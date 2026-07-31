<!--
  ECGDEX-CARDIOPULMONARY-COUPLING-FOLLOWUPS-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-31 · **Follows:** `ECGDEX-CARDIOPULMONARY-COUPLING-2026-07-30-BRIEF.md` §10 · **Relates:** `DEEP-STAGE-DESAT-CONFOUND-2026-07-29-BRIEF.md` §9/§12

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
