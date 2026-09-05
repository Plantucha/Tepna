<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT-2026-09-05-BRIEF.md
---
bond() never sets `trust` (the old set-then-revoke window leaked the flag permanently on session death — measured: both Polars `Trusted: yes` on the capture adapter months after the untrust shipped), and a startup tripwire (`bonding.trusted_flags` → `defense_warnings`) now names any configured sensor left Trusted on the capture adapter, so the §B2 kernel-vs-daemon ACL race can never sit silent again.
