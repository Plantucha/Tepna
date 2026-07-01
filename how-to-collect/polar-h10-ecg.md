<!--
  how-to-collect/polar-h10-ecg.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# How to collect — Polar H10 raw ECG (overnight)

**Device:** Polar **H10** chest strap.
**Signal:** single-channel raw **ECG** (`ecg`) at ~130 Hz → ECGDex (R-peaks → HRV, CVHR apnea band,
HR-based staging). The richest cardiac source in the suite.
**Adapter / path:** the `ecg` path → ECGDex's `compute()` on the canonical single-channel ecg frame;
or open **`ECGDex.html`** directly and drop the `*_ECG.txt`.

## ⚠️ The H10 must be LIVE-streamed for raw ECG
The H10's onboard recording keeps only **HR + RR** for a session — **not** the raw 130 Hz waveform.
Raw ECG exists **only** on the live BLE stream (Polar **PMD** service). So overnight raw ECG needs a
host holding the link all night — a phone running Polar Sensor Logger (PSL), or the **health box**
(`CAPTURE-HOST-2026-06-29-BRIEF.md`).

## Capture
**A — Phone (manual):** Polar Sensor Logger → enable **ECG** → record overnight → export the
`*_ECG.txt`. Keep the phone close and on the charger (a sleeping phone drops the link).

**B — Health box (auto):** the `tepna-capture` daemon subscribes to PMD ECG (type 0x00), arrival-stamps
each frame, and writes the **same PSL layout** so nothing downstream changes:
```
Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]
```

## File layout & naming
The file is the PSL `*_ECG.txt` shape (`;`-separated, header above). Name it device-id + 14-digit
stamp so `dex-ingest.js`/`signal-orchestrate` pair companions and the date anchor reads from the name:
`Polar_H10_<DeviceId>_YYYYMMDDHHMMSS_ECG.txt` — e.g. `Polar_H10_AAAAAAAA_20260625_215300_ECG.txt`.

## Clock Contract
Write the **`Phone timestamp` as a zone-free local-civil ISO** (`2026-06-25T21:53:00.123`) → parser
branch 3 → floating `tMs`. The Polar `sensor timestamp [ns]` (ns since 2000-01-01) is kept for
reference only. Never write raw epoch as the primary stamp; never fabricate a stamp for a dropped
packet — **leave the gap** (a missing stamp surfaces as `null`, never `now()`). The `timestamp [ms]`
column may flip to scientific notation late in long files — `parseFloat` handles it.

## Known gotcha (live capture will reproduce it)
A strap that begins recording **mid electrode-settling** prepends a large transient that used to poison
Pan-Tompkins seeding → "Too few R-peaks". Fixed in `ecgdex-dsp.js` (`_seedScale` global-percentile
seed). If you analyze a freshly-donned strap, this is the case that fix covers — see
`ECG-RPEAK-SEED-FIX-2026-06-27-BRIEF.md`.

## Where it goes
Drop the `*_ECG.txt` into the **Data Unifier** / **OverDex** → routes to the `ecg` path → ECGDex
computes a `ganglior.node-export` (CVHR / HRV events onto the Ganglior bus), fusing with SpO₂ / PPG /
CGM. Or open **`ECGDex.html`** for the full single-night dashboard. Pair the H10 `_ACC`/`_HR`/`_RR`
sidecars (same device-id + stamp) for device-RR cross-checks + posture.
