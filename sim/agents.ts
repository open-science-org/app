// Agents: archetypes with eight traits, defined in the scenario (sim/scenarios/default.yaml).
import type { Scenario, Traits } from './config.ts';
import type { Rng } from './rng.ts';

export interface Agent {
  id: number;
  archetype: string;
  traits: Traits;
  /** The specialist's strong area, or null. */
  specialty: number | null;
}

/** Builds the population in the order of `agents.mix`. */
export function makeAgents(config: Scenario['agents'], areas: number, rng: Rng): Agent[] {
  const agents: Agent[] = [];
  for (const [archetype, count] of Object.entries(config.mix)) {
    const traits = config.archetypes[archetype];
    for (let k = 0; k < count; k++) {
      agents.push({ id: agents.length, archetype, traits, specialty: traits.specialist ? rng.int(areas) : null });
    }
  }
  return agents;
}

/** Skill of an agent in an area. */
export function skillIn(agent: Agent, area: number, specialist: Scenario['agents']['specialist']): number {
  if (agent.specialty === null) return agent.traits.skill;
  return agent.traits.skill * (area === agent.specialty ? specialist.boost : specialist.penalty);
}
