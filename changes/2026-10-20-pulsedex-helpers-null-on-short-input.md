---
bump: patch
type: fixed
brief: none
---

The three PulseDex dispersion helpers answer `null` for an input too short to measure, not `0`.
A flat series has a sample SD of exactly 0, so the old return told the next caller "measured, and
flat" about nothing measured. All 20 call sites guard a short input, so no exported number moves.
