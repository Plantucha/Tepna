---
bump: patch
type: changed
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---

Records a second source of false mutation survivors beside §3's coverage-map one: a REUSED scratch
can report already-killed mutants as surviving, with `mutmut run <mutant>` in that same scratch
flipping the verdict and no source or test change between.

The cause is explicitly UNISOLATED and the section says so. #1664's commit message asserted a stale
"results database"; that framing is refuted here — the test copy and the coverage mapping were both
current — and naming an unsupported mechanism is what sends the next reader chasing the wrong thing.
The `.pyc` same-size hypothesis is recorded as not fitting either, with the evidence.

Also splits FINISHED-WORK §D's E2E item, which bundles two asks with different fates: the
cohort-worker realm half is DONE (#1671, closing Tier 4 at 4 of 4), while the pinned-summary CI gate
half is still open — but the fold itself is exercised, so it should not be written up as untested.

Docs only; no code, no bundle changes.
