<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md
---
O2Ring timebase — Stage 1 of O2RING-ADAPTIVE-TIMEBASE (executes DEVICE-RATE-TRUTH §3/§6.5): honest
ADC-rate label + per-capture clock-precision provenance.

`O2PPG_FS_DEFAULT` is now the crystal ADC rate **125.000** (manufacturer's 125; AFE4403 off a 32 MHz
crystal ÷8 ÷32000), not the row rate **125.738** it carried since 2026-07-18. 125.738 was never the sample
clock: the finger pleth inserts one `156` beat MARKER per detected beat, so the file runs at 125.000
samples + ~HR/60 marker rows ≈ 125.7 rows/s. Labelling the sample rate with the row rate contradicted the
manufacturer and the module's own "crystal-accurate 125.000000 Hz exactly" note — the maintenance landmine
a future coder could not reconcile (code 125.738 vs docs 125). It is a **label/starting-guess change, not a
computation change**: `O2PpgGrid._re_estimate` slews the working step to the observed rows and PpgDex
derives its working fs from the ns column, so no captured output moves. The observed row rate stays,
correctly, in the row-count validators (`nightqc._NOMINAL_HZ`, `webmon._BPS_BY_MODEL`, now explicitly
labelled as the ROW rate) where a rows/second figure is what is meant.

Provenance: `host_clock` now parses chrony's `Skew` into `chrony_skew_ppm` (the clock-frequency error
bound — the single best "what clock precision governed this capture" fact), surfaced on `read_state()` and
recorded per night as a new last column in the CLOCK sidecar (appended, back-compat; blank on the timesyncd
path, which has no analogue). This is the field the Stage-3 timebase decision will gate host-discipline on.

capture-host suite green at the 100 % statement+branch floor.
