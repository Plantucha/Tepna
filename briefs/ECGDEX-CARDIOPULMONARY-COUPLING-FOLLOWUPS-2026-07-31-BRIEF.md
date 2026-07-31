<!--
  ECGDEX-CARDIOPULMONARY-COUPLING-FOLLOWUPS-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-31 · **Created:** 2026-07-31 · **Follows:** `ECGDEX-CARDIOPULMONARY-COUPLING-2026-07-30-BRIEF.md` §10 · **Relates:** `DEEP-STAGE-DESAT-CONFOUND-2026-07-29-BRIEF.md` §9/§12

# What retiring the AHI proxy left behind

`ECGDEX-CARDIOPULMONARY-COUPLING` §10 removed `estimatedAHI` and `riskCategory` from ECGDex, because
both were `cvhrIndex` wearing AHI's name, units and clinical cut-points, and §9 measured that index
against device-scored residual AHI at **r = −0.151, p = 0.36**. Retiring the producer was scoped
deliberately to ECGDex. This brief holds what that scoping left open, plus what executing it exposed.

---

## 1 · Consumers still read the retired field from LEGACY exports

Four modules still read `apnea.estimatedAHI`. All null-guard, so nothing crashes and every one
degrades to `null` against a current export. But **exports written before 2026-07-31 still carry the
number**, and re-ingesting one revives it:

| module | line | what it does with it |
|---|---|---|
| `integrator-dsp.js` | `:322` | `summary.estAHI = json.apnea.estimatedAHI.value` |
| `oxydex-fusion.js` | `:547`, `:897`, `:1060` | renders an AHI pill + a table row + an `· AHI n/h` label |
| `cpapdex-coimport.js` | `:129–130` | `estAHI` / `estAHIband` into the co-import row |
| `oxydex-app.js` | `:168` | passes the block through to fusion |

**The one real gap.** `integrator-dsp.js:555` overwrites `summary.estAHI` with CPAP's device-scored
`residualAHI` — the honest source — but **only when a CPAP night is present**. A **non-CPAP** fusion
reading a legacy ECGDex export therefore still surfaces the retired proxy as though it were an AHI.
That is the case worth fixing; the rest is cosmetic.

**Why it was not done in §10:** these live in three other bundles (Integrator, OxyDex, CPAPDex), so
the change serialises three more re-bundles for no gain against *current* exports. **Do NOT** fix this
by deleting the defensive reads — a consumer tolerating a legacy field is correct back-compat. The
fix is to stop *trusting* it: treat a legacy `estimatedAHI` as absent, and let `ahiSource` say so.

**Done when:** a legacy ECGDex export fused WITHOUT a CPAP night yields `summary.estAHI === null` and
an `ahiSource` that names the omission, gated by a leg that feeds a pre-2026-07-31 fixture through
`adaptEnvelopeNode`.

## 2 · ECGDex has no committed fixture that exercises the apnea block

§10.5's uncomfortable finding: all three ECGDex fixtures — the real-corpus equiv clip and both
synthetics — regenerated to **identical bytes** after the export shape changed, because **none of them
carries an `apnea` block at all**. They are too short for `longRec`. So the whole apnea/CVHR/CPC
export path, including the metric this line of work just validated, has **zero committed-fixture
coverage**; GATE B and the equiv leg are blind to it.

This is the same shape as the GlucoDex 14 h-gap lesson in `CLAUDE.md` §🔒: an adversarial **committed**
twin beats a real one, because CI re-runs committed bytes on every push and cannot go stale unseen.

**Done when:** a committed synthetic ECGDex night long enough to trip `longRec` and produce a populated
`apnea` block (`cvhrIndex`, `cpc`, `surgeEscalationPct`) is minted into `provenance/ECGDex.json` with an
equiv/GATE-C leg, so a future edit to that block moves a fixture instead of moving nothing.

## 3 · `personalize()` is a browser-only derivation layer that no gate can see

§10.1's near-miss generalises. `ECGProfile.personalize` computes values that reach the user's screen
and the app's ⬇JSON export, but it **never runs in the headless/batch path**, so every corpus probe,
every fixture, and every Node-lane assertion sees those fields as `null`. That is exactly why §9.5
concluded `estimatedAHI` was "still null on every night" when it was live in the product.

Ask of the other nodes: `ppgdex-profile.js` and `glucodex-profile.js` share this structure. **What else
is derived UI-side, surfaced to a user, and invisible to every gate?**

**Done when:** the profile-derived surface of each node is enumerated, and either (a) covered by a
browser-lane assertion, or (b) documented as display-only with nothing clinical derived in it.

