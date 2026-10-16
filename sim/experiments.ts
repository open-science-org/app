// Named experiments. Each returns its full configuration, a summary table and one record per run,
// which the CLI prints and, with --save, writes to sim/results/<id>/ (sim/README.md, "Results").
import { hiddenDepth, sharedDepth } from './analytic.ts';
import { run, type Rules, type RunParams, type RunResult } from './model.ts';
import { BASE, SETTINGS } from './settings.ts';

export interface Output {
  config: unknown;
  table: Record<string, string | number>[];
  runs: Record<string, unknown>[];
}

export interface Experiment {
  id: string;
  title: string;
  description: string;
  defaultSeeds: number;
  run: (seeds: number) => Output;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const msd = (xs: number[], d = 2) => (xs.length ? `${f(mean(xs), d)} ± ${f(sd(xs), d)}` : '–');
const mse = (xs: number[], d = 2) => `${f(mean(xs), d)} ± ${f(sd(xs) / Math.sqrt(xs.length), d)}`;

/** A run record without the full curve: the frontier is kept at 11 evenly spaced points of spend. */
function record(r: RunResult, extra: Record<string, unknown>) {
  const { curve, ...rest } = r;
  const X = curve.length ? curve[curve.length - 1].spend : 0;
  const at = (x: number) => curve.filter((c) => c.spend <= x).at(-1)?.level ?? 0;
  return { ...extra, ...rest, frontierAtSpend: Array.from({ length: 11 }, (_, k) => at((X * k) / 10)) };
}

function runSeeds(params: Omit<RunParams, 'seed'>, seeds: number, first = 1): RunResult[] {
  return Array.from({ length: seeds }, (_, k) => run({ ...params, seed: first + k }));
}

/** The summary columns used by every experiment on the full model. */
function measures(rs: RunResult[], L: number) {
  const reached = rs.filter((r) => r.speed !== null);
  return {
    frontier: msd(rs.map((r) => r.frontier), 1),
    [`reach L${L}`]: f(reached.length / rs.length),
    speed: msd(reached.map((r) => r.speed!), 0),
    cost: msd(reached.map((r) => r.cost!), 0),
    spend: msd(rs.map((r) => r.spend), 0),
    'results per 100': msd(rs.map((r) => r.productivity * 100), 1),
    breadth: msd(rs.map((r) => r.breadth)),
    waste: msd(rs.map((r) => r.waste)),
    credit: msd(rs.map((r) => r.creditAccuracy)),
    sharing: msd(rs.map((r) => r.sharingRate)),
    hoarded: msd(rs.map((r) => r.hoarded)),
  };
}

const simple: Experiment = {
  id: 'simple',
  title: 'The simple model: one chain, shared vs. hidden progress',
  description:
    'A single chain of 300 results, each with success chance p = 0.2 per attempt; N identical agents; X = 640 attempts in total, one per agent per round. ' +
    'Shared: every result is published and taken up at once. Hidden: nothing is published until the end of the chain, which no one reaches. ' +
    'Measure: the deepest result proved by anyone. The exact values come from sim/analytic.ts.',
  defaultSeeds: 1000,
  run(seeds) {
    const X = 640;
    const p = 0.2;
    const world = { ...BASE.world, levels: 300, width: 1, maxPrereqs: 1, areas: 1, p0: p, eta: 1, targets: [{ level: 300, count: 1 }] };
    const config = { X, p, chainLength: 300, agents: 'plain', N: [1, 2, 4, 8, 16], seeds };
    const table: Output['table'] = [];
    const runs: Output['runs'] = [];
    for (const N of [1, 2, 4, 8, 16]) {
      const base = { ...BASE, world, mix: { plain: N }, X, T: X / N, rho: 0 };
      const go = (kind: 'immediate' | 'finished-only') => runSeeds({ ...base, rules: { alpha: 1, c: 0, visibility: { kind } } }, seeds);
      const shared = go('immediate');
      const hidden = go('finished-only');
      shared.forEach((r, k) => runs.push(record(r, { N, progress: 'shared', seed: k + 1 })));
      hidden.forEach((r, k) => runs.push(record(r, { N, progress: 'hidden', seed: k + 1 })));
      const sh = shared.map((r) => r.deepestProved);
      const hd = hidden.map((r) => r.deepestProved);
      const exactS = sharedDepth(X, p).mean;
      const exactH = hiddenDepth(X, p, N).mean;
      table.push({
        N,
        'shared: simulated': mse(sh, 1),
        'shared: exact': f(exactS, 1),
        'hidden: simulated': mse(hd, 1),
        'hidden: exact': f(exactH, 1),
        'gain: simulated': f(mean(sh) / mean(hd)),
        'gain: exact': f(exactS / exactH),
      });
    }
    return { config, table, runs };
  },
};

const settings: Experiment = {
  id: 'settings',
  title: 'The six rule settings on the default world',
  description:
    'Traditional research (α = 1, c = 0, finished-only), OSO (α = 0.8, c = 0.15) with immediate and with agent\'s-choice visibility, ' +
    'and the mixed corners. Same world parameters, agents and budget in every setting; each seed gives the same world and agents across settings.',
  defaultSeeds: 100,
  run(seeds) {
    const table: Output['table'] = [];
    const runs: Output['runs'] = [];
    for (const [key, s] of Object.entries(SETTINGS)) {
      const rs = runSeeds({ ...BASE, rules: s.rules }, seeds);
      rs.forEach((r, k) => runs.push(record(r, { setting: key, seed: k + 1 })));
      const shares: Record<string, number[]> = {};
      for (const r of rs) for (const [a, x] of Object.entries(r.earningsByArchetype)) (shares[a] ??= []).push(x);
      table.push({
        setting: s.label,
        ...measures(rs, BASE.targetLevel),
        'gamer share of pay': f(mean(shares.gamer ?? [0])),
      });
    }
    return { config: { base: BASE, settings: SETTINGS, seeds }, table, runs };
  },
};

function sweep(id: string, title: string, description: string, grid: { label: Record<string, string | number>; over: Partial<RunParams>; rules: Rules }[]): Experiment {
  return {
    id, title, description, defaultSeeds: 100,
    run(seeds) {
      const table: Output['table'] = [];
      const runs: Output['runs'] = [];
      for (const g of grid) {
        const rs = runSeeds({ ...BASE, ...g.over, rules: g.rules }, seeds);
        rs.forEach((r, k) => runs.push(record(r, { ...g.label, seed: k + 1 })));
        table.push({ ...g.label, ...measures(rs, BASE.targetLevel) });
      }
      return { config: { base: BASE, grid, seeds }, table, runs };
    },
  };
}

const alphas = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];

