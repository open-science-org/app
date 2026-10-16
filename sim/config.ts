// Scenario configuration: types, loading (YAML or JSON), merging, dotted-path edits and validation.
// The defaults live in sim/scenarios/default.yaml, which documents every setting.
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parse } from 'yaml';

export interface Traits {
  /** Multiplies the success chance of every attempt. */
  skill: number;
  /** Conjecture quality q (0 to 1): how accurately the agent perceives what results are worth. */
  conjecture: number;
  /** Compute units per attempt. */
  cost: number;
  /** Discount per round on value that arrives later (0 to 1). */
  horizon: number;
  /** Penalty per unit of payoff spread; negative means risk-seeking. */
  risk: number;
  /** Chance per round of taking up a result someone else published. */
  reuse: number;
  /** Intrinsic value of publishing, in units of the mint. */
  sharing: number;
  /** Share of attempts spent farming trivial results. */
  gaming: number;
  /** A specialist is stronger in one random area and weaker elsewhere. */
  specialist: boolean;
}

/** A component chosen by `kind`, with that component's own parameters. */
export type Component = { kind: string } & Record<string, unknown>;

export interface Scenario {
  /** The hidden DAG of results (registry: worlds). */
  world: Component;
  /** Success chance per attempt by level, p = p0 · eta^(level − 1), unless the world gives p per result. */
  success: { p0: number; eta: number };
  /** Noise in the ledger's attribution weights (0 = exact, as in Lean). */
  attribution: { noise: number };
  agents: {
    archetypes: Record<string, Traits>;
    mix: Record<string, number>;
    specialist: { boost: number; penalty: number };
  };
  rules: {
    /** Share of incoming value a result keeps; the rest flows to what it built on. */
    alpha: number;
    /** Share of each mint paid to what the new result built on. */
    c: number;
    /** Mint per newly published result. */
    mint: number;
    /** Chance the validation screen rejects a trivial result. */
    screen: number;
    /** When proofs are published (registry: visibility). */
    visibility: Component;
  };
  budget: {
    /** Total compute for the run. */
    X: number;
    /** Number of rounds; or set perAgentPerRound to derive it as X / (agents × perAgentPerRound). */
    rounds: number | null;
    perAgentPerRound: number | null;
    /** End the run once every target is solved. */
    stopWhenSolved: boolean;
    /** How each round's compute is split among agents (registry: allocation). */
    allocation: Component;
  };
  behaviour: {
    /** How an agent chooses what to attempt (registry: policies). */
    policy: Component;
    /** Scale of the noise in agents' perception of value. */
    perceptionNoise: number;
    /** Publish rule: how much publishing raises a lemma's use (κ), and the scoop risk (ψ). */
    kappa: number;
    psi: number;
    /** Expected rounds per level of depth, for discounting value that arrives later. */
    roundsPerLevel: number;
  };
  measures: {
    /** Level L* for the speed and cost measures. */
    targetLevel: number;
  };
}

const SIM_DIR = new URL('.', import.meta.url).pathname;

export function readConfigFile(path: string): unknown {
  const full = isAbsolute(path) ? path : join(SIM_DIR, path);
  const text = readFileSync(full, 'utf8');
  return full.endsWith('.json') ? JSON.parse(text) : parse(text);
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Deep merge: objects merge key by key, everything else (numbers, arrays, null) replaces. A component
 * whose `kind` changes is replaced whole, so parameters of the old kind do not leak into the new one.
 */
export function merge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : patch) as T;
  if ('kind' in patch && 'kind' in base && patch.kind !== base.kind) return structuredClone(patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = k in out ? merge(out[k], v) : structuredClone(v);
  return out as T;
}

/** Turns `{ "rules.alpha": 0.8 }` into `{ rules: { alpha: 0.8 } }`; nested objects pass through. */
export function expandPaths(patch: Record<string, unknown>): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split('.');
    let nested: unknown = isObject(value) ? expandPaths(value) : value;
    for (let i = parts.length - 1; i >= 1; i--) nested = { [parts[i]]: nested };
    out = merge(out, { [parts[0]]: nested });
  }
  return out;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (isObject(o) ? o[k] : undefined), obj);
}

/** Settings that may be a number or null. */
const NULLABLE = new Set(['budget.rounds', 'budget.perAgentPerRound']);

/** Checks a scenario against the defaults' shape: unknown keys and wrong types are errors. */
export function validate(scenario: unknown, shape: unknown, where = 'scenario'): void {
  const walk = (value: unknown, model: unknown, path: string) => {
    if (isObject(model) && 'kind' in model) {
      // Components are checked by their registry, which knows each kind's parameters.
      if (!isObject(value) || typeof value.kind !== 'string') throw new Error(`${where}: ${path} must be an object with a "kind"`);
      return;
    }
    if (path === 'agents.archetypes') {
      if (!isObject(value)) throw new Error(`${where}: ${path} must be an object`);
      const traitShape = Object.values(model as Record<string, unknown>)[0];
      for (const [name, traits] of Object.entries(value)) walk(traits, traitShape, `${path}.${name}`);
      return;
    }
    if (path === 'agents.mix') {
      if (!isObject(value)) throw new Error(`${where}: ${path} must be an object`);
      for (const [name, n] of Object.entries(value)) {
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new Error(`${where}: ${path}.${name} must be a whole number`);
      }
      return;
    }
    if (isObject(model)) {
      if (!isObject(value)) throw new Error(`${where}: ${path || 'scenario'} must be an object`);
      for (const k of Object.keys(value)) if (!(k in model)) throw new Error(`${where}: unknown setting "${path ? path + '.' : ''}${k}"`);
      for (const k of Object.keys(model)) walk(value[k], model[k], path ? `${path}.${k}` : k);
      return;
    }
    if (model === null || NULLABLE.has(path)) {
      if (value !== null && typeof value !== 'number') throw new Error(`${where}: ${path} must be a number or null`);
      return;
    }
    if (typeof value !== typeof model) throw new Error(`${where}: ${path} must be a ${typeof model}, not ${JSON.stringify(value)}`);
  };
  walk(scenario, shape, '');
}

let defaults: Scenario | null = null;

export function defaultScenario(): Scenario {
  defaults ??= readConfigFile('scenarios/default.yaml') as Scenario;
  return structuredClone(defaults);
}

/** Loads a scenario: the defaults, then an optional file, then patches in order (dotted paths allowed). */
export function loadScenario(file: string | null = null, ...patches: Record<string, unknown>[]): Scenario {
  let s = defaultScenario();
  if (file && file !== 'default') s = merge(s, readConfigFile(file.includes('/') || file.includes('.') ? file : `scenarios/${file}.yaml`));
  for (const p of patches) s = merge(s, expandPaths(p));
  validate(s, defaultScenario());
  for (const name of Object.keys(s.agents.mix)) {
    if (!(name in s.agents.archetypes)) throw new Error(`scenario: agents.mix uses "${name}", which is not in agents.archetypes`);
  }
  return s;
}
