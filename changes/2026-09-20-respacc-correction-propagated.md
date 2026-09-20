---
bump: patch
type: fixed
brief: none
---

**A shipped bundle published retracted validation figures for thirteen days.**
`papers/acc-respiratory-rate.html` retracted and restated its headline on 2026-09-07 — MAE
1.01 → 1.10, within-2-brpm 91.7% → 90.8%, epoch count 18,856 → 8,057 over 49 ACC/CPAP-paired
nights — because the prior numbers predate the cross-device alignment fix of #1042 and were never
reproducible from committed code. Only the paper was corrected.

`motiondex-registry.js` went on justifying the `respRate` metric's `emerging` tier with the
retracted MAE, and `MotionDex.html`, `resp-acc-analysis.html`, `DOCS-INDEX.md`, `papers.html` and
both copies of `PAPERS-AUDIT.md` went on publishing them. A tier resting on a number its own
paper has withdrawn is the fabricated authority the evidence ladder exists to prevent.

Every surface now carries the reproduced figures. What the correction did NOT restate is marked
withdrawn rather than updated — the event-free-epoch row and the shipped-predecessor comparison
(zero-crossing, MAE 3.59), both because the analysis tool no longer emits those configurations.
Carrying a number forward under corrected figures is the precise thing the correction refuses to
do, so nothing here invents a replacement for either.

⚠️ `docs/papers/PAPERS-AUDIT.md` had to be synced BY HAND: `build-docs.mjs` filters `.md` out of
its asset list, so `docs/papers/*.md` is authored and owned by no builder, and `verify:docs`
reported "docs/ current" with the stale twin in place.

MotionDex re-bundled (`manifestHash` 48869d75e29e → 086a8d08438c); analysis tools and docs rebuilt.

Fleet-Session: Magpie
