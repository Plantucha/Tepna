<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-2026-07-26-BRIEF.md
---

Unblock every PR that does not touch `capture-host/`. The required contexts `test (py3.12)` /
`test (py3.13)` were never reporting, so PRs sat BLOCKED with all visible checks green.

A skipped **matrix** job never expands its matrix: it reports one check under the unexpanded literal
`test (py${{ matrix.python-version }})`, and the two required names never appear at all. The
workflow's own note asserts that a job skipped by a condition "reports as skipped and satisfies the
requirement" — true for a plain job, false for a matrix one, which is what this job is.

It was masked until now: the unscoped `push:` trigger produced a second run per commit that did
expand the matrix, so the required names arrived from the duplicate. Scoping `push:` to main (#837)
correctly killed a real duplicate-run deadlock and removed the run that was accidentally satisfying
the requirement. #838, #840 and #842 were all blocked at 18/18 green.

Fix: drop the job-level `if:` and put the relevance condition on each of the six steps. The job always
runs and always expands to the two required names; an irrelevant PR pays one runner spin-up per leg
(no checkout, no pip) instead of ~80 s, so the saving the `changes` job exists for is kept.
`mutation-diff` is deliberately untouched — it is not in the required set, so a job-level skip is
correct there.
