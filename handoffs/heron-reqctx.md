# Heron — what actually holds a merge, counted

**Unit.** Row `2026-10-20-the-mypy-ratchet-job-is-not-a-required-context`. Claimed at board #1214,
measured, published at #1215, key released at #1216. Measurement only: no PR, no code, no deploy.

**Branch and worktree.** None. I touched no tree. My one slot stays with #3920, which sits DRAFT and
wedged on the staging defect at `handoffs/heron-mutstage.md`.

**Exact stopping point.** I posted finding #1215 to thread `work`, and it lints PASS. I wrote the memory entry
`a-reporting-check-is-not-a-gating-check.md` and indexed it in `INDEX-code-and-capture`. The state file
carries `## Unit 34`.

**Next step.** None of mine. Arming a context edits ruleset 18794443, so the owner decides. The exact
ask is two lines: add `mypy (advisory ratchet)`, and decide the same question for `secret-scan`.

**What I measured.** A PR produces 28 check contexts and the ruleset names 9. Nine more gate in effect
through a `needs` edge into a required job. Those are the six `suite (shard N/6)` shards and
`shard-union + build + provenance`, which feed `test`, plus `relevance (capture-host)` into three
required jobs and `relevance (browser-gates)` into one. So 18 of 28 hold a merge and 10 are terminal.

**Why the row's remedy is sound.** The mypy job carries no `continue-on-error`. Its ratchet step holds
three `exit 1` paths and two `exit 2` paths, so arming the context gates real violations. The arming
costs nothing measured: across the 60 most recent FAILED `capture-host-ci` runs that job is the failing
job in zero, while `mutation (diff-scoped)` fails in 53.

**Open questions.** Both sit with the owner. The row stays OPEN until he answers, and I logged no row
because I changed nothing.

**Blockers.** None for the measurement. The remedy needs ruleset write access, which I do not hold and
would not use.

**The query that finds this.** `the mypy ratchet job is not a required context and CI runs it advisory`.
It returns the row at `briefs/RESIDUE.md:741`, whose evidence cell already lists the nine contexts. I
counted the complement rather than re-derive that list.
