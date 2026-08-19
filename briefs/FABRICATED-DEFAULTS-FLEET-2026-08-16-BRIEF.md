<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-18 · **Created:** 2026-08-16

> ⚠️ **This brief read `PROPOSED` for two days while every node in it had already SHIPPED**, and that
> cost a near-miss worth recording: on 2026-08-18 a session read the status line, found the OxyDex work
> apparently undone, and was three tool calls from reimplementing all 11 guard sites before
> `rebase-safe` reported `skipped previously applied commit` and `rev-list --count origin/main..X`
> returned **0**. A stale status line is not a cosmetic defect; it is an instruction to redo finished
> work. **ECGDex #1397 · OxyDex #1402 · PpgDex #1464 · `std` #(this PR).**

# Fabricated defaults — the DSPs never inherited §2.6, and every one fails toward "healthy"

## 1 · The class

Clock Contract §2.6 states it plainly: **a missing stamp must be visible (null), never fabricated.**
The parsers honour it. The DSPs never inherited it. Below a minimum-N guard they return **zeros**, and
those zeros reach registered, badged metrics where nothing distinguishes them from a real measurement
of zero.

**`hrvdex-dsp.js` and `glucodex-dsp.js` are clean, and PulseDex already carries the fix.** That is the
load-bearing fact and it belongs before any table: **the pattern is avoidable, not inherent to the
domain.** Three of eight nodes already do it right, so this is a gap in inheritance rather than a
problem with the mathematics.

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

**And the guard is only half of it — the consumer completes the fabrication.** Measured by Mutator on
OxyDex against `origin/main`, seven assertions seen to fail:

```
✕ sbii       got 0          want null
✕ sbiiQ      got "Q1(low)"  want null
✕ pred3p     got 0          want null
✕ pred3pQ    got "Q1"       want null
✕ desSev     got 0          want null
✕ ahiKulkas  got 5.7        want null      ← the consumer defect
✕ ahiODI4    got 0          want null
✓ ahiODI4 still computes from the input it DOES have (5.5)
```

`ahiKulkas` is the one to read twice. `0.6 * null` is `0`, so an absent `DesSev` **silently dropped its
term** and the estimate emerged as **5.7 rather than refusing** — missing data producing a specific,
plausible, *low* AHI. Exactly the `hfnu` shape at a different site: the guard leaks a null, and one
line later ordinary arithmetic converts it back into a number. **Fixing the guard without auditing its
consumers moves the fabrication rather than removing it.**

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
"not measurable". ⚠️ **PpgDex's case is strictly worse than ECGDex's**: its own export comment states
**`"cvhrIndex=0 = none detected"`** — so `0` was already spoken for as a *real finding* before the
guard began emitting it. There is no spare value left to overload. Fixing ECGDex's `detectCVHR` without PpgDex's would break that shared-method
promise in the opposite direction.

**PulseDex is the pattern to copy, not a new design to invent.** The fix and its assertions already
exist in this repo.

## 4 · Reachability is measured for ONE node only

| node | measured | result |
|---|---|---|
| ECGDex | box **152** + phone **2154** `lombScargle` calls | **0 refusals, min N = 37** |
| **PpgDex** | **44 real `PpgDex_*.node-export.json`** (corpus-trio + trio-all), 2026-08-18 | **0 refusals — every night published a real `cvhrIndex`** |
| everything else | — | **not measured** |

**PpgDex measured 2026-08-18: LATENT, 0 of 44.** Not one night hit `N < 60` or `M < 120`; every
export carries a numeric `apnea.cvhrIndex` (first file reads 4.2). The reason is structural rather
than lucky — unlike ECGDex's `lombScargle`, which is called **per epoch** and so meets every short
fragment, `cvhrFromNN` is called **once per record** on the whole corrected beat train, so a full
night cannot be short enough to trip it. What reaches it is a *truncated capture*: a fragment, a
battery death, a session cut before two minutes.

⚠️ The check that mattered was that the query examined something. `absent: 0` beside `zero: 0` is
precisely the shape of a path that silently resolved to nothing, so the field was printed before the
count was believed: `.apnea.cvhrIndex` resolves and reads 4.2.

So the PpgDex fix is a **correctness** change, not an active-harm one, and this brief should not imply
otherwise. Worth stating precisely because §1's OxyDex sites were the opposite — eleven of them, on a
metric whose quintile label reads as a judgement already made.

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

## 6 · Three traps, all paid for on 2026-08-16

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

**6.3 · REFUSE WHEN YOU COULD NOT LOOK; REPORT ZERO WHEN YOU LOOKED AND FOUND NOTHING.** The third
member of the family, and the one that nearly went wrong in the *fix* rather than the defect.
`computeSBII` has two exits:

```js
if (n < 60 || durationHr <= 0) return { sbii: 0, sbiiQ: 'Q1(low)' };   // could not look  → REFUSE
if (!nadirEvents.length)       return { sbii: 0, sbiiQ: 'Q1(low)' };   // looked, found none → 0 is TRUE
```

They are textually identical and semantically opposite. The second is reached **only after the first
passed**, so the night was long enough and the detector genuinely found nothing — and a genuinely
clean night really does belong in the lowest quintile. Mutator nulled it, then reverted: **nulling a
true negative destroys a real measurement**, and it would have been invisible, because a night with no
desaturations and a night too short to look would once again have produced the same output — merely
`null` instead of `0`.

Both cases must be asserted separately. **A fix that only moves the failure is not a fix**, and this
family makes that mistake easy in both directions: §6.1 would have refused a real signal, §6.2 is the
symmetry, §6.3 would have refused a real absence.

## 7 · Done when

