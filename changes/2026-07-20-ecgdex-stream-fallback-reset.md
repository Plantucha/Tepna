<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
The streaming ECG parse worker's catch-fallback now resets its accumulator before re-reading. A
mid-stream read failure left everything already parsed in the buffer, and the fallback — which
re-reads every part from byte zero — appended a second copy of that prefix. The record grew by the
duplicated span, every sample after the seam sat at the wrong index, and fs/gaps were derived
across a discontinuity that never existed in the recording. Reproduced against the previous code:
a failure on part 2 of 3 yielded 1637 samples for a 1200-sample recording.
