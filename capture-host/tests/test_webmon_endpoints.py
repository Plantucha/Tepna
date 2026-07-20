# tepna-capture — tests/test_webmon_endpoints.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The webmon endpoints not exercised by test_webmon_api.py: the index page, scan/bond/forget, the clock
# surface (get/set/sync/tz), timesync_all, the Polar recordings/pull path, the SSE keep-alive, and
# start(). Each stubs only the module boundary it crosses (bonding / clockcfg / polar_psftp), so no BLE
# or root privilege is touched. Driven with the same TestServer pattern as test_webmon_api.

import asyncio

import bonding
import telemetry
import webmon
from aiohttp.test_utils import TestClient, TestServer

from tests.test_webmon_api import H10, RING, _mk, _serve


import pytest


@pytest.fixture(autouse=True)
def _no_real_bluetoothctl(monkeypatch):
    """Every _polar_run calls bonding.ensure_bonded, which shells out to bluetoothctl (~23 s of real
    scan/pair). Stub it fast for the whole module — these are HTTP-surface tests, not bonding tests."""
    async def fake_bond(*a, **k): return True
    async def fake_sync(*a, **k): return {"ok": True}
    monkeypatch.setattr(webmon.bonding, "ensure_bonded", fake_bond)
    monkeypatch.setattr(webmon.clockcfg, "sync_now", fake_sync)   # host sync in timesync_all


def test_index_serves_the_monitor_page(tmp_path):
    app, *_ = _mk(tmp_path)
    async def go(c):
        r = await c.get("/")
        return r.status, await r.text()
    status, body = _serve(app, go)
    assert status == 200 and "Tepna Vigil" in body


def test_scan_bond_forget(tmp_path, monkeypatch):
    async def fake_scan(*a, **k):
        return [bonding.Found("11:22:33:44:55:66", "Polar H10", rssi=-50, health=True)]
    async def fake_bond(*a, **k): return {"ok": True, "detail": "paired", "address": a[0]}
    async def fake_forget(*a, **k): return {"ok": True, "address": a[0]}
    monkeypatch.setattr(webmon.bonding, "scan", fake_scan)
    monkeypatch.setattr(webmon.bonding, "bond", fake_bond)
    monkeypatch.setattr(webmon.bonding, "forget", fake_forget)
    app, cfg, *_ = _mk(tmp_path)

    async def go(c):
        s = await (await c.post("/api/scan", json={})).json()
        b = await (await c.post("/api/bond", json={"address": "11:22:33:44:55:66"})).json()
        f = await (await c.post("/api/forget", json={"address": H10["address"]})).json()
        return s, b, f
    s, b, f = _serve(app, go)
    assert (s["found"] if isinstance(s, dict) else s)[0]["address"] == "11:22:33:44:55:66"
    assert b["ok"] is True and f["ok"] is True


def test_clock_endpoints(tmp_path, monkeypatch):
    async def status(): return {"available": True, "synchronized": True, "timezone": "UTC"}
    async def set_ntp(servers, poll, sudo=True): return {"ok": True, "servers": servers}
    async def sync_now(sudo=True): return {"ok": True}
    async def set_tz(zone, sudo=True): return {"ok": True, "timezone": zone}
    for n, f in [("status", status), ("set_ntp", set_ntp), ("sync_now", sync_now), ("set_tz", set_tz)]:
        monkeypatch.setattr(webmon.clockcfg, n, f)
    app, *_ = _mk(tmp_path)

    async def go(c):
        g = await (await c.get("/api/clock")).json()
        n = await (await c.post("/api/clock", json={"servers": "pool.ntp.org", "poll_max_sec": 1024})).json()
        s = await (await c.post("/api/clock/sync", json={})).json()
        t = await (await c.post("/api/clock/tz", json={"timezone": "Europe/Prague"})).json()
        return g, n, s, t
    g, n, s, t = _serve(app, go)
    assert g["synchronized"] is True and n["ok"] and s["ok"] and t["timezone"] == "Europe/Prague"


def test_timesync_all_summarises_every_device(tmp_path, monkeypatch):
    async def sync_now(sudo=True): return {"ok": True}
    monkeypatch.setattr(webmon.clockcfg, "sync_now", sync_now)
    async def sync_time(addr): return {"ok": True, "address": addr}
    app, *_ = _mk(tmp_path, devices=[H10, RING], sync_time=sync_time)

    async def go(c):
        return await (await c.post("/api/timesync/all", json={})).json()
    out = _serve(app, go)
    assert out["host"]["ok"] is True
    names = [d.get("address") or d.get("name") for d in out["devices"]]
    assert H10["address"] in names or "H10" in str(out["devices"])


