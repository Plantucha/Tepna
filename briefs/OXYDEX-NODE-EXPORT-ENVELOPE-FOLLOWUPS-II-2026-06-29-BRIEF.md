<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-06-30 (§1 + §3 executed 2026-06-29; §2 + §4 + §5 executed 2026-06-30) · **Created:** 2026-06-29 · **Supersedes-context:** OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-2026-06-29-BRIEF.md (executed) · **Follow-ups:** OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-III-2026-06-30-BRIEF.md

# Event-lexicon reconciliation — FOLLOW-UPS II

> Residue the `-FOLLOWUPS §1` event-lexicon pass deliberately deferred. The parent pinned the canonical
> impulse vocabulary in **`EVENT-LEXICON.md`** and migrated the one *live-forking* emitter (the
> Integrator-side desat naming → `desat_event`), keeping back-compat aliases so nothing broke. These are
> the remaining per-node migrations + the one genuine feature — each its own deliberate pass, **never a
> blind batch-change**. None is a live bug today (aliases keep every path working); they are
> finish-the-unification + capability work.

---

> **✅ EXECUTED 2026-06-30 — §2 + §4 + §5 (Integrator-only re-bundle; no node/golden change):**
> **§2** — NEW cross-node PERIODIC-BREATHING corroboration. `integrator-dsp.js` `fusePeriodicBreathing(recs)`
> groups PB observers by night-overlap (the `fuseStagingConsensus`/`fuseHRVConsensus` pattern): OxyDex
> `periodic_breathing` = SpO₂ oscillation (experimental) · CPAPDex `periodic_breathing` + `metrics.periodicBreathingPct`
> = device flow (device-scored) · ECGDex `summary.cvhrIndex` ≥ `PB_CVHR_MIN` = cardiac CVHR correlate (emerging).
> Surfaces ONLY windows with ≥2 distinct observers; `conf` = tier-weighted noisy-OR (device 1.0 · CVHR 0.8 ·
> proxy 0.6); the fused finding is graded **experimental** (a corroboration signal, NOT a scored CSR index); a
> lone observer is NOT surfaced. `runFusion` threads a `periodic_breathing` finding + `fusion.periodicBreathing`;
> `buildFusionExport` carries the `periodicBreathing` block (schema **1.2 → 1.3**, additive/null-tolerant).
> `integrator-render.js` adds the PB finding card + KPI + `FINDING_EVIDENCE.periodic_breathing`/`TYPE_EV`
> (experimental badge, corner placement — coverage mandate). `integrator-app.js` `genSynthetic` emits PB observers
> on the last fusable night (OxyDex PB events when odi4≥5 · ECGDex `apnea.cvhrIndex` · CPAPDex
> `periodicBreathingPct` + PB events in the on-CPAP scenario) so the live demo SHOWS the finding. **Burden trend
> DEFERRED** to -III: `integrator-longitudinal.js` is a generic crossnight ingester — a PB-burden trend needs each
> node's crossnight `metrics{}` to carry a PB metric (NODE-side, fleet-wide), and flows through automatically once
> they do (no Integrator code needed). **§4** — `hrv_drop`/`hrv_low` + `stress_peak`/`stress_high` **DECIDED
> node-scoped** (no cross-node consumer; no code change) — recorded `EVENT-LEXICON.md §2`. **§5** — multi-record
> carrier-key divergence (`nights`/`recordings`/`sessions`) **DECIDED intentional** (each node's domain word; the
> Integrator adapters already read each) — recorded `EVENT-LEXICON.md §6`. **Gates:** NEW shared
> `Integrator periodic-breathing corroboration (§2)` group (both runners; `env.fusePeriodicBreathing` wired) +
> a browser-only PB render-coverage rig (drives `normalize → runFusion → renderAll` in the bundle realm, asserts
> card+badge+table reach the DOM); P10 export-version assert bumped 1.2 → 1.3 + a `periodicBreathing`-key assert.
> External-JS-only edit → Integrator re-bundled `manifestHash d86b136a979c → 21eacd2aff9b`; `buildHash 78e04e861cce`
> UNCHANGED. No Integrator code-gated fixtures → GATE B unaffected. Behavior + GATE A confirmed; full
> `Dex-Test-Suite` (incl. render-coverage) is the final green gate. **Residue → `OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-III-2026-06-30-BRIEF.md`** (PB burden trend; the ECGDex direct-PB-emit question).

