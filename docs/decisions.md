# Decision log

One entry per decision: what, why, who, date. "Proposed" entries need confirmation from the people named.

## 2026-10-15: One repository for the app foundation

**What.** Ledger, API, contract, seed data and front end live in `open-science-org/app`, as [Architecture](https://github.com/open-science-org/OSO/blob/master/docs/ui/architecture.md) suggests. The website stays in `open-science-org.github.io`.
**Why.** One clone, one test run and one pull request for changes that cross the contract.
**Who.** Proposed by Gajendra; confirm with Abinash and Bikrant.

## 2026-10-15: TypeScript on Node, no build step, no API framework

**What.**
- The ledger and API are TypeScript run directly by Node 22.18 or later, with type stripping. Only erasable syntax is allowed (no enums or parameter properties).
- The API uses `node:http`.
- Dependencies are `@noble/curves` and `@noble/hashes` for Ethereum-style keys.

**Why.**
- Same language as the front end, so contract types are shared.
- No build to break.
- Few dependencies to audit.

**Who.** Proposed. Bikrant may choose an API framework; the ledger stays a plain library either way.

## 2026-10-15: Contract first

**What.** [contract/openapi.yaml](../contract/openapi.yaml) (OpenAPI 3.1) is the source of truth. `contract/types.ts` is generated from it. The contract tests call every operation and validate every response.
**Why.** Front end and back end can work in parallel without drifting ([ui-v1.md](https://github.com/open-science-org/OSO/blob/master/docs/ui-v1.md), section 7).
**Who.** Decided.

## 2026-10-15: Seed data from arXiv and Semantic Scholar, not OpenAlex

**What.** The importer takes:
- curated metadata and dates from the arXiv API;
- references and the read-only tier from the Semantic Scholar Academic Graph API.

**Why.** OpenAlex is unreliable for this field (checked 2026-10-15):
- Its record for LoRA's arXiv DOI (10.48550/arXiv.2106.09685) carries the title "LoRA Fine-Tuning of a 3B Code LLM for Algorithmic Efficiency".
- Its QLoRA record lists no references.
- Title search did not find LoRA at all.

**Open.** Semantic Scholar rate-limits unauthenticated use; request an API key (`S2_API_KEY`) before importing larger fields. Check the Semantic Scholar API terms, and whether abstracts may be shown publicly, before launch.
**Who.** Proposed; Bikrant to confirm.

## 2026-10-15: Curated slice and read-only tier

**What.**
- The curated slice is 41 works from the field's main lineage, from the Transformer and BERT through adapters, prompt and prefix tuning, LoRA and its variants, to 2024 ([seed/curated.json](../seed/curated.json)).
- The read-only tier is works cited by at least three curated works (148 works).

**Why.** The design asks for 50 to 100 curated works chosen with a domain expert. This is a starting draft that keeps the lineage connected.
**Who.** Draft; needs a domain expert's review.

## 2026-10-15: Citation-only weights until AI assessments exist

**What.**
- Each curated work's payout weights are an equal split over the strictly older curated works it cites (OIP-14 sections 5.4 and 6, with λ = 0).
- They are approved by the operator standing in for the weight panel, and each approval records this basis.

**Why.** Value flow needs approved weights to be testable now. Citation-only weights follow the spec's own extrinsic rule rather than invented numbers.
**Next.** AI intrinsic assessments with two model families (OIP-15 Class A), then review by a disclosed panel.
**Who.** Proposed.

## 2026-10-15: AI adapter with an offline stub by default

**What.**
- One adapter speaks the OpenAI-style chat-completions interface, with providers and tasks in [ai.config.json](../ai.config.json).
- The default chat provider is `stub`, which answers from the graph alone.
- There is a daily call limit per task.

**Why.** Anyone can run the API with no key and no cost. Switching to OpenRouter or a local model is configuration only ([AI services and providers](https://github.com/open-science-org/OSO/blob/master/docs/ui/ai.md)).
**Open.** Which models to pin, the budget, and who holds the OpenRouter key.
**Who.** Proposed.
