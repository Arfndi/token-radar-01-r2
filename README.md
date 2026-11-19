# Token Radar — radar-3 (round 3)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Arfndi/token-radar-01-r2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Arfndi/token-radar-01-r2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A ranked board of the pre-token protocols in the sealed DefiLlama snapshot of
14 November 2026, each scored by the expected value its token would carry if
the protocol's record stayed as it is. The board holds 200 rows: the 40
protocols on the watchlist (no token, at least $50M of TVL) and 160 early
protocols below that floor. Every row carries a seven-step farm plan for the
protocol as it stands, and a rank range from 20 bootstrap refits of the model.

Nothing here predicts that a token will issue, or when. A protocol records no
token; the board never claims it has none. The implied value is this entry's
own claim from the snapshot's figures.

## The model — radar-3

Expected value = implied value × launch odds, where the implied value is
TVL × size-curve multiple × growth multiplier × maturity multiplier.

- **Size curve.** An OLS fit of log(mcap / TVL) on log(TVL) over the 128
  live-token protocols: log(mcap/TVL) = 6.9646 − 0.4777 · log(TVL). Small
  protocols trade at far higher multiples than large ones, and the curve
  recovers that; round 1's category-median multiple hid it. A per-category
  median-residual offset (shrunk by n / (n + 10), for categories with at
  least three live protocols) bends the curve toward the categories that
  trade rich or cheap. The multiple is clamped to [0.05, 1.5]; the band
  binds on only 4 of 200 rows.
- **Growth.** The 7-day TVL change enters at weight 0.20, clamped to
  [-30%, +50%]. The snapshot shows no growth premium — the 7-day change
  correlates -0.15 with the multiple, mechanically, because the multiple
  already divides by TVL — so the weight is a disclosed prior, cut from
  round 1's 0.60.
- **Maturity.** 0.92 to 1.00 over 730 days; a protocol with no listing date
  is treated as 180 days old. Age carries no signal in the snapshot (the
  correlation with the multiple is -0.00), so the range is narrow on
  purpose: it breaks near-ties toward the older protocol without letting
  age dominate value.
- **Launch odds.** Each category's live-token rate over all 758 protocols
  in the snapshot, shrunk toward the global rate of 0.5488 with strength
  10, clamped to [0.10, 0.95]. Categories with fewer than three protocols
  use the global rate. The odds are population rates, not a fit on the
  live rows, so they do not leak the fitted set. They are stored at full
  precision on the board, and the entrypoint re-derives every row before
  writing anything.
- **Rank ranges.** 20 bootstrap refits of the size curve (mulberry32, seed
  20261114) on resamples of the 128 live rows; the p10 and p90 of the
  ranks a protocol takes across the refits.

## Validation

Held out, in log-mcap space, against round 1's model (radar-2) on the same
splits:

| Split | radar-2 medAE | radar-3 medAE | radar-2 MAE | radar-3 MAE | radar-2 ρ | radar-3 ρ |
| --- | --- | --- | --- | --- | --- | --- |
| 5-fold CV (n=128) | 1.605 | **1.241** | 1.903 | **1.618** | 0.403 | 0.374 |
| Time split (n=48) | 1.656 | **1.102** | 1.981 | **1.606** | 0.252 | 0.321 |

The 5-fold split is the snapshot index modulo 5; the time split trains on
the 47 older protocols that carry a listing date and tests on the 48 most
recently listed. The prediction is log(TVL) plus log(multiple) — growth and
maturity are ranking adjustments, not part of the value prediction. The
numbers are computed at run time and shown on the dashboard.

## Run it

Run with Node, not Bun: the two engines differ in the last ulp of
`Math.exp` and `Math.log`, and the byte-identical outputs this entry
promises are the ones Node's V8 produces. Node 22 or later, standard
library only, no dependencies.

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The input may be the snapshot file itself or a directory holding
`snapshot.json`. The output holds:

- `board.json` — the 200 ranked rows, ranks 1..200, implied values
  non-increasing with rank.
- `data.js` — the dashboard's data as `window.RADAR`.
- `dashboard/` — the board's interactive page (index, styles, script).
- `screenshots/` — three captures of the dashboard (board, one detail
  row, one filtered view).
- `dossier.json` — the dossier: the dashboard source embedded as fenced
  code blocks, and the screenshots as base64 images with sha256 digests.

The entrypoint refuses to write anything if a board row does not re-derive
exactly from the snapshot and the model, or if the board fails the shape
checks (200 rows, ranks 1..200 once each, every watchlist slug present,
farm steps of 3 to 12 strings of 20 to 600 characters).

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
