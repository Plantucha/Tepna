<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# `codegen/` — Dex manifest → scaffold toolchain

A small, dependency-free Node toolchain that turns **one manifest JSON per node** into
scaffold artifacts. It is **build-time tooling**, not part of any shipped bundle — nothing here
is referenced by a `*.src.html` and nothing here runs in the browser. Use it to bootstrap a new
`-Dex` node (today: **CPAPDex**), then hand-finish the output against the real architecture and
the Clock Contract.

> ⚠️ **These generators produce a STARTING POINT, not a finished node.** Read
> `../CPAPDEX-CODEGEN-HANDOFF.md` before using any output — it lists exactly what the generated
> code does NOT yet satisfy (Clock Contract, the `*-dsp.js`/`*-render.js`/`*-app.js` split,
> EDF reading, cohesion wiring, provenance, the gates).

---

## Files

| File | Role |
|---|---|
| `dex-registry-gen.js` | manifest → **`<node>-registry.js`** (SIGNAL-ADAPTER brief Phase 3, manifest-as-single-source). Projects the evidence-grade registry + resolver (`idForLabel`/`badgeForLabel`/`depthForLabel`) faithfully to the live contract (`../ecgdex-registry.js`). Reads the Phase-3 manifest additions `evidence` (5-level ladder, validated + retired-vocab-rejected) + `goodDirection` per metric. **Forward-first: for NEW nodes only** — do NOT regenerate the 7 hand-written registries. Validated sample: `generated/eegdex-registry.js` from `manifests/eegdex.manifest.json` (10 metrics, all 5 grades, round-trip 10/10). |
| `dex-gen.js` | manifest → **reference-guide HTML** (metrics, formulas, normal-value tables, quick-jump). Emits markup using the *Tepna Design System v1.2.0* classes — you must paste/inline that CSS into the `<style>` block. **Cohesion-wired (Phase 3):** links `dex-badges.css` and projects each metric's `evidence` into an `ev-corner` badge + an evidence legend strip, so a generated guide passes the shared `cohesion-badges` gate against the generated registry by construction. Sibling of the committed `OxyDex Reference.html`. Sample: `generated/eegdex-reference.html` from `manifests/eegdex.manifest.json` (10 cards, 10 badges, all 5 tiers). |
| `dex-analysis-gen.js` | manifest → **`<node>-analysis.js`** compute module: one pure function per metric, generated from each metric's `compute` spec, plus a `prepare(raw)` data-prep step and a stats kernel (`_p`, `_mean`, `_sd`, `_cov`, `_iqr`, `_olsSlope`, …). |
| `dex-test-gen.js` | manifest → **`<node>-tests.js`** synthetic-data harness: a per-modality `generateSyntheticData()` + one assertion per metric (expected value ± tolerance) derived from the synthetic ground truth. |
| `manifests/*.manifest.json` | one manifest per node (see below). `cpapdex.manifest.json` is the **canonical** target; the rest are reference examples of the schema. |
| `manifests/cpapdex.docs-draft.json` | an earlier, docs-only CPAPDex manifest (more metrics, **no `compute`**). Superseded by `cpapdex.manifest.json` for codegen; keep only as a source of extra metric copy to port. |

## Usage

```bash
# reference guide (paste design-system CSS into the <style> block afterwards)
node dex-gen.js          manifests/cpapdex.manifest.json --output CPAPDex-Reference.html

# compute module + test harness
node dex-analysis-gen.js manifests/cpapdex.manifest.json --output cpapdex-analysis.js
node dex-test-gen.js     manifests/cpapdex.manifest.json --output cpapdex-tests.js
node cpapdex-tests.js    # runs the synthetic assertions (last sample run: 12 pass / 1 skip)
```

## Manifest schema (the contract all three generators read)

