<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: none
---

Correct the adapter recovery ladder's docstring — its rungs are btusb-shaped, not RTL8761B-shaped — and state where the ladder stops reaching.

`cpap_escalation_gate` described "the rungs that actually fix an RTL8761B-class wedge". That part left
the box on 2026-09-07 20:08:27 (`usb 1-2` UB500 disconnect; zero `RTL:` lines Sep 8 to Sep 18 in journal
boot -1), and the rungs were never RTL-specific: soft power off/on, `hciconfig reset`, `_usb_rebind` and
a VBUS cut all act on a device bound to btusb. Corrected in three places, including the same
generalisation in `test_bluez_wedge_wire.py`.

The added paragraph states the limit where a reader meets it: a cdc_acm Zephyr board is not a btusb
device, so `Can't init device: Connection timed out (110)` there is a hung transport rather than a rung
that failed, and such a board is recovered by its own systemd unit. `uhubctl` is recorded as a hardware
precondition (all four radios sit on the xHCI root hub, which exposes no per-port power switching), not
as pending work.

Part-specific RTL8761B references (udev rules, autosuspend, README, `tepna-btreset.sh`) are deliberately
untouched — they remain true of that part.

Also opens one residue row, `2026-09-18-format-leg-scopes-pre-existing-debt`, against
`capture-host/check.sh`: the advisory format leg attributes a file's pre-existing formatting debt to any
diff that touches it, and flips on commit state. No behaviour change anywhere.