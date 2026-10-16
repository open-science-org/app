// Named settings and the shared base parameters (OSO/docs/demo-model.md, section 9).
import { DEFAULT_MIX } from './agents.ts';
import type { Rules, RunParams } from './model.ts';
import { DEFAULT_WORLD } from './world.ts';

export const BASE: Omit<RunParams, 'rules' | 'seed'> = {
  world: DEFAULT_WORLD,
  mix: DEFAULT_MIX,
  X: 1200,
  T: 120,
  m: 1,
  theta: 0.5,
  rho: 0.5,
  lambdaE: 0.7,
  sigmaW: 0,
  tau: 0.3,
  epsilon: 0.05,
  sigma0: 1,
  kappa: 1,
  psi: 0.5,
  roundsPerLevel: 5,
  targetLevel: 7,
};

const OSO_ALPHA = 0.8;
const OSO_C = 0.15;

export const SETTINGS: Record<string, { label: string; rules: Rules }> = {
  traditional: { label: 'Traditional', rules: { alpha: 1, c: 0, visibility: { kind: 'finished-only' } } },
  oso: { label: 'OSO (immediate)', rules: { alpha: OSO_ALPHA, c: OSO_C, visibility: { kind: 'immediate' } } },
  creditOnly: { label: 'Flow-back, finished-only', rules: { alpha: OSO_ALPHA, c: OSO_C, visibility: { kind: 'finished-only' } } },
  sharingOnly: { label: 'No flow-back, immediate', rules: { alpha: 1, c: 0, visibility: { kind: 'immediate' } } },
  traditionalChoice: { label: 'No flow-back, choice', rules: { alpha: 1, c: 0, visibility: { kind: 'choice' } } },
  osoChoice: { label: 'OSO (choice)', rules: { alpha: OSO_ALPHA, c: OSO_C, visibility: { kind: 'choice' } } },
};
