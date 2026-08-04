<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
capture-host CI: a skipped MATRIX job never reports its expanded contexts, so every docs-only PR could deadlock on required checks that will never exist.

`capture-host-ci.yml`'s design note says *"a job skipped by a condition reports as skipped and satisfies the requirement"*. That is true for a **plain** job and **false for a matrix** job: a matrix is only expanded when the job runs, so a skipped matrix job registers **one** check under the literal `test (py${{ matrix.python-version }})` while the two **required** contexts `test (py3.12)` / `test (py3.13)` never report at all. Branch protection then waits forever on checks that cannot exist.

**Measured 2026-08-04 on PR #842** (docs-only): `relevance (capture-host)` logged `decision: run=false`, the run finished with **18 checks passing, 0 failing, 0 pending**, and `mergeStateStatus` sat at **BLOCKED** permanently.

**Why it was not constantly red — and why that is worse.** A docs-only PR only deadlocks when nothing else happens to supply the contexts. PR #833, also docs-only, escaped because a `push` run on main reported them for the same commit (`decision: run=true (event=push)`). So the gate's correctness depended on luck, and **the better-behaved the PR the more likely it hangs**: rebasing right onto current main and touching nothing under `capture-host/` is exactly the state that produces `run=false`.

The note had even *observed* the unexpanded literal on PR #776 and attributed it to duplicate runs rather than to skipping a matrix — the evidence was in hand and read as a different bug.

**Fix:** move the guard from the job to its steps. The job always runs and the matrix always expands, so both required contexts report; the ~80 s of real work is still skipped. Cost on an irrelevant PR is checkout + `setup-python` (~15 s, both legs in parallel) against the previous ~8 s. Only `checkout` and `setup-python` are unguarded; all four costly steps (deps, ruff, shellcheck, pytest) carry `if: needs.changes.outputs.run == 'true'`, plus a step that says so in the log.

No change to the required-check invariant the note defends: an irrelevant PR now reports **passing** rather than **skipped**, which is the same semantic and actually reaches branch protection.
