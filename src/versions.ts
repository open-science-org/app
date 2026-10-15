// Builders for OIP-16 idea versions.
import { sha256Hex } from './crypto.ts';
import type { Version } from './state.ts';

export interface Fixture {
  key: string;
  title: string;
  summary: string;
  authors: string[];
  arxiv: string;
  date: string;
  parents: Record<string, number>;
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

/** An imported work: attribution only, no owners (OIP-16 section 9). */
export function importVersion(f: Fixture, registrant: string): Version {
  return {
    ...base(registrant),
    type: 'paper',
    title: f.title,
    abstract: f.summary,
    domain_tags: ['parameter-efficient-fine-tuning'],
    content_refs: [{ role: 'main', hash: '', uri: `https://arxiv.org/abs/${f.arxiv}`, media_type: 'text/html' }],
    attribution: f.authors.map((name) => ({ name, orcid: '' })),
    external_ids: { arxiv: f.arxiv },
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
