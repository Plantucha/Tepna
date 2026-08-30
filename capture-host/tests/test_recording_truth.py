# tepna-capture — tests/test_recording_truth.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE NIGHT OF 2026-07-29. The H10's BlueZ bond went stale at 22:57. `ensure_bonded`'s re-pair removed
# it and could not re-establish it, leaving `Paired: no`. From 23:48 the task connected and was torn
# down every ~70 s — for four and a half hours — writing nothing. Two independent defects turned a bond
# glitch into a lost night, and each is fixed here:
#
#   1. THE ALERT LIED. It keyed on `connected`, which is momentarily TRUE inside every doomed
#      connect->drop cycle, so the operator was told:
#
#          23:54 offline -> 00:18 RECONNECTED -> 00:24 offline -> 00:51 RECONNECTED
#          00:57 offline -> 03:31 RECONNECTED -> 03:37 offline -> 03:42 RECONNECTED -> 03:48 offline
#
#      Four "recovered" notices and not one byte after 23:48. A total outage read as resolved blips.
#      `connected` is not `recording` — the same lesson cpap_harvest.blocking_devices already learned
#      ("a sensor on its charger reports connected=True while producing nothing").
#
#   2. NOTHING EVER RE-BONDED. The bond ran once, before the reconnect loop, on a comment that had held
#      for a year: "reconnects after a transient drop reuse the stored bond, so we don't re-bond in the
#      loop". When the bond is GONE rather than transiently dropped, that makes the state terminal.

import asyncio

import pytest

import alerts
import capture
from tests._srcscan import block_source, module_source, suite_tail


@pytest.fixture(autouse=True)
def _clean():
    capture._STOP = asyncio.Event()
    capture._RECOVER = asyncio.Event()
    capture._OXYII_PAUSE = asyncio.Event()
    capture._CONNECT_LOCK = asyncio.Lock()
    capture._POLAR_PAUSED.clear()
    capture._LAST_DATA.clear()
    capture._CFG.clear()
    capture.STATUS.clear()
    capture.STATUS["devices"] = {}
    yield
    capture._STOP.set()
    capture._STOP.clear()
    capture._LAST_DATA.clear()


# ---------------------------------------------------------------- recording != connected

def test_a_link_with_no_data_is_NOT_recording():
    """The exact 2026-07-29 state: connected, but nothing has ever arrived."""
    assert alerts.device_is_recording(True, None, now=1000.0, grace_sec=120) is False


def test_a_link_whose_data_went_stale_is_NOT_recording():
    """It streamed, then stopped, while the link stayed up — the 4h25m freeze shape."""
    assert alerts.device_is_recording(True, 800.0, now=1000.0, grace_sec=120) is False


def test_a_link_with_fresh_data_IS_recording():
    assert alerts.device_is_recording(True, 950.0, now=1000.0, grace_sec=120) is True


def test_data_exactly_at_the_grace_boundary_still_counts():
    """Inclusive, so a device sampling right at the limit does not flicker in and out of alarm."""
    assert alerts.device_is_recording(True, 880.0, now=1000.0, grace_sec=120) is True


def test_disconnected_is_never_recording_however_fresh_the_data():
    """Guards the obvious inversion: recent bytes must not excuse a dropped link."""
    assert alerts.device_is_recording(False, 999.0, now=1000.0, grace_sec=120) is False


# ---------------------------------------------------------------- the data hook

def test_note_data_stamps_the_device():
    """The caller passes the clock reading. Reading it inside would waste a call on a per-second hot
    path AND perturb the stall tests, which drive a stateful fake clock that advances on every read."""
    capture.note_data("H10", 4242.0)
    assert capture._LAST_DATA["H10"] == 4242.0


def test_every_stream_path_reports_its_data():
    """A predicate fed by nothing is worse than no predicate — it reports "not recording" forever and
    the alarm never clears. Both the Polar aggregate-flow hook and BOTH O2Ring row paths must call it."""
    src = module_source("capture.py")
    assert src.count("note_data(name,") >= 3, \
        "expected the Polar flow hook plus both O2Ring row paths to stamp data arrival"
    # Bounded on the BLOCK, not a byte window. The claim is a LOCALITY one — the flow check itself
    # must stamp — and the enclosing function `run_polar` is 73 771 chars, so bounding on the function
    # would widen this 184x and let it pass on any `note_data(` in a 900-line function. A byte window
    # is a guess at where the block ends; the block is a property of the code.
    assert "note_data(name," in block_source("capture.py", "if flowed:"), \
        "the Polar per-second flow check must stamp it"


