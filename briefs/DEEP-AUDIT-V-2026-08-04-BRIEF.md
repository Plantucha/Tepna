<!--
  DEEP-AUDIT-V-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-04 · **Charter:** `AUDIT-PROMPT.md` · **Sibling:** `DEEP-AUDIT-IV-2026-08-04-BRIEF.md` (same day, solo pass — its two findings are context here, not re-filed)

# Deep audit V — the arithmetic held; identity did not

A 10-hunter `AUDIT-PROMPT.md` fan-out, one hunter per uncovered dimension, **every candidate faced by an
independent adversarial refuter** instructed to default to `refuted=true` under doubt. 36 agents,
**24 candidates → 20 survived, 4 killed**, plus 66 claims the hunters refuted themselves before filing.

Deliberately pointed at what `DEEP-AUDIT-III`, `DEEP-AUDIT-III-FOLLOWUPS-II` and `DEEP-AUDIT-IV` all left
alone — `integrator-tch.js`, `event-coupling.js` internals, `integrator-longitudinal.js`, `capture-host/`,
and the fleet-wide sweeps of classes 1 / 3a / 10 / 13 / 14.

---

## 0 · Baseline — and one thing every prior audit got wrong about it

| run | result |
|---|---|
| `npm run test:par` (as any worktree runs it) | **5782 passed · 12 skipped · 385 groups** |
| `DEX_UPLOADS=/run/media/…/Tepna/uploads node tests/run-tests.mjs --jobs=auto` | **5823 passed · 0 skipped · 385 groups** |

**41 assertions — the corpus-backed GATE-C equivalence legs — asserted NOTHING for the whole of audits IV
and V until this run.** They pass. That is a real result: it means **none of the 20 findings below has
moved a committed export**, which is consistent with their nature (absent inputs, partial coverage, and
labels — not the golden paths). It is also a standing trap: **`DEX_UPLOADS` is not set by default, so the
gate that proves current code still reproduces every committed export is dark in every fresh worktree.**
Set it before believing any equivalence claim, including the ones in this brief.

---

## 1 · The result that matters most: the arithmetic held

Ten hunters plus a refuter each attacked the numerical core and **found nothing wrong with it.** Recorded
here because a negative result from an adversarial pass is evidence, and because it should stop the next
auditor spending a hunter on it:

- **The coupling permutation p-value is correctly calibrated.** 500 independent uniform-Poisson trials
  through the Integrator's exact configuration → **4.8 % FPR, flat histogram**. `DEEP-AUDIT-III`'s
  measured 54 % is **fixed and stays fixed**. Shared slow non-stationarity (both streams denser in the
  second half of the night) does **not** break it either: 6.0 % / 5.3 % vs a 6.0 % uniform control.
- **TCH negative-variance handling is honest.** Every path into `sigma2` passes `Math.max(x,0)` *after* a
  `>= -1e-9` tolerance test; a genuinely negative solve returns `{negative:true}`, never `NaN`, never a
  confident tiny sigma. The `rho` sweep does reach `rhoMax` (`+EPS` beats the 6e-16 drift). `n<3` is
  unreachable — `minN` defaults to 12 at every caller.
- **Sigma IS quoted with its N.** `integrator-render.js:1183` prints "across N co-recorded sites over M
  epochs (common-mode rho=…, method)" plus the precision-not-trueness caveat — the §7 discipline holds.
- **Lomb–Scargle Parseval calibration is correct in all three nodes.** The five crossnight `*-cross.js`
  clones are byte-identical. Every fleet HRV estimator agrees on the same RR truth.
- **All five Clock-Contract parsers agree** on §2.7 component-range rejection **including** the ISO
  `24:00:00` exception. Four real files exported byte-identically across a **±25 h timezone swing**.
- `integrator-tch.js`'s `÷N` variance vs `analysis-stats.js`'s `÷(N−1)` is real, intentional and
  **algebraically immaterial** — every pairwise variance scales by the same factor and the classic hat is
  linear in them.

