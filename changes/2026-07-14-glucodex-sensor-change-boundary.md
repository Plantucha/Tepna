<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [GlucoDex]
brief: DEEP-AUDIT-2026-07-14-BRIEF.md
---
GlucoDex: make `detectSessions` able to see a sensor change at all (DEEP-AUDIT-2026-07-14 §4, the same root as §1). The boundary scan tested `FLAG.GAP`, which it can never see over a sensor-change hole — the short-gap branch requires *both* neighbour gaps under `gapThresh` (≈12.5 min at 5-min cadence), so every interior cell of a ≥90-min hole is `FLAG.GAP_LONG`, and a run of short-gap cells can never reach 90 min by construction. So the boundary was unreachable: `nSessions` was **always 1**, the per-session drift fit ran **across mixed sensor wears**, and `levelSessions` (which aligns each wear's median) was a silent no-op. The fit also masked only WARMUP/COMPRESSION, so the drawn `GAP_LONG` line fed its slope, mean and median — the residue `9bdb9be` explicitly left to §4; it now routes through the same `_ana` predicate as every other distribution consumer. Gated on the committed 14 h-gap twin: 3 days now split into 2 wears (inter-session gap 840 min) and the fit runs on 697 measured cells, not 864. **Export-inert — verified, not asserted:** all three GlucoDex fixtures (including the real Lingo night, which carries an actual long gap) are byte-identical, because sessions are not in the export and the level/de-drift corrections are off by default.
