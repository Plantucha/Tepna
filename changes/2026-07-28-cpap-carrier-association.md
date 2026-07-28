<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Confirm the CPAP Wi-Fi association from /sys/class/net carrier instead of wpa_cli, which cannot run under the service sandbox.
