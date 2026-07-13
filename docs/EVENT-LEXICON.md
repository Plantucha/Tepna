<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living spec) · **Created:** 2026-06-29 · **last-verified:** 2026-07-13 — **§7 added: CPAPDex device-scored `apnea`/`hypopnea`/`rera` annotation classes catalogued + the deferred apnea-corroboration decision, and the HRVDex `measurementMedian`≠`wholeRecord` window decision — DEEP-AUDIT-FOLLOWUPS §D1/§D2**; prior 2026-07-02 (CPAPDex `desat`→`desat_event` + dead `cvhr_surge` drop — -II §1/§3; **periodic_breathing cross-node fusion + hrv/stress + carrier-key decisions — -II §2/§4/§5**; **PB-burden longitudinal trend SHIPPED + ECGDex-emit / PB_CVHR_MIN / PB-span decisions — -III §1/§2/§3/§4, see §6.1/6.3/6.4/6.5**; **ECGDex cardiac PB-burden already-present-as-`cvhrIndex` + `cite`-in-mapping deferred decisions — -IV §1/§2, see §6.7/6.8**; **ECGDex has NO symmetric sqi-floor (INTENTIONAL) + `sqiFloor`/`clampFloor` are audit-only — NODE-RESIDUE-FOLLOWUPS-II §1/§2, see §6.10**)

# EVENT-LEXICON — the canonical `ganglior_events[].impulse` vocabulary

> One authoritative list of the impulse names every node emits onto the Ganglior bus, so a new node
> (or a synthetic/demo path) cannot silently re-fork a name for a concept that already has one. Born
> from `OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-2026-06-29-BRIEF §1` after OxyDex's honest rename
> (`desat_event`) exposed that the desaturation concept was spoken three different ways across the fleet.
>
> **Rule for a new emitter:** reuse the **canonical** name for a concept that already exists here; only
> mint a new impulse for a genuinely new concept, and add it to this table in the same pass. **Rule for
> a consumer** (`integrator-dsp.js` `fuseApneaEvents` `gather()` sets, etc.): accept the canonical name
> **plus** the listed deprecated aliases for **one migration cycle**, then drop the aliases once every
> emitter + committed fixture has moved. This is the same "canonical + back-compat alias" discipline the
> Clock Contract uses for timestamps.

---

## 1. Canonical names (the apnea-fusion family — these MUST agree across nodes)

| Concept | **Canonical impulse** | Emitted by (real node) | Deprecated aliases (accepted by fusion, one cycle) |
|---|---|---|---|
| O₂ desaturation | **`desat_event`** | OxyDex (`oxydex-dsp.js` `oxyBuildGangliorEvents`), CPAPDex (`cpapdex-fusion.js` `cpapEvents`, SA2 lane — **migrated -II §1**) | `spo2_desaturation` (Integrator demo + legacy-synthesis output) · ~~`desat`~~ (was CPAPDex — **migrated → `desat_event` 2026-06-29, -II §1**) |
| Autonomic surge / arousal | **`autonomic_surge`** | ECGDex (`ecgdex-dsp.js`), PpgDex (`ppgdex-dsp.js`) | `autonomic_arousal` (OxyDex *legacy-synthesis* pulse-rate arousal — see §3) · ~~`cvhr_surge`~~ (**dropped from gather 2026-06-29, -II §3** — no emitter; see §4) |
| Periodic breathing / Cheyne-Stokes | **`periodic_breathing`** | OxyDex (SpO₂ oscillation), CPAPDex (device flow) | — (already unified). **Now also a fusion CONSUMER** — `fusePeriodicBreathing` corroborates a PB window seen by ≥2 signals (incl. ECGDex cardiac-CVHR as the autonomic correlate); see §6. |

The Integrator's apnea matcher (`fuseApneaEvents`) gathers **desats** = `['spo2_desaturation','desat_event']`
and **surges** = `['autonomic_surge','autonomic_arousal']` (the dead `cvhr_surge` was dropped — -II §3).
Both sets carry the canonical name + the live alias, so a desat under EITHER name confirms against a
surge — the migration is non-breaking by construction. Separately, `fusePeriodicBreathing` gathers
**`periodic_breathing`** (+ ECGDex `cvhrIndex` as the cardiac correlate) to corroborate PB across nodes (§6).

