// The world: a hidden DAG of results (sim/README.md, section 2.1). World generators are plugins in
// the `worlds` registry; each turns its parameters and the success model into a World.
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Scenario } from './config.ts';
import { Registry } from './registry.ts';
import type { Rng } from './rng.ts';

export interface World {
  n: number;
  /** Deepest level. */
  levels: number;
  level: number[];
  area: number[];
  /** Base success chance per attempt, before skill. */
  p: number[];
  prereqs: number[][];
  children: number[][];
  /** True attribution weights over each result's prerequisites, proportional to 1/p_j. */
  weights: number[][];
  isTarget: boolean[];
  bounty: number[];
  targets: number[];
  ancestors: Set<number>[];
  /** Targets strictly below each result (targets that depend on it). */
  targetsBelow: number[][];
  deadEnd: boolean[];
  /** Optional names, for worlds read from a file. */
  names?: string[];
}

export type WorldMaker = (success: Scenario['success'], rng: Rng) => World;

export const worlds = new Registry<Record<string, unknown>, WorldMaker>('world');

/** Fills in everything derived from levels, prerequisites, p and bounties. */
export function finishWorld(base: { level: number[]; area: number[]; p: number[]; prereqs: number[][]; bounty: number[]; names?: string[] }): World {
  const { level, area, p, prereqs, bounty } = base;
  const n = level.length;
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
      if (j >= r) throw new Error(`world: result ${r} builds on result ${j}, which must come earlier in the list`);
      a.add(j);
      for (const x of ancestors[j]) a.add(x);
    }
    ancestors.push(a);
  }
  const isTarget = bounty.map((b) => b > 0);
  const targets = [...Array(n).keys()].filter((r) => isTarget[r]);
  const targetsBelow: number[][] = Array.from({ length: n }, () => []);
  for (const t of targets) for (const a of ancestors[t]) targetsBelow[a].push(t);
  const deadEnd = [...Array(n).keys()].map((r) => !isTarget[r] && targetsBelow[r].length === 0);
  return {
    n, levels: Math.max(0, ...level), level, area, p, prereqs, children, weights, isTarget, bounty, targets,
    ancestors, targetsBelow, deadEnd, names: base.names,
  };
}

interface LayeredParams extends Record<string, unknown> {
  levels: number;
  width: number;
  maxPrereqs: number;
  skipProb: number;
  areas: number;
  areaStickiness: number;
  targets: { level: number; count: number }[];
  bountyBase: number;
  bountyGrowth: number;
}

function layered(params: LayeredParams): WorldMaker {
  return (success, rng) => {
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
    const p = level.map((l) => success.p0 * success.eta ** (l - 1));
    // Ancestor counts, to place targets where real composition is needed.
    const ancestorCount: number[] = [];
    const ancestors: Set<number>[] = [];
    for (let r = 0; r < level.length; r++) {
      const a = new Set<number>();
      for (const j of prereqs[r]) {
        a.add(j);
        for (const x of ancestors[j]) a.add(x);
      }
      ancestors.push(a);
      ancestorCount.push(a.size);
    }
    const bounty = new Array<number>(level.length).fill(0);
    for (const spec of params.targets) {
      const pool = [...byLevel[spec.level]].sort((a, b) => ancestorCount[b] - ancestorCount[a]);
      const top = rng.shuffle(pool.slice(0, Math.max(spec.count, Math.ceil(pool.length / 2))));
      top.slice(0, spec.count).forEach((t) => (bounty[t] = params.bountyBase * params.bountyGrowth ** (spec.level - 1)));
    }
    return finishWorld({ level, area, p, prereqs, bounty });
  };
}

worlds.register<LayeredParams>('layered', {
  description: 'A random DAG in levels; each result builds on 1 to maxPrereqs results below it',
  defaults: {
    levels: 8, width: 10, maxPrereqs: 3, skipProb: 0.25, areas: 3, areaStickiness: 0.8,
    targets: [{ level: 3, count: 2 }, { level: 5, count: 2 }, { level: 7, count: 2 }, { level: 8, count: 1 }],
    bountyBase: 4, bountyGrowth: 2,
  },
  create: layered,
});

worlds.register<{ length: number; bounty: number }>('chain', {
  description: 'A single chain of results, with a target (bounty) at the end; the simple model',
  defaults: { length: 300, bounty: 1 },
  create: ({ length, bounty }) => {
    const make = layered({
      levels: length, width: 1, maxPrereqs: 1, skipProb: 0, areas: 1, areaStickiness: 1,
      targets: [{ level: length, count: 1 }], bountyBase: bounty, bountyGrowth: 1,
    });
    return make;
  },
});

interface FileNode {
  id: string;
  prereqs?: string[];
  /** Success chance per attempt; if absent, taken from the success model by level. */
  p?: number;
  area?: number;
  /** A bounty makes the result a target. */
  bounty?: number;
}

worlds.register<{ path: string; areas: number }>('file', {
  description: 'A DAG read from a JSON file: { nodes: [{ id, prereqs?, p?, area?, bounty? }] }, prerequisites listed first',
  defaults: { path: '', areas: 1 },
  create: ({ path }) => (success) => {
    if (!path) throw new Error('world "file" needs a path');
    const full = isAbsolute(path) ? path : join(new URL('.', import.meta.url).pathname, path);
    const nodes = (JSON.parse(readFileSync(full, 'utf8')) as { nodes: FileNode[] }).nodes;
    const index = new Map(nodes.map((nd, i) => [nd.id, i]));
    const prereqs = nodes.map((nd) => (nd.prereqs ?? []).map((id) => {
      const j = index.get(id);
      if (j === undefined) throw new Error(`world file: ${nd.id} builds on unknown result ${id}`);
      return j;
    }).sort((a, b) => a - b));
    const level: number[] = [];
    prereqs.forEach((ps, r) => level.push(1 + Math.max(0, ...ps.map((j) => level[j] ?? 0))));
    return finishWorld({
      level,
      area: nodes.map((nd) => nd.area ?? 0),
      p: nodes.map((nd, r) => nd.p ?? success.p0 * success.eta ** (level[r] - 1)),
      prereqs,
      bounty: nodes.map((nd) => nd.bounty ?? 0),
      names: nodes.map((nd) => nd.id),
    });
  },
});

/** Ledger weights: true weights plus noise of spread sigma, renormalized. */
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
 * waterfall. share[x][x] is what x's author keeps.
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
 * is eventually solved and every descendant published.
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