- [x] **PARTIAL, and closed as such rather than claimed.** Measured for **ECGDex** (152 box + 2154
      phone `lombScargle` calls, 0 refusals, min N 37), **PpgDex** (44 exports, 0 refusals) and now
      **`std`** (0 exact-zero `sdnn`/`rmssd`/`sdnnIndex` across 132 exports, plus 66 public-call
      differential comparisons across 11 exported functions — 0 differ). **Not** measured for the five
      nodes that turned out to need no fix, and that is the honest reason it stayed unmeasured: the
      condition was "before that node is touched", and they were not touched. Do not read this box as
      fleet-wide reachability coverage.
- [x] **DONE.** Each site returns `null` (or null-valued fields) and every consumer tolerates it —
      checking especially derived expressions, where fabrication re-enters one line after the guard
      (`+pg.sd1.toFixed(2)` throws on null; `+null` is `0`; the `|| 1` shape recurs).
      ECGDex #1397 · OxyDex #1402 · PpgDex #1464. The PpgDex consumer sweep is worth recording as a
      NEGATIVE: every reader already refuses — `integrator-dsp.js:526` digs the field into
      `cvhrIndexWave` and `:3034` requires `!= null && isFinite`, so an unmeasurable finger leg makes
      the corroboration return `null` rather than compute a gap against nothing; `oxydex-fusion.js:552`
      skips its tile; `fnum` renders "—". Unlike OxyDex's `ahiKulkas`, no consumer completed the
      fabrication, so the guard was the only defect.
- [x] **DONE** — PpgDex `cvhrFromNN` (#1464) with ECGDex `detectCVHR` (#1397). Note the direction:
      ECGDex was fixed first, so *leaving PpgDex alone had become the state that broke the shared-method
      promise*, not the conservative one.
- [x] **DONE** (#1402) — verified on `main`: `oxydex-dsp.js:6234` returns `{ sbii: null, sbiiQ: null }`
      and `:6286` `{ pred3p: null, pred3pQ: null }`. **`:6266` deliberately still returns
      `{ sbii: 0, sbiiQ: 'Q1(low)' }`** and that is correct: `!nadirEvents.length` on a night with
      enough data is a genuine *measured* absence of instability, not an absence of measurement. The
      whole point of this brief is that those two are different, so nulling both would be the
      mirror-image error.
- [x] **DONE** — `std` returning `0` on `<2` input, shipped last and separately as designed. ⚠️ **Scope measured 2026-08-18 and
      it is far narrower than this line implied.** `median` and `mean` already return `NaN`, and
      GlucoDex's `quantile` already returns `null` — the defect is **`std` alone, in two files**:

      | file | line | current |
      |---|---|---|
      | `ppgdex-dsp.js` | 87 | `if (a.length < 2) return 0;` |
      | `hrvdex-dsp.js` | 931 | `arr.length > 1 ? Math.sqrt(…) : 0` |

      The sample standard deviation of ONE observation is undefined — the denominator is `n − 1 = 0` —
      so `0` claims *"no variability"* from data that cannot support the claim. An SDNN of 0 ms reads
      as a perfectly regular heart.
      **Reachability: LATENT, 0 of 132.** Across 132 real node-exports (corpus-trio + trio-all) not one
      carries an exact-zero `sdnn`, `rmssd` or `sdnnIndex`. (The query was checked before the count was
      believed: `hrv.time.sdnn` resolves in 26 of 39 sampled files, the other 13 being OxyDex exports
      with no HRV block, and sample values read 50.2 / 159.9 / 61.)
      So this stays **last** — but for the right reason now. It is not deferred because the blast
      radius is unknown; it is deferred because the blast radius is real and the defect is latent, and
      that is a different trade from the one this line originally described.

      **RESOLVED 2026-08-18 — both sites return `NaN`.** The return VALUE was the whole decision, not
      the guard: every caller that declines here tests with `isNaN` or an `|| fallback`, and **both
      `isNaN(null)` and `isFinite(null)` are `false`**, so `null` would have passed every existing
      guard and converted a visible refusal into an invisible one — this brief's own defect, committed
      inside its fix. `NaN` is already what each file's `mean` returns (and hrvdex's `pearsonCorr` for
      `n < 2`), so the honest answer was present in both files and this is inheritance.

      **The fix is DEFENSIVE and that is measured, not assumed:** no public path reaches it —
      `timeDomain` returns null under 2 and clamps `base` to ≥ 2 · `sampEn` guards `N < 60` ·
      `magInterfAtSec` guards `< 3` · both hrvdex call sites pre-check `length > 1`. Differential
      execution over `origin/main` vs fixed: **66 public-call comparisons across 11 exported functions
      on six degenerate inputs, 0 differ.** No golden needed regenerating, unlike PpgDex #1464 where
      three had the fabricated `0` byte-pinned.

      **So the assertions pin the REASON the fix is safe, not the fix** — `ppgdex-dsp ·
      degenerate-refusal` (8 legs) asserts the public boundary refuses, which is the property that
      would have to break for the fabricated `0` to become reachable again. Testing `std` directly
      would assert a line nothing calls. ⚠️ Its anti-vacuity legs fired immediately: the draft used 16
      points as "adequate input" and FAILED, revealing adequacy had been assumed rather than measured
      (`riseFraction` null at 16, `0.713` at 64).
- [x] **DONE** — no registry file was touched by #1397, #1402 or #1464. This was a refusal fix, not a
      re-grading.

## 8 · Related

- `PULSEDEX-DA-V` §2.6 — the existing fix and its assertions; copy, do not re-invent.
- CLAUDE.md §🔒 *"EXPORT-INERT IS A COMPUTED VALUE — you don't get to claim it"* — the same family:
  a claim the code was never asked to prove.
- Clock Contract §2.6 — the rule this brief is only asking the DSPs to inherit.
