<!-- SPDX-License-Identifier: Apache-2.0 -->
# Magpie · unit `intattr` — the Integrator figure publishes its attribution

**Unit:** `intattr` · **Branch:** `claude/intattr-mg` · **Worktree:** `wt-intattr-mg` (beside the primary
checkout) · **PR:** DRAFT #4369 · **Board:** note #3410 (thread 8), decision #3411 (thread 7)

**Doc-search that found the prior work:**
`node tools/doc-search.mjs --read "integrator apnea index attribution contributions leave-one-out over nodes"`
→ board 3390, `briefs/VERDICT-CONTRIBUTIONS-2026-10-04-BRIEF.md`:88-103, `briefs/INTEGRATOR-BUILD-BRIEF.md`.

## Where this stopped

DRAFT #4369 is open and green over its committed head: TC=0, LINT=0 at main's 104 warnings,
`✓ check — all 49 steps passed`, EXIT=0, 0 steps NOT RUN, `secret-scan` PASS with 0 findings. The walker
undrafts it; I never undraft my own. A second commit adds the handoff and one residue row, so the gate
re-runs over that state before the branch is final.

## What it does

`confirmedApneaIndex` (`integrator-dsp.js fuseApneaEvents`) publishes a `contributions` block by
leave-one-out over the nodes it reads — the fifth and last figure of VERDICT-CONTRIBUTIONS §2. The block
rides on that function's own return, both paths, and a reduced run carries `_noAttribution`.
`tools/integrator-contributions.mjs` is the gate harness: six pre-stated checks, a seven-plant
`--selftest`, and `--contributions-sample` for the adoption gate, which now reads
`adopted 3 (read 3, block examined 3) · pending 2`.

## The finding, in one line

The block is ∅ on every bus shape the corpus has, because the index needs a desaturation observer AND a
cardiac node. Removing either leaves a population that cannot produce the figure, so the deltas are `null`
with reason `reduced-bus-unfusable`. The new four-node twin `attributed` is what exercises the numeric
half: dominant `node.ECGDex` at `0.538`, two measured zeros beside it.

## Next step for whoever picks this lane up

1. Watch #4369 to green, then `node tools/wt-done.mjs <this worktree>` and release claim #3390.
2. VERDICT-CONTRIBUTIONS §5 box 4 stays open: one recorded night where the block answered "which input"
   without a bird reading code. For this figure that night needs two desaturation observers and two
   cardiac nodes, which no corpus night has — so the box wants a different figure, or a CPAP-plus-oximeter
   night paired with both Polar devices.
3. §5 box 2 is now three of the five. The two `pending` rows are the remaining figures.

## Open questions

- Whether §2's label "Integrator fused sleep summary" should name the object instead. I kept the label and
  named `confirmedApneaIndex` in the row's own cell, because the adoption gate pairs rows on that label.
- `test:hooks` redded once on the `git worktree add` shape and does not reproduce; row
  `2026-11-04-the-hooks-gate-flakes-on-the-worktree-creating-cd-shape` holds the evidence.
