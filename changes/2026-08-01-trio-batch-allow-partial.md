<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: []
brief: POOLED-CLOCK-FIT-FOLLOWUPS-2026-07-31-BRIEF.md
---
`trio-batch` refused any night without all three of ECG+PPG+SpO2 (`have.length < 3`, hard-coded). That is a **fusion** precondition — `tch-multinight` needs a genuine three-way overlap — and the **clock fit needs no such thing**: it consumes CPAP anchors plus whatever wearable channels exist, and each node's export is full-length however little the three coincide.

**It is 42 nights, not the 4 the brief estimated** — more than the 36-night corpus itself — and every one has CPAP data (39 SpO2-only, 2 ECG+SpO2). No existing flag reached it: on unmodified `main`, `--only-node OxyDex --min-overlap 0 --min-hours 0 --keep-daytime` still drops them.

`--allow-partial`, **default OFF** so every existing analysis is byte-unchanged. Three things had to change together, and the last two would otherwise have made it a hollow flag:

1. the gate becomes conditional;
2. the sleep window intersects **the legs that exist** with the anchor — byte-identical when both are present, degrading instead of emptying when one is not;
3. `printClockFit` was gated on a full trio, so **the fit never ran on the nights the flag admits**.

Two more defects surfaced only by running it: the flag was parsed by the parent and never forwarded to the child (the source carries a warning about that exact boundary — now gated for the whole night-selection flag set), and absent nodes were *attempted*, throwing `Cannot read properties of null` 80 times across the corpus.

**Payoff, measured:** all 41 foldable partial nights produce a clock fit and **16** clear their own null; the rest are flagged `⚠ indistinguishable from this night's own null`. Roughly doubles the reachable clock-fit corpus without pretending it adds 41 confident offsets.
