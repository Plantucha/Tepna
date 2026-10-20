<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-10-20 · **Created:** 2026-10-20

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
| `sensor-trio-night.js` | the NIGHT KEY a file is grouped under | **defect, owed** |
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

- [ ] **`dex-ingest.js stampMs` range-validates its components.** `Date.UTC` over unchecked slices
  rolls `20261332999999` onto a wrong instant, which §2.7 forbids and which `fileStamp` already
  solved for the tools. The instant feeds `pickNearestByStamp`, so a rolled stamp can drop a true
  sidecar or pick a wrong one. 🔴 **The remedy is node-local, never `DexClock`**: `dex-ingest.js`
  reaches four bundles, and `PpgDex.html` carries no `clock.js`, so an alias there is a
  `ReferenceError` at module evaluation (§✅). Shared-module work: four `manifestHash` values move,
  and it owes the corpus lap. 0 of 454 Polar-named files in the corpus violate the ranges today, so
  this is a tripwire rather than a recovered loss.
- [ ] **The three night-grouping scripts read the first data row for the night key.** A name 18.7 h
  out puts a file on the wrong night, and these three publish figures, so the fix moves numbers a
  reader may have quoted. One unit each, with the before and after night counts in the PR.

## 5 · Acceptance

- [x] every one of the ten converters read, with its verdict in §2
- [x] the pre-filter bound exceeds the measured name error, pinned by a selftest leg
- [ ] `dex-ingest.js` refuses an out-of-range filename stamp, with the four bundles re-bundled
- [ ] each night-grouping script keys on content, with the night-count delta measured
- [ ] residue `2026-09-22-filename-stamp-still-wrong-for-other-consumers` closes only when §4 is empty