> **✅ EXECUTED 2026-06-29 — §1 + §3 (one paired CPAPDex re-bundle + one golden regen, per the user pairing with
> `CPAPDEX-PHASE9-FOLLOWUPS-IV §2`):**
> **§1** — `cpapdex-fusion.js` `cpapEvents` SA2-desat emitter `desat` → canonical **`desat_event`**; CPAPDex
> re-bundled; BOTH synthetic goldens (`cpapdex_synthetic_golden` + `cpapdex_synthetic_multinight_golden`)
> REGENERATED via the deterministic `_synthEdfSet → buildSessionFromEdf → buildNight → cpapBuildExport` chain
> (verified: the ONLY content move vs the committed goldens is `desat`→`desat_event`; byte-identical otherwise) +
> their `manifestHash` re-recorded in `FIXTURE-PROVENANCE.json`. `EVENT-LEXICON.md` §1 table updated (CPAPDex now
> an emitter of the canonical name; `desat` retired). **Decision (documented):** `desat` is NOT added to the
> apnea `gather()` — CPAPDex is the device-scored AHI authority, intentionally NOT folded into the consumer-grade
> OxyDex⟷ECG desat⟷surge confirmation.
> **§3** — dead `cvhr_surge` **dropped** from `integrator-dsp.js`'s surge `gather()` → `['autonomic_surge',
> 'autonomic_arousal']`; Integrator re-bundled; `EVENT-LEXICON.md` §1/§4 + prose updated.
> **CPAPDEX-PHASE9-FOLLOWUPS-IV §2** rode the same CPAPDex re-bundle: the multi-night envelope was lifted into the
> shared `CpapFusion.cpapBuildMultiNightExport(chrono)` (app `exportNight` + the `Dex-Test-Suite` multi-night golden
> gate both call it; the -III in-test reconstruction + 4 source-pin asserts retired).
> **Behavior gate** `Dex-Test-Suite.html` (golden + multi-night equivalence groups diff the new `desat_event`).
> ⚠️ **Provenance caveat:** the inliner (`super_inline_html`) keys manifest assets by random UUIDs →
> **non-deterministic `manifestHash`**, and the platform auto-rebuilds bundles — so `verify-provenance` GATE A also
> surfaces a **PRE-EXISTING fleet drift** on 5 OTHER bundles (OxyDex/ECGDex/GlucoDex/PpgDex/HRVDex) whose committed
> `manifestHash` was recorded before this task and not re-synced. That drift is **NOT introduced by §1/§3/§2** and
> needs a separate fleet manifest re-sync pass (re-bundle + re-record each, or re-record current hashes). **Still
> open here: §2 (PB cross-node fusion), §4 (hrv/stress unify), §5 (carrier-key).**

## §1 — CPAPDex emitter `desat` → canonical `desat_event` (the last desat fork)

`cpapdex-fusion.js` emits `impulse:'desat'` for device-scored desaturations — the third name for the
desaturation concept (after `desat_event` canonical + `spo2_desaturation` legacy alias). The Integrator's
apnea `gather()` does **not** include `desat` (CPAPDex is device-scored AHI authority, intentionally not
folded into the consumer-grade OxyDex⟷ECG confirmation), so this is naming-consistency, not a fusion gap.

**Do:** rename the CPAPDex emitter `desat` → `desat_event`. This **moves committed golden fixtures**
(`cpapdex_synthetic_golden.node-export.json` + `cpapdex_synthetic_multinight_golden.node-export.json`
carry `"impulse":"desat"`), so it is the **full per-node ritual**: edit `cpapdex-fusion.js` → re-bundle
CPAPDex → regenerate BOTH goldens by re-running the deterministic `_synthEdfSet` chain (never hand-edit)
→ update their `manifestHash` in `FIXTURE-PROVENANCE.json` → `Dex-Test-Suite` green (the golden + multi-
night equivalence groups will diff the new name) → `verify-provenance` GATE A/B clean. Decide whether to
also add `desat`→accept in the gather for one cycle (only if a consumer should treat device-scored
desats as confirmable — probably **not**; document the decision).

## §2 — OxyDex `periodic_breathing` cross-node fusion semantics (the real feature)

Today `periodic_breathing` events (OxyDex + CPAPDex) only land in the raw event list — there is **no**
cross-node corroboration and **no** surfaced PB finding (`integrator-dsp.js` carries
`summary.periodicBreathingPct` from CPAPDex metrics but fuses nothing). This is the parent's §3, deferred
because it is a **capability**, not a cleanup:

- **Corroboration:** a PB episode observed by ≥2 signals (OxyDex SpO₂-oscillation ↔ CPAPDex device-flow
  ↔ ECGDex CVHR/CSR) is stronger than one — model it like `fuseStagingConsensus` (a new fuse* rule +
  a finding the render surfaces). Keep it **down-weighted** (OxyDex PB is `experimental` by registry;
  CPAPDex is device-scored) and honest about the source mix.
- **Burden trend:** feed a longitudinal PB-burden series (episodes/night) into `integrator-longitudinal.js`.
- **Finding card:** surface "periodic breathing observed by N nodes" with the experimental badge.

**Do:** design the PB fusion rule (inputs, weighting, output finding shape), implement in
`integrator-dsp.js` (+ a render surface in `integrator-render.js`), gate it (a fusion test + a render-
coverage assertion), then re-bundle the Integrator. Decide weighting deliberately (device-scored vs
proxy). This is the largest item here — scope it as its own brief if it grows.

## §3 — Dead `cvhr_surge` accept-type (drop-or-wire)

The surge `gather()` set lists `cvhr_surge`, which **no node emits** (ECGDex + PpgDex both emit
`autonomic_surge` for CVHR; confirmed in `INTEGRATOR-FUSION-AUDIT.md`). Harmless (inert accept-set
membership) but dead. **Do:** drop `cvhr_surge` from the gather set in `integrator-dsp.js` (1-line, then
re-bundle Integrator + gates) — OR, if a future node *should* emit it, wire that emitter. Record the
choice in `EVENT-LEXICON.md §4`.

## §4 — `hrv_drop`/`hrv_low` + `stress_peak`/`stress_high` unify question

PulseDex emits `hrv_drop`/`stress_peak`; HRVDex emits `hrv_low`/`stress_high` — two names each for
*parasympathetic-low* and *high-autonomic-stress*. They are **node-distinct by design** (different
windowing + evidence tiers) and **no cross-node consumer unifies them**, so this is NOT a live bug.
**Decide:** if a future fusion rule wants "low-HRV / high-stress across nodes," pick a canonical name
each (e.g. `hrv_low`, `stress_high`) + migrate PulseDex (re-bundle + its event fixtures move) with gather
aliases; otherwise **record in `EVENT-LEXICON.md §2` that they stay node-scoped** and close. Lowest
priority — do only if a consumer needs it.

## §5 — Multi-record carrier-key inconsistency (orthogonal to impulses, same instinct)

Multi-record node-exports use inconsistent carrier keys + multi-flags: OxyDex `nights[]`/`multiNight`,
ECGDex + PulseDex `recordings[]`/`multiRecording`, PpgDex `sessions[]`/`multiSession`, CPAPDex
`nights[]`. The Integrator's per-node adapters handle each, so it is **not broken** — but it is the same
"one shape" instinct the envelope pass applied to impulses. **Decide:** either standardize a single
carrier (e.g. `records[]` + `multiRecord`) with per-node back-compat reads, or **document the divergence
as intentional** (each node's domain word) in a short spec note and close. A fleet-wide reshape is a big
pass — scope separately; do NOT fold into an unrelated change.

---

## Done when
- [x] §1 CPAPDex emitter `desat`→`desat_event`; goldens regenerated + `manifestHash` re-recorded;
      `EVENT-LEXICON.md` desat-alias row updated (CPAPDex now emits the canonical name). Behavior gate
      (`Dex-Test-Suite`) green; `verify-provenance` GATE A pinned for CPAPDex (⚠ fleet-drift caveat above).
- [x] §2 PB cross-node fusion semantics implemented (corroboration + finding + render) + gated — **DONE 2026-06-30**
      (`fusePeriodicBreathing`; finding card/KPI/badge; shared fusion-test group + browser PB render-coverage rig).
      The longitudinal **burden trend** is scoped to -III with a recorded design (it is a NODE-side crossnight
      metric the generic `integrator-longitudinal.js` already trends — no Integrator code needed).
- [x] §3 dead `cvhr_surge` dropped + recorded (`integrator-dsp.js` surge `gather()` + `EVENT-LEXICON.md` §4).
- [x] §4 `hrv_*`/`stress_*` unify decision recorded — **node-scoped, no consumer** (`EVENT-LEXICON.md` §2).
- [x] §5 carrier-key decision recorded — **intentional divergence** (`EVENT-LEXICON.md` §6).
- [x] Every code-touching item honors the re-bundle + `Dex-Test-Suite` / `verify-provenance` gates
      (behavior 17/17 + GATE A 8/8 confirmed; render-coverage in the browser suite).
