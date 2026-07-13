<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — the primitive's contract + failure modes; last-verified 2026-07-13) · **Created:** 2026-07-13 · **Module:** `event-coupling.js` · **Origin:** `CPAP-REAL-CORPUS-2026-07-11-BRIEF.md` §P5/§M1 · **Corrections:** `CPAP-REAL-CORPUS-FOLLOWUPS-2026-07-12-BRIEF.md` §2

# `event-coupling.js` — the "is it real or coincidence?" primitive, and the four ways its null model lied

> **Why this brief exists.** The primitive was proposed inside a **CPAP** brief (§P5), built there, and
> then corrected twice more in a CPAP *follow-up*. Its contract and its hard-won guards therefore lived
> scattered across two documents about a subject it has nothing to do with — while the module itself has
> **no consumer in any node yet**. The next person to wire it into the Integrator will not go reading a
> CPAP corpus brief to discover that a lift of ×0.0 can mean "we weren't looking". This is its home.
>
> **Read this before using `coupling()`. Every guard below exists because it was learned the hard way,
> on real data, after the module had already shipped and its numbers had already been written up as
> findings.**

---

## 1 · What it is for

Two frequent event streams **co-occur by construction**. If node A fires 700 times a night and node B
fires 60 times, some of A's events will land near some of B's *no matter what*. A raw co-occurrence rate
is therefore **not evidence of anything**.

`coupling(eventsA, eventsB, opts)` measures the observed co-occurrence against a **chance baseline**:
circular time-shift surrogates that displace every A-event by ±5–15 min. That preserves both streams'
marginal rates and their internal structure, and destroys **only the alignment** — so the observed-to-
chance ratio (`lift`) isolates genuine temporal coupling from two signals that are merely both busy.

It generalizes to any (node A event, node B event) pair: CPAP apnea × desat, ECG arrhythmia × desat,
GlucoDex excursion × anything. **It is the missing test the Integrator needs before it can claim any
cross-node coupling.**

## 2 · THE RULE

> **Read `lift` only when `underpowered` and `saturated` are BOTH false — and only when `coverageAssumed`
> is false or you genuinely know B was observing the whole time.**

A `lift` on its own is not a result. Three of the four failure modes below produce a *confident, wrong
number* rather than an error, and each one of them fooled the author in a different direction.

## 3 · The four ways the null lied — with the real numbers

| # | defect | which way it lied | the real damage |
|---|---|---|---|
| 1 | **Non-wrapping shift** | **INFLATED** lift | invented a coupling of **×3.3–10** |
| 2 | **No coverage model** | **DEFLATED** lift | invented **anti**-coupling (×0.72) |
| 3 | **No power floor** | made a tiny bucket look **decisive** | a ×0.0 on 16 events published as *"provably no signal"* |
| 4 | **Resonant shifts** | **collapsed** a real coupling to ~1 | a planted, *perfect* coupling scored **×1.006** |

### 3.1 · The shift must WRAP  *(fixed at birth — PR #52)*
A plain additive shift lets surrogates fall off the end of the recording, where **no B can ever match
them**. That deflates `chance`, which **inflates `lift`** — it manufactures couplings, in exactly the
direction a hopeful reader wants. Every magnitude the original prototype produced came from this.

### 3.2 · An absent reading is NOT a miss — `coverage`  *(PR #62; the one that actually bit)*
An event stream has an **observation window**. B's device was on for *part* of the night. If an A-event
happens while B is **not recording**, "no B nearby" says nothing about coupling — **it says B was
switched off.**

It does not merely add noise, it **biases**: an unobserved A-event is a forced miss at shift 0, yet the
circular shuffle can carry it **back into** the recorded span where it *can* hit. So `chance` rises above
`observed` and lift lands **below 1** — manufactured *anti*-coupling.

On the real corpus **30% of apneas happened while the oximeter was not recording**, and the primitive
duly reported ×0.72 with a "striking" ×0.0 bucket. It was an artifact. Supplying `coverage` moved the
same data to **×1.04 — exactly chance**.

> This is the suite's own DEEP-AUDIT §17–21 principle (*an absent reading is not a score of zero*), one
> level up. **Pass `coverage` whenever you know it.** Omit it and you get `coverageAssumed: true` — the
> old behaviour, but never silently.

