// HTTP API for the node (paths follow OSO/docs/ui/architecture.md) and a one-page development UI.
//
//   npm start                 serves ./data, seeding a development ledger first if it is empty
//   OSO_OPERATOR_KEY=<hex>    operator key; without it the node runs in development mode with
//                             deterministic keys and the /v1/dev endpoints enabled
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { Chain } from './chain.ts';
import { DEV_NAMES, devKeys, seedDemo } from './demo.ts';
import { makeTx, type Tx } from './ledger.ts';
import { acct, balance, formatOSO, mintTo, parseOSO, transfer, type Idea, type State } from './state.ts';
import { owed, receive, settleAll, type Event } from './waterfall.ts';

const dir = process.env.OSO_DATA ?? 'data';
const port = Number(process.env.PORT ?? 8787);
const dev = !process.env.OSO_OPERATOR_KEY;
const chain = Chain.load(process.env.OSO_OPERATOR_KEY ?? devKeys.operator, dir);
if (chain.blocks.length === 0) {
  if (!dev) throw new Error(`no ledger in ${dir}`);
  seedDemo(chain);
  console.log(`Seeded a development ledger in ${dir}`);
}
const ui = readFileSync(new URL('../ui/index.html', import.meta.url));

// Totals by idea, built from block events, so the UI can show what each idea has received.
const received: Record<string, bigint> = {};
function indexEvents(events: Event[]) {
  for (const e of events) if (e.type === 'received') received[e.idea] = (received[e.idea] ?? 0n) + BigInt(e.amount);
}
chain.blocks.forEach((b) => indexEvents(b.events));
function commit(txs: Tx[]) {
  const block = chain.commit(txs);
  indexEvents(block.events);
  return block;
}

const amount = (x: bigint | string) => ({ base: BigInt(x).toString(), oso: formatOSO(x) });

function summary(s: State, idea: Idea) {
  return {
    work_id: idea.work_id,
    title: idea.current.title,
    type: idea.current.type,
    authors: idea.current.attribution.map((a) => a.name),
    origin_date: idea.origin_date,
    status: idea.status,
    tier: idea.tier,
    received: amount(received[idea.work_id] ?? 0n),
  };
}

function children(s: State, id: string) {
  return Object.values(s.ideas).filter((i) => i.weights?.parents[id] !== undefined);
}

function detail(s: State, id: string) {
  const idea = s.ideas[id];
  if (!idea) return null;
  return {
    ...summary(s, idea),
    version: idea.current,
    registry: {
      kind: idea.kind,
      alpha_bps: idea.alpha,
      origin_block: idea.origin_block,
      weights_effective_block: idea.weights?.effective_block ?? null,
      held_for_parents: amount(balance(s, acct.idea(id))),
      mint: idea.mint !== '0' ? amount(idea.mint) : null,
      window_end: idea.window_end,
      holders: Object.entries(idea.holders).map(([account, units]) => ({ account, units, balance: amount(balance(s, account)) })),
    },
    parents: Object.entries(idea.weights?.parents ?? {}).map(([j, w]) => ({
      work_id: j, title: s.ideas[j].current.title, weight_bps: w, owed: amount(owed(idea, j)),
    })),
    children: children(s, id).map((c) => ({ work_id: c.work_id, title: c.current.title, weight_bps: c.weights!.parents[id] })),
  };
}

/** Dry run of funding an idea, settled all the way up (OIP-14), without touching the ledger. */
function simulateFund(s: State, id: string, value: bigint) {
  const sim = structuredClone(s);
  const events: Event[] = [];
  mintTo(sim, 'simulation', value);
  transfer(sim, 'simulation', acct.idea(id), value);
  receive(sim, id, value, events);
  settleAll(sim, events);
  const rows: Record<string, { received: bigint; to_holders: bigint; passed_up: bigint }> = {};
  const row = (i: string) => (rows[i] ??= { received: 0n, to_holders: 0n, passed_up: 0n });
  for (const e of events) {
    if (e.type === 'received') row(e.idea).received += BigInt(e.amount);
    if (e.type === 'distributed') row(e.idea).to_holders += BigInt(e.amount);
    if (e.type === 'settled') row(e.from).passed_up += BigInt(e.amount);
  }
  return Object.entries(rows)
    .sort(([, a], [, b]) => (b.received > a.received ? 1 : b.received < a.received ? -1 : 0))
    .map(([i, r]) => ({
      work_id: i, title: s.ideas[i].current.title,
      received: amount(r.received), to_holders: amount(r.to_holders), passed_up: amount(r.passed_up),
    }));
}

