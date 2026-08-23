<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [docs]
brief: CPAP-ACQ-P4-SPOOL-TRANSACTION-2026-08-23-BRIEF.md
---
P4 design brief for the CPAP hardening audit — the transactional BLE spool chain, recovery model hardware-fixed by a live AirSense-11 run (fromDateTime cursor, round = transaction unit, discard-and-re-pull on drop), mapped onto the P2 lifecycle with an append-only JSONL cursor ledger, the WiFi path's .part→content-addressed atomic promote, and five planted chaos controls.
