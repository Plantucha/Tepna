---
bump: patch
type: fixed
nodes: [oxydex]
brief: SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md
---

`nsrr-adapter.js` no longer fabricates absent SpO₂ and heart rate.

`to1Hz()` forward-filled a physiologically invalid sample with the last valid one, so a sensor dropout
became a flat run of the previous saturation for as long as it lasted, and a wholly-invalid channel was
seeded with a hardcoded `97 %` (or `60` bpm). Measured over the first 15 SHHS1 records: mean 2.76 % of
SaO₂ samples invalid, and shhs1-200001 held one value across 3840 s — 64 minutes of invented flat trace,
over which no desaturation can be detected and the rolling baseline is computed from a run that never
happened.

A dropout is now `null`. Two representation traps had to be avoided, both of which re-fabricate
silently: a `Float32Array` cannot hold null (it coerces to `0`), and `NaN` fails both halves of
`processNight`'s range guard so a NaN row reaches the detector. Only `null` is skipped.

Coverage now travels with the rows (`spo2CoveragePct`, `spo2ValidSec`, `hrValidSec`) — §∅'s rule that an
output computed over absent input reports the absence. Measured across 99 records: 24 have under 95 %
SpO₂ coverage, the worst 57.7 %, all previously indistinguishable from complete nights.

⚠️ The `nsrr-adapter · ingest · known-answer` gate had ENCODED THE FABRICATION as the invariant — four
assertions required the fill and the hardcoded 97, one arguing a normoxic default was the safe value to
invent. Choosing which value to fabricate is the §∅ error, and the gate held it in place so any correct
fix read as a regression. Those assertions now assert the opposite and are plant-verified.

This changes ODI slightly (spurious events over held spans disappear) but does NOT explain the measured
under-count: the severity gradient moved −0.853 → −0.860 across 99 records.
