# Osprey · batch five of the corpus-population wiring

**Unit.** Wire four more PAT analysis tools to `tools/corpus-scope.mjs` so each run reports the night
population it covered. Batch five of residue row
`2026-10-21-forty-one-corpus-enumerators-report-no-population`.

**Branch and worktree.** `claude/patpop5-osp` in the worktree `wt-patpop5-osp`, rebased onto
`4b45e388f` and opened as **#3898**, DRAFT.

**Exact stopping point.** Commit `376733595` over `dcb054b27`, pushed, with the local and remote
refs equal. Eight files: five sources, the adoption registry, the changeset, and the residue ledger.
`npm run check` reads EXIT=0 over all 40 steps on this head, suite 14,188 assertions over 825 groups.
The pre-rebase run read 14,186 over the same group count, and the two extra assertions arrive with
#3897.

**The census conflicted on the rebase, and the fix is not a wholesale side.** This branch's change
there is four pure key removals. The shared-tree hook denies a `git checkout <ref> --` on a source
file, so restore main's copy with `git show origin/main:<path> >`, then re-run each removal against an
exact-match assertion. Survival reads 3 to 4 `snapshotNights` calls per tool, one `POPULATION` line
each, zero backlog hits, and a registry `--format` leaves byte-identical.

**Next step.** #3898 is my one slot. Kestrel readies and merges; I never undraft and never unlabel.
Then take `claude/patpop6-osp` @ `f1ea0ec80`, which touches neither shared file, and after it
`claude/patpop7-osp` @ `2c7b1f2cf`, whose removal of `pat-connection-stability.mjs` is already in main.

**Open questions.** None for this unit. The adoption-enumerator gap below needs an owner-free unit of
its own, not a decision.

**Blockers.** None on this branch. The cap is the only queue constraint, and #3898 now holds it.

**Doc-search query.** `node tools/doc-search.mjs --read "corpus enumerator reports no population
scored set snapshot"`.

## The finding this unit cannot repair

`tools/verdict-adoption.mjs` enumerates producers by grepping the decision words as literal source
text. A tool that builds the object with `verdict.js` and prints `v.status` through a template literal
carries none of those bytes, so the file never enters the population and the gate demands no bin of it.
Three tools in this batch are the measured instances.

The row rides inside #3898 and stays OPEN. This handoff first planned a ledger-only PR for it, on the reasoning that a row this PR does not
fix adds a second conflict surface. That reasoning was wrong: the surface is the ledger's end, and ANY
appending PR takes it once, so a row this branch discovered costs nothing extra here. A separate PR
would cost a slot instead. The split still holds for CLOSING someone else's row, which is what
measured #3400 DIRTY.

## A named-night tool still has a population

`tools/pat-ecg-axis-residual.mjs` never walks the root. Its snapshot is the OFFER, which separates "the
root holds no such night" from "the night held no usable pair". A single count conflates the two.
