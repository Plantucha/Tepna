<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Probe for a writable wpa control directory instead of assuming one — the daemon runs under ProtectSystem=strict, where both /run and /tmp are read-only.
