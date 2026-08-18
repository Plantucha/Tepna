---
bump: patch
type: fixed
brief: O2RING-PHASE4-PREMISE-REVIEW-2026-08-06-BRIEF.md
---

**pat-gate: the clock refusals had a caller that never passed a clock — and the worst axis slipped
through the guard built for the second-worst.**

`PATGate.verdict(ov, cp, sc, ax)` refuses a pair whose two devices are not on one timebase
(`NO SHARED CLOCK`, `ax.independent === false`). It was correct, commented and gated by six
assertions. Its only shipped caller, `pat-feasibility-worker.js`, invoked it as
`PATGate.verdict(ov, cp, sc)` — **three arguments** — so no input could reach the guard, and it had
never fired in the runtime. Both parsers already held `rec.hostAxis` and dropped it in their reshape,
which is the lesson `ppgdex-dsp.js` states three lines above `timingSource`'s own definition, applied
one layer down.

Fixing only that would still have missed the more degenerate case. `timingSource:'none'` — a DRAWN
axis (`sample_index × an assumed rate`) with no usable host anchors — is a `hostAxis` *refusal*, so it
carries no `independent` member at all: `undefined`, not `false`. **The leg with no clock walked
through the guard that catches the leg with an unshared clock.** It is now a separate `DRAWN AXIS`
refusal rather than a widening of the old one, because it is a different claim: not "these two clocks
are not shared" but "this recording carries no timing at all", so a beat-lag is a rate-error
difference wearing the shape of a PTT.

- `pat-gate.js` — new `DRAWN AXIS` refusal on `timingSource === 'none'`; new `worstAxis(a, b)`,
  which picks the leg that decides (drawn > non-independent > either). A PAT number is a comparison
  BETWEEN two recordings, so it is only as good as the worse of their two clocks and an honest H10
  axis must not redeem a drawn ring one. That choice is gate policy, so it lives here rather than in
  the worker — the reason `verdict` and `sharedClock` moved here (ENGINE-VERIFICATION-FINDINGS §1.5).
- `pat-feasibility-worker.js` — both parsers forward `rec.hostAxis`; both `verdict` call sites
  (primary and the ACC-corrected `vdCorr`) pass `PATGate.worstAxis(ecg.hostAxis, ppg.hostAxis)`. An
  ACC offset correction re-aligns two trains, it does not conjure a clock.

**`'host'` is deliberately NOT refused.** A drawn axis that real host anchors then placed on host time
does put both devices on one timebase — the condition the gate exists to require, however the axis got
there.

**Measured before claiming.** Across the corpus's 89 PpgDex exports: **0** `'none'`, 27 `'device'`,
31 `'host'`, 31 `'device+host'`. So the drawn-axis refusal is **prophylactic — it has no live target
today**, and this changeset does not claim it corrected a published number. What is live is the 27
`'device'` nights, the case the gate could always have refused and never once saw. Refusing `'host'`
would have discarded the largest single class, including the box nights that are the only ones with a
second clock at all.

Gated by `pat-align · regression` (+20 assertions): both refusals fire and name themselves, `'host'`
and `'device+host'` still reach `go`, `worstAxis` severity holds in both argument orders, a null leg
does not vote, and — the leg without which the rest is decoration — a **source scan** asserting every
`PATGate.verdict(...)` in the worker carries ≥4 arguments, since a Web Worker is not drivable from a
behavioural test. Mutation-verified: removing the drawn guard fails 3, flattening `worstAxis` fails 2,
reverting the call to 3 args fails 1, un-forwarding a parser's axis fails 1.

Source-only — `pat-gate.js` and `pat-feasibility-worker.js` are referenced in prose but inlined by no
bundle, so there is no GATE A/B or fixture cost. The brief predicted a shipped-bundle change; that was
its `_tchHat` half, which had already landed.
