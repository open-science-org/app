// Pluggable rules: visibility (when proofs are published), allocation (how each round's compute is
// split) and policy (how an agent chooses what to attempt). Each is a registry; see sim/README.md.
import { Registry } from './registry.ts';
import type { Rng } from './rng.ts';

/** What a visibility rule can do when an agent proves a result nobody has published. */
export interface ProofContext {
  round: number;
  isTarget: boolean;
  /** Publish the result with every private result of the agent's it depends on. */
  publish: () => void;
  /** Publish it at a later round (if nobody has by then). */
  schedule: (round: number) => void;
  /** The agent's own publish rule (sim/README.md, section 2.5). */
  agentWouldPublish: () => boolean;
}

export interface Visibility {
  onProof: (ctx: ProofContext) => void;
}

export const visibilities = new Registry<Record<string, unknown>, Visibility>('visibility');

visibilities.register('finished-only', {
  description: 'A result stays private until its author proves a target that depends on it',
  defaults: {},
  create: () => ({ onProof: (ctx) => { if (ctx.isTarget) ctx.publish(); } }),
});

visibilities.register('immediate', {
  description: 'A result is published as soon as it is proved',
  defaults: {},
  create: () => ({ onProof: (ctx) => ctx.publish() }),
});

visibilities.register<{ d: number }>('delayed', {
  description: 'A result is published d rounds after it is proved',
  defaults: { d: 1 },
  create: ({ d }) => ({ onProof: (ctx) => ctx.schedule(ctx.round + d) }),
});

visibilities.register('choice', {
  description: "Targets are published; for each lemma the agent decides by its publish rule",
  defaults: {},
  create: () => ({ onProof: (ctx) => { if (ctx.isTarget || ctx.agentWouldPublish()) ctx.publish(); } }),
});

/** Splits a round's compute among agents and learns from their earnings. */
export interface Allocation {
  budgets: (perRound: number) => number[];
  update: (roundEarnings: Float64Array) => void;
}

export const allocations = new Registry<Record<string, unknown>, (n: number) => Allocation>('allocation');

allocations.register<{ rho: number; smoothing: number }>('earnings-share', {
  description: 'A share 1 − rho split equally, a share rho in proportion to smoothed recent earnings',
  defaults: { rho: 0.5, smoothing: 0.7 },
  create: ({ rho, smoothing }) => (n) => {
    const ebar = new Float64Array(n);
    return {
      budgets: (perRound) => {
        const total = ebar.reduce((a, b) => a + b, 0);
        return Array.from(ebar, (e) => perRound * ((1 - rho) / n + rho * (total > 0 ? e / total : 1 / n)));
      },
      update: (earned) => {
        for (let i = 0; i < n; i++) ebar[i] = smoothing * ebar[i] + (1 - smoothing) * earned[i];
      },
    };
  },
});

allocations.register('equal', {
  description: 'Every agent gets the same compute every round',
  defaults: {},
  create: () => (n) => ({ budgets: (perRound) => new Array(n).fill(perRound / n), update: () => {} }),
});

/** Chooses one option index from scored options. */
export interface Policy {
  choose: (scores: number[], rng: Rng) => number;
}

export const policies = new Registry<Record<string, unknown>, Policy>('policy');

policies.register<{ tau: number; epsilon: number }>('softmax', {
  description: 'With chance epsilon a random option; otherwise softmax over scores at temperature tau × |best|',
  defaults: { tau: 0.3, epsilon: 0.05 },
  create: ({ tau, epsilon }) => ({
    choose: (scores, rng) => {
      if (rng.chance(epsilon)) return rng.int(scores.length);
      const best = Math.max(...scores);
      const scale = Math.max(1e-9, tau * Math.abs(best));
      const ws = scores.map((u) => Math.exp((u - best) / scale));
      let pick = rng.next() * ws.reduce((a, b) => a + b, 0);
      let idx = 0;
      while (pick > ws[idx] && idx < ws.length - 1) pick -= ws[idx++];
      return idx;
    },
  }),
});

policies.register('greedy', {
  description: 'Always the best-scoring option (ties to the first)',
  defaults: {},
  create: () => ({ choose: (scores) => scores.indexOf(Math.max(...scores)) }),
});
