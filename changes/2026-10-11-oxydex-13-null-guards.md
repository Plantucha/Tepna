---
bump: patch
type: fixed
brief: none
---

Guard all thirteen remaining OxyDex consumers that read a row's SpO2 or HR directly, so a carried hole stops fabricating a desaturation, an oscillation crossing, a settling ramp, an HR asymmetry or a spike recovery — and correct #3408's cool-down trim, which came from `94 - null`.
