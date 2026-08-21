---
bump: minor
type: added
brief: O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md
---

**The 0x05 channel-identity refutation is reopened — its evidence base was invalidated by the
saturation discovery, and the functional red+IR test now PASSES at corpus scale.**

Two findings changed the ground: (a) the corpus sweep (FOLLOWUPS §2.1a) showed 99.3 % of 0x05 buffers
gap-spliced at the reply cap — the "no cardiac periodicity" check ran on data whose ~1 s phase jumps
destroy autocorrelation by construction, and its within-buffer leg used a 0.82 s window that cannot
hold a 0.91 s beat; (b) a per-buffer phase test shows the buffer swing phase-locks to the device's own
beat period (Rayleigh p ≈ 0.007 vs clean controls) — the channels are real plethysmograms.

`tools/ppg2w-spo2-fit.mjs` (committed apparatus, 9 selftest assertions incl. a non-tracking control):
per-buffer ratio-of-ratios, 15 s-binned, per-session normalised, fitted against the device's own 1 Hz
SpO₂ over the whole corpus. Measured: **19,006 bins · pooled r = 0.500 · LOO r ∈ [0.484, 0.511] ·
monotonic dose–response (Rn 0.835 → 0.928 → 1.007)**, per-session r positive 14/15 incl. a 73 % desat
night. Sign ⇒ functionally **ch0 = IR, ch1 = RED** (opposite of the withdrawn ④ claim). Recorded as
④-REOPENED in the parent brief with its explicit limits: functional evidence, not spectral proof
(sunlight §5.1 remains the confirmation); a per-device regression, not calibration; the §5.2
no-SpO₂-metrics ban stands until #1596's contiguous data sharpens the estimator.
