<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [oxydex, ecgdex, ppgdex, pulsedex, cpapdex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
The personal-baseline behind `baseline.zLatest` was computed **unweighted** — `mean(prior)` / `sd(prior)` — while the centre it is compared against, `central.mean`, is coverage-weighted. A near-empty night therefore moved the baseline as though it were a full night; and because a wild value on that night also **inflates** the baseline SD, the newest night's z was pulled toward zero twice over.

The same spec breach as §9.1, in the same five cloned modules: `CROSSNIGHT-ENVELOPE-SPEC` §3 requires low-quality items be "down-weighted in **every** fit/aggregate via `weight`". Fixed by routing the prior slice and its weights through the `wsd()` added for §9.1, so the baseline now shares the centre's weighting.

**This is not a rounding difference — it changes whether the user is alerted.** Reproducing the audit's own figure: prior meanSpo2 `[95,95,95,60]` at coverage `[100,100,100,6]`, newest night 80 at full coverage.

| | baseline mean | baseline sd | `zLatest` | flagged (`\|z\| ≥ 1`) |
|---|---|---|---|---|
| unweighted (old) | 86.25 | 17.50 | **−0.36** | no |
| weighted (new) | 94.31 | 5.89 | **−2.43** | yes |

A genuine −2.4σ night read as ordinary because one 6 %-coverage night sat in the prior. The pre-fix code did not merely understate the event; it declined to raise it.

Mutation-verified: reverting to `mean`/`sd` reproduces exactly 86.25 / 17.5 / −0.36 (unflagged). Export-inert — **proven**: uniform weights make the weighted form an exact identity, so all 10 re-verified fixtures reproduced byte-identical, including `cpapdex_synthetic_multinight_golden`, which carries a real crossNight block. Five bundles rebuilt.

Completes two thirds of punch-list #12 (§9.1 + §9.2). **§9.3 remains open** — `trendLabel` takes direction from OLS but significance from Mann–Kendall, which is a different class of defect (an estimator-precedence decision, not a weighting one) and is deliberately not bundled in here.
