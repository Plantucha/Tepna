# tepna-capture — tests/test_clock_resync_on_reconnect.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The device clock used to be written exactly ONCE, before the reconnect loop. Two consequences, both
# observed on the real box in the week to 2026-07-29:
#
#   1. A device that was on its CHARGER at task start never got a usable clock for the rest of the
#      session, however many times it reconnected afterwards. That is the common case, not a corner —
#      the sensors sit on the dock all day and the daemon is already running when they come off.
#      `clock auto-sync gave up — device stayed unreachable/busy` appeared 21x in one week.
#
#   2. `clock_watchdog` kept re-syncing a DOCKED device on its 5-minute cadence. A docked Polar refuses
#      PMD outright ("charging — PMD streams unavailable", status 0x0D) and will not take a clock write
#      either, so the skew never moved, the give-up budget burned down, and the device was marked
#      `clock_uncorrectable` for the whole session. Measured: Verity at −5.0 s, re-syncs logged at
#      05:01 / 05:06 / 05:12, given up 05:17 — i.e. immediately after it went on the dock. Worse, the
#      give-up was STICKY across the very event that fixes it: coming off the charger and syncing
#      cleanly did not clear it.
#
# The fix re-syncs on every reconnect, skips charging devices entirely, and lets a fresh sync forgive
# the watchdog's history.

import asyncio
import capture


# ---------------------------------------------------------------- the pure predicate

def test_resync_is_due_on_a_reconnect():
    """The whole point: a LATER connection attempt re-writes the clock."""
    assert capture.clock_sync_due(True, True, charging=False, first_attempt=False) is True


def test_no_resync_on_the_first_attempt():
    """The pre-loop sync already ran; repeating it immediately would pause capture for nothing."""
    assert capture.clock_sync_due(True, True, charging=False, first_attempt=True) is False


def test_never_resync_a_charging_device():
    """A docked Polar cannot take the write — attempting it only burns the give-up budget."""
    assert capture.clock_sync_due(True, True, charging=True, first_attempt=False) is False


def test_charging_none_is_treated_as_not_charging():
    """`charging` is absent until something observes it; unknown must not block the sync."""
    assert capture.clock_sync_due(True, True, charging=None, first_attempt=False) is True


def test_non_polar_and_disabled_never_sync():
    """PS-FTP is Polar-only, and the operator can turn auto-sync off."""
    assert capture.clock_sync_due(False, True, charging=False, first_attempt=False) is False
    assert capture.clock_sync_due(True, False, charging=False, first_attempt=False) is False


def test_predicate_is_pure():
    """No I/O, no globals — it is called on the hot reconnect path."""
    for _ in range(3):
        assert capture.clock_sync_due(True, True, False, False) is True
        assert capture.clock_sync_due(True, True, True, False) is False


# ---------------------------------------------------------------- the sync helper

def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_a_successful_sync_clears_uncorrectable_and_publishes_the_address(monkeypatch):
    """Both halves matter: the flag is what the operator sees, the set is what the watchdog reads."""
    seen = {}
    monkeypatch.setattr(capture, "sync_device_time", lambda addr: asyncio.sleep(0))
    monkeypatch.setattr(capture, "_set", lambda name, **kw: seen.update(kw))
    capture._CLOCK_FRESHLY_SYNCED.discard("AA:BB")

    assert _run(capture.auto_sync_clock("Verity", "AA:BB")) is True
    assert seen.get("clock_uncorrectable") is False, "a fresh sync must retract the uncorrectable verdict"
    assert seen.get("clock_synced"), "and must record when it happened"
    assert "AA:BB" in capture._CLOCK_FRESHLY_SYNCED, "the watchdog learns about it through this set"
    capture._CLOCK_FRESHLY_SYNCED.discard("AA:BB")


