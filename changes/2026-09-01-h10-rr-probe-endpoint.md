<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: POLAR-ONBOARD-BACKUP-FOLLOWUPS-2026-08-11-BRIEF.md
---
Add the H10 onboard-recording control surface — PS-FTP REQUEST_START/STOP/RECORDING_STATUS behind a second deliberate allowlist (firmware-update id unreachable from every path) plus `POST /api/polar/recording` through the daemon's connect-lock wrapper, with a status readback after every write — making the §6 Q1 RR-acceptance probe runnable against the live daemon.
