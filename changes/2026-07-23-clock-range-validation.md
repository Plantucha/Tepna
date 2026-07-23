<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [GlucoDex, PpgDex, CPAPDex]
brief: none
---
Node-local Clock parsers now reject out-of-range components (§2.7) instead of silently rolling — GlucoDex `_ckParse`, PpgDex `parseTimestamp`, CPAPDex `parseTimestamp` + `parseEdfClock` each route regex-captured components through an `_ckMk`-style round-trip validator, so a corrupt stamp (month 13, day 45, Feb 30, Apr 31, 25:99) returns an honest null rather than a plausible wrong instant; the ISO `24:00:00` end-of-day exception is preserved.
