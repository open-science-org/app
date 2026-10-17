// One run (specification, section 2.6). This module is the environment only: frontier, success,
// publishing, payment and compute. Everything else comes from the scenario through plugins: the
// world, the success oracle, each agent's decider, visibility, allocation and measures.
import { makeAgents, skillIn, type Agent } from './agents.ts';
import type { Scenario } from './config.ts';
import { deciders, type Choice, type Decider } from './deciders.ts';
import { measure, type RunResult } from './measures.ts';
import { oracles, type Oracle } from './oracles.ts';
import { Rng } from './rng.ts';
import { allocations, visibilities, type Visibility } from './rules.ts';
import { ledgerWeights, shares, worlds, type World } from './world.ts';

export type { RunResult } from './measures.ts';

/** The state of a run, read by the measures. */
export interface State {
  sc: Scenario;
  world: World;
  agents: Agent[];
  rng: Rng;
  visibility: Visibility;
  oracle: Oracle;
  share: Float64Array[];
  w: number[][];
  known: Set<number>[];
  proved: Set<number>[];
  author: Int32Array;
  pubRound: Int32Array;
  firstProof: Int32Array;
  scheduled: Map<number, [number, number][]>;
  earnings: Float64Array;
  roundEarnings: Float64Array;
  /** Earnings from bounties only, for credit accuracy. */
  bountyEarnings: Float64Array;
  spendOn: Map<number, number>;
  spendTrivial: number;
  spend: number;
  /** How many agents can attempt each result this round (all agents know this; used to estimate the race). */
  rivalsAt: Int32Array;
  /** Failed attempts by agent and result (key: agent × n + result), for oracles that learn. */
  failures: Map<number, number>;
  duplicates: number;
  trivialPublished: number;
  round: number;
}

/** Pays value v entering result x through the waterfall to the authors of x and its ancestors. */
function payInto(s: State, x: number, v: number, bounty = false) {
  const row = s.share[x];
  const pay = (r: number) => {
    const amount = v * row[r];
    s.roundEarnings[s.author[r]] += amount;
    if (bounty) s.bountyEarnings[s.author[r]] += amount;
  };
  pay(x);
  for (const a of s.world.ancestors[x]) if (row[a] > 0) pay(a);
}

function publishOne(s: State, i: number, x: number) {
  const { world } = s;
  const { mint, c } = s.sc.rules;
  s.author[x] = i;
  s.pubRound[x] = s.round;
  const ps = world.prereqs[x];
  s.roundEarnings[i] += ps.length ? (1 - c) * mint : mint;
  ps.forEach((j, k) => payInto(s, j, c * mint * s.w[x][k]));
  if (world.isTarget[x]) payInto(s, x, world.bounty[x], true);
  for (const a of s.agents) {
    if (a.id !== i && !s.known[a.id].has(x) && s.rng.chance(a.traits.reuse)) s.known[a.id].add(x);
  }
}

/** Publishes x together with every private result of i's that x depends on, oldest first. */
function publishBundle(s: State, i: number, x: number) {
  const bundle = [...s.world.ancestors[x], x].filter((r) => s.proved[i].has(r) && s.author[r] < 0);
  bundle.sort((a, b) => s.world.level[a] - s.world.level[b] || a - b);
  for (const r of bundle) if (s.author[r] < 0) publishOne(s, i, r);
}

export function frontierOf(s: State, i: number): number[] {
  const out: number[] = [];
  const k = s.known[i];
  for (let r = 0; r < s.world.n; r++) {
    if (k.has(r)) continue;
    if (s.world.prereqs[r].every((j) => k.has(j))) out.push(r);
  }
  return out;
}

/** One attempt by agent i: its decider chooses, the oracle decides, the visibility rule publishes. */
function attempt(s: State, i: number, decider: Decider) {
  const { world } = s;
  const agent = s.agents[i];
  const k = agent.traits.cost;
  const choice: Choice = decider.choose(i, frontierOf(s, i));
  if (choice.kind === 'idle') return;
  if (choice.kind === 'trivial') {
    s.spend += k;
    s.spendTrivial += k;
    if (!s.rng.chance(s.sc.rules.screen)) {
      s.roundEarnings[i] += s.sc.rules.mint;
      s.trivialPublished++;
    }
    return;
  }
  const r = choice.result;
  const key = i * world.n + r;
  s.spend += k;
  s.spendOn.set(key, (s.spendOn.get(key) ?? 0) + k);
  const p = Math.min(1, skillIn(agent, world.area[r], s.sc.agents.specialist) * world.p[r]);
  const failures = s.failures.get(key) ?? 0;
  if (!s.oracle.succeeds({ agent: i, result: r, p, failures, rng: s.rng, payload: choice.payload })) {
    s.failures.set(key, failures + 1);
    return;
  }

  s.proved[i].add(r);
  s.known[i].add(r);
  if (s.firstProof[r] < 0) s.firstProof[r] = s.round;
  if (s.author[r] >= 0) {
    s.duplicates++;
    return;
  }
  s.visibility.onProof({
    round: s.round,
    isTarget: world.isTarget[r],
    publish: () => publishBundle(s, i, r),
    schedule: (at) => s.scheduled.set(at, [...(s.scheduled.get(at) ?? []), [i, r]]),
    agentWouldPublish: () => decider.wouldPublish(i, r, choice),
  });
}

