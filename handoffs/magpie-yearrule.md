# Magpie — unit `yearrule`

**Rows:** `2026-10-26-the-327-night-shaped-figure-counts-directories-over-two-scopes` (closed here) and
`2026-10-26-the-corpus-night-rule-is-pinned-to-one-calendar-year` (stays OPEN — see below)
**Branch:** `claude/yearrule-mg` · **Worktree:** `wt-yearrule-mg` (sibling of the primary checkout)
**Rule 0:** `night rule year literal pinned caller passes population criterion pre-stated` →
board #1537, #1347, #1530, #1535, #1293.

## I take one half of the order and refuse the other, on the fleet's own record

Kestrel ordered both rows. I close the 327 row and I leave the year row open.

**The year half is an owner decision and two birds already said so.** Osprey measured it as unit
`yearfree` (#1347) and took no code. Heron measured the horizon as unit `yearhz` (#1530) and took
only the tripwire. Closed row `2026-10-21-the-reference-validation-night-filter-is-pinned-to-one-year`
put the same question once and answered it: the rule stays and the output says so. Widening it
re-scores every published PAT and TCH figure. Kestrel's own #1350 still lists #1347 as an owner
ruling waiting in his handoff.

Three further facts close the year half for now. The suite pins the literal for six of the eleven
tools, and its comment calls a widening "a population change wearing an accounting fix's clothes".
CLAUDE.md §🧾 rules that a threshold drawn from the data it judges reads `UNKNOWN`, and the night
rule is the population criterion, so deriving it from the corpus would void all eleven verdicts. The
row's own clause that no output names the year as the reason is already REFUTED by `fixed #3982`.

## What the 327 row asked for, and what now answers it

The row wants the corpus size to come from a measurement. The number 327 appears nowhere outside the
ledger, and rows never change, so the remedy is a command rather than an edit.

`node tools/corpus-scope.mjs --nights` publishes a `tepna.verdict/1` census over the documented
roots. Today it reads **286 night-shaped directories over 129 distinct names, across 3 distinct
trees, from 9 documented roots**, dated 2026-06-10 to 2026-10-27. Five roots do not walk here and one
aliases another. No sum of today's readings reaches 327.

The census states the two units apart, names its depth and its rule, and says in its own output that
a directory is not a night.

## Why the walk is recursive, and why the scorers keep theirs

🔴 **A ONE-LEVEL WALK OF THESE ROOTS READS 25 NAMES SHORT.** I measured both walks over the
documented roots: the flat union holds 104 names and the recursive union holds 129. The flat set is a
strict subset, so the error only ever understates. `/srv/data/tepna-corpus/uploads/` is the clearest
case — a `readdirSync` of it names zero nights while 180 night directories sit one level down.

I changed no scorer and I did not touch `snapshotNights`. That primitive reads one level because a
scorer's population is what its own `--dir` offers directly, and eleven shipped tools take their
population from it. The census asks a different question, so it gets a different walk.

## Where the code sits, and the constraint that placed it

`corpus-scope-core.mjs` gains `nightDirsUnder` and `nightCensusVerdict`, both pure. The lister is
REQUIRED and injected, and the core throws without one.

⚠️ **THAT IS NOT A STYLE CHOICE.** The module header records why the file split: `closureHazards`
reads the whole text of every module in an importer's closure. A `find` inside the core would mark
all eleven scorers `exec`. So the walker `findDirNames` stays in `corpus-scope.mjs`, beside
`countUnder`, which already shells out.

`-L` is load-bearing in that walker. Three documented roots are symlinks, and a `find` that starts at
one prints nothing and exits 0. Osprey hit exactly that in #3950 and read four trees as empty.

## The plant

Nine new selftest legs, 107 passing in all. One is the plant: a nested tree where the one-level walk
answers 0 and the recursive walk finds 3 directories over 2 names. Capping the walker at
`-maxdepth 1` reds that leg alone, and restoring the walk gives 107 of 107.

Three legs hold the §∅ line. An unwalkable root reads `null` and never `0`, a run with no walkable
root reads UNDERPOWERED with a reason, and an unparsed doc reads NOT_RUN with a null result.

## One thing I got wrong, and it cost nothing because Osprey had already paid for it

I fed `parseRoots` output straight into `dedupeRoots` and read six roots as `alias-of undefined`.
`dedupeRoots` wants the count-bearing rows and an injected resolver, and `parseRoots` keys its rows
on `path`. Osprey made the same mistake in #3950, called it his own error and logged no row. Mine is
the same error and gets the same treatment.

## Still owed, and not in this PR

A new row: `night-rule-horizon.mjs` publishes `nightsOffered` from a one-level union, so the tripwire
judges a smaller population than the corpus holds. A nested 2027 night would escape its probe. I log
the row and I do not touch Heron's tool.

The year row needs an owner ruling, not an implementer.

---

## FOLLOW-UP 2026-10-28 — unit `elideup`, branch `claude/elideup-mg`

#4033 merged as `6aa9cfa40` while Kestrel's review order was still open, so Osprey's finding rides a
second PR off the same worktree.

🔴 **MY CENSUS OMITTED THE LARGEST TREE IN THE CORPUS, AND IT SAID NOTHING.** `docs/CORPUS-LOCATIONS.md`
writes the primary checkout's tree as `<primary checkout>/uploads`, `classifyRoot` marks a
`<placeholder>` row `elided`, and the census walks countable roots alone. Osprey read the published
figure against his own walk and named the gap (board #1766). The omitted tree holds 249 night-shaped
directories over 156 names, 47 of them in no other root, and it opens the span five weeks earlier.

**A ROW THAT CANNOT BE WALKED AND A ROW THAT WAS NEVER TRIED READ THE SAME IN A CENSUS.** Both print as
excluded, so the output argued for its own completeness. The published total was 286 directories over
129 names, and it read as the corpus size.

`applyElidedUploads` resolves that one row through `corpusSearch`, the resolver `verify-fixtures.mjs`
already uses: `$DEX_UPLOADS`, then the primary checkout, then this one. The row keeps the document's
elided text as its printed name, because the resolved path is a home directory and a published census
may not carry one. The row prints the candidate that answered. When no candidate exists the row stays
excluded and names the resolver that failed, never a zero (§∅).

| | directories | distinct names | span |
|---|---|---|---|
| before | 286 | 129 | 2026-06-10 → 2026-10-27 |
| after | 535 | 176 | 2026-05-03 → 2026-10-27 |

**Osprey's 287/130 against my 286/129 is a RULE difference, not an error.** His prefix rule admits
`2026-07-19.PRE-FIX` under the workshop-imports tree. `NIGHT_RE` anchors both ends, so the census refuses it,
and that anchored rule is the one the eleven scorers run.

Eight selftests, 115 in all. Planting a pass-through `applyElidedUploads` reds four of them and names
the row.