## 4 · `surgeEscalationPct` is the next unvalidated apnea-adjacent number

Still exported from the same block, still `experimental`, still never measured against the
device-scored label that §9 established is available for 39 paired nights. It is not making an AHI
claim, so it is not urgent — but it is the same family, and the corpus and the harness now exist.

**Done when:** `surgeEscalationPct` is correlated against device residual AHI the way `cpcHfc` was, and
either earns a tier or is documented as measured-and-flat.

## 5 · Nothing was promoted into the vacated slot, on purpose

Recorded so a future reader does not treat the gap as an oversight. `cpc.hfcPct` is the only validated
correlate (r = −0.408, p = 0.009) and **a correlate is not an estimator**. Filling `estimatedAHI` from
it would reproduce the retired field's exact error with better inputs. If an AHI estimate is ever
wanted from ECGDex, it needs a model fit and validated against scored labels — held-out, and ideally
not one subject — not a rescaled single band.

---

## 6 · §1 and §2 EXECUTED (2026-07-31)

### 6.1 §1 — the legacy value is parsed but no longer trusted

`summary.estAHI` is no longer folded from `apnea.estimatedAHI` at all, and `summary.ahiSource` now
carries the reason, so a reader can tell **"no AHI known"** from **"AHI is zero"**:

- `'none — legacy ECGDex estimatedAHI ignored (retired: r = −0.151 vs device AHI)'` when the field is
  present (i.e. a pre-2026-07-31 export)
- `'none — ECGDex measures CVHR, not AHI'` when it is absent (a current export)

CPAPDex's device-scored override at `integrator-dsp.js:571` is untouched — a CPAP night still yields
`ahiSource: 'device-scored'`. The three display surfaces were re-keyed onto `cvhrIndex` rather than
deleted, because a legacy export still carries the retired field and only re-keying actually stops the
old number reaching a screen: OxyDex's fusion tile (now *"CVHR index (ECG) · cyclic HR variation — not
an apnea count"*, uncoloured), its detail row (the `<5` clinical target is gone), its ingest
confirmation line, and CPAPDex's co-import + the `ECG est. AHI` metric tile. That tile was the worst
placement in the suite: a relabelled CVHR index captioned *"independent estimate"*, sitting directly
beside CPAPDex's **device-scored** AHI — two numbers in the same units inviting a comparison, one of
which correlates with the other at r = −0.151.

**Mutation-verified.** Restoring the old read reds `Integrator: a LEGACY estimatedAHI is NOT folded
into estAHI` with **`got 7 · want null`** — the gate feeds a legacy-shaped export carrying
`estimatedAHI: {value: 7}` through a **non-CPAP** fusion, so it fails on a real value rather than
passing vacuously on a null.

### 6.2 §2 — the apnea block is now gated, and the reason it never was is worse than "too short"

§2 assumed the fixtures missed the apnea block because they are too short for `longRec`. That is only
half of it. **Two** conditions gate that block, and no fixture met *either*:

1. **`opts.rich`.** Plain `compute({text})` emits the **LIGHT** export (`recording` +
   `ganglior_events` only). The rich blocks — `quality`, `hrv`, `timeseries`, `sleep`, `apnea`,
   `hrvStability` — are behind `opts.rich`, which only the orchestrate emitter passes. Every fixture
   builder calls plain `compute`. So **no ECGDex fixture has ever covered the rich export at all**,
   not just the apnea part of it.
2. **`longRec`** — `durSec >= 90 min`, measured as **active beat-covered time, not span**, so a
   sparse or gappy file cannot reach it either.

**The committed-fixture form was rejected on cost, and the number is worth recording:** the 60 s twin
is 450 KB, so a 90-minute committed ECG is **~40 MB**. That is not a reasonable thing to add to a git
repo to satisfy a gate. Instead the long recording is **built at test time by tiling the committed
60 s twin 92×**, advancing only the ms column. This keeps the property the committed-twin argument is
actually about — CI reconstructs it from committed bytes on every push, so it cannot rot unseen — at
zero repo cost.

Eight assertions now cover the block: it exists, `cvhrIndex` is a real number, `estimatedAHI` and
`riskCategory` are **not keys** (absent, not null), `method` disclaims being an AHI *and* carries the
measured `−0.408`, `cpc` rides the block, and its window is the pinned 512 s. Asserted on **shape,
not on an outputHash** — the values are whatever the tiled signal yields, and pinning them would gate
the tiling rather than the export contract.

