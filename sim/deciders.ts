// Deciders: how an agent chooses what to attempt and whether to publish (specification, section 4.2).
// The environment (frontier, success, publishing, payment) stays in model.ts; a decider only decides.
// A decider must use only what its agent knows (specification, section 2.3), and draw randomness
// only from `ctx.s.rng`, so runs stay reproducible.
import { skillIn } from './agents.ts';
import type { State } from './model.ts';
import { Registry } from './registry.ts';
import type { Rng } from './rng.ts';
import { policies } from './rules.ts';
import { attributionValue } from './world.ts';

export type Choice =
  | { kind: 'idle' }
  | { kind: 'trivial' }
  /** Attempt a result on the frontier. `payload` goes to the success oracle (e.g. a written proof). */
  | { kind: 'attempt'; result: number; payload?: unknown; note?: unknown };

export interface Decider {
  /** What agent i does with one attempt, given its frontier. */
  choose: (i: number, frontier: number[]) => Choice;
  /** Whether agent i publishes the lemma it just proved (agent's-choice visibility). */
  wouldPublish: (i: number, result: number, choice: Choice) => boolean;
}

export interface DeciderContext {
  s: State;
  /** A random stream for each agent's noisy perception, drawn once when the decider is built. */
  perception: Rng;
}

export const deciders = new Registry<Record<string, unknown>, (ctx: DeciderContext) => Decider>('decider');

/** Expected delay, in rounds, until value from targets below r arrives. */
function delay(s: State, r: number): number {
  const below = s.world.targetsBelow[r];
  if (!below.length) return 1;
  const mean = below.reduce((a, t) => a + s.world.level[t], 0) / below.length;
  return Math.max(1, s.sc.behaviour.roundsPerLevel * (mean - s.world.level[r]));
}

deciders.register('formula', {
  description: 'Scores each frontier result by expected value under the rules (sim/README.md, section 2.5); behaviour.* sets its parameters',
  defaults: {},
  create: () => ({ s, perception }) => {
    const { world, sc } = s;
    // Each agent's noisy perception of attribution value S and of the best bounty below each result.
    const S = attributionValue(world, s.share, s.w, sc.rules.c, sc.rules.mint);
    const down = world.targetsBelow.map((ts) => Math.max(0, ...ts.map((t) => world.bounty[t])));
    const noisy = (base: number[], q: number) =>
      Float64Array.from(base, (x) => Math.max(0, x * (1 + sc.behaviour.perceptionNoise * (1 - q) * perception.normal())));
    const seenS = s.agents.map((a) => noisy(S, a.traits.conjecture));
    const seenDown = s.agents.map((a) => noisy(down, a.traits.conjecture));
    const policy = policies.create(sc.behaviour.policy, 'behaviour.policy');

    const score = (i: number, r: number) => {
      const { alpha, c, mint: m } = sc.rules;
      const t = s.agents[i].traits;
      const pi = Math.min(1, skillIn(s.agents[i], world.area[r], sc.agents.specialist) * world.p[r]);
      const win = 1 / (1 + Math.max(0, s.rivalsAt[r] - 1));
      const later = t.horizon ** delay(s, r);
      const mint = world.prereqs[r].length ? (1 - c) * m : m;
      const bounty = world.isTarget[r] ? alpha * world.bounty[r] * win : 0;
      // A lemma is a stepping stone to a target the agent may win itself, under any rules.
      const step = later * alpha * seenDown[i][r] * win;
      const flow = later * seenS[i][r];
      const value = mint + bounty + step + flow;
      return { u: value * (pi - t.risk * Math.sqrt(pi * (1 - pi))), win, later };
    };

    return {
      choose: (i, frontier) => {
        if (s.rng.chance(s.agents[i].traits.gaming)) return { kind: 'trivial' };
        if (!frontier.length) return { kind: 'idle' };
        const scored = frontier.map((r) => score(i, r));
        const idx = policy.choose(scored.map((o) => o.u), s.rng);
        return { kind: 'attempt', result: frontier[idx], note: scored[idx] };
      },
      wouldPublish: (i, r, choice) => {
        const { win, later } = (choice as { note: { win: number; later: number } }).note;
        const { alpha, c, mint: m } = sc.rules;
        const { kappa, psi } = sc.behaviour;
        const t = s.agents[i].traits;
        // Kept private, the mint arrives only if the agent later wins a target that uses r.
        const mint = (world.prereqs[r].length ? 1 - c : 1) * m;
        const mintAtRisk = mint * (1 - (world.targetsBelow[r].length ? later * win : 0));
        const gain = t.sharing * m + mintAtRisk + later * seenS[i][r] * kappa;
        const scoop = alpha * seenDown[i][r] * win * psi;
        return gain >= scoop;
      },
    };
  },
});

deciders.register<{ publish: number }>('random', {
  description: 'Picks a frontier result uniformly at random, never games, and publishes a lemma with chance `publish`: a zero-intelligence baseline',
  defaults: { publish: 1 },
  create: ({ publish }) => ({ s }) => ({
    choose: (_i, frontier) => (frontier.length ? { kind: 'attempt', result: frontier[s.rng.int(frontier.length)] } : { kind: 'idle' }),
    wouldPublish: () => s.rng.chance(publish),
  }),
});
