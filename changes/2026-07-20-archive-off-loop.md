<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Run the night-archive copy, the QC newline scan and the retention rmtree off the event loop, so slow storage can no longer starve the capture tasks or stop the systemd watchdog heartbeat.
