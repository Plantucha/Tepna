<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Integrator Fusion — GitHub issues (paste-ready)

> One issue per remediation item from `INTEGRATOR-FUSION-AUDIT.md`, **validated against the uploaded
> Jun-10 fixtures**. Copy each block into a new issue. Suggested labels are in each header; evidence
> cites in-repo source by file + function plus the fixture values that prove it.
> Milestone suggestion: **R2–R8 → "Fusion hardening"**, **R1 + R9–R11 → "Hygiene / Node QC"**.

---

## R1 · No build/input stamping on exports (verifiability hygiene) · ✅ IMPLEMENTED (Jun-12)
**Labels:** `enhancement` `provenance` `priority:low`

**Shipped.** `ganglior-provenance.js` (shared, self-contained, loaded first in all 7 apps) stamps every
export with `schema.provenance = { buildHash, generated, inputs[] }`:
- `buildHash` — ⚠️ **RETIRED as a provenance signal (Phase 7, 2026-06-30 — `CLAUDE.md` §🔏).** *Intended*
  as SHA-256[0:12] of the bundle's immutable `__bundler/template`, but the template is stripped at unpack
  so the committed value is a runtime inline-shell fallback hash (not the template, not the executed
  code); it is now inert legacy metadata that **no gate reads**. `manifestHash` (the `__bundler/manifest`
  projection = the inlined `*.js`/CSS) is the sole executed-code identity `verify-provenance.html` checks.
- `inputs[]` — `{ name, bytes, lastModifiedMs (floating, Clock-Contract), sha256[0:16] }` for every
  file read, captured by a **passive `FileReader` hook** — one install point, no per-app ingest edits,
  no change to read behaviour. The Integrator's inputs are the node-export JSONs, so node-version
  identity is captured transitively (each hashed file embeds its `nodeVersion`).
- OxyDex's deliberately byte-compatible single-night array stamps each night record instead of a wrapper.

**CI — `verify-provenance.html`** (runnable now): loads each bundle in an iframe, reads the live
`buildHash` → the commit-able build manifest, then audits every `uploads/*.json`, flagging any fixture
whose stamped `buildHash` ≠ its app's current hash (= an export the code can no longer reproduce). The
embedded recipe specifies the headless (Playwright) GATE A/B/C for wiring into real CI, including the
volatile-key strip list (`schema.generated`, `provenance.generated`).

**Verified:** 7/7 apps expose the helper with distinct, stable hashes (e.g. ECGDex `488b1266f060`); the
hook fingerprints a sample input (name/bytes/floating mtime/sha256); the four pre-R1 fixtures correctly
report "no provenance — pre-R1 export".

<details><summary>Original ticket</summary>

**Note — downgraded after validation.** The captured fixture **reproduces exactly** from current
source, so this is hygiene, not a blocker.

**Problem**
The fusion export can only be re-verified by manual recomputation — it carries no build identity or
input identity, and doesn't propagate the node versions it consumed.

**Evidence (reproduces — so NOT a correctness bug)**
- `confirmedApneaIndex 0.17` = 1 / 5.807 h (`toFixed(2)`); finding `conf 0.815` = noisy-OR(0.63, 0.50);
  `overlapMin 1115` = sum of the three pairwise overlaps. All match `integrator-dsp.js`.
- The *node* exports stamp `nodeVersion` (ECGDex 1.1, PpgDex 1.0); the **fusion** export drops them,
  and has no `buildHash` / input SHA-256.

**Fix**
- Propagate consumed node versions into the fusion export; add `buildHash` + per-input SHA-256.
- CI regenerates the committed fixture from committed source and fails on diff.

**Acceptance**
- The fixture is reproducible *and* self-describes the exact build + inputs that produced it.

</details>

---

## R2 · PpgDex is silently excluded from all fusion (node-name gap) · ✅ IMPLEMENTED (Jun-11)
**Labels:** `bug` `fusion` `priority:high`

**Problem**
A `PpgDex` export loads and shows on the timeline but contributes to **zero** fusion rules — it is
registered nowhere under that name.

