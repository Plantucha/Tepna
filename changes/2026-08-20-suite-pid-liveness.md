<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Verify `suite.pid` before reporting a sweep as running — a crashed or pre-reboot record read as `in flight` forever, and an unknown flag (including `--help`) launched a multi-hour fleet sweep.
