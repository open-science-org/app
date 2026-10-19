// SVG figures for reports: line charts and the research tree. Self-contained files that follow the
// viewer's light or dark mode. Colours are the validated categorical slots (blue, orange, aqua);
// every line is also labelled at its end, and every point has a tooltip, so colour is never the
// only cue.
import type { World } from './world.ts';

const STYLE = `
  .viz { --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --grid: #e6e5e1;
         --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --dead: #c9c7c0; }
  @media (prefers-color-scheme: dark) {
    .viz { --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --grid: #34332f;
           --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --dead: #4a4945; }
  }
  .bg { fill: var(--surface); }
  text { fill: var(--ink); font-family: Helvetica, Arial, sans-serif; }
  .title { font-size: 16px; font-weight: 700; }
  .sub, .tick, .axis { fill: var(--ink-2); font-size: 12px; }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .base { stroke: var(--ink-2); stroke-width: 1; }
  .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .c1 { stroke: var(--s1); } .f1 { fill: var(--s1); }
  .c2 { stroke: var(--s2); } .f2 { fill: var(--s2); }
  .c3 { stroke: var(--s3); } .f3 { fill: var(--s3); }
  .dot { stroke: var(--surface); stroke-width: 2; }
  .label { font-size: 12px; font-weight: 700; }
`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface Series {
  name: string;
  /** Categorical slot 1-3, fixed per entity across all charts. */
  slot: 1 | 2 | 3;
  points: [number, number][];
}

export interface LineChart {
  title: string;
  subtitle: string;
  xLabel: string;
  yLabel: string;
  series: Series[];
  x: [number, number];
  y: [number, number];
  xTicks: number[];
  yTicks: number[];
  /** Draw x from high (left) to low (right). */
  reverseX?: boolean;
  format?: { x?: (v: number) => string; y?: (v: number) => string };
  /** Show a marker at every point (for sparse data); dense curves get end markers only. */
  markers?: boolean;
}

