---
bump: patch
type: fixed
---

**The lattice guard has two terms and only one of them was ever tested.** The diff-scoped mutation gate
proved it on #1440:

    bool(stamp_frozen)  →  bool(None)        SURVIVED

`device_axis_is_clock=not (quantised or bool(stamp_frozen))` refuses a corner whose device axis is not
a clock. **The `quantised` half alone carries the ring** (`_DURATION_S`), and every existing assertion
used the ring — so the frozen term was never the deciding one and could be deleted without a single
test noticing.

The stream it was written for is Verity **`ppi`**: frozen at `last_sensor_ns == 0` *without* being
name-quantised, so `quantised` is `False` and only the frozen term stands between it and a fabricated
lattice. That stream had a test — it asserted `device_stamp_constant is True` and the estimator's
`implausible-skew` refusal, but **never the lattice refusal**.

So the guard would have kept working for the ring and **silently stopped working for `ppi`**. Now
asserted; the mutant dies.

⚠️ **This survived because the guard's two terms are not symmetric in the fixtures.** A test that
exercises a compound condition through its *easy* term certifies the condition without covering it —
the same shape as the `_tchHat` test that built `timingSource` at a level no producer emits. When a
guard reads `A or B`, at least one fixture must be decided by **B alone**.

**Found only because the diff-scoped gate mutates the FUNCTION a PR touched, not the lines.** #1440
added one line to `arrival_quality` for an unrelated reason and the whole row was re-examined. The
one-line change had nothing to do with the defect it surfaced, which is an argument for that scoping
choice rather than a narrower one.
