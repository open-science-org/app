// Compatibility shim: the base parameters and named settings now live in sim/scenarios/default.yaml
// and sim/presets.yaml. Prefer `loadScenario` from config.ts and `preset:` in experiment files.
import { loadScenario, readConfigFile, type Scenario } from './config.ts';

/** The named rule settings from presets.yaml, as scenario overrides. */
export const SETTINGS = readConfigFile('presets.yaml') as Record<string, Record<string, unknown>>;

/** The default scenario with a named setting and further overrides (dotted paths allowed). */
export function scenarioFor(setting: string, ...overrides: Record<string, unknown>[]): Scenario {
  const preset = SETTINGS[setting];
  if (!preset) throw new Error(`unknown setting "${setting}"`);
  return loadScenario(null, preset, ...overrides);
}
