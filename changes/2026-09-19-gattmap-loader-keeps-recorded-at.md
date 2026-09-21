<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`gattmap.configure()` dropped `recorded_at` on reload — the provenance stamp #2611 added lived only
until the next deploy plus one new unit.

Measured on vigil 2026-09-19 00:22: the O2Ring's first sighting flushed the map and the Verity's
16:35 stamp read `None`, with its 21-characteristic table byte-identical. The loader rebuilt every
record from three named keys (`db_hash`, `chars`, `source`); `_flush` then wrote the stripped map
back for every unit. The daemon restarts on every deploy, so the field was structurally short-lived.

The stamp now rides through a reload when it is an integer; a record written before the field existed
reloads without one — an absent stamp stays absent, never fabricated from the reload clock (§∅).
Two tests: the exact losing sequence (restart, then a `new` for a different address), which fails on
the old loader; and the pre-#2611 shape reloading stamp-less, read off the file after a real flush
because `snapshot()` does not carry the field.
