---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

GlucoDex `agp` was pseudo-tested — the Ambulatory Glucose Profile's 48-bin percentile grid, the
standard consensus chart, with nothing asserting the bins, the percentile order, or what an empty
bin reports. Now gated through `analyze(genSynthetic(...))`, including the non-decreasing percentile
ladder in every populated bin and `n: 0` with null percentiles for an empty one. A gapped fixture
also closes a hole the whole GlucoDex lane was missing: `agp`'s analyzable filter, which excludes
long-gap FILL from the percentiles, could be removed without any test noticing. Verified by
re-applying 11 mutants: 9 killed, 2 documented equivalent.
