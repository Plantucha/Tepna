# tepna-capture — ble_discovery.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# DISCOVERY FAILOVER — try a sibling radio before believing "not found".
#
# 🔴 READ THIS BEFORE CITING IT AS THE FIX FOR 2026-08-29. IT IS NOT.
# That night the AS11 shadow poll logged `BleakDeviceNotFoundError` for TWELVE HOURS and
# `SESSIONDETECT.csv` went silent, so the night's therapy state became unknowable. The reflex — and
# the one the owner and I both reached for — was "another adapter would probably have found it."
# The evidence says otherwise, and it is worth stating plainly here so this module is not
# mis-credited later:
#
#   · during the blackout a 12 s `BleakScanner.discover` on hci0 returned **107 devices** and on
#     hci2 returned 29 — healthy scans by any measure — and NEITHER contained the CPAP;
#   · `bluetooth.service` restarted at 07:27:58 and the journal's first row after the gap is
#     07:28:30, THIRTY-TWO SECONDS later.
#
# Both adapters share ONE bluez daemon, so both were blind to that one device while seeing everything
# else. That is a bluez per-DEVICE state wedge, not per-adapter contention, and **failing over to a
# sibling adapter would have inherited the same bad state and found nothing.** The recovery that
# class needs is a bluez/device-state reset — which is what the owner did by hand.
#
# WHAT THIS MODULE IS ACTUALLY FOR: a genuinely per-ADAPTER wedge, where one radio cannot answer and
# another can. That failure is real and separately attested (the night hci1 sat healthy and idle for
# 110 min while the pinned dongle was down, VIGIL-OVERNIGHT-FINDINGS P1.5), and until now discovery
# had no equivalent of the capture-side failover that incident produced. It is a cheap second
# opinion before anyone writes down an absence — it is not a cure for a wedged bluez.
#
# THIS IS DISCOVERY failover, distinct from `capture.py`'s P1.5 CAPTURE failover: that one moves a
# CONNECTED device off a wedged radio once the recovery ladder is spent; this one asks, earlier,
# "is it really absent, or could a sibling see it?" — and refuses to record an absence nobody
# established.
#
# ⚠️ NOT WITNESSED MID-WEDGE, and by the above it could not have been: the only wedge we have on
# record is the wrong kind. Validated against forced failures, not a live per-adapter wedge.

from __future__ import annotations

__all__ = ["ABSENT", "CONTENDED", "OTHER", "classify_failure", "discovery_order", "absence_verdict"]

ABSENT = "absent"  # the scan ran and the device was not there
CONTENDED = "contended"  # the scan could not run — the radio was busy, wedged, or unanswered
OTHER = "other"  # anything else; treated as contention-shaped for retry, but named as itself

# Substrings of the exception TEXT/class that mean "this adapter could not answer", as opposed to
# "this adapter answered and the device is not here". Taken from the daemon's own overnight log:
# `org.bluez.Error.InProgress — Operation already in progress`, D-Bus NoReply, and connect timeouts.
_CONTENTION = (
    "inprogress",
    "in progress",
    "noreply",
    "no reply",
    "timed out",
    "timeout",
    "resource",
    "busy",
    "notready",
    "not ready",
)
_ABSENCE = ("notfound", "not found", "no device", "was not found")


def classify_failure(exc) -> str:
    """`ABSENT` | `CONTENDED` | `OTHER` for one adapter's attempt. PURE.

    🔴 THE DISCRIMINATOR THE POLL USED TO SWALLOW. "The scan ran and found nothing" and "the scan
    could not run" need OPPOSITE responses — the first is evidence about the device, the second is
    evidence about the radio — and both used to arrive as one `except` writing nothing.

    Contention is checked FIRST and deliberately: bleak wraps some contention failures in classes
    whose names also contain "NotFound", so an absence-first test would read a jammed radio as a
    missing device — which is exactly the twelve-hour false negative."""
    text = f"{type(exc).__name__} {exc}".lower()
    if any(m in text for m in _CONTENTION):
        return CONTENDED
    if any(m in text for m in _ABSENCE):
        return ABSENT
    return OTHER


def discovery_order(pinned, adapters):
    """The adapters to try, pinned FIRST then its siblings, de-duplicated and order-stable. PURE.

    The pinned radio leads because it is the one bonded//configured for this device and the one whose
    success costs nothing; siblings are the fallback, not a rotation. Stable order so a log reading
    "found on hci2" means the same thing tomorrow."""
    out = []
    for a in [pinned] + list(adapters or []):
        if a and a not in out:
            out.append(a)
    return out


def absence_verdict(attempts):
    """`(absent, detail)` from `[(adapter, kind), ...]` — may we write down "not found"? PURE.

    ⚠️ ABSENCE REQUIRES A CLEAN SWEEP. Only when EVERY adapter ran its scan and came back empty is
    the device genuinely gone. If any adapter was contended, the honest answer is "we could not
    tell" — writing absence there is the false negative this module exists to prevent, and it is
    what made a whole night unknowable.

    No attempts at all is NOT absence either: nothing looked."""
    tried = list(attempts or [])
    if not tried:
        return False, "no adapter was tried"
    kinds = [k for _a, k in tried]
    if all(k == ABSENT for k in kinds):
        return True, f"absent on all {len(tried)} adapter(s): {', '.join(a for a, _ in tried)}"
    bad = [f"{a}={k}" for a, k in tried if k != ABSENT]
    return False, ("could not establish absence — " + ", ".join(bad) + f" (of {len(tried)} adapter(s) tried)")
