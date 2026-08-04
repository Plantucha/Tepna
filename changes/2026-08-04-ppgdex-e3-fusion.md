<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex, suite]
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---
Close deep-dive experiment E-3 — re-scored on PPI jitter with the shipped detector, waveform fusion is a wash on sleep nights (+0.03 ms) and its apparent 0.94 ms all-nights win is entirely daytime, so §3.1's refutation stands; PCA-1's weights are 1/sqrt(3) on every night, so it rediscovers the mean rather than channel selection.
