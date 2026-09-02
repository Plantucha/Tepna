<!--
  MULTI-SENSOR-DERIVATIONS-FOLLOWUPS-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-08-03 (**§1 CLOSED** — the owed 3a audit pass ran on all three: `ecgdex-dsp` clean, `ppgdex-dsp` four instances fixed + gated, `cpapdex` `periodicBreathingPct` fixed + gated. Only §4's staging item remains) · **Created:** 2026-07-18 · **Follows:** `MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md` (DONE) · **Related:** `MOTIONDEX-BUILD-FOLLOWUPS-2026-07-18-BRIEF.md` · `APNEA-TYPING-FUSION-2026-07-18-BRIEF.md` (DONE) · **Residue:** R12

# Multi-sensor derivations — follow-ups: what executing four fusions surfaced

Spawned per `CLAUDE.md` §📌 after **§1.1 · §1.2 · §2.2 · §2.4** shipped (PRs #172, #178, #182, #186).
The features were the small part; most of the value was in defects and mis-scopes the work exposed.
Nothing here blocks what shipped.

## 1 · The recurring defect: fabricated absence in per-epoch series ⚠️ **the load-bearing one**
Three of the four fusions surfaced the SAME bug shape, and it predates this work (`EVENT-COUPLING` §2's
×0.72 artifact). A per-epoch series feeding a fusion must be **tri-state** (`true`/`false`/`null` =
sensor not recording) and nulls must leave the **denominator** — otherwise a coverage gap manufactures a
clinical finding:
- `actigraphy()` scored an epoch with **zero ACC samples** as `counts=0 → moving=false → immobile` — a
  recording gap fabricating *stillness*, which then inflated a motion-gated HRV confidence. **Fixed** (#182).
- Effort/posture series: "no chest-ACC" must read **UNTYPED**, never **CENTRAL** apnea. **Encoded + gated** (#172).

**Done here:** `AUDIT-PROMPT.md` bug class **#3** gained sub-class **3a** naming this variant explicitly
(it is nastier than the classic form — nothing looks null; the epoch returns a plausible measurement).
**Still owed:** an audit pass applying 3a to the series that predate it — `ppgdex-dsp` motion/SQI epochs,
`ecgdex-dsp` epoch series, `cpapdex` per-session lanes. Ask of each: *what does this field say when the
sensor was off?*

### ✅ §1 AUDIT PASS — executed 2026-08-03 on `ppgdex-dsp`. It said "perfectly still."

The question was asked of each series and answered by **execution**, not by reading.

**`ecgdex-dsp` epoch series — CLEAN, and worth recording as clean.** `epochEngine` *omits* an epoch with
< 20 beats rather than emitting a plausible one, and every consumer keys on the epoch's real `tMin`:
`hrvStability` groups by `e.tMin - wStart`, regresses against `tMin/60`, and already carries `n` per
window so an under-sampled window is visible (DEEP-AUDIT-II #39). Omission plus a real-time axis is
fail-safe — a gap shortens the series, it does not shift it. No change.

**`ppgdex-dsp` motion/SQI epochs — FOUR instances of 3a, one of them severe.**

*The severe one.* `motionAtSec(sec)` returns a numeric **`0`** for any second outside the ACC grid, and
`accCell`/`gyCell` are zero-initialised, so a cell no sample landed in is indistinguishable from a cell
whose sensor said "not moving". `motion.hasData` is a SESSION-level fact, so an epoch past the end of a
short inertial stream averaged a run of fabricated zeros into a confident stillness. Measured on a
60-min synthetic whose ACC stops at 30 min, wearer moving identically throughout:

| | |
|---|---|
| `motionAtSec` while ACC records | **1.0000** (saturated) |
| `motionAtSec` one cell later, no ACC | **0.0000** |
| gap samples scoring low-motion (≤ 0.15) | **359 / 360** |

That is MotionDex `actigraphy()` (#182) — *a recording gap fabricating stillness, which then inflated a
motion-gated HRV confidence* — reproduced verbatim in another node, which is exactly why §1 called this
the recurring shape rather than a bug.

*Three more, all in the confidence block, all measured on the **committed** twins (neither carries ACC):*

- `qLowMotion` admitted `motionIndex == null` as low motion **and** kept it in the denominator ⇒
  `lowMotionFrac: 1` — "perfectly still all night", from a sensor that never recorded.
- `qPosture` counted `'unknown'` as a position ⇒ `postureStableFrac: 1` — "never shifted" — and, in the
  partial case, **two spurious shifts** on the way out of and back into `'unknown'`. Wrong in both
  directions at once.
- `magInterference` was `false` when there was no posture datum, and sat in `magInterferencePct`'s
  denominator as evidence of a clean field. `!!e.magInterference` in *both* export projections
  (`ppgdex-dsp` and `ppgdex-app`) collapsed the tri-state again one layer up.

Those phantom `1.0`s multiplied straight into published grades: **hf 0.97 / 0.56 "motion-graded"** on
recordings with no motion sensor.

**Fixed.** A coverage grid (`covCell`) is tracked alongside the value grid; `motionCoveredAtSec` is added
as a **companion** predicate so `motionAtSec` keeps its numeric contract (two hot loops threshold it);
`motionIndex` averages only covered beats and is `null` otherwise; nulls **leave the denominators**;
`magInterference` is tri-state to the export; and `motionCoveredFrac` + an `evidence` block
(`none`/`partial`/`full` per driver, with counts) are published so a null is diagnosable.

**One judgement call, stated because the brief did not specify it:** a confidence whose driver was never
measured now reads **`null`**, not a number. Letting an absent driver multiply in as `1.0` published the
manufactured grade that "confidence from MEASURED drivers" denies. This is deliberately **not** a
re-calibration — no weight was retuned and no constant invented; a term that cannot be evaluated makes
its metric unknown. Consequence: an ACC-less session (every finger/O2Ring pleth) now reports
`hf/sdnn/vlf = null` with `evidence.motion = 'none'` instead of 0.97. `beatToBeat` and `lf` are
unaffected — they have no inertial driver — which is also the control proving the fix did not buy
honesty by nulling everything.

Gated by two groups (20 assertions), both **verified RED by value** against the pre-fix DSP —
`lowMotionFrac got 1 want null`, `hf got 0.56 want null`, `magInterference got false want null` — not
merely by throwing on the new API. Suite 5250 → 5287. `synthetic_ppgdex_rich_golden` regenerated (9
fields moved); the light exports and the corpus-backed equiv fixture were **unchanged** (no confidence
block), and `verifiedUnder` was re-established on the real corpus.

**Then owed:** `cpapdex` per-session lanes — deliberately not folded into the PpgDex change, because that
node's shape is different (per-session pooling, not a per-epoch series) and rushing it would have been
the same haste this bug class rewards. Taken up separately the next day → part 2 below.

### ✅ §1 AUDIT PASS, part 2 — `cpapdex` per-session lanes, 2026-08-03

**The ventilation lanes are CLEAN.** `rrMaskOn`/`tvMaskOn`/`mvMaskOn`/`snMaskOn`/`flMaskOn` are each
built `ch ? _filterBy(...) : []` and every derived metric is `lane.length ? … : null`, so an absent
channel yields `null`, never a plausible number. `nightMetrics` concatenates raw mask-on samples, so an
unscored session contributes no samples rather than a run of zeros. No change.

**`periodicBreathingPct` was NOT clean, and the way it failed is the interesting part.**

`§7` (DEEP-AUDIT-2026-07-14) had already identified this exact metric as fabricated-absence and shipped
a fix whose comment reads *"null on absence, matching the sibling apnea indices, not a measured-looking
0"*. The guard it actually shipped is **`durSec > 0`** — the **denominator**, not the channel. And its
gate (`CPAPDex §7 — periodicBreathingPct is null, not 0, on a zero-duration session`) drives a
**zero-duration** session, which that guard *does* catch. So the gate passed, the comment asserted the
property, and the real absence case had never once run. Measured on the synthetic set:

| CSL state | `periodicBreathingPct` |
|---|---|
| lane present, 120 s episode | 20 |
| lane present, device scored nothing | 0 |
| **lane absent** | **0** ← indistinguishable |

Periodic breathing is a heart-failure signal, so that is a manufactured **negative** finding. The
`reraIndex` line directly above it cites *this very metric* as the precedent for the discipline it was
not itself following.

**A second defect, same root.** An unscored session left the numerator but stayed in the
**denominator**: PB seconds were divided by the whole night's duration even when only one of several
sessions carried a CSL lane. On the synthetic pair that turns a real 20 % episode into **10 %**.

**Fixed** by guarding on **file presence** (`pbObserved = !!set.CSL`) — deliberately *not* on
`pbSec > 0`. Unlike RERA capability, which is unknowable from one session and hence uses the `nRE > 0`
proxy, whether the device wrote a CSL lane **is** knowable, so a genuinely scored zero stays a real `0`
and only true absence goes `null`. A CSL file with an empty annotation list is a *measurement*. The
night-level denominator is now the duration actually scored, and `pbObservedHours` /
`pbObservedSessions` are published so a partial night is visible.

**How much of this is live, measured rather than assumed.** Across **410** therapy sessions in the real
CPAP corpus, **408 carry a CSL lane** — and the 2 that do not are both the post-midnight continuation of
a night whose *other* session is scored. So **no night in this corpus is wholly unscored**: the
full-`null` case is **latent**, and saying otherwise would overstate it. The *denominator* half is not
latent — on the real night **2026-05-12** the fix reports `usageHours 7.2` against
`pbObservedHours 4.35`, i.e. the published percentage had a denominator **65 % larger** than what was
actually scored. Its value did not move only because that night's numerator is genuinely 0; any PB on
such a night would have been under-reported by 40 %.

Gated by 10 assertions, **verified RED by value** (`got 0 · want null`, and `got 10 · want 20` for the
diluted denominator), with the scored-clean night asserted to stay a real `0` as the load-bearing
control — a fix that nulled the true negative too would be a regression dressed as honesty. All five
CPAP fixtures moved by the two additive fields only; `periodicBreathingPct` itself is unchanged on every
one of them, and `verifiedUnder` was re-established on the real corpus.

**§1 is now CLOSED** — `ppgdex-dsp`, `ecgdex-dsp` and `cpapdex` have all had the pass. §4's staging item
remains the brief's only open work.

## 2 · PpgDex RIIV — §2.2's missing third leg (a real DSP defect, deliberately not worked around)
`fuseRespirationRate` fuses MotionDex chest-ACC + ECGDex RSA today. PpgDex should be the third
independent estimate, but `ppgdex-dsp` hardcodes `respRate: null` because **`PPGDSP.lombScargle` never
tracks the HF peak** — diagnosed in `TCH-REFERENCE-VALIDATION-2026-07-12` §F1 and still open.
The fuser is **n-agnostic** and null-safe (verified — adding a PpgDex record without the field leaves output byte-identical). **⚠️ CORRECTED 2026-07-18: "fix the DSP and PpgDex folds in with no Integrator change" is FALSE.** Executed trace (`ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md` §1.6) found **three** links missing, not one: (i) `lombScargle` (`ppgdex-dsp.js:927`) accumulates band power and never retains the argmax — its return literal has no frequency-valued field; (ii) the export's `hrv.frequency` block (`ppgdex-dsp.js:2279`) has **no `respRate` key at any level**; (iii) the Integrator's `PulseDex|HRVDex|PpgDex` ingest branch (`integrator-dsp.js:395-500`) **never assigns `summary.respRateBrpm`**. Confirmed by execution: synthetic 135 Hz PPG with RSA planted at 0.25 Hz returns `respRate` null on all 3 epochs while hf = 5758/5729/5657 ms² — the modulation IS captured as power; only frequency extraction is absent. **✅ RESOLVED 2026-08-01 — and the correction itself needed correcting.** Links (i) and (ii) were real and are fixed: `lombScargle` now retains the HF argmax and the export publishes `hrv.frequency.respRate` + `respRateMethod` (plus per-epoch `respRate`), verified against a KNOWN answer — RSA planted at 0.25/0.20/0.30 Hz recovers 15.06/12.06/18.06 breaths-min, and three distinct plants give three distinct answers so a constant cannot pass. 🔴 **~~Link (iii) was NOT missing.~~ RE-CORRECTED 2026-09-02 (Magpie) — the retraction was wrong and the ORIGINAL finding was right. Link (iii) WAS missing, and it still was on `origin/main` a month later.** `integrator-dsp` does assign `summary.respRateBrpm = _hf.respRate` — **inside `if (node === 'ECGDex')` (`:365`)**. The whole file assigns that field at exactly two sites, `:365` (ECGDex) and `:617` (MotionDex); the `PulseDex|HRVDex|PpgDex` branch this brief correctly named reads `hrv.frequency.lfhf` and never the sibling `respRate` beside it. So links (i) and (ii) were fixed, the export has published `hrv.frequency.respRate` since 2026-08-01, and the value reached **no fusion at all** — PpgDex could not fold in with no Integrator change, because the assignment it was said to reuse was gated to another node. ⚠️ **The retraction says "Verified in the tree before building on it, not read off this line", which is what makes it worth recording:** the check found the assignment and did not ask which branch it was in — a grep proves occurrence, not reachability. `ppgdex-dsp.js`'s own export comment repeats the same claim (*"the field the Integrator already reads … has assigned it all along (link 3 was never missing)"*), so two independent surfaces asserted a link that a one-line branch check refutes, and both are corrected in the PR that wires it. **A confident retraction closes a file; this one closed it for a month with the value computed, exported, and one `if` away from its consumer.** So the DSP fix alone does **not** complete the third leg. That makes
this the single highest-leverage item here — it upgrades a 2-source method comparison into the rare
3-source one §2.2 was written for. Its own executable brief when taken up (a DSP change → gated,
fixtures re-verified).

## 3 · A gate that never drove the real ingest path
The §1.1 typing gate built Integrator records **by hand**, so it passed while MotionDex was **not
registered** in `NODE_COLORS`/`KNOWN_NODES` — the R2 guard was warning *"will load but be excluded from
fusion"* and nothing failed. §1.2 only caught it because it drove `normalizeFile` end-to-end.
**Rule:** a fusion gate must drive the node's **real ingest seam** (`normalizeFile`) at least once, not
just hand-built `recs`. Worth generalising into the TEST-AUDIT lineage: hand-built fixtures test the
function, not the wiring.

## 4 · Residual derivations
- **§2.1 cardiorespiratory/actigraphic sleep staging** — ~~the last unexecuted Tier-1/2 item. All its inputs
  now exist (MotionDex `activitySeries` + HRV from ECGDex/PulseDex), so it is unblocked.~~
  > **CORRECTED 2026-08-20 — it is NOT unexecuted. See §6.**
- **§2.2** is complete at **2 of 3 legs** (see §2 above), and the parent brief says so rather than
  claiming a 3-way fusion.

## 5 · Smaller things
- **`_norm` single-pass tag strip** in 7 `*-registry.js`: CodeQL flags it (`js/incomplete-multi-character-
  sanitization`) and it BLOCKED PR #162 — but only a NEW copy is flagged; the existing 7 are baselined and
  the looped fix is **provably behaviour-inert** (6561-input fuzz, zero difference — any `<` surviving the
  `/g` pass has no `>` after it). Inputs are hardcoded labels, never user input. **Decision (owner,
  2026-07-18): fix opportunistically** when a node is already being re-bundled; do NOT sweep the fleet for
  a proven no-op (7 re-bundles → every `manifestHash` moves → §👥.3 serialisation).
- **MotionDex render-coverage rig** + **position-frame calibration** are tracked in
  `MOTIONDEX-BUILD-FOLLOWUPS-2026-07-18` — not duplicated here.

## Done-when
Each item is executed or carries an explicit park reason. §1 (3a audit pass) and §2 (PpgDex RIIV) are the
two with real engineering behind them; §3 is a testing rule to propagate; §4 is the remaining agenda.

## 6 · §2.1 is SUBSTANTIALLY BUILT — and the obvious way to finish it fabricates REM (2026-08-20)

### The item is not unexecuted

`ecgdex-dsp.js` `stageSleep(epochs, motionByTMin)` is already a cardiorespiratory **and** actigraphic
stager: it classifies from HRV (`rmssd`, `hr`, `lfhf` — the LF/HF gate is what separates REM from deep
sleep) with **motion as an explicit veto**, and its own comments record why the ordering matters
(`REM-STAGING-REDESIGN` §4c: a Wake branch tested first swallowed 9 of 9 planted REM epochs). It ships
in the ECGDex export as `timeseries.sleepStages[]` and `sleep.stageMinutes`, on a 5-min grid.

So the "SpO₂/HR sleep-stability proxy" §2.1 proposes to replace **has already been replaced**, by a
different brief. What §2.1 still describes accurately is the *Vigil-unique* part: the parent notes the
papers use chest **or** wrist, ECG **or** PPG, while this rig has all four at once.

### What is genuinely missing: the wrist leg

**PpgDex publishes no stages at all** (`sleep: null`), while its epochs already carry everything
`stageSleep` consumes — `tMin`, `hr`, `rmssd`, `lfhf`, plus `motionIndex`. So "run the existing stager
on the wrist node" is both the obvious next step and, done naively, **wrong**.

### 🔴 The trap: `motionIndex` is the same field name on two different scales

Measured over 12 trio nights, ~1000 epochs each:

| node | min | p50 | p90 | max |
|---|---|---|---|---|
| ECGDex `motionIndex` | 0.000 | 0.000 | **72.200** | **100.000** |
| PpgDex `motionIndex` | 0.020 | 0.030 | **0.070** | **0.670** |

Neither is wrong — PpgDex declares `units: { motionIndex: '0..1' }` in its own export, and both are
internally consistent. But `stageSleep`'s veto is the **absolute** test `m >= 60`, which on a 0..1
scale **can never fire**.

⚠️ **And it does not degrade to "no veto" — it degrades to FABRICATED REM.** A movement burst carries
the REM HRV signature (elevated HR, suppressed RMSSD, high LF/HF); the motion veto is the only thing
between it and a REM call. Planted 60 epochs with every 5th moving, and fed the identical physical
motion on each scale:

| motion scale | movement epochs called REM |
|---|---|
| 0..100 (ECGDex) | **0 of 12** |
| 0..1 (PpgDex) | **12 of 12** |

**20 % of the night changes stage on the units alone**, and it lands on the one stage the code's own
comments say motion must rule out. Gated by `ecgdex-dsp · staging · motion-scale-contract`
(6 assertions), which pins the contract by showing both scales and asserts the hypnograms differ on
*exactly* the planted epochs and nowhere else.

### Not a defect today — a latent one

Checked before claiming either way. The Integrator carries `epochs[].motionIndex` from every node into
`hrvEpochs.motion` (`integrator-dsp.js:643`) and uses it twice:

- **`_tchAlignedMotion` → `_tchPearson`** — a correlation, which is **scale-invariant**. Safe.
- **`_meanMotion` → `r.coMotion`** — a per-node mean, and `coMotion` is **written and never read** by
  anything in the tree. Inert.

So there is no live miscomputation. The hazard is entirely in front of whoever executes §2.1, which is
why it is recorded here and pinned by a test rather than "fixed" by renaming a field or rescaling an
export (either would move every fixture for a bug nobody has yet).

**Owed for §2.1's wrist leg:** scale PpgDex motion to the stager's convention, or give `stageSleep` an
explicit threshold argument (additive, last, optional — the back-compat rule). Then the two hypnograms
become an inter-sensor agreement measurement, which is the only validation instrument available here —
there is no PSG in this corpus, so κ against truth is not computable and chest-vs-wrist agreement is
the honest substitute.
