---
bump: patch
type: fixed
brief: SIGNAL-QUALITY-TABLE-2026-11-14-BRIEF.md
---

Read the ECGDex night drift rate off `driftProfile.night.ppm`. The producer publishes `night` as an object, and the render read it as a number. The panel threw on every capture-host night. That throw stopped `renderAll` at the quality section, so no later section rendered. The label now gives the anchor count, the span and the uncertainty beside the rate.
