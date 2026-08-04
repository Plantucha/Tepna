<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: CPAP-AUTOHARVEST-FOLLOWUPS-2026-07-28-BRIEF.md
---
`CPAP-AUTOHARVEST-FOLLOWUPS` §2.1 still reads as a live opportunity — it is a refuted one.

The section proposes the CPAP's `SA2.edf` as *"a second, wired, drop-free SpO₂ source over the identical interval"* and a gap-filler for the 17 % of nights the O2Ring spends below −85 dBm. `CPAP-SA2-OXIMETRY-SOURCE-2026-08-01` executed it and **refuted the premise**, but the parent section was left carrying its "✅ ROUTED … the measurement both confirms it" table. A reader landing on §2.1 sees a confirmed-looking coverage table and only learns otherwise by following the link — which is how a dead lead gets rebuilt.

Re-confirmed 2026-08-04 on the live box, an order of magnitude wider than the original sweep: all **254** `SA2.edf` under `/srv/tepna/captures/cpap/DATALOG` (204 distinct nights, 2026-01-11 → 08-03) carry **5,036,280 samples of `SpO2.1s` and 5,036,280 of `Pulse.1s` at 100.00 % `−1`** — both channels, zero plausible values. Headers are immaculate throughout: correct labels, `%`/`bpm` units, gain exactly 1.0, full-length records. The ResMed writes the file every therapy night whether or not the optional oximeter is attached.

⚠️ Deliberately **not** claimed as "empty always": the earlier sweep's one good night (`20260613_231433_SA2.edf`, 2.50 h of real data) is **not on the box** — its DATALOG is a different file set, holding 2026-06-13 only as `_201036`. The scope of this measurement is "everything the box currently holds", and saying more would repeat the generalisation being corrected.

The section is annotated rather than deleted: it is a clean worked example of a corpus claim built from headers instead of values.
