---
bump: minor
type: added
brief: SEAM-SIDECAR-CONSUMPTION-2026-11-03-BRIEF.md
---

ECGDex reads the box's `…_ECGSEAMS.txt` clock-seam sidecar and refuses the epoch a recorded seam
falls in. Every ECG export now states whether the channel was read: a night with no sidecar reads
`seams: null` with the reason `no-seam-sidecar`, never as a night with zero seams.