function status(s: State) {
  return {
    network: s.params?.network,
    dev,
    height: s.height,
    head: chain.head,
    day: s.day,
    operator: s.operator,
    supply: amount(BigInt(s.minted) - BigInt(s.burned)),
    minted: amount(s.minted),
    burned: amount(s.burned),
    fund: amount(balance(s, acct.fund)),
    bootstrap: amount(balance(s, acct.bootstrap)),
    ideas: Object.keys(s.ideas).length,
    pending_settlements: s.queue.length,
    params: s.params,
    note: 'All amounts are simulated units with no outside value (OIP-8).',
  };
}

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function send(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(data, null, 2));
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const s = chain.state;
  const m = (re: RegExp) => re.exec(path);
  let match: RegExpExecArray | null;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST' });
    return res.end();
  }
  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(ui);
  }
  if (req.method === 'GET' && path === '/v1/status') return send(res, 200, status(s));
  if (req.method === 'GET' && path === '/v1/ideas') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const list = Object.values(s.ideas)
      .filter((i) => !q || i.current.title.toLowerCase().includes(q) || i.current.attribution.some((a) => a.name.toLowerCase().includes(q)))
      .sort((a, b) => (a.origin_date < b.origin_date ? -1 : a.origin_date > b.origin_date ? 1 : a.origin_block - b.origin_block))
      .map((i) => summary(s, i));
    return send(res, 200, { ideas: list });
  }
  if (req.method === 'GET' && (match = m(/^\/v1\/ideas\/([^/]+)$/))) {
    const d = detail(s, decodeURIComponent(match[1]));
    return d ? send(res, 200, d) : send(res, 404, { error: 'no such idea' });
  }
  if (req.method === 'GET' && (match = m(/^\/v1\/ideas\/([^/]+)\/graph$/))) {
    const root = decodeURIComponent(match[1]);
    if (!s.ideas[root]) return send(res, 404, { error: 'no such idea' });
    const depth = Math.min(Number(url.searchParams.get('depth') ?? 2), 6);
    const nodes = new Set([root]);
    const edges: { from: string; to: string; type: string; weight_bps: number }[] = [];
    let frontier = [root];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const [j, w] of Object.entries(s.ideas[id].weights?.parents ?? {})) {
          edges.push({ from: id, to: j, type: 'depends-on', weight_bps: w });
          if (!nodes.has(j)) { nodes.add(j); next.push(j); }
        }
        for (const c of children(s, id)) {
          if (!nodes.has(c.work_id)) {
            edges.push({ from: c.work_id, to: id, type: 'depends-on', weight_bps: c.weights!.parents[id] });
            nodes.add(c.work_id); next.push(c.work_id);
          }
        }
      }
      frontier = next;
    }
    return send(res, 200, { nodes: [...nodes].map((n) => summary(s, s.ideas[n])), edges });
  }
  if (req.method === 'POST' && path === '/v1/simulate/fund') {
    const { work_id, amount: amt } = await body(req);
    if (!s.ideas[work_id]) return send(res, 404, { error: 'no such idea' });
    return send(res, 200, { work_id, amount: amount(parseOSO(String(amt))), flows: simulateFund(s, work_id, parseOSO(String(amt))) });
  }
  if (req.method === 'GET' && path === '/v1/ledger/blocks') {
    const page = Math.max(0, Number(url.searchParams.get('page') ?? 0));
    const newest = chain.blocks.slice().reverse().slice(page * 20, page * 20 + 20);
    return send(res, 200, {
      blocks: newest.map((b) => ({
        number: b.number, hash: b.hash, day_label: b.day_label, timestamp: b.timestamp,
        txs: b.txs.map((t) => ({ type: t.tx.type, sender: t.tx.sender, ok: t.ok, error: t.error })),
        events: b.events.length,
      })),
    });
  }
  if (req.method === 'GET' && (match = m(/^\/v1\/ledger\/blocks\/(\d+)$/))) {
    const b = chain.blocks[Number(match[1])];
    return b ? send(res, 200, b) : send(res, 404, { error: 'no such block' });
  }
  // Signed transactions from clients. Each one is committed in its own block for now.
  if (req.method === 'POST' && path === '/v1/tx') {
    const tx = (await body(req)) as Tx;
    const bad = chain.check(tx);
    if (bad) return send(res, 400, { error: bad });
    const b = commit([tx]);
    return send(res, b.txs[0].ok ? 200 : 422, { block: b.number, ok: b.txs[0].ok, error: b.txs[0].error });
  }
  if (dev && req.method === 'POST' && path === '/v1/dev/fund') {
    const { from = 'funder', work_id, amount: amt } = await body(req);
    if (!(DEV_NAMES as readonly string[]).includes(from)) return send(res, 400, { error: 'unknown development identity' });
    const tx = makeTx(devKeys[from as keyof typeof devKeys], s, 'idea.fund', { work_id, amount: parseOSO(String(amt)).toString() });
    const b = commit([tx]);
    return send(res, b.txs[0].ok ? 200 : 422, { block: b.number, ok: b.txs[0].ok, error: b.txs[0].error });
  }
  if (dev && req.method === 'POST' && path === '/v1/dev/advance') {
    const { blocks = 1 } = await body(req);
    const k = s.params!.round_blocks;
    const n = blocks === 'round' ? k - 1 - (s.height % k) || k : Math.min(Number(blocks), 100);
    for (let i = 0; i < n; i++) commit([]);
    return send(res, 200, { height: chain.state.height });
  }
  send(res, 404, { error: 'not found' });
}

createServer((req, res) => {
  route(req, res).catch((e) => send(res, 400, { error: (e as Error).message }));
}).listen(port, () => {
  console.log(`OSO node on http://localhost:${port} (${dev ? 'development mode' : 'operator key from OSO_OPERATOR_KEY'}), height ${chain.state.height}`);
});
