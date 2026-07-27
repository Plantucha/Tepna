<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
One observer now owns the desaturation spine, so a second oximeter watching the same night can no longer inflate the pool. The dedupe key was `impulse@round(tMs/1000)`, which only ever collapses stamps landing in the same second — two devices run two clocks and never round together, so a redundant observer doubled `total.desat` and halved the surfaced `Desat match rate` KPI (60/60 rendered as 60/120 = 50%). Coverage-first choice with a node-ladder tie-break, both events and the AHI denominator taken from the chosen observer; the others are reported in a new additive `desatObserver.alsoObservedBy` rather than silently dropped. A merge on the only available tolerance (`dtMs`, 120 s) was rejected: apneas recur every 20–60 s in severe OSA, so it would have collapsed genuinely distinct events.