> **Why `desat_event`, not `spo2_desaturation`?** The canonical name describes the **event**, not the
> **signal that observed it** — OxyDex infers desaturation from an SpO₂ proxy, CPAPDex from device flow,
> a future node from something else. Baking `spo2_` into the bus name is exactly the source-coupling the
> OxyDex envelope pass moved away from. `autonomic_surge` and `periodic_breathing` are already
> source-neutral, so they stay.

## 2. Node-scoped impulses (no cross-node fork — documented for completeness)

These are emitted by exactly one node and consumed structurally; they do **not** participate in the
apnea `gather()` sets, so they need no canonicalization:

| Impulse | Node | Notes |
|---|---|---|
| `stage_<stage>` (e.g. `stage_rem`, `stage_deep`) | ECGDex | sleep-stage transitions; `conf 0.7`, `sqi null` |
| `hrv_drop` | PulseDex | windowed RMSSD drop |
| `hrv_low` | HRVDex | per-measurement low RMSSD (`evidence:'measured'`) |
| `stress_peak` | PulseDex | windowed high stress |
| `stress_high` | HRVDex | per-measurement high stress (Welltory composite, `evidence:'heuristic'`) |
| `nocturnal_hypo`, `glucose_excursion` | GlucoDex | CGM events |
| `glucose_autonomic_correlation`, `nocturnal_glucose_risk`, `hypo_qtc_arrhythmia_risk` | GlucoDex | cross-signal composites |
| `large_leak` | CPAPDex | mask-leak event |

✅ **DECISION (-II §4, 2026-06-30): stay NODE-SCOPED — closed.** `hrv_drop` (PulseDex) vs `hrv_low`
(HRVDex) both mean *parasympathetic-low*; `stress_peak` (PulseDex) vs `stress_high` (HRVDex) both mean
*high autonomic stress*. They are node-distinct BY DESIGN (different windowing + evidence tiers —
PulseDex windowed RMSSD/stress vs HRVDex per-measurement) and **no cross-node consumer unifies them**
(`fuseApneaEvents` / `fuseHRVConsensus` / `fusePeriodicBreathing` gather none of them). Unifying now
would cost a PulseDex re-bundle + its event-fixture regen to buy nothing. Left node-scoped; if a future
fusion rule needs "low-HRV / high-stress across nodes," pick a canonical each (proposal: `hrv_low`,
`stress_high`) + migrate PulseDex with gather aliases THEN. No code change this pass.

## 3. `autonomic_arousal` — OxyDex legacy-synthesis only (decision recorded)

OxyDex's v2.0 envelope emits **only** `desat_event` + `periodic_breathing` (the honest two-impulse model
the envelope brief chose). It does **not** emit an arousal impulse — HR-spike "arousals" off a 1 Hz pulse
are a soft proxy, and OxyDex is **not** a cardiac (surge) node, so it was never a fusion surge input.
**Decision (`-FOLLOWUPS §2`, option a): leave it dropped.** `autonomic_arousal` survives ONLY on the
Integrator's *legacy-synthesis* fallback (`integrator-dsp.js` `adaptOxyDex`, for old bare-array OxyDex
exports), kept in the surge `gather()` for back-compat. New OxyDex exports never produce it.

## 4. `cvhr_surge` — reserved / dead

Was listed in the surge `gather()` set but **emitted by no node** (ECGDex + PpgDex both emit `autonomic_surge`
for CVHR-derived surges; see `INTEGRATOR-FUSION-AUDIT.md`). **Dropped 2026-06-29 (-II §3 — drop-or-wire → drop):**
removed from `integrator-dsp.js`'s surge `gather()` (the accept-set membership was inert — no producer). A future
CVHR surge emits the canonical `autonomic_surge`; re-add a distinct accept-type only alongside a real emitter.

## 5. What this pass changed (and what it deliberately did not)

