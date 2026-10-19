# The six rule settings on the Lean problem set's reference tree

The same settings as `settings`, on the real shape of the Lean problem set (42 results in three areas plus cross-area results, 8 targets, bounties by depth) instead of a random tree, with X = 400. Success chances follow the default model by level until the Lean pilot measures them.

- **Date:** 2026-10-17
- **Code:** commit `3b82e1b`
- **Experiment:** [sim/experiments/lean-tree.yaml](../../experiments/lean-tree.yaml)
- **Command:** `npm run sim -- lean-tree --seeds 100 --save`
- **Runs:** 600 (100 seeds per row), in `runs.jsonl`; the full configuration in `config.json`

Values are mean ± standard deviation over seeds.

| setting | frontier | reach L5 | speed | cost | spend | targets solved | breadth | waste | credit | sharing | gamer share of pay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Traditional | 4.4 ± 1.2 | 0.44 | 31 ± 7 | 303 ± 66 | 394 ± 14 | 4.8 ± 1.5 | 0.60 ± 0.19 | 0.53 ± 0.10 | 0.98 ± 0.04 | 0.01 ± 0.02 | 0.89 |
| OSO (immediate) | 7.0 ± 0.0 | 1.00 | 13 ± 3 | 125 ± 32 | 243 ± 59 | 8.0 ± 0.0 | 1.00 ± 0.00 | 0.78 ± 0.05 | 0.73 ± 0.06 | 1.00 ± 0.00 | 0.14 |
| Flow-back, finished-only | 4.3 ± 1.1 | 0.48 | 33 ± 6 | 327 ± 64 | 392 ± 19 | 4.9 ± 1.7 | 0.62 ± 0.21 | 0.55 ± 0.11 | 0.99 ± 0.03 | 0.01 ± 0.02 | 0.86 |
| No flow-back, immediate | 7.0 ± 0.1 | 1.00 | 14 ± 4 | 131 ± 39 | 246 ± 63 | 8.0 ± 0.1 | 1.00 ± 0.02 | 0.77 ± 0.06 | 0.59 ± 0.08 | 1.00 ± 0.00 | 0.15 |
| No flow-back, choice | 4.9 ± 1.2 | 0.67 | 31 ± 7 | 301 ± 74 | 386 ± 33 | 5.9 ± 1.4 | 0.73 ± 0.18 | 0.59 ± 0.13 | 0.84 ± 0.09 | 0.35 ± 0.05 | 0.68 |
| OSO (choice) | 5.2 ± 1.2 | 0.76 | 28 ± 8 | 273 ± 77 | 372 ± 54 | 6.3 ± 1.3 | 0.79 ± 0.17 | 0.62 ± 0.13 | 0.84 ± 0.08 | 0.42 ± 0.06 | 0.53 |
