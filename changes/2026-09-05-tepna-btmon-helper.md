<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT-2026-09-05-BRIEF.md
---
`tepna-btmon.sh` — a bounded, argument-validated, read-only HCI capture helper (audit §D2), because the O2Ring restart storm is not decidable from the daemon journal: the ring's restart and the RTC write it triggers are logged at the same instant, so cause and consequence emit identical lines and only the on-the-wire ordering separates them. Needs `CAP_NET_RAW` (verified refused unprivileged), so it follows the `tepna-rssi.sh` pattern — root-owned install plus one sudoers line — and is inert until an owner installs it.