**Evidence**
- `NODE_COLORS` (integrator-dsp.js) has no `PpgDex` → renders grey "Unknown".
- `adaptEnvelopeNode` summary branch handles only `ECGDex/GlucoDex/PulseDex/HRVDex` → empty summary.
- `fuseApneaEvents` gathers surges from `_byNode('ECGDex')` only; `fuseHRVConsensus` filters
  `['ECGDex','PulseDex','HRVDex']`.
- Yet `ppgdex-dsp.js` `buildEvents` emits `autonomic_surge` (conf 0.65) and `hrv_drop` — valid
  corroborating impulses the matcher would accept.
- Dead branch: the matcher's accepted surge list includes `cvhr_surge`, which **no node emits**
  (ECGDex + PpgDex both emit `autonomic_surge` for CVHR).
- **Fixture proof:** `nodes[]` lists PpgDex with `nEvents:81` and an overlapping Jun-10 window, yet the
  single finding draws only on OxyDex+ECGDex and **no PpgDex surge appears in `unmatched.surge`**.

**Fix**
- Register `PpgDex` in `NODE_COLORS`, `detectNode`, the `adaptEnvelopeNode` summary branch, and the
  `fuseHRVConsensus` filter — or canonically alias `PpgDex ↔ PulseDex` across the suite.
- Remove the dead `cvhr_surge` accepted-type or wire emitters to it.
- Add a regression asserting every `nodes[]` entry resolves to a color + a summary adapter.

**Acceptance**
- Dropping a PpgDex export colors it correctly and routes its `autonomic_surge`/HRV into apnea +
  consensus rules; a test fails if any future node name is unregistered.

---

## R3 · `window.overlapMin` double-counts (two overlap computations) · ✅ IMPLEMENTED (Jun-11)
**Labels:** `bug` `fusion` `priority:high`

**Problem**
The headline window number sums pairwise overlaps (double-counting) and is not an N-way intersection,
while the AHI denominator silently uses a *different, correct* union — two inconsistent definitions.

**Evidence**
- `runFusion`: `window.overlapMin = pairs.reduce((s,p)=> s + (p.overlap?p.overlap.overlapMin:0), 0)`.
- `fuseApneaEvents` builds a **merged union** of OxyDex×ECGDex intervals for `overlapHours`.

**Fix**
- Compute one canonical overlap (true union and/or N-way intersection); never sum pairwise.
- Exclude zero-overlap nodes (e.g. GlucoDex 66 days off) from the headline window; report them as
  historical/non-coincident.

**Acceptance**
- `window.overlapMin` equals the merged-union minutes; a 1-Oxy × 2-ECG fixture counts shared time once.

---

## R4 · Two divergent apnea matchers in one suite · ✅ IMPLEMENTED (Jun-11)
**Labels:** `bug` `fusion` `consistency` `priority:high`

**Problem**
Apnea is confirmed in two places with different rules, and they disagree on the same night.

**Evidence**

| | OxyDex `oxyComputeFusion` (`oxydex-fusion.js`) | Integrator `fuseApneaEvents` (`integrator-dsp.js`) |
|---|---|---|
| Window | ±90 s (`WIN=90`) | ±120 s (`dtMs`) |
| Output | `confirmed/desN` + `confPct` | noisy-OR conf + AHI / union-hour |
| Surge dedup | none | global `usedSurge` Set |
| Surge types | `autonomic_surge` only | +`autonomic_arousal`, `cvhr_surge` |

- Concrete contradiction: the reconstructed pair at **latency −96 s** confirms under the Integrator
  (|−96| ≤ 120) but fails OxyDex's ±90 s gate → "confirmed" on one dashboard, "not confirmed" on the other.

**Fix**
- Extract one shared matcher (window, dedup, surge-type set, output metric); both surfaces call it.
- If OxyDex's in-app panel stays standalone, have it import the Integrator's parameters so they can't drift.

**Acceptance**
- A shared fixture yields identical confirmed counts in both surfaces.

---

