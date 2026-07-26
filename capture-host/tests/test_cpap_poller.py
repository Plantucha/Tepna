"""cpap_poller / _cpap_loop — the daily-harvest task inside capture.py.

Covers the guarantees the brief makes and the ones the owner asked for explicitly: the box never loses
its default route to the card, and the association is always released when the transfer ends — including
when the run fails, when the task is cancelled, and when a previous run died mid-transfer.
"""
import asyncio
import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import capture  # noqa: E402
import cpap_harvest  # noqa: E402

CFG = {"cpap": {"enabled": True, "at_hour": 13, "wifi_profile": "ezshare"}}


def _run(coro):
    return asyncio.run(coro)


def _stop_after(monkeypatch, n=1):
    calls = {"n": 0}

    async def fake_sleep(_secs):
        calls["n"] += 1
        if calls["n"] >= n:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    return calls


class _Spy:
    """Records the association lifecycle so a test can assert it was closed, and how many times."""

    def __init__(self):
        self.up, self.down, self.guards = 0, 0, []

    def install(self, monkeypatch, up_ok=True, harvest=None, route="enp9s0"):
        monkeypatch.setattr(cpap_harvest, "default_route_dev", lambda: route)

        def _up(profile, timeout=45.0, guard_dev=None):
            self.up += 1
            self.guards.append(guard_dev)
            return up_ok

        def _down(profile, timeout=30.0):
            self.down += 1
            return True

        monkeypatch.setattr(cpap_harvest, "wifi_up", _up)
        monkeypatch.setattr(cpap_harvest, "wifi_down", _down)
        monkeypatch.setattr(cpap_harvest, "harvest", harvest or (lambda *a, **k: _res()))


def _res(**kw):
    r = {"files": 5, "bytes": 2_560_000, "skipped": 0, "nights": 1, "short": [], "errors": [],
         "partial": False, "nights_on_card": 197}
    r.update(kw)
    return r


