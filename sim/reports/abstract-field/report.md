# An abstract research field: OSO vs. traditional research

> A generic field of 80 results in 8 levels and 3 areas, with 7 prizes; the simulator's default world.

**For the same money, the OSO community got further, or got there more cheaply, than the traditional one.**

- **How far:** with a budget of 1200 compute, OSO reached level **7.9** of 8 on average; traditional research reached **5.7**.
- **Targets solved:** OSO solved **6.9** of 7; traditional solved **4.2**.
- **Cost to reach level 7:** OSO 485 compute; traditional 957 compute (in the 35% of runs that got there).
- **Does flow-back make agents share?** When agents choose, sharing rises clearly (by 0.2 or more) once α is 0.3 or lower. At OSO's default α = 0.8, agents shared 22% of their intermediate results.
- **Robustness:** OSO's lead in level is smallest when shared knowledge is **costly to absorb** (+2.0 levels).

*The verdict compares the hardest level reached, the targets solved and (when both communities reach level 7 in at least 90% of runs) the cost to get there, each against two standard errors. 100 simulated runs per setting · simulator commit `bf5a855` · 2026-10-19. This is a simulation with guessed parameters, not evidence about real research; see [What this shows](#what-this-shows-and-what-it-does-not).*

## 1. The problem space

A research field with no particular subject. Results build on results in eight levels of rising difficulty, across three loosely connected areas. Seven targets carry prizes that double with each level, and about a third of all results are dead ends that lead to no target. Twelve agents of six kinds work in it: patient foundation builders, target racers, cheap explorers, specialists, a free rider and a gamer who farms trivial results.

| In this space | means |
| --- | --- |
| a result | a finding that later findings can build on |
| a target | a prize-carrying finding announced in advance |
| an attempt | one try at proving a finding, which succeeds or fails |
| an area | a subfield |

![The research tree](figures/world.svg)

The tree has 80 results in 8 levels and 3 areas (area 1, area 2, area 3). 29 are dead ends: no target depends on them. 7 are targets:

| target | level | bounty | results it rests on |
| --- | --- | --- | --- |
| T1 | 3 | 16 | 8 |
| T2 | 3 | 16 | 7 |
| T3 | 5 | 64 | 21 |
| T4 | 5 | 64 | 18 |
| T5 | 7 | 256 | 38 |
| T6 | 7 | 256 | 23 |
| T7 | 8 | 512 | 46 |

How hard each level is, before an agent's skill:

| level | results | targets | success chance per attempt |
| --- | --- | --- | --- |
| 1 | 10 | 0 | 50% |
| 2 | 10 | 0 | 30% |
| 3 | 10 | 2 | 18% |
| 4 | 10 | 0 | 11% |
| 5 | 10 | 2 | 6% |
| 6 | 10 | 0 | 4% |
| 7 | 10 | 2 | 2% |
| 8 | 10 | 1 | 1% |

The community has 12 agents (3 foundation, 3 racer, 2 explorer, 2 specialist, 1 freeRider, 1 gamer) and a budget of 1200 compute over 120 rounds.

## 2. Progress for the money

![Hardest level published by compute spent](figures/frontier.svg)

Each line is the mean, over 100 runs, of the hardest level the community had published after spending that much compute. A line that ends early means every target was solved and the funder stopped paying.

## 3. The six settings

The rules are the only difference between rows ([specification, section 3](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md#3-the-rules)). Traditional: nothing flows back to what a result built on, and work is published only when finished. OSO: value flows back (α = 0.8, c = 0.15), and results are published at once or when the agent chooses.

| setting | frontier | reach L7 | speed | cost | spend | targets solved | waste | credit | sharing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Traditional | 5.7 ± 1.2 | 0.35 | 96 ± 16 | 957 ± 161 | 1194 ± 11 | 4.2 ± 0.9 | 0.64 ± 0.09 | 0.95 ± 0.09 | 0.01 ± 0.01 |
| OSO (immediate) | 7.9 ± 0.2 | 1.00 | 49 ± 14 | 485 ± 141 | 849 ± 207 | 6.9 ± 0.5 | 0.86 ± 0.03 | 0.57 ± 0.07 | 1.00 ± 0.00 |
| Flow-back, finished-only | 5.5 ± 1.1 | 0.28 | 96 ± 18 | 959 ± 182 | 1195 ± 2 | 4.1 ± 0.9 | 0.64 ± 0.09 | 0.96 ± 0.07 | 0.00 ± 0.01 |
| No flow-back, immediate | 7.9 ± 0.3 | 1.00 | 50 ± 14 | 494 ± 143 | 871 ± 210 | 6.9 ± 0.4 | 0.84 ± 0.04 | 0.47 ± 0.09 | 1.00 ± 0.00 |
| No flow-back, choice | 6.0 ± 0.9 | 0.35 | 100 ± 16 | 990 ± 159 | 1195 ± 2 | 4.1 ± 0.9 | 0.66 ± 0.07 | 0.88 ± 0.12 | 0.23 ± 0.08 |
| OSO (choice) | 6.3 ± 1.0 | 0.43 | 96 ± 19 | 959 ± 186 | 1193 ± 11 | 4.4 ± 1.0 | 0.68 ± 0.09 | 0.87 ± 0.11 | 0.22 ± 0.09 |

Values are mean ± standard deviation over runs. *frontier*: hardest level published; *reach L7*: share of runs reaching level 7; *speed*, *cost*: rounds and compute to reach it; *credit*: how closely bounty pay matches true contribution; *sharing*: share of intermediate results published as soon as they were proved.

## 4. Does flow-back make agents share?

![Sharing and reach by α](figures/alpha.svg)

| α | intermediate results shared | frontier | reach level 7 | targets solved |
| --- | --- | --- | --- | --- |
| 1 | 23% | 6.0 | 35% | 4.1 |
| 0.8 | 22% | 6.3 | 43% | 4.4 |
| 0.6 | 25% | 6.4 | 48% | 4.4 |
| 0.5 | 28% | 6.7 | 63% | 4.5 |
| 0.4 | 34% | 6.9 | 73% | 4.7 |
| 0.3 | 47% | 7.2 | 86% | 5.2 |
| 0.2 | 63% | 7.6 | 98% | 5.9 |
| 0.1 | 77% | 7.8 | 100% | 6.5 |

Sharing rises clearly once α is 0.3 or lower: this is the threshold α* in this space. The threshold depends on the scoop risk ψ = 0.5, which is a guess.

## 5. When sharing is costly or sometimes wrong

Absorbing a published result costs 0.5 compute; proofs are wrong 10% of the time, results built on a wrong result are wrong too, and targets reveal and retract them.

| shared knowledge | traditional frontier | OSO frontier | OSO lead | traditional targets | OSO targets |
| --- | --- | --- | --- | --- | --- |
| free and correct | 5.7 | 7.9 | +2.3 | 4.2 | 6.9 |
| costly to absorb | 5.7 | 7.7 | +2.0 | 4.2 | 6.2 |
| sometimes wrong | 4.9 | 7.4 | +2.5 | 3.3 | 5.4 |
| costly and sometimes wrong | 4.7 | 6.9 | +2.2 | 3.2 | 4.7 |

## What this shows and what it does not

- **It is a simulation** of the [OSO demo specification](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md): results are abstract, success is chance, and agents follow a formula. It shows how the incentive rules play out *if* this space works as described, not that it does.
- **The parameters are guesses,** especially the success chances, the scoop risk ψ, and the costs and error rates in section 5.
- **By default, sharing is free and always correct,** which favours OSO; section 5 shows how much of the lead survives without that.

## Reproduce

```sh
npm run sim -- report abstract-field --seeds 100
```

The space is [sim/spaces/abstract-field.yaml](../../spaces/abstract-field.yaml) (written by hand; the default scenario). Every number above is in [data.json](data.json). Generated by the OSO simulator at commit `bf5a855`.
