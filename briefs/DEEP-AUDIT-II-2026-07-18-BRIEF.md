<!--
  DEEP-AUDIT-II-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED — 2026-07-18 · **Created:** 2026-07-18 · **Executes:** `AUDIT-PROMPT.md` (the deep-audit charter) · **Follows:** `DEEP-AUDIT-2026-07-11-BRIEF.md` (DONE 2026-07-12, 21 findings) · **Sibling-axis:** `TEST-AUDIT-FINDINGS-2026-07-18-BRIEF.md` (gates that stay green) · `DEEP-SCOUT-HOLLOW-GATES-2026-07-18-BRIEF.md`

# Deep audit II — 64 correctness defects across the fleet

The second full-fleet execution of `AUDIT-PROMPT.md`, run 2026-07-18. Where `DEEP-AUDIT-2026-07-11`
found 21, this found **64 after dedup**, concentrated in the surfaces the first pass and the
mutation work did not reach: **node-side fusion, the orchestrators, worker realms, cross-night
statistics, and the newest node**.

## How it was run (so the coverage claim is checkable)

- **Baseline established green first**, per the charter: `node tests/run-tests.mjs` 2976 assertions /
  194 groups; `node tests/verify-manifest.mjs` GATE A 9/9, GATE B 25/25. No finding #1.
- **16 concurrent invariant hunters** — the charter's 10 bug classes, plus 6 end-to-end node traces
  (OxyDex · ECGDex/PulseDex · GlucoDex · CPAPDex · PpgDex/HRVDex · MotionDex+Integrator).
- **Every finding faced 3 independent adversarial refuters** with distinct lenses (does the
  reproduction actually reproduce · is it out-of-scope or already-tracked · steelman the current
  code), each instructed to default to *refuted* under uncertainty. Majority-refuted findings died.
- **A completeness wave** then asked what the method itself had structurally missed (untouched
  modules · defect shapes falling *between* the ten classes · claims resting on reading rather than
  execution), and 14 gap hunters ran against the named blind spots.
- **Method was invariant-first**, per the charter — state an invariant, hunt counterexamples;
  differential, metamorphic and adversarial-input reasoning. Findings were established by executing
  the real modules in `node:vm` realms, not by reading code.
- **Provenance of the line numbers.** The run was launched at `9029f86`, but 88 commits landed on
  `main` during it and this checkout is shared — the hunters read the working tree as it advanced, so
  the audit effectively covers **current `main` (`8588908`)**. This was confirmed, not assumed: all 13
  §7/§8 findings were re-verified line-by-line against `8588908`, **13/13 still present, 0 fixed**, and
  two of them (7.1, 7.7) *arrive with* commit `9697bd3` — inside the 88 — which the hunters could only
  have seen post-merge. Line numbers here align with current `main`; only 7.5's shifted (by 2).
- **The six commits touching the changed files in that range are feature additions, not fixes**
  (`9697bd3` effort series · `4fabb59`/`668253a` apnea typing · `32bf5e0` positional OSA ·
  `3e9792f` motion-gated HRV · `dba3ae7` respiration fusion). Two *introduced* audited defects. The one
  genuine fix in the range — `3e9792f`'s actigraphy coverage correction — is the contrast case that
  makes 7.4 (`bodyPosition`, never given the same treatment) indefensible.

## Severity vocabulary

| Tag | Meaning |
|---|---|
| **W** | Mis-states a surfaced number — the worst outcome in this domain |
| **A** | Fabricates absence or presence (an absent input rendered as a measurement) |
| **S** | Silent failure (data dropped or corrupted, headline still green) |
| **C** | Contract / provenance drift |
| **R** | Robustness / hardening |
| **(latent)** | Mechanism proven by execution, but no shipped-corpus input currently triggers it |

## ⚠️ The structural finding — read before touching any item

**Six defects survived because a gate asserted the wrong thing, and three of those gates would RED on
the correct fix.** Several punch-list items are therefore blocked by a test that is itself the bug:

| Gate | What it actually asserts |
|---|---|
| `tests/dex-tests.js:11381` | a source-regex pinning `d_welfare`'s **buggy text** — green through the bug, reds on the fix |
| `:7156` | labelled "any hypo ON the rail", actually asserts **ALL** — reds on the fix |
| `:14677` | pins `vo2Category`'s **drift** as "the ACSM band" — reds on the fix |
| `:14174` | source regex for a warning message that never reaches a user |
| `:12578` | passes the host explicitly, **bypassing** the path that fails in production |
| `:11386` | asserts a gate *exists*, not that it covers its factors |

