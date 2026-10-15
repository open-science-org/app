// Transactions, blocks and replay (OIP-13), with the transaction types of the minimal node.
//
// Validation (OIP-11) and claims (OIP-10 section 6) are not built yet. Until they are, the operator
// records their outcomes with `idea.admit` and `idea.remove`, which stand in for a validator vote and
// an upheld challenge, and imported works keep their IDEA units in the unresolved-claims account.
import { canonicalize, hashOf, merkleRoot, recoverSigner, signMessage, addressOf } from './crypto.ts';
import {
  BPS, IDEA_UNITS, acct, balance, burnFrom, cloneState, emptyState, freezeVersion, mintTo, stateHash, totalBalances, transfer,
  type Idea, type Params, type State, type Version,
} from './state.ts';
import { approveWeights, isEarlier, processQueue, queueAllOwed, receive, type Event } from './waterfall.ts';

export interface Tx {
  domain: { protocol: 'OSO'; network: string; version: 1 };
  type: string;
  sender: string;
  nonce: number;
  custody: 'self' | 'operator';
  body: Record<string, any>;
  signature: string;
}

export interface TxResult {
  tx: Tx;
  ok: boolean;
  error?: string;
}

export interface Block {
  number: number;
  prev_hash: string | null;
  timestamp: string;
  day_label: string;
  txs: TxResult[];
  tx_root: string;
  events: Event[];
  state_hash: string;
  hash: string;
  signature: string;
}

export const VERSION_FIELDS = [
  'schema', 'type', 'title', 'abstract', 'domain_tags', 'content_refs', 'previous', 'parents', 'cites',
  'targets', 'license', 'ai_disclosure', 'owners', 'attribution', 'external_ids', 'registrant',
];
const IDEA_TYPES = ['paper', 'preprint', 'dataset', 'code', 'review', 'replication', 'hypothesis', 'other'];

export function txMessage(tx: Omit<Tx, 'signature'> | Tx): string {
  const { signature: _ignored, ...unsigned } = tx as Tx;
  return canonicalize(unsigned);
}

export function signTx(privateKey: string, tx: Omit<Tx, 'signature'>): Tx {
  return { ...tx, signature: signMessage(privateKey, txMessage(tx)) };
}

export function makeTx(
  privateKey: string, state: State, type: string, body: Record<string, any>, nonceOffset = 0,
): Tx {
  const sender = addressOf(privateKey);
  const network = state.params?.network ?? body.params?.network;
  return signTx(privateKey, {
    domain: { protocol: 'OSO', network, version: 1 },
    type,
    sender,
    nonce: (state.nonces[sender] ?? 0) + nonceOffset,
    custody: 'operator',
    body,
  });
}

export const versionId = (v: Version) => hashOf(v);
export const ownerMessage = (versionIdHex: string) => `OSO idea version ${versionIdHex}`;

/** Envelope checks (OIP-13 section 1). A tx failing these is never included in a block. */
export function checkEnvelope(s: State, tx: Tx): string | null {
  if (tx.domain?.protocol !== 'OSO' || tx.domain.version !== 1) return 'bad domain';
  if (s.params && tx.domain.network !== s.params.network) return 'wrong network';
  const signer = recoverSigner(txMessage(tx), tx.signature);
  if (!signer || signer !== tx.sender) return 'bad signature';
  if (tx.nonce !== (s.nonces[tx.sender] ?? 0)) return `bad nonce: expected ${s.nonces[tx.sender] ?? 0}`;
  return null;
}

function requireOperator(s: State, tx: Tx) {
  if (tx.sender !== s.operator) throw new Error('only the operator may send this transaction in v0');
}

function amountOf(x: unknown): bigint {
  if (typeof x !== 'string' || !/^\d+$/.test(x)) throw new Error('amounts must be decimal strings of base units');
  return BigInt(x);
}