def test_a_failed_sync_claims_nothing(monkeypatch):
    """The inverse control — otherwise the test above would pass on a function that always reports OK."""
    async def boom(addr):
        raise RuntimeError("no such characteristic")
    seen = {}
    monkeypatch.setattr(capture, "sync_device_time", boom)
    monkeypatch.setattr(capture, "_set", lambda name, **kw: seen.update(kw))
    capture._CLOCK_FRESHLY_SYNCED.discard("CC:DD")

    assert _run(capture.auto_sync_clock("H10", "CC:DD")) is False
    assert "CC:DD" not in capture._CLOCK_FRESHLY_SYNCED, "a failure must not forgive the watchdog history"
    assert seen.get("clock_uncorrectable") is not False, "and must not retract an uncorrectable verdict"


def test_busy_is_waited_out_not_surrendered_to(monkeypatch):
    """Contention for the single offline slot is not a failure — two sensors start at once."""
    calls = {"n": 0}

    async def busy_then_ok(addr):
        calls["n"] += 1
        if calls["n"] < 3:
            raise capture.offline_lock.OfflineBusy()

    real_sleep = asyncio.sleep          # capture BEFORE patching — capture.asyncio IS asyncio, so a
                                        # lambda calling asyncio.sleep would patch itself into recursion
    monkeypatch.setattr(capture, "sync_device_time", busy_then_ok)
    monkeypatch.setattr(capture, "_set", lambda name, **kw: None)
    monkeypatch.setattr(capture.asyncio, "sleep", lambda *_a, **_k: real_sleep(0))
    capture._CLOCK_FRESHLY_SYNCED.discard("EE:FF")

    assert _run(capture.auto_sync_clock("Verity", "EE:FF")) is True
    assert calls["n"] == 3, "it must retry through OfflineBusy, not give up on the first collision"
    capture._CLOCK_FRESHLY_SYNCED.discard("EE:FF")


# ---------------------------------------------------------------- wiring, asserted on the source

def _src():
    import os
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return open(os.path.join(here, "capture.py"), encoding="utf-8").read()


def test_the_resync_is_wired_into_the_reconnect_loop():
    """A predicate nothing calls is decoration. It must be consulted per iteration, and BEFORE
    `_connect` — the PS-FTP write needs the device's single BLE link, so inside the connected session
    it would deadlock against the pause only run_polar can grant."""
    src = _src()
    assert "if clock_sync_due(" in src, "clock_sync_due must gate a real call site"
    loop = src.index("    while not _STOP.is_set():", src.index("async def run_polar"))
    call = src.index("if clock_sync_due(", loop)
    connect = src.index("async with _connect(addr)", loop)
    assert call < connect, "the re-sync must happen before the link is established, not inside the session"


def test_the_watchdog_leaves_a_charging_device_alone():
    """The give-up budget must not burn down against a device that structurally cannot be written."""
    src = _src()
    wd = src.index("async def clock_watchdog")
    body = src[wd:wd + 4000]
    assert 'if st.get("charging"):' in body, "clock_watchdog must skip docked devices"
    assert body.index('if st.get("charging"):') < body.index("clock_resync_reason("), \
        "the charging skip must come BEFORE the re-sync decision, or the budget still burns"


def test_the_watchdog_forgives_a_freshly_synced_device():
    """The sticky give-up was the actual defect: coming off the dock and syncing cleanly did not
    clear `clock_uncorrectable`, so the device stayed written off for the whole session."""
    src = _src()
    wd = src.index("async def clock_watchdog")
    body = src[wd:wd + 4000]
    assert "_CLOCK_FRESHLY_SYNCED" in body, "the watchdog must drain the fresh-sync set"
    assert "gave_up.discard(addr)" in body
    assert "seen.pop(addr, None)" in body, \
        "it must also re-baseline `seen`, or the corrected skew reads as a JUMP and re-syncs again"


def test_the_first_sync_still_happens_before_the_loop():
    """Regression guard on the fix itself: moving the sync into the loop must not have removed the
    task-start sync, or a device that never reconnects would run the whole night unsynced."""
    src = _src()
    fn = src.index("async def run_polar")
    loop = src.index("    while not _STOP.is_set():", fn)
    assert "await auto_sync_clock(name, addr)" in src[fn:loop], \
        "the pre-loop first sync must survive"
