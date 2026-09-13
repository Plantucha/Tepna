---
bump: minor
type: added
brief: briefs/COHORT-VALIDATION-BRIEF.md
---

`tools/cohort-fit.mjs` — compares `cohort-gen.js`'s synthetic patients against a real scored cohort
(two-sample KS on AHI, severity mix, representable range) and computes the post-stratification
weights that would let a coverage sample project onto a real population.

First measurement of the two side by side. 50 000 synthetic profiles vs 5136 SHHS1 records: KS
D=0.331 against a 0.020 critical value, synthetic AHI median 17.4 vs real 35.0, severity mix 25.6 %
severe vs 58.6 %.

This is NOT reported as a generator defect — `COHORT-VALIDATION-BRIEF.md` specifies a state-space
coverage harness, and a near-uniform severity draw is correct for that; fitting SHHS1 would leave
1.2 % healthy patients and gut the none/mild path. What it reports is that the synthetic cohort is a
COVERAGE sample and not an EPIDEMIOLOGICAL one, so a projection needs the weights (none ×0.052,
mild ×0.531, mod ×0.969, severe ×2.290, computed from the supplied reference, never hardcoded).

Two findings are real coverage gaps and survive the definitional caveat: age and BMI are sampled
UNIFORMLY (no covariate has a scoring convention), and the severe stratum caps at AHI 80 while 406
real records (7.9 %) lie above it — unreachable, not merely under-sampled, and exactly where a
detector saturates.

⚠️ SHHS scored hypopneas without requiring a desaturation, so part of the AHI gap is definitional
rather than sampling. The tool prints that caveat with every run.
