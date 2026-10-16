// Simulator tests: the fast waterfall against the ledger, traditional as a special case, accounting,
// determinism, and the model's two main predictions on fixed seeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chain } from '../ledger/chain.ts';
import { makeTx, versionId } from '../ledger/ledger.ts';
import { ONE_OSO, acct, balance } from '../ledger/state.ts';
import { importVersion } from '../ledger/versions.ts';
import { DEV_PARAMS, devAddress, devKeys } from '../api/demo.ts';
import { run } from './model.ts';
import { Rng } from './rng.ts';
import { BASE, SETTINGS } from './settings.ts';
import { attributionValue, makeWorld, shares } from './world.ts';

const small = { ...BASE.world, levels: 4, width: 3, targets: [{ level: 4, count: 1 }] };

test("the simulator's waterfall pays what the ledger's OIP-14 waterfall pays", () => {
  const world = makeWorld(small, new Rng(7));
  // Integer weights in bps, as the ledger stores them, used by both sides.
  const bps = world.weights.map((ws) => {
    const out = ws.map((w) => Math.floor(w * 10_000));
    if (out.length) out[0] += 10_000 - out.reduce((a, b) => a + b, 0);
    return out;
  });
  const alpha = 0.7;
  const share = shares(world, alpha, bps.map((ws) => ws.map((x) => x / 10_000)));

  const op = devKeys.operator;
  const chain = new Chain(op);
  const params = { ...DEV_PARAMS, alpha_default: alpha * 10_000, dust: '1', settle_cap: 10_000 };
  chain.commit([makeTx(op, chain.state, 'genesis', { params, bootstrap: (1000n * ONE_OSO).toString() })]);
  chain.commit([makeTx(op, chain.state, 'bootstrap.grant', { to: devAddress('funder'), amount: (100n * ONE_OSO).toString() })]);
  const ids: string[] = [];
  chain.commit(world.level.map((l, r) => {
    const v = importVersion({
      key: `r${r}`, tier: 'curated', title: `Result ${r}`, abstract: '', authors: ['X'], date: `${2000 + l}-01-01`,
      date_precision: 'day', type: 'paper', venue: '', citation_count: 0, external_ids: { s2: `r${r}` }, references: [],
    }, devAddress('operator'));
    ids.push(versionId(v));
    return makeTx(op, chain.state, 'idea.import', { version: v, origin_date: `${2000 + l}-01-01`, tier: 'curated' }, r);
  }));
  const approvals = world.prereqs.flatMap((ps, r) => ps.length
    ? [['weights.approve', { work_id: ids[r], parents: Object.fromEntries(ps.map((j, k) => [ids[j], bps[r][k]])), basis: 'test' }] as const]
    : []);
  chain.commit(approvals.map(([type, body], i) => makeTx(op, chain.state, type, body, i)));

  const t = world.targets[0];
  const amount = 100n * ONE_OSO;
  const b = chain.commit([makeTx(devKeys.funder, chain.state, 'idea.fund', { work_id: ids[t], amount: amount.toString() })]);
  assert.ok(b.txs[0].ok, b.txs[0].error ?? '');
  for (let i = 0; i < 5 && chain.state.queue.length; i++) chain.commit([]);
  for (let r = 0; r < world.n; r++) {
    const got = Number(balance(chain.state, acct.unresolved(ids[r]))) / Number(amount);
    assert.ok(Math.abs(got - share[t][r]) < 1e-9, `result ${r}: ledger ${got}, simulator ${share[t][r]}`);
  }
});

test('with traditional rules, only targets have attribution value', () => {
  const world = makeWorld(BASE.world, new Rng(3));
  const S = attributionValue(world, shares(world, 1, world.weights), world.weights, 0, 1);
  for (let r = 0; r < world.n; r++) if (!world.isTarget[r]) assert.equal(S[r], 0);
  const osoS = attributionValue(world, shares(world, 0.8, world.weights), world.weights, 0.15, 1);
  assert.ok(osoS.some((x, r) => !world.isTarget[r] && x > 0));
});

test('runs are reproducible from their seed', () => {
  const a = run({ ...BASE, rules: SETTINGS.osoChoice.rules, seed: 11 });
  const b = run({ ...BASE, rules: SETTINGS.osoChoice.rules, seed: 11 });
  assert.deepEqual(a, b);
});

test('everything paid out equals mints plus bounties of solved targets', () => {
  for (const key of Object.keys(SETTINGS)) {
    const r = run({ ...BASE, rules: SETTINGS[key].rules, seed: 5 });
    const world = makeWorld(BASE.world, new Rng(5).fork(1));
    const solvedBounty = r.targetsSolved > 0 ? r.totalEarnings - (r.published + r.trivialPublished) * BASE.m : 0;
    const bounties = world.targets.map((t) => world.bounty[t]);
    // Solved bounties must be a sum of distinct target bounties.
    const subsetSums = bounties.reduce<number[]>((sums, x) => [...sums, ...sums.map((y) => y + x)], [0]);
    assert.ok(subsetSums.some((x) => Math.abs(x - solvedBounty) < 1e-6), `${key}: unexplained payout ${solvedBounty}`);
  }
});

const mean = (key: string, f: (r: ReturnType<typeof run>) => number, over: object = {}) => {
  const rs = Array.from({ length: 12 }, (_, k) => run({ ...BASE, ...over, rules: SETTINGS[key].rules, seed: 100 + k }));
  return rs.reduce((a, r) => a + f(r), 0) / rs.length;
};

test('prediction 1: sharing pools search, so OSO reaches deeper than traditional for the same budget', () => {
  assert.ok(mean('oso', (r) => r.frontier) > mean('traditional', (r) => r.frontier) + 1);
});

test('prediction 2: with enough flow-back, agents choose to share', () => {
  const runs = (alpha: number) => Array.from({ length: 12 }, (_, k) =>
    run({ ...BASE, psi: 0.1, rules: { alpha, c: alpha === 1 ? 0 : 0.15, visibility: { kind: 'choice' } }, seed: 200 + k }));
  const sharing = (alpha: number) => runs(alpha).reduce((a, r) => a + r.sharingRate, 0) / 12;
  assert.ok(sharing(0.3) > sharing(1) + 0.3);
});
