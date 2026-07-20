<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Run the night-archive copy off the event loop, so a slow or hung destination can no longer starve the capture tasks or stop the systemd watchdog heartbeat.
