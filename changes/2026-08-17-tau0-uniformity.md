<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: INTERDISCIPLINARY-LITERATURE-DIAGNOSIS-2026-08-16-BRIEF.md
---

`allan.tau0_uniformity` — does the input actually have the even spacing every estimator here assumes?

The module header says the input is a PHASE series. It does not say the other half: each estimator is
handed ONE `tau0` and assumes the samples are spaced by it. Nothing checked that, and on this box the
assumption is false in one lane and true in the other.

`nightqc._tau0_of` returns span / (n-1), which telescopes to exactly the MEAN of consecutive intervals.
On a BLE arrival axis the packets are not evenly spaced, so that mean is the spacing PLUS the gaps, and
the whole tau axis is relabelled by the ratio between them. Measured over 120 *_PMDARRIVAL.csv on the
box, mean / median consecutive interval:

    H10 ecg     1.04          H10 acc      0.98-0.99
    Verity ppg  0.87 - 1.16   (79 series)  Verity ppi   0.52 - 0.97
    Verity acc  0.94-1.06     O2Ring dur   1.00

Up to a 16 % tau-label error on the most-populated stream. For contrast the DEVICE-counter axis the JS
node lane uses is uniform to <=0.7 % over 439 streams — same estimator, same vocabulary, different
series, opposite answer. Conflating those two lanes is how this nearly got written up as refuted.

WHAT THE ERROR DOES, because it bounds what this is for. A UNIFORM rescale of tau is a horizontal shift
in log-log, so the SLOPE is invariant and `classify`'s noise type — the thing callers branch on — is
immune. Asserted, not argued: test_a_uniform_tau_rescale_leaves_the_SLOPE_invariant pins
classification.slope/noise/candidates identical under a 3x wrong tau0 while optimal_tau and tau_max
scale by exactly 3x.

THE CONSEQUENCE A READER ACTUALLY SPENDS is `_TDEV_TAU_S`. That tau is FIXED precisely so nights are
comparable to each other, and a tau label wrong by a different amount per stream partially defeats that:
two streams quoted "at 100 s" are not at the same 100 s when one tau0 is the mean of an even series and
the other is inflated 16 % by gaps. (Raised by the Vigil box session, and it is the reason to publish
the ratio rather than leave it a known-unknown.)

Genuinely irregular spacing additionally biases AVAR itself (dead time — Barnes & Allan 1990, NIST TN
1318), which relabelling tau does not fix. Two distinct effects; only the first is a scale error.

REPORTS, DOES NOT GATE AND DOES NOT CORRECT. ALLAN-DEVIATION §4's rule — the last two arrival
diagnostics that shipped with thresholds both fired on every stream of the first real night — and the
precedent is now broader than that one brief: connection_lattice, device_stamp_constant and
tail_gaussian all shipped this week as published-not-judged. The unbiased-AVAR estimator for unequal
spacing (Sesia & Tavella 2008, Metrologia 45(6):S134, doi:10.1088/0026-1394/45/6/S19) is the principled
fix and should FOLLOW this measurement rather than precede it.

Refuses rather than fabricating: fewer than 3 samples, fewer than 2 positive deltas, and None/empty all
return None. Returning 1.0 there would be "perfectly uniform" asserted about a series that has no axis.
Non-finite samples are dropped, not propagated; the result is order-independent.

⚠️ THE 100 % BRANCH FLOOR FOUND DEAD CODE IN THIS FUNCTION. A `median > 0` guard was written and proved
UNREACHABLE: the comprehension keeps only `b > a`, so every delta is strictly positive, and the series
with no spacing at all ([5,5,5,5]) refuses earlier at `len(deltas) < 2` having produced zero positive
deltas. Removed rather than silenced with a pragma — an unreachable guard reads as a handled case that
is not one.

Scope: the pure function and its tests only. Wiring it into `arrival_quality` is the Vigil box session's
— that row was mutation-hardened three times today (#1407 killed a mutant deleting the
`allan.stability(...)` call), and the context that matters there is which lines in that dict were
untested.

allan.py: 100 % statement AND branch, 111 tests. `ruff check` clean. Note `ruff format` reports this file
unformatted at line 371 — pre-existing, and check.sh gates `ruff check`, not `ruff format`, so no
reformat is included.