def test_the_alert_loop_keys_on_recording_not_connected():
    src = module_source("capture.py")
    assert "alerts.device_is_recording(" in src, "the alert loop must consult the predicate"
    assert "if recording:" in src, "…and branch on it rather than on `connected`"
    assert "recording again" in src, "the recovery message must claim recording, not merely a link"


def test_the_offline_message_names_which_failure_it_is():
    """"offline" and "linked but recording nothing" want different operator responses — a flat battery
    versus a bond failure. Saying "offline" for a strap that is right there, connecting every 70 s,
    sends them looking for the wrong thing."""
    src = module_source("capture.py")
    assert 'linked but recording nothing' in src


# ---------------------------------------------------------------- re-bonding a lost bond

def test_rebond_is_due_when_the_bond_is_gone():
    assert capture.rebond_due(True, bonded=False, iteration=5, attempts=0, every=5, limit=60) is True


def test_a_healthy_bond_costs_nothing():
    """BlueZ is the authority; a bonded device must never drive a bluetoothctl subprocess."""
    assert capture.rebond_due(True, bonded=True, iteration=5, attempts=0, every=5, limit=60) is False


def test_only_every_nth_reconnect_tries():
    """Bonding takes seconds. Retrying on every ~70 s reconnect would spend more time pairing than
    capturing."""
    assert capture.rebond_due(True, False, iteration=4, attempts=0, every=5, limit=60) is False
    assert capture.rebond_due(True, False, iteration=5, attempts=0, every=5, limit=60) is True


def test_attempts_are_capped():
    """A bond that can never take must stop costing subprocesses by morning."""
    assert capture.rebond_due(True, False, iteration=5, attempts=60, every=5, limit=60) is False


def test_the_cap_still_spans_a_whole_night():
    """The 2026-07-29 loss needed a retry FOUR HOURS after the bond went stale. A short burst of
    attempts would have been exhausted long before the operator touched the strap."""
    seconds_covered = capture._REBOND_LIMIT * capture._REBOND_EVERY * 70
    assert seconds_covered >= 6 * 3600, \
        f"re-bond budget spans only {seconds_covered / 3600:.1f} h — too short to survive a night"


def test_hr_only_devices_are_never_bonded():
    """The SIG Heart Rate characteristic needs no authentication, and most third-party straps cannot
    pair at all — bonding one fails and reports a scary "bond failed" for a device about to work fine."""
    assert capture.rebond_due(False, bonded=False, iteration=5, attempts=0, every=5, limit=60) is False


def test_every_zero_disables_rebonding():
    """The escape hatch has to actually escape."""
    assert capture.rebond_due(True, False, iteration=5, attempts=0, every=0, limit=60) is False


def test_the_rebond_is_wired_before_connect():
    """Pairing needs the device's own BLE link, so it can only happen before the session opens —
    the same constraint the clock write has."""
    src = module_source("capture.py")
    loop = src.index("    while not _STOP.is_set():", src.index("async def run_polar"))
    call = src.index("if rebond_due(", loop)
    connect = src.index("async with _connect(addr)", loop)
    assert call < connect, "re-bonding must precede the connection, not run inside the session"


def test_run_polar_re_pairs_a_lost_bond_mid_session(tmp_path, monkeypatch):
    """Driven through the real runner, because a predicate nothing reaches saves nobody.

    The link is refused so each attempt costs one sleep, letting the loop reach the 5th iteration where
    the cadence fires — a successful session would exhaust `_stop_after`'s budget first."""
    from tests.test_capture_runners import _polar_common, _stop_after, _pdev
    _polar_common(monkeypatch)
    capture._CFG.clear()
    capture._CFG.update({"time": {"auto_sync_devices": False}})
    forced = []

    async def not_bonded(addr, adapter=None):
        return False

    async def rebond(addr, adapter=None, *, force=False):
        forced.append(force)
        return True

    def refuse(addr, *a, **k):
        raise OSError("le-connection-abort-by-local")

    monkeypatch.setattr(capture.bonding, "is_bonded", not_bonded)
    monkeypatch.setattr(capture.bonding, "ensure_bonded", rebond)
    monkeypatch.setattr(capture, "_connect", refuse)
    _stop_after(monkeypatch, 6)
    asyncio.run(capture.run_polar(_pdev(), str(tmp_path)))
    assert forced and forced[-1] is True, \
        "a lost bond must be re-paired with force=True — a plain ensure_bonded no-ops on a stale entry"


