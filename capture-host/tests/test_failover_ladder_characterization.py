# tepna-capture — tests/test_failover_ladder_characterization.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# CHARACTERIZATION tests for the radio/CPAP failover ladder (#1963, #1970, #1971).
#
# ⚠️ THESE PIN WHAT THE CODE DOES, INCLUDING WHERE THAT IS LESS THAN THE SPEC AROUND IT. They exist
# because an adversarial review (2026-08-30) found two properties that read as implemented and are
# not, and an unpinned gap drifts silently. A characterization test is not an endorsement: where one
# asserts a limitation, it says so in its own name and docstring, and the FIX for that limitation is
# expected to turn it red. **If one of these fails, read the docstring before changing the test** —
# a red here may mean the gap was closed, in which case the test is what should change, and the
# comment says which direction that is.
#
# No source is touched by this file. The fixes belong to the owner of these modules.

import ble_discovery
from cpap_stream_watch import therapy_minutes


# ── F3 · classify_failure keys on message TEXT, and contention wins ─────────────────────────────
# The precedence is DELIBERATE and documented in `classify_failure`: bleak wraps some contention
# failures in classes whose names also contain "NotFound", so an absence-first test would read a
# jammed radio as a missing device — the twelve-hour false negative the module exists to prevent.
# These tests pin that choice, and then pin its cost.
def _exc(cls_name: str, msg: str):
    return type(cls_name, (Exception,), {})(msg)


def test_a_plain_not_found_is_an_absence():
    """The scan ran and the device was not there — the one case that may be written down."""
    e = _exc("BleakDeviceNotFoundError", "Device with address AA:BB:CC:DD:EE:FF was not found")
    assert ble_discovery.classify_failure(e) == ble_discovery.ABSENT


def test_bluez_contention_shapes_are_contention():
    """Taken from the daemon's own overnight log — these mean the radio could not answer."""
    for cls, msg in [
        ("BleakError", "org.bluez.Error.InProgress: Operation already in progress"),
        ("BleakError", "[org.freedesktop.DBus.Error.NoReply] Did not receive a reply"),
        ("BleakError", "Device is busy"),
    ]:
        assert ble_discovery.classify_failure(_exc(cls, msg)) == ble_discovery.CONTENDED, msg


def test_a_not_found_WORDED_as_a_timeout_is_classified_CONTENDED_not_absent():
    """⚠️ THE COST OF CONTENTION-FIRST, PINNED. The SAME exception class lands on BOTH sides
    depending on how its message happens to be worded:

        "…was not found"                         -> ABSENT
        "…not found after 10.0 seconds, timed out" -> CONTENDED

    because `_CONTENTION` contains "timed out" and is tested first. The direction is SAFE — contended
    blocks an absence verdict, so the ladder refuses to write down an absence it did not establish —
    but the consequence is that on any bleak path whose not-found message carries timeout wording,
    `ABSENT` is UNREACHABLE and the module can never conclude the machine is simply off.

    This is characterization, not a demand: fixing it means classifying on the exception TYPE rather
    than its text, and that is the owner's call. If this test goes red because the classifier stopped
    keying on text, that is the gap closing — update the test, not the code."""
    e = _exc("BleakDeviceNotFoundError", "Device AA:BB:CC:DD:EE:FF not found after 10.0 seconds, timed out")
    assert ble_discovery.classify_failure(e) == ble_discovery.CONTENDED


# ── F2 · the UNREACHABLE row's failure CLASS is written but not consumed ────────────────────────
_FIELDS = 12  # Decision.ROW_FIELDS; [0]=host_ms [5]=trigger [7]=reachable [8]=fg_state


def _row(host_ms, *, reachable, fg="", trigger=""):
    cells = [""] * _FIELDS
    cells[0] = str(host_ms)
    cells[5] = trigger
    cells[7] = str(reachable)
    cells[8] = fg
    return ";".join(cells)


