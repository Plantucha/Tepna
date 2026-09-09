<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Retry the CPAP BLE connect ONCE on the same adapter when bleak's service snapshot lacks the notify
characteristic, and log what the snapshot held (#2170).

**Measured 2026-09-07 on the box:** 95 of 96 failures on the pinned CPAP adapter were
`BleakCharacteristicNotFoundError`, and every one failed over onto the RESERVED wearables radio. The
2026-09-08 `btmon` capture of one such event shows the wire **clean**: link up, ATT discovery complete
through the notify characteristic's CCCD, and then OUR host issuing `HCI_Disconnect` 1.9 s later —
the characteristic is on the air and missing only from bleak's D-Bus snapshot. Mechanism (a) of the
issue's two candidates; the adapter is not at fault.

The fix is the smallest thing the evidence licenses: the existing leak guard already closes the
failed link; when the exception is that class (matched by NAME, so the bleak-free test lanes need no
`bleak.exc`) `_cpap_ble_connect` connects once more on the SAME adapter (`retry_missing_char`,
keyword-only, last, default on). A second identical failure raises as before — one retry, never a
loop. The warning line names each service the snapshot held with its characteristic UUIDs and
handles, so the next event discriminates partial-snapshot from empty-snapshot without another
`btmon`. n=1 capture, discovery-failover class only — the shadow-poll class was not observed under
`btmon`, so whether the retry clears it on the box is the measurement this ships to take.
