---
bump: patch
type: fixed
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---

PpgDex's CVHR detector now takes the per-second gap mask ECGDex already had, so the
detector drops an event stamped on a second a dropout spans rather than counting it. The two
indices the Integrator corroborates against each other agreed on 48 of 51 planted
cases before the port and on all 51 after it. `cvhrFromNN` also publishes
`coveredSec`, the numerator the mask leaves.

No exported measured value moved: the six PpgDex fixtures moved `manifestHash` and
`computeHash` only, and no fixture carries a CVHR value.
