<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Handoff — CPAPDex codegen base + what to build next

> **For the next AI coder (Claude Code preferred for the build).** This note hands you the
> **manifest-driven scaffold toolchain** that just landed in `codegen/`, explains how it relates to
> the already-authoritative `CPAPDEX-BUILD-BRIEF.md`, and gives the recommended build path. Read
> `CLAUDE.md` first (especially **THE CLOCK CONTRACT**), then `CPAPDEX-BUILD-BRIEF.md` (the full,
> locked spec), then this. **On any conflict, `CLAUDE.md` and `CPAPDEX-BUILD-BRIEF.md` win** — the
> codegen output is a starting point, never the source of truth.

---

## What just changed (context for where this came from)

- **Cohesion Rollout is COMPLETE** across the five existing nodes + Integrator longitudinal + the two
  spec docs. Evidence badges + disclosure tiers are live on OxyDex, ECGDex, PulseDex, PpgDex,
  GlucoDex, HRVDex; the Integrator badges longitudinal trend/coupling cells from each envelope's
  self-described `evidence`. PpgDex's **Full Metrics Table** now carries badges + status pills +
  color-coding (matching OxyDex). Baseline gates are green: **`Dex-Test-Suite.html` 272/24 all
  green**, **`verify-provenance.html` zero red**. Keep them there.
- A set of scratch uploads ("base for cpapdex") has been **identified, renamed to the system
  convention, and organized into `codegen/`** (toolchain) + `codegen/manifests/` (one manifest per
  node). The scratch `uploads/code (*)` files were removed after copying — all unique content is
  preserved under `codegen/`.

## What's in `codegen/` (see `codegen/README.md` for the full schema + fn list)

| Artifact | From the scratch drop | Use |
|---|---|---|
| `codegen/dex-gen.js` | reference-guide HTML generator | manifest → `*-Reference.html` (docs) |
| `codegen/dex-analysis-gen.js` | analysis-module generator | manifest → `<node>-analysis.js` (compute math) |
| `codegen/dex-test-gen.js` | synthetic-test generator | manifest → `<node>-tests.js` (per-metric asserts) |
| `codegen/manifests/cpapdex.manifest.json` | **canonical** CPAPDex manifest — `dataModel` + `eventTypes` + per-metric `compute`/`formula`/`ranges` (13 metrics across Usage, Pressure, Residual Events, Leak) | drives all 3 generators |
| `codegen/manifests/cpapdex.docs-draft.json` | earlier docs-only CPAPDex manifest (more metrics, **no `compute`**) | quarry for extra metric copy to port into the canonical manifest |
| `codegen/manifests/{oxydex,ecgdex,ppgdex,pulsedex,glucodex}.manifest.json` | per-node example manifests | schema references; not build targets |

## How the codegen base maps onto the REAL node architecture

The generators emit a single `<node>-analysis.js` + a reference HTML. The suite's real shape is
different (`CLAUDE.md`): each node is **`*-dsp.js` + `*-render.js` + `*-app.js`** referenced by a
**`*.src.html`**, bundled to a standalone **`*.html`** via the inliner. So:

- Generated **`cpapdex-analysis.js`** → mine it for the **metric math** that seeds `cpapdex-dsp.js`.
  Do **not** ship it as-is: its `prepare(raw)` is CPAP-shaped but assumes **Unix-seconds**
  timestamps — rewrite onto the **Clock Contract** (floating `tMs` via `Date.UTC(...)`, read back
  with `getUTC*`; mirror `parseTimestamp` locally — do not extract a shared util).
- Generated **`cpapdex-tests.js`** → fold its per-metric assertions into **`tests/dex-tests.js`** (the
  shared suite both `node tests/run-tests.mjs` and `Dex-Test-Suite.html` run) plus a render-coverage
  entry driving the CPAPDex bundle in an iframe. The standalone harness is a convenience, not the gate.
- Generated **reference HTML** → reconcile against the evolved cohesion model before shipping
  (5-level evidence ladder + bottom-right corner badge placement — `SYSTEM-COHESION-BRIEF.md` /
  `Visual-Language-Spec.html`), not the older *ANS Design System v1.2.0* the generator targets.

## The thing the manifest does NOT cover (build it by hand — see `CPAPDEX-BUILD-BRIEF.md`)

The manifest is metrics + ranges + compute specs. It does **not** describe the hard parts. From the
build brief, these are still net-new and are the real work:

1. **`cpapdex-edf.js`** — the EDF/EDF+ binary reader (BRP/PLD/SA2 signals + EVE/CSL annotation TALs).
   Nothing else in the suite reads EDF. Spec: `CPAPDEX-BUILD-BRIEF.md` §1.
2. **Clock mapping** — EDF startdate/starttime → floating `t0Ms`; two-sessions-per-night with an
   off-mask gap (one night, N sessions). §2.
3. **Oximeter self-gate** on the SA2 lane — mirror `OXIMETER-SELFGATE-AND-CONSEQUENCE-COROBORATION.md`
   Part A verbatim (the squeeze-artifact lesson). §4.4.
4. **Cohesion-native wiring** — clone OxyDex: a `cpapdex-registry.js` (label/unit/goodDirection/
   depth/evidence/cite per metric), the `evBadge` hook in render, `mountDepthSelector` in the
   `.src.html`, corner-badge placement. §5. (Use the just-shipped nodes as the live reference.)
5. **`cpapdex-fusion.js`** — `ganglior_events` + `ganglior.node-export`; device-scored EVE apneas are
   the top apnea tier in the Integrator; keep the fusion window `LEAD=15/TRAIL=60` identical. §6.
   New emitters SHOULD write self-describing `evidence` on each metric in the crossnight envelope so
   the Integrator can badge CPAPDex trends (the existing node cross.js files don't yet — a known,
   separately-scoped gap).

## Recommended build order

1. `cpapdex-edf.js` + a unit round-trip on a real `uploads/2026061*_*.edf` set (brief §1, §7.1).
2. Port the generated compute math into `cpapdex-dsp.js`, **on the Clock Contract** (brief §2, §3).
3. `cpapdex-registry.js` + `cpapdex-render.js` cohesion-native views (clone OxyDex; corner badges).
4. `cpapdex-fusion.js` events + export (brief §6).
5. `CPAPDex.src.html` → bundle to `CPAPDex.html` via the inliner (load order: provenance →
   metric-registry → cpapdex-registry → cpapdex-edf → cpapdex-dsp → cpapdex-render → cpapdex-app).
6. Add assertions to `tests/dex-tests.js` (EDF decode, clock round-trip, self-gate, AHI math) +
   a render-coverage entry. Add the synthetic CPAP night + failure-injection fixtures (brief §8).
7. **Gates before `done`:** `Dex-Test-Suite.html` all-green · `verify-provenance.html` no red ·
   live spot-check on the real night (two sessions stitched, AHI vs device, self-gate catches a
   squeeze). Re-bundling changes `CPAPDex.html`'s `buildHash` — re-stamp any committed CPAPDex export
   fixture, or it flips to a provenance mismatch.

## Do NOT

- Do not edit bundled `*.html` directly; edit `*.js` + `*.src.html` and re-bundle.
- Do not revert the Clock Contract to real-UTC epoch, or `new Date()`/now() a missing stamp.
- Do not add `@font-face`/CDNs/woff2 (resolved June 2026 — system-font stacks only).
- Do not extract a shared `parseTimestamp` util — mirror it locally per the Clock Contract.
- Do not touch the cohesion work on the five existing nodes; it's done and green.
