---
bump: minor
type: added
brief: PPG-ABSENCE-AS-VALUE-2026-09-06-BRIEF.md
---

A SATURATED span is labelled distinctly from an ABSENT one — owner ruling 2026-09-18, which scopes
P5's "a pinned span is an ABSENCE" to the ZERO rail.

A top-rail run is a measurement AT ITS BOUND: the true value was at-or-above the rail, which is
strictly more than "not measured". `pinnedSpans` has always stamped `end: 'lo' | 'hi'` per span, and
the export pooled both into one `samplesUnmeasured` — detected, reported, then collapsed at the point
a consumer reads it, the same shape #2531 fixed for absence and left standing here.

`quality.pinnedCoverage` now carries `samplesAbsent` (floor) and `samplesSaturated` (ceiling).
`samplesUnmeasured` is KEPT and still means the total, so an existing reader sees no change; the name
is now imprecise for the saturated half and is deliberately not renamed, because renaming a shipped
field to improve a word breaks every reader of it.

THE LABEL IS DELIBERATELY INERT. Whether saturation should be excluded from a NARROWER set than
absence was put to the owner and DEFERRED until a controlled finger-off capture, so all three
populations are classified in one pass rather than two. `spansOmit` still excludes both rails
identically, nothing reads the label yet, and no computed statistic moves. What the unit buys is that
the decision becomes implementable: today the set cannot be narrowed for saturation at all, because by
the time `spansOmit` exists the rail is gone.

NO THRESHOLD IS CHOSEN. This re-labels what the shipped `PIN_MIN_RUN = 5` rail detector already
finds. A value-agnostic run-length rule would need a threshold, that threshold is undecided, and it
is a separate unit.

Measured rather than asserted: bytes moved (3 fixtures gain the two fields) and NO statistic moved —
every changed key is `samplesAbsent`/`samplesSaturated`, and `samplesUnmeasured`'s only diff is a
trailing comma.

The gate drives `compute()` rather than re-implementing the split. An earlier draft asserted a split
it computed itself from `pinnedSpans` output, so pooling the rails back together inside the export
left it fully green; the decoy now reds three assertions while the total-only check stays green,
which is the point — pooling preserves the total.
