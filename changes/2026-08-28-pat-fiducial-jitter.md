---
bump: patch
type: added
brief: PAT-FORENSICS-FIDUCIAL-JITTER-2026-08-28-BRIEF.md
---
PAT forensics phase (b), §7: measured the beat-to-beat variability of eight pulse-foot fiducial
families on real pulses, clock-free by construction (two fiducials of the same beat share the
clock, so their difference cancels it identically; no acceptance stage runs, so the 450 ms PHYS
window never enters). All 28 pairs land under 6.22 ms against pre-stated closed bands, so the
fiducial family is not a lever and the standing 38.0 ms residual IQR is not explained by it.
New tool `tools/pat-fiducial-jitter.mjs` (--selftest 11/11, including an assertion that a planted
clock shift leaves every pairwise SD at zero, and a positive control that planted jitter is seen).
Bounds the differential only: common-mode error cancels in the difference and needs the oracle.
