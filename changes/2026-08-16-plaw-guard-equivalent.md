---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

Five surviving mutants on `hrvdex-dsp.js` L703 — the 3-band power-law guard — are recorded as
`no-distinguishing-input`, **with a proof rather than a failed search**.

The guarded block writes exactly one field, `r.d_plaw`, and its `else` writes `NaN` to the same field.
The mutants differ from the original ONLY for a band ≤ 0 — and that is precisely the input for which
the block itself yields `NaN`: `log10(0)` is `-Infinity`, so `mxp` is `-Infinity`, so
`(lp_arr[i] − mxp)` is `(−∞) − (−∞) = NaN`. Both branches assign `NaN` for every input that
distinguishes the conditions. The guard is a clarity guard, not a correctness one.

🔴 **HOW THIS WAS FOUND IS THE POINT, AND IT NEARLY WENT THE OTHER WAY.** The witness search proposed
`{_vlf: 0, _lf: 1, _hf: 1}` — a valid witness, the conditions genuinely differ. I wrote the obvious
test (`!isFinite(d_plaw)` for a zeroed band), the suite went green at 504 assertions, and it **killed
0 of the 5 mutants**: NaN is not finite, so the assertion is satisfied by the original AND every
mutant. A test that reads as a real contract and encodes nothing.

The sharper form, `d_plaw === undefined`, then failed on the **baseline** too — `got "@NaN" ·
want "@undef"` — which is what revealed both paths converge on `NaN` rather than one leaving the field
unset.

⚠️ **A CONDITION-LEVEL WITNESS PROVES INFECTION, NOT PROPAGATION.** In the standard fault model a kill
needs Reachability → Infection → Propagation → Revealability; a witness establishes only that state
diverges at the condition. Here the divergence is annihilated before any output. That is a load-bearing
limit on the whole witness programme: **1683 witnesses is a count of conditions proven non-equivalent,
not of killable survivors**, and the first conversion attempted converted at 0/5.

⚠️ **Equivalence was checked across EVERY observable, not just the obvious one** — a peer's correction,
and the same asymmetry as the TCE caveat in the other direction: a false equivalence removes a mutant
from the denominator permanently. The block writes one field; there is no second output to check, which
is what makes this a proof rather than "I could not separate them via `d_plaw`".
