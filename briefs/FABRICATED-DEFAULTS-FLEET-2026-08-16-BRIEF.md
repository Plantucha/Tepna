<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-16

# Fabricated defaults — the DSPs never inherited §2.6, and every one fails toward "healthy"

## 1 · The class

Clock Contract §2.6 states it plainly: **a missing stamp must be visible (null), never fabricated.**
The parsers honour it. The DSPs never inherited it. Below a minimum-N guard they return **zeros**, and
those zeros reach registered, badged metrics where nothing distinguishes them from a real measurement
of zero.

The sharpest statement of the class, found by Mutator in `ecgdex-dsp.js` and quoted verbatim because
no paraphrase improves it:

```js
hfnu: +((spec.hf / (spec.hf + spec.lf || 1)) * 100).toFixed(1)
```

`null + null` is `0`; `0 || 1` is `1`; `null / 1` is `0`. So an untransformed spectrum published a
clean **0.0 %** on a **`validated`**-tier metric. The `|| 1` was written for a genuinely measured
`hf + lf === 0` and silently absorbs absence too. **A guard written for one kind of zero swallowed
the other.**

## 2 · The direction — why this is a brief and not a footnote

**All eleven OxyDex sites fail toward the reassuring answer.** That is not a random distribution of
defaults.

```js
if (n < 60)                    return { odi1Rate: 0, odi1Total: 0 };   // no desaturations
if (n < 60)                    return { oxyCrashCount: 0 };            // no crashes
if (n < 60)                    return { desSev: 0 };                   // no severity
if (n < 60 || durationHr <= 0) return { sbii: 0, sbiiQ: 'Q1(low)' };
if (!nadirEvents.length)       return { sbii: 0, sbiiQ: 'Q1(low)' };
if (!n)                        return { pred3p: 0, pred3pQ: 'Q1' };
```

`sbii` is registered `emerging` and cited as *"Sleep-breathing instability index — Σ(D²·T)/TRT,
SHHS-calibrated quintiles; **best oximetry predictor of CVD mortality** (Hui 2024, Respirology
29:825)."*

**Insufficient data returns the lowest-risk quintile.** That is worse than returning `0`, because a
quintile label reads as *a judgement already made* rather than a number awaiting interpretation. A
reader cannot tell it apart from a genuinely low-risk night, and the failure is silent in the
direction that invites no follow-up.

## 3 · Fleet map — and inspection more than halved the count

⚠️ **A first pass COUNTED the pattern and produced a misleading map.** Inspecting the hits changed
the answer materially, and the count alone would have sent someone to fix code that is already
correct. Recorded because it is this repo's recurring failure — a query that ran and examined nothing.

| node | raw count | **after inspection** | notes |
|---|---:|---|---|
| **oxydex-dsp.js** | 11 | **11 real** | all inspected; all fail toward "healthy" |
| **ecgdex-dsp.js** | 4 + derived | **fix IN FLIGHT** | Mutator, `claude/ecgdex-refuse-not-fabricate` |
| **ppgdex-dsp.js** | 5 (+7 bare) | **1 real** | `cvhrFromNN` L1889/1892 → `{events:[], index:0}` |
| integrator-dsp.js | 2 (+3) | **0** | L2592 returns `{ok:false, reason}` — a proper refusal |
| cpapdex-dsp.js | 2 | **0** | L426 already returns `compliancePct: null`; L675 `{available:false, reason:'no-spo2-channel'}` |
| motiondex-dsp.js | 1 | **0** | `{conf:0, flags:['no-data']}` — flagged, not silent |
| **pulsedex-dsp.js** | 0 (+3) | **ALREADY FIXED** | DA-V §2.6 — *"indices that cannot be computed report null, not a graded 0"*, with `F16 · null+null===0 no longer sneaks through the sum-guard` |
| hrvdex-dsp.js · glucodex-dsp.js | 0 | **clean** | the pattern is avoidable, not inherent to the domain |

**PpgDex's single instance is the ECGDex twin.** `cvhrFromNN`'s own comment: *"the Integrator
corroborates finger CVHR against ECGDex cardiac CVHR, so they MUST share a method."* Its `index: 0`
feeds `cvhrIndex` (registered, `emerging`) and reads as **"no cyclic variation detected"** rather than
"not measurable". Fixing ECGDex's `detectCVHR` without PpgDex's would break that shared-method
promise in the opposite direction.

