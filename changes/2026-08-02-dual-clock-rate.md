<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md
---
Measure device clock rate directly from the two clocks already in every raw file.

Polar Sensor Logger and the capture host both write a host "Phone timestamp" and a device "sensor
timestamp [ns]" on every row. Regressing one against the other inside a fragment gives that device's
ppm offset with no beat matching, blocking, comb or unwrap — the stack that has produced four
retractions. Four nights: H10 ~-20 ppm (+-2), Verity ~-27 ppm (+-3), each stable across fragments and
across nights, so the inter-device rate is ~7 ppm = 176 ms over a night, under one RR. Beat-derived
estimates of 89-216 ppm are 13-30x too high, and since 7 ppm needs ~47 h to accumulate one RR, every
observed one-RR slip is a pairing failure rather than drift. Also identifies the O2Ring's sensor
timestamp as unusable as a clock (-1441 to +141 ppm within one night), which is the mechanism behind
every weak O2Ring leg in the closure work.
