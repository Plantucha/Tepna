---
bump: minor
type: added
brief: CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05-BRIEF.md
---

`capture-host` gains `_adapter_responds` — an HCI command ROUND TRIP, closing §7's third item ("post-recovery
verification for a radio"). `_adapter_is_up` reads the kernel's cached flags and asks the controller nothing,
so a wedged radio still reads UP RUNNING; measured on vigil 2026-09-11, that flag suppressed the InProgress
wedge inference for ~19 minutes (wedge 19:23:12, first sign 19:42:06). The probe shells `hciconfig <hci>
version`, which issues HCI_Read_Local_Version_Information — measured 2026-09-18 to increment the adapter's TX
`commands:` counter by 1 where a plain state read increments it by 0, and it works unprivileged on all four of
the box's radios. A TIMEOUT maps to False deliberately (a wedged controller not replying IS the signal);
every other failure is None, so a probe that cannot run never convicts a healthy radio. In
`classify_adapter_health` the verdict is asymmetric on purpose: False BREAKS the `adapter_up is True`
suppression and is wedge evidence on its own, while True grants no new suppression — a radio can answer HCI
and still carry no link, so the change can only ever make the watchdog see more. `adapter_responds=None`
reproduces every pre-existing caller's verdict exactly.
