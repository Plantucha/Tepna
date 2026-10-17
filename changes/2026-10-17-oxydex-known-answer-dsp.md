---
bump: patch
type: added
brief: none
---

The OxyDex known-answer fixture now drives the real DSP helpers. One new test group builds parsed rows from `tests/fixtures/oxydex-math-known-answer.json`. It asserts the hand-computed values against `computeStats` and `computeCTprecise` through `OxyDex._bare`: 20 assertions in both lanes. The fixture shipped in #3590 with only a shape check as its consumer.

The group pins two semantics. `computeCTprecise` counts rows at 1 Hz, so a sparse series reads seconds as count × sampleSec. `computeStats` reads measured values only, so an absent sample never reads as 0.

The second commit re-earns `verifiedUnder` on 7 OxyDex and CPAPDex fixtures after a green real-corpus run of `tools/verify-fixtures.mjs`. No export moved.
