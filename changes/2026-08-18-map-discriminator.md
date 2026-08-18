<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
Closes the obvious rescue for the quarantined coverage map, by measurement rather than argument, and
records the one result that outlives the quarantine.

**§3a — the discriminator does not exist.** The natural fix is to split the 188 zero-attribution
groups using the `384 = exactly the baseline` signature: `record == baseline` means capture failed, so
select it; a smaller or empty record means a true zero, so skip it. One c8 run refutes it. Group 2
(`Clock Contract — parseTimestamp`, which touches `clock.js` and not hrvdex) and group 338 (which
provably executes `hrvdex-dsp.js:853`, since it fails when that line is mutated) record **identical
384-line sets** for that module.

The cause is structural: `tests/run-tests.mjs` loads every DSP before any group runs, so the
load-time baseline appears in every group's record regardless of what that group touches. A true zero
and a capture failure are not similar observations — they are the same observation. Any real fix must
change what is **collected**, not how it is **interpreted**.

**§3b — the half that survives.** The three `SURVIVED → KILLED` flips are a property of the tag
filter, not of the map: selection ran groups that execute a line without carrying the node's tag, and
they killed mutants the tag-filtered sweep had recorded as survivors. So **every survivor count this
programme has published is an upper bound and every kill count a lower one** — 3 in 489 on hrvdex
(0.6 %), small but signed, always in the same direction. "3751 survivors" should be read as "at most
3751".

Credit: a peer session proposed the discriminator and asked to have it tested rather than accepted,
and separately pointed out that the under-count outlives the quarantine.

Docs only; the map stays quarantined and no tool behaviour changes.
