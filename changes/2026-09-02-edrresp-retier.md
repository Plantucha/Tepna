<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [ecgdex]
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
`edrResp` (EDR respiration rate) re-tiered **emerging → experimental** — adjudicated against an
external reference instead of left on the sentence that it was "probably also experimental"
(DEEP-AUDIT-VI-FOLLOWUPS §1.5, the sibling of #1455's `rraccRate` re-tier).

**The brief's premise was stale.** It recorded that adjudication "needs a reference the corpus
lacks". Measured: 33 nights carry both a raw `_ECG.txt` and a CPAP `*BRP.edf`, and 24 pass a
pre-registered overlap rule (≥4 h AND ≥60 % of the shorter recording). n = 22 after excluding 2
fallback nights.

**Bands frozen before the run** (MAE ≤1.5 br/min, LoA width ≤6, r ≥0.50; the failing axis decides):
MAE **1.90**, bias −1.01, LoA **[−5.80, +3.78] width 9.58**. Two axes fail. `r` is deliberately NOT
cited — the reference's between-night SD is 0.54 br/min, so a correlation is range-restricted by
construction and would be evidence about the design, not the estimator.

**The decisive control:** a CONSTANT 15.0 br/min — this metric's own hardcoded fallback — scores
MAE **0.80** against the same reference; a constant 15.8 scores 0.42. The estimator is beaten by the
constant it falls back to, carries ~5× the reference's spread (2.50 vs 0.54), and misses to 7.4 and
20.0 br/min against a truth that never leaves 14.8–16.8. That is `experimental` = "directional only".

**Reference chosen by a pre-registered kill-switch, not by results:** `detectBreaths().breathRate`
was rejected *before* any agreement number because it divides by wall duration while every sibling
ventilation metric beside it is mask-on filtered; the device's own mask-on `RespRate.2s` replaced it.
That rejection is spun out as brief line 1.9, and the un-flagged `respFromEDR` fallback constant as
1.10 — neither fixed inside a grading unit.

**Deliberately NOT re-graded:** the sibling `respRate` (registry line 54) is a different estimator
(per-epoch median, not whole-record autocorrelation) and is what the Reference guide's 'Resp Rate'
card maps to. It keeps `emerging` until measured on its own.

Registry-only change: no DSP, no bundle behaviour, no fixture. `evidence` is read by the badge
engine at render time.