### 6.3 What the gates proved this round

`computeHash` moved for **Integrator, OxyDex and CPAPDex** (render/display edits are inside the
compute closure by design — it is a denylist that over-flags rather than a allowlist that fails open),
so re-verification was owed. Every regen tool was then run **with all inputs present — 0 skipped** —
and **0 fixtures moved** on all nine nodes. So "no output changed" here is measured, not asserted.
ECGDex's own `computeHash` is unchanged (`322bb5f5a6e6`): this round touched no ECGDex module.

### 6.4 Still open

**§3** (browser-only `personalize()` derivations invisible to every gate — the near-miss that let
§9.5 call a live field "null on every night") and **§4** (`surgeEscalationPct`, the next unvalidated
apnea-adjacent number in the same block) are untouched. **§5** records a decision, not work.

---

## 7 · §3 EXECUTED (2026-07-31) — and its premise was wrong in a way worth keeping

### 7.1 The layer is NOT invisible to the gates

§3 said `personalize()` is *"invisible to every fixture and every Node-lane assertion."* **It is not.**
`tests/run-tests.mjs` already loads `ecgdex-profile.js`, `glucodex-profile.js` and `ppgdex-profile.js`
into the realm and exposes them as `env.ECGProfile` / `env.GLUProfile` / `env.PPGProfile`, and a
known-answer group has been exercising all three since `TEST-COVERAGE-FOLLOWUPS §1`.

What is genuinely invisible is narrower and more specific: **the corpus/export path**. `trio-batch`
and every probe built on it call the headless route, where `personalize` never runs, so a
profile-derived field reads `null` in **all 39 nights** while being populated in the app. That — not a
missing gate — is what let §9.5 describe a live, clinically-labelled number as "null on every night."

The distinction matters because it changes the remedy. "No gate can see it" implies *write gates*;
the truth is *the gates exist, and a corpus measurement is not one of them*. **Never conclude a field
is dead from corpus exports alone** — that is the transferable lesson, and it is now the first line of
this section rather than an inference someone has to re-derive.

### 7.2 The enumeration

Three nodes implement `personalize()`; `hrvdex-profile.js` and `oxydex-profile.js` derive nothing onto
the result object, and `dex-profile.js` is the shared panel. **34 derived fields**, of which **six** had
no assertion anywhere:

| field | node | what it is | now pinned by |
|---|---|---|---|
| `rhrEff` | ECGDex | **divides every VO₂max** (Uth–Sørensen `15.3·HRmax/RHR`) | a manual RHR must beat the auto value, and VO₂ must move with it |
| `hrmaxRejected` | ECGDex | flags that an implausible manual HRmax was discarded | rejected `<140` ⇒ flag true **and** fallback to Tanaka; a plausible one ⇒ false |
| `cpapInUse` | PpgDex | therapy context | true/false both pinned |
| `tgtLo` / `tgtHi` | GlucoDex | the user's glycemic target range; rides the app export as `targetRangeMgdl` | carried through **and** TIR proved unmoved |
| `dqLabel` | GlucoDex | the human reading of `dataQualityConf` (which *was* pinned) | non-empty label |

`rhrEff` is the one that mattered. It is the denominator of the fleet's headline fitness number, and
nothing pinned it — `vo2base` was asserted only against the *derived* RHR, so a regression where a
user's manual resting HR silently lost to the auto value would have moved every VO₂max with no leg
naming the cause.

### 7.3 The reassuring find, pinned so it stays true

`tgtLo`/`tgtHi` are the only profile-derived values that reach an **export** (`targetRangeMgdl` in
`glucodex-app.js`), which looked like the worst case: user-editable inputs feeding a clinical metric.
**They do not.** Time-in-range is computed from the fixed 2019 consensus cut-points (`TIR_CUT` =
54/70/180/250 mg/dL); the profile targets are declarative annotation. So retargeting labels an export
and moves no metric.

That was worth *proving* rather than reading, and it is now gate-backed: the sweep asserts TIR is
unchanged while custom targets are in force, so **if a future edit ever wires TIR to the profile
targets, that assertion is what breaks.**

### 7.4 Scope note

§3's "Done when" offered (a) browser-lane coverage **or** (b) documentation as display-only. This took
(a) for all six, in the **Node** lane — where the existing profile group already lives, so it runs on
every push rather than only under `?full`. No node needed option (b): every derived field is either
pinned or transitively pinned by a value that is.

---

## 8 · §4 EXECUTED (2026-07-31) — `surgeEscalationPct` is measured, and FLAT

