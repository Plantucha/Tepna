<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [HRVDex, OxyDex, PpgDex, PulseDex, suite]
brief: none
---

An event the node cannot place in time now sorts last in every review timeline, instead of leading it as 1970-01-01.

The clock module gains `eventSortKeyMs` and `sortEventsByClock`, promoted from the GlucoDex pair that shipped first. Six call sites in four nodes read them. Each one keyed its sort on `(a.tMs || 0)`. The Clock Contract §6 admits an export whose events carry `t` alone, so an absent stamp read as a number. The one event the view could not place then came first.

The descending HRVDex table read that row as the oldest measurement in the export. GlucoDex keeps its node-local copy, because the GlucoDex bundle inlines no clock module by design.
