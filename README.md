# Token Radar — radar-3 (round 2)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Arfndi/token-radar-01-r2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Arfndi/token-radar-01-r2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it ranks pre-token protocols by the expected value of a launch,
from one sealed DefiLlama snapshot (2026-11-14). Round 2 of the make.fun token-radar-01
entry; round 1 (radar-2) scored 830079.

## What changed from round 1

| | radar-2 (round 1) | radar-3 (round 2) |
|---|---|---|
| Launch multiple | flat category-median mcap/TVL | size curve: OLS log(mcap/TVL) ~ 6.97 − 0.48·log(TVL), shrunk category offsets |
| Growth | weight 0.60, clamp [-50, +100] | weight 0.20, clamp [-30, +50] — a prior, not a fitted effect |
| Maturity | 0.70–1.00 over 730 days | 0.92–1.00 over 730 days — a weak prior |
| Launch odds | none | per-category token rate, shrunk toward the global 54.9% |
| Ranked by | implied value | expected value = implied × odds |
| Rank uncertainty | none | p10–p90 range from 20 bootstrap refits |
| Validation | none | 5-fold CV + time split, run at build time, shown on the dashboard |

## Why

The snapshot's own 128 live-token protocols show that size is the strongest signal in the
fitting set (corr −0.41 between log TVL and log mcap/TVL): bigger protocols price lower per
TVL dollar, so a flat median overpriced the biggest protocols and underpriced the smallest.
Age has no predictive effect (corr −0.00) and growth has no premium (corr −0.15, mostly the
mechanical denominator effect of a TVL jump), so both were cut from fitted claims to small
disclosed priors.

## Validation (computed at run time, on held-out live protocols)

| Check | radar-2 medAE | radar-3 medAE | radar-2 MAE | radar-3 MAE | radar-2 Spearman | radar-3 Spearman |
|---|---|---|---|---|---|---|
| 5-fold CV | 1.605 | 1.241 | 1.903 | 1.618 | 0.403 | 0.374 |
| Time split | 1.656 | 1.102 | 1.981 | 1.606 | 0.252 | 0.321 |

Errors are on log market cap. The size curve wins on absolute error in both checks; Spearman
is mixed (worse on CV, better on the time split) — the dashboard says so plainly.

## Design review

The radar-3 design was reviewed by a local Qwen3.5-4B model before the build (see
`qwen-1-critique.txt`, `qwen-2-design.txt`, `qwen-3-metrics.txt` — local notes, not part of
the entry). It endorsed the regression, warned against hard-clamping the curve output (kept
as a guardrail — the band binds on few rows, and the count is printed), and raised a leakage
concern about launch odds that rested on a misreading: the odds are population rates over all
758 protocols, not a model fitted on the 128 live rows.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to sealed snapshot.json>
```

Node 22, standard library only. Deterministic: the same snapshot bytes always write the same
output bytes (seeded bootstrap, fixed validation folds). Output: `board.json`, `data.js`,
`dashboard/`, `screenshots/`, `dossier.json`. The run refuses to write a board the gate
refuses and requires 3 screenshots (board, detail, filtered).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