**What failed is identity.** Seven of the nine top findings are one sentence with different nouns: *a
string was spent as a thing it is not.* `PpgDex` as a device (§2.1). `_MAG` as an ECG (§2.2). a Coospo
device name in a log file as a recording (§2.8). a start date as a night (§2.4). a zero as a measurement
(§2.3, §2.5, §2.6). The suite has excellent machinery for asking *"is this number right"* and almost none
for asking *"is this label entitled to the authority it is being given."*

---

## 2 · Findings (20, post-refutation), by module

Ranked within each group. `[V]` = a refuter corrected the mechanism, severity or fix; **the corrected
version is what ships.**

### 2.1 · Integrator — TCH and fusion identity

**F4 · TOP — the decorrelation screen's AMBIGUOUS verdict is computed and thrown away.**
`integrator-dsp.js:2577` implements two of `screenTriplet`'s three documented outcomes: it branches on
`scr.drop` and never on `scr.ok`. When the screen says *"3 nodes mutually decorrelate — cannot identify
the reliable pair"*, the Integrator publishes a confident per-sensor sigma card anyway.
Repro (`/tmp/tchaudit/e9.mjs`, three real 96-epoch exports): screen returns
`{ok:false, drop:null, ambiguous:true}` → `block.tchStatus:"ok"`, sigma
`{ECGDex:19.99, PpgDex:0.51, HRVDex:30.77}`, **ambiguity surfaced nowhere (`keys: []`)** — pure garbage
ranked QUIETEST and handed **79 % of the inverse-variance fusion weight**.
*Fix:* branch on `scr.ok === false` across **all four** refusal returns, attach `reason`/`corr`/`ambiguous`,
degrade to pairwise consensus. *Gate:* `build.mjs --app Integrator --app OverDex` + `npm run check`;
golden's triplet is screen-clean ⇒ expect export-inert, **confirm** via `env.equiv`.

**F5 · TOP — corner identity ≠ node label; two corners sharing a label silently collapse.**
`integrator-tch.js:405 _bylabel` assigns `o[labels[0..2]]` with no uniqueness check, and
`integrator-dsp.js:2547` builds `labels` straight from `schema.node`. The real capture tree writes **both**
a Verity `_PPG` and an O2Ring `_PPG` per night and routes **both to PpgDex**.
Repro (`/tmp/tchaudit/e6.mjs`): `sigma2` returns **2 keys, not 3** — the Verity's sigma is overwritten by
the O2Ring's, and the surviving PpgDex weight is applied to **both** PpgDex rows in the reconciled mean.
`dedupeRecs` also dropped one of the two exports outright.
*Fix `[V]`:* disambiguate `labels` **and** re-key `levels`, `coMotion`, `allanTriplet.adev` **and
`rm.values`** — the refuter established that without `rm.values` the reconciled RMSSD silently degrades to
ECG-only. `_bylabel` must refuse on non-distinct labels. Thread the device key through `dedupeRecs`.

**F6 · a negative Allan split is published as `adev = 0`.** `integrator-tch.js:162` pushes
`sqrt(max(cl.a,0))` with no flag, so a tau where the three-cornered split goes negative (common-mode
noise — the normal overnight case) draws a finite point at the bottom of the chart: *"perfectly steady at
40 min averaging"*. **The in-code comment claiming this matches the sigma-bar path is false** —
`threeCorneredHat:340` only clamps inside ±1e-9 and otherwise sets `negative`.
*Fix:* push `null` past the same tolerance + return `negativeAt[]`. Makes the renderer's existing
null-break comment true by construction; no render change needed.

