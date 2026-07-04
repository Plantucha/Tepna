<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-06-30 · **Created:** 2026-06-30 · **Supersedes-context:** OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-II-2026-06-29-BRIEF.md (executed — §2 cross-node periodic-breathing fusion shipped) · **Follow-up:** OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-IV-2026-06-30-BRIEF.md

> **EXECUTED 2026-06-30.** §1 SHIPPED (CPAPDex `periodicBreathingPct` + OxyDex `pbIndex` now ride each
> node's `ganglior.crossnight` envelope → the Integrator Longitudinal view trends + Pearson-couples PB
> burden with ZERO Integrator code, the generic ingester picks it up). §2/§3/§4 are DECISIONS — all
> recorded in `EVENT-LEXICON.md` §6.1/6.3/6.4/6.5 (no code beyond the §3 in-place annotation). Gates:
> `Dex-Test-Suite.html` all-green (1479 passed), `verify-provenance.html` GATE A 8/8 + GATE B clean.
> Per-section outcomes:
> - **§1 DONE** — `oxydex-cross.js` OXY_DEFS += `pbIndex` (osc episodes/hr, **experimental**); `cpapdex-cross.js`
>   CPAP_DEFS += `periodicBreathingPct` (device-scored CSL %, **measured**). Found+fixed a latent bug: both
>   def→envelope mappings dropped `cite` (builder plumbs it, mapping omitted it) → now propagated. OxyDex
>   re-bundled 990cb3ee4737→**e931eb8e5ad9**, CPAPDex 6c3e110b6fe2→**b4f063b3da7c** (both buildHash-stable,
>   external-JS-only). `cpapdex_synthetic_multinight_golden` regenerated; OxyDex×2 + CPAPDex×3 single-night
>   fixtures export-inert (re-recorded). Shared assertion id-lists updated deliberately (`tests/dex-tests.js`).
>   ECGDex cardiac-correlate burden trend **NOT** built (optional) → carried to FOLLOWUPS-IV.
> - **§2 DONE (decision)** — keep `cvhrIndex`-as-index; ECGDex does NOT emit a first-class `periodic_breathing`
>   (would stamp a cardiac signature as airflow PB — dishonest). Lexicon §6.3.
> - **§3 DONE (decision)** — `PB_CVHR_MIN` stays Integrator-local (fusion-layer corroboration knob, not a node
>   physiology threshold; kernel-sourcing would force an 8-app rebuild for an unvalidated heuristic). Annotated
>   at its def site in `integrator-dsp.js`; Integrator re-bundled 21eacd2aff9b→**215fe4dc22d0**. Lexicon §6.4.
> - **§4 DONE (decision)** — PB stays a card/table window finding (no timeline span overlay), consistent with
>   `staging_disagreement`/`hrv_consensus`. Lexicon §6.5.

# Periodic-breathing fusion — FOLLOW-UPS III

> Residue surfaced while executing `-II §2` (the cross-node periodic-breathing corroboration capability).
> The same-night corroboration rule (`fusePeriodicBreathing`), its finding card/KPI/badge, the synthetic-demo
> PB path, and the export `periodicBreathing` block all shipped + are gated (shared fusion-test group + a
> browser PB render-coverage rig; behavior 17/17 + provenance GATE A 8/8 confirmed). What `-II §2` deliberately
> deferred or exposed, none a live bug today:

---

## §1 — Longitudinal PB-BURDEN TREND (the deferred half of -II §2) · MED

`-II §2` listed three sub-items: corroboration (✅ shipped), a **finding** (✅ shipped), and a **burden trend**
(episodes/night) — the last deferred here because it is a **NODE-side, fleet-wide** change, not an Integrator one.

**Key fact (verified during -II):** `integrator-longitudinal.js` is a **generic `ganglior.crossnight` ingester** —
it already trends (sparkline) + cross-correlates (Pearson, ranked) **ANY** metric a node's crossnight envelope
carries in its `metrics{}`. So a PB-burden trend needs **no Integrator code** — it appears automatically the moment
the PB nodes emit a PB metric per night:

- **CPAPDex** — add `periodicBreathingPct` (already a night-level `metrics` field) to its `ganglior.crossnight`
  `metrics{}` series (device-scored, `goodDirection:'down'`).
- **OxyDex** — add a per-night PB index (episodes/h or the oscillation-flagged %) to its crossnight `metrics{}`
  (experimental tier per registry).
- *(optional)* **ECGDex** — a per-night CVHR/CSR burden if one is wanted as the cardiac-correlate trend.

