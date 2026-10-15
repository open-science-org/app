// Writes a fresh development ledger to ./data: `npm run seed`.
import { rmSync } from 'node:fs';
import { Chain } from './chain.ts';
import { devKeys, seedDemo } from './demo.ts';
import { formatOSO, acct, balance } from './state.ts';

const dir = process.env.OSO_DATA ?? 'data';
rmSync(dir, { recursive: true, force: true });
const chain = new Chain(devKeys.operator, dir);
const { ids, newId } = seedDemo(chain);
const s = chain.state;
console.log(`Wrote ${chain.blocks.length} blocks to ${dir}/blocks (head ${chain.head})`);
console.log(`Supply ${formatOSO(BigInt(s.minted) - BigInt(s.burned))} OSO, fund ${formatOSO(balance(s, acct.fund))} OSO`);
console.log(`New idea ${newId.slice(0, 19)}… is ${s.ideas[newId].status}; LoRA is ${ids.lora.slice(0, 19)}…`);
const failed = chain.blocks.flatMap((b) => b.txs.filter((t) => !t.ok).map((t) => `${b.number} ${t.tx.type}: ${t.error}`));
if (failed.length) { console.error('Failed transactions:\n' + failed.join('\n')); process.exit(1); }