**F7 · TOP — the longitudinal join uses the recording's START date, so a post-midnight bedtime collides
with the next night.** `integrator-longitudinal.js:216` keys `node|date` off
`crossnight-envelope.js:100`'s `fmtDateUTC(t0)` and line 230 overwrites unconditionally.
Repro (`/tmp/eca/long1.mjs`, 25 real nights per node): a 00:01 start lands on the next date →
**49 rows stored where 50 were supplied**, OxyDex series 24 vs ECGDex 25, `2026-06-27` missing from OxyDex
entirely — **one real night destroyed with no warning**, and the same-night cross-node pairing lost. The
UI still says *"absorbed 25 … (persisted)"*.
*Fix `[V]`:* a **scoped** post-midnight shift, **not** a blanket noon anchor (which would re-date
ambulatory sessions), plus the IndexedDB re-key/store-version bump, an honest `rows` count, and a
collision WARN. **The WARN + honest count are worth landing even if the date convention is deferred.**

### 2.2 · Ingest and routing — a label spent as a device

**F10 · TOP — `_MAG.txt` classifies as an ECG primary.** `dex-ingest.js:104`'s `ecgKind` skip-rule still
requires `_MAGN`; `DEEP-AUDIT-III §6.4a` widened every *other* classifier to `_MAGN?` and **missed this
one sibling**, so `ecgKind` fails open to `'ecg'`.
Repro: **813 real `*_MAG.txt` files classify as `ecg`.** A 0-byte MAG survives the app's byte sniff, puts
`POLAR_VERITYSENSE` into `planIngest`'s ECG device-anchor set, and thereby admits **6 Verity arm-band
`_ACC.txt` as ACC companions for H10 chest ECG** — which changes exported `meta.position` from lateral to
upright. *Fix:* `MAGN` → `MAGN?` in **both** alternations, plus the two missing gate assertions and a
0-byte sniff guard. **File the single-slot `DEVICE_ACC` pairing defect separately** — do not let this fix
imply it is closed.
⚠️ **§4.7:** the classifier and the plan are reproduced twice; **the exported position flip has never been
observed in a real export** and the refuter showed it is load-order dependent.

**F11 + F24 · a device NAME inside a data row routes a log file as an RR recording.**
`adapters/coospo-rr.js:40/60` tests `/coospo|hw9|h808/i` against `name + ' ' + head` where `head` is the
first 2 KB of **file content** — and the capture host's own `Tepna_*_LINK.csv` lists every BLE peer by
advertised name. **27 real non-RR files route to PulseDex at 0.95, `ambiguous:false`.**
The frame correctly reads `usable:false`, but `PulseDex.compute` still yields
`durationMin 723.6, beats 2808, coveragePct 0.2` from a stream of literal `24`s.
*Fix:* gate on `DexIngest.nonSignalName()` (which **already** returns true for `_LINK`) and/or require the
vendor token in the NAME or header LINE. Update `how-to-collect/coospo-rr.md:19` in the same commit.
*Gate:* orchestrators only — **no GATE-A entry, no fixtures, no `verify-fixtures`.** Cheapest real harm
reduction on this list.

### 2.3 · OxyDex — three fabricated absences

**F15 · TOP — a missing Motion column is rendered as a night of perfect stillness.**
`oxydex-dsp.js:626`: `motionCol >= 0 && … ? p[motionCol].trim() : '0'`. A 3-column oximeter CSV **is** a
supported OxyDex input (`oxydex-spo2` detects it at 0.8).
Repro — the same real night with the Motion column removed, SpO₂/HR/tMs byte-identical (24 412 rows):
`motionPct 1.2 → 0`, **Sleep Efficiency 100 %, Arousal Index 0, WASO 0**, a perfect 100/100 motion
sub-score inside the Sleep Stability Score, and a per-epoch `motionIndex` of 0 exported to the Integrator.
**The correct pattern is eight lines below the defect in the same function** — `pi_pct = 0` is explicitly
treated as absent, with a comment saying why. Class 14 inside a single function.

