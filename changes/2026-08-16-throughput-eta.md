---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

The shared ETA multiplied a per-run cost by the ROUNDS remaining. That is correct arithmetic resting
on an assumption — that every one of `jobs` workers is doing work — and when the assumption is false
the estimate is wrong by exactly the factor that does not exist. Level B reported `1h05m left`
against ~6 h because `--jobs 6` bought no parallelism at all (#1338), and the same shape appears more
mildly under contention or a straggler-bound tail.

`etaFromThroughput(done, total, elapsed)` assumes nothing: `done / elapsed` is what actually
happened, so it absorbs contention, warm-up, stragglers, and a jobs count that turns out to be a lie.
`progressLine` now prefers it wherever elapsed time is known and **says which form it used** — `obs`
for measured, `est` for the projection — because an estimate a reader cannot attribute is one they
cannot sanity-check. The rounds form is kept for the up-front estimate, before there is anything to
measure.

**This came from reading `tools/mutate.mjs`, which has always done it this way** (`rate = done / el`)
— and which, on inspection, needed nothing else either: it is genuinely parallel (`await
runSuiteAsync`), and its `--resume` journal is MORE capable than the shared ledger, quarantining
mutants that started and never finished. The previous changeset listed it as "not yet unified onto
this core", which implied a gap that does not exist; unifying it would replace a better
implementation with a simpler one. Corrected here rather than left standing.
