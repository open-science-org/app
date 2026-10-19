// Prompting a new problem space: `npm run sim -- new "<description>"`.
// Claude writes a space file (sim/spaces/<id>.yaml) from a plain-language description; the file is
// validated against the scenario rules and test-run, and any error is sent back for a fix. The budget
// is then calibrated, so every space is hard but not hopeless (spaces.ts, calibrateBudget).
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { run } from './model.ts';
import { calibrateBudget, parseSpace, spaceAgents, withBudget, type Space, type SpaceSpec } from './spaces.ts';

const SIM_DIR = new URL('.', import.meta.url).pathname;
export const MODEL = 'claude-opus-5-5';

/** Sends a conversation and returns the model's text. Injectable, so the loop can be tested offline. */
export type Complete = (system: string, messages: { role: 'user' | 'assistant'; content: string }[]) => Promise<string>;

export function claudeComplete(): Complete {
  const client = new Anthropic();
  return async (system, messages) => {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      // If the model declines, retry on a fallback model chosen by the API.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages,
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('the model declined to write this space');
    if (message.stop_reason === 'max_tokens') throw new Error('the response was cut off (max_tokens)');
    return message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
  };
}

export function systemPrompt(): string {
  const read = (p: string) => readFileSync(join(SIM_DIR, p), 'utf8');
  return `You write problem-space files for the OSO research-community simulator.

The simulator compares a community of research agents under traditional incentives (work published only when finished, no credit to what it built on) with OSO incentives (results published at once, value flowing back to what they built on). A problem space describes one field: its research tree of results, how hard each is, which results are targets with bounties, and the agents and budget. Results are abstract: the simulator only needs the tree's shape, difficulty and prizes, not the content.

Write ONE problem-space file as YAML in a single \`\`\`yaml code block, and nothing else after it. The file has these keys:
- id: kebab-case name.
- title: a short title.
- summary: one sentence.
- description: a paragraph in plain words: what the field is, what its stages or areas are, what progress means.
- glossary: { result, target, attempt, area (optional), agent (optional) }: what each term means in this field, as short noun phrases.
- areas: names of the areas, in index order (optional).
- scenario: overrides of the default scenario below. Change only what the field needs. Usually: world, success, measures.targetLevel, and sometimes agents.mix.
- notes: caveats, such as which numbers are guesses (optional).

Choosing the world (scenario.world):
- kind: layered, for a field best described by its stages: levels (number of stages), width (results per stage), maxPrereqs, skipProb, areas, areaStickiness, targets (a list of { level, count }), bountyBase and bountyGrowth (bounty = bountyBase · bountyGrowth^(level − 1)).
- kind: graph, for a small field with a known structure: nodes, a list of { id, prereqs (ids listed earlier), area (from 0), p (optional success chance per attempt), bounty (makes it a target) }. Keep it under 60 nodes.
Targets must exist. measures.targetLevel must not exceed the deepest level; set it to the level of the main targets or one below. Success chances: success.p0 is the chance at level 1 and success.eta the factor per level; most fields fall between eta 0.4 (steep) and 0.8 (gentle). Do not set the budget: it is calibrated automatically.

Every setting, with its default and meaning (sim/scenarios/default.yaml):
\`\`\`yaml
${read('scenarios/default.yaml')}
\`\`\`

Two example problem spaces:
\`\`\`yaml
${read('spaces/drug-discovery.yaml')}
\`\`\`
\`\`\`yaml
${read('spaces/abstract-field.yaml')}
\`\`\``;
}

function extractYaml(text: string): string {
  const fenced = [...text.matchAll(/```(?:yaml|yml)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  return fenced.length ? fenced[fenced.length - 1] : text;
}

/** Parses, validates and test-runs a space; throws with a message a model can act on. */
export function checkSpace(yamlText: string): Space {
  let spec: SpaceSpec;
  try {
    spec = parse(yamlText) as SpaceSpec;
  } catch (e) {
    throw new Error(`the YAML does not parse: ${(e as Error).message}`);
  }
  const space = parseSpace(spec, 'space');
  const probe = run(space.scenario, 1);
  if (probe.spend <= 0) throw new Error('a test run spent nothing: no agent could attempt any result');
  return space;
}

/**
 * Generates a space from a description: ask, check, and send errors back, up to `attempts` times.
 * Then calibrates the budget.
 */
export async function generateSpace(description: string, complete: Complete, { attempts = 3, log = (_: string) => {} } = {}): Promise<Space> {
  const system = systemPrompt();
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: `Write the problem-space file for this field:\n\n${description}` },
  ];
  let lastError = '';
  for (let k = 1; k <= attempts; k++) {
    log(`  asking ${MODEL} (attempt ${k} of ${attempts})…`);
    const text = await complete(system, messages);
    const yamlText = extractYaml(text);
    try {
      const space = checkSpace(yamlText);
      log('  the space is valid; calibrating the budget…');
      const X = calibrateBudget(space);
      const spec = withBudget({ ...space.spec, source: `generated by ${MODEL} from: "${description.replace(/\s+/g, ' ').trim()}"` }, X, spaceAgents(space));
      return parseSpace(spec, 'space');
    } catch (e) {
      lastError = (e as Error).message;
      log(`  not valid: ${lastError}`);
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: `That file is not valid: ${lastError}\n\nFix it and send the whole file again, in one yaml code block.` });
    }
  }
  throw new Error(`no valid space after ${attempts} attempts; last error: ${lastError}`);
}
