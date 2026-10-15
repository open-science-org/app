// The block log on disk, one JSON file per block (OIP-13 section 4), and the node's current head.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { applyBlock, checkEnvelope, produceBlock, type Block, type Tx } from './ledger.ts';
import { cloneState, emptyState, type State } from './state.ts';

export class Chain {
  state: State = emptyState();
  blocks: Block[] = [];
  readonly dir: string | null;
  readonly operatorKey: string;

  constructor(operatorKey: string, dir: string | null = null) {
    this.operatorKey = operatorKey;
    this.dir = dir;
  }

  get head(): string | null {
    return this.blocks.length ? this.blocks[this.blocks.length - 1].hash : null;
  }

  /** Loads and replays the log in `dir`, checking every block. */
  static load(operatorKey: string, dir: string): Chain {
    const chain = new Chain(operatorKey, dir);
    const blocksDir = join(dir, 'blocks');
    if (!existsSync(blocksDir)) return chain;
    for (const f of readdirSync(blocksDir).filter((f) => f.endsWith('.json')).sort()) {
      const block = JSON.parse(readFileSync(join(blocksDir, f), 'utf8')) as Block;
      chain.state = applyBlock(chain.state, chain.head, block);
      chain.blocks.push(block);
    }
    return chain;
  }

  /** Checks a transaction's envelope against the head, as a mempool would. */
  check(tx: Tx): string | null {
    const next = cloneState(this.state);
    next.height += 1;
    return checkEnvelope(next, tx);
  }

  /** Produces, stores and returns a block with these transactions. */
  commit(txs: Tx[], now = new Date()): Block {
    const { block, state } = produceBlock(this.state, this.head, txs, this.operatorKey, now);
    this.state = state;
    this.blocks.push(block);
    if (this.dir) {
      const blocksDir = join(this.dir, 'blocks');
      mkdirSync(blocksDir, { recursive: true });
      writeFileSync(join(blocksDir, String(block.number).padStart(8, '0') + '.json'), JSON.stringify(block, null, 2) + '\n');
    }
    return block;
  }
}
