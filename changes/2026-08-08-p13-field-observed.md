<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md
---
Record the field observation P1.3 was waiting on: the last recovery rung has now run.

Docs only — no code. PR #1001 shipped `tepna-btreset.sh` and left an honest gap: the rung was armed but
had never been seen to work on hardware. It has now, on the box, 2026-08-08 ~21:00, with the helper
deployed root-owned 0755 and `check-system-files.sh` reading `10 managed, 0 drifted`.

Two independent confirmations. First the boot-time defence report, which confirms by silence in the right
place: it emitted its archive warning while saying nothing about `usb_path` — so `usb_rebind_available()`
returned True, on a path that had no check at all before this work. Then the rung fired deliberately
against the live UB500:

    BEFORE  hci0 UP RUNNING · AC:A7:F1:29:9D:1D · devnum 2 · driver usb
    RUN     sudo -n /usr/local/lib/tepna/tepna-btreset.sh 1-2  →  RC=0
            "re-bound: 1-2 (2357:0604)"
    AFTER   hci0 UP RUNNING · AC:A7:F1:29:9D:1D · devnum 2 · driver usb

The daemon stayed active; the Verity never dropped; the O2Ring dropped and self-reconnected within ~90 s
with no intervention. `devnum` is unchanged by design — a driver re-bind is not a USB re-enumeration, and
that difference is precisely why `tepna-btreset.sh` and `tepna-usbreset.sh` are separate helpers.

What it does NOT prove is recorded next to it: this proves the mechanism, not that the rung clears a real
RTL8761B firmware hang. No wedge has occurred since 2026-07-23. The claim is "the last rung can now run,
and has run" — not "the outage is fixed". P1.2's `hciconfig reset` half remains unexercised for the same
reason, and the brief stays PROPOSED.
