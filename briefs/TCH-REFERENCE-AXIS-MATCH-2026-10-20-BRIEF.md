<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-10-20 · **Created:** 2026-10-20 · **Follows:** `TCH-REFERENCE-POPULATIONS-2026-10-13-BRIEF.md` · **Residue:** 2026-10-18-tch-reference-and-h10-corner-sit-on-two-axes

# Does matching the reference's clock axis remove the H10's host-minus-wall gap?

**One line.** The hat's reference check scores the H10 against a reference built from the H10's own
beats. Until now the reference rode the raw device counter while the corner rode the host-corrected
axis. This brief gives the check a second leg that matches the two, and measures what the match costs.

## 1 · What is already measured and must not be re-measured

`TCH-REFERENCE-POPULATIONS` §8 published one paired run per clock axis over the box captures. 94
eligible nights, 54 scored, 2026-07-27 → 2026-10-16. Pooled figures only, per the owner's 2026-09-24
ruling.

| corner | median paired \|Δσ\| | median Δσ (host − wall) | host larger than wall |
|---|---|---|---|
| H10 | 0.540 bpm | +0.540 | 53 of 54 nights |
| Verity | 0.506 bpm | −0.444 | 7 of 54 nights |
| O2Ring | 0.278 bpm | −0.278 | 15 of 54 nights |

§8 read the H10's direction as the §2.3 axis defect rather than drift. The two optical corners read
better with the host discipline on, which is what a rate correction should do. The H10 reads worse on
53 of 54 nights, one-sided, on the one corner that supplies the reference.

## 2 · The defect, in the source

`analyze` builds its beat clock from `rec.devMsAt` — the raw device counter, with no `correctionAt`
(`ecgdex-dsp.js:2802-2812`). The H10 corner's HR series rides `rec.tMsAt`, which adds the correction
(`ecgdex-dsp.js:5610`). Under `--axis host` the two diverge by the host discipline's own correction.
The H10's apparent error against its own beats carries that divergence.

Under `--axis wall` the divergence is zero by construction. `hostAxis` returns its refusal, so
`_ecgCorrAt` is null and `tMsAt` collapses onto the device counter. That is the negative control, and
§4 runs it rather than arguing it.

## 3 · The criterion, stated before the run

**C1 — the one thing this brief decides.** With the reference placed on the corner's own axis, the
H10's median paired |Δσ| against the wall leg is at or under 0.05 bpm. That line is §4's materiality
line in the parent brief, and `DRIFT_LINE` in `tools/tch-reference-record.mjs`. A PASS says the
published gap was the mismatch. A FAIL says the gap survives a matched axis, so the mismatch does not
account for it. Nobody moves the line after the run.

**C2 — reported beside C1, never decided.** A two-sided difference puts `hostLarger` inside
[0.25, 0.75] of the scored nights. The §8 baseline sits at 53 of 54, or 0.981. C2 is a second quantity
over the same data, and a verdict carries one criterion.

**Both axes ride the verdict and the ledger key.** A σ measured against a reference on the device
counter and one measured against a reference on the corrected axis are different measurements of the
same night. The ledger key separates them, so no row can read as same-axis.

## 4 · The legs

1. `--axis host --reference-axis corrected` — the matched leg.
2. `--axis wall --reference-axis corrected` — the wall leg, carrying the matching label.
3. `--axis wall --reference-axis device` over a subset — the negative control. Leg 3 must reproduce
   leg 2 row for row, because the wall axis makes the two reference axes the same axis.
4. `--axis host --reference-axis device` — the status quo, re-run on this code so the comparison is
   paired on identical nights.

Then `tools/tch-reference-record.mjs --host <leg 1> --wall <leg 2>`, which emits the C1 verdict.

## 5 · What changes in code

- [x] `tools/tch-firmware-reference.mjs` takes `--reference-axis device|corrected`, defaulting to
      `device`. No shipped number moves.
- [x] The corrected branch reads `rec.tMsAt(refIdx[k])`. The estimator's `nn` values do not move.
- [x] A record with no `tMsAt`, or a `refIdx` that is not aligned with `nn`, refuses the night by
      name. A silent fall back to the device axis would relabel the row.
- [x] `ledgerKey`, the ledger rows and every verdict carry the reference axis. A legacy row reads as
      `device`.
- [x] `pairedDrift` refuses a mixed pair. The CLI refuses it before it builds anything.
- [x] `tch-reference-record:axis-match` decides C1 and reports C2.

## 6 · Acceptance

- [x] Both tools' selftests cover the five outcomes, with a negative control and a decoy.
- [x] The four legs run over the box captures, and §7 records the result with its n and its span.
- [x] The negative control reproduces leg 2 row for row.
- [x] §7 states C1 as it fell.

## 7 · Result

**C1 PASSED. The published H10 gap was the axis mismatch.**

The gate `tch-reference-record:axis-match` reads PASS over 56 paired nights, 2026-07-27 to 2026-10-18.
The H10 median paired absolute delta sigma is **0.019 bpm** against the pre-stated 0.05 bpm line.

All four legs ran over the box captures. Legs 1 and 2 scored 56 nights of the 93 they read, and legs 3
and 4 scored 57 of 97. The table pairs every figure on the 56 nights that all four legs scored.

| corner | reference on the device axis | reference on the corrected axis |
|---|---|---|
| H10 | 0.531 bpm · median +0.531 · 55 of 56 one-sided | **0.019 bpm · median −0.004 · 20 of 56** |
| Verity | 0.494 bpm · median −0.444 · 7 of 56 | 0.164 bpm · median −0.097 · 15 of 56 |
| O2Ring | 0.310 bpm · median −0.310 · 15 of 56 | 0.303 bpm · median −0.303 · 13 of 56 |

Three readings carry the argument.

1. The H10 gap falls by a factor of 27 and loses its direction. C2's two-sided band holds at 0.357.
2. The O2Ring barely moves, from 0.310 to 0.303. Its corner never rode `rec.tMsAt`, so a matched axis
   owes it nothing. That corner is the control the table carries inside itself.
3. Verity falls by a factor of three. Its corner reads the corrected axis for its own HR map.

**The negative control holds exactly.** On the wall axis the two reference axes are one axis, and
`trueSd` agrees on all 56 nights for all three corners.

The status-quo pair cannot pass its own test, by design. `axisMatchVerdict` returns NOT_APPLICABLE when
the host leg carries the device reference, because that run is the mismatch. Its figure comes from
`pairedDrift`, never from a verdict status.

### 7a · The corpus moved between the two pairs

A daily job re-syncs the box captures root around 09:37 local and preserves each mtime. It ran in the
60 seconds between leg 2 finishing and leg 3 starting. Four nights gained content, so the second pair
read 97 night directories where the first pair read 93.

**The directory mtime is blind to that arrival.** One night directory reads mtime 06:28 and ctime 09:41,
and the H10 `_ECG.txt` that appeared inside it reads mtime 04:43 with ctime 09:41. A preserving copy
keeps mtime and moves ctime alone.

Each pair stays internally paired, because both legs of a pair start within seconds of each other. So
every figure above runs over the 56-night intersection of all four legs. The finding has its own OPEN
residue row.

## 8 · Out of scope

- Any change to the hat estimator itself. The owner settled D7 on 2026-10-12 (option A).
- Flipping the shipped default to the corrected axis. That is an owner decision, and this brief
  measures the cost rather than taking it.
- Publishing per-night values. Pooled figures, the night count and the date range only.
