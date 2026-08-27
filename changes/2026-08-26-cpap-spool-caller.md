<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: CPAP-SPOOL-ACQUISITION-2026-08-25-BRIEF.md
---
Wire the CPAP stored-spool pull into the daemon — a scheduled, default-OFF morning pull that refuses to arm in the Wi-Fi harvest's window.

`cpap_spool.sync_spool` has been a complete, 100 %-covered transaction driver wired into nothing
since #1711, carried as a dated `find_unwired` suppression so the gap stayed visible. This closes it:
`cpap_spool_caller.py` holds the decision half (arming · window-conflict · defer reasons · the
short-connect cycle), and `capture.py` gets the thin loop both CPAP-SPOOL-ACQUISITION Do-3 and
CPAP-ACQ-P4 §7 announced.

Default OFF and never inherited — the first pull is still the ATTENDED one (Do-1, waiting on the
owner), so the caller ships disabled on purpose and the radio-touching first run stays an event
somebody arranges. It logs its arming state either way: a disabled path that says so is debuggable,
and a silent one is indistinguishable from a broken one.

One rule was added that neither brief asked for: the spool window must not overlap `cpap.at_hour`'s
harvest window, and arming REFUSES when it does, naming the hour. Both are 2.4 GHz on one box and
neither job's interlock can see the other's traffic, so the contention would be invisible at runtime
by construction — this is the one place a runtime interlock structurally cannot help, so it is
checked at arming, from config alone.
