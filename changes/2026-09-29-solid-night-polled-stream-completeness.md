---
bump: patch
type: fixed
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---

The SOLID-NIGHT completeness band stopped manufacturing a denominator. `rate × span` measures
completeness only for a stream whose rate is a clock; the O2Ring's live vitals are POLLED, and the poll
sleeps a fixed interval and then does the work, so the period is 1 s + work. On 2026-09-28 that read
23 826 rows against 24 179 s = 98.54 % and FAILED the 0.99 band on a night when every frame carried a
value and nothing was lost. The `@1Hz` it divided by is the nominal in the stream's signal NAME, while
the same file's acquisition evidence says `expected_sample_count: "UNKNOWN"` in as many words.

The denominator is now taken in a stated order and never invented: the count the writer stated, else
`rate × span` when the rate came from a negotiated record (unchanged for every PMD stream), else the band
does not bind. Band decisions gain a fourth outcome, `NOT_APPLICABLE` — the verdict contract's own word,
"examined and the rule does not bind". A device's outcome is computed over its applicable bands; an
inapplicable band neither passes nor fails it and must name why; a device whose every band is
inapplicable reads UNKNOWN, never PASS. Coverage for a polled stream is answered by the continuity band,
which measures the gaps directly.
