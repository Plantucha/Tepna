---
bump: minor
type: added
brief: SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md
---

`tools/ecg-rate-transfer.mjs` — experiment E3: does Pan–Tompkins transfer from the H10's 130 Hz to
the 125 Hz external polysomnography ships?

It does. 14 records, 7 818 beats: median |Δ| 0.304 ms against a pre-stated ≤4 ms band, 100.00 %
correspondence against ≥99 %. The same-rate control is an exact identity, so the measurement is the
detector rather than the resampler.

The displacement is a systematic sub-sample bias (signed median negative on every record), not
jitter — reporting only |Δ| would have hidden that it has a direction.
