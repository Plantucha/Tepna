<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md
---
The self-maintaining half of the mutation canary **had never once worked**, and the failure was worse than inert: the first file to learn a canary silently **destroyed the stored canary for every other file**.

`saveCanary` serialised with `JSON.stringify(all, Object.keys(all).sort(), 2)`, intending "sort the keys". `JSON.stringify`'s second parameter is the **replacer**, and an array there is an **allowlist of property names** — so every property not named after a file (`line`, `op`, `before`, `after`, `killers`) was stripped, and each entry was written as `{}`.

Found by accident: a fleet sweep across eight DSPs left `tools/mutate-canaries.json` holding eight empty objects **plus an emptied `clock.js`** — the one entry that had been seeded and verified by hand. Nothing could have reported it, because what the writer writes is never read back.

Serialisation is now a pure `serializeCanaries()`, pinned by **9** known-answer selftest cases: every field survives the round-trip, adding a second file does not empty the first, keys are sorted, and a round-tripped entry still **matches its mutant** through `findCanary` — which is the property that actually matters, since a canary that cannot match reads `STALE` forever while looking like a live guard. Verified in both directions: restoring the original serialiser turns **8 of the 9 red**.

`saveCanary` now also **fails closed** on an incomplete mutant rather than storing an entry that can never match.

Tooling only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
