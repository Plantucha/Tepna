<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-11-12 · **Created:** 2026-10-28

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

- [x] Name the commit that closed the `multiSeg` gate on these nights, by the same two-ended fold.
- [x] State whether the Verity rail should take the per-segment path at all, with the segment count
      read from an export rather than from `hostAxis.maxStepMs`.
- [x] Decide the correction-versus-regression question the row posed, against the exported
      segmentation.
- [x] Close or supersede this brief in the same diff as the PR that discharges it.

## 4 · Where to start

`node tools/doc-search.mjs --read "verity ppg moves in a ring seam refold"` finds this brief, the row,
and `2026-10-25-the-refold-moves-four-stepless-verity-nights`. The last of those falsified the
simplest reading from published axis fields, and said it could not name the code path. This brief
names it.

## 5 · Answered 2026-11-12 — nothing closed the gate, and the scrub hid it

**The title above is wrong, and this section states why.** The per-segment path fires today on every
Verity rail that publishes an axis. No commit closed it. `#4070` published
`recording.offsetSegments`, `export-schema.js` never declared that key, and `dexScrubExport` drops
every undeclared key. `tools/trio-batch.mjs` scrubs each export it writes, so the field the fold
looked for could never reach a folded file.

The drop is not silent. The scrub names each removed key in `schema.scrubDropped`, which landed
2026-11-09, five weeks after this fold ran. So `offsetSegments` appears in 0 of 173
committed PPG exports, and `scrubDropped` appears in 0 of 173 as well. Those artifacts predate both
the reader and the marker, so that count describes the corpus and not the code.

### 5.1 · The measurement

Two folds ran at `2caee6fcd` over `/srv/data/tepna-corpus/smoketest-captures`, which offers 120
nights. The first folded 2026-08-24 alone. The second folded the eight nights the row names, and 7
of 8 landed all three node-exports; 2026-08-29 landed 2 of 3.

| night | Verity `segments` | Verity `maxStepMs` | Verity `spreadMs` | ring `segments` |
|---|---|---|---|---|
| 2026-08-17 | 9 | 27648.4 | 54461.1 | 11 |
| 2026-08-18 | null | null | null | null |
| 2026-08-21 | null | null | null | 1 |
| 2026-08-24 | 3 | 90.9 | 19079.9 | 3 |
| 2026-08-26 | 2 | 111.6 | 11794.5 | 5 |
| 2026-08-29 | 3 | 120.3 | 18261.1 | 5 |
| 2026-08-30 | null | null | null | 4 |
| 2026-09-03 | 3 | 148.9 | 13145.4 | 3 |

15 of the 16 exports name `recording.offsetSegments` in `scrubDropped`. The one that does not is
2026-08-21's ring rail, which reads `segments: 1`. A single segment takes the whole-file path by
construction, so it publishes no array and drops nothing. That export is the control, and it shows
the marker tracks the gate.

### 5.2 · The acceptance items

- [x] **Nothing closed the `multiSeg` gate.** It is open on 5 of 5 Verity rails that publish a
      segment count, at 9, 3, 2, 3 and 3 segments. The three remaining Verity rails publish
      `hostAxis.ok: true` with every measurement null, so they state no count.
- [x] **The count already reaches an export, as `hostAxis.segments`.** It survives the scrub because
      `hostAxis` is declared. It reads null on 3 of the 8 nights, where the axis published no span.
- [x] **The movement is a correction.** Every moved Verity night carries `spreadMs` from 11794 ms to
      54461 ms against the 10000 ms bound, so the raw anchor series holds over-bound divergence.
      `maxStepMs` reads 90.9 ms to 148.9 ms on the same nights, because it quotes the smoothed step.
      So the four nights that read stepless in row
      `2026-10-25-the-refold-moves-four-stepless-verity-nights` were never stepless in the series the
      cut reads. The regression reading rested on a flat offset per segment, which discards the host
      rate. `ppgdex-dsp.js` now builds one axis per segment and forbids interpolation across a seam
      only, so that objection no longer describes the code.
- [x] **This brief closes here.** Two findings ride a separate ledger PR: the undeclared
      `offsetSegments` key, and the `hostAxis` block that reads `ok: true` beside eight null
      measurements.
