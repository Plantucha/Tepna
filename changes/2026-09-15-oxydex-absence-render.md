<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: RESIDUE.md
---

The remaining eight OxyDex self-ingest scalars coerced absence to a number, `maxSpo2 || 100` worst
among them: 100 is in-range and flattering, so a night nobody measured reported a perfect one and no
downstream plausibility guard could catch it. All eight now take the `!= null` form. The render was
fixed in the same change rather than left to follow — JS coerces null to 0, so passing null to the
old consumers was silently wrong in both directions: `null >= 90` is false so Min SpO2 read "bad",
while `null < 5` is true so T95, T90, Mean HR and Max HR all read "good". Three further sites on
`meanSpo2` and `durationMin` were already live from the earlier half of this fix and are closed here.
