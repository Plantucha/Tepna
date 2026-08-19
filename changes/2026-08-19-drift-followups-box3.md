---
bump: patch
type: fixed
brief: CROSS-DEVICE-DRIFT-FOLLOWUPS-2026-08-17-BRIEF.md
---

**One open box closed on evidence: `WEARABLE-DRIFT-DIRECT` was already flipped.**

`CROSS-DEVICE-DRIFT-FOLLOWUPS` §Done-when asked that *"`WEARABLE-DRIFT-DIRECT`'s header be re-verified
against its Done-when list and flipped, or its gaps recorded."* It reads **`Status: DONE — 2026-08-17`**
already, with every Done-when item `[x]`; its single `[~]` is a **retraction note**, not open work.

**Spot-checked against the tree rather than taken on the header's word**, because a status line is
precisely what this repo keeps finding stale:

| claim | verified |
|---|---|
| *"shipped as a tool, not left in a scratch script"* | `tools/dual-clock-rate.mjs`, 13 584 B ✓ |
| *"refuses when there is no second clock"* | `independent` / `spreadMs` guards present ✓ |
| paper's scope-note retraction applied | `papers/wearable-clock-drift.html` ✓ |

⚠️ **The last one nearly went down as a defect.** A case-sensitive grep for `Corrections` returned **0**
while `90–216` still appeared **4 times** — which reads as *"the retraction never landed."* It had:
case-insensitively the paper carries 23 correction mentions, and every `90–216` occurrence is
**retraction context** — *"contradicted by a direct measurement"*, *"it is retracted as a statement about
the device"*, *"≈7 ppm, not 90–216"*. **The figure is present because it is being retracted.** Presence
of a retracted number is not evidence the retraction is missing; read the context, and check the case.

The brief stays **PROPOSED** — its other three boxes are open and two need code changes
(`hostAxis.stability` additions, a shared crystal-rule implementation) that would force a re-bundle,
which is not safe while the volume is degraded.
