# All together on the Lean tree: learning, shared failures, costly and fallible sharing

The Lean reference tree; every agent learns from failure (learning oracle, gain 0.1). Knowledge is either free and always correct, or costly (absorbCost 0.25) and fallible (errorRate 0.05). OSO is run with and without publishing failed attempts.

- **Date:** 2026-10-17
- **Code:** commit `3b82e1b`
- **Experiment:** [sim/experiments/complex.yaml](../../experiments/complex.yaml)
- **Command:** `npm run sim -- complex --seeds 100 --save`
- **Runs:** 800 (100 seeds per row), in `runs.jsonl`; the full configuration in `config.json`

Values are mean ± standard deviation over seeds.

| knowledge | setting | frontier | reach L5 | speed | cost | spend | targets solved | absorb spend | rejected targets | retracted | sharing | credit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| free and correct | Traditional | 5.6 ± 1.4 | 0.81 | 30 ± 7 | 294 ± 67 | 383 ± 40 | 6.2 ± 1.5 | 0.00 ± 0.00 | 0.0 ± 0.0 | 0.0 ± 0.0 | 0.01 ± 0.02 | 0.98 ± 0.04 |
| free and correct | OSO (immediate) | 7.0 ± 0.0 | 1.00 | 12 ± 3 | 114 ± 32 | 194 ± 42 | 8.0 ± 0.0 | 0.00 ± 0.00 | 0.0 ± 0.0 | 0.0 ± 0.0 | 1.00 ± 0.00 | 0.74 ± 0.07 |
| free and correct | OSO + public failures | 7.0 ± 0.0 | 1.00 | 10 ± 2 | 96 ± 25 | 153 ± 24 | 8.0 ± 0.0 | 0.00 ± 0.00 | 0.0 ± 0.0 | 0.0 ± 0.0 | 1.00 ± 0.00 | 0.73 ± 0.06 |
| free and correct | OSO (choice) | 6.2 ± 1.2 | 0.92 | 25 ± 8 | 248 ± 76 | 330 ± 81 | 7.3 ± 1.2 | 0.00 ± 0.00 | 0.0 ± 0.0 | 0.0 ± 0.0 | 0.42 ± 0.05 | 0.88 ± 0.08 |
| costly and fallible | Traditional | 5.1 ± 1.4 | 0.66 | 31 ± 8 | 301 ± 76 | 384 ± 39 | 5.6 ± 1.6 | 0.12 ± 0.06 | 1.2 ± 1.1 | 1.7 ± 1.9 | 0.01 ± 0.02 | 0.99 ± 0.01 |
| costly and fallible | OSO (immediate) | 6.9 ± 0.4 | 1.00 | 16 ± 7 | 159 ± 69 | 257 ± 80 | 7.8 ± 0.7 | 0.42 ± 0.07 | 1.8 ± 1.3 | 2.6 ± 2.5 | 0.93 ± 0.07 | 0.89 ± 0.11 |
| costly and fallible | OSO + public failures | 6.9 ± 0.4 | 1.00 | 16 ± 7 | 158 ± 65 | 259 ± 80 | 7.9 ± 0.5 | 0.42 ± 0.07 | 2.1 ± 1.7 | 3.5 ± 3.1 | 0.91 ± 0.08 | 0.88 ± 0.11 |
| costly and fallible | OSO (choice) | 5.4 ± 1.3 | 0.78 | 27 ± 9 | 261 ± 86 | 352 ± 77 | 6.2 ± 1.6 | 0.25 ± 0.09 | 1.4 ± 1.1 | 2.2 ± 2.5 | 0.41 ± 0.06 | 0.90 ± 0.08 |
