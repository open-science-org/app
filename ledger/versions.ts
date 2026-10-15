// Builders for OIP-16 idea versions.
import { sha256Hex } from './crypto.ts';
import type { Version } from './state.ts';

/** One imported work, as written by scripts/import.ts into seed/<community>.json. */
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
  /** Keys of other seed works this one cites. */
  references: string[];
}

function base(registrant: string): Omit<Version, 'type' | 'title' | 'abstract'> {
  return {
    schema: 'oso.idea/1',
    domain_tags: [],
    content_refs: [],
    previous: null,
    parents: [],
    cites: [],
    targets: {},
    license: 'LicenseRef-see-source',
    ai_disclosure: { level: 'none', description: '' },
    owners: [],
    attribution: [],
    external_ids: {},
    registrant,
  };
}

function location(ids: Record<string, string>): string {
  if (ids.arxiv) return `https://arxiv.org/abs/${ids.arxiv}`;
  if (ids.doi) return `https://doi.org/${ids.doi}`;
  return `https://www.semanticscholar.org/paper/${ids.s2}`;
}

/** An imported work: attribution only, no owners (OIP-16 section 9). Citations name works by external ID. */
export function importVersion(w: SeedWork, registrant: string, domainTags: string[] = []): Version {
  return {
    ...base(registrant),
    type: w.type,
    title: w.title.slice(0, 300),
    abstract: w.abstract.slice(0, 5000),
    domain_tags: domainTags,
    content_refs: [{ role: 'main', hash: '', uri: location(w.external_ids), media_type: 'text/html' }],
    cites: w.references.map((key) => ({ external_id: `s2:${key}` })),
    attribution: w.authors.map((name) => ({ name, orcid: '' })),
    external_ids: w.external_ids,
  };
}

export interface SubmissionInput {
  type: string;
  title: string;
  abstract: string;
  content: string;
  parents: { version_id: string; weight_bps: number }[];
  owners: { identity: string; share_bps: number }[];
  attribution: string[];
  registrant: string;
  license?: string;
}

/** A new submission whose main content is the given text, referenced by its SHA-256 (OIP-16 section 5). */
export function submissionVersion(x: SubmissionInput): Version {
  const hash = 'sha256:' + sha256Hex(x.content);
  return {
    ...base(x.registrant),
    type: x.type,
    title: x.title,
    abstract: x.abstract,
    content_refs: [{ role: 'main', hash, uri: `oso:${hash}`, media_type: 'text/markdown' }],
    parents: x.parents,
    cites: x.parents.map((p) => ({ version_id: p.version_id })),
    license: x.license ?? 'CC-BY-4.0',
    owners: x.owners,
    attribution: x.attribution.map((name) => ({ name, orcid: '' })),
  };
}

/**
 * Citation-only suggested weights (OIP-14 sections 5.4 and 6 with λ = 0): each cited candidate gets
 * an equal raw score; candidates are normalized to 10,000 with the residue to the lowest work ID.
 */
export function citationWeights(candidates: string[]): Record<string, number> {
  if (!candidates.length) return {};
  const sorted = [...candidates].sort();
  const each = Math.floor(10_000 / sorted.length);
  const weights = Object.fromEntries(sorted.map((id) => [id, each]));
  weights[sorted[0]] += 10_000 - each * sorted.length;
  return weights;
}