**Do:** for each PB node, emit the PB metric in `<node>-cross.js` `crossNightBlock` (the `CrossNightEnvelope.build`
path the fleet already uses), with the metric self-describing `{label,unit,goodDirection,evidence,cite}`. Then
re-bundle that node + regenerate its crossnight fixtures (the full per-node ritual). **Verify** the trend +
coupling appear in the Integrator Longitudinal view (e.g. "rising PB burden tracks falling rMSSD"). This is a
fleet-wide node pass — scope it deliberately (one node at a time honors the re-bundle + `Dex-Test-Suite` /
`verify-provenance` gates); do NOT fold into an unrelated change.

## §2 — ECGDex: a first-class `periodic_breathing` emit vs. the `cvhrIndex` correlate · LOW (decision)

Today ECGDex participates in PB corroboration via **`summary.cvhrIndex` ≥ `PB_CVHR_MIN`** (a derived index
threshold), NOT a `periodic_breathing` event — because ECGDex emits `autonomic_surge` (CVHR), and CVHR is the
autonomic *correlate* of the breathing cycle, not a direct airflow/SpO₂ PB read. This is honest (the channel is
labelled "cardiac CVHR (autonomic correlate)" + tiered `emerging`), but it means PB corroboration reads an
**index off a summary**, not an **event off the bus** — slightly different plumbing from the OxyDex/CPAPDex
`periodic_breathing` observers.

**Decide:** whether ECGDex should emit a first-class **`periodic_breathing`** impulse when its CVHR train is
CSR-like (cyclic, ~the right period), so all three observers speak the same event vocabulary and
`fusePeriodicBreathing` reads events uniformly. **Trade-off:** cleaner lexicon + uniform plumbing vs. the honesty
risk of stamping "periodic breathing" on a purely-cardiac signature (CVHR also accompanies plain OSA, not only
PB/CSR). If taken, it is an ECGDex DSP change (a CSR-pattern gate on the CVHR train) + re-bundle + event-fixture
regen; record the canonical-name decision in `EVENT-LEXICON.md`. If not, **record that CVHR-as-index stays the
ECGDex PB channel** and close.

## §3 — `PB_CVHR_MIN` is a local heuristic, not a kernel constant · LOW

The ECGDex CVHR floor for counting as a PB observer (`PB_CVHR_MIN = 5` events/h, in `integrator-dsp.js`) is an
unvalidated rule-of-thumb living as a module-local `var`. The genuinely cross-fleet physiology thresholds live in
`DexKernel.K` (kernel-constants single source). **Decide:** either source `PB_CVHR_MIN` from `DexKernel.K` (if it
is a shared physiology threshold — would bump `KERNEL_HASH` + force the 8-app fleet rebuild, so only if warranted)
or annotate it "intentionally Integrator-local — a fusion-layer corroboration knob, not a node physiology
threshold" (the `DEX-EVENT-UNIFY C2` precedent for OxyDex's SpO₂-only params). Lowest priority; cosmetic until the
threshold is validated against the corpus.

## §4 — PB finding has no timeline band (window vs. point) · LOW (UX)

`confirmed_apnea_event` draws a vertical band on the Integrator timeline; `periodic_breathing` does **not** — it is
a *window* finding (a night-level corroboration), surfaced as a finding card + KPI + a findings-table row, with its
`tMs` at the window start. That is intentionally consistent with the other window findings
(`staging_disagreement`, `hrv_consensus` — also card/table only). **Decide:** whether a PB **span** overlay
(start→end shaded region across lanes) is worth adding to the timeline, OR leave PB as a card/table finding like
its window-finding siblings (likely fine). Pure UX; no correctness impact.

---

## Done when
- [x] §1 PB-burden longitudinal trend: PB metric emitted in each PB node's crossnight `metrics{}` (node re-bundle +
      fixture regen per node) and the trend/coupling verified in the Integrator Longitudinal view — OR explicitly
      deferred with the node list recorded. **DONE** — CPAPDex `periodicBreathingPct` + OxyDex `pbIndex` shipped;
      ECGDex cardiac-correlate burden trend explicitly deferred to FOLLOWUPS-IV (the only node not done).
- [x] §2 ECGDex direct-`periodic_breathing`-emit decision recorded (emit + migrate, or keep CVHR-as-index channel).
      **DONE** — keep CVHR-as-index (lexicon §6.3).
- [x] §3 `PB_CVHR_MIN` placement decision recorded (kernel-sourced, or annotated Integrator-local). **DONE** —
      annotated Integrator-local (lexicon §6.4 + def-site annotation).
- [x] §4 PB-timeline-span decision recorded (added, or left a card/table window finding like its siblings).
      **DONE** — left card/table window finding (lexicon §6.5).
- [x] Every code-touching item honors the re-bundle + `Dex-Test-Suite` / `verify-provenance` gates. **DONE** —
      Dex-Test-Suite all-green (1479 passed); verify-provenance GATE A 8/8 + GATE B clean.
