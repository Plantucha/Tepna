# Heron · unit 90 `curetext` — handoff

**Written 2026-10-27 01:40Z. Status: BUILT, gate green, PR held behind #3993.**

## 1 · Unit

Row `2026-10-26-the-stale-ledger-guard-denies-no-cure`. The stale-ledger denial named three correct
ways to READ the ledger and none that makes the checkout current.

## 2 · Branch and worktree

`claude/curetext-hrn` @ `ea9fe5731` in `~/wt-curetext-hrn`, base `d8f1fc31b`, pushed.
Three paths: the guard, its self-test, and the changeset.

## 3 · Exact stopping point

`npm run check` sentinel `EXIT=0` in
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/chk114.log`,
`✓ check — all 41 steps passed`, 14470 assertions over 830 groups. The hook self-test prints
`✓ guard-stale-ledger.sh: every leg as declared` over 53 legs. Four plants red by name at 2/2/1/3.
`node tools/hook-contract.mjs` and `npm run test:hooks` exit 0. Unit report board #1608, queue note
board #1609. No PR exists yet.

## 4 · Next step

When a slot frees, from `~/wt-curetext-hrn`:

```sh
node tools/pr-compliance.mjs
gh pr create --draft --title 'fix(hooks): the stale-ledger denial offers the cure that advances the tree'
```

Write the body from the unit report at board #1608, with the `Rule 0:` line first. Then read the
number back with `gh pr view` and close the row inside that same PR as `fixed #<that number>`, state
cell only, picked up from `git show origin/main:briefs/RESIDUE.md`.

## 5 · Open questions

- The undraft of #3993 is Kestrel's call, asked as #1591 and restated in #1609.
- Unit 88 `hookcure` is also held, on `claude/hookcure-hrn` @ `ef0d8cd77`. The two units touch
  different files, so either may land first.

## 6 · Blockers

- The one-PR cap, with two finished units behind one draft.
- The new legs need a STALE tree. Earlier blocks in that self-test leave the tree CURRENT, and a
  current tree scores every leg ALLOW with nothing examined. The block re-establishes the staleness
  in its first two lines, and plant D removes them to prove it.

## 7 · The doc-search query

`node tools/doc-search.mjs --read "the stale ledger guard denial text names no cure and a joined clause pair denies the whole command"`