def _at(hour=13):
    """Freeze capture's clock at a due hour."""
    class _DT(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return dt.datetime(2026, 7, 26, hour, 5)
    return _DT


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    capture._STOP.clear()
    capture._RECOVER.clear()
    capture.STATUS["devices"] = {}
    capture.STATUS.pop("cpap", None)
    yield
    capture._STOP.clear()
    capture.STATUS.pop("cpap", None)


# ── the enable gate ─────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("cfg", [{}, {"cpap": {}}, {"cpap": {"enabled": False}}])
def test_disabled_is_a_no_op(cfg):
    _run(capture.cpap_poller(cfg, "/tmp"))
    assert "cpap" not in capture.STATUS          # nothing published, nothing associated


# ── the happy path ──────────────────────────────────────────────────────────────────────────────────
def test_harvest_runs_and_publishes_status(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    st = capture.STATUS["cpap"]
    assert st["state"] == "ok" and st["files"] == 5 and st["nights_on_card"] == 197
    assert st["last_ok"] is not None


def test_it_does_not_run_before_the_hour(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at(hour=9))   # 09:00 is deliberately too early
    _stop_after(monkeypatch, 3)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.up == 0, "09:00 must not trigger a 13:00 job — see brief §3.2"
    assert capture.STATUS["cpap"]["state"] == "idle"


def test_it_runs_once_per_day_not_once_per_tick(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 6)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.up == 1


# ── the ethernet guarantee ──────────────────────────────────────────────────────────────────────────
def test_the_pre_association_default_route_is_passed_as_a_guard(tmp_path, monkeypatch):
    """wifi_up is handed the interface that carried the default route BEFORE associating, so it can
    verify the card did not steal it."""
    spy = _Spy(); spy.install(monkeypatch, route="enp9s0")
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.guards == ["enp9s0"]


def test_a_refused_association_skips_the_day_and_harvests_nothing(tmp_path, monkeypatch):
    """wifi_up returns False when the card would take the default route. The day is skipped rather
    than risking an unreachable box, and no harvest is attempted."""
    called = {"n": 0}

    def _harvest(*a, **k):
        called["n"] += 1
        return _res()

    spy = _Spy(); spy.install(monkeypatch, up_ok=False, harvest=_harvest)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert called["n"] == 0
    assert capture.STATUS["cpap"]["state"] == "error"


# ── the association is always released ──────────────────────────────────────────────────────────────
def test_association_is_released_after_a_normal_transfer(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.up == 1 and spy.down >= 2         # stale-clear on entry + close after transfer


def test_association_is_released_when_the_harvest_raises(tmp_path, monkeypatch):
    """The `finally` must fire even on an exception — otherwise a card that fails mid-run leaves the
    box associated to a network with no route out."""
    def boom(*a, **k):
        raise RuntimeError("card vanished")

    spy = _Spy(); spy.install(monkeypatch, harvest=boom)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.down >= 2
    assert capture.STATUS["cpap"]["state"] == "error"
    assert "card vanished" in capture.STATUS["cpap"]["detail"]


def test_a_stale_association_is_cleared_before_the_first_run(tmp_path, monkeypatch):
    """A previous run killed mid-transfer (SIGKILL / power cut) can leave the card associated;
    keep_running would restart this task straight into that state."""
    spy = _Spy(); spy.install(monkeypatch)
    capture._STOP.set()                          # exit immediately — only the entry teardown runs
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.down >= 1 and spy.up == 0


def test_association_is_released_on_cancellation(tmp_path, monkeypatch):
    """At shutdown the task is cancelled mid-flight. The teardown is shielded so it still completes —
    an unshielded await would be cancelled too, stranding exactly what it exists to prevent."""
    spy = _Spy(); spy.install(monkeypatch)

    async def go():
        t = asyncio.create_task(capture.cpap_poller(CFG, str(tmp_path)))
        await asyncio.sleep(0)
        t.cancel()
        with pytest.raises(asyncio.CancelledError):
            await t

    _run(go())
    assert spy.down >= 1


# ── interlocks ──────────────────────────────────────────────────────────────────────────────────────
def test_a_streaming_sensor_defers_without_consuming_the_day(tmp_path, monkeypatch):
    """The day's slot must NOT be burned: it retries each tick until the sensor comes off, otherwise a
    late-sleeping user silently loses that night."""
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    capture.STATUS["devices"]["Polar H10"] = {"connected": True}
    _stop_after(monkeypatch, 4)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.up == 0
    st = capture.STATUS["cpap"]
    assert st["state"] == "waiting" and "Polar H10" in st["detail"]


def test_adapter_recovery_blocks_the_harvest(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    capture._RECOVER.set()
    _stop_after(monkeypatch, 3)
    try:
        _run(capture.cpap_poller(CFG, str(tmp_path)))
    finally:
        capture._RECOVER.clear()
    assert spy.up == 0


# ── result classification ───────────────────────────────────────────────────────────────────────────
def test_short_reads_are_an_error_not_a_success(tmp_path, monkeypatch):
    """A truncated EDF parses far enough to look real, so a half-arrived night must never read as ok."""
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(short=["BRP.edf: 2229KB, got 90KB"]))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    st = capture.STATUS["cpap"]
    assert st["state"] == "error" and st["last_ok"] is None and st["short"]


def test_a_deadline_capped_run_is_partial_not_failed(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(partial=True))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert capture.STATUS["cpap"]["state"] == "partial"


def test_fetch_errors_are_surfaced(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(errors=["STR.EDF: timeout"]))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert capture.STATUS["cpap"]["state"] == "error"


def test_an_empty_pull_is_logged_loudly(tmp_path, monkeypatch, caplog):
    """Zero files AND zero skips means the card was unreachable — the IDENTITY_FIELDS lesson: never let
    'did nothing' read as 'nothing to do'."""
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(files=0, skipped=0, nights=0))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    with caplog.at_level("WARNING"):
        _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert any("pulled NOTHING" in r.message for r in caplog.records)
