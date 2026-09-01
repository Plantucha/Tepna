<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---
The residual 2.2–13.2 ms spread, decomposed against a pre-registered design — three candidates die,
one survives cross-night, and the last conjunct is data-blocked by a disk failure.

**Pre-registration first, committed before measurement** (candidates C1–C5, signatures, closed
decision rules — the window-sweep discipline). Then the measurement, phone tree primary (n=15):
the estimand reproduces (worst-pair IQR 2.23–13.71 ms), **C4 alternation is refuted outright** (no
pair-night at r1 ≤ −0.3; r1 skews +0.78 — the difference WANDERS, it does not alternate), **C3
motion-via-yield is refuted as instrumented** (yield 99–100 % everywhere — no dynamic range), and
**C1's white-noise/slope physical model is refuted as THE explanation** — its rank correlation is
real (ρ = +0.789) but its predicted magnitude is ~150× too small (sd/c1 = 68–282), so the
dispersion is in-band noise, not sample-level noise through the slope. **C2 amplitude-to-noise
passes cross-night at ρ = −0.861.** Box tree secondary (n=45): same directions, none at bar.

**Neither survivor is promoted to "explains":** rule 1's within-night slope-tertile conjunct was
mid-flight when the `data` USB volume — the only local phone-tree copy — threw Buffer I/O errors
with lost async page writes and dropped (kernel log 10:21). The owner was notified; remounting a
disk that just lost writes is not a session call. The box stays open as bounded + partially
decomposed, with the within-night probe (`--within`, built and selftested) as the one remaining
step, runnable from a safe corpus copy.

**Tooling:** `tools/ppg-foot-residual-sweep.mjs` — same-beat pairwise dispersion with the C1–C4
predictors, consensus-forced polarity, both corpus layouts, cross-night Spearman table, per-skip
reasons (no silent filters), and a `--within` beat-level probe; 20-check selftest, which caught the
first noise estimator reading the diastolic slope instead of the noise (replaced by
second-difference MAD, Var = 6σ²). C2's named instrument `channelSNR` turned out to be unexported
from PPGDSP — `pat-per-led.mjs`'s guarded read has printed n/a since it was written; substituted
in-tool with the amplitude-to-noise ratio, recorded in brief and tool header.
