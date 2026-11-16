---
bump: patch
type: fixed
brief: none
---

Refuse an ECGDex beat coverage that no span measured. `buildNN` published `coveragePct` 100 whenever `spanSec` was 0, and `analyzablePct` carried that to the KPI card as 100 % analyzable. A series under two intervals and a device counter that never advances both reach it. `coveragePct`, `analyzablePct`, `cleanBeatPct` and `correctionRate` now refuse together. Each one names its own cause. The ECGDex surfaces print an em dash with a neutral grade, instead of `null%` graded against a threshold.
