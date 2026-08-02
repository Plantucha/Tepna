<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md
---
`dual-clock-rate.mjs` selected fragments by **file size**, which is not a proxy for the thing a ppm slope needs — **time leverage**. A high-rate ECG fragment can exceed 3 MB while spanning eleven minutes.

Found while verifying the direct two-clock measurement rather than accepting it. Running the tool's own code on 2026-07-27: the **373-minute** H10 fragment gives **−20.3 ppm**, the **10.9-minute** one gives **−65.8**. Both pass the 3 MB filter; only one is a rate.

The tool already computed `spanMin` and didn't gate on it. Short fragments are now **marked, not dropped** — silently removing them would hide how few long fragments a night actually has — and excluded from a new per-device summary:

```
            fragments ≥60 min   median ppm   spread
  H10                 1        -20.3      0.0
  O2RING              2         -3.4    642.0   ← not a disciplined clock
  VERITY              2        -26.0      1.6
```

That spread **is** the honest error bar, and it separates a disciplined crystal from a counter that isn't one automatically, rather than by reading a column. It also states the brief's headline in one line: Verity holds 1.6 ppm across a night, the O2Ring moves 642.

Inter-device rate from long fragments alone: **5.7 ppm**, consistent with the brief's ~7.
