<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Give the hotplug path a vendor-independent catch-all. The udev rule matched a vendor allowlist, so a Raytac MDBT50Q plugged into a running box came up with autosuspend live while every other adapter was armed — an allowlist is always one dongle behind, and the boot-time unit is a oneshot that does not re-fire on hotplug. The catch-all matches the USB Bluetooth class triple on the INTERFACE (the Raytac reports 00/00/00 at device level, so a device-level match would miss exactly the dongle it exists to catch) and delegates to the already-tested arming script rather than reimplementing the parent-walk in udev syntax. Verified with `udevadm verify`.
