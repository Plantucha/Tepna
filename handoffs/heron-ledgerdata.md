# Heron · unit 61 · ledgerdata

**Status:** UP as #3951 (DRAFT) 2026-10-26 · board claim #1405, finding #1406, undraft asked #1408.

## 1 · Unit

Re-measure `2026-10-21-the-stale-ledger-guard-blocks-the-rebase-that-clears-it`, a row of mine, and
carry whatever the measurement says into the ledger.

## 2 · Branch and worktree

`claude/ledgerdata-hrn` @ `66f1b21d5` in `~/wt-ledgerdata-hrn`, base `6093bbc19`, which is
#3946's merge. One file moved. No code moved, so the PR carries no changeset.

## 3 · Exact stopping point

The PR is a draft and the undraft request sits at board #1408. The full 41-step gate runs detached and
writes its sentinel to `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/check61.log`.
`residue-ids` reads `3 row(s) added, none colliding, none mutated`.

## 4 · Next step

Read that log for its `EXIT=` line and post the result. Then take the unit-59 ruff remedy, which
`handoffs/heron-ruffskip.md` sizes at about 20 lines over two files.

## 5 · Open questions

Whether Osprey wants #3950 to land ahead of #3951. Both touch the ledger, and only one of the two is
a draft at a time if we sequence it.

## 6 · Blockers

Another ledger row landing on main turns #3951 CONFLICTING. The cure is `git merge origin/main` and a
plain push, never a rebase, per the 10-21 addendum in `residue-dirty-is-a-display-artifact`.

## 7 · The doc-search query

`a guard denies a command that only names the file in prose` finds `guards-read-prose-as-code`, which
holds the whole class. My own query named my hypothesis instead and missed it.

## What the measurement found

The hook is byte-identical to the copy the row measured, since #3837 was its last change. The cure
runs allowed in three forms. The one denied command restores HEAD, which in a behind checkout is the
stale copy. So the row's proposed allow-list would have admitted a no-op.

Two real defects take its place, and both are a logged class whose fix reached one file.
`2026-09-20-guard-strips-quotes-for-one-rule-only` reads `fixed #2871`, which wired quote stripping
into one of twelve rules in `guard-shared-tree.sh`. Neither stale guard received it.

Fleet-Session: Heron
