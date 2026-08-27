---
bump: patch
type: changed
brief: CLOCK-LEG-SIGN-CONTRADICTION-2026-08-27-BRIEF.md
---

A second fragment pair on 2026-08-13 reframes the whole question: **leg C contradicts itself within a
night.**

The night carries a second matched pair (H10 `…203006`, Verity `…203037`, 31 s apart, 166.5 min each,
host legs −20.4 / −26.8 ⇒ prediction +6.4). Leg C reads **+26.6 ppm ± 14.4** there — consistent with its
prediction at 1.4σ — against **−13.5 ± 5.0** on the later pair, which misses by 3.94σ. **The two leg-C
estimates are 40.1 ppm apart, 2.6σ from each other, same night and same devices.** The host legs are
stable across both windows (−20.1/−20.4 and −26.4/−26.8): of the two methods, the one that reproduces is
the one that was being doubted.

🔑 **New hypothesis 5, now leading: leg C fits a slope through the SAWTOOTH.**
`PAT-SAWTOOTH-ANSWERS-THE-130MS` (#1131) established the ECG↔PPG offset as a sawtooth of peak-to-peak
≈ one RR (821–1162 ms) that ramps for tens of minutes and wraps. Leg C's observable *is* that offset and
its method is a least-squares slope through it — which measures which portion of the ramp a fragment
covered, not a crystal. With no new parameter it predicts everything observed: fragment-dependence within
a night, ~100 ms wandering residuals, occasional sign inversion, and quiet nights looking clean
(2026-07-20: 7 ms scatter, 0.27σ agreement).

This **subsumes the original sign flip as a symptom**, demotes the mid-night-event and sign-convention
hypotheses, and means the AR(1) correction recorded earlier is still insufficient — a sawtooth is not
AR(1) noise, which is how a 3.94σ "contradiction" can coexist with a 40 ppm within-night swing.

🔴 Consequence if the settling test confirms it: **leg C is not a clock measurement on this corpus**, and
`CROSS-DEVICE-DRIFT-AND-CLOSURE` §PAT's gate would be retired in its current form rather than left
blocked — and the band↔verdict anti-correlation recorded there would follow directly from leg C's true
uncertainty exceeding every host-leg band.
