<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — §4 was EXECUTED 2026-08-17 and its defect fixed (dc2ac7d3: the clock guard's only caller passed three arguments; `PATGate.verdict(ov, cp, sc, ax)` now takes four, `_tchHat` guards `timingSource === 'none'`, drawn-axis assertions at `tests/dex-tests.js:9080-9095`), and §1's constant is settled (`O2PPG_FS_DEFAULT = 125.000`, df89b48e, pinned by `test_o2ring_frame_lock.py`). What keeps it open is §2's own instruction: **measure §3's impact before building it — replay a night with marker-aware gridding, diff the HRV outputs, and if nothing moves close Phase 4 as unnecessary.** That replay has never been run (no marker-aware-gridding artifact anywhere); the 8.0 ms p-p sawtooth was measured against PAT beat-to-beat scatter, a different question. So Phase 4 is neither built nor honestly closable yet. **Owner:** Heron · **Next step:** the replay + HRV diff — a desk measurement, and a NULL result closes Phase 4) · **Created:** 2026-08-06

# Phase 4 review — its premise moved, and a bigger timeline defect sits next to it

Written on starting `DEVICE-RATE-TRUTH-2026-08-05` §6.5 (Phase 4: strip markers to a beat-event column,
`O2PPG_FS_DEFAULT → 125.000`, `ppgdex-dsp.js` 156 semantics, regenerate fixtures, re-bundle, GATE A/B).
**The work was not started.** Three things came up that change what it should be, and one of them is a
live defect in a different module.

## 1 · `O2PPG_FS_DEFAULT` is a starting guess, not the timebase — the grid already self-corrects

Phase 4 reads as though the constant *is* the sample clock. It has not been since
`CAPTURE-HOST-DEEP-AUDIT §A3`: `O2PpgGrid._re_estimate` **slews `step_s` toward the rate the ring is
actually running at** (`capture.py:638`), and `capture.py:349` says so — *"The configured rate is a
STARTING GUESS, not the sample clock."*

Confirmed on the corpus: the per-night written row rate is **not** pinned at 125.738 but converges
per night, tracking heart rate (125.748 Hz at 46.5 bpm → 126.108 Hz at 70.6 bpm across 17 nights).
A grid stuck at the constant could not do that.

**So `125.738 → 125.000` changes only the pre-convergence guess.** That is a real if modest improvement
— it starts nearer the truth and converges sooner — but it is *not* the structural fix Phase 4 describes,
and on its own it moves no timestamp that the slew would not have reached anyway.

## 2 · "Strip markers" would destroy information, and get ~7 % of it wrong

`ppgdex-dsp.js:239` does **not** reject every `156`. It applies an isolation test
(`O2_SENTINEL_ISOLATION = 25` LSB from the local trend) because a genuine signal value of 156 is
indistinguishable from a marker by value alone — measured ~93 % isolated / ~7 % trend-consistent, with
the comment: *"Rejecting every 156 would punch ~7 % of holes into VALID signal."*

Stripping markers at **capture** time makes that judgement once, irreversibly, at the point where the
least context is available. Today's format is lossless: markers stay inline and every consumer applies
its own test. **Do not move a lossy decision upstream** — if the isolation rule is ever improved, an
archive of stripped files cannot benefit from it.

## 3 · What the residual defect actually is, measured

Markers are inserted rows (proven across 17 nights — `DEVICE-RATE-TRUTH` §6.4a), and the grid writes
**uniformly spaced** timestamps. Measured on the 2026-08-04 night (3 672 646 rows):

| | |
|---|---|
| isolated `156` markers | **23 796** |
| marker-to-marker row spacing | **144 rows** → 52.4 bpm, matching the night |
| written grid step | **8.000 ms**, uniform |

So **each marker consumes an 8.00 ms slot of real time it never took.** Because the slew matches the
grid to the *average* row rate, this does not accumulate — it is a **sawtooth locked to the heart rate**:
real samples drift ahead by one step across a beat, and the marker absorbs it. Total span stays correct.

That is the honest statement of the defect, and it is much smaller than "the constant is wrong". The
right fix is to **advance the grid only on real samples, at 125.000, and give a marker the timestamp of
its insertion point without consuming a slot** — which keeps the file lossless (§2), keeps the header
byte-identical (`oxydex-dsp.parseCSV` byte-identity is gate-asserted), and removes the sawtooth.

**Whether that sawtooth matters is unmeasured**, and that is the gap: it is locked to the beat, so it
largely cancels in RR intervals. Nobody has shown it moves an HRV number. §4 is worth more.

## 4 · THE LIVE DEFECT: the three-cornered hat accepts a drawn axis; closure no longer does

`ppgdex-dsp.js:442` warns, in the code:

> *"DRAWN + no anchors ⇒ `'none'`: the recording carries no timing information whatsoever and must never
> be spent as a clock leg — **closure, three-cornered hat and PAT all silently accept such a leg today
> and measure a constant**."*

That comment is now **half stale and half still true**, and the still-true half ships:

| consumer | guards on `timingSource`? |
|---|---|
| `integrator-dsp.js` closure | ✅ — `WEARABLE-HOST-AXIS-FOLLOWUPS §F3` excludes `'none'` (line ~5055) |
| `tools/tch-multinight.mjs`, `tools/tch-corpus.js` | ✅ |
| **`integrator-dsp.js` `_tchHat`** | ❌ — filters only on `ptsFn(s).length >= 12` (line 2550) |
| **`pat-gate.js`** | ❌ zero mentions |
| **`pat-feasibility-worker.js`** | ❌ zero mentions |

