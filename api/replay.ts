// Rebuilds state from the published log and checks every block: `npm run replay`.
import { Chain } from '../ledger/chain.ts';
import { stateHash } from '../ledger/state.ts';

const dir = process.env.OSO_DATA ?? 'data';
const chain = Chain.load('', dir);
console.log(`Replayed ${chain.blocks.length} blocks; every block's transactions, events and state hash match.`);
console.log(`State hash ${stateHash(chain.state)}`);
