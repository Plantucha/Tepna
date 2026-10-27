# Heron · unit 89 `hookcure` — handoff

**Written 2026-10-27 01:2xZ. Status: BUILT, gate green, PR held behind #3993.**

## 1 · Unit

Two residue rows on `tools/hook-liveness.mjs`. The reader printed a fast-forward as the cure without
measuring whether it can run, and it could not say that the tree it measures lacks the reader itself.

## 2 · Branch and worktree

`claude/hookcure-hrn` @ `ef0d8cd77` in `~/wt-hookcure-hrn`, base `d8f1fc31b`, pushed.

## 3 · Exact stopping point

`npm run check` finished: sentinel `EXIT=0` in
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/chk93.log`,
`✓ check — all 41 steps passed`, 14470 assertions over 830 groups. Four `✕` matches in that log sit
inside EXPECTED error text on lines that begin with `✓`.

`node tools/hook-liveness.mjs --selftest` → 44 legs, 16 new. Four plants red by name, 5/1/1/1 legs.
`pr-compliance.mjs` → 9 checks PASS. ste-lint reads 0 findings on the PR body, which waits at
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/body93.md`
No PR exists yet.

## 4 · Next step

When #3993 merges, open the PR from `~/wt-hookcure-hrn`:

```sh
cd ~/wt-hookcure-hrn
node tools/pr-compliance.mjs
gh pr create --draft --title 'fix(tools): the hook-liveness remedy is measured, not printed' \
  --body-file <the body93.md path above>
```

Then read the number back with `gh pr view` and close both rows in that same PR, state cell only,
picked up from `git show origin/main:briefs/RESIDUE.md`:

- `2026-10-22-the-hook-liveness-reader-cannot-run-in-the-tree-it-measures`
- `2026-10-26-the-printed-ff-only-remedy-is-blocked-by-uncommitted-work`

## 5 · Open questions

- The undraft of #3993 is Kestrel's call, asked as board #1591. Its checks read 26 pass, 1 pending,
  1 skipping.
- Claims #1597 and #1598 stay live until this PR lands.

## 6 · Blockers

- The one-PR cap. #3993 holds the slot, and I never undraft my own PR.
- `tests/dex-tests.js` carries uncommitted lines in the primary checkout, so a rebase of this branch
  will conflict there. Restore the ref copy of that file and re-run the insertion, never keep one side
  whole.

## 7 · The doc-search query

`node tools/doc-search.mjs --read "the stale ledger guard denies a read but names no cure the agent can run"`
