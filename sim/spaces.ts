// Problem spaces: a research field described in its own words plus a scenario, so that anyone can
// add one (by hand or with `npm run sim -- new "<description>"`) and get the canonical report.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { expandPaths, loadScenario, readConfigFile, type Scenario } from './config.ts';
import { run } from './model.ts';
import { worlds } from './world.ts';
import { Rng } from './rng.ts';

/** A problem space file (sim/spaces/<id>.yaml). */
export interface SpaceSpec {
  /** Short kebab-case name; also the report folder. */
  id: string;
  title: string;
  /** One sentence. */
  summary: string;
  /** A paragraph: what the field is and what progress means in it. */
  description: string;
  /** What the specification's terms mean in this field. */
  glossary: { result: string; target: string; attempt: string; area?: string; agent?: string };
  /** Names of the areas, in index order. */
  areas?: string[];
  /** A base scenario from sim/scenarios/ (default: the default scenario). */
  scenarioFile?: string;
  /** Overrides of the scenario (sim/scenarios/default.yaml documents every setting). */
  scenario?: Record<string, unknown>;
  /** Caveats specific to this space, shown in the report. */
  notes?: string;
  /** How the space was made: by hand, or the prompt it was generated from. */
  source?: string;
}

export interface Space {
  spec: SpaceSpec;
  scenario: Scenario;
}

const SPEC_KEYS = ['id', 'title', 'summary', 'description', 'glossary', 'areas', 'scenarioFile', 'scenario', 'notes', 'source'];
const SPACES_DIR = new URL('./spaces/', import.meta.url).pathname;

/** Checks a space and builds its scenario. Errors name the problem in words a model can act on. */
export function parseSpace(spec: SpaceSpec, where = 'space'): Space {
  if (!spec || typeof spec !== 'object') throw new Error(`${where}: must be a YAML mapping`);
  const unknown = Object.keys(spec).filter((k) => !SPEC_KEYS.includes(k));
  if (unknown.length) throw new Error(`${where}: unknown key ${unknown.map((k) => `"${k}"`).join(', ')} (allowed: ${SPEC_KEYS.join(', ')})`);
  for (const k of ['id', 'title', 'summary', 'description'] as const) {
    if (typeof spec[k] !== 'string' || !spec[k].trim()) throw new Error(`${where}: "${k}" must be a non-empty string`);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(spec.id)) throw new Error(`${where}: id "${spec.id}" must be kebab-case (a-z, 0-9, hyphens)`);
  const g = spec.glossary;
  if (!g || typeof g !== 'object') throw new Error(`${where}: "glossary" must give result, target and attempt`);
  for (const k of ['result', 'target', 'attempt'] as const) {
    if (typeof g[k] !== 'string' || !g[k].trim()) throw new Error(`${where}: glossary.${k} must be a non-empty string`);
  }
  const scenario = loadScenario(spec.scenarioFile ?? null, expandPaths(spec.scenario ?? {}));
  // Build one world to catch structural errors early (missing targets, bad prerequisites, ...).
  const world = worlds.create(scenario.world, `${where}: world`)(scenario.success, new Rng(1).fork(1));
  if (!world.targets.length) throw new Error(`${where}: the world has no targets (results with a bounty)`);
  if (spec.areas && spec.areas.length < Math.max(...world.area) + 1) {
    throw new Error(`${where}: "areas" names ${spec.areas.length} areas but the world uses ${Math.max(...world.area) + 1}`);
  }
  if (scenario.measures.targetLevel > world.levels) {
    throw new Error(`${where}: measures.targetLevel is ${scenario.measures.targetLevel} but the deepest level is ${world.levels}`);
  }
  return { spec, scenario };
}

export function spaceIds(): string[] {
  if (!existsSync(SPACES_DIR)) return [];
  return readdirSync(SPACES_DIR).filter((f) => f.endsWith('.yaml')).map((f) => f.slice(0, -5)).sort();
}

export function loadSpace(idOrPath: string): Space {
  const path = idOrPath.includes('/') || idOrPath.endsWith('.yaml') ? idOrPath : join(SPACES_DIR, `${idOrPath}.yaml`);
  return parseSpace(readConfigFile(path) as SpaceSpec, path);
}

/** Whether the space (or its base scenario file) sets the budget; if not, reports calibrate it. */
export function setsBudget(spec: SpaceSpec): boolean {
  const own = expandPaths(spec.scenario ?? {}).budget as Record<string, unknown> | undefined;
  if (own?.X !== undefined) return true;
  if (!spec.scenarioFile) return false;
  const file = spec.scenarioFile.includes('/') || spec.scenarioFile.endsWith('.yaml') ? spec.scenarioFile : `scenarios/${spec.scenarioFile}.yaml`;
  return (readConfigFile(file) as { budget?: { X?: unknown } }).budget?.X !== undefined;
}

/** The space ready for a report: the budget calibrated if the space does not set one. */
export function withCalibratedBudget(space: Space): { space: Space; calibrated: boolean } {
  if (setsBudget(space.spec)) return { space, calibrated: false };
  const X = calibrateBudget(space);
  return { space: parseSpace(withBudget(space.spec, X, spaceAgents(space)), space.spec.id), calibrated: true };
}

export function spaceToYaml(spec: SpaceSpec): string {
  return stringify(spec, { lineWidth: 100 });
}

/**
 * Sizes the budget so the problem is hard but not hopeless: the smallest X (doubling, then
 * bisecting) at which OSO with immediate sharing solves at least `share` of the targets on average
 * over `seeds` runs, on the seeds reports use first (1, 2, ...), so the report sees the same runs. The comparison is then what the same money buys traditional research.
 */
export function calibrateBudget(space: Space, { share = 0.9, seeds = 50, max = 200_000 } = {}): number {
  const oso = (X: number) => loadScenario(space.spec.scenarioFile ?? null, expandPaths(space.spec.scenario ?? {}), {
    rules: { alpha: 0.8, c: 0.15, visibility: { kind: 'immediate' } },
    budget: { X, rounds: Math.max(10, Math.round(X / Math.max(1, agentsOf(space.scenario)))), perAgentPerRound: null },
  });
  /** Mean share of targets solved by OSO with budget X. */
  const solved = (X: number) => {
    const sc = oso(X);
    let total = 0;
    for (let k = 0; k < seeds; k++) total += run(sc, 1 + k).breadth;
    return total / seeds;
  };
  let hi = 50;
  while (solved(hi) < share) {
    hi *= 2;
    if (hi > max) return max;
  }
  let lo = hi / 2;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    if (solved(mid) >= share) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi / 10) * 10;
}

function agentsOf(sc: Scenario): number {
  return Object.values(sc.agents.mix).reduce((a, b) => a + b, 0);
}

/** The space with its budget set: X from calibration and one attempt per agent per round, roughly. */
export function withBudget(spec: SpaceSpec, X: number, agents: number): SpaceSpec {
  const scenario = expandPaths(spec.scenario ?? {});
  const budget = { ...((scenario.budget as Record<string, unknown>) ?? {}), X, rounds: Math.max(10, Math.round(X / Math.max(1, agents))), perAgentPerRound: null };
  return { ...spec, scenario: { ...scenario, budget } };
}

export function spaceAgents(space: Space): number {
  return agentsOf(space.scenario);
}

export { stringify as toYaml };
