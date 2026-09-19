---
bump: patch
type: added
brief: ECG-SATURATION-ABSENCE-2026-09-18-BRIEF.md
---

Promotes residue row `2026-09-18-ecg-saturation-unflagged` into a brief; the row closes pointing at
it. Measurement only — no threshold proposed, no remedy taken.

The thesis outlives the ECG instance: a fix keyed on the CAUSE it was written for does not generalise
to a second cause with the same consequence. `buildNN`'s §∅ gap-straddle rule keys on ELAPSED TIME
(`GAP_S = 10 s`) and was calibrated for dropouts; a saturated stretch is just as much an absence and
produces a shorter span, so 28 of 55 saturation-induced spanning intervals are MEDIAN-FILLED instead
of excluded — verbatim the failure that block's own comment records as fixed.

The guard fails two ways. Its rail leg is gated above the phenomenon (`|int16| > 31000` against an H10
saturating at ~18,100-19,500 per-file: 0 of 112 fire). Its flat leg is peak-conditional, examining
only +-130 ms around a DETECTED peak while saturation is what suppresses detection: 55 looked at, 57
not — a guard whose coverage is decided by the failure it guards against.

§4 checks each remedy's dependency rather than inheriting it, and corrects an earlier claim from this
session that both were blocked on the deferred finger-off capture. Neither is: the rail constant has
exactly one live site and is independently fixable, and `GAP_S` is ECG-local in code but held equal to
`PPG_CVHR_GAP_S` by a COMMENT rather than a shared symbol, so moving it silently breaks a documented
cross-node invariant.

The caveat is stated unsoftened: the 55/57 split uses `detectPeaks` over the full record, so if
detection is perturbed upstream the magnitude could move. The direction cannot.
