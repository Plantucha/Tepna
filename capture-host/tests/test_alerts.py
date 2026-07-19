# tepna-capture — tests/test_alerts.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

import alerts


def _run(coro):
    return asyncio.run(coro)


def test_notifier_disabled_without_a_url():
    n = alerts.Notifier(url=None, enabled=True)
    assert n.enabled is False
    assert _run(n.send("t", "m")) is False        # disabled → never posts


def test_notifier_disabled_when_flag_off():
    n = alerts.Notifier(url="https://x", enabled=False)
    assert n.enabled is False
    assert _run(n.send("t", "m")) is False


def test_notifier_sends_via_the_injected_poster():
    sent = []
    async def fake_post(url, payload): sent.append((url, payload)); return True
    n = alerts.Notifier(url="https://hook", enabled=True, _post=fake_post)
    assert _run(n.send("Title", "Body")) is True
    assert sent == [("https://hook", {"title": "Title", "message": "Body"})]


def test_notifier_dedupes_within_the_window():
    calls = {"n": 0}
    async def fake_post(url, payload): calls["n"] += 1; return True
    n = alerts.Notifier(url="https://hook", enabled=True, _post=fake_post)
    assert _run(n.send("t", "m", key="H10", dedupe_sec=60, now=100.0)) is True
    assert _run(n.send("t", "m", key="H10", dedupe_sec=60, now=130.0)) is False   # 30 s < 60 s → suppressed
    assert _run(n.send("t", "m", key="H10", dedupe_sec=60, now=200.0)) is True    # window elapsed → fires
    assert calls["n"] == 2


def test_notifier_reset_reopens_the_dedupe_window():
    calls = {"n": 0}
    async def fake_post(url, payload): calls["n"] += 1; return True
    n = alerts.Notifier(url="https://hook", enabled=True, _post=fake_post)
    _run(n.send("t", "m", key="H10", dedupe_sec=60, now=100.0))
    n.reset("H10")
    assert _run(n.send("t", "m", key="H10", dedupe_sec=60, now=110.0)) is True     # reset → immediate re-fire
    assert calls["n"] == 2


def test_notifier_swallows_a_poster_exception():
    async def boom(url, payload): raise RuntimeError("network down")
    n = alerts.Notifier(url="https://hook", enabled=True, _post=boom)
    assert _run(n.send("t", "m")) is False        # a webhook failure must never propagate


def test_offline_alert_due():
    assert alerts.offline_alert_due(None, 100.0, 300) is False       # connected → never due
    assert alerts.offline_alert_due(100.0, 200.0, 300) is False      # 100 s < 300 s
    assert alerts.offline_alert_due(100.0, 500.0, 300) is True       # 400 s ≥ 300 s


def _serve(handler):
    """Run a one-route aiohttp server and POST to it via the REAL _http_post, returning its verdict."""
    async def go():
        app = web.Application(); app.router.add_post("/hook", handler)
        srv = TestServer(app); cl = TestClient(srv); await cl.start_server()
        try:
            url = str(cl.make_url("/hook"))
            return await alerts._http_post(url, {"title": "T", "message": "M"})
        finally:
            await cl.close()
    return _run(go())


def test_http_post_returns_true_on_2xx():
    got = {}
    async def handler(req):
        got["body"] = await req.json()
        return web.json_response({"ok": True})     # 200
    assert _serve(handler) is True
    assert got["body"] == {"title": "T", "message": "M"}


def test_http_post_returns_false_on_5xx():
    async def handler(req):
        return web.Response(status=503)
    assert _serve(handler) is False
