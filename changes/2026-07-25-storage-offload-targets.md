<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: STORAGE-OFFLOAD-TARGETS-2026-07-25-BRIEF.md
---
Add a Storage card to the Vigil monitor that configures where finished nights are offloaded and at what time — iSCSI/NFS/NVMe-oF/SMB as verified mount targets with a generated systemd unit, rsync-over-SSH run by the daemon itself, a local-civil-time schedule, and no password field anywhere.
