---
bump: patch
type: fixed
brief: VIGIL-AUTO-UPDATE-2026-08-04-BRIEF.md
---

`tepna-update.sh` read "no device is recording" as "the box is idle" and restarted the daemon. Measured
on vigil 2026-10-11: at 12:00:45 hci2 held two LE central links while the daemon reported idle; at
12:01:06 the updater restarted it. A restart drops every link, so a wearer's night is split into two
file-sets across that seam.

A second, independent interlock now reads the KERNEL — sysfs `hciN:HANDLE` entries, no hcitool, no
D-Bus — because the interlock must not depend on the stack it protects. It can only ever refuse: it
never turns a recording box idle. An unreadable sysfs defers rather than reading as "no links", and the
quiet window is measured from when links were last seen, so a drop seconds before the timer tick still
blocks.
