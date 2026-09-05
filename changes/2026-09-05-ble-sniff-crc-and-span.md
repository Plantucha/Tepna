<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-BLUETOOTH-ADAPTERS-2026-09-05-BRIEF.md
---
ble_sniff.py reads the nRF CRC flag — CRC-bad records (14 % of the real overnight capture; they inflated 12 CONNECT_INDs to 262) are excluded from every counter and the exclusion is stated even at zero — and the report opens with the first→last packet span in UTC, which is what would have exposed the capture that died 2 h into a 7.4 h window.
