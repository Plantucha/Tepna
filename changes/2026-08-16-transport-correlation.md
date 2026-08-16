---
bump: patch
type: fixed
---

**`transport.shared` could report a shared fraction of −1.914. It shipped that way this morning.**

The field divided the Groslambert covariance by **one** channel's ADEV, so it was unbounded: since
`|gcov| <= adev_a*adev_b`, it could reach `adev_b/adev_a`. Measured over all **70 device-fragments** in
the box corpus it ran **−1.914 to +2.071, with 4 outside [−1, 1]** — values a shared fraction cannot
take.

Normalising by the **geometric mean** makes it a correlation coefficient, which Cauchy–Schwarz bounds to
[−1, 1] by construction. The same 70 fragments then run **−0.385 to +0.969, none outside**. So the
impossible readings were the normalisation, not small-sample noise.

**That matters because the fix I first proposed was an n-floor**, and it would have been wrong: a
threshold hides the symptom while leaving the impossible values reachable at any n. Renamed `shared` →
`corr` rather than redefined in place, so no consumer silently receives a different quantity.

Read on the variance scale — `corr**2` is the shared variance fraction, and the corpus median `corr` is
0.042, i.e. **~96 % of a typical fragment's arrival variance is per-stream transport noise**. The
deviation scale compressed this misleadingly (a 5 % shared variance showed as 0.22), which is why the
rooted ratio is gone rather than merely documented.

## The interval, and why it is deliberately wide

`ci` is the Fisher z 95 % interval — the shape a bounded statistic can carry and a threshold cannot.
On the real corpus it does the work:

| stream | corr | 95 % CI | n / n_eff |
|---|---|---|---|
| H10 ecg\|acc | **+0.463** | [+0.441, +0.484] | 15084 / 5028 |
| Verity ppg\|acc | **+0.008** | [−0.031, **+0.046**] | 7790 / 2597 |
| Verity, 785-row fragment | −0.017 | [−0.138, +0.105] | 783 / 261 |

The Verity's interval **includes zero**: its two streams share essentially nothing, which is a statement
the old bare `−0.934` could not make. The H10's does not, and is tight.

⚠️ **`n_eff`, not `n`, feeds it.** Overlapping Allan second differences reuse most of the same samples,
so a Fisher z over `n` would be far too tight — the effective-degrees-of-freedom problem
`allan.classify` explicitly refuses to hand-roll. `n_eff` counts NON-overlapping second differences
(each spans `2m+1` samples), understating the information so the interval errs wide. It is a stand-in
for a proper EDF treatment, not one. A wide honest interval is publishable; a narrow wrong one is not.

⚠️ `corr` is **symmetric** — it describes the pair, so both records carry the same value while `adev`
stays per-stream. The test that previously asserted the two must DIFFER was correct for the old
asymmetric statistic and has been replaced; keeping it would have pinned the defect rather than the
contract.

## My first regression test passed under the defect

It generated INDEPENDENT ragged pairs — but with `gcov ~ 0` every normalisation gives ~0, so it
asserted nothing. Mutation-checked and caught: reverting to `gcov/adev_a**2` left all 45 tests green.
Exposing it needs a **correlated** pair with unequal scales; the one now in the test shares a clock and
differs 6× in scale, reading **4.80** under the old form against **0.79** under this one.

Three mutants, each killed by the test written for it: one-channel normalisation, Fisher z over `n`
instead of `n_eff`, and admitting `r = ±1` into `atanh`.
