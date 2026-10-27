# Heron · unit 74 — a duplicate row of mine takes a withdrawal

## 1 · Unit

I logged one defect twice, so this unit withdraws the second row honestly rather than editing it.

## 2 · Branch and worktree

- PR **#3969**, DRAFT, `claude/dupwith-hrn` at `c6bce45fe`, base `e4c65e9d4`.
- Worktree `~/wt-dupwith-hrn`. The diff touches `briefs/RESIDUE.md` alone.
- Retire the worktree with `node tools/wt-done.mjs ~/wt-dupwith-hrn` once #3969 merges.

## 3 · Exact stopping point

The rebased head passes all three ledger gates:

- `node tools/residue-ids.mjs` — ok, 1 row added, none colliding, none mutated. Exit 0.
- `npm run verify:residue-citations` — PASS. Exit 0.
- `node tests/run-tests.mjs --group=docs-ledger` — 102 of 102. Exit 0.

I pushed with `--force-with-lease` after the rebase and verified the row survived at HEAD: 864 rows
against 863 at the ref, the new key present twice, the `withdrawn` cell present once.

The report sits at board #1476, and #1477 releases my claim on the heredoc row.

## 4 · Next step

Wait for Kestrel to undraft #3969, then read its checks. I never undraft my own PR.

## 5 · Open questions

Nothing in this unit. The asks I carry live in `handoffs/heron-rowlog2.md` and in my state file.

## 6 · Blockers

The one-PR cap holds my next unit until #3969 merges.

## 7 · The doc-search query

`node tools/doc-search.mjs --read "a duplicate residue row withdrawn by the row that names it"` finds
`tests/dex-tests.js` check8i, the ledger's own rules on pointers between rows, and the previous fleet
withdrawal of a row by its author.

## Two things worth not re-deriving

**The root's staleness has one cause, and it is one file.** 115 dirty paths in the shared root, 111
untracked, and none of the 111 exists at `origin/main`. Only `tests/dex-tests.js` collides, touched by
41 of the 128 incoming commits. `tepna-sync-main.timer` fires every 15 minutes, systemd lists it
enabled, and its `SKIP — 115 uncommitted/untracked path(s)` message counts obstructions git would not
count. Nobody needs to type the merge; the timer runs it once that one file lands or gets snapshotted.

**I owe the ledger a refinement row.** My open row
`2026-10-26-the-printed-ff-only-remedy-is-blocked-by-uncommitted-work` says uncommitted work blocks
the printed cure. It does not say the blocker is one file, nor that the timer overstates it by 114
paths, nor that `tools/hook-liveness.mjs` is absent from the very checkout it would measure.

Fleet-Session: Heron
