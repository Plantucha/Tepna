<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---
The residual 2.2–13.2 ms spread closes under a pre-registered design: bounded, unexplained, all
four candidates refuted — and PPG-FOOT-PLACEMENT is DONE.

**Pre-registration first, committed before measurement** (candidates C1–C5, signatures, closed
decision rules — the window-sweep discipline). Then the measurement on the CANONICAL phone corpus
(`/srv/data/tepna-corpus/uploads/Ecg nightly`, n=31 of 32 dates): estimand 1.84–13.71 ms worst-pair
IQR; **C1 noise/slope ρ=+0.683, C2 amplitude/noise ρ=−0.694, C3 yield ρ=−0.698 — all under the
pre-stated 0.7 bar — and C4 alternation absent outright** (no pair-night at r1 ≤ −0.3 across 31
phone + 45 box nights). C1's physical model is also ~140× too small in magnitude (sd/c1 62–282),
and the within-night slope-tertile conjunct holds on only 8/18 pair-nights with both extremes at
0/3. **Rule 3 closes the box: bounded, unexplained, refuted with measurements** — three correlated
near-misses at 0.68–0.70 are recorded as one latent factor, not argued over the line.

**Two integrity finds along the way, both recorded in §5:** the first run measured a stale,
incomplete sdb1 mirror (June-only, n=15) that read C1/C2 ABOVE bar (+0.789/−0.861) — the canonical
re-run caught the flattery — and that USB volume then failed with lost async page writes
(owner notified, nothing remounted). And C2's named instrument `channelSNR` turned out to be
un-exported from PPGDSP — `pat-per-led.mjs`'s guarded read has printed n/a since it was written;
substituted in-tool (amplitude/noise), recorded before any predictor table was seen.

**The parent brief flips to DONE** (every box closed: bar re-stated+met, CFD rejected #2037,
residual closed) and spawns `PPG-FOOT-PLACEMENT-FOLLOWUPS-2026-09-01`: the slow-wander seed
(r1 to +0.78 — the dispersion is coherent over many beats, no per-beat mechanism), the
channelSNR export-or-delete, the latent-factor design constraint, and the sdb1/mirror owner call.

**Tooling:** `tools/ppg-foot-residual-sweep.mjs` — same-beat pairwise dispersion with the C1–C4
predictors, consensus-forced polarity, both corpus layouts, per-skip reasons (no silent filters),
`--within` beat-level probe, cross-night Spearman table; 20-check selftest, which caught the first
noise estimator reading the diastolic slope instead of the noise (replaced with second-difference
MAD, Var = 6σ²).
