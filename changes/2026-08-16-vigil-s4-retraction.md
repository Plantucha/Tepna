---
bump: patch
type: fixed
brief: VIGIL-COEXISTENCE-FOLLOWUPS-2026-08-16-BRIEF.md
---

Retracts §2 of a brief shipped hours earlier. It asserted that capture runs without `CAP_NET_ADMIN` and
that the adapter-recovery ladder is disarmed, and routed the question into a privilege-model design. All
of that was taken from the parent brief's premise rather than from the box.

Checked on the box the same afternoon: `AmbientCapabilities=CAP_NET_ADMIN` is on
`tepna-capture.service`, the live process carries it (`CapPrm`/`CapEff`/`CapAmb` = bit 12), the "has no
CAP_NET_ADMIN" warning has not fired in three days, and the watchdog is actively managing wedges —
"clean poll 1/2 — holding the wedge count at 1 until recovery" on the 13th, 15th and again at 14:45 on
the 16th. The decision had been made and shipped before the brief claimed it was open.

The supporting argument was wrong twice over. It cited the day's Verity fragmentation as the measured
cost of a disarmed ladder, but the fragmentation occurs with recovery armed and running — so it is
evidence about the adapter or the link, not for a grant that already exists. Attaching a real
measurement to a stale premise made it read as corroboration, which is worse than either error alone.

What remains open is the other half and it is a different question: whether the update/restart path may
hold `NOPASSWD`, which is root code execution rather than a network capability, and whose root hole
stands. That work is unaffected.

Records the two in-repo precedents found while checking, since they mean the shape that question needs
is not novel: `link_rssi.py` performs a privileged action through `AmbientCapabilities` inherited across
exec, with sudo only as a dev-workstation fallback because `NoNewPrivileges=true` forbids setuid sudo on
the appliance; and `webmon.py` states the companion rule, that a rebind's USB port comes from server
config and never the request body, because an argument the caller chooses is still an argument the
caller chooses.

Docs only.
