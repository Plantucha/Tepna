---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

CPAPDex `_leakCV` was pseudo-tested; its coefficient of variation and the `LEAK_CV_FLOOR = 2`
near-zero-mean guard are now gated by known answer. Writing that gate exposed a suite-wide hole:
`T.eq` compared `JSON.stringify(got) === JSON.stringify(want)`, and JSON maps NaN, +Infinity,
−Infinity and null all to `"null"` — so 275 `T.eq(x, null)` assertions passed for any of the four.
`T.eq` now tags non-finite numbers distinctly; measured, that reds ZERO of the suite's 7000+
assertions, so nothing was relying on the conflation.