- **Migrated (this pass, Integrator-only, low-risk — no committed fixture moves):** the Integrator's
  **synthetic generator** (`integrator-app.js` `genSynthetic`) and **legacy-synthesis** path
  (`integrator-dsp.js` `adaptOxyDex`) now emit the canonical **`desat_event`** instead of
  `spo2_desaturation`. The Integrator therefore surfaces ONE desat name for OxyDex regardless of whether
  it read a v2.0 stream or synthesized one from a legacy array.
- **Kept as back-compat aliases:** `spo2_desaturation` + `desat` in the desat gather; `autonomic_arousal`
  + `cvhr_surge` in the surge gather. Committed historical fixtures (`integrator_fusion_2026-06-16.json`,
  the `tests/fixtures/oxydex.*`) carry old names and keep fusing.
- **-II progress (2026-06-30 — ALL items closed):** ✅ (a) CPAPDex emitter `desat` → `desat_event` — **DONE**
  (-II §1: `cpapdex-fusion.js` re-bundled + both synthetic goldens regenerated); ✅ (c) dead `cvhr_surge`
  accept-type **dropped** — **DONE** (-II §3, see §4 above); ✅ (e) **periodic_breathing CROSS-NODE FUSION
  shipped** — **DONE** (-II §2: `fusePeriodicBreathing` in `integrator-dsp.js` + finding card/KPI in
  `integrator-render.js` + the synthetic-demo PB path in `integrator-app.js`; Integrator re-bundled; gated by
  the shared suite's "periodic-breathing corroboration (§2)" group + a browser-only PB render-coverage rig — see
  §6); ✅ (b) the `hrv_drop`/`hrv_low` + `stress_peak`/`stress_high` unify question **DECIDED node-scoped** —
  **DONE** (-II §4, see §2 above — no code change, no consumer); ✅ (d) the multi-record **carrier-key**
  divergence **DECIDED intentional** — **DONE** (-II §5, see §6 — documented, no fleet reshape).

## 6. Cross-node fusion CONSUMERS of the lexicon + the carrier-key decision (-II §2/§5)

### 6.1 `fusePeriodicBreathing` — periodic-breathing corroboration (-II §2, shipped)
Periodic breathing / Cheyne–Stokes is observable by several INDEPENDENT signals, so the Integrator
corroborates it the way it does staging + HRV consensus (group observers by night-overlap; surface
only CORROBORATED windows):
- **OxyDex** — `periodic_breathing` events (SpO₂ oscillation) — tier **experimental**
- **CPAPDex** — `periodic_breathing` events + `metrics.periodicBreathingPct` (device flow) — **device-scored**
- **ECGDex** — `summary.cvhrIndex` ≥ `PB_CVHR_MIN` (cardiac CVHR, the autonomic CORRELATE of the
  breathing cycle — NOT a direct PB read) — tier **emerging**

A window with **≥2 distinct observer nodes** emits a `periodic_breathing` finding; confidence is the
tier-weighted noisy-OR (device 1.0 · CVHR 0.8 · oximetry-proxy 0.6), and the finding is graded
**experimental** (a corroboration signal, NOT a scored CSR/PB index). A LONE observer is NOT surfaced
(single-signal PB stays in the raw event list). No node is re-scored; this reads events/metrics already
on the bus. Exported under the `periodicBreathing` block of `ganglior.fusion-export` (schema bumped
1.2 → **1.3**, additive/null-tolerant).

> **SHIPPED (-III §1, 2026-06-30): the longitudinal PB-BURDEN TREND.** `integrator-longitudinal.js` is a
> GENERIC `ganglior.crossnight` ingester — it already trends + cross-correlates ANY metric a node's
> crossnight envelope carries, so this needed **NO Integrator code**: each PB node now emits a PB metric
> in its crossnight `metrics{}` and the trend + coupling appear automatically. **CPAPDex** —
> `periodicBreathingPct` (% therapy in CSL Cheyne-Stokes/PB spans, `goodDirection:'down'`, **measured**)
> in `cpapdex-cross.js` `CPAP_DEFS`. **OxyDex** — `pbIndex` (oscillation episodes/hr =
> `osc.episodeCount ÷ durationMin·60`, `goodDirection:'down'`, **experimental** — OxyDex infers
> respiration from an SpO₂-oscillation proxy, never `measured`) in `oxydex-cross.js` `OXY_DEFS`. Both
> ride the shared `CrossNightEnvelope.build` path + are self-describing (`label/unit/goodDirection/`
> `evidence/cite`). ECGDex's per-night CVHR/CSR burden trend stays the optional cardiac-correlate leg
> (not built — see §6.3). Verified: a rising PB-burden series tracks against the other crossnight metrics
> (e.g. falling rMSSD) in the Integrator Longitudinal view's Pearson coupling table.

