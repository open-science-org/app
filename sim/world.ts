// The world: a hidden DAG of results (OSO/docs/demo-model.md, section 2).
import type { Rng } from './rng.ts';

export interface WorldParams {
  /** Number of levels; level 1 holds the roots. */
  levels: number;
  /** Results per level. */
  width: number;
  /** Each result has 1 to maxPrereqs prerequisites. */
  maxPrereqs: number;
  /** Chance that an extra prerequisite comes from any lower level instead of the level just below. */
  skipProb: number;
  /** Number of areas (subfields). */
  areas: number;
  /** Chance that a result is in the same area as its main prerequisite. */
  areaStickiness: number;
  /** Base success chance per attempt: p_r = p0 · eta^(level − 1). */
  p0: number;
  eta: number;
  /** Targets to place, by level. */
  targets: { level: number; count: number }[];
  /** Bounty of a target: B0 · g^(level − 1). */
  B0: number;
  g: number;
}

export const DEFAULT_WORLD: WorldParams = {
  levels: 8,
  width: 10,
  maxPrereqs: 3,
  skipProb: 0.25,
  areas: 3,
  areaStickiness: 0.8,
  p0: 0.5,
  eta: 0.6,
  targets: [{ level: 3, count: 2 }, { level: 5, count: 2 }, { level: 7, count: 2 }, { level: 8, count: 1 }],
  B0: 4,
  g: 2,
};

export interface World {
  n: number;
  levels: number;
  level: number[];
  area: number[];
  p: number[];
  prereqs: number[][];
  children: number[][];
  /** True attribution weights over each result's prerequisites, proportional to 1/p_j. */
  weights: number[][];
  isTarget: boolean[];
  bounty: number[];
  targets: number[];
  /** All ancestors of each result. */
  ancestors: Set<number>[];
  /** Targets strictly below each result (targets that depend on it). */
  targetsBelow: number[][];
  deadEnd: boolean[];
}

export function makeWorld(params: WorldParams, rng: Rng): World {
  const level: number[] = [];
  const area: number[] = [];
  const prereqs: number[][] = [];
  const byLevel: number[][] = [];
  for (let l = 1; l <= params.levels; l++) {
    byLevel[l] = [];
    for (let k = 0; k < params.width; k++) {
      const r = level.length;
      level.push(l);
      byLevel[l].push(r);
      if (l === 1) {
        prereqs.push([]);
        area.push(rng.int(params.areas));
        continue;
      }
      const main = rng.pick(byLevel[l - 1]);
      const ps = new Set([main]);
      const extra = rng.int(params.maxPrereqs);
      for (let e = 0; e < extra; e++) {
        const from = rng.chance(params.skipProb) && l > 2 ? 1 + rng.int(l - 2) : l - 1;
        ps.add(rng.pick(byLevel[from]));
      }
      prereqs.push([...ps].sort((a, b) => a - b));
      area.push(rng.chance(params.areaStickiness) ? area[main] : rng.int(params.areas));
    }
  }
  const n = level.length;
  const p = level.map((l) => params.p0 * params.eta ** (l - 1));
  const children: number[][] = Array.from({ length: n }, () => []);
  prereqs.forEach((ps, r) => ps.forEach((j) => children[j].push(r)));
  const weights = prereqs.map((ps) => {
    const raw = ps.map((j) => 1 / p[j]);
    const sum = raw.reduce((a, b) => a + b, 0);
    return raw.map((x) => x / sum);
  });
  const ancestors: Set<number>[] = [];
  for (let r = 0; r < n; r++) {
    const a = new Set<number>();
    for (const j of prereqs[r]) {
      a.add(j);
      for (const x of ancestors[j]) a.add(x);
    }
    ancestors.push(a);
  }

  // Targets: among each level's results with the most ancestors, so targets need real composition.
  const isTarget = new Array<boolean>(n).fill(false);
  for (const spec of params.targets) {
    const pool = [...byLevel[spec.level]].sort((a, b) => ancestors[b].size - ancestors[a].size);
    const top = rng.shuffle(pool.slice(0, Math.max(spec.count, Math.ceil(pool.length / 2))));
    top.slice(0, spec.count).forEach((t) => (isTarget[t] = true));
  }
  const bounty = level.map((l, r) => (isTarget[r] ? params.B0 * params.g ** (l - 1) : 0));
  const targets = [...Array(n).keys()].filter((r) => isTarget[r]);
  const targetsBelow: number[][] = Array.from({ length: n }, () => []);
  for (const t of targets) for (const a of ancestors[t]) targetsBelow[a].push(t);
  const deadEnd = [...Array(n).keys()].map((r) => !isTarget[r] && targetsBelow[r].length === 0);

  return { n, levels: params.levels, level, area, p, prereqs, children, weights, isTarget, bounty, targets, ancestors, targetsBelow, deadEnd };
}

/** Ledger weights: true weights plus noise of spread sigma, renormalized (model section 2). */
export function ledgerWeights(world: World, sigma: number, rng: Rng): number[][] {
  return world.weights.map((ws) => {
    if (sigma === 0 || ws.length < 2) return [...ws];
    const noisy = ws.map((w) => Math.max(1e-6, w + sigma * rng.normal()));
    const sum = noisy.reduce((a, b) => a + b, 0);
    return noisy.map((w) => w / sum);
  });
}

/**
 * share[x][r]: the fraction of value entering result x that reaches result r's author through the
 * waterfall (model section 5). share[x][x] is what x's author keeps.
 */
export function shares(world: World, alpha: number, w: number[][]): Float64Array[] {
  const out: Float64Array[] = [];
  for (let x = 0; x < world.n; x++) {
    const row = new Float64Array(world.n);
    const ps = world.prereqs[x];
    row[x] = ps.length ? alpha : 1;
    ps.forEach((j, k) => {
      const f = (1 - alpha) * w[x][k];
      const rj = out[j];
      for (const a of world.ancestors[j]) row[a] += f * rj[a];
      row[j] += f * rj[j];
    });
    out.push(row);
  }
  return out;
}

/**
 * S_r: what authoring r can be expected to earn later from flow-back, assuming every target below it
 * is eventually solved and every descendant published (model section 5).
 */
export function attributionValue(world: World, share: Float64Array[], w: number[][], c: number, m: number): number[] {
  const S = new Array<number>(world.n).fill(0);
  for (let d = 0; d < world.n; d++) {
    for (const r of world.ancestors[d]) {
      if (world.isTarget[d]) S[r] += world.bounty[d] * share[d][r];
      world.prereqs[d].forEach((j, k) => {
        if (j === r || world.ancestors[j].has(r)) S[r] += c * m * w[d][k] * share[j][r];
      });
    }
  }
  return S;
}
