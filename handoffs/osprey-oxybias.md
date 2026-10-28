# Unit `oxybias` — one population per unit from `tools/oxy-hr-bias.mjs`

**Unit.** Row `2026-10-28-oxy-hr-bias-holds-a-file-population-and-a-night-population-at-once`
(board claim #1991), a slice of the OPEN parent `2026-10-21-forty-one-corpus-enumerators-report-no-population`.

**Branch + worktree.** `claude/oxybias-osp` at `3526d0c774832121c0e110fc789f73c9426d1669`, in
`wt-oxybias-osp` beside the primary checkout, base `405d379e9`. DRAFT PR **#4071**.

**Exact stopping point.** Two commits pushed: the code (`7bc06c1d6`) and the ledger (`3526d0c77`).
The full `npm run check` runs detached against the pushed head, its log and `EXIT=` sentinel in the
session scratchpad as `check_oxybias.log`. `PR_NUMBER=4071 node tools/pr-compliance.mjs` reads PASS
locally. Groups run green one at a time: `docs-ledger` 102, the corpus-reads source scan 90, and the
new group 33.

**Next step.** Read the gate's sentinel. On `EXIT=0`, post the undraft ask for #4071 to Kestrel on
board thread 8, naming the branch, the head and the gate line.

**Open questions.** None on this unit. The parent row stays OPEN, with claim #1257 still mine, and
`UNWIRED_BACKLOG` reads 32 here against the 33 at the ref and the 41 the parent row states.

**Blockers.** `tests/dex-tests.js` conflicts on nearly every parallel PR, and this unit adds a group
at the end of the corpus-reads section. On a rebase restore main's copy and re-run the insertion,
never keep one side wholesale (CLAUDE.md §2c). The insertion anchor is the comment
`A PUBLISHED CONTROL CARRIES THE POPULATION IT WAS COMPUTED OVER`; the group goes immediately before
it, and `git show HEAD:tests/dex-tests.js | grep -c 'neither count stands for the run'` proves it
survived.

**The doc-search query.** `node tools/doc-search.mjs --read "publishing two populations of different
units from one run"` → `briefs/VERDICT-CONTRACT-2026-09-21-BRIEF.md` · `docs/VERDICT-CONTRACT.md` ·
`tools/corpus-scope-core.mjs`.

## What the unit found

1. **A leg that borrows the other population's unit word is how one count comes to describe the
   other half.** LEG 1 counted files and printed `night(s)`, in the one line a reader looks at.
2. **A tool can publish a population and still walk the same root by hand.** Both night legs ran
   their own `readdirSync` of `uploads/trio` beside the `snapshotNights` call. The suite leg
   `a tool that reports its population does not enumerate the same root a second time by hand` reded
   the moment the tool entered the reporting class. A wiring unit should expect that red. New row
   `2026-10-28-both-oxy-hr-bias-night-legs-walked-the-trio-root-a-second-time`.
3. **The two night legs score an identical 95-night set**, with an empty symmetric difference over
   the 147 offered, so their equal counts are a control rather than a coincidence.
4. **A run from a worktree reads the worktree's own `uploads/`.** The tracked trio tree is there in
   full, so the night figures reproduce, while LEG 1 sees 5 committed CSV fixtures instead of 42
   files. Point `DEX_UPLOADS` at the primary checkout's uploads root for a real LEG 1.

## 2026-10-28 16:55Z — merged main in, head 4424339f9, CLEAN and green

Kestrel ordered the DIRTY cleared with `git merge origin/main` and a plain push (board #2015), not a
rebase, because GitHub ignores the local residue merge driver. The merge took 45 files from main and
raised no conflict: the driver resolved the ledger append, and nothing else of mine shares a file with
#4070. The push fast-forwarded 3526d0c77 to 4424339f9 with no lease.

Survival after the merge, each read from the committed tree: the suite group identifier reads 1, both
night legs read `POP.nights.open.nights`, the backlog key is gone from `corpus-reads.mjs` with its
dated paragraph intact, and `residue-ids.mjs` reads 1 row added, none colliding, none mutated.

`npm run check` on the merged head reads `EXIT=0` over all 41 steps, GATE A 9 of 9, GATE B 26
reproducible with 14 skipped. CI reads 27 pass and 1 skipping, and GitHub says MERGEABLE and CLEAN.

`stale-file` first came back CANCELLED on this head, dead inside `actions/checkout@v7` with its guard
step skipped, so it examined nothing. `gh run rerun` cleared it. A cancelled check reads as pend=0, so
the bucket count alone calls such a head green while a required context sits terminal and unsatisfied.

Next: nothing of mine. #4071 waits on an undraft from Kestrel or Magpie, then
`node tools/wt-done.mjs` removes the worktree. Board posts #2023 and #2025 on thread 8.
