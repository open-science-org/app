// Draws one simulated world as an SVG: `node sim/draw-world.ts [seed] [scenario] > world.svg`.
import { loadScenario } from './config.ts';
import { Rng } from './rng.ts';
import { worlds } from './world.ts';

const seed = Number(process.argv[2] ?? 1);
const sc = loadScenario(process.argv[3] ?? null);
const w = worlds.create(sc.world, 'world')(sc.success, new Rng(seed).fork(1));
const perLevel: number[][] = [];
for (let r = 0; r < w.n; r++) (perLevel[w.level[r]] ??= []).push(r);
const width = Math.max(...perLevel.filter(Boolean).map((l) => l.length));
const colW = 130, rowH = 46, left = 90, top = 90;
const x = (r: number) => left + (w.level[r] - 1) * colW;
const y = (r: number) => top + perLevel[w.level[r]].indexOf(r) * rowH;
const areaColor = ['#2f6f5e', '#2563eb', '#a16207', '#7c3aed', '#c2410c'];
const W = left + (w.levels - 1) * colW + 120, H = top + width * rowH + 120;
const out: string[] = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif" font-size="12">`);
out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
out.push(`<text x="20" y="32" font-size="18" font-weight="700">One simulated world (seed ${seed}): ${w.n} results, ${w.targets.length} targets, ${w.deadEnd.filter(Boolean).length} dead ends</text>`);
out.push(`<text x="20" y="54" fill="#5f5d58">Columns are levels (harder to the right). Lines join a result to its prerequisites. Colour = area; grey = dead end (no target depends on it); stars = targets with bounties.</text>`);
for (let l = 1; l <= w.levels; l++) {
  const r0 = perLevel[l]?.[0];
  if (r0 === undefined) continue;
  out.push(`<text x="${left + (l - 1) * colW}" y="${top - 22}" text-anchor="middle" font-weight="700">level ${l}</text>`);
  out.push(`<text x="${left + (l - 1) * colW}" y="${top - 8}" text-anchor="middle" fill="#5f5d58">p = ${(w.p[r0] * 100).toFixed(1)}%</text>`);
}
for (let r = 0; r < w.n; r++) for (const j of w.prereqs[r]) {
  const useful = !w.deadEnd[r];
  out.push(`<line x1="${x(j)}" y1="${y(j)}" x2="${x(r)}" y2="${y(r)}" stroke="${useful ? '#9a968e' : '#e4e1db'}" stroke-width="${useful ? 1.2 : 0.8}"/>`);
}
for (let r = 0; r < w.n; r++) {
  const fill = w.deadEnd[r] ? '#d6d2ca' : areaColor[w.area[r] % areaColor.length];
  if (w.isTarget[r]) {
    const s = 13, cx = x(r), cy = y(r);
    const pts = Array.from({ length: 10 }, (_, k) => {
      const a = -Math.PI / 2 + (k * Math.PI) / 5, rad = k % 2 ? s * 0.45 : s;
      return `${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`;
    }).join(' ');
    out.push(`<polygon points="${pts}" fill="${fill}" stroke="#1d1c1a" stroke-width="1.2"/>`);
    out.push(`<text x="${cx}" y="${cy + 26}" text-anchor="middle" font-weight="700">B=${w.bounty[r]}</text>`);
  } else {
    out.push(`<circle cx="${x(r)}" cy="${y(r)}" r="8" fill="${fill}"/>`);
  }
}
const ly = H - 40;
[['area 1', areaColor[0]], ['area 2', areaColor[1]], ['area 3', areaColor[2]], ['dead end', '#d6d2ca']].forEach(([label, c], k) => {
  out.push(`<circle cx="${30 + k * 110}" cy="${ly}" r="7" fill="${c}"/><text x="${42 + k * 110}" y="${ly + 4}">${label}</text>`);
});
out.push(`<text x="${30 + 4 * 110}" y="${ly + 4}">★ target (bounty B)</text>`);
out.push('</svg>');
console.log(out.join('\n'));
