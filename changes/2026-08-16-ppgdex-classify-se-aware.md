---
bump: minor
type: fixed
brief: HOSTAXIS-STABILITY-FOLLOWUPS-2026-08-15-BRIEF.md
---

`ppgdex-dsp.js classifyAllan` was the third copy of the noise-type rule and the one the joint fix
(#1227) missed. It tested a strict `<` against a point estimate and rounded the slope into the record
it returned, so the digit that decided the answer was not in the output: -0.7501 classified as
white/flicker-phase and -0.7500 as white-frequency, both reporting slope -0.75, with `meaning`
flipping between "averages away" and "helps as √N" — the field the Integrator branches on. The ECGDex
marker pair sits exactly there (slope -0.7500, SE 0.0204, so the edge is inside the CI).

Now `classifyAllan(sl, se, nTau)`: an edge within 1.96·SE leaves `noise` null and names `candidates`
instead, `slopeSE`/`nTau` are published, and the slope is returned unrounded. `null` rather than a
string sentinel, because a truthy 'ambiguous' would pass the guard callers actually write and
reintroduce the bug inside its own fix. The new parameters are optional and last, so every
pre-existing caller keeps the pre-SE contract by construction.

It cannot delegate to `clock.js`: `PpgDex.html` inlines no `clock.js`, so `DexClock` is undefined in
that bundle. The duplication is structural, which is the argument for pinning the lanes' answers
rather than trusting the copies to stay equal. The known-answer group now checks all three against the
same pinned `allan.py` output — they agree on all 23 boundary rows.

Scope kept deliberately narrow. `channelStability` still consumes the scalar `allanSlope` and rounds
at its own call site; that output is in a committed fixture and this brief gives no reason to move it.
New data arrives via a new `allanSlopeFit` returning `{slope, se, nTau}`, never by changing an existing
return shape. The published `knownLimitation` string is corrected rather than deleted — removing a
field is a contract change for a string that only needed to stop lying.

Downstream: the Integrator's `readDetectorStability` guards on `isFinite(st.slope)`, not on `noise`,
so a refusal passes through unchanged.

Re-bundled (`manifestHash` 0a6b1833a7d9 → d0bd8cbe0add, 6 fixtures re-stamped) across all three
generated trees. No fixture carried `validation.stability` — verified by reading the bytes, not
asserted — and all 10 equiv groups stay green. `computeHash` moved regardless, so the corpus
re-verification §🔏 requires was run: green, with `PpgDex_2026-06-27_equiv` stamped
`verifiedUnder → 16583a17082c`.
