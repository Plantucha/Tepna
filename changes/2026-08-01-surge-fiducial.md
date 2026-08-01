<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [ECGDex, PpgDex]
brief: POOLED-CLOCK-FIT-FOLLOWUPS-2026-07-31-BRIEF.md
---
`POOLED-CLOCK-FIT-FOLLOWUPS` §1 found `autonomic_surge → movement_onset` strongly coupled across 29 of 30 nights but with a **bimodal** latency — +10 s and −20 s, and a pronounced hole at simultaneity (**10 of 992** deltas within ±5 s). It tested three explanations, rejected all three correctly, and declined to guess.

The mechanism was a fourth one nobody had, because the stamp's meaning was undocumented. **`autonomic_surge` stamps the bradycardia TROUGH** that opens a CVHR cycle; the tachycardic rebound the event is *named* for occurs `periodSec` later — median 20 s, IQR 17–28. `detectCVHR` computes both (`s` and `pkAt`) and stamps `s`.

Re-measuring the identical pair on the identical 30 nights, changing only which instant the anchor uses, collapses the distribution to **one mode**: **330 of 915** deltas within ±5 s, **36.1 %** against 1.0 %. The hole at zero existed *because* of the wrong fiducial — the true partner is never near zero under the trough stamp, so nearest-neighbour matching kept picking the neighbouring movement.

**`tMs` is unchanged**: the trough is the correct CVHR fiducial and the stamp is a published contract. `meta.peakTMs` publishes the rebound alongside it, so any cross-channel latency can name the instant it used. `movement_onset` is now documented too — it stamps a jerk local **maximum**, the peak of a burst rather than its start.

`CROSS-DEVICE-CLOCK-SKEW` §2d amended: its "latency that changes sign" language is withdrawn. The ladder is **still not rewritten** — it was inferred under a deprecated estimator, and swapping one asserted ordering for another would repeat the original mistake — but the obstacle to measuring it is gone.
