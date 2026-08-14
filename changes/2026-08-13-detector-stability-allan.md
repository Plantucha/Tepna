---
bump: minor
type: added
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

PpgDex now reports how much its own beat detector and the device firmware's disagree AS A FUNCTION OF
AVERAGING TIME — overlapping Allan deviation of the two beat-time series' difference — and exports it
for the Integrator to ingest.

WHY THIS IS THE RIGHT INPUT, since the method is borrowed. Allan deviation is clock metrology's answer
to "does this error shrink if I average longer?", a question a standard deviation cannot answer because
for several common noise types SD diverges as N grows (NIST SP 1065). Its native input is PHASE, a
time-error series. Two beat detectors watching the SAME heart through the SAME file give exactly that:
the physiology is common to both and cancels in the difference, leaving detector noise alone. That is a
two-oscillator comparison in everything but name.

⚠️ Raw RR/PPI is the WRONG input and the contrast is measured, not asserted. Intervals are a FREQUENCY
series, and a heart is not an oscillator with stationary noise. On 2026-08-08 the detector difference
gives slope -1.007 (pure jitter: 45.8 ms per beat, 0.17 ms over 5 min, 0.021 ms over 40 min, halving at
every doubling of tau across 12 octaves with no knee and no floor), while the same night's beat times
against a uniform grid give -0.307 and stall at 27 ms. That residual is respiratory sinus arrhythmia and
sleep-stage drift: running intervals through this measures HRV with an instrument built to make HRV
vanish.

WHAT THE SLOPE LICENSES, which is why it is the load-bearing field and the magnitude is not: -1 jitter
that averages away, -1/2 benign, 0 A FLOOR that averaging cannot remove, +1/2 wander, +1 drift. A -1
slope with no floor is what turns "a sustained divergence between our detector and the firmware is a
real fault" from an assumption into a measurement. It also retro-explains the previous changeset: rMSSD
is a first-difference statistic, i.e. the SHORTEST tau, where this curve is at its worst; the mean is
the longest tau. Mean agreeing to 0.74 % while rMSSD sat 10.7 % apart is what the curve predicts.

THREE IMPLEMENTATIONS, GATED AGAINST EACH OTHER. `capture-host/allan.py` works in the phase domain via
the second difference; `integrator-tch.js allanDeviation` in the frequency domain via overlapping
averages; PpgDex needs a third because Python is another lane and it does not load the Integrator's TCH
module (promoting one function to the shared spine would re-stamp all 8 provenance fragments). The
formulations are algebraically equivalent, so drift between them is invisible until a number is wrong.
The gate pins all three: the analytic slopes any correct implementation must produce, exact parity with
the Integrator's, and a cross-LANGUAGE known answer computed by allan.py. Verified on real data first —
converting phase to fractional frequency and feeding the Integrator's existing function reproduced
allan.py to every reported digit at all 12 tau over 17 755 beats.

Writing that gate caught two fixture defects worth recording. The glibc LCG both lanes used overflows
2^53 in JS but not in Python's arbitrary-precision ints, so the two languages built DIFFERENT series
and the "cross-language" comparison was not one (MINSTD is exact in a double, and is used instead). And
a noiseless constant offset makes ADEV identically zero, so every point filters out and the slope gets
fitted on the dropout alone — a degenerate fixture that passes for unrelated reasons.

INTEGRATOR INGESTION. `readDetectorStability()` reads `validation.stability` off a node export and
`hrAgreement` carries it through keyed by node. Read, never derived: an export has no beat times, so a
slope cannot be recomputed downstream and must not be guessed — absent, malformed or non-finite yields
null so a consumer branches on presence rather than a fabricated default. Deliberately NOT folded into
`fault`: a stability slope is evidence about a detector, an epoch disagreement is evidence about a
moment, and blending them produces a number answering neither. What it adds is the fact a fault count
cannot supply — whether the accused node's detector is intrinsically noisy or was fine and met a real
event.

Not available for a `_PPI.txt` source, deliberately. That file carries intervals plus the host's
ARRIVAL stamps, so differencing against it would fold BLE transport jitter into the result and report
the sum as detector noise. The card says so rather than showing a number that does not mean what it
appears to.

Badged `emerging`, not `validated`: the statistic is standard and cited, but applying it to two
DETECTORS rather than two oscillators is this suite's own construction with no external validation, and
a badge is never upgraded on "the literature says". Same tier and same reasoning as ECGDex's
`edrAgreement`. The UI block explains what is being compared, why the comparison is legitimate and what
the number permits — a bare slope and noise name would read as jargon decorating a guess.
