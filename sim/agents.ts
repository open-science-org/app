// Agents: eight core traits and six archetypes (OSO/docs/demo-model.md, section 3).
import type { Rng } from './rng.ts';

export interface Traits {
  /** Proving skill; multiplies the base success chance. */
  skill: number;
  /** If set, skill in this area is multiplied by specialistBoost and elsewhere by specialistPenalty. */
  specialty: number | null;
  /** Conjecture quality q: how accurately the agent perceives which results matter (0 to 1). */
  conjecture: number;
  /** Cost per attempt k, in compute units. */
  cost: number;
  /** Time horizon δ: discount per round on future rewards (0 to 1). */
  horizon: number;
  /** Risk attitude γ: penalty per unit of payoff spread; negative means risk-seeking. */
  risk: number;
  /** Reuse ω: chance of trusting and using another agent's published result. */
  reuse: number;
  /** Sharing disposition β: intrinsic value of publishing, in units of the mint m. */
  sharing: number;
  /** Gaming g: share of attempts spent farming trivial results. */
  gaming: number;
}

export type Archetype = 'plain' | 'foundation' | 'racer' | 'explorer' | 'specialist' | 'freeRider' | 'gamer';

export const ARCHETYPES: Record<Archetype, Omit<Traits, 'specialty'> & { specialist?: boolean }> = {
  // The simple model's agent: average skill, unit cost, no preferences, takes up others' work at once.
  plain: { skill: 1.0, conjecture: 1.0, cost: 1.0, horizon: 1.0, risk: 0, reuse: 1.0, sharing: 0, gaming: 0 },
  foundation: { skill: 1.0, conjecture: 0.7, cost: 1.0, horizon: 0.98, risk: 0.2, reuse: 0.9, sharing: 0.5, gaming: 0 },
  racer: { skill: 1.0, conjecture: 0.5, cost: 1.0, horizon: 0.85, risk: -0.2, reuse: 0.6, sharing: 0, gaming: 0 },
  explorer: { skill: 0.5, conjecture: 0.3, cost: 0.3, horizon: 0.95, risk: 0, reuse: 0.8, sharing: 0.2, gaming: 0 },
  specialist: { skill: 1.0, conjecture: 0.6, cost: 1.0, horizon: 0.95, risk: 0, reuse: 0.8, sharing: 0.2, gaming: 0, specialist: true },
  freeRider: { skill: 0.8, conjecture: 0.5, cost: 1.0, horizon: 0.9, risk: 0, reuse: 1.0, sharing: -1, gaming: 0 },
  gamer: { skill: 0.8, conjecture: 0.3, cost: 0.5, horizon: 0.9, risk: 0, reuse: 0.8, sharing: 0, gaming: 0.6 },
};

export const SPECIALIST_BOOST = 1.6;
export const SPECIALIST_PENALTY = 0.4;

export const DEFAULT_MIX: Partial<Record<Archetype, number>> = {
  foundation: 3, racer: 3, explorer: 2, specialist: 2, freeRider: 1, gamer: 1,
};

export interface Agent {
  id: number;
  archetype: Archetype;
  traits: Traits;
}

export function makeAgents(mix: Partial<Record<Archetype, number>>, areas: number, rng: Rng): Agent[] {
  const agents: Agent[] = [];
  for (const [archetype, count] of Object.entries(mix) as [Archetype, number][]) {
    for (let k = 0; k < count; k++) {
      const { specialist, ...t } = ARCHETYPES[archetype];
      agents.push({ id: agents.length, archetype, traits: { ...t, specialty: specialist ? rng.int(areas) : null } });
    }
  }
  return agents;
}

/** Skill of an agent in an area. */
export function skillIn(agent: Agent, area: number): number {
  const t = agent.traits;
  if (t.specialty === null) return t.skill;
  return t.skill * (area === t.specialty ? SPECIALIST_BOOST : SPECIALIST_PENALTY);
}
