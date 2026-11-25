---
bump: patch
type: fixed
brief: none
---

A train of equal RR intervals has no spectrum, so ECGDex, PpgDex and PulseDex now publish no LF/HF ratio and no breath rate for it.

The detrend leaves a floating-point residue when the interval is not a short binary fraction. The three nodes read that residue as power and published a ratio near 3.9 beside LF 0 and HF 0. One floor on the variance (1e-6 ms²) now refuses it. The same floor applies to each DFA scale. PpgDex published an exponent of 0 on a flat series and now reports null with the reason no-fluctuation.
