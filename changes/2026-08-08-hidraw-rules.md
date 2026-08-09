<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: none
---
Own the hidraw rules: adopt the Polar one, add the O2Ring-S, and notice the file left behind.

The Wellue O2Ring-S is docked on the box's USB and exposes a raw-HID pipe — `1-5`, `1915:f33c`,
interface class 03, a 33-byte report descriptor and one 64-byte interrupt-IN endpoint (a vendor
transport wearing HID clothing; writes go out as SET_REPORT control transfers). `/dev/hidraw*` is
created root:root 0600 and capture.py runs unprivileged, so every open is EACCES — measured:
`PermissionError [Errno 13]` as `vigil`.

⚠️ It enumerates under **Nordic's** vendor id (`0x1915`), not Viatom's. The ring ADVERTISES as Viatom
(`0x036F`) and OxyII (`0xF34E`) over BLE, so a USB scan filtered on the vendor ids you know from the
radio walks straight past it — which is exactly what happened on the first pass here.

The Polar half is an **adoption, not a new rule**. It was already on the box, hand-installed as
`/etc/udev/rules.d/99-polar-hidraw.rules`, in no repo and on no manifest — invisible to
`check-system-files.sh`, whose entire purpose is "is what /etc is running what the repo says". A rebuild
would have dropped it silently and the Polar USB pull would have started failing with a permission error
nobody would connect to a missing file. Same rot the btdongle rule already suffered once. It is carried
over byte-identical, `GROUP="vigil"` included: adopting a working file must not quietly change its
semantics, the same discipline `deploy/tepna-capture.service` followed when it absorbed its duplicate.

Adopting under a new name creates a new problem, so the gate learned to see it. `SUPERSEDED` reports an
/etc file that a managed file has replaced — here `99-polar-hidraw.rules`, which would otherwise sit
there loading the same udev rule a second time, harmless until the two copies disagree and filename sort
order picks the winner. That is `ambiguous()`'s problem pointed at /etc instead of the repo. It is
**reported and counted as drift, never deleted**: everything `--install` writes is recoverable from the
repo and an `rm` is not, and the script cannot know why an operator put a file there. It also stays
silent until the replacement is actually installed — advising `rm` before then would talk someone into
deleting the only working copy and installing nothing.

Verified against the live device rather than by inspection: `udevadm info -a -n /dev/hidraw0` shows
`SUBSYSTEM=="hidraw"` on the node and `ATTRS{idVendor}=="1915"`, `ATTRS{idProduct}=="f33c"` on the `1-5`
parent. Note the HID node in that same path is spelled `0003:1915:F33C.0001` — UPPERCASE — while the
attribute udev matches is lowercase; copy the case from the path and the rule loads clean and never
fires. There is a test for exactly that.

Five mutants re-applied, each killed by the intended test: the ordering precondition dropped, superseded
no longer counted as drift, `--install` deleting the old file, the O2Ring PID uppercased, and the adopted
Polar rule's GROUP silently changed. (The first attempt at two of those broke the script syntactically —
re-applied cleanly, because a mutant killed by a syntax error proves nothing about the assertion.)

This unblocks reading the ring over USB; it does not implement it. Whether OxyII frames ride the HID
transport is untested — `oxyii.py` is already a transport-agnostic codec of exactly that envelope, but no
byte has been put on this pipe.
