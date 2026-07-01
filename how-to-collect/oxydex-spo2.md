<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Capture note — O2Ring overnight SpO₂

**Device:** Wellue / Viatom **O2Ring**, **O2Ring S**, or **Checkme O2** wrist/ring pulse-oximeter.
**Signal:** continuous 1 Hz overnight pulse-oximetry — SpO₂ + pulse rate + a motion flag (`spo2`).
**Adapter:** `adapters/oxydex-spo2.js` → wraps OxyDex's PURE `parseCSV` (the same parser `OxyDex.html`
uses) and emits a `SignalFrame(spo2)`; the SpO₂ sibling of `polar-rr.js`.

The ring records to onboard memory overnight and syncs over BLE to Wellue's companion app:

1. Wear the ring/band overnight; in the morning open the **ViHealth** (or **O2 Insight Pro**) app and
   let it sync the session.
2. Open the recording and **export / share the CSV** (not the PDF report). The file is 1 Hz, one row
   per second, often 20 000–30 000 rows for a full night.
3. The columns are `Time, Oxygen Level, Pulse Rate, Motion` with a `HH:MM:SS DD/MM/YYYY` timestamp.
   Drop the CSV into the **Data Unifier** or **OverDex** — `oxydex-spo2.js` routes it to the SpO₂ path
   and runs it through `OxyDex.compute()`. (O2Ring's native `.dat`/`.bin` export is also accepted —
   same downstream path.)

**Routing / `detect()`:** the adapter fires at **0.95** when the filename carries an explicit
`o2ring` / `oxydex` / `wellue` / `viatom` / `checkme` mark; at **0.8** when the header shows an
oximetry column **and** a pulse column **and** a time/date column (the O2Ring CSV shape); and at a
weaker **0.5** for an oximetry-ish header (ox + time, no pulse). A file matching none returns 0 → it is
set aside as *unknown* (safe — never mis-routed). If a generically-named O2Ring file does not route,
rename it to include `o2ring`.

**Clock Contract:** the O2Ring stamp is `HH:MM:SS DD/MM/YYYY` — parsed by **explicit regex** (never
`new Date(str)`). DMY vs MDY is auto-disambiguated per Clock Contract §3: a row whose day-component is
> 12 locks the order for the whole file; absent that, the shared parser's default (`preferDMY = true` →
**DMY** for O2Ring) applies. Stamps become floating wall-clock `tMs`; a row with no usable timestamp
yields `null`, never a fabricated time. SpO₂ samples are nominally 1 Hz but the stream may drop/repeat
samples, so the frame carries per-sample `tsMs` (irregular cadence allowed — monotonic non-decreasing,
gaps OK; see `signal-frame.js`), not a guaranteed fixed `fs`.
