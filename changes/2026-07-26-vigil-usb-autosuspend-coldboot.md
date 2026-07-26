<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Arm USB autosuspend-off from a systemd unit ordered after udev-settle, because a udev rule cannot win a race it is not in: on the 2026-07-26 reboot the BLE adapters enumerated at 13:55:34 and systemd-udevd only started at 13:55:38, so the kernel's `usbcore.autosuspend=2` default stood and the dongle came up exposed to the RTL8761B firmware-wedge that cost ~110 minutes on 2026-07-23. `udevadm test` confirmed the rule matched and would have set `on` — every static check passed while the live value was wrong. The unit also matches on the USB Bluetooth class triple rather than a vendor allowlist, which is why a newly added Raytac MDBT50Q (idVendor 2fe3) was covered by neither existing clause.
