<!--
  DEEP-AUDIT-III-2026-07-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-26 · **Method-parent:** `AUDIT-PROMPT.md` · **Sibling:** `CAPTURE-HOST-DEEP-AUDIT-2026-07-26-BRIEF.md` (same day, the producer half) · **Relates:** `DEEP-AUDIT-II-2026-07-18-BRIEF.md`, `DEEP-AUDIT-2026-07-22-BRIEF.md` (§1.1 amends its REFUTED row), `DEEP-AUDIT-2026-07-11-BRIEF.md` (§1.2 and §3.1 amend its punch-list #1 and §15), `DEEP-AUDIT-2026-07-14-BRIEF.md` (§5.1 completes its §3), `MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS-2026-07-22-BRIEF.md` (§4.2 executes its §2)

# Deep audit III — the Integrator's arithmetic, opened for the first time

> **Scope:** the whole Dex suite — 8 node DSPs, the shared spine (`clock.js`, `signal-frame.js`,
> `signal-spec.js`, `metric-registry.js`), ingest/orchestration (`adapters/`, `dex-ingest.js`,
> `signal-orchestrate.js`), the **Integrator** (`integrator-dsp.js`, `crossnight-envelope.js`), and the
> gate/build machinery (`tools/`, `tests/`). `capture-host/` is deliberately **out of slice** — it has its
> own same-day brief.
>
> **Baseline (verified before and re-verified after):** `node tests/run-tests.mjs` → **3903 assertions,
> 257 groups, all pass**; `node tests/verify-manifest.mjs` → **GATE A 9/9 bundles, GATE B 25/25 fixtures
> reproducible**.
>
> **Method:** invariant-and-counterexample per `AUDIT-PROMPT.md`, run as **9 parallel dimension hunters**
> (units · clock · fabricated absence · **Integrator fusion arithmetic** · HRV differential + spectral
> honesty · evidence + fabricated redundancy · contracts/provenance/fail-open gates · ingest + DSP edge
> cases · missing-instance matrix + sibling divergence), each followed by an **independent adversarial
> verifier** told to kill its hunter's findings and default to REFUTED without a reproduction it ran itself.
>
> **30 candidates → 28 CONFIRMED, 2 REFUTED, 0 unverified.** Nineteen ship with a **verifier correction**
> that changed the mechanism, severity, magnitude or — in three cases — **the fix itself**. Read those
> blocks before writing any fix commit: in two instances the hunter's proposed fix was *proven
> insufficient or actively wrong* by the verifier, and shipping it would have fabricated coverage.
>
> **Dimension 4 is the point of this pass.** `AUDIT-PROMPT.md` records that the Integrator's fusion
> arithmetic *"has now been left unaudited by two consecutive passes that both examined the Integrator's
> ingest and presentation and stopped there."* It was opened here, and it produced the two worst findings
> in the brief.

---

## 0. The one-paragraph story

**The Integrator publishes agreement it did not measure.** Its headline `confirmedApneaIndex` **doubles**
when a second oximeter observes the same apneas, because the desat pool's dedupe is a 1-second stamp bucket
rather than an authority merge — 7.5/h (mild) becomes 15/h (moderate) from adding a device, not a symptom.
Its `apneaCoupling.real`, documented as *"the rigorous verdict"*, is `lift > 1` with no significance test at
all, and under the null lift's median **is** 1 — so it fires on **54 % of genuinely independent streams**
(162 of 300 trials), a coin flip published as a finding. Its respiration block fuses **two ECGDex exports
from two different nights** into *"2 independent estimates (ECGDex + ECGDex) … agreement within the ±2
br/min chest-ACC validation band"* — same device, same method, no overlap, no chest-ACC leg. Every
`confirmed_apnea_event` attributes its desaturation to **OxyDex even when OxyDex is not on the bus**. And
`Autonomic ⟷ glycemic` publishes a number computed from the ECG slope alone, under a note claiming *"Single
overlapping night"*, on four nights. That is one class — **a consensus statistic over inputs that are not
independent** (`AUDIT-PROMPT` class 11) — reached five different ways, in the one file no previous pass
opened. Outside the Integrator the pattern repeats at smaller scale: ECGDex counts an **abstaining** ACC
vote as agreement, MotionDex measures a confident breathing rate **across epochs where the strap was not
recording**, and the fleet-wide Clock lint that prints *"clean across 70 files"* is scanning 70 of the 124
shipped `.js` files — **failing open by omission** on a hand-maintained list nothing keeps in sync.

---

## 1 · The shared spine — `clock.js` and the Clock-Contract gate

### 1.1 `resolveDMY` computes `contradictory` and all six callers throw it away — `clock.js:97`

The doc-comment at `clock.js:66` says *"the file contradicts itself ⇒ refuse (`contradictory:true`) rather
than guess"*, and `DEEP-AUDIT-2026-07-11` punch-list #1 (stamped EXECUTED) claims the same word. Nothing
refuses. The contradictory return is byte-identical in effect to the genuinely-ambiguous one — `locked:false`
plus the caller's preference — and `grep -rn contradictory` finds the flag **written** in `clock.js:97` and
its `glucodex-dsp.js:140` clone, **read by nobody**.

```
CLEAN    resolveDMY={"dmy":false,"locked":true,"contradictory":false}
         night.date=2026-06-12  t0Ms=1781305216000
POISONED resolveDMY={"dmy":true,"locked":false,"contradictory":true}
         night.date=2026-12-06  t0Ms=1796598016000
```

One anomalous row moves a proven-MDY O2Ring night **six months**.

> **Verifier correction.** *"with no flag, no reason, no warning"* is **false** — OxyDex's honesty guard does
> fire (`durationMin` → null, `clockNonMonotonic` → true). What survives **silently** wrong is only the
> **date**: `night.date`, `t0Ms`, `exportName()`, the crossnight axis and the Integrator's cross-node date
> join. Keep the finding, narrow the claim.

**Fix.** Make the refusal real at the seam that already exists — `parseTimestamp` gains
`opts.dmyContradictory` and returns **null** for the two ambiguous slash shapes when set (honest null per
§2.6). **Gate cost: `clock.js` is the shared spine ⇒ re-bundle all 8 apps + re-stamp all 8
`provenance/<App>.json` fragments, serialized per `CLAUDE.md` §👥.3; `computeHash` moves ⇒
`DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` re-verification owed.**

### 1.2 The time-only roll has zero backwards tolerance — `clock.js:184`

`while (t < opts.prevTMs) t += 86400000` treats a **1-second** backwards step as a midnight wrap. Both
in-repo siblings that do this job carry a tolerance — `oxydex-fusion.js:42` and `cpapdex-coimport.js:49` both
use `prevMs - 1000`, the latter documenting exactly that reasoning under `DEEP-AUDIT-II §6.4`. **The
canonical parser diverged from its own two correct siblings.**

```
time-only CLEAN     durationMin=120   clockNonMonotonic=false  start 23:00:16 end 01:00:15  sbii=81.383
time-only +1 BLIP   durationMin=1560  clockNonMonotonic=false  start 23:00:16 end 01:00:15  sbii=6.26
```

One duplicated row turns a 120-min night into 1560 min and collapses SBII **13×**, while start/end still read
correctly and the non-monotonic flag stays false — because `oxydex-dsp.js:2500`'s guard is
`_durBad = !(rawDurMs >= 0)`, which catches only a **negative** span.

> **Verifier correction — the proposed fix is INSUFFICIENT, and this was proven, not argued.** A patched
> copy in a fresh realm still rolls on every step larger than the slack:
> ```
> CURRENT        1s→ROLLED  2s→ROLLED  5s→ROLLED  60s→ROLLED  3600s→ROLLED
> PATCHED(-1000) 1s→ok      2s→ROLLED  5s→ROLLED  60s→ROLLED  3600s→ROLLED
> ```
> A real midnight wrap is ~23 h backwards, so the guard should be a **fraction of a day** (e.g. roll only
> when the step back exceeds ~12 h), not a 1 s slack. Severity also drops to **latent** — no vendor in either
> corpus ships a time-only-stamped CSV today.

**Fix.** Widen the roll condition properly, *and* independently harden OxyDex's guard so an **inflated** span
is visible (flag when `rawDurMs` exceeds the span implied by row count × cadence). Same spine gate cost as §1.1.

### 1.3 PpgDex's parser rounds a `.9995` fraction to 1000 ms and then rejects its own stamp — `ppgdex-dsp.js:58`

```
"2026-06-17T01:02:03.9995"  DexClock=…03.999Z | PPGDSP=null | GLUDSP=…03.999Z | CPAPDSP=…03.999Z
```

`Math.round(parseFloat('0.'+frac)*1000)` overflows where all four siblings truncate (`+(m[7]+'00').slice(0,3)`).
PpgDex is a *sanctioned* node-local variant, so this is a bug **inside** the variant, not a call to unify it.
Latent: every real producer writes exactly 3 fractional digits.

> **Verifier correction.** Broader than "rounds .9995 up": an exhaustive sweep shows all 1000 three-digit
> fractions agree, but on **>3-digit** fractions it is rounding-vs-truncation **in general** (`…03.0005` →
> PPG=1, Dex=0), not only at the top.

**Fix.** One token: truncate, never round. **Gate: re-bundle PpgDex only.**

### 1.4 The Clock-Contract lint says "clean across 70 files" while 44 shipped files are outside its scope — `tests/dex-tests.js:8808`

The A1 house-invariant lint is scoped to `Object.keys(env.sources)` — a hand-curated array in
`tests/run-tests.mjs:214-297`. Nothing keeps it in sync with what the bundler actually inlines, so **the gate's
scope silently shrinks relative to the shipped code**: it fails **OPEN by omission** while printing a
fleet-wide guarantee.

```
✓ A1 · no Date.parse() on any source  — clean across 70 files
data-inline-src="integrator-longitudinal.js"
integrator-longitudinal.js:343:  return r.t0Ms != null ? r.t0Ms : r.date ? Date.parse(r.date) : …
```

> **Verifier correction.** "54 unwired files" overcounts (it includes files that ship in no bundle). The
> load-bearing number is **44 shipped-and-unscanned**, and the useful framing is *which*: `motiondex-dsp.js`
> (an entire node's DSP), `cpapdex-coimport.js` (itself the subject of §1.2's sibling comparison),
> `nsrr-adapter.js`, and all 9 `adapters/*.js`.

**Fix.** Derive the lint's file set from the tree — the union of every `data-inline-src` in the 10 owned
bundles — so *"any source"* means *"any code we ship"*. **Gate: `tests/` only.**

---

## 2 · Units — three guards that cover only part of their own field

### 2.1 HRVDex: three of six `_meanRR` consumers bypass the unit guard — `hrvdex-dsp.js:636`

`DEEP-AUDIT-2026-07-11 §4` and `DEEP-AUDIT-2026-07-22 §E` each installed one instance of the
`DexUnits.asSecondsRR` guard. Three expressions still read `_meanRR` **raw**, in the same loop, on the same row:

```
>>DIFF d_cvi       4.577 → 1.577   (Δ = −3, exactly log10 of a product of two ms→s conversions)
>>DIFF d_nn50      60    → 59 999
  ok   d_csi / d_rsa / d_mxdmn_meanrr / d_si   INVARIANT
```

`d_cvi` is rendered as the **Toichi CVI** KPI with a colour rule `>4.4 good / >4.1 warn / else bad` — 1.58
paints a red *"bad"* cardiac-vagal verdict. **This also overturns `DEEP-AUDIT-2026-07-22`'s REFUTED row**
(*"d_cvi … internally consistent (both operands from the same vendor), correct"*): ratio-cancellation
reasoning does not hold for a **log of a product**, and `d_nn50` reads a single operand, so nothing can cancel.

> **Verifier correction.** `d_cv_calc` is **not** part of the defect — it is invariant under any
> vendor-*consistent* convention; the hunter's row B fabricated a mixed ms/s convention no producer emits.
> Drop it. Severity: **latent** — every real vendor row carries meanRR in ms.

**Fix.** Route the remaining sites through the existing single source and add a metamorphic ms≡s assertion
mirroring the one `d_csi` already has. **Gate: `hrvdex-dsp.js` is inlined by HRVDex + Data Unifier +
OverDex ⇒ three bundles, serialized (the orchestrators are the fleet chokepoint); `computeHash` moves ⇒
corpus re-verification owed.**

### 2.2 MotionDex assumes `mg` for any unrecognised ACC unit — `motiondex-dsp.js:105`

The unrecognised-unit path silently returns `'mg'` rather than `null`, so an `m/s²` file would be scaled
9.8×-wrong with no flag.

> **Verifier correction — the severity attaches to the other half.** The unit fall-through has **no
> reachable producer**: 500 real ACC files surveyed, all `[mg]` headers, and `capture-host/writers.py:165`
> hardcodes it. What *is* reachable is the **absent magnitude oracle** at the parse boundary — the sibling
> `classifyGravity` already implements one. File the fall-through as robustness; file the missing oracle as
> the real defect.

### 2.3 `SignalSpec.cgm.unit` declares mmol/L for frames that carry mg/dL — `signal-spec.js:69`

Every `cgm` producer emits mg/dL; `toSignalFrame`'s fixed field list has no `unit` key, so the adapter's
honest source-unit tag is **discarded** and cannot be recovered downstream.

> **Verifier correction — downgraded.** `describeFrame` is **dead code** (zero callers), so the only live
> surface is the Data Unifier routing card. Robustness/code-health, not contract-drift.

**Fix.** Set `cgm.unit = 'mg/dL'` (the canonical internal unit; `CLAUDE.md` §📏 permits the clinical metric
unit) and add `unit` to the frame shape so an adapter's tag survives.

---

## 3 · The Integrator's fusion arithmetic — first pass ever

### 3.1 A second oximeter doubles the desat pool and halves the match-rate KPI — `integrator-dsp.js:1414` — **FIXED 2026-07-27**

> **Correction, from executing the fix — and the mutation check is what caught it.** The filed headline
> (*"a second oximeter **doubles the index**"*) is **overstated**. Run against pre-fix code with one ECG
> stream, the new regression test shows `confirmedAHI` **does not move**: `usedSurge` is a `Set`
> (`integrator-dsp.js:1516`), so each surge is consumed by at most one desat and the duplicate copy of every
> desat lands in `unmatchedDesat` instead. The original repro reached 15/h only because its second observer
> duplicated the **cardiac** side as well. What a redundant oximeter *does* corrupt, measured:
> ```
> OLD code, 60 apneas, one ECG:  total.desat = 120   ✕ "the desat pool is not doubled" — got 120 · want 60
> NEW code, same input:          total.desat =  60   ✓
> ```
> `total.desat` **is** surfaced: `integrator-render.js:436` renders **`Desat match rate`** as
> `matched.desat / total.desat`, badged **`measured`** — so a flawless 60/60 night reads **50 %
> (“60/120 desats paired”)**, with the unmatched-desat list doubled beside it. Still a surfaced wrong number
> at `measured` tier; it is the **match rate**, not the index. The index doubles only when the cardiac side is
> duplicated too — a **separate, unfixed instance of the same defect**: `gather()` applies the identical
> 1-second key to the **surge** pool, so two cardiac observers (H10 + Verity) double `total.surge` and
> therefore `lambda`/`surgeRatePerHr`, pushing the Poisson null toward `belowChance` and **suppressing real
> findings**. Filed for the follow-up brief; not fixed here (one gated change at a time).

`gather()` dedupes the desat pool with `key = impulse + '@' + Math.round(tMs/1000)`. Its own comment says the
dedupe exists *"so the same night seen via two ECG recordings can't enter the pool twice"* — but it collapses
only events whose stamps round to the **same second**. `DEEP-AUDIT-2026-07-11 §15` then deliberately re-keyed
the pool by **impulse** rather than by node, making CPAPDex a first-class `desat_event` emitter from its own
SA2 oximeter clock. Two devices, two clocks, one night ⇒ every apnea counted twice, and the KPI crosses the
**mild → moderate** clinical boundary.

> **Verifier correction.** Blast radius is bounded at **2×**, not N× — exactly two producers exist on the bus.

**Fix AS LANDED (2026-07-27) — and the sketch below was NOT followed.** The sketch says *"collapse desats
within the alignment tolerance `dtMs`"*. `dtMs` **defaults to 120 s**, and apneas recur every 20–60 s in severe
OSA, so that merge would have collapsed genuinely distinct events and **under-counted exactly where the count
matters most** — trading a doubled pool for a silently halved one. Any tighter tolerance would be a guess about
inter-device clock skew *and* device-specific nadir averaging. What landed instead is the sketch's own first
clause taken literally: **an authority spine**, the shape `pickHRAuthority` already uses. `pickDesatObserver()`
picks the observer whose own union with the cardiac nodes covers **more of the night** (coverage is measured,
counts hours not events, so it cannot bias toward a noisier device); ties fall to a node ladder
(`DESAT_OBSERVER_AUTHORITY`, encoding one physical fact — a wired oximeter cannot drop a BLE link); the events
**and** the AHI denominator both come from that observer, so the index stays self-consistent. The other
observers are reported in a new additive `desatObserver.alsoObservedBy`, not silently dropped. With one
oximeter on the bus — every night in the corpus today — it is a no-op, which is why no fixture moved.
**Gate:** `node tests/run-tests.mjs` **3911 assertions green with `DEX_UPLOADS` (0 skipped, equiv/GATE-C legs
included)** · `build.mjs --check` clean (11 owned) · GATE A 9/9 (`Integrator.html` `16ca95f0b69c` →
`e73344812eea`, `OverDex.html` re-bundled) · `verify-fixtures.mjs` re-stamped
`integrator_tch_golden verifiedUnder → 36e9f06bfd91` after a green corpus run · changeset
`changes/2026-07-27-integrator-desat-observer-spine.md`. New gate group: *"A second oximeter cannot double the
apnea index — §3.1"* (8 assertions), **mutation-checked**: 4 of its 8 fail against pre-fix code, including a
case proving a non-redundant observer is still counted, so the fix cannot silently swallow events an observer
genuinely saw alone.

<details><summary>Original fix sketch (superseded — kept for the record)</summary>

An authority/merge step, not a stamp-equality dedupe — the same shape `pickHRAuthority` already
implements for the HR witness: collapse desats within the alignment tolerance `dtMs` that come from different
nodes, keeping the higher-authority observer. **Gate: re-bundle Integrator; `computeHash` moves ⇒
re-verification owed.**

</details>

### 3.2 `apneaCoupling.real` is `lift > 1` — a coin flip labelled "the rigorous verdict" — `integrator-dsp.js:1562` — **FIXED 2026-07-27**

```
trials=300  usable=300  real(among usable)=162   => false-positive rate 54.0%
lift over INDEPENDENT streams: min 0.347  median 1.022  max 2.097
```

`real = usable && lift > 1 && observedPct > chancePct`, with **no p-value anywhere**. The two guards it leans
on protect against *different* failures: `underpowered` protects a low lift from reading as absence;
`saturated` protects a lift ≈ 1 on a too-wide window. **Neither tests that an above-1 lift is distinguishable
from chance.**

> **Verifier correction.** The ~50 % rate is **by construction**, not accident: `chancePct` is the mean of the
> surrogate distribution — the estimator's own expectation under the null — so `observedPct > chancePct` is a
> fair coin by definition.

**Fix AS LANDED (2026-07-27).** `real` is now the exact one-sided permutation p-value against the
window's own surrogates — `pPerm = (1 + #{null ≥ observed}) / (1 + m)`, `real = usable && pPerm < α`,
α = 0.05 — with `pPerm`, `pFloor` and `alpha` published beside it. The +1/+1 correction is deliberate
(Phipson & Smyth 2010): an unadjusted `k/m` can return **p = 0**, which asserts impossibility from a
finite sample.

Two things the sketch did not anticipate, both found by executing it:

1. **The surrogate count is the consumer's cost, not the primitive's default.** `pPerm` can never fall
   below `1/(m+1)`, so with the primitive's 10 default shifts the floor is **0.091** and a p < 0.05
   verdict is *arithmetically unreachable* — the old rule could not have been replaced without also
   buying power. `EventCoupling.shiftsForAlpha(α)` now sizes the set, and the Integrator calls it: the
   node that wants to publish a claim pays for it. `pFloor` ships in the block so "not significant" can
   never be confused with "too few surrogates to tell".
2. **Reachability alone leaves a knife-edge.** At the minimum m = 20, `p < 0.05` requires the
   observation to beat **every** surrogate — and this module's own resonance caveat describes how a
   single shift can re-phase onto stream B's period and score like the observation. One unlucky
   surrogate would then turn a real coupling into a null result. The set is therefore sized for
   *resolution* too — tolerate 3 exceedances and still clear α ⇒ **m = 80**.

**Measured through the shipped path** (not through a p-value the test computes for itself — that
version passed against the old rule for the wrong reason, and was rewritten):

| | independent streams called `real` | planted coupling |
|---|---|---|
| pre-fix (`lift > 1`) | **47.5 %** (19 of 40 usable) | real ✓ |
| permutation test | **2.5 %** (1 of 40) | real ✓ (p = 0.0123) |

The right-hand column is the point: a verdict that is merely *stricter* is a mute button, not a fix.

**Gate:** 3923 assertions green with `DEX_UPLOADS` (0 skipped) · GATE A 9/9 (`Integrator.html`
`bdc5fc47fed7` → `6e6a28ffcee7`, `OverDex.html` re-bundled — both inline `event-coupling.js`) ·
`build/--docs/--analysis --check` clean · biome 2.5.3 clean · `verify-fixtures` re-stamped
`integrator_tch_golden verifiedUnder → 626fee271d66` after a green corpus run. New group *"Coupling
`real` is a permutation test, not a coin flip — §3.2"* (11 assertions), **mutation-checked**: 4 fail
against pre-fix code, the load-bearing one reporting the 47.5 % false-positive rate.

### 3.3 Every confirmed apnea attributes its desat to OxyDex — even with OxyDex absent — `integrator-dsp.js:1459` — **FIXED 2026-07-27**

```
nodes on the bus  : CPAPDex, ECGDex
finding[0].nodes  : ["OxyDex","ECGDex"]
finding[0].sources: [{"node":"OxyDex",…}, {"node":"ECGDex",…}]
```

`nodes: ['OxyDex', s.node || 'ECGDex']` hardcodes the desat side's provenance. That was correct while the pool
was `_byNode(recs,'OxyDex')`; §15 made it impulse-keyed and the attribution was never updated. **The surge side
was done correctly** (`s.node || 'ECGDex'` + `meta.surgeNode`) — the sibling is the fix.

> **Verifier correction.** One sub-claim is refuted and must be struck: the speculation about a PpgDex record
> supplying *both* sides sends the fixer after a guard that guards nothing.

### 3.4 Respiration "consensus" fuses one node with itself across nights — `integrator-dsp.js:2474` — **FIXED 2026-07-27**

```
sources: [ {node: ECGDex, method: "RSA (ECG)", brpm: 14.4},      ← 2026-07-01
           {node: ECGDex, method: "RSA (ECG)", brpm: 15.2} ]     ← 2026-07-02
n: 2   → "2 independent estimates (ECGDex + ECGDex) … agreement within the ±2 br/min
          chest-ACC validation band (Ryser 2022)"
```

No temporal-overlap grouping, no collapse to one observer per node, and `runFusion` is called with the **whole
loaded bus**. This is `AUDIT-PROMPT` **class 11** in its purest form — and the sibling `fusePeriodicBreathing`
already implements both missing guards.

### 3.5 `fusePulseCrossCheck` compares recordings nights apart — `integrator-dsp.js:2282` — **FIXED 2026-07-27**

A finger PpgDex export and an O2Ring OxyDex export **three nights apart** yield `biasBpm: 2.5`, `agree: true`
and a human-readable note about vendor smoothing that measures nothing. The doc comment at `:2280` states the
contract the code does not enforce (*"one session"*), and the call site's own comment says *"no overlap gate"*
out loud. **Reachability is thin today** (no `site:'finger'` PpgDex export exists in the corpus) — the verifier
insisted this be stated.

### 3.6 `Autonomic ⟷ glycemic` publishes an ECG-only number under a false note — `integrator-dsp.js:1902`

```
per-night glucoseCV: 14.2, 14.2, 14.2, 14.2   (the SAME whole-wear value on every night)
r = null | directional = 0.3 | SURFACED glucoseAutonomicCorrelation = 0.3 | n = 4
note: "Single overlapping night — directional estimate only …"
```

Three lines chain: `glucoBuildNodeExport` emits no `timeseries`, so `hasCells` is always false and the same
whole-wear CV is stamped on every night; `pearson` over a constant series returns null; the `directional`
fallback then publishes `0.5 + clamp(oneNightSlope)` — a pure function of ECGDex — as the surfaced
cross-signal coupling, while the note claims one overlapping night over four.

> **Verifier correction.** The ECG-only formula is the *designed* single-pair estimate; the defect is that the
> **canonical GlucoDex export starves the windowed path**, so the fallback fires when it should not.

**Fix.** Emit the `timeseries{cadenceMin,t0Ms,cells[]}` block the app already builds (**this also fixes §6.2**),
and make the note reflect the actual `n`.

---

**§3.3/§3.4/§3.5 FIXED 2026-07-27 — one file, one edit.** The desat side now carries `d.node` exactly as
the surge side already carried `s.node` (plus `meta.desatNode`); `fuseRespirationRate` fuses only within a
temporally overlapping group and collapses to **one observer per node** before its `<2` check; and
`fusePulseCrossCheck` selects an **overlapping pair** instead of the first of each kind.

**The guard deliberately rejects only PROVEN-disjoint records, and that is a decision worth recording.**
§6.2 of this same brief shows HRVDex and GlucoDex declare **no duration key at all**, so `recWindow`
returns null for them — their window is *unknown*, not disjoint. A strict "must provably overlap" rule
would have silently dropped whole nodes out of fusion, trading a wrong number for a **missing** one, which
is the mirror-image defect. So `_mayOverlap` fuses when the windows overlap **or when either is unknown**,
and both blocks now publish **`overlapVerified`** so a "one session" claim can be read for exactly what it
is. **Gate:** 3954 assertions green with `DEX_UPLOADS` (0 skipped) · GATE A 9/9 (`Integrator.html`
`6e6a28ffcee7` → `732cc553e00f`, `OverDex.html` re-bundled) · **mutation-checked: 7 of the group's 11
assertions fail against pre-fix code**, one of them printing the fabricated claim verbatim.

## 4 · MotionDex — a sample rate derived from wall-clock, and a rate measured across a gap

> **ALL THREE FIXED 2026-07-27** — one file, one edit, one re-bundle, as this section argued.
>
> · **§4.1** `sampleHz` is now the median inter-sample interval (the measurement `respResample` in the
>   same file already did correctly), with the span-based form kept only as a last resort for rows that
>   carry no usable deltas at all.
> · **§4.2** `respResample` publishes a coverage mask: grid points interpolated across a gap wider than
>   four native periods are uncovered. Such a window gets a **uniform likelihood** rather than the
>   spectrum of the interpolated line — the verifier's point that `respViterbi` is a GLOBAL ridge track,
>   so a fabricated ridge corrupts CLEAN windows too, is what forced this rather than a simple null-out.
>   The window ships as `covered:false` with a null rate and **leaves the coverage denominator**.
> · **§4.3** samples beyond hardware full scale are **dropped and counted** (`_implausibleDropped`),
>   the PpgDex precedent — never clamped, since a clamped sample is a fabricated reading at the bound.
>   Verified on the real file the finding cites: **136 samples dropped**, exactly the audit's count, and
>   the 5.02e32 `Effort amplitude` saturation is gone.
>
> **Gate:** 3936 assertions green with `DEX_UPLOADS` (0 skipped) · GATE A 9/9 (`MotionDex.html`
> `c1563dc52703` → `1396dc11ce29`) · `resp-acc-analysis.html` + docs re-bundled · `verify-fixtures`
> reports all 14 current (the MotionDex golden has committed inputs, so CI re-runs it every push).
> New group *"MotionDex: rate, coverage and plausibility — §4"* (10 assertions), **mutation-checked:
> 6 fail against pre-fix code**, including the denominator — old coverage 0.667 vs new 1.0 on a
> stream whose uncovered windows should never have been counted.

### 4.1 `sampleHz` divides count by span, so any gap mis-scales every window — `motiondex-dsp.js:214/220`

Filed independently by **two** hunters (dimensions *absence* and *matrix-siblings*), on the same function.

```
real Verity ACC file, 102 671 rows
metric   SHIPPED count/span   median-delta   Δ
hz       18.68                52.00          −64.1 %

SAME SAMPLES, gap in the clock : hz=38.03  legacyRate=13.7  amplitudeG=0.0140  movementIndex=0.4191
SAME SAMPLES, clock contiguous : hz=50.68  legacyRate=16.8  amplitudeG=0.0154  movementIndex=0.4359
```

Consumers assume a **native** rate: the 10 s gravity/drift MA, the 1.5 s cardiac de-noise MA, the 1.2 s breath
refractory, and actigraphy's ~1 s gravity baseline all become too short in real time. The correct
implementation is 8 lines away in the same file (`respResample`'s median delta).

> **Verifier corrections.** (a) **Prior art exists** — `MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS-2026-07-22 §2`
> (still open) proposes exactly this fix; cite it rather than claiming discovery. (b) **Strike the
> effort/apnea-typing consequence** from the second filing — it was produced by passing a *wrist* file into
> the `chestAcc` slot, which `slotFor()` gates against.

### 4.2 `respiratoryRate()` measures a confident rate across epochs where the strap was off — `motiondex-dsp.js:786`

```
trueBrpm 10 | FULL 10.3 | GAPPED 18.2  rateCoverage 0.664 | in-gap fabricated n=78 median 18.2
trueBrpm 15 | FULL 15.1 | GAPPED 17.8  rateCoverage 0.933 | in-gap fabricated n=73 median 18.5
```

`respResample()` fills a sensor-off hole by **linear interpolation**, so the gap becomes a synthetic straight
line rather than a hole; `respWindowSpectrum()` normalises each channel's in-band power to sum 1 and then
re-normalises, **discarding amplitude — the only thing that distinguishes "no signal" from "signal"**. 73 of 80
sensor-off windows return a brpm at conf up to 0.882. Textbook `AUDIT-PROMPT` class 3a.

> **Verifier correction.** The mechanism is worse than filed: `respViterbi` is a **global** ridge track, so the
> fabricated ridge corrupts **clean** windows too — measurable at 83 % coverage, not just when gap windows
> outnumber real ones.

**Fix.** A per-grid-point coverage mask, `brpm=null` plus exclusion from `kept`/`series.length` below a
coverage floor (mirroring `bodyPosition`'s `covered` counter).

### 4.3 No plausibility bound on IMU samples — `motiondex-dsp.js:174`

```
out-of-full-scale (>16 g): 136 of 102 671   worst |x| = 1.62e38 mg
RENDERED "Movement index" : 1.03e34      RENDERED "Effort amplitude": 5.02e32
RENDERED "Signal quality" : conf 0.96, flags []   ← clipFrac is a FRACTION test; 0.13 % can't trip 2 %
```

> **Verifier correction — lead with the other number.** `1.03e34` is self-evidently broken; a human knows
> something failed. The **plausible-but-wrong** number, which is the class this suite actually fears, is the
> sibling KPI on the same card: **"Immobile time" reads 20 % for a night that is 96 % immobile.**

**Fix.** A unit-aware per-sample bound (ACC ≤ 16 g, GYRO ≤ 2000 dps, MAG ≤ 4900 µT), finite-check Y and Z as
well as X, and follow the **PpgDex precedent — drop and COUNT**, not the ECGDex clamp. All three MotionDex
findings are one `motiondex-dsp.js` edit: **land them together**.

---

## 5 · HRV differential and spectral honesty

### 5.1 PulseDex's **surfaced** Total Power still breaks the Task-Force identity — `pulsedex-app.js:710`

```
APP lastResult : tp=2069  vlf=870 lf=648 hf=243   vlf+lf+hf=1761
DSP compute    : tp=1761  vlf=870 lf=648 hf=243   vlf+lf+hf=1761
→ identity broken by 308 ms² (17.5 %) on a real 179-min RR file
```

`DEEP-AUDIT-2026-07-14 §3`'s EXECUTED header claims the fix landed on *"BOTH PulseDex spectral paths"* — the
two paths it names are **both inside the DSP**. The app that renders the number was never touched, so the UI
takes a 4th independent median while the DSP sums the bands.

> **Verifier correction.** *"the node-export carries the correct band sum"* is **false** — the export omits
> `totalPower` entirely.

**Fix.** Mirror the DSP (`tp = _wv + _wl + _wh`), drop the dead accumulator, and close the hollow gate: the
existing PulseDex §3 group must drive the **app** path, not only the DSP.

### 5.2 LF/HF is ratio-of-medians in PulseDex, median-of-ratios in ECGDex and PpgDex — `pulsedex-dsp.js:1258`

```
file                      nWin  ratioOfMedians  medianOfRatios  Δ
20260612_225442_RR.txt    85    2.342           2.108           11.1 %
20260615_215320_RR.txt    90    2.673           2.252           18.7 %
```

The Integrator reads both into one `summary.lfhf` and publishes a cross-node `hrvConsensus.lfhf` spread — so a
**purely definitional** gap is reported as sensor disagreement on identical beat truth.

> **Verifier correction — the proposed fix would ship a NEW inconsistency.** The "PpgDex is the honest
> sibling" framing is wrong: ECGDex does the same `hf || 1` fabrication per-epoch. Pick the convention
> deliberately and apply it to all three, rather than porting one sibling's half-fix.

---

## 6 · Evidence honesty, contracts, ingest and gates

### 6.1 ECGDex counts an **abstaining** ACC vote as agreement — `ecgdex-dsp.js:3072` — **FIXED 2026-07-27**

`if (vote === 'Ambiguous') { agreed++; }` — the vote is explicitly tri-state (*"Wake>20 / Ambiguous 5–20 /
Sleep<5"*) and the third state is folded into the **numerator** instead of leaving both numerator and
denominator. The exact inversion of class 3a.

```
HRV stage = Wake on ALL 20 epochs
surfaced consensusRatePct = 30 %   (hero number; ≥85 paints "Strong consensus")
abstentions counted as AGREED = 5
honest rate, abstentions out of BOTH = 7 %
```

> **Verifier correction.** Magnitude was overstated: 16.9 % is the *abstention share*, not the inflation. The
> measured surfaced-vs-honest gap on four real H10 nights is **2, 3, 4 and 6 points** — but the pill-boundary
> crossing was independently verified.

**Fix AS LANDED (2026-07-27).** An abstention leaves BOTH sides: `rate = agreed / (n − nAbstained)`,
with `nVoted` and `nAbstained` published in the block and in `sleepStageConsensus`. The card's sub-line
changed with it — it read "N stage epochs" beside a rate whose denominator is no longer N, which would
have been a new small dishonesty introduced by the fix itself. Committed synthetic (4 agreements,
4 abstentions, 3 conflicts): **pre-fix 75 % vs honest 63 %**. **Gate:** 3943 assertions green with
`DEX_UPLOADS` (0 skipped) · GATE A 9/9 (`ECGDex.html` `b89f59803103` → `9f98493f904c`; Data Unifier +
OverDex re-bundled) · analysis + docs re-bundled · `verify-fixtures` re-stamped after a green corpus run.
**Mutation-checked:** 4 of the group's 7 assertions fail against pre-fix code.

### 6.2 Two nodes declare no duration key, so their records collapse to a point — `hrvdex-dsp.js:1098`, `glucodex-dsp.js:1946`

```
OxyDex + CPAPDex only      : intersectionMin = 420
… + the REAL HRVDex export : intersectionMin = 0   ("Excluded (no temporal overlap): HRVDex")
```

`adaptEnvelopeNode` reads `endEpochMs / durationMin / durationMs / durationSec / durSec`; HRVDex writes
`firstTMs/lastTMs/spanDays` (which nothing reads) and GlucoDex writes none plus no `timeseries`. **The
healthiest CGM record — zero events because everything was in range — is the one that drops out of the fold.**

> **Verifier correction — the proposed fix would FABRICATE coverage.** Stamping
> `durSec = (lastTMs − t0)/1000` on HRVDex would declare a **29-day** window as continuous recording, turning
> an honest exclusion into a false 29-day overlap. The fix must express *sparse* coverage, not a span.

### 6.3 `parseDeviceHR` reads the last column — which is HRV in ms — `ecgdex-dsp.js:3274` — **FIXED 2026-07-27**

```
header : Phone timestamp;HR [bpm];HRV [ms];Breathing interval [rpm];
TRUTH  (column "HR [bpm]") : n=21613  min=46  max=78  mean=50.47
parseDeviceHR() returned   : n= 6396  min=20  max=70  mean=39.94   (70.4 % of rows dropped)
```

PSL emits a 2-field row when HRV is absent and a 3-field row when present, so on the real corpus **the last
column is HRV-in-ms on the majority of rows**, and the 20–260 band silently launders it into plausible "HR".
This drives ECGDex's surfaced *ECG-derived vs Device HR* validation card — mean, range, MAE, correlation *r*
and its green/yellow/red pill.

**Fix AS LANDED (2026-07-27).** The column is resolved **by header** — a port of
`motiondex-dsp.js xyzColsFromHeader`, which had it right — with `\bhr\b` deliberately not matching
`hrv` (no word boundary before the v), so the interval column can never be taken for the rate column.
Headerless files fall back **by shape, per row**: a bare list of rates reads column 0, anything wider
reads the first field after the stamp. Neither choice can land on an interval, and the pre-existing
bare-value contract (`58\n60\n62\n`) is preserved.

**The defect was worse than filed — it has two faces, and the second is invisible in the write-up.**
Executing it against both real layouts:

| layout | last column | pre-fix result | truth |
|---|---|---|---|
| Polar SL (`…;HR [bpm];HRV [ms];…`) | HRV ms on 3-field rows | n=6396, mean **39.94** | n=21613, mean **50.47** |
| capture-host (`…;HR [bpm];RR-interval [ms]`) | RR ms, 857–1062 | **n=0** | n=138, mean 61.64 |

On capture-host files every RR value exceeds the 20–260 bpm band, so **every row was rejected**: the
validation card did not go wrong there, it went **silent**, on every capture-host night. Post-fix both
layouts reproduce their labelled-column truth exactly.

**Gate:** 3914 assertions green with `DEX_UPLOADS` (0 skipped) · GATE A 9/9 (`ECGDex.html`
`f97624c0a100` → `b89f59803103`; `Data Unifier.html` + `OverDex.html` re-bundled) · **8 analysis pages
re-bundled** (`build-analysis.mjs` — they inline the DSP in worker blobs; `--check` caught them) ·
docs re-bundled · `verify-fixtures` re-stamped `ECGDex_2026-06-27_equiv verifiedUnder → d11461c7983e`
after a green corpus run. Both real headers ship as **committed twins** in the gate — a gitignored
recording would have left CI exactly as blind as the positional read was. **Mutation-checked:** the
twins return `[57]` and `[]` against pre-fix code.

### 6.4 Ingest: three routing defects — `dex-ingest.js:63/80/92`

- **`_MAG` vs `_MAGN`** — every classifier except MotionDex knows only `_MAGN`; the capture host writes
  `_MAG.txt`. **688 files** across the corpus are silently never paired, and PpgDex tells the user
  *"No `*_MAGN.txt` for this session"* about a file sitting in the drop. `motiondex-dsp.js:109` is the
  in-tree proof the one-character fix works.
- **A foreign chest strap enters the H10 companion lane** — `SignalAdapters.route()` sends the Coospo file to
  `coospo-rr` while `DexIngest` returns `deviceKey: null` and admits it unconditionally. **Two routing layers,
  one file, two answers.** *(Verifier: latent today — becomes live once the `_MAG` fix lands.)*
- **Non-signal files default into the ECG primary lane** — 40 of 67 "ECG recordings" on a real night folder are
  the capture host's own `_CLOCK.csv` / `_LINK.csv` telemetry and `QC-SUMMARY.json`. The default is
  **fail-open**, and the content sniff is an allow-list that also fails open on any header it has not seen.

### 6.5 The badge fallback hides surfaced numbers with no registry entry — `oxydex-render.js:321`

`badgeForLabel(label, true)` mints an `ev-experimental` disc for any label the registry cannot resolve, so a
metric with **no registry entry** looks fully badged. 8 such surfaced numbers found; ECGDex's ectopy chart card
badges `experimental` while its registry grades the metric `measured`.

> **Verifier correction — one exemplar must be dropped or the fix ships a fabricated citation.** "MOS
> (McGill Oximetry Score)" as a *published clinical score* is **refuted**; `experimental` is the honest tier
> for it. Fix the ECGDex alias and add the genuinely-missing entries; do **not** promote MOS.

### 6.6 The Integrator's code-gated fixture has no regen tool — `tools/regen-goldens.mjs:17`

`CLAUDE.md` §🔏 says the per-node regen tools are *"the ONLY sanctioned way to move an output byte"* and forbids
hand-editing an export. The `NODES` map covers all 8 nodes but not the Integrator — whose fragment carries a
code-gated fixture with a real `verifiedUnder` stamp and a live equiv leg. If a TCH-fusion change legitimately
moves that output, **there is no sanctioned way to re-record it.**

> **Verifier strengthening.** `provenance/Integrator.json`'s own note claims *"Fully regenerable: re-run …
> byte-identical to `_diag/tch-golden-gen.html`"* — **that file is not in the repo.**

---

## 7 · What NOT to chase — investigated and REFUTED

| claim | killed by |
|---|---|
| An O2Ring `.dat` with no stamped filename decodes into a time-only CSV that structurally cannot parse — the `dated` branch is dead | The 3-line repro reproduces, but **both interpretations are false**. Decoding the committed `.dat` under six filenames: `20260618214109.dat` → 31 691 rows dated 2026-06-18; `o2ring.dat` → 0 rows; `12345678901234.dat` → 31 691 rows dated **1238-10-17**. The branch is live, not dead. **Adjacent real defect found while refuting:** `_o2DateAnchorMs` **fabricates** a date from an out-of-range 14-digit filename instead of returning null — `20261332999999` (month 13, day 32) silently rolls to a night dated **2027-02-01**; `99999999999999` → **10007-06-07**. A direct Clock-Contract §2.7 violation, and the opposite of what was filed. **File the adjacent defect, not the claim.** |
| `apneaTyping.coverageAssumed` is a compile-time `false` that is never assigned — a fail-open flag that can never fire | The static half reproduces exactly (`grep -n "coverageAssumed\s*="` returns **nothing**), but the interpretation dies on three checks: the literal is the executing brief's own specification, not an orphan. **Adjacent, and it is not the one named:** the weak guard is `usable = typed >= 5` — a power floor on the typed *count*, blind to selection bias in *which* desats were typeable — largely defused because `untyped` is published alongside. |

Both cautions the charter asks for apply here: **refute the claim, not the concern** (both rows above conceal a
real adjacent defect), and **a refuted claim is not a cleared area**.

---

## 8 · Scope — what this audit did NOT cover

- **The browser lane, entirely.** No browser exists in this environment: `Dex-Test-Suite.html?full`
  render-coverage rigs never booted and `verify-provenance.html` was never opened in a browser
  (`window.__provenanceOK` unread — the Node sibling `verify-manifest.mjs` was used instead). **Every
  render-path finding here is reasoned from source, not from a painted DOM.** §5.1 in particular lives in the
  app layer.
- **No rendered DOM string was diffed across timezones.** The TZ sweeps cover `compute()`/export/fusion/
  filename layers; `*-render.js` was loaded but never driven, so a viewer-TZ-dependent *display* string would
  not have been caught.
- **Cross-night envelopes and the `*-cross.js` layer** — read, never numerically harnessed. Whether pooling
  across nights mixes units, and whether the crossnight `*_DEFS` projections carry units correctly, is unknown.
- **The Integrator's remaining machinery:** `integrator-tch.js` (three-cornered hat), `fuseHRVConsensus`,
  `fuseStagingConsensus`, `fuseHrvResource`, `fuseCvhrCorroboration`, and `_poissonSf`'s null models were
  **not attacked numerically**. `fusePeriodicBreathing`'s tier-weighted noisy-OR was looked at, not resolved.
  EventCoupling's `windowSweep`/`strata` blocks are computed by the primitive and **dropped** by
  `fuseApneaEvents` — noticed, unfiled.
- **DFA α1, SampEn, fragmentation, PRSA and CVHR were not differentially compared**, despite each having 2–3
  sibling implementations. The HRV dimension covered time-domain, geometric and spectral only.
- **PpgDex's full `compute()` on a real `_PPG.txt`** (optical detection → `consensusBeats` → `buildPPI` →
  `correctRR`) was never executed; only `timeDomain` was exercised.
- **ECGDex's µV assumption end-to-end** — `parseECGText` takes the last column and rounds into an Int16 with
  no reference to the `[uV]` header; a `[mV]` vendor file is untested.
- **`tools/release.mjs`'s pre-flight wall** (the refusal to cut a release on an UNVERIFIED corpus-backed
  fixture) was inspected, never executed.
- **A latent contract gap deliberately NOT filed** for want of an executed failure: nothing gates
  `record.inputs ≡ Object.keys(record.inputHashes)`.
- **`capture-host/`** — out of slice; see the sibling brief.

---

## 9 · Prioritized punch-list (correctness first)

| # | finding | why |
|---|---|---|
| 1 | **§3.1** desat pool double-counts a second oximeter | Moves the headline `confirmedApneaIndex` across the **mild→moderate** clinical boundary by adding a *device*. Worst surfaced number in the suite. |
| 2 | **§3.2** `apneaCoupling.real` has no significance test | A **54 % false-positive** verdict documented as "rigorous". Export-only today, which is the only reason it is not #1. |
| 3 | **§6.3** `parseDeviceHR` reads HRV-ms as bpm | 52 % of a surfaced validation card's values are the wrong physical quantity, on the **real** corpus. |
| 4 | **§4.2 + §4.1 + §4.3** MotionDex (one edit) | A breathing rate measured across a sensor-off gap, a sample rate 64 % low on a real file, and "Immobile time 20 %" on a 96 %-immobile night. |
| 5 | **§6.1** ECGDex abstention counted as agreement | Inflates a hero consensus % and crosses its own Strong/Moderate pill boundary. |
| 6 | **§3.4 + §3.5 + §3.3** Integrator fabricated redundancy + attribution | Three separate publications of agreement that was never measured. |
| 7 | **§5.1** PulseDex UI Total Power | A `validated`-badged number that contradicts the three numbers rendered beside it. |
| 8 | **§1.1 + §1.2** spine clock (one serialized re-bundle) | Both latent today, but the gate cost is the whole fleet — batch them, and **do not ship §1.2's proposed 1 s slack**. |
| 9 | **§1.4** Clock lint scans 70 of 124 shipped files | A gate that fails open by omission makes every "clean" line above it worth less. |
| 10 | **§6.2 + §3.6** duration keys + GlucoDex `timeseries` | One export-shape fix kills a false "no temporal overlap" **and** the ECG-only autonomic-glycemic number. |
| 11 | **§6.4** ingest routing (3), **§6.5** badge fallback, **§2.x** units, **§1.3**, **§5.2**, **§6.6** | Ordered as filed. §5.2 needs a **convention decision** before any code moves. |

**Gate cost summary.** `clock.js` (§1.1, §1.2) is the **shared spine** — all 8 apps re-bundle and all 8
provenance fragments re-stamp, serialized per `CLAUDE.md` §👥.3. `hrvdex-dsp.js` (§2.1) additionally drags
**Data Unifier + OverDex** (the orchestrator chokepoint). Every other DSP edit is single-app. **Every item
here moves `computeHash` as well as `manifestHash`** (all are inside the compute closure), so
`DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` re-verification is **owed before release** —
`tools/release.mjs` will refuse otherwise, and per `CLAUDE.md` §🔒 "export-inert" may **not** be asserted in
prose. No fixture *output* is expected to move on the latent findings; the equiv/GATE-C legs must be re-run to
prove it rather than claimed.

**Follow-up brief owed on execution:** `DEEP-AUDIT-III-FOLLOWUPS-YYYY-MM-DD-BRIEF.md`, pre-seeded with §8's
gaps — the browser lane, the Integrator's untouched TCH/noisy-OR/Poisson machinery, the DFA/SampEn/PRSA
differential, and the `_o2DateAnchorMs` fabricated-date defect surfaced by §7's first refutation.
