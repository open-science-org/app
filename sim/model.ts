// One run of the research-community model (OSO/docs/demo-model.md, sections 4 to 8).
import { makeAgents, skillIn, type Agent, type Archetype } from './agents.ts';
import { Rng } from './rng.ts';
import { attributionValue, ledgerWeights, makeWorld, shares, type World, type WorldParams } from './world.ts';

export type Visibility =
  | { kind: 'finished-only' }
  | { kind: 'delayed'; d: number }
  | { kind: 'immediate' }
  | { kind: 'choice' };

/** The rules: the only thing that differs between traditional research and OSO (section 9). */
export interface Rules {
  /** α: share of incoming value a result keeps; the rest flows to its prerequisites. */
  alpha: number;
  /** c: share of each mint paid to what the new result built on. */
  c: number;
  visibility: Visibility;
}

export interface RunParams {
  world: WorldParams;
  mix: Partial<Record<Archetype, number>>;
  rules: Rules;
  /** Total compute X and number of rounds T. */
  X: number;
  T: number;
  /** Mint per newly published result. */
  m: number;
  /** Validation screen θ: chance a trivial result is rejected. */
  theta: number;
  /** ρ: how much earnings buy future compute (0 = equal grants). */
  rho: number;
  /** Smoothing of recent earnings for the compute loop. */
  lambdaE: number;
  /** Noise in the ledger's attribution weights. */
  sigmaW: number;
  /** Rationality (softmax temperature, relative to the best score) and exploration rate. */
  tau: number;
  epsilon: number;
  /** Scale of the noise in agents' perception of attribution value. */
  sigma0: number;
  /** Publication boost κ and scoop risk ψ in the publish rule (section 6). */
  kappa: number;
  psi: number;
  /** Expected rounds per level of depth, for discounting flow-back that arrives later. */
  roundsPerLevel: number;
  /** Level L* used for the speed and cost measures. */
  targetLevel: number;
  seed: number;
}

export interface RunResult {
  /** Hardest level published after each round, with cumulative spend. */
  curve: { round: number; spend: number; level: number }[];
  spend: number;
  frontier: number;
  /** Deepest level proved by anyone, published or not. */
  deepestProved: number;
  speed: number | null;
  cost: number | null;
  productivity: number;
  breadth: number;
  areasReached: number;
  waste: number;
  wasteParts: { duplicate: number; deadEnd: number; trivial: number };
  creditAccuracy: number;
  /** Diagnostics. */
  sharingRate: number;
  publicationLag: number;
  hoarded: number;
  reuse: number;
  duplicates: number;
  published: number;
  trivialPublished: number;
  targetsSolved: number;
  /** Total paid out, for accounting checks. */
  totalEarnings: number;
  earningsByArchetype: Record<string, number>;
}

