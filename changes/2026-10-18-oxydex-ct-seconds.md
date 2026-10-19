---
bump: patch
type: fixed
brief: none
---

OxyDex derived every cumulative-time figure by counting rows and calling each one a second. A 1.015 s cadence therefore under-reported T90 by 1.5 %, and a doubled stamp added a second no sample covered.

Each row now holds its value until the next stamp. A step longer than twice the median cadence is a discontinuity, and its excess rides `ctUncoveredSec`. A series with no usable stamps names its synthesis as `ctSource: assumed-1Hz`. The surfaced sample rate reads the measured median step rather than the constant 1 Hz. Residue row 2026-09-29-oxydex-counts-rows-as-seconds.
