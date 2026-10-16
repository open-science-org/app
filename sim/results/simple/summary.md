# The simple model: one chain, shared vs. hidden progress

A single chain of 300 results, each with success chance p = 0.2 per attempt; N identical agents; X = 640 attempts in total, one per agent per round. Shared: every result is published and taken up at once. Hidden: nothing is published until the end of the chain, which no one reaches. Measure: the deepest result proved by anyone. The exact values come from sim/analytic.ts.

- **Date:** 2026-10-16
- **Code:** commit `6501aec`
- **Command:** `npm run sim -- simple --seeds 1000 --save`
- **Runs:** 10000 (1000 seeds per row), in `runs.jsonl`; all parameters in `config.json`

Values are mean ± standard deviation over seeds, except in the simple model, where they are mean ± standard error so they can be compared with the exact values.

| N | shared: simulated | shared: exact | hidden: simulated | hidden: exact | gain: simulated | gain: exact |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 128.6 ± 0.3 | 128.0 | 128.6 ± 0.3 | 128.0 | 1.00 | 1.00 |
| 2 | 128.3 ± 0.3 | 128.0 | 67.9 ± 0.2 | 68.0 | 1.89 | 1.88 |
| 4 | 128.4 ± 0.3 | 128.0 | 37.2 ± 0.1 | 37.3 | 3.45 | 3.44 |
| 8 | 128.3 ± 0.3 | 128.0 | 21.3 ± 0.1 | 21.2 | 6.02 | 6.03 |
| 16 | 128.3 ± 0.3 | 128.0 | 12.7 ± 0.0 | 12.7 | 10.14 | 10.11 |