# ⚠️ THE FIXTURE STRADDLES THE COVERAGE THRESHOLD ON PURPOSE, and the first version of this file did
# not. With only a couple of unreachable rows, a consumer that started reading the class would change
# `unreachable` from 2 to 0 — and the answer would stay 2.5 either way, because neither count crosses
# MIN_OBSERVED_FRAC. The test passed against a planted gap-closing fix, i.e. it pinned nothing.
# Six observed against six unreachable REFUSES today (None); discount the unreachable ones and it
# becomes measurable. So the verdict itself turns on whether the class is read.
def _journal(trigger):
    """Six observed Therapy polls, then six unreachable polls carrying `trigger` — enough to trip the
    coverage refusal while all six are counted, and not enough once any are discounted."""
    rows = [_row(1_000_000 + i * 30_000, reachable=True, fg="Therapy") for i in range(6)]
    rows += [_row(1_180_000 + i * 30_000, reachable=False, trigger=trigger) for i in range(6)]
    return "\n".join(rows)


def test_therapy_minutes_ignores_the_failure_CLASS_entirely():
    """⚠️ A GAP, PINNED SO A FIX HAS A RED-TO-GREEN TARGET. `UnreachableRow` records the exception
    class in `trigger` (parts[5]) so a persistent fault is identifiable — by a HUMAN reading the CSV.
    Nothing consumes it: `therapy_minutes` reads only parts[7] (reachable) and parts[8] (fg_state).

    So a night the machine was OFF and a night the RADIO could not answer are byte-identical to this
    function, though they need opposite responses (wait vs reset bluez). Two journals differing ONLY
    in the recorded class produce the same number.

    ⚠️ The source never claimed otherwise — this is a spec-versus-implementation gap, not a false
    claim in code. When a consumer starts reading the class this assertion should FAIL; that is the
    gap closing, and the test is then what changes."""
    gone = therapy_minutes(_journal("BleakDeviceNotFoundError"))
    jammed = therapy_minutes(_journal("BleakError"))
    assert gone == jammed, "therapy_minutes distinguishes the classes — the F2 gap has closed"
    # Verified against a PLANT: a consumer that discounts NotFound rows makes `gone` measurable while
    # `jammed` still refuses, and the equality above breaks. Without the straddling fixture it did not.
    assert gone is None, "both must refuse today — if one measures, the class is being read"


def test_an_unreachable_row_is_not_counted_as_standby():
    """The property that IS implemented, pinned beside the one that is not: an unreachable poll is
    excluded from the therapy sum rather than read as 'not in therapy'. Without this the ladder's
    whole point — that an outage is visible as an outage — would be undone one layer down."""
    # Its OWN fixture, deliberately: `_journal` straddles the coverage refusal so that the class test
    # above has something to turn on, and a journal that refuses cannot show that a row added no time.
    observed = therapy_minutes("\n".join(
        _row(1_000_000 + i * 30_000, reachable=True, fg="Therapy") for i in range(6)))
    plus_two_unreachable = therapy_minutes("\n".join(
        [_row(1_000_000 + i * 30_000, reachable=True, fg="Therapy") for i in range(6)]
        + [_row(1_180_000 + i * 30_000, reachable=False, trigger="BleakError") for i in range(2)]))
    assert observed is not None and observed > 0, "the fixture must measure something"
    assert observed == plus_two_unreachable, "an unreachable poll must add no therapy time"


def test_a_mostly_unreachable_journal_refuses_to_answer():
    """Coverage, not mere presence — the MIN_OBSERVED_FRAC guard. A handful of real observations in a
    night of failures must not report a short, calm, fictional night."""
    rows = [_row(1_000_000 + i * 30_000, reachable=True, fg="Therapy") for i in range(2)]
    rows += [_row(1_100_000 + i * 30_000, reachable=False, trigger="BleakError") for i in range(20)]
    assert therapy_minutes("\n".join(rows)) is None
