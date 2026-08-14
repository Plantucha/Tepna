---
bump: patch
type: changed
brief: HOSTAXIS-STABILITY-2026-08-13-BRIEF.md
---

`ppgdex-dsp.js` carried its own copy of the Allan core after the same code was promoted into `clock.js`
for `hostAxis`. The duplicate is removed and the node delegates by name — the pattern `parseTimestamp`
already uses. Net -59 lines.

It was never meant to survive: the promotion shipped with a parity assertion holding the two copies
byte-identical precisely because a duplicate awaiting divergence is what it was. `clock.js` is inlined
into every bundle, so the node was carrying a second implementation of code it already had.

⚠️ NOT A LIKE-FOR-LIKE SWAP, and that is the point. The spine's `classifyAllan(sl, se, nTau)` refuses to
NAME a noise type when a category boundary lies within 1.96 SE, returns `slope` UNROUNDED, and publishes
`slopeSE` and `candidates`. The local copy took `(sl)` alone and rounded to 2 dp — the exact defect this
node shipped a `knownLimitation` string about ("noise/meaning are unreliable when slope sits on a
category boundary"). So delegating RETIRES that string rather than restating it: the limitation is
fixed, not merely documented. `slopeSE` and `candidates` now ship on `validation.stability`, and `noise`
may be null — branch on `slope`, never on the label.

Real data unchanged where it should be: the three-channel hat still reports 6.11 / 6.90 / 6.43 ms at
slopes -1.01 / -1 / -1.01, identical to before. `stability.slope` is now unrounded (-1.0003624869 where
it read -1.00), which is the intended consequence of dropping `r2()` from the data.

THE PARITY ASSERTION IS REPLACED, NOT DELETED — and the replacement is the interesting part. Comparing
the OUTPUTS of two copies was the right check while two copies existed; comparing outputs of the SAME
function is vacuous. What still means something is IDENTITY: the node must expose the spine's function
object, so a reintroduced local implementation fails immediately rather than passing until it drifts.

⚠️ AND IT MUST NOT USE `T.eq`. The comparator serialises through JSON and a FUNCTION serialises to
`undefined`, so `T.eq(fnA, fnB)` compares undefined to undefined and passes for ANY two functions —
including a lookalike wrapper. Verified: wrapping the delegation in
`function (a, b) { return DexClock.allanFromPhase(a, b); }` left the `T.eq` form green and fails the
`===` form. Anyone asserting on functions in this suite needs `T.ok` with `===`.

`allanSlope` is deliberately not asserted — the node uses it internally and does not export it, and
widening the public surface for a test convenience would trade a real contract for a green check.

Export-inert: 195/195 equivalence assertions against the real corpus, no golden moves, all 11 bundles
clean.