### 6.3 ECGDex — `cvhrIndex`-as-index stays the PB channel (NO first-class `periodic_breathing` emit) (-III §2, decision)
**DECISION (2026-06-30): keep CVHR-as-index; ECGDex does NOT emit a `periodic_breathing` impulse.**
ECGDex participates in PB corroboration via **`summary.cvhrIndex` ≥ `PB_CVHR_MIN`** (a derived-index
threshold), not an event off the bus — because ECGDex emits `autonomic_surge` (CVHR), and CVHR is the
autonomic *correlate* of the breathing cycle, **not** a direct airflow/SpO₂ PB read. Stamping a
first-class `periodic_breathing` on a purely-cardiac signature would buy uniform plumbing at the cost of
**honesty** — CVHR also accompanies plain OSA, not only PB/CSR. The channel stays labelled *"cardiac CVHR
(autonomic correlate)"* + tiered **emerging**, and `fusePeriodicBreathing` reads it as an index (the
slightly-different-plumbing is accepted, documented here). Revisit only if a validated CSR-pattern gate on
the CVHR train (cyclic, ~the right period) is built — then it emits the canonical `periodic_breathing`
and migrates to event-reading, no new impulse name.

### 6.4 `PB_CVHR_MIN` — INTENTIONALLY Integrator-local, not a kernel constant (-III §3, decision)
**DECISION (2026-06-30): annotate Integrator-local; do NOT source from `DexKernel.K`.** `PB_CVHR_MIN`
(= 5 events/h, in `integrator-dsp.js`) is a **fusion-layer corroboration knob** — how strong a cardiac
CVHR train must be to COUNT as one PB observer — **not** a cross-fleet node physiology threshold, so it
does not belong in `DexKernel.K` (the kernel-constants single source). Kernel-sourcing it would bump
`KERNEL_HASH` and force the **8-app fleet rebuild** for an **unvalidated** rule-of-thumb — unwarranted.
This follows the **DEX-EVENT-UNIFY C2** precedent (OxyDex's SpO₂-only detector params stay node-local).
The `var` is annotated in place at its definition site; promote to the kernel only once the threshold is
validated against the corpus. Lowest priority; cosmetic until then.

### 6.5 PB finding has no timeline band — left a card/table WINDOW finding (-III §4, decision · UX)
**DECISION (2026-06-30): leave PB as a card/table window finding; no timeline span overlay.**
`confirmed_apnea_event` draws a vertical band on the Integrator timeline; `periodic_breathing` does not —
it is a **window** finding (a night-level corroboration), surfaced as a finding card + KPI + a
findings-table row, with its `tMs` at the window start. That is **intentionally consistent** with the
other window findings (`staging_disagreement`, `hrv_consensus` — also card/table only). A PB **span**
overlay (start→end shaded region across lanes) was considered and **not** added: pure UX, no correctness
impact, and adding it for PB alone would break the window-finding family's visual consistency. Revisit
only if a span overlay is built for the whole window-finding family at once.

### 6.6 Multi-record carrier keys — INTENTIONAL divergence (-II §5, decision)
Multi-record node-exports use different carrier keys + multi-flags by node: OxyDex `nights[]`/`multiNight`,
ECGDex + PulseDex `recordings[]`/`multiRecording`, PpgDex `sessions[]`/`multiSession`, CPAPDex `nights[]`.
**DECISION (2026-06-30): keep the divergence — each is the node's correct DOMAIN word** (an oximeter
records *nights*, a PPG armband records *sessions*). The Integrator's per-node adapters (`adaptOxyDex` /
`adaptEnvelopeNode`) already read each shape, so it is **not broken** — only non-uniform. A fleet-wide
reshape to a single `records[]`/`multiRecord` carrier would touch all node emitters + every committed
fixture to buy cosmetic uniformity over a layer that already abstracts it. Not done. If a future
cross-node tool ever needs ONE carrier name, standardize then with per-node back-compat reads (the same
canonical+alias discipline this doc uses for impulses).

