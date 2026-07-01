<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Capture note — Wahoo TICKR RR intervals

**Device:** Wahoo TICKR / TICKR X chest strap. **Signal:** beat-to-beat RR intervals (`rr`).
**Adapter:** `adapters/wahoo-rr.js` → wraps PulseDex's `parseRRInput` (shared RR math).

The TICKR streams heart rate + RR over BLE but has **no first-party RR file export**. Capture RR with
a logger app paired to the strap:

1. Pair the TICKR in a BLE HRV logger (e.g. **HRV Logger** or **EliteHRV**) — wake the strap by
   moistening the electrodes and clipping it on.
2. Record the session; **export the RR / "RR intervals" CSV** (not the summary).
3. The export is a delimited file with a timestamp column + an `RR-interval [ms]` / `RR(ms)` / `RRI`
   column. Drop it into the **Data Unifier** or **OverDex** — `wahoo-rr.js` detects it (filename
   contains `wahoo`/`tickr`, or the header carries an RR column) and routes it to the RR path.

**Clock Contract:** stamps are parsed by regex into floating wall-clock `tMs` (no `new Date(str)`); a
row with no usable timestamp yields `null`, never a fabricated time. If your logger writes a timestamp
format `parseRRInput` doesn't recognize, normalize it inside `wahoo-rr.js` before handing text down —
do **not** edit a node's `parseTimestamp`.
