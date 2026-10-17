// Measures of one run (sim/README.md, section 4), and the table columns experiments can ask for.
import type { Scenario } from './config.ts';
import type { State } from './model.ts';

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
  sharingRate: number;
  publicationLag: number;
  hoarded: number;
  reuse: number;
  duplicates: number;
  published: number;
  trivialPublished: number;
  targetsSolved: number;
  /** Targets rejected because they rested on a wrong result, and wrong results retracted. */
  rejectedTargets: number;
  retracted: number;
  /** Share of spend on absorbing others' results. */
  absorbShare: number;
  /** Total paid out, for accounting checks. */
  totalEarnings: number;
  earningsByArchetype: Record<string, number>;
}

export function measure(s: State, curve: RunResult['curve'], speed: number | null, cost: number | null): RunResult {
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
    rejectedTargets: s.rejectedTargets,
    retracted: s.retracted,
    absorbShare: s.spendAbsorb / spend,
    totalEarnings: payTotal,
    earningsByArchetype: byArchetype,
  };
}

// ---- Table columns -------------------------------------------------------------------------------

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
export const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
export const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
/** Mean ± standard deviation. */
export const msd = (xs: number[], d = 2) => (xs.length ? `${fmt(mean(xs), d)} ± ${fmt(sd(xs), d)}` : '–');
/** Mean ± standard error. */
export const mse = (xs: number[], d = 2) => (xs.length ? `${fmt(mean(xs), d)} ± ${fmt(sd(xs) / Math.sqrt(xs.length), d)}` : '–');

export interface Column {
  /** Header in the table; may depend on the scenario, e.g. `reach L7`. */
  header: (sc: Scenario) => string;
  value: (runs: RunResult[], sc: Scenario) => string;
}

const reached = (rs: RunResult[]) => rs.filter((r) => r.speed !== null);

/** Every column an experiment can list under `columns:`. Add a measure by adding an entry. */
export const COLUMNS: Record<string, Column> = {
  frontier: { header: () => 'frontier', value: (rs) => msd(rs.map((r) => r.frontier), 1) },
  deepestProved: { header: () => 'deepest proved', value: (rs) => msd(rs.map((r) => r.deepestProved), 1) },
  reachTarget: { header: (sc) => `reach L${sc.measures.targetLevel}`, value: (rs) => fmt(reached(rs).length / rs.length) },
  speed: { header: () => 'speed', value: (rs) => msd(reached(rs).map((r) => r.speed!), 0) },
  cost: { header: () => 'cost', value: (rs) => msd(reached(rs).map((r) => r.cost!), 0) },
  spend: { header: () => 'spend', value: (rs) => msd(rs.map((r) => r.spend), 0) },
  productivity: { header: () => 'results per 100', value: (rs) => msd(rs.map((r) => r.productivity * 100), 1) },
  breadth: { header: () => 'breadth', value: (rs) => msd(rs.map((r) => r.breadth)) },
  waste: { header: () => 'waste', value: (rs) => msd(rs.map((r) => r.waste)) },
  credit: { header: () => 'credit', value: (rs) => msd(rs.map((r) => r.creditAccuracy)) },
  sharing: { header: () => 'sharing', value: (rs) => msd(rs.map((r) => r.sharingRate)) },
  hoarded: { header: () => 'hoarded', value: (rs) => msd(rs.map((r) => r.hoarded)) },
  reuse: { header: () => 'reuse', value: (rs) => msd(rs.map((r) => r.reuse)) },
  duplicates: { header: () => 'duplicates', value: (rs) => msd(rs.map((r) => r.duplicates), 1) },
  targetsSolved: { header: () => 'targets solved', value: (rs) => msd(rs.map((r) => r.targetsSolved), 1) },
  gamerShare: {
    header: () => 'gamer share of pay',
    value: (rs) => {
      const xs = rs.map((r) => r.earningsByArchetype.gamer).filter((x) => x !== undefined);
      return xs.length ? fmt(mean(xs)) : '–';
    },
  },
  trivialSpend: { header: () => 'trivial spend', value: (rs) => msd(rs.map((r) => r.wasteParts.trivial)) },
  rejected: { header: () => 'rejected targets', value: (rs) => msd(rs.map((r) => r.rejectedTargets), 1) },
  retracted: { header: () => 'retracted', value: (rs) => msd(rs.map((r) => r.retracted), 1) },
  absorbSpend: { header: () => 'absorb spend', value: (rs) => msd(rs.map((r) => r.absorbShare)) },
};
