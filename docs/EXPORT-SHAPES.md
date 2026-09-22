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

## The `measurement` block — per-instance lineage (additive, MINOR; OxyDex emits it since 2026-09-21, ECGDex since 2026-09-22)

Specified by `MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26` §1 and validated by **`measurement-block.js`**
(`validateMeasurement(block, opts) → {ok, errors[], checked[]}`), which is the schema authority the way
`signal-frame.js` is for the canonical intermediate.

**It is a NEW BLOCK INSIDE `ganglior.node-export`, not a sibling artifact.** The gap it closes, in one
line: Tepna can prove that a BUNDLE produced an EXPORT from an INPUT, byte for byte, years later — and
cannot answer the same question about one number *inside* that export. Provenance is airtight at
ARTIFACT granularity (`manifestHash`, `computeHash`, GATE A/B) and absent at INSTANCE granularity.

**OxyDex is the first emitter (roadmap §3, 2026-09-21).** Every OxyDex night element carries
`measurement: { meanSpo2, t90, odi4, hypoxicBurden }` — one block per headline metric, keyed by registry
id (each block still carries its own `metricId`) — and its `schema.version` is **2.1**. The values are
the element's own numbers (`stats.meanSpo2` / `stats.t90pct` / `odi4.rate` / `hypoxicBurden.rate`);
the block adds lineage and recomputes nothing. `code` is read off the bundle's own `<html
data-manifest-hash data-compute-hash>` stamp (build-time, outside every inline block); a headless
source-module run has none and emits `code: null` + `codeReason`. `evidence.inputHash` is the
recording's `contentId`; `evidence.envelopeRef` is the attached acquisition envelope's `session_id` or
`null` + reason on a CSV. Desat events carry `inputHash` + `evidenceRef` (§2). Walk-through + tool:
`docs/MEASUREMENT-WALKTHROUGH-OXYDEX-2026-09-21.md`, `tools/measurement-walk.mjs`. **ECGDex is the second
emitter (roadmap §12, 2026-09-22):** the export carries a recording-level `measurement: { hr, rmssd, sdnn }`
— the WHOLE-RECORD numbers (`hrv.time.wholeRecordHR/RMSSD/SDNN`, the Integrator's consensus axis), not the
epoch-median display values; `basis: derived` on all three (a statistic over a detected, Malik-corrected beat
train — LEXICON §4b); `sourceChannel: H10:ecg`; `window.spreadMs` is the host axis's measured spread on a box
night (the H10 has a second clock, so this emitter can publish what OxyDex cannot) and null-with-reason on a
phone export; `evidence.envelopeRef` is null with the reason that no acquisition envelope joins the ECG path
yet. Present on BOTH the light and the rich export; `schema.version` 2.1. Emission is still staged per node —
the other six do not emit it yet, and a missing block on THEIR exports is not a defect. **The Integrator consumes it (roadmap §8, 2026-09-21; the generic `adaptEnvelopeNode` too since
2026-09-22, so an ECGDex export's recording-level map is consumed the same way):** `adaptOxyDex` turns each block into a
REF on the rec (`measurements.blocks.<id>` = metricId · value · basis · window · code · evidence join ·
`provenance: resolved | unresolved` + reason) and the fusion export's `nodes[].measurements` carries
those refs forward — never the payload. Absence adds no key (a legacy export fuses byte-identically);
a block whose refs do not resolve (inputHash ≠ the element's contentId, missing code identity, value ≠
the element scalar, non-positive window) is marked `unresolved` loudly and never silently accepted.

**Back-compat:** additive, so **consumers tolerating its absence is the contract**, gated the same way
the `t`-only event tolerance already is. The `schema.version` MINOR bump lands with the FIRST EMITTER,
not with the shape: a version announcing a block no node writes is a claim the artifact does not
honour.

Field rules a reviewer should know without reading the module:

- **`metricId` resolves; it never carries `unit`/`label`/`evidence` inline.** Those are the registry's
  (the metric contract's single source), and the validator REJECTS them inline. An id the registry does
  not resolve is the fabricated-identity failure one layer below `no-fabricated-tier`.
- **`basis` is NOT the evidence ladder.** `measured | derived | estimated` is per-INSTANCE derivation
  kind; the ladder is per-METRIC epistemics. They share the word `measured` and nothing else, which is
  exactly why the validator rejects the ladder's other four values *by name*.
- **`code: {manifestHash, computeHash}` — a hash IS the version.** §📦 forbids a hand-typed version
  string, so the validator accepts only a 12-hex content hash.
- **∅ at every optional field.** `window.spreadMs`, `uncertainty` and `evidence.envelopeRef` are
  `null` **with a reason beside them**, never `0` and never silently absent — "unknown" is a valid
  state, and a `spreadMs: 0` asserts the two clocks agreed exactly, which is a claim nobody made.
- **`window.clockDomain` is named** (`device | host | host-corrected`), never implied.

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
