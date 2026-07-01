<!--
  how-to-collect/muse-eeg.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# How to collect — Muse EEG (overnight)

**Device:** InteraXon **Muse S** (the sleep band; Muse 2 also works for shorter sessions).
**Signal:** raw **EEG** (`eeg`) ~256 Hz, 4–5 channels (TP9/AF7/AF8/TP10 + ref) → **EEGDex** (the only
node that does *real* sleep staging — Wake/N1/N2/N3/REM + band powers).
**Adapter / path:** **Mind Monitor CSV** is the EEGDex default input (`EEGDEX-BUILD-BRIEF.md`); the
host reshapes its stream to that layout. Open **`EEGDex.html`** directly, or route via the `eeg` path.

## ⚠️ Raw EEG is BLE-stream-only — and the model picks the tool
The Muse app exports *staged sleep*, not raw EEG; raw needs a live BLE capture. **Which tool depends on
your Muse firmware:**
- **Muse 2 / Muse S (gen 1–2):** `muse-lsl` (the `bleak` backend, clean on Linux) → LSL → CSV.
- **Muse S Athena (2024/25):** newer firmware changed the GATT service (`0000fe8d…`) and multiplexes the
  channels — **muse-lsl and BlueMuse fail on it.** Use **`OpenMuse`** (purpose-built for the Athena;
  records/streams via LSL; can stream multiple bands in parallel).

**Confirm your model before buying into a toolchain** — it flips muse-lsl ↔ OpenMuse.

## Capture
`tepna-capture` runs the right tool as a child process, captures LSL → CSV, and reshapes to the Mind
Monitor column layout EEGDex expects. **Battery:** streaming *raw* EEG drains faster than the app's
sleep mode — confirm the band survives ~8 h (Muse S is the one to use overnight).

## File layout & naming
Mind Monitor CSV; name device-id + 14-digit stamp:
`Muse_S_<DeviceId>_YYYYMMDDHHMMSS_eeg.csv`.

## Clock Contract
Mind Monitor stamps look like `2026-05-12 23:55:00.400` (no zone) → parser branch 3 (`Date.UTC` of
components verbatim, `offsetMin=null`) → floating `tMs`; some exports carry `±HH:MM` → branch 2 (zone
authoritative). Parsed by **explicit regex**, never `new Date(str)`; a stamp-less row → `null`.

## Evidence grade (do not inflate)
Single-channel automated staging is `emerging` (literature-backed, **not PSG-validated**); band powers
`measured`; ratios `emerging`; spindle/SWA `experimental`. The capture path changes none of this.

## Where it goes
Drop the CSV into the **Data Unifier** / **OverDex** → routes to the `eeg` path → EEGDex computes a
`ganglior.node-export` (a real hypnogram + stage events onto the Ganglior bus). EEGDex's staging is what
the other nodes' "stages are HR/SpO₂ heuristics, not EEG" apologies point at — it anchors sleep
architecture for the whole fused night.
