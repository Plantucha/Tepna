# Heron — unit 105 `splitpoll`

**Unit.** Close residue row `2026-10-27-split-poll-mode-writes-the-raw-pleth-to-a-none-writer`: in O2Ring
split wave-poll mode the 0x03 reply wrote its samples to a `None` writer whenever no `pletha` stream was
configured. Kestrel's order also folds five owed RESIDUE rows into the same PR.

**Branch and worktree.** `claude/splitpoll-hrn` in `~/wt-splitpoll-hrn`, cut from `origin/main` at
`ef4eb7605`. Two source files carry the whole repair: `capture-host/capture.py` and
`capture-host/tests/test_capture_runners.py`.

**Exact stopping point.** `capture-host/check.sh` under the primary checkout's venv interpreter reads
`EXIT=0`, 11569 passed, `TOTAL 30548 0 10626 0 100%`, `Required test coverage of 100% reached` and
`mypy=AT_BASELINE`. The pass count is exactly one above unit 104's, which is the new test. `ruff format`
left both files unchanged, so no reflow and no hash churn. `mypy --ignore-missing-imports` reads
`Success: no issues found in 1 source file` **with the `type: ignore[union-attr]` removed**, which is how
the guard proves it narrows the type rather than silencing the checker.

**Next step.** `npm run check` on the final tree, then the DRAFT PR, then the ledger commit in the same
branch: close the target row's state cell to `fixed #<the PR>` with the number read from `gh pr view`,
and append the five owed rows. I drafted three earlier in the scratchpad and wrote two this unit: the
partial-leg consumer row and the gate spawn-timeout row.

**Open questions.** None for the repair. One for the fleet: the row I close ranked its own preferred
remedy first and a pinned design decision refuses it, so a reader should not trust that
ranking here.

**Blockers.** `npm run check` step 38 of 41 spawns `xerj-load --dry-run --json` under a fixed 120 s cap
and that walk took 1 m 48.7 s at load average 44, so a box under fleet load reds the step and leaves the
last three steps unrun. The new row names it. The cost if it fires is a second full gate run.

**The doc-search query.** `split wave poll mode writes the raw pleth to a none writer`.

## What the row asked for, and why it is wrong

The row ranked two remedies and said "I prefer the second and did not measure either". The second was to
stop issuing the 0x03 poll when no `pletha` stream exists. Two tests pin the opposite as the design, and
one of them says so in words: `pletha` is deliberately absent from its `streams` list because in split
mode 0x03 is the wave source rather than an optional extra, so the mode alone owns the poll. So the
correct remedy is the one the row ranked first, and the ranking in a residue row is a guess until a
reader checks it against the tests.

## Why no test could see the defect

`FakeGattClient` notifies SYNCHRONOUSLY inside `write_gatt_char`. The callback's `AttributeError`
therefore unwound into the 0x03 poll's own `except Exception` and printed `pleth-A poll failed
(AttributeError(...)) — vitals unaffected` on a link where nothing had failed. On a box bleak dispatches
notifications on its own task, so the same error escapes the frame loop instead, and the remaining frames
of that notification go unprocessed with the vitals in the same batch included. The host-side tell that
separates those two is the log line, which is why the new test asserts on `caplog` rather than on a raised
exception.

## The repair

One condition, and it is the writer's existence. The sample loop runs only when `plethawr` exists; the
arrival sidecar row above it and the bus push below it need no writer and still run, which is what the
poll buys when the stream is absent. A second edit states the configuration once per link with
`log.info`, so a reader of the journal never has to infer from an absent file that the poll ran and kept
nothing. That is what keeps §👥.3's hazard from applying: a bare guard would convert the crash into
silent disablement.

Dual mode and split-with-`pletha` are behaviour-identical. The only configuration whose behaviour changes
is the one that crashes today.

Fleet-Session: Heron
