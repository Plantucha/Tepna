# Osprey — the four PAT/ACC runs report their night population

**Unit.** Residue row `2026-10-21-forty-one-corpus-enumerators-report-no-population`, fourth batch:
wire `pat-dip-validate`, `pat-residual-structure`, `pat-drift-attribution` and `acc-shared-movement`
to the population primitives in `tools/corpus-scope.mjs`. Board claim #1024, held by me.

**Branch + worktree.** `claude/patpop4-osp` @ `56a16480a`, worktree `wt-patpop4-osp` beside the
primary checkout, rebased onto `origin/main` `5eea29572` and opened as **#3897**, DRAFT.

**What landed in the commit.**

- Each of the four walks is now `snapshotNights(<root>)`. The run publishes the offer it saw, a
  re-snapshot after the loop, and `notANight` over the SELECTED set.
- `/^2026-/` in the two PAT walks goes to `snapshotNights`'s `re`, which measures it against
  `NIGHT_RE` over the same listing. `--only` stays a selection beside the walk, named by the count
  of offered nights it left unread.
- The human line labels the status as MOVEMENT. `checked` is the snapshot intersection, and a first
  draft read it as a scored count: it printed `97 scored` for a run that scored none.
- `acc-shared-movement` publishes `offered` and `population` inside each of its two stdout JSON
  documents. Human lines stay on stderr, so a `jq` reader still sees one document.
- `verdict-adoption.json`: `pat-dip-validate` added as `already-json`/adopted; `acc-shared-movement`
  and `pat-drift-attribution` re-binned off `word-only`/exempt, whose "selftest assertion printer"
  reason goes false the moment a run prints a population.
- Four keys left `UNWIRED_BACKLOG`. The census moved `reports 18 → 22`, `enumerates 96 → 92`.

**Exact stopping point.** Two commits, both gated. `973f7f0f4` wired the four tools; `e16a53327`
repairs the census that reads them. `npm run check` on the second head: all 40 steps, `EXIT=0`,
suite 14,188 assertions over 825 groups, zero failure lines. Before each commit I verified every
sample object, both run modes, both selftests, the adoption registry at 293 producers and biome over
every changed source per file with the exit code read before any pipe.

**The second commit is the tripwire for the first one's claim.** The census cleared a tool as
`reports` on a `populationVerdict` call the run never makes — the fabricated one inside the
`verdictSample` helper the verdict contract asks every wired tool to carry. I measured it by gutting
the real call in `tools/acc-shared-movement.mjs` and leaving the sample: the class stayed `reports`
and the ratchet group stayed green over 28 assertions. `classifyTool` now blanks the sample and
selftest helper bodies first, over the function spans `corpus-reads.mjs` already computes for its
argv rung. I left `tools/js-lex.mjs` alone for that reason: its header refuses a second brace
walker, and the local spans already cover arrow and method-shorthand helpers. The census is
unchanged at 22 reporting tools, so no wired tool was resting on a sample call.

**The rebase tested the prediction below and refuted half of it.** This handoff said #3896 would
conflict in both `verdict-adoption.json` and `corpus-reads.mjs`. Only the census conflicted: the
registry auto-merged, parses, and `verdict-adoption.mjs --format` left it byte-identical. The census
hunk was the real one — main had already lost `pat-connection-stability.mjs` to #3896 while my side
removes four other keys, so the resolution keeps all five removals and resurrects none. Survival
checked per §2c: `blankSampleHelpers` twice in `HEAD:tools/corpus-reads.mjs`, three references in
`HEAD:tests/dex-tests.js`, zero backlog hits for the four wired tools.

**Next step.** #3897 is DRAFT and is my one slot. Kestrel readies and unlabels; I never do either.
Watch CI, then take the next held branch in order: `claude/patpop5-osp` @ `aca82708b`, then
`claude/patpop6-osp` @ `f1ea0ec80`, then `claude/patpop7-osp` @ `2c7b1f2cf`. Five and seven both
touch `tools/corpus-reads.mjs`, and seven's removal of `pat-connection-stability.mjs` is already in
main, so expect the same additive resolution.

**Open questions.** None on this unit. The row stays OPEN: 92 enumerators remain after this batch.
The repair's own row rides inside #3897, closed as the #3897 closure, and `residue-ids --check` reads 1 row added once committed.

**Blockers.** None left on this branch.

**The row owed its own full run, and the code gate said nothing about it.** The rebased code read
EXIT=0 over all 40 steps. The final-state run then RED at step 14 of 40, and the row was the cause:
check8b refuses a residue source cell that is not a backticked repo path, and mine read
`tools/corpus-reads.mjs` bare. That red also left 26 steps NOT RUN, which the gate prints rather
than letting an exit code imply a verdict about them.

The corrected head `f6a38dd62` reads EXIT=0 over all 40 steps, suite 14,188 over 825 groups. CI on
that head reads 22 pass, 4 pending, 1 skipping.

**Doc-search query that finds the prior work.**
`node tools/doc-search.mjs --read "corpus enumerator reports no population verdict"`
