---
bump: patch
type: fixed
brief: DEVICE-TIME-HANDLING-2026-10-29-BRIEF.md
---

`DexExport.timingBlock` no longer borrows the resync count when a node reports no seam count. OxyDex
and PulseDex scan their own stamp intervals, so each now passes the tripwire's count and its refusal
reason. The reason sentence names each absent count separately, and a node that looks for neither
keeps its one combined sentence.
