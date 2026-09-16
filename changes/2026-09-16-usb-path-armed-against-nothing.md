---
bump: patch
type: fixed
brief: none
---

The last rung of the adapter recovery ladder was armed against a USB device that is not on the bus, and
nothing said so.

`watchdog.usb_path` gates `_usb_rebind` — the only thing that clears an RTL8761B firmware hang a soft
power-cycle leaves "powered but deaf". Two startup checks already guard it: one for the key being
**unset**, and one added 2026-08-05 for it being set while the daemon is **incapable** of the write.
Neither asks whether the configured bus-port **exists**.

Measured on vigil 2026-09-16: `usb_path: 1-2` in the deployed config, `/sys/bus/usb/devices/1-2`
**absent**, and the four Bluetooth radios at **1-3, 1-4, 1-5, 1-9**. So the rung could not have fired for
*any* radio on the box. That resolves the unresolved half of residue
`2026-09-11-dead-adapter-goes-unnoticed` — which recorded a radio wedged for fifteen minutes with
`org.bluez.Error.InProgress` and kernel `-110` repeating, zero of three sensors connected, and **0** reset
attempts in `journalctl` — and names why nothing fired: not a missing trigger, a rung pointed at nothing.

It is the same defect the 2026-08-05 check was added for, one cause further along. That check's own
comment states the principle — *"a configured-but-inoperable rung is worse than a disabled one: it reads
as armed"* — and a stale bus-port reads as armed identically. A bus-port is host-specific and **moves when
a dongle is replugged into another socket**, so this is not a one-time setup mistake that can be assumed
away once fixed.

The warning names the ports that **are** present, because "wrong" without "here is the right value" is a
warning nobody can act on at 3 a.m. Where the radios cannot be read either it still fires — the rung is
still dead — but says the correct value is unknown rather than implying one.

`usb_path_present is None` means the sysfs read did not happen, and is treated as *unmeasured*, not as
fine: it neither warns nor counts as present. Same honest-absence shape as `autosuspend`/`capeff` in the
same function.

The probe lives at the caller and the decision stays in the pure `defense_warnings`, matching how
`archive_dest_ready` is already handled. Four tests: the live shape, a present path, an unprobed path, and
an absent path with no readable radios. Plant-verified — removing the check reds the two discriminating
ones; the two negative controls assert silence and correctly pass either way.

⚠️ **This does not fix the box.** It makes the dead rung visible at startup. Correcting `usb_path`, or
deciding whether one static value can serve a four-adapter box at all, is a config change on vigil and an
owner decision — the same scope limit residue `2026-09-11-dead-adapter-goes-unnoticed` still carries.
