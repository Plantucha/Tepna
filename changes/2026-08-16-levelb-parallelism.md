---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

**`--jobs N` bought nothing.** `runSuite` used `execFileSync`, which blocks the event loop, and the
worker loop contained no `await` — so `trees.map(worker)` invoked worker #1, which ran the ENTIRE
subject list synchronously and never yielded. Workers 2..N were not invoked until it finished, by
which point every index was claimed, so they returned immediately. The tool was sequential while
reporting six-way parallelism, and it created N worker trees for nothing.

Measured on the live clock.js run: ONE child process at any moment, 285 s per subject, **8 hours for
101 of 179 subjects**.

⚠️ **It hid behind a plausible ETA**, which is why it survived a day of work on this tool. The
estimate divided by `jobs`, so it under-reported by exactly the factor that did not exist —
`1h05m left` against ~6 h of remaining work — and TWO separate diagnoses of the slowness were wrong
in turn: first I/O contention on the volume, then CPU over-subscription. There was never any
parallelism to contend for. `execFile` was already imported in this file and never used, which is
the tell that the async path was intended from the start.

Fixed by an async `runSuiteAsync` the worker awaits. `ran` still demands the TAP plan, so a load
failure remains INCONCLUSIVE rather than a kill.

**Verified by measurement, not by selftest** — the 73 selftests pass either way, because none of them
runs the pipeline (the same blind spot that let a stop-matcher exclusion ship). Two controls:
identical fixture, `--jobs 1` 3 s vs `--jobs 6` 1 s with identical verdicts; and direct process
sampling during a `--jobs 4` run showing **3–7 concurrent suite processes**, where sequential can
never exceed 1.
