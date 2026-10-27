# Unit — the host-offset run reports its night population

**Status:** open as #3923, DRAFT, gated green. **Branch:** `claude/hostpop-osp` @ `c351aaabe`.
**Worktree:** `wt-hostpop-osp` beside the primary checkout.

## 1 · Unit

Batch seven of the night-population series: wire `tools/pat-host-offset.mjs` into the series, delete
its backlog key from the census, and pin the series contract in the suite.

## 2 · What landed in the PR

Six files. `tools/pat-host-offset.mjs` prints `POPULATION <object>` beside its prose.
`tools/corpus-reads.mjs` loses the `pat-host-offset.mjs` backlog key. `tests/dex-tests.js` gains two
legs. `tools/pat-connection-stability.mjs` and `tools/pat-dip-validate.mjs` each gain the object
print. The changeset is `2026-10-25-the-host-offset-run-reports-its-night-population.md`.

## 3 · Exact stopping point

The owner undrafted it. GitHub then read `CONFLICTING`, because Heron's #3920 landed on the residue
ledger at 21:11Z. `git merge origin/main` cleared it with no conflict markers, and `residue-ids --check`
reads `1 row(s) added, none colliding, none mutated` on the result.

`npm run check` on the merge head `273d8297c` reads **EXIT=0 over all 40 steps**, suite **14,249
assertions over 826 groups**. The same numbers held on `c351aaabe` before the merge. GitHub reads
MERGEABLE with 24 pass, 3 pending, 1 skipping, and `mergeStateStatus` BLOCKED only while CI finishes.

## 4 · Next step

Hold the one-PR cap until Kestrel undrafts #3923 and it merges. Then retire this worktree with
`wt-done.mjs`, and the abandoned batch-seven worktree with it, since the one file it still holds is the
file main lacked until this PR.

## 5 · Three measured findings

**A held branch decayed.** `claude/patpop7-osp` stopped on six source conflicts. Three of its four
tools had reached main by another route over the three-day gap, so resolving them would have
re-applied finished repairs. A fresh branch carrying the one file main still lacked was the honest
move, and it applied clean.

**A frozen list inside a suite leg decayed too.** The invisible-publisher list named six tools on
10-22. Re-measured live against the adoption gate's own word regex it is 30 builders and 8 invisible.
One tool left the set and three joined. Copying the old list forward would have reded the suite.

**A leg written about the contract caught two tools the unit never touched.** The new leg asserts that
every wired run imports the primitive, prints the object and exports its sample. It reded naming
`pat-connection-stability` and `pat-dip-validate`, which print the sentence and keep the object. Both
are on main and reached nobody machine-readably, which is the reference-validator defect again. I
repaired the tools rather than narrowing a true assertion.

## 6 · Open questions

The enumerator widening that closes the word-keyed adoption row is the later unit. It must bin and
gate the eight invisible publishers it admits, so it is not a one-line change.

## 7 · Blockers

The one-PR cap. #3923 holds the slot, and I never undraft my own PR.

## 8 · The doc-search query

`node tools/doc-search.mjs --read "night population verdict for a corpus tool"`
