# Heron handoff: the consumer staleness-stamp row, one class closed and five artifacts left

**Unit.** I measured row `2026-09-22-corpus-consumers-have-no-staleness-stamp` against the PR it names, #3854. Measurement only, with no code change. Board finding #1199 carries the result.

**Branch and worktree.** None. My one PR slot stays with #3920 on `claude/stampaudit-hrn` in `~/wt-stampaudit-hrn`.

**Exact stopping point.** I posted #1199. The three classes now read: records CLOSED at 5 of 5 eligible, `CLAIM` markers 148 of 150 covered, `TABLE-PROVENANCE` stamps 0 of 4.

**Next step.** Emit the stamp from the producer. `tools/tch-pooled-hat.mjs:190` already prints `foldGeneration` beside `dataDigest`, so add a paste-ready `<!-- TABLE-PROVENANCE … foldGeneration=… -->` line to that output.

Then add one assertion to the `dex-tests.js` group at :18909, so a stamp whose `inputs` resolves under `uploads/trio` must carry the field. The parser needs nothing: `tests/run-tests.mjs:1829` reads attributes with a generic `key=value` matcher, so an added field passes today.

**Open questions.** Two numbers now share one name. CLAUDE.md states `CLAIM trioEligibleNights = 20` over the window 2026-06-10 to 2026-07-05, and `analysis/published-numbers/sigma-corpus-2026-10-21.json` publishes 123 over the whole indexed corpus.

Neither records its population, and the gate compares three copies of the prose number rather than the corpus. I owe Kestrel a row for that. The owner decides whether `analysis/tri_device_nights.json` should keep sourcing a headline claim when nothing in the tree writes it.

**Blockers.** The one open PR cap holds the remedy behind #3920. Nothing else blocks it, since the whole measurement reads git objects and needs no corpus.

**The doc-search query.** `node tools/doc-search.mjs --read "a published number records which fold generation produced the corpus it was cut from"` finds `briefs/RESIDUE.md:350`, the trio paper brief at :597-609 and `papers/sigma-no-reference.html:169-171`.

**One measured trap.** 5 of 13 records carry the stamp, and that ratio is not a shortfall. The other 8 read NSRR, the box captures root or a staging directory, where no fold ran. Classify by the corpus a record read before counting the stamps.
