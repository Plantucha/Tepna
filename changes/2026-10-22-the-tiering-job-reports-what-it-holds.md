---
bump: patch
type: changed
brief: none
---

Make the corpus-tier run print the memory it holds.
The run reads its own `VmHWM` and the largest `VmSwap` it samples.
An absent field reads null with a reason, because a memory figure of 0 reads as a measurement.
The unit's `MemoryPeak` charges page cache, so it never answered this question.