## R5 · Apnea match has no directionality or null-model gate · ✅ IMPLEMENTED (Jun-11)
**Shipped.** Both surfaces now use an **asymmetric directional gate** (`leadMaxSec 15` / `trailMaxSec 60`:
a surge may lead the nadir by ≤15 s, trail by ≤60 s) plus a **Poisson null model** (`_poissonSf`) that
flags `belowChance` + `pSpurious` on every finding; `confirmedAHIReportable` is false and the KPI shows
"— / below chance" when chance isn't beaten. Verified on the Jun-10 fixture: the lone −96 s pair is now
**rejected on direction (0 findings)**, and even under a wide ±120 s window it returns `belowChance:true`
(expected 0.18, p=1.0). Params: `LEAD/TRAIL` in `oxydex-fusion.js`, `leadMaxSec/trailMaxSec` in
`integrator-dsp.js` — keep identical.
**Labels:** `enhancement` `fusion` `statistics` `priority:high`

**Problem**
Symmetric ±120 s with no sign constraint lets a surge *before* a desat confirm an obstructive event,
and a single coincidence emits a finding with no chance baseline.

**Evidence**
- `fuseApneaEvents` matcher uses `Math.abs(s.tMs - d.tMs)`; `latencySec` can be negative.
- No per-night expected-coincidence computation anywhere in `runFusion`.
- **Fixture proof:** the export's *only* confirmed event has `latencySec −96` (surge 96 s **before** the
  desat). And the chance baseline is damning: 25 ECG surges over 5.8 h with a ±120 s window per desat
  ⇒ ~0.57 confirmations expected by chance across the 2 desats vs **1 observed** — indistinguishable
  from coincidence.

**Fix**
- Tighten Δt (≤60 s) and gate on `latencySec ≥ −T` (response should trail/coincide with the nadir).
- Compute a per-night Poisson/permutation coincidence expectation; suppress findings below it.
- Require a minimum confirmed count before publishing `confirmedApneaIndex`.
- Optional: global nearest-pair assignment instead of greedy desat-order matching.

**Acceptance**
- A surge-before-desat pair no longer confirms; findings at/below chance are suppressed with a logged reason.

---

## R6 · Document the noisy-OR + 0.97 cap in the export schema · ✅ IMPLEMENTED (Jun-11)
**Labels:** `docs` `fusion` `priority:med`

**Problem**
The core confidence weighting is undocumented in the export, contrary to the suite's "auditable
weights" ethos.

**Evidence**
- `combineConf = min(0.97, 1 − Π(1−cᵢ))` (`integrator-dsp.js`), but `buildFusionExport.schema.doc`
  never mentions the formula, the cap, or the `toFixed(3)` rounding.

**Fix**
- Add the formula, cap, and rounding to `schema` (and to per-finding `conf` provenance).

**Acceptance**
- A reader can recompute any finding's `conf` from the documented formula + source confidences.

---

## R7 · Confidence encodes signal quality, not severity · ✅ IMPLEMENTED (Jun-11)
**Shipped.** Surge `conf` now scales to **CVHR/HR surge magnitude** (ECGDex `surgeConf(ampBpm)` =
`clamp(0.45+min(amp,24)/48, .45,.95)`; PpgDex mirrors it), and local signal quality rides alongside
as a **separate `sqi`** field on each event. The Integrator's noisy-OR consumes a quality-weighted
likelihood `effConf = conf × (sqi ?? 1)` (`integrator-dsp.js`), so a strong surge in a noisy patch
contributes less than a clean one; raw `conf`+`sqi`+`effConf` are kept in each finding's `sources[]`
for audit. Legacy exports (no `sqi`) fall back to ×1. ECGDex `sqiNote` updated. Verified: same surge
(conf 0.80) → finding **0.918 @ sqi 0.95 vs 0.769 @ sqi 0.40**; `surgeConf` monotone 0.59→0.95 across
ampBpm 6.6→24 (was flat 0.48–0.56). **Touches emitters — ECGDex/PpgDex exports re-bundled.**
**Labels:** `bug` `calibration` `priority:med`

**Problem**
Surge confidence reflects how clean the trace was, not how strong the event was — and that number
drives the noisy-OR.

**Evidence**
- `ecgdex-dsp.js` `gangliorEvents`: surge `conf = sqiAt(ev.sec)` — a 10-second-windowed signal-quality
  index (header: "conf = SQI"). A strong surge in a noisy patch scores lower than a weak one in a clean patch.
- `ppgdex-dsp.js`: surge conf hard-coded `0.65`; `hrv_drop` 0.7; ECGDex stage events fixed `0.70`.
- OxyDex synth (`adaptOxyDex`): `0.45+min(depth,12)/24`, `0.4+min(rise,40)/80` — scales with severity
  but uncalibrated.
