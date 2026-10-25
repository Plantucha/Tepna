# tepna-capture — tests/test_battery_alerts.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Low-battery push alerts, the ntfy email header, and the Batteries card's history.

The defect, measured on the box 2026-10-13 → 10-23: an H10 coin cell read 90 % on 10-13, 50 % on 10-19,
then 10 % for 3½ days before the strap went silent. The level was in every LINK row and nothing pushed
it. Owner ruling 2026-10-25: a push at 20 %, a push plus an email at 10 %, and a card with a 7-day line.
Device names here are synthetic."""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aiohttp import web  # noqa: E402
from aiohttp.test_utils import TestClient, TestServer  # noqa: E402

import alerts  # noqa: E402
import battery_history  # noqa: E402
import capture  # noqa: E402
from tests.test_capture_runners import _dev  # noqa: E402
from tests.test_webmon_alerts_contract import _app, _Spy  # noqa: E402
from tests.test_webmon_api import _serve  # noqa: E402

W, C, RE = alerts.BATTERY_WARN_PCT, alerts.BATTERY_CRIT_PCT, alerts.BATTERY_REARM_PCT


# ── the pure step ───────────────────────────────────────────────────────────────────────────────────


def test_battery_alert_step_known_answers():
    f = alerts.battery_alert_step
    assert f(None, None) == (None, None), "no reading is not 0 %"
    assert f(None, W) == (None, W), "no reading moves no latch"
    assert f(True, None) == (None, None), "a bool is not a level"
    assert f("10", None) == (None, None), "a string is not a level"
    assert f(100, C) == (None, None), "a full cell re-arms"
    assert f(RE, W) == (None, None), "re-arms AT the re-arm level"
    assert f(RE - 10, W) == (None, W), "a rebound below the re-arm level keeps the latch"
    assert f(30, None) == (None, None)
    assert f(W, None) == (W, W), "20 % fires the first warning"
    assert f(W, W) == (None, W), "once"
    assert f(C, W) == (C, C), "10 % fires again, with the email"
    assert f(C, None) == (C, C), "a jump past both thresholds sends only the 10 % alert"
    assert f(C, C) == (None, C), "once"
    assert f(0, C) == (None, C)
    assert f(15.0, None) == (W, W), "a float level is a level"


def test_the_2026_10_19_bounce_alerts_once_per_threshold():
    """50 → 90 → 80 → 10 inside four minutes, then 10 for days: one 10 % alert, no repeats."""
    latch, fired = None, []
    for pct in (60, 50, 90, 80, 10, 10, 10, 20, 10):
        fire, latch = alerts.battery_alert_step(pct, latch)
        if fire is not None:
            fired.append(fire)
    assert fired == [C]


# ── the email address ───────────────────────────────────────────────────────────────────────────────


def test_validate_email_accepts_one_address_and_clears():
    v = alerts.validate_email
    assert v(None) == "" and v("") == "" and v("   ") == ""
    assert v("  someone@example.org ") == "someone@example.org"
    assert v("a.b+tag@sub.example.org") == "a.b+tag@sub.example.org"


def test_validate_email_refuses_without_quoting_the_value():
    bad = [
        5,
        "x" * 250 + "@secret.org",
        "a b@secret.org",
        "a@secret.org,b@secret.org",
        "a@secret.org\r\nX: y",
        "secret",
        "@secret.org",
        "a@@secret.org",
        "a@secret",
        "a@.secret.org",
        "a@secret.org.",
    ]
    for value in bad:
        try:
            alerts.validate_email(value)
        except alerts.AlertsError as e:
            assert "secret" not in str(e)
        else:
            raise AssertionError(f"accepted {value!r}")


def test_configured_email_drops_a_bad_value_and_keeps_a_good_one(caplog):
    assert alerts.configured_email(None) is None
    assert alerts.configured_email("someone@example.org") == "someone@example.org"
    assert alerts.configured_email("not an address") is None
    assert "alerts.email ignored" in caplog.text


def test_email_hint_is_the_domain_only():
    assert alerts.email_hint(None) == "" and alerts.email_hint("junk") == ""
    assert alerts.email_hint("someone@example.org") == "…@example.org"


# ── the Notifier carries the header only when asked and only when an address is stored ─────────────


def _notifier(email):
    seen = []

    async def post(url, payload, **kw):
        seen.append(kw)
        return True

    return alerts.Notifier("https://ntfy.example/t", enabled=True, _post=post, email=email), seen


def test_send_with_email_adds_the_ntfy_header():
    n, seen = _notifier("someone@example.org")
    assert asyncio.run(n.send("T", "M", email=True)) is True
    assert asyncio.run(n.send("T", "M")) is True
    assert seen == [{"headers": {"Email": "someone@example.org"}}, {}]
    assert n.stats()["email_configured"] is True


def test_send_with_email_but_no_address_is_a_plain_push():
    n, seen = _notifier(None)
    assert asyncio.run(n.send("T", "M", email=True)) is True
    assert seen == [{}]
    assert n.stats()["email_configured"] is False


def test_http_post_sends_the_header():
    got = {}

    async def handler(req):
        got["email"] = req.headers.get("Email")
        return web.json_response({"ok": True})

    async def go():
        app = web.Application()
        app.router.add_post("/hook", handler)
        cl = TestClient(TestServer(app))
        await cl.start_server()
        try:
            return await alerts._http_post(str(cl.make_url("/hook")), {"title": "T"}, headers={"Email": "a@b.org"})
        finally:
            await cl.close()

    assert asyncio.run(go()) is True
    assert got["email"] == "a@b.org"


# ── alert_poller ────────────────────────────────────────────────────────────────────────────────────


class _N:
    def __init__(self, enabled=True, ok=True):
        self.enabled, self.ok, self.sent = enabled, ok, []

    async def send(self, title, message, **kw):
        self.sent.append((title, kw.get("email", False)))
        return self.ok


def _poll(monkeypatch, levels, notifier, name="H10-01"):
    """Run alert_poller once per level in `levels`, with the device connected and streaming. The loop
    checks `_STOP` before its sleep, so the last level is polled twice."""
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 10**9}, "devices": [_dev(name=name)]}
    st = {"connected": True}
    capture.STATUS["devices"][name] = st
    capture._LAST_DATA[name] = 1000.0
    seq = list(levels)
    calls = {"n": 0}

    async def fake_sleep(_s):
        if calls["n"] < len(seq):
            st["battery"] = seq[calls["n"]]
        else:
            capture._STOP.set()
        calls["n"] += 1

    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    asyncio.run(capture.alert_poller(cfg, notifier))
    capture._LAST_DATA.pop(name, None)
    return st


@pytest.mark.sets_capture_events  # the poll script sets _STOP as the scenario's end
def test_poller_pushes_at_20_and_pushes_plus_emails_at_10(monkeypatch):
    n = _N()
    st = _poll(monkeypatch, [None, 60, 30, 20, 20, 10, 10, 90, 10], n)
    assert n.sent == [
        ("Tepna: H10-01 battery 20 %", False),
        ("Tepna: H10-01 battery 10 %", True),
        ("Tepna: H10-01 battery 10 %", True),  # after the re-arm at 90 % (a new cell), the next fall alerts
    ]
    assert st["battery_alert"]["pct"] == 10 and st["battery_alert"]["threshold"] == C
    assert len(st["battery_alert"]["at"]) == 16


@pytest.mark.sets_capture_events  # the poll script sets _STOP as the scenario's end
def test_poller_retries_an_undelivered_battery_alert(monkeypatch):
    n = _N(ok=False)
    st = _poll(monkeypatch, [10, 10], n)
    assert n.sent == [("Tepna: H10-01 battery 10 %", True)] * 3, "the latch follows the delivery"
    assert "battery_alert" not in st


@pytest.mark.sets_capture_events  # the poll script sets _STOP as the scenario's end
def test_poller_with_alerting_off_logs_once_and_latches(monkeypatch, caplog):
    n = _N(enabled=False, ok=False)
    _poll(monkeypatch, [10, 10, 10], n)
    assert len(n.sent) == 1
    assert caplog.text.count("battery reads 10 %") == 1


# ── /api/alerts: the email is write-only ────────────────────────────────────────────────────────────


def _alerts_post(tmp_path, body, alerts_cfg, notifier):
    app, cfg = _app(tmp_path, alerts_cfg, notifier)

    async def go(c):
        r = await c.post("/api/alerts", json=body)
        return r.status, await r.json()

    status, js = _serve(app, go)
    return status, js, cfg


def test_api_alerts_sets_keeps_and_clears_the_email_and_never_echoes_it(tmp_path):
    spy = _Spy("https://ntfy.example/t", True)
    base = {"enabled": True, "webhook_url": "https://ntfy.example/t"}
    status, js, cfg = _alerts_post(tmp_path, {"email": "someone@example.org"}, dict(base), spy)
    assert status == 200 and js["email_configured"] is True and js["email_hint"] == "…@example.org"
    assert "someone" not in str(js)
    assert cfg["alerts"]["email"] == "someone@example.org" and spy.email == "someone@example.org"

    status, js, cfg = _alerts_post(tmp_path, {"enabled": True}, {**base, "email": "someone@example.org"}, spy)
    assert cfg["alerts"]["email"] == "someone@example.org", "absent keeps"

    status, js, cfg = _alerts_post(tmp_path, {"email": ""}, {**base, "email": "someone@example.org"}, spy)
    assert "email" not in cfg["alerts"] and js["email_configured"] is False and spy.email is None


def test_api_alerts_refuses_a_bad_email_without_quoting_it(tmp_path):
    status, js, cfg = _alerts_post(tmp_path, {"email": "secret-name@nowhere"}, {}, None)
    assert status == 400 and "secret-name" not in str(js)
    assert "email" not in (cfg.get("alerts") or {})


# ── /api/battery and battery_history ────────────────────────────────────────────────────────────────

HDR = "Phone timestamp;device;connected;rssi_dbm;battery_pct;frames_dropped;frames_duplicated;link_epoch;address\n"


def _link(d, name, rows, header=HDR):
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text("# adapter=synthetic\n" + header + "".join(rows), encoding="utf-8")


def _row(stamp, dev, pct):
    return f"{stamp};{dev};1;-60;{pct};;;1;synthetic\n"


def test_build_reads_the_lowest_reading_per_hour_and_the_24h_change(tmp_path):
    cap = tmp_path / "captures"
    _link(
        cap / "2026-01-01",
        "Tepna_20260101000000_LINK.csv",
        [
            _row("2026-01-01T10:00:01.000", "H10-01", 90),
            _row("2026-01-01T10:30:00.000", "H10-01", 80),  # the hour's low
            _row("2026-01-01T10:45:00.000", "H10-01", 100),
            _row("2026-01-01T10:50:00.000", "H10-01", ""),  # no reading, not 0 %
            _row("2026-01-01T10:51:00.000", "H10-01", "abc"),
            _row("2026-01-01T10:52:00.000", "H10-01", 101),
            _row("garbage", "H10-01", 5),
            _row("2026-13-01T10:00:00.000", "H10-01", 5),
            _row("2026-01-01T10:53:00.000", "", 5),
            "2026-01-01T10:54:00.000;H10-01\n",  # torn
        ],
    )
    _link(
        cap / "2026-01-02",
        "Tepna_20260102000000_LINK.csv",
        [_row("2026-01-02T11:00:00.000", "H10-01", 60), _row("2026-01-02T11:00:00.000", "RING-01", 70)],
    )
    _link(cap / "2026-01-02", "Tepna_20260102000001_LINK.csv", [], header="a;b;c\n")  # unknown layout
    (cap / "2026-01-02" / "notes.txt").write_text("x")
    (cap / "devcaps.json").write_text("{}")
    out = battery_history.build(str(cap))
    h = out["devices"]["H10-01"]
    assert [p for _, p in h["points"]] == [80, 60]
    assert h["last"] == 60 and h["d24"] == -20
    assert out["devices"]["RING-01"]["d24"] is None, "less than 24 h of history"
    assert h["points"][0][0] == 1767261600000, "floating tMs of 2026-01-01 10:00"


def test_build_drops_points_older_than_the_window_and_survives_a_missing_root(tmp_path):
    cap = tmp_path / "captures"
    _link(cap / "2026-01-01", "Tepna_1_LINK.csv", [_row("2026-01-01T00:00:00.000", "OLD-01", 50)])
    _link(cap / "2026-01-20", "Tepna_2_LINK.csv", [_row("2026-01-20T00:00:00.000", "H10-01", 50)])
    out = battery_history.build(str(cap), days=30)
    assert set(out["devices"]) == {"OLD-01", "H10-01"}
    out = battery_history.build(str(cap), days=1)
    assert set(out["devices"]) == {"H10-01"}
    assert battery_history.build(str(tmp_path / "absent")) == {"days": 7, "devices": {}}


def test_api_battery_serves_caches_and_never_500s_on_a_reader_fault(tmp_path, monkeypatch):
    _link(tmp_path / "captures" / "2026-01-01", "Tepna_1_LINK.csv", [_row("2026-01-01T00:00:00.000", "H10-01", 40)])
    app, _ = _app(tmp_path)
    calls = {"n": 0}
    real = battery_history.build

    def counting(captures):
        calls["n"] += 1
        return real(captures)

    monkeypatch.setattr(battery_history, "build", counting)

    async def go(c):
        a = await (await c.get("/api/battery")).json()
        b = await (await c.get("/api/battery")).json()
        return a, b

    a, b = _serve(app, go)
    assert a == b and a["devices"]["H10-01"]["last"] == 40
    assert calls["n"] == 1, "the second call is a cache hit"

    def boom(captures):
        raise OSError("disk")

    monkeypatch.setattr(battery_history, "build", boom)
    app, _ = _app(tmp_path)

    async def go2(c):
        r = await c.get("/api/battery")
        return r.status, await r.json()

    status, js = _serve(app, go2)
    assert status == 500 and "OSError" in js["error"]
