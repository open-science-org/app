// The canonical battery: the same experiments, run on every problem space, so that every report
// answers the same questions in the same form (specification, section 8).
import type { ExperimentSpec } from './experiment.ts';
import type { Space } from './spaces.ts';

export const SETTINGS_LEVELS = [
  { label: 'Traditional', preset: 'traditional' },
  { label: 'OSO (immediate)', preset: 'oso' },
  { label: 'Flow-back, finished-only', preset: 'creditOnly' },
  { label: 'No flow-back, immediate', preset: 'sharingOnly' },
  { label: 'No flow-back, choice', preset: 'traditionalChoice' },
  { label: 'OSO (choice)', preset: 'osoChoice' },
];

export const ALPHAS = [1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];

export const KNOWLEDGE_LEVELS = [
  { label: 'free and correct', set: {} },
  { label: 'costly to absorb', set: { 'knowledge.absorbCost': 0.5 } },
  { label: 'sometimes wrong', set: { 'knowledge.errorRate': 0.1 } },
  { label: 'costly and sometimes wrong', set: { 'knowledge.absorbCost': 0.5, 'knowledge.errorRate': 0.1 } },
];

/** The battery for a space: the six settings, the α sweep, and robustness of sharing. */
export function battery(space: Space, seeds: number): ExperimentSpec[] {
  const base = { scenario: space.spec.scenarioFile, set: space.spec.scenario ?? {}, seeds };
  return [
    {
      ...base,
      id: 'settings',
      title: 'The six rule settings',
      description: 'Traditional research, OSO, and the mixed corners, on the same world, agents and budget.',
      factors: [{ name: 'setting', levels: SETTINGS_LEVELS }],
      columns: ['frontier', 'reachTarget', 'speed', 'cost', 'spend', 'targetsSolved', 'waste', 'credit', 'sharing'],
    },
    {
      ...base,
      id: 'alpha',
      title: 'Does flow-back make agents share?',
      description: "Agents choose whether to publish each intermediate result. α from 1 (traditional) down to 0.1; c = 0.15 (0 at α = 1).",
      set: { ...base.set, 'rules.c': 0.15, 'rules.visibility': { kind: 'choice' } },
      factors: [{ name: 'α', path: 'rules.alpha', values: ALPHAS }],
      patches: [{ when: { 'rules.alpha': 1 }, set: { 'rules.c': 0 } }],
      columns: ['sharing', 'frontier', 'reachTarget', 'targetsSolved'],
    },
    {
      ...base,
      id: 'robustness',
      title: 'When sharing is costly or sometimes wrong',
      description: 'Absorbing a published result costs 0.5 compute; proofs are wrong 10% of the time, and targets reveal and retract them.',
      factors: [
        { name: 'knowledge', levels: KNOWLEDGE_LEVELS },
        { name: 'setting', levels: SETTINGS_LEVELS.slice(0, 2) },
      ],
      columns: ['frontier', 'reachTarget', 'targetsSolved', 'absorbSpend', 'retracted'],
    },
  ];
}