Add four surfaces with **zero** behavioural coverage — `oxyComputeFusion`, `CpapCoimport`,
`WORKER_SRC`'s parse body, MotionDex's entire registry — and one feature untested **by construction**:
every crossNight test feeds a **uniform weight vector**, so coverage-weighting has never been
exercised, which alone explains four Tier-1 findings.

`TEST-AUDIT-FINDINGS-2026-07-18` closed 40 hollow gates in the shared suite. **These are a second
generation of the same species**, clustering exactly where the first pass did not reach. **Replace the
six hollow gates with both-direction-verified assertions before touching the code they guard.**

**Four DONE briefs assert more coverage than shipped** (e.g. `AUDIT-FOLLOWUPS-II §4` records the
HRVDex persistence quota as done — the warning is dead code; `DEEP-AUDIT §1` stamped the DMY file-lock
EXECUTED with 2 of 5 sites threaded). A dedicated **"does the DONE stamp match the code?"** pass is the
single highest-value follow-up this audit suggests.

---

# Findings by node

## 1 · HRVDex — `hrvdex-dsp.js` (11 defects, one root pattern)

A composite's presence gate validates *some* of the values it consumes; JS coerces the ungated `null`
to `0` (or passes it through `>= 0`), so an absent column becomes a confident measurement. The file
*knows* the rule — `_hasSubj` / `_hasLfHf` / `_hasNu` exist for exactly this — these sites never got it.

| § | Defect | Sev |
|---|---|---|
| 1.1 | `d_sd1 = r._rmssd / Math.sqrt(2)` **ungated** (`:507`) — `null/√2 === 0`, so SD1 renders 0.0 ms as a measurement and SD2 collapses to `sdnn·√2`. `d_dfa_proxy` then passes its `!isNaN` gate → **DFA α1~ 1.000 coloured GREEN** on a record with no vagal data. Committed repro: `ECGDex_2026-06-27_equiv.node-export.json` | **A** |
| 1.2 | `d_otr` gate is `r._pnn50 >= 0` (`:574`) — **`null >= 0` is `true`** in JS. Absent pNN50 → `100/0.01` → clamp → **OTR 500, red band, `d_otr_sat`**. Sibling `d_pns_eff:571` got this right with `>= 1` | **W** |
| 1.3 | `computeCAMQ` scores an absent parasympathetic input as a measured 0 — CAMQ 58 instead of 88; reachable from shipping emitters (`integrator-app.js:518`, `cohort-worker.js:224`) | **A** |
| 1.4 | `d_crs` / `d_pti` gate the subjective inputs, not the factors multiplied | **A** |
| 1.5 | `d_nn50` / `d_rmssd_circ` — fabricated 0 carrying a physical unit | **A** |
| 1.6 | `d_hfnu` / `d_lfnu` — the gate validates only the denominator | **A** |
| 1.7 | `d_abs` saturates to exactly ±1.000 on partial absence | **A** (latent) |
| 1.8 | four ratio metrics gate one operand and read the absent other as zero | **A** |
| 1.9 | `d_welfare` — denominator omitted from the presence gate | **W** (latent) |
| 1.10 | DMY file-lock never threaded into `_hrvParseSummaryRows` — `DEEP-AUDIT §1` stamped EXECUTED with 2 of 5 sites done | **C → latent W** |
| 1.11 | `persistHRVRows`' storage-failure warning is always overwritten — "✅ Added 30 measurements" over a truncated mirror | **S** |

## 2 · OxyDex — `oxydex-dsp.js`

| § | Defect | Sev |
|---|---|---|
| 2.1 | **SBII counts artifact desaturations ODI-4 already rejected** — `computeSBII` re-runs `detectDesatEvents` itself and never reads `desat.events`. Up to 6.5×; 3 of 11 nights change quintile. Do **not** touch the `durationHr` denominator (ratified) | **W** |
| 2.2 | `computeDesSev` uses `dropPct: 1, minSec: 0` and integrates half the night — **classifier saturated at "bad" on 37/37 nights**, the "good" band unreachable; also inflates exported `ahiKulkas` to 10× the sibling `ahiODI4` | **W** |
| 2.3 | `dataGaps.gapPct` (`:4060`) divides gap **seconds** by a **sample count** — 33.4 % for a true 25 %, unbounded above 100 %. Only looks right because the O2Ring samples at 1 Hz. **It is rendered**, via the generic auto-walk in `oxydex-fusion.js` (a literal grep misses the site) | **W** |

## 3 · PulseDex / ECGDex / PpgDex — shared spectral + beat detection

