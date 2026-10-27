<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-10-27 · **Created:** 2026-10-20

# The JS consumers of a capture filename stamp

Part (b) of residue `2026-09-22-filename-stamp-still-wrong-for-other-consumers`. The census row
`2026-10-12-filename-stamp-consumers-split-twelve-convert-four-identify` enumerated 17 files that
carry a 14-digit filename-stamp regex and split them 12 / 4 / 1. Ten of the twelve converters are JS,
and this brief reads each of the ten for ONE question: does it use the NAME where the first data row
is authoritative?

## 1 · The two measurements this brief rests on

- **The name is wrong by hours, not seconds.** Part (a) measured 39 files on 14 nights whose filename
  stamp and first sample disagree by over 5 min, 8 of them by 13 to 19 h. #373 re-measured the whole
  tree: the first data row of 8077 of 8077 files carries a parseable host stamp, 101 files disagree by
  over 5 min, and the worst sits 18.7 h out.
- **The ECG population that one pre-filter screens is tighter.** Measured 2026-10-20 over the corpus
  the two experiment tools walk: 641 ECG files pass their own path test, 591 of those carry a name
  stamp, and the worst name-to-content error among them is 2.41 h with a median of 36.7 s. Two files
  exceed 5 min and none reaches 12 h.

⚠️ **A walk that does not follow symlinks sees 2504 of 33388 files.** The corpus root is mostly
symlinks, and the tools' own walker follows them. The first run of the measurement above read 17 ECG
files and looked complete.

## 2 · The ten JS converters, by what the name decides

| file | what the stamp decides | reading |
|---|---|---|
| `tools/ppg-foot-consensus-e1.mjs` | whether an ECG may pair with a PPG at all | **defect, fixed here** |
| `tools/ppg-fusion-e3.mjs` | the same pre-filter, duplicated | **defect, fixed here** |
| `dex-ingest.js` | `stampMs` builds an instant from unvalidated components | **defect, owed** |
| `sensor-trio-night.js` | the NIGHT KEY a file is grouped under | **defect, fixed** |
| `sensor-trio-power-analysis.js` | the same night key | **defect, owed** |
| `sigma-no-reference-analysis.js` | the same night key | **defect, owed** |
| `oxydex-dsp.js` | anchor source (2), through `DexClock.fileStamp` | clean |
| `tools/acc-shared-movement.mjs` | nothing — bounds come from the rows | clean |
| `tools/pat-matchrate-strict.mjs` | nothing — it refuses a file whose rows carry no stamp | clean |
| `tools/trio-batch.mjs` | a cache key for redo decisions | clean |

`dex-ingest.js pickNearestByStamp` reads as measured-CORRECT and stays: its 24 h bound sits outside
the 18.7 h worst name error, which is what part (a) demands of a bound.

## 3 · What landed here

Both experiment tools rejected a pairing when the ECG name stamp sat 12 h or more from the PPG start,
and their comment promised the filter "can only save work, never silently drop a pairing". That promise
holds for an UNPARSEABLE stamp and fails for a WRONG one, which is the whole of part (b). The bound is
now the 24 h `dex-ingest.js` already applies to the same question, with the derivation beside it, and
`ppg-fusion-e3.mjs --selftest` pins that the bound exceeds the measured name error.

The widening costs no work today, because no ECG file in the measured population comes within 12 h of
the bound. It removes the case the promise could not cover.

## 4 · The remainder, and why each piece is its own unit

- [x] **`dex-ingest.js stampMs` range-validates its components.** Landed as #3812: `_stampMk`
  round-trips the date, admits the one ISO `24:00:00` overflow and bounds the time fields, and the
  four carrying bundles re-bundled. `Date.UTC` over unchecked slices
  rolls `20261332999999` onto a wrong instant, which §2.7 forbids and which `fileStamp` already
  solved for the tools. The instant feeds `pickNearestByStamp`, so a rolled stamp can drop a true
  sidecar or pick a wrong one. 🔴 **The remedy is node-local, never `DexClock`**: `dex-ingest.js`
  reaches four bundles, and `PpgDex.html` carries no `clock.js`, so an alias there is a
  `ReferenceError` at module evaluation (§✅). Shared-module work: four `manifestHash` values move,
  and it owes the corpus lap. 0 of 454 Polar-named files in the corpus violate the ranges today, so
  this is a tripwire rather than a recovered loss.
