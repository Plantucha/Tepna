---
bump: patch
type: fixed
brief: ALLAN-DEVIATION-2026-08-12-BRIEF.md
---

Level B found **the entire least-squares body of `_ckAllanSlope` surviving deletion** — the `mx`/`my`
accumulators, both `/= k` means, and the `sxy` covariance — inside a function this suite already
exercises.

The reason is that every existing slope assertion is an **inequality**: `st.slope < -0.5`,
`st.slopeSE > 0`. Those pin a DIRECTION, and the slope's whole job is to name a MAGNITUDE — §7 reads
τ⁻¹ as jitter that averages away, τ⁻¹ᐟ² as the benign case, τ⁰ as a floor where more averaging buys
nothing, τ⁺¹ as drift. `slope < -0.5` cannot separate −0.6 from −1.0, so it cannot separate "benign"
from "jitter", which is the one distinction the number exists to make.

A pure power law `adev = C·τ^m` is exactly collinear in log-log, so least squares must return `m`.
Four known answers (−1, −0.5, 0, +1) plus the §7 refusal below three τ points.

⚠️ **One mutant is not killable by any slope assertion, and that is least squares, not a test gap.**
`my += ys[i]` sets the INTERCEPT; the slope `b = sxy/sxx` is invariant to it — for collinear y,
`Σ(x−mx)·y = m·sxx` whatever `my` is. Verified by applying the mutant: all four slope answers stayed
exact. It reaches the RESIDUAL instead, so the fit of an exact law is asserted to have `se === 0`.

**Every one of the five was verified killed by re-applying it**, which is the step that has twice
caught a test written from reading the code that caught nothing.
