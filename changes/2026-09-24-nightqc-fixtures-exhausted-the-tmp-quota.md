<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The 2026-09-23 QC fixtures wrote six million rows to carry a geometry that does not depend on the
sample rate, retaining 2.0 GB of `tmp_path` per nightqc run; 37 retained directories exhausted the
rig's shared /tmp quota and every fleet session's gates began failing with EDQUOT. Holding the spans
and dropping the fixture rate to 2 Hz leaves every asserted value identical, and
`tmp_path_retention_policy = "failed"` means a passing run keeps nothing: 2,097,737,728 → 0 bytes.
