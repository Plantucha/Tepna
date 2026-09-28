---
bump: patch
type: fixed
brief: none
---

**Both hat rows on `PAT Classic vs Fused.html` have rendered `REFUSED` on every night since the page
shipped (#3128), and the refusal asserted a physical cause for a field-name mismatch.**

`hatRow` read `h.h10` / `h.verity` / `h.o2`. `threeHat` (`pat-feasibility-worker.js:549`) keys its `sigma`
and `variance` by **site** — `{chest, finger, ankle}` — and has never written a device key. So all three
reads were `undefined`, `undefined >= 0` is false, and the negative-variance guard evaluated TRUE for every
possible input, including a perfect three-corner solve. The row then printed *"a negative solved variance —
the hat's independence assumption failed"*: a claim about the physics, for a typo, with a real solve one
field away. A fabricated explanation is worse than a missing number.

**Why it shipped:** nothing executed the function. Zero tests named `hatRow` or either row label, and the
page's own export comment claimed it was "exposed for the suite's source/behaviour checks" while neither
lane bound `PatCvf` at all. The code also *reads* correct — the old caption listed "chest / ankle / finger"
in exactly the order the three device keys were printed, so the site mapping was self-consistent and only
wrong.

The site list now comes from the object the worker actually sent (`Object.keys(h.sigma)`), which also makes
the caption and the values incapable of disagreeing, and the suite pins the consumer's key set against the
producer's own `v2` literal so a rename reds instead of silently blanking a row.

⚠️ **A second defect found in this change's own first draft, before it shipped:** `null >= 0` is **true** in
JavaScript, and `threeHat` writes exactly `null` for a corner whose solved variance went negative
(`sigma[k] = v2[k] >= 0 ? sqrt(v2[k]) : null`). So the obvious `!(sg[k] >= 0)` **admits the very case the
refusal exists for** — the measured 2026-09-26 night (chest variance −32.0 ms² classic, −27.6 ms² fused)
rendered blue with a `null` in it. The guard is on the value TYPE. The old code was right by accident, for
the wrong reason, on every night.

**Scope, stated so the PR does not over-claim:** this makes the page's `REFUSED` track the worker's actual
sign. On 2026-09-26 the chest corner really is negative, so that night still reads `REFUSED` under today's
wording — correctly now rather than unconditionally. Distinguishing *underpowered* (σ < 14.4 ms, CI spanning
0) from a true independence failure is the per-corner status work in the PAT-hat brief, not this fix, and
Wren's worker-side measurement stands on its own.

Plants: 13 assertions executing the shipped function text over a clean solve · a null corner · an explicit
negative · a NaN corner · a missing `sigma` object, plus the producer/consumer key-set equality and an
anti-vacuity leg that the legs are distinguishable. On `origin/main` the clean-solve leg reports
`got "REFUSED" · want "9.1 / 12.2 / 25.5"`.
