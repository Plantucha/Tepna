---
bump: patch
type: fixed
brief: none
---

Refuse the ECGDex artifact-masked beat count when the trust gate could not calibrate.

Carry the reason into the ectopy and PVC quality blocks, and decide that gate by a pre-stated
margin, so a flat quality signal cannot read as spread.
