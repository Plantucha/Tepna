---
bump: minor
type: changed
brief: O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md
---

**`pat-buzz-stability.mjs` repurposed — from an acquisition instrument waiting for a capture into the
drift-vs-noise decomposition the existing captures needed; run on real data, with a computed capture
prescription.**

The first version duplicated onset detection and waited for a cross-device capture that had in fact
already been made and analysed (`buzz-onset-extract.mjs`, brief §5). Repurposed: it now imports that
tool's primitives and computes what nobody had — the decomposition of §5b's per-event scatter into
DRIFT (OLS slope ± SE, von Neumann ratio) vs NOISE (residual SD), judged against the ΔPAT dip index's
pre-stated budget (15 ms / 60 s window).

Measured (morning motor-60 calibration, cmd→H10, n=5/16 s and n=8/29 s): **von Neumann 2.18 / 1.21 —
white-noise signature; slope unresolved (−233 ± 238, then 150 ± 116 ms/min)**. The scatter is
noise-consistent, which is the good outcome for the dip index — but the burst geometry structurally
cannot bound drift at the 15 ms scale, and the tool says so honestly (charges |slope|+2·SE, flags
UNRESOLVED) instead of reporting a false verdict either way. New `requiredSpanS` computes the capture
prescription: with σ≈50 ms, ~10 fires spread over ~7–8 min of one connection resolve the question.
Recorded in the brief as §5d, including the two command-list exclusions the raw log forces (the solo
pre-test fire; the motor-40/20 sweep fires whose spurious xcorr locks pass the r floor).

15 selftest assertions (white→unresolved, ramp→recovered+SWAMPED, planted-offset recovery,
silent-device refusal, prescription bounds). Analysis tool + brief only.
