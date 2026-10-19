# Sharing isn't free: absorbing costs and wrong results

Taking up a published result costs `absorbCost` compute, and each proof is wrong with chance `errorRate`; results built on a wrong result are wrong, and a target check rejects them and retracts the wrong results. Where does OSO's advantage shrink or vanish? Default world.

- **Date:** 2026-10-17
- **Code:** commit `3b82e1b`
- **Experiment:** [sim/experiments/costly-sharing.yaml](../../experiments/costly-sharing.yaml)
- **Command:** `npm run sim -- costly-sharing --seeds 100 --save`
- **Runs:** 2400 (100 seeds per row), in `runs.jsonl`; the full configuration in `config.json`

Values are mean ± standard deviation over seeds.

| setting | absorb cost | error rate | frontier | reach L7 | cost | spend | targets solved | absorb spend | rejected targets | retracted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Traditional | 0 | 0 | 5.7 ± 1.2 | 0.35 | 957 ± 161 | 1194 ± 11 | 4.2 ± 0.9 | 0.00 ± 0.00 | 0.0 ± 0.0 | 0.0 ± 0.0 |
| Traditional | 0 | 0.05 | 5.1 ± 1.0 | 0.15 | 1061 ± 122 | 1194 ± 2 | 3.6 ± 0.9 | 0.00 ± 0.00 | 1.4 ± 1.2 | 3.6 ± 3.7 |
| Traditional | 0 | 0.15 | 4.5 ± 0.9 | 0.02 | 989 ± 234 | 1194 ± 2 | 3.0 ± 0.8 | 0.00 ± 0.00 | 3.9 ± 1.9 | 9.8 ± 5.8 |
| Traditional | 0.25 | 0 | 5.5 ± 1.1 | 0.27 | 975 ± 167 | 1194 ± 7 | 4.1 ± 0.9 | 0.04 ± 0.01 | 0.0 ± 0.0 | 0.0 ± 0.0 |
| Traditional | 0.25 | 0.05 | 5.1 ± 1.0 | 0.12 | 954 ± 114 | 1195 ± 1 | 3.6 ± 0.9 | 0.04 ± 0.01 | 1.6 ± 1.4 | 3.7 ± 3.8 |
| Traditional | 0.25 | 0.15 | 4.5 ± 0.9 | 0.01 | 895 ± 0 | 1195 ± 1 | 3.0 ± 0.9 | 0.03 ± 0.01 | 3.7 ± 2.0 | 9.4 ± 6.1 |
| Traditional | 0.5 | 0 | 5.7 ± 1.1 | 0.35 | 996 ± 134 | 1193 ± 11 | 4.2 ± 0.9 | 0.09 ± 0.03 | 0.0 ± 0.0 | 0.0 ± 0.0 |
| Traditional | 0.5 | 0.05 | 5.2 ± 1.0 | 0.15 | 976 ± 192 | 1192 ± 30 | 3.6 ± 0.9 | 0.08 ± 0.03 | 1.6 ± 1.3 | 3.9 ± 3.8 |
| Traditional | 0.5 | 0.15 | 4.4 ± 1.0 | 0.01 | 585 ± 0 | 1192 ± 30 | 2.9 ± 1.0 | 0.05 ± 0.02 | 3.6 ± 1.9 | 10.0 ± 6.0 |
| Traditional | 1 | 0 | 5.5 ± 1.1 | 0.30 | 1009 ± 170 | 1195 ± 2 | 4.0 ± 0.9 | 0.15 ± 0.04 | 0.0 ± 0.0 | 0.0 ± 0.0 |
| Traditional | 1 | 0.05 | 5.2 ± 0.9 | 0.14 | 1008 ± 128 | 1194 ± 2 | 3.7 ± 0.8 | 0.13 ± 0.04 | 2.3 ± 1.5 | 4.6 ± 3.9 |
| Traditional | 1 | 0.15 | 4.5 ± 1.0 | 0.03 | 1070 ± 74 | 1194 ± 2 | 3.0 ± 0.9 | 0.10 ± 0.04 | 5.4 ± 2.2 | 12.4 ± 6.5 |
| OSO (immediate) | 0 | 0 | 7.9 ± 0.2 | 1.00 | 485 ± 141 | 849 ± 207 | 6.9 ± 0.5 | 0.00 ± 0.00 | 0.0 ± 0.0 | 0.0 ± 0.0 |
| OSO (immediate) | 0 | 0.05 | 7.6 ± 0.5 | 1.00 | 568 ± 178 | 1061 ± 188 | 6.1 ± 1.0 | 0.00 ± 0.00 | 3.2 ± 2.0 | 9.2 ± 6.8 |
| OSO (immediate) | 0 | 0.15 | 7.2 ± 0.5 | 0.96 | 629 ± 188 | 1183 ± 49 | 4.9 ± 1.0 | 0.00 ± 0.00 | 7.0 ± 2.2 | 20.8 ± 8.1 |
| OSO (immediate) | 0.25 | 0 | 7.8 ± 0.4 | 1.00 | 627 ± 173 | 1020 ± 187 | 6.5 ± 0.8 | 0.17 ± 0.03 | 0.0 ± 0.0 | 0.0 ± 0.0 |
| OSO (immediate) | 0.25 | 0.05 | 7.4 ± 0.5 | 0.99 | 675 ± 222 | 1121 ± 152 | 5.5 ± 1.2 | 0.16 ± 0.03 | 2.8 ± 1.8 | 7.4 ± 6.2 |
| OSO (immediate) | 0.25 | 0.15 | 7.1 ± 0.5 | 0.92 | 781 ± 215 | 1192 ± 20 | 4.4 ± 0.9 | 0.16 ± 0.02 | 5.6 ± 2.1 | 16.5 ± 8.5 |
| OSO (immediate) | 0.5 | 0 | 7.7 ± 0.5 | 0.99 | 626 ± 228 | 1007 ± 217 | 6.2 ± 1.1 | 0.33 ± 0.07 | 0.0 ± 0.0 | 0.0 ± 0.0 |
| OSO (immediate) | 0.5 | 0.05 | 7.2 ± 0.6 | 0.92 | 679 ± 261 | 1128 ± 151 | 5.3 ± 1.2 | 0.31 ± 0.05 | 2.6 ± 1.7 | 7.0 ± 6.1 |
| OSO (immediate) | 0.5 | 0.15 | 7.0 ± 0.6 | 0.84 | 759 ± 250 | 1188 ± 34 | 4.3 ± 1.0 | 0.31 ± 0.03 | 5.8 ± 2.2 | 16.5 ± 7.8 |
| OSO (immediate) | 1 | 0 | 7.3 ± 0.7 | 0.87 | 663 ± 260 | 1076 ± 200 | 5.4 ± 1.4 | 0.41 ± 0.03 | 0.0 ± 0.0 | 0.0 ± 0.0 |
| OSO (immediate) | 1 | 0.05 | 6.8 ± 0.7 | 0.72 | 695 ± 250 | 1182 ± 68 | 4.3 ± 1.2 | 0.41 ± 0.03 | 2.5 ± 1.6 | 6.3 ± 5.5 |
| OSO (immediate) | 1 | 0.15 | 6.6 ± 0.6 | 0.62 | 744 ± 255 | 1186 ± 56 | 3.4 ± 1.1 | 0.41 ± 0.02 | 5.5 ± 2.2 | 14.1 ± 6.9 |