const alphaSweep = sweep(
  'alpha-sweep',
  'α sweep under agent\'s-choice visibility',
  'Agents choose whether to publish each lemma (section 6 of the model). α from 1 (traditional) down to 0.1, with c = 0.15 (c = 0 at α = 1). Default scoop risk ψ = 0.5.',
  alphas.map((alpha) => ({ label: { α: alpha }, over: {}, rules: { alpha, c: alpha === 1 ? 0 : 0.15, visibility: { kind: 'choice' } } })),
);

const alphaPsi = sweep(
  'alpha-psi',
  'Where sharing becomes rational: α × scoop risk ψ × cited share c',
  'Agent\'s-choice visibility. ψ is how much publishing a lemma raises a rival\'s chance of winning the target below it; c is the share of each mint paid to what a result built on.',
  [0.5, 0.25, 0.1].flatMap((psi) => [1, 0.8, 0.5, 0.3, 0.1].flatMap((alpha) => (alpha === 1 ? [0] : [0, 0.15]).map((c) => ({
    label: { ψ: psi, α: alpha, c },
    over: { psi },
    rules: { alpha, c, visibility: { kind: 'choice' as const } },
  })))),
);

export const EXPERIMENTS: Experiment[] = [simple, settings, alphaSweep, alphaPsi];
