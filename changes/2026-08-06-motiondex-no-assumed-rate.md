---
bump: patch
type: fixed
nodes: [MotionDex]
brief: NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-2026-08-06-BRIEF.md
---

MotionDex could publish a duration it never measured, divided out of an assumed 26 Hz.

`durationOf` ended `: rows.length / 26` whenever the last row resolved no time. Measured over the whole
real corpus — 616 ACC files, 121,429,712 rows, 690 h across both trees — that branch fires zero times,
but the delivered ACC rate across those same files runs 20.9–202.7 Hz (H10 median 50.7, Verity 51.7),
so where it did fire it would misstate the recording by 0.8×–7.8×: 462 s published for a 60 s record,
beside a `startEpochMs` of null. Every other field on that path honestly says unknown; this one alone
invented a number.

Two changes. The scan now walks BACKWARD to the last row that resolves a time, so a single stampless
trailing row no longer discards the duration of thousands of measured samples — the same rule
`parsePPG` uses for `endEpochMs`. And when no row resolves at all, the answer is null.

The windowing is handed 0 in that case, which is safe and not a new branch: all four consumers already
floor the value (`Math.max(1, Math.ceil(durSec / epoch))` in bodyPosition/actigraphy/respiratoryEffort,
`Math.max(1, durSec)` in the rate fallback) and `durationOf` already returned 0 for the fewer-than-two-
rows case. What must not be zero is the PUBLISHED duration: a zero-length recording is a claim, and
NODE-EXPORT-RECORDING-DURATION shows a node making it collapses to a point in the fold. `Math.max` also
had to go — it coerces null to 0, so an unmeasurable stream would have read as a real zero-length one.

Gated by `motiondex-dsp · export · absence` (8 assertions, both halves plus a fully-timed control) and
mutation-verified against the pre-fix fallback: 4 red, reporting 154 s for a 20 s record — the 7.7× the
corpus census predicted. 26 was deliberately not replaced with a "better" constant; any assumed rate is
wrong for some file.
