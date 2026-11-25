<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [EEGDex]
brief: EEGDEX-STAGE-FORMULA-2026-11-24-BRIEF.md
---
Score an EEG night with a reader-supplied stage formula, behind a switch that starts off.

The reader turns the switch on, and gives the model file to the drop zone that takes the EDF. The
node reads the file by its own `schema` field, and it inlines no coefficients into the page. The
series carries four classes of its own, and not the band-power stager's five. It shows no figure,
because the published thresholds behind it hold no checkable citation yet. The registry grades it
`experimental`.
