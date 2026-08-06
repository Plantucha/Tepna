<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md
---
The watchdog's last recovery rung could never have run, and said so only at INFO.

`_usb_rebind` is the rung VIGIL-DEEP-ANALYSIS §2D identifies as the ONLY thing that clears an RTL8761B
firmware hang — the fault that cost ~110 minutes of a real night on 2026-07-23. It wrote
`/sys/bus/usb/drivers/usb/{unbind,bind}` itself. Measured on the live box 2026-08-05: those files are
`--w------- root root`, capture runs as `vigil` with `CapEff: 0000000000001000` (CAP_NET_ADMIN alone, no
CAP_DAC_OVERRIDE). Every write raised `PermissionError`, was caught, and was logged at INFO as "skipped".

The rung was not merely unprivileged, it was invisible. `watchdog.usb_path` was SET on the box (`1-2`,
genuinely the UB500) — and the only warning on that path fires on ABSENCE, so setting the key silenced
the sole check while the rung stayed inoperable. A configured-but-incapable rung reads as armed.

The 2026-08-04 diagnosis that this was "blocked on a deploy, not on code" was wrong twice over:
`tepna-usbreset.sh` is a Polar-**dock** re-enumerator hard-allowlisted to `0da4:0008`, whose own header
names "the very BLE adapters the capture depends on" as what it must never reach. Installing it moved
this rung not at all.

Adds `tepna-btreset.sh` — the exact mirror: allowlisted by USB device **class** `e0:01:01`, so it may
touch only Bluetooth radios, never a hub (`09`) or the boot disk (`08`). A class check rather than a
VID:PID list because this box has already been through one adapter swap, and a list that must be
maintained as root to stay safe eventually is not. `_usb_rebind` tries the direct write first (a box with
the capability pays no subprocess) then falls back to `sudo -n`, matching the clock/RSSI/radio-restart
rungs. A failed rebind now logs at WARNING. `usb_rebind_available()` feeds a new `defense_warnings`
branch so a set-but-incapable `usb_path` says so at boot, naming the fix.

Also deletes the duplicate `systemd/tepna-capture.service`. `check-system-files.sh`'s `ambiguous()` check
was correct and the repo was wrong: two different files named `tepna-capture.service` (the `User=tepna`
copy installed by nobody, and the `User=vigil` copy `install-services.sh` actually installs) held the
gate at exit 1 on every run on the live box, with all nine rows reading ✓. A gate whose red cannot be
cleared by any action stops being read. Unique documentation merged into the surviving deploy/ copy.
