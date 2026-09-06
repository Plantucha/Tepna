# tepna-capture — tests/test_charging_state.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The `charging` device flag. It used to be set in exactly ONE place — the PMD START rejection path
# (status 0x0D in_charger) — which can only fire for a device that was ALREADY on the dock when the
# daemon tried to connect. A device put on charge MID-SESSION keeps its BLE link, so no START is
# attempted, so nothing ever noticed: measured 2026-07-19, a Verity climbed 35 % -> 61 % while the
# monitor reported charging=False the whole way, and an O2Ring reached 77 % with its own batt_state flag
# set to 1 in the sidecar. Two devices visibly charging, neither flagged.

import pytest

import oxyii
import telemetry
from tests._srcscan import module_source


def test_the_ring_reports_its_own_charge_state():
    """batt_state is the device's OWN flag (0 = not charging), so the ring needs no inference."""
    payload = bytes(20)
    live = oxyii.parse_live(payload)
    assert live is not None and "batt_state" in live, "parse_live must surface batt_state"


def test_ring_charge_flag_is_read_from_batt_state_not_inferred():
    src = module_source("capture.py")
    assert 'charging=bool(live.get("batt_state"))' in src, \
        "the O2Ring must take charging from its own batt_state, not from a battery trend"
    assert src.count('charging=bool(live.get("batt_state"))') == 2, \
        "both the worn and the NOT-worn path must report charge state — the ring keeps its link on the dock"


def test_polar_charge_is_inferred_from_a_RISING_battery():
    """A Polar exposes no charge flag mid-session. A battery that rises is unambiguous — these cells do
    not self-charge — and a battery that falls means it came off the dock."""
    src = module_source("capture.py")
    assert "lvl > prev" in src and "charging=True" in src
    assert "lvl < prev" in src and "charging=False" in src, \
        "coming off the dock must clear the flag, or it latches on forever"


def test_the_monitor_pill_describes_data_not_the_link():
    """The card said `live` whenever the stream was `active`, which means started — not delivering. On
    2026-07-19 seven of twelve streams read `live` at effFs 0.0."""
    html = open(__file__.replace("tests/test_charging_state.py", "monitor.html"), encoding="utf-8").read()
    assert "function streamState(" in html
    for state in ("charging", "not worn", "no data", "weak", "idle"):
        assert f"'{state}'" in html or f'"{state}"' in html, f"pill must be able to report {state!r}"
    assert "s.health === 'stall'" in html, "the pill must consult health, not just active"
    assert html.count("streamState(s") >= 2, "used on first render AND on the in-place refresh"


def test_the_pill_styles_exist_for_every_class_it_emits():
    """A class with no CSS renders as unstyled text — the state would be reported but invisible."""
    html = open(__file__.replace("tests/test_charging_state.py", "monitor.html"), encoding="utf-8").read()
    for cls in ("live", "warn", "chg"):
        assert f".ov-head .st.{cls}{{" in html, f"missing style for .st.{cls}"


def test_not_worn_and_charging_are_amber_or_blue_never_red():
    """These are NORMAL states — the user isn't wearing the sensor. Red would cry fault at an expected
    condition and train people to ignore the colour that should mean something is genuinely broken."""
    html = open(__file__.replace("tests/test_charging_state.py", "monitor.html"), encoding="utf-8").read()
    warn = html.split(".ov-head .st.warn{")[1].split("}")[0]
    chg = html.split(".ov-head .st.chg{")[1].split("}")[0]
    assert "--amber" in warn and "--red" not in warn
    assert "--blue" in chg and "--red" not in chg


# ── THE HOLE THE RISING RULE CANNOT REACH: a battery already at 100 % ───────────────────────────────
# The tests above are source scans. This one EXECUTES, because the defect it covers is a wiring
# question — does a `True` from the predicate actually reach the flag — and a scan cannot answer that.

@pytest.mark.sets_capture_events
def test_a_FULL_flat_battery_sets_charging_where_the_rising_rule_is_blind(tmp_path, monkeypatch):
    """A full cell has nowhere to rise to, so `lvl > prev` can never fire at 100 %. Measured
    2026-08-14: the Verity streamed 80 min at 176 Hz with `battery` pinned at 100 and `charging` False
    the whole time, so the contact bit's `worn: True` stood unopposed and the not-worn drop could never
    fire — an armband on a dock, indistinguishable from a wrist.

    The RULE (how long flat, at what level) is tested exhaustively and purely in
    `test_worn_detectors.py`. What this asserts is the part a pure test cannot: that a `True` from it
    reaches `charging`, on the second battery read, when the level has not moved."""
    import asyncio
    import sys as _sys

    _sys.path.insert(0, __import__("os").path.dirname(__file__))
    import capture
    import test_capture_runners as T

    capture._STOP = asyncio.Event()
    T._polar_common(monkeypatch)
    # The predicate is stubbed rather than time-travelled: advancing `_time.monotonic` past 45 min
    # would also trip the 90 s stall watchdog and end the session before the second read.
    # Patched at `note_flat_battery` rather than at `full_battery_implies_charging`: the clock now lives
    # in a module-level store so it can survive reconnects, and the predicate is called from telemetry's
    # namespace, where a patch on `capture.` cannot reach it.
    monkeypatch.setattr(capture, "note_flat_battery", lambda *_a, **_k: True)
    c = T.FlexPolarClient(data_frames=[T._ppg_frame()], batt_level=100)
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 130)          # past `secs % 120` → a SECOND battery read
    asyncio.run(capture.run_polar(T._pdev(streams=["ppg"]), str(tmp_path)))
    st = capture.STATUS["devices"][T._pdev(streams=["ppg"])["name"]]
    assert st.get("battery") == 100, f"the fixture reads 100; the flat path needs prev == lvl: {st}"
    assert st.get("charging") is True, (
        f"a full, unmoving battery must set charging — this is the case `lvl > prev` cannot see: {st}")


