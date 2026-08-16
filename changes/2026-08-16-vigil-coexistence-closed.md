---
bump: patch
type: changed
brief: VIGIL-COEXISTENCE-AND-RANGE-2026-07-26-BRIEF.md
---

Owner-directed close. `VIGIL-COEXISTENCE-AND-RANGE` had carried "NO CODE WORK REMAINS" in its own banner
since 2026-08-04 — §1, §2 and §5 executed and verified on the box, §6 a record — and stayed open anyway,
because two items could not be finished at a keyboard. A finished code brief reading as open work is the
stale-status cost this repo keeps paying, so it closes and the live items move to a follow-up.

What outlives it. §3 needs a controlled physical walk-away, deliberately outside a WiFi bulk-transfer
window — the parent's original observation coincided with one, and its own §2 established that transfer
and BLE capture cannot share a window, so a re-measurement inside one would reproduce the confound
rather than test the question. §4 is a privilege decision, not code.

§4 is the same question as `VIGIL-AUTO-UPDATE-FOLLOWUPS` §2, reached from the other side: the
adapter-recovery ladder wants `CAP_NET_ADMIN` and the restart path wants `NOPASSWD`, and both run into
one wall, since a capture user who can write `/opt/tepna` plus a single granted privileged command is
root in two steps. It routes into the box privilege-model design rather than being decided twice.

That decision now carries a measured cost it lacked when the parent was written. Measured 2026-08-16:
the adapter fault is real and intermittent — the Verity fragmented into roughly three-minute segments
from 11:06, and 2 of the last 12 capture days produced no usable long single segment. That is precisely
what a disarmed self-heal ladder cannot recover from. Recorded as evidence for the decision, not as a
recommendation to grant the capability: the root hole is unchanged by the fault being real, and "an
unattended wedge requires a human" remains defensible provided it is stated rather than left implicit in
a startup warning nobody can filter.

Docs only.