> **VERIFIED AND CORRECTED 2026-08-17 — three of those five rows had gone stale, and the diagnosis of a
> fourth was wrong in a way that mattered.** The table above is left as written; it is the premise this
> review was deferred on. Read it with this note.
>
> | consumer | state on 2026-08-17 |
> |---|---|
> | `integrator-dsp.js` closure | ✅ still guarded (line ~5460) |
> | `tools/tch-multinight.mjs`, `tools/tch-corpus.js` | ✅ still guarded |
> | `integrator-dsp.js` `_tchHat` | ✅ **now guarded** — `if (s.timingSource === 'none')` at line 2573, landed since this brief. The TCH lane's work, not this one's. |
> | `pat-gate.js` | ⚠️ **premise right, reason wrong** — see below |
> | `pat-feasibility-worker.js` | ❌ confirmed, **fixed 2026-08-17** |
>
> **"Zero mentions" was true of `pat-gate.js` and was not the defect.** The gate had acquired a correct
> clock refusal in the meantime — `NO SHARED CLOCK` on `ax.independent === false`, six assertions behind
> it. What shipped broken is that its only runtime caller, `pat-feasibility-worker.js:423`, invoked it as
> `PATGate.verdict(ov, cp, sc)` — **three arguments**. Nothing could reach the fourth, so the guard had
> never once fired. Both parsers already held `rec.hostAxis` and dropped it in their reshape — the lesson
> `ppgdex-dsp.js` states three lines above `timingSource`'s own definition, re-applied one layer down.
>
> That distinction is the transferable part. A grep for `timingSource` reports an absent guard; a grep
> for `PATGate.verdict` reports a healthy, heavily-exercised one. **Neither can see an argument that is
> never passed.** The check has to be *who calls it, with what arguments* — not *does the name appear*.
> `integrator-dsp.js:694` records the identical failure one lane over ("WITHOUT IT THIS GUARD WAS
> INERT"), so this is two independent instances of one shape inside the same subsystem.
>
> **The severity was also inverted from what this section assumed.** `timingSource:'none'` is a
> `hostAxis` *refusal*, so it carries no `independent` member at all — `undefined`, not `false`. The leg
> with **no clock** therefore walked straight through the guard that catches the leg with an **unshared**
> clock: the more degenerate input passed. It is now a separate `DRAWN AXIS` refusal rather than a
> widening of the old one, because it is a different claim — not "these two clocks are not shared" but
> "this recording carries no timing at all".
>
> **Impact, measured rather than asserted — and it cut the claim down.** Across the corpus's 89 PpgDex
> exports: **0** `'none'`, 27 `'device'`, 31 `'host'`, 31 `'device+host'`. The drawn-axis refusal is
> therefore **prophylactic today**, and §4's "the estimator returns a confident number about nothing" is
> a statement about the 27 `'device'` nights, not the drawn ones. `'host'` — drawn, but real host
> anchors then placed it on host time — is deliberately **not** refused: those 31 nights genuinely do
> sit on one timebase, and refusing them would discard the largest single class, including the box
> nights that are the only ones with a second clock at all.
>
> **Cost was over-estimated.** §4 closes by pricing this as a shipped-bundle change carrying re-bundle
> and GATE A/B. That was true of its `_tchHat` half, which has since landed. `pat-gate.js` and
> `pat-feasibility-worker.js` are named in prose by `Integrator.html`, `PAT Feasibility.html` and two
> analysis tools but **inlined by none of them**, so this half was source-only: no bundle, no fixture,
> no GATE A/B.
>
> Anti-inertness is pinned by a **source scan** in `pat-align · regression` — every
> `PATGate.verdict(...)` in the worker must carry ≥4 arguments — because the caller is a Web Worker that
> no behavioural test can drive. That unavailability is precisely why the defect survived. Reverting the
> call to three arguments fails the assertion.

The **offline tools were taught the rule and the shipped runtime was not.** This is the same failure
`CLOCK-CLOSURE-THREE-SOURCE` hit — *"six nights failed with all legs confident"* — and the same one
`O2RING-SYNTHESISED-AXIS` retracted two of three pairs over. A drawn leg contributes a constant, both of
its pairs faithfully measure a fiction, and the estimator returns a confident number about nothing.

**Fix:** apply §F3's filter in `_tchHat` and in the PAT path, reporting exclusions the way closure does
rather than silently dropping. Note `_tchHat` operates on a per-epoch *metric* series rather than clock
offsets, so the severity needs stating rather than assuming — but a drawn axis biases the RR/HRV values
that feed it, so "it is only a metric" is not a defence, and the code comment already treats it as scope.

This is a shipped-bundle change (`integrator-dsp.js` → `Integrator.html`), so it carries the re-bundle,
GATE A/B and `npm run check` cost. It is worth that cost; §3 is not yet shown to be.

## 5 · Recommended order

1. **§4 first** — a confident wrong number from a drawn leg is worse than an 8 ms sawtooth.
2. **Measure §3's impact** before building it: replay a night with marker-aware gridding and diff the
   HRV outputs. If nothing moves, say so and close Phase 4 as unnecessary rather than shipping it.
3. **`O2PPG_FS_DEFAULT → 125.000`** is safe and cheap on its own (§1), but it must not be sold as the
   structural fix, and `test_o2ring_frame_lock.py:83` pins it deliberately — that guard forbids
   *re-calibrating to reconcile two constants*, which this is not. Change the guard's reasoning in the
   same commit or the next reader cannot tell the difference.
