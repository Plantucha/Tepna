---
bump: minor
type: changed
brief: none
---

Give every window-oracle JSON row the count behind each spread and the knobs that decided it.

A row published `narrowSd` with no count, no untruncated `fullSd` and no word of which ECG axis,
half-width or fiducial produced it. `narrowSd` describes the lags inside the window, so the
population moves with any knob. Each row now carries `ecgAxis`, `halfWidth`, `fiducial`,
`refine`, `narrowN`, `fullN`, `fullSd` and `nullN`. Every field it already held keeps its name
and its value.

