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


def test_a_not_found_WORDED_as_a_timeout_is_now_an_ABSENCE():
    """✅ THE GAP CLOSED 2026-08-30. This test previously asserted the OPPOSITE, and its own docstring
    said that a red here would mean the fix had landed and the TEST should change. It did, and it has.

    What it used to pin: the same exception class landed on opposite sides depending on how its
    message happened to be worded —

        "…was not found"                           -> ABSENT
        "…not found after 10.0 seconds, timed out" -> CONTENDED

    because `_CONTENTION` contains "timed out" and was tested first. The direction was SAFE (contended
    blocks an absence verdict) but the cost was that on any bleak path whose not-found message carries
    timeout wording — which is bleak's ACTUAL wording — `ABSENT` was unreachable and the module could
    never conclude the machine was simply off. A detector that cannot reach one of its verdicts is
    not a detector.

    `classify_failure` now consults an unambiguous exception TYPE before any text, so bleak's real
    message no longer decides the verdict."""
    e = _exc("BleakDeviceNotFoundError", "Device AA:BB:CC:DD:EE:FF not found after 10.0 seconds, timed out")
    assert ble_discovery.classify_failure(e) == ble_discovery.ABSENT


def test_THE_TEXT_PATH_STILL_PUTS_CONTENTION_FIRST_FOR_EVERY_OTHER_CLASS():
    """The half that must NOT change. Only an unambiguous type short-circuits; everything else still
    goes through the text markers with contention winning, because a generic class carrying a
    not-found-ish message really can be a jammed radio."""
    jammed = _exc("BleakError", "Device AA:BB not found — org.bluez.Error.InProgress")
    assert ble_discovery.classify_failure(jammed) == ble_discovery.CONTENDED


def test_A_JAMMED_RADIO_STILL_CANNOT_PRODUCE_AN_ABSENCE_VERDICT():
    """⚠️ WHY REACHING `ABSENT` IS SAFE, AND IT IS NOT THIS FUNCTION THAT MAKES IT SO.

    A deaf radio hears nothing, so it can produce a genuine not-found too — one attempt cannot
    separate "the device is off" from "this radio cannot hear". The protection is `absence_verdict`'s
    CLEAN SWEEP: one contended adapter blocks the verdict however many others came back empty. This
    function classifies an ATTEMPT; the sweep decides the night."""
    absent, _ = ble_discovery.absence_verdict([("hci0", ble_discovery.ABSENT),
                                               ("hci1", ble_discovery.CONTENDED)])
    assert absent is False


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


# ── the REAL 2026-08-29 blackout, from the box's own journal ──────────────────────────────────────
# Every fixture above is synthetic. These three lines are verbatim from
# `journalctl -u tepna-capture.service` over Aug 29 19:00 → Aug 30 08:00, with the counts observed:
#
#   851×  BleakDeviceNotFoundError: Device with address 04:CD:15:3A:0B:BD was not found.
#     5×  BleakCharacteristicNotFoundError: Characteristic a6220003-…-cb089d2044aa was not found!
#     5×  BleakDBusError: [org.freedesktop.DBus.Error.NoReply] Message recipient disconnected …
#
# ⚠️ AND THE FACT THAT SETTLED A REVIEW: the dominant message reads "was not found." — it carries NO
# timeout wording. So this incident classified ABSENT *before* the F3 fix and classifies ABSENT after
# it; the fix does not change the blackout's verdict by a single row. A reviewer reasonably feared the
# opposite, and only the real line could answer it — the synthetic "not found after 10.0 seconds,
# timed out" fixture is a DIFFERENT shape that this night never produced.
_BLACKOUT = [
    ("BleakDeviceNotFoundError", "Device with address 04:CD:15:3A:0B:BD was not found.", "absent"),
    # ⚠️ CORRECTED IN REVIEW, and the correction is the interesting one. This class is raised at GATT
    # time — AFTER a successful connect — so it PROVES the device was reached. Its message says "was
    # not found!", and the text path duly classified it ABSENT: a device we had just talked to,
    # recorded as not being there. It appeared 5× on the blackout night, where it would have counted
    # toward "absent on all adapters". Now OTHER, which blocks a sweep exactly as CONTENDED does.
    ("BleakCharacteristicNotFoundError",
     "Characteristic a6220003-35f1-4b20-afae-cb089d2044aa was not found!", "other"),
    ("BleakDBusError",
     "[org.freedesktop.DBus.Error.NoReply] Message recipient disconnected from message bus without "
     "replying", "contended"),
]


