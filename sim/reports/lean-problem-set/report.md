# The Lean problem set: OSO vs. traditional research

> The shape of the OSO Lean problem set; 42 theorems in three areas, 8 posted targets.

**For the same money, the OSO community got further, or got there more cheaply, than the traditional one.**

- **How far:** with a budget of 400 compute, OSO reached level **7.0** of 7 on average; traditional research reached **4.4**.
- **Targets solved:** OSO solved **8.0** of 8; traditional solved **4.8**.
- **Cost to reach level 5:** OSO 125 compute; traditional 303 compute (in the 44% of runs that got there).
- **Does flow-back make agents share?** When agents choose, sharing rises clearly (by 0.2 or more) once α is 0.6 or lower. At OSO's default α = 0.8, agents shared 42% of their intermediate results.
- **Robustness:** OSO's lead in level is smallest when shared knowledge is **costly to absorb** (+2.2 levels).

*The verdict compares the hardest level reached, the targets solved and (when both communities reach level 5 in at least 90% of runs) the cost to get there, each against two standard errors. 100 simulated runs per setting · simulator commit `bf5a855` · 2026-10-19. This is a simulation with guessed parameters, not evidence about real research; see [What this shows](#what-this-shows-and-what-it-does-not).*

## 1. The problem space

The reference tree of the Lean problem set: a number sequence (area A), sorting (area B) and 2 × 2 integer matrices (area C), plus results that join areas. Each result is a theorem; a theorem can be attempted once the theorems its proof uses are known. The eight posted targets carry bounties that double with depth. Area A is a long chain, area B is wide, and area C is shallow. Success chances follow the default model by level until the Lean pilot measures them.

| In this space | means |
| --- | --- |
| a result | a theorem, with its proof |
| a target | a posted theorem with a bounty |
| an attempt | one try at writing a proof that Lean accepts |
| an area | a mathematical topic |

![The research tree](figures/world.svg)

The tree has 42 results in 7 levels and 4 areas (A sequence, B sorting, C matrices, across areas). 6 are dead ends: no target depends on them. 8 are targets:

| target | level | bounty | results it rests on |
| --- | --- | --- | --- |
| C3 | 1 | 4 | 0 |
| A3 | 2 | 8 | 1 |
| C4 | 3 | 16 | 3 |
| X1 | 3 | 16 | 4 |
| B3 | 4 | 32 | 4 |
| B5 | 5 | 64 | 14 |
| X2 | 5 | 64 | 11 |
| A5 | 7 | 256 | 7 |

How hard each level is, before an agent's skill:

| level | results | targets | success chance per attempt |
| --- | --- | --- | --- |
| 1 | 20 | 1 | 50% |
| 2 | 9 | 1 | 30% |
| 3 | 6 | 2 | 18% |
| 4 | 2 | 1 | 11% |
| 5 | 3 | 2 | 6% |
| 6 | 1 | 0 | 4% |
| 7 | 1 | 1 | 2% |

The community has 12 agents (3 foundation, 3 racer, 2 explorer, 2 specialist, 1 freeRider, 1 gamer) and a budget of 400 compute over 40 rounds.

## 2. Progress for the money

![Hardest level published by compute spent](figures/frontier.svg)

Each line is the mean, over 100 runs, of the hardest level the community had published after spending that much compute. A line that ends early means every target was solved and the funder stopped paying.

## 3. The six settings

The rules are the only difference between rows ([specification, section 3](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md#3-the-rules)). Traditional: nothing flows back to what a result built on, and work is published only when finished. OSO: value flows back (α = 0.8, c = 0.15), and results are published at once or when the agent chooses.

| setting | frontier | reach L5 | speed | cost | spend | targets solved | waste | credit | sharing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Traditional | 4.4 ± 1.2 | 0.44 | 31 ± 7 | 303 ± 66 | 394 ± 14 | 4.8 ± 1.5 | 0.53 ± 0.10 | 0.98 ± 0.04 | 0.01 ± 0.02 |
| OSO (immediate) | 7.0 ± 0.0 | 1.00 | 13 ± 3 | 125 ± 32 | 243 ± 59 | 8.0 ± 0.0 | 0.78 ± 0.05 | 0.73 ± 0.06 | 1.00 ± 0.00 |
| Flow-back, finished-only | 4.3 ± 1.1 | 0.48 | 33 ± 6 | 327 ± 64 | 392 ± 19 | 4.9 ± 1.7 | 0.55 ± 0.11 | 0.99 ± 0.03 | 0.01 ± 0.02 |
| No flow-back, immediate | 7.0 ± 0.1 | 1.00 | 14 ± 4 | 131 ± 39 | 246 ± 63 | 8.0 ± 0.1 | 0.77 ± 0.06 | 0.59 ± 0.08 | 1.00 ± 0.00 |
| No flow-back, choice | 4.9 ± 1.2 | 0.67 | 31 ± 7 | 301 ± 74 | 386 ± 33 | 5.9 ± 1.4 | 0.59 ± 0.13 | 0.84 ± 0.09 | 0.35 ± 0.05 |
| OSO (choice) | 5.2 ± 1.2 | 0.76 | 28 ± 8 | 273 ± 77 | 372 ± 54 | 6.3 ± 1.3 | 0.62 ± 0.13 | 0.84 ± 0.08 | 0.42 ± 0.06 |

Values are mean ± standard deviation over runs. *frontier*: hardest level published; *reach L5*: share of runs reaching level 5; *speed*, *cost*: rounds and compute to reach it; *credit*: how closely bounty pay matches true contribution; *sharing*: share of intermediate results published as soon as they were proved.

## 4. Does flow-back make agents share?

![Sharing and reach by α](figures/alpha.svg)

| α | intermediate results shared | frontier | reach level 5 | targets solved |
| --- | --- | --- | --- | --- |
| 1 | 35% | 4.9 | 67% | 5.9 |
| 0.8 | 42% | 5.2 | 76% | 6.3 |
| 0.6 | 57% | 5.9 | 92% | 7.0 |
| 0.5 | 68% | 6.5 | 99% | 7.5 |
| 0.4 | 80% | 6.9 | 100% | 7.9 |
| 0.3 | 87% | 6.9 | 99% | 7.9 |
| 0.2 | 92% | 7.0 | 100% | 8.0 |
| 0.1 | 95% | 7.0 | 100% | 8.0 |

Sharing rises clearly once α is 0.6 or lower: this is the threshold α* in this space. The threshold depends on the scoop risk ψ = 0.5, which is a guess.

## 5. When sharing is costly or sometimes wrong

Absorbing a published result costs 0.5 compute; proofs are wrong 10% of the time, results built on a wrong result are wrong too, and targets reveal and retract them.

| shared knowledge | traditional frontier | OSO frontier | OSO lead | traditional targets | OSO targets |
| --- | --- | --- | --- | --- | --- |
| free and correct | 4.4 | 7.0 | +2.6 | 4.8 | 8.0 |
| costly to absorb | 4.2 | 6.4 | +2.2 | 4.7 | 7.0 |
| sometimes wrong | 4.1 | 6.6 | +2.5 | 4.3 | 7.6 |
| costly and sometimes wrong | 3.7 | 5.9 | +2.2 | 3.8 | 6.3 |

## What this shows and what it does not

- **It is a simulation** of the [OSO demo specification](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md): results are abstract, success is chance, and agents follow a formula. It shows how the incentive rules play out *if* this space works as described, not that it does.
- **The parameters are guesses,** especially the success chances, the scoop risk ψ, and the costs and error rates in section 5.
- **By default, sharing is free and always correct,** which favours OSO; section 5 shows how much of the lead survives without that.
- **Notes for this space:** Theorem names are hidden; the tree is the route of our own reference proofs, and agents may find others.

## Reproduce

```sh
npm run sim -- report lean-problem-set --seeds 100
```

The space is [sim/spaces/lean-problem-set.yaml](../../spaces/lean-problem-set.yaml) (written by hand from the Lean problem set's reference proofs). Every number above is in [data.json](data.json). Generated by the OSO simulator at commit `bf5a855`.
