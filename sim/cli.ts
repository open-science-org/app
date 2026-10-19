// Command line for the simulator (sim/README.md, "Running it").
//
//   npm run sim                                     list experiments
//   npm run sim -- <experiment | file.yaml | all>   run, print the table
//     --seeds N        seeds per row (default: the experiment's)
//     --set path=value override any scenario setting for every row (repeatable; value is JSON or text)
//     --save           write sim/results/<id>/ and add a line to sim/results/LOG.md
//   npm run sim -- plugins                          list every plugin: worlds, oracles, deciders, rules, columns
//
// Problem spaces (sim/spaces/) and their canonical reports (sim/reports/):
//   npm run sim -- spaces                           list problem spaces
//   npm run sim -- new "<description>" [--report]   write a space with Claude, check it, calibrate its budget
//   npm run sim -- check <space>                    validate a space file and test-run it
//   npm run sim -- report <space | all> [--seeds N] run the canonical experiments and write the report
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadExperiment, runExperiment, analyses, type ExperimentSpec, type Output } from './experiment.ts';
import { deciders } from './deciders.ts';
import { COLUMNS } from './measures.ts';
import { oracles } from './oracles.ts';
import { allocations, policies, visibilities } from './rules.ts';
import { worlds } from './world.ts';
import { buildReport, writeIndex } from './report.ts';
import { claudeComplete, generateSpace, checkSpace } from './new-space.ts';
import { loadSpace, spaceIds, spaceToYaml } from './spaces.ts';

const args = process.argv.slice(2);
const save = args.includes('--save');
const seedsArg = args.indexOf('--seeds');
const seeds = seedsArg >= 0 ? Number(args[seedsArg + 1]) : undefined;
const sets: Record<string, unknown> = {};
args.forEach((a, i) => {
  if (a !== '--set') return;
  const [path, ...rest] = (args[i + 1] ?? '').split('=');
  const text = rest.join('=');
  try { sets[path] = JSON.parse(text); } catch { sets[path] = text; }
});
const skip = new Set<number>();
args.forEach((a, i) => { if (a === '--seeds' || a === '--set') skip.add(i + 1); });
const target = args.find((a, i) => !a.startsWith('--') && !skip.has(i));
const simDir = new URL('.', import.meta.url).pathname;
const resultsDir = join(simDir, 'results');
const experimentIds = readdirSync(join(simDir, 'experiments')).filter((f) => f.endsWith('.yaml')).map((f) => f.slice(0, -5)).sort();

const second = args.filter((a, i) => !a.startsWith('--') && !skip.has(i))[1];

if (target === 'spaces') {
  console.log('Problem spaces (sim/spaces/):');
  for (const id of spaceIds()) {
    const s = loadSpace(id);
    console.log(`  ${id.padEnd(20)} ${s.spec.title}: ${s.spec.summary}`);
  }
  process.exit(0);
}

if (target === 'check') {
  if (!second) throw new Error('usage: npm run sim -- check <space or file.yaml>');
  const path = second.includes('/') || second.endsWith('.yaml') ? second : join(simDir, 'spaces', `${second}.yaml`);
  const space = checkSpace(readFileSync(path, 'utf8'));
  console.log(`${space.spec.id}: valid, and a test run works.`);
  process.exit(0);
}

if (target === 'report') {
  if (!second) throw new Error('usage: npm run sim -- report <space | all> [--seeds N]');
  const ids = second === 'all' ? spaceIds() : [second];
  for (const id of ids) {
    console.log(`Report for ${id}:`);
    const h = buildReport(loadSpace(id), seeds ?? 100, console.log);
    console.log(`  ${h.verdict}: level ${h.oso.frontier.toFixed(1)} (OSO) vs ${h.traditional.frontier.toFixed(1)} (traditional) of ${h.maxLevel}; written to sim/reports/${id}/report.md`);
  }
  writeIndex();
  process.exit(0);
}

if (target === 'new') {
  if (!second) throw new Error('usage: npm run sim -- new "<description of the field>" [--report] [--seeds N]');
  const space = await generateSpace(second, claudeComplete(), { log: console.log });
  const path = join(simDir, 'spaces', `${space.spec.id}.yaml`);
  if (existsSync(path)) throw new Error(`sim/spaces/${space.spec.id}.yaml already exists; rename the generated id or remove the old file`);
  writeFileSync(path, spaceToYaml(space.spec));
  console.log(`Wrote sim/spaces/${space.spec.id}.yaml: ${space.spec.title}. Budget X = ${space.scenario.budget.X}.`);
  if (args.includes('--report')) {
    const h = buildReport(space, seeds ?? 100, console.log);
    console.log(`  ${h.verdict}; written to sim/reports/${space.spec.id}/report.md`);
  } else {
    console.log(`Next: npm run sim -- report ${space.spec.id}`);
  }
  process.exit(0);
}

