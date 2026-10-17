// Success oracles: what decides whether an attempt succeeds (specification, section 2.2).
// The simulation's oracle is chance; the Lean experiment's will be Lean's checker.
import { Registry } from './registry.ts';
import type { Rng } from './rng.ts';

export interface AttemptContext {
  agent: number;
  result: number;
  /** The success chance from the environment: min(1, skill × p of the result). */
  p: number;
  /** Failed attempts this agent has already made on this result. */
  failures: number;
  /** Failed attempts by other agents on this result that were made public (rules.publishFailures). */
  othersFailures: number;
  rng: Rng;
  /** Whatever the decider attached to the attempt, such as a written proof. */
  payload?: unknown;
}

export interface Oracle {
  succeeds: (ctx: AttemptContext) => boolean;
}

export const oracles = new Registry<Record<string, unknown>, Oracle>('success oracle');

oracles.register('chance', {
  description: 'The attempt succeeds with chance p: a random number below p',
  defaults: {},
  create: () => ({ succeeds: (ctx) => ctx.rng.chance(ctx.p) }),
});

oracles.register<{ gain: number; sharedWeight: number; cap: number }>('learning', {
  description: "Failures teach: chance p × (1 + gain × (own failures + sharedWeight × others' public failures)), at most cap",
  defaults: { gain: 0.25, sharedWeight: 1, cap: 1 },
  create: ({ gain, sharedWeight, cap }) => ({
    succeeds: (ctx) => ctx.rng.chance(Math.min(cap, ctx.p * (1 + gain * (ctx.failures + sharedWeight * ctx.othersFailures)))),
  }),
});
