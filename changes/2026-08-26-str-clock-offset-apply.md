<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: CPAPDEX-STR-SUMMARY-INGEST-2026-08-21-BRIEF.md
---

**Link 4 — apply the measured clock offset to STR's device-time session boundaries.** Closes the last
box of `CPAPDEX-STR-SUMMARY-INGEST`; the brief flips to DONE.

**ADDITIVE by ratified design.** Raw `sessions[].onMs/offMs` stay verbatim (INV3); corrected values
land beside them as `sessionsCorrected`, with the offset's provenance on `strClockCorrection` (INV4 —
the reference axis beside the device clock, never substituting). Correcting in place would silently
move the ~17 existing `.sessions` consumers that read device time today.

**The sign is stated and pinned from both directions.** `offset_sec` is POSITIVE when the device reads
LATER than the reference, so a device stamp `T` denotes reference time `T − offset`. The AS11 here runs
BEHIND, so correction moves its stamps LATER — the direction the ~42-minute skew finding predicts.
`strClockCorrection.appliedMs` states what was ADDED so no consumer re-derives it, and the suite pins
both a negative and a positive offset, because one example cannot distinguish a convention from its
inverse.

**An UNMEASURED offset yields NO corrected view** — never a copy of the raw sessions. A
`sessionsCorrected` that silently equalled `sessions` would assert a correction that never happened. A
MEASURED zero is different and does yield one: 0 s is a result, not an absence.

Three controls, each verified to fail when relaxed: flipping the sign (7 assertions red), copying the
raw sessions for an unknown offset (2 red), and applying in place (the INV3 assertion red).

The applier is ~15 lines and was blocked for five days not by difficulty but because it had **nothing
to apply** — visible only by tracing the chain to its LAST link. `fitClockOffsetSegments` existed and
was exported, which made the box look ready; it was not.
