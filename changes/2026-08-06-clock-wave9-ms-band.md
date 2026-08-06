<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---
`_ckMk` validates the time components with `… || ms < 0 || ms > 999`, and a mutation of that last comparison to `ms >= 999` was the single mutant the full suite killed that the scoped `clock` selection missed — the entire accuracy cost of the group filter on this module, recorded in the brief's §1. It is now killed from inside the `clock` tag, so scoped and full agree for the first time. Three ISO fraction digits express exactly 0…999, so 999 is the largest value the grammar can produce; under the mutant `2026-08-05T23:15:42.999` — a real stamp, one millisecond before the second rolls — is refused as out of range. Adds `clock.js — wave 9: the millisecond band is closed at both ends` (5 assertions), written as the contract that a closed band contains both endpoints rather than as the shape of the mutant, and verified RED-under-mutant then GREEN-restored. Also corrects the brief's `✅ RESOLVED` figures: the `104/127 = 81.9 %` table predates #982, which found that 5 of those kills never ran and that generation itself was emitting 4 malformed mutants (`win >=> 1`) — so the numerator was inflated and the denominator four wide. Re-measured on two independent sweeps: 98/117 = 83.8 % full, 97/117 = 82.9 % scoped, with `invalid` deterministically 5 rather than the 1 assumed elsewhere.
