<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: none
---
CPAP pairing can now be UNDONE and says what it is pairing to: `/api/cpap/pair {action:"forget"}` deletes the stored ResMed key (held under the pairing lock so it cannot race a confirm about to write one; refuses while the live stream holds the link or an exchange is open, and reports "nothing stored" as success rather than an error), and `PairingSession.status()` additionally reports the radio it pairs on, whether a key is stored and for which device, and whether that radio can be paired against at all — a Zephyr/nRF52840 reports an all-zero BD address and refuses a host-side public pin, which `capture._addressable` already guarded in the failover ladder while the pairing panel showed nothing. The monitor surfaces all of it, states plainly that the ResMed SRP key is not a BlueZ bond (one word had conflated them), and stops overclaiming elsewhere: the Overview grid is titled `Streams · N of M live` instead of "Live streams" over cards that are deliberately shown before their first frame, and the sidebar's device tile keeps its true count of BLE links but now reads `linked · N not streaming · <the daemon's own reason>` instead of the bare "connected" that made a charging Verity look like a working one.
