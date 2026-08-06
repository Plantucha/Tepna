<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md
---
The O2Ring's `156` is an INSERTED row, settled across 17 nights — Phase 4 is unblocked.

`DEVICE-RATE-TRUTH` §6.5 blocked the O2Ring structural fix on §6.1, which planned to settle
insert-vs-replace by reading `RtWave.offset` at payload `[20:24]`. That field was probed on hardware and
is EMPTY on this firmware, so the planned night can never land.

Settled instead by a cross-night regression, which is a stronger test than the register would have been.
Marker count scales with heart rate, so the hypotheses make opposite predictions for how the ROW rate
varies between nights. Over 17 whole-night files spanning 46.5-70.6 bpm:

    row_Hz         slope +0.01517 Hz/bpm   R2 0.957   = 91% of the INSERTION prediction (+1/60)
    row - markers  slope -0.00151 Hz/bpm   R2 0.180   =  9% of the REPLACEMENT prediction (-1/60)

The row rate climbs with heart rate; the marker-corrected rate does not. Insertion. So
`O2PPG_FS_DEFAULT -> 125.000` together with a beat-event column is the correct fix.

Explicitly NOT claimed: the fit's intercept (125.047 Hz, +374 ppm from theoretical) is not a crystal
measurement and must not be quoted as one. The phone-timestamp column comes from `O2PpgGrid`, whose
`step_s` is adaptively slewed toward observed arrival, so `rows/span` is partly the grid's own estimate.
The slope survives that (the grid behaves identically on every night); the absolute value does not.

Docs only — no code, no bundle, no fixture.
