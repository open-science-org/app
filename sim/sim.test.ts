// Simulator tests: the waterfall against the ledger, the simple model against exact predictions,
// traditional rules as a special case, accounting, reproducibility, the model's predictions, and
// the configuration layer (validation, plugins, file worlds, experiment expansion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chain } from '../ledger/chain.ts';
import { makeTx, versionId } from '../ledger/ledger.ts';
import { ONE_OSO, acct, balance } from '../ledger/state.ts';
import { importVersion } from '../ledger/versions.ts';
import { DEV_PARAMS, devAddress, devKeys } from '../api/demo.ts';
import { hiddenDepth, sharedDepth } from './analytic.ts';
import { loadScenario, type Scenario } from './config.ts';
import { expand, loadExperiment } from './experiment.ts';
import { run } from './model.ts';
import { Rng } from './rng.ts';
import { scenarioFor } from './settings.ts';
import { attributionValue, shares, worlds } from './world.ts';

const worldOf = (sc: Scenario, seed: number) => worlds.create(sc.world, 'world')(sc.success, new Rng(seed).fork(1));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

test("the simulator's waterfall pays what the ledger's OIP-14 waterfall pays", () => {
  const sc = loadScenario(null, { world: { levels: 4, width: 3, targets: [{ level: 4, count: 1 }] } });
  const world = worldOf(sc, 7);
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

test('the simple model matches its exact predictions', () => {
  const X = 320;
  const p = 0.2;
  for (const [N, kind] of [[4, 'immediate'], [4, 'finished-only']] as const) {
    const sc = loadScenario(null, {
      world: { kind: 'chain', length: 200 },
      success: { p0: p, eta: 1 },
      budget: { X, perAgentPerRound: 1, allocation: { kind: 'equal' } },
      'agents.mix': { foundation: 0, racer: 0, explorer: 0, specialist: 0, freeRider: 0, gamer: 0, plain: N },
      'rules.visibility': { kind },
    });
    const depths = Array.from({ length: 300 }, (_, k) => run(sc, 300 + k).deepestProved);
    const exact = kind === 'immediate' ? sharedDepth(X, p) : hiddenDepth(X, p, N);
    const se = exact.sd / Math.sqrt(depths.length);
    assert.ok(Math.abs(mean(depths) - exact.mean) < 4 * se, `${kind}: simulated ${mean(depths)}, exact ${exact.mean} ± ${se}`);
  }
});

test('with traditional rules, only targets have attribution value', () => {
  const world = worldOf(loadScenario(), 3);
  const S = attributionValue(world, shares(world, 1, world.weights), world.weights, 0, 1);
  for (let r = 0; r < world.n; r++) if (!world.isTarget[r]) assert.equal(S[r], 0);
  const osoS = attributionValue(world, shares(world, 0.8, world.weights), world.weights, 0.15, 1);
  assert.ok(osoS.some((x, r) => !world.isTarget[r] && x > 0));
});

test('runs are reproducible from their seed', () => {
  assert.deepEqual(run(scenarioFor('osoChoice'), 11), run(scenarioFor('osoChoice'), 11));
});

test('everything paid out equals mints plus bounties of solved targets', () => {
  for (const setting of ['traditional', 'oso', 'creditOnly', 'sharingOnly', 'traditionalChoice', 'osoChoice']) {
    const sc = scenarioFor(setting);
    const r = run(sc, 5);
    const world = worldOf(sc, 5);
    const solvedBounty = r.totalEarnings - (r.published + r.trivialPublished) * sc.rules.mint;
    const bounties = world.targets.map((t) => world.bounty[t]);
    const subsetSums = bounties.reduce<number[]>((sums, x) => [...sums, ...sums.map((y) => y + x)], [0]);
    assert.ok(subsetSums.some((x) => Math.abs(x - solvedBounty) < 1e-6), `${setting}: unexplained payout ${solvedBounty}`);
  }
});

test('prediction 1: sharing pools search, so OSO reaches deeper than traditional for the same budget', () => {
  const frontier = (setting: string) => mean(Array.from({ length: 12 }, (_, k) => run(scenarioFor(setting), 100 + k).frontier));
  assert.ok(frontier('oso') > frontier('traditional') + 1);
});

test('prediction 2: with enough flow-back, agents choose to share', () => {
  const sharing = (alpha: number) => mean(Array.from({ length: 12 }, (_, k) =>
    run(loadScenario(null, { 'behaviour.psi': 0.1, rules: { alpha, c: alpha === 1 ? 0 : 0.15, visibility: { kind: 'choice' } } }), 200 + k).sharingRate));
  assert.ok(sharing(0.3) > sharing(1) + 0.3);
});

test('misspelled settings and unknown plugin parameters are rejected', () => {
  assert.throws(() => loadScenario(null, { 'rules.alhpa': 0.5 }), /unknown setting "rules.alhpa"/);
  assert.throws(() => loadScenario(null, { 'rules.alpha': 'high' }), /rules.alpha must be a number/);
  assert.throws(() => loadScenario(null, { 'agents.mix.wizard': 2 }), /not defined in agents.archetypes/);
  assert.throws(() => run(loadScenario(null, { 'rules.visibility': { kind: 'delayed', dd: 2 } }), 1), /has no parameter "dd"/);
  assert.throws(() => run(loadScenario(null, { 'rules.visibility': { kind: 'telepathy' } }), 1), /unknown visibility "telepathy"/);
});

test('a component whose kind changes does not keep the old kind\'s parameters', () => {
  const sc = loadScenario(null, { world: { kind: 'chain', length: 10 } });
  assert.deepEqual(sc.world, { kind: 'chain', length: 10 });
});

test('a world read from a file runs, with levels derived from prerequisites', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oso-sim-'));
  const path = join(dir, 'dag.json');
  writeFileSync(path, JSON.stringify({ nodes: [
    { id: 'a' }, { id: 'b' }, { id: 'ab', prereqs: ['a', 'b'] }, { id: 'goal', prereqs: ['ab'], bounty: 10, p: 0.5 },
  ] }));
  const sc = loadScenario(null, { world: { kind: 'file', path }, 'measures.targetLevel': 3 });
  const world = worldOf(sc, 1);
  assert.deepEqual(world.level, [1, 1, 2, 3]);
  assert.equal(world.p[3], 0.5);
  assert.deepEqual(world.targets, [3]);
  const r = run(sc, 1);
  assert.equal(r.targetsSolved, 1);
});

test('experiments expand factors, presets, patches and exclusions into rows', () => {
  const psi = expand(loadExperiment('alpha-psi'));
  assert.equal(psi.length, 27);
  assert.ok(!psi.some((r) => r.scenario.rules.alpha === 1 && r.scenario.rules.c === 0.15));
  const sweep = expand(loadExperiment('alpha-sweep'));
  assert.equal(sweep[0].scenario.rules.c, 0);
  assert.equal(sweep[1].scenario.rules.c, 0.15);
  const settings = expand(loadExperiment('settings'));
  assert.deepEqual(settings[1].scenario.rules, scenarioFor('oso').rules);
  const sens = expand(loadExperiment('sensitivity'));
  assert.equal(sens.length, 8);
  assert.equal(sens[6].scenario.agents.mix.gamer, 0);
});

test('delayed visibility publishes lemmas the stated number of rounds later', () => {
  const r = run(loadScenario(null, { 'rules.visibility': { kind: 'delayed', d: 3 } }), 4);
  assert.ok(r.publicationLag >= 3, `lag ${r.publicationLag}`);
});

test('a learning oracle, where failures raise the next chance, reaches deeper than pure chance', () => {
  const chain = (oracle: Record<string, unknown>) => loadScenario(null, {
    world: { kind: 'chain', length: 200 },
    success: { p0: 0.1, eta: 1, oracle },
    budget: { X: 200, perAgentPerRound: 1, allocation: { kind: 'equal' } },
    'agents.mix': { foundation: 0, racer: 0, explorer: 0, specialist: 0, freeRider: 0, gamer: 0, plain: 1 },
    'rules.visibility': { kind: 'immediate' },
  });
  const depth = (sc: Scenario) => mean(Array.from({ length: 200 }, (_, k) => run(sc, 500 + k).deepestProved));
  const chance = depth(chain({ kind: 'chance' }));
  const learning = depth(chain({ kind: 'learning', gain: 0.5 }));
  assert.ok(Math.abs(chance - 20) < 1.5, `chance oracle: ${chance}, expected about X·p = 20`);
  assert.ok(learning > chance + 5, `learning ${learning} vs chance ${chance}`);
});

test('deciders can differ by archetype, and a zero-intelligence decider runs', () => {
  const sc = loadScenario(null, { 'agents.deciders': { gamer: { kind: 'random' }, racer: { kind: 'random', publish: 0 } } });
  const r = run(sc, 3);
  assert.ok(r.published > 0);
  // A random gamer never games, so nothing trivial is farmed.
  assert.equal(r.trivialPublished, 0);
  const all = run(loadScenario(null, { 'behaviour.decider': { kind: 'random' }, 'rules.visibility': { kind: 'immediate' } }), 3);
  assert.ok(all.frontier >= 1);
  assert.throws(() => run(loadScenario(null, { 'agents.deciders': { gamer: { kind: 'oracle-reader' } } }), 1), /unknown decider/);
});

test('costly knowledge is paid from the budget, so spend never exceeds X', () => {
  const runs = (absorbCost: number) => Array.from({ length: 10 }, (_, k) => run(scenarioFor('oso', { 'knowledge.absorbCost': absorbCost }), 700 + k));
  const free = runs(0);
  const costly = runs(1);
  for (const r of costly) assert.ok(r.spend <= 1200 + 1e-9, `spend ${r.spend}`);
  assert.ok(mean(costly.map((r) => r.absorbShare)) > 0.2);
  assert.ok(mean(costly.map((r) => r.frontier)) < mean(free.map((r) => r.frontier)));
});

test('wrong results spread, are rejected at targets, and are retracted', () => {
  const none = run(scenarioFor('oso'), 9);
  assert.equal(none.rejectedTargets + none.retracted, 0);
  const rs = Array.from({ length: 10 }, (_, k) => run(scenarioFor('oso', { 'knowledge.errorRate': 0.15 }), 800 + k));
  assert.ok(mean(rs.map((r) => r.rejectedTargets)) > 1);
  assert.ok(mean(rs.map((r) => r.retracted)) > 1);
});

test('public failures let agents learn from each other', () => {
  const chain = (publishFailures: boolean) => loadScenario(null, {
    world: { kind: 'chain', length: 200 },
    success: { p0: 0.05, eta: 1, oracle: { kind: 'learning', gain: 0.1 } },
    budget: { X: 400, perAgentPerRound: 1, allocation: { kind: 'equal' } },
    'agents.mix': { foundation: 0, racer: 0, explorer: 0, specialist: 0, freeRider: 0, gamer: 0, plain: 4 },
    rules: { visibility: { kind: 'immediate' }, publishFailures },
  });
  const depth = (sc: Scenario) => mean(Array.from({ length: 100 }, (_, k) => run(sc, 900 + k).deepestProved));
  assert.ok(depth(chain(true)) > depth(chain(false)) + 3);
});

test('the Lean reference tree loads as a world', () => {
  const sc = loadScenario('lean-tree');
  const world = worldOf(sc, 1);
  assert.equal(world.n, 42);
  assert.equal(world.targets.length, 8);
  assert.equal(world.levels, 7);
  assert.ok(mean(Array.from({ length: 10 }, (_, k) => run(loadScenario('lean-tree', { rules: { alpha: 0.8, c: 0.15, visibility: { kind: 'immediate' } } }), k + 1).targetsSolved)) > 7);
});

test('problem spaces load, and a bad space is rejected with a usable message', async () => {
  const { loadSpace, parseSpace, spaceIds } = await import('./spaces.ts');
  for (const id of spaceIds()) assert.equal(loadSpace(id).spec.id, id);
  const good = loadSpace('drug-discovery').spec;
  assert.throws(() => parseSpace({ ...good, id: 'Not Kebab' }), /kebab-case/);
  assert.throws(() => parseSpace({ ...good, glossary: { result: 'x', target: '', attempt: 'y' } }), /glossary.target/);
  assert.throws(() => parseSpace({ ...good, scenario: { 'world.targets': [] } }), /no targets/);
  assert.throws(() => parseSpace({ ...good, scenario: { ...good.scenario, 'measures.targetLevel': 9 } }), /deepest level/);
});

test('an inline graph world builds, with levels from prerequisites', () => {
  const sc = loadScenario(null, { world: { kind: 'graph', nodes: [
    { id: 'a' }, { id: 'b', prereqs: ['a'] }, { id: 'c', prereqs: ['a'] }, { id: 'goal', prereqs: ['b', 'c'], bounty: 5 },
  ] }, 'measures.targetLevel': 3 });
  const w = worldOf(sc, 1);
  assert.deepEqual(w.level, [1, 2, 2, 3]);
  assert.throws(() => worldOf(loadScenario(null, { world: { kind: 'graph', nodes: [{ id: 'a', prereqs: ['b'] }, { id: 'b', bounty: 1 }] } }), 1), /listed before it/);
});

test('generating a space sends errors back to the model until the file is valid', async () => {
  const { generateSpace } = await import('./new-space.ts');
  const valid = readFileSync(new URL('./spaces/drug-discovery.yaml', import.meta.url), 'utf8').replace('id: drug-discovery', 'id: test-space');
  const replies = ['```yaml\nid: test-space\ntitle: T\n```', '```yaml\n' + valid + '\n```'];
  const seen: string[] = [];
  const space = await generateSpace('a test field', async (_system, messages) => {
    seen.push(messages[messages.length - 1].content);
    return replies.shift()!;
  });
  assert.equal(space.spec.id, 'test-space');
  assert.match(seen[1], /not valid/);
  assert.ok(space.scenario.budget.X > 0);
  assert.match(space.spec.source ?? '', /generated by/);
});

test('the canonical report has the same sections for every space', async () => {
  const { buildReport } = await import('./report.ts');
  const REPORTS_DIR = mkdtempSync(join(tmpdir(), 'oso-reports-'));
  const { loadSpace } = await import('./spaces.ts');
  const space = loadSpace('drug-discovery');
  const spec = { ...space.spec, id: 'test-report' };
  const h = buildReport({ spec, scenario: space.scenario }, 4, () => {}, REPORTS_DIR);
  const md = readFileSync(join(REPORTS_DIR, 'test-report', 'report.md'), 'utf8');
  for (const heading of ['## 1. The problem space', '## 2. Progress for the money', '## 3. The six settings', '## 4. Does flow-back make agents share?', '## 5. When sharing is costly or sometimes wrong', '## What this shows and what it does not', '## Reproduce']) {
    assert.ok(md.includes(heading), heading);
  }
  for (const f of ['figures/frontier.svg', 'figures/alpha.svg', 'figures/world.svg', 'data.json']) assert.ok(existsSync(join(REPORTS_DIR, 'test-report', f)), f);
  assert.ok(['OSO ahead', 'no clear difference', 'traditional ahead'].includes(h.verdict));
});
