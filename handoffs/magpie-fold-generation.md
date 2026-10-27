<!-- SPDX-License-Identifier: Apache-2.0 -->
# Magpie — published-number fold generation

**Unit:** residue `2026-09-22-corpus-consumers-have-no-staleness-stamp`, CONSUMER half (one slice).
**Branch:** `claude/foldgen-mg` · **Worktree:** `wt-foldgen-mg` · **PR:** #3854 (DRAFT) @ `0a74739d9`.
**Rule 0:** `published number records which fold generation produced the corpus staleness stamp` →
`briefs/RESIDUE.md:350`, `briefs/SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md:597-609`,
`papers/sigma-no-reference.html:169-171`.

## Stopping point

`npm run check` reads 40/40 and `EXIT=0` on the final head `0a74739d9`, suite 14,071 over 819
groups, zero failure marks. Earlier full runs read the same on `8b198b9ab` and on the rebased
`b6f84150a`. CI on the pushed head is green so far, with the suite shards that reded before now
passing.

🔴 **CI found a defect this machine cannot see.** The first push read PASS locally and SHORTFALL on
suite shard 4. Kodiak squashes, so a record's `producerCommit` is an ancestor of `main` only when it
IS the squash. Three of the five trio cut commits are not, and they survive here as unreferenced
objects. A fresh clone holds none of them. The verdict now reads UNKNOWN for a cut this clone cannot
read, reds only a MOVED export, and the suite asserts the invariant that holds in both clones.

## What landed

- `tools/fold-generation.mjs` — two identifiers over `uploads/trio`, never merged: `dataDigest` over
  the export files, and `foldGeneration` over the night set plus each night's `.trio-stamp`
  `codeDigest`. `--all` re-resolves every `analysis/published-numbers/*.json` record and emits a
  `published-number-corpus` verdict; both CLI paths also emit `corpus-population`.
- `tools/tch-pooled-hat.mjs` emits the block, scoped to the nights it read.
- A suite group of 31 assertions, four planted controls, an anti-vacuity leg. The selftest reads 44.
- `tools/verdict-adoption.json` names the producer (`emits.key: verdict`).

## Measured

147 night folders · 569 export files · 90 nights stamped under one digest `54df21a0a400403d` · 57
unstamped. The pooled hat reads 90 nights and all 90 carry a stamp. Of the 57 unstamped, 43 hold one
OxyDex export, and nine of the remaining 14 hold both Polar exports.

## Next step

The row stays OPEN. `CLAIM x = v FROM …` markers and `TABLE-PROVENANCE` stamps still carry no fold
identifier, and four producers still write the mixed all-files digest over roots this tool does not
judge. Both halves are the obvious next slice.

## Open questions

- Does the next fold stamp the nine unstamped Polar nights, or do they stay unattributable?
  Row `2026-10-21-nine-trio-shaped-nights-carry-no-fold-stamp` holds the question.
- Should a published record carry the cut's TREE identity beside its commit? A tree digest survives
  any merge policy. Row `2026-10-21-a-published-record-names-a-commit-the-squash-merge-does-not-keep`
  holds that one.
- Re-cutting the four other producers onto the split block changes records that briefs cite.
  Nobody has ruled on whether a re-cut record may replace one a brief already names.
