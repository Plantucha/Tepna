<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: CPAP-ACQ-P4-SPOOL-TRANSACTION-2026-08-23-BRIEF.md
---
P4 executed: cpap_spool.py — the transactional stored-spool chain (round-as-transaction over the injected protocol core, .part -> content-addressed atomic promote, append-only byte-stable cursor ledger as the co-signed consumer read index, verbatim device-time cursors, C1-C5 planted controls, FailureClass reuse, the between-rounds hypothesis behind one revalidate seam). 35 tests, 100% statement+branch, mutation gate EXIT=0 with 3 probe-backed equivalents; two real defects found and fixed by the killers (foreign-ledger-row restart crash, mid-file garbage break).
