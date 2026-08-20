<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: JOINT-UNWRAP-ATTEMPT-FOLLOWUPS-2026-08-08-BRIEF.md
---

Answer JOINT-UNWRAP's covariate question with a measured negative, and add the tool that measured it.

`tools/unwrap-night-covariates.mjs` (18 selftest assertions) tests what distinguishes a lockable night
from an un-lockable one: **16 covariates over 54 trio nights**, at two block lengths — 900 s and the
brief's own 300 s — with the estimator held FIXED, because §2 is explicit that another sweep is not the
answer. Each covariate carries a percentile-bootstrap CI on both a Spearman rho against the continuous
scatter and the between-population AUC, Holm-corrected across the family, with per-population medians
printed side by side. The bootstrap is a seeded mulberry32: a resampling CI that moves between runs
cannot be gated.

**Result: nothing separates, in either arm.** The four NAMED candidates are flat — slip rate rho 0.04 /
−0.01, coverage −0.09 / −0.04, posture 0.20 / 0.15, off-body 0.26 / 0.20, every CI spanning zero, every
Holm-adjusted p 1.000. §3's negative branch is recorded and the brief is DONE. No unwrap is shipped or
proposed; §7 keeps that out of scope until a night can be classified before the fit.

⚠️ **The negative is reported WITH ITS POWER, because the two populations did not reproduce.** §1
describes about half the nights at 700–950 ms; on this corpus **50 of 54 sit under the 450 ms bar at a
median of 119 ms**, leaving n=4 un-lockable (5 at 300 s). Every AUC CI is correspondingly wide — the
widest spans 0.05→0.78 — so this is *"not detectable at this contrast"*, not *"refuted"*. Nothing was
tuned to produce that: same estimator, same scatter definition, the brief's own split.

**Two method findings outlived the question.**

1. **A zero-inflated variable summarised centrally reads as "no signal".** Posture — a NAMED candidate
   — was first summarised as the median per-epoch `motionIndex`, which is **0 on all 54 nights** because
   a sleeping body is still for most epochs. It reported `constant across nights` and would have retired
   a named candidate on an artefact of the summariser; the per-epoch series carries 38–39 distinct values
   spanning 0–100. `motionP90` (IQR 24.2, 54 distinct) is a real test where the median was a dead row.
   The tool now prints each covariate's modal share · distinct count · IQR · range beside its p and names
   any where ≥50 % of nights share one value, so a null can be read as "no contrast to test" where that
   is what it means (`coverageEcgPct` 54 %, `ledAgreementPct` 56 %).
2. **The endpoint itself is now in doubt.** The one covariate that moves is capture provenance, and its
   sign is backwards: box nights (`device+host`, a genuinely independent host clock) score WORSE than
   phone nights — 161 ms vs 93 ms at 900 s. `CLAUDE.md` §7 predicts exactly that if a phone recording's
   host column is the device stamp rounded, "the absence of a measurement wearing the shape of one". If
   so, per-block scatter partly measures capture mode rather than lockability and the population split is
   contaminated at its root — which would also explain the missing upper population, since 25 of 54
   nights are phone. NOT established (Holm 0.104; cross-tab 3/29 box vs 1/25 phone) and deliberately
   carried to `JOINT-UNWRAP-ATTEMPT-FOLLOWUPS-II-2026-08-20-BRIEF.md` rather than concluded. §1.1 there
   names the settling test, and it needs no new data: recompute on the 29 box nights alone.

`--from-json [--dir]` re-renders a saved run's statistics without recomputing the scatter (~34 s per
night of `fitClockDrift`, against milliseconds for the statistics), re-deriving covariates against the
saved scatter. That is what made fixing `motionMed` cost seconds instead of an hour — the difference
between a measurement that gets re-examined and one that does not. The saved `results` are ignored and
recomputed, so a re-render reflects the current statistics code rather than replaying old conclusions.
