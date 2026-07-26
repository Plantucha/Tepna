<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
---
trio-batch decides "is this window a night" on clock time, not duration alone: more than half the three-way overlap must fall inside `--night-band` (default 21:00–09:00 floating wall clock), and cluster selection now ranks by nocturnal span rather than length. An awake 2026-07-26 14:33→18:15 afternoon block had cleared the old `--min-hours 3` test with all three sensors worn and entered the sigma corpus as a night, posting its worst row (PpgDex 8.31, OxyDex 5.16 bpm) and dragging the corpus median 4.24→6.21; `--keep-daytime` folds such a block deliberately, and `--selftest` pins the gate with known answers.
