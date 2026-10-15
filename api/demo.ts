// The development ledger: genesis, the seed field from seed/<community>.json with citation-only
// weights for the curated slice, then a little activity (one submission taken through admission
// and publication, and one funding payment). Every key here is a deterministic, public development key.
import { readFileSync } from 'node:fs';
import { Chain } from '../ledger/chain.ts';
import { addressOf, devKey, signMessage } from '../ledger/crypto.ts';
import { makeTx, ownerMessage, versionId, type Tx } from '../ledger/ledger.ts';
import { ONE_OSO, type Params } from '../ledger/state.ts';
import { citationWeights, importVersion, submissionVersion, type SeedWork } from '../ledger/versions.ts';

export const DEV_PARAMS: Params = {
  network: 'oso-dev',
  supply_cap: (10n ** 12n * ONE_OSO).toString(),
  mint_rate_inv: (10n ** 10n).toString(),
  alpha_default: 8_000,
  dust: (ONE_OSO / 1_000n).toString(),
  round_blocks: 10,
  settle_cap: 200,
  challenge_window: 3,
  stake: (10n * ONE_OSO).toString(),
  validator_fee: ONE_OSO.toString(),
};

export const DEV_NAMES = ['operator', 'alice', 'bob', 'funder', 'v1', 'v2', 'v3', 'v4', 'v5'] as const;
export type DevName = (typeof DEV_NAMES)[number];
export const devKeys = Object.fromEntries(DEV_NAMES.map((n) => [n, devKey(n)])) as Record<DevName, string>;
export const devAddress = (name: DevName) => addressOf(devKeys[name]);

const oso = (n: number) => (BigInt(n) * ONE_OSO).toString();
export const WEIGHT_BASIS = 'Citation-only suggestion (OIP-14 sections 5.4 and 6, λ = 0): equal weights over the curated works it cites. Development stand-in; not assessed by AI or reviewed by the weight panel.';

/** Sends several transactions from one sender in one block. */
function batch(chain: Chain, key: string, items: [string, Record<string, any>][]): Tx[] {
  return items.map(([type, body], i) => makeTx(key, chain.state, type, body, i));
}

export function advance(chain: Chain, blocks: number) {
  for (let i = 0; i < blocks; i++) chain.commit([]);
}

export function loadSeed(path: string): { community: string; works: SeedWork[] } {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Imports the seed and approves citation-only weights for the curated slice. Returns work IDs by seed key. */
export function importSeed(chain: Chain, seed: { community: string; works: SeedWork[] }) {
  const op = devKeys.operator;
  const operator = devAddress('operator');
  const ids: Record<string, string> = {};
  const items = seed.works.map((w) => {
    const v = importVersion(w, operator, [seed.community]);
    ids[w.key] = versionId(v);
    return ['idea.import', { version: v, origin_date: w.date, tier: w.tier }] as [string, Record<string, any>];
  });
  for (let i = 0; i < items.length; i += 100) chain.commit(batch(chain, op, items.slice(i, i + 100)));

  const byKey = new Map(seed.works.map((w) => [w.key, w]));
  const approvals = seed.works
    .filter((w) => w.tier === 'curated')
    .map((w) => {
      // Candidates: cited curated works that are strictly older (OIP-14 section 3).
      const candidates = w.references
        .filter((r) => byKey.get(r)?.tier === 'curated' && byKey.get(r)!.date < w.date)
        .map((r) => ids[r]);
      return [w, citationWeights(candidates)] as const;
    })
    .filter(([, weights]) => Object.keys(weights).length > 0)
    .map(([w, parents]) => ['weights.approve', { work_id: ids[w.key], parents, basis: WEIGHT_BASIS }] as [string, Record<string, any>]);
  if (approvals.length) chain.commit(batch(chain, op, approvals));
  return ids;
}

export function seedDevLedger(chain: Chain, seedPath = new URL('../seed/peft.json', import.meta.url).pathname) {
  const op = devKeys.operator;
  const seed = loadSeed(seedPath);

  // Genesis with a disclosed bootstrap pool (OIP-8 section 10), then bootstrap grants.
  chain.commit([makeTx(op, chain.state, 'genesis', { params: DEV_PARAMS, bootstrap: oso(10_000) })]);
  chain.commit(batch(chain, op, [
    ['bootstrap.grant', { to: 'fund', amount: oso(2_000) }],
    ['bootstrap.grant', { to: devAddress('alice'), amount: oso(100) }],
    ['bootstrap.grant', { to: devAddress('bob'), amount: oso(100) }],
    ['bootstrap.grant', { to: devAddress('funder'), amount: oso(5_000) }],
  ]));
  const ids = importSeed(chain, seed);
  const find = (title: string) => {
    const w = seed.works.find((x) => x.title.startsWith(title));
    if (!w) throw new Error(`seed has no work titled ${title}`);
    return ids[w.key];
  };

  // Alice and Bob submit a new idea that builds on QLoRA and DoRA.
  const alice = devAddress('alice');
  const bob = devAddress('bob');
  const version = submissionVersion({
    type: 'hypothesis',
    title: "DoRA's magnitude–direction split reduces the quantization error of QLoRA adapters",
    abstract: 'We propose that decomposing adapter updates into magnitude and direction, as in DoRA, makes 4-bit QLoRA fine-tuning recover more of full-precision accuracy, and describe a test. (Development example.)',
    content: '# Hypothesis\n\nDevelopment example: the content of this idea is a placeholder.\n',
    parents: [{ version_id: find('QLoRA'), weight_bps: 6_000 }, { version_id: find('DoRA'), weight_bps: 4_000 }],
    owners: [{ identity: alice, share_bps: 6_000 }, { identity: bob, share_bps: 4_000 }],
    attribution: ['Alice (development identity)', 'Bob (development identity)'],
    registrant: alice,
  });
  const newId = versionId(version);
  const owner_signatures = {
    [alice]: signMessage(devKeys.alice, ownerMessage(newId)),
    [bob]: signMessage(devKeys.bob, ownerMessage(newId)),
  };
  chain.commit([makeTx(devKeys.alice, chain.state, 'idea.submit', { version, owner_signatures })]);

  // Admission (stand-in for the OIP-11 vote), then the challenge window passes and the mint is released.
  const validators = (['v1', 'v2', 'v3', 'v4', 'v5'] as const).map(devAddress);
  chain.commit([makeTx(op, chain.state, 'idea.admit', { work_id: newId, validators })]);
  advance(chain, DEV_PARAMS.challenge_window);

  // A funder sends 1,000 OSO to LoRA; the rest of the round settles it upstream.
  chain.commit([makeTx(devKeys.funder, chain.state, 'idea.fund', { work_id: find('LoRA:'), amount: oso(1_000) })]);
  const k = DEV_PARAMS.round_blocks;
  advance(chain, k - (chain.state.height % k) - 1);

  return { ids, newId, lora: find('LoRA:') };
}
