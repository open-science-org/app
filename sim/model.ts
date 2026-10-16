// One run of the research-community model (sim/README.md, section 2). Everything comes from the
// scenario; worlds, visibility, allocation and policy are plugins.
import { makeAgents, skillIn, type Agent } from './agents.ts';
import type { Scenario } from './config.ts';
import { measure, type RunResult } from './measures.ts';
import { Rng } from './rng.ts';
import { allocations, policies, visibilities, type Visibility } from './rules.ts';
import { attributionValue, ledgerWeights, shares, worlds, type World } from './world.ts';

export type { RunResult } from './measures.ts';

/** The state of a run, read by the measures. */
export interface State {
  sc: Scenario;
  world: World;
  agents: Agent[];
  rng: Rng;
  visibility: Visibility;
  share: Float64Array[];
  w: number[][];
  /** Each agent's noisy perception of attribution value S and of the best bounty below each result. */
  seenS: Float64Array[];
  seenDown: Float64Array[];
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

/** Expected delay, in rounds, until value from targets below r arrives. */
function delay(s: State, r: number): number {
  const below = s.world.targetsBelow[r];
  if (!below.length) return 1;
  const mean = below.reduce((a, t) => a + s.world.level[t], 0) / below.length;
  return Math.max(1, s.sc.behaviour.roundsPerLevel * (mean - s.world.level[r]));
}

/** The score U_i(r) of attempting r (sim/README.md, section 2.5), and its parts. */
function score(s: State, i: number, r: number, rivals: number) {
  const { world } = s;
  const { alpha, c, mint: m } = s.sc.rules;
  const t = s.agents[i].traits;
  const pi = Math.min(1, skillIn(s.agents[i], world.area[r], s.sc.agents.specialist) * world.p[r]);
  const win = 1 / (1 + rivals);
  const later = t.horizon ** delay(s, r);
  const mint = world.prereqs[r].length ? (1 - c) * m : m;
  const bounty = world.isTarget[r] ? alpha * world.bounty[r] * win : 0;
  // A lemma is a stepping stone to a target the agent may win itself, under any rules.
  const step = later * alpha * s.seenDown[i][r] * win;
  const flow = later * s.seenS[i][r];
  const value = mint + bounty + step + flow;
  return { pi, value, u: value * (pi - t.risk * Math.sqrt(pi * (1 - pi))), win, later };
}

function wouldPublish(s: State, i: number, r: number, win: number, later: number): boolean {
  const { world } = s;
  const { alpha, c, mint: m } = s.sc.rules;
  const { kappa, psi } = s.sc.behaviour;
  const t = s.agents[i].traits;
  // Kept private, the mint arrives only if the agent later wins a target that uses r.
  const mint = (world.prereqs[r].length ? 1 - c : 1) * m;
  const mintAtRisk = mint * (1 - (world.targetsBelow[r].length ? later * win : 0));
  const gain = t.sharing * m + mintAtRisk + later * s.seenS[i][r] * kappa;
  const scoop = alpha * s.seenDown[i][r] * win * psi;
  return gain >= scoop;
}

function attempt(s: State, i: number, rivalsAt: Int32Array, choose: (scores: number[]) => number) {
  const { world, rng } = s;
  const agent = s.agents[i];
  const k = agent.traits.cost;
  if (rng.chance(agent.traits.gaming)) {
    s.spend += k;
    s.spendTrivial += k;
    if (!rng.chance(s.sc.rules.screen)) {
      s.roundEarnings[i] += s.sc.rules.mint;
      s.trivialPublished++;
    }
    return;
  }
  const options = frontierOf(s, i);
  if (!options.length) return;
  const scored = options.map((x) => score(s, i, x, Math.max(0, rivalsAt[x] - 1)));
  const idx = choose(scored.map((o) => o.u));
  const r = options[idx];
  const sc = scored[idx];
  s.spend += k;
  s.spendOn.set(i * world.n + r, (s.spendOn.get(i * world.n + r) ?? 0) + k);
  if (!rng.chance(sc.pi)) return;

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
    agentWouldPublish: () => wouldPublish(s, i, r, sc.win, sc.later),
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
  const S = attributionValue(world, share, w, sc.rules.c, sc.rules.mint);
  const down = world.targetsBelow.map((ts) => Math.max(0, ...ts.map((t) => world.bounty[t])));
  const perception = rng.fork(4);
  const noisy = (base: number[], q: number) =>
    Float64Array.from(base, (x) => Math.max(0, x * (1 + sc.behaviour.perceptionNoise * (1 - q) * perception.normal())));
  const N = agents.length;
  const s: State = {
    sc, world, agents, rng: rng.fork(5), share, w,
    visibility: visibilities.create(sc.rules.visibility, 'rules.visibility'),
    seenS: agents.map((a) => noisy(S, a.traits.conjecture)),
    seenDown: agents.map((a) => noisy(down, a.traits.conjecture)),
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
    duplicates: 0,
    trivialPublished: 0,
    round: 0,
  };
  const allocation = allocations.create(sc.budget.allocation, 'budget.allocation')(N);
  const policy = policies.create(sc.behaviour.policy, 'behaviour.policy');
  const choose = (scores: number[]) => policy.choose(scores, s.rng);

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
    const rivalsAt = new Int32Array(world.n);
    for (const a of agents) for (const r of frontierOf(s, a.id)) rivalsAt[r]++;
    for (const i of turns) attempt(s, i, rivalsAt, choose);
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
