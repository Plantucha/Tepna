<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: removed
nodes: [OxyDex]
brief: O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS-2026-08-03-BRIEF.md
---
Retire `counted_loss` — the followups §3 decision, and it is closed rather than preferred: the counter cannot be made informative under **any** nominal.

- With a **fitted** nominal (the per-second rate estimated from the session itself) `expected` converges on `declared` and the residual is identically ~0 — a statistic whose reference comes from the data it is testing, which is the exact defect this brief family keeps finding (`matchRate`'s stage two; `strictMatchRate.residIQR`).
- With a **fixed** nominal the constant's error is the same order as any loss it could detect: 126 against a measured **126.04** per device-second with a **125.6–126.5** per-session spread. On the reference night it read **−5 120 samples** — a *surplus*.

There is no third option, so it is removed rather than documented, along with `expected`, the `nominal` parameter, and the **`ppg_expected` sidecar column**. **Removed before any capture was written in that format**: no `OXYFRAME` on disk carries the new columns yet — the most recent (2026-08-03 21:22) still has the 10-column header — so taking the column back costs nothing and no reader has to handle two layouts. The sidecar is now `…;flag;ppg_n;ppg_dur_step`.

`truncated` and the step counters need no constant and stay; `oxyii.PPG_FRAME_SAMPLES` remains as documented protocol knowledge and is simply no longer used to compute anything.

Also records that followups **§1 is blocked on a capture-host deploy, not on work** — confirming §7.2 forward from the `ppg_n` column needs the box redeployed and then one night, no code and no analysis.
