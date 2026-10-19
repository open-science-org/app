// The canonical report for a problem space (specification, section 8). Every space gets the same
// experiments (battery.ts) and the same report: a headline, the space, progress for the money, the
// six settings, whether flow-back makes agents share, robustness, limits, and how to reproduce.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { battery, KNOWLEDGE_LEVELS } from './battery.ts';
import { runExperiment, type Output } from './experiment.ts';
import { lineChart, worldFigure } from './figures.ts';
import { mean, sd, type RunResult } from './measures.ts';
import { Rng } from './rng.ts';
import { spaceIds, spaceToYaml, withCalibratedBudget, type Space } from './spaces.ts';
import { worlds } from './world.ts';

const SIM_DIR = new URL('.', import.meta.url).pathname;
export const REPORTS_DIR = join(SIM_DIR, 'reports');

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');
const se = (xs: number[]) => (xs.length > 1 ? sd(xs) / Math.sqrt(xs.length) : 0);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mean frontier (hardest level published) at each spend on a common grid. */
function frontierCurve(runs: RunResult[], X: number, steps = 40): [number, number][] {
  return Array.from({ length: steps + 1 }, (_, k) => {
    const x = (X * k) / steps;
    const levels = runs.map((r) => {
      let level = 0;
      for (const c of r.curve) {
        if (c.spend <= x + 1e-9) level = c.level;
        else break;
      }
      return level;
    });
    return [x, mean(levels)] as [number, number];
  });
}

function git() {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: SIM_DIR }).trim();
    const dirty = execSync('git status --porcelain -- .', { encoding: 'utf8', cwd: SIM_DIR })
      .split('\n').filter((l) => l && !l.includes('reports/') && !l.includes('results/') && !l.includes('spaces/')).length > 0;
    return { commit, dirty };
  } catch {
    return { commit: 'unknown', dirty: true };
  }
}

