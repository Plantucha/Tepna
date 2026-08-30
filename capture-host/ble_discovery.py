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
# 🔴 CONTENTION MARKERS COME IN TWO STRENGTHS, AND CONFLATING THEM IS WHAT MADE `ABSENT` UNREACHABLE.
#
# EXPLICIT markers name a refusal by the stack itself — bluez said "in progress", D-Bus said "no
# reply", the device is busy. Nothing else produces those words, so they are decisive and they beat
# even an unambiguous absence TYPE: `test_contention_is_checked_BEFORE_absence` pins a real
# `BleakDeviceNotFoundError` carrying `org.bluez.Error.InProgress`, and reading that as an absence
# would be the twelve-hour false negative all over again.
#
# AMBIGUOUS markers are timeout wording — and bleak's own not-found message is literally
# "…not found after 10.0 seconds, timed out". Treating that as contention is what made `ABSENT`
# unreachable on bleak's most common path (F3): the same class landed on opposite sides depending on
# how its message happened to be phrased. These still mean contention for a class we cannot otherwise
# identify; they no longer outrank a type that says plainly what happened.
_CONTENTION_EXPLICIT = (
    "inprogress",
    "in progress",
    "noreply",
    "no reply",
    "resource",
    "busy",
    "notready",
    "not ready",
)
_CONTENTION_AMBIGUOUS = (
    "timed out",
    "timeout",
)
_CONTENTION = _CONTENTION_EXPLICIT + _CONTENTION_AMBIGUOUS
_ABSENCE = ("notfound", "not found", "no device", "was not found")

# EXCEPTION TYPES THAT MEAN ABSENCE WHATEVER THE MESSAGE SAYS.
# bleak raises `BleakDeviceNotFoundError` from ONE place — a connect whose address never appeared in
# discovery. It is not the class it reaches for when the adapter is busy: contention arrives as
# `BleakError` / `BleakDBusError` carrying org.bluez.Error.InProgress, NoReply, or "Device is busy",
# which is what every pinned contention shape in the characterization suite actually uses.
#
# Matched on the exact type name, NOT a substring: "contains notfound" is precisely the reasoning the
# text path already does, and repeating it here would inherit its ambiguity instead of replacing it.
# ⚠️ THESE ARE TYPE NAMES AS STRINGS, AND THIS MODULE NEVER IMPORTS bleak. That is deliberate and it
# has a consequence worth stating: the classifier is version-agnostic by construction — a bleak
# upgrade changes which exceptions the daemon RECEIVES, not how any of this behaves, and the tests
# build synthetic classes so they pass against any bleak. `requirements.txt` pins only `bleak>=0.22`,
# so the set of raise sites is an OBSERVATION of the installed version (3.0.2, enumerated 2026-08-30)
# rather than a guarantee. Pinning bleak would control the inputs; it would not protect this logic.
# Recorded as a known assumption rather than fixed, deliberately — the alternative is a dependency
# pin whose cost lands outside this question.
_ABSENCE_TYPES = ("bleakdevicenotfounderror",)

# ⚠️ AND THE MIRROR: TYPES WHOSE NAME READS LIKE AN ABSENCE BUT WHICH PROVE THE OPPOSITE.
# `BleakCharacteristicNotFoundError` is raised at GATT time — AFTER a successful connect — when the
# device is missing a characteristic. Its message is literally "…was not found!", so the text path
# classified it ABSENT: a device we had demonstrably just talked to, recorded as not being there.
# That is a fabricated negative, and it appeared 5× in the 2026-08-29 journal alongside the real
# not-founds, where it would have counted toward "absent on all adapters".
#
# It is `OTHER` rather than `CONTENDED` because the radio was fine — nothing was contended. OTHER is
# the honest "this is not evidence about presence either way", and `absence_verdict` requires every
# attempt to be ABSENT, so OTHER blocks a sweep exactly as CONTENDED does.
_REACHED_TYPES = ("bleakcharacteristicnotfounderror",)


def classify_failure(exc) -> str:
    """`ABSENT` | `CONTENDED` | `OTHER` for one adapter's attempt. PURE.

    🔴 THE DISCRIMINATOR THE POLL USED TO SWALLOW. "The scan ran and found nothing" and "the scan
    could not run" need OPPOSITE responses — the first is evidence about the device, the second is
    evidence about the radio — and both used to arrive as one `except` writing nothing.

    Contention is checked FIRST among the TEXT markers, and deliberately: contention failures arrive
    wrapped in generic classes whose messages can also mention a device not being found, so a
    text-level absence-first test would read a jammed radio as a missing device — the twelve-hour
    false negative this module exists to prevent.

    🔴 BUT TEXT ALONE MADE `ABSENT` UNREACHABLE ON THE MOST COMMON PATH (F3, fixed 2026-08-30).
    bleak's not-found message is literally "…not found after 10.0 seconds, timed out", and
    `_CONTENTION` contains "timed out". So the SAME exception class landed on opposite sides
    depending on how its message happened to be worded, and on every bleak path with timeout wording
    the module could never conclude the machine was simply off — it could only ever say "could not
    tell". A detector that cannot reach one of its verdicts is not a detector.

    So the order is now by EVIDENCE STRENGTH rather than by category:

      1. EXPLICIT contention text — bluez/D-Bus saying "in progress", "no reply", "busy". Nothing
         else produces those words, so they are decisive and beat even an unambiguous type. A real
         `BleakDeviceNotFoundError` carrying `org.bluez.Error.InProgress` is contention, and
         `test_contention_is_checked_BEFORE_absence` pins exactly that.
      2. An unambiguous TYPE — `BleakDeviceNotFoundError` comes from one place, a connect whose
         address never appeared in discovery, and is not what bleak raises for a busy adapter.
      3. A type that PROVES the device was reached (`BleakCharacteristicNotFoundError`, raised at
         GATT time after a successful connect) — `OTHER`, because a device we just talked to is not
         absent however its message is worded.
      4. AMBIGUOUS timeout wording, then absence wording, for classes we cannot otherwise identify.

    ⚠️ Step 1 exists because a type-first classifier is NOT sufficient, which is only visible from
    `test_ble_discovery.py` — the same class genuinely appears carrying an explicit contention
    message. A fix that consulted the type before all text passed the F3 characterization suite and
    still broke that case.

    ⚠️ AND THE HONEST LIMIT, BECAUSE THE TYPE IS NOT A PROOF: a jammed radio hears nothing, so it can
    ALSO produce a genuine not-found. Nothing in one attempt separates "the device is off" from "this
    radio is deaf" — the same indistinguishability `bluez_wedge` states about a single device. What
    makes reaching ABSENT safe is not this function but `absence_verdict`, which writes an absence
    only on a CLEAN SWEEP: every adapter tried, every one empty. One contended adapter still blocks
    the verdict. This function classifies an ATTEMPT; the sweep decides the NIGHT."""
    text = f"{type(exc).__name__} {exc}".lower()
    if any(m in text for m in _CONTENTION_EXPLICIT):
        return CONTENDED            # the stack refused, in its own words — decisive, beats the type
    if type(exc).__name__.lower() in _REACHED_TYPES:
        return OTHER                # we CONNECTED; whatever failed after that is not an absence
    if type(exc).__name__.lower() in _ABSENCE_TYPES:
        return ABSENT               # ...otherwise an unambiguous type outranks timeout WORDING
    if any(m in text for m in _CONTENTION_AMBIGUOUS):
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
