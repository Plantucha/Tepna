---
bump: minor
type: changed
brief: none
---

`cohort-gen/2.0` — the severe stratum draws a shifted log-normal fitted to SHHS1 (μ=3.076, σ=0.731 on
AHI−29) instead of `uniform[30,80]`, and its upper bound becomes a refusal guard at 300 rather than a
ceiling. A uniform draw has no skew and no tail by construction, and 13.5 % of real severe nights sat
above the old ceiling — unreachable, not under-sampled.

Shape now matches: median 50.7 exactly, p95 102.2 vs 101.2 real, 12.4 % above 80 vs 13.5 % real.

The other three strata are deliberately unchanged (`mod` is already near-exact at 22.7 vs 22.5), and
the stratum MIX is not fitted either — that would destroy coverage, and the same 5136 nights are
58.6 % or 3.1 % severe depending on the reference.

Measured effect on the published statistic, 1000 paired nights: slope 0.8523→0.8449, R² 0.9701→0.9683,
severe bias unchanged at −6.9. Nothing moved, which is the argument for the change rather than
against: it closes the gap without invalidating existing synthetic results.
