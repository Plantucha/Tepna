<!--
  how-to-collect/cpap-edf.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# How to collect — ResMed CPAP (AirSense 11) EDF

**Device:** ResMed **AirSense 11** (AirSense 10 similar).
**Signal:** per-night therapy **EDF** — ~25 Hz BRP flow waveform, pressure, leak + **device-scored
EVE/CSL events** → **CPAPDex**.
**Adapter / path:** **binary EDF drag-drop** into **`CPAPDex.html`** (or the OverDex CPAP ingest). EDF
is binary, so it does **not** traverse the live-host text/BLE path — there is no `cpap` BLE stream
(`CPAPDEX-PHASE9-FOLLOWUPS §2`). CPAP joins the box as **files**, not a captured stream.

## ⚠️ Use the SD card — NOT ResMed Wi-Fi / myAir
The AirSense's cellular/Wi-Fi modem uploads **compliance summaries only** to myAir / AirView — usage
hours, AHI, leak summary, a daily score — **not** the flow waveform or the full EDF. The data CPAPDex
needs lives **only on the SD card**.

## Capture
**A — SD card (canonical):** power off, pull the microSD, copy the `DATALOG/` folder's per-night
`*.edf` files (+ `STR.edf` summary) with a card reader. This is exactly what OSCAR reads.

**B — Wi-Fi done right (auto, for the health box):** put an **ezShare** (or FlashAir-style) **Wi-Fi
microSD adapter** in the CPAP. The `tepna` box then **auto-pulls `DATALOG/` over Wi-Fi each morning**
into `captures/<night>/` — full-fidelity data, no daily card swap. This is the only "wireless" route
that yields the real waveform (the machine's own Wi-Fi does not).

## File layout & naming
Copy the native ResMed `DATALOG/YYYYMMDD/*.edf` set as-is (CPAPDex reads the EDF structure). If you
flatten into a night folder, keep the date in the name so the anchor is unambiguous:
`ResMed_AirSense11_<SerialOrId>_YYYYMMDD_*.edf`.

## Clock Contract
EDF carries its own start date/time in the header — parsed by **explicit regex** into floating `tMs`,
never `new Date(str)`. ResMed is MDY-free (header is explicit `YYYY`-first datetime); read back via
`getUTC*` so the night is viewer-timezone-independent.

## Where it goes
Drop the night's `*.edf` into **`CPAPDex.html`** → it builds a `ganglior.node-export` (flow/pressure
metrics + device-scored EVE/CSL events). Fused with OxyDex/ECGDex, the CPAP events corroborate
desaturation + autonomic-surge findings across nodes.
