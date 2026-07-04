<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-06-30 · **Created:** 2026-06-30 · **Supersedes-context:** OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-III-2026-06-30-BRIEF.md (executed — §1 longitudinal PB-burden trend shipped; §2/§3/§4 decisions recorded) · **Follow-up:** OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-V-2026-06-30-BRIEF.md

> **EXECUTED 2026-06-30.** Both sections are DECISIONS — **no code, no re-bundle, no fixture change**, so neither
> gate is triggered (the "Done when" gate clause is vacuous — there are no code-touching items). Decisions
> recorded in `EVENT-LEXICON.md` §6.7 (§1) + §6.8 (§2).
> - **§1 DONE (decision)** — ECGDex cardiac-correlate PB-burden trend **intentionally NOT built as a dedicated
>   metric**. KEY FACT found on inspection: ECGDex's crossnight `metrics{}` ALREADY carries **`cvhrIndex`**
>   (CVHR index, `/h`, `goodDirection:'down'`, **emerging** — Hayano cyclical-variation-of-HR, the oximetry/ECG
>   apnea surrogate; emitted for overnight non-ambulatory recordings, nulled under ambulatory). Since
>   `integrator-longitudinal.js` is a GENERIC `ganglior.crossnight` ingester that trends + Pearson-couples ANY
>   crossnight metric, the cardiac-correlate burden (CVHR events/h) ALREADY trends + couples in the Integrator
>   Longitudinal view alongside `periodicBreathingPct`/`pbIndex`. A dedicated `cvhrBurden`=CVHR/h would DUPLICATE
>   `cvhrIndex`; the only non-duplicate option (a CSR-pattern fraction) needs the CSR-pattern gate that `-III §2`
>   (lexicon §6.3) deliberately DECLINED on honesty grounds. So the cardiac correlate is present at BOTH layers
>   (same-night §6.1 + longitudinal §6.2) — just not under a redundant PB-specific name. Lexicon §6.7.
> - **§2 DONE (decision)** — `cite`-in-mapping propagation **DEFERRED** (no standalone 3-app rebuild). SHARPENED
>   FINDING correcting the brief's premise: of the three nodes, only **PpgDex** actually drops `cite` — its
>   `crossNightBlock` builds the metric array via `Object.keys(PPG_DEFS).map(...)`, omitting `cite` AND `evidence`.
>   **ECGDex + PulseDex** pass their `METRICS` array LITERAL straight into `CrossNightEnvelope.build`, and
>   `_shapeMetric` already does `cite:m.cite||null` → they are ALREADY cite-safe (a future cited entry flows
>   through; nothing to add). A 3-app pass would re-bundle 2 apps for ZERO source delta. Inert today + the
>   CLAUDE.md BADGE_CSS precedent ("leave bundles as-is for inert shared-module additions; re-bundle only when
>   runtime behavior changes") → fold the PpgDex one-liner (`evidence:d.evidence` + `cite:d.cite`) into PpgDex's
>   next rebuild. Lexicon §6.8. Residue → FOLLOWUPS-V.

# Periodic-breathing fusion — FOLLOW-UPS IV

> Residue surfaced while executing `-III §1` (the longitudinal PB-burden trend: CPAPDex `periodicBreathingPct`
> + OxyDex `pbIndex` now ride each node's `ganglior.crossnight` envelope, picked up automatically by the generic
> `integrator-longitudinal.js`). `-III` shipped + is gated (Dex-Test-Suite 1479 passed; verify-provenance GATE A
> 8/8 + GATE B clean). None of the below is a live bug today.

---

## §1 — ECGDex cardiac-correlate PB-burden crossnight trend · LOW (the one node `-III §1` left undone)

`-III §1` listed ECGDex as **optional** ("a per-night CVHR/CSR burden if one is wanted as the cardiac-correlate
trend") and it was **not** built — only CPAPDex + OxyDex emit a PB metric in their crossnight `metrics{}` today.
So the Integrator Longitudinal view trends + couples PB burden from the **airflow/SpO₂** nodes but not the
**cardiac** correlate.

**Decide + (if yes) do:** whether to add a per-night **CVHR/CSR burden** metric (e.g. `cvhrBurden` = CVHR
events/h, or a CSR-pattern fraction) to `ecgdex-cross.js`'s `crossNightBlock` `metrics{}`, graded per
`ecgdex-registry.js` (CVHR is **emerging** — the autonomic correlate, NOT a direct PB read, consistent with the
`-III §2` decision to keep CVHR-as-index). If taken, it is the standard per-node ritual: emit the self-describing
metric `{label,unit,goodDirection,evidence,cite}` via the `CrossNightEnvelope.build` path, re-bundle ECGDex,
regenerate its crossnight fixtures, update `tests/dex-tests.js` (the `Cross §1` group's ECGDex id-list +
`BUILD-MANIFEST.json` + `FIXTURE-PROVENANCE.json`), and honor both gates. **Verify** the cardiac PB-burden series
trends + couples in the Integrator Longitudinal view alongside the airflow/SpO₂ ones. If not wanted, **record that
the cardiac correlate is intentionally absent from the longitudinal PB trend** (CVHR-as-index already corroborates
PB at the same-night fusion layer) and close.

## §2 — `cite` was dropped in EVERY node's def→envelope mapping · LOW (latent; fixed for 2 nodes in `-III`)

**Found while executing `-III §1`:** `crossnight-envelope.js` `_shapeMetric` already plumbs `cite:m.cite||null`,
but each node's `<node>-cross.js` `crossNightBlock` builds the `metrics:[{id,label,unit,goodDirection,evidence,get}]`
def array and **omitted `cite`** — so any cited metric surfaced `cite:null`. `-III §1` added `cite:d.cite` to the
**OxyDex + CPAPDex** mappings (the two nodes that gained a cited metric). The **other three** crossnight emitters —
`ppgdex-cross.js`, `ecgdex-cross.js`, `pulsedex-cross.js` — still drop `cite` in their mappings. It is **inert
today** (none of their existing defs carry a `cite` field, so all their crossnight metrics already `cite:null`
legitimately), but it is an inconsistency: the moment any of those nodes adds a cited metric, its cite will silently
vanish from the envelope.

**Decide + (if yes) do:** add `cite:d.cite` to the `Object.keys(<DEFS>).map(...)` mapping in the remaining three
`<node>-cross.js` files for fleet consistency (so the envelope is uniformly self-describing). ⚠️ This is a code
change to three bundled modules → re-bundle PpgDex + ECGDex + PulseDex + update `BUILD-MANIFEST.json` (the
fixtures are export-inert for it — none of those nodes' defs have a cite, so no crossnight metric value changes,
but `manifestHash` moves on the JS edit) + both gates. Because it is purely additive + currently inert, it can be
folded into the next time each of those nodes is re-bundled for another reason rather than driving a standalone
3-app rebuild — **OR** done as one deliberate consistency pass. Lowest priority; cosmetic until one of those nodes
cites a crossnight metric. (If ECGDex `-III §1`/`-IV §1` adds a cited `cvhrBurden`, fold the ECGDex half of this in
there.)

---

## Done when
- [x] §1 ECGDex cardiac PB-burden crossnight trend decision recorded. **DONE** — intentionally left absent as a
      DEDICATED metric: `cvhrIndex` (CVHR /h, emerging) already IS the trended + coupled cardiac-correlate burden
      in the Integrator Longitudinal view, so a `cvhrBurden` duplicate adds nothing, and a CSR-pattern fraction
      reopens the §6.3 honesty decision. No ECGDex code/re-bundle. Lexicon §6.7.
- [x] §2 `cite`-in-mapping decision recorded for the remaining 3 crossnight emitters. **DONE** — DEFERRED (no
      standalone 3-app rebuild). Sharpened: only PpgDex actually drops `cite` (its `.map()`); ECGDex + PulseDex
      pass METRICS literals directly → already cite-safe (nothing to add). Fold PpgDex's `evidence`+`cite` map
      one-liner into its next rebuild. Lexicon §6.8; residue → FOLLOWUPS-V.
- [x] Every code-touching item honors the re-bundle + `Dex-Test-Suite` / `verify-provenance` gates. **DONE
      (vacuous)** — both sections are decision-only; no `*-cross.js`/app/dsp change, no re-bundle, no fixture
      change → neither gate is triggered this pass.
