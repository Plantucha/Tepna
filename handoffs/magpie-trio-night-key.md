<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the trio night key reads the first data row (Magpie)

**Unit:** §4 of `briefs/FILENAME-STAMP-JS-CONSUMERS-2026-10-20-BRIEF.md`, the first of its three
night-grouping scripts.
**Doc-search query that found the prior work:** `trio night grouping keys the night on the filename
stamp offload time` → `tools/trio-anchor.mjs:5-20` · `tests/trio-anchor-tests.mjs:3-81` ·
`capture-host/tests/test_nightqc.py:4453-4465`.

## Where this stopped (2026-10-20 05:45Z)

Shipped as **DRAFT #3746** — `claude/nightkey-mg` @ `6891678f7`, worktree `~/wt-nightkey-mg`,
board thread #5 (claim #415, finish #418).

- `npm run check` → all 39 steps passed, EXIT=0, on `e48986a03`. The head above is an empty commit
  with an identical tree, pushed to re-trigger `pr-compliance`.
- The new group `the trio night key reads the first data row, and says when it could not` runs 21/21.
- Corpus cross-check on the final helper: 9738 agree with `DexClock.parseTimestamp`, 0 disagree, 115
  null on both sides, 8 flips, nights 121/121, eligible 87/87.

⚠️ **The PR is STACKED on #3743** and its base is `claude/namestart-mg`, because the brief item it
ticks lives on that PR. Land #3743 first, then rewrite this base to `main`.

## Next step

**§5 of `briefs/CVHR-HOLE-EDGE-EXCLUSION-2026-10-19-BRIEF.md`** — the mirrored exclusion window in both
nodes, `cvhrIndex` losing the excluded seconds from its denominator, and a named refusal when no
resolvable span remains. DRAFT #3723 still holds that brief, so it waits. That unit moves both
bundles and all six PpgDex fixtures: `node tools/build.mjs --app PpgDex` BEFORE
`tools/regen-ppgdex-goldens.mjs`, then the corpus lap.

Free for anyone, named in §4 of this unit's brief and on board #418:
`sensor-trio-power-analysis.js` and `sigma-no-reference-analysis.js` carry the same night key, one unit
each. `dex-ingest.js stampMs` still builds an instant from unvalidated components, which moves four
bundle hashes and owes the corpus lap.

## Carry these forward

**A population delta is not an output delta.** Nights read 121 by name and 121 by row, eligible 87 both
ways, nothing gained or lost. The output still moves on 10 of the 121 nights, and FOUR of those ten
move no bucket at all — they change because the nearest-to-anchor comparison now runs on the row stamp.
Counting the nights would have reported a no-op. Count the thing the tool CHOOSES.

**A published figure moved and this PR names it rather than fixing it.**
`papers/sensor-trio-nights.html` §3.4 reports a 26-night corpus from 2026-06-10 to 07-05, and
2026-06-19 changes its chosen verityHR file. Re-running that section decides what a reader who quoted
the old figure should be told, so it is its own unit.

**Cut each guard separately in a negative control** — `memory/a-guard-two-guards-cover-is-untested.md`.
And the `Fleet-Session:` trailer belongs in the PR BODY as well as every commit; `pr-compliance` reads
the trigger payload, so a body fix needs an empty commit behind it.

## Maintenance pass, same session (2026-10-20 06:15Z, board #421)

All five drafts I hold now read MERGEABLE and CLEAN: #3723, #3727, #3740, #3743, #3746. #3740 had sat
red on `pr-compliance` since 04:53Z for a PR body with no `Fleet-Session:` trailer, which also red its
`test` gate through `static` — a red test gate that was not a test. #3723 was CONFLICTING and 12
commits behind, and #3727 was BEHIND and red on `stale-file`. Both rebased with
`node tools/rebase-safe.mjs` and pass all 39 steps on the rebased heads `8a134f3cd` and `a1b19a840`.
