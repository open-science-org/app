// Builds seed/peft.json, the seed field's works and citation links: `npm run import`.
//
// Curated slice: the works in seed/curated.json, with metadata and dates from the arXiv API and
// references from Semantic Scholar. The importer stops if a fetched title does not match.
// Read-only tier: works cited by at least MIN_CITED curated works, from Semantic Scholar.
//
// Set S2_API_KEY for higher Semantic Scholar rate limits; without it, requests are retried with backoff.
// OpenAlex is not used for this field: in October 2026 its record for LoRA's arXiv DOI carried another
// paper's title and its QLoRA record had no references (docs/decisions.md).
import { readFileSync, writeFileSync } from 'node:fs';

const MIN_CITED = Number(process.env.MIN_CITED ?? 3);
const S2 = 'https://api.semanticscholar.org/graph/v1';
const FIELDS = 'paperId,externalIds,title,abstract,publicationDate,year,authors,citationCount,venue,references.paperId';

interface Curated { arxiv: string; title: string }
interface S2Paper {
  paperId: string;
  externalIds?: Record<string, string>;
  title: string;
  abstract?: string | null;
  publicationDate?: string | null;
  year?: number | null;
  authors?: { name: string }[];
  citationCount?: number;
  venue?: string;
  references?: { paperId: string | null }[];
}
interface ArxivEntry { id: string; title: string; summary: string; published: string; authors: string[] }

export interface SeedWork {
  key: string;
  tier: 'curated' | 'read-only';
  title: string;
  abstract: string;
  authors: string[];
  date: string;
  date_precision: 'day' | 'year';
  type: 'paper' | 'preprint';
  venue: string;
  citation_count: number;
  external_ids: Record<string, string>;
  references: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

async function fetchRetry(url: string, init: RequestInit = {}, tries = 8): Promise<Response> {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status < 500) return res;
    const wait = 2_000 * 2 ** i;
    console.error(`  ${res.status} from ${new URL(url).host}; retrying in ${wait / 1000}s`);
    await sleep(wait);
  }
  throw new Error(`gave up on ${url}`);
}

async function s2Batch(ids: string[]): Promise<(S2Paper | null)[]> {
  const out: (S2Paper | null)[] = [];
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.S2_API_KEY) headers['x-api-key'] = process.env.S2_API_KEY;
  for (let i = 0; i < ids.length; i += 100) {
    const res = await fetchRetry(`${S2}/paper/batch?fields=${FIELDS}`, {
      method: 'POST', headers, body: JSON.stringify({ ids: ids.slice(i, i + 100) }),
    });
    if (!res.ok) throw new Error(`Semantic Scholar: ${res.status} ${await res.text()}`);
    out.push(...((await res.json()) as (S2Paper | null)[]));
    await sleep(1_100);
  }
  return out;
}

async function arxivEntries(ids: string[]): Promise<Map<string, ArxivEntry>> {
  const map = new Map<string, ArxivEntry>();
  const text = (s: string) => s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < ids.length; i += 50) {
    const url = `https://export.arxiv.org/api/query?id_list=${ids.slice(i, i + 50).join(',')}&max_results=50`;
    const xml = await (await fetchRetry(url)).text();
    for (const entry of xml.split('<entry>').slice(1)) {
      const get = (tag: string) => text((entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [])[1] ?? '');
      const id = get('id').replace(/^.*\/abs\//, '').replace(/v\d+$/, '');
      const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => text(m[1]));
      map.set(id, { id, title: get('title'), summary: get('summary'), published: get('published').slice(0, 10), authors });
    }
    await sleep(3_000); // arXiv asks for one request every three seconds
  }
  return map;
}

function externalIds(p: S2Paper): Record<string, string> {
  const ids: Record<string, string> = { s2: p.paperId };
  if (p.externalIds?.ArXiv) ids.arxiv = p.externalIds.ArXiv;
  if (p.externalIds?.DOI) ids.doi = p.externalIds.DOI.toLowerCase();
  return ids;
}

