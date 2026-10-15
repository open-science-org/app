// The payout waterfall, approval rules and settlement queue (OIP-14 sections 3, 7, 8, 9 and 10).
import { BPS, IDEA_UNITS, acct, transfer, type Idea, type State, type WeightSet } from './state.ts';

export type Event =
  | { type: 'received'; idea: string; amount: string }
  | { type: 'distributed'; idea: string; to: string; amount: string }
  | { type: 'settled'; from: string; to: string; amount: string }
  | { type: 'minted'; idea: string; amount: string }
  | { type: 'released'; idea: string; authors: string; fund: string; cited: string }
  | { type: 'burned'; idea: string; amount: string }
  | { type: 'status'; idea: string; status: string };

const big = (x: string | undefined) => BigInt(x ?? '0');

function sortedParents(idea: Idea): [string, bigint][] {
  if (!idea.weights) return [];
  return Object.entries(idea.weights.parents)
    .map(([j, w]) => [j, BigInt(w)] as [string, bigint])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** What I currently owes parent j: under the current weight set plus any earlier set. */
export function owed(idea: Idea, j: string): bigint {
  const w = idea.weights?.parents[j];
  const current = w === undefined ? 0n : (big(idea.wf.up) * BigInt(w)) / BPS - big(idea.wf.paid[j]);
  return current + big(idea.wf.legacy[j]);
}

function owedParents(idea: Idea): string[] {
  const names = new Set([...Object.keys(idea.weights?.parents ?? {}), ...Object.keys(idea.wf.legacy)]);
  return [...names].sort();
}

function enqueue(s: State, child: string, parent: string) {
  const key = `${child}|${parent}`;
  if (!s.queue.includes(key)) s.queue.push(key);
}

/** OIP-14 section 3.2: may `parent` be a payout parent of `child`? */
export function isEarlier(parent: Idea, child: Idea): boolean {
  if (parent.origin_date < child.origin_date) return true;
  return (
    parent.origin_date === child.origin_date &&
    parent.kind === 'submission' &&
    child.kind === 'submission' &&
    parent.origin_block < child.origin_block
  );
}

/** Records a complete weight set for a child (OIP-14 section 7), carrying held amounts (section 8.4). */
export function approveWeights(
  s: State, childId: string, parents: Record<string, number>, approval: Pick<WeightSet, 'authority' | 'basis'>,
) {
  const child = s.ideas[childId];
  if (!child) throw new Error(`unknown idea ${childId}`);
  let sum = 0;
  for (const [j, w] of Object.entries(parents)) {
    const parent = s.ideas[j];
    if (!parent) throw new Error(`unknown parent ${j}`);
    if (j === childId) throw new Error('an idea cannot be its own parent');
    if (parent.tier === 'read-only') throw new Error(`parent ${j} is a read-only import, which has no payout edges (OIP-14 section 7)`);
    if (parent.status === 'removed') throw new Error(`parent ${j} was removed`);
    if (!Number.isInteger(w) || w <= 0) throw new Error('weights must be positive integers in bps');
    if (!isEarlier(parent, child)) throw new Error(`parent ${j} is not older than the child (OIP-14 section 3)`);
    sum += w;
  }
  if (Object.keys(parents).length > 0 && sum !== 10_000) throw new Error(`weights sum to ${sum}, not 10,000`);

  const wf = child.wf;
  if (child.weights) {
    const up = big(wf.up);
    let allocated = 0n;
    for (const [j, w] of sortedParents(child)) {
      const share = (up * w) / BPS;
      allocated += share;
      const still = share - big(wf.paid[j]);
      if (still > 0n) wf.legacy[j] = (big(wf.legacy[j]) + still).toString();
    }
    const carry = up - allocated;
    wf.up = carry.toString();
    wf.num = (carry * BPS).toString();
    wf.paid = {};
  }
  child.weights = Object.keys(parents).length ? { parents: { ...parents }, effective_block: s.height, ...approval } : null;
}

/** Pays `amount` out of the idea account to IDEA holders, pro rata, carrying the residue (section 8.2). */
function distribute(s: State, ideaId: string, amount: bigint, events: Event[]) {
  const idea = s.ideas[ideaId];
  const total = amount + big(idea.wf.residue);
  let paid = 0n;
  for (const holder of Object.keys(idea.holders).sort()) {
    const share = (total * BigInt(idea.holders[holder])) / BigInt(IDEA_UNITS);
    if (share === 0n) continue;
    transfer(s, acct.idea(ideaId), holder, share);
    events.push({ type: 'distributed', idea: ideaId, to: holder, amount: share.toString() });
    paid += share;
  }
  idea.wf.residue = (total - paid).toString();
}

/**
 * Incoming value v, already credited to the idea account, enters the waterfall (section 8).
 * The upstream part stays in the account as a pending liability to parents; the rest goes to holders.
 */
export function receive(s: State, ideaId: string, v: bigint, events: Event[]) {
  const idea = s.ideas[ideaId];
  events.push({ type: 'received', idea: ideaId, amount: v.toString() });
  let upstream = 0n;
  if (idea.weights) {
    const num = big(idea.wf.num) + v * (BPS - BigInt(idea.alpha));
    upstream = num / BPS - big(idea.wf.up);
    idea.wf.num = num.toString();
    idea.wf.up = (big(idea.wf.up) + upstream).toString();
    const dust = BigInt(s.params!.dust);
    for (const [j] of sortedParents(idea)) if (owed(idea, j) >= dust) enqueue(s, ideaId, j);
  }
  distribute(s, ideaId, v - upstream, events);
}

/** Transfers everything I owes j and runs the waterfall at j. */
function settle(s: State, childId: string, parentId: string, events: Event[]) {
  const child = s.ideas[childId];
  const amount = owed(child, parentId);
  if (amount <= 0n) return;
  const w = child.weights?.parents[parentId];
  if (w !== undefined) {
    const current = (big(child.wf.up) * BigInt(w)) / BPS;
    child.wf.paid[parentId] = current.toString();
  }
  delete child.wf.legacy[parentId];
  transfer(s, acct.idea(childId), acct.idea(parentId), amount);
  events.push({ type: 'settled', from: childId, to: parentId, amount: amount.toString() });
  receive(s, parentId, amount, events);
}

/** Queues every pair with anything owed, in ascending order (section 10.2). */
export function queueAllOwed(s: State) {
  for (const childId of Object.keys(s.ideas).sort()) {
    const child = s.ideas[childId];
    for (const j of owedParents(child)) if (owed(child, j) > 0n) enqueue(s, childId, j);
  }
}

/** Processes up to `cap` queue entries in order (section 9.4). */
export function processQueue(s: State, cap: number, events: Event[]) {
  for (let n = 0; n < cap && s.queue.length > 0; n++) {
    const [child, parent] = s.queue.shift()!.split('|');
    settle(s, child, parent, events);
  }
}

/** Settles everything owed, ignoring dust and caps. Used only for simulations. */
export function settleAll(s: State, events: Event[]) {
  for (let guard = 0; guard < 10_000; guard++) {
    queueAllOwed(s);
    if (s.queue.length === 0) return;
    processQueue(s, Number.MAX_SAFE_INTEGER, events);
  }
  throw new Error('settlement did not terminate');
}
