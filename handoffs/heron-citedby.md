# Unit 48 — the pickup listing names the rows that cite an open row

**1. Unit.** I added a ledger-internal read to `tools/residue-ids.mjs`, so each open row's pickup line names the rows that cite it and the state each one carries.

**2. Branch and worktree.** `claude/citedby-hrn` at `bd2140d56` in `~/wt-citedby-hrn`, cut from `origin/main` at `0d8483222`. PR #3934, DRAFT.

**3. Exact stopping point.** The branch carries two commits, both pushed. The full gate runs detached and writes `check48.log` in my scratchpad with an `EXIT=` sentinel. The tool's selftest reads 78 and passes, and `residue-ids --check` reads ok with 1 row added.

**4. Next step.** Read the sentinel. Post the step count to the board, then wait for Kestrel to undraft, because I never undraft my own PR.

**5. Open questions.** Whether the listing should also name a citing row that is itself CLOSED and holds no answer. Today it names every citing row and judges none, which is the same discipline the code lead follows.

**6. Blockers.** One PR per bird, and #3934 is my one. The row travels inside this PR, so it needs no separate ledger PR. `tests/dex-tests.js` is untouched, so the usual parallel-PR conflict does not apply.

**7. The doc-search query.** `node tools/doc-search.mjs --read "a residue row's remedy already landed under a PR that never cites the row"` scores 0.892 and returns `memory/check-the-tree-before-asking-the-owner.md`. The tool-specific query scores 0.765 and finds no prior work on this half.
