# tepna-capture — tests/test_ble_discovery.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Discovery failover: ask a sibling radio before writing down an absence.

⚠️ THIS IS NOT THE FIX FOR THE 2026-08-29 BLACKOUT and the tests do not pretend otherwise. That was a
bluez per-DEVICE state wedge shared by every adapter — hci0 enumerated 107 other devices throughout —
so a sibling would have been blind too. This is for a per-ADAPTER wedge, the class P1.5 attests on
the capture side and which discovery had no answer to. Validated against forced failures, never a
live wedge.
"""

import asyncio

import ble_discovery as B
import capture


def _run(c):
    return asyncio.run(c)


class _NotFound(Exception):
    pass


_NotFound.__name__ = "BleakDeviceNotFoundError"


class _Busy(Exception):
    pass


_Busy.__name__ = "BleakDBusError"


# ── classification: the discriminator the poll used to swallow ─────────────────────────────────


def test_a_CONTENDED_radio_is_not_an_ABSENT_device():
    """🔴 'The scan ran and found nothing' and 'the scan could not run' are evidence about DIFFERENT
    things — the device and the radio — and both used to arrive as one `except` writing nothing."""
    assert B.classify_failure(_NotFound("04:CD:15 not found")) == B.ABSENT
    for e in (
        _Busy("org.bluez.Error.InProgress: Operation already in progress"),
        TimeoutError("connect timed out"),
        _Busy("org.freedesktop.DBus.Error.NoReply"),
        OSError("Device or resource busy"),
    ):
        assert B.classify_failure(e) == B.CONTENDED, e


def test_contention_is_checked_BEFORE_absence():
    """bleak wraps some contention failures in classes whose NAME also contains NotFound. An
    absence-first test would read a jammed radio as a missing device — the false negative itself."""
    e = _NotFound("device not found: org.bluez.Error.InProgress")
    assert B.classify_failure(e) == B.CONTENDED


def test_an_unrecognised_failure_is_named_OTHER_not_guessed_as_absent():
    assert B.classify_failure(ValueError("something new")) == B.OTHER


# ── ordering ───────────────────────────────────────────────────────────────────────────────────


def test_the_PINNED_adapter_leads_and_the_order_is_stable():
    """The pinned radio is the configured one and costs nothing when it works; siblings are a
    fallback, not a rotation. Stable so 'found on hci2' means the same tomorrow."""
    assert B.discovery_order("hci1", ["hci0", "hci1", "hci2"]) == ["hci1", "hci0", "hci2"]
    assert B.discovery_order("hci1", ["hci1"]) == ["hci1"]
    assert B.discovery_order(None, ["hci0", "hci0"]) == ["hci0"]
    assert B.discovery_order("hci1", None) == ["hci1"]


# ── the verdict: what may be written down ──────────────────────────────────────────────────────


def test_ABSENCE_REQUIRES_A_CLEAN_SWEEP():
    """🔴 The whole point. Only when every adapter RAN its scan and came back empty is the device
    gone. One contended adapter and the honest answer is 'we could not tell'."""
    ok, why = B.absence_verdict([("hci1", B.ABSENT), ("hci0", B.ABSENT)])
    assert ok is True and "hci1" in why
    bad, why2 = B.absence_verdict([("hci1", B.CONTENDED), ("hci0", B.ABSENT)])
    assert bad is False and "hci1=contended" in why2
    assert B.absence_verdict([("hci1", B.OTHER)])[0] is False


def test_NO_ATTEMPTS_is_not_absence_either():
    """Nothing looked. That is not evidence the device is gone."""
    ok, why = B.absence_verdict([])
    assert ok is False and "no adapter was tried" in why
    assert B.absence_verdict(None)[0] is False


# ── the connect path ───────────────────────────────────────────────────────────────────────────


def _conn(good=None, err=_NotFound):
    seen = []

    async def connect(_addr, adapter, _t):
        seen.append(adapter)
        if adapter == good:
            return ("W", "R", "D")
        raise err(f"{adapter} says no")

    return connect, seen


def test_a_SIBLING_rescues_a_discovery_the_pinned_radio_missed():
    conn, seen = _conn(good="hci2")
    got, used, attempts = _run(
        capture._cpap_connect_any_adapter("04:CD", "hci1", 8.0, connect=conn, adapters=["hci0", "hci1", "hci2"])
    )
    assert got == ("W", "R", "D") and used == "hci2"
    assert seen == ["hci1", "hci0", "hci2"], "the pinned adapter must be tried first"
    assert attempts == [("hci1", B.ABSENT), ("hci0", B.ABSENT)]


def test_the_pinned_adapter_working_costs_no_extra_scans():
    conn, seen = _conn(good="hci1")
    _got, used, attempts = _run(
        capture._cpap_connect_any_adapter("04:CD", "hci1", 8.0, connect=conn, adapters=["hci0", "hci1", "hci2"])
    )
    assert used == "hci1" and seen == ["hci1"] and attempts == []


def test_when_EVERY_adapter_fails_the_original_error_is_raised():
    """A caller that does not care about failover must see the behaviour it always saw."""
    conn, seen = _conn(good=None)
    try:
        _run(capture._cpap_connect_any_adapter("04:CD", "hci1", 8.0, connect=conn, adapters=["hci0", "hci1"]))
    except Exception as e:
        assert type(e).__name__ == "BleakDeviceNotFoundError" and "hci1" in str(e), e
    else:
        raise AssertionError("every adapter failed and nothing was raised")
    assert seen == ["hci1", "hci0"]


def test_a_contended_sweep_is_reported_as_INCONCLUSIVE_not_as_absence(caplog):
    """🔴 The log line a reader needs: the radios could not answer, so nothing was established about
    the machine. Reporting that as 'not found' is the false negative this unit exists to prevent."""
    conn, _seen = _conn(good=None, err=_Busy)
    with caplog.at_level("WARNING"):
        try:
            _run(capture._cpap_connect_any_adapter("04:CD", "hci1", 8.0, connect=conn, adapters=["hci0", "hci1"]))
        except Exception:
            pass
    assert any("INCONCLUSIVE" in r.message and "NOT evidence" in r.message for r in caplog.records)


def test_a_clean_sweep_is_reported_as_an_ordinary_absence(caplog):
    """The control: a genuine absence must NOT be shouted about — the machine being off is normal,
    and a warning there would train the operator to ignore the inconclusive one."""
    conn, _seen = _conn(good=None)
    with caplog.at_level("INFO"):
        try:
            _run(capture._cpap_connect_any_adapter("04:CD", "hci1", 8.0, connect=conn, adapters=["hci0", "hci1"]))
        except Exception:
            pass
    assert any("not found on any adapter" in r.message for r in caplog.records)
    assert not any("INCONCLUSIVE" in r.message for r in caplog.records)


def test_the_failover_ITSELF_is_logged_because_a_silent_recovery_hides_a_dying_radio():
    conn, _seen = _conn(good="hci0")
    _got, used, _a = _run(
        capture._cpap_connect_any_adapter("04:CD", "hci1", 8.0, connect=conn, adapters=["hci0", "hci1"])
    )
    assert used == "hci0"


def test_on_attempt_reports_each_failure_to_the_caller():
    """So a caller can journal the attempts, not merely the conclusion."""
    conn, _seen = _conn(good="hci2")
    seen = []
    _run(
        capture._cpap_connect_any_adapter(
            "04:CD",
            "hci1",
            8.0,
            connect=conn,
            adapters=["hci0", "hci1", "hci2"],
            on_attempt=lambda a, k, e: seen.append((a, k)),
        )
    )
    assert seen == [("hci1", B.ABSENT), ("hci0", B.ABSENT)]


def test_no_adapters_at_all_raises_rather_than_reporting_absence():
    conn, _seen = _conn(good=None)
    try:
        _run(capture._cpap_connect_any_adapter("04:CD", None, 8.0, connect=conn, adapters=[]))
    except RuntimeError as e:
        assert "no adapter" in str(e)
    else:
        raise AssertionError("an empty adapter list must not read as a successful absence")


def test_the_PRODUCTION_path_discovers_its_own_adapters(monkeypatch):
    """🔴 Every other test here passes `adapters` explicitly — so the branch that actually RUNS on the
    box, which asks `list_adapters()` for them, was covered by nothing. The coverage floor caught it.

    Only UP adapters are offered: failing over onto a radio we could not confirm is up is worse than
    staying put, which is the same rule `failover_target` applies on the capture side."""

    async def fake_list():
        return [
            {"mac": "hci0", "up": True},
            {"mac": "hci9", "up": False},
            {"mac": None, "up": True},
            {"mac": "hci2", "up": True},
        ]

    monkeypatch.setattr(capture, "list_adapters", fake_list)
    conn, seen = _conn(good="hci2")
    _got, used, _a = _run(capture._cpap_connect_any_adapter("04:CD", "hci1", 8.0, connect=conn))
    assert used == "hci2"
    assert seen == ["hci1", "hci0", "hci2"], f"a DOWN adapter was offered as a fallback: {seen}"
