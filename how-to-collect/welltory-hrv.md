<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Capture note — Welltory HRV summary

**App:** **Welltory** (or any HRV app that exports the same per-measurement summary CSV).
**Signal:** `hrv` — a **summary**, NOT a raw signal. Each row is an already-computed HRV measurement (a
spot read: rMSSD, SDNN, Mean RR, MxDMn, AMo50, Mode, plus Welltory's subjective scores), so the frame
is an **irregularly-sampled** stream (per-sample `tsMs`, no `fs`) — the cgm-style shape.
**Adapter:** `adapters/welltory-summary.js` → wraps `HRVDex.parseRows` (the same parser `HRVDex.html`
uses) and emits a `SignalFrame(hrv)` through `HRVDex.compute()`.

1. In **Welltory**, take your morning (and any spot) HRV measurements over the period you want.
2. Open **data export** and export the **HRV summary CSV** (the per-measurement table, not a PDF).
3. The header is `Date, Time, Stress(HRV), Energy(HRV), …, Mean RR, SDNN, rMSSD, MxDMn, pNN50, AMo50,
   Mode, …`. Drop it into the **Data Unifier** or **OverDex** — `welltory-summary.js` routes it to the
   HRV-summary path.

**Routing / `detect()`:** **0.95** when the filename carries a `welltory` mark **or** the header has the
Welltory-specific subjective columns (`Stress(HRV)` / `ANS balance`); **0.85** for a generic HRV-summary
header shape (`rMSSD` **and** `SDNN` **and** one of `Mean RR`/`MxDMn`/`AMo50`/`pNN50`); **0.6** for a
`*_hrv` / `hrv-summary` filename; **0** (set aside) otherwise. A leading `[`/`{` (a JSON node-export) is
hard-rejected to 0 so a `*_ganglior.json` is never mistaken for a summary CSV.

**Clock Contract:** Welltory exports a **zone-less ISO** stamp `YYYY-MM-DDTHH:MM:SS` → parsed by
components verbatim into floating `tMs`, `offsetMin = null` (Clock Contract resolution #3). For
non-ISO vendor variants the shared parser's **DMY default** applies (auto-disambiguated by a
day-component > 12). Measurement times are irregular; the frame carries per-sample `tsMs` (monotonic
non-decreasing, gaps allowed).

**Two ingest-boundary correctness caveats** the adapter handles for you:
- **Baevsky ms-vs-s unit guard.** `Mode` / `MxDMn` arrive in **seconds** in this Welltory export
  (e.g. `Mode 0.975`, `MxDMn 0.25`) but in **milliseconds** from some HRV apps — a ms value silently
  mis-scales the Stress Index by up to 10⁶×. `DexUnits.guardBaevsky` auto-detects the ms band,
  normalizes to seconds, recomputes a unit-safe SI per row, and **flags** (never silently scales) any
  value outside the plausible RR range. (`HRVDex.html`'s own `computeDerived` now runs the SAME guard.)
- **Black-box composites.** Welltory's subjective scores (`Stress(HRV)`/`Energy`/`Coherence`/`Focus`/
  `SNS`/`PSNS`) are vendor BLACK-BOX composites → the frame is stamped `provenance.derived:true` and the
  emitted `stress_high` event is tagged `meta.derived` at the **heuristic** tier; `rMSSD`/`SDNN`/`Mean RR`
  stay measured. (Note: `meta.derived` is audit-only today — the Integrator does not yet down-weight it.)