**F22 · TOP — a Cheyne–Stokes flag on every recording under 20 min.** `oxydex-dsp.js:3772`
initialises `crcIdx = 0` and only computes when `spo2Means.length > 3`, so on a short recording the
un-computed `0` satisfies the CS "low cardiorespiratory coupling" criterion (`crc < 0.2`).
Repro (real night truncated): `5min/15min/19min → csScore = 1` → **"Cheyne-Stokes: Possible"** as a
warn-severity entry in `summary.ranked`, and `crcIdx: 0` exported as a real measurement.
*Fix `[V]`:* `crcIdx = null` when not computable **and move the render block gate to `if (n.cross)`** —
the refuter established the render-side change is required or the null merely renders as blank inside a
card that still claims to show a coupling.

**F23 · the stuck-motion-column guard is structurally blind under 10 min.** `oxydex-dsp.js:3219`
`_motionColumnStuck` needs a contiguous 600-sample non-zero run, so a 592-row recording with a 100 %
stuck column is not condemned — and then publishes **exactly the four numbers the guard exists to
suppress**: `motionPct 100`, `sleepEff 0` (ranked RED), `arousalIndex 100`. Real files at both sides of
the boundary exist in the corpus (592 and 642 rows, both `motionZero=0`).
*Fix:* make the run-length **relative** to record length; the deliberate update to the 599/600
`=== false` assertions is part of the change.

**F1 · evidence honesty — `Mean` and `Min` SpO₂ badge `experimental` while `OXY_REGISTRY` grades them
`measured`.** Three tiers off, in the same four-tile grid as T95/T90 which correctly show `validated`.
`OXY_LABEL_ALIAS` carries `'mean spo₂'` but the render passes the bare `'Mean'`.
*Fix `[V]`:* **rename the three call sites** (`'Mean SpO₂'`, `'Min SpO₂'`, and the missed
`ssKPI('Perfusion Idx')`) — **do NOT add bare `mean`/`min` aliases**; they are section-relative and
`meanHr`/`minHr` have an equal claim. Decisive on gate cost: the rename is render-only ⇒ `computeHash`
provably stable ⇒ **export-inert PROVEN**; the alias route touches the registry, moves `computeHash`, and
makes `verify-fixtures` mandatory.

### 2.4 · PpgDex

**F12 · TOP — absolute physical thresholds applied to IMU columns whose declared unit is never checked.**
`ppgdex-dsp.js:2203` normalises with `v/120` mg and `v/40` dps, while `parseSensorXYZ` never reads the
`[mg]`/`[dps]`/`[G]` token and has no range check. On **543 real corpus files** the GYRO column is raw LSB
(16.384× dps), saturating the motion gate.
Repro on a real 2026-07-18 Verity night: `analyzablePct 20 → 66`, `rMSSD 77.3 → 99.2 ms`, `sdnnRobust
87 → 94.3` when the gyro is scaled to true dps. The no-gyro control gives 68 % / 100.4 ms — i.e. **the
mis-scaled gyro is worse than no gyro at all.**
*Fix `[V]`:* **(a) porting `motiondex-dsp.js`'s `streamKindFromHeader` + `xyzPlausible` guard alone is a
no-op for the headline; (b) the unit oracle is the load-bearing half.** Ship both, plus `magBaseG` → µT.
⚠️ **§4.7:** the headline magnitudes come from one hunter with one confirming reader — **reproduce before
this drives a DSP edit.**

**F13 · `hostAxis.independent` is dropped at the export boundary.** `ppgdex-dsp.js:550` copies
`ok`/`ppm`/`totalMs`/`maxStepMs` and drops `independent`/`spreadMs`/`inertReason`, then stamps
`timingSource:'device+host'` from `axisDrawn` alone. Repro on a real phone-captured file: DexClock returns
`independent:false` with *"host ≡ device — residual spread 0.94 ms ≤ 2 ms … not an independent clock"*,
and the export claims the top provenance tier anyway. This is `CLAUDE.md` §7's explicit instruction —
*read `independent`, never a ~0 ppm* — discarded one line after it was computed.

