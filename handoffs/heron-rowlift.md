# Heron — unit `rowlift`

**1. Unit.** Lift five measured rows into the ledger and close two rows against PRs that merged today.

**2. Branch and worktree.** `claude/rowlift-hrn` @ `78010a769` in `~/wt-rowlift-hrn`, cut
from `origin/main` at `67b3f3b1b`, `node_modules` symlinked. PR **#3932 DRAFT**. Claim #1292, report
#1296.

**3. Exact stopping point.** Two commits sit pushed. `5e916c569` appends five rows and closes
`2026-10-21-a-writers-sibling-files-carry-no-envelope-of-their-own` as `fixed #3929`. `78010a769`
closes `2026-10-21-the-solid-card-states-a-stale-night-until-the-rejudge-backlog-reaches-today` as
`fixed #3925`. `node tools/residue-ids.mjs --check` reads ok with 5 rows added, none colliding, none
mutated.

The full `npm run check` runs detached to
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/check-rowlift.log`
with an `EXIT=` sentinel.

**4. Next step.** Read the sentinel, post the step count on #3932 as a comment, and wait for Kestrel to
undraft. I never undraft my own PR.

**5. Open questions.** Kestrel still owes `answered #3908`, `answered #3713`, and an `answered <ref>`
call on the pull-reporting row and the pletha row. The owner still owes the unit-41 question: does
`trioEligibleNights = 20` count nights three devices were worn, or nights the corpus folds three ways?
Nothing in the tree answers it, which is what the new trio-eligible row records.

**6. Blockers.** The ledger conflicts by construction on its tail, and `tools/residue-merge.mjs` appends
rather than merging an edit. So a second RESIDUE PR opening before this one merges risks a duplicate id
on a closure near the tail. One RESIDUE-only PR at a time.

**7. The doc-search query.** `node tools/doc-search.mjs "a residue-only PR appends measured rows and
closes rows other units fixed"` scores 0.922 and names `memory/heron-state-2026-10-12-restart.md:136-152`
for the PR order, `tools/residue-merge.mjs:2-20` for the driver, and
`memory/a-named-by-code-marker-is-a-lead-not-a-closure.md:16-35` for `fixed` against `answered`.

## Three lessons

🔴 **An escape-blind pipe counter calls a good row malformed.** The re-judge row quotes a probability
with an escaped pipe. Both ledger gates split on unescaped pipes only, so that row carries seven pipes
and my `split('|')` read eight. My own memory records this trap from the same day.

⚠️ **A row text sitting in a board post may already be in the ledger.** One of my six keys had landed
under another PR. Check every key against the ref before lifting, even your own.

⚠️ **check8b refuses a bare source path.** The cell must be a backticked brief, repo path or PR number,
and three of my scratchpad rows carried a bare path.
