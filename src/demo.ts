// A development ledger: genesis, the seed slice, one new submission through admission and
// publication, and one funding payment. Every key here is a deterministic development key.
import { readFileSync } from 'node:fs';
import { addressOf, devKey, signMessage } from './crypto.ts';
import { Chain } from './chain.ts';
import { makeTx, ownerMessage, versionId, type Tx } from './ledger.ts';
import { ONE_OSO, type Params } from './state.ts';
import { importVersion, submissionVersion, type Fixture } from './versions.ts';

export const DEV_PARAMS: Params = {
  network: 'oso-dev',
  supply_cap: (10n ** 12n * ONE_OSO).toString(),
  mint_rate_inv: (10n ** 10n).toString(),
  alpha_default: 8_000,
  dust: (ONE_OSO / 1_000n).toString(),
  round_blocks: 10,
  settle_cap: 50,
  challenge_window: 3,
  stake: (10n * ONE_OSO).toString(),
  validator_fee: ONE_OSO.toString(),
};

export const DEV_NAMES = ['operator', 'alice', 'bob', 'funder', 'v1', 'v2', 'v3', 'v4', 'v5'] as const;
export const devKeys = Object.fromEntries(DEV_NAMES.map((n) => [n, devKey(n)])) as Record<(typeof DEV_NAMES)[number], string>;
export const devAddress = (name: (typeof DEV_NAMES)[number]) => addressOf(devKeys[name]);

const oso = (n: number) => (BigInt(n) * ONE_OSO).toString();

/** Sends several transactions from one sender in one block. */
function batch(chain: Chain, key: string, items: [string, Record<string, any>][]): Tx[] {
  return items.map(([type, body], i) => makeTx(key, chain.state, type, body, i));
}

export function advance(chain: Chain, blocks: number) {
  for (let i = 0; i < blocks; i++) chain.commit([]);
}

export function seedDemo(chain: Chain, fixturePath = new URL('../fixtures/peft-slice.json', import.meta.url)) {
  const op = devKeys.operator;
  const operator = devAddress('operator');
  const works = (JSON.parse(readFileSync(fixturePath, 'utf8')) as { works: Fixture[] }).works;

  // Block 0: genesis with a disclosed bootstrap pool (OIP-8 section 10).
  chain.commit([makeTx(op, chain.state, 'genesis', { params: DEV_PARAMS, bootstrap: oso(10_000) })]);

  // Block 1: bootstrap grants and the curated seed slice.
  const ids: Record<string, string> = {};
  const imports = works.map((f) => {
    const v = importVersion(f, operator);
    ids[f.key] = versionId(v);
    return ['idea.import', { version: v, origin_date: f.date, tier: 'curated' }] as [string, Record<string, any>];
  });
  chain.commit(batch(chain, op, [
    ['bootstrap.grant', { to: 'fund', amount: oso(2_000) }],
    ['bootstrap.grant', { to: devAddress('alice'), amount: oso(100) }],
    ['bootstrap.grant', { to: devAddress('bob'), amount: oso(100) }],
    ['bootstrap.grant', { to: devAddress('funder'), amount: oso(5_000) }],
    ...imports,
  ]));

  // Block 2: the weight panel approves the slice's weights (illustrative values, see the fixture note).
  chain.commit(batch(chain, op, works
    .filter((f) => Object.keys(f.parents).length)
    .map((f) => ['weights.approve', {
      work_id: ids[f.key],
      parents: Object.fromEntries(Object.entries(f.parents).map(([k, w]) => [ids[k], w])),
    }] as [string, Record<string, any>])));

  // Block 3: Alice and Bob submit a new idea that builds on QLoRA and DoRA.
  const alice = devAddress('alice');
  const bob = devAddress('bob');
  const version = submissionVersion({
    type: 'hypothesis',
    title: "DoRA's magnitude–direction split reduces the quantization error of QLoRA adapters",
    abstract: 'We propose that decomposing adapter updates into magnitude and direction, as in DoRA, makes 4-bit QLoRA fine-tuning recover more of full-precision accuracy, and describe a test.',
    content: '# Hypothesis\n\nDevelopment fixture: the content of this idea is a placeholder.\n',
    parents: [{ version_id: ids.qlora, weight_bps: 6_000 }, { version_id: ids.dora, weight_bps: 4_000 }],
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

  // Block 4: admission (stand-in for the OIP-11 vote), then the challenge window passes.
  const validators = (['v1', 'v2', 'v3', 'v4', 'v5'] as const).map(devAddress);
  chain.commit([makeTx(op, chain.state, 'idea.admit', { work_id: newId, validators })]);
  advance(chain, DEV_PARAMS.challenge_window);

  // A funder sends 1,000 OSO to LoRA; the rest of the round settles it upstream.
  chain.commit([makeTx(devKeys.funder, chain.state, 'idea.fund', { work_id: ids.lora, amount: oso(1_000) })]);
  const k = DEV_PARAMS.round_blocks;
  advance(chain, k - (chain.state.height % k) - 1);

  return { ids, newId };
}