export function lineChart(c: LineChart): string {
  const W = 760, H = 420, left = 64, right = 190, top = 92, bottom = 56;
  const pw = W - left - right, ph = H - top - bottom;
  const fx = c.format?.x ?? ((v: number) => String(v));
  const fy = c.format?.y ?? ((v: number) => String(v));
  const sx = (v: number) => {
    const t = (v - c.x[0]) / (c.x[1] - c.x[0] || 1);
    return left + (c.reverseX ? 1 - t : t) * pw;
  };
  const sy = (v: number) => top + ph - ((v - c.y[0]) / (c.y[1] - c.y[0] || 1)) * ph;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="viz" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(c.title)}">`);
  out.push(`<style>${STYLE}</style><rect class="bg" width="${W}" height="${H}" rx="8"/>`);
  out.push(`<text class="title" x="${left}" y="30">${esc(c.title)}</text>`);
  out.push(`<text class="sub" x="${left}" y="50">${esc(c.subtitle)}</text>`);
  // Legend, one row above the plot.
  let lx = left;
  for (const s of c.series) {
    out.push(`<line class="line c${s.slot}" x1="${lx}" y1="70" x2="${lx + 18}" y2="70"/><text class="tick" x="${lx + 24}" y="74">${esc(s.name)}</text>`);
    lx += 34 + s.name.length * 6.6;
  }
  for (const t of c.yTicks) {
    out.push(`<line class="grid" x1="${left}" x2="${left + pw}" y1="${sy(t)}" y2="${sy(t)}"/>`);
    out.push(`<text class="tick" x="${left - 8}" y="${sy(t) + 4}" text-anchor="end">${esc(fy(t))}</text>`);
  }
  out.push(`<line class="base" x1="${left}" x2="${left + pw}" y1="${top + ph}" y2="${top + ph}"/>`);
  for (const t of c.xTicks) {
    out.push(`<text class="tick" x="${sx(t)}" y="${top + ph + 18}" text-anchor="middle">${esc(fx(t))}</text>`);
  }
  out.push(`<text class="axis" x="${left + pw / 2}" y="${H - 12}" text-anchor="middle">${esc(c.xLabel)}</text>`);
  out.push(`<text class="axis" transform="translate(16 ${top + ph / 2}) rotate(-90)" text-anchor="middle">${esc(c.yLabel)}</text>`);
  // Lines, then points with tooltips.
  const ends: { y: number; s: Series; last: [number, number] }[] = [];
  for (const s of c.series) {
    if (!s.points.length) continue;
    const d = s.points.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(' ');
    out.push(`<path class="line c${s.slot}" d="${d}"/>`);
    const shown = c.markers ? s.points : [s.points[s.points.length - 1]];
    for (const [x, y] of shown) {
      out.push(`<circle class="dot f${s.slot}" cx="${sx(x).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="4.5"><title>${esc(`${s.name}: ${fy(y)} at ${c.xLabel.toLowerCase()} ${fx(x)}`)}</title></circle>`);
    }
    const last = s.points[s.points.length - 1];
    ends.push({ y: sy(last[1]), s, last });
  }
  // Direct labels at the right, nudged apart so they never overlap.
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
  const labelX = Math.max(...ends.map((e) => sx(e.last[0]))) + 12;
  for (const e of ends) {
    out.push(`<text class="label" x="${labelX}" y="${e.y + 4}">${esc(e.s.name)}: ${esc(fy(e.last[1]))}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

/** The research tree: columns are levels, colour is area, grey is a dead end, stars are targets. */
export function worldFigure(w: World, title: string, areaNames: string[] = []): string {
  const perLevel: number[][] = [];
  for (let r = 0; r < w.n; r++) (perLevel[w.level[r]] ??= []).push(r);
  const width = Math.max(...perLevel.filter(Boolean).map((l) => l.length));
  const colW = Math.max(70, Math.min(130, 900 / Math.max(1, w.levels))), rowH = width > 14 ? 26 : 40;
  const left = 70, top = 96;
  const x = (r: number) => left + (w.level[r] - 1) * colW;
  const y = (r: number) => top + perLevel[w.level[r]].indexOf(r) * rowH;
  const W = left + (w.levels - 1) * colW + 110, H = top + width * rowH + 80;
  // Areas use the categorical slots in fixed order; past three, the legend and tooltips carry identity.
  const slots = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="viz" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}">`);
  out.push(`<style>${STYLE}</style><rect class="bg" width="${W}" height="${H}" rx="8"/>`);
  out.push(`<text class="title" x="20" y="30">${esc(title)}</text>`);
  out.push(`<text class="sub" x="20" y="50">${w.n} results · ${w.targets.length} targets · ${w.deadEnd.filter(Boolean).length} dead ends · columns are levels (deeper to the right); lines join a result to what it builds on</text>`);
  for (let l = 1; l <= w.levels; l++) {
    const r0 = perLevel[l]?.[0];
    if (r0 === undefined) continue;
    out.push(`<text class="tick" x="${left + (l - 1) * colW}" y="${top - 26}" text-anchor="middle">level ${l}</text>`);
    out.push(`<text class="tick" x="${left + (l - 1) * colW}" y="${top - 12}" text-anchor="middle">p ≈ ${(w.p[r0] * 100).toFixed(1)}%</text>`);
  }
  for (let r = 0; r < w.n; r++) for (const j of w.prereqs[r]) {
    out.push(`<line class="grid" style="stroke:${w.deadEnd[r] ? 'var(--grid)' : 'var(--ink-2)'};stroke-opacity:${w.deadEnd[r] ? 1 : 0.45}" x1="${x(j)}" y1="${y(j)}" x2="${x(r)}" y2="${y(r)}"/>`);
  }
  for (let r = 0; r < w.n; r++) {
    const fill = w.deadEnd[r] ? 'var(--dead)' : slots[w.area[r] % slots.length];
    const name = w.names?.[r] ?? `#${r}`;
    const tip = `${name} · level ${w.level[r]} · ${areaNames[w.area[r]] ?? `area ${w.area[r] + 1}`}${w.isTarget[r] ? ` · target, bounty ${w.bounty[r]}` : ''}${w.deadEnd[r] ? ' · dead end' : ''}`;
    if (w.isTarget[r]) {
      const s = 11, cx = x(r), cy = y(r);
      const pts = Array.from({ length: 10 }, (_, k) => {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, rad = k % 2 ? s * 0.45 : s;
        return `${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`;
      }).join(' ');
      out.push(`<polygon points="${pts}" style="fill:${fill};stroke:var(--ink);stroke-width:1.2"><title>${esc(tip)}</title></polygon>`);
      out.push(`<text class="tick" x="${cx}" y="${cy + 24}" text-anchor="middle">${esc(String(w.bounty[r]))}</text>`);
    } else {
      out.push(`<circle cx="${x(r)}" cy="${y(r)}" r="6" style="fill:${fill}"><title>${esc(tip)}</title></circle>`);
    }
  }
  const areas = Math.max(...w.area) + 1;
  let lx = 20;
  const ly = H - 26;
  for (let a = 0; a < Math.min(areas, slots.length); a++) {
    const label = areaNames[a] ?? `area ${a + 1}`;
    out.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="6" style="fill:${slots[a]}"/><text class="tick" x="${lx + 16}" y="${ly}">${esc(label)}</text>`);
    lx += 34 + label.length * 6.6;
  }
  out.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="6" style="fill:var(--dead)"/><text class="tick" x="${lx + 16}" y="${ly}">dead end</text>`);
  out.push(`<text class="tick" x="${lx + 90}" y="${ly}">★ target (number = bounty)</text>`);
  out.push('</svg>');
  return out.join('\n');
}
