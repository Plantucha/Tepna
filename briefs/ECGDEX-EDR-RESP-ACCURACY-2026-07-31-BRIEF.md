<!--
  ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-31 · **Spawned-by:** `DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md` §EP-rest

# `crc.respFromEDR` reads exactly HALF at 24 breaths/min — the estimator degrades at both edges of its own declared window

## 1 · The measurement

`cardiorespCoupling` estimates respiration directly off the EDR band by autocorrelation —
`_autocorrPeriod(edrB, FS, 2.5, 10)`, i.e. periods 2.5–10 s = **6–24 breaths/min** — and surfaces it as
`crc.respFromEDR`, an **exported** field carrying `respFromEDRMethod: 'EDR (R-peak amplitude modulation)'`.

Driving `ECGDSP.analyze` on a deterministic `genSynthetic` ECG whose respiratory carrier is set to a
known rate (`opts.respHz`, added for this purpose) gives, identically across seeds 20260601 / 42 / 7:

| true /min | period | reported | error |
|---|---|---|---|
| 6 | 10.00 s | 6.9 | +15 % |
| 7 | 8.57 s | 6.9 · 6.9 · **11.4** | seed-dependent |
| 8 | 7.50 s | **11.4** | **+43 %** |
| 9 | 6.67 s | **11.4** | +27 % |
| 10 | 6.00 s | 12 | +20 % |
| 12 | 5.00 s | 13.3 | +11 % |
| 14 | 4.29 s | 15 | +6 % |
| 16 | 3.75 s | 16 | 0 % |
| 18 | 3.33 s | 18.5 | +3 % |
| 20 | 3.00 s | 20 | 0 % |
| 22 | 2.73 s | 21.8 | −1 % |
| **24** | **2.50 s** | **12** | **−50 % — exactly half** |

**Trustworthy over roughly 14–22 /min. Outside that it is biased high, and at the top edge it fails
completely.**

## 2 · Why — and it is not the autocorrelation's search bounds

Two independent effects, both at the edges:

- **Period-doubling at 24/min.** `_bandResp` is the DIFFERENCE OF TWO MOVING AVERAGES
  (`_maHalf(x, 0.3·fs) − _maHalf(x, 2.0·fs)`), nominally ~0.1–0.4 Hz. A moving-average difference has a
  **gentle** roll-off, so a fundamental sitting *at* 0.4 Hz is already substantially attenuated. The
  autocorrelation's first admissible lag is then a suppressed fundamental while the 5 s second harmonic
  survives, so it locks onto the harmonic → exactly half. The existing zero-crossing skip in
  `_autocorrPeriod` guards against half-period *sidelobes*, not against a genuinely stronger harmonic.
- **Coarse lag quantisation.** The EDR is resampled to a **4 Hz** grid and the search is over INTEGER
  lags, so period resolution is 0.25 s — about 1.5 % at a 3 s period but ~6 % at 4.3 s and larger still
  as the period grows. This is what makes 14/min read 15.0 (lag 16 = 4.00 s rather than lag 17 = 4.25 s).

**The 2.5 s / 10 s bounds are NOT the defect** and are now both-direction gated (`ecgdex-dsp · crc ·
known-answer`): 20/min → 20.0 with a `2.5→3.5` slip re-reading 10.4, and 6/min → 6.9 with a `10→7` slip
re-reading 12. The window admits what it says it admits; the estimator inside it is what degrades.

## 3 · What this does and does not affect

- `respFromEDR` is **exported** and read by the Integrator's respiration fusion as one of its sources.
  `MULTI-SENSOR-DERIVATIONS` §2.2 publishes every source **and the spread**, and reports disagreement
  rather than averaging it away — so a wrong EDR rate widens a declared spread rather than silently
  corrupting a consensus. That is the design working, and it caps the blast radius.
- `f0 = respFromEDR/60` also centres `_narrowPhase` for the **CPC/PLV** analysis. A half-rate `f0` centres
  the phase analysis on the wrong band, so `crcPLV` and the CPC band shares at 24/min are suspect too.
  **This is the more serious consequence and is untested.**
- Adult resting respiration is typically 12–20 /min, so the trustworthy range covers the common case.
  24/min is not exotic, though — it is ordinary in children, in fever, and in CSR.

## 4 · Options

1. **Parabolic interpolation on the autocorrelation peak** — removes the quantisation error at every rate
   for a few lines and no new assumption. Cheapest real improvement; does not fix period-doubling.
2. **Harmonic check** — after picking `bestLag`, test whether `bestLag/2` is admissible and carries
   comparable correlation; prefer the shorter period when it does. Directly targets the 24/min failure.
3. **Widen or steepen the band.** `_bandResp`'s edges are the root cause. A steeper filter costs more
   than (1)+(2) and would move every CRC metric, forcing a fixture re-record fleet-wide.
4. **Narrow the declared window to the trustworthy range and abstain outside it.** Honest and cheap, but
   it converts a wrong number into no number over a physiologically real range — likely worse than (2).

**Recommended: (1) + (2).** Both are local to `_autocorrPeriod`, neither touches the filter, and together
they address the two measured mechanisms.

## 5 · Done when

- [ ] A decision is recorded between §4's options (owner call — this brief does not presume it).
- [ ] The sweep in §1 is re-run and the table updated; the accurate range should widen.
- [ ] The two `KNOWN LIMITATION` legs in `ecgdex-dsp · crc · known-answer` — which pin 24/min → **12**
      deliberately, so the defect cannot change unnoticed — are **updated in the same commit as the fix**.
      They are characterization pins, not correctness claims; a fix is SUPPOSED to red them.
- [ ] The CPC/PLV consequence (§3) is measured, not assumed: does a corrected `f0` move `crcPLV` or the
      CPC band shares at 24/min?
- [ ] `ECGDEX-CARDIOPULMONARY-COUPLING`'s validated `cpc.hfcPct` result is re-checked against the fix —
      it is the one CRC metric with a real correlation (r = −0.408, p = 0.009) and must not regress.
- [ ] Gates green; ECGDex re-bundled; `computeHash` moves ⇒ `DEX_UPLOADS=<corpus> tools/verify-fixtures.mjs`.

## 6 · Guardrail

Do **not** tune the estimator against `genSynthetic` alone. The generator's respiratory carrier is a clean
sinusoid; real EDR is neither clean nor stationary, and `REM-STAGING-REDESIGN` §8's warning that the
synthetic oracle is circular applies directly here. Any fix should also be checked against the real
trio-corpus ECG, where the truth is unknown but the *stability* of the estimate across a night is
observable.
