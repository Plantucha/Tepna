<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex]
brief: O2RING-PPG-GAP-2026-07-22-BRIEF.md
---
`tools/ppg-gap-bridge-scan.mjs` — §4 was deferred on a counter that cannot respond.

§4 (bridged-interval exclusion) has sat PROPOSED with this reason: *"on every real segment measured here the bridged path fired zero times (`nGapSpanIntervals: 0 → 0`) — so it is unexercised by real data"*. That names the wrong counter, and the whole deferral rests on it:

- **`nGapSpanIntervals`** (§2) counts intervals straddling a **time discontinuity in the source**. It reads 0 whenever the capture grid is contiguous.
- **`nGapBeats`** (§3) counts beats **dropped** because their foot→peak span touched a gap — and each drop is exactly what creates a §4 bridge.

A beat dropped by `gapBeats` leaves **no discontinuity in `relSec`** (every sample is still there, only the beat is gone), so `spansGap` is blind to it *by construction*. Watching `nGapSpanIntervals` to decide whether §4 fires watches the one quantity guaranteed not to move.

Measured over the 22 largest O2Ring finger captures, driving the shipped `parsePPG` + `analyze`:

| | |
|---|---|
| files scanned | 22 |
| **files where `gapBeats` dropped ≥1 beat** | **14** |
| total beats dropped | **88** (max **25** in one file) |
| files where `nGapSpanIntervals` ≠ 0 | 11 |

§4's Done-when — *"a real gappy finger night on which foot-anchored `gapBeats` still drops ≥1 beat"* — was already satisfied fourteen times over when the item was parked. The last row matters too: even §2's counter is non-zero on 11 of 22 files, so the *"0 → 0"* observation came from a narrower sample than the corpus offers.

**A committed adversarial twin makes this falsifiable without the corpus.** `--selftest` plants two `156` sentinel runs straddling a foot in a synthetic single-channel record and asserts `nGapBeats > 0` **while** `nGapSpanIntervals === 0` — the two counters separated in one run, on a machine with no medical data. Placement is load-bearing: a first draft planted the runs mid-rise, clear of the foot, and `nGapBeats` came back 0 — a twin that would have *confirmed* the very deferral it exists to disprove. `gapBeats` fires only within `GAP_FOOT_SPAN` (±3 samples, ~24 ms) of the **foot**.

**§4 is deliberately NOT landed.** It touches HRV, and this brief's own standard (§5) is per-epoch RMSSD/SDNN agreement against paired chest ECG — the evidence that settled §3. This supplies the segments that standard needs and the tool to find them; it does not ship the change. Landing §4 needs the WIP implementation rebased, run over the 14 firing files, and HRV shown unmoved-or-improved vs ECG on each. The blocker was wrong; the validation is not optional.

Also checked off §4's sibling Done-when item: the release-time `verifiedUnder` re-stamp of the PpgDex corpus fixture landed in PR #670 — `PpgDex_2026-06-27_equiv.node-export.json` carries `verifiedUnder: 2acf0985e625`, stamped by `tools/verify-fixtures.mjs` after a green real-corpus run.

Tool + brief only — no shipped source touched, so no `manifestHash` moves and no fixture is re-recorded.