| § | Defect | Sev |
|---|---|---|
| 3.1 | **Lomb–Scargle Parseval calibration folds OUT-OF-BAND variance into VLF/LF/HF** — `sc = tp > 0 ? variance / tp : 1` with `tp` accumulated over 0.003–0.4 Hz only. Every ms² band power one-directionally inflated: +10 % on clean RR, ~5× at fast respiration, ~11× at Nyquist alternans — on a **`validated`** metric graded against literature thresholds. **Fleet-wide, 3 nodes.** `audits/DEX-DSP-AUDIT-FREQ-HRV.md` prescribed the current form and must be corrected too | **W** |
| 3.2 | **PpgDex ACF cadence locks onto the sub-harmonic — HR silently HALVED** at ≥60 bpm with pulsus alternans, every quality channel reading perfect. Latent (corpus is 52 bpm), high consequence. `detectBeats` is driven against a known beat count by **nothing** today | **W** |
| 3.3 | PulseDex `artifactClean`'s local median is contaminated by the artifacts it is correcting — rMSSD **+58 %**, and the recording reads *healthier*; corrected beats remain below the function's own floor. Corrupts whole-record export values. **One line; all 3 committed fixtures verified byte-identical under the fix** | **W** (latent) |
| 3.4 | HRV triangular index graded against a **24-h Holter** threshold on any-duration recording — bad→ok purely on recording length, on a `validated` mortality metric. **Three call sites incl. a hero KPI** (`pulsedex-overview.js:472`) | **W** |
| 3.5 | PulseDex export mixes analysis scales inside `hrv.time` — `lnRMSSD` is epoch-median while its siblings are whole-record, with no `windowNote` | **C** |

## 4 · ECGDex

| § | Defect | Sev |
|---|---|---|
| 4.1 | **QT/QTc silently pinned to the median-beat window edge** (`ecgdex-morph.js:527`) — **492/469 ms in a committed export**, false-reassuring across a clinical threshold; the `unstable` flag is **inverted**, so the export tells consumers to discard the good windows | **W** |
| 4.2 | `rec.gaps` is parsed and then discarded — `coveragePct 100` claimed, events time-shifted | **A** (mostly latent) |
| 4.3 | **`parseECG` infers fs from a SINGLE ms delta** — real-corpus part-files parse at 143/167 Hz for a 130 Hz stream: duration −22 %, rMSSD −22 %, HR ×1.28. **THREE mirrored sites must move in lockstep** (`ecgdex-dsp.js:3140`, `ecgdex-app.js:67` WORKER_SRC, `:219`). Median **plus** a stamp cross-check — median alone would not have caught the shipped 10 % error | **W** |
| 4.4 | Streaming worker: a mid-stream read error **DUPLICATES the already-parsed prefix** — rMSSD +11 %, triIdx crosses the normal cutoff, `coveragePct 100`; persistent failure hangs silently. **Nothing in any gate has ever executed `WORKER_SRC`'s parse body** | **S** |
| 4.5 | `hrvStability` admits a 3-epoch trailing group as a full 30-min window. Real-corpus effect immaterial; the useful half is surfacing each window's epoch count `n` | **R** |

## 5 · GlucoDex

| § | Defect | Sev |
|---|---|---|
| 5.1 | Silent truncation of a CGM record at 200 000 grid cells — the **silence** is the defect and is unconditional | **W** (latent on 5-min corpus) |
| 5.2 | Unbounded `Math.max(...xs)` spread in `detectSessions` overflows the stack. Land with 5.1 — fixing the cap alone converts a silent truncation into a crash | **R** |
| 5.3 | **"Largest drift" KPI is 18× overstated in mmol/L mode** — a KPI contradicting the table directly beneath it. Two characters | **W** |
| 5.4 | Every nocturnal hypo on a clipped export stamped `clampFloor` and halved in fusion — **32 of 37 real hypos** down-weighted ×0.5. A documented regression: inert when written, live since `DEEP-AUDIT §6` | **S** |
| 5.5 | `parseNutrition`: no DMY lock, and **date-only exports silently drop EVERY row** (the likelier real defect) | **R** (narrowed) |

## 6 · CPAPDex

| § | Defect | Sev |
|---|---|---|
| 6.1 | **`pressureChangePoints` mis-states before/delta and DROPS real steps** when a series has ≥2 changes — self-contradicting export (`cp[0].after ≠ cp[1].before`), a `before` value that was never a setting, and **appending later nights erases an earlier change point**. `PEN_K` must be re-tuned | **W** |
| 6.2 | ODI rated over total therapy span, not oximeter-analyzable time — up to 2× understated, and the field is literally named `analyzedHours`. The OxyDex §5 precedent already ratified the fix | **W** (latent) |
| 6.3 | `CpapCoimport` corroboration is **all-pairs, not a matching** — one surge corroborates five apneas (100 % from 1) | **W** |
| 6.4 | `CpapCoimport._hmsToMs` has **no start anchor** (rolls only against `prevMs`) — a t-only overnight ECG lands **24 h early**, rendering a confident "0 %" | **A** |

