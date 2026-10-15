// Test cases from OIP-8 and OIP-14, plus ledger rules from OIPs 10, 11, 13 and 16.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chain } from '../src/chain.ts';
import { addressOf, devKey, signMessage } from '../src/crypto.ts';
import { DEV_PARAMS, advance, devKeys, seedDemo } from '../src/demo.ts';
import { makeTx, ownerMessage, replay, versionId, type Block } from '../src/ledger.ts';
import { ONE_OSO, acct, balance, stateHash, type Params } from '../src/state.ts';
import { importVersion, submissionVersion } from '../src/versions.ts';

const OSO = (n: number) => BigInt(n) * ONE_OSO;
const op = devKeys.operator;
const key = (name: string) => devKey('test:' + name);
const addr = (name: string) => addressOf(key(name));

function fixture(keyName: string, date: string, parents: Record<string, number> = {}) {
  return { key: keyName, title: `Work ${keyName}`, summary: 's', authors: ['X'], arxiv: `0000.${keyName}`, date, parents };
}

/** Genesis plus users with balances; returns the chain and a helper to send transactions. */
function setup(overrides: Partial<Params> = {}, bootstrap = OSO(100_000), grants: Record<string, bigint> = {}) {
  const chain = new Chain(op);
  const params = { ...DEV_PARAMS, ...overrides };
  chain.commit([makeTx(op, chain.state, 'genesis', { params, bootstrap: bootstrap.toString() })]);
  const g = Object.entries(grants).map(([to, amount], i) =>
    makeTx(op, chain.state, 'bootstrap.grant', { to: to === 'fund' ? 'fund' : addr(to), amount: amount.toString() }, i));
  if (g.length) chain.commit(g);
  return chain;
}

function importWorks(chain: Chain, works: ReturnType<typeof fixture>[]) {
  const ids: Record<string, string> = {};
  const txs = works.map((f, i) => {
    const v = importVersion(f, addressOf(op));
    ids[f.key] = versionId(v);
    return makeTx(op, chain.state, 'idea.import', { version: v, origin_date: f.date, tier: 'curated' }, i);
  });
  chain.commit(txs);
  return ids;
}

/** Submits a new idea owned by the given (name, share) pairs, admits it and waits out the window. */
function submitAndPublish(chain: Chain, owners: [string, number][], parents: [string, number][], validators = ['v1', 'v2', 'v3']) {
  const version = submissionVersion({
    type: 'hypothesis', title: 'Child', abstract: 'a', content: 'child content ' + chain.state.height,
    parents: parents.map(([version_id, weight_bps]) => ({ version_id, weight_bps })),
    owners: owners.map(([n, share_bps]) => ({ identity: addr(n), share_bps })),
    attribution: owners.map(([n]) => n), registrant: addr(owners[0][0]),
  });
  const id = versionId(version);
  const owner_signatures = Object.fromEntries(owners.map(([n]) => [addr(n), signMessage(key(n), ownerMessage(id))]));
  const sub = chain.commit([makeTx(key(owners[0][0]), chain.state, 'idea.submit', { version, owner_signatures })]);
  assert.ok(sub.txs[0].ok, sub.txs[0].error);
  const adm = chain.commit([makeTx(op, chain.state, 'idea.admit', { work_id: id, validators: validators.map(addr) })]);
  assert.ok(adm.txs[0].ok, adm.txs[0].error);
  advance(chain, chain.state.params!.challenge_window);
  assert.equal(chain.state.ideas[id].status, 'published');
  return id;
}

function fund(chain: Chain, from: string, work_id: string, amount: bigint, nonceOffset = 0) {
  return makeTx(key(from), chain.state, 'idea.fund', { work_id, amount: amount.toString() }, nonceOffset);
}

function sumEvents(blocks: Block[], pred: (e: any) => boolean): bigint {
  return blocks.flatMap((b) => b.events).filter(pred).reduce((a, e: any) => a + BigInt(e.amount), 0n);
}

test('OIP-8 mint test case: first mint of 100 OSO splits 50 / 35 / 9 / 6', () => {
  const chain = setup({ stake: '0', validator_fee: '0' }, 0n);
  const ids = importWorks(chain, [fixture('p1', '2020-01-01'), fixture('p2', '2020-01-02')]);
  const before = chain.blocks.length;
  const child = submitAndPublish(chain, [['a', 10_000]], [[ids.p1, 6_000], [ids.p2, 4_000]]);
  const blocks = chain.blocks.slice(before);
  const minted = blocks.flatMap((b) => b.events).find((e) => e.type === 'minted')!;
  assert.equal(BigInt((minted as any).amount), OSO(100));
  const released = blocks.flatMap((b) => b.events).find((e) => e.type === 'released') as any;
  assert.equal(BigInt(released.authors), OSO(50));
  assert.equal(BigInt(released.fund), OSO(35));
  assert.equal(sumEvents(blocks, (e) => e.type === 'received' && e.idea === ids.p1), OSO(9));
  assert.equal(sumEvents(blocks, (e) => e.type === 'received' && e.idea === ids.p2), OSO(6));
  assert.equal(balance(chain.state, acct.user(addr('a'))), OSO(50));
  assert.equal(balance(chain.state, acct.escrow(child)), 0n);
});

