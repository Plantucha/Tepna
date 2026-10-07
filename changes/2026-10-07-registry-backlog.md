---
date: 2026-10-07
pr: registry backlog adjudication
---

Registry backlog adjudication — systematic resolution of the 2026-10-06
projection findings (13 non-emitting IDs).

Renames (naming drift, DSP emits the latter):
- ecgdex `correction` → `correctionRate`
- ecgdex `meanSqi` → `meanSQI`

Dormant markings (adjudicated, not deleted):
- ecgdex `crCoupling`: duplicate of `crcPLV`
- cpapdex `cmpResidSD`: emitted nested as `scale.residSD`, registry needs path support
- motiondex `activityCounts`, `sqiConf`: no compute site
- hrvdex `recovIndex`: no compute site

The 6 IDs from the 2026-10-06 ID↔EMISSION DRIFT fix were already resolved on main.