interface State {
  world: World;
  agents: Agent[];
  params: RunParams;
  rng: Rng;
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
  const { world, params } = s;
  s.author[x] = i;
  s.pubRound[x] = s.round;
  const { m } = params;
  const { c } = params.rules;
  const ps = world.prereqs[x];
  s.roundEarnings[i] += ps.length ? (1 - c) * m : m;
  ps.forEach((j, k) => payInto(s, j, c * m * s.w[x][k]));
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

function frontierOf(s: State, i: number): number[] {
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
  return Math.max(1, s.params.roundsPerLevel * (mean - s.world.level[r]));
}

/** The score U_i(r) of attempting r (section 6), and its parts. */
function score(s: State, i: number, r: number, rivals: number) {
  const { world, params } = s;
  const { alpha, c } = params.rules;
  const t = s.agents[i].traits;
  const pi = Math.min(1, skillIn(s.agents[i], world.area[r]) * world.p[r]);
  const win = 1 / (1 + rivals);
  const later = t.horizon ** delay(s, r);
  const mint = world.prereqs[r].length ? (1 - c) * params.m : params.m;
  const bounty = world.isTarget[r] ? alpha * world.bounty[r] * win : 0;
  // A lemma is a stepping stone to a target the agent may win itself, under any rules.
  const step = later * alpha * s.seenDown[i][r] * win;
  const flow = later * s.seenS[i][r];
  const value = mint + bounty + step + flow;
  return { pi, value, u: value * (pi - t.risk * Math.sqrt(pi * (1 - pi))), win, later };
}

function shouldPublish(s: State, i: number, r: number, win: number, later: number): boolean {
  const { params, world } = s;
  const t = s.agents[i].traits;
  // Kept private, the mint arrives only if the agent later wins a target that uses r.
  const mint = (world.prereqs[r].length ? 1 - params.rules.c : 1) * params.m;
  const mintAtRisk = mint * (1 - (world.targetsBelow[r].length ? later * win : 0));
  const gain = t.sharing * params.m + mintAtRisk + later * s.seenS[i][r] * params.kappa;
  const scoop = params.rules.alpha * s.seenDown[i][r] * win * params.psi;
  return gain >= scoop;
}

function attempt(s: State, i: number, rivalsAt: Int32Array) {
  const { world, params, rng } = s;
  const agent = s.agents[i];
  const k = agent.traits.cost;
  if (rng.chance(agent.traits.gaming)) {
    s.spend += k;
    s.spendTrivial += k;
    if (!rng.chance(params.theta)) {
      s.roundEarnings[i] += params.m;
      s.trivialPublished++;
    }
    return;
  }
  const options = frontierOf(s, i);
  if (!options.length) return;
  let r: number;
  let chosen: ReturnType<typeof score> | null = null;
  if (rng.chance(params.epsilon)) {
    r = rng.pick(options);
  } else {
    const scored = options.map((x) => ({ x, sc: score(s, i, x, Math.max(0, rivalsAt[x] - 1)) }));
    const best = Math.max(...scored.map((o) => o.sc.u));
    const scale = Math.max(1e-9, params.tau * Math.abs(best));
    const ws = scored.map((o) => Math.exp((o.sc.u - best) / scale));
    let pick = rng.next() * ws.reduce((a, b) => a + b, 0);
    let idx = 0;
    while (pick > ws[idx] && idx < ws.length - 1) pick -= ws[idx++];
    r = scored[idx].x;
    chosen = scored[idx].sc;
  }
  const sc = chosen ?? score(s, i, r, Math.max(0, rivalsAt[r] - 1));
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
  const v = params.rules.visibility;
  if (v.kind === 'immediate') publishBundle(s, i, r);
  else if (v.kind === 'delayed') {
    const at = s.round + v.d;
    s.scheduled.set(at, [...(s.scheduled.get(at) ?? []), [i, r]]);
  } else if (world.isTarget[r]) publishBundle(s, i, r);
  else if (v.kind === 'choice' && shouldPublish(s, i, r, sc.win, sc.later)) publishBundle(s, i, r);
}

export function run(params: RunParams): RunResult {
  const rng = new Rng(params.seed);
  const world = makeWorld(params.world, rng.fork(1));
  const agents = makeAgents(params.mix, params.world.areas, rng.fork(2));
  const w = ledgerWeights(world, params.sigmaW, rng.fork(3));
  const share = shares(world, params.rules.alpha, w);
  const S = attributionValue(world, share, w, params.rules.c, params.m);
  const down = world.targetsBelow.map((ts) => Math.max(0, ...ts.map((t) => world.bounty[t])));
  const perception = rng.fork(4);
  const noisy = (base: number[], q: number) =>
    Float64Array.from(base, (x) => Math.max(0, x * (1 + params.sigma0 * (1 - q) * perception.normal())));
  const N = agents.length;
  const s: State = {
    world, agents, params, rng: rng.fork(5), share, w,
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

  const Ebar = new Float64Array(N);
  const carry = new Float64Array(N);
  const curve: RunResult['curve'] = [];
  const perRound = params.X / params.T;
  let speed: number | null = null;
  let cost: number | null = null;

  for (let t = 1; t <= params.T; t++) {
    s.round = t;
    // Compute loop (section 7).
    const total = Ebar.reduce((a, b) => a + b, 0);
    const turns: number[] = [];
    for (const a of agents) {
      const share = total > 0 ? Ebar[a.id] / total : 1 / N;
      const budget = perRound * ((1 - params.rho) / N + params.rho * share) + carry[a.id];
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
    for (const i of turns) attempt(s, i, rivalsAt);
    // Uptake of published results by agents who have not yet taken them up (reuse ω).
    for (const a of agents) {
      for (let r = 0; r < world.n; r++) {
        if (s.author[r] >= 0 && !s.known[a.id].has(r) && s.rng.chance(a.traits.reuse)) s.known[a.id].add(r);
      }
    }
    for (let i = 0; i < N; i++) {
      s.earnings[i] += s.roundEarnings[i];
      Ebar[i] = params.lambdaE * Ebar[i] + (1 - params.lambdaE) * s.roundEarnings[i];
      s.roundEarnings[i] = 0;
    }
    let level = 0;
    for (let r = 0; r < world.n; r++) if (s.author[r] >= 0 && world.level[r] > level) level = world.level[r];
    curve.push({ round: t, spend: s.spend, level });
    if (speed === null && level >= params.targetLevel) {
      speed = t;
      cost = s.spend;
    }
    // A funder stops paying once every target is solved.
    if (world.targets.every((x) => s.author[x] >= 0)) break;
  }
  return measure(s, curve, speed, cost);
}

/** The measures and diagnostics (section 10). */
function measure(s: State, curve: RunResult['curve'], speed: number | null, cost: number | null): RunResult {
  const { world, agents } = s;
  const published = [...Array(world.n).keys()].filter((r) => s.author[r] >= 0);
  const spend = Math.max(s.spend, 1e-9);

  let duplicate = 0;
  let deadEnd = 0;
  for (const [key, k] of s.spendOn) {
    const i = Math.floor(key / world.n);
    const r = key % world.n;
    if (world.deadEnd[r]) deadEnd += k;
    else if (s.author[r] >= 0 && s.author[r] !== i) duplicate += k;
  }

  // Contribution in hindsight: each solved target's bounty split over its proof, by cost 1/p.
  const contribution = new Float64Array(agents.length);
  for (const t of world.targets) {
    if (s.author[t] < 0) continue;
    const proof = [t, ...world.ancestors[t]];
    const total = proof.reduce((a, r) => a + 1 / world.p[r], 0);
    for (const r of proof) contribution[s.author[r]] += world.bounty[t] * (1 / world.p[r]) / total;
  }
  const payTotal = s.earnings.reduce((a, b) => a + b, 0);
  const bountyTotal = s.bountyEarnings.reduce((a, b) => a + b, 0);
  const contribTotal = contribution.reduce((a, b) => a + b, 0);
  let tv = 0;
  if (bountyTotal > 0 && contribTotal > 0) {
    for (let i = 0; i < agents.length; i++) tv += Math.abs(s.bountyEarnings[i] / bountyTotal - contribution[i] / contribTotal);
  }

  const lemmas = published.filter((r) => !world.isTarget[r]);
  const lags = lemmas.map((r) => s.pubRound[r] - s.firstProof[r]);
  const provedLemmas = [...Array(world.n).keys()].filter((r) => s.firstProof[r] >= 0 && !world.isTarget[r]);
  const deepAreas = new Set(published.filter((r) => world.level[r] >= Math.ceil(world.levels / 2)).map((r) => world.area[r]));
  const byArchetype: Record<string, number> = {};
  agents.forEach((a) => (byArchetype[a.archetype] = (byArchetype[a.archetype] ?? 0) + s.earnings[a.id]));
  for (const k of Object.keys(byArchetype)) byArchetype[k] = payTotal > 0 ? byArchetype[k] / payTotal : 0;

  return {
    curve,
    spend: s.spend,
    frontier: curve.at(-1)?.level ?? 0,
    deepestProved: Math.max(0, ...[...Array(world.n).keys()].filter((r) => s.firstProof[r] >= 0).map((r) => world.level[r])),
    speed,
    cost,
    productivity: published.length / spend,
    breadth: world.targets.filter((t) => s.author[t] >= 0).length / Math.max(1, world.targets.length),
    areasReached: deepAreas.size,
    waste: (duplicate + deadEnd + s.spendTrivial) / spend,
    wasteParts: { duplicate: duplicate / spend, deadEnd: deadEnd / spend, trivial: s.spendTrivial / spend },
    creditAccuracy: bountyTotal > 0 && contribTotal > 0 ? 1 - tv / 2 : 0,
    sharingRate: provedLemmas.length ? lags.filter((l) => l <= 0).length / provedLemmas.length : 0,
    publicationLag: lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : 0,
    hoarded: provedLemmas.length ? provedLemmas.filter((r) => s.author[r] < 0).length / provedLemmas.length : 0,
    reuse: published.length ? published.reduce((a, r) => a + world.children[r].filter((ch) => s.author[ch] >= 0).length, 0) / published.length : 0,
    duplicates: s.duplicates,
    published: published.length,
    trivialPublished: s.trivialPublished,
    targetsSolved: world.targets.filter((t) => s.author[t] >= 0).length,
    totalEarnings: payTotal,
    earningsByArchetype: byArchetype,
  };
}
