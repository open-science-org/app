// Runs named experiments: `npm run sim -- <experiment | all> [--seeds N] [--save]`.
// With --save, results go to sim/results/<experiment>/ and a line is added to sim/results/LOG.md.
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPERIMENTS, type Experiment, type Output } from './experiments.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const name = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--seeds'));
const save = args.includes('--save');
const resultsDir = new URL('./results/', import.meta.url).pathname;

if (!name || (name !== 'all' && !EXPERIMENTS.some((e) => e.id === name))) {
  console.log('Usage: npm run sim -- <experiment | all> [--seeds N] [--save]\n\nExperiments:');
  for (const e of EXPERIMENTS) console.log(`  ${e.id.padEnd(12)} ${e.title} (default ${e.defaultSeeds} seeds)`);
  process.exit(name ? 1 : 0);
}

function git() {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain -- sim ledger', { encoding: 'utf8' })
      .split('\n').filter((l) => l && !l.includes('sim/results/')).length > 0;
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

function runOne(e: Experiment) {
  const seeds = flag('seeds') ?? e.defaultSeeds;
  const started = Date.now();
  const out = e.run(seeds);
  const seconds = (Date.now() - started) / 1000;
  console.log(`\n${e.title} (${seeds} seeds, ${seconds.toFixed(1)}s)\n${e.description}\n`);
  console.table(out.table);
  if (!save) return;

  const { commit, dirty } = git();
  const date = new Date().toISOString().slice(0, 10);
  const command = `npm run sim -- ${e.id} --seeds ${seeds} --save`;
  const dir = join(resultsDir, e.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ experiment: e.id, date, commit, dirty, command, seeds, config: out.config }, null, 2) + '\n');
  writeFileSync(join(dir, 'runs.jsonl'), out.runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(dir, 'summary.md'), [
    `# ${e.title}`,
    '',
    e.description,
    '',
    `- **Date:** ${date}`,
    `- **Code:** commit \`${commit}\`${dirty ? ' (with uncommitted changes to the simulator)' : ''}`,
    `- **Command:** \`${command}\``,
    `- **Runs:** ${out.runs.length} (${seeds} seeds per row), in \`runs.jsonl\`; all parameters in \`config.json\``,
    '',
    'Values are mean ± standard deviation over seeds, except in the simple model, where they are mean ± standard error so they can be compared with the exact values.',
    '',
    markdownTable(out.table),
    '',
  ].join('\n'));
  const log = join(resultsDir, 'LOG.md');
  if (!existsSync(log)) {
    writeFileSync(log, '# Simulation log\n\nOne line per saved experiment, newest last. Findings are discussed in [../README.md](../README.md#results).\n\n| Date | Experiment | Commit | Seeds | Command |\n| --- | --- | --- | --- | --- |\n');
  }
  appendFileSync(log, `| ${date} | [${e.id}](${e.id}/summary.md) | \`${commit}\`${dirty ? ' (uncommitted changes)' : ''} | ${seeds} | \`${command}\` |\n`);
  console.log(`Saved to sim/results/${e.id}/ (commit ${commit}${dirty ? ', uncommitted changes' : ''}).`);
}

for (const e of EXPERIMENTS) if (name === 'all' || e.id === name) runOne(e);