function checkVersion(v: Version) {
  const keys = Object.keys(v ?? {});
  const extra = keys.filter((k) => !VERSION_FIELDS.includes(k));
  const missing = VERSION_FIELDS.filter((k) => !keys.includes(k));
  if (extra.length || missing.length) throw new Error(`version fields: missing [${missing}] extra [${extra}]`);
  if (v.schema !== 'oso.idea/1') throw new Error('schema must be oso.idea/1');
  if (!IDEA_TYPES.includes(v.type.split('/')[0])) throw new Error(`unknown idea type ${v.type}`);
  if (v.title.length > 300 || v.abstract.length > 5000) throw new Error('title or abstract too long');
  if (canonicalize(v).length > 64 * 1024) throw new Error('version larger than 64 KiB');
}

function newIdea(s: State, v: Version, id: string, kind: Idea['kind'], origin: string): Idea {
  return {
    work_id: id,
    versions: [id],
    current: freezeVersion(structuredClone(v)),
    kind,
    tier: null,
    origin_date: origin,
    origin_block: s.height,
    status: kind === 'import' ? 'imported' : 'submitted',
    holders: {},
    alpha: s.params!.alpha_default,
    weights: null,
    wf: { num: '0', up: '0', paid: {}, legacy: {}, residue: '0' },
    submitter: null,
    stake: '0',
    mint: '0',
    window_end: null,
    validators: [],
  };
}

type Handler = (s: State, tx: Tx, events: Event[]) => void;

