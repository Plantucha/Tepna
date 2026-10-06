---
bump: patch
type: fixed
brief: none
---

Six sites in oxydex-dsp.js read an absent sample as a number: a null summed as 0 in a mean, admitted by a less-than filter, and sorted to the front by a numeric comparator. A dropout could publish hypoxic burden, a cyclical-desaturation index, an IQR of the whole scale, a conditional mean of 0 percent, LF/HF power from a constant heart rate, and a respiration rate read off the gap.
