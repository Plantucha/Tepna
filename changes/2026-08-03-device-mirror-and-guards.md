<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: POLAR-PMD-COMMAND-SURFACE-2026-08-02-BRIEF.md
---
Mirror the device once; stop paying for the same question twice.

`polar_mirror.py` walks the Polar PS-FTP filesystem from `/`, pulls every file to disk with a manifest,
and is resumable. It exists because a day was spent doing exploratory round trips over a BLE link that
fails every few minutes — list a directory, think, list another, lose the session, start again. The link
is the scarce unreliable resource; the analysis is free. One pass took **43 files across 37 directories,
42 pulled**, and every question since has been answered locally.

**`Trusted: no` breaks PS-FTP, and the error does not say so.** `PolarPsFtp.__aenter__` fails at
`start_notify(MTU_CHAR)` with GATT `UNLIKELY_ERROR (0x0E)` — the same code an un-bonded read gives — but
`bluetoothctl info` reported **Paired: yes, Bonded: yes**. The missing property was TRUST. One
`bluetoothctl trust` and every listing worked. Bonded-but-untrusted is indistinguishable from unbonded
at the ATT layer, so the mirror checks and repairs it first.

**That corrects a conclusion published earlier the same day.** Five system files (`SYSLOG`, `ERRORLOG`,
`SYNCINFO`, `USENSET`, `USERID`) were retrieved over USB after BLE "silently ignored" them, and that was
written up as USB having a different access level. It does not: **BLE serves all of them once trusted.**
The USB route worked but was never necessary.

⚠️ **A mirror of this device is highly sensitive, in two ways that are not obvious:**

* `/U/0/USERID.BPB` carries the owner's **real name** and Polar account UUID.
* `/SYS/BT/<n>/BTDEV.BPB` is the **bonding table** — one directory per paired host, each holding that
  peer's address and a **128-bit key**. So anything reaching PS-FTP can read the pairing secrets for
  *every* host the device is bonded to, not just its own. Slot 0 held a second host's MAC and key.

`--redact` blanks both, output defaults to the gitignored capture root, and none of it is committed. The
export pipeline scrubs serials via `dexScrubExport`; device files have no such pipeline, so the care has
to live here.

Also adds `link_guard.require_free_link()` — one import that refuses to start while
`tepna-capture.service` holds the device's single BLE link. That precondition cost **five runs** in one
session, including two where a probe had already started a recording and could not deliver its stop,
because every failure downstream reports BlueZ's state rather than the cause.

**And it corrects a false claim in committed code.** `probe_verity_survey.py` asserted that this device
ACCEPTS PMD starts while docked, "contradicting the documented behaviour". That came from one
observation on a wall charger at 3–12 % battery. Measured again on USB at 100 %, a PPG start is refused
with `0x0D in_charger` exactly as documented. One observation each way, two variables not held fixed
(wall charger vs USB host, charge level) — so the comment now records both and concludes neither.

capture-host only, out of suite — no bundle, no `manifestHash` movement, no fixture re-recorded.