### 6.7 ECGDex cardiac PB-burden longitudinal trend — already present as `cvhrIndex`; no dedicated `cvhrBurden` (-IV §1, decision)
**DECISION (2026-06-30): do NOT add a dedicated ECGDex `cvhrBurden`/CSR-fraction crossnight metric; the cardiac-
correlate PB burden ALREADY trends as `cvhrIndex`.** `-III §1` left ECGDex's cardiac-correlate burden trend as the
one optional leg unbuilt. On inspection it does not need building: ECGDex's `crossNightBlock` `metrics{}` ALREADY
carries **`cvhrIndex`** (CVHR index, `/h`, `goodDirection:'down'`, **emerging** — Hayano cyclical-variation-of-HR,
the oximetry/ECG apnea surrogate; emitted for overnight non-ambulatory recordings, nulled under ambulatory).
Because `integrator-longitudinal.js` is a GENERIC `ganglior.crossnight` ingester that trends + Pearson-couples ANY
metric a node's envelope carries, the cardiac-correlate burden (CVHR events/h) ALREADY appears in the Integrator
Longitudinal view's sparkline + coupling table alongside the airflow/SpO₂ PB metrics (`periodicBreathingPct`,
`pbIndex`). A dedicated `cvhrBurden` = CVHR events/h would be a LITERAL DUPLICATE of `cvhrIndex` under a PB label —
clutter, no new signal. The only NON-duplicate option, a CSR-pattern fraction (how much of the night the CVHR
train is CSR-like), requires the CSR-pattern detector on the CVHR train that §6.3 (-III §2) DELIBERATELY DECLINED
on honesty grounds (CVHR also accompanies plain OSA, not only PB/CSR). So the cardiac correlate is present at BOTH
layers — same-night corroboration (§6.1, `cvhrIndex ≥ PB_CVHR_MIN`) AND the longitudinal trend (§6.2, `cvhrIndex`
as a crossnight metric) — just not under a redundant PB-specific name. No code; no ECGDex re-bundle. Revisit only
if a validated CSR-pattern gate is built (then it emits `periodic_breathing` per §6.3 and could carry its own
burden metric).

