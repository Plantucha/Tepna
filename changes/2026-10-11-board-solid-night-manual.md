---
bump: patch
type: fixed
brief: USAGE-GUARD-2026-10-11-BRIEF.md
---

**The board's solid-night section renders a hand-entered file, named as manual with a date, until the capture box publishes a summary the rig can read.**

Owner, 2026-10-11 ("put placeholders in it"). The section was a fixed "not read"; it now reads
`solid-night.md` from the board directory like the evaluation does. A manual entry is a measurement of
what a person copied, not of the night, and the page says which. Selftest: a manual file renders its
text and the section no longer reads as absent.
