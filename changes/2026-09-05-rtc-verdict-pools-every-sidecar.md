<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The night's ring-clock verdict was read off the FIRST `_RTCLOG.csv` sidecar and stopped there.

#2219 made `rtc` non-null for the first time (the caller looked for the wrong filename case), and the
first real night it reached — vigil 2026-09-05 — reported `reads 1 · pushes 11 · resets 0 · span_h 0.0`.
The directory held **29** sidecars for the same ring: `RingClockLogWriter` opens one per CONNECT
SESSION, and the O2Ring reconnects all night. Replayed through the pooled reader the same 29 files give
`reads 17 · pushes 63 · resets 2 · drift 0.9 s over span_h 4.3`; `summarize`'s `and rtc is None` handed
over the first file's two minutes and the resets the field exists to surface never reached
`QC-SUMMARY.json`.

`rtc_drift_summary` now takes one path or a sequence, drops each file's own header row, skips a torn
or unreadable sidecar without nulling the rest, and reports `files` beside the tally; `summarize`
collects every `_RTCLOG.csv` in the night and hands them over together. A one-path call is unchanged.

The locale test for the same reader also now sees what it claimed to: the first version compared a
non-ASCII NOTE column, which no decoder touches (`errors="replace"` never raises), so the two encoding
mutants #2219's mutation lap surfaced survived a test that read as covering them. Unicode digits in the
offset column are the one decoder-sensitive field — `float("٢.٥")` parses under UTF-8 and is replaced
under a C locale — and the test now plants one, asserts it was parsed here, and kills both mutants.