## 7 · MotionDex

Re-verified line-by-line against `8588908`: **9/9 still present, 0 fixed.**

| § | Defect | Sev |
|---|---|---|
| 7.1 | **Effort epochs indexed by SAMPLE NUMBER, not wall-clock** (`motiondex-dsp.js:333`) — `lo2 = e·EFFORT_CAD_SEC·hz` is a sample index while `tEp = t0Ms + e·EFFORT_CAD_SEC·1000` is uniform wall-clock; the two diverge on any gap or off-nominal rate, and `present:null` fires only on `hi2−lo2 < 3`. **Apnea typing comes out INVERTED.** Must be fixed together with 7.2 | **W** |
| 7.2 | Per-stream `relNs` treated as seconds-from-`t0Ms` (`:140` `relSecOf` returns `r.relNs/1e9` unconditionally; `relNs` is per-stream from `ns0` at `:129`, against a single global `t0Ms` at `:423`) — chest track time-shifted | **W** |
| 7.3 | Respiratory rate divided by the **LONGEST** stream's duration (`:321` over `durSec = Math.max(durationOf(…))` at `:427`) — halved by a longer wrist file. Second injection site at `:291` | **W** |
| 7.4 | `supineFrac` denominator counts epochs where the accelerometer was not recording — `dwell.unknown++` (`:203`) then `/nE` (`:213`). **`actigraphy` was given exactly this fix** in `3e9792f` (`seen`/`covered`, `:242-276`); `bodyPosition` never was — the in-repo contrast makes this indefensible | **W** |
| 7.5 | Signal quality measured on the **CHEST** stream (`:432` `motionSQI(posSrc, …)`) while actigraphy is computed from the **WRIST** (`:430`) — and the comment at `:424` disagrees with the code | **S** |
| 7.6 | `recording.durSec` emitted (`motiondex-dsp.js:540`); the Integrator's declared-end chain reads `endEpochMs / durationMin / durationSec` and **never `durSec`** (`integrator-dsp.js:258`) — all-node overlap reads 40 min for 480 | **W** |
| 7.7 | The effort-**PRESENT percentage** rendered under the "Effort amplitude" label and badge (`motiondex-render.js:162`, directly below the genuine amplitude row at `:161`). **The fix cannot be a pure relabel** — `motiondex-registry.js` has no `effortPresentFrac` entry, so renaming alone trips 7.8's fail-open path and the number ships unbadged | mislabelled |
| 7.8 | MotionDex's badge helper is the **only one in the fleet that fails OPEN** (`motiondex-render.js:46`, `badgeForLabel(label, false)`), and its registry is loaded by **neither** runner | **R** (latent) |
| 7.9 | `toG` tests `unit === 'mg'` case-sensitively — a `[mG]` header would yield 1000× motion metrics | **R** (latent — no producer emits it) |

## 8 · Integrator

Re-verified against `8588908` — this cluster moved most during the audit.

| § | Defect | Sev |
|---|---|---|
| 8.1 | **Every event in ECGDex/PpgDex/PulseDex multi-record exports is silently dropped** (`integrator-dsp.js:921`) — findings 2→0 with **zero warnings**, while longitudinal trends still render (confirming "the file loaded"). The `:918` comment's "generically" means *any node*, not *any carrier key*: the guard is still `Array.isArray(json.nights) && json.schema.multiNight`, but `ecgdex-app.js:2655` emits `multiRecording`+`recordings[]`, `ppgdex-app.js:1006` emits `multiSession`+`sessions[]`, `pulsedex-app.js:1208` emits `multiRecording`+`recordings[]` — **none sets `multiNight`, none uses `nights[]`**. All three fall through to `adaptEnvelopeNode`. Also surface `validateNodeExport`'s warnings (a one-line independent mitigation) and correct `EVENT-LEXICON §6.6` | **A** |
| 8.2 | `reconstructEventTMs` can only roll ONE day (`integrator-dsp.js:57`, fixed anchor `prevTMs: t0Ms`). **Do NOT thread `prevTMs` naively** — the current stateless roll is order-independent and exact under 24 h. Prefer documenting *why*, plus an explicit "day unknown" for >24 h t-only envelopes | **C** (latent) |
| 8.3 | Integrator counts long-gap interpolation as measured glucose — `if (win[i].f === 3) continue;` (`integrator-dsp.js:1627`) has no `f === 4` arm, and `coverage = win.length/expected` (`:1633`) counts interpolated cells. Node says TIR 0 %, Integrator says 11.6 %, and `coverage` self-reports 1.00 so the `minCoverage` gate is blind. The Integrator uses the **numeric literal**, never the name — `FLAG.GAP_LONG = 4` lives only in `glucodex-dsp.js:298`. `glucodex-app.js:1838`'s comment and `cellsNote:1843` are stale too | **W** |
| 8.4 | Longitudinal trend footer renders the **recording COUNT** with a `d` suffix (`integrator-longitudinal.js:673`) — "over 12d" for a 90-day span, always in the alarming direction | mis-stated label |