**F19 · `accFs` = count ÷ PPG-duration — the exact defect `DEEP-AUDIT-III §4.1` fixed in MotionDex and
ECGDex.** Same real file: **MotionDex 52.00 Hz, PpgDex 19 Hz.** Corpus scan: 103 of 386 pairs below 0.9 of
native, 68 below 0.7, worst ~12 Hz.
⚠️ **A near-identical claim was KILLED** (see §3) because `PpgDex Reference.html:418` documents the metric
as an *"**effective** accelerometer sample rate"*. **File this only if the surfaced KPI label and the
node-export `motion{}` field also say "effective"** — otherwise the refutation applies here too. Verify
first; this one is the least safe on the list.

### 2.5 · ECGDex

**F20 · the two inline browser parsers skip the §2.7 component-range guard.** `ecgdex-app.js:48`
(`WORKER_SRC._ckPF`) and the main-thread `parseTSfloat` build `tMs` with a bare `Date.UTC(...)`.
Repro: `2026-02-30T12:00` → **2026-03-02**, `2026-13-45T25:99:99` → **2027-02-15**, where `clock.js`
returns `null`. Both set `t0Ms`, the anchor for the whole recording — a fabricated night.

**F21 · the browser ingest is a third parser sibling that never emits `endEpochMs`** and never applies the
host-axis `fs` correction. Repro on a real H10 night: headless `fs 130.0026, endEpochMs 1785658138860`;
browser worker `fs 130, endEpochMs undefined`. `ECGDSP.analyze` reads `rec.endEpochMs`, so **every
browser-produced ECGDex export** differs from the gated headless one.
*Fix `[V]`:* ship `clock.js`'s `parseTimestamp` **and** `hostAxis` into `WORKER_SRC` via
`Function.toString()` — the `WORKER-REALM-GATES-2026-07-12` prescription and the `ppgdex-dsp.js`
precedent — **do not hand-port `_ckMk` into a second copy.** F20 and F21 are one change.
*Gate:* `manifestHash` moves, **`computeHash` does NOT** (`/-app\.js$/` is `DISPLAY_ONLY`) ⇒ export-inert
**proven**, no `verify-fixtures` owed. Cheapest correctness-adjacent item on the list.

### 2.6 · PulseDex

**F16 · ABS renders `0.000` = "perfectly balanced / ok" when the spectral estimate is unavailable.**
`pulsedex-dsp.js:254 absIdx` guards `ps + sn ? … : 0`, and `ansBalance` deliberately returns
`{sns:null, psns:null}` — `null + null === 0` is falsy, so ABS returns the exact centre of its −1..+1
scale and the research table renders it green against target `~0`. Siblings `siCalc`, `crsIdx`, `fe`,
`rsa` and the `nu` pair share the shape; **`crsIdx` is the demonstrated instance (12/214 recordings graded
`bad`), `absIdx`'s end-to-end trigger remains a HYPOTHESIS.** Fix them together with the render sites that
must print `—`.

### 2.7 · capture-host — the producer seam

