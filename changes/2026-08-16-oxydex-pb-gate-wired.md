---
bump: minor
type: changed
brief: OXYDEX-PB-DETECTOR-2026-08-09-BRIEF.md
---

`detectOscillations` now gates on periodicity. It previously flagged a fixed 300-second window whenever
motion was low, at least 40 samples sat below an absolute 95 % SpO₂ level, and the trace crossed that
same level at least six times — so nothing it computed depended on the *spacing* of those crossings.

The fixed window could not survive the fix. A cycle may run to 130 s, so four consecutive cycles need up
to 520 s: an episode that cannot fit inside the window it was being scored in. Episodes are now
variable-length runs, which is also how AASM defines them, and `windowSec` carries the episode's own
duration rather than a constant.

Measured on the same 42 nights, old code against new: nights flagged 38/42 → 16/42, correlation between
episode count and time below 95 % **0.910 → 0.370**, and against mean SpO₂ −0.832 → −0.380. That is the
brief's §3.2 criterion, and the residual 0.370 is reported as residual rather than rounded to a claim of
independence — periodic breathing and hypoxemia genuinely co-occur, so zero correlation would be
suspicious in the other direction.

Fixtures were regenerated rather than re-verified, because behaviour changed: the equivalence gate red
first, `regen-oxydex-goldens.mjs` moved two fixtures, and the synthetic golden was unchanged.
