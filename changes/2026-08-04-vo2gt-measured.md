<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: changed
nodes: [PulseDex]
brief: AUDIT-FOLLOWUPS-BRIEF.md
---

Reclassify PulseDex's `VO₂ GT` from a `_META_DENY` key to a real `PULSE_REGISTRY` metric at
`evidence: 'measured'` (owner decision, §5.3).

It was grouped with `date` / `source` / `duration` as recording context because the user types it in.
But entered-ness is not a tier — provenance is. `VO₂ GT` is a real laboratory VO₂max and the only
directly measured value in that table: the two estimates beside it (`vo2`, `vo2base`) are `heuristic`
population proxies, and this is the CPET number they are proxies for. Denying it left the single
most-evidenced number in the table as the only unbadged one, next to two badged guesses at it.
`measured` is honest precisely because PulseDex does not compute it.

Shipped: both deny keys removed (with a do-not-re-add note), a cited `vo2gt` entry added, and the two
label aliases. Verified by execution — the 68-row scan now reports 64 badged / 4 unbadged, and the 4
are `DateTime`, `Recording`, `Duration` and the section separator.

`manifestHash 954546478f4d → b194b9db26fb`. `computeHash` also moved (`bb8ff7dd1faf → 6ecbd5da2dc2`)
because the registry is inside the compute closure, so re-verification was owed and performed rather
than asserted: `DEX_UPLOADS=… tools/verify-fixtures.mjs` re-ran the real corpus green and re-stamped
the two corpus-backed fixtures. The suite passing is what proves the export bytes did not move.
