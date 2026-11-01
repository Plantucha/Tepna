<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — Magpie, unit `axisref`

**Unit:** `axisref` · **PR:** draft #4228 · **Branch:** `claude/axisref-mg` @ `a357e5f27`
**Worktree:** `wt-axisref-mg` beside the primary checkout · **Cut from:** `d543259e9`

## Rule 0

```
node tools/doc-search.mjs --read "host axis refusal reason reaches no export artifact declared key set hostAxis block"
```

Top hits: `docs/EXPORT-SHAPES.md`, `dex-export.js` `timingBlock`, the `hostaxis-ok` suite group
from #4223, and the memory lesson on the reshape seam. Reranker best score 0.904.

## What landed in the two commits

Rows `2026-11-01-no-artifact-carries-the-host-axis-refusal-the-spine-published` and
`2026-11-01-the-hand-rolled-host-axis-block-has-no-declared-key-set`, one PR.

- Row A reads `answered #4228`. The spine's refusal sentence already travels: all three
  publishers put it in `recording.timing.reason` through `DexExport.timingBlock`. The row's
  premise holds of the CORPUS, not of the code — 455 tracked exports carry no refusing axis.
- Row B reads `fixed #4228`. `recording.hostAxis` now carries a declared key set per publisher:
  21 keys for PpgDex, 16 for ECGDex, 17 for MotionDex, 13 shared by all three.
- My own #4223 leg asserted `recording.hostAxisReason === undefined`, a key no node writes.
  It passed whatever the truth was. The corrected leg reads the value a producer writes.
- Two new suite groups, `hostaxis-refusal` and `hostaxis-keyset`, each with a red control.
- Two sections plus rules 7 and 8 in `docs/EXPORT-SHAPES.md`.
- Changeset `changes/2026-11-01-hostaxis-refusal-and-keyset.md` (minor/added).

## Stopping point

`--group=hostaxis` reads 303 assertions over 16 groups at EXIT=0. The full 47-step
`npm run check` runs on the final state, detached, log at
`scratchpad/check-axisref.log` in this session's scratchpad.

## Next step

Read that gate's aggregate, never its tail. The PR stays a draft; the walker readies a green
draft and I never undraft my own.

Then, per the order: row `2026-10-17-sample-parsers-called-without-their-sidecar`, then
`SAMPLE-VALIDITY-ENVELOPE`, then `VERDICT-CONTRIBUTIONS`.

## Open questions

None for the owner.