const handlers: Record<string, Handler> = {
  genesis(s, tx) {
    if (s.height !== 0 || s.operator) throw new Error('genesis only in block 0');
    const params = tx.body.params as Params;
    s.operator = tx.sender;
    s.params = params;
    mintTo(s, acct.bootstrap, amountOf(tx.body.bootstrap));
  },

  'bootstrap.grant'(s, tx) {
    requireOperator(s, tx);
    const to = tx.body.to === 'fund' ? acct.fund : acct.user(tx.body.to);
    transfer(s, acct.bootstrap, to, amountOf(tx.body.amount));
  },

  transfer(s, tx) {
    transfer(s, acct.user(tx.sender), acct.user(tx.body.to), amountOf(tx.body.amount));
  },

  // OIP-16 section 9 and OIP-10 section 6: imports carry attribution only; IDEA units stay unresolved.
  'idea.import'(s, tx) {
    requireOperator(s, tx);
    const v = tx.body.version as Version;
    checkVersion(v);
    if (v.owners.length) throw new Error('imported works have no owners');
    if (v.registrant !== tx.sender) throw new Error('registrant must be the sender');
    if (!Object.keys(v.external_ids).length) throw new Error('imports need external_ids');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.body.origin_date)) throw new Error('origin_date must be yyyy-mm-dd');
    const id = versionId(v);
    if (s.version_index[id]) throw new Error('version already registered');
    for (const [k, val] of Object.entries(v.external_ids)) {
      if (s.external_index[`${k}:${val}`]) throw new Error(`${k}:${val} already belongs to another work`);
    }
    const idea = newIdea(s, v, id, 'import', tx.body.origin_date);
    idea.tier = tx.body.tier === 'curated' ? 'curated' : 'read-only';
    idea.holders = { [acct.unresolved(id)]: IDEA_UNITS };
    s.ideas[id] = idea;
    s.version_index[id] = id;
    for (const [k, val] of Object.entries(v.external_ids)) s.external_index[`${k}:${val}`] = id;
  },

  // OIP-14 section 7: the disclosed weight panel approves weights for curated imports.
  'weights.approve'(s, tx) {
    requireOperator(s, tx);
    const idea = s.ideas[tx.body.work_id];
    if (!idea || idea.kind !== 'import' || idea.tier !== 'curated') {
      throw new Error('the panel approves weights only for curated imports; submissions get theirs at admission');
    }
    if (typeof tx.body.basis !== 'string' || !tx.body.basis) throw new Error('state the basis for the weights');
    approveWeights(s, idea.work_id, tx.body.parents, { authority: 'panel', basis: tx.body.basis });
  },

  // OIP-16, OIP-10 section 4, OIP-8 section 8: signed by every owner, stake locked.
  'idea.submit'(s, tx) {
    const v = tx.body.version as Version;
    checkVersion(v);
    if (v.previous !== null) throw new Error('new versions of existing works are not supported yet');
    if (v.registrant !== tx.sender) throw new Error('registrant must be the sender');
    if (!v.owners.length) throw new Error('a submission needs owners');
    const shares = v.owners.reduce((a, o) => a + o.share_bps, 0);
    if (shares !== 10_000 || v.owners.some((o) => !Number.isInteger(o.share_bps) || o.share_bps <= 0)) {
      throw new Error('owner shares must be positive and sum to 10,000');
    }
    if (!v.owners.some((o) => o.identity === tx.sender)) throw new Error('the sender must be an owner');
    if (!v.content_refs.some((r) => r.role === 'main' && /^sha256:[0-9a-f]{64}$/.test(r.hash))) {
      throw new Error('a submission needs a main content reference with a sha256 hash');
    }
    const id = versionId(v);
    if (s.version_index[id]) throw new Error('version already registered');
    const sigs = (tx.body.owner_signatures ?? {}) as Record<string, string>;
    for (const o of v.owners) {
      if (recoverSigner(ownerMessage(id), sigs[o.identity] ?? '') !== o.identity) {
        throw new Error(`missing or invalid signature from owner ${o.identity}`);
      }
    }
    if (v.parents.length && v.parents.reduce((a, p) => a + p.weight_bps, 0) !== 10_000) {
      throw new Error('proposed parent weights must sum to 10,000');
    }
    const idea = newIdea(s, v, id, 'submission', s.day);
    for (const p of v.parents) {
      const parent = s.ideas[s.version_index[p.version_id] ?? ''];
      if (!parent) throw new Error(`parent ${p.version_id} is not in the graph`);
      if (!isEarlier(parent, idea)) throw new Error(`parent ${p.version_id} is not older than this idea`);
    }
    const stake = BigInt(s.params!.stake);
    idea.submitter = tx.sender;
    idea.stake = stake.toString();
    idea.holders = Object.fromEntries(v.owners.map((o) => [acct.user(o.identity), o.share_bps * 100]));
    s.ideas[id] = idea;
    s.version_index[id] = id;
    transfer(s, acct.user(tx.sender), acct.stake(id), stake);
  },

  // Stand-in for an OIP-11 admission vote: pays fees (OIP-8 section 4a), approves the proposed
  // weights (OIP-14 section 7), and mints into escrow (OIP-8 sections 3 and 4).
  'idea.admit'(s, tx, events) {
    requireOperator(s, tx);
    const idea = s.ideas[tx.body.work_id];
    if (!idea || idea.status !== 'submitted') throw new Error('only a submitted idea can be admitted');
    const validators = (tx.body.validators ?? []) as string[];
    if (!validators.length || new Set(validators).size !== validators.length) throw new Error('list each on-time validator once');
    const owners = new Set(idea.current.owners.map((o) => o.identity));
    if (validators.some((x) => owners.has(x))) throw new Error('an owner cannot validate their own idea');
    const fee = BigInt(s.params!.validator_fee);
    if (balance(s, acct.fund) < fee * BigInt(validators.length)) {
      throw new Error('the OSO fund cannot pay validator fees; the idea waits (OIP-11)');
    }
    for (const x of validators) transfer(s, acct.fund, acct.user(x), fee);
    const parents = Object.fromEntries(idea.current.parents.map((p) => [s.version_index[p.version_id], p.weight_bps]));
    approveWeights(s, idea.work_id, parents, { authority: 'admission', basis: 'owners\' proposed weights, approved by admission' });
    const remaining = BigInt(s.params!.supply_cap) - BigInt(s.minted);
    const m = remaining / BigInt(s.params!.mint_rate_inv);
    mintTo(s, acct.escrow(idea.work_id), m);
    s.mints += 1;
    idea.mint = m.toString();
    idea.validators = validators;
    idea.status = 'admitted';
    idea.window_end = s.height + s.params!.challenge_window;
    events.push({ type: 'minted', idea: idea.work_id, amount: m.toString() });
    events.push({ type: 'status', idea: idea.work_id, status: 'admitted' });
  },

  // Stand-in for an upheld challenge with no appeal (OIP-11 section 5.3): burn the mint, slash the stake.
  'idea.remove'(s, tx, events) {
    requireOperator(s, tx);
    const idea = s.ideas[tx.body.work_id];
    if (!idea || idea.status !== 'admitted') throw new Error('only an admitted idea in its window can be removed');
    burnFrom(s, acct.escrow(idea.work_id), BigInt(idea.mint));
    transfer(s, acct.stake(idea.work_id), acct.fund, BigInt(idea.stake));
    idea.status = 'removed';
    idea.window_end = null;
    events.push({ type: 'burned', idea: idea.work_id, amount: idea.mint });
    events.push({ type: 'status', idea: idea.work_id, status: 'removed' });
  },

  // Funding enters the waterfall (OIP-14 section 8, income types).
  'idea.fund'(s, tx, events) {
    const idea = s.ideas[tx.body.work_id];
    if (!idea || !['imported', 'published'].includes(idea.status)) throw new Error('only imported or published ideas can be funded');
    const amount = amountOf(tx.body.amount);
    if (amount === 0n) throw new Error('amount must be positive');
    transfer(s, acct.user(tx.sender), acct.idea(idea.work_id), amount);
    receive(s, idea.work_id, amount, events);
  },
};

