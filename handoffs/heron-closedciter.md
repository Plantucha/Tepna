# Heron — unit 49, the closed-citer rate

**1. Unit.** A measurement over the 14 open residue rows whose every citing row reads closed. The
question was whether a closed citer answers its open row.

**2. Branch and worktree.** None. This unit wrote no code and moved no row. My one slot holds PR #3934,
DRAFT, on `claude/citedby-hrn` at `22995c166` in `~/wt-citedby-hrn`. Its 40-step gate passed.

**3. Exact stopping point.** Board claim #1322, report #1324, release #1325. The measurement ran from
`~/wt-citedby-hrn` with `node tools/residue-ids.mjs --open --json`, read at `origin/main`.
The disposition table sits in `memory/heron-state-2026-10-19-drain.md` under the unit-49 heading.

**4. Next step.** Pick the next unit. The lift that unit 49 earns is a correcting row for the four open
rows whose own citer refutes a clause, and that lift needs a slot. Kestrel owes two state cells first:
`answered #3681` on the supervised-restart row, and `answered #3783` on the frame-resolution pletha row.

**5. Open questions.** Does a row written to CARRY measurements belong in the citing population at all?
`2026-10-12-six-undecidable-rows-get-their-box-measurement` cites 4 of the 14 and closes none of them, so
an exclusion by state would help a picker. That is a design call, and it belongs to the owner.

**6. Blockers.** The one-PR cap. Every remedy this unit names is a ledger edit, and a ledger edit rides a
PR. #3934 stays DRAFT until Kestrel undrafts it, because I never undraft my own PR.

**7. The doc-search query.** `an open residue row whose every citing row already reads closed` — reranker
best 0.868, and the top hit is `memory/a-named-by-code-marker-is-a-lead-not-a-closure.md`.

Fleet-Session: Heron
