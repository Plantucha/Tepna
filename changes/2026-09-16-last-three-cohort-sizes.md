---
bump: patch
type: fixed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

All six analysis tools now carry their paper's cohort size — and one paper's stated size does not
reproduce its own counts.

Three tools were refused by `--paper-scale` because their paper cohort size was "not established".
It was established all along; my greps looked for *"N subjects"* and *"N patients"* while the papers
phrase it *"This run used 240"*. A failed grep is not a negative — the same error this brief was
already corrected for in #2543, committed a second time against the same document.

| paper | stated | driven at | reproduces? |
|---|---|---|---|
| `rmssd-equivalence` | 240 → "220 valid windows" | `nSubj: 240` | ✅ **nWindows = 220** |
| `qrs-yield` | 400 → "≈363 windows/arm, ≈188,000 beats" | `nSubj: 400` | ✅ **362 windows, 187,740 beats, 24,184 in apnea** |
| `treatment-response` | ~900 → "912 tx + 918 flat" | `nSubj: 900` | ❌ **269 tx, 317 flat** |

The inventory assertion is inverted from *"three tools carry a paper cohort size, three are refused"*
to **"all six carry one — none is refused"**.

## The one that doesn't reproduce is filed, not tuned

`treatment-response.html` Table 2 records its run as ~900/arm producing 912 + 918. Driving it at 900
yields 269 + 317 — a 3.4× gap. The stated figure is odd before any run, too: 912 per-arm survivors
cannot come from ~900 per arm once the ≥10-night filter attrits, and the same table says that cohort
*"attrits heavily on per-night coverage"*.

**I did not tune `nSubj` until the counts matched.** That would reverse-engineer a configuration from
a desired output: the numbers would agree and nothing would have been established. The paper's own
table names ~3,000/arm as *Recommended*, roughly the 3.4× the gap implies — recorded as a
**hypothesis**, not asserted.

What makes this attributable to the paper rather than to the driver is that **its two siblings in the
same batch reproduce exactly**. A broken driver would miss all three.

A second, smaller mismatch is recorded with it: the tool defaults to `minNights: 6` while the paper
reports ≥10, so the published run changed a control its configuration line never lists. Any re-cut of
that paper must establish both values first.

Filed as `2026-09-16-treatment-response-config-unreproducible`.