## 9 · Cross-night — the five `*-cross.js` clones

**Every crossNight test feeds a uniform weight vector**, so the entire coverage-weighting feature is
untested by construction. That single gap explains 9.1–9.4.

| § | Defect | Sev |
|---|---|---|
| 9.1 | **CV% divides an UNWEIGHTED sd by a coverage-WEIGHTED mean** (`oxydex-cross.js:157` `const m = wmean(vals, w), s = sd(vals)`) — 74.6 % vs 49.8 % on routine CPAP partial-use. A documented spec breach (`CROSSNIGHT-ENVELOPE-SPEC.md:157`) | **W** |
| 9.2 | Personal-baseline z unweighted while the displayed mean is weighted — a 6 %-coverage night masks a real −2.4σ event. Spec breach (`:97`) | **W** |
| 9.3 | `trendLabel` takes DIRECTION from OLS but SIGNIFICANCE from Mann–Kendall — reads "improving" beside τ −0.6 on 10.3 % of endpoint-outlier series | **W** |
| 9.4 | `slopePerDay` silently becomes slope-per-**RECORDING** when any item is undated — 7× overstatement, still labelled `/d`. `t0Ms === null` is a first-class Contract-mandated state | **W** |
| 9.5 | `bootstrapDeltaCI`'s LCG overflows 2^53 — CI ~1 % narrow, borderline "95 % CI excludes 0" verdicts flip, entropy collapses at n ≥ 18. Also `event-coupling.js:447` | **R** |

## 10 · Orchestrators, ingest, companion pairing

| § | Defect | Sev |
|---|---|---|
| 10.1 | **OverDex / Data Unifier cannot compute ECG, PPG or CGM** — the host shim is never booted; every such file silently excluded while the pill reads green "fused N recordings", and the error message blames a co-load that is present | **S** |
| 10.2 | `pickNearestByStamp` has **no max-distance guard** — a 5-day-old sidecar renders a green "98.3 % Agreement"; a foreign ACC silently changes which beats survive into the HRV numbers | **W** |
| 10.3 | An unparseable stamp scores as epoch 0 (`(candidates[i].stampMs \|\| 0)`) — absence ranked as the **WORST** evidence | **S** |
| 10.4 | ECGDex multi-night drop: `DEVICE_RR/HR/ACC` are single globals — "✓ Self-RR validated" off another night's beats; a wrong-night ACC **rewrites exported `ev.meta.position`** | **W** |

## 11 · Node-side fusion — `oxydex-fusion.js` (three defects, one call chain, currently ungated)

| § | Defect | Sev |
|---|---|---|
| 11.1 | "Confirmed apnea %" counts desats the paired ECG never recorded as **misses** — `confPct` deflated | **W** |
| 11.2 | `oxyEcgForNight` pairs an ECG that **never overlaps** the night, then renders a green "0 confirmed" | **A** |
| 11.3 | Hypoxic dose/event divides a whole-night burden by an ECG-window-only count — 3.7× inflation on an irrelevant variable | **W** |

## 12 · Spine, provenance gates, analysis kernels

| § | Defect | Sev |
|---|---|---|
| 12.1 | `computeHash`'s closure excludes `*dex-profile.js`, which **reaches `compute()`** — `verifiedUnder` on corpus-backed fixtures cannot expire after a legitimate profile change. The denylist that was supposed to fail closed has a hole | **C** (downgraded) |
| 12.2 | `gateBEvaluate` reports a fixture with **NO `outputHash`** as `reproducible` — the one fail-**open** path in a function whose every sibling fails closed. Mirror the fix in `tests/reconcile-provenance.mjs`. **Also verify `computeHashFromText` is actually live** — `run-tests.mjs:320` currently SKIPs it silently | **R** (latent) |
| 12.3 | `clock.js` accepts out-of-range date/time components and rolls them. Route as a **contract amendment + code**, not a bug. **Do not add an `h > 23` guard** — it breaks ISO `24:00:00` | **R** (contract gap) |
| 12.4 | `analysis-stats.js roc().auc` mis-handles ties — order-dependent AUC that falsifies `hrv-confound-analysis.js:30-31`'s own order-invariance comment, made **run-to-run nondeterministic** by worker completion order | **W** (papers layer) |

