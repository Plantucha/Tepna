# tepna-capture — tests/test_alerts.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
import types
import sys
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


# ── _http_post: the bound and the accepted status range ─────────────────────────────────────────────
# `Notifier._post` is injectable, so every existing test replaces it — which means the ONE function
# that actually talks to the network was never executed by anything. Its timeout and its status test
# were entirely unobserved.

def test_the_webhook_post_is_bounded_and_only_2xx_counts_as_delivered(monkeypatch):
    """Two separate things, both invisible from `send()`'s return value.

    THE BOUND. A webhook is an operator-supplied URL that may be a black hole; unbounded, the POST
    parks a task inside the capture daemon forever. It is set in TWO places — the ClientTimeout and the
    session that receives it — and dropping either leaves aiohttp's default (5 minutes, or none).

    THE RANGE. 2xx is delivered; 3xx is NOT. A redirect means the webhook moved, and reporting that as
    delivered latches the caller and tells the operator nothing was wrong — the same
    silently-lost-alert failure §C1 already had to fix once in the except arm below."""
    seen = {}

    class _Resp:
        def __init__(self, status):
            self.status = status

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class _Session:
        def __init__(self, timeout=None):
            seen["session_timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def post(self, url, json=None):
            seen["url"], seen["json"] = url, json
            return _Resp(seen["status"])

    class _Timeout:
        def __init__(self, total=None):
            seen["total"] = total

    fake = types.SimpleNamespace(ClientTimeout=_Timeout, ClientSession=_Session)
    monkeypatch.setitem(sys.modules, "aiohttp", fake)

    seen["status"] = 204
    assert _run(alerts._http_post("http://hook", {"title": "t", "message": "m"})) is True
    assert seen["total"] == 10, "the bound must be 10s — aiohttp's own default is minutes"
    assert seen["session_timeout"] is not None, "the timeout must reach the SESSION, not just be built"
    assert seen["url"] == "http://hook" and seen["json"] == {"title": "t", "message": "m"}

    for status, delivered in ((200, True), (299, True), (300, False), (301, False), (500, False)):
        seen["status"] = status
        assert _run(alerts._http_post("http://hook", {})) is delivered, \
            f"{status} must read as delivered={delivered}"


def test_a_failed_delivery_is_logged_not_just_swallowed(caplog):
    """CAPTURE-HOST-DEEP-AUDIT §C1: the exception must not take down capture, but it must leave a
    record — a delivery that never happened was previously indistinguishable from one that did."""
    async def boom(url, payload):
        raise OSError("no route to host")

    n = alerts.Notifier(url="http://hook", enabled=True, _post=boom)
    with caplog.at_level("WARNING"):
        assert _run(n.send("disk full", "1 GB left")) is False
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "disk full" in joined, "the lost alert must be named"
    assert "no route to host" in joined, "and so must the reason it was lost"


def test_a_non_2xx_rejection_is_also_logged(caplog):
    async def rejected(url, payload):
        return False

    n = alerts.Notifier(url="http://hook", enabled=True, _post=rejected)
    with caplog.at_level("WARNING"):
        assert _run(n.send("strap off", "H10")) is False
    assert "strap off" in " ".join(r.getMessage() for r in caplog.records)


# ── delivery is RECORDED, not merely attempted ──────────────────────────────────────────────────────
# 32 alerts fired on the box in 24 h and the journal held exactly ONE delivery outcome in 48 h — a
# failure. Nothing said whether the other 32 landed, because success was silent and nothing was
# published. These pin the three states apart, because collapsing them is the whole defect.

def test_a_delivered_alert_is_recorded_with_a_timestamp():
    async def ok_post(url, payload):
        return True
    n = alerts.Notifier(url="https://hook", enabled=True, _post=ok_post)
    assert asyncio.run(n.send("t", "m")) is True
    st = n.stats()
    assert st["delivered"] == 1 and st["failed"] == 0
    assert st["last_ok"] is not None, "a delivery with no timestamp cannot be told from no delivery"
    assert st["last_error"] is None
    assert st["last_title"] == "t"


def test_ENABLED_BUT_NEVER_DELIVERED_is_its_own_state_not_healthy():
    """The state the box was actually in. `last_ok is None` with no error means the transport is
    UNPROVEN — rendering that as ok is how a dead webhook reads as a working one."""
    n = alerts.Notifier(url="https://hook", enabled=True, _post=None)
    st = n.stats()
    assert st["enabled"] is True and st["last_ok"] is None and st["last_error"] is None
    assert st["delivered"] == 0


def test_a_FAILED_send_records_why_and_does_not_look_delivered():
    async def boom(url, payload):
        raise TimeoutError()
    n = alerts.Notifier(url="https://hook", enabled=True, _post=boom)
    assert asyncio.run(n.send("t", "m")) is False
    st = n.stats()
    assert st["failed"] == 1 and st["delivered"] == 0 and st["last_ok"] is None
    assert "TimeoutError" in (st["last_error"] or ""), st


def test_a_NON_2XX_is_a_failure_not_a_silent_success():
    async def rejected(url, payload):
        return False
    n = alerts.Notifier(url="https://hook", enabled=True, _post=rejected)
    assert asyncio.run(n.send("t", "m")) is False
    assert n.stats()["failed"] == 1 and n.stats()["last_ok"] is None


def test_a_SUPPRESSED_alert_is_counted_and_never_counted_as_sent():
    """Dedupe returning a bare False was indistinguishable from a failed send. It is neither: nothing
    was attempted, and the operator was still not told."""
    calls = []

    async def ok_post(url, payload):
        calls.append(payload)
        return True
    n = alerts.Notifier(url="https://hook", enabled=True, _post=ok_post)
    assert asyncio.run(n.send("t", "m", key="k", dedupe_sec=60, now=100.0)) is True
    assert asyncio.run(n.send("t", "m", key="k", dedupe_sec=60, now=110.0)) is False
    st = n.stats()
    assert len(calls) == 1
    assert st["delivered"] == 1 and st["suppressed"] == 1 and st["failed"] == 0


def test_a_LATER_success_clears_the_error_so_the_card_recovers():
    """Otherwise one transient timeout paints FAILING for the rest of the daemon's life."""
    state = {"fail": True}

    async def flaky(url, payload):
        if state["fail"]:
            raise TimeoutError()
        return True
    n = alerts.Notifier(url="https://hook", enabled=True, _post=flaky)
    asyncio.run(n.send("t", "m"))
    assert n.stats()["last_error"] is not None
    state["fail"] = False
    asyncio.run(n.send("t", "m"))
    assert n.stats()["last_error"] is None and n.stats()["last_ok"] is not None


# ── ring_identity_mismatch — the audit §6.2 Mitigation C pure check ─────────────────────────────────
def test_identity_check_is_INERT_when_no_serial_is_configured():
    """Detection the operator opts into. Nothing configured ⇒ nothing to compare ⇒ never fires, whatever
    the peer said — including a peer that said nothing."""
    assert alerts.ring_identity_mismatch(None, "2592302100") is None
    assert alerts.ring_identity_mismatch("", "2592302100") is None
    assert alerts.ring_identity_mismatch("   ", "") is None
    assert alerts.ring_identity_mismatch(None, None) is None


def test_a_matching_wire_serial_is_silent_and_yaml_ints_count_as_a_match():
    """`serial: 2592302100` parses as an int in YAML; the ring answers a string. One ring, one verdict."""
    assert alerts.ring_identity_mismatch("2592302100", "2592302100") is None
    assert alerts.ring_identity_mismatch(2592302100, "2592302100") is None
    assert alerts.ring_identity_mismatch(" 2592302100 ", "2592302100") is None


def test_a_different_serial_names_both_sides():
    msg = alerts.ring_identity_mismatch("2592302100", "2592399999")
    assert msg is not None
    assert "2592399999" in msg and "2592302100" in msg, "the operator must see what answered AND what was expected"


def test_the_filename_id_is_NOT_the_wire_serial_and_the_check_says_so_by_mismatching():
    """The audit brief's first draft compared against `S8AW2100`, the BLE-name id. Configured that way, the
    real ring would read as an impostor every night — a false alarm that teaches the operator to ignore
    the alert. The docstring names the right field; this pins that the two strings really do differ."""
    assert alerts.ring_identity_mismatch("S8AW2100", "2592302100") is not None


def test_an_EMPTY_or_ABSENT_reply_against_a_configured_serial_is_a_mismatch():
    """A peer that answers the identity query with no identity is the impostor shape, not a pass."""
    for seen in ("", None, "   "):
        msg = alerts.ring_identity_mismatch("2592302100", seen)
        assert msg is not None, f"seen={seen!r} must not read as a match"
        assert "no serial at all" in msg
