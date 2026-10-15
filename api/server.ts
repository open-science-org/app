// Starts the OSO API: `npm start`.
//
//   OSO_DATA=data           where the block log lives; a development ledger is seeded if it is empty
//   OSO_OPERATOR_KEY=<hex>  operator key; without it the API runs in development mode, with public
//                           development keys and the /v1/dev endpoints on
//   PORT=8787
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Chain } from '../ledger/chain.ts';
import { AI, loadAIConfig } from './ai.ts';
import { createApp } from './app.ts';
import { devKeys, seedDevLedger } from './demo.ts';
import { stubAnswer } from './stub.ts';

const dir = process.env.OSO_DATA ?? 'data';
const port = Number(process.env.PORT ?? 8787);
const dev = !process.env.OSO_OPERATOR_KEY;

const chain = Chain.load(process.env.OSO_OPERATOR_KEY ?? devKeys.operator, dir);
if (chain.blocks.length === 0) {
  if (!dev) throw new Error(`no ledger in ${dir}`);
  seedDevLedger(chain);
  console.log(`Seeded a development ledger in ${dir}`);
}

const communities = [JSON.parse(readFileSync(new URL('../seed/community-peft.json', import.meta.url), 'utf8'))];
const ai = new AI(loadAIConfig(), stubAnswer);
const app = createApp({ chain, ai, dev, communities });

createServer((req, res) => void app(req, res)).listen(port, () => {
  const chat = ai.config.tasks.chat;
  console.log(`OSO API on http://localhost:${port}${dev ? ' (development mode; dev page at /dev)' : ''}`);
  console.log(`Ledger height ${chain.state.height}, ${Object.keys(chain.state.ideas).length} ideas; chat uses ${chat.provider}/${chat.model}`);
});