def test_THE_REAL_BLACKOUT_LINES_CLASSIFY_AS_THE_BOX_SAW_THEM():
    for cls, msg, expected in _BLACKOUT:
        got = ble_discovery.classify_failure(_exc(cls, msg))
        assert got == expected, f"{cls}: {msg[:48]}… -> {got}, expected {expected}"


def test_THE_BLACKOUT_IS_A_UNIFORM_ABSENCE_WHICH_THE_CLEAN_SWEEP_CANNOT_BLOCK():
    """⚠️ A PRE-EXISTING FALSE NEGATIVE, PINNED HONESTLY RATHER THAN PAPERED OVER.

    The wedge was uniform: both adapters were blind to the CPAP while seeing 107 and 29 other devices
    respectively. So every attempt classifies ABSENT, nothing is contended, and `absence_verdict`'s
    clean-sweep rule — which blocks an absence when ANY adapter was contended — has nothing to block
    on. It says "absent on all adapters" for a night the machine was demonstrably present and
    running: therapy occurred and ten EDF files were harvested the next day.

    This is TRUE ON MAIN TODAY and is not created by the F3 fix. It is safe because the one
    production consumer of `absence_verdict` only LOGS (capture.py) — it settles nothing — and
    because the escalation that this night actually needed lives elsewhere: `bluez_wedge`'s rung,
    which runs off the shadow poller's own unreachable streak and is independent of this path."""
    attempts = [("hci0", ble_discovery.ABSENT), ("hci1", ble_discovery.ABSENT)]
    absent, why = ble_discovery.absence_verdict(attempts)
    assert absent is True, "the sweep did not produce the uniform absence the incident really shows"
    assert "all 2 adapter" in why


def test_A_CHARACTERISTIC_MISS_IS_NOT_A_MISSING_DEVICE():
    """The predicate is an EXACT type match, not a substring, and this is why it has to be.

    `BleakCharacteristicNotFoundError` is NotFound-named and would be promoted to ABSENT by any
    `"notfound" in type(exc).__name__` test — but it is raised after a successful connect, so it is
    positive evidence the device is PRESENT. Recording that as an absence is a fabricated negative
    about a device we had just been talking to."""
    reached = _exc("BleakCharacteristicNotFoundError", "Characteristic a622 was not found!")
    assert ble_discovery.classify_failure(reached) == ble_discovery.OTHER
    # ...and it blocks a sweep, so it can never contribute to "absent on all adapters".
    absent, _ = ble_discovery.absence_verdict([("hci0", ble_discovery.ABSENT),
                                               ("hci1", ble_discovery.classify_failure(reached))])
    assert absent is False


def test_BLUEZ_UNKNOWN_OBJECT_IS_DELIBERATELY_AN_ABSENCE():
    """A DECISION, pinned so it is explicit rather than incidental (raised in review 2026-08-30).

    bleak's `client.py` raises `BleakDeviceNotFoundError` on D-Bus UNKNOWN_OBJECT with the message
    "…removed from BlueZ when scanning stopped". That is a BlueZ BOOKKEEPING artifact — the object
    vanished from the daemon's tree — which is arguably closer to a per-device wedge than to "the
    machine is off", so it could defensibly be a could-not-tell.

    It is ABSENT, deliberately, for two reasons. It IS bleak's not-found path and the scan genuinely
    ran; and the alternative would re-narrow `ABSENT` toward the unreachability F3 exists to fix,
    trading a rare wrong-absence for the common no-verdict-ever.

    ⚠️ What makes that safe is NOT this function. `absence_verdict`'s sole production consumer only
    logs and then raises — it settles nothing — and the escalation this shape actually needs is
    `bluez_wedge`'s rung, which fires off the shadow poller's own unreachable streak and never
    consults this verdict. If either of those changes, revisit this line first."""
    e = _exc("BleakDeviceNotFoundError",
             "Device with address 04:CD:15:3A:0B:BD was removed from BlueZ when scanning stopped")
    assert ble_discovery.classify_failure(e) == ble_discovery.ABSENT
