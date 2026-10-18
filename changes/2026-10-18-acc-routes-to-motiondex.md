---
bump: minor
type: added
brief: none
---

OverDex now routes a Polar ACC file to MotionDex as its own node. The new polar-acc adapter reads the H10 chest ACC and the Verity Sense arm ACC with MotionDex's own parser and its validity sidecar. OverDex folds a chest and an arm ACC from the same night into one MotionDex run, so the Integrator receives one MotionDex export. The ACC also stays an ECG and PPG companion, so ECGDex posture and motion gating are unchanged.
