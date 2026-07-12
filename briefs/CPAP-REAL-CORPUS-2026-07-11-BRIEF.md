<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-12 (P1 · P2 · P3 · P4 · P5 · P6 · P9 all executed) · **Created:** 2026-07-11 · **Corpus:** ~180 real CPAP nights (6 months), 39 paired with O2Ring, 17 quad-modal · **Related:** `CPAPDEX-PHASE9-FOLLOWUPS-*-BRIEF.md`, `INTEGRATOR-BUILD-BRIEF.md` · **Spawned:** `TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md` (executes §P6)

# CPAP real corpus — what a whole SD card exposed, and what the data still owes us

> **What this is.** The first time an *entire* ResMed SD card was driven through CPAPDex. Every node in
> the fleet has been exercised on real data except CPAPDex, whose equivalence gate is **synthetic-only**
> by explicit admission in `FIXTURE-PROVENANCE.json`. Running ~180 real nights through
> `CPAPDex.compute()` found **six code defects that synthetic fixtures structurally cannot find**, and
> surfaced a data asset (a quad-modal 17-night overlap + two dated device-setting changes) that unblocks
> work the `PAPERS-ROADMAP` currently lists as blocked-on-reference.
>
> ### 🔒 Scope — this brief is CODE ONLY, on purpose
> The corpus is a real person's therapy record and **this repo is public**. So this brief carries only
> *code facts* (what the DSP computes, what the export drops, what the gates miss) and *method facts*
> (estimator design, null models, correlation structure). **No clinical values, no per-night indices, no
> therapy narrative** — those live in a **local, gitignored** log (`uploads/` is ignored by
> `.gitignore:16`) and must stay there. Raw recordings are likewise never committed. If you extend this
> brief, hold that line: a finding earns its place here only if it changes the **software**.

---

## 1 · The assets

| id | asset | why it matters |
|---|---|---|
| **A1** | **~180 CPAP nights** — 1139 EDF files, ~486 MB, 222 sessions, ~6 months (day-foldered SD-card layout) | ~60× the 2-night real-EDF fixture set. The first corpus large enough to expose threshold/heuristic bugs. |
| **A2** | **39 nights CPAP ∩ O2Ring**, ~6.6 h mean overlap | First real cross-node event↔event join in the fleet. |
| **A3** | **17 nights CPAP ∩ ECG (H10) ∩ PPG (Verity) ∩ O2Ring** — `uploads/trio/` ∩ the CPAP tree | **Quad-modal.** Four independent devices, one night, one clock. See §4 P6 — this is the valuable one. |
| **A4** | **Two dated device-setting step-changes**, each landing on a single identifiable night and holding thereafter | A **labelled change-point dataset** — ground truth for testing `CPAPCross` trend/change detection, which today only ever runs on synthetic nights with `sd: 0` and a `'stable'` label. |

A1–A2 are personal recordings and stay out of git. A3's node-exports are already committed under
`!uploads/trio/**`.

---

## 2 · Code defects (none findable with synthetic fixtures)

### F1 — the ventilation lane never reaches the bus ✅ **FIXED 2026-07-12 (P1)**

> **Executed.** The export now carries **30** metrics (was 15). Note the diagnosis below was
> *mis-attributed*: `cpapBuildExport` does **not** filter — it does `metrics: night.metrics`, passing
> straight through. The drop was upstream in **`nightMetrics()`**, which aggregated only 15 of the 32
> session metrics and never pooled the ventilation lanes at all. Fixed by carrying the mask-on slices
> in `_pool` and pooling them exactly as pressure/leak are pooled. Thresholds and rounding mirror
> `buildSessionFromEdf`, so a single-session night reads **identically** at both levels — verified
> 15/15 on a real EDF night. All 15 were **already graded in `CPAP_REGISTRY`** (rendered per session,
> never aggregated), so no registry or badge work was needed. Fixtures regenerated; both `contentId`s
> unchanged. See `changes/2026-07-12-cpapdex-ventilation-lane.md`.

`buildSessionFromEdf` computes 32 metrics. `cpapBuildExport` emits **15**. The 17 dropped, and whether
they carry real data:

| dropped | populated | |
|---|---|---|
| `respRateMedian` `respRateRange` `tidVolMedian` `minVentMedian` `minVentStability` `breathCount` `breathRate` `ieRatio` | **176/180 nights** | the **whole ventilation lane** |
| `flowLimMean` `flowLimitedPct` `snorePct` `snorePressureCorr` | **168–176/180** | the **flow-limitation + snore lane** |
| `eprDelta` `maskOnLatency` `maxLeak` | **176–180/180** | |
| `compliancePct` `mode` | 0/180 (by design — longitudinal / string) | |

