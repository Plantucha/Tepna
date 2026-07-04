<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Integrator Fusion — Reconstruction reconciled against source

> Reconstructed the Ganglior fusion algorithm from node event-logs + timestamps, then reconciled
> against the **live `integrator-dsp.js`** (it's in-repo). Reading the source **closed both of my
> open questions and overturned one earlier finding** (flagged ⚠️). Every claim is tagged
> **CONFIRMED** (matches source/output), **CORRECTED** (source overturned my inference), or
> **OPEN** (needs a file not in repo). References are to function names in `integrator-dsp.js`.

---

## 0. Bottom line

- The headline rule is exactly what reconstruction recovered: `confirmed_apnea_event =
  spo2_desaturation ⟷ autonomic_surge`, **noisy-OR** confidence, **±120 s**.
- ⚠️ **Provenance claim RETRACTED.** With the real fixture in hand, the export **reproduces exactly
  from current source** — `confirmedApneaIndex 0.17` (= 1/5.807 h, `toFixed(2)`), `conf 0.815`
  (noisy-OR of 0.63, 0.50), `overlapMin 1115` (sum of pairwise), desat `conf 0.63` (synth formula),
  surge `conf 0.48–0.56` (≈ ECG `meanSQI 0.521`). My earlier "unreproducible 3-decimal AHI" was an
  artifact of a hand-rounded `0.171`; the file says `0.17`. R1 downgraded to a hygiene item (no
  `buildHash`/checksums *stamped*, but the numbers do reproduce). See §5.
- Two real algorithm bugs survive in current source: **PpgDex is silently excluded from every
  fusion rule** (node-name registration gap → **R2**) and the headline **`window.overlapMin`
  double-counts pairwise overlaps** while the AHI path quietly uses a *different, correct* union
  (→ **R3**).
- **Two different apnea matchers exist in the suite** — OxyDex's own ±90 s `oxyComputeFusion` and the
  Integrator's ±120 s `fuseApneaEvents` — so the same night yields contradictory "confirmed apnea"
  numbers (→ **R4**).
- Two design gaps stand: **no directionality / null-model gate** on the apnea match (**R5**, now
  ✅ implemented) and an **undocumented noisy-OR + uncalibrated confidences** (**R6/R7**).

---

## 0a. Validation against the real fixtures (Jun 10 night)

Every structural finding is now confirmed with the actual files — only R1's premise was wrong:

| Claim | Fixture evidence | Verdict |
|---|---|---|
| Noisy-OR conf | finding `conf 0.815` = 1−(1−.63)(1−.5) | ✅ reproduces |
| AHI = union hours | `0.17` = 1 / ((min(ECG.end,Oxy.end)−max starts)/3.6e6 = 5.807 h) | ✅ reproduces |
| `overlapMin` double-counts | `1115` = 348.4 (ECG∩Oxy) + 351.5 (ECG∩Ppg) + 415.1 (Oxy∩Ppg); true 4-node ∩ = 0 | ✅ R3 |
| PpgDex dropped | `nodes[]` has PpgDex `nEvents:81`, but finding uses only Oxy+ECG; its surges aren't even in `unmatched.surge` | ✅ R2 |
| Directionality | the *only* confirmed event has `latencySec −96` → surge 96 s **before** the desat | ✅ R5 |
| Null model | 25 ECG surges over 5.8 h, 2 desats, ±120 s ⇒ ~0.57 expected by chance vs 1 observed | ✅ R5 |
| conf = SQI | ECG `meanSQI 0.521`, `sqiNote: "…→ also Ganglior conf"`; surge confs 0.48–0.56 | ✅ R7 |
| desat conf severity-blind *(retracted)* | depths 4.4→0.633, 4.2→0.625 both `toFixed(2)`→`0.63` | ✅ corrected |
| Stage contradiction | ECG REM **10 min** (`stageMinutes`) vs OxyDex REM **330 min** (`stageProxy`) | ✅ R9 |
| RR artifact | RR row 1 = **474 ms** (21:15:37) → `hrv.time.minRR 474`, survived correction | ✅ R10 |
| QRS clamp | `qrsDur 123` vs `medianQRSWidthMs 62`; `qtcTrend` climbs 62→85→115→123 then pins at 123 | ✅ R11 |

OxyDex ran the **synthesis fallback** (`hr_spikes.count:0`, no native `ganglior_events`) → 2 synth
desats only; that's why `nEvents:2`. So the synth conf path was definitively live for this fixture.

---

## 1. Confirmed algorithm (`fuseApneaEvents` + helpers)

### Match — CONFIRMED, both prior unknowns resolved
- Eligibility = the **merged union of every OxyDex×ECGDex pairwise overlap interval** (not the sum of
  pairwise; a single Oxy night overlapping two ECG recordings is counted once). The union is widened
  by ±`dtMs` (`inUnion`).
- Pool is **de-duplicated** by `impulse@round(tMs/1000)` (`gather`) so the same event seen via two ECG
  recordings can't enter twice.
- **Matcher:** each desat → **nearest *unused* surge within ±dtMs**; a global `usedSurge` Set ⇒
  **one surge confirms at most one desat.** This answers both questions I'd flagged as OPEN:
  - *nearest vs. max-conf surge?* → **nearest** (`dd<bd`). **CONFIRMED.**
  - *one surge → many desats?* → **no**, deduped. **CONFIRMED.**
  - New note: matching is **greedy in desat-time order**, not a global optimal assignment — an early
    desat can claim a surge that fit a later desat better. Minor; folded into R4.
- Surge types accepted: `autonomic_surge`, `autonomic_arousal`, `cvhr_surge`.

### Confidence — CONFIRMED
`combineConf = min(0.97, 1 − Π(1−cᵢ))` rounded `toFixed(3)`. Reproduces `0.63 ⊕ 0.50 → 0.815` exactly.
Capped at 0.97; null-safe (skips null/non-finite inputs).

### Latency sign — CONFIRMED
`latencySec = (surge − desat)/1000` → **positive = surge *after* desat**, negative = surge precedes.
Matcher is symmetric (`Math.abs`), so a surge *before* the desat still confirms (see R4).

### Index — CORRECTED denominator precision
`confirmedAHI = nFindings / unionHours`, `toFixed(2)`.
⚠️ My reconstructed `1/5.86 h = 0.171` (3 dp) **cannot come from this build** — current source emits
`0.17`. The value is right; the **3-decimal precision is the tell that the analyzed export predates
current source** → evidence for R1, not an alternate denominator. (On one Oxy × one ECG night the
union *is* their single overlap interval, so "≈ECG window" was directionally fine.)

### The other three rules exist in source (dormant on the analyzed night because nodes didn't overlap)
- `labelPositionalApnea` — ECGDex ACC body-position lookup (±10 min) at each confirmed event; flags
  positional apnea on supine clustering (supine ≥3 and rate ≥0.7). Honest "ACC-derived, provisional".
- `fuseAutonomicGlycemic` + `glucoseMetricsInWindow` — windows the continuous CGM to each night's
  exact overlap (coverage-gated, compression cells `f===3` excluded); Pearson r over ≥3 nights else a
  single-pair directional estimate; returns null on no overlap (so GlucoDex's 66-days-off recording is
  correctly never fused).
- `fuseHRVConsensus` — RMSSD/SDNN/LF-HF agreement across overlapping `ECGDex/PulseDex/HRVDex`; flags
  >30 % divergence as a QC issue.

---

## 2. Earlier claims the source CORRECTED

- ⚠️ **"Desat conf is a severity-blind constant 0.63."** *False for this build.* `adaptOxyDex`
  synthesizes desat conf = `clamp(0.45 + min(depth,12)/24, 0.4, 0.95)`. Depths 4.4 → 0.633 and
  4.2 → 0.625, both `toFixed(2)` → **"0.63"**. Severity *does* flow in; the two samples merely
  collided at 2-dp. **Retracted as a bug.** Caveat: this is the **synthesis fallback**; if OxyDex's
  emit-shim populated `ganglior_events`, conf came from there and isn't visible here → R7 follow-up.
- ⚠️ **"4-node fusion is really 2-node."** Imprecise. The apnea *headline* is OxyDex×ECG by design,
  but the file ships **four** rules spanning ECG/Oxy/Gluco/Pulse/HRV. The export looked 2-node only
  because the other nodes didn't overlap that night.

---

## 3. Still OPEN (need files not in repo)

1. A **second overlapping night** — empirical coincidence baseline instead of the per-night Poisson
   estimate in §0a.

*(Resolved with the uploaded fixtures: the export reproduces from current source (§0a), the OxyDex
synth conf path was live, and the ECGDex emit-shim's `conf = SQI` is confirmed by `meanSQI 0.521`.)*

---

## 4. Remediation — ticketable, by severity

### R1 · No build/input stamping on exports (verifiability hygiene) — **low** *(downgraded)* · ✅ IMPLEMENTED (Jun-12)
**Shipped.** A shared, self-contained `ganglior-provenance.js` is loaded first in every app
(`OxyDex/ECGDex/PulseDex/GlucoDex/PpgDex/HRVDex/Integrator`). Every export now carries
`schema.provenance = { buildHash, generated, inputs[] }` (OxyDex's byte-compat single-night array
stamps each night record instead). `buildHash` = SHA-256[0:12] of the bundle's immutable
`__bundler/template` (identifies the code, not runtime DOM, and is stable across runs); `inputs[]` =
`{ name, bytes, lastModifiedMs(floating), sha256[0:16] }` for every file, captured via a **passive
`FileReader` hook** (no per-app ingest edits, no behaviour change). Node-version identity is captured
transitively — each dropped node-export the Integrator hashes embeds its own `nodeVersion`.
`verify-provenance.html` is the CI harness: it loads each bundle, reads the live `buildHash` (manifest
to commit), and audits every `uploads/*.json` fixture, flagging any whose stamped `buildHash` ≠ its
app's current hash (an export the code can no longer reproduce). Verified: 7/7 apps expose the helper
with distinct stable hashes (ECGDex `488b1266f060`), the hook fingerprints inputs, and the four
pre-R1 fixtures are correctly flagged "no provenance".

<details><summary>Original (pre-fix) note</summary>

**Retraction:** the analyzed export **does** reproduce from current source (see §0a) — my earlier
"unreproducible 3-dp AHI" was a misread of a hand-rounded `0.171` (the file says `0.17`). What
remains is weaker but still worth doing: the **fusion** export carries no `buildHash`, no input
SHA-256, and doesn't propagate node versions (the *node* exports do — ECGDex `nodeVersion 1.1`,
PpgDex `1.0`), so reproducibility is only confirmable by manual recomputation. **Fix:** propagate
node versions into the fusion export and stamp `buildHash` + per-input SHA-256; add CI that
regenerates the committed fixture and fails on diff.

</details>

### R2 · PpgDex is silently excluded from ALL fusion — **high** · ✅ IMPLEMENTED (Jun-11)
`detectNode` returns the literal `schema.node` ("PpgDex"), so its **events load** and appear on the
timeline — but **grey "Unknown"** (`NODE_COLORS` has no PpgDex), with an **empty summary**
(`adaptEnvelopeNode`'s summary branch handles only ECGDex/GlucoDex/PulseDex/HRVDex). Downstream:
`fuseApneaEvents` gathers surges from `_byNode('ECGDex')` only, and `fuseHRVConsensus` filters
`['ECGDex','PulseDex','HRVDex']` — **PpgDex reaches zero rules**. This is not academic: `ppgdex-dsp.js`
*does* emit `autonomic_surge` (conf fixed 0.65) and `hrv_drop` — valid corroborating impulses the
matcher would accept, dropped purely on node-name. **Fix:** register `PpgDex` in `NODE_COLORS`,
`detectNode`, the summary branch, and the consensus filter (or canonically alias PpgDex↔PulseDex
across the suite), and add a regression that every `nodes[]` entry resolves to a color + summary
adapter. *(Aside: the matcher's accepted list includes `cvhr_surge`, which **no node emits** —
ECGDex and PpgDex both emit `autonomic_surge` for CVHR — so that branch is dead; drop it or wire the
emitters to it.)*

### R3 · Two inconsistent "overlap" numbers in one file — **high** · ✅ IMPLEMENTED (Jun-11)
**Shipped.** `window.overlapMin` is now the **merged-union** minutes (via `_mergeMs`), not the sum of
pairwise overlaps. The export also carries `overlapUnionMin`, `intersectionMin` (N-way all-node),
`pairwiseSumMin` (the old number, retained for transparency), `spanMin`, and `nodesExcluded` (dated
nodes overlapping nothing). The hero card surfaces union + all-node intersection and names excluded
nodes. Verified on Jun-10: `overlapMin` **1115 → 418.3** (true union), `intersectionMin` 348.4,
`pairwiseSumMin` 1115 — the old figure exceeded the 429-min total span, the double-count in plain sight.

`runFusion` set `window.overlapMin = Σ pairwise overlap.overlapMin` (double-counts overlapping pairs,
**not** an N-way intersection), while `fuseApneaEvents` independently builds a correct **merged union**
for the AHI denominator. The headline number can badly overstate true simultaneity. **Fix:** report
the true union and/or N-way intersection consistently; never sum pairwise. Exclude zero-overlap nodes
(GlucoDex) from the headline window; surface them as historical/non-coincident.

### R4 · Two divergent apnea matchers in one suite — **high** · ✅ IMPLEMENTED (Jun-11)
Apnea is confirmed in **two places with different rules**, and they disagree:
| | OxyDex `oxyComputeFusion` (`oxydex-fusion.js`) | Integrator `fuseApneaEvents` |
|---|---|---|
| Window | **±90 s** (`WIN=90`) | **±120 s** (`dtMs`) |
| Output | `confirmed/desN` ratio + `confPct` | noisy-OR conf + AHI / union-hour |
| Surge dedup | none (nearest each desat) | global `usedSurge` Set |
| Surge types | `autonomic_surge` only | +`autonomic_arousal`,`cvhr_surge` |

Concrete contradiction: the reconstructed pair at **latency −96 s** *confirms* under the Integrator
(|−96| ≤ 120) but **fails** OxyDex's own ±90 s gate — the same night reads "confirmed apnea" on one
dashboard and "not confirmed" on the other. **Fix:** extract one shared matcher (window, dedup,
surge-type set, output metric) and have both surfaces call it; if OxyDex's in-app panel must stay
standalone, make it import the Integrator's parameters so the numbers can't drift.

### R5 · Apnea match has no directionality or null-model gate — **high** · ✅ IMPLEMENTED (Jun-11)
Fixed. Replaced the symmetric ±120 s match with an **asymmetric directional gate** (surge −15 s…+60 s
vs the nadir) and added a **Poisson null model** that stamps `belowChance` + `pSpurious` on findings,
sets `confirmedAHIReportable=false` and shows "below chance" in the KPI when chance isn't beaten.
Applied identically in `integrator-dsp.js` (`fuseApneaEvents`, params on `runFusion`) and OxyDex's
`oxyComputeFusion` (R4). Verified on Jun-10: the −96 s pair now yields **0 confirmed**.
Δt is symmetric ±120 s with no sign constraint, so a surge **before** a desat confirms an obstructive
event; and a single coincidence emits a finding. **Fix:** (a) tighten Δt (≤60 s) and gate on
`latencySec ≥ −T` (autonomic response should trail/coincide with the nadir); (b) per-night
Poisson/permutation chance-coincidence expectation, suppress findings below it; (c) require a minimum
confirmed count before publishing `confirmedApneaIndex`. Optionally replace greedy matching with a
global nearest-pair assignment.

### R6 · Document the noisy-OR + the 0.97 cap in the schema — **med** · ✅ IMPLEMENTED (Jun-11)
**Shipped.** Export `schema` bumped to 1.1 with a `method` block documenting: the noisy-OR
(`conf = 1 − ∏(1 − cᵢ)`, cap 0.97, 3-dp) and `effConf = conf × (sqi ?? 1)` (R7), the directional apnea
match (R5), the Poisson null model + reportability gate (R5), the union/intersection window geometry
(R3), and the whole-record HRV consensus (R8).

`combineConf` is the core weighting but `buildFusionExport.schema.doc` never stated it — at odds with
the suite's "auditable weights" ethos. **Fix:** write the formula, the cap, and the rounding into the
export schema.

### R7 · Confidence encodes signal quality, not severity — **med** · ✅ IMPLEMENTED (Jun-11)
**Shipped.** Surge `conf` now scales to surge magnitude (ECGDex `surgeConf(ampBpm)` =
`clamp(0.45+min(amp,24)/48,.45,.95)`, PpgDex mirrored); local signal quality is emitted **separately**
as `sqi`. Fusion's noisy-OR uses `effConf = conf × (sqi ?? 1)` so quality down-weights rather than
conflates likelihood; each finding's `sources[]` retains raw `conf`/`sqi`/`effConf` for audit. Verified:
same surge (conf 0.80) → finding **0.918 @ sqi 0.95 vs 0.769 @ sqi 0.40**; `surgeConf` monotone
0.59→0.95 across ampBpm 6.6→24 (was flat 0.48–0.56). Legacy `sqi`-less exports fall back to ×1.
Re-bundled ECGDex + PpgDex (emitters) and the Integrator. *Original confirmation below for reference.*

The ECGDex emitter set surge `conf = sqiAt(ev.sec)` — the 10-second-windowed **signal-quality
index** near the event (`ecgdex-dsp.js` `gangliorEvents`, header literally "conf = SQI"). So surge
confidence measures **how clean the trace was, not how strong the surge was** — a large CVHR surge in
a noisy patch scores *lower* than a weak one in a clean patch, and that orthogonal-to-severity number
feeds the noisy-OR directly. PpgDex is worse (surge conf hard-coded 0.65); stage events fixed 0.70.
The OxyDex synth maps (`0.45+depth/24`, `0.4+rise/80`) at least scale with severity but are
uncalibrated. **Fix:** separate two axes — emit `conf` (a calibrated event-likelihood from
magnitude/CVHR strength/depth) and a distinct `sqi`/quality field; let fusion down-weight by quality
but drive the noisy-OR from severity-calibrated likelihoods.

### R8 · Cross-node metric-name collision — **med** · ✅ IMPLEMENTED (Jun-11)
**Shipped.** The consensus now normalizes every node's HRV axis to **whole-record** before comparing
(`adaptEnvelopeNode`): ECGDex uses `wholeRecordSDNN`/`wholeRecordRMSSD` instead of its bare
display value (epoch-median on overnight recordings), and the epoch-scoped variants are carried under
explicit keys (`sdnnEpochMedian`, `sdnnIndex`, `rmssdEpochMedian`). Every source + consensus block is
tagged `hrvWindow`/`units`, and `fuseHRVConsensus` only compares same-window metrics. Emitter schemas
self-document via `windowNote` (ECGDex + PpgDex). Verified on Jun-10: the ECGDex×PpgDex SDNN
divergence dropped from a spurious **42% "divergent"** (47.3 epoch-median vs 72.4 whole-record) to a
true **20% "agreement"** (88.9 vs 72.4 whole-record) — the definitional mismatch no longer masquerades
as a data-quality flag. Re-bundled Integrator + ECGDex + PpgDex. *Original finding below.*

`summary.sdnn` is filled from `hrv.time.sdnn` for **both** ECGDex and PulseDex though they denote
different windows, and `fuseHRVConsensus` compares them **directly**. **Fix:** window-qualify keys
(`sdnnEpochMedian` / `sdnnIndex` / `sdnnWholeRecord`), tag every HRV/freq field with `window`+`units`,
compare like-window only.

### R9 · Single-signal sleep stages contradict each other — **med** *(node-side)*
ECGDex (REM ~10 min) vs OxyDex (REM ~330 min). **Fix:** label single-signal stages as estimates with
CIs; have the Integrator surface the disagreement rather than letting two dashboards assert different
truths.

### R10 · Upstream artifact contaminates min/max — **low** *(node-side)*
First RR/PPI after sensor contact (474 ms, row 1) pollutes `minRR`/`maxHR`. Drop the first beat after
contact; gate min/max on physiological plausibility.

### R11 · False morphology precision + QRS ceiling — **low** *(node-side)*
`qrsDur=123` contradicts `medianQRS=62` and pins at 123 (looks clamped). At 130 Hz (~7.7 ms/sample),
1-ms QT/QTc/QRS is false precision. Round to the sample grid; add a precision caveat (clinical QT
wants ≥250 Hz); investigate the 123 clamp once the generating code is in hand.

---

*Generated from reconstruction + reconciliation against in-repo source **and validated against the
uploaded Jun-10 fixtures** (`integrator_fusion`, `OxyDex`, `ECGDex`, `ppgdex`, computed-RR). Every
structural finding reproduces against the real data; R1's original "unreproducible" premise was
retracted (the export reproduces exactly). R2–R8 confirmed against source; R9–R11 node-side.*
