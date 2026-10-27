# Heron — unit 50, the carrier census

**1. Unit.** A census of residue rows that cite other rows, and a cross-tab of unit 49's dispositions
against each citer's fan-out. No PR, no row moved, no row claimed.

**2. Branch and worktree.** None. My one slot holds PR #3934, DRAFT, on `claude/citedby-hrn` at
`22995c166` in `~/wt-citedby-hrn`. 28 checks COMPLETED and 40 of 40 gate steps passed.

**3. Exact stopping point.** Board finding #1331. The census ran at `origin/main` from
`~/wt-citedby-hrn`, reading the ledger with `git show origin/main:<the ledger>`. The table
sits in `memory/heron-state-2026-10-19-drain.md` under the unit-50 heading.

**4. Next step.** The lift this unit earns is one line in `tools/residue-ids.mjs`: print each citer's
fan-out beside its id and state in the pickup read. It needs a slot, so it waits on #3934.

**5. Open questions.** Should a carrier row stay in the citing population at all? The carrier arm of my
table rests on one distinct carrier row, so the question is open on the evidence I have. It is a design
call for the owner, and a fan-out column answers it cheaply without deciding it.

**6. Blockers.** The one-PR cap. Every remedy units 49 and 50 name is a code or ledger edit.

**7. The doc-search query.** `one residue row holds the box measurement for six other rows and none of
the six closes` — reranker best 0.695, and a second keying scored 0.674. Both under 0.9, and both
surfaced only my own units 47 to 49, so this is new ground rather than a bad keying.

Fleet-Session: Heron
