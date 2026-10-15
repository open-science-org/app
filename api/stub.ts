// The offline `stub` AI provider (ai.config.json): answers built from the graph alone.
import type { Message } from './ai.ts';

/** Offline answers built from the graph sources in the system prompt, so chat works without a model. */
export function stubAnswer(_task: string, messages: Message[]): string {
  const lines = messages[0].content.split('\n').filter((l) => /^\[\d+\] /.test(l));
  const sources = lines.map((l) => {
    const m = /^\[(\d+)\] (.+?) \((\d{4});.*\) — (.+)$/.exec(l)!;
    return { n: m[1], title: m[2], year: m[3], relation: m[4] };
  });
  const [self, ...rest] = sources;
  const builds = rest.filter((x) => x.relation.startsWith('the idea builds on')).map((x) => `[${x.n}] ${x.title} ${x.relation.replace('the idea builds on this ', '')}`);
  const children = rest.filter((x) => x.relation === 'builds on the idea').map((x) => `[${x.n}] ${x.title}`);
  const cited = rest.filter((x) => x.relation === 'cited by the idea').slice(0, 4).map((x) => `[${x.n}] ${x.title}`);
  const citing = rest.filter((x) => x.relation === 'cites the idea').slice(0, 4).map((x) => `[${x.n}] ${x.title}`);
  return [
    `[${self.n}] ${self.title} (${self.year}).`,
    builds.length ? `It builds on ${builds.join('; ')}.` : '',
    !builds.length && cited.length ? `It cites ${cited.join('; ')}.` : '',
    children.length ? `Ideas that build on it: ${children.join('; ')}.` : '',
    !children.length && citing.length ? `Works that cite it: ${citing.join('; ')}.` : '',
    '(Offline stub: this answer comes from the graph only. Set a chat provider in ai.config.json for real answers.)',
  ].filter(Boolean).join(' ');
}
