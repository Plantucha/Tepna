<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-14

# Deep audit (post-193-commit churn) — verified findings

Executed `AUDIT-PROMPT.md` against the suite after ~15 PRs / 193 commits since the last deep audit
(`DEEP-AUDIT-2026-07-11`). Four adversarial auditors (OxyDex+GlucoDex · the redundant HRV paths · CPAP+
Integrator fusion · a recent-churn regression pass), each verified by direct code trace before filing.
Every finding below is **CONFIRMED by trace** unless marked HYPOTHESIS; each still needs a **failing-
assertion gate added to `tests/dex-tests.js`** as the first step of its fix (charter: verify, don't trust).

> **The recent-PR churn is a CLEAN BILL.** The checkJs / strictNullChecks casts and biome reflows are
> runtime-inert (traced every cast/guard; GATE-B confirms no fixture output moved). The behavioral changes
> in the window are all intentional, separately committed, brief-backed, gate-passing. **These findings are
> older latent defects, NOT regressions from the recent work.** Most are *residue of `DEEP-AUDIT-2026-07-11`'s
> incomplete fixes* (a fix applied at the headline but not propagated to every consumer).

Fix **one gated change at a time** (charter). Recommended order: §1 → §2 → §3 (the three that mis-state a
surfaced number), then §4/§5, then §6–§8.

---

## §1 — GlucoDex: long sensor-gaps counted as real glucose in ~9 metric families  ⚠ highest impact  ✅ EXECUTED 2026-07-14
> **EXECUTED 2026-07-14.** One module-level predicate `_ana(c,i) = f!==WARMUP && f!==COMPRESSION &&
> f!==GAP_LONG` (`glucodex-dsp.js`), and every distribution consumer routed through it —
> analyzableIndex · conga · modd · gvp · magRate · adrr · postprandial · dawn (also stops excluding the
> *short* GAP bridge) · nocturnalHypo · daypartVariability · excursions · agp · perDay. Metamorphic gate
> added to the §5/§6 group (`tests/dex-tests.js`): a 14 h gap vs the SAME readings explicitly filled must
> give different `gvp` — RED on the old code (gapped 7.1 ≈ filled 7.2), GREEN after (gapped 8.4 ≠ 7.2).
> **Export-inert** — the committed fixtures carry no GAP_LONG, so the synthetic GlucoDex golden stays
> byte-identical (equiv leg confirms); re-bundled GlucoDex + the two orchestrators (OverDex, Data Unifier)
> that inline the DSP; GATE A/B + `build --check` clean. NOTE: `detectSessions`' per-session drift fit
> (`glucodex-dsp.js:354`) still masks only WARMUP/COMPRESSION — deliberately left to §4, which overhauls
> that function.

- **Severity:** mis-states surfaced numbers **+ fabricates absence** (interpolation across hours the sensor
  never saw is folded into variability / per-day / AGP; and `nocturnalHypo` can emit fabricated events).
- **Root cause:** `clean()` splits gaps into `FLAG.GAP` (short bridge) and `FLAG.GAP_LONG`
  (`glucodex-dsp.js:220`). The DEEP-AUDIT §5 fix added the `GAP_LONG` exclusion in **exactly one place** —
  `analyzableIndex()` (`glucodex-dsp.js:307`, feeds headline TIR/mean/CV/MAGE/grade/bgRisk). Verified: `GAP_LONG`
  is referenced only at its def (158), the interpolation (220), the `_isGap` counter (276), and 307. Every
  other consumer masks WARMUP/COMPRESSION but **not** `GAP_LONG`: `conga`:442, `modd`:454, `gvp`:466, `magRate`:506,
  `adrr`:534, `dawn`:601 (also wrongly excludes the *short* GAP), `nocturnalHypo`:624, `daypartVariability`:642,
  `excursions`:664, `agp`:689, `perDay`:704. The `analyzableIndex` docstring (`:296-301`) claims long gaps are
  "excluded from **every** distribution metric" — the code excludes them from one family.
- **Triggering input:** a 14-day CGM CSV with one 12–14 h sensor-change gap → headline TIR drops the gap, but
  the gap-day `perDay` TIR / `modd` / `gvp` / AGP bands include the interpolated line; a gap bridging 180→110
  mg/dL counts interpolated 110–180 as in-range measured glucose; a bridge dipping <70 fabricates `nocturnal_hypo`.
- **Fix sketch:** one shared predicate `_isAnalyzable(f) = f!==WARMUP && f!==COMPRESSION && f!==GAP_LONG`; route
  all the above through it (and fix `dawn` to stop excluding the short GAP). **Gate cost:** `glucodex-dsp.js` →
  re-bundle GlucoDex + regenerate its equiv/golden fixtures (the ~6-min equiv clips contain no `GAP_LONG` — add a
  committed synthetic long-gap fixture + assertion that the excluded metrics don't move when the gap is inserted).

## §2 — Integrator silently drops a multi-night CPAP export's entire per-night payload  ⚠ high
- **Severity:** contract/provenance drift **+ silent failure** — device-scored AHI (the strongest apnea truth
  on the bus) vanishes from fusion with no warning.
- **Root cause:** `cpapdex-app.js:406` emits `cpapBuildMultiNightExport` (≥3 nights) → wrapper
  `{kernel,schema,generated,nightCount,crossNight,nights:[…]}` (`cpapdex-fusion.js:352-373`) with **no** top-level
  `ganglior_events`/`recording`/`metrics`. `integrator-dsp.js:580` unwraps a `json.nights[]` wrapper **only for
  `node==='OxyDex'`**; CPAPDex falls through to `adaptEnvelopeNode` (:586) → `_eventsFromEnvelope` (:133-153) reads
  top-level `recording`/`ganglior_events` (absent) → `t0Ms=null`, `events=[]`; the CPAP branch (:349) does
  `json.metrics||{}` → `{}` → every summary field null. `_deviceScoredAuthority` (:857-873) then returns null; no
  `KNOWN_NODES` warning (CPAPDex is registered) and `_looksSummary` (:569) needs `json.t0Ms!=null` (the wrapper
  lacks it) → nothing warns. (Longitudinal still absorbs `json.crossNight` at `integrator-longitudinal.js:99`,
  masking the loss.)
- **Triggering input:** load ≥3 nights in CPAPDex → Export → drop the `multiNight:true` file into the Integrator
  → one empty date-unknown CPAP record, `apneaAuthority=null`, no CPAP events fused, no warning.
- **Fix sketch:** in `normalizeFile`, before node dispatch, generically unwrap a multi-night wrapper —
  `if (Array.isArray(json.nights) && json.schema?.multiNight) { each night → adaptEnvelopeNode(night, node, filename) }`
  — so any multi-night emitter is handled like OxyDex. **Gate cost:** `integrator-dsp.js` → re-bundle Integrator
  + `--check`; add a contract assertion (3-night CPAP wrapper → N recs with events + non-null `apneaAuthority`);
  no fixture regen (ingest-only).

## §3 — PulseDex breaks the Task-Force identity `vlf+lf+hf == totalPower` on overnight readings
- **Severity:** mis-states surfaced numbers (~5–20% on overnight) + differential drift (the un-fixed sibling of
  a fix ECGDex and PpgDex both carry).
- **Root cause:** the windowed/overnight path takes **four independent medians** — `winSpec =
  {hf:round(median(sh)), lf:round(median(sl)), vlf:round(median(sv)), tp:round(median(stp))}` (`pulsedex-dsp.js:1143`);
  `median(tp_i) ≠ median(vlf_i)+median(lf_i)+median(hf_i)`. ECGDex **defines** `tp = _v+_l+_h` (`ecgdex-dsp.js:601`),
  PpgDex likewise (`ppgdex-dsp.js:982,550`). Surfaced + badged at `pulsedex-render.js:178/181` (Total/VLF) and the
  HF/LF fraction bars `:134,137` (`hf/(tp||1)*100`). (The single-window path `:475` also rounds `tp` independently
  but there the break is immaterial ±1–2 ms² rounding.) PulseDex's export omits `totalPower`, so HRVDex's `_hasNu`
  guard saves the fusion seam — the defect is confined to PulseDex's UI.
- **Triggering input:** three 5-min windows (vlf,lf,hf) = (100,100,800),(200,200,600),(900,50,50) → PulseDex
  reports Total=1000, HF-bar 60%; bands sum to 900, true HF share 67%. ECGDex/PpgDex report Total=900.
- **Fix sketch:** make `tp` the band sum in both spots (`winSpec.tp = vlf+lf+hf` at :1143; `tp:_v+_l+_h` at :475),
  mirroring ECGDex:601. **Gate cost:** `pulsedex-dsp.js` → re-bundle PulseDex; **moves the overnight-fixture Total
  Power/VLF output** → PulseDex equiv leg reds → regenerate its fixtures (§🔏) + a changeset (release-ledger check7).

## §4 — GlucoDex `detectSessions` can never detect a sensor-change boundary
- **Severity:** mis-states `nSessions` + per-session drift; disables the between-sensor level correction. Same
  root regression as §1.
- **Root cause:** `detectSessions` scans for runs of `c.gF[i]===c.FLAG.GAP` ≥90 min (`glucodex-dsp.js:331-338`),
  but a ≥90-min sensor-change gap is entirely `FLAG.GAP_LONG` (the `FLAG.GAP` branch at :215 requires *both*
  neighbor gaps `< gapThresh` ≈12.5 min — impossible inside a long gap). The other split path (mid-stream WARMUP,
  :339) never fires mid-file (warm-up flagged only on the first `warmCells`). → `nSessions` always 1, drift fit
  across mixed sensors, `levelSessions` a no-op.
- **Triggering input:** a 3-week CSV spanning 3 sensors with ~2 h swap gaps → expected `nSessions=3`, actual `1`.
- **Fix sketch:** change the boundary test to match `GAP_LONG` (reuse the `_isGap` helper or a `GAP_LONG` check).
  **Gate cost:** `glucodex-dsp.js` → re-bundle + regenerate fixtures (can share §1's long-gap fixture).

## §5 — OxyDex ODI-family rates use two incompatible time bases  ⚠ needs an owner decision on canonical basis
- **Severity:** mis-states surfaced `/hr` numbers on gappy / non-1 Hz nights (charter #1, samples-vs-seconds).
- **Root cause:** `durationHr = n/3600` (valid-sample count; invalid rows dropped at `oxydex-dsp.js:554 continue`)
  drives `detectODI`:2657, `computeODI1`:1024, nadir density :1148, `oxyCrashRate`:1848 (+ ~9 other `n/3600` sites);
  but the artifact-adjusted `odi4.rate` is **recomputed** on the elapsed-span basis `stats.durationMin/60`
  (`:2170,2178`; `durationMin=(last.tMs−first.tMs)/60000`, :2404-2407). On a night with dropped samples the two
  bases diverge (~14% on 1 h finger-off; ~4× on a 4 s-cadence oximeter). `odi41ratio = odi4.rate/odi1.odi1Rate`
  (:1160) then divides a span-based rate by a sample-based rate.
- **Confidence:** CONFIRMED the code uses two bases and they diverge when samples drop; HYPOTHESIS on the exact
  magnitude for a given file (needs a run on a gappy night).
- **OPEN QUESTION (author):** which basis is canonical? Valid-sample `n/3600` is arguably the more clinically
  honest "per hour of *analyzable* recording" denominator (don't count finger-off) — i.e. the artifact-adjusted
  `odi4.rate` at :2178 may be the odd one out, opposite the auditor's suggestion. **Decide before touching.** The
  `odi41ratio` mixing the two is unambiguously wrong regardless.
- **Fix sketch:** thread ONE chosen basis through all ODI-family denominators. **Gate cost:** `oxydex-dsp.js` →
  re-bundle OxyDex + regenerate fixtures (add a gappy fixture — the clean ~6-min clips don't exercise it).

## §6 — Integrator resurrects the retired per-session CPAP `mode` label  (latent)
- **Severity:** fabricated/misleading value; **latent** today (no consumer reads `summary.mode`) — a contract landmine.
- **Root cause:** `integrator-dsp.js:358` sets `summary.mode = json.recording.sessions[0].mode` — the first
  session's label — which CPAPDex deliberately retired (`cpapdex-dsp.js:776` forces `metrics.mode=null`;
  `cpapdex-fusion.js:419-425`: a per-session label "flipped 7× across 182 real nights … Never `s0.mode`").
- **Fix sketch:** `summary.mode = json.metrics?.mode || null` (honor the node's null), or drop the field. **Gate
  cost:** `integrator-dsp.js` → re-bundle Integrator; no fixture regen.

## §7 — CPAPDex `periodicBreathingPct: 0` (not `null`) on a zero-duration session  (degenerate)
- **Severity:** fabricated absence (null-vs-0), low reach.
- **Root cause:** `cpapdex-dsp.js:664` and `:753` use `durSec>0 ? … : 0`; sibling metrics on the same object
  return **null** on absence (`residualAHI: usageHours>0 ? … : null`, :659-663/:748-752). A `durSec===0` session
  exports a measured-looking `periodicBreathingPct:0` beside honestly-null apnea indices.
- **Fix sketch:** change both `: 0` → `: null`. **Gate cost:** `cpapdex-dsp.js` → re-bundle CPAPDex; verify the
  synthetic goldens don't move (the branch needs `durSec===0`, which they don't hit).

## §8 — SD1 estimator drift across nodes  (code-health, negligible magnitude)
- **Severity:** low; real definitional divergence, immaterial numerically.
- **Root cause:** PulseDex `sd1 = rMSSD/√2` (`pulsedex-dsp.js:116,1160`); ECGDex `SD1 = SDSD/√2` (÷N,
  `ecgdex-dsp.js:56-66`); PpgDex `SD1 = √0.5·std(Δ)` = SDSD/√2 (÷N−1, `ppgdex-dsp.js:520`). Two mismatches:
  rMSSD-vs-SDSD (differ only by `mean(Δ)²` ≈ 0) and ÷N-vs-÷N−1 on the difference series (the SDNN-oracle class, but
  on a secondary axis, negligible for large N).
- **Fix sketch:** unify on `SDSD/√2` fleet-wide (÷N−1). Low priority; bundles + fixture regen for any node touched.

---

## Cleared (checked, no finding — recorded so coverage is honest)
- **Recent 15-PR type/format churn** — clean (see banner).
- **`event-coupling.js`** — wrapping null, `_eligible` coverage, `MIN_EXPECTED_HITS` power floor, `maxLift`
  saturation, non-round default shifts all correct; `_lift` never coerces 0/0→1.0; not co-loaded (no in-scope
  consumer reading `lift` past the guards — dormancy tracked in `CPAP-REAL-CORPUS-FOLLOWUPS-II`).
- **EDF / `adapters/resmed-edf.js` / `cpapdex-edf.js`** — pure-regex→`Date.UTC` clock, no `new Date(str)`/`now()`;
  corrupt-stream `catch` pushes a visible `prov.warnings` (not swallowed).
- **CPAP fusion/cross** — ODI/T90 pooled on numerator+denominator (not mean-of-rates); gates on inputs *present*.
- **Core HRV time-domain estimators** — `std` ÷(N−1), `rmssd` ÷pairs, `pnn50` `>50`/(N−1) unified across
  PulseDex/ECGDex/PpgDex/HRVDex; **no SDNN ÷N regression**. Artifact bounds (300–2000/2200 + Malik) effectively
  consistent. Baevsky/HF-nu presence guards intact; the `fascia` back-compat seam correct.

## Done when
- [ ] §1–§7 each: a failing assertion added first (proving it reds on current code), then the fix, then the gate
      goes green; re-bundle + fixture regen where noted; one PR per finding.
- [ ] §5's canonical-basis question answered by the author before its fix.
- [ ] Follow-up brief spawned for anything discovered during execution.
