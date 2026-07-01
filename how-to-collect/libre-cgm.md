<!--
  how-to-collect/libre-cgm.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# How to collect — CGM (Abbott FreeStyle Libre / Lingo · Dexcom)

**Device:** Abbott **FreeStyle Libre** / **LibreLinkUp** / **Lingo**, or **Dexcom** (G6/G7/ONE).
**Signal:** continuous glucose (`cgm`) — one glucose reading every ~5 min, an irregularly-sampled
stream (per-sample `tsMs`, no `fs` — the cgm-style shape it shares with the Welltory HRV summary).
**Adapter:** `adapters/libre-cgm.js` → wraps GlucoDex's PURE `parseCSV` (the same parser `GlucoDex.html`
uses) and emits a `SignalFrame(cgm)`; GlucoDex's headless `compute()` then runs the real glycemic
pipeline (clean → core/variability/pattern metrics → `ganglior_events`).

## Abbott FreeStyle Libre / LibreLinkUp
1. Open the **LibreLinkUp** app (or LibreView on the web at `libreview.com`).
2. **Menu → Export Data → "Glucose Readings"** → save the CSV. (LibreView: *Account → Export*.)
3. The file has a **Date/Time** column and a **glucose** column in either **mg/dL** or **mmol/L** —
   `parseCSV` auto-detects the unit (median < 30 ⇒ mmol/L, normalised to mg/dL internally).

## Abbott Lingo
1. In the **Lingo** app, request a data export (or use the emailed CSV).
2. Lingo exports a `Time of Glucose Reading [...], Measurement(mg/dL)` CSV, **newest-first**, with a
   trailing **±HH:MM time-zone offset** on each stamp. Both are handled: GlucoDex sorts ascending by
   floating `tMs` and the Clock Contract captures the zone (`offsetMin`) while keeping display
   viewer-timezone-independent (`getUTC*`).
3. ⚠️ **Lingo clips readings to 55–200 mg/dL.** Values beyond the clip are simply ABSENT from the
   file, so time-below/above-range, LBGI/HBGI and severe-low/high UNDER-count. GlucoDex DETECTS the
   clip (`detectClampSaturation` → `vendor:'lingo'`) and flags the affected metrics honestly rather
   than silently under-reporting.

## Dexcom (Clarity)
1. **Dexcom Clarity** (`clarity.dexcom.com`) → **Export → CSV**.
2. The file has a **`Timestamp (YYYY-MM-DDThh:mm:ss)`** column and a **`Glucose Value (mg/dL)`**
   column. Dexcom CGM is **MDY**-convention; GlucoDex parses with `preferDMY:false` (the Clock-Contract
   default for CGM). A DMY-format CGM vendor would set the hint at the adapter ingest boundary only —
   never by editing the shared `parseTimestamp`.

## Clock Contract
Timestamps become floating wall-clock `tMs` (`Date.UTC(components)`), read back only via `getUTC*`. A
zoned Lingo stamp and a zone-free local stamp for the same wall instant resolve to the SAME `tMs`. A
row with no parseable timestamp is dropped (never fabricated to "now"). Need ≥10 readings to be usable.

## Where it goes
Drop the CSV into the **Data Unifier** or **OverDex** → the file routes to `libre-cgm` → GlucoDex
computes a `ganglior.node-export` (CGM events onto the Ganglior bus), fusing with your RR / SpO₂ /
HRV nodes. Or open **`GlucoDex.html`** directly for the full GlucoScope / AGP / TIR dashboard.