async function main() {
  const curated = (JSON.parse(readFileSync('seed/curated.json', 'utf8')) as { works: Curated[] }).works;
  console.log(`Fetching ${curated.length} curated works from arXiv and Semantic Scholar…`);
  const arxiv = await arxivEntries(curated.map((c) => c.arxiv));
  const s2 = await s2Batch(curated.map((c) => `ARXIV:${c.arxiv}`));

  const problems: string[] = [];
  const works = new Map<string, SeedWork>();
  const papers = new Map<string, S2Paper>();
  curated.forEach((c, i) => {
    const a = arxiv.get(c.arxiv);
    const p = s2[i];
    if (!a) return problems.push(`${c.arxiv}: not found on arXiv`);
    if (norm(a.title) !== norm(c.title)) return problems.push(`${c.arxiv}: arXiv title "${a.title}" ≠ "${c.title}"`);
    if (!p) return problems.push(`${c.arxiv}: not found on Semantic Scholar`);
    if (norm(p.title) !== norm(c.title)) problems.push(`${c.arxiv}: note, Semantic Scholar title is "${p.title}"`);
    papers.set(p.paperId, p);
    works.set(p.paperId, {
      key: p.paperId,
      tier: 'curated',
      title: a.title,
      abstract: a.summary,
      authors: a.authors,
      date: a.published,
      date_precision: 'day',
      type: p.venue && p.venue !== 'arXiv.org' ? 'paper' : 'preprint',
      venue: p.venue || 'arXiv',
      citation_count: p.citationCount ?? 0,
      external_ids: { ...externalIds(p), arxiv: c.arxiv },
      references: [],
    });
  });
  const fatal = problems.filter((p) => !p.includes(': note,'));
  problems.forEach((p) => console.error('  ' + p));
  if (fatal.length) throw new Error(`${fatal.length} curated works failed to match; fix seed/curated.json`);

  // Read-only tier: works the curated slice relies on, cited by at least MIN_CITED curated works.
  const counts = new Map<string, number>();
  for (const p of papers.values()) {
    for (const r of p.references ?? []) if (r.paperId && !works.has(r.paperId)) counts.set(r.paperId, (counts.get(r.paperId) ?? 0) + 1);
  }
  const background = [...counts].filter(([, n]) => n >= MIN_CITED).map(([id]) => id);
  console.log(`Fetching ${background.length} read-only works cited by at least ${MIN_CITED} curated works…`);
  for (const p of await s2Batch(background)) {
    if (!p || !p.title || (!p.publicationDate && !p.year)) continue;
    papers.set(p.paperId, p);
    works.set(p.paperId, {
      key: p.paperId,
      tier: 'read-only',
      title: p.title,
      abstract: p.abstract ?? '',
      authors: (p.authors ?? []).map((x) => x.name),
      date: p.publicationDate ?? `${p.year}-01-01`,
      date_precision: p.publicationDate ? 'day' : 'year',
      type: p.venue && p.venue !== 'arXiv.org' ? 'paper' : 'preprint',
      venue: p.venue || '',
      citation_count: p.citationCount ?? 0,
      external_ids: externalIds(p),
      references: [],
    });
  }

  // Citation links, kept only where both ends are in the seed.
  for (const [id, p] of papers) {
    works.get(id)!.references = [...new Set((p.references ?? []).map((r) => r.paperId).filter((r): r is string => !!r && works.has(r)))].sort();
  }

  const list = [...works.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
  const links = list.reduce((n, w) => n + w.references.length, 0);
  writeFileSync('seed/peft.json', JSON.stringify({
    community: 'peft',
    generated_at: new Date().toISOString().slice(0, 10),
    sources: {
      metadata: 'arXiv API for the curated slice; Semantic Scholar Academic Graph API for the read-only tier',
      references: 'Semantic Scholar Academic Graph API',
      attribution: 'Data from Semantic Scholar (https://www.semanticscholar.org) and arXiv (https://arxiv.org). Thank you to arXiv for use of its open access interoperability.',
    },
    min_cited: MIN_CITED,
    works: list,
  }, null, 1) + '\n');
  console.log(`Wrote seed/peft.json: ${list.filter((w) => w.tier === 'curated').length} curated, ${list.filter((w) => w.tier === 'read-only').length} read-only, ${links} citation links.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