## 13 · Profile layer — `dex-profile.js` / `oxydex-profile.js`

| § | Defect | Sev |
|---|---|---|
| 13.1 | **`vo2Category` fabricates an ACSM citation** — it is a ratio heuristic against `vo2Norm`, a full band off, giving two answers on one page | **W** |
| 13.2 | `vo2Norm` plateaus at 65 with no chip and no disclosure | **W** |
| 13.3 | OxyDex profile elevation copy says "sea level" while thresholds have already moved; the corrective `pd_elev` disclosure is **dead code targeting a non-existent DOM id** | mis-stated |
| 13.4 | `_clampAge` admits `n >= 6` (ages 6–17) | **R** |

---

# PRIORITIZED PUNCH-LIST

Correctness first. **One gated change at a time** (`CLAUDE.md` §👥.3). Each item is sized by
*re-bundles · fixture movement · gates*.

> ⚠️ Every "fixtures hold" below is a **prediction to compute**, never a claim — this audit was
> read-only and ran no build or regen tool. Per `CLAUDE.md` §🔏, export-inertness is a **computed
> value** (`computeHash`), not an assertion.

## Tier 0 — mis-states a number a user reads today, on the real corpus

| # | Item | § | Size |
|---|---|---|---|
| 1 | **OxyDex `computeDesSev` saturates on 37/37 nights** — reconcile all three classifiers + the reference doc | 2.2 | 1 bundle · **fixtures MOVE (all 3, every night)** · regen + verify-fixtures + both browser gates |
| 2 | **OxyDex SBII counts artifact desats** — up to 6.5×; do **not** touch `durationHr` | 2.1 | 1 bundle · **fixtures MOVE (2)** |
| 3 | **ECGDex QT/QTc pinned to the window edge**; `unstable` flag inverted | 4.1 | 2 files, 1 bundle · fixtures hold · **must ship with a NEW assertion — no GATE-C leg covers delineation** · MINOR |
| 4 | **HRVDex absent-column family** — 11 sites, one edit. **Replace the two hollow gates** (`:11381`, `:11386`) | 1.1–1.9 | 1 bundle (+2 orchestrators) · outputs should hold — **prove it** |
| 5 | **ECGDex `parseECG` single-delta fs** — **THREE mirrored sites in lockstep**; median **plus** stamp cross-check | 4.3 | 1 bundle · **land with #6** |
| 6 | **ECGDex discards parsed sample gaps** | 4.2 | rides #5's bundle |
| 7 | **Integrator drops multi-record events** — also surface `validateNodeExport` warnings | 8.1 | 1 bundle · `historical:true` fixtures don't move |
| 8 | **GlucoDex "Largest drift" 18× in mmol/L** — two characters | 5.3 | 1 bundle |
| 9 | **Integrator counts gap interpolation as measured glucose** — add the `f === 4` arm at `integrator-dsp.js:1627` and exclude interpolated cells from `coverage`. **Land the Integrator edit alone first**; the `cellsNote` doc fix is separate and more expensive. Gate with the **committed** Lingo-gap twin | 8.3 | 1 bundle · fixtures hold |
| 10 | **`oxydex-fusion` coverage trilogy** — all three ungated today | 11.1–11.3 | 1 bundle · **first-ever gate on this function** |

## Tier 1 — mis-states a number under an input the corpus can produce