**F17 · TOP — the O2Ring's synthesised timestamp column now certifies itself as a real device clock.**
`capture-host/capture.py:629`. Since the 2026-07-27 rate-slew fix, a `sensor timestamp [ns]` column built
**entirely from host arrival times + an estimated rate** classifies `drawn:false` /
`timingSource:'device+host'` — the top provenance tier — and ships that claim in the node export. The slew
fix erased the very signature the drawn-axis detector looks for: `quantizedShare` **0.00083**.
This **contradicts an established repo fact** (`O2RING-SYNTHESISED-AXIS`, and `CLAUDE.md` §7's *"a device
whose axis was DRAWN is not a clock"*).
*Fix:* (b)(c) key `timingSource` on `site === 'finger'` covering **both** branches at
`ppgdex-dsp.js:550-551` and mirror in `tools/trio-batch.mjs:1413`; **retract `O2RING-SYNTHESISED-AXIS §5`,
`WEARABLE-HOST-AXIS-FOLLOWUPS §F1` and `PAT-PROXIMAL-DISTAL-PAIR §2/§2a`.** (a) Separately and worth doing
regardless: write `# axis=host-synthesised fs_source=estimated` into the file header — that moves
provenance from a statistical inference into the data. **Exports MOVE (`device+host` → `host`) ⇒
`regen-ppgdex-goldens.mjs` FIRST, then `verify-fixtures`.**

**F18 · `_PPI.txt` is written in PMD WIRE order, not PSL file order.** ✅ **FIXED — #961 (2026-08-05).** `capture-host/writers.py:233` puts
`sensor timestamp [ns]` in column 1 and `HR` before `PP-interval`; real PSL has neither. `parseDevicePPI`
is **positional**, so every beat is read as a ~8.4e17 ms interval, filtered out, and the device-PPI
cross-validation lane silently reports `nDevice: 0` — *"the device produced nothing."*
The existing pytest asserts a **header string** and never a parsed beat.
*Gate:* capture-host only. No JS bundle, no `manifestHash`, no fixtures.

### 2.8 · Evidence honesty — the registry-resolution family

**F2 · 21 of 53 HRVDex full-metrics columns badge `experimental` with an empty tooltip**, seven of them
Task-Force-standard metrics the sibling `PULSE_REGISTRY` grades `validated`/`measured`. **LFnu sits one
column from HFnu, which renders `validated` with a Task Force 1996 citation.** All are computed; only the
registry rows were never written. *Gate:* `computeHash` **moves** ⇒ `verify-fixtures` **mandatory** (both
HRVDex fixtures expire; `release.mjs` blocks otherwise).

**F14 · `badgeForLabel`'s unresolved branch calls `MetricRegistry.badge('experimental','')` directly**,
bypassing `MetricRegistry.entry()` and therefore its `console.warn` — a tier no registry assigned, issued
**completely silently**. ECGDex's `'PLV surge vs base'` gets it, while **CPAPDex renders the same quantity
at `emerging`, citing ECG_REGISTRY as the authority.** *Fix `[V]`:* alias to `crcPLV`
(`ecgdex-registry.js:173`), **not** `crCoupling:64`, and route all **eight** `badgeForLabel` clones
through `MetricRegistry.entry` so the fallback warns.

**F3 · MotionDex's body-position legend renders six percentages with zero badges**; `Prone` and `Unknown`
have no `MOTION_REGISTRY` row at all. `positionBar` builds its legend inline and never calls `evBadge`,
unlike its own siblings `kpi()` and `row()`. `CLAUDE.md` §🎫 names legends explicitly as placement (2).
*Fix `[V]`:* **wire `evBadge` into `motiondex-render.js:88` AND `glucodex-render.js:479 tirBar`** — the
refuter found the same defect in GlucoDex with **higher exposure**. Do not ship MotionDex alone. Both
files are `DISPLAY_ONLY` ⇒ export-inert proven.

---

## 3 · What NOT to chase — investigated and REFUTED

Four candidates were **killed by their refuters**, and the hunters refuted **66 further claims**
themselves. The highest-value rows:

| claim | verdict | evidence |
|---|---|---|
| `DEEP-AUDIT-III`'s 54 % coupling false-positive rate is still live | **REFUTED** | 500 trials, Integrator's exact config → **4.8 % FPR**, flat histogram. The +1/+1 exact permutation p is correctly calibrated. **Do not touch it.** |
| Circular surrogates manufacture coupling from shared slow non-stationarity | **REFUTED at the hour scale** | 300 trials from a shared ~1 h intensity hump → FPR 6.0 % / 5.3 % vs 6.0 % uniform control. (The **bout** scale, 5–20 min, is F8 — a different timescale.) |
| A TCH solve returns a negative variance → `NaN` → silently dropped | **REFUTED** | Strongly common-mode triplet → `{ok:true, negative:true, sigma:{…}}`, **zero NaN**. Every path clamps after a tolerance test. |
| `allanTriplet`'s zero-clamp is caused by common-mode noise | **MECHANISM REFUTED** | The clamp is real (443/3600 tau-points at N=24) but injecting common-mode σ=3 moved it 440→419, i.e. nothing. **F6 ships on the honesty of `0`-vs-`null`, not on this mechanism.** |
| `correlated()`'s `rho` sweep never reaches `rhoMax` | **REFUTED** | `iterations 96, last rho 0.9500000000000006, reaches 0.95? true` — `+EPS` (1e-9) beats the 6e-16 drift. |
| The Integrator quotes sigma without its N (the §7 ppm analogue) | **REFUTED** | `integrator-render.js:1183` prints sites, epochs, rho and method. |
| `PpgDex accFs` under-reads the native rate | **KILLED** | Numbers hold (52.0 → 19 Hz) but `PpgDex Reference.html:418` documents it as the **"effective"** rate. **This is why F19 is filed conditionally.** |
| No `n<3` refusal in `threeCorneredHat` | **REFUTED** | `pairDiffVar` refuses at `d.length < 2`; `minN` defaults to **12** at every caller. |
| `integrator-tch` `÷N` vs `analysis-stats` `÷(N−1)` is a sibling defect | **REFUTED** | Intentional and algebraically immaterial — all three pairwise variances scale identically and the classic hat is linear. |
| "MotionDex has no regen tool" / "four surfaces have no render rig" (prior-audit precedents) | **BOTH CLOSED** | All nine roster nodes + Integrator have `regen-*`; 7 generic rigs + 3 bespoke legs cover every app. |
| `no-fabricated-tier` closes the fabricated-disc class fleet-wide | **REFUTED** | It scans only **string-literal** first args of `evBadge(`. F1/F2/F3/F14 all live in its blind spot. |

---

## 4 · Scope — what this pass did NOT cover

- **The browser lane — NOT COVERED, by any of the 36 agents.** No `Dex-Test-Suite.html?full`, no
  `verify-provenance.html`, no render-coverage rigs, no `tests/browser-gates.mjs`. Every render claim in
  F1, F2, F3, F4, F5, F14, F22 is a source-level derivation. **Run `BASE_URL=… node
  tests/browser-gates.mjs` (~9 min) before fixing any of them.**
- **The mutation harness — never invoked, in either language.** `tools/mutate.mjs` and
  `capture-host/mutation_triage.py` both exist and neither ran. capture-host is at
  `--cov-fail-under=100` statement+branch — exactly the regime where coverage is exhausted as a signal.
- **No end-to-end trace of one real recording** past the first arrow. Three live leads die at that seam:
  F10's position flip, F5's two-PpgDex arrival at `fuseHrvConsensus`, and `rec_to_psl.write_psl` deriving
  `Phone timestamp` from `POLAR_EPOCH + sensor_ns`.
- **Class 9 (provenance) — zero hunters.** It passes when run, with `verifiedUnder` on all 14
  corpus-backed fixtures. *Probably* fine — and "probably" is what this charter exists to abolish.
- **Class 11 — only the known canonical instance was checked.** 28 files carry
  `consensus`/`nAgree`/`agreementPct`/`concordance`. **The un-hunted high-value one:**
  `integrator-dsp.js:3504` collapses periodic-breathing observers **by NODE**, feeds `combineConf`, and
  prints *"corroborated across N **independent** signals"* — while an OxyDex export and a PpgDex export
  can be **the same O2Ring**. The respiration fusion already grew a `mechIndependent` guard
  (`:2968-3073`) after precisely this class; the PB path never got it. Same root cause as F5.
- **In nobody's report:** `cohort-worker.js` (644 lines, **zero** test-group mentions, the compute engine
  behind four shipped analysis pages) · `support.js` · `dex-profile.js` (the one place the
  never-persist-imperial rule can break) · `oxydex-fusion.js` · `cpapdex-fusion.js` ·
  **9 of 10 adapters**, 6 of them in no test group. Note the structure: `adapters/` loads **only** into
  the two orchestrator bundles that sit **outside GATE A's 8-app scope** — F11 lives there. Not a
  coincidence.
