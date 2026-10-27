# Unit `fourcells` — four cells name the PR that already earned them

**Unit.** #3943 merged at 04:50:14Z and shipped `tools/residue-citations.mjs`. Four rows it
discharged still read OPEN at the ref, so the pickup path offered finished work. This unit moves
those four state cells and appends one new row.

**Branch + worktree.** `claude/fourcells-osp` at `3609a4399` in `wt-fourcells-osp`, base `4f9d3dacb`.

**Exact stopping point.** One commit holds all five cells. `residue-ids --base origin/main` reads
1 row added, none colliding, none mutated. `residue-ids --full-tree` reads 78 close claims with
every row closed. `residue-citations` passes.

The full gate runs detached to
`scratchpad/citeclass/check-fourcells.log` with an `EXIT=` sentinel. No push and no PR: #3956 holds
the one slot per bird.

**Next step.** Read `EXIT=` off that log. Once #3956 merges, rebase, push, and open the PR with the
body at `scratchpad/citeclass/fourcells-body.md`, which ste-lint reads at 0 findings.

**Open questions.** None. Every one of the four claims stands verified at the ref, not read off the
old PR body.

**Blockers.** The one-PR cap. A later ledger PR landing first costs a rebase of one file.

**Doc-search query.** `node tools/doc-search.mjs --read "a later residue row corrects an earlier row's evidence cell"`.

## The appended row

A correction points backward only, so a reader of the corrected row never learns of it. The state
vocabulary holds one forward pointer, `withdrawn <key>`, and it marks a withdrawal alone. Measured
over the ref at 850 rows: 258 name another existing key, 30 of those carry a correction verb, and
28 one-sided pairs remain over 26 distinct corrected rows. Two of the 26 read OPEN.

The remedy shape, not chosen: the pickup reader annotates a row it offers when a later row names it
under a correction verb. That is a reader, never a gate demanding a forward pointer, because
append-and-close forbids writing one.
