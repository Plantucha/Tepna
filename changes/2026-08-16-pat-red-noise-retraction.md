---
bump: patch
type: fixed
---

**"PAT's dominant frequency is 0.032 Hz — a ~31-second cycle" is retracted. It is what red noise does.**

In a red spectrum the argmax sits near the low-frequency end **by construction**, so reading its location
as a characteristic period reads a peak into a slope. Tested against the null §4e's own numbers imply,
needing none of the original data: an **AR(1) process reproduces the published band shares almost
exactly** — rho = 0.908 gives VLF 0.51 / LF 0.33 / HF 0.16 against the measured 0.50 / 0.36 / 0.15 — on
the same geometry, **with no oscillation present at all**.

    argmax over 120 runs of PURE red noise, nothing planted:
        median 0.0220 Hz    10th-90th 0.0080 - 0.0500 Hz
        74 % of runs at or below 0.032 Hz

The rest of §4e stands and is untouched: the band shares (50/36/15) are a measurement, the respiration
refutation rests on a shuffled **control** rather than a peak reading (3.99 % vs 8.70 %, exceeding the
null on 1 of 17 nights), and the localisation to VLF+LF holds. What is retracted is a *characteristic
frequency* within the band, not the band.

⚠️ AR(1) is one background model, and this tests only whether the argmax LOCATION discriminates — it does
not. Fitting a robust background and testing peak HEIGHT against it (Mann & Lees 1996) is the stronger
test, and is what to run to CLAIM a cycle rather than retire one.

## The SAME test gives the OPPOSITE verdict on shipped code

`oxydex-dsp.js computeSpO2FFT` surfaces **"FFT Cycle Length"** (the periodic-breathing / Cheyne-Stokes
number a user reads) as a raw-power argmax over 11 fixed frequencies, 0.005-0.05 Hz, with **no
background, no significance test and no null**. It cannot return "no cycle detected"; it always returns a
number, and on pure AR(1) it pins to the 0.005 Hz band edge in 12 % of runs at rho = 0 rising to 55 % at
rho = 0.995, nothing planted.

**But the corpus refutes the red-noise null there, decisively.** Across **103 O2Ring nights** (median
lag-1 rho = 0.9813, range 0.955-0.997):

    reporting the 200 s EDGE     19/103 = 18 %     null predicts 42 %
    exact one-sided binomial     p = 3.3e-7        Wilson 95 % CI [0.121, 0.270], excluding 0.42
    cycle distribution           62s:16  77s:8  100s:21  125s:13  143s:13  200s:19  (+33/40/50: 13)

Cycles spread across the band rather than piling at the edge, and 62-125 s is the classic
periodic-breathing / CSR range.

**So §4e's argmax does not discriminate and OxyDex's does — same statistic, opposite verdicts.** That is
the reason neither can be generalised from the other, and why this changeset retires one claim without
touching the other.

What survives for OxyDex is narrower than "the metric reads noise": it has **no null**, so it cannot flag
the nights where there is nothing to report. The fix is peak height against a fitted background
(Mann & Lees 1996), which **keeps** the real detections — not removal. **Not done here:** it is an OxyDex
DSP change with bundle, GATE A/B and fixture cost, and it changes a user-facing number.

⚠️ **Provenance of these numbers.** Found with Papers, who corrected themselves twice: an initial n=14
result (3/14 = 21 %) was reported as a refutation when it was **not significant** — exact p = 0.096, the
null inside the Wilson CI [0.076, 0.476], 41 % power. An earlier draft of this changeset repeated it as
"weak positive evidence"; it was neither. The 103-night run settles it, and both binomial tests and both
CIs were re-derived here independently rather than taken on report.
