---
bump: patch
type: added
brief: QWEN-ENGINEERING-PROGRAM-2026-08-27-BRIEF.md
---

**The `qwen3.8:27b` DSP-adversary re-audition, banked: 6 confirmed of 29 triaged, and the lane is
retired.**

The lens was re-run under a newer model to test whether the first audition's failure was the model
or the lens. **227 functions, 309 findings, 20.7 % confirmed** — below the §2.5 band of 30 %. The
model was not the binding constraint.

All six are in `hrvdex-dsp.js`, all minor, and all the same shape: **a function that answers when it
should decline.** `fmtClock(NaN)` → `"NaN:NaN"` · `fmtDate(NaN)` → `"NaN-NaN-NaN"` · `_persistNote`
rendering *"capped to the most recent undefined of undefined"* · `computeCAMQ` returning a neutral
**50** when no parasympathetic indicator exists · `hrvEventsFromRows` badging a `1e-300` RMSSD as
`evidence:"measured"` at `conf 0.9` · `_rowFromSeed` coercing `{tMs:"123"}` into a numeric epoch at
the storage boundary.

**Every one is execution-backed rather than resting on the model's prose or the coordinator's.** Each
was re-run against the real module and the ledger note records the actual input and output. That is
what caught the two corrections below, neither of which a read-through would have found.

**A coordinator verdict that execution REVERSED, recorded rather than dropped.** `persistHRVRows` was
judged TRUE; it is rejected here. The halving loop is `while (kept.length > 1)` with
`Math.max(1, …)`, so `kept` cannot empty; under real quota pressure it returns `{failed:true}` — the
exact refusal the claim says is missing — and the no-rows branch's `{ok:true}` follows a
`removeItem` that verifiably happens. **The discriminator that was skipped is whether the empty
end-state is the CORRECT one**: an honest no-op is indistinguishable from a fabrication until you
ask that. This is the *inverse* of the house's examined-nothing class — a correct report over-flagged
as a fabricated one — and it moved the headline **24.1 % → 20.7 %**, leaving the band decision **more**
robust rather than less.

⚠️ **The first attempt to verify it was itself vacuous and would have filed a false confirm.**
`compute({rows})` silently failed to populate `allRows`, so the quota case fell through the *no-rows*
branch and returned `{ok:true}` — visually identical to the claim reproducing. The tell was two cases
exercising *different* paths returning *identical* results. **Identical output from paths that should
differ is the signal to trust.**

🔴 **And a real limitation of the metric, surfaced by using it.** `findings-ledger.mjs` computes
precision per **lens**, so a re-auditioned lens blends two model generations into one ratio: the
`dsp-adversary` key currently reads 6/38 = 0.16 across 3.8 *and* its predecessor, while the 3.8
population alone is 6 confirmed · 2 rejected · **300 untriaged**. A band decision taken on the blended
figure measures the wrong thing. **Precision should key on `(lens, model)`** — every record already
carries the `model` stamp, so only the aggregation is missing. Flagged, not fixed: it is a change to
the tool, not to this review.

Also closes `allanFromPhase([0,1,2,3,4,5], 1) → []` as **the guard working, not an edge defect**:
six phase points give four overlapping terms at the shortest τ, tripping `cnt < 8`. Measured
threshold is **10** phase points, and it cannot arise in the shipped path because both callers gate
on `ALLAN_MIN_PAIRS = 64` first. Recorded so nobody re-derives it.