- **capture-host: one hunter, ~12 modules untouched** — `webmon.py`, `cpap_harvest.py`, `nightqc.py`,
  `timeline.py`, `polar_psftp.py`, all eleven `probe_*.py`. Concrete lead left sitting: **`125.738` is
  hard-coded as a coverage denominator in two independent places** (`nightqc.py:98`, `webmon.py:586`) for
  the stream whose axis F17 says is drawn.

**§4.7 — findings whose consequence is asserted, not observed:** F10 (position flip never seen in a real
export), F12 (headline magnitudes from one hunter), F22 (rendered CS flag never produced in a browser),
F8 (reachability on a real OSA stream unverified — the trio corpus is a healthy sleeper), F5/F4 (the
two-PpgDex arrival through the real fold). **Say this in any brief that ships them.**

---

## 5 · Prioritized punch-list

**Tier 0 — before fixing anything.** (0.1) **DONE in this brief** — `DEX_UPLOADS` run: 5823/0 skipped.
(0.2) `BASE_URL=… node tests/browser-gates.mjs` — re-bases every render claim. (0.3) independently
reproduce F12's magnitudes.

**Tier 1 — correctness.** 1.1 **F11/F24 coospo sniff** (best harm-to-cost ratio; orchestrators only, no
fixtures). 1.2 **F17 O2Ring `timingSource`** *(exports move ⇒ regen then verify-fixtures; retract three
brief sections)*. 1.3 F17(a) capture-host provenance header *(pytest only)*. 1.4 **F15+F22+F23 as ONE
OxyDex change** — landing them separately pays the OxyDex + OverDex + Data Unifier re-bundle three times;
commit a `synthetic_oxydex_o2ring_nomotion.csv` adversarial twin. 1.5 F12 **[serialize with audit IV's
`gatedEp` fix — same file, interacting motion path]**. 1.6 F10. 1.7 F16. 1.8 F4 → 1.9 F5 **[serialize]**.
1.10 F7.

