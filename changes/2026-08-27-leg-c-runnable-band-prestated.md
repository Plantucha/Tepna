---
bump: patch
type: changed
brief: WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md
---

`WEARABLE-DRIFT-DIRECT` §7.3 declared the three-source clock closure impossible — legs A/B need a **box**
capture, leg C needs beat intervals from **device-axis exports**, and *"No night satisfies both"* because
box nights' trio exports carry `rr: 0 / ppi: 0`.

**That impossibility held for the EXPORTS, and dissolved when the tool stopped needing them.**
`tools/beat-leg-closure.mjs` detects beats from the **raw waveform** on each device's own
`sensor timestamp [ns]` axis and never opens an export, so one box night satisfies A, B and C together.
Demonstrated on `2026-07-18` — a box night by its own evidence (host residual 1887 ms, not the 1.00 ms
one-stamp-quantum signature of a phone capture): 15,682 H10 beats · 8,538 Verity beats · 16 blocks · leg
C **+9.6 ppm** against **+6.4 ppm** predicted from that night's host legs. The brief's remedy
(*regenerate box-night exports with interval series*) is therefore no longer a precondition for this
leg — its device-axis warning still stands and is satisfied by construction when reading raw files.

Also records, beside the amendment, the two things needed to use the check honestly:

- **Estimator error is not the limiting term**, which is the licence to attribute a residual to the host
  legs: `--selftest` recovers planted rates to **±0.0 ppm** across −40…+40 ppm under realistic HRV
  (CV 0.052), 2% dropouts/side and ±20 ms PAT jitter, 7/7.
- **A PRE-STATED acceptance band**, recorded before any σ was measured and with the coverage factor fixed
  a priori: closure holds iff `|legC − (A−B)| ≤ 2·σ_pred`, `σ_pred = √(σ_H10² + σ_Verity²)` from each
  device's within-night fragment spread — per-night, because leg precision varies with fragment count.
  A night where either device yields <2 fragments **refuses** rather than borrowing an uncertainty
  (the `hostAxis` ≥3-anchor discipline); the existing five-night table has exactly that hole. If the
  bandable set collapses, that is the result, not a reason to widen the band.

Filed now so the next reader does not re-block on a constraint that no longer binds — the same service
the `⛔ VOID` banner in `CROSS-DEVICE-DRIFT-AND-CLOSURE` performed when it stopped a voided closure from
being used as a gate.
