---
bump: patch
type: changed
brief: FINISHED-WORK-IMPROVEMENTS-2026-08-20-BRIEF.md
---

`O2RING-TIME-CAPABILITY-WIRING` §4a records FINISHED-WORK §B3's decision: the fiducial network is
ADOPTED as the TCH direction and the RTC stays declined as a corner.

The item's "first closure residual" half is answered too, and the answer is that it cannot be
computed — for a structural reason rather than a data gap. A closure needs three independently
observed pairwise offsets; only H10↔Verity exists (+140 ± 35 ms pooled), because the ring fails its
own detection band at 2/5 on every run. §4's recorded workaround — deriving the ring onset from the
command stamp plus the H10-leg latency — would make the three-way sum identically zero by
construction, a closure that cannot fail.

Also ticks §B4's row, landed as the trio-batch timefit hook.

Docs only; no code, no bundle changes.
