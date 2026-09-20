---
bump: minor
type: fixed
brief: DEEP-AUDIT-VI
---

ECGDex's coupling grid now says which cells were measured. `_interpGrid` returned a bare Float64Array,
so a cell drawn across a dropout was indistinguishable from one backed by beats, and
`cardiorespCoupling` published seven metrics with `nGrid` and no count of what was drawn. Per-cell
flags in GlucoDex's existing vocabulary, plus `nGridGap`/`gridGapFrac` on the return and in the export.
