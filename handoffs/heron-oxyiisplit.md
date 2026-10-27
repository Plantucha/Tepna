<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 Michal Planicka -->

# Heron — unit 104 `oxyiisplit`

**Unit.** Split `capture.run_oxyii` into smaller functions so that mypy can read its callback, on the owner ruling of 2026-10-27 relayed by Kestrel. Behaviour-preserving, code and tests.

**Branch and worktree.** `claude/oxyiisplit-hrn` at `4625da618` in `~/wt-oxyiisplit-hrn`, base `39cfafdc4`, PR **#4023** open as a DRAFT. Two commits: the refactor at `1d422cc90`, and the ledger at the head.

**Exact stopping point.** Both commits sit on `origin/claude/oxyiisplit-hrn`. `capture-host/check.sh` reads `EXIT=0` on the refactor tree with 11568 passed and a real 100 percent TOTAL row. `npm run check` runs detached over the pushed head, and its sentinel lands in the session scratchpad as `check104.log`. The undraft ask on thread 8 waits on that verdict.

**Next step.** Read the `EXIT=` line out of that log. The verdict then goes in the PR body, under an undraft ask to Kestrel on thread 8. No further unit until Kestrel orders one.

**Open questions.** Row `2026-09-27-type-ratchet-pays-a-functions-whole-mutant-backlog` stays OPEN and carries DECISION NEEDED, because its claim covers every module rather than this one. The new row `2026-10-27-split-poll-mode-writes-the-raw-pleth-to-a-none-writer` names two remedies and ranks them, and nobody has measured either.

**Blockers.** None for the PR. The pletha defect needs a behaviour change, so it needs its own unit and its own order.

**The doc-search query.** `node tools/doc-search.mjs --read "split run_oxyii into smaller functions so mypy can type it"` ranks memory `a-rows-remedy-is-a-hypothesis` first, which is the row-closure reasoning this unit followed.

## What the split measured

An untyped `def` has an unchecked body under this mypy invocation, so the 567-line `on_data` closure went unchecked while its enclosing `async def` did not. Lifting it to module level is what made mypy read it, and mypy then named a reachable None write. That is the unit's payoff, and the row's own cost argument is not. `capture.py` carries a module-level declared mutation exclusion, so the diff-scoped gate charges nothing there.

The error the order names no longer exists. #3262 widened `_rtc_sync` on 2026-10-04, and `MYPY_BASELINE` has read 0 since 2026-10-09.
