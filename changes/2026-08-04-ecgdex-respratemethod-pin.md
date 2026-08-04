---
bump: patch
type: added
nodes: [ECGDex]
brief: TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md
---

Pins ECGDex's exported `respRateMethod`, the one respiration field that was not gated. It became
load-bearing when the R3 mechanism-collision flag shipped: the Integrator's respiration fusion
classifies each source by that string, so had it drifted, ECGDex would have classified as `other`,
`mechanismsIndependent` would have flipped true, and the fusion would have resumed calling two RSA
corners "2 independent estimates" — silently, since R3's own legs use synthetic method strings and
would have stayed green. Adds a leg asserting the two estimates name different mechanisms, and records
that R4/D2 was already fixed in `74f6b1c`: every rich ECGDex export carries both estimates, and the
brief's "no respiration at all" text was stale because the light/equiv exports have no hrv block by
design. Test-only; no DSP behaviour changed.
