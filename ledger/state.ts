// Ledger state and its types. Amounts are bigints in base units, stored as decimal strings so the
// state serializes canonically (OIP-8 section 1, OIP-13 section 3).
import { hashOf } from './crypto.ts';

export const BPS = 10_000n;
export const ONE_OSO = 10n ** 18n;
export const IDEA_UNITS = 1_000_000;

export interface Params {
  network: string;
  supply_cap: string; // T, base units (OIP-8 section 3)
  mint_rate_inv: string; // R_inv
  alpha_default: number; // α in bps (OIP-14 section 11)
  dust: string; // D, base units
  round_blocks: number; // K
  settle_cap: number; // queue entries settled per block
  challenge_window: number; // W, blocks
  stake: string; // s_sub
  validator_fee: string; // f_val
}

export interface ContentRef {
  role: 'main' | 'supplement' | 'data' | 'code';
  hash: string;
  uri: string;
  media_type: string;
}

/** An idea version, exactly the fields of OIP-16 section 4. */
export interface Version {
  schema: string;
  type: string;
  title: string;
  abstract: string;
  domain_tags: string[];
  content_refs: ContentRef[];
  previous: string | null;
  parents: { version_id: string; weight_bps: number }[];
  cites: ({ version_id: string } | { external_id: string })[];
  targets: Record<string, string>;
  license: string;
  ai_disclosure: { level: 'none' | 'assisted' | 'generated'; description: string };
  owners: { identity: string; share_bps: number }[];
  attribution: { name: string; orcid: string }[];
  external_ids: Record<string, string>;
  registrant: string;
}

/** An approved weight set (OIP-14 section 7.1): who approved it, on what basis, from which block. */
export interface WeightSet {
  parents: Record<string, number>;
  effective_block: number;
  authority: 'admission' | 'panel';
  basis: string;
}

export type IdeaStatus = 'imported' | 'submitted' | 'admitted' | 'published' | 'removed';

/** Payout waterfall counters for the current weight set (OIP-14 section 8). */
export interface Waterfall {
  num: string;
  up: string;
  paid: Record<string, string>;
  /** Amounts still owed to parents of an earlier weight set (OIP-14 section 8.4). */
  legacy: Record<string, string>;
  /** Distribution residue carried to the next distribution. */
  residue: string;
}

export interface Idea {
  work_id: string;
  versions: string[];
  current: Version;
  kind: 'import' | 'submission';
  tier: 'curated' | 'read-only' | null;
  origin_date: string;
  origin_block: number;
  status: IdeaStatus;
  /** IDEA units by account (OIP-8 section 9). */
  holders: Record<string, number>;
  alpha: number;
  weights: WeightSet | null;
  wf: Waterfall;
  submitter: string | null;
  stake: string;
  mint: string;
  window_end: number | null;
  validators: string[];
}

export interface State {
  height: number;
  day: string;
  operator: string | null;
  params: Params | null;
  nonces: Record<string, number>;
  balances: Record<string, string>;
  minted: string;
  burned: string;
  mints: number;
  ideas: Record<string, Idea>;
  version_index: Record<string, string>;
  external_index: Record<string, string>;
  /** Settlement queue of "child|parent" pairs (OIP-14 section 9). */
  queue: string[];
}

export function emptyState(): State {
  return {
    height: -1,
    day: '',
    operator: null,
    params: null,
    nonces: {},
    balances: {},
    minted: '0',
    burned: '0',
    mints: 0,
    ideas: {},
    version_index: {},
    external_index: {},
    queue: [],
  };
}

/** Deep-freezes an idea version on registration: versions are immutable (OIP-16 section 4). */
export function freezeVersion<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) freezeVersion(x);
  }
  return v;
}

/** Copies the state, sharing the immutable version objects instead of copying them. */
export function cloneState(s: State): State {
  const ideas: Record<string, Idea> = {};
  for (const [k, idea] of Object.entries(s.ideas)) {
    const { current, ...rest } = idea;
    ideas[k] = { ...structuredClone(rest), current };
  }
  return { ...structuredClone({ ...s, ideas: {} }), ideas };
}

export function stateHash(s: State): string {
  return hashOf(s);
}

// Account names (OIP-8 section 2).
export const acct = {
  user: (address: string) => `user:${address}`,
  idea: (work: string) => `idea:${work}`,
  escrow: (work: string) => `escrow:${work}`,
  stake: (work: string) => `stake:${work}`,
  unresolved: (work: string) => `unresolved:${work}`,
  fund: 'fund',
  bootstrap: 'bootstrap',
};

export function balance(s: State, account: string): bigint {
  return BigInt(s.balances[account] ?? '0');
}

function setBalance(s: State, account: string, value: bigint) {
  if (value < 0n) throw new Error(`negative balance for ${account}`);
  if (value === 0n) delete s.balances[account];
  else s.balances[account] = value.toString();
}

export function transfer(s: State, from: string, to: string, amount: bigint) {
  if (amount < 0n) throw new Error('negative amount');
  if (amount === 0n) return;
  const have = balance(s, from);
  if (have < amount) throw new Error(`insufficient balance in ${from}: has ${have}, needs ${amount}`);
  setBalance(s, from, have - amount);
  setBalance(s, to, balance(s, to) + amount);
}

export function mintTo(s: State, account: string, amount: bigint) {
  setBalance(s, account, balance(s, account) + amount);
  s.minted = (BigInt(s.minted) + amount).toString();
}

export function burnFrom(s: State, account: string, amount: bigint) {
  const have = balance(s, account);
  if (have < amount) throw new Error(`cannot burn ${amount} from ${account}`);
  setBalance(s, account, have - amount);
  s.burned = (BigInt(s.burned) + amount).toString();
}

/** Conservation check (OIP-8 section 1.3): all balances sum to minted minus burned. */
export function totalBalances(s: State): bigint {
  return Object.values(s.balances).reduce((a, b) => a + BigInt(b), 0n);
}

export function formatOSO(base: bigint | string, decimals = 4): string {
  const v = BigInt(base);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / ONE_OSO;
  const frac = (abs % ONE_OSO).toString().padStart(18, '0').slice(0, decimals).replace(/0+$/, '');
  return (neg ? '-' : '') + whole.toString() + (frac ? '.' + frac : '');
}

export function parseOSO(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim());
  if (!m) throw new Error(`not an OSO amount: ${text}`);
  return BigInt(m[1]) * ONE_OSO + BigInt((m[2] ?? '').padEnd(18, '0') || '0');
}
