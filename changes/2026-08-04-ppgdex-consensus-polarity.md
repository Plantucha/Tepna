<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---
Decide PPG channel polarity across the device instead of per channel — a lone mis-oriented LED sat ~236 ms off the vote window and joined no consensus cluster, so 3 of 18 real Verity nights ran their 3-LED vote as a silent 2-LED vote with kept3/3 = 0.
