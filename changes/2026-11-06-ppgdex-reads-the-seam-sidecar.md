---
bump: minor
type: added
brief: SEAM-SIDECAR-CONSUMPTION-2026-11-03-BRIEF.md
---

PpgDex reads the box's `…_PPGSEAMS.txt` clock-seam sidecar, places each recorded seam on its own
sample axis and folds it into the node's seam verdict, so a box-recorded seam now refuses what a
device-counter resync already refused. Every PPG export states whether the channel was read: a
recording with no sidecar reads `seams: null` with the reason `no-seam-sidecar`, never as a
recording with zero seams. Both PPG adapters and the H10 ECG adapter also carry the parsed sidecar
across the SignalFrame boundary, which the orchestrated road dropped on both nodes.