- [x] **`sensor-trio-night.js` keys the night on the first data row.** `tools/trio-anchor.mjs` made
  the same repair for the box-side fold under residue
  `2026-09-22-capture-filename-stamp-disagrees-with-content`; this is the browser consumer left
  behind. Measured over the 9853 files the tool's own classifier accepts: 9738 carry a parseable
  first-row stamp and 115 do not, median error 3.9 s, 74 files over 5 min, worst 18.71 h, and **8
  files cross the noon fold**. Nights 121 by name and 121 by row, eligible 87 both ways with none
  gained or lost, and **10 of the 121 nights change at least one chosen file** — 2026-06-19, 07-27,
  08-05, 08-08, 08-20, 08-21, 08-24, 08-27, 08-28, 09-30. Four of the ten move no bucket at all: they
  change because the nearest-to-anchor comparison now runs on the row stamp.

  The page carries no
  `clock.js` and `verify:analysis` requires it to stay self-contained, so the parser is node-local,
  and it agrees with `DexClock.parseTimestamp` on all 9738 files that carry a row stamp, returns null
  on exactly the same 115, and reproduces the 8 flips.

  🔴 **A published figure moves, and is NAMED here rather than quietly corrected.**
  `papers/sensor-trio-nights.html` §3.4 reports a 26-night corpus from 2026-06-10 to 07-05 processed
  through this tool's folder-ingest arm, and 2026-06-19 sits in that window: one of the paper's 26
  nights changes its chosen verityHR file. Re-running that section is its own unit, because it decides
  what a reader who quoted the old figure should be told.

  **Re-run 2026-10-26: the figures do not move, and the keying is now recorded rather than assumed.**
  The page's own ingest, run over the capture folder held here under both keyings, returns 58 nights
  and 31 eligible either way, with no night present under one keying alone. One file changes night in
  the whole corpus, the 2026-06-19 Verity `_HR.txt`. `sensor-trio-worker.js:1085` reads that file only
  as `if (!V && f.verityHR)`, and the night resolves its Verity corner from raw PPG, so the file that
  moved is never read. 🔴 **A CHANGED INPUT IS NOT A CHANGED FIGURE UNTIL YOU READ ITS CONSUMER** — the
  brief named a moved published figure, and the moved file sits on a fallback leg that night declines.
  The §3.4 caption now carries the keying as a third unrecorded-provenance axis beside the window
  length and the DSP generation it already confessed, because a later reader cannot re-derive that
  nothing moved. ⚠️ The ingest arm does not solve, so the re-run cannot check the published 26-of-31
  solve rate. It does report both counts over this folder as two different populations: 31 eligible
  over the whole span, 26 nights inside the stated window. The file set behind the published pair is
  not recorded, which is the same gap the caption already states.
- [x] **`sensor-trio-power-analysis.js` and `sigma-no-reference-analysis.js`, the same repair.**
  Landed as #3791. Each
  publishes figures, so each owes its own before-and-after night counts in its PR. Neither carries
  `clock.js` either; the reader above is the shape to mirror, not to import.
- [x] **`pat-feasibility.js`, a FOURTH page the census never read.** The row enumerates ten JS
  converters and this is not one of them, yet `tools/build-analysis.mjs TOOLS` builds and serves
  `PAT Feasibility.html`, so the defect was live. The page keyed its night on the filename stamp and
  picked every companion by name-stamp proximity, and its own comment cites
  `sensor-trio-power-analysis.js` as the rule it copies — the rule #3791 repaired under this residue
  while the copy stayed. Measured over the 9591 files its own classifier accepts: 8075 carry a
  parseable first-row stamp and 1516 do not, median error 4.5 s, 99 files over 5 min, worst 18.71 h,
  and **13 files cross the noon fold**. Nights 141 by name and 141 by row with none gained or lost,
  and **eligible 126 by name against 127 by row** — one night whose ECG and PPG the name had split
  across two buckets now holds both. This page copies the reader verbatim rather than importing it,
  for the reason the two items above give.

  🔴 **AN ENUMERATION IN A ROW AGES LIKE ANY OTHER FROZEN CELL.** Re-running the census row's own
  derivation at `20a175458` returns 15 files against its 17: four left as their fixes landed and two
  entered. Nothing in the tree re-derives it, which is why a served page sat outside the set for two
  weeks. Logged as `2026-10-26-a-residue-census-enumeration-has-no-instrument-and-has-drifted-by-two`.