test('OIP-14 waterfall test case: 100 OSO to I gives P1 12, P2 8, A 48, B 20, investor 12', () => {
  const chain = setup({}, OSO(100_000), { fund: OSO(1_000), a: OSO(100), funder: OSO(1_000) });
  const ids = importWorks(chain, [fixture('p1', '2020-01-01'), fixture('p2', '2020-01-02')]);
  const child = submitAndPublish(chain, [['a', 6_000], ['b', 2_500], ['investor', 1_500]], [[ids.p1, 6_000], [ids.p2, 4_000]]);
  const b = chain.commit([fund(chain, 'funder', child, OSO(100))]);
  assert.ok(b.txs[0].ok, b.txs[0].error);
  const paid = (to: string) => sumEvents([b], (e) => e.type === 'distributed' && e.idea === child && e.to === to);
  assert.equal(paid(acct.user(addr('a'))), OSO(48));
  assert.equal(paid(acct.user(addr('b'))), OSO(20));
  assert.equal(paid(acct.user(addr('investor'))), OSO(12));
  assert.equal(sumEvents([b], (e) => e.type === 'settled' && e.to === ids.p1), OSO(12));
  assert.equal(sumEvents([b], (e) => e.type === 'settled' && e.to === ids.p2), OSO(8));
  assert.equal(balance(chain.state, acct.idea(child)), 0n);
});

/** One curated child with one parent (w = 10,000), α = 8,000, dust D = 2,000 base units. */
function splitSetup() {
  const chain = setup({ dust: '2000', round_blocks: 100 }, OSO(100_000), { funder: OSO(10) });
  const ids = importWorks(chain, [fixture('parent', '2020-01-01'), fixture('child', '2021-01-01')]);
  chain.commit([makeTx(op, chain.state, 'weights.approve', { work_id: ids.child, parents: { [ids.parent]: 10_000 } })]);
  return { chain, ids };
}

function settledTo(chain: Chain, parent: string) {
  return sumEvents(chain.blocks, (e) => e.type === 'settled' && e.to === parent);
}

function finishRound(chain: Chain) {
  const k = chain.state.params!.round_blocks;
  advance(chain, k - (chain.state.height % k));
}

test('OIP-14 split payments: one payment of 10,000 settles 2,000 at once', () => {
  const { chain, ids } = splitSetup();
  const b = chain.commit([fund(chain, 'funder', ids.child, 10_000n)]);
  assert.equal(sumEvents([b], (e) => e.type === 'settled'), 2_000n);
});

test('OIP-14 split payments: ten payments of 1,000 settle 2,000 after the tenth', () => {
  const { chain, ids } = splitSetup();
  for (let i = 0; i < 9; i++) chain.commit([fund(chain, 'funder', ids.child, 1_000n)]);
  assert.equal(settledTo(chain, ids.parent), 0n);
  chain.commit([fund(chain, 'funder', ids.child, 1_000n)]);
  assert.equal(settledTo(chain, ids.parent), 2_000n);
});

test('OIP-14 split payments: 9,990 at once and ten payments of 999 both give the parent 1,998 by round end', () => {
  const one = splitSetup();
  one.chain.commit([fund(one.chain, 'funder', one.ids.child, 9_990n)]);
  finishRound(one.chain);
  const ten = splitSetup();
  ten.chain.commit(Array.from({ length: 10 }, (_, i) => fund(ten.chain, 'funder', ten.ids.child, 999n, i)));
  finishRound(ten.chain);
  assert.equal(settledTo(one.chain, one.ids.parent), 1_998n);
  assert.equal(settledTo(ten.chain, ten.ids.parent), 1_998n);
});

test('a re-approved weight set changes later payouts and leaves earlier ones unchanged', () => {
  const chain = setup({ dust: (10n ** 30n).toString(), round_blocks: 100 }, OSO(100_000), { funder: OSO(1_000) });
  const ids = importWorks(chain, [fixture('old', '2020-01-01'), fixture('new', '2020-01-02'), fixture('child', '2021-01-01')]);
  chain.commit([makeTx(op, chain.state, 'weights.approve', { work_id: ids.child, parents: { [ids.old]: 10_000 } })]);
  chain.commit([fund(chain, 'funder', ids.child, OSO(100))]); // 20 owed to old, held below dust
  chain.commit([makeTx(op, chain.state, 'weights.approve', { work_id: ids.child, parents: { [ids.new]: 10_000 } })]);
  chain.commit([fund(chain, 'funder', ids.child, OSO(100))]); // 20 owed to new
  finishRound(chain);
  assert.equal(settledTo(chain, ids.old), OSO(20));
  assert.equal(settledTo(chain, ids.new), OSO(20));
});

