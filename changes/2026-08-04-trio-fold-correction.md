<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md
---

Correct the same-day trio-fold note. It said the overlap with the existing corpus was "not established";
established now, and the answer is the unflattering one.

`uploads/trio/` is TRACKED and holds exactly those 25 nights — 75 committed exports, 2026-06-10 …
2026-07-13, the identical set. The fold re-derived the committed corpus. That is a useful reproduction
check and it is not an increase in N, which is how the previous note read.

The conclusion survives for a better reason. This brief blocks the paper on N = 10 → 15, and the
committed corpus is already 25 post-host-axis nights that `tch-multinight` confirms as a single
producing-code version. The re-fit was never data-blocked; it can run today on committed data.

The 15 further nights in the working tree (2026-07-16 … 07-30) look like they would take N to 40. Running
the hat over all 40 returns CONFOUNDED: the cohorts are post-host-axis 25 and pre-host-axis 15, and each
occupies its own date range, so code version and date are the same variable and no date-based subset
recovers a clean comparison. The tool's instruction is explicit — regenerate, do not subset.

Regenerating is possible but not cheap: the raw capture for 2026-07-25 … 08-04 (11 nights, 5 entirely
new) is on the vigil box, `node` is absent there, and the link measures ~2 MB/s, so pulling the ~5.5 GB
of trio-relevant streams is about 40 minutes. Worth doing to push N past 25, but an enhancement rather
than a blocker, and recorded as such so it is not mistaken for one again.
