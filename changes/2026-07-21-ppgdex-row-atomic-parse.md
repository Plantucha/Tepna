<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---
Validate every optical column a PPG layout claims to carry and drop the row atomically — a junk ch1/ch2/ambient cell beside a good ch0 previously admitted NaN into the channel arrays and silently degraded the 3-LED vote to a fabricated `ledAgreementPct: 67`.
