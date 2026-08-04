---
bump: minor
type: added
brief: REM-STAGING-FOLLOWUPS-2026-08-02-BRIEF.md
---

`tools/nsrr-stage-validate.mjs` — scores the shipped sleep stager against expert PSG labels, end to end:
EDF → `CpapEdf.readEDF` → ECG channel → `ECGDSP.analyze` → `ECGDSP.stageSleep` → join to the 30 s expert
grid → REM recall/precision/confusion. `--selftest` proves the whole chain on a synthesised EDF +
annotation XML, so §2b is now blocked on records alone. The join (5-min detector epochs ↔ 30 s expert
epochs, majority vote, uncovered windows excluded) is gated in the Node lane and mutation-verified.
