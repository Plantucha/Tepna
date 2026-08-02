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


def _stub(monkeypatch, harvest=None, up=True, calls=None, reachable=False, seen=None):
    """`reachable` defaults False so these tests keep exercising the ASSOCIATION path they were written
    for. The doubles take the same optional args the real functions grew (`root`, `addr`) — a double
    that cannot accept what the caller passes tests the double, not the caller.

    ACCEPTING an argument is not OBSERVING it, and the gap was measurable: these doubles took `root=`
    and dropped it, so `wifi_up(profile, 45.0, guard, root=root)` → `wifi_up(profile, 45.0, guard)`
    survived mutation with the suite green. That argument is the one this handler's own comment calls
    load-bearing — without it the wpa control dir falls back to /tmp, which is READ-ONLY under
    `ProtectSystem=strict`. Pass `seen=[]` to capture every argument of every call."""
    def _rec(op, **kw):
        if seen is not None:
            seen.append({"op": op, **kw})

    monkeypatch.setattr(cpap_harvest, "reachable",
                        lambda base, timeout=5.0: (_rec("reachable", base=base, timeout=timeout),
                                                   reachable)[1])
    monkeypatch.setattr(cpap_harvest, "default_route_dev", lambda: "eno1")
    monkeypatch.setattr(cpap_harvest, "wifi_up",
                        lambda p, t=45.0, g=None, ssid=None, psk=None, iface=None, addr=None, root=None:
                        (_rec("up", profile=p, timeout=t, guard=g, iface=iface, root=root),
                         calls.append(("up", g)) if calls is not None else None, up)[2])
    monkeypatch.setattr(cpap_harvest, "wifi_down",
                        lambda p, t=30.0, iface=None, root=None:
                        (_rec("down", profile=p, timeout=t, iface=iface, root=root),
                         calls.append(("down", p)) if calls is not None else None, True)[2])
    monkeypatch.setattr(cpap_harvest, "harvest",
                        harvest or (lambda *a, **k: (_rec("harvest", args=a, kw=k), _res())[1]))


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


# ── what the handler actually passes down ───────────────────────────────────────────────────────────
# The tests above prove the SEQUENCE (associate, harvest, tear down). These prove the ARGUMENTS, which
# is where the failures on real hardware have been: a dropped `root=`, a profile read from the wrong
# config key, a destination assembled from the wrong root.
def test_the_capture_root_reaches_both_wifi_calls(tmp_path):
    """`root=` is load-bearing, and the handler says so in its own comment: omitting it falls through to
    /tmp for the wpa control dir, which is READ-ONLY under ProtectSystem=strict. Measured — the
    scheduled path worked and this one failed with
    "Failed to initialize control interface '/tmp/tepna-wpa-1000'". It must reach the teardown too,
    or `wpa_cli terminate` resolves through the SYSTEM supplicant's socket directory."""
    seen = []
    app = _app(tmp_path)
    with pytest.MonkeyPatch.context() as mp:
        _stub(mp, seen=seen)
        status, _body = _post(app)
    assert status == 200
    ups = [c for c in seen if c["op"] == "up"]
    downs = [c for c in seen if c["op"] == "down"]
    assert ups and downs
    assert ups[0]["root"] == str(tmp_path), f"the capture root must reach wifi_up: {ups[0]}"
    assert downs[0]["root"] == str(tmp_path), f"…and wifi_down: {downs[0]}"


def test_the_configured_profile_and_route_guard_reach_the_association(tmp_path):
    seen = []
    app = _app(tmp_path, cpap={**CFG, "wifi_profile": "cardnet"})
    with pytest.MonkeyPatch.context() as mp:
        _stub(mp, seen=seen)
        _post(app)
    up = next(c for c in seen if c["op"] == "up")
    assert up["profile"] == "cardnet", "the profile comes from cpap.wifi_profile, not a literal"
    assert up["guard"] == "eno1", "the pre-association default route is passed as the guard"
    assert up["timeout"] == 45.0
    down = next(c for c in seen if c["op"] == "down")
    assert down["profile"] == "cardnet", "tear down the profile that was raised"


def test_the_harvest_is_aimed_at_the_configured_destination_and_base(tmp_path):
    """`dest` is root + cpap.dest_subdir, and `base` is cpap.base_url. Assembled from the wrong keys
    the pull still reports 200 with files copied — into the wrong directory, or from the wrong host."""
    seen = []
    app = _app(tmp_path, cpap={**CFG, "dest_subdir": "captures/resmed",
                               "base_url": "http://192.168.4.1"})
    with pytest.MonkeyPatch.context() as mp:
        _stub(mp, seen=seen)
        status, _ = _post(app)
    assert status == 200
    h = next(c for c in seen if c["op"] == "harvest")
    assert h["args"][0] == os.path.join(str(tmp_path), "captures/resmed")
    assert h["args"][1] == "http://192.168.4.1"
    probe = next(c for c in seen if c["op"] == "reachable")
    assert probe["base"] == "http://192.168.4.1", "the reachability probe must ask the same host"


def test_the_scope_selects_the_nights_that_are_harvested(tmp_path, monkeypatch):
    """`scope` is the whole point of the button — "last" is one night, "week" is seven. It reaches
    `nights_for`, and its answer reaches `harvest`; a scope that is accepted and then ignored looks
    identical to one that worked."""
    seen = []
    monkeypatch.setattr(cpap_harvest, "nights_for", lambda scope, now: {f"nights-for-{scope}"})
    _stub(monkeypatch, seen=seen)
    status, body = _post(_app(tmp_path), {"scope": "week"})
    assert status == 200 and body["scope"] == "week"
    h = next(c for c in seen if c["op"] == "harvest")
    assert h["args"][2] == {"nights-for-week"}


def test_the_run_is_bounded_by_the_configured_max_run_sec(tmp_path):
    """A deadline, not a duration: `harvest` takes an absolute monotonic cap. Unbounded, a card that
    stalls mid-transfer holds the interlock — and the sensors it blocks — until something else kills it."""
    import time as _t
    seen = []
    app = _app(tmp_path, cpap={**CFG, "max_run_sec": 120})
    with pytest.MonkeyPatch.context() as mp:
        _stub(mp, seen=seen)
        before = _t.monotonic()
        _post(app)
        after = _t.monotonic()
    deadline = next(c for c in seen if c["op"] == "harvest")["args"][3]
    assert before + 120 <= deadline <= after + 120, f"deadline {deadline} is not now+max_run_sec"
