# OSO node (minimal)

The smallest working version of the OSO core protocol: a simulated ledger with signed transactions and hash-chained blocks, the idea registry, minting on validation, and the value-flow waterfall. It comes with a JSON API and a one-page development UI. The main app is a separate project; this node is what its API reads from and writes to (see [Architecture and API](https://github.com/open-science-org/OSO/blob/master/docs/ui/architecture.md)).

All amounts are simulated units with no outside value.

## Run it

Requires Node.js 23.6 or later (it runs TypeScript directly, with no build step).

```sh
npm install
npm test        # test cases from OIP-8 and OIP-14, plus ledger rules
npm start       # http://localhost:8787 — seeds a development ledger on first run
npm run seed    # rewrite ./data with a fresh development ledger
npm run replay  # rebuild state from ./data/blocks and check every block
```

The development ledger has genesis, a curated slice of eight parameter-efficient fine-tuning papers with **illustrative** weights, one new idea taken through submission, admission and publication, and one 1,000 OSO funding payment to LoRA that settles upstream. The fixture is in [fixtures/peft-slice.json](fixtures/peft-slice.json). Its weights were not assessed or approved under OIP-14. They exist only to exercise the waterfall, and the OpenAlex import will replace them.

## What it implements

| Spec | Implemented |
| --- | --- |
| OIP-8 Token structure | Supply cap and mint formula, mint split 50 / 35 / 15 with escrow until the challenge window closes, burn on removal, submission stakes, validator fees from the OSO fund, bootstrap pool, integer base units with floor rounding |
| OIP-14 Attribution and value flow | Payout waterfall with cumulative counters, dust threshold and round settlement, per-block settlement cap, time rule for payout edges, weight approval and re-approval applied only forward |
| OIP-16 Idea object | Version schema, exact fields, version and work IDs by RFC 8785 canonical JSON and SHA-256, external ID index, imports with attribution only |
| OIP-10 Ownership | Ethereum-style secp256k1 identities, every owner signs a submission, owner shares become IDEA units, imported works keep their units in an unresolved-claims account |
| OIP-13 Ledger | Signed transactions with per-sender nonces and a network domain, signed hash-chained blocks with day labels, failed transactions recorded and reverted, events recorded per block, replay from the log alone with every block checked |
| OIP-12 Block-end processing | Window closings, then settlement, in a fixed order |

A conservation check runs after every block: all balances must sum to minted minus burned.

## Not built yet

- **Validation and challenges (OIP-11).** Until they exist, the operator records their outcomes with `idea.admit` (validator vote) and `idea.remove` (upheld challenge).
- Claims and adjudication (OIP-10 section 6), reputation (OIP-9), review (OIP-17), new versions of a work, the content store, sealed priority claims, AI services, community setups and modules (OIP-12).
- Publishing blocks to a public git repository and independent timestamps (OIP-13 section 4).

**Simplifications to fix before the spec is final**

- Transactions are signed over keccak-256 of their canonical JSON, not EIP-712 typed data.
- The state hash is SHA-256 of the canonical state, not a Merkle root.
- Each transaction posted to `/v1/tx` is committed in its own block.

## API

| Endpoint | Returns |
| --- | --- |
| `GET /v1/status` | Height, head, supply, fund, bootstrap pool, parameters |
| `GET /v1/ideas?q=` | Ideas with title, type, status, origin date and total received |
| `GET /v1/ideas/{work_id}` | Version, registry state, parents with weights and amounts owed, children, IDEA holders |
| `GET /v1/ideas/{work_id}/graph?depth=2` | Nodes and approved payout edges around an idea |
| `POST /v1/simulate/fund` `{work_id, amount}` | Dry run of a funding payment settled all the way up: what each idea receives, pays to holders and passes up (amount in OSO, for example `"100"`) |
| `GET /v1/ledger/blocks?page=`, `GET /v1/ledger/blocks/{n}` | Recent blocks; one full block |
| `POST /v1/tx` | Submit a signed transaction |
| `POST /v1/dev/fund`, `POST /v1/dev/advance` | Development mode only: fund as a development identity; add empty blocks (`{"blocks": 1}` or `{"blocks": "round"}`) |

Amounts are returned as `{ "base": "<base units>", "oso": "<decimal>" }`.

**Development mode.** The node runs in development mode unless `OSO_OPERATOR_KEY` is set. In that mode, all keys come from public seeds in [src/demo.ts](src/demo.ts) and the `/v1/dev` endpoints are on. Never use those keys for anything real.

## Layout

| Path | Contents |
| --- | --- |
| `src/state.ts` | State, accounts, amounts |
| `src/waterfall.ts` | OIP-14 waterfall, approvals, settlement |
| `src/ledger.ts` | Transaction types, blocks, execution and replay |
| `src/chain.ts` | Block log on disk |
| `src/crypto.ts` | Canonical JSON, hashes, keys and signatures |
| `src/server.ts`, `ui/index.html` | API and development UI |
| `src/demo.ts`, `fixtures/` | Development ledger |
| `test/` | Tests |