export function run(sc: Scenario, seed: number): RunResult {
  const rng = new Rng(seed);
  const world = worlds.create(sc.world, 'world')(sc.success, rng.fork(1));
  const areas = typeof sc.world.areas === 'number' ? sc.world.areas : Math.max(0, ...world.area) + 1;
  const agents = makeAgents(sc.agents, areas, rng.fork(2));
  if (!agents.length) throw new Error('scenario: agents.mix has no agents');
  const w = ledgerWeights(world, sc.attribution.noise, rng.fork(3));
  const share = shares(world, sc.rules.alpha, w);
  const perception = rng.fork(4);
  const N = agents.length;
  const s: State = {
    sc, world, agents, rng: rng.fork(5), share, w,
    visibility: visibilities.create(sc.rules.visibility, 'rules.visibility'),
    oracle: oracles.create(sc.success.oracle, 'success.oracle'),
    known: agents.map(() => new Set()),
    proved: agents.map(() => new Set()),
    author: new Int32Array(world.n).fill(-1),
    pubRound: new Int32Array(world.n).fill(-1),
    firstProof: new Int32Array(world.n).fill(-1),
    scheduled: new Map(),
    earnings: new Float64Array(N),
    roundEarnings: new Float64Array(N),
    bountyEarnings: new Float64Array(N),
    spendOn: new Map(),
    spendTrivial: 0,
    spend: 0,
    rivalsAt: new Int32Array(world.n),
    failures: new Map(),
    duplicates: 0,
    trivialPublished: 0,
    round: 0,
  };
  const allocation = allocations.create(sc.budget.allocation, 'budget.allocation')(N);
  // One decider per kind; an archetype may override the default (agents.deciders).
  const built = new Map<string, Decider>();
  const deciderFor = agents.map((a) => {
    const config = sc.agents.deciders[a.archetype] ?? sc.behaviour.decider;
    const name = JSON.stringify(config);
    if (!built.has(name)) built.set(name, deciders.create(config, `decider for ${a.archetype}`)({ s, perception }));
    return built.get(name)!;
  });

  const { X, perAgentPerRound } = sc.budget;
  const T = perAgentPerRound ? Math.round(X / (N * perAgentPerRound)) : sc.budget.rounds;
  if (!T || T < 1) throw new Error('scenario: set budget.rounds or budget.perAgentPerRound');
  const carry = new Float64Array(N);
  const curve: RunResult['curve'] = [];
  const perRound = X / T;
  let speed: number | null = null;
  let cost: number | null = null;

  for (let t = 1; t <= T; t++) {
    s.round = t;
    const budgets = allocation.budgets(perRound);
    const turns: number[] = [];
    for (const a of agents) {
      const budget = budgets[a.id] + carry[a.id];
      const n = Math.floor(budget / a.traits.cost);
      carry[a.id] = budget - n * a.traits.cost;
      for (let k = 0; k < n; k++) turns.push(a.id);
    }
    s.rng.shuffle(turns);
    for (const [i, r] of s.scheduled.get(t) ?? []) if (s.author[r] < 0) publishBundle(s, i, r);
    s.scheduled.delete(t);
    // How many agents can currently attempt each result, to estimate the race for it.
    s.rivalsAt = new Int32Array(world.n);
    for (const a of agents) for (const r of frontierOf(s, a.id)) s.rivalsAt[r]++;
    for (const i of turns) attempt(s, i, deciderFor[i]);
    // Uptake of published results by agents who have not yet taken them up (reuse).
    for (const a of agents) {
      for (let r = 0; r < world.n; r++) {
        if (s.author[r] >= 0 && !s.known[a.id].has(r) && s.rng.chance(a.traits.reuse)) s.known[a.id].add(r);
      }
    }
    allocation.update(s.roundEarnings);
    for (let i = 0; i < N; i++) {
      s.earnings[i] += s.roundEarnings[i];
      s.roundEarnings[i] = 0;
    }
    let level = 0;
    for (let r = 0; r < world.n; r++) if (s.author[r] >= 0 && world.level[r] > level) level = world.level[r];
    curve.push({ round: t, spend: s.spend, level });
    if (speed === null && level >= sc.measures.targetLevel) {
      speed = t;
      cost = s.spend;
    }
    if (sc.budget.stopWhenSolved && world.targets.length && world.targets.every((x) => s.author[x] >= 0)) break;
  }
  return measure(s, curve, speed, cost);
}
