<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED — 2026-10-28 · **Created:** 2026-10-28

# The ring-seam re-fold moved ten Verity nights, and today it would move none

Residue row `2026-10-03-verity-ppg-moves-in-a-ring-seam-refold` set out two opposite readings of one
movement. A re-fold meant to correct the O2Ring's replay seam also moved ten nights of Verity
`PpgDex` exports. The row could not tell a correction from a regression, and it named `ppgdex-dsp.js`
as the mechanism to look at first. The unit carrying this brief measured that mechanism and repaired
one defect it exposed. This brief holds what the measurement did not settle.

## 1 · What is measured (2026-10-28)

**The fold pins the mover byte-exactly, and infers nothing.** Folding 2026-08-24 at `c3d4c15d5` reproduces the
committed pre-fold export byte for byte. Folding it at `c4d0602a3` reproduces the committed post-fold
export byte for byte. Two code states inside that window, `8dc3c178b` and `107154931`, both reproduce
the pre-fold bytes. So `dd1032aa4` is the mover, and `tools/trio-batch.mjs` changed only an argv guard
in the same window.

**That commit's compute change is one line.** It removes
`relSec[i] = (devMs + (hostAx.ok ? hostAx.correctionAt(devMs) : 0)) / 1000;` and the replacement
differs only where `multiSeg` is true. The night's bytes moved, so the per-segment offset path was
open on that night.

**The same night publishes no segmentation today.** Re-folding the eight moved nights from the same
corpus root, with today's code, publishes no `offsetSegments` on either rail. The per-segment path
therefore fires on none of them now.

**Two earlier reads already pointed here.** Board #1173 named `ppgdex-dsp.js:1229` as the path, and
noted that the cut reads the RAW anchor deltas while a folded export publishes only the SMOOTHED
step. The API lane measured the other end: every moved night's pre-fold export carries
`hostAxis.spreadMs` over the 10 000 ms bound, from 11.8 s to 54.5 s, and no unmoved night with an
axis exceeds 9.19 s. So the gate was open at fold time, and the published fields could only hint at
it.

**And nothing recorded either state.** Until this unit, `offsetSegments` had one occurrence in the
whole source tree: its write. It appeared in 0 of 173 committed PPG exports, so no artifact of the
fold-era run or of today's run can say how many segments either saw.

## 2 · The open question

Something between `dd1032aa4` and today closed the `multiSeg` gate on these nights. Three candidates
stand: the anchor series, the merged fold input, or the offset distribution itself. The corpus cannot
choose between them, because no committed artifact carries a segment count from either era.

The row's own question is still open underneath that. A per-segment flat offset discards the host
rate inside each segment. That is right for a ring that replays a buffer on reconnect. Whether it is
right for a Verity stream, whose divergence is a steady −25 ppm, is not established anywhere.

## 3 · Acceptance

- [ ] Name the commit that closed the `multiSeg` gate on these nights, by the same two-ended fold.
- [ ] State whether the Verity rail should take the per-segment path at all, with the segment count
      read from an export rather than from `hostAxis.maxStepMs`.
- [ ] Decide the correction-versus-regression question the row posed, against the exported
      segmentation.
- [ ] Close or supersede this brief in the same diff as the PR that discharges it.

## 4 · Where to start

`node tools/doc-search.mjs --read "verity ppg moves in a ring seam refold"` finds this brief, the row,
and `2026-10-25-the-refold-moves-four-stepless-verity-nights`. The last of those falsified the
simplest reading from published axis fields, and said it could not name the code path. This brief
names it.
