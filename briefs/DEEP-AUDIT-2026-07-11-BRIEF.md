<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS · **Created:** 2026-07-11 · **Charter:** `AUDIT-PROMPT.md` · **Baseline at audit time:** headless 2000/2000 + provenance GATE A 8/8 / GATE B 16/16 (both green — no finding #0)

# Deep audit 2026-07-11 — 21 reproducible defects

Executed `AUDIT-PROMPT.md` end-to-end against the real corpus (39 O2Ring nights, the tri-device trio,
the real Welltory / Abbott Lingo / Polar H10 / Verity files). **Every finding below carries a runnable
reproduction** — a hypothesis without one is labelled as such. The suite's two gates were green
*before and after*: these defects live in the space the gates do not cover.

> **Why the gates missed all of this.** The `env.equiv.*` fixtures are all ~6-minute clips of *clean*
> recordings. Three separate findings (§1, §8, §9) are invisible on a clean 6-min clip and only appear
> on a long, lossy, or differently-configured real night. The gates prove *reproducibility*, not
> *correctness* — they pin `compute(committed input) ≡ committed export`, and both sides can be wrong
> together.

Repro scripts were written to the audit session scratchpad (not committed). Each finding names the
script that proves it; re-create from the described input if the scratchpad is gone.

---

## TIER 1 — mis-states a number the user sees

### §1 · Clock Contract §3 is not implemented — an MDY O2Ring night reports a healthy patient · **FIXING FIRST**
`clock.js:40` `_ckDMY(a,b,preferDMY)` decides day-vs-month **per row**, with no file memory. The Clock
Contract is explicit: *"Any row with day-component > 12 ⇒ file is unambiguous; **lock that order for the
whole file** … Never switch order mid-file."* No caller pre-scans; every caller hard-codes the tie-break
(`oxydex-dsp.js:558,579` `preferDMY:true` · `glucodex-dsp.js:76` `false` · `hrvdex-dsp.js:76` ·
`pulsedex-overview.js:57` · `integrator-dsp.js:471`; `ecgdex-app.js:34,95` inlines it with no `opts` at all).
`glucodex-dsp.js:46` carries a byte-copy of the same per-row helper.

In an **MDY** O2Ring file (the Contract's own §2 step 4 lists `MM/DD/YYYY` as an O2Ring format), row
`06/12` reads as Dec 6 while row `06/13` reads as Jun 13 — the order flips **mid-file** and time runs
backward:

```
durationMin = -254460   (expected 420)     ← negative, and it ships in the node-export
ODI-4       = 0 /h                          ← an apnea night reads PERFECTLY HEALTHY
hypoxicBurden = 0
```

`oxydex-dsp.js:2390` computes `rawDurMs = rows[n-1].tMs - rows[0].tMs` under a comment asserting
monotonicity that nothing enforces; `parseCSV` never sorts nor validates it.
**Repro:** `oxy-dmy.mjs` (OxyDex, end-to-end), `glu-dmy.mjs` (GlucoDex, an EU/DMY LibreView export →
11 days scattered across 11 different months, `pctActive` 4% instead of ~100%).

**Fix:** file-level pre-scan in `clock.js` (`resolveDMY`) → a locked order applied unconditionally; a row
that contradicts the lock yields `null`, never a guess; a file containing **both** proofs is contradictory
→ refuse. Thread the resolved order through every vendor parser. Guard `computeStats` so a negative
duration becomes `null` + a reason, never a number.
**Gate cost:** `clock.js` is inlined fleet-wide → re-bundle all 8; fixtures should NOT move (every
committed input is DMY-consistent or ISO) — confirm via the `env.equiv.*` GATE-C legs.

### §2 · A Polar H10 accelerometer file is analyzed as a heart recording
Real `*_ACC.txt` (272 556 rows, tri-axial, milli-g) routes to the RR adapter, passes `usable`, and yields a
confident export: **HR 61.9 bpm · mode "🌙 Overnight" · stress 100 · 36 `stress_peak` events @ conf 0.92.**
The Z-axis gravity rail (~973 mg) is read as 973 ms RR intervals. Three layers each fail open:
`adapters/polar-rr.js:37` returns 0.6 for *any* Polar-Sensor-Logger header (every PSL stream matches);
`pulsedex-dsp.js:289` accepts any column whose median lands in 300–2000; the `usable` gate checks value
range but never *interval-likeness* — SDNN 9.5 ms over 3 h is impossible and is never questioned.
Verity's ACC survives only because its gravity axis is **negative**: a coin-flip on strap orientation.
**Repro:** `acc-as-rr2.mjs`. **Fix:** foreign-stream exclusion in `polar-rr.js detect()` (one line, adapter
only — no node re-bundle), then harden the column picker (reject `[mg]`/`[G]`/`[dps]` headers and
near-constant series).

### §3 · HRVDex `HF n.u.` = 125 000 000 % — a quantity that is 0–100 by definition
`hrvdex-dsp.js:347` — `const nu_denom = (r._totalPow - r._vlf) || 0.001;`. Absence seeds to `0`
(`_envToSeed`'s `n()`, `:280`), `0-0 → 0`, and `||` substitutes a 1000×-too-small denominator. Fires on
**every** ECGDex/PpgDex export ingest (neither emits `totalPower`); with PulseDex (vlf present, totalPower
absent) it goes **negative**. Surfaced on the hero "HRV Bench" card. This is the un-gated *spectral*
sibling of the subjective-composite class `_hasSubj` (`:317`) already fixed.
**Repro:** `f-hrv-nu-explode.mjs`, `nu-matrix.mjs`. **Fix:** gate on presence, not on `!= 0`.

### §4 · HRVDex `MxDMn/MeanRR` is 1000× low — the un-guarded sibling of `guardBaevsky`
The real Welltory CSV is **mixed-unit** (`Mean RR` ms, `MxDMn`/`Mode` **seconds**) — precisely why
`DexUnits.guardBaevsky` exists. `d_si`/`d_csi` use the guard; `d_mxdmn_meanrr` **three lines below**
(`hrvdex-dsp.js:343`) divides raw s ÷ raw ms. Metamorphic: re-express the same measurement in ms and the
guarded values are invariant while this one moves 1000× (0.000189 vs 0.1892).
**Repro:** `repro-hrv-mxdmn.mjs`. **Fix:** route it through the guard's `_baevskyS.mxdmnS` (it is then
identical to `d_csi` — consider collapsing the two). Also: `measurements[].mxdmn` is exported in **seconds**
next to ms siblings, with no registry entry declaring a unit.

### §5 · GlucoDex counts straight-line gap-fill as measured glucose
`glucodex-dsp.js:212` — the comment says *"long gap — carry interpolation but mark; **will be excluded from
coverage**"* — then assigns the **same `FLAG.GAP`** short gaps get, and `analyzableIndex` (`:290`) filters
only `WARMUP`/`COMPRESSION`. `FLAG.GAP` is never filtered anywhere. A routine 14 h sensor-change gap is
interpolated straight into the **validated-tier headline KPIs**: TIR reads **11 %** where the truth is
**0 %**. **Repro:** `f-gluco-gapfill.mjs`. **Fix:** split `GAP_SHORT`/`GAP_LONG`; denominate TIR/GMI on real
cells + report coverage.

### §6 · The real Abbott Lingo export IS clipped, and the clip detector misses it
The committed `lingo-glucose-data-2026-MAY-23.csv` rails at **54 mg/dL**: 46 readings at exactly 54 vs
**15** at 55 and **14** at 56 — a **3.2× pile-up at the extreme**, zero readings below. The same file's
*ceiling* thins normally (169:1, 168:0) — that is the internal control. A genuine tail thins toward its
extreme; this **rises**. `detectClampSaturation` (`glucodex-dsp.js:747` `spikeAt`) compares a 2-wide bound
band against a 5-wide inner slab, so it can essentially never trip on real data (`61 >= 1.5×218` → false).
Consequence: **37 `nocturnal_hypo` events at conf 0.97, all unflagged** — clip artifacts sold as clinical
hypoglycemia; TBR/LBGI silently under-count.
**Repro:** `cgm-clip.mjs`. **Fix:** compare like-for-like *at the exact bound* (count at min vs mean of the
next two bins → real Lingo `46 >= 1.5×14.5` → true); promote the known-vendor floor band to an independent
trigger.

### §7 · OxyDex's REM estimate is physiologically impossible on 100 % of real nights
Across **all 39 committed O2Ring nights**: median **77.5 %** REM, max **87.8 %**, min 39.6 % (normal adult
REM ≈ 20–25 % of sleep). **39/39 exceed any plausibility ceiling**, and every one renders as KPI colour
**"good"** (`oxydex-render.js:1385`, threshold ≥45 min) with the label *"High REM estimate"*. The criteria
(`oxydex-dsp.js:4653`) are inverted: "still + HR SD < 3 + HR within ±5 bpm of the night mean" describes the
bulk of quiet sleep, not REM (REM shows *increased* HR variability).
**Known-but-not-fixed:** `audits/INTEGRATOR-FUSION-ISSUES.md` §T2 already records the 77.5 % figure but
"resolved" it by making the **Integrator** surface a `staging_disagreement` — which requires a second node.
A **standalone OxyDex** user (each Dex runs standalone — the common case) sees the bare number with nothing
to disagree with. §T2 also claims the ECGDex sleep export "now carries `method`, `confidence:'low'`, and a
`plausibility` flag" — **grep finds none of the three**; the export is `{totalSleepMin, stageMinutes}` only.
Only the Integrator half of that fix ever shipped.
**Repro:** `repro-rem-corpus.mjs`. **Fix:** a plausibility gate on the node itself (the half §T2 promised);
re-derive or demote the proxy. Also: `remProxyPct` denominates on **recording** time while ECGDex's
`remFraction` denominates on **sleep** time, and `fuseStagingConsensus` compares them directly.

### §8 · OxyDex places desat events on the wrong clock — 849 s error against a 15 s gate
`parseCSV` drops rows (`- -` no-reading, out-of-band, unparsable), so a row **index is no longer a
second-offset** — but two consumers rebuild event time from the index anyway and disagree with each other:
`oxydex-dsp.js:5649` (`t0 + idx*dt`, a uniform stretch that smears an 849-sample dropout evenly across the
night) and `oxydex-fusion.js:204` (`t0 + idx*1000`, hard-coded 1 Hz). On the real lossy night
`O2Ring…20260514195655.csv` the worst desat lands **422 s** (bus) / **849 s** (fusion) from its own parsed
timestamp — against a coincidence gate of LEAD 15 s / TRAIL 60 s, so desat↔surge corroboration is noise.
**The equiv-fixture night has ~0 s error — which is exactly why the gate never caught it.** The honest value
(`rows[idx].tMs`) is already sitting in the row. **Repro:** `repro-oxy-idx-clock.mjs`.

### §9 · OxyDex FFT Cycle Length describes only the first hour of a 6–10 h night
`computeSpO2FFT` (`:1511`) and `computeDFA` (`:1430`) head-slice to 3600 samples (~1 h at 1 Hz) with **no
disclosure**. Neither cap is performance-motivated (DFA is O(N)). The surfaced **FFT Cycle Length** — the
periodic-breathing / Cheyne-Stokes number — **changes on ~30 of 39 real nights** (63s→200s, 200s→33s,
50s→200s). The *sibling function in the same file* (`computeHREntropy:1553`) was explicitly fixed for this
exact bug with whole-night decimation; two of three siblings were missed. Same family, unproven:
`:3669/:3692/:3728/:3826` use `rows.slice(-USE)` (last 30–60 min only), also undisclosed.
**Repro:** `oxy-headslice.mjs`.

### §10 · ECGDex's exported spectrum mixes two time scales
`ecgdex-dsp.js:1143-1148` builds `hf`/`lf` from **5-min epoch medians**, then **overwrites** `tp`/`vlf` with a
**whole-night** transform. They ship side by side in one `hrv.frequency` block: `vlf+lf+hf = 5060` but
`totalPower = 5674` — the Task-Force identity broken by 11 %, and two irreconcilable "HF n.u." from one
export (ECGDex-native 32.1 vs HRVDex-ingest 20.4). **Repro:** `real-diff.mjs`.

### §11 · Whole-record Lomb–Scargle band split is a grid lottery
All three LS implementations integrate on a **fixed bin count** regardless of record length; for a whole
night the intrinsic resolution is ~50× finer than the grid, so the sum samples a spiky periodogram at
arbitrary points. Parseval pins the *total* to the variance but leaves the *split* free:

| `nf` | VLF | LF | HF | **LF/HF** |
|---|---|---|---|---|
| 219 | 4150 | 969 | 555 | **1.747** |
| **220** *(shipped)* | 3988 | 1169 | 516 | **2.265** |
| 221 | 3851 | 1303 | 519 | **2.51** |

**±1 bin in an arbitrary constant swings LF/HF by 44 %**, and it does not converge. `ecgdex-dsp.js:585`
(`nf=220`), `ppgdex-dsp.js:447` (`df=0.002`, coarsest in the fleet), `pulsedex-dsp.js:230` — none scale `df`
with `T`. PulseDex is protected *by accident* (it uses the epoch-median path on long records).
**The LS core itself is correct** (see clean bills). **The defect is the grid, not the transform.**
**Fix:** derive whole-record bands from the per-5-min epoch spectra (the Task-Force prescription, and what
the epoch path already does correctly). **Repro:** `real-diff.mjs`, `ls-grid.mjs`.

---

## TIER 2 — fabricated absence / silent failure

- **§12 · The Integrator says "Sources agree … reliable" when nothing was comparable.**
  `integrator-dsp.js:1104` — `Math.max(rm&&rm.divergencePct||0, sd&&sd.divergencePct||0)`. `spread()`
  correctly returns `null` for an incomparable key; `|| 0` converts that absence into a **measured 0 %
  divergence** → `qc:'agreement'` → the surfaced note *"Sources agree within 0 % … reconciled autonomic
  state is reliable."* **Repro:** `f-integrator-agree.mjs`.
- **§13 · A glucose⟷autonomic coupling number with no glucose in it.** GlucoDex writes `glucose.cv`
  (`glucodex-dsp.js:1082`); `integrator-dsp.js:226` reads `glycemic.cv | variability.cv | glycemia.cv |
  summary.cv`. Never matches → `glucoseCV = null` → the fusion still publishes
  **`glucoseAutonomicCorrelation = 0.44` with `n: 0`**, surfaced as the "Autonomic⟷glycemic" KPI. The
  *rich* summary uses `glycemic.cv` and works — so the one file users are told to drop into the Integrator
  is the one whose key is unread. **Repro:** `c8-gluco-drop.mjs`.
- **§14 · HRVDex — the HRV node — can never join the HRV consensus.** Its export writes `measurements[]`
  (the 2026-07-04 SELF-INGEST enrichment); `integrator-dsp.js:272` reads `hrv.time.rmssd`. `summary.rmssd`
  is `null` on 100 % of HRVDex exports, so `fuseHRVConsensus` excludes it always. Its rMSSD values
  (36.7, 43.1, 39.5 …) sit unread. **Repro:** `c8-hrv-readset.mjs`, `c8-fusion-drop.mjs`.
- **§15 · The apnea rule is keyed by node, not impulse.** `integrator-dsp.js:673` = `_byNode(recs,'OxyDex')`.
  Metamorphic: a **byte-identical** `desat_event` stream changes only its `node` label → `fusion.apnea` goes
  from a result to **`null`** for CPAPDex/PpgDex. `EVENT-LEXICON.md` says impulses are keyed by the *event*,
  not the observer, and lists CPAPDex as a first-class `desat_event` emitter. Separately, CPAPDex's
  `apnea`/`hypopnea` events are consumed by no fusion rule and `hypopnea`/`rera` are absent from the lexicon.
  **Repro:** `c8-cpap-desat.mjs`.
- **§16 · The kernel-drift audit is blind to 3 of 7 nodes.** ECGDex/PpgDex/GlucoDex stamp the **raw
  `DexKernel`** (`{K, VERSION, HASH}` — `ecgdex-dsp.js:1831`, `ppgdex-dsp.js:1154`, `glucodex-dsp.js:1069`
  pass `opts.kernel` through); OxyDex/PulseDex/HRVDex/CPAPDex **normalize** to `{version, hash}`. The
  Integrator reads lowercase `.hash` (`:359`, `:498`). So on **every** real multi-node night the user is
  told *"Node ECGDex built against kernel (none), expected 118ebed5 — thresholds may differ"* — **false**;
  the export carries exactly `118ebed5` under `HASH`. Worse, a **genuine** kernel drift produces the
  *identical* `missing` verdict: the gate cannot distinguish drift from its own blindness. **Repro:**
  `repro-kernel-audit.mjs`.
- **§17 · OverDex names an undated export with today's date.** `overdex-app.js:315` —
  `new Date().toISOString().slice(0,10)`, the exact fabrication `integrator-app.js:130` documents as
  deliberately **dropped** ("a Clock-Contract fabrication"). OverDex never adopted the shared `exportName()`,
  which already yields `undated`.
- **§18 · OxyDex renders "Coupling 0 %" in red on a night with zero desaturations.** `oxydex-dsp.js:3512`
  — `: 0` where the renderer's own guard (`oxydex-render.js:1880`) was written expecting `: null`.
  Coupling is *undefined* with no nadirs (0/0), not 0. One-token fix. **Repro:** `f-oxy-coupling.mjs`.
- **§19 · The population default profile is indistinguishable from an entered one.** A user who entered
  **nothing** gets BMI **28.8 "Overweight"**, BSA 2.07, RMR 1796, HRmax 179, VO₂max 40 ("Good", 50th pct) —
  and the ECGDex export ships `personalization.profile = {age:42, weightKg:89.8, …}` under the note *"null =
  left on auto/default"*, which those fields can never be. `dex-profile.js` **does** carry `origin:'pop'`,
  but every consumer drops it (`derive()` returns no origin; `ecgdex-profile.js:44` `num(p.age)||42`). The
  same files already gate `hrRest`/`vo2` on `origin==='detected'` — the discipline was never applied to
  age/weight/height. **Repro:** `f-profile-pop.mjs`.
- **§20 · CPAPDex night ODI/T90 are an unweighted mean of per-session rates.** `cpapdex-fusion.js:131`
  averages the *rates*; every other per-night index pools correctly (`residualAHI = nA/totHours`). A real
  6.38 h + 0.68 h night → ODI **5.97** vs pooled **3.68** (×1.62 overstated). Latent until an SA2 oximeter
  is attached (the committed corpus has none) — which is the entire reason the lane exists.
  **Repro:** `repro-cpap-odi.mjs`.
- **§21 · Evidence-badge coverage holes.** Four **unbadged hero numbers** (`hrvdex-render.js:233`,
  `pulsedex-overview.js:131`, `oxydex-render.js:674`, `cpapdex-render.js:455`) while their own subscores
  directly below are correctly badged — and HRVDex's hero *is* Welltory's black-box score
  (`hrvdex-dsp.js:103` `parseFloat(r['HRV Score']||0)` — which also turns an **absent** vendor score into a
  real-looking `0`, rendered *"Strained · Prioritize rest"*). **OverDex loads no badge engine at all**
  (`OverDex.src.html` has no `metric-registry.js`) yet renders a fused clinical KPI grid.
  `hrvdex-render.js:271` hardcodes the ladder word `validated` as markup on a card whose own CAI metric is
  `emerging`. `.ev-corner` — the mandate's card placement — is used in **no** app render file.
  **Repro:** `c7-unbadged.mjs`.

---

## Verified CLEAN — do not re-hunt

- **The charter's own flagship suspicion is REFUTED.** ECG electrode-settling: 9 adversarial variants
  (20 mV/4 s and 32 mV/8 s leading transients, single- and 3-sample rail spikes placed to defeat the stall
  guard, a 25 mV step edge, a mid-record rail-to-rail saturation burst, lead+mid combined) on a 7 h /
  130 Hz night → **every variant analyzed the full 7.000 h, 25 194–25 203 of 25 200 truth beats, coverage
  100 %, rMSSD within 0.8 of clean.** The `_seedScale` global-p99 seed and the idle-bleed stall guard both
  hold. No silent collapse.
- **Spectral honesty: no proxies anywhere.** A planted 0.25 Hz tone, amplitude 40 ms (true band power
  A²/2 = **800 ms²**) → PulseDex **799**, ECGDex **799**, PpgDex **798**; same at 0.10 Hz (LF) and 0.02 Hz
  (VLF). Normalization, band edges, Hz integration and ms² units are all correct. Every surfaced
  LF/HF/VLF/total-power traces to a real Lomb–Scargle call; the old `hf ≈ rmssd²` estimator is gone.
- **The `÷N` vs `÷N−1` SDNN bug stays fixed.** Same beat truth through every path: SDNN **0.054 %**,
  rMSSD **0.024 %**, pNN50 **0.138 %**, triangular index **0.25 %**, SD2 **0.025 %** max delta. (`std()` is
  ÷N−1 and identical in all four nodes. Only `poincareGeo`'s hand-rolled SD1 drifts — 0.17 % at n=22k,
  2.5 % at the 20-beat epoch floor; `ecgdex-dsp.js:62` uses ÷N of the diffs. Low.)
- **Viewer-timezone independence holds** — 6 real recordings, byte-identical volatile-stripped digests and
  identical `startEpochMs` under `TZ=UTC / +14 / −11 / −4`. No non-UTC getter on a floating `tMs` anywhere
  in the fleet. **No `now()` fabrication in any compute path** (a stamp-less O2Ring CSV → `null`, not today).
  Midnight rollover, DST, and the EDF clock all correct.
- **O(N²) caps are disclosed and sound** — deterministic whole-record uniform-stride decimation with the
  tolerance scaled to the pre-decimation SD, each with a justifying comment. Not head-slices. (§9 is a
  *different*, undisclosed cap.)
- **Parsers are honest** on empty / whitespace / header-only / single-sample / stamp-less / garbage input —
  `usable:false` + a specific reason, or an informative throw. Never a plausible-but-empty result.
  All-zero Verity `_HR.txt` and header-only `_PPI.txt` (the CLAUDE.md-documented cases) are handled.
  Foreign-stream routing is clean for MAGN / GYRO / Verity ACC — **only** the H10 ACC gets through (§2).
- **Metric-is-canonical holds** — `dex-profile.js` persists SI only; imperial is a display-boundary flag.
  No persisted imperial value, no math in imperial.
- **GlucoDex's unit handling is correct** — `MGDL_PER_MMOL` at parse, GMI/eA1c/J-index/Kovatchev in their
  published mg/dL forms, GRADE correctly converted to mmol/L first. **CPAPDex EDF scaling is correct**
  (verified against the real `*_PLD/BRP/SA2.edf`).
- Already handled, don't re-file: the Integrator warns loudly for an unknown node and for a flat-summary
  shape; legacy `t`-only events reconstruct correctly; the `fascia` alias is a deliberate read-side seam.

---

## Punch-list (correctness first)

1. **§1 Clock DMY/MDY file-lock** — ✅ **EXECUTED 2026-07-11.** `clock.js` gained `DexClock.resolveDMY()`
   (scan once; day>12 proves DMY, month-slot>12 proves MDY, *both* proofs ⇒ contradictory ⇒ refuse, neither
   ⇒ fall back to `preferDMY`) + `opts.dmyLocked`, applied unconditionally so no single row can flip the
   order, with a contradicting row returning `null` rather than a fabricated date. `oxydex-dsp.js parseCSV`
   resolves the order before parsing any row; `computeStats` now yields `durationMin: null` +
   `clockNonMonotonic` instead of a negative number. Back-compatible (`dmyLocked` optional, defaults off).
   **Gated:** a new clock group (§3 lock, 9 asserts) + a metamorphic OxyDex group — *the same night written
   DMY vs MDY must compute identically* — which **reds on the original bug** with the exact audit numbers
   (`durationMin −254460`, `t0Ms` 6 months adrift). All 39 real O2Ring nights parse byte-identically; **no
   fixture output moved.** Re-bundled the 7 `clock.js` delegators (PpgDex/GlucoDex/CPAPDex keep node-local
   parsers, untouched). Behavior 2017/2017 · GATE A 8/8 · GATE B 16/16 · build drift clean.
   Changeset: `changes/2026-07-11-clock-dmy-file-lock.md`.
2. **§2 ACC-as-RR** — ✅ **EXECUTED 2026-07-12.** `adapters/polar-rr.js detect()` now vetoes a foreign PSL
   stream by **name** (`_ACC`/`_MAGN`/`_GYRO`/`_PPG`/`_ECG`) **and by declared unit** (`[mg]`/`[G]`/`[dps]`/
   `[uV]`/`[nT]`, so a *renamed* file is still refused), and the bare `Phone timestamp` envelope — which
   **every** PSL stream carries — no longer votes for an RR stream on its own; an `RR-interval`/`PP-interval`
   column does. The real H10 `*_ACC.txt` now reports `ROUTE: UNKNOWN → set aside`. Genuine `*_RR.txt`/
   `*_PPI.txt` still route to `polar-rr` @0.97 and `*_PPG.txt`/`*_ECG.txt` to their own adapters, unchanged.
   **Gated:** 5 new route-precedence asserts (incl. the renamed-file and bare-envelope cases) that **red on
   the original bug** ("routed to polar-rr @0.6"). Adapters inline only into the two orchestrators → **no node
   re-bundle, no fixture churn.** Behavior 2022/2022 · provenance PASS · build clean.
   Changeset: `changes/2026-07-12-polar-rr-foreign-stream-veto.md`.
   **Residue:** the two *deeper* layers still fail open — `pulsedex-dsp.js:289 _pdIntervalColByRange` accepts
   any column whose median lands in 300–2000 (no unit/header check), and the `usable` gate never asks whether
   the values behave like *intervals* (the gravity rail's SDNN 9.5 ms over 3 h is impossible and went
   unquestioned). The adapter veto closes the reachable production path; hardening PulseDex itself is
   defence-in-depth and needs a judgement call on rejecting genuinely low-variability recordings → carry to
   the follow-up brief.
3. **§3 + §4 HRVDex** — ✅ **EXECUTED 2026-07-12.** §3: every spectral derivative (`d_lfhf`, `d_hfnu`,
   `d_lfnu`, `d_svi`, `d_sdi`, `d_rsa`, `d_sai`, `d_vlf_hf`, `d_spectral_ent`, `d_lfhf_totpow`) now gates on
   its inputs being **present** — mirroring the existing `_hasSubj` rule — and reads `NaN` when they are not.
   The `|| 0.001` epsilon denominators are gone, `d_sdi`'s always-truthy guard (a `+0.001` term saw to that)
   is gone, and `d_spectral_ent` no longer fabricates a VLF share via a `|| 0.0001` floor. §4:
   `d_mxdmn_meanrr` now uses the **same guard-normalized operands as `d_csi`** — which is literally the same
   quantity — so it is unit-invariant and the two agree exactly. Also made the derivation genuinely headless
   (`getProfile()` guarded — it previously *threw* outside the app, which is why nothing ever gated these
   columns) and exposed `HRVDex.derive()` / `HRVDex.rowFromNodeExport()` as the headless surface.
   **Gated:** a 20-assert group that **reds on the original math** with the exact audit numbers
   (`d_hfnu = 125000000`; `d_mxdmn_meanrr = 0.000436` vs `d_csi = 0.4364`). The honest path is provably
   untouched — with all four bands present, `HFnu + LFnu` is **exactly 100**. Export-inert: **no fixture
   output moved**. Re-bundled HRVDex + the two orchestrators.
   Behavior 2042/2042 · GATE A 8/8 · GATE B 16/16 · build drift clean.
   Changeset: `changes/2026-07-12-hrvdex-spectral-presence-gate.md`.
   **Residue:** `_envToSeed` still seeds absent objective columns to `0` (`n()`); the new `> 0` presence
   gates make that harmless today (a real band power is never exactly 0), but `null` would be the honest
   seed — carry to the follow-up. Unchanged and still open: HRVDex's export writes `measurements[]` while
   the Integrator reads `hrv.time.*` (§14), so HRVDex still cannot join the HRV consensus.
4. **§5 + §6 GlucoDex** — ✅ **EXECUTED 2026-07-12.** §5: long gaps now carry `FLAG.GAP_LONG` and are
   excluded from every distribution metric (still drawn, still counted as inactive time, so `pctActive` /
   `gapMin` keep their meaning); short gaps stay analyzable. Applied to the daily distribution and to
   `nightCV` too — and because an overnight dropout now correctly leaves `nightCV` null, the
   `nocturnal_glucose_risk` composite no longer silently substitutes the **daytime** CV (it returns null
   and the event is not emitted). §6: the clip test now compares like for like — the count AT the bound vs
   the mean per-bin count of the two bins just inside it — at a **2.5×** threshold chosen from measured
   anchors: a genuine nocturnal nadir piles up only **1.7×** (an arcsine/turning-point effect — real
   glucose lingers at its nadir), the real Lingo rail is **3.2×**, a hard synthetic rail **184×**.
   **The false-positive control is the important half** and is gated alongside the detection: flagging a
   real nadir as a clip artifact would *hide true hypoglycemia*, which is worse than the bug being fixed.
   **Gated:** a 9-assert group driven through `compute()` on synthetic traces (uploads/ is gitignored, so
   CI cannot depend on the real file) that **reds on the original code** (TIR 12.9 % vs 0; the realistic
   rail undetected). ⚠️ The rail case had to be built with a *populated, rising* density above the floor —
   a naive rail with nothing above it does NOT reproduce the bug, because the old 5-wide slab is only
   swamped when the bulk of the distribution sits inside it.
   **Fixture MOVED** (the first of this audit): regenerated by re-running `compute()` on the committed
   input, never hand-edited — the export now carries `clamp:{detected:true, floor:54, blindMetrics:[…]}`,
   37 events gain `meta.clampFloor`, and `sd`/`cv`/`mage`/`tir` shift as long-gap fill drops out. The
   `outputHash` was re-recorded with a method first validated against the 15 untouched fixtures (all 15
   reproduce their recorded hash exactly). **A long-standing assertion that this fixture was a "clean,
   unclamped file" was itself wrong** — the real Lingo export always rails at 54; the old detector just
   could not see it. That assertion now encodes the truth.
   Behavior 2052/2052 · GATE A 8/8 · GATE B 16/16 · build drift clean.
   Changeset: `changes/2026-07-12-glucodex-gapfill-and-clip-floor.md`.
5. **§7 + §8 + §9 OxyDex** — ✅ **EXECUTED 2026-07-12.** §8: desat events now carry `tMs`/`startTMs`/`endTMs`
   from their OWN rows; both consumers (bus export + `oxydex-fusion`) read them, with the index mapping kept
   only as a legacy fallback. Exported `tMs` now equals the true row stamp exactly (0.0 s); the old mapping is
   **952 s** off on the same input, against a 60 s gate. §9: `computeSpO2FFT`/`computeDFA` no longer head-slice
   to the first hour — the committed `_0439` fixture's FFT cycle length moves **100 s → 143 s** on this fix
   alone. §7: the stage proxy self-reports `plausible:false` + a reason past a 30 % ceiling; the KPI never
   renders 'good' for it (**all 39 real nights flagged; 0 now render "good", previously 39/39 did**); and the
   Integrator refuses to fold an implausible proxy into the staging consensus, **re-checking the ceiling itself
   so LEGACY exports are caught too** — on the real trio night the false 67.7-pt `staging_disagreement`
   disappears. Deliberately NOT done: re-deriving the REM estimator (research, not an audit fix) — the node
   now refuses to assert an impossible number as a healthy finding, which is the node-side half §T2 promised.
   **Gated:** a 12-assert group on a synthetic LOSSY night (the shape a clean 6-min equiv clip can never
   expose) that **reds on the original code** (952 s drift · cycle 20 s vs 50 s · `plausible: undefined`), incl.
   a control asserting the OLD index mapping really is wrong on that input. **Both OxyDex fixtures regenerated**
   by re-running `compute()` on their committed inputs. Behavior 2064/2064 · GATE A 8/8 · GATE B 16/16 · biome clean.
   Changeset: `changes/2026-07-12-oxydex-event-clock-windows-rem.md`.
   **Residue:** the *tail*-slice family (`computeSpO2Autocorr`/`computeHRFreqBands`/`computeRespRateProxy`/
   `computeSpO2HRLag` use `rows.slice(-USE)` = the last 30–60 min, undisclosed) is untouched — same class, but
   not proven to move a surfaced number. `remProxyPct` also still denominates on RECORDING time while ECGDex's
   `remFraction` denominates on SLEEP time; moot while the proxy is suppressed, but it must be reconciled if
   the estimator is ever re-derived.
6. **§12–§16 Integrator** — ✅ **EXECUTED 2026-07-12.** §12: an incomparable spread is `null`, `qc` is
   `incomparable`, and the note refuses to claim agreement (`|| 0` no longer turns absence into a measured
   0 %). §13: the read-chain now knows `glucose.cv` (what the LIGHT ganglior export actually writes — the
   only file users are told to drop in), and the single-pair fallback **requires the pair to carry a glucose
   value** — a coupling between two signals cannot be estimated from one of them. §14: HRVDex's
   `measurements[]` are READ (median), so the HRV node is no longer silently dropped from HRV fusion; its
   window is labelled `measurementMedian`, **not** `wholeRecord` — a month of Welltory spot readings is not
   an overnight whole-record value, and tagging it so would let R8's like-window guard stage a false
   comparison. The exclusion is now REASONED and VISIBLE rather than a silent null. §15: the desat pool is
   keyed by IMPULSE, not by node label, so CPAPDex/PpgDex `desat_event` streams corroborate apnea (metamorphic:
   a byte-identical stream used to vanish when only the emitter's label changed). §16: the kernel reader
   accepts BOTH spellings — so exports already in the wild audit correctly — **and** the three pass-through
   emitters (ECGDex/PpgDex/GlucoDex) are normalized to the contract `{version, hash}` shape. All three nodes
   now read `match` instead of `missing`, and a genuine drift is finally distinguishable from the audit's own
   blindness.
   **Gated:** a 15-assert group that **reds on the original code** (`kernelHash: null` · HRVDex `rmssd: null`
   · CPAPDex `apnea = NULL`). Export-inert on the equiv path — **no fixture output moved**.
   Behavior 2079/2079 · GATE A 8/8 · GATE B 16/16 · biome clean.
   Changeset: `changes/2026-07-12-integrator-readset-and-kernel-audit.md`.
7. **§10 + §11** — one gated ECGDex/PpgDex spectral re-bundle (shared call sites, shared fixture cost)
8. **§17–§21** — hygiene: `exportName()`, null-not-zero, profile origins, ODI pooling, badge coverage

## Follow-ups spawned
Per `CLAUDE.md` §📌, a `DEEP-AUDIT-FOLLOWUPS-…-BRIEF.md` will capture what execution surfaces. The
**gate blind-spot** this audit exposed — every equiv fixture is a clean ~6-min clip, so §1/§8/§9 were
structurally invisible — is itself the highest-value follow-up: add a **long, lossy, real** night to the
equiv set.
