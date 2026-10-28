# Osprey — the five night-shaped keys (2026-10-25)

**Unit.** Wire the five night-shaped census keys to the night population primitive under the held row
`2026-10-21-forty-one-corpus-enumerators-report-no-population`: `trio-batch.mjs`,
`cvhr-edge-widen.mjs`, `stitch-31d-run.mjs`, `motion-rho-vs-minrho.mjs`, `tch-minrho-corpus.mjs`.

**Branch + worktree.** `claude/nightkeys-osp` in the sibling worktree `wt-nightkeys-osp`, cut from
`origin/main` at `28bfedc63`.

**Stopping point.** DONE. PR **#3926 DRAFT**, head `b3751bbf3`, three commits. `npm run check` on that
head reads **all 40 steps passed**, the suite 14,251 assertions over 826 groups, and
`verify:verdict-adoption` 148 adopted at the merge base with 0 de-adopted. The live PR body passes the
real gate's five body checks under `PR_BODY`, and `ste-lint` reads `findings:0`.

**What each tool now does.** It imports `populationVerdict`, `ruleLine` and `snapshotNights` from
`tools/corpus-scope.mjs`, takes the opening snapshot where the old hand-rolled listing stood, scores
the snapshot's own night list rather than a second walk, and prints the prose line, `ruleLine`, and
`POPULATION <object>`. The two trio tools also export a corpus-free `verdictSample()` behind
`--verdict-sample`. The three others already answered that flag under their own gate.

**Measured at this head.** `motion-rho-vs-minrho` and `tch-minrho-corpus` each offer 147 nights and
score 87. `stitch-31d-run` reads 2 under a synthetic captures root against 1 in the manifest.
`trio-batch --dry-run` walks 92 under the source root, calls 84 trio-eligible and plans 2.
`cvhr-edge-widen --from` opens no tree and says NOT ENUMERATED. The census backlog falls from 56 keys
and weight 90 to 51 and 73.

**Two more findings the suite caught, not me.** The first full run reded two legs already in the tree.
`stitch-31d-run` still hand-walked the captures root inside its quiet-hours guard, so the guard and the
population verdict could disagree about which nights exist; the guard now reads the snapshot's list, and
that also gave it an ordering it never had, since `readdirSync` returns none and `slice(-3)` had been
reading three arbitrary nights for recent writes. The two trio tools publish a population the adoption
enumerator cannot see, and the named invisibility set in `tests/dex-tests.js` records that.

**Three findings from the wiring.** The fold's `--dry-run` exit planned a population and reported none, so the
publisher is one helper on all three exits. Every NOT_RUN population reason read "neither snapshot
could not enumerate the root", which states the opposite of what happened. A `--from`
re-aggregation opens no night tree, so a 0 there would read as an empty corpus.

**Next step.** Kestrel undrafts #3926. I never undraft my own PR. The row this PR closes travels inside
it, keyed `2026-10-25-the-population-refusal-reason-states-the-opposite-of-what-happened`.

**Open questions.** Measurement excludes `stage-lab.mjs` (weight 12): its population is
per-dataset PSG records, not nights, and it owes an owner-facing decision rather than a wiring.

**Blockers.** None. The ledger conflicts with every landing PR, so the row commit may need a
`git merge origin/main` before the push.

**Doc-search query.** `node tools/doc-search.mjs --read "corpus enumerator reports no night population"`.
