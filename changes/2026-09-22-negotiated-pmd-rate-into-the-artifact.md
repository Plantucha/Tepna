---
bump: patch
type: fixed
brief: none
---

The negotiated PMD sample rate and the device's offered menu are now written beside the stream, in
its SEAMS sidecar. The daemon logged `START ppg (negotiated) -> ok` and published the menu to STATUS,
but neither reached an artifact: what a stream was captured at survived only as an inference from
rows over a stamp span. Measured on vigil — 3 days of journal, 3 `START ppg (negotiated)` lines for
the Verity, 0 naming a menu or rate, against files that measured 55.14 Hz.

An EMPTY menu is not a negotiation and the line does not claim one: `negotiated` is derived from the
menu rather than passed, so with no menu `rate=` is written empty and the vendor default appears
under `assumed=`. It lands in the sidecar and not the stream file because a comment after the stream
header breaks the Polar row contract (`_rows()` takes lines[1:]) — five writer-contract tests pin it.
