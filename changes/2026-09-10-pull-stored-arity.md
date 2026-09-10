<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Fix the monitor's "Pull stored session" button, which raised TypeError on every request and returned 500.
