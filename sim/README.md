# OSO demo simulator

The simulator is one instantiation of the **[OSO demo experiment specification](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md)**. The specification defines every concept once:
- results and the research tree;
- attempts and success;
- what agents know and what sharing conveys;
- rewards, rounds and measures.

**Read it first.** This document describes how the simulator implements it.

What makes this instantiation the simulation:
- **results are abstract:** nodes of a generated tree, with no content;
- **the success oracle is chance:** each attempt succeeds with probability p, drawn by a seeded random-number generator;
- **agents are formulas:** they follow a scoring rule with set traits.

Traditional research and OSO are two settings of the same rules.

**What it is for.** It checks the mechanics, finds which parameters matter, finds failure modes, and designs the experiment with real LLM agents. It is **not** evidence that OSO works in the real world; see [section 6](#6-what-this-simulation-can-and-cannot-show).

```sh
npm run sim                                     # list the experiments
npm run sim -- settings                         # run one, print its table
npm run sim -- settings --set rules.screen=0.9  # change any setting for every row
npm run sim -- my-experiment.yaml               # run your own experiment file
npm run sim -- all --save                       # run all and log results in sim/results/
npm run sim -- plugins                          # list worlds, rules, policies, columns
npm test                                        # includes the simulator's tests
```

Everything about a run is configuration. The defaults are in [scenarios/default.yaml](scenarios/default.yaml), which documents every setting, and experiments are YAML files in [experiments/](experiments/). See [3. Configuration and extending](#3-configuration-and-extending).

Contents:
- [0. The specification in the simulator](#0-the-specification-in-the-simulator)
- [1. The simple model](#1-the-simple-model)
- [2. The default setup, as implemented](#2-the-default-setup-as-implemented)
- [3. Configuration and extending](#3-configuration-and-extending)
- [4. Measures](#4-measures)
- [5. Results](#5-results)
- [6. What this simulation can and cannot show](#6-what-this-simulation-can-and-cannot-show)
- [7. Code and tests](#7-code-and-tests)

## 0. The specification in the simulator

Where each element of the [specification](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md) lives:

| Specification | Configuration (scenario) | Code |
| --- | --- | --- |
| Research tree, targets, bounties (2.1) | `world` (plugin: `layered`, `chain`, `file`) | `world.ts` |
| Success oracle and chance p (2.2) | `success.oracle` (plugin: `chance`, `learning`); p from `success` (p0, eta), agent `skill`, specialist boost | `oracles.ts`; `model.ts`, `attempt` |
| Knowledge, publishing, uptake (2.3) | `rules.visibility` (plugin), agent `reuse` | `rules.ts` (`visibilities`), `model.ts` (`publishBundle`, uptake loop) |
| Rewards: mint, bounty, waterfall, screen (2.4) | `rules.alpha`, `rules.c`, `rules.mint`, `rules.screen`, `attribution.noise` | `world.ts` (`shares`, `attributionValue`), `model.ts` (`publishOne`, `payInto`) |
| Budget, rounds, allocation (2.5) | `budget` (allocation plugin) | `rules.ts` (`allocations`), `model.ts` (`run`) |
| One round (2.6) | — | `model.ts`, `run` |
| The rules and settings (3) | `rules`; named settings in `presets.yaml` | `presets.yaml` |
| Traits and archetypes (4.1) | `agents.archetypes`, `agents.mix` | `agents.ts` |
| How agents decide (4.2) | `behaviour.decider` (plugin: `formula`, `random`), per archetype in `agents.deciders`; the formula decider's settings in `behaviour` | `deciders.ts`; `rules.ts` (`policies`) |
| Measures (5) | `measures.targetLevel`; columns in experiments | `measures.ts` |
| Experiments and factors (7) | `experiments/*.yaml` | `experiment.ts`, `cli.ts` |

**The one effect of sharing modelled here.** A published result lets other agents attempt what builds on it, after uptake. It carries no statement, method or failed attempts, and it is always correct and free to absorb ([specification, section 2.3](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md#23-knowledge-and-sharing)).

## 1. The simple model

Start here: it isolates the one effect everything else builds on, and it has an exact answer, so it also checks the simulator.

**Setup.**
- **The problem:** a single chain of results. Result k can be attempted only once result k − 1 is known.
- **Difficulty:** every attempt succeeds with the same probability **p = 0.2**.
- **Agents:** N identical agents ("plain" agents: average skill, no preferences).
- **Budget:** X = 640 attempts in total, one per agent per round.

The only difference between the two cases is visibility:
- **Shared progress:** every result is published, and every agent takes it up at once.
- **Hidden progress:** nothing is published until the end of the chain, which no one reaches. So each agent climbs alone.

The measure is the deepest result proved by anyone.

**Exact predictions** (`sim/analytic.ts`):
- **Shared:** every attempt, by anyone, works on the current step, so the depth is the number of successes in X attempts: **Binomial(X, p)**, with mean **X·p = 128**.
- **Hidden:** each agent gets X/N attempts and climbs alone, so its depth is **Binomial(X/N, p)**. The community's deepest result is the best of N such agents, with mean **Σ_k (1 − F(k)^N)**, where F is the Binomial(X/N, p) distribution function. That is about X·p/N plus a little luck.

**Simulated vs. exact** ([results/simple](results/simple/summary.md); 1,000 seeds per row; mean ± standard error):

| N | Shared: simulated | Shared: exact | Hidden: simulated | Hidden: exact | Gain from sharing |
| --- | --- | --- | --- | --- | --- |
| 1 | 128.6 ± 0.3 | 128.0 | 128.6 ± 0.3 | 128.0 | 1.00 |
| 2 | 128.3 ± 0.3 | 128.0 | 67.9 ± 0.2 | 68.0 | 1.89 |
| 4 | 128.4 ± 0.3 | 128.0 | 37.2 ± 0.1 | 37.3 | 3.45 |
| 8 | 128.3 ± 0.3 | 128.0 | 21.3 ± 0.1 | 21.2 | 6.02 |
| 16 | 128.3 ± 0.3 | 128.0 | 12.7 ± 0.0 | 12.7 | 10.14 |

**What it shows.**
- **The gain from sharing grows with the number of agents.** With N agents, sharing reaches roughly N times deeper for the same money, a little less because the best of N lone agents gets lucky. Hidden progress makes N agents search the same steps N times.
- **The simulator matches the mathematics.** Every row agrees with the exact value to within about two standard errors. The rows use the same seeds, so their errors move together.

This check also caught a flaw. The simulator's first random-number generator (mulberry32) lowered success rates by about 0.3%, about 3 standard errors over 7,000 runs. With xoshiro128\*\* the simulated depth matched the exact value (127.97 vs. 128.0 over 4,000 runs). Commit `77f0d88`.

**What the simple model leaves out:** incentives. Here visibility is imposed. The default setup adds the reasons agents would or wouldn't share, and what they get paid for.

## 2. The default setup, as implemented

The default scenario ([scenarios/default.yaml](scenarios/default.yaml)), with the implementation details the [specification](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md) leaves to each instantiation. Compared with the simple model, it adds five things:
1. **A branching world** with targets, bounties and dead ends.
2. **Agents with different traits.**
3. **Rewards:** a mint per result and a bounty per target, paid through the OSO waterfall.
4. **Choices:** agents decide what to attempt and, in one setting, whether to publish.
5. **A compute loop:** earnings buy future compute.

### 2.1 The world (`world.ts`)

**Layout.** 8 levels of 10 results each, so 80 results.
- **Prerequisites.** A result at level ℓ ≥ 2 has one main prerequisite at level ℓ − 1, plus up to two extra prerequisites. Each extra one comes from the level just below, or (with probability 0.25) from any lower level. Results at level 1 are roots.
- **Areas.** There are 3. A result is in the same area as its main prerequisite with probability 0.8; otherwise its area is random.

**Difficulty.** Every attempt on a result at level ℓ succeeds with probability:

  p = 0.5 · 0.6^(ℓ−1)

That is 50% at level 1, 18% at level 3, 6.5% at level 5, 2.3% at level 7 and 1.4% at level 8, for an agent of skill 1.

**Targets.** Two each at levels 3, 5 and 7, and one at level 8.
- **Placement:** each is chosen at random from the half of its level with the most ancestors, so targets need real composition.
- **Bounty:** 4 · 2^(ℓ−1), so 16, 64, 256 and 512.

**Dead ends.** Results with no target below them. On average about 31 of the 80 results (over 200 worlds).

**Attribution weights.** A result's prerequisites share its attribution in proportion to their cost, 1/p. Harder prerequisites count more. The ledger can use noisy weights (spread σ_w), but the default is exact.

[world-example.svg](world-example.svg) draws the world of seed 1 (`node sim/draw-world.ts 1 > world.svg`).

Every run draws a new world from its seed. Within an experiment, the same seed gives the same world and agents in every setting, so the settings are compared on identical worlds.

### 2.2 Agents (`agents.ts`)

There are 12 agents. Each has eight traits:

| Archetype | Count | Skill | Conjecture q | Cost k | Horizon δ | Risk γ | Reuse ω | Sharing β | Gaming g |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Foundation builder | 3 | 1.0 | 0.7 | 1.0 | 0.98 | 0.2 | 0.9 | 0.5 | 0 |
| Target racer | 3 | 1.0 | 0.5 | 1.0 | 0.85 | −0.2 | 0.6 | 0 | 0 |
| Cheap explorer | 2 | 0.5 | 0.3 | 0.3 | 0.95 | 0 | 0.8 | 0.2 | 0 |
| Specialist | 2 | 1.0 (×1.6 in its area, ×0.4 elsewhere) | 0.6 | 1.0 | 0.95 | 0 | 0.8 | 0.2 | 0 |
| Free rider | 1 | 0.8 | 0.5 | 1.0 | 0.9 | 0 | 1.0 | −1 | 0 |
| Gamer | 1 | 0.8 | 0.3 | 0.5 | 0.9 | 0 | 0.8 | 0 | 0.6 |

What each trait does:
- **Skill** multiplies the success chance: π = min(1, skill · p).
- **Conjecture quality** q sets how accurately the agent perceives what a result is worth. Its estimates are the true values × (1 + (1 − q)·ξ), with ξ standard normal, drawn once per agent and result.
- **Cost** k is the compute units per attempt.
- **Horizon** δ discounts value that arrives later, per round.
- **Risk** γ penalizes uncertain payoffs; negative means risk-seeking.
- **Reuse** ω is the chance per round of taking up a result someone else published.
- **Sharing** β is the intrinsic value of publishing, in units of the mint.
- **Gaming** g is the share of attempts spent farming trivial results.

These values are guesses chosen to give a diverse population. They were not measured.

### 2.3 The rules: the only thing the settings change (`presets.yaml`)

| Setting | α | c | Visibility |
| --- | --- | --- | --- |
| Traditional | 1 | 0 | finished-only |
| OSO (immediate) | 0.8 | 0.15 | immediate |
| Flow-back, finished-only | 0.8 | 0.15 | finished-only |
| No flow-back, immediate | 1 | 0 | immediate |
| No flow-back, choice | 1 | 0 | agent's choice |
| OSO (choice) | 0.8 | 0.15 | agent's choice |

- **α** is the share of incoming value a result keeps; the rest flows to its prerequisites.
- **c** is the share of each new result's mint paid to what it built on.
- **Visibility:**
  - **finished-only:** a result stays private until its author proves a target that depends on it. The author's whole private bundle under that target is then published, oldest first.
  - **immediate:** a result is published as soon as it is proved, together with any private results it needs.
  - **delayed(d):** a result is published d rounds after it is proved (available, but not used by the named settings).
  - **agent's choice:** the agent decides for each lemma (section 2.5). Targets are always published.

  A result's prerequisites are always published before it, so value never flows to hidden work.

### 2.4 One round (`model.ts`, function `run`)

The budget is X = 1,200 compute units over T = 120 rounds, so 10 per round.

1. **Budgets.** Agent i gets:

   b_i = 10 · [ (1 − ρ)/12 + ρ · Ē_i / Σ Ē ]

   with ρ = 0.5. Ē_i is its smoothed recent earnings: Ē ← 0.7·Ē + 0.3·(this round's earnings). Before anyone earns, the split is equal. An agent makes floor(b_i / k_i) attempts and carries the remainder to the next round. All attempts in a round are shuffled, so agents interleave and race.
2. **Delayed publications** due this round are made.
3. **Rivals.** For each result, count how many agents could attempt it now. This is the race estimate used in scoring.
4. **Attempts,** one at a time:
   - With probability g, the agent farms a trivial result. It costs k, and the validation screen rejects it with probability θ = 0.5. If accepted, it earns the mint m = 1.
   - Otherwise the agent lists its **frontier**: results it doesn't know whose prerequisites it all knows. If the frontier is empty, it spends nothing.
   - With probability ε = 0.05 it picks a random result from the frontier. Otherwise it picks by softmax over the score U (section 2.5): the probability is proportional to exp((U − U_best) / (τ·|U_best|)), with τ = 0.3.
   - It spends k, and succeeds with probability π.
   - **On success:** if someone else already published the result, the proof is a duplicate and earns nothing. Otherwise the visibility rule decides whether to publish.
5. **Publishing a result** makes the agent its author of record:
   - **Mint:** the author earns (1 − c)·m, or the whole m for a root. c·m flows into the result's prerequisites through the waterfall.
   - **Bounty:** if the result is a target, its bounty enters it through the waterfall.
   - **Uptake:** every other agent takes the result up at once with probability ω.
6. **Uptake.** Every agent takes up each published result it doesn't yet know, with probability ω.
7. **Earnings** are added up and Ē is updated.
8. **Stopping.** The run ends when the budget is spent, or as soon as every target is solved, since a funder stops paying then.

**The waterfall** (`world.ts`, function `shares`): value v entering result x pays share[x][a] · v to the author of each a, either x itself or one of its ancestors.

```
share[x][x] = α            (1 if x is a root)
share[x][a] = Σ over prerequisites j of x of (1 − α) · ŵ(x, j) · share[j][a]
```

A test checks that this pays each result exactly what the ledger's integer OIP-14 waterfall pays (to 1e-9).

### 2.5 Decisions

The default `formula` decider ([deciders.ts](deciders.ts)). Deciders are plugins: an archetype can use another one (`agents.deciders`), such as `random`, a zero-intelligence baseline.


**What to attempt.** The value of result r to agent i is:

```
V = mint + bounty + stepping stone + flow-back
  mint           = (1 − c)·m                                (m for a root)
  bounty         = α · B_r · win                            (targets only)
  stepping stone = δ^h · α · B̂_down · win
  flow-back      = δ^h · Ŝ
U = V · ( π − γ · √(π·(1 − π)) )
```

- **win** = 1 / (1 + rivals): the agent's chance of being first.
- **B̂_down:** the agent's estimate of the largest bounty below r. A lemma is worth proving on the way to one's own target, under any rules.
- **Ŝ:** the agent's estimate of S_r, what authoring r will earn from flow-back. S_r is computed assuming every target below r is eventually solved and every descendant published:

  S_r = Σ over targets t below r of B_t · share[t][r] + Σ over descendants d of r of c·m · (the share of d's mint that reaches r)

  Under traditional rules (α = 1, c = 0), S_r = 0 for every lemma.
- **h:** the expected delay before value from below arrives, set to 5 rounds per level between r and the targets below it.

**Whether to publish** (agent's choice only). Publish lemma r now if:

```
β·m  +  mint at risk  +  δ^h · Ŝ · κ   ≥   α · B̂_down · win · ψ
```

- **mint at risk** = mint × (1 − δ^h · win): publishing earns the mint now, while a private lemma is published, and paid, only if its author later wins a target above it.
- **κ = 1:** how much publishing raises a lemma's expected use.
- **ψ = 0.5:** the scoop risk, meaning how much publishing raises a rival's chance of winning the target below. This is the parameter the results are most sensitive to.

## 3. Configuration and extending

### Scenarios

A **scenario** is one complete setup: the world, the agents, the rules, the budget and the agents' behaviour. [scenarios/default.yaml](scenarios/default.yaml) holds every setting with its default and a comment. Any file or override changes only what it names.

| Section | Settings | Defaults |
| --- | --- | --- |
| `world` | A world generator (`kind`) and its parameters | `layered`: 8 levels × 10, ≤ 3 prerequisites, 3 areas, targets at levels 3, 5, 7, 8, bounty 4·2^(ℓ−1) |
| `success` | Success chance per attempt by level: p = p0 · eta^(level − 1) | p0 = 0.5, eta = 0.6 |
| `attribution` | Noise in the ledger's attribution weights | 0 (exact) |
| `agents` | Archetypes and their traits, the mix, specialist boost and penalty | 12 agents of six archetypes (section 2.2) |
| `rules` | α, c, mint, validation screen θ, visibility rule | Traditional: α = 1, c = 0, finished-only, θ = 0.5 |
| `budget` | Total compute X, rounds (or attempts per agent per round), stopping, allocation rule | X = 1,200 over 120 rounds; earnings share with ρ = 0.5 |
| `behaviour` | Choice policy, perception noise, κ, ψ, rounds per level | softmax τ = 0.3, ε = 0.05; κ = 1, ψ = 0.5 |
| `measures` | Level L\* for speed and cost | 7 |

**Validation.** Every scenario is checked before it runs. A misspelled or unknown setting is an error, and so are a wrong type, an archetype used in the mix but not defined, and an unknown parameter of a plugin. So a typo can't silently do nothing.

**Overrides** use nested YAML or dotted paths, for example `rules.alpha: 0.8` or `--set budget.allocation.rho=0`. When a component's `kind` changes, it is replaced whole, so parameters of the old kind don't leak into the new one.

### Experiments

An experiment is a YAML file in [experiments/](experiments/):

```yaml
id: my-experiment
title: Does a strong screen help OSO?
description: One paragraph, copied into the saved summary.
seeds: 100                      # seeds per row; every row uses the same seeds (paired comparison)
scenario: default               # base scenario: default, a name in scenarios/, or a path
set:                            # overrides for every row
  rules.visibility: { kind: choice }
factors:                        # every combination of levels becomes one row; first factor outermost
  - name: setting               # a factor of named levels, inline (set) or from presets.yaml (preset)
    levels:
      - { label: Traditional, preset: traditional }
      - { label: OSO, preset: osoChoice }
  - { name: θ, path: rules.screen, values: [0.5, 0.9] }   # a sweep of one setting
patches:                        # overrides for rows whose settings match
  - { when: { rules.alpha: 1 }, set: { rules.c: 0 } }
exclude:                        # rows to leave out
  - { rules.alpha: 1, rules.c: 0.15 }
columns: [frontier, reachTarget, cost, sharing, gamerShare]   # see `npm run sim -- plugins`
```

An experiment may instead name an `analysis` that builds its own table, as `simple.yaml` does with `simple-chain-exact`. [presets.yaml](presets.yaml) holds the six rule settings by name.

### Plugins

Components chosen by `kind` are plugins. `npm run sim -- plugins` lists them with their parameters.

| Registry | In a scenario | Built in |
| --- | --- | --- |
| `worlds` (world.ts) | `world.kind` | `layered` (random levels), `chain` (the simple model), `file` (any DAG from JSON) |
| `visibilities` (rules.ts) | `rules.visibility.kind` | `finished-only`, `immediate`, `delayed` (`d`), `choice` |
| `allocations` (rules.ts) | `budget.allocation.kind` | `earnings-share` (`rho`, `smoothing`), `equal` |
| `oracles` (oracles.ts) | `success.oracle.kind` | `chance` (succeeds with chance p), `learning` (`gain`, `cap`: each failure raises the next chance) |
| `deciders` (deciders.ts) | `behaviour.decider.kind`, `agents.deciders.<archetype>.kind` | `formula` (section 2.5), `random` (`publish`) |
| `policies` (rules.ts) | `behaviour.policy.kind` (formula decider) | `softmax` (`tau`, `epsilon`), `greedy` |
| `COLUMNS` (measures.ts) | `columns:` | frontier, reach, speed, cost, spend, productivity, breadth, waste, credit, sharing, hoarded, reuse, duplicates, targets solved, gamer share, trivial spend |
| `analyses` (experiment.ts) | `analysis:` | `simple-chain-exact` |

**A world from a file** reads `{ "nodes": [{ "id", "prereqs"?, "p"?, "area"?, "bounty"? }] }`, with every result listed after the results it builds on. Levels are derived from the prerequisites. A result's `p` overrides the success model, and a `bounty` makes it a target. This is how the Lean problem set's reference DAG, with measured success chances, can become a simulated world.

**Adding a plugin** means registering it once; it can then be used from any YAML file. For example, a visibility rule that publishes only every k-th round:

```ts
// in rules.ts, or any module imported by the simulator
visibilities.register<{ every: number }>('batched', {
  description: 'Results are published in batches every `every` rounds',
  defaults: { every: 5 },
  create: ({ every }) => ({
    onProof: (ctx) => ctx.schedule(Math.ceil((ctx.round + 1) / every) * every),
  }),
});
```

```yaml
rules: { visibility: { kind: batched, every: 10 } }
```

The other registries work the same way:
- **A world generator** returns a function `(success, rng) => World`; `finishWorld` builds the World from levels, prerequisites, p and bounties.
- **A success oracle** returns `{ succeeds(ctx) }`. The context includes the agent, the result, the environment's chance p, the agent's past failures on that result, the random stream, and the decider's `payload`. An oracle that runs Lean's checker on a written proof would be one more plugin.
- **A decider** returns `{ choose(agent, frontier), wouldPublish(agent, result, choice) }`. It must use only what its agent knows (specification, section 2.3) and draw randomness only from the run's stream. An LLM decider, which prompts a model and attaches its proof as the payload, would be one more plugin.
- **A measure** is an entry in `COLUMNS`.

The core loop (`model.ts`) is only the environment: frontier, success, publishing, payment and compute. Every decision and every source of success is a plugin. Today the loop is synchronous; LLM deciders and a Lean oracle will need an asynchronous version of it, which is the next change for the Lean harness.

**Reproducibility.** A run depends only on its scenario and seed. Each component draws from its own random stream (world, agents, attribution noise, perception, the run itself), so changing one part of a setup does not reshuffle the others. Both refactors (to configuration, then to oracle and decider plugins) reproduced every saved result exactly: all 56 table rows of the five experiments.

## 4. Measures

Computed at the end of each run (`model.ts`, function `measure`):

| Measure | Definition |
| --- | --- |
| **frontier** | Highest level published |
| **reach L7** | Share of runs in which level 7 was published |
| **speed** | First round in which level 7 was published (runs that reached it) |
| **cost** | Spend at that round |
| **spend** | Total spend; less than X when every target was solved early |
| **results per 100** | Published, non-trivial results per 100 units of spend |
| **breadth** | Share of targets solved |
| **waste** | Share of spend on redundant work (attempts by others on a result someone published first, including failed attempts), dead ends and trivial results |
| **credit** | Credit accuracy: 1 − ½ Σ_i \| bounty pay share − contribution share \|. Each solved target's bounty is split over every result in its proof, in proportion to cost 1/p, to define contribution. **High trivially when one agent proves a whole chain alone, as under traditional rules**, so compare it only between settings that share work |
| **sharing** | Share of proved lemmas published in the same round they were first proved |
| **hoarded** | Share of proved lemmas never published |
| **gamer share of pay** | Share of all pay that went to the gaming agent |
| **trivial spend** | Share of spend on trivial results |

Tables show mean ± standard deviation over seeds. Per-run values, including the frontier at 11 points of spend, are in each experiment's `runs.jsonl`.

## 5. Results

Logged in [results/](results/LOG.md). Every saved result names the commit that produced it. To regenerate one:

```sh
git checkout <commit> && npm run sim -- <experiment> --seeds <n> --save
```

### Six settings ([results/settings](results/settings/summary.md), 100 seeds)

| Setting | Frontier | Reach L7 | Cost to L7 | Results per 100 | Credit | Sharing | Gamer share of pay |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Traditional | 5.7 ± 1.2 | 35% | 957 | 2.4 | 0.95 | 0.01 | 0.96 |
| OSO (immediate) | 7.9 ± 0.2 | 100% | 485 | 7.7 | 0.57 | 1.00 | 0.38 |
| Flow-back, finished-only | 5.5 ± 1.1 | 28% | 959 | 2.3 | 0.96 | 0.00 | 0.97 |
| No flow-back, immediate | 7.9 ± 0.3 | 100% | 494 | 7.6 | 0.47 | 1.00 | 0.37 |
| No flow-back, choice | 6.0 ± 0.9 | 35% | 990 | 3.5 | 0.88 | 0.23 | 0.92 |
| OSO (choice) | 6.3 ± 1.0 | 43% | 959 | 3.7 | 0.87 | 0.22 | 0.91 |

### α sweep under agent's choice ([results/alpha-sweep](results/alpha-sweep/summary.md), 100 seeds)

| α | 1 | 0.8 | 0.6 | 0.5 | 0.4 | 0.3 | 0.2 | 0.1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sharing | 0.23 | 0.22 | 0.25 | 0.28 | 0.34 | 0.47 | 0.63 | 0.77 |
| Reach L7 | 35% | 43% | 48% | 63% | 73% | 86% | 98% | 100% |
| Frontier | 6.0 | 6.3 | 6.4 | 6.7 | 6.9 | 7.2 | 7.6 | 7.8 |

The full grid over scoop risk ψ and cited share c is in [results/alpha-psi](results/alpha-psi/summary.md).

### Sensitivity ([results/sensitivity](results/sensitivity/summary.md), 100 seeds)

| Variant | Traditional frontier | OSO frontier | Gap | Gamer share of pay (traditional) |
| --- | --- | --- | --- | --- |
| Default (ρ = 0.5, θ = 0.5) | 5.7 | 7.9 | 2.2 | 0.96 |
| No compute loop (ρ = 0) | 4.6 | 8.0 | 3.4 | 0.36 |
| Strong screen (θ = 0.9) | 5.7 | 8.0 | 2.3 | 0.83 |
| No gamer | 7.0 | 8.0 | 1.0 | – |

### What the results say

1. **Sharing does most of the work.** Immediate visibility reaches level 7 in every run at about half the cost, with or without flow-back. The simple model shows why: hidden progress makes every agent repeat the same steps. In this model the effect is largely built in (section 6).
2. **Flow-back makes agents choose to share, but only when α is well below OSO's 0.8.**
   - **At 0.8:** sharing barely moves (0.22 vs. 0.23 at α = 1).
   - **At 0.3:** it doubles to 0.47.
   - **At 0.1:** it reaches 0.77, and every run reaches level 7.

   With a lower scoop risk (ψ = 0.1), the turn comes earlier: sharing is 0.61 at α = 0.5. So the threshold α\* exists in this model, but where it falls depends on ψ, which is a guess.
3. **The cited mint share c barely matters,** because the mint (1) is small next to the bounties (16 to 512).
4. **Flow-back makes credit more accurate when work is shared:** 0.57 with flow-back vs. 0.47 without, both with immediate visibility. The traditional setting's 0.95 is the trivial case of one agent proving a whole chain alone.
5. **Under traditional rules, the gaming agent captures the compute.** Lemmas stay private, so nobody else earns anything until they win a target. Meanwhile the gamer's trivial results earn mint from the first round, so the compute loop hands it the largest budget. It then wins most targets too, and ends with a median of 100% of all pay. Without the gamer, traditional reaches level 7.0 instead of 5.7, and the gap to OSO shrinks from 2.2 levels to 1.0. **So a large part of the default gap comes from one spammer combined with earnings-driven funding,** a real-world pattern, but an assumption here. Present the gap together with this decomposition.
6. **Without the compute loop (ρ = 0), the gap grows** (4.6 vs. 8.0), because traditional agents can no longer concentrate compute on whoever is ahead.

## 6. What this simulation can and cannot show

It is a thought experiment with the arithmetic done exactly. The [specification, section 6](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md#6-instantiations) compares it element by element with the Lean experiment. Where it departs from real research, starting with the largest gaps:

1. **Agents never invent problems.** Every possible result already exists, and agents see exactly which ones they can attempt. Real research is mostly finding the right question or lemma.
2. **The benefit of sharing is largely built in.** A published result is instantly usable, always correct and free to understand. "Sharing does most of the work" largely restates that assumption.
3. **Each attempt is an independent draw.** There is no partial progress and no learning from failure.
4. **The agents are formulas.** Their behaviour is the scoring rule in section 2.5. Real scientists and LLM agents may respond to incentives differently.
5. **The key numbers are guesses.** Bounties, the mint, the traits, and above all the scoop risk ψ were chosen, not measured. Where α\* falls is a property of these assumptions.
6. **The worlds are random graphs,** not fields with foundational results, fashions or dying lines of work.

What it is good for:
- checking the mechanics (the waterfall matches the ledger, and the simple model matches the mathematics);
- finding which parameters matter (ψ, α, ρ and the gamer, while c barely matters);
- finding failure modes (spam capturing compute);
- choosing the settings, budget and number of runs for the experiment with LLM agents on real problems, which addresses gaps 1, 3 and 4.

## 7. Code and tests

| File | Contents |
| --- | --- |
| `scenarios/default.yaml` | Every setting with its default, documented |
| `presets.yaml` | The six rule settings by name |
| `experiments/*.yaml` | The experiments |
| `config.ts` | Scenario types, loading, merging, dotted paths, validation |
| `registry.ts` | Plugin registries |
| `world.ts` | World generators (`layered`, `chain`, `file`), waterfall shares, attribution value S |
| `agents.ts` | Agents from archetypes |
| `oracles.ts` | Success oracles |
| `deciders.ts` | Deciders: the formula agent and the random baseline |
| `rules.ts` | Visibility rules, compute allocation, choice policies |
| `model.ts` | One run: the environment only |
| `measures.ts` | Measures of a run, and table columns |
| `experiment.ts` | Expands experiments into rows, runs them; analyses |
| `analytic.ts` | Exact predictions for the simple model |
| `cli.ts` | Command line; `--save` logs results |
| `draw-world.ts` | Draws one world as an SVG |
| `rng.ts` | Seeded xoshiro128\*\* random numbers |
| `settings.ts`, `experiments.ts` | Compatibility shims for the old API; can be deleted |
| `sim.test.ts` | Tests |
| `results/` | Saved results: per experiment `summary.md`, `config.json` (every parameter, the commit), `runs.jsonl` (one line per run); `LOG.md` lists every saved run |

The tests (`npm test`) check:
- the waterfall against the ledger;
- the simple model against its exact predictions;
- that lemmas have no flow-back value under traditional rules;
- reproducibility from a seed;
- that payouts equal mints plus solved bounties;
- both predictions of the model doc on fixed seeds;
- the configuration layer: validation errors, component replacement, worlds from files, experiment expansion, and the delayed visibility rule;
- the plugins: a learning oracle reaches deeper than chance, and deciders can differ by archetype.
