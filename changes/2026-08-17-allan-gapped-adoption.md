<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: INTERDISCIPLINARY-LITERATURE-2026-08-16-BRIEF.md
---

Closes the reading queue's "one field adopted or rejected in writing" item, and corrects a [MISSING]
label on the diagnosis that was already built.

§13b.4 (Allan-family estimators on gapped and irregular data) is ADOPTED for the arrival lane and
REJECTED for the node lane, both on measurement — and the entry conflated the two, which is why the
answer differs.

`allan.py` (Python) and `allanFromPhase` (the JS spine) both take a `tau0` and both assume a uniform
grid, but they are handed DIFFERENT SERIES.

ARRIVAL LANE — `nightqc._tau0_of` -> `allan.stability`, indexed on BLE packet-arrival host stamps.
Measured over 120 `*_PMDARRIVAL.csv` sidecars on the box, per (device, meas) series, as
mean-tau0 / median-delta:

    H10 ecg           n=7    541 ms    1.04           worst gap  9x median
    H10 acc           n=7    720 ms    0.98-0.99      worst gap 10x
    Verity ppg        n=79   300 ms    0.87 - 1.16    worst gap  4x
    Verity acc        n=8   2416 ms    0.94-1.06      worst gap  2x
    Verity ppi        n=2   4897 ms    0.52 - 0.97    worst gap  1x
    O2Ring duration   n=10  1005 ms    1.00           worst gap  1x

NODE LANE — `DexClock.hostAxis(...).stability`, indexed on the device counter. 439 ECG/PPG streams over
17 box nights: Polar 0.9999-1.0066 with worst gap 1.0-1.4x; O2Ring 0.9990-1.0510 with one gap 208x.

So the arrival axis is irregular and the device axis is not. §13b.4's "BLE arrivals are not uniform" is
correct, and the number is: on the most-populated stream (Verity ppg, 79 series) the mean packet
interval runs 0.87-1.16x the median, i.e. up to a 16 % error in the tau label; Verity ppi reaches 0.52.

WHAT THE TAU ERROR DOES AND DOES NOT DO, because it bounds the cost. A uniform rescaling of tau shifts
the curve horizontally in log-log and leaves the SLOPE invariant, so the noise-type classification - the
thing this suite branches on - is immune. What moves is where on the curve a sigma is quoted:
`optimal_tau`, `tauMaxSec`, and any cross-stream comparison read at a fixed tau. Separately, genuinely
irregular spacing biases AVAR itself (dead time; Barnes & Allan 1990, NIST TN 1318), which relabelling
tau does not fix. Two distinct effects, only the first a scale error.

ADOPTED: Sesia & Tavella (2008), Estimating the Allan variance in the presence of long periods of
missing data and outliers, Metrologia 45(6):S134, DOI 10.1088/0026-1394/45/6/S19.

REJECTED for the node lane: its input is uniform to <=0.7 % on every Polar stream, so an unbiased-AVAR
rewrite there would add machinery to correct a bias that is not present. The O2Ring is the one node-lane
exception and is already refused twice over (drawn axis; incoherent cross-fragment rate).

OWED AND DELIBERATELY NOT DONE: the arrival lane should publish the mean-to-median ratio beside its
curve, so a reader can see when the tau label is trustworthy - cheap, Python-side, no bundle. The
unbiased-AVAR swap is larger and should FOLLOW that ratio, not precede it: measure how often the bias
matters before importing an estimator to remove it.

SEPARATELY - the diagnosis's §2.3 [MISSING] label is corrected. `capture-host/nightqc.py
timing_uncertainty()` implements GUM measurement-uncertainty propagation and cites §2.3 as its
justification: delivery jitter (IQR/1.349), stamp quantum (w/sqrt(12), GUM 4.3.7) and the oscillator
curve, combined in quadrature, returning components as well as total. §2.2 is cited there for why it is
a budget and not a correction. Scope stated so the gap is not overstated: capture-host ONLY - no JS node
attaches a per-event timing uncertainty, so §7.1's "propagate it" half is still open.

I reported §2.3 as "confirmed absent" earlier in this session after grepping
`uncertaintyMs|timingUncertainty|eventUncertainty` across `*.js`. The implementation is Python, so that
query could not have found it whatever the answer was - a search whose scope excluded the answer,
reported as a negative. An empty result is a statement about where you looked.

SECOND FIELD CLOSED — §4 (GNSS integer ambiguity resolution), [REINVENTED].

That entry claimed the ratio test "answers is this alignment trustworthy on this night, which the suite
currently cannot answer at all". That is false as of INTEGRATOR-PAT-VASCULAR §2-RESULT-IV, which built
exactly it: the R-to-foot offset is ambiguous MODULO ONE RR and beat TIMES cannot resolve it; it is
resolved by normalised cross-correlation of the ECG RR sequence against the PPG PPI sequence over
INTEGER BEAT-INDEX LAGS; and it is validated by the MARGIN between best and second-best lag, reported
per night, the two populations separating by three orders of magnitude (2 of 29 nights recoverable,
ncc 0.995-0.996, margin 0.196-0.223, PAT SD 28.1 / 36.8 ms - inside pat-gate's 60 ms bar).

That margin IS the GNSS ratio test, independently rebuilt under a different name on a different signal.

What GNSS still adds, one real item: the fixed-failure-rate ratio test (Teunissen & Verhagen) sets the
acceptance threshold from a target false-fix probability rather than a constant. §2-RESULT-IV needs no
threshold today because its separation is 10^3 - a property of this corpus, not of the method.

REJECTED with the reason: LAMBDA's decorrelation does not apply. The Z-transformation exists because a
MULTI-DIMENSIONAL float-ambiguity covariance is elongated and makes integer least-squares expensive. The
beat-lag ambiguity is ONE-dimensional, where integer least-squares is rounding and decorrelation is a
no-op. Importing the toolbox would be machinery for a dimension the problem does not have.

STILL OPEN: cycle-slip detection. A dropped or inserted beat is formally a cycle slip; GNSS detects them
explicitly and the suite does not - JOINT-UNWRAP-ATTEMPT measured slips wrecking a cumulative unwrap with
no detector for them.

METHOD NOTE. Grep could not reach this: the queue says "integer ambiguity", the repo says "ambiguous
modulo one RR" and "margin", and the two share no token. A loopback bge-m3 semantic index over all 4374
brief sections surfaced §2-RESULT-IV at rank 3 for the field's own description. Calibrated before use
with a control LADDER - three known-answer rungs landing 0.60-0.66 and a nonsense rung flooring at 0.42 -
and every hit was opened and read. The retrieval is a candidate generator, never evidence; the index and
harness stay in the scratchpad, uncommitted, out of every verification path.