if (target === 'plugins') {
  for (const [name, reg] of [['World generators (world.kind)', worlds], ['Success oracles (success.oracle.kind)', oracles],
    ['Deciders (behaviour.decider.kind, agents.deciders.<archetype>.kind)', deciders],
    ['Visibility rules (rules.visibility.kind)', visibilities], ['Compute allocation (budget.allocation.kind)', allocations],
    ['Choice policies for the formula decider (behaviour.policy.kind)', policies]] as const) {
    console.log(`\n${name}`);
    for (const p of reg.describe()) console.log(`  ${p.kind.padEnd(16)} ${p.description}\n${' '.repeat(19)}parameters: ${JSON.stringify(p.defaults)}`);
  }
  console.log(`\nTable columns (columns:)\n  ${Object.keys(COLUMNS).join(', ')}`);
  console.log(`\nAnalyses (analysis:)\n  ${Object.keys(analyses).join(', ')}`);
  process.exit(0);
}

if (!target) {
  console.log('Usage: npm run sim -- <experiment | file.yaml | all> [--seeds N] [--set path=value] [--save]\n       npm run sim -- plugins\n       npm run sim -- spaces | new "<description>" [--report] | check <space> | report <space | all> [--seeds N]\n\nExperiments (sim/experiments/):');
  for (const id of experimentIds) {
    const e = loadExperiment(id);
    console.log(`  ${id.padEnd(12)} ${e.title} (${e.seeds} seeds)`);
  }
  process.exit(0);
}

function git() {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: simDir }).trim();
    const dirty = execSync('git status --porcelain -- .', { encoding: 'utf8', cwd: simDir })
      .split('\n').filter((l) => l && !l.includes('results/')).length > 0;
    return { commit, dirty };
  } catch {
    return { commit: 'unknown', dirty: true };
  }
}

function markdownTable(rows: Output['table']): string {
  const cols = Object.keys(rows[0] ?? {});
  const line = (cells: unknown[]) => `| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(cols), line(cols.map(() => '---')), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}

function runOne(spec: ExperimentSpec) {
  const n = seeds ?? spec.seeds;
  const withSets = Object.keys(sets).length ? { ...spec, set: { ...(spec.set ?? {}), ...sets } } : spec;
  const started = Date.now();
  const out = runExperiment(withSets, n);
  console.log(`\n${spec.title} (${n} seeds, ${((Date.now() - started) / 1000).toFixed(1)}s)\n${spec.description}\n`);
  if (Object.keys(sets).length) console.log(`Overrides: ${JSON.stringify(sets)}\n`);
  console.table(out.table);
  if (!save) return;

  const { commit, dirty } = git();
  const date = new Date().toISOString().slice(0, 10);
  const setText = Object.entries(sets).map(([k, v]) => ` --set ${k}=${JSON.stringify(v)}`).join('');
  const command = `npm run sim -- ${spec.id} --seeds ${n}${setText} --save`;
  const dir = join(resultsDir, spec.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ experiment: spec.id, date, commit, dirty, command, seeds: n, overrides: sets, config: out.config }, null, 2) + '\n');
  writeFileSync(join(dir, 'runs.jsonl'), out.runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(dir, 'summary.md'), [
    `# ${spec.title}`,
    '',
    spec.description,
    '',
    `- **Date:** ${date}`,
    `- **Code:** commit \`${commit}\`${dirty ? ' (with uncommitted changes to the simulator)' : ''}`,
    `- **Experiment:** [sim/experiments/${spec.id}.yaml](../../experiments/${spec.id}.yaml)`,
    `- **Command:** \`${command}\``,
    `- **Runs:** ${out.runs.length} (${n} seeds per row), in \`runs.jsonl\`; the full configuration in \`config.json\``,
    '',
    spec.analysis === 'simple-chain-exact'
      ? 'Values are mean ± standard error, so they can be compared with the exact values.'
      : 'Values are mean ± standard deviation over seeds.',
    '',
    markdownTable(out.table),
    '',
  ].join('\n'));
  const log = join(resultsDir, 'LOG.md');
  if (!existsSync(log)) {
    writeFileSync(log, '# Simulation log\n\nOne line per saved experiment, newest last. Findings are discussed in [../README.md](../README.md#5-results).\n\n| Date | Experiment | Commit | Seeds | Command |\n| --- | --- | --- | --- | --- |\n');
  }
  appendFileSync(log, `| ${date} | [${spec.id}](${spec.id}/summary.md) | \`${commit}\`${dirty ? ' (uncommitted changes)' : ''} | ${n} | \`${command}\` |\n`);
  console.log(`Saved to sim/results/${spec.id}/ (commit ${commit}${dirty ? ', uncommitted changes' : ''}).`);
}

const specs = target === 'all' ? experimentIds.map(loadExperiment) : [loadExperiment(target)];
for (const spec of specs) runOne(spec);
