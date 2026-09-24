<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The ring's `ppg2w_contact` epochs on one second of clock, taken from each row's own stamp, instead of a
fixed 100 rows. The stream has run at ~199 rows/s since 2026-08-23, so `doff_at` (computed from the
epoch count) was hours late: 2026-09-22 read 09:59:38 against the SpO2 file's last row at 04:22:34, and
now reads 04:22:38. The same pass holds the channels as machine ints: peak memory on that night drops
from 515 MB to 300 MB. `loss_audit.wear_ends` gains the ring, one end per SpO2 file. `doff` needs the
PPG2W off-finger tail AND the SpO2 stream stopping where it began. Two tails with the finger in (ratio
drifting over the band while SpO2 read 98–100 %) are published as `ppg2w_contradicted` and not called
a doff.
