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

__all__ = ["WEDGED", "ABSENT", "WATCHING", "UNKNOWN", "wedge_verdict", "restart_allowed",
           "RETURNED", "NOT_RETURNED", "PENDING", "RECOVERY_WINDOW_S", "recovery_outcome",
           "fire_row", "parse_fires"]

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


# ── DID THE DEVICE COME BACK? — the only thing that separates "off" from "wedged" ─────────────────
#
# 🔴 THIS IS THE MISSING HALF OF THE 2026-08-30 RUNG, AND IT WAS MY OWN GAP. The rung fires and
# restarts bluetooth, but `STATUS["cpap_wedge"]` is IN-MEMORY and captures the verdict AT THE MOMENT
# OF FIRING — whether the device actually returned afterwards was recorded nowhere, in memory or on
# disk. Worse, the rung then clears `unreachable_streak`, so even the evidence that prompted it is
# gone. `status.json` does not help: it is a snapshot that gets overwritten, not a journal, so
# "fired at T, returned or not" is unrecoverable from it by construction.
#
# It matters because a machine that is OFF and a bluez wedged against one device are identical on
# every PASSIVE channel — same unanimous not-found, and (measured 2026-08-29) the radio is
# demonstrably HEALTHY in both, since a per-device wedge enumerated 107 other devices. They are
# separable ONLY BY INTERVENTION: after a bluetooth restart the wedged device returns in ~32 s and
# the absent one does not. So the discriminator is not a signal, it is an OUTCOME.
#
# ⚠️ THE OUTCOME IS DERIVED, NOT RECORDED, AND THAT IS DELIBERATE. The obvious design writes a
# "returned: yes/no" row N minutes after the fire — but the rung RESTARTS BLUETOOTH and the daemon
# itself may restart in that window, so the process owing the second write is exactly the process
# most likely to die before making it. A recorded outcome would be missing precisely when the
# recovery was most violent. Only the FIRE is written; the outcome is a pure function of that
# timestamp and the observations that follow, so it survives any number of restarts and can be
# recomputed from the journal forever.
RETURNED = "returned"          # it was a WEDGE — the intervention worked, so the night stays UNKNOWN
NOT_RETURNED = "not-returned"  # the machine really was gone — this is what licenses a therapy 0
PENDING = "pending"            # the window has not elapsed; asking now would answer early

# How long to allow. The one observed recovery took 32 s; 10 min is ~19x that, so a slow re-advertise
# is not mistaken for an absence. Erring long is the safe direction here: a too-short window turns a
# recovering device into a fabricated "machine off", which is the failure this whole path exists to
# avoid.
RECOVERY_WINDOW_S = 600.0


def recovery_outcome(fired_ms, observations, window_s: float = RECOVERY_WINDOW_S, now_ms=None):
    """`(outcome, detail)` — did the device return after the rung fired at `fired_ms`? PURE.

    `observations` is `[(host_ms, reachable_bool), ...]`, in any order; only those falling inside
    `[fired_ms, fired_ms + window_s]` are consulted.

    ⚠️ NO OBSERVATION IS NOT A NEGATIVE. A window that elapsed with nobody looking returns UNKNOWN,
    never NOT_RETURNED — and that distinction is the whole point, because NOT_RETURNED is the state
    that would license reporting zero therapy for a night. Concluding "the machine was off" from
    "we stopped polling" is exactly the fabrication this module refuses everywhere else."""
    try:
        t0 = float(fired_ms)
        win = float(window_s) * 1000.0
    except (TypeError, ValueError):
        return UNKNOWN, "unusable fire timestamp"
    inside = []
    for row in observations or ():
        try:
            ms, ok = float(row[0]), bool(row[1])
        except (TypeError, ValueError, IndexError):
            continue                      # a torn row is not evidence either way
        if t0 <= ms <= t0 + win:
            inside.append((ms, ok))
    if any(ok for _ms, ok in inside):
        back = min(ms for ms, ok in inside if ok)
        return RETURNED, f"device answered {(back - t0) / 1000.0:.0f}s after the restart — it was a wedge"
    now = float(now_ms) if now_ms is not None else None
    if now is not None and now < t0 + win:
        return PENDING, f"{(t0 + win - now) / 1000.0:.0f}s of the recovery window still to run"
    if not inside:
        return UNKNOWN, "the window elapsed with no poll at all — nobody looked, so nothing is known"
    return NOT_RETURNED, (f"{len(inside)} poll(s) across {window_s:.0f}s after the restart and the "
                          f"device answered none of them")


def fire_row(fired_ms, device: str, reason: str, error_class=None) -> str:
    """One semicolon row for the fire journal. PURE. Same delimiter as SESSIONDETECT so one reader
    idiom serves both, and every field is squeezed of `;` rather than quoted — a torn field is
    recoverable, a broken column count is not."""
    def _f(v):
        return str(v if v is not None else "").replace(";", ",").replace("\n", " ").strip()
    return ";".join([str(int(float(fired_ms))), _f(device), _f(reason), _f(error_class)])


def parse_fires(text: str) -> list:
    """`[{fired_ms, device, reason, error_class}]` from a fire journal, oldest first. PURE."""
    out = []
    for line in str(text or "").splitlines():
        parts = line.split(";")
        if len(parts) < 4:
            continue
        try:
            ms = int(parts[0])
        except ValueError:
            continue                      # header or torn line
        out.append({"fired_ms": ms, "device": parts[1], "reason": parts[2],
                    "error_class": parts[3] or None})
    return sorted(out, key=lambda r: r["fired_ms"])
