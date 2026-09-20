---
bump: minor
type: fixed
brief: none
---

ECGDex's coupling grid now says which cells were measured. `_interpGrid` returned a bare Float64Array,
so a cell drawn across a dropout was indistinguishable from one backed by beats, and
`cardiorespCoupling` published seven metrics with `nGrid` and no count of what was drawn. Per-cell
flags in GlucoDex's existing vocabulary, plus `nGridGap`/`gridGapFrac` on the return and in the export.

(`brief: none` is deliberate. This descends from an owner ruling relayed through the fleet, not from a
brief — and neither `DEEP-AUDIT-VI` brief mentions `_interpGrid`, `cardiorespCoupling` or interpolation
at all. Naming a plausible brief would satisfy `check5` while sending the next reader somewhere the
defect never was.)
