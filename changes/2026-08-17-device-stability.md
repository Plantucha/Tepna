<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md
---

Per-device timing stability, measured against the capture host instead of against another wearable —
344 streams over 16 box nights, answering the open item that asked for "a third MECHANICAL channel, or
measure against the capture host".

That item existed because §2.6 had pointed `integrator-tch.js` at timing and got sigma_ECG = 128 ms,
which is not the ECG's clock: both ECG-containing pairs carry pulse arrival time, so a three-cornered
hat over beat-derived offsets attributes physiology to a device. `Phone timestamp` vs
`sensor timestamp [ns]` contains no beat at all, so nothing in it can carry a transit delay. The
independent timing path was in every raw capture file the whole time.

`tools/device-stability.mjs` walks the corpus and rolls up per device; every number comes from
`DexClock.hostAxis(...).stability`, so this is NOT a fourth Allan implementation (HOSTAXIS-STABILITY
§4.3 forbids one) and it inherits the existing cross-language parity pin against `capture-host/allan.py`.

    device        streams  nights  ADEV slope            sigma_y(tau=256 s)   noise type
    Polar H10          98      16  -0.99 [-1.06..-0.91]   388 ppm [171..764]  white/flicker PHASE
    Verity Sense      218      16  -1.00 [-1.03..-0.88]   843 ppm [248..1945] white/flicker PHASE
    Wellue O2Ring-S    28      14  -0.55 [-0.98..-0.30]  1195 ppm [178..15032] white FREQUENCY, mixed

THE QUESTION AS ASKED IS NOT WHAT THIS ANSWERS, and the slope is what says so. Every Polar curve is
tau^-1 across the whole reachable tau range - phase noise all the way out - so neither crystal is ever
reached and this cannot rank the crystals. What it ranks is the timing PATH: the H10 is quieter than
the Verity on 16 of 16 paired nights, median ratio 2.27x, holding on the primary streams alone (H10 ECG
452 ppm vs Verity PPG 808 ppm). Inverting the tau^-1 model names the mechanism - implied arrival jitter
50 ms for the H10 (about 1x its 45 ms connection interval) against 124 ms for the Verity (about 4x its
30 ms). That is BLE delivery, not crystal quality.

The corollary generalises: because the noise is white phase throughout, averaging always pays, so the
limit on any rate estimate here is recording LENGTH and not a stability floor. No device in this corpus
needs a stability gate.

A METHOD FINDING THAT NEARLY SHIPPED AS ITS OPPOSITE. The first crystal check compared fragment rates
by raw max-min spread and failed 25 of 40 device-nights, including 10 H10 nights - which would have
contradicted WEARABLE-DRIFT-DIRECT §1's +-2-3 ppm. §1 was right and the check was wrong: it filtered to
fragments > 3 MB and this did not. On 2026-08-01 the H10's 563-minute fragment reads -21.0 +- 2.4 ppm
while its 28-minute fragments read -119.5 +- 309 and +12.5 +- 307 - the same measurement, every short
value inside 1 sigma. Judged through the error bars (inverse-variance mean, reduced chi-squared 0.07)
the night is a crystal at -21.0 +- 2.4, and 39 of 40 device-nights now hold one; the single failure is
the O2Ring on 2026-08-01 at chi2red 6.30, exactly as §7.1 predicted. This is the concrete payoff of
publishing `ppmUncertainty`: without sigma_i the decision cannot be made correctly, only confidently.

Two comparisons are refused rather than approximated, both because the first version got them wrong on
real data. sigma_y is a FUNCTION of tau, so every cross-device figure is read at ONE reference tau
(256 s) and a stream whose curve does not reach it is dropped, never compared at its own longest tau -
tau_max spans 311-16153 s here, a 52x range. And fragment rates are compared only THROUGH their
uncertainties, never by raw spread.

Also answers the sibling item on inverse-variance weighting in `fitClockOffsetPooled`, and the answer is
still no - but now for a measured reason rather than a missing one. `hostAxis.stability` yields a
per-DEVICE CLOCK sigma while the pooled fit weights per-CHANNEL OFFSET estimates, and channels differ in
how sharply each event type localises in time, which is event morphology and not a clock property. The
real precondition is a per-channel sigma of the offset estimate itself, which remains unbuilt.
`integrator-tch.js inverseVarianceWeights` is also the wrong function to reach for even then: it floors
each sigma^2 at 8 % of the largest, and in clock work the smallest sigma is the most trustworthy, so
that regularisation would discard the fragment carrying the answer.

Gated by `device-stability · per-device-sigma` (14 assertions, Node-lane only - the browser lane cannot
ESM-import a tool, so it SKIPs). Verified RED by value under two mutants: reverting to the raw-spread
crystal rule kills 2 assertions, and letting the common-tau read fall back to the nearest available tau
kills 1. `--selftest` plants three noise types and requires them back strictly ordered -1 < -1/2 < +1/2,
since separating "averaging helps" from "averaging hurts" is the whole question.

Does NOT license revisiting ECGDex's 2400 s span gate. The arithmetic is tempting and it is precisely
the claim HOSTAXIS-STABILITY §3 made and withdrew; ADEV and the uncertainty of the endpoint estimator
ECGDex actually uses are different quantities. The gate moves when someone derives the bound for that
estimator.
