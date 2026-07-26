<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Resolve a pinned adapter through BlueZ over D-Bus when sysfs and `hcitool dev` cannot see it. Both read a controller's PUBLIC address, and an LE-only controller is entitled not to have one: a Raytac MDBT50Q on Zephyr USB HCI reports 00:00:00:00:00:00 to both while BlueZ has given it the static-random identity it actually bonds with. Without this the pin resolved to None, capture logged "falling back to the BlueZ default" and dropped it — and on 2026-07-26 that default was the same untested controller, so the pin would have failed OPEN onto a different radio. D-Bus is consulted only when the cheap sources did not already answer, so the common case still costs one subprocess.
