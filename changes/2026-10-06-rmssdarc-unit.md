---
bump: patch
type: fixed
brief: none
---

OxyDex's `rmssdArc` declares the unit it actually emits — `bpm/30min`, the slope of a pulse-rate RMSSD over 30-minute windows — instead of `ms/h`, which was wrong in both the numerator and the denominator; the DSP is unchanged and the declaration is now pinned by a known answer.
