---
bump: patch
type: changed
---

**`TCH-FUSED-ROBUST-HAT-FOLLOWUPS` Do 3 is CLOSED — the suppression it asks for already ships, and the
corpus shows it is load-bearing rather than decorative.** Unlike Do 2 and Do 4 this is not a refutation.

**OxyDex** subtracts artifacts from ODI-4 (`odi4.count -= desat.artifactCount`) and gates ODI-3 via
`pulseSeries`. Measured across **55 corpus nights**:

| | |
|---|---|
| artifacts suppressed per night | median **0**, mean 0.87, max **7** |
| nights where it removed ≥1 event | **23 of 55 (42 %)** |
| artifacts as a share of raw ODI-4 | median 0 %, **max 55.6 %** |

⚠️ **The decisive night is 2026-07-21: `artifactCount=7, events=0, eventsAll=7`** — every detected
desaturation was an artifact. Without the gate it scores **ODI-4 = 7 instead of 0**: a *fabricated* index,
not an inflated one. The median of 0 would on its own have read as machinery that never fires; it fires on
42 % of nights and decides the verdict on at least one.

**CPAPDex** has the same gating on its oximetry path — *"ODI: artifact desats are excluded and never
emitted downstream"*, `!e.artifact` with its own `artifactCount`.

⚠️ **The "AHI" half of Do 3 is a category error and should not be built.** `residualAHI` is not a
desaturation index — it comes from CPAPDex's own **flow** classification, and the code already records a
deliberate divergence from the device's count. Suppressing device-corroborated apneas because an optical
artifact gate fired is a different operation from excluding a fake desaturation.

Nothing to build. Do 1/5 still stand unmeasured. No code change.