| # | Item | § | Size |
|---|---|---|---|
| 11 | **Lomb–Scargle Parseval calibration** — **the single largest blast radius in this report**; correct `audits/DEX-DSP-AUDIT-FREQ-HRV.md` too | 3.1 | **3 bundles, one unit** · **ALL fixtures for 3 nodes MOVE** · commit an adversarial twin · loud CHANGELOG |
| 12 | **Cross-night estimator trilogy** — all five clones together; two are documented spec breaches | 9.1–9.3 | **5 bundles** · **mandatory new non-uniform-weight gate — the feature is untested** |
| 13 | **`slopePerDay` becomes slope-per-recording** when any item is undated | 9.4 | rides #12 |
| 14 | **MotionDex timing + coverage cluster** — **7.1 and 7.2 must be fixed together** (either alone leaves the apnea-typing fabrication in place). Mirror `3e9792f`'s actigraphy `seen`/`covered` fix onto `bodyPosition` for 7.4 | 7.1–7.6 | 1 bundle · **7.6 moves export bytes; write `tools/regen-motiondex-goldens.mjs` FIRST (none exists)** · land `MOTIONDEX-BUILD-FOLLOWUPS §4`'s differentiated twin in the SAME change or nothing gates the fix |
| 15 | **CPAPDex `pressureChangePoints`** — `PEN_K` must be re-tuned | 6.1 | 1 bundle · 3-regime + append-invariance gates, verified RED first |
| 16 | **CPAPDex ODI over therapy span** — commit a probe-off SA2 twin | 6.2 | 1 bundle · MINOR (additive `spanHours`) |
| 17 | **`CpapCoimport` all-pairs + no start anchor** — land together | 6.3, 6.4 | 1 bundle · **first behavioural gate on `CpapCoimport`** |
| 18 | **Companion pairing: no max-distance guard + `\|\|0` on a null stamp** | 10.2, 10.3 | **2 bundles** (ECGDex + PpgDex) |
| 19 | **ECGDex multi-night `DEVICE_*` globals** | 10.4 | app-only leg provably export-inert; other legs move `computeHash` |
| 20 | **PulseDex triangular index vs 24-h Holter norms** — three call sites incl. a hero KPI | 3.4 | 3 bundles |
| 21 | **PulseDex `artifactClean` median contamination** — one line; **fixtures proven unmoved** | 3.3 | 1 bundle · no regeneration owed |
| 22 | **PpgDex ACF sub-harmonic — HR halved** | 3.2 | 1 bundle |
| 23 | **GlucoDex 200 000-cell truncation + `Math.max(...)` overflow** — land together | 5.1, 5.2 | 1 bundle · **commit an over-cap CSV twin (CI has no `uploads/`)** |
| 24 | **GlucoDex blanket `clampFloor`** — gate `:7156` is hollow **and reds on the correct fix** | 5.4 | 1 bundle · **fixture MOVES** |
| 25 | **`analysis-stats roc()` tie handling** — gate with the `roc ≡ mannWhitneyAUC` identity | 12.4 | **No app bundle** · `tools/build-analysis.mjs` only · **cheapest correctness fix here** |
| 26 | **Profile layer: fabricated ACSM citation, `vo2Norm` plateau, `_clampAge`** — single-source onto OxyDex's table; **update the test that locks the drift in** | 13.1, 13.2, 13.4 | **shared spine — all 8 bundles, SERIALIZE** · `computeHash` is **blind here** → verify-fixtures by hand |
| 27 | **OxyDex `gapPct` seconds ÷ sample count** | 2.3 | 1 bundle · cheapest riding #1 or #2 |

## Tier 2 — silent failure / fabricated absence, no wrong number on screen

| # | Item | § | Size |
|---|---|---|---|
| 28 | **OverDex / Data Unifier cannot compute ECG, PPG, CGM** — **close the hollow gate `:12578` first** | 10.1 | 2 orchestrator bundles (out of GATE A) · `--check` |
| 29 | **ECGDex worker duplicates the parsed prefix** — **closes the last shadow realm** | 4.4 | `-app.js` only → provably export-inert (compute it) |
| 30 | **HRVDex storage-failure warning is dead code** — also correct `AUDIT-FOLLOWUPS-II §4`'s false DONE stamp | 1.11 | 1 bundle |
| 31 | **Integrator longitudinal footer renders count with a `d` suffix** | 8.4 | render-only, 1 bundle |

## Tier 3 — provenance / contract / robustness

| # | Item | § | Size |
|---|---|---|---|
| 32 | **`gateBEvaluate` grades a missing `outputHash` as reproducible** — mirror in `tests/reconcile-provenance.mjs`; verify `computeHashFromText` is live | 12.2 | **No re-bundle, no fixtures** · trivial |
| 33 | **`computeHash` closure excludes `*dex-profile.js`** — fail closed or add a containment guard. **Best landed WITH #26** | 12.1 | No re-bundle · `computeHash` moves for 5 bundles → corpus re-verification in the same unit |
| 34 | **DMY file-lock never threaded** into `hrvdex-dsp.js:100`, `pulsedex-overview.js:82`, `integrator-dsp.js:794`. **DO NOT flip `preferDMY` to false** — `CLAUDE.md` §3 wins; mirror `oxydex-dsp.js:555` verbatim | 1.10 | 1–3 bundles · outputs hold (corpus inputs are ISO) |
| 35 | **MotionDex badge helper fails OPEN + zero gate coverage** — goes live the moment 7.7's label is added | 7.7, 7.8 | 1 bundle (**`-registry.js` IS compute-closure — `computeHash` moves**) |
| 36 | **PulseDex export mixes analysis scales in `hrv.time`** — follow the ECGDex precedent | 3.5 | 1 bundle · **fixtures MOVE** · MINOR |
| 37 | **`clock.js` out-of-range component rolling** — contract amendment. **Ride the next shared-spine change**; if taken, land **BEFORE #34** | 12.3 | **shared spine — all 10 bundles, SERIALIZE** |
| 38 | **Cross-night bootstrap LCG overflows 2^53** — **land LAST in §9**, the only item there that moves committed bytes | 9.5 | 5+ bundles · **every crossNight fixture with n ≥ 7 MOVES** |
| 39 | **`hrvStability` short trailing group** — the useful half is surfacing each window's epoch count `n` | 4.5 | ride another ECGDex re-bundle |
| 40 | **`parseNutrition`: no DMY lock; date-only exports drop EVERY row** | 5.5 | 1 bundle |
| 41 | **MotionDex `toG` fail-open unit handling** | 7.9 | ride #14 |
| 42 | **`reconstructEventTMs` single-day roll** — prefer documenting *why* + an explicit "day unknown" | 8.2 | doc + optional 1 bundle |
| 43 | **OxyDex profile elevation copy + dead `pd_elev` disclosure** | 13.3 | render-only |

