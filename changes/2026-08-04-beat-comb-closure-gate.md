---
bump: minor
type: added
nodes: []
brief: CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md
---

Gates `beat-comb-analysis.mjs`'s drift figures on a three-source closure, the tool named by
CROSS-DEVICE-DRIFT-AND-CLOSURE section 5. The four-state verdict already existed in
`tools/drift-report.js` and `trio-batch` routed its clock lines through it, but beat-comb derives
drift from per-block lag by Theil-Sen rather than `fitClockDrift`, so no closure could reach it: it
printed a bare ppm column spanning -133 to +185 ppm against a crystal error of about 20, which is the
guardrail that brief wrote against.

Adds `DriftReport.closeTriple(legs)` -- directed `{a,b,ppm}` legs, checking d(A,B)+d(B,C)+d(C,A)=0 over
legs the caller fitted, which is what makes the check free: each pair is fitted independently, so the
identity is a constraint the fit never used. beat-comb's three pairs are the three edges of one triangle,
so a night's rows are now buffered, closed, then printed -- printing first and closing afterwards is the
ordering bug drift-report.js was extracted to fix.

The first honest run reports 0 closed, 0 inconsistent, 25 unclosed of 25 nights. The cause is an absent
check rather than a failing one: no night carries a PpgDexFinger export, so two of three pairs produce
no rows, silently, because a pair with no data has no lines. The tool now names the silent pairs.

Gated by a new `drift-report · closure-identity` group, 14 assertions in both lanes, verified RED by
value against two mutants: a constant tolerance kills four assertions, and letting an absent leg default
to zero produces the fabricated pass it exists to forbid. The tolerance is mirrored from
`fitClockClosure` because one file is bundled and the other is not, so the gate reads the rule out of
both sources as text.
