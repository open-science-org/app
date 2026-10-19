# OSO app

The foundation for the OSO v1 app ([design](https://github.com/open-science-org/OSO/blob/master/docs/ui-v1.md)):
- the API contract;
- a working API on a real ledger;
- seed data from the proposed seed field (parameter-efficient fine-tuning of LLMs);
- the community setup the app reads;
- a swappable AI adapter;
- tests.

The website and the real front end are still to be built, in `web/`.

All amounts are simulated units with no outside value.

## Quick start

Requires Node.js 22.18 or later (it runs TypeScript directly, with no build step).

```sh
npm install
npm start          # API on http://localhost:8787; seeds a development ledger on first run
npm test           # ledger and contract tests
npm run check      # type-check
```

The development page at http://localhost:8787/dev is a plain reference view of every endpoint: search, idea detail, payout links and citations, chat and the fund simulator. It is not the app. http://localhost:8787/dev/graph draws the idea DAG: payout links with their weights, where each work's value flows, and a fund simulation on the graph.

## For the front end (Abinash)

- **Build in `web/`** against the running API, which sends CORS headers so a dev server on another port can call it. See [web/README.md](web/README.md).
- **The contract is [contract/openapi.yaml](contract/openapi.yaml).** Types for every request and response are generated in [contract/types.ts](contract/types.ts) (`npm run types`).
- **Read the community setup** from `GET /v1/communities/{id}/setup`, as [Modular and customizable design](https://github.com/open-science-org/OSO/blob/master/docs/ui/modularity.md) describes: modules, parameters, and interface options (screens on or off, idea types, theme, labels).
- **Never compute protocol rules in the browser.** Weights, value flows, balances and statuses come from the API. Amounts arrive as `{ base, oso }`; show `oso`.

## For data and the API (Bikrant)

- **Contract first.** Change `contract/openapi.yaml` in the same pull request as the API, then run `npm run types`. The contract tests call every operation and validate each response against the schema; a new operation without a test fails the suite.
- **Seed data.** `npm run import` rebuilds [seed/peft.json](seed/peft.json) from [seed/curated.json](seed/curated.json):
  - arXiv metadata for the curated slice;
  - Semantic Scholar references, plus a read-only tier of works cited by at least three curated works.

  Today the seed has 41 curated works, 148 read-only works and 2,814 citation links. `npm run seed` rebuilds the development ledger from it.
- **AI.** All model calls go through [api/ai.ts](api/ai.ts), configured in [ai.config.json](ai.config.json):
  - The default provider is an offline `stub` that answers from the graph alone, so nobody needs a key.
  - For a real model: `OSO_AI_CHAT_PROVIDER=openrouter OSO_AI_CHAT_MODEL=<model> OPENROUTER_API_KEY=… npm start`, or `local` for Ollama.
- **Next in the work plan:**
  - hybrid search (keyword plus embeddings);
  - AI edge assessments for the curated slice, with review;
  - streaming chat;
  - the field map;
  - per-idea MCP endpoints;
  - deployment.

## Demo experiment

The simulator that compares OSO with traditional research now lives in its own repository, [open-science-org/experiment](https://github.com/open-science-org/experiment). It keeps a pinned copy of this repository's ledger, and its tests check that its waterfall pays exactly what `ledger/waterfall.ts` pays. After changing the ledger, refresh that copy there with `npm run sync-ledger`.

## What is real and what stands in

| Part | State |
| --- | --- |
| Ledger: signed transactions, hash-chained blocks, replay, minting, escrow, the OIP-14 waterfall | Implemented and tested against the OIP-8 and OIP-14 test cases |
| Seed works, dates, authors, abstracts and citations | Real, from arXiv and Semantic Scholar |
| Curated slice | A first draft of 41 works; a domain expert must review it |
| Payout weights of the curated slice | **Citation-only** suggestions (OIP-14 with λ = 0): equal weights over the curated works each paper cites. Each approval records this basis. Not yet assessed by AI or reviewed by the weight panel |
| Validation and challenges (OIP-11) | Not built. The operator records outcomes with `idea.admit` and `idea.remove` |
| Sign-in, claims, reputation, review | Not built (Phase B) |
| Chat | Works with any OpenAI-compatible provider; offline stub by default |

The development ledger also has one example submission taken through admission and publication, and one 1,000 OSO funding payment to LoRA. **Development mode** (no `OSO_OPERATOR_KEY`) uses public keys from [api/demo.ts](api/demo.ts); never use them for anything real.

## Layout

| Path | Contents |
| --- | --- |
| `contract/` | OpenAPI contract and generated TypeScript types |
| `api/` | The API (`app.ts`), AI adapter, development ledger, development page, contract tests |
| `ledger/` | The core protocol: state, transactions and blocks, the waterfall, keys; ledger tests |
| `seed/` | Curated list, imported seed data, community setup |
| `scripts/` | Seed importer |
| `web/` | The front end (to be built) |
| `docs/decisions.md` | Decision log |

The ledger implements OIPs 8, 13, 14 and 16, and owner signatures from OIP-10. Known simplifications, to fix before the specs are final:
- Transactions are signed over keccak-256 of canonical JSON, not EIP-712 typed data.
- The state hash is a hash of the canonical state, not a Merkle root.
- Each transaction posted to `/v1/tx` gets its own block.

## Data

Seed data comes from [Semantic Scholar](https://www.semanticscholar.org) and [arXiv](https://arxiv.org). Thank you to arXiv for use of its open access interoperability. Check both sources' terms before any public launch.
