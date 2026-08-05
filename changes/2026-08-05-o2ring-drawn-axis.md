<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex, Integrator]
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---
Since 2026-07-27 every O2Ring night certified itself `timingSource:'device+host'` — the top provenance tier, asserting a real second clock — for a `sensor_ns` column capture.py accumulates entirely from host arrival times. The rate-slew estimator added that day stopped the synthesised column being a singleton delta set, so `quantizedShare` fell 1.0 → 0.00083 and the drawn-axis detector went blind: the axis became MORE synthetic and the fingerprint disappeared. The verdict now keys on the layout, which is the provenance fact, rather than on a signature the writer can erase.