test('a parent with the same or a later origin date is rejected (OIP-14 section 3)', () => {
  const chain = setup();
  const ids = importWorks(chain, [fixture('a', '2021-01-01'), fixture('b', '2021-01-01'), fixture('c', '2022-01-01')]);
  const b = chain.commit([
    makeTx(op, chain.state, 'weights.approve', { work_id: ids.a, parents: { [ids.b]: 10_000 } }),
    makeTx(op, chain.state, 'weights.approve', { work_id: ids.a, parents: { [ids.c]: 10_000 } }, 1),
  ]);
  assert.deepEqual(b.txs.map((t) => t.ok), [false, false]);
});

test('removal burns the whole escrowed mint and slashes the stake (OIP-8 section 4.7)', () => {
  const chain = setup({}, OSO(100_000), { fund: OSO(100), a: OSO(100) });
  const version = submissionVersion({
    type: 'other/test', title: 'Spam', abstract: 'a', content: 'x', parents: [],
    owners: [{ identity: addr('a'), share_bps: 10_000 }], attribution: ['a'], registrant: addr('a'),
  });
  const id = versionId(version);
  chain.commit([makeTx(key('a'), chain.state, 'idea.submit', {
    version, owner_signatures: { [addr('a')]: signMessage(key('a'), ownerMessage(id)) },
  })]);
  chain.commit([makeTx(op, chain.state, 'idea.admit', { work_id: id, validators: [addr('v1')] })]);
  const supply = BigInt(chain.state.minted) - BigInt(chain.state.burned);
  const fundBefore = balance(chain.state, acct.fund);
  const b = chain.commit([makeTx(op, chain.state, 'idea.remove', { work_id: id })]);
  assert.ok(b.txs[0].ok, b.txs[0].error);
  assert.equal(BigInt(chain.state.minted) - BigInt(chain.state.burned), supply - BigInt(chain.state.ideas[id].mint));
  assert.equal(balance(chain.state, acct.fund), fundBefore + OSO(10));
  advance(chain, DEV_PARAMS.challenge_window + 1);
  assert.equal(chain.state.ideas[id].status, 'removed');
});

test('a submission missing an owner signature is not accepted (OIP-10 section 4.2)', () => {
  const chain = setup({}, OSO(100_000), { a: OSO(100) });
  const version = submissionVersion({
    type: 'hypothesis', title: 'Two owners', abstract: 'a', content: 'y', parents: [],
    owners: [{ identity: addr('a'), share_bps: 5_000 }, { identity: addr('b'), share_bps: 5_000 }],
    attribution: ['a', 'b'], registrant: addr('a'),
  });
  const id = versionId(version);
  const b = chain.commit([makeTx(key('a'), chain.state, 'idea.submit', {
    version, owner_signatures: { [addr('a')]: signMessage(key('a'), ownerMessage(id)) },
  })]);
  assert.equal(b.txs[0].ok, false);
  assert.match(b.txs[0].error!, /signature/);
  assert.equal(chain.state.ideas[id], undefined);
});

test('a failed transaction changes nothing but uses its nonce; a replayed transaction is rejected', () => {
  const chain = setup({}, OSO(100_000), { a: OSO(1) });
  const before = structuredClone(chain.state.balances);
  const tx = makeTx(key('a'), chain.state, 'transfer', { to: addr('b'), amount: OSO(5).toString() });
  const b = chain.commit([tx]);
  assert.equal(b.txs[0].ok, false);
  assert.deepEqual(chain.state.balances, before);
  assert.equal(chain.state.nonces[addr('a')], 1);
  assert.equal(chain.check(tx), 'bad nonce: expected 1');
  assert.throws(() => chain.commit([tx]), /bad nonce/);
});

test('a transaction signed by someone else is rejected', () => {
  const chain = setup();
  const tx = makeTx(key('a'), chain.state, 'transfer', { to: addr('b'), amount: '1' });
  assert.equal(chain.check({ ...tx, sender: addr('b') }), 'bad signature');
});

test('replaying the published log reproduces every block; a tampered block is detected (OIP-13 section 5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oso-'));
  const chain = new Chain(op, dir);
  seedDemo(chain);
  const loaded = Chain.load('', dir);
  assert.equal(stateHash(loaded.state), stateHash(chain.state));
  assert.equal(stateHash(replay(chain.blocks)), stateHash(chain.state));

  const tampered = structuredClone(chain.blocks);
  const fundTx = tampered.flatMap((b) => b.txs).find((t) => t.tx.type === 'idea.fund')!;
  fundTx.tx.body.amount = (BigInt(fundTx.tx.body.amount) * 2n).toString();
  assert.throws(() => replay(tampered), /bad signature/);

  const forged = structuredClone(chain.blocks);
  forged[forged.length - 1].events.push({ type: 'burned', idea: 'x', amount: '1' });
  assert.throws(() => replay(forged), /events differ/);
});

test('the demo ledger conserves supply and keeps imported value as unresolved liabilities', () => {
  const chain = new Chain(op);
  const { ids } = seedDemo(chain);
  const s = chain.state;
  const total = Object.values(s.balances).reduce((a, b) => a + BigInt(b), 0n);
  assert.equal(total, BigInt(s.minted) - BigInt(s.burned));
  assert.ok(balance(s, acct.unresolved(ids.lora)) > 0n);
  assert.equal(s.queue.length, 0);
});
