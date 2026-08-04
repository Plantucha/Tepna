<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex, suite]
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---
Answer deep-dive experiment E-1 — foot-domain consensus does NOT recover the 1-of-3 drop rate (+13.04 pp for +0.00 pp PPV over 18 Verity nights) — and surface the defect the run found instead: on 3 of 18 nights one LED's peaks sit a fixed ~236 ms off, so it joins no consensus cluster and the 3-LED vote silently runs as 2-LED.