**15 of 17 carry real data on ≥168 of 180 nights, and none reach the `ganglior` bus.** The Integrator
cannot see a single CPAP ventilation variable.

This is not cosmetic. **§3 M2 shows the dropped lane holds the strongest predictor of nightly event
burden anywhere in the corpus** — tidal volume, detrended r ≈ 0.5 (t ≈ 8) — while the pressure and leak
fields that *are* exported sit at r ≈ 0.16–0.26. **We export the weak predictors and drop the strong one.**

*Fix:* additive fields on `cpapBuildExport` → **MINOR** bump (backwards-compatible, per §📦). Regenerate
the CPAP fixtures (output moves). Add the new metrics to `CPAP_REGISTRY` with evidence badges (the
ventilation ones are device-*measured*; `snorePressureCorr` is derived → lower tier).

### F2 — the `mode` heuristic is noise on real data ✅ **FIXED 2026-07-12 (P4)**

> **Executed — and the diagnosis below understates it. The threshold was not badly chosen; it was
> measuring the wrong thing.**
>
> The raw IQR of delivered pressure is dominated by **EPR**, not by auto-titration. EPR drops pressure
> **1–3 cmH₂O on every EXPIRATION**, and PLD samples at 0.5 Hz — fast enough to catch those dips (the
> DSP's own `epapCh` comment already said so: *"on a fixed-CPAP machine with no EPR this equals
> delivered pressure"*). So a **fixed-pressure CPAP with EPR=3 shows a raw IQR > 1.0 and was labelled
> "APAP"**. No constant can fix that — the statistic does not contain the signal. That is why the cut
> landed inside the distribution, and why the label flipped 57×.
>
> The fix separates the two by **timescale**, which is what actually distinguishes them — EPR modulates
> within a *breath* (~4 s), auto-titration drifts over *minutes*. `mode` is now called on the IQR of a
> **per-5-min P90 pressure envelope** (P90 steps *over* the expiratory dips instead of averaging through
> them), so it is EPR-immune by construction. Two further guards, both required by this §:
>
> - **A dead-band. It refuses to guess.** Between the thresholds the answer is **`null`** — a visible
>   "don't know", not a coin-flip. The 27% of nights sitting on the old cut are exactly these.
> - **A night-level stability guard.** A night is labelled only if **every session made a call and they
>   all agree**. Previously the *first* session's label named the whole night (`s0.mode`). On the real
>   06-12 fixture this now correctly reports `mode: null` — its two sessions do not agree.
>
> **Both user-facing surfaces that shipped the old rule are gone**: the `mode` chip (now `unknown` when
> indeterminate), and — worse — a subtitle that stated the discredited rule to the user as fact,
> *"Auto-titration spread (>1 ⇒ APAP)"*. The registry's `cite` said the same and was corrected. New
> `pressureEnvIqr` metric (registered, `measured`) surfaces the quantity the call is actually made on,
> so a consumer can see *why* a night is CPAP/APAP/null instead of trusting a bare label.
>
> ⚠️ **Honest limit — the cut points are NOT calibrated against the corpus.** They are set from physiology
> (a fixed machine's minute-scale envelope is flat; an auto-titrating one wanders by cmH₂O) and agree with
> every fixture (real nights **1.2** and **2.2**, synthetic EDF **1.08**, a fixed machine **~0**) — but the
> ~180-night corpus is not in this repo, so they have not been *fitted* to it. **The dead-band is what makes
> that safe**: a night the thresholds cannot separate reads "unknown", never a wrong device setting.
> Calibrating them (and reporting how many nights land indeterminate) is carried in
> `CPAP-REAL-CORPUS-FOLLOWUPS-2026-07-12-BRIEF.md` §1.

### F2 (as diagnosed)

`cpapdex-dsp.js:506` — `mode = pressIqr > 1.0 ? 'APAP' : 'CPAP'`. Across ~180 real nights the label
**flips 57 times**, and **27% of nights sit within ±0.2 cmH₂O of the 1.0 cut** — the threshold lands
*inside* the distribution, not outside it. It reads as a device setting and is not one. Synthetic nights
have a clean IQR, so the suite never sees this.

*Fix:* retire it, add hysteresis, or derive it honestly — with F1 exporting `eprDelta`, a real
CPAP-vs-APAP call is available from `pressureRange` + `eprDelta` together rather than a bare IQR cut.
**Do not surface a per-night mode label without a stability guard.**

### F3 — CPAPDex's synthetic-only equivalence gate ✅ **FIXED 2026-07-12 (P2)**

> **Executed — and it exposed something far worse than F3.** The binary-EDF leg now runs
> (`✓ CPAPDex (binary EDF).compute() ≡ committed export — byte-identical`), driving the full chain the
> `_synthEdfSet` golden skips: `readEDF` → `buildSessionFromEdf` → `buildNight` → `cpapBuildExport`.
> The input is a **committed, synthetic** five-file EDF set (`tools/make-synthetic-edf.mjs`) — see **M5**
> for the discovery that made that the only viable route, and for why it matters far beyond CPAPDex.
> Also closes **F6**. See `changes/2026-07-12-cpapdex-binary-edf-equiv-gate.md`.

### F3 (as diagnosed) — the stated blocker is FALSE

`FIXTURE-PROVENANCE.json` states:

> *"CPAPDex can't join the Phase-9 'compute() ≡ committed export' equivalence gate (its real input is a
> BINARY multi-file EDF set, not a `{text}`/CSV)"*

So CPAPDex is the **only** node whose GATE-C leg is synthetic (`_synthEdfSet` → golden). Its two
real-EDF fixtures are byte-pinned but **never re-run**.

**Disproved.** `fs.readFileSync` → `ArrayBuffer` → `CpapEdf.readEDF` → `CPAPDex.compute({edfSets})` runs
headless in a Node vm realm over binary multi-file EDF — demonstrated on **222 sessions**, and now
shipped as `tools/cpap-corpus.mjs`. A real-data equivalence leg is buildable today.

> ### ⛔ **P2 BLOCKER — the raw EDFs carry a DEVICE IDENTIFIER. Do not commit them as-is.**
>
> The EDF+ header's `recording` field (bytes 88–168) has the shape:
> ```
> Startdate DD-MMM-YYYY X X X SRN=<device serial> MID=<n> VID=<n>
>                             ^^^^^^^^^^^^^^^^^^^ identical across every file
> ```
> The literal value is deliberately **not reproduced here** — this brief is a public artifact. Read it
> off a local file if you need it.
>
> A persistent hardware identifier that links every night in the corpus. Git history is permanent and
> indexable even after deletion. It also contradicts the suite's own posture: `EXPORT-IDENTITY` makes
> `contentId` *"identity-free (source is a generic device family, **no serial**)"*.
>
> **Required before P2 commits any EDF:** scrub the header to `X`s. The identifier sits in bytes 88–168 —
> away from the start date/time (168–184) and the signal records — so `compute()` output is **unchanged**;
> only `inputHashes` move, and a fixture-only re-record needs **no re-bundle** (§🔏). Check the `patient`
> field (bytes 8–88) in the same pass.
>
> **Cheaper alternative:** *synthesize* an EDF set calibrated to the corpus's distributions. Gets a genuine
> **binary-EDF** equivalence leg with no real recording published at all. Probably the right call.

### F4 — no ResMed ingest adapter ✅ **FIXED 2026-07-12 (P3)**

> **Executed.** `adapters/resmed-edf.js` is registered like the other eight (all 6 lists: `dex-coload.js`,
> both orchestrator `.src.html`, `Dex-Test-Suite.html`, `run-tests.mjs`, `tsconfig.json`). CPAP was the
> fleet's **only adapter-less signal type**, on the premise that *"EDF is binary + multi-file, so there is
> NO text-stream adapter"* — but that premise only rules out a **text** adapter. The adapter takes its
> bytes off the **established `ctx` escape hatch** (`ctx.buffers` / `ctx.edfSets`) and ignores the `text`
> arg — the same hatch `oxydex-spo2` already uses for `ctx.parseCSV` and `polar-h10-ecg` for
> `ctx.companions`. The stale "no adapter" prose in `signal-spec.js` is corrected.
>
> **The §F4 rule is now gate-backed both ways**, which is the point of promoting it: the test asserts that
> both EVE files survive grouping **and** that the naive ±60 s-only rule *provably drops one*. So a future
> "simplification" back to the naive cluster reds instead of silently under-counting events again.
>
> Orchestrator-only re-bundle (Data Unifier / OverDex are **non-provenance**): **no `manifestHash` moved,
> no fixture regenerated.**

### F4 (as diagnosed)

`adapters/` holds 8 vendor adapters (Polar ×3, Coospo, Wahoo, Libre, Welltory, OxyDex-SpO₂) and **none
for CPAP**. The SD-card tree → `edfSets` grouping had to be hand-rolled. The non-obvious rule:

> cluster files whose stamps are within ±60 s of the set's anchor, **and a SECOND file of a type opens a
> NEW set.**

Without that second clause, **8 sessions silently lose an `EVE` file** — a brief mask-off/on inside one
minute writes a second CSL/EVE pair, and a naive ±60 s cluster overwrites the first and under-counts
events. The rule now lives in `tools/cpap-corpus.mjs`; *fix* is to promote it to `adapters/resmed-edf.js`
and register it like the others.

### F5 — `buildLongitudinal` silently returns `crossNight: null` in any Node realm ✅ **FIXED 2026-07-12 (rode P1)**

> **Executed — and the root cause was deeper than the diagnosis below.** Mirroring line 34 was *not*
> sufficient: `cpapdex-cross.js` was a **browser-only IIFE** (`})(window)`) that exposed nothing to
> CommonJS, so `require()`ing it **threw** (`window is not defined`) and the caller swallowed that into
> a null. Real fix: make the module **dual-realm** like its siblings (`module.exports` + `globalThis`
> fallback + a side-effect `require` of the already-dual-realm `kernel-constants.js` for its bare
> `DexKernel` reads; `CrossNightEnvelope` stays optional behind its existing guard), *then* resolve it
> browser-global-first / CommonJS-second in `cpapdex-dsp.js`.
>
> It also exposed a **second, pre-existing bug**: the DSP self-test's unguarded `root.CPAPCross` read
> threw outright under CommonJS, so **`node cpapdex-dsp.js --selftest` had never once completed**. It is
> now an unconditional assertion — **49 passed, 0 failed**, headless.

**Root cause: inconsistent dependency resolution.** `cpapdex-dsp.js` resolves its two external deps two
different ways:

```js
:34   var EDF = (typeof require !== 'undefined') ? require('./cpapdex-edf.js') : (root && root.CpapEdf);
:227  var crossNight = (root && root.CPAPCross && root.CPAPCross.crossNightBlock) ? … : null;
```

The EDF dep has a **Node fallback**; `CPAPCross` is resolved **only** through the browser global `root`
(= `window`). So under a plain CommonJS `require()`, `root` is `null` → `crossNight` is `null`. **Proven**
(identical inputs): `require()` realm → `null`; a realm with `CPAPCross` co-loaded →
`{schema, window, metrics, series, headline}`.

The bug is not the null — it is that it is **silent**. A headless Node consumer gets a quietly degraded
longitudinal block with no error and no warning.

*Fix:* mirror line 34 —
`var CROSS = (typeof require !== 'undefined') ? require('./cpapdex-cross.js') : (root && root.CPAPCross);`
(resolve lazily at the call site to dodge load-order/circularity). **Source change → CPAPDex re-bundles →
`manifestHash` moves**, so this rides P1's bundle pass rather than a standalone one. `tools/cpap-corpus.mjs`
documents the co-load requirement meanwhile.

### F6 — the SA2 oximetry lane has zero real coverage ✅ **FIXED 2026-07-12 (rode P2)**

> The synthetic EDF set ships a working SpO₂ channel with genuine desaturations, so the lane finally
> runs on a gated input: `available:true`, ODI 1.6, nadir 87.1%, 4 desats, self-gate active. Real data
> could never cover it — the oximeter was simply never connected.

### F6 (as diagnosed)

**217/222** sessions report `oximeter-not-connected`; 5 report `no-spo2-channel`. Every SA2 file parses;
none carries SpO₂. The self-gated desat lane (`selfGateDesat` / `detectDesats` / `oximetryLane`) has
therefore **never run on real data**. Either wire a real oximeter to the device, or state plainly that the
lane is synthetic-only.

---

## 3 · Method findings (what changes how we compute, not what any person's numbers are)

### M1 — a shuffled-null baseline is mandatory for cross-node event coupling

Testing whether node A's events precede node B's events **requires a chance baseline**, because two
frequent event streams co-occur by construction. Circular time-shift surrogates (displace every A event by
±5–15 min) preserve both marginal rates and destroy only the alignment, isolating true coupling.

On the real corpus this **inverted the naive conclusion**: the *dominant* event class (n=688) showed a lift
of **×0.6–1.0** — i.e. exactly chance — at every window from 0–30 s through 0–120 s, while a *rare* class
(n=39) showed **×3.3–10**. Without the null model, the dominant class's raw co-occurrence rate looks like a
finding. It is not one.

The decisive refinement: **stratify by event duration.** Long events must couple if they are real; the
longest bucket (n=42) came back at **lift ×0.0**. Duration stratification is what turns "no signal" into
"provably no signal", and belongs in the primitive.

→ **P5.**

### M2 — the strongest predictor in the corpus is in the dropped lane

Detrended (residuals after removing the shared night-index trend, so this is not drift):

| predictor | detrended r | |
|---|---|---|
| `tidVolMedian` *(dropped)* | **≈ 0.51** (t≈8.0) | strongest in the corpus |
| `minVentStability` *(dropped)* | ≈ 0.50 (t≈7.7) | ⚠ **probably circular** |
| `minVentMedian` *(dropped)* | ≈ 0.28 (t≈3.8) | |
| `medianPressure` *(exported)* | ≈ 0.16 | |
| `largeLeakPct` *(exported)* | ≈ 0.16 | |

**Two honest caveats, both load-bearing:**
- **Not class-specific.** Tidal volume predicts both event classes about equally, so it is an *event-burden*
  correlate — **not** the clean mechanism it first resembled. Do not oversell it.
- **`minVentStability` is probably circular** — an event *is* a gap in ventilation, so events inflate the
  very instability metric that appears to predict them. `tidVolMedian` is a median over thousands of breaths
  and is not obviously circular; it is the one to trust.

Either way, the best predictor in six months of data is a field the bus never sees → **F1**.

### M3 — a plausible mechanism failed its corroborating channel (discipline note)

An association can be statistically bulletproof and still have the wrong mechanism attached. In this corpus
a strong, permutation-verified association (**p ≈ 0.005**, and a competing detection-artifact explanation was
tested and **refuted** separately) came with an obvious causal story — which the machine's *own* corroborating
channel then **contradicted**, moving the opposite way and correlating at **r ≈ 0.00**.

Lesson for the suite: when we ship a causal claim, check whether the node already measures the *precursor* of
the proposed mechanism, and require it to agree. We had the channel and were not using it (**F1** again).

### M5 — the fleet's equivalence gate did not run in CI ✅ **FIXED 2026-07-12 (P9)**

> **Executed.** Every node now has a **committed, synthetic, vendor-format input**
> (`tools/make-synthetic-inputs.mjs`) — format reproduced exactly, data never. All six legs now run:
> `✓ OxyDex / PulseDex / HRVDex / GlucoDex / PpgDex / ECGDex [synthetic].compute() ≡ committed export —
> byte-identical`. Equivalence group **17 → 38** assertions; GATE B **4 → 10** content-addressed
> fixtures. The synthetic twins are derived from the real cases programmatically (same node, same
> run/pick/fixPick), so they cannot drift from what they mirror, and they **add to** the real-recording
> legs rather than replace them. See `changes/2026-07-12-synthetic-equiv-inputs-ci.md`.
>
> **Honest limit:** this makes the gate *execute*; it does not strengthen what it asserts. ECGDex's and
> PpgDex's exports are event-only and their real fixtures also carry zero events, so those two legs pin
> `recording.contentId` (a content-fold of the parsed samples — it does catch parser/DSP drift) rather
> than a rich metric surface. Provoking real events in those two inputs would strengthen them further.

### M5 (as found, during P2)

The single most important finding in this brief, and it was found by accident.

**All eight** `compute() ≡ committed export` legs **skip on any fresh clone** — i.e. in CI:

```
⊘ OxyDex / PulseDex / HRVDex / GlucoDex / PpgDex / ECGDex / HRVDex(events) / PulseDex(events)
  "committed input absent — uploads/ is gitignored (personal data); this leg runs locally with uploads/ present"
```

Every node's equivalence input is a **real recording**, so it is gitignored, so **CI never executes the
diff**. The gate CLAUDE.md §🔏 leans on to catch "a code change that moved a fixture's output" — the
GATE-C surface, the thing that closes the loop GATE B cannot — has been running **only on the
maintainer's machine**. A regression that moved an export sails through CI green.

The fix is the one P2 stumbled into: **an input that carries no personal data can be committed.** P2's
synthetic EDF set is the first, and its leg is consequently the **only equivalence diff that runs in CI**.

→ **P9 (new, high value):** synthesize a committable input for every other node, the same way. The
suite's strongest correctness gate is currently decorative in CI; this makes it real.

### M4 — the Clock Contract, validated across device families

An EDF-header clock and an O2Ring CSV clock — two unrelated parsers — joined across 39 nights on floating
`tMs` with **zero timezone code**. That is the contract's entire *raison d'être*, demonstrated end-to-end, and
nothing in the suite currently pins it. Deserves a fixture.

---

## 4 · Proposals

| id | proposal | value | effort |
|---|---|---|---|
| ~~**P1**~~ | ✅ **DONE 2026-07-12** — the lane is on the bus (15 → 30 metrics); F5 rode the same bundle. `manifestHash b7cc3f0256da → e2392eda2d0a`; 4 fixtures regenerated (both `contentId`s unchanged); changeset dropped. No registry/badge work needed (all 15 were already graded). | **high** | med |
| ~~**P2**~~ | ✅ **DONE 2026-07-12** — binary-EDF equiv leg live (17→20 assertions), via a **committed synthetic** EDF set (no personal data, no device serial). Closes F3 + F6. First fixture with committed, content-addressed INPUT bytes. Surfaced **M5**. | **high** | low |
| ~~**P9**~~ | ✅ **DONE 2026-07-12** — every node has a committed synthetic input; the equivalence gate runs in CI for the first time (17 → 38 assertions, GATE B 4 → 10). | **highest** | med |
| ~~**P3**~~ | ✅ **DONE 2026-07-12** — `adapters/resmed-edf.js` registered (all 6 lists); CPAP was the fleet's ONLY adapter-less signal type. Binary EDF rides the established `ctx` escape hatch (`ctx.buffers`/`ctx.edfSets`), so the "no text-stream adapter ⇒ no adapter" premise is retired. The §F4 rule is exposed on the adapter record and unit-tested **both ways**: both EVE files survive, AND the naive ±60 s-only rule provably drops one — so a "simplification" back to it reds. Orchestrator-only re-bundle: **no `manifestHash`, no fixture moved.** | med | low |
| ~~**P4**~~ | ✅ **DONE 2026-07-12** — the bare-IQR `mode` cut is retired. Root cause was a **confound, not a bad constant**: the raw pressure IQR is dominated by **EPR** (a 1–3 cmH₂O drop on every *expiration*, sampled at 0.5 Hz), so a FIXED machine with EPR=3 read "APAP". `mode` is now called on a minutes-scale P90 pressure envelope (EPR-immune), with a **dead-band that returns `null` rather than guessing** and a **night-level stability guard** (every session must agree — the first session no longer names the night). Both surfaces that shipped the old rule are gone, incl. a subtitle literally telling the user *"Auto-titration spread (>1 ⇒ APAP)"*. F6 decided + documented below. | med | low |
| ~~**P5**~~ | ✅ **DONE 2026-07-12** — `event-coupling.js` in the spine (22 self-test + 21 contract assertions, both runners). Absorbing the prototype found **three ways it lied, all toward false positives**: the null shift did not **wrap** (surrogates fell off the recording end where no B can match → chance deflated → **lift inflated**); a **saturated** window (wider than B's inter-event interval) crushes lift to ~1.0 *by arithmetic* and was indistinguishable from "no coupling" (now flagged, with the exact ceiling `maxLift = 100/chancePct`); and the whole-minute default shifts **resonate** with any round periodicity in B — a planted, perfect coupling scored **lift 1.006**, a false negative (defaults are now second-level). Bundle-free + fixture-free by construction. | **high** | med |
| ~~**P6**~~ | ✅ **DONE 2026-07-12** — executed as **`TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md`**. The answer is *no*: over 67 epochs / 11 quad-modal nights the reference-free TCH estimator fails **two** ways that are invisible without a truth signal — it is **blind to bias** by construction (ECG under-reads respiration by 1.35 br/min), and its **independence assumption is violated** (ρ = 0.42 between the ECG and PPG error terms — both read the same RSA proxy with the same estimator), which makes it rate a calibrated flow sensor as noisy as an RSA-derived estimate. Rode a sibling ECGDex fix (respiration was computed two ways and exported zero ways — §F1's bug class in a second node). | **highest** | med |
| **P7** | Apnea → HR (CVHR) and apnea → motion-arousal coupling on A3, via P5. Independently tests M3's re-labelling alternative. | high | med |
| **P8** | Use A4's dated change-points as ground truth for `CPAPCross` change detection. | med | low |

### P5 — the coupling primitive ✅ **DONE 2026-07-12**

> **Executed** — `event-coupling.js`, spine module, dual-realm, gated in both runners (22 self-test +
> 21 contract assertions). Not co-loaded into any bundle: no app consumes it yet, so wiring it into
> `dex-coload.js` would re-bundle all 8 apps to carry inert code (the `BADGE_CSS` economics, §🎫). It
> rides the first node that uses it. **No `manifestHash` moved; no fixture was touched.**
>
> **Absorbing `tools/cpap-oxy-couple.mjs`'s `coupling()` found three defects in it — and all three lie
> in the direction the reader wants to believe.** This matters beyond CPAP: the prototype's numbers are
> what §M1 is *reported from*, so the primitive had to be right before anything was built on it.
>
> 1. **The null did not WRAP.** The prototype shifted surrogates additively, so displaced A events fell
>    off the end of the recording, where no B can ever match them. That deflates `chancePct` and
>    therefore **inflates `lift`** — it manufactures couplings. The shift is now circular within the
>    recording span. (§M1's *lifts* are directionally safe — the dominant class was called at chance and
>    a deflated chance would only have exaggerated it — but the magnitudes were never sound.)
> 2. **Saturation was invisible.** If the window is wider than B's mean inter-event interval, every A
>    finds a B by chance, `chancePct` → 100%, and `lift` is crushed toward 1.0 **by arithmetic even when
>    the coupling is perfect**. A bare `lift ≈ 1.0` therefore means *either* "no coupling" *or* "this
>    window cannot resolve one", and the prototype could not tell them apart. Each measurement now
>    carries the exact ceiling **`maxLift = 100/chancePct`** and a **`saturated`** flag, so lift ≈ 1 may
>    be read as absence **only** on a window that could have shown presence.
> 3. **The default shifts RESONATED.** Whole-minute shifts (±5/7/11/13/15 min) are all multiples of 60 s,
>    so against any stream with a round periodicity every surrogate re-lands A on the *same phase*, the
>    null reproduces the observed rate, and a real coupling reads as ~1.0 — a **false negative**. Caught
>    by the module's own gate: a planted, *perfect* coupling scored **lift 1.006**. Defaults are now
>    second-level (317/461/663/809/887 s), sharing no factor with 30/60/120 s.
>
> Each of the three is pinned by a regression assertion, so none can come back. **§M1's conclusions
> survive** (a chance-level dominant class, a coupled rare class, a ×0.0 longest-duration bucket), but
> any *magnitude* quoted from the prototype should be re-derived through the primitive before it is
> published.

### P5 (as proposed)

`cgm-hrv-coupling-analysis.js` is precedent (GlucoDex × PulseDex) but it validates a mechanism **deliberately
planted in the synthetic cohort generator** — it answers *"did our detectors recover what we injected?"*. The
harder, real-data question needs a surrogate null:

```
coupling(eventsA, eventsB, {window:[lo,hi], nullShifts:[…], stratifyBy:'durSec'}) →
  { n, hits, observedPct, chancePct, lift, windowSweep[], strata[] }
```

Generalizes to CPAP apnea × desat, ECG arrhythmia × desat, GlucoDex excursion × anything. **The missing
"is it real or coincidence" primitive for the Integrator** — and M1 shows it *changes conclusions*.
Prototype: `tools/cpap-oxy-couple.mjs` (`coupling()`), ready to absorb.

### P6 — CPAP as a reference. The one that unblocks the σ programme.

The `sigma-no-reference-analysis` / three-cornered-hat programme exists **because there is no reference** —
you cannot measure a device's σ without a truth signal, so you triangulate three devices and hope the
estimator is sound. **We have never been able to check whether it is.**

CPAP's PLD channel writes **measured respiration** — `RespRate` (0.5 Hz), `TidVol`, `MinVent` — from a
calibrated flow sensor in the therapy path. That is a **genuine ventilation reference**, and on the 17
quad-modal nights (A3) it sits beside ECG and PPG on the same clock.

1. Build a **respiration triplet** — CPAP `RespRate` (measured) + ECG-derived respiration (EDR/RSA) +
   PPG-derived respiration.
2. Run the **existing reference-free TCH σ machinery** on it, exactly as it runs on the HR triplet.
3. **Compare its σ estimates against the CPAP reference.** For the first time: *does the reference-free
   estimator actually recover the true σ?*

A **validation of the method itself**, not another application of it — the one experiment a reference-free
technique can normally never run, and exactly what a `PAPERS-ROADMAP` real-validation item needs. Cheap: the
data exists and is already parsed.

---

## 5 · Analysis claims made and then RETRACTED (discipline record)

Recorded so nobody rebuilds them. All four were *plausible* and *wrong*, and each was killed by a specific check.

| claim | killed by |
|---|---|
| Two interventions were "separable in time" | **Nightly** data put both on one night. Weekly aggregates hid it. *Never infer separability from a smoothed view.* |
| One regime "beat" another | **Permutation test** — p ≈ 0.22. It was a 9-night block. *Eyeballed block means are not effects.* |
| A DSP field "reads null — DSP gap" | It is **computed correctly** and then **dropped from the export** (F1). *Check the export before blaming the DSP.* |
| A mechanism explained a real association | The association survived every test; the **mechanism's own precursor channel contradicted it** (M3). *Statistical strength ≠ mechanistic truth.* |

---

## 6 · Done when

- [x] **P1** — the 15 populated dropped metrics ride the `ganglior` bus; `CPAP_REGISTRY` + badges updated; F5's one-line fix rides the same bundle; CPAP fixtures regenerated (output moves → changeset per §📦); `registry-defs-parity` green.
- [x] **P2** — the identifier question settled (**synthesize** — no real EDF committed, so no device serial published); a binary-EDF `env.equiv` leg runs `compute({edfSets}) ≡ committed export` in **both** runners; `FIXTURE-PROVENANCE.json`'s "can't join" note **deleted**.
- [x] **P3** — `adapters/resmed-edf.js` registered; the second-file-of-type rule has a unit test (and a companion assertion proving the naive rule DOES drop an EVE, so the clause cannot be "simplified" away).
- [x] **P4** — `mode` fixed (no bare-IQR label ships anywhere: not the chip, not the `pressureRange` subtitle, not the registry `cite`); F6 decided and documented (below).
- [x] **P5** — `event-coupling.js` in the shared spine with a self-test (window sweep + duration strata + null). 22 self-test + 21 contract assertions, gated in both runners; the three prototype defects (non-wrapping null · unflagged saturation · resonant whole-minute shifts) fixed and each pinned by a regression assertion.
- [x] **P6** — respiration triplet built on A3; TCH σ compared against the CPAP reference; written up as `TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md`. **The estimator does NOT recover the true σ** — blind to bias, and its independence assumption fails (ρ = 0.42).
- [x] `verify-provenance.html` GATE A/B clean · `node tools/build.mjs --check` clean.
      *(Final, 2026-07-12: `run-tests.mjs` **2132 passing / 0 failing** (136 groups), `build.mjs --check` **clean (10 owned)**, `verify-manifest.mjs` **GATE A 8/8 · GATE B clean**, `tsc --noEmit --checkJs` clean, `cpapdex-dsp --selftest` **59/0**.)*
- [ ] **`Dex-Test-Suite.html?full` render-coverage lane — NOT RUN.** The headless floor is green, but P4 changed a rendered surface (the CPAPDex pressure cards: the `mode` chip now reads `unknown` on an indeterminate night, and `pressureEnvIqr` is a NEW card). That is exactly what the browser-only render lane exists to cover, and it has not been driven. **Run `Dex-Test-Suite.html?full` before release.**
- [x] Follow-up briefs spawned per §📌 — `TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md` (P6; feeds `SIGMA-PAPER-REWRITE` + `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III`) and `CPAP-REAL-CORPUS-FOLLOWUPS-2026-07-12-BRIEF.md` (what P3/P4/P5 surfaced and did not close).

## 7 · Reproducing

```sh
# SD-card tree → per-night ganglior.node-exports (+ corpus stats)
node tools/cpap-corpus.mjs --root <sd-card-dir> --out exports.json --stats

# fold O2Ring in → event↔desat coupling against a shuffled null
node tools/cpap-oxy-couple.mjs --exports exports.json --oxy <dir-of-O2Ring-csv>
```

Both drive the **real** modules (`cpapdex-edf/dsp/cross/fusion.js`, `oxydex-dsp.js`) in a vm realm co-loaded
exactly as `CPAPDex.src.html` does — no re-implemented parser, no hand-typed numbers. Paths are arguments; no
personal paths or data are baked in. `cpap-corpus.mjs` carries the session-grouping rule (**F4**);
`cpap-oxy-couple.mjs` carries the `coupling()` primitive (**P5**).
