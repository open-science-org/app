// Runs the model over many seeds and prints the measures: `npm run sim -- [--seeds 40] [--sweep]`.
import { run, type RunResult } from './model.ts';
import { BASE, SETTINGS } from './settings.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const seeds = flag('seeds', 40);
const firstSeed = flag('seed', 1);

function stats(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1));
  return { mean, sd };
}

function runMany(rules: (typeof SETTINGS)[string]['rules']): RunResult[] {
  return Array.from({ length: seeds }, (_, k) => run({ ...BASE, rules, seed: firstSeed + k }));
}

const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const ms = (xs: number[], d = 2) => {
  const { mean, sd } = stats(xs);
  return `${fmt(mean, d)} ±${fmt(sd, d)}`;
};

function row(label: string, rs: RunResult[]) {
  const reached = rs.filter((r) => r.speed !== null);
  return {
    setting: label,
    frontier: ms(rs.map((r) => r.frontier), 1),
    [`reach L${BASE.targetLevel}`]: fmt(reached.length / rs.length),
    speed: reached.length ? ms(reached.map((r) => r.speed!), 0) : '–',
    cost: reached.length ? ms(reached.map((r) => r.cost!), 0) : '–',
    productivity: ms(rs.map((r) => r.productivity * 100), 1),
    breadth: ms(rs.map((r) => r.breadth)),
    waste: ms(rs.map((r) => r.waste)),
    credit: ms(rs.map((r) => r.creditAccuracy)),
    sharing: ms(rs.map((r) => r.sharingRate)),
    hoarded: ms(rs.map((r) => r.hoarded)),
  };
}

console.log(`${seeds} seeds per setting; budget X = ${BASE.X} over ${BASE.T} rounds; productivity is results per 100 units of spend.\n`);
console.table(Object.values(SETTINGS).map((s) => row(s.label, runMany(s.rules))));

if (args.includes('--sweep')) {
  console.log('\nα sweep with visibility = agent\'s choice (c = 0.15; α = 1 uses c = 0):');
  const sweep = [];
  for (let a = 1; a >= 0.099; a -= 0.1) {
    const alpha = Math.round(a * 100) / 100;
    const rs = runMany({ alpha, c: alpha === 1 ? 0 : 0.15, visibility: { kind: 'choice' } });
    sweep.push({ alpha, ...row(`α = ${alpha}`, rs) });
  }
  console.table(sweep.map(({ alpha: _a, ...r }) => r));
}