```jsonc
{
  "node": "CPAPDex",
  "modality": "CPAP / PAP Therapy",      // dex-test-gen branches on this substring
  "icon": "🫁", "accentColor": "var(--cyan)", "accentHex": "#3DE0D0",
  "version": "1.0.0", "status": "alpha",
  "description": "...", "warning": "...",
  "dataModel": { "fields": { "pressure": "Float32Array — cmH₂O, 1 Hz", ... } },
  "eventTypes": { "OA": "Obstructive Apnea", "CA": "Central Apnea", ... },
  "sections": [
    { "id": "pressure", "title": "Pressure Profile", "icon": "📊", "description": "...",
      "metrics": [
        { "id": "medianPressure", "abbr": "P50", "name": "Median Pressure",
          "fullName": "...", "tier": "core|secondary|research", "unit": "cmH₂O",
          "formula": "percentile50(pressure[maskOn])",   // docs (dex-gen)
          "formulaNote": "...",
          "compute": { "fn": "percentile", "source": "pressure",
                       "where": "maskOn", "args": [50] },  // code (dex-analysis-gen)
          "ranges": [ { "max": 8, "label": "Low", "class": "ok|warn|bad|critical" }, ... ] }
      ] }
  ],
  "abbreviations": { "AHI": "Apnea–Hypopnea Index", ... }
}
```

**Tiers** map to disclosure depth: `core → Core`, `secondary → Advanced`, `research → Research`.

**Supported `compute.fn`** (everything else → a `stub` returning `NaN` with a `// TODO`):
`percentile · mean · sum · sd · cov · iqr · min · max ·
count_above · count_below · pct_above · pct_below ·
count_where_div · first_where_div · event_rate · event_count · ols_slope · expr · stub`

- stats fns take `{ source, where?, args? }`; `where` selects a precomputed `<source>Filtered` mask.
- `event_rate`/`event_count` take `{ eventTypes:[...], denominator:"usageHours" }` over `d.events`.
- `expr` takes `{ expr: "<js>" }` for composites.

## Known limitations (why output needs hand-finishing)

1. **`dex-analysis-gen.js`'s `prepare(raw)` is CPAP-shaped** — it hardcodes `raw.pressure` and a
   `maskOn = pressure > 0` mask. Other modalities need their own prepare step.
2. **`dex-test-gen.js` only implements a CPAP/PAP synthetic generator**; every other modality hits
   the generic fallback (empty arrays → trivially-passing/0 tests).
3. **No Clock Contract.** Generated code assumes `timestamps` are *Unix seconds*. The suite's law
   is **floating wall-clock `tMs`** via `Date.UTC(...)`, read back with `getUTC*` (see `../CLAUDE.md`).
   The generated module is a metric-math reference, **not** a Clock-Contract-compliant parser.
4. **Wrong runtime shape.** Real nodes are `*-dsp.js` + `*-render.js` + `*-app.js` bundled from a
   `*.src.html` — not a single `<node>-analysis.js`. Treat the generated module as a quarry for the
   DSP math, and `dex-gen.js`'s HTML as a quarry for the reference-guide copy.
5. **Design-system version.** `dex-gen.js` targets the *Tepna Design System v1.2.0* layout classes
   and the cohesion model in this repo (5-level evidence ladder, corner badge placement — see
   `../SYSTEM-COHESION-BRIEF.md`). The **evidence-badge layer is now reconciled** (Phase 3): the guide
   links `dex-badges.css` and renders an `ev-corner ev-<tier>` badge per metric from the manifest's
   `evidence` field, so it conforms to the `cohesion-badges` gate against the generated registry. What
   still needs hand-finishing is the **layout CSS** — paste/inline the full design-system stylesheet
   into the `<style>` block (the `[PASTE DESIGN SYSTEM CSS HERE]` placeholder) before shipping a guide.
   A pre-Phase-3 manifest with no `evidence` fields generates no corner badges and will not pass
   `cohesion-badges` until the field is added (the generator warns).
