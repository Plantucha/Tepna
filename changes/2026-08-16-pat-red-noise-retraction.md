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

## It transfers to shipped, user-facing code — and there the fix is not removal

`oxydex-dsp.js computeSpO2FFT` surfaces **"FFT Cycle Length"** (the periodic-breathing / Cheyne-Stokes
number) as a raw-power argmax over 11 fixed frequencies, 0.005-0.05 Hz, with **no background, no
significance test and no null**. It cannot return "no cycle detected"; it always returns a number. On
pure AR(1) at rho = 0.98 it reports the 0.005 Hz band edge in **42 %** of runs.

**But the corpus refutes the obvious conclusion.** Real O2Ring nights (median lag-1 rho = 0.98) hit that
edge in **3 of 14 = 21 %** — half as often as the null — which is weak positive evidence that something
real pulls the argmax away from the edge. Periodic breathing and CSR have a genuinely characteristic
period, so unlike §4e a dominant frequency there is not a-priori meaningless.

So the honest statement is narrower than "the metric reads noise": it has **no null**, cannot say "no
cycle", and demonstrably fabricates one on featureless input — while appearing to respond to something
real on real nights. Both are true, and one fix covers them: peak height against a fitted background,
keeping real detections and dropping fabricated ones. **Not done here** — it is an OxyDex DSP change with
bundle, GATE A/B and fixture cost, and it changes a user-facing number.

Found with Papers, whose corpus check refuted their own stronger hypothesis; n = 14, so 21 % vs 42 % is
suggestive rather than decisive.
