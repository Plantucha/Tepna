<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md
---
Vigil §4 BLE robustness — stronger adapter recovery + passive O2Ring scan (out-of-suite capture-host/).
The adapter watchdog's soft `power off/on` cannot clear an RTL8761B FIRMWARE hang (the radio returns
"powered but deaf"), so the recovery ladder now escalates: after the soft power-cycle it `hciconfig <hci>
reset`s the controller (config `watchdog.hci_reset`, default on), and on the LAST cycle before give-up it
re-enumerates the USB dongle by unbind+bind (config `watchdog.usb_path` = the bus-port from
/sys/bus/usb/devices/, OFF by default) — the only thing that clears a firmware hang. Both bounded and
never-raising (graceful on a dev box without the caps). Separately, the O2Ring reconnect scan now uses
PASSIVE scanning (listen, don't transmit scan requests) so the churniest device's frequent 15 s scan
window stops stealing air-time from the live H10/Verity links on the shared radio. 4 new pytest cases;
928+ passing.
