<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: FABRICATED-DEFAULTS-FLEET-2026-08-16-BRIEF.md
---
Brings the brief's §7 Done-when in line with what is verified, and rescopes its one deferred item
from a warning into a two-line fix with a measured reachability.

**Four of six items closed and marked, each verified against `main` rather than from memory:** every
site refuses and every consumer tolerates it (ECGDex #1397 · OxyDex #1402 · PpgDex #1464); PpgDex
`cvhrFromNN` fixed with ECGDex `detectCVHR`; OxyDex's quintile labels refuse; registry tiers untouched.

**Two remain open, and the brief now says so honestly** rather than reading as nearly-done.

**§7 item 5 was much broader than the defect.** It said *"`std` / `median` / `quant` returning `0` on
empty or `<2` input — used throughout, highest blast radius."* Measured: `mean` and `median` already
return `NaN`, and GlucoDex's `quantile` already returns `null`. The defect is **`std` alone, in two
files** — `ppgdex-dsp.js:87` and `hrvdex-dsp.js:931`. The sample standard deviation of one observation
is undefined (`n − 1 = 0`), so `0` claims *"no variability"* from data that cannot support it; an SDNN
of 0 ms reads as a perfectly regular heart.

**Reachability: latent, 0 of 132.** No real node-export (corpus-trio + trio-all) carries an exact-zero
`sdnn`, `rmssd` or `sdnnIndex`. The query was checked before the count was believed — `hrv.time.sdnn`
resolves in 26 of 39 sampled files, the other 13 being OxyDex exports with no HRV block, with sample
values 50.2 / 159.9 / 61.

So the item stays last, but for a corrected reason: not because the blast radius is unknown, but
because it is real while the defect is latent. That is a different trade from the one the line
originally described.

One clarification worth keeping: `oxydex-dsp.js:6266` still returns `{ sbii: 0, sbiiQ: 'Q1(low)' }`
**deliberately**. `!nadirEvents.length` on a night with enough data is a genuine measured absence of
instability, not an absence of measurement — and this brief exists because those two are different.

Docs only.
