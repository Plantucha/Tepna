# Heron — unit 80: the cpap cancellation leg reaches the teardown it names

**Unit.** Rewrite `test_association_is_released_on_cancellation` so the cancel lands inside the loop,
and log both findings the measurement produced.

**Branch plus worktree.** `claude/cpaprace-hrn` at `02cd60f5c` in `~/wt-cpaprace-hrn`, base
`ae38f0e3b`, PR **#3976** DRAFT. Two commits: `ecc7627e1` carries the leg, the changeset and the
shield row; `02cd60f5c` carries the closing row.

**Exact stopping point.** The leg cancelled the poller after one `await asyncio.sleep(0)`, which landed
on the entry sweep's `to_thread` at `capture.py:11072`, before the `try`. PROBE A read
`down=1 loop_entered=0`, so `_cpap_loop` never started and the `finally` at `:11108` never ran.

PROBE B gave the loop one executor worker and occupied it, which reproduced `down=0` and
`assert 0 >= 1` — the gw7 red of 2026-10-25. The rewrite stubs `_cpap_loop` with a blocking coroutine,
waits for its event, cancels, and asserts `spy.up == 0 and spy.down >= 2`. A plant that moves the
teardown out of the `finally` reds the new leg alone at 1 failed and 38 passed, and the shipped leg
passes 39 of 39 over it.

Two probes also read the same numbers with the `shield()` and without it, so nothing in the repo reads
it. Row `2026-10-26-the-shielded-cpap-teardown-has-no-reader` carries that OPEN.

`capture-host/check.sh` exits 0 at 100 per cent coverage over 30,305 statements. `pr-compliance` reads
PASS over 9 checks against the final body.

**Next step.** Read `npm run check`'s verdict from the scratchpad log, then ask Kestrel for the undraft
on the board.

**Open questions.** Whether the shield earns its place needs a harness that models the daemon's own
shutdown, where other tasks and a closing loop decide whether the orphaned inner task runs. Nobody has
sized that.

**Blockers.** Nothing blocks this PR.

**The doc-search query.** `a cancellation test asserts a teardown that its own cancel point never
reaches`.
