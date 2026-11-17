---
bump: patch
type: fixed
brief: none
---

Refuse an NSRR EDF signal that carries no sample rate, and never assume 1 Hz.

`cpapdex-edf.js` writes `fs: null` when an EDF record duration is 0.
The NSRR adapter turned that null back into 1 Hz at two sites.
1800 SpO₂ samples from a 0.5 Hz hour then published half the night at 100 % coverage.
The adapter now refuses such a SpO₂ or HR channel and names the reason.
A status channel with no rate stays present but is not applied, with `reason: status-fs-absent`.
