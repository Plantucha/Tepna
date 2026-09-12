---
bump: patch
type: added
brief: residue 2026-09-12-sysfs-hci-address-attr-gone
---

A systemd template unit that attaches a Zephyr HCI-UART controller and re-issues its BD address,
because the address does not survive power loss: the `0xFC06` vendor write is runtime-only, and all
three dongles came back `00:00:00:00:00:00` after a power cycle.

That matters more than a cosmetic identifier, which is why it is a unit rather than an ExecStart
line. `capture._addressable()` refuses an all-zero address, so an attached-but-unwritten dongle is
not a radio that works badly — it is one that never joins the failover ladder, with nothing logged,
because "no usable address" and "not present" are indistinguishable downstream.

Instances are named by USB serial rather than `ttyACMn` (the indices renumber on every replug), the
address map is deployment config on the box rather than hardware inventory in the repo, and an
unmapped serial fails closed instead of attaching an unidentifiable radio.
