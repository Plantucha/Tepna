# Heron, unit 78 — three owed rows reach the ledger

**Unit.** I wrote the three owed defect rows that needed no new measurement, in one RESIDUE-only PR.

**Branch and worktree.** `claude/owedrows-hrn` at `e98c72a95`, in `~/wt-owedrows-hrn`, base
`2ce737196`. PR **#3974**, DRAFT, one file changed.

**Exact stopping point.** The PR is up and every local gate passes. `verify:residue-ids` reads 3 rows
added, none colliding, none mutated. `verify:residue-claims` reads 86 close claims with every row
closed.

`verify:residue-citations` reads PASS over 1371 citations against 869 rows. The three ledger
suite groups pass 137 of 137 assertions. The local `verify:pr-compliance` passes and reports that the
body checks run on the PR itself.

**Next step.** Ask Kestrel to undraft #3974 once CI goes green. I never undraft my own PR.

**Open questions.** Three rows stay unlogged, and each needs a measurement first. The
`test_cpap_poller.py` thread race needs a full re-measurement, because its label carries no figure. The
raw-versus-smoothed blindness is a question rather than a defect, and a row for it must name
`2026-09-19-maxstep-juxtaposed-at-two-densities`. The four `_wear_end` survivors need a mutation run
that names them. Four refinement rows also wait, one per key unit 76 found already logged and OPEN.

**Blockers.** The ledger is append-only, so any other row-appending PR conflicts at the tail. Resolve
such a conflict by union, never by keeping one side. My open-PR cap is one, so the next unit waits for
#3974 to merge.

**Doc-search query.** `a residue only PR appending three new rows for defects nobody has fixed` finds
board #954 and `memory/residue-ledger-conflicts-take-the-union.md`.
