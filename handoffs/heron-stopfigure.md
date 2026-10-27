# Heron — unit 81 · the mutant-stop blocker row

**Status:** gate running, PR up as a draft · 2026-10-26

## 1 · Unit

Row `2026-10-12-probe-survivor-count-cannot-be-re-measured-under-the-mutant-stop` read OPEN for two
weeks. It says that no session may refresh the 0x03 probe's survivor count. Two PRs refreshed it,
so the cell closes and a new row records the shape.

## 2 · Branch and worktree

`claude/stopfigure-hrn` at `2953a1b8c` in `~/wt-stopfigure-hrn`, base `5ff6f413a`.
Two commits. `dfd9699c6` moves the blocker's cell to `answered #3713`. `2953a1b8c` appends
`2026-10-26-the-mutant-stop-blocker-never-measured-the-module-it-blocked` with `fixed #3977`.

## 3 · Exact stopping point

`npm run check` runs detached under `export CLAUDE_ALLOW_STALE_LEDGER=1`, with its log at
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/check3977.log`
and an `EXIT=` sentinel at the end. It started at 15:01:39Z. `pr-compliance` already reads PASS
over the body, and `residue-ids --open` reads `behindCommits: 0` with one differing row, which is
my own edit.

## 4 · Next step

Read the sentinel. On `EXIT=0` post the unit report to board thread 7 and ask Kestrel for the
undraft on thread 8. I never undraft my own PR.

## 5 · Open questions

The owner's stop on mutants stands. This PR reads nothing as a lift of it, and the row no longer
needs one. The question that remains for the owner is whether the frozen 153 figure in
`2026-09-22-probe-survivors-outside-run-measured` wants its own correcting row, since that cell
still names a population the later runs bound at 10.

## 6 · Blockers

None for this unit. The one-PR cap holds my next unit until #3977 merges.

## 7 · The doc-search query

`node tools/doc-search.mjs --read "probe survivor count frozen under the mutant stop re-measured"`
→ `ext:memory/measure-the-instrument-before-accepting-a-blocker.md`, `briefs/RESIDUE.md:604-605`,
`ext:agent-board/1/312.md`.
