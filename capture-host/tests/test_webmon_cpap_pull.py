"""POST /api/cpap/pull — the operator's manual CPAP harvest.

The scheduled poller owns the 13:00 window; this is "do it now" for a missed night or a swapped card.
It must enforce the SAME interlock as the poller — a button is not a reason to put a 2.4 GHz
transmitter beside a recording sensor (measured 2026-07-26: 5-7 dB and 17 reconnects across three).
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cpap_harvest  # noqa: E402
from tests.test_webmon_api import _mk, _serve  # noqa: E402

CFG = {"enabled": True, "at_hour": 13, "wifi_profile": "ezshare", "dest_subdir": "captures/cpap"}


def _res(**kw):
    r = {"files": 5, "bytes": 2_560_000, "skipped": 0, "nights": 1,
         "short": [], "errors": [], "partial": False, "nights_on_card": 197}
    r.update(kw)
    return r


def _app(tmp_path, cpap=CFG, status=None):
    app, cfg, *rest = _mk(tmp_path, status=status)
    if cpap is not None:
        cfg["cpap"] = dict(cpap)
    return app


def _post(app, body=None):
    async def go(c):
        r = await c.post("/api/cpap/pull", json=body if body is not None else {})
        return r.status, await r.json()
    return _serve(app, go)


def _stub(monkeypatch, harvest=None, up=True, calls=None, reachable=False):
    """`reachable` defaults False so these tests keep exercising the ASSOCIATION path they were written
    for. The doubles take the same optional args the real functions grew (`root`, `addr`) — a double
    that cannot accept what the caller passes tests the double, not the caller."""
    monkeypatch.setattr(cpap_harvest, "reachable", lambda base, timeout=5.0: reachable)
    monkeypatch.setattr(cpap_harvest, "default_route_dev", lambda: "eno1")
    monkeypatch.setattr(cpap_harvest, "wifi_up",
                        lambda p, t=45.0, g=None, ssid=None, psk=None, iface=None, addr=None, root=None:
                        (calls.append(("up", g)) if calls is not None else None) or up)
    monkeypatch.setattr(cpap_harvest, "wifi_down",
                        lambda p, t=30.0, iface=None, root=None: (calls.append(("down", p)) if calls is not None else None) or True)
    monkeypatch.setattr(cpap_harvest, "harvest", harvest or (lambda *a, **k: _res()))


# ── refusals ────────────────────────────────────────────────────────────────────────────────────────
def test_400_when_the_harvest_is_disabled(tmp_path):
    status, body = _post(_app(tmp_path, cpap={"enabled": False}))
    assert status == 400 and "disabled" in body["error"]


def test_400_on_an_unknown_scope(tmp_path):
    status, body = _post(_app(tmp_path), {"scope": "everything"})
    assert status == 400 and "unknown scope" in body["error"]


def test_409_while_a_sensor_is_streaming(tmp_path, monkeypatch):
    """Same rule as the poller. 409 not 500: the box is working exactly as intended."""
    _stub(monkeypatch)
    app = _app(tmp_path, status={"Polar H10": {"connected": True}})
    status, body = _post(app, {"scope": "last"})
    assert status == 409 and body["busy"] == ["Polar H10"] and "streaming" in body["error"]


def test_a_charging_sensor_does_not_block_the_button(tmp_path, monkeypatch):
    """`connected` is not `streaming` — a docked sensor produces nothing. This is the state the box
    was actually in when the button first refused wrongly (2026-07-26)."""
    _stub(monkeypatch)
    app = _app(tmp_path, status={
        "Polar Verity Sense": {"connected": True, "charging": True},
        "Wellue O2Ring-S": {"connected": True, "charging": True, "worn": False}})
    status, body = _post(app, {"scope": "last"})
    assert status == 200 and body["files"] == 5


# ── the happy paths ─────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("scope", ["last", "week", "missing"])
def test_each_scope_runs_and_reports(tmp_path, monkeypatch, scope):
    _stub(monkeypatch)
    status, body = _post(_app(tmp_path), {"scope": scope})
    assert status == 200 and body["scope"] == scope and body["ok"] is True


def test_scope_defaults_to_missing(tmp_path, monkeypatch):
    """No body = "pull whatever I am missing", the safe default: skip-if-present means it fetches only
    what is absent, so an accidental press cannot cost a full re-download."""
    _stub(monkeypatch)
    status, body = _post(_app(tmp_path))
    assert status == 200 and body["scope"] == "missing"


def test_the_association_is_raised_with_a_route_guard_and_always_released(tmp_path, monkeypatch):
    calls = []
    _stub(monkeypatch, calls=calls)
    _post(_app(tmp_path), {"scope": "last"})
    assert ("up", "eno1") in calls, calls          # the pre-association route is passed as the guard
    assert any(c[0] == "down" for c in calls)      # and dropped afterwards


def test_association_released_even_when_the_harvest_raises(tmp_path, monkeypatch):
    calls = []

    def boom(*a, **k):
        raise RuntimeError("card vanished")
    _stub(monkeypatch, harvest=boom, calls=calls)
    status, body = _post(_app(tmp_path), {"scope": "last"})
    assert status == 500 and "card vanished" in body["error"]
    assert any(c[0] == "down" for c in calls), "a failed pull must not strand the association"


def test_a_refused_association_is_reported_not_raised(tmp_path, monkeypatch):
    _stub(monkeypatch, up=False)
    status, body = _post(_app(tmp_path), {"scope": "last"})
    assert status == 200 and body["ok"] is False and "associate" in body["error"]


def test_short_reads_make_the_result_not_ok(tmp_path, monkeypatch):
    """A truncated EDF parses far enough to look real, so a half-arrived night must never read ok."""
    _stub(monkeypatch, harvest=lambda *a, **k: _res(short=["BRP.edf: 2229KB, got 90KB"]))
    status, body = _post(_app(tmp_path), {"scope": "last"})
    assert status == 200 and body["ok"] is False and body["short"]


def test_the_result_is_published_to_api_state(tmp_path, monkeypatch):
    """The card reads from status, so a manual pull must update it exactly as the poller does."""
    _stub(monkeypatch)
    app = _app(tmp_path)

    # Both requests in ONE _serve: each call runs its own asyncio.run, and reusing an aiohttp app
    # across two loops raises "Application instance initialized with different loop".
    async def go(c):
        await c.post("/api/cpap/pull", json={"scope": "last"})
        r = await c.get("/api/state")
        return (await r.json()).get("cpap")
    st = _serve(app, go)
    assert st["state"] == "ok" and st["files"] == 5 and st["nights_on_card"] == 197


def test_a_second_concurrent_pull_is_refused_not_queued(tmp_path, monkeypatch):
    """One card, one Wi-Fi association, one destination tree. Two overlapping harvests would fight for
    all three, so the second is refused outright — the same "one at a time" rule offline_lock enforces
    for BLE pulls. Refusing is honest; queueing would make a button press mean "sometime later"."""
    import asyncio
    _stub(monkeypatch)
    app = _app(tmp_path)
    started, release = asyncio.Event(), asyncio.Event()

    def slow(*a, **k):                      # runs in a worker thread via asyncio.to_thread
        loop.call_soon_threadsafe(started.set)
        asyncio.run_coroutine_threadsafe(_wait(), loop).result(timeout=5)
        return _res()

    async def _wait():
        await release.wait()

    monkeypatch.setattr(cpap_harvest, "harvest", slow)
    loop = None

    async def go(c):
        nonlocal loop
        loop = asyncio.get_running_loop()
        first = asyncio.create_task(c.post("/api/cpap/pull", json={"scope": "last"}))
        await asyncio.wait_for(started.wait(), 5)          # first pull is genuinely in flight
        r2 = await c.post("/api/cpap/pull", json={"scope": "last"})
        second = (r2.status, await r2.json())
        release.set()
        await first
        return second

    status, body = _serve(app, go)
    assert status == 409 and "already running" in body["error"]


def test_a_reachable_card_is_pulled_without_associating(tmp_path, monkeypatch):
    """The manual pull must follow the SAME two rules as the scheduled loop. A station-mode card needs
    no Wi-Fi work at all, and a manual path that behaves differently from the nightly one is a trap for
    whoever is debugging at 2am."""
    calls = []
    _stub(monkeypatch, calls=calls, reachable=True)
    status, body = _post(_app(tmp_path), {"scope": "missing"})
    assert status == 200 and body["ok"] is True
    assert not any(c[0] == "up" for c in calls), "a reachable card must not be associated to"
    assert not any(c[0] == "down" for c in calls), "…and nothing torn down that was never brought up"
