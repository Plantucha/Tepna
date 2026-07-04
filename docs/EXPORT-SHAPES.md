<!--
  EXPORT-SHAPES.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living) · **Created:** 2026-07-04 · last-verified 2026-07-04 · **Origin:** `briefs/SELF-INGEST-FOLLOWUPS-II-2026-07-04-BRIEF.md` F3

# Export shapes per node — the light-vs-rich contract

> **Why this exists.** Every node emits a `schema.name:"ganglior.node-export"` JSON, but **not the same
> shape**. Most nodes emit a **LIGHT** stream (`exportGanglior` → `<node>BuildNodeExport`: recording +
> `ganglior_events[]`, the byte-identical **Integrator fusion** currency) and — for some — a **RICH**
> artifact (`exportSummary` → `buildV2` / an enriched builder: the full derived layer, the **clinical**
> reload target). Confusing the two caused three mis-classifications in the 6-node self-ingest roll-out
> (GlucoDex + HRVDex were assumed rich but shipped light → real enrichment; ECGDex + PpgDex were assumed
> to need enrichment but already had a rich `buildV2` → export-inert). **New nodes (EEGDex/SpiroDex) must
> decide their export shape up front** and fill in a row here — don't ship light then retrofit.

## The two builders

- **LIGHT — `<node>BuildNodeExport`** (in `<node>-dsp.js`, DOM-free, headless `compute()` + the app's
  `exportGanglior` both call it → byte-identical). Carries `recording` (source/contentId/startEpochMs/…)
  + `ganglior_events[]` (+ node aggregates). This is what the **Integrator** consumes; keep it stable.
- **RICH — `buildV2` / `exportSummary`** (in `<node>-app.js`, DOM-adjacent) OR an **enriched** light
  builder. Carries the full clinical derived layer (hrv / quality / glucose / measurements / epochs / …).
  This is the "full AI-readable JSON" a user brings to a doctor, and what `<node>LoadOwnExport` renders.

## Per-node table (verified 2026-07-04)

| Node | Signal | LIGHT `exportGanglior` (`…BuildNodeExport`) | RICH clinical export | Multi-carrier key | `loadOwnExport` reads |
|---|---|---|---|---|---|
| **OxyDex** | SpO₂ | per-night element (`oxyBuildNightElement`) — already rich (`date`, `stats`, `summary`) | same — the `nights[]` export IS the rich artifact | **`nights[]`** | `nights[]` (rich per-night) |
| **CPAPDex** | CPAP EDF | `cpapBuildExport` per night — rich (`metrics`, `oximetry[]`, `quality`) | same — `nights[]` export is rich | **`nights[]`** | `nights[]` (rich per-night) |
| **PulseDex** | RR HRV | `pdBuildNodeExport` — **single-record + already rich** (`recording` + `hrv.{time,frequency,poincare}` + `summary`) | same builder (no separate `buildV2`) | **`recordings[]`** | single obj or `recordings[]` |
| **GlucoDex** | CGM | `glucoBuildNodeExport` — was **LIGHT** → **ENRICHED 2026-07-04** with a `glucose{}` block (mean/GMI/CV/TIR/MODD/ADRR/dawn/daypart) | the enriched ganglior export (+ a separate `exportSummary` AI-readable JSON) | single-record | single obj (`glucose` block) |
| **ECGDex** | ECG | `ecgBuildNodeExport` — **LIGHT** (recording + events; `opts.rich` adds hrv/quality/timeseries, **orchestrate-only**) | **`buildV2`/`exportSummary`** — RICH (recording + `quality` + full `hrv` + `epochs` + `timeseries`) | **`recordings[]`** | rich `buildV2` **or** light — reads whatever's present |
| **HRVDex** | HRV summaries | `hrvBuildNodeExport` — was **LIGHT** (`recording.measurements:N` + events) → **ENRICHED 2026-07-04** with a per-measurement `measurements[]` table | the enriched ganglior export | (ledger; single obj) | single obj (`measurements[]`) |
| **PpgDex** | Wrist PPG | `ppgBuildNodeExport` — **LIGHT** (recording + events; `opts.rich` orchestrate-only) | **`buildV2`/`exportSummary`** — RICH (recording + `hrv{time,frequency,nonlinear}` + `personalization` + `apnea`) | **`sessions[]`** | rich `buildV2` **or** light — reads whatever's present |
| **EEGDex** *(planned)* | EEG | — decide at build time — | — decide at build time — | — | — |

## Rules that fall out of this (for a new node / a reviewer)

1. **Decide the clinical export shape up front.** If the node's value is a derived table (HRV rows, glycemic
   summary), the LIGHT stream is NOT a useful clinical reload — either make the light builder rich (GlucoDex/
   HRVDex pattern, **fixture-moving**) or add a `buildV2` rich `exportSummary` (ECGDex/PpgDex pattern).
2. **`loadOwnExport` reads, never recomputes.** It surfaces whatever derived layer the dropped export carries
   (rich or light), provenance/kernel/events **verbatim**, and never calls `GangliorProvenance.stamp()`.
3. **Multi-carrier key is node-specific** — `nights[]` (OxyDex/CPAPDex), `recordings[]` (PulseDex/ECGDex),
   `sessions[]` (PpgDex). Any code that walks per-element blocks (e.g. `dexScrubExport`) must cover **all
   three** — see `SELF-INGEST-FOLLOWUPS-II` F1 (the scrub only walked `nights[]`).
4. **Keep the LIGHT stream byte-identical for the Integrator** unless you deliberately enrich it (then it's
   fixture-moving: regenerate the node's `env.equiv` fixture + re-record).

> Cross-refs: `docs/CROSSNIGHT-ENVELOPE-SPEC.md` (the `crossNight` aggregate header), `CLAUDE.md` §🔒 Clock
> Contract §6 (the export currency), `ARCHITECTURE-PRINCIPLES.md` §8 (adding a new Dex — this table is the
> "what does it export" checklist item).
