---
bump: minor
type: fixed
brief: none
---

MotionDex refuses `immobileFrac` across a clock seam, and the `beatConfidence` mirror claim is now
both true and gated.

Completes the fleet sweep Kestrel assigned for the refuse-vs-annotate ruling (`CLAUDE.md` §∅, owner
2026-09-17 — verified on `main` at §∅ before citing, not on the PR).

## MotionDex — the refusal half only

`immobileFrac` is a **duration over the axis**: epochs are assigned by
`Math.floor(relSecOf(...) / epoch)`, a **time-derived** index. A device-clock seam is re-anchored
upstream, which makes the axis continuous again and therefore makes the discontinuity *invisible* —
samples either side land in adjacent epochs as though no time passed. The fraction over that stretch
is not an observation anyone made.

It now returns `null` with `immobileFracReason: 'clock-seam'` — the spelling PpgDex established
(#2600), verbatim, never a second spelling of one fact.

**Scoped deliberately.** `movementIndex` is a *magnitude*, not a span, and still publishes. And the
**coverage half is untouched**: tri-state `moving`, uncovered epochs outside the denominator, already
exactly what §∅ mandates — conforming it would have been a change with no defect behind it.

7 assertions, both directions, positive control first: a seamless recording publishes
`immobileFrac = 0.75` and carries no reason key. Verified discriminating — removing the guard reds
exactly the two seam assertions (`got 0.75 · want null`) and leaves the control and scoping green.

## The mirror claim — false as written, and unguarded

`ppgdex-dsp.js:2121` said *"Byte-for-byte MIRROR of ECGDSP.beatConfidence"*. Two defects:

1. **False where a reader can check it.** Raw bodies are 2708 vs 3122 chars — the *comments* differ.
   It is true only comment-stripped (2135 each), which the comment never said.
2. **Nothing checked it.** All 16 `beatConfidence` references are behavioural; none asserts source
   text. A future body edit would diverge the copies silently, invisibly, *because* everyone believes
   the comment.

Both fixed: the wording now states the transformation under which it holds, and a `beatConfidence
mirror` gate compares the two bodies comment-stripped. Verified discriminating — one added line to
either copy reds it.

⚠️ **The gate carries its own anti-misreading, because #1232 is the hazard here.** That PR was closed
after a byte-parity assertion was read as proof one copy was surplus; deleting it sent the PpgDex
render rig 1458 ms → 16945 ms. So the assertion message says, inline: nodes never import each other
(`ARCHITECTURE-PRINCIPLES` §2), the duplication is deliberate, **this is not evidence of redundancy,
and deleting either copy is the #1232 failure**. It also records that the two are correctly divergent
in their *guards* — identical bodies, different callers.

This gate was **earned by measurement**: before today nobody had checked the bodies were identical,
which is why #2600 gated the constants and explicitly not the bodies.
