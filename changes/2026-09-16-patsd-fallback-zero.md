---
bump: patch
type: added
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

A re-cut that looked ready was hiding two of its three headline comparisons, and a fabricated zero.

`rmssd-equivalence` was cleared for re-cutting because driving its tool at the paper's stated
`nSubj: 240` reproduced `nWindows = 220` exactly — the published count. **Matching *n* is not matching
the result.** The captured object contained only one of three Bland–Altman pairs (`ppg_minus_ecg`),
while the paper headlines the other two: ECG−Pulse (bias −0.02 ms, r 0.9999) and optical−Pulse
(bias ≈+1 %, r 0.92).

`baEP` and `baPP` both require the `pulse` arm; `baPE` does not — so the one pair that survived is
exactly the one that needs no reference. The run was **incomplete, not differently configured**, and
`nSubj` is the tool's only input.

## The zero that is not a measurement

`qrs-equiv-analysis.js:302`:

```js
var patSD = baEP && baPP && baPP.sd > baEP.sd ? Math.sqrt(baPP.sd*baPP.sd - baEP.sd*baEP.sd) : 0;
```

The `: 0` branch covers **three** cases — ECG−Pulse absent, PPG−Pulse absent, or no excess over the
electrical floor. Only the third is a measured zero; the first two are absences, published as the same
number. §∅ exactly.

This is not an incidental field. The paper headlines it: *"the quadrature excess over the electrical
floor — was ≈4.0 ms, i.e. essentially all of the PPG disagreement is pulse-arrival-time jitter"*. A
fabricated `0` reads as *the optical arm carries no PAT jitter* — that paper's central claim, negated.

**Observed, not hypothesised:** the run that returned `patJitterSdMs: 0` is the same run in which the
quantity could not be computed at all, and nothing in the result says so.

## The sibling defect made the partial run look complete

`RESULT.pairs[...]` is populated `if (p[1])`, so a missing comparison is **absent** from the object
rather than present-and-null. A consumer cannot distinguish *"this pair was not computed"* from
*"this tool never emits that pair"* — which is precisely how I read a partial run as a finished one.

**Why the `pulse` arm was empty is not established and is not guessed at.** That is the next unit, and
it blocks re-cutting `rmssd-equivalence` under cohort-gen 2.0.

Filed as `2026-09-16-patsd-zero-is-a-fallback`. No behaviour changed.
