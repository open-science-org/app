# Early-stage drug discovery: OSO vs. traditional research

> Five stages from biology to a development candidate, in three disease areas, with three candidates as prizes.

**For the same money, the OSO community got further, or got there more cheaply, than the traditional one.**

- **How far:** with a budget of 1240 compute, OSO reached level **6.0** of 6 on average; traditional research reached **2.7**.
- **Targets solved:** OSO solved **2.8** of 3; traditional solved **0.7**.
- **Cost to reach level 5:** OSO 223 compute; traditional 847 compute (in the 45% of runs that got there).
- **Does flow-back make agents share?** When agents choose, sharing rises clearly (by 0.2 or more) once α is 0.4 or lower. At OSO's default α = 0.8, agents shared 41% of their intermediate results.
- **Robustness:** OSO's lead in level is smallest when shared knowledge is **costly to absorb** (+3.2 levels).

*The verdict compares the hardest level reached, the targets solved and (when both communities reach level 5 in at least 90% of runs) the cost to get there, each against two standard errors. 100 simulated runs per setting · simulator commit `bf5a855` · 2026-10-19. This is a simulation with guessed parameters, not evidence about real research; see [What this shows](#what-this-shows-and-what-it-does-not).*

## 1. The problem space

Early-stage drug discovery. Validated biology (a disease mechanism) supports target identification; targets support screening assays; assays find hits; hits are optimized into leads; and a lead with enough evidence becomes a development candidate. Each stage is much harder than the one before, and many hits and leads go nowhere. Three disease areas (oncology, immunology, neuroscience) share some early biology. Labs either publish each step as they go or keep it until they have a candidate.

| In this space | means |
| --- | --- |
| a result | a validated piece of evidence (mechanism, target, assay, hit or lead) |
| a target | a development candidate, worth a large bounty |
| an attempt | one experimental campaign |
| an area | a disease area |
| an agent | a lab |

![The research tree](figures/world.svg)

The tree has 54 results in 6 levels and 3 areas (oncology, immunology, neuroscience). 33 are dead ends: no target depends on them. 3 are targets:

| target | level | bounty | results it rests on |
| --- | --- | --- | --- |
| T1 | 6 | 486 | 16 |
| T2 | 6 | 486 | 18 |
| T3 | 6 | 486 | 16 |

How hard each level is, before an agent's skill:

| level | results | targets | success chance per attempt |
| --- | --- | --- | --- |
| 1 | 9 | 0 | 60% |
| 2 | 9 | 0 | 27% |
| 3 | 9 | 0 | 12% |
| 4 | 9 | 0 | 5% |
| 5 | 9 | 0 | 2% |
| 6 | 9 | 3 | 1% |

The community has 12 agents (3 foundation, 3 racer, 2 explorer, 2 specialist, 1 freeRider, 1 gamer) and a budget of 1240 compute over 103 rounds (calibrated: the smallest budget at which OSO solves about 90% of the targets).

## 2. Progress for the money

![Hardest level published by compute spent](figures/frontier.svg)

Each line is the mean, over 100 runs, of the hardest level the community had published after spending that much compute. A line that ends early means every target was solved and the funder stopped paying.

## 3. The six settings

The rules are the only difference between rows ([specification, section 3](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md#3-the-rules)). Traditional: nothing flows back to what a result built on, and work is published only when finished. OSO: value flows back (α = 0.8, c = 0.15), and results are published at once or when the agent chooses.

| setting | frontier | reach L5 | speed | cost | spend | targets solved | waste | credit | sharing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Traditional | 2.7 ± 3.0 | 0.45 | 71 ± 18 | 847 ± 221 | 1228 ± 51 | 0.7 ± 0.9 | 0.56 ± 0.16 | 0.44 ± 0.49 | 0.00 ± 0.00 |
| OSO (immediate) | 6.0 ± 0.1 | 1.00 | 19 ± 8 | 223 ± 94 | 850 ± 234 | 2.8 ± 0.6 | 0.87 ± 0.05 | 0.67 ± 0.14 | 1.00 ± 0.00 |
| Flow-back, finished-only | 2.7 ± 3.0 | 0.45 | 73 ± 18 | 871 ± 217 | 1227 ± 55 | 0.6 ± 0.8 | 0.55 ± 0.15 | 0.45 ± 0.50 | 0.00 ± 0.00 |
| No flow-back, immediate | 6.0 ± 0.0 | 1.00 | 20 ± 7 | 236 ± 83 | 869 ± 239 | 2.8 ± 0.5 | 0.85 ± 0.06 | 0.56 ± 0.12 | 1.00 ± 0.00 |
| No flow-back, choice | 5.4 ± 0.9 | 0.78 | 69 ± 21 | 826 ± 258 | 1224 ± 58 | 0.8 ± 0.9 | 0.66 ± 0.11 | 0.54 ± 0.48 | 0.41 ± 0.12 |
| OSO (choice) | 5.4 ± 0.9 | 0.79 | 63 ± 21 | 756 ± 253 | 1207 ± 91 | 1.0 ± 1.1 | 0.69 ± 0.13 | 0.53 ± 0.46 | 0.41 ± 0.12 |

Values are mean ± standard deviation over runs. *frontier*: hardest level published; *reach L5*: share of runs reaching level 5; *speed*, *cost*: rounds and compute to reach it; *credit*: how closely bounty pay matches true contribution; *sharing*: share of intermediate results published as soon as they were proved.

## 4. Does flow-back make agents share?

![Sharing and reach by α](figures/alpha.svg)

| α | intermediate results shared | frontier | reach level 5 | targets solved |
| --- | --- | --- | --- | --- |
| 1 | 41% | 5.4 | 78% | 0.8 |
| 0.8 | 41% | 5.4 | 79% | 1.0 |
| 0.6 | 46% | 5.6 | 95% | 1.4 |
| 0.5 | 53% | 5.8 | 98% | 1.7 |
| 0.4 | 66% | 5.9 | 100% | 2.2 |
| 0.3 | 77% | 6.0 | 100% | 2.4 |
| 0.2 | 85% | 6.0 | 100% | 2.6 |
| 0.1 | 91% | 6.0 | 100% | 2.6 |

Sharing rises clearly once α is 0.4 or lower: this is the threshold α* in this space. The threshold depends on the scoop risk ψ = 0.5, which is a guess.

## 5. When sharing is costly or sometimes wrong

Absorbing a published result costs 0.5 compute; proofs are wrong 10% of the time, results built on a wrong result are wrong too, and targets reveal and retract them.

| shared knowledge | traditional frontier | OSO frontier | OSO lead | traditional targets | OSO targets |
| --- | --- | --- | --- | --- | --- |
| free and correct | 2.7 | 6.0 | +3.3 | 0.7 | 2.8 |
| costly to absorb | 2.7 | 5.9 | +3.2 | 0.7 | 2.2 |
| sometimes wrong | 1.0 | 5.8 | +4.8 | 0.2 | 1.3 |
| costly and sometimes wrong | 1.0 | 5.5 | +4.5 | 0.2 | 0.9 |

## What this shows and what it does not

- **It is a simulation** of the [OSO demo specification](https://github.com/open-science-org/OSO/blob/master/docs/demo-model.md): results are abstract, success is chance, and agents follow a formula. It shows how the incentive rules play out *if* this space works as described, not that it does.
- **The parameters are guesses,** especially the success chances, the scoop risk ψ, and the costs and error rates in section 5.
- **By default, sharing is free and always correct,** which favours OSO; section 5 shows how much of the lead survives without that.
- **Notes for this space:** Stage difficulties and bounties are illustrative, not industry figures.

## Reproduce

```sh
npm run sim -- report drug-discovery --seeds 100
```

The space is [sim/spaces/drug-discovery.yaml](../../spaces/drug-discovery.yaml) (written by hand as an example of a new problem space). Every number above is in [data.json](data.json). Generated by the OSO simulator at commit `bf5a855`.