**Tier 2 — silent failure.** 2.1 **F20+F21 as one ECGDex change** — cheapest correctness-adjacent item
(`computeHash` provably stable). 2.2 F8 *(local-density diagnostic, **not** a second short-band null —
measured 36–53 % residual FPR; **do not touch the p-value**)*. 2.3 F18 *(capture-host only)*.

**Tier 3 — evidence honesty.** **3.5 FIRST:** extend `no-fabricated-tier` to resolve non-literal labels
and route through `badgeForLabel`, so each of 3.1 (F1) · 3.2 (F14) · 3.3 (F3+GlucoDex) · 3.4 (F2) lands
**with a gate that would have caught it.**

**Tier 4 — next charter's run list.** Playwright badge enumeration over the 9 bundles · the class-5/6
spectral differential oracle across the three `lombScargle` siblings · **class 11 × the Integrator's PB
noisy-OR (device identity, not node identity)** · `tools/mutate.mjs` + `mutmut` · the E2E fold
(`trio-batch` → `tch-multinight`) · a hunter each for `capture-host/webmon.py` and the
orchestrator/adapter surface · `cohort-worker.js`.

---

## 6 · The structural conclusion

The suite's gates are strong where they measure **numbers** and absent where they measure **entitlement**.
Every surviving finding in §2.1, §2.2 and §2.8 is a string being spent as authority it does not have — a
node label as a device, a filename token as a vendor, an unresolved label as a tier. Tier 3.5 and Tier 4's
class-11 item are the two cheapest places to start building the missing half.
