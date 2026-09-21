# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The passive-scan filter (2026-09-20). BlueZ passive-scans only through `or_patterns`; bleak refused
every patternless passive request at construction, so each "passive" window since 09-05 was ACTIVE and
the refusal was re-learned by every daemon process. These pin: the filter is a superset radio filter and
not an identity check; it rides the SAME `bluez` dict as the adapter pin (a second `bluez=` would drop
the pin); both scan sites downgrade on either refusal class and log WHICH knob is missing; and a real
scan error is still raised, never masked by a second scan on the same radio."""
import asyncio
import logging

import pytest

import capture
import oxy_presence as OP
from test_capture_runners import _clean_stop, _run  # noqa: F401 — autouse: resets _STOP/STATUS per test


# ── the filter spec ──────────────────────────────────────────────────────────────────────────────
def test_the_spec_is_the_MEASURED_flags_and_manufacturer_id_plus_the_documented_recording_id():
    """From the ring's own ADV_IND (2026-09-05 air capture, docked + connected): Flags 0x06, manufacturer
    0xF34E. 0x036F is O2RING-PROTOCOL §6's recording-mode id, documented not measured. Nothing guessed."""
    spec = OP.passive_or_pattern_spec()
    assert spec == [(0, 0x01, b"\x06"), (0, 0xFF, b"\x4e\xf3"), (0, 0xFF, b"\x6f\x03")]
    assert OP.PASSIVE_FLAG_BYTES == (0x06,) and OP.PASSIVE_MFR_CIDS == (0xF34E, 0x036F)
    flags = [(o, t, p) for o, t, p in spec if t == OP.AD_TYPE_FLAGS]
    mfr = [(o, t, p) for o, t, p in spec if t == OP.AD_TYPE_MANUFACTURER]
    assert len(spec) == len(flags) + len(mfr)
    # no pattern carries anything that could be read as a device address — identity is not here
    assert all(len(p) <= 2 for _, _, p in spec)
    import probe_ring_adv
    assert set(OP.PASSIVE_MFR_CIDS) == set(probe_ring_adv.MFR_HYPOTHESES), "one source for the ring's CID hypotheses"


@pytest.mark.parametrize("exc, want", [
    (Exception("passive scanning mode requires bluez or_patterns"), "or_patterns"),
    (Exception("passive scanning on Linux requires BlueZ >= 5.56 with --experimental enabled and Linux kernel >= 5.10"), "experimental"),
    (Exception("Passive mode not supported"), "passive"),
    (Exception("org.bluez.Error.InProgress: Operation already in progress"), None),
    (Exception("adapter hci1 not found"), None),
])
def test_passive_refusal_names_the_missing_knob_and_never_swallows_a_real_error(exc, want):
    assert OP.passive_refusal(exc) == want


# ── the kwargs: filter INSIDE the adapter pin's bluez dict ───────────────────────────────────────
def test_passive_scan_kw_keeps_the_adapter_pin_beside_the_patterns():
    from bleak.args.bluez import OrPattern
    kw = capture._passive_scan_kw({"bluez": {"adapter": "hci2"}})
    assert kw["scanning_mode"] == "passive"
    assert kw["bluez"]["adapter"] == "hci2", "the pin must survive — losing it lands the scan on the onboard radio"
    pats = kw["bluez"]["or_patterns"]
    assert len(pats) == len(OP.passive_or_pattern_spec()) and all(isinstance(p, OrPattern) for p in pats)
    assert (pats[0].start_position, int(pats[0].ad_data_type), pats[0].content_of_pattern) == (0, 0x01, b"\x06")
    assert capture._passive_scan_kw({})["bluez"].keys() == {"or_patterns"}, "no pin ⇒ patterns alone"


# ── _connect_scan: both refusal classes downgrade, the class is logged, the patterns were sent ───
def _refuser(found, calls, message):
    from bleak.exc import BleakError
    async def find(*a, **k):
        calls.append((k.get("scanning_mode"), sorted((k.get("bluez") or {}).keys())))
        if k.get("scanning_mode") == "passive":
            raise BleakError(message)
        return found
    return find


