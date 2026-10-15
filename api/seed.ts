// Writes a fresh development ledger to ./data from seed/peft.json: `npm run seed`.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Chain } from '../ledger/chain.ts';
import { acct, balance, formatOSO } from '../ledger/state.ts';
import { devKeys, seedDevLedger } from './demo.ts';

const dir = process.env.OSO_DATA ?? 'data';
// Clear only the block files this script writes.
mkdirSync(join(dir, 'blocks'), { recursive: true });
for (const f of readdirSync(join(dir, 'blocks'))) if (/^\d{8}\.json$/.test(f)) rmSync(join(dir, 'blocks', f));
const started = Date.now();
const chain = new Chain(devKeys.operator, dir);
const { newId } = seedDevLedger(chain);
const s = chain.state;
const ideas = Object.values(s.ideas);
console.log(`Wrote ${chain.blocks.length} blocks to ${dir}/blocks in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`${ideas.length} ideas (${ideas.filter((i) => i.tier === 'curated').length} curated, ${ideas.filter((i) => i.weights).length} with approved weights)`);
console.log(`Supply ${formatOSO(BigInt(s.minted) - BigInt(s.burned))} OSO, fund ${formatOSO(balance(s, acct.fund))} OSO; new idea is ${s.ideas[newId].status}`);
const failed = chain.blocks.flatMap((b) => b.txs.filter((t) => !t.ok).map((t) => `${b.number} ${t.tx.type}: ${t.error}`));
if (failed.length) { console.error('Failed transactions:\n' + failed.join('\n')); process.exit(1); }