## 5 · Acceptance

- [x] every one of the ten converters read, with its verdict in §2
- [x] the pre-filter bound exceeds the measured name error, pinned by a selftest leg
- [x] `dex-ingest.js` refuses an out-of-range filename stamp, with the four bundles re-bundled — #3812
- [x] each night-grouping script keys on content, with the night-count delta measured — 4 of 4
- [x] **this brief discharges part (b) of residue
  `2026-09-22-filename-stamp-still-wrong-for-other-consumers`, and the row stays OPEN on part (a).** 🔴 **THIS ITEM CONFLATED THE TWO HALVES OF ITS OWN PARENT ROW.**
  It read "closes only when §4 is empty", and §4 is now empty. That row has two halves, and only part (b)
  — the consumer enumeration — is what this brief addresses. Part (a) is the capture-host writing a
  SESSION-start stamp: 39 files on 14 nights, worst 18.7 h. Part (a) needs a writer change, a night and a
  deploy, so an empty §4 cannot close the row. The row that closes here is the census row §6 answers.
## 6 · What closes, and what the instrument cannot see

Residue `2026-10-12-filename-stamp-consumers-split-twelve-convert-four-identify` closes as
`fixed #4011`. That row names twelve files as time converters, and this section answers each one
against the shipped census `tools/stamp-consumer-census.json` at `2ac325510`.

| the row's twelve | in the census | reads | anchored | how it is answered |
|---|---|---|---|---|
| `capture-host/parse_dat.py` | yes | time | **true** | asks `writers.file_start_stamp` — #4011 |
| `tools/trio-batch.mjs` | yes | identifier · time | **true** | delegates to `DexClock.fileStamp` — #4011 |
| `dex-ingest.js` | yes | identifier · time | true | node-local validated reader — #3812 |
| `sensor-trio-night.js` | yes | identifier · time | true | keys on the first data row — #3812's family |
| `sensor-trio-power-analysis.js` | yes | identifier · time | true | the same repair — #3791 |
| `sigma-no-reference-analysis.js` | yes | identifier · time | true | the same repair — #3791 |
| `capture-host/loss_audit.py` | yes | docstring | null | delegates in code — #3920 |
| `oxydex-dsp.js` | yes | docstring | null | already an owner call, §2 read it clean |
| `tools/acc-shared-movement.mjs` | **absent** | — | — | stopped reading a stamp at all |
| `tools/pat-matchrate-strict.mjs` | **absent** | — | — | hands the whole basename to the owner |
| `tools/ppg-foot-consensus-e1.mjs` | **absent** | — | — | the same, at two sites — #4006 |
| `tools/ppg-fusion-e3.mjs` | **absent** | — | — | the same, at two sites — #4006 |

The three node-local readers are correct rather than a shortfall. None of those pages carries
`clock.js`, and `verify:analysis` requires each to stay self-contained, so an alias there is a
`ReferenceError` at module evaluation.

🔴 **THE CENSUS POPULATION ERASES THE REPAIR IT CERTIFIES, AND FOUR ANCHORED READERS SIT OUTSIDE IT.**
The instrument enumerates every tracked source whose text spells a run of adjacent quantified digit
atoms summing to 14. A reader repaired by handing the whole basename to the owner carries no such run,
so it leaves the population on the commit that fixes it.

Four files convert a filename stamp to an instant today and are absent from the census, at six call
sites between them: `signal-orchestrate.js`, `tools/pat-matchrate-strict.mjs`,
`tools/ppg-foot-consensus-e1.mjs` and `tools/ppg-fusion-e3.mjs`. Three of the four sit in the table
above. `signal-orchestrate.js` sits OUTSIDE the row's twelve, because the row derived its own
enumeration from the same spelling the census inherited, so a reader counting the table's whole-basename
entries finds three and not four. None of the four was ever declared, so
the tool's own departure check never had a row to fire on. Its headline of 14 of 14 anchored counts the
files that still spell a stamp, never the files that read one.

Logged as `2026-10-27-the-stamp-census-population-erases-the-repair-it-certifies`, which names
`2026-10-27-a-spelling-keyed-census-credits-a-fix-over-a-file-that-kept-a-second-reader` as its parent.
The remedy is a second predicate over the owner call sites beside the spelling predicate, and it raises
the time-reader population from 14 to 18.
