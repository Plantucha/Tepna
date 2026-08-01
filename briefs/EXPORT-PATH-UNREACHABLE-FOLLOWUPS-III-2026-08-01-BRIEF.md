<!--
  EXPORT-PATH-UNREACHABLE-FOLLOWUPS-III-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 · **Created:** 2026-08-01 · **Follows:** `EXPORT-PATH-UNREACHABLE-FOLLOWUPS-II-2026-08-01-BRIEF.md` · **Affects:** `cpapdex-edf.js`, `cpapdex-app.js`, `adapters/resmed-edf.js`, `Data Unifier.src.html`, `tests/dex-tests.js`

# CPAPDex was silently discarding 76 EDF files across 16 of 199 nights.

`FOLLOWUPS-II` opened the CPAP path through OverDex and recorded, unresolved, that the two ingest
routes disagreed on one night: the app scored **28 events from 21:08:19**, OverDex **29 from
21:02:25**. It refused to pick a side from a single night. This brief resolves it on the corpus, and
the answer is worse than a disagreement.

**There were two implementations of one rule, and the app's loses data:**

| | rule |
|---|---|
| `adapters/resmed-edf.js groupSessionSets` | ±60 s of the set's anchor, **AND a repeated TYPE opens a NEW set** (CPAP-REAL-CORPUS §F4) |
| `cpapdex-app.js groupEdfFiles` | a **>15 MINUTE** gap opens a new cluster, then `c.files[e.type] = e` — *"last-wins on duplicate type within a cluster"* |

That comment describes a silent overwrite. When a second therapy session starts less than 15 minutes
after the first — mask off, bathroom, mask back on — ResMed writes a second complete
`BRP`/`PLD`/`SA2`/`EVE`/`CSL` set. The app's rule drops the whole first set on the floor: its scored
apneas simply vanish, with no error, no warning, and a lower AHI.

## 1 · Measured over the real SD card

199 night folders, 1008 EDF files, both rules replayed over the filenames (the disagreement is
entirely in the grouping, so no decoding is needed):

| | |
|---|---|
| nights where the app rule silently discards ≥1 file | **16 / 199 — 8.0 %** |
| files silently discarded | **76** |
| nights where the two rules disagree on session count | **16 / 199** |

Worst night **2026-04-23**: the app sees **2** sessions where the rule sees **6**, dropping **14
files**. The affected nights are 01-17, 03-04, 03-22, 04-04, 04-05, 04-10, 04-13, 04-16, 04-21, 04-23,
04-26, 05-08, 05-11, 06-03, 07-16, 07-26.

The §F4 header already warned about exactly this failure — *"a naive ±60 s cluster OVERWRITES the
first … **8 sessions in the ~180-night reference corpus hit exactly this**"* — and the app's window is
**fifteen times wider**, so it fires on twice as many nights.

## 2 · Resolved by deleting the duplicate, not by choosing

The rule now lives ONCE, on **`CpapEdf.groupSessionSets`** (`cpapdex-edf.js`) — the shared EDF reader
that *both* grouping surfaces already load. `adapters/resmed-edf.js` delegates to it and keeps its own
name so `SignalAdapters.byId('resmed-edf').groupSessionSets` and its existing gate still work;
`cpapdex-app.js` calls it and its `SESSION_GAP_MS` constant is deleted.

**Effect on the 2026-07-26 night, through the app's own UI:**

| | before | after |
|---|---|---|
| `sessionCount` | 1 | **2** |
| `startEpochMs` | `1785100099000` (21:08:19) | **`1785099745000` (21:02:25)** |
| ganglior events | 28 | **29** (apnea 21 → **22**) |
| `therapyHours` | 7.27 | **7.33** |

The app and OverDex now agree exactly, because they are running the same function.

> **Committed fixtures did not move, and that was PROVEN, not assumed.** The synthetic goldens
> regenerate byte-identical (`regen: 0 fixture(s) moved`). The two real-recording fixtures
> (`cpapdex-2026-06-12`, `cpapdex-2026-06-16`) skip for absent inputs, so the regen tool could not
> speak for them — and a skip is exactly where a stale fixture hides (`FIXTURE-VERIFICATION-GATE`).
> Both nights were therefore grouped under **both** rules directly from the SD card: **identical set
> count AND identical file membership** (06-12: 8 files → 2 sets; 06-16: 4 files → 1 set). Neither is
> among the 16 affected nights, so their outputs cannot have moved.

## 3 · The Data Unifier's missing co-load — the owed item from `FOLLOWUPS-II` §4

`Data Unifier.src.html` carried the identical gap OverDex had: it registers `resmed-edf` through
`signal-adapters.js` but never booted the node behind it. Added `cpapdex-edf.js` + `cpapdex-dsp.js` +
`cpapdex-fusion.js` to its `__DEX_NAMESPACED__` block. Fixed together on purpose — patching one
sibling orchestrator and not the other is how they drifted in the first place.

## 4 · Gate

The existing `ResMed EDF session grouping` group gains three legs: that the adapter **delegates** to
the single source, and that the real 2026-07-26 shape (two full sets 5 m 48 s apart) stays **two
sets** with **no file dropped** — the exact case the 15-minute rule merged.

**Negative-controlled.** Removing the load-bearing `!byType[type]` clause reds the group (`got 1 ·
want 2`); restored, green. A gate never seen to fail is not evidence.

## 5 · Done when

- [x] One grouping rule, single-sourced, called by the app **and** the adapter.
- [x] The corpus measured before choosing — 76 files / 16 of 199 nights — rather than picking from one night.
- [x] App and OverDex produce the same session set, event count and therapy hours on the real night.
- [x] Fixture immobility **proven** for the two nights the regen tool had to skip.
- [x] `Data Unifier` co-load closed (`FOLLOWUPS-II` §4).
- [x] Gate extended + negative-controlled · 4782/4782 zero skips on the real corpus · browser suite
      green · all three drift guards current.
- [ ] *(owed, out of scope)* The 15 other affected nights' committed analyses — none are fixtures, but
      any downstream figure computed from a CPAP night in the list above predates this fix.
