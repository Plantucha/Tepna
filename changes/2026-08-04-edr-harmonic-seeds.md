---
bump: patch
type: added
nodes: [ECGDex]
brief: ECGDEX-EDR-RESP-ACCURACY-2026-07-31-BRIEF.md
---

Pins the EDR harmonic check on five seeds instead of one. Disabling it makes a true 24 breaths/min
carrier read 12.0 on every seed at the 900 s the gate uses — the check is the entire fix for the
brief's headline defect. It nearly read as dead code: at the shorter default duration only 3 of 5
seeds double, and the seed every other leg uses is one of the two that never does, so a
single-condition isolation shows no change at all. Whether the doubling appears depends on record
length and seed together, both of which move where the carrier's phase lands on the 4 Hz EDR grid.
Disabling the check now reds 14 legs. Test-only; no DSP behaviour changed.
