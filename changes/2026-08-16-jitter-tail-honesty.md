---
bump: patch
type: fixed
---

**`timing_uncertainty` converts IQR to a sigma with `/1.349`. That is a robust sigma only if the tail is
normal, and it never said so.**

IQR/1.349 is the normal-consistency estimator. Publishing it as a standard uncertainty asserts a Gaussian
tail silently — and on this hardware the assertion is false by three orders of magnitude. `host_jitter`
now publishes **excess kurtosis**, and `timing_uncertainty` carries it through with a `tail_gaussian`
flag, so the premise is CHECKABLE instead of implied.

Measured per stream on one real night — **13 of 14 fail it**:

    H10 acc     +1901.3      H10 ecg    +1400.1      Verity ppg  +94.4 / +34.4 / -1.0
    Verity mag   +17.5       O2Ring     +114.2 / +11.2 / +3.7 / +2.7      (0 = normal)

Where this is far from 0 the budget **under-states** the delivery term, and no finite sigma describes the
tail. `allan.mtie` is the bound to read instead — it assumes no distribution at all (ITU-T G.810).

⚠️ **A correction to my own earlier claim.** I reported these streams as uniformly leptokurtic. That came
from a CONCATENATED read across session files, whose boundaries inject huge steps. Per file — which is
how the shipped code processes them — it is **mixed**: the H10 is violently heavy-tailed (+1400, +1901),
while several Verity streams sit at **−0.9 to −1.1**, i.e. FLAT-TOPPED. Negative excess kurtosis is the
dual-Dirac shape, so on those streams the bounded/unbounded split I rejected may in fact apply. The
rejection stands for the H10 and for the streams with positive kurtosis; it was over-general.

The bound is two-sided (`|excess kurtosis| < 1`) for exactly that reason: flat-topped is as far from
normal as heavy-tailed, and a one-sided test would have called those Verity streams Gaussian.

⚠️ **Reported, not judged.** Nothing gates on `tail_gaussian`, and the raw kurtosis travels beside it so
a reader can disagree with the bound. `None` when variance is zero — an unmeasured tail is not a Gaussian
one, and a default `True` there is the one wrong answer available.
