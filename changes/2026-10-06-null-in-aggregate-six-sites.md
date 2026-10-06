---
bump: patch
type: fixed
brief: none
---

Three aggregates in oxydex-dsp.js read an absent sample as a number: the CDI state machine (`null < loThresh` is always true for SpO2, so a dropout manufactured a cyclical-desaturation index) and both spectral windows, where `reduce` summed nulls as 0 and `v - m` turned each into a -m impulse — publishing LF/HF power from a constant heart rate and a respiration rate read off the gap (7.8 to 8.4 bpm, peak power 0 to 14.2). The other three sites of the original six were fixed by #3321 while this waited behind it; their assertions remain as regression guards.
