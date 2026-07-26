<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Make the privileged clock helper detect chrony vs systemd-timesyncd — on a chrony box (Ubuntu Server, RHEL) it wrote a timesyncd drop-in chrony never reads and restarted a unit that does not exist, so the monitor reported the NTP servers saved while the clock kept using whatever it had.