- **Fixture proof:** ECGDex `quality.meanSQI 0.521` with `sqiNote: "…→ also Ganglior conf"`; the
  export's surge confs sit at 0.48–0.56, i.e. they *are* the SQI band, not event strength.

**Fix**
- Emit two separate axes per impulse: `conf` (severity-calibrated event likelihood) and `sqi` (quality).
- Fusion drives the noisy-OR from `conf`, down-weighting by `sqi` — not conflating them.
- Calibrate `conf` against any labeled events.

**Acceptance**
- Holding SQI fixed, a stronger surge yields higher `conf`; noisy-OR outputs track event likelihood.

---

## R8 · Cross-node metric-name collision (`sdnn`, etc.) · ✅ IMPLEMENTED (Jun-11)
**Shipped.** Consensus normalizes all nodes to **whole-record** HRV before comparing (ECGDex →
`wholeRecordSDNN/RMSSD`; epoch variants kept as `sdnnEpochMedian`/`sdnnIndex`), tags every source +
block with `hrvWindow`/`units`, and `fuseHRVConsensus` compares same-window only. Emitter `windowNote`
added to ECGDex + PpgDex. Verified: ECGDex×PpgDex SDNN divergence fell from a spurious **42%
"divergent"** to a true **20% "agreement"**. Re-bundled Integrator + ECGDex + PpgDex.
**Labels:** `bug` `schema` `priority:med`

**Problem**
One key name denotes different windows across nodes and is compared directly.

**Evidence**
- `adaptEnvelopeNode` fills `summary.sdnn` from `hrv.time.sdnn` for both ECGDex and PulseDex though
  they mean different windows; `fuseHRVConsensus` compares `summary.sdnn` across nodes directly.

**Fix**
- Window-qualify keys (`sdnnEpochMedian` / `sdnnIndex` / `sdnnWholeRecord`); tag every HRV/frequency
  field with `window` + `units`; compare like-window only.

**Acceptance**
- Consensus only pairs metrics of the same window; mismatched windows are flagged, not silently compared.

---

## R9 · Single-signal sleep stages contradict each other
**Labels:** `bug` `node` `priority:med`

**Problem**
ECGDex and OxyDex emit minute-precise stage durations that flatly disagree (ECG REM ~10 min vs OxyDex
REM ~330 min), presented as if measured.

**Evidence**
- Same Jun-10 night: ECGDex `sleep.stageMinutes.REM = 10` (Light 315, Deep 5, Wake 25) vs OxyDex
  `newMetrics.stageProxy.remProxyMin = 330` (77.5 %). A 33× disagreement on one night.

**Fix**
- Label single-signal stages as estimates with explicit CIs.
- Have the Integrator surface the disagreement rather than letting two dashboards assert different truths.

**Acceptance**
- Stage outputs carry CIs; a cross-node stage disagreement raises a QC flag in the fusion view.

---

## R10 · Upstream RR/PPI artifact contaminates min/max
**Labels:** `bug` `node` `priority:low`

**Problem**
The first beat after sensor contact (474 ms, row 1) pollutes `minRR` / `maxHR`.

**Evidence**
- `ecgdex_computed_RR_2026-06-10.txt` row 1 = `2026-06-10T21:15:37.011;474`; the export's
  `hrv.time.minRR = 474` (≈127 bpm instantaneous) survived correction despite an HR floor of 44–47.

**Fix**
- Drop the first RR/PPI after contact; gate min/max on physiological plausibility (node-side).

**Acceptance**
- `minRR`/`maxHR` are stable to removal of the first post-contact beat; implausible extremes rejected.

---

## R11 · False morphology precision + QRS ceiling
**Labels:** `bug` `node` `priority:low`

**Problem**
Morphology is reported to 1 ms at 130 Hz (~7.7 ms/sample), and `qrsDur=123` contradicts
`medianQRS=62` while pinning at 123 (looks clamped).

**Evidence**
- ECGDex `morphology.intervals.qrsDur 123` vs `morphology.ectopy.medianQRSWidthMs 62`; `qtcTrend`
  shows qrsDur climbing 62→85→115→123 then **pinned at 123** for most later windows — a ceiling.
