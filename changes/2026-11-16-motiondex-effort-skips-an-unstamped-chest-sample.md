---
bump: patch
type: fixed
brief: none
---

MotionDex no longer places an unstamped chest sample at its index time. Such a sample has no device counter and no host stamp, so it has no instant. The effort series skipped no such sample, and a block of them could fill an epoch that the chest never covered. That epoch then read `present: true`, and the Integrator reads that flag for apnea typing. The effort series now leaves the sample out of every epoch, and `respiratoryEffort` counts it in `unstampedSamples`.