def test_timesync_all_records_a_host_sync_failure(tmp_path, monkeypatch):
    async def boom(sudo=True): raise RuntimeError("no ntp")
    monkeypatch.setattr(webmon.clockcfg, "sync_now", boom)
    app, *_ = _mk(tmp_path, devices=[H10])
    async def go(c):
        return await (await c.post("/api/timesync/all", json={})).json()
    assert _serve(app, go)["host"]["ok"] is False


def test_polar_recordings_lists_via_the_offline_path(tmp_path, monkeypatch):
    async def fake_list(address, adapter=None):
        return [{"session": "/U/0/1/", "size": 1234}]
    monkeypatch.setattr(webmon.polar_psftp, "list_recordings", fake_list)
    async def pause(addr, fn): return await fn()
    app, *_ = _mk(tmp_path, polar_pause=pause)

    async def go(c):
        r = await c.get("/api/polar/recordings", params={"address": H10["address"]})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True and body["recordings"][0]["size"] == 1234


def test_polar_pull_downloads_via_the_offline_path(tmp_path, monkeypatch):
    async def fake_pull(address, session, out_dir, adapter=None, on_progress=None):
        return {"files": [out_dir + "/x.dat"]}
    monkeypatch.setattr(webmon.polar_psftp, "pull_recording", fake_pull)
    async def pause(addr, fn): return await fn()
    app, *_ = _mk(tmp_path, polar_pause=pause)

    async def go(c):
        r = await c.post("/api/polar/pull", json={"address": H10["address"], "session": "/U/0/1/"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True


def test_polar_run_without_a_pause_hook_runs_directly(tmp_path, monkeypatch):
    """When the daemon supplies no polar_pause, _polar_run must still execute the op directly."""
    async def fake_list(address, adapter=None): return [{"session": "/U/0/1/", "size": 1}]
    monkeypatch.setattr(webmon.polar_psftp, "list_recordings", fake_list)
    app, *_ = _mk(tmp_path, polar_pause=None)
    async def go(c):
        r = await c.get("/api/polar/recordings", params={"address": H10["address"]})
        return r.status
    assert _serve(app, go) == 200


def test_settings_rejects_rates_for_an_unknown_device(tmp_path):
    app, *_ = _mk(tmp_path)
    async def go(c):
        r = await c.post("/api/settings", json={"rates": {"00:00:00:00:00:00": {"acc": 50}}})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and "unknown device" in body["error"]


def test_timesync_reports_unavailable_for_a_polar_without_a_sync_hook(tmp_path):
    app, *_ = _mk(tmp_path, devices=[H10], sync_time=None)
    async def go(c):
        r = await c.post("/api/timesync", json={"address": H10["address"]})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and "unavailable" in body["error"]


def test_timesync_surfaces_a_busy_offline_slot(tmp_path):
    import offline_lock
    async def busy(addr): raise offline_lock.OfflineBusy("Polar H10")
    app, *_ = _mk(tmp_path, devices=[H10], sync_time=busy)
    async def go(c):
        r = await c.post("/api/timesync", json={"address": H10["address"]})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 409 and body["busy"] == "Polar H10"


def test_polar_recordings_surfaces_a_generic_error_as_502(tmp_path, monkeypatch):
    async def boom(a, adapter=None): raise RuntimeError("psftp died")
    monkeypatch.setattr(webmon.polar_psftp, "list_recordings", boom)
    app, *_ = _mk(tmp_path, polar_pause=None)          # direct path, no pause wrapper
    async def go(c):
        r = await c.get("/api/polar/recordings", params={"address": H10["address"]})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 502 and "psftp died" in body["error"]


def test_polar_pull_surfaces_a_generic_error_as_502(tmp_path, monkeypatch):
    async def boom(a, s, o, adapter=None, on_progress=None): raise RuntimeError("pull died")
    monkeypatch.setattr(webmon.polar_psftp, "pull_recording", boom)
    app, *_ = _mk(tmp_path, polar_pause=None)
    async def go(c):
        r = await c.post("/api/polar/pull", json={"address": H10["address"], "session": "/U/0/1/"})
        return r.status
    assert _serve(app, go) == 502


def test_timesync_all_records_a_per_device_error(tmp_path):
    async def boom(addr): raise RuntimeError("device died")
    app, *_ = _mk(tmp_path, devices=[H10], sync_time=boom)
    async def go(c):
        return await (await c.post("/api/timesync/all", json={})).json()
    out = _serve(app, go)
    assert any("error" in d for d in out["devices"])


def test_pull_stored_surfaces_a_generic_error_as_502(tmp_path):
    async def boom(which, ftype): raise RuntimeError("pull exploded")
    app, *_ = _mk(tmp_path, pull_stored=boom)
    async def go(c):
        r = await c.post("/api/pull", json={})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 500 and "pull exploded" in str(body)


def test_polar_pull_surfaces_a_busy_slot_as_409(tmp_path, monkeypatch):
    import offline_lock
    async def busy(a, s, o, adapter=None, on_progress=None): raise offline_lock.OfflineBusy("H10")
    monkeypatch.setattr(webmon.polar_psftp, "pull_recording", busy)
    async def pause(addr, fn): return await fn()
    app, *_ = _mk(tmp_path, polar_pause=pause)
    async def go(c):
        r = await c.post("/api/polar/pull", json={"address": H10["address"], "session": "/U/0/1/"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 409 and body["busy"] == "H10"


def test_start_binds_and_cleans_up(tmp_path):
    app, *_ = _mk(tmp_path)

    async def go():
        runner = await webmon.start(app, "127.0.0.1", 0)   # port 0 = any free port
        assert runner is not None
        await runner.cleanup()
    asyncio.run(go())


def test_polar_recordings_surfaces_a_busy_slot_as_409(tmp_path, monkeypatch):
    import offline_lock
    async def busy(a, adapter=None): raise offline_lock.OfflineBusy("H10")
    monkeypatch.setattr(webmon.polar_psftp, "list_recordings", busy)
    app, *_ = _mk(tmp_path, polar_pause=None)
    async def go(c):
        r = await c.get("/api/polar/recordings", params={"address": H10["address"]})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 409 and body["busy"] == "H10"


def test_timesync_all_names_a_synced_polar(tmp_path):
    async def sync_time(addr): return {"ok": True, "address": addr}
    app, *_ = _mk(tmp_path, devices=[H10], sync_time=sync_time)
    async def go(c):
        return await (await c.post("/api/timesync/all", json={})).json()
    out = _serve(app, go)
    assert any(d.get("name") == "H10" for d in out["devices"])


def test_pull_malformed_body_is_tolerated(tmp_path):
    async def puller(which, ftype): return {"files": []}
    app, *_ = _mk(tmp_path, pull_stored=puller)
    async def go(c):
        r = await c.post("/api/pull", data=b"{bad json", headers={"Content-Type": "application/json"})
        return r.status
    assert _serve(app, go) == 200        # malformed body -> defaults, not a 500


def test_polar_pull_reports_progress(tmp_path, monkeypatch):
    seen = {}
    async def fake_pull(address, session, out_dir, adapter=None, on_progress=None):
        if on_progress:
            on_progress(50, 100)          # drives the _prog closure (line 392-393)
            seen["fired"] = True
        return {"files": []}
    monkeypatch.setattr(webmon.polar_psftp, "pull_recording", fake_pull)
    app, *_ = _mk(tmp_path, polar_pause=None)
    async def go(c):
        r = await c.post("/api/polar/pull", json={"address": H10["address"], "session": "/U/0/1/"})
        return r.status
    assert _serve(app, go) == 200 and seen.get("fired")   # the progress callback executed


def test_settings_save_failure_is_swallowed(tmp_path):
    """_save() must never raise into the handler — an unwritable config path is caught."""
    app, cfg, _st, _p, _bus = _mk(tmp_path)
    # point cfg_path at a directory so open(path,'w') raises -> the _save except
    app2 = webmon.make_app(_bus, cfg, str(tmp_path), "AA", {"devices": {}}, None)  # cfg_path IS a dir
    async def go(c):
        r = await c.post("/api/settings", json={"settings": {"watchdog.interval_sec": 90}})
        return r.status
    from aiohttp.test_utils import TestServer, TestClient
    async def serve():
        srv = TestServer(app2); cl = TestClient(srv); await cl.start_server()
        try:
            r = await cl.post("/api/settings", json={"settings": {"watchdog.interval_sec": 90}})
            return r.status
        finally:
            await cl.close()
    assert asyncio.run(serve()) == 200      # save failed silently, request still succeeded


def test_sse_stream_forwards_a_pushed_frame():
    """Drive the /api/stream SSE forward path (dequeue -> filter -> write), then disconnect."""
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        app, _cfg, _st, _p, bus = _mk(__import__("pathlib").Path(d))

        async def go():
            srv = TestServer(app); cl = TestClient(srv); await cl.start_server()
            try:
                resp = await cl.get("/api/stream/hr")           # single-stream key
                await resp.content.readuntil(b"\n\n")            # the initial snapshot frame
                bus.push("hr", [72], fs=1.0)                     # a matching frame -> forwarded (L130)
                bus.push("acc", [1, 2, 3], fs=50.0)              # a non-matching frame -> filtered (L128)
                bus.push("hr", [73], fs=1.0)
                data = await asyncio.wait_for(resp.content.readuntil(b"\n\n"), timeout=2)
                return data
            finally:
                await cl.close()                                # disconnect -> CancelledError caught
        frame = asyncio.run(go())
        assert b"data:" in frame and b"72" in frame


# ── web-control auth (optional shared-secret on the POST control surface) ──────────────────────────────
def _mk_token(tmp_path, token):
    """An app whose config sets web.token, so the auth middleware is armed."""
    cfg = {"root": str(tmp_path), "clock": {"sudo": False},
           "web": {"token": token}, "devices": [dict(H10)]}
    st = {"host_clock": {"source": "ntp"}, "devices": {}}
    app = webmon.make_app(telemetry.TelemetryBus(), cfg, str(tmp_path / "config.yaml"),
                          "AA:AA:AA:AA:AA:AA", st, None)
    return app


_GOOD_BODY = {"settings": {"watchdog.interval_sec": 90}}   # a valid settings POST (200 when authorized)


def test_auth_allows_a_post_with_the_right_token_header(tmp_path):
    app = _mk_token(tmp_path, "s3cret")
    async def go(c):
        r = await c.post("/api/settings", json=_GOOD_BODY, headers={"X-Tepna-Token": "s3cret"})
        return r.status
    assert _serve(app, go) == 200


def test_auth_allows_a_post_with_a_bearer_token(tmp_path):
    app = _mk_token(tmp_path, "s3cret")
    async def go(c):
        r = await c.post("/api/settings", json=_GOOD_BODY, headers={"Authorization": "Bearer s3cret"})
        return r.status
    assert _serve(app, go) == 200


def test_auth_rejects_a_post_with_no_token(tmp_path):
    app = _mk_token(tmp_path, "s3cret")
    async def go(c):
        r = await c.post("/api/settings", json=_GOOD_BODY)
        return r.status
    assert _serve(app, go) == 401


def test_auth_rejects_a_post_with_the_wrong_token(tmp_path):
    app = _mk_token(tmp_path, "s3cret")
    async def go(c):
        r = await c.post("/api/settings", json=_GOOD_BODY, headers={"X-Tepna-Token": "nope"})
        return r.status
    assert _serve(app, go) == 401


def test_auth_leaves_get_reads_open(tmp_path):
    app = _mk_token(tmp_path, "s3cret")
    async def go(c):
        r = await c.get("/api/state")          # a GET read needs no token, even with auth armed
        return r.status
    assert _serve(app, go) == 200


def test_no_token_configured_leaves_posts_open(tmp_path):
    app, *_ = _mk(tmp_path)                     # default cfg has no web.token → middleware is a pass-through
    async def go(c):
        r = await c.post("/api/settings", json=_GOOD_BODY)
        return r.status
    assert _serve(app, go) == 200


def test_state_surfaces_storage_and_qc_blocks(tmp_path):
    """/api/state exposes the guardrail pollers' storage + qc blocks so the monitor can render them."""
    st = {"host_clock": {"source": "ntp"}, "devices": {},
          "storage": {"free_gb": 12.3, "free_pct": 41.0, "low": False, "keep_nights": 30},
          "qc": {"night": "2026-07-19", "ok": False, "missing": ["H10:acc"], "total_rows": 5}}
    cfg = {"root": str(tmp_path), "clock": {"sudo": False}, "devices": [dict(H10)]}
    app = webmon.make_app(telemetry.TelemetryBus(), cfg, str(tmp_path / "config.yaml"),
                          "AA:AA:AA:AA:AA:AA", st, None)
    async def go(c):
        r = await c.get("/api/state")
        return await r.json()
    body = _serve(app, go)
    assert body["storage"]["free_gb"] == 12.3 and body["qc"]["missing"] == ["H10:acc"]


def test_state_storage_and_qc_absent_before_the_pollers_run(tmp_path):
    app, *_ = _mk(tmp_path)                     # default status has neither block yet
    async def go(c):
        return await (await c.get("/api/state")).json()
    body = _serve(app, go)
    assert body["storage"] is None and body["qc"] is None


def test_sse_stream_survives_an_abrupt_client_disconnect():
    """A browser tab yanked mid-stream (socket reset, no graceful close) must not raise out of the
    handler — the write into the dead socket is caught and the subscriber unregistered. Distinct from
    the shutdown path, where the daemon ends the stream deliberately."""
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        app, _cfg, _st, _p, bus = _mk(__import__("pathlib").Path(d))

        async def go():
            srv = TestServer(app); cl = TestClient(srv); await cl.start_server()
            try:
                resp = await cl.get("/api/stream/_all")
                await resp.content.readuntil(b"\n\n")        # snapshot received; stream is live
                resp.close()                                  # ABRUPT: reset the connection, server up
                for _ in range(30):                           # keep writing into the dead socket
                    bus.push("hr", [70], fs=1.0)
                    await asyncio.sleep(0.01)
            finally:
                await cl.close()
        asyncio.run(go())                                     # must not raise