def test_run_polar_does_NOT_re_pair_a_healthy_bond(tmp_path, monkeypatch):
    """The inverse control. Without it the test above passes on a runner that re-pairs unconditionally,
    which would drive a bluetoothctl subprocess every few reconnects all night."""
    from tests.test_capture_runners import _polar_common, _stop_after, _pdev
    _polar_common(monkeypatch)
    capture._CFG.clear()
    capture._CFG.update({"time": {"auto_sync_devices": False}})
    calls = []

    async def bonded(addr, adapter=None):
        return True

    async def rebond(addr, adapter=None, *, force=False):
        calls.append(force)
        return True

    def refuse(addr, *a, **k):
        raise OSError("le-connection-abort-by-local")

    monkeypatch.setattr(capture.bonding, "is_bonded", bonded)
    monkeypatch.setattr(capture.bonding, "ensure_bonded", rebond)
    monkeypatch.setattr(capture, "_connect", refuse)
    _stop_after(monkeypatch, 6)
    asyncio.run(capture.run_polar(_pdev(), str(tmp_path)))
    assert True not in calls, "a bonded device must never be force-re-paired"


def test_a_rebond_failure_is_surfaced_not_swallowed(tmp_path, monkeypatch):
    """The operator has to learn the strap needs attention — this is the state that cost 2026-07-29."""
    from tests.test_capture_runners import _polar_common, _stop_after, _pdev
    _polar_common(monkeypatch)
    capture._CFG.clear()
    capture._CFG.update({"time": {"auto_sync_devices": False}})

    async def not_bonded(addr, adapter=None):
        return False

    async def fails(addr, adapter=None, *, force=False):
        return False

    def refuse(addr, *a, **k):
        raise OSError("le-connection-abort-by-local")

    errors = []
    real_set = capture._set
    monkeypatch.setattr(capture, "_set",
                        lambda n, **kw: (errors.append(kw["last_error"]) if "last_error" in kw else None,
                                         real_set(n, **kw))[1])
    monkeypatch.setattr(capture.bonding, "is_bonded", not_bonded)
    monkeypatch.setattr(capture.bonding, "ensure_bonded", fails)
    monkeypatch.setattr(capture, "_connect", refuse)
    _stop_after(monkeypatch, 6)
    asyncio.run(capture.run_polar(_pdev(), str(tmp_path)))
    # Asserted on the SEQUENCE, not the final value: the failing connection that follows overwrites
    # `last_error` a moment later, so the end state would hide it.
    assert any("bond lost" in str(e) for e in errors), \
        "a failed re-pair must tell the operator the strap needs attention"


def test_a_raising_bond_check_never_kills_the_capture_task(tmp_path, monkeypatch):
    """bluetoothctl is a subprocess on a flaky bus. It must never take the session down with it."""
    from tests.test_capture_runners import _polar_common, _stop_after, _pdev
    _polar_common(monkeypatch)
    capture._CFG.clear()
    capture._CFG.update({"time": {"auto_sync_devices": False}})

    async def boom(addr, adapter=None):
        raise RuntimeError("dbus went away")

    def refuse(addr, *a, **k):
        raise OSError("le-connection-abort-by-local")

    monkeypatch.setattr(capture.bonding, "is_bonded", boom)
    monkeypatch.setattr(capture, "_connect", refuse)
    _stop_after(monkeypatch, 6)
    asyncio.run(capture.run_polar(_pdev(), str(tmp_path)))   # must simply return, not raise


def test_a_successful_rebond_restores_the_full_budget():
    """A later, unrelated bond loss must get the whole retry budget again rather than inheriting a
    half-spent one from hours earlier."""
    # `suite_tail`, not `block_source`: the anchor is a log line and the property is on its NEXT
    # SIBLING at the same indentation, so the block it "opens" is one line. Same reason as the flow
    # check above — a byte window spans whichever of those two shapes happens to fit in 300 chars.
    assert "rebond_attempts = 0" in suite_tail("capture.py", "re-bonded — PMD should hold again")