**PulseDex is the pattern to copy, not a new design to invent.** The fix and its assertions already
exist in this repo.

## 4 · Reachability is measured for ONE node only

| node | measured | result |
|---|---|---|
| ECGDex | box **152** + phone **2154** `lombScargle` calls | **0 refusals, min N = 37** |
| everything else | — | **not measured** |

**Latent is not unreachable.** `analyze` already throws on a whole-record shortfall, so these guards
only ever protect the **per-epoch** calls — precisely what a fragmented night, a doffing gap or a
dropped BLE link shortens. ECGDex's margin is one factor of two (min N 37 against a `N < 12` guard).

⚠️ **Measure reachability per node before fixing it.** Latent-but-dangerous and active are different
priorities, and only ECGDex's is known. Five nodes of unmeasured reachability is a programme, not a
follow-up.

## 5 · Evidence discipline — this is the class where a green gate proves nothing

- **Assertions must be SEEN TO FAIL first.** Mutator's ECGDex work: 7 red on `origin/main`,
  `got 0 · want null`, written before the change rather than after it.
- **`DEX_UPLOADS` is mandatory.** The equivalence legs **skip** where `uploads/` is absent, so a green
  run without it proves nothing about the export (§🔏).
- **A DSP change moves `computeHash`**, so corpus-backed fixtures owe re-verification via
  `tools/verify-fixtures.mjs` — never a re-stamp around a moved output.
- **Registry tiers stay untouched.** This is a refusal fix, not a re-grading.

## 6 · Two traps, both paid for on 2026-08-16

**6.1 · A single-bin significance threshold does not transfer to an aggregate.** Investigating CPC, I
measured per-bin magnitude-squared coherence across five full box nights: HFC median **0.31–0.38**
against a 95 % single-bin floor of **0.527**, with only 23–33 % of bins clearing it — and concluded
the band was measuring noise. **Wrong.** `cpc.hfcPct` is a mean over ~100 windows × ~150 bins, and
averaging weakly-coherent bins is *how* a signal too small for any single bin is extracted. It is
validated against device-scored residual AHI over **39 paired nights, r = −0.408, p = 0.009**
(`ECGDEX-CARDIOPULMONARY-COUPLING-FOLLOWUPS` §84) — the **only** metric in that export block that
tracks it; CVHR did not (r = −0.151, p = 0.36) nor did surge-escalation (−0.095, p = 0.56). A refusal
filter keyed to that floor would have destroyed the metric **while looking like rigour**.
⚠️ `ECGDEX-EDR-RESP-ACCURACY` §315 has r = −0.408 queued for re-check: validated, but provisional.

**6.2 · The mirror symmetry, which is the reason to state 6.1 here at all.** The defect in §1
**fabricates presence**; the refusal in §6.1 would have **fabricated absence**. *Both wear the costume
of a careful guard.* A fix in this class is not safe merely because it refuses more — it has to refuse
the right thing, and "more conservative" is not a proof.

## 7 · Done when

- [ ] Reachability measured per node, on **both** capture trees, before that node is touched.
- [ ] Each site returns `null` (or null-valued fields) and every consumer tolerates it — checking
      especially derived expressions, where fabrication re-enters one line after the guard
      (`+pg.sd1.toFixed(2)` throws on null; `+null` is `0`; the `|| 1` shape recurs).
- [ ] PpgDex `cvhrFromNN` fixed **with** ECGDex `detectCVHR`, since they promise a shared method.
- [ ] OxyDex's quintile labels (`sbiiQ`, `pred3pQ`) refuse rather than defaulting to `Q1`. **This is
      the highest-severity item in the brief** — it fabricates a clinical stratification, not a number.
- [ ] `std` / `median` / `quant` returning `0` on empty or `<2` input: **last, and separately.**
      Used throughout, highest blast radius.
- [ ] Registry tiers unchanged throughout.

## 8 · Related

- `PULSEDEX-DA-V` §2.6 — the existing fix and its assertions; copy, do not re-invent.
- CLAUDE.md §🔒 *"EXPORT-INERT IS A COMPUTED VALUE — you don't get to claim it"* — the same family:
  a claim the code was never asked to prove.
- Clock Contract §2.6 — the rule this brief is only asking the DSPs to inherit.