@pytest.mark.sets_capture_events
def test_a_full_battery_that_has_NOT_been_flat_long_enough_sets_nothing(tmp_path, monkeypatch):
    """The complement, and the one that keeps the rule from becoming "at 100 % assume a charger".

    A device unplugged at full reads 100 for the first minutes too. If a short flat stretch set the
    flag, every session that began on a fully-charged strap would declare itself docked and drop the
    link — the expensive error, made for the cheap reason."""
    import asyncio
    import sys as _sys

    _sys.path.insert(0, __import__("os").path.dirname(__file__))
    import capture
    import test_capture_runners as T

    capture._STOP = asyncio.Event()
    T._polar_common(monkeypatch)
    # Same seam move as the positive case above: the predicate is now reached through
    # `note_flat_battery`, whose store outlives the connection.
    monkeypatch.setattr(capture, "note_flat_battery", lambda *_a, **_k: False)
    c = T.FlexPolarClient(data_frames=[T._ppg_frame()], batt_level=100)
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 130)
    asyncio.run(capture.run_polar(T._pdev(streams=["ppg"]), str(tmp_path)))
    st = capture.STATUS["devices"][T._pdev(streams=["ppg"])["name"]]
    assert st.get("battery") == 100
    assert st.get("charging") is not True, (
        f"a full battery alone is not a charger — only a full battery that has not MOVED is: {st}")


# ── the flat-battery clock must OUTLIVE the connection ──────────────────────────────────────────────
_FLAT = telemetry._BATT_FLAT_CHARGING_S


def test_flat_clock_starts_on_first_sight_and_claims_nothing_yet():
    store = {}
    assert telemetry.note_flat_battery(store, "V", None, 100, 1000.0) is False
    assert store["V"] == 1000.0


def test_flat_clock_does_not_fire_before_the_window():
    store = {"V": 1000.0}
    assert telemetry.note_flat_battery(store, "V", 100, 100, 1000.0 + _FLAT - 1) is False


def test_flat_clock_fires_once_the_window_passes():
    store = {"V": 1000.0}
    assert telemetry.note_flat_battery(store, "V", 100, 100, 1000.0 + _FLAT + 1) is True


def test_a_moving_battery_restarts_the_clock():
    store = {"V": 1000.0}
    assert telemetry.note_flat_battery(store, "V", 100, 99, 5000.0) is False
    assert store["V"] == 5000.0


def test_below_full_never_fires_however_long_it_sits():
    """The rising rule owns that range; flatness lower down is a slow drain and a coarse step at once."""
    store = {"V": 1000.0}
    assert telemetry.note_flat_battery(store, "V", 80, 80, 1000.0 + 10 * _FLAT) is False


def test_THE_CLOCK_SURVIVES_RECONNECTS():
    """⚠️ THE REGRESSION THIS FIX EXISTS FOR, and the old code could not pass it.

    The clock used to be a local inside `run_polar`'s `async with _connect(...)` block, so every dropped
    link reset it. A docked device is precisely one that keeps dropping its link — measured 2026-08-15,
    the Verity reconnected at 10:03 / 10:10 / 10:15 / 10:20 while streaming noise at 176 Hz with battery
    pinned at 100 and `charging` False throughout. 45 min of UNINTERRUPTED connection is exactly what the
    scenario denies, so the guard was correct, wired, and structurally unreachable.

    Here the store is owned by the caller and outlives the connection, so five short sessions add up."""
    store = {}
    t = 1000.0
    telemetry.note_flat_battery(store, "V", None, 100, t)          # session 1 opens
    fired = []
    for session in range(1, 6):                                     # five ~10-minute sessions
        for tick in range(10):
            t += 60.0
            fired.append(telemetry.note_flat_battery(store, "V", 100, 100, t))
        # the link drops here; nothing in this loop touches `store`, which is the whole point
    assert any(fired), "the clock never reached the window across reconnects — the bug is back"
    assert fired.index(True) * 60 >= _FLAT - 60, "fired too early to be the real window"


def test_a_reset_store_reproduces_the_OLD_broken_behaviour():
    """The counterfactual, so the test above cannot pass for an unrelated reason: clearing the store at
    each reconnect — what the connection-scoped local did — never reaches the window."""
    t = 1000.0
    fired = []
    for session in range(5):
        store = {}                                                  # ← the old per-connection local
        telemetry.note_flat_battery(store, "V", None, 100, t)
        for tick in range(10):
            t += 60.0
            fired.append(telemetry.note_flat_battery(store, "V", 100, 100, t))
    assert not any(fired), "the counterfactual fired, so the regression test proves nothing"