Correlated against the CPAP's own device-scored `residualAHI` over the same 39 paired nights that
validated `cpcHfc`, using `tools/ecg-apnea-correlate.mjs` (new, committed — §8.2):

| predictor | n | Pearson r | 95 % CI | p | Spearman | vs §9 |
|---|---|---|---|---|---|---|
| `cpc.hfcPct` | 39 | **−0.408** | [−0.641, −0.106] | 0.007 | −0.348 | ✓ control reproduced |
| `cpc.lfcPct` | 39 | −0.045 | [−0.356, +0.274] | 0.78 | +0.135 | ✓ control reproduced |
| `cpc.vlfcPct` | 39 | +0.356 | [+0.046, +0.604] | 0.020 | +0.138 | ✓ control reproduced |
| `cvhrIndex` | 39 | −0.151 | [−0.445, +0.173] | 0.35 | −0.144 | ✓ control reproduced |
| `cvhrEvents` | 39 | −0.116 | [−0.416, +0.207] | 0.48 | −0.053 | new — flat |
| **`surgeEscalationPct`** | 39 | **−0.095** | **[−0.398, +0.228]** | **0.56** | −0.096 | **new — flat** |

**`surgeEscalationPct` does not track apnea burden.** Pearson and Spearman agree (−0.095 / −0.096)
and the interval spans zero almost symmetrically — a flat null, not an underpowered hint.

### 8.1 What that does and does not mean

It is **not a refutation of what the metric claims.** `surgeEscalation()` measures whether CVHR surges
cluster toward the end of the night — a *timing* trend, per Li/Kiyono's HRV-instability signature —
and nothing ever asserted a link to AHI. The measurement was worth making anyway because the field
sits in the **`apnea` export block, beside `cvhrIndex` and `cpc`**, and that context is exactly what
invites a future reader to treat it as an apnea marker and promote it on the assumption. It is not
one, on the only independent label this suite has.

**Tier unchanged at `experimental`** — it never rested on an AHI claim, so a null against AHI is not
grounds to move it. What changed is that the registry `cite` and the DSP source comment now carry the
number, so the assumption cannot be made silently. That is §4's option (b), *documented as
measured-and-flat*, in a stronger form than prose: the null sits at the two places someone would look
before promoting the metric.

`cvhrEvents` was measured on the way (r = −0.116, flat) — the raw count behaves like the index derived
from it, which is the expected result, recorded so nobody re-runs it.

### 8.2 The harness is committed, and it re-checks §9 on every run

`tools/ecg-apnea-correlate.mjs`. §9 published four correlations from a script that was never
committed — the same failure §11/§12 hit, where a quoted result cannot be re-run without rebuilding
the harness from prose. So **§9's four numbers are now CONTROLS the tool reproduces on every run**,
printed in a `vs §9` column: if `hfcPct` stops coming back at −0.408, either the corpus moved or the
harness is wrong, and both are things to learn *before* reading a new row. All four reproduced
exactly. `--selftest` additionally pins the Fisher-z intervals against §9's **published** CIs
(−0.641 / −0.106 / −0.445), so a change to the interval math cannot silently re-write the brief.

**Two honest notes on method.** (1) The tool tests **every** numeric candidate in the apnea block, not
a favourite — testing only the metric you hope will land is how a fishing expedition looks
respectable. (2) Bonferroni is therefore over **six** predictors (α = 0.0083), not §9's four
(α = 0.0125), and **`cpcHfc` survives the stricter bar** (p = 0.0066): adding two more candidates did
not cost the one real finding. Our p for `hfcPct` prints 0.007 against §9's published 0.009 — a
normal-approximated tail versus an exact t at n = 39. Same conclusion, and r and CI match to the digit.

---

## 9 · This brief is now closed

§1, §2, §3 and §4 are executed; §5 was a recorded decision with no work in it. Nothing here spawned a
further follow-up: the two questions that arose during execution were both answered in place (§2's
`opts.rich` discovery, §7.1's correction to §3's premise), and §8's null closes the last open metric
in the block rather than opening a new thread.

**What the whole line of work settles.** ECGDex's `apnea` block now contains exactly one number
validated against an independent label — `cpcHfc`, r = −0.408 — and every other candidate in it has
been measured against that same label and found flat: `cvhrIndex` (−0.151), `cvhrEvents` (−0.116),
`surgeEscalationPct` (−0.095), `cpc.lfcPct` (−0.045). The two that *claimed* to be apnea burden and
never were, `estimatedAHI` and `riskCategory`, are gone.
