<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ppgdex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
PpgDex's `cvhrIndex` counts events per hour of OBSERVED recording, matching ECGDex — so the two
indices the Integrator corroborates against each other are finally the same quantity (the F3 port).

**The defect:** `cvhrFromNN` divided events by `tt[N-1]`, the wall span, so sensor dead time sat in
the denominator — the identical two lines DEEP-AUDIT-VI F3 fixed in ECGDex's `detectCVHR`, which the
finding names as its sibling.

**Why the PPG leg is the worse half.** The Verity is the fleet's worst dropout offender — 24 recorded
segments in one corpus night against the H10's 3 — so a night where contact is lost deflates the
finger index against a chest index that F3 has already corrected. The Integrator corroborates
`apnea.cvhrIndex` across the two nodes; with one on wall span and the other on covered time, that
corroboration measures the dropouts rather than the physiology.

**The fix, identical in shape to F3:** `cvhrFromNN(nn, tt, activeSec)` takes the observed seconds as
an OPTIONAL LAST argument (§🧪 back-compat: a two-arg caller still computes, on the span; `activeSec
= 0` falls back rather than dividing by zero), `analyze()` measures them from the corrected beat
series with ECGDex's own gap cut (`PPG_CVHR_GAP_S = 10`, one constant so the two nodes stay
comparable), and the basis travels: `cvhrDenomSec` on the result, `apnea.cvhrHours` on the export,
each attached only when an index was computed so the refusal path stays byte-stable.

The seconds are measured from the BEAT series rather than reused from `ppgCoverage`, deliberately:
that function answers where the SAMPLE stream was recording, and a hole in the samples is not the
same set as a hole in the accepted beat series — the denominator has to match the series the events
came from.

**Measured** on planted physiology (HR 60 bpm, 30 s period, ±8 bpm — the same twin F3 used): gap-free
119.7, with 1.5 h dead 119.4, against a wall-span quotient of 59.7. 13 assertions, including three
**cross-node** legs asserting ECGDex and PpgDex return the same index AND the same denominator on
identical input — the property the Integrator's corroboration actually rests on, and one that only
became assertable once `cvhrFromNN` was exported (additively, mirroring ECGDex's own reason for
exporting `detectCVHR`).

⚠️ This is NOT the change the standing note in the OxyDex §2.6 group forbids. That note governs
nulling `index: 0`, the deliberate refusal marker two committed goldens pin byte-for-byte; the
denominator is a different edit and leaves 0 meaning exactly what it meant.
