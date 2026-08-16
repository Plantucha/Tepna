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

**And format 4d had no test at all.** Level B also found `parseTimestamp` L186-189 surviving — the
match, the `_ckMk` call and the return of `YYYY/MM/DD HH:MM[:SS]`, an entire vendor format named in
Clock Contract §2.4. The one existing `YYYY/MM/DD` assertion in this suite goes through GlucoDex's
OWN parser, not DexClock's, so it covered a different implementation of the same shape.

That failure would have been quiet: a disturbed branch parses to `null`, and `null` is the contract's
honest "unknown" — so it surfaces as missing data, not as an error. Five assertions now pin the
components, the optional-seconds default (`m[6] ? +m[6] : 0` is all that stands between an absent
group and a `NaN`), and the §2.7 refusals for an impossible month and day. All three mutants verified
killed, 4 assertions failing on each.

**And the noise CLASSIFICATION was unasserted too.** Level B found `_ckClassifyAllan` L404/L409/L410
surviving — the `meaning` table lookup and the `drift` branch. The only existing assertion on that
function is a REFUSAL (`noise is null` when the slope straddles an edge); nothing checked that a
slope actually PRODUCES the right name.

§7 is explicit that the slope's job is to name a MECHANISM, and the name is what a reader acts on:
`A FLOOR — more averaging buys nothing` and `deterministic — fit and remove it` prescribe OPPOSITE
responses. A classifier whose label is unasserted can swap those two and nothing reddens. Eight
assertions pin all five names and both extreme meanings; all three mutants verified killed.

