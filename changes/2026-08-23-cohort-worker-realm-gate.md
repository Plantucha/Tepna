---
bump: patch
type: added
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---

`cohort-worker.js` (644 lines) is now EXECUTED by the suite rather than mentioned in it — the one
Tier-4 coverage row that survived re-measurement, and the one a `git grep -c` would have wrongly
cleared because its single hit in `tests/` was prose calling it a documented gap.

The new `cohort · worker · realm` group reconstructs the worker realm with `node:vm`, boots the lean
`pulse` KIND, runs a job and asserts the returned envelope carries scored nights. Two assertions do
the load-bearing work: that `ready` arrives with NO `err` — a boot failure is a FIELD on an otherwise
identical message, which is how a KIND broke silently before — and an unknown-KIND control proving
that contract can actually report failure.

Also corrects the stale prose that made the grep count read as covered.

Node-only (the browser lane cannot build a vm realm); no shipped bundle changes.