## Cheapest-first, if you want early wins

**#25** (no app bundle at all) → **#32** (no bundle, no fixtures) → **#8** (two characters) →
**#21** (one line, fixtures proven unmoved) → **#27** (rides another re-bundle).

## Sequencing constraints worth honouring

- **#5 + #6** share the ECGDex parse/timing seam — one re-bundle instead of two.
- **#14's 7.1 + 7.2** are **not** independent: fixing either alone leaves the apnea-typing fabrication in place.
- **#23**'s two halves must land together, or a silent truncation becomes a crash.
- **#33** is cheapest landed **with #26**; **#37** is cheapest landed **before #34**.
- **#38 LAST** within §9 — the only cross-night item that moves committed bytes.
- **#11** and **#37** are the two "announce before you start" items (multi-node / spine serialization).
- **The six hollow gates come before the code they guard** (see the structural finding above).

---

# What this audit did NOT cover

Stated plainly so the green areas are not mistaken for verified ones.

**Not exercised at all**
- **The browser lane.** `Dex-Test-Suite.html?full`, `verify-provenance.html` and every render-coverage
  rig were never opened; all 64 findings were established headlessly in `node:vm`. Any defect living
  **only** in DOM painting, event wiring, iframe boot or CSS is outside this audit — including whether
  the render-layer fixes proposed here actually paint correctly.
- **`capture-host/` (Python).** Untouched. The mutation audit (PR #163, 44 %) and its open gaps
  (`clockcfg` 8 %, `writers` 49 %) remain the live record there.
- **EEGDex** (no implementation yet) and the `licensing/`, `docs/COMPLIANCE/`, `papers/` layers.
- **`tools/release.mjs`, `tools/build.mjs`, `tools/build-core.js` and the changeset machinery** as
  *systems* — no build or regen tool was run (read-only mandate), and **the gate-cost predictions in
  this brief were not verified**.
- **Concurrency / storage lifecycle** beyond §1.11 — IndexedDB, `dex-forget.js`, `entrance-guard.js`,
  multi-tab behaviour.
- **Security, privacy, the no-network invariant** — `no-network.html` was not re-run.
- **Adversarial/malformed binary inputs** — EDF header fuzzing beyond one synthetic probe-off case.

**Covered thinly**
- **OverDex / Data Unifier** — only the emit seam (§10.1).
- **The Integrator's core fusion arithmetic** — the noisy-OR posterior, `effConf`, the Poisson null
  models and the event-coupling surrogate machinery were read but not driven adversarially.
  §§8.1–8.4 are all *ingest and presentation* defects; **the fusion math itself is essentially unaudited.**
- **Cross-night beyond the five statistics in §9** — `mannKendall`, `ols`, `quantile` and the
  envelope's `headline` ranking were not independently verified.
- **GlucoDex's AGP/MODD/CONGA/GRADE estimators** — the grid, sessions and event stamping were audited,
  not the estimators.
- **`docs/` and `briefs/` as a corpus** — only the specific stale statements the findings landed on
  were corrected.

---

# Done when

- Each punch-list item is either **executed** (its own gated change, one at a time, with the gates
  named in its Size column re-run green) or carries an **explicit park reason** in this brief.
- The **six hollow gates** are replaced with both-direction-verified assertions **before** the code
  they guard is modified.
- Each executed item lands with the gate that would have caught it — per `TEST-AUDIT-FINDINGS`, a fix
  without a both-direction-verified gate is half a fix.
- A follow-up brief captures the residue (house `-FOLLOWUPS` pattern), including the **"does the DONE
  stamp match the code?"** pass this audit recommends and the coverage gaps listed above.
