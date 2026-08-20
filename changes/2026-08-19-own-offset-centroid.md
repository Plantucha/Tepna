---
bump: patch
type: fixed
brief: CROSS-DEVICE-DRIFT-FOLLOWUPS-2026-08-17-BRIEF.md
---

**A user-visible per-channel offset was biased by ~−`matchSec`, because the correction that fixes it
was applied to the pooled value and not to the per-channel one — in the same function.**

`fitClockOffsetPooled` documents why the point estimate must be a centroid: a hard ±`matchSec` match
window makes the peak a **plateau ~2·matchSec wide**, so the argmax is decided by whatever tilts the
plateau. Its own words: *"on the planted fixture the argmax landed 37 s low; the centroid lands within
a second."*

That centroid was applied to `offsetSec`. `ownOffsetSec` took the raw per-channel argmax.

**Measured at ±0.1 s jitter — near-perfect input, so the error is the estimator, not the data:**

| matchSec | 10 | 20 | 30 | 45 | 90 |
|---|---|---|---|---|---|
| `ownOffsetSec` bias | −7 | −17 | −27 | −42 | −87 |
| pooled error | +0.5 | +0.5 | +0.5 | +0.5 | +0.5 |

The bias is almost exactly **−matchSec**, so at the shipped default of 30 every per-channel offset read
**~27 s low**, at any true offset (checked at 0, 37, 137, 300, −137). After the fix all five windows
read **+0.5 s** — identical to the pooled path, which is the right answer since they now compute the
same estimator.

**Not internal.** `integrator-app.js` renders it to the user as *"(own peak N min — does NOT support
this offset)"*, so a channel that agreed could be displayed as disagreeing by ~0.45 min; `trio-batch`
prints it in the batch report.

The pooled path is **deliberately not refactored** to share the code: it computes the same centroid
inline with its own grid rounding and `spreadSec`, and touching it would move numbers this function has
shipped for months to fix a defect that never existed on that side.

**Gate: `integrator-dsp · clock-fit-pooled · own-offset-bias`, 11 assertions.** It sweeps matchSec
across all five windows, because the defect was a bias that *scaled* with the window — a single-window
test could pass by coincidence. Plus an anti-vacuity leg: a genuinely disagreeing channel must still
report ITS OWN peak (137.5 vs 900), without which the group would pass if `ownOffsetSec` were simply
wired to the pooled value.

## How it was found — and what it says about box 148

This came out of `CROSS-DEVICE-DRIFT-FOLLOWUPS` box 148 ("per-channel offset σ extracted"), whose
premise is §3.4's *"No new machinery is needed; the estimator already computes each channel's curve."*

⚠️ **That premise does not hold, and this is the measurement that shows it.** The only per-channel
precision figure recorded is `zAtPeak`, and it **saturates**: planted σ from 0.5 s to 12 s — a **24×
spread** — all produce the *identical* z of 11.45, with z only falling near σ ≈ 16 s (half the window).
So the recorded scalar is a match-count, not a precision proxy, and cannot distinguish channels that
differ four-fold in σ. A real per-channel σ needs the peak's **width**, which the function computes
internally and never records. **Box 148 therefore needs new machinery after all** — recorded in the
brief rather than left as a premise nobody re-tested.
