# tepna-capture — tests/test_alerts.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
import asyncio

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


def test_offline_alert_suppressed():
    """Known answers. Only an OPTIONAL device that never joined stays quiet.

    The real 2026-07-29 case: a COOSPO strap nobody was wearing made the box contradict itself six
    minutes apart — "optional backup device not present — keeping a quiet eye out", then "has been
    offline for ~5 min — capture is missing it" plus a webhook, on every service start."""
    assert alerts.offline_alert_suppressed(True, False) is True    # optional, never joined → quiet
    assert alerts.offline_alert_suppressed(True, True) is False    # optional but WAS contributing → alert
    assert alerts.offline_alert_suppressed(False, False) is False  # required and absent → the whole point
    assert alerts.offline_alert_suppressed(False, True) is False
    # `optional` arrives straight from YAML, so absent/None must read as "not optional" — a required
    # device silently demoted to quiet would be the worst possible way to get this wrong.
    assert alerts.offline_alert_suppressed(None, False) is False


# ── mutation-audit leads, 2026-08-02 (tools/mutate.py) ───────────────────────────────────────────────
# alerts.py measured 87/110 mutants killed at 100% statement+branch coverage. Two survivors were real
# gaps rather than untestable noise, and both are on the fail-safe side of the module — the side that
# decides whether a box with no webhook configured stays silent. Each test below kills one named mutant.

def test_a_notifier_constructed_without_a_flag_defaults_to_DISABLED():
    """Kills Notifier.__init__ `enabled: bool = False` → `True`.

    Every existing test passes `enabled=` explicitly, so nothing pinned the DEFAULT — and the default
    is what stands between "no webhook configured" (the shipped state, and the box's state until
    2026-08-01) and every install quietly attempting POSTs. A caller that forgets the kwarg must get
    silence, not traffic."""
    n = alerts.Notifier(url="https://hook")
    assert n.enabled is False, "the default must be OFF — opt in to sending, never opt out"
    assert _run(n.send("t", "m")) is False


def test_un_keyed_alerts_do_not_dedupe_against_each_other():
    """Kills Notifier.send `key is not None and dedupe_sec > 0` → `or`.

    With `or`, a `key=None` alert enters the dedupe block and stores itself under the None key — so the
    NEXT un-keyed alert, of an entirely different kind, is suppressed as a repeat of it. Two unrelated
    events collapse into one delivery. Dedupe is supposed to be opt-in per key; without a key there is
    nothing to dedupe against."""
    sent = []

    async def fake_post(url, payload):
        sent.append(payload["title"])
        return True

    n = alerts.Notifier(url="https://hook", enabled=True, _post=fake_post)
    assert _run(n.send("disk low", "m", dedupe_sec=300, now=1000.0)) is True
    assert _run(n.send("sensor offline", "m", dedupe_sec=300, now=1001.0)) is True
    assert sent == ["disk low", "sensor offline"], (
        f"an un-keyed alert suppressed an unrelated one: {sent}"
    )
