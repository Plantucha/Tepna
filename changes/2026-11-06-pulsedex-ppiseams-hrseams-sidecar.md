---
bump: minor
type: added
brief: SEAM-SIDECAR-CONSUMPTION-2026-11-03-BRIEF.md
---

Read the capture-host `_PPISEAMS` and `_HRSEAMS` clock-seam sidecars in PulseDex. A row whose device
step the box measured refuses the whole-record SDNN, rMSSD and pNN50 and the 5-minute window spanning
it; the reader counts a row on a flat device axis as a host gap and refuses nothing on its account; a
night with no sidecar reports seams unknown, never zero.