- `sampleRateHz 130` ⇒ 7.69 ms/sample, yet `qt 403` / `qtcBazett 364` / `pr 162` are to 1 ms.

**Fix**
- Round QT/QTc/QRS to the sample grid; add a precision caveat (clinical QT wants ≥250 Hz).
- Investigate the 123 clamp once the generating code is in hand.

**Acceptance**
- Morphology values fall on the sample grid with a stated precision; the 123 pin is explained or fixed.

---

# Fix Brief 2026-06-11 (Round 2) — node + Integrator defects · ✅ ALL IMPLEMENTED

Six-ticket brief from a second review thread, actioned against the user-edited Jun-10 exports.
(T2/T3/T6 overlap the older R9/R10/R11 node-side items — now closed.)

### T1 · ECGDex QRS-width 16-sample ceiling — HIGH · ✅
Root cause: `delineate` used `qWin = round(0.06×130) = 8` samples with "outermost departure in
window" offset detection → every wide-ish beat pegged at R±8 = 16 samples = **123 ms** (14/24 windows
modal at 123). **Fix** (`ecgdex-morph.js`): rewrote QRS onset/offset to **return-to-baseline**
(sustained, ±120 ms search) + a `qrsSaturated` flag on each beat/window. `intervals.qrsDur` is now the
validated **beat-template energy median** (== `ectopy.medianQRSWidthMs`); the delineation value +
`qrsSaturatedWindowFraction` ride alongside (`ecgdex-app.js`). Unit-tested: injected 60/90/120/150 ms
QRS → measured 62/92/123/154 ms (±1 sample, no ceiling, no saturation).

### T2 · Implausible / un-reconciled sleep staging — MEDIUM · ✅
ECGDex sleep export now carries `method`, `confidence:'low'`, and a `plausibility` flag (REM/Deep
out-of-norm bounds). Integrator gained **`fuseStagingConsensus`** → emits a `staging_disagreement`
finding when single-signal REM fractions differ >20 pts. Verified Jun-10: ECG REM 3% vs OxyDex 77.5%
→ 75-pt gap flagged.

### T3 · First-beat startup artifact pollutes min/extremes — LOW–MED · ✅
`buildNN` looped from `k=1`, never gating beat 0 → the 474 ms sensor-contact beat survived into
`minRR`. **Fix** (`ecgdex-dsp.js`): evaluate `k=0` with the same range + relative-plausibility
(>20% local-median) gate. Unit-tested: rr[0]=474 → corrected to ~1207; min(nn) 474 → 1191.

### T4 · Stale `toleranceSec` — LOW · ✅
Removed the misleading top-level `toleranceSec:120` from the export; replaced with a truthful
`matchWindow:{leadMaxSec:15, trailMaxSec:60, directionalWindowSec:75, unionPrefilterSec:120}`
(`integrator-dsp.js`), fed from the actual matcher gate. Render text updated.

### T5 · PulseDex can't join fusion (no timestamp) — MEDIUM · ✅
PulseDex RR content lacked a timestamp → `t0Ms:null` → silently excluded. **Fix**
(`pulsedex-app.js`): derive the anchor from the **filename** (`YYYYMMDD[_-]HHMMSS` → floating ms,
Clock Contract) when content has none; record `t0Source`; surface `dateWarning` if still undated.

### T6 · Precision / hygiene — LOW · ✅
- **QT/QTc precision:** ECGDex `intervals` now states `sampleGridMs` (7.69 ms @130 Hz) + a ±1-sample
  `precisionNote` (clinical QT wants ≥250 Hz).
- **GlucoDex GMI/estA1c:** already disambiguated in-export (`glycemic.labels`/`formulas`) — left as-is.
- **GlucoDex `fusion:null`:** replaced with `{available:false, note:…}` so it no longer implies missing
  computation.
- **Low meanSQI:** ECGDex `quality.meanSQICaveat` surfaces when meanSQI <0.6 (Jun-10 = 0.521).

**Bundled:** ECGDex, PulseDex, GlucoDex, Integrator. Integrator-side (T2/T4) verified against the live
Jun-10 exports; ECGDex DSP (T1/T3) unit-tested with synthetic inputs (raw-signal regeneration needed
for full end-to-end numbers).