function markdownTable(rows: Record<string, string | number>[]): string {
  const cols = Object.keys(rows[0] ?? {});
  const line = (cells: unknown[]) => `| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(cols), line(cols.map(() => '---')), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}

export interface Headline {
  id: string;
  title: string;
  summary: string;
  verdict: 'OSO ahead' | 'no clear difference' | 'traditional ahead';
  maxLevel: number;
  targetLevel: number;
  targets: number;
  budget: number;
  traditional: { frontier: number; reach: number; cost: number; targetsSolved: number };
  oso: { frontier: number; reach: number; cost: number; targetsSolved: number };
  osoChoice: { frontier: number; sharing: number };
  alphaStar: number | null;
  robustness: { condition: string; osoLead: number }[];
  seeds: number;
  commit: string;
  date: string;
}

function summarize(runs: RunResult[]) {
  const reached = runs.filter((r) => r.speed !== null);
  return {
    frontier: mean(runs.map((r) => r.frontier)),
    frontierSE: se(runs.map((r) => r.frontier)),
    reach: reached.length / runs.length,
    cost: reached.length ? mean(reached.map((r) => r.cost!)) : NaN,
    costSE: se(reached.map((r) => r.cost!)),
    targetsSolved: mean(runs.map((r) => r.targetsSolved)),
    targetsSE: se(runs.map((r) => r.targetsSolved)),
    sharing: mean(runs.map((r) => r.sharingRate)),
  };
}

/** Runs the battery on a space and writes sim/reports/<id>/. Returns the headline numbers. */
export function buildReport(input: Space, seeds = 100, log: (s: string) => void = () => {}, root = REPORTS_DIR): Headline {
  const { space, calibrated } = withCalibratedBudget(input);
  if (calibrated) log(`  calibrated the budget: X = ${space.scenario.budget.X}`);
  const { spec, scenario } = space;
  const g = spec.glossary;
  const outDir = join(root, spec.id);
  mkdirSync(join(outDir, 'figures'), { recursive: true });
  const world = worlds.create(scenario.world, 'world')(scenario.success, new Rng(1).fork(1));

  const outputs: Record<string, Output> = {};
  for (const exp of battery(space, seeds)) {
    const t0 = Date.now();
    outputs[exp.id] = runExperiment(exp, seeds);
    log(`  ${exp.title}: ${outputs[exp.id].rows.length} rows × ${seeds} runs (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  const settings = outputs.settings;
  const byLabel = (o: Output, labels: Record<string, string | number>) => {
    const i = o.rows.findIndex((r) => Object.entries(labels).every(([k, v]) => r.labels[k] === v));
    if (i < 0) throw new Error(`report: no row ${JSON.stringify(labels)}`);
    return o.results[i];
  };
  const trad = summarize(byLabel(settings, { setting: 'Traditional' }));
  const oso = summarize(byLabel(settings, { setting: 'OSO (immediate)' }));
  const choice = summarize(byLabel(settings, { setting: 'OSO (choice)' }));
  const X = scenario.budget.X;
  const L = scenario.measures.targetLevel;
  const T = world.targets.length;

  const diff = oso.frontier - trad.frontier;
  const margin = 2 * Math.hypot(oso.frontierSE, trad.frontierSE);
  const tdiff = oso.targetsSolved - trad.targetsSolved;
  const tmargin = 2 * Math.hypot(oso.targetsSE, trad.targetsSE);
  // Cost counts only when both reach the main level in nearly every run; otherwise level and targets decide.
  const costComparable = oso.reach >= 0.9 && trad.reach >= 0.9;
  const cdiff = costComparable ? trad.cost - oso.cost : 0;
  const cmargin = 2 * Math.hypot(oso.costSE, trad.costSE);
  const ahead = [diff > margin, tdiff > tmargin, cdiff > cmargin].some(Boolean);
  const behind = [diff < -margin, tdiff < -tmargin, cdiff < -cmargin].some(Boolean);
  const verdict: Headline['verdict'] = ahead && !behind ? 'OSO ahead' : behind && !ahead ? 'traditional ahead' : 'no clear difference';

  // α sweep: sharing and reach by α; α* is the highest α at which sharing rises 0.2 above α = 1.
  const alpha = outputs.alpha;
  const alphaPoints = alpha.rows.map((r, i) => ({ alpha: Number(r.labels['α']), ...summarize(alpha.results[i]) }));
  const base = alphaPoints.find((p) => p.alpha === 1)!;
  const alphaStar = alphaPoints.filter((p) => p.alpha < 1 && p.sharing >= base.sharing + 0.2).map((p) => p.alpha).sort((a, b) => b - a)[0] ?? null;

  // Robustness: OSO's frontier lead under each condition of knowledge.
  const rob = outputs.robustness;
  const robustness = KNOWLEDGE_LEVELS.map((k) => {
    const t = summarize(byLabel(rob, { knowledge: k.label, setting: 'Traditional' }));
    const o = summarize(byLabel(rob, { knowledge: k.label, setting: 'OSO (immediate)' }));
    return { condition: k.label, traditional: t, oso: o, osoLead: o.frontier - t.frontier };
  });

  // Figures.
  const curveRuns = (label: string) => byLabel(settings, { setting: label });
  writeFileSync(join(outDir, 'figures', 'frontier.svg'), lineChart({
    title: `How far each community got for the money: ${spec.title}`,
    subtitle: `Mean hardest level published, by compute spent (${seeds} runs per setting). Higher is better.`,
    xLabel: 'Compute spent', yLabel: 'Hardest level published',
    series: [
      { name: 'OSO (immediate)', slot: 1, points: frontierCurve(curveRuns('OSO (immediate)'), X) },
      { name: 'Traditional', slot: 2, points: frontierCurve(curveRuns('Traditional'), X) },
      { name: 'OSO (choice)', slot: 3, points: frontierCurve(curveRuns('OSO (choice)'), X) },
    ],
    x: [0, X], y: [0, world.levels],
    xTicks: [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(X * t)),
    yTicks: Array.from({ length: world.levels + 1 }, (_, i) => i),
    format: { y: (v) => v.toFixed(1).replace(/\.0$/, ''), x: (v) => String(Math.round(v)) },
  }));
  writeFileSync(join(outDir, 'figures', 'alpha.svg'), lineChart({
    title: 'Does flow-back make agents share?',
    subtitle: `Agents choose whether to publish each intermediate result. Lower α: more value flows back to what a result built on.`,
    xLabel: 'α (share of value a result keeps)', yLabel: 'Share',
    series: [
      { name: 'Results shared', slot: 1, points: alphaPoints.map((p) => [p.alpha, p.sharing]) },
      { name: `Runs reaching level ${L}`, slot: 2, points: alphaPoints.map((p) => [p.alpha, p.reach]) },
    ],
    x: [0.1, 1], y: [0, 1], reverseX: true, markers: true,
    xTicks: [1, 0.8, 0.6, 0.4, 0.2], yTicks: [0, 0.25, 0.5, 0.75, 1],
    format: { y: (v) => `${Math.round(v * 100)}%`, x: (v) => String(v) },
  }));
  writeFileSync(join(outDir, 'figures', 'world.svg'), worldFigure(world, `The research tree: ${spec.title}`, spec.areas));

  const { commit, dirty } = git();
  const date = new Date().toISOString().slice(0, 10);
  const headline: Headline = {
    id: spec.id, title: spec.title, summary: spec.summary, verdict, maxLevel: world.levels, targetLevel: L, targets: T, budget: X,
    traditional: { frontier: trad.frontier, reach: trad.reach, cost: trad.cost, targetsSolved: trad.targetsSolved },
    oso: { frontier: oso.frontier, reach: oso.reach, cost: oso.cost, targetsSolved: oso.targetsSolved },
    osoChoice: { frontier: choice.frontier, sharing: choice.sharing },
    alphaStar, robustness: robustness.map((r) => ({ condition: r.condition, osoLead: r.osoLead })),
    seeds, commit: dirty ? `${commit}+` : commit, date,
  };

  const costLine = (s: typeof trad, name: string) =>
    s.reach > 0 ? `${name} ${Math.round(s.cost)} compute${s.reach < 1 ? ` (in the ${pct(s.reach)} of runs that got there)` : ''}` : `${name} never got there`;
  const verdictText = {
    'OSO ahead': 'For the same money, the OSO community got further, or got there more cheaply, than the traditional one.',
    'no clear difference': 'For the same money, there is no clear difference between the two communities.',
    'traditional ahead': 'For the same money, the traditional community got further, or got there more cheaply, than the OSO one.',
  }[verdict];
  const deadEnds = world.deadEnd.filter(Boolean).length;
  const levelsTable = Array.from({ length: world.levels }, (_, i) => i + 1).map((l) => {
    const rs = [...Array(world.n).keys()].filter((r) => world.level[r] === l);
    return { level: l, results: rs.length, targets: rs.filter((r) => world.isTarget[r]).length, 'success chance per attempt': pct(mean(rs.map((r) => world.p[r]))) };
  });
  const targetsTable = world.targets.map((t, k) => ({ target: world.names?.[t] ?? `T${k + 1}`, level: world.level[t], bounty: world.bounty[t], 'results it rests on': world.ancestors[t].size }));

  const settingsTable = settings.table.map((r) => r);
  const alphaTable = alphaPoints.map((p) => ({ α: p.alpha, 'intermediate results shared': pct(p.sharing), frontier: f1(p.frontier), [`reach level ${L}`]: pct(p.reach), 'targets solved': f1(p.targetsSolved) }));
  const robTable = robustness.map((r) => ({
    'shared knowledge': r.condition,
    'traditional frontier': f1(r.traditional.frontier), 'OSO frontier': f1(r.oso.frontier), 'OSO lead': (r.osoLead >= 0 ? '+' : '') + f1(r.osoLead),
    'traditional targets': f1(r.traditional.targetsSolved), 'OSO targets': f1(r.oso.targetsSolved),
  }));
  const weakest = robustness.reduce((a, b) => (b.osoLead < a.osoLead ? b : a));

  const verdictRule = `The verdict compares the hardest level reached, the targets solved and (when both communities reach level ${L} in at least 90% of runs) the cost to get there, each against two standard errors.`;
  const md = `# ${spec.title}: OSO vs. traditional research

> ${spec.summary}

**${verdictText}**

- **How far:** with a budget of ${X} compute, OSO reached level **${f1(oso.frontier)}** of ${world.levels} on average; traditional research reached **${f1(trad.frontier)}**.
- **Targets solved:** OSO solved **${f1(oso.targetsSolved)}** of ${T}; traditional solved **${f1(trad.targetsSolved)}**.
- **Cost to reach level ${L}:** ${costLine(oso, 'OSO')}; ${costLine(trad, 'traditional')}.
- **Does flow-back make agents share?** ${alphaStar !== null ? `When agents choose, sharing rises clearly (by 0.2 or more) once α is ${alphaStar} or lower.` : 'When agents choose, sharing does not rise clearly (by 0.2) for any α down to 0.1.'} At OSO's default α = 0.8, agents shared ${pct(choice.sharing)} of their intermediate results.
- **Robustness:** OSO's lead in level is ${weakest.osoLead >= 0 ? 'smallest' : 'reversed'} when shared knowledge is **${weakest.condition}** (${weakest.osoLead >= 0 ? '+' : ''}${f1(weakest.osoLead)} levels).

*${verdictRule} ${seeds} simulated runs per setting · simulator commit \`${headline.commit}\` · ${date}. This is a simulation with guessed parameters, not evidence about real research; see [What this shows](#what-this-shows-and-what-it-does-not).*

## 1. The problem space

${spec.description}

| In this space | means |
| --- | --- |
| a result | ${g.result} |
| a target | ${g.target} |
| an attempt | ${g.attempt} |
${g.area ? `| an area | ${g.area} |\n` : ''}${g.agent ? `| an agent | ${g.agent} |\n` : ''}
![The research tree](figures/world.svg)

The tree has ${world.n} results in ${world.levels} levels${spec.areas?.length ? ` and ${spec.areas.length} areas (${spec.areas.join(', ')})` : ''}. ${deadEnds} are dead ends: no target depends on them. ${world.targets.length} are targets:

${markdownTable(targetsTable)}

How hard each level is, before an agent's skill:

${markdownTable(levelsTable)}

The community has ${Object.values(scenario.agents.mix).reduce((a, b) => a + b, 0)} agents (${Object.entries(scenario.agents.mix).filter(([, n]) => n > 0).map(([a, n]) => `${n} ${a}`).join(', ')}) and a budget of ${X} compute over ${scenario.budget.rounds ?? '–'} rounds${calibrated ? ' (calibrated: the smallest budget at which OSO solves about 90% of the targets)' : ''}.

## 2. Progress for the money

![Hardest level published by compute spent](figures/frontier.svg)

Each line is the mean, over ${seeds} runs, of the hardest level the community had published after spending that much compute. A line that ends early means every target was solved and the funder stopped paying.

## 3. The six settings

The rules are the only difference between rows ([specification, section 3](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md#3-the-rules)). Traditional: nothing flows back to what a result built on, and work is published only when finished. OSO: value flows back (α = 0.8, c = 0.15), and results are published at once or when the agent chooses.

${markdownTable(settingsTable)}

Values are mean ± standard deviation over runs. *frontier*: hardest level published; *reach L${L}*: share of runs reaching level ${L}; *speed*, *cost*: rounds and compute to reach it; *credit*: how closely bounty pay matches true contribution; *sharing*: share of intermediate results published as soon as they were proved.

## 4. Does flow-back make agents share?

![Sharing and reach by α](figures/alpha.svg)

${markdownTable(alphaTable)}

${alphaStar !== null ? `Sharing rises clearly once α is ${alphaStar} or lower: this is the threshold α* in this space.` : 'Sharing does not rise clearly for any α in this range: in this space, flow-back alone does not make agents share.'} The threshold depends on the scoop risk ψ = ${scenario.behaviour.psi}, which is a guess.

## 5. When sharing is costly or sometimes wrong

Absorbing a published result costs 0.5 compute; proofs are wrong 10% of the time, results built on a wrong result are wrong too, and targets reveal and retract them.

${markdownTable(robTable)}

## What this shows and what it does not

- **It is a simulation** of the [OSO demo specification](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md): results are abstract, success is chance, and agents follow a formula. It shows how the incentive rules play out *if* this space works as described, not that it does.
- **The parameters are guesses,** especially the success chances, the scoop risk ψ, and the costs and error rates in section 5.
- **By default, sharing is free and always correct,** which favours OSO; section 5 shows how much of the lead survives without that.
${spec.notes ? `- **Notes for this space:** ${spec.notes}\n` : ''}
## Reproduce

\`\`\`sh
npm run sim -- report ${spec.id} --seeds ${seeds}
\`\`\`

The space is [sim/spaces/${spec.id}.yaml](../../spaces/${spec.id}.yaml)${spec.source ? ` (${spec.source})` : ''}. Every number above is in [data.json](data.json). Generated by the OSO simulator at commit \`${headline.commit}\`${dirty ? ' (with uncommitted changes)' : ''}.
`;
  writeFileSync(join(outDir, 'report.md'), md);
  writeFileSync(join(outDir, 'space.yaml'), spaceToYaml(spec));
  writeFileSync(join(outDir, 'data.json'), JSON.stringify({
    headline,
    settings: settings.table, alpha: alphaTable, robustness: robTable,
    curves: Object.fromEntries(['Traditional', 'OSO (immediate)', 'OSO (choice)'].map((l) => [l, frontierCurve(curveRuns(l), X)])),
    world: { results: world.n, levels: world.levels, targets: T, deadEnds },
  }, null, 1) + '\n');
  writeIndex(root);
  return headline;
}

/** sim/reports/README.md: every space with its headline numbers. */
export function writeIndex(root = REPORTS_DIR): void {
  if (!existsSync(root)) return;
  // In the repository's reports folder, list only reports whose space still exists.
  const known = root === REPORTS_DIR ? new Set(spaceIds()) : null;
  const heads: Headline[] = readdirSync(root)
    .filter((d) => existsSync(join(root, d, 'data.json')) && (!known || known.has(d)))
    .map((d) => (JSON.parse(readFileSync(join(root, d, 'data.json'), 'utf8')) as { headline: Headline }).headline)
    .sort((a, b) => a.title.localeCompare(b.title));
  const rows = heads.map((h) => ({
    'problem space': `[${h.title}](${h.id}/report.md)`,
    verdict: cap(h.verdict),
    'level reached (OSO / traditional)': `${f1(h.oso.frontier)} / ${f1(h.traditional.frontier)} of ${h.maxLevel}`,
    'targets solved (OSO / traditional)': `${f1(h.oso.targetsSolved)} / ${f1(h.traditional.targetsSolved)} of ${h.targets}`,
    'α*': h.alphaStar ?? '–',
    runs: h.seeds,
    date: h.date,
  }));
  writeFileSync(join(root, 'README.md'), `# Problem-space reports

Every problem space in [sim/spaces/](../spaces/) gets the same canonical report: the same experiments, the same sections, the same figures. Add a space by hand or with \`npm run sim -- new "<description>"\`, then \`npm run sim -- report <id>\`.

**α\\*** is the highest α at which agents who choose clearly share more (by 0.2) than at α = 1; "–" means not within α ≥ 0.1.

${rows.length ? markdownTable(rows) : 'No reports yet.'}
`);
}

export { f2 };
