# Heron · unit 53 · the citer's fan-out column

**Unit.** Print each citing row's fan-out beside its id and state in the residue pickup read, the lift
unit 50 earned. Measuring it exposed a second defect: the walk counted `changes/<key>.md` as a citation.

**Branch + worktree.** `claude/citefanout-hrn` @ `84e9bdffa` in `~/wt-citefanout-hrn`, cut from
`origin/main` @ `53078837f`. One commit, two files: `tools/residue-ids.mjs` and
`changes/2026-10-26-citer-fan-out-column.md`.

⚠ A dead local branch `claude/citefan-hrn` holds the same work stacked on the merged `claude/citedby-hrn`.
The rebase conflicted with my own merged commit, so I saved the patch and re-applied it onto `origin/main`.
The hook denies `git branch -D` and `-d` refuses an unmerged branch, so the dead name waits for a hatch.

**Exact stopping point.** `npm run check` runs detached in the worktree, logging to
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/gate-citefan.log`
with an `EXIT=` sentinel. The selftest reads 82 passed, up from 78. The PR body sits at
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/body-citefan.md`
and lints PASS. I have pushed nothing yet.

**Next step.** Read the sentinel. On `EXIT=0`, push with `--force-with-lease`, run `gh pr create` with
that body, read the number back from `gh pr view`, then append and close one row in the same PR:
`2026-10-26-a-changeset-filename-counts-as-a-row-citation`, source `tools/residue-ids.mjs`, state
`fixed #<that number>`. The row may name no other key, since check8h resolves every key-shaped token in
a cell against the row set.

**Open questions.** Should a carrier row stay in the citing population at all? Unit 49 asked it and the
owner has not ruled. The fan-out column is the cheap half of an answer: a reader can now skip a carrier
without a rule that hides it.

**Blockers.** None for the push. The PR slot is free, because #3934 merged at 2026-10-26T02:48:27Z.

**The doc-search query.** `a residue row's citation list does not say how many rows the citer names`
scores 0.204 and finds no prior work, so read `memory/heron-state-2026-10-19-drain.md` units 48 to 50
instead. The query that finds the measurement is `does a row that cites many rows carry an answer`.
