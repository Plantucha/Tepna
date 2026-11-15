---
bump: patch
type: fixed
brief: none
---

Refuse eight ECGDex and PpgDex metrics that published a number over input the node never measured. The group covers validateRR, pnn50, hrvStability, the Lomb-Scargle respiratory rate, the cardiorespiratory PLV, the activity score and the per-beat trust statistic. The trust statistic now marks its own calibration out of band, so the artifact-second count refuses rather than answering 0. PpgDex carries the same mirror and a third state on its own confidence channel.