@pytest.mark.parametrize("message, why", [
    ("passive scanning mode requires bluez or_patterns", "or_patterns"),
    ("passive scanning on Linux requires BlueZ >= 5.56 with --experimental enabled and Linux kernel >= 5.10", "experimental"),
])
def test_connect_scan_sends_or_patterns_and_names_the_refusal_class_when_downgrading(monkeypatch, caplog, message, why):
    import bleak
    class _Dev:
        address = "D1:98:62:7C:92:B3"; name = "S8-AW"
    calls = []
    class _BC:
        def __init__(self, dev, **kw): pass
        async def connect(self): pass
        async def disconnect(self): pass
    monkeypatch.setattr(capture, "_O2_PASSIVE_SCAN", True)
    monkeypatch.setattr(bleak.BleakScanner, "find_device_by_filter", _refuser(_Dev(), calls, message))
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    async def pinned(): return {"bluez": {"adapter": "hci1"}}
    monkeypatch.setattr(capture, "adapter_kw", pinned)

    async def go():
        async with capture._connect_scan("D1:98:62:7C:92:B3"):
            pass
    with caplog.at_level(logging.INFO, logger=capture.log.name):
        _run(go())
    assert calls == [("passive", ["adapter", "or_patterns"]), (None, ["adapter"])], \
        "passive request carried the patterns AND the pin; the active retry carried the pin alone"
    assert capture._O2_PASSIVE_SCAN is False
    line = [r.getMessage() for r in caplog.records if "passive BLE scan unsupported" in r.getMessage()]
    assert len(line) == 1 and f"[{why}]" in line[0]


def test_connect_scan_still_raises_a_non_passive_error(monkeypatch):
    import bleak
    from bleak.exc import BleakError
    calls = []
    monkeypatch.setattr(capture, "_O2_PASSIVE_SCAN", True)
    monkeypatch.setattr(bleak.BleakScanner, "find_device_by_filter",
                        _refuser(None, calls, "org.bluez.Error.InProgress: Operation already in progress"))
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)

    async def go():
        async with capture._connect_scan("D1:98:62:7C:92:B3"):
            pass
    with pytest.raises(BleakError):
        _run(go())
    assert calls == [("passive", ["or_patterns"])], "no second scan on the same broken radio"
    assert capture._O2_PASSIVE_SCAN is True, "a real error is not a refusal — passive is not given up"


# ── the observer's bleak factory: exercised once, with the same stub ─────────────────────────────
def _observer_factory(monkeypatch, message):
    """Run `_maybe_start_presence_scan`'s default scan_factory (the bleak edge) against a stub
    BleakScanner.discover that refuses passive like BlueZ, and return what it was asked."""
    import bleak
    calls = []
    class _Dev:
        address = "D1:98:62:7C:92:B3"; name = "S8-AW"
    async def discover(timeout=None, **k):
        calls.append((k.get("scanning_mode"), sorted((k.get("bluez") or {}).keys())))
        if k.get("scanning_mode") == "passive":
            from bleak.exc import BleakError
            raise BleakError(message)
        return [_Dev()]
    monkeypatch.setattr(bleak.BleakScanner, "discover", discover)
    async def pinned(): return {"bluez": {"adapter": "hci1"}}
    monkeypatch.setattr(capture, "adapter_kw", pinned)
    return calls


def test_the_observer_factory_sends_or_patterns_downgrades_and_names_the_class(monkeypatch, caplog):
    captured = {}
    def create_task(coro):
        captured["coro"] = coro
        class _T:
            def done(self): return False
            def cancel(self): pass
        return _T()
    monkeypatch.setattr(capture, "_O2_PASSIVE_SCAN", True)
    calls = _observer_factory(monkeypatch, "passive scanning on Linux requires BlueZ >= 5.56 with --experimental enabled")
    cfg = {"o2ring": {"presence_harvest": {"enabled": True, OP.COEXISTENCE_KEY: True, "window_sec": 0.01}},
           "devices": [{"vendor": "Wellue", "address": "D1:98:62:7C:92:B3"}]}
    # Intercept the loop so the bleak-edge factory the wiring built is handed to us instead of run.
    async def fake_loop(*, addresses, window_s, scan, **kw):
        captured["scan"] = scan
    monkeypatch.setattr(capture, "_presence_scan_loop", fake_loop)
    monkeypatch.setattr(capture, "keep_running", lambda factory, *a, **k: factory())
    got = capture._maybe_start_presence_scan(cfg, [], create_task=create_task)
    assert got is not None and "coro" in captured, "armed config ⇒ the observer task is created"
    asyncio.run(captured["coro"])
    scan = captured.get("scan")
    assert scan is not None, "the loop received the bleak-edge factory"
    with caplog.at_level(logging.INFO, logger=capture.log.name):
        seen = asyncio.run(scan(0.01))
    assert calls == [("passive", ["adapter", "or_patterns"]), (None, ["adapter"])]
    assert "D1:98:62:7C:92:B3" in seen
    assert capture._O2_PASSIVE_SCAN is False
    line = [r.getMessage() for r in caplog.records if "presence observer using active scan" in r.getMessage()]
    assert len(line) == 1 and "[experimental]" in line[0]
