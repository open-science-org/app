// Contract tests: every operation in contract/openapi.yaml is called against a development ledger,
// and every response is validated against the contract's schema.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Chain } from '../ledger/chain.ts';
import { AI, loadAIConfig } from './ai.ts';
import { createApp } from './app.ts';
import { devKeys, seedDevLedger } from './demo.ts';
import { stubAnswer } from './stub.ts';

const spec = parse(readFileSync(new URL('../contract/openapi.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema(JSON.parse(JSON.stringify(spec).replaceAll('"#/components/', '"openapi#/components/')), 'openapi');

let server: Server;
let base = '';
let ids: { lora: string; newId: string; ids: Record<string, string> };
const called = new Set<string>();

before(async () => {
  const chain = new Chain(devKeys.operator);
  ids = seedDevLedger(chain);
  const communities = [JSON.parse(readFileSync(new URL('../seed/community-peft.json', import.meta.url), 'utf8'))];
  const app = createApp({ chain, ai: new AI(loadAIConfig(), stubAnswer), dev: true, communities });
  server = createServer((req, res) => void app(req, res));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});

after(() => {
  server.close();
});

/** Finds the contract operation for a concrete path. */
function operation(method: string, path: string) {
  for (const [template, item] of Object.entries<any>(spec.paths)) {
    const re = new RegExp('^' + template.replace(/\{[^}]+\}/g, '[^/]+') + '$');
    if (re.test(path) && item[method]) return { template, op: item[method] };
  }
  throw new Error(`no contract operation for ${method.toUpperCase()} ${path}`);
}

/** Calls the API and checks the response against the contract. */
async function call(method: 'get' | 'post', pathAndQuery: string, body?: unknown, expectStatus = 200): Promise<any> {
  const res = await fetch(base + pathAndQuery, {
    method: method.toUpperCase(),
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const path = pathAndQuery.split('?')[0];
  const { op } = operation(method, path);
  called.add(op.operationId);
  assert.equal(res.status, expectStatus, `${method.toUpperCase()} ${pathAndQuery}: ${res.status} ${await res.clone().text()}`);
  let response = op.responses[String(res.status)];
  if (response.$ref) response = spec.components.responses[response.$ref.split('/').pop()];
  const [type, media] = Object.entries<any>(response.content)[0];
  if (type === 'text/plain') return res.text();
  const data = await res.json();
  const validate = ajv.compile(JSON.parse(JSON.stringify(media.schema).replaceAll('"#/components/', '"openapi#/components/')));
  assert.ok(validate(data), `${op.operationId} ${res.status} does not match the contract: ${ajv.errorsText(validate.errors)}`);
  return data;
}

test('status and transparency', async () => {
  const s = await call('get', '/v1/status');
  assert.equal(s.network, 'oso-dev');
  const t = await call('get', '/v1/transparency');
  assert.ok(t.ledger.trust_assumptions.length > 0);
  assert.equal(t.ai.tasks.chat.provider, 'stub');
});

test('communities and the setup the app reads', async () => {
  const { communities } = await call('get', '/v1/communities');
  assert.equal(communities[0].id, 'peft');
  const setup = await call('get', '/v1/communities/peft/setup');
  assert.equal(setup.parameters.alpha_default, 8000);
  assert.equal(setup.interface.screens.chat, true);
  await call('get', '/v1/communities/nope/setup', undefined, 404);
});

test('search finds real papers and filters them', async () => {
  const r = await call('get', '/v1/ideas?q=low-rank%20adaptation&per_page=5');
  assert.ok(r.total >= 3);
  assert.ok(r.ideas.some((i: any) => i.title.startsWith('LoRA:')));
  const curated = await call('get', '/v1/ideas?tier=curated&sort=oldest&per_page=100');
  assert.equal(curated.total, 41);
  assert.ok(curated.ideas.every((i: any, n: number, a: any[]) => n === 0 || a[n - 1].origin_date <= i.origin_date));
  const range = await call('get', '/v1/ideas?year_from=2024&year_to=2024&per_page=100');
  assert.ok(range.ideas.every((i: any) => i.year === 2024));
});

test('idea detail shows weights, holders and citations', async () => {
  const d = await call('get', `/v1/ideas/${ids.lora}`);
  assert.equal(d.tier, 'curated');
  assert.equal(d.parents.reduce((a: number, p: any) => a + p.weight_bps, 0), 10_000);
  assert.equal(d.registry.approval.authority, 'panel');
  assert.match(d.registry.approval.basis, /Citation-only/);
  assert.ok(d.children.length > 0);
  assert.ok(d.cited_by_ideas.length >= d.children.length);
  assert.equal(d.registry.holders[0].units, 1_000_000);
  await call('get', '/v1/ideas/sha256:nope', undefined, 404);
});

test('graphs: neighbourhood, lineage, path and export', async () => {
  const g = await call('get', `/v1/ideas/${ids.lora}/graph?depth=1`);
  assert.ok(g.nodes.length > 5);
  assert.ok(g.edges.some((e: any) => e.type === 'depends-on' && e.weight_bps > 0));
  const lineage = await call('get', '/v1/graph?tier=curated');
  assert.equal(lineage.nodes.length, 41);
  assert.ok(lineage.edges.every((e: any) => e.type === 'depends-on'));
  const path = await call('get', `/v1/graph/path?from=${ids.newId}&to=${ids.lora}`);
  assert.equal(path.path[0].work_id, ids.newId);
  assert.equal(path.path.at(-1).work_id, ids.lora);
  assert.equal(path.edges.length, path.path.length - 1);
  const all = await call('get', '/v1/graph/export');
  assert.equal(all.nodes.length, 190);
});

test('citation in BibTeX', async () => {
  const bib = await call('get', `/v1/ideas/${ids.lora}/cite?format=bibtex`);
  assert.match(bib, /eprint = \{2106\.09685\}/);
});

test('the fund simulator follows the OIP-14 waterfall', async () => {
  const r = await call('post', '/v1/simulate/fund', { work_id: ids.lora, amount: '100' });
  const lora = r.flows[0];
  assert.equal(lora.work_id, ids.lora);
  assert.equal(lora.depth, 0);
  assert.equal(lora.received.oso, '100');
  assert.equal(lora.to_holders.oso, '80');
  assert.equal(lora.passed_up.oso, '20');
  const kept = r.flows.reduce((a: bigint, f: any) => a + BigInt(f.to_holders.base), 0n);
  assert.ok(100n * 10n ** 18n - kept < 1000n, 'everything but rounding dust reaches holders');
  await call('post', '/v1/simulate/fund', { work_id: ids.lora, amount: 'ten' }, 400);
});

test('chat answers from the graph and cites ideas', async () => {
  const r = await call('post', '/v1/chat', { work_id: ids.lora, messages: [{ role: 'user', content: 'What does this build on?' }] });
  assert.equal(r.provider, 'stub');
  assert.ok(r.citations.some((c: any) => c.work_id === ids.lora));
  await call('post', '/v1/chat', { work_id: ids.lora, messages: [] }, 400);
});

test('ledger: blocks, transactions and development endpoints', async () => {
  const list = await call('get', '/v1/ledger/blocks');
  assert.equal(list.blocks[0].number, list.height);
  const block = await call('get', '/v1/ledger/blocks/0');
  assert.equal(block.txs[0].tx.type, 'genesis');
  await call('post', '/v1/tx', { type: 'transfer' }, 400);
  const funded = await call('post', '/v1/dev/fund', { work_id: ids.lora, amount: '5' });
  assert.equal(funded.ok, true);
  const before = (await call('get', '/v1/status')).height;
  const adv = await call('post', '/v1/dev/advance', { blocks: 2 });
  assert.equal(adv.height, before + 2);
});

test('every operation in the contract is tested', () => {
  const all = Object.values<any>(spec.paths).flatMap((item) => Object.values<any>(item).map((op) => op.operationId));
  assert.deepEqual(all.filter((id) => !called.has(id)), []);
});
