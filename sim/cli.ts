// Command line for the simulator (sim/README.md, "Running it").
//
//   npm run sim                                     list experiments
//   npm run sim -- <experiment | file.yaml | all>   run, print the table
//     --seeds N        seeds per row (default: the experiment's)
//     --set path=value override any scenario setting for every row (repeatable; value is JSON or text)
//     --save           write sim/results/<id>/ and add a line to sim/results/LOG.md
//   npm run sim -- plugins                          list worlds, visibility rules, allocations, policies, columns
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadExperiment, runExperiment, analyses, type ExperimentSpec, type Output } from './experiment.ts';
import { COLUMNS } from './measures.ts';
import { allocations, policies, visibilities } from './rules.ts';
import { worlds } from './world.ts';

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

if (target === 'plugins') {
  for (const [name, reg] of [['World generators (world.kind)', worlds], ['Visibility rules (rules.visibility.kind)', visibilities],
    ['Compute allocation (budget.allocation.kind)', allocations], ['Choice policies (behaviour.policy.kind)', policies]] as const) {
    console.log(`\n${name}`);
    for (const p of reg.describe()) console.log(`  ${p.kind.padEnd(16)} ${p.description}\n${' '.repeat(19)}parameters: ${JSON.stringify(p.defaults)}`);
  }
  console.log(`\nTable columns (columns:)\n  ${Object.keys(COLUMNS).join(', ')}`);
  console.log(`\nAnalyses (analysis:)\n  ${Object.keys(analyses).join(', ')}`);
  process.exit(0);
}

if (!target) {
  console.log('Usage: npm run sim -- <experiment | file.yaml | all> [--seeds N] [--set path=value] [--save]\n       npm run sim -- plugins\n\nExperiments (sim/experiments/):');
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
