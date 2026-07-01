<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Capture note — Coospo RR intervals

**Device:** Coospo HW9 / H808S chest strap. **Signal:** beat-to-beat RR intervals (`rr`) — the same
signal as the Polar H10. **Adapter:** `adapters/coospo-rr.js` → wraps PulseDex's `parseRRInput`
(shared RR math; the adapter differs from `polar-rr.js` only in `detect`).

The Coospo strap streams heart rate + RR over BLE. RR comes out either through Coospo's companion app
or, more reliably, through a dedicated BLE HRV logger paired to the strap:

1. Wet the electrode pads and clip the strap on to wake it; pair it in the **Coospo** app, or in a BLE
   HRV logger (e.g. **HRV Logger** / **EliteHRV**).
2. Record the session and **export the RR / "RR intervals" CSV** (not the HR-summary file).
3. The export is a delimited file with a timestamp column + an `RR(ms)` / `RRI` / `RR_Interval`
   column. Drop it into the **Data Unifier** or **OverDex** — `coospo-rr.js` routes it to the RR path.

**Routing / `detect()`:** the adapter fires with high confidence (0.95) when the **filename or header
carries an explicit `coospo` / `hw9` / `h808` mark**, and at 0.8 when an RR column *and* a vendor mark
both appear in the header. A generically-named Coospo RR CSV with **no vendor mark** currently returns
0 → it is set aside as *unknown* (safe — never mis-routed), not run. If you have such a file, rename it
to include `coospo` (or add the mark to the header) so it routes; and please contribute the real
export so `detect` can be hardened against its actual header signature
(SIGNAL-ADAPTER-FOLLOWUPS-2026-06-24-BRIEF §5).

**Clock Contract:** Coospo firmware tends to stamp **`MM/DD/YYYY HH:MM:SS` (MDY)** — the adapter hands
text to `parseRRInput` with the shared parser's MDY resolution; stamps become floating wall-clock `tMs`
by regex (never `new Date(str)`), and a row with no usable timestamp yields `null`, never a fabricated
time. If a future Coospo firmware uses a format `parseRRInput` doesn't recognize, normalize it inside
`coospo-rr.js` (to ISO-8601 or a Clock-Contract `tMs`) before handing text down — do **not** add a
regex to a node's `parseTimestamp`.