### 3.3 · A ×0.0 is usually just SMALL — `expectedHits` / `underpowered`  *(PR #62)*
A lift of ×0.0 sounds decisive. Usually it just means the bucket was tiny. With **n=16** and a ~5.6%
chance rate you expect **0.9 hits**, so observing zero has probability ≈ **41%**. A coin toss was written
up as proof. `underpowered` (expectedHits < 3) marks a result whose low lift carries **no information**.

### 3.4 · Circular surrogates RESONATE with periodic streams — `nullShifts`  *(PR #52)*
Whole-minute shifts are all multiples of 60 s, so against a stream with round periodicity every surrogate
re-lands on the **same phase**: the null reproduces the observed rate and a real coupling reads as ~1.0 —
a false negative. Defaults are second-level (317/461/663/809/887 s) and share no factor with 30/60/120 s.

### 3.5 · Also: SATURATION — `maxLift` / `saturated`
If the window is wider than B's mean inter-event interval, **every** A finds a B by chance, and lift is
crushed toward 1.0 **by arithmetic** even when the coupling is perfect. So `lift ≈ 1.0` is ambiguous: it
means *either* "no coupling" *or* "this window cannot resolve one". `maxLift = 100/chancePct` is the exact
ceiling; `saturated` (maxLift < 1.5) marks a window that is **uninformative, not negative**.

## 4 · Contract

```js
coupling(eventsA, eventsB, {
  window,          // [loMs, hiMs] — a "hit" = some B in [tA+lo, tA+hi]
  coverage,        // [[t0,t1], …] ⚠️ the spans in which B WAS OBSERVING. Pass it.
  nullShifts,      // surrogate displacements (default: non-round, ±5–15 min)
  windowSweep,     // extra windows (default 0–30 / 0–60 / 0–120 s)
  stratifyBy       // e.g. 'durSec' — bucket A and re-measure per bucket
}) → {
  n, hits, expectedHits, underpowered,   // ← power
  excluded, coverageMs, coverageAssumed, // ← coverage
  observedPct, chancePct, lift,
  maxLift, saturated,                    // ← saturation
  nullPcts, spanMs, window,
  windowSweep[], strata[]
}
```

Pure: no clock reads, no RNG, no I/O. Deterministic for identical inputs.

## 5 · Status of the module

- **Shipped, gated, dormant.** 35 self-test + 26 contract assertions, both runners. Each of the four
  defects above is pinned by a regression assertion, so none can return quietly.
- **NOT co-loaded into any bundle.** No app consumes it, so wiring it into `dex-coload.js` would
  re-bundle all 8 apps to carry inert code (the `BADGE_CSS` economics). **It rides the first node that
  actually uses it.**
- **Its only consumer today is a tool** — `tools/cpap-oxy-couple.mjs` (which was its prototype, and whose
  local copy is deleted so it cannot drift from the gated module).

## 6 · What it still owes

- [ ] **A NODE consumer.** `CPAP-REAL-CORPUS` **§P7** is the natural first: apnea → HR (CVHR) and
      apnea → motion-arousal coupling on the 17 quad-modal nights. That is also what settles which
      bundle it rides into, and it independently tests §M3's re-labelling alternative.
- [ ] **A `coverage` source per node.** The primitive can only be correct if callers can *say* when their
      device was recording. Today that means reaching into `recording.startEpochMs` + `durationMin` by
      hand (as `cpap-oxy-couple` does). A `ganglior.node-export` convention for the observation window
      would make the coverage guard usable by construction rather than by discipline.
- [ ] **Re-derive anything ever quoted from the prototype.** §M1's magnitudes were wrong twice; its
      *conclusions* survive. Nothing else should be cited from the pre-correction runs.

## 7 · The lesson, stated once

Every defect above produced a **confident, plausible, wrong number** — and the synthetic self-tests were
**green throughout**. All four were found only by pushing real data through and asking why a figure looked
odd. A green suite proves an estimator is *self-consistent*, not that it is *correct*.

> **A chance baseline only protects you if the baseline is right.**
