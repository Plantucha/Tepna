# tepna-capture — bluez_wedge.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE PARTIAL WEDGE: bluez goes blind to ONE device while serving every other link normally.
#
# Measured 2026-08-29/30. The CPAP was invisible for twelve hours — `SESSIONDETECT.csv` stopped at
# 19:36:53 and nothing could say whether therapy had run — while the H10 and the O2Ring streamed
# without interruption. hci0 enumerated 107 devices in a scan and never once listed the CPAP.
# Restarting `bluetooth.service` cured it in 32 seconds. It was not contention, not a dead task, and
# not an absent machine: therapy HAD run, and ten EDF files were harvested the next day.
#
# 🔴 WHY THE EXISTING LADDER CANNOT SEE THIS, AND WHY THAT IS STRUCTURAL RATHER THAN AN OVERSIGHT.
# `radio_looks_deaf` short-circuits on `connected_any` — deliberately, and its reasoning is sound for
# the failure IT owns: "a radio holding a live link is demonstrably working, whatever a scan says."
# But a per-device wedge's SIGNATURE is that everything else keeps working. So that predicate is not
# merely too narrow here; it tests for a condition this failure mode cannot produce. The two rungs are
# complements, not a hierarchy, and neither subsumes the other.
#
# 🔴 AND WHY THIS RUNG'S BAR MUST BE HIGHER THAN THE DEAFNESS RUNG'S. `radio_looks_deaf`'s own comment
# says its bar is "deliberately low" because "the cost of being wrong here is a bluetooth restart that
# drops nothing (nothing was connected)". Here the cost is inverted: a restart drops precisely the
# links that ARE working — an on-body sensor mid-recording. Same recovery action, opposite blast
# radius, so the evidence required is not the same and must not be copied across.
#
# ⚠️ WHAT THIS CANNOT DO, STATED PLAINLY. A powered-off device and a wedged bluez are INDISTINGUISHABLE
# from one device's point of view: both are simply never seen. Nothing in this module resolves that,
# and any claim to have done so would be fabricated. What it does instead is bound the mistake — it
# fires only inside a WINDOW where "wedged" is the better explanation, and only against a budget.

from __future__ import annotations

__all__ = ["WEDGED", "ABSENT", "WATCHING", "UNKNOWN", "wedge_verdict", "restart_allowed"]

WEDGED = "wedged"        # seen recently, gone since, radio demonstrably fine ⇒ recovery is warranted
ABSENT = "absent"        # gone long enough that "the device is not here" is the better explanation
WATCHING = "watching"    # not yet enough consecutive misses to mean anything
UNKNOWN = "unknown"      # we cannot tell, and say so rather than guessing

# A device must be missed this many consecutive rounds before absence is evidence of anything. The
# watchdog polls at `interval_sec` (60 s by default), so 15 rounds ≈ 15 minutes. The deafness rung uses
# 2 because its recovery is free; this one drops live links, so it waits.
MIN_ABSENT_ROUNDS = 15

# ...and the device must have been SEEN within this window, because that is the only thing separating
# "bluez lost it" from "it is not here". Six hours spans a night's therapy plus a wide margin: on the
# 2026-08-29 incident the CPAP had been visible the same evening. Past this, "removed" wins.
MAX_LAST_SEEN_AGE_S = 6 * 3600.0

# Restarting bluetoothd drops every live link. Two a day, the same budget the watchdog gives its radio
# resets, and for the same reason: a restart that did not help will not help on the fourth attempt.
MAX_RESTARTS_PER_DAY = 2


def wedge_verdict(absent_rounds, radio_healthy, last_seen_age_s,
                  min_rounds=MIN_ABSENT_ROUNDS, max_age_s=MAX_LAST_SEEN_AGE_S):
    """`(verdict, reason)` — is bluez wedged against ONE device? PURE.

    `radio_healthy` must mean *demonstrably* healthy: another device is connected, or a scan returned
    advertisements. A radio that is merely `UP` does not qualify — that is the exact reading that was
    true and useless on 2026-07-30."""
    if not radio_healthy:
        # The whole-radio rung owns this. Claiming a per-device wedge while the receiver is deaf would
        # attribute a general failure to one device and restart on the wrong evidence.
        return UNKNOWN, "radio is not demonstrably healthy — the deafness rung owns this state"
    if last_seen_age_s is None:
        # Never seen at all: no prior evidence the device was ever reachable, so its absence says
        # nothing about bluez. Honest UNKNOWN, never folded into a verdict.
        return UNKNOWN, "never seen — no prior evidence this device was ever reachable"
    if absent_rounds < min_rounds:
        return WATCHING, f"missed {absent_rounds}/{min_rounds} consecutive rounds"
    if last_seen_age_s > max_age_s:
        return ABSENT, (f"last seen {last_seen_age_s / 3600.0:.1f} h ago — beyond the window where "
                        f"'bluez lost it' beats 'it is not here'")
    return WEDGED, (f"missed {absent_rounds} consecutive rounds but was seen "
                    f"{last_seen_age_s / 60.0:.0f} min ago, while the radio serves other links")


def restart_allowed(restarts_today, max_per_day=MAX_RESTARTS_PER_DAY):
    """`(ok, reason)` — may we spend a bluetoothd restart? PURE.

    Separate from the verdict on purpose: exhausting the budget must not change what we BELIEVE is
    happening, only what we do about it. Folding the two would make a wedged night read as healthy
    once the budget ran out — the honest-absence failure, one level up."""
    if restarts_today >= max_per_day:
        return False, (f"restart budget spent ({restarts_today}/{max_per_day} today) — a restart that "
                       f"did not help will not help on the next attempt")
    return True, f"{restarts_today}/{max_per_day} restarts used today"