export const TX_TYPES = Object.keys(handlers);

/** Releases a mint whose challenge window has closed (OIP-8 sections 4.5 and 4.6). */
function publish(s: State, idea: Idea, events: Event[]) {
  const m = BigInt(idea.mint);
  const escrow = acct.escrow(idea.work_id);
  const authors = (m * 5_000n) / BPS;
  const cited = (m * 1_500n) / BPS;
  let paidAuthors = 0n;
  for (const holder of Object.keys(idea.holders).sort()) {
    const share = (authors * BigInt(idea.holders[holder])) / BigInt(IDEA_UNITS);
    transfer(s, escrow, holder, share);
    paidAuthors += share;
  }
  let paidCited = 0n;
  for (const [j, w] of Object.entries(idea.weights?.parents ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const share = (cited * BigInt(w)) / BPS;
    transfer(s, escrow, acct.idea(j), share);
    receive(s, j, share, events);
    paidCited += share;
  }
  // Fund share, every rounding residue, and the cited share when there are no parents (OIP-8 section 4).
  const toFund = balance(s, escrow);
  transfer(s, escrow, acct.fund, toFund);
  transfer(s, acct.stake(idea.work_id), acct.user(idea.submitter!), BigInt(idea.stake));
  idea.status = 'published';
  idea.window_end = null;
  events.push({
    type: 'released', idea: idea.work_id, authors: paidAuthors.toString(), fund: toFund.toString(), cited: paidCited.toString(),
  });
  events.push({ type: 'status', idea: idea.work_id, status: 'published' });
}

/** Block-end processing (OIP-12 section 4a): window closings, then settlement. */
function blockEnd(s: State, events: Event[]) {
  if (!s.params) return;
  for (const id of Object.keys(s.ideas).sort()) {
    const idea = s.ideas[id];
    if (idea.status === 'admitted' && idea.window_end !== null && idea.window_end <= s.height) publish(s, idea, events);
  }
  if (s.height % s.params.round_blocks === s.params.round_blocks - 1) queueAllOwed(s);
  processQueue(s, s.params.settle_cap, events);
}

export interface Header {
  number: number;
  prev_hash: string | null;
  timestamp: string;
  day_label: string;
}

/** Runs one block's transactions and block-end processing on a copy of the state. */
export function execute(prev: State, header: Header, txs: Tx[]): { state: State; results: TxResult[]; events: Event[] } {
  if (header.number !== prev.height + 1) throw new Error(`expected block ${prev.height + 1}`);
  if (prev.day && header.day_label < prev.day) throw new Error('day labels must not decrease');
  let s = cloneState(prev);
  s.height = header.number;
  s.day = header.day_label;
  const results: TxResult[] = [];
  const events: Event[] = [];
  for (const tx of txs) {
    const bad = checkEnvelope(s, tx);
    if (bad) throw new Error(`invalid transaction envelope: ${bad}`);
    const handler = handlers[tx.type];
    const before = cloneState(s);
    const txEvents: Event[] = [];
    try {
      if (!handler) throw new Error(`unknown transaction type ${tx.type}`);
      handler(s, tx, txEvents);
      events.push(...txEvents);
      results.push({ tx, ok: true });
    } catch (e) {
      s = before; // failed transactions change nothing but still use their nonce (OIP-12 section 4.4)
      results.push({ tx, ok: false, error: (e as Error).message });
    }
    s.nonces[tx.sender] = (s.nonces[tx.sender] ?? 0) + 1;
  }
  blockEnd(s, events);
  const total = totalBalances(s);
  const expected = BigInt(s.minted) - BigInt(s.burned);
  if (total !== expected) throw new Error(`conservation violated: balances ${total}, supply ${expected}`);
  return { state: s, results, events };
}

function blockBody(header: Header, results: TxResult[], events: Event[], state: State) {
  return {
    ...header,
    txs: results,
    tx_root: merkleRoot(results.map((r) => canonicalize(r.tx))),
    events,
    state_hash: stateHash(state),
  };
}

/** Produces and signs the next block. */
export function produceBlock(
  prev: State, prevHash: string | null, txs: Tx[], operatorKey: string, now = new Date(),
): { block: Block; state: State } {
  const header: Header = {
    number: prev.height + 1,
    prev_hash: prevHash,
    timestamp: now.toISOString(),
    day_label: now.toISOString().slice(0, 10),
  };
  if (prev.day && header.day_label < prev.day) header.day_label = prev.day;
  const { state, results, events } = execute(prev, header, txs);
  const body = blockBody(header, results, events, state);
  const hash = hashOf(body);
  const block: Block = { ...body, hash, signature: signMessage(operatorKey, hash) };
  if (state.operator && addressOf(operatorKey) !== state.operator) throw new Error('block not signed by the operator');
  return { block, state };
}

/** Re-executes a block and checks every recorded field (OIP-13 section 5). */
export function applyBlock(prev: State, prevHash: string | null, block: Block): State {
  if (block.prev_hash !== prevHash) throw new Error(`block ${block.number}: previous hash mismatch`);
  const header: Header = {
    number: block.number, prev_hash: block.prev_hash, timestamp: block.timestamp, day_label: block.day_label,
  };
  const { state, results, events } = execute(prev, header, block.txs.map((r) => r.tx));
  const body = blockBody(header, results, events, state);
  if (canonicalize(body.txs) !== canonicalize(block.txs)) throw new Error(`block ${block.number}: transaction results differ`);
  if (canonicalize(events) !== canonicalize(block.events)) throw new Error(`block ${block.number}: events differ`);
  if (body.state_hash !== block.state_hash) throw new Error(`block ${block.number}: state hash differs`);
  if (hashOf(body) !== block.hash) throw new Error(`block ${block.number}: block hash differs`);
  if (recoverSigner(block.hash, block.signature) !== state.operator) throw new Error(`block ${block.number}: not signed by the operator`);
  return state;
}

export function replay(blocks: Block[]): State {
  let s = emptyState();
  let prevHash: string | null = null;
  for (const b of blocks) {
    s = applyBlock(s, prevHash, b);
    prevHash = b.hash;
  }
  return s;
}
