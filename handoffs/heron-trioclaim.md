# Heron — unit 101 `trioclaim`

**1 · Unit.** Produce the trio-eligible night population from the tracked fold corpus, so the published
count reads off a list rather than beside a typed one. Row
`2026-10-25-the-trio-eligible-claim-resolves-to-an-unproduced-list`, claim #1623.

**2 · Branch and worktree.** `claude/trioclaim-hrn` in `~/wt-trioclaim-hrn`, base `330fe4a58`
(the #4013 merge). Ten paths dirty, nothing committed at the time of writing.

| path | state |
|---|---|
| `tools/trio-eligible-nights.mjs` | new — the producer, 20 selftest legs |
| `analysis/tri_device_nights.json` | regenerated as one `tepna.verdict/1` |
| `CLAUDE.md` | the CLAIM moves to `#result/window/count`, 20 → 17 |
| `docs/CLAUDE-MD-RATIONALE.md` | the dated note, plus the three-populations paragraph |
| `briefs/PUBLISHED-NUMBER-PROVENANCE-2026-09-15-BRIEF.md` | a superseded note under the kept sentence |
| `tests/run-tests.mjs` | the import, `readTrioNights()`, the `trioNights` env key |
| `tests/dex-tests.js` | group `docs · claude-md · trio-nights`, 25 assertions |
| `tools/verdict-adoption.json` | the producer row, 276 → 277 |
| `docs/TOOLS-INDEX.md` | regenerated |
| `changes/2026-10-27-trio-eligible-nights-are-produced.md` | new, `patch` / `fixed` |

**3 · Exact stopping point.** `npm run check` runs detached over the final tree, writing
`$SP/chk101d.log` with a `CHK4_EXIT=` sentinel. Two earlier runs reded on canonical forms a new tool
owes. Step 13 of 41 wanted `all 20 selftests passed` as the selftest's last line, and step 15 wanted
`isCliEntry(import.meta.url)` in place of my hand-rolled entry comparison. The tool carries both now.

**4 · Next step.** Read the sentinel. On green, stage the ten paths by explicit path, commit from a
`-F` file, push, and open the PR non-draft with `$SP/body101.md` (ste-lint 0, twice). Then close the
row as `fixed #<N>` with the number from `gh pr view`, inside this PR, and push that commit at once.

**5 · Open questions.** Which population the published figure should name stays owner item 8. This PR
names the tracked tree and says so; the box-side raw-capture plan is a different set, and board #1627
measures it at 91 nights and 18 in the window.

**6 · Blockers.** None. The PR slot is free: #4013 merged and `wt-done.mjs` retired its tree.

**7 · The doc-search query.** `trio-eligible nights published count typed list provenance` → board
#1266, board #1627, memory `an-open-row-at-the-ref-cannot-see-a-merged-fix`, memory
`trio-corpus-37-nights`.

## What the unit measured

- The tracked tree holds 147 night folders, 26 inside 2026-06-10 → 2026-07-05. 90 fold three devices
  corpus-wide, and 17 do so inside the window. Someone typed the published 20.
- Two instruments agree on all 147 folders: each night's `.trio-stamp` and its tracked trio exports.
  The producer reds on a split, so a later divergence stops the gate.
- 74 nights carry `PpgDexFinger_<night>.node-export.json`, which no stamp names. A prefix match would
  admit it as the PpgDex leg.
- `uploads/trio/trio-batch-verdicts.json` carries the real criterion and cannot serve as the pointer:
  one night, and a box-side capture root absent from the repo.
- The window figures differ from board #1627's by 2026-06-19 alone. That folder carries OxyDex and
  PpgDex, no ECGDex export and no stamp.

Fleet-Session: Heron
