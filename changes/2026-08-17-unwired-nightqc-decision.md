---
bump: patch
type: changed
---

**The unwired-machinery brief was stamped DONE with its one genuinely open decision still open.** §1's
remaining box — *should `nightqc` carry `clock_uncorrectable` per night?* — is now decided in writing, and
the answer is **no, not as `nightqc` reads it today**, because the naive implementation fabricates.

The brief's premise is right: the per-night row *is* the artefact an analysis reads months later. But
`clock_uncorrectable` is **live device state, not a property of a night**. `capture.py:1536 _set()` does
`d.update(kv)` into `STATUS["devices"][name]` — a mutable current-state dict with **no history** — and
`:1432` *clears* the flag on a successful sync. Reading `STATUS` at QC time and writing it onto a night
captured three days earlier attributes **today's** state to that night: clean where the capture was
uncorrectable if the device has since re-synced, uncorrectable where the capture was fine if it has been
docked since. That is a fabricated per-night fact — Clock Contract §2.6, *a missing value must be visible,
never invented*.

**Declined with its condition, not rejected.** The honest route already exists one line from where the flag
is set: `_set()` forwards `link_epoch` into the **LINK sidecar (E5)** through the same call path, for the
same reason — a live device fact pinned to the session it describes. Stamp `clock_uncorrectable` there and
`nightqc` can read it per night from the night's own bytes, at which point the box reopens as a real task.

⚠️ **Also corrected: §2's "run it against real QC first" box was unticked over shipped work.** #1258 *did*
run the check before wiring — **0 gaps across 4 nights, zero false positives on every session since
2026-08-11**, with earlier nights reported as abstention rather than as a pass. The evidence is now recorded
beside the tick, because the tick alone would not have survived the next reader asking whether it happened.

§8's first box could not honestly have been ticked before this decision — §1 was neither wired nor declined,
only half-answered. §8's §7 box is marked **STANDING, do not tick**: it is a precondition on future work, so
unticked is its correct resting state.

Docs-only. No code, no bundle, no fixture.