### 6.8 `cite` in the def→envelope mapping — DEFERRED; only PpgDex actually drops it (-IV §2, decision)
**DECISION (2026-06-30): defer the `cite`-in-mapping propagation; do NOT drive a standalone 3-app rebuild for an
inert cosmetic change.** `-III §1` found + fixed (for OxyDex + CPAPDex) that a node's `crossNightBlock` could drop
a metric's `cite` before `CrossNightEnvelope.build` (the builder's `_shapeMetric` plumbs `cite:m.cite||null`, but
the node's metric-def array omitted it). -IV §2 asked whether to propagate the fix to the remaining three.
SHARPENED FINDING (corrects the brief's premise that all three share the lossy `Object.keys(<DEFS>).map(...)`):
only **PpgDex** actually has it — its `crossNightBlock` builds the array via `Object.keys(PPG_DEFS).map(...)` and
emits `{id,label,unit,goodDirection,get}`, dropping BOTH `cite` and `evidence`. **ECGDex** and **PulseDex** do NOT
map: they pass their `METRICS` array LITERAL straight into `build`, so `_shapeMetric`'s `cite:m.cite||null` already
forwards any future cite — they are ALREADY cite-safe, with literally nothing to add. A 3-app consistency pass
would therefore re-bundle ECGDex + PulseDex for ZERO source delta (pure provenance/manifest churn). It is inert
today (no node's crossnight defs carry a `cite` → all legitimately `cite:null`), so per the CLAUDE.md BADGE_CSS
precedent ("leave bundles as-is for inert shared-module additions; re-bundle only when runtime behavior changes")
nothing is re-bundled this pass. FOLD-IN (captured in FOLLOWUPS-V): when PpgDex is next re-bundled for another
reason — or when it first cites a crossnight metric — change its map to also emit `evidence:d.evidence` +
`cite:d.cite` (parity with the OxyDex/CPAPDex mapping; `PPG_DEFS` gains the fields alongside the cite). Lowest
priority; cosmetic until a node cites a crossnight metric.

### 6.9 PpgDex `event.sqi` fusion weighting — proportional `effConf` taper + a categorical SQI FLOOR (NODE-RESIDUE-FOLLOWUPS §3, shipped)
**DECISION (2026-06-30): the Integrator trusts low-SQI PpgDex events less, in TWO complementary layers.**
PpgDex stamps a per-event signal-quality axis `sqi` (local `sqiAt()` mean, `[0,1]`) on `autonomic_surge` /
`hrv_drop` / `motion_artifact_segment` — fleet-consistent with ECGDex (R7: `sqi` rides ALONGSIDE `conf`, never
folded into it).
- **Proportional (fleet-generic, already present):** `effConf(e) = conf × (sqi ?? 1)` attenuates every event's
  likelihood in the apnea noisy-OR by its `sqi`. A noisy PpgDex surge (`sqi 0.5`) corroborates a desat at half the
  evidence of a clean one — automatically, because the event carries a real `sqi`. `sqi==null` ⇒ quality-neutral.
- **Categorical SQI FLOOR (NEW — mirrors the GlucoDex clamp-floor):** `adaptEnvelopeNode`'s PpgDex branch adds an
  EXTRA-distrust penalty for the UNUSABLE-quality tail — an event whose `sqi < PPG_SQI_FLOOR` (= `0.3`) has its
  `conf` halved (`×0.5`) and is tagged `sqiFloor` at ingest, exactly as a clip-floor CGM `nocturnal_hypo` is
  (`×0.5` + `clampFloor`). The `sqi` axis is PRESERVED (R7). The two layers stack DELIBERATELY: a surge in a
  too-noisy window is discounted BOTH proportionally (effConf) AND categorically (floor) — it barely corroborates.
- **Integrator-LOCAL knob:** `PPG_SQI_FLOOR` is a fusion-layer quality floor, NOT a node physiology threshold — do
  NOT kernel-source it (the `PB_CVHR_MIN` precedent, §6.4). `sqi==null` / `sqi ≥ floor` → untouched (back-compat).
- **Gate:** `tests/dex-tests.js` group *"Integrator PpgDex sqi-floor down-weight (NODE-RESIDUE-FOLLOWUPS §3)"*
  (both runners) — sub-floor surge → `conf ×0.5` + `sqiFloor`, `sqi` preserved; above-floor + `sqi==null`
  untouched; plus a source-mirror on the `PPG_SQI_FLOOR` constant + the branch loop.

### 6.10 No symmetric ECGDex SQI floor (INTENTIONAL) + `sqiFloor`/`clampFloor` are audit-only (NODE-RESIDUE-FOLLOWUPS-II §1/§2, decisions)
**DECISION (2026-07-02): the categorical SQI floor (§6.9) is PpgDex-ONLY on purpose, and the `sqiFloor` / `clampFloor`
tags it sets are audit breadcrumbs — the `conf ×0.5` is the load-bearing part, not the tag.**

- **§1 — the asymmetry is INTENTIONAL, not an oversight.** ECGDex `autonomic_surge` events ALSO carry a per-event
  `sqi` (`ecgdex-dsp.js` stamps `sqiAt()`, fleet-consistent with PpgDex), and `effConf = conf × (sqi ?? 1)` already
  tapers BOTH nodes' surges proportionally in the apnea noisy-OR. The EXTRA categorical floor (§6.9) is applied only
  to the `node==='PpgDex'` branch of `adaptEnvelopeNode` because the two sensors have different quality physics:
  **PpgDex is limb-worn OPTICAL** (Polar Verity Sense) — motion-prone, its `sqi` legitimately dips into the unusable
  tail, so the hard categorical distrust is warranted; **ECGDex is a CHEST STRAP** (Polar H10) whose `sqi` rarely
  reaches `< PPG_SQI_FLOOR` on a real recording, so a floor would almost never fire and `effConf`'s smooth
  proportional taper already covers it. Deliberately NOT generalized to a shared `NODE_SQI_FLOOR` table — that adds
  surface area (a per-node table + a shared post-map step + a test twin in both runners) for a floor that would
  essentially never fire on chest-strap data. Documented at the PpgDex-branch floor site in `integrator-dsp.js`.
- **§2 — the `sqiFloor` (PpgDex) and `clampFloor` (GlucoDex) tags are AUDIT-ONLY today.** The `conf ×0.5` each floor
  applies is the LOAD-BEARING down-weight (it flows through `effConf` → the noisy-OR → the posterior); the boolean
  tag itself is a provenance breadcrumb — grep-confirmed NOT read anywhere (`integrator-dsp.js` /
  `integrator-render.js` / `integrator-app.js`; not surfaced in `buildFusionExport`'s finding `sources[]` nor on any
  render card). This mirrors the documented `meta.derived` precedent (the `effConf` header note in
  `integrator-dsp.js`). Do NOT assume either tag gates anything in the posterior until a reader + a test land. If a
  future pass surfaces a "quality-floored source" marker on the apnea finding's `sources[]`, that is a source-shape
  change (Integrator re-bundle + GATE A + a test), not a free-rider on the existing tag.

## 7. CPAPDex device-scored annotations + the HRVDex consensus window (DEEP-AUDIT-FOLLOWUPS-2026-07-12 §D1/§D2)

### 7.1 `apnea` / `hypopnea` / `rera` — CPAPDex device-scored classes, NOT (yet) first-class fusion impulses (§D1)
CPAPDex parses the AirSense EVE/CSL annotation channels into device-scored event classes via
`cpapdex-edf.js` `classifyAnnotation`: **Obstructive / Central / Mixed / (bare) Apnea · Hypopnea · RERA ·
Cheyne-Stokes · PeriodicBreathing**. These are the device's OWN scored events. Today they are consumed
**internally only** — they drive the residual-AHI / central-apnea-index trend metrics (`cpapdex-cross.js`)
and, on the demo path, place the synthetic SA2 desaturations (`cpapdex-app.js`) so ODI tracks the device AHI.

They are **NOT emitted as `ganglior_events[].impulse`**: CPAPDex's bus emissions are `desat_event`,
`large_leak`, and `periodic_breathing` (`cpapdex-fusion.js` `cpapEvents`). So `apnea` / `hypopnea` / `rera`
are **not** cross-node impulse names and carry no canonicalization in §1 — they are device-internal classes,
catalogued here for completeness so the next reader doesn't mistake them for a missing impulse.

**Decision (deferred, recorded — §D1):** whether `fuseApneaEvents` should **corroborate a device-scored
apnea/hypopnea against an OxyDex/ECGDex desat+surge** — the SAME shape as the §15 fix that keyed the desat
pool by *impulse* not *node* — is left for a deliberate future work-unit. It would require CPAPDex to emit the
scored event as a first-class impulse (a `ganglior.node-export` shape change → Integrator re-bundle + GATE A +
a fusion test), so it is NOT a free-rider on the existing internal classes. Until then a device-scored apnea
reaches fusion only via the desaturation it produces (`desat_event`) — the current, intentional behavior.

### 7.2 HRVDex `measurementMedian` is NOT compared against an overnight `wholeRecord` value (§D2)
The HRV consensus axis (`integrator-dsp.js`, R8) is normalized to **`wholeRecord`** — a node's whole-record
SDNN/RMSSD — with the epoch-scoped display variants carried under explicit keys (`sdnnEpochMedian`, …).
HRVDex's `measurements[]` median (§14) is a **month of Welltory spot readings**, labelled `measurementMedian`,
NOT `wholeRecord`. **Decision (§D2):** a spot-reading median and an overnight whole-record SDNN are **different
analysis windows and are NOT consensus-comparable**; R8's like-window guard deliberately keeps them apart (the
HRV node is no longer silently dropped — §14 — but it joins the consensus only on a like window). Do **not**
"fix" this by feeding `measurementMedian` into the whole-record axis — that re-introduces the exact
window-mismatch R8 exists to prevent.
