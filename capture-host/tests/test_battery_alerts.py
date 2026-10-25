# tepna-capture — tests/test_battery_alerts.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Low-battery push alerts, the ntfy email header, and the Batteries card's history.

The defect, measured on the box 2026-10-13 → 10-23: an H10 coin cell read 90 % on 10-13, 50 % on 10-19,
then 10 % for 3½ days before the strap went silent. The level was in every LINK row and nothing pushed
it. Owner ruling 2026-10-25: a push at 20 %, a push plus an email at 10 %, and a card with a 7-day line.
Device names here are synthetic."""

import asyncio
import json
import logging
import os
import subprocess
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


def test_configured_emails_keeps_good_entries_in_order_and_drops_the_rest(caplog):
    f = alerts.configured_emails
    assert f(None) == []
    assert f("someone@example.org") == [], "a bare string is not the list form"
    assert "not a list" in caplog.text
    got = f(["b@example.org", "secret bad", "a@example.org", "b@example.org", ""])
    assert got == ["b@example.org", "a@example.org"], "order kept, repeats and blanks dropped"
    assert "entry ignored" in caplog.text and "secret" not in caplog.text
    many = [f"u{i}@example.org" for i in range(alerts.MAX_EMAILS + 2)]
    assert f(many) == many[: alerts.MAX_EMAILS]
    assert "the first 5 are used" in caplog.text


def test_email_hint_is_the_first_letter_and_the_domain():
    assert alerts.email_hint(None) == "" and alerts.email_hint("junk") == ""
    assert alerts.email_hint("someone@example.org") == "s…@example.org"


def test_mail_topic_url_keeps_the_server_and_the_query():
    assert alerts.mail_topic_url("https://ntfy.example/tepna") == "https://ntfy.example/tepna-mail"
    assert alerts.mail_topic_url("https://ntfy.example/tepna/") == "https://ntfy.example/tepna-mail"
    assert alerts.mail_topic_url("https://h:8080/t?auth=x") == "https://h:8080/t-mail?auth=x"


# ── the Notifier: one push, one email per address ───────────────────────────────────────────────────


def _notifier(emails, results=None, payloads=None):
    seen = []
    results = list(results or [])

    async def post(url, payload, **kw):
        seen.append((url, kw.get("headers")))
        if payloads is not None:
            payloads.append(payload)
        r = results.pop(0) if results else True
        if isinstance(r, Exception):
            raise r
        return r

    n = alerts.Notifier("https://ntfy.example/t", enabled=True, _post=post, emails=emails)
    return n, seen


def test_the_first_address_rides_the_push_and_the_rest_use_the_mail_topic():
    n, seen = _notifier(["a@example.org", "b@example.org", "c@example.org"])
    assert asyncio.run(n.send("T", "M", email=True)) is True
    assert seen == [
        ("https://ntfy.example/t", {"Email": "a@example.org"}),
        ("https://ntfy.example/t-mail", {"Email": "b@example.org"}),
        ("https://ntfy.example/t-mail", {"Email": "c@example.org"}),
    ]
    assert n.stats()["emails"] == 3 and n.stats()["email_failed"] == 0


def test_a_push_without_email_reaches_only_the_topic():
    n, seen = _notifier(["a@example.org", "b@example.org"])
    assert asyncio.run(n.send("T", "M")) is True
    assert seen == [("https://ntfy.example/t", None)]


def test_with_no_address_an_email_alert_is_a_plain_push():
    n, seen = _notifier([])
    assert asyncio.run(n.send("T", "M", email=True)) is True
    assert seen == [("https://ntfy.example/t", None)]
    assert n.stats()["emails"] == 0


def test_an_undelivered_push_sends_no_extra_email():
    """The poller sends an undelivered alert again; extra emails sent now would arrive twice."""
    n, seen = _notifier(["a@example.org", "b@example.org"], results=[False])
    assert asyncio.run(n.send("T", "M", email=True)) is False
    assert len(seen) == 1


def test_a_failed_extra_email_is_counted_and_keeps_the_push(caplog):
    n, seen = _notifier(["a@example.org", "b@example.org", "c@example.org"], results=[True, False, OSError("x")])
    assert asyncio.run(n.send("T", "M", email=True)) is True
    assert n.stats()["email_failed"] == 2 and n.delivered == 1 and n.failed == 0
    assert "email 2 of 3 rejected" in caplog.text and "email 3 of 3 not delivered" in caplog.text
    assert "example.org" not in caplog.text


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


# ── the address checks, at their edges ──────────────────────────────────────────────────────────────


def test_validate_email_says_which_rule_refused():
    """The error never quotes the value, so its wording is the only thing telling the operator why."""
    cases = [
        (5, "email must be a string"),
        ("x" * 250 + "@example.org", r"email is too long \(max 254\)"),
        ("a b@example.org", "space, a separator or a control character"),
        ("someone", "one address of the form name@example.org"),
    ]
    for value, why in cases:
        with pytest.raises(alerts.AlertsError, match=why):
            alerts.validate_email(value)


def test_validate_email_length_limit_is_inclusive():
    at_limit = "x" * (254 - len("@example.org")) + "@example.org"
    assert len(at_limit) == 254 and alerts.validate_email(at_limit) == at_limit
    with pytest.raises(alerts.AlertsError, match="too long"):
        alerts.validate_email("x" + at_limit)


def test_validate_email_refuses_each_separator_and_del_but_not_the_first_printable():
    for c in ',;<>"':
        with pytest.raises(alerts.AlertsError, match="a separator"):
            alerts.validate_email(f"a{c}b@example.org")
    with pytest.raises(alerts.AlertsError, match="control character"):
        alerts.validate_email("a\x7fb@example.org")
    assert alerts.validate_email("a!b@example.org") == "a!b@example.org", "0x21 is the first printable, not a space"
    assert alerts.validate_email("a\x80b@example.org") == "a\x80b@example.org", "only 0x7F is DEL"


def test_configured_emails_logs_the_reason_and_warns_only_above_the_cap(caplog):
    assert alerts.configured_emails(["secret bad"]) == []
    assert "entry ignored: email contains a space" in caplog.text
    caplog.clear()
    five = [f"u{i}@example.org" for i in range(alerts.MAX_EMAILS)]
    assert alerts.configured_emails(five) == five
    assert "holds" not in caplog.text, "exactly MAX_EMAILS addresses is not too many"


def test_email_hint_takes_the_domain_after_the_last_at():
    assert alerts.email_hint("a@b@example.org") == "a…@example.org"


# ── the Notifier's ledger: defaults, dedupe edges, counters ─────────────────────────────────────────


def test_a_fresh_notifier_has_shown_no_title():
    n, _ = _notifier([])
    assert n.stats()["last_title"] is None, "never sent is not an empty title"


def test_a_key_without_a_window_does_not_dedupe():
    n, seen = _notifier([])
    assert asyncio.run(n.send("T", "M", key="k")) is True
    assert asyncio.run(n.send("T", "M", key="k")) is True
    assert len(seen) == 2 and n.suppressed == 0


def test_the_default_clock_reads_zero():
    n, seen = _notifier([])
    assert asyncio.run(n.send("T", "M", key="k", dedupe_sec=60)) is True  # stamped at now=0
    assert asyncio.run(n.send("T", "M", key="k", dedupe_sec=60, now=60.5)) is True, "60.5 s after 0 is past 60 s"
    assert len(seen) == 2


def test_a_zero_window_never_suppresses_even_when_the_clock_steps_back():
    n, seen = _notifier([])
    assert asyncio.run(n.send("T", "M", key="k", dedupe_sec=0, now=100.0)) is True
    assert asyncio.run(n.send("T", "M", key="k", dedupe_sec=0, now=50.0)) is True
    assert asyncio.run(n.send("T", "M", key="k", dedupe_sec=60, now=60.0)) is True, "a zero window records nothing"
    assert len(seen) == 3 and n.suppressed == 0


def test_a_sub_minute_window_still_suppresses():
    n, seen = _notifier([])
    assert asyncio.run(n.send("T", "M", key="k", dedupe_sec=1, now=100.0)) is True
    assert asyncio.run(n.send("T", "M", key="k", dedupe_sec=1, now=100.5)) is False
    assert len(seen) == 1 and n.suppressed == 1


def test_the_window_ends_exactly_at_dedupe_sec():
    n, seen = _notifier([])
    assert asyncio.run(n.send("T", "M", key="k", dedupe_sec=60, now=100.0)) is True
    assert asyncio.run(n.send("T", "M", key="k", dedupe_sec=60, now=160.0)) is True
    assert len(seen) == 2


def test_every_suppressed_failed_and_delivered_alert_is_counted(caplog):
    caplog.set_level(logging.INFO, logger="tepna-capture")
    n, _ = _notifier([], results=[True, True, False, False, OSError("x"), OSError("y")])
    for t in (0.0, 10.0, 20.0):
        asyncio.run(n.send("T", "M", key="k", dedupe_sec=60, now=t))
    assert n.delivered == 1 and n.suppressed == 2
    assert asyncio.run(n.send("Late", "M")) is True
    assert n.delivered == 2
    assert "alert 'Late' delivered" in caplog.text
    for _ in range(2):
        assert asyncio.run(n.send("T", "M")) is False
    assert n.failed == 2 and n.last_error == "rejected by the webhook (non-2xx)"
    for _ in range(2):
        assert asyncio.run(n.send("T", "M")) is False
    assert n.failed == 4 and n.last_error == "OSError: y"


def test_every_publish_carries_the_alert_body():
    payloads = []
    n, seen = _notifier(["a@example.org", "b@example.org"], payloads=payloads)
    assert asyncio.run(n.send("T", "M", email=True)) is True
    assert len(seen) == 2
    assert payloads == [{"title": "T", "message": "M"}] * 2, "the push AND the mail-topic publish"


def test_a_raising_extra_email_is_logged_with_its_error_and_not_as_a_rejection(caplog):
    n, _ = _notifier(["a@example.org", "b@example.org"], results=[True, OSError("refused")])
    assert asyncio.run(n.send("T", "M", email=True)) is True
    assert "email 2 of 2 not delivered: OSError('refused')" in caplog.text
    assert "rejected" not in caplog.text, "an exception is not a non-2xx answer"
    assert n.email_failed == 1


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


# ── /api/alerts: the addresses are write-only ───────────────────────────────────────────────────────


def _alerts_post(tmp_path, body, alerts_cfg, notifier=None):
    app, cfg = _app(tmp_path, alerts_cfg, notifier)

    async def go(c):
        r = await c.post("/api/alerts", json=body)
        return r.status, await r.json()

    status, js = _serve(app, go)
    return status, js, cfg


BASE = {"enabled": True, "webhook_url": "https://ntfy.example/t"}
TWO = ["anna@example.org", "bert@example.org"]


def test_api_alerts_adds_an_address_and_shows_only_its_hint(tmp_path):
    spy = _Spy("https://ntfy.example/t", True)
    status, js, cfg = _alerts_post(tmp_path, {"email_add": "carl@example.org"}, {**BASE, "emails": list(TWO)}, spy)
    assert status == 200 and js["emails"] == ["a…@example.org", "b…@example.org", "c…@example.org"]
    assert js["emails_max"] == alerts.MAX_EMAILS
    assert "anna" not in str(js) and "carl" not in str(js)
    assert cfg["alerts"]["emails"] == [*TWO, "carl@example.org"] and spy.emails == cfg["alerts"]["emails"]


def test_api_alerts_keeps_the_list_when_no_email_key_is_sent(tmp_path):
    status, js, cfg = _alerts_post(tmp_path, {"enabled": True}, {**BASE, "emails": list(TWO)})
    assert status == 200 and cfg["alerts"]["emails"] == TWO


def test_api_alerts_adding_a_stored_address_again_is_a_no_op(tmp_path):
    status, js, cfg = _alerts_post(tmp_path, {"email_add": " anna@example.org "}, {**BASE, "emails": list(TWO)})
    assert status == 200 and cfg["alerts"]["emails"] == TWO


def test_api_alerts_refuses_a_sixth_address(tmp_path):
    full = [f"u{i}@example.org" for i in range(alerts.MAX_EMAILS)]
    status, js, cfg = _alerts_post(tmp_path, {"email_add": "secret@example.org"}, {**BASE, "emails": list(full)})
    assert status == 400 and "at most" in js["error"] and cfg["alerts"]["emails"] == full


def test_api_alerts_refuses_a_bad_or_empty_address_without_quoting_it(tmp_path):
    status, js, cfg = _alerts_post(tmp_path, {"email_add": "secret-name@nowhere"}, {})
    assert status == 400 and "secret-name" not in str(js)
    assert "emails" not in (cfg.get("alerts") or {})
    status, js, _ = _alerts_post(tmp_path, {"email_add": "  "}, {})
    assert status == 400 and "empty" in js["error"]


def test_api_alerts_removes_one_address_by_index_and_hint(tmp_path):
    spy = _Spy("https://ntfy.example/t", True)
    body = {"email_remove": {"index": 0, "hint": "a…@example.org"}}
    status, js, cfg = _alerts_post(tmp_path, body, {**BASE, "emails": list(TWO)}, spy)
    assert status == 200 and js["emails"] == ["b…@example.org"]
    assert cfg["alerts"]["emails"] == ["bert@example.org"] and spy.emails == ["bert@example.org"]
    assert cfg["alerts"]["webhook_url"] == BASE["webhook_url"], "removing an address keeps the URL"


def test_api_alerts_removing_the_last_address_drops_the_key(tmp_path):
    body = {"email_remove": {"index": 0, "hint": "a…@example.org"}}
    status, js, cfg = _alerts_post(tmp_path, body, {**BASE, "emails": ["anna@example.org"]})
    assert status == 200 and js["emails"] == [] and "emails" not in cfg["alerts"]


def test_api_alerts_refuses_a_removal_from_an_old_list(tmp_path):
    body = {"email_remove": {"index": 0, "hint": "b…@example.org"}}
    status, js, cfg = _alerts_post(tmp_path, body, {**BASE, "emails": list(TWO)})
    assert status == 409 and cfg["alerts"]["emails"] == TWO


def test_api_alerts_refuses_a_removal_with_no_valid_index(tmp_path):
    for r in [None, {}, {"index": True}, {"index": "0"}, {"index": -1}, {"index": 2}]:
        status, js, cfg = _alerts_post(tmp_path, {"email_remove": r}, {**BASE, "emails": list(TWO)})
        assert status == 400 and cfg["alerts"]["emails"] == TWO, r


def test_api_alerts_clears_every_address_only_with_an_empty_list(tmp_path):
    spy = _Spy("https://ntfy.example/t", True)
    status, js, cfg = _alerts_post(tmp_path, {"emails": []}, {**BASE, "emails": list(TWO)}, spy)
    assert status == 200 and "emails" not in cfg["alerts"] and spy.emails == []
    status, js, cfg = _alerts_post(tmp_path, {"emails": ["secret@example.org"]}, {**BASE, "emails": list(TWO)})
    assert status == 400 and cfg["alerts"]["emails"] == TWO and "secret" not in str(js)


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


# ── battery_history at its edges ────────────────────────────────────────────────────────────────────


def test_hour_ms_accepts_every_last_valid_field_and_refuses_one_past_it():
    f = battery_history._hour_ms
    assert f("2026-12-31T23:59:59.000") == 1798758000000, "December 31st, 23:59 is a real stamp"
    for bad in ("2026-13-01T00:00", "2026-01-32T00:00", "2026-01-01T24:00", "2026-01-01T00:60"):
        assert f(bad) is None, bad


def test_pct_keeps_both_ends_of_the_scale_and_nothing_beyond():
    f = battery_history._pct
    assert f("0") == 0, "an empty cell is no reading, but a reading of 0 % is one"
    assert f("100") == 100
    assert f("-1") is None and f("101") is None


def test_build_reads_only_the_newest_days_plus_one_nights(tmp_path):
    """A night folder holds rows past its own midnight, so the read is bounded by FOLDERS (days + 1)."""
    cap = tmp_path / "captures"
    _link(cap / "2026-01-01", "Tepna_1_LINK.csv", [_row("2026-01-02T12:00:00.000", "EARLY-01", 50)])
    _link(cap / "2026-01-02", "Tepna_2_LINK.csv", [_row("2026-01-02T13:00:00.000", "H10-01", 60)])
    _link(cap / "2026-01-03", "Tepna_3_LINK.csv", [_row("2026-01-03T00:00:00.000", "H10-01", 55)])
    assert set(battery_history.build(str(cap), days=1)["devices"]) == {"H10-01"}
    assert set(battery_history.build(str(cap), days=2)["devices"]) == {"EARLY-01", "H10-01"}


def test_build_reads_only_tepna_link_files(tmp_path):
    night = tmp_path / "captures" / "2026-01-01"
    _link(night, "Tepna_1_LINK.csv", [_row("2026-01-01T00:00:00.000", "H10-01", 50)])
    _link(night, "Tepna_1_STATUS.csv", [_row("2026-01-01T00:00:00.000", "STRAY-01", 50)])
    _link(night, "copy_LINK.csv", [_row("2026-01-01T00:00:00.000", "STRAY-02", 50)])
    assert set(battery_history.build(str(tmp_path / "captures"))["devices"]) == {"H10-01"}


def test_build_window_and_24h_change_both_include_their_boundary(tmp_path):
    night = tmp_path / "captures" / "2026-01-02"
    _link(
        night,
        "Tepna_1_LINK.csv",
        [
            _row("2026-01-01T12:00:00.000", "A-OLD", 90),  # every point older than the window
            _row("2026-01-01T00:00:00.000", "B-NEW", 80),  # exactly `days` before the newest
            _row("2026-01-02T00:00:00.000", "B-NEW", 70),
            _row("2026-01-03T00:00:00.000", "C-LAST", 50),  # the newest reading of ANY device
        ],
    )
    out = battery_history.build(str(tmp_path / "captures"), days=2)
    assert sorted(out["devices"]) == ["A-OLD", "B-NEW", "C-LAST"]
    out = battery_history.build(str(tmp_path / "captures"), days=1)
    assert sorted(out["devices"]) == ["B-NEW", "C-LAST"], "a device with nothing in the window is skipped, not the end"
    b = out["devices"]["B-NEW"]
    assert [p for _, p in b["points"]] == [70], "2026-01-01 00:00 is 2 days before the newest: outside"
    out = battery_history.build(str(tmp_path / "captures"), days=2)
    b = out["devices"]["B-NEW"]
    assert [p for _, p in b["points"]] == [80, 70], "exactly `days` before the newest is inside"
    assert b["d24"] == -10, "a point exactly 24 h before the last one is the comparison point"


def test_read_link_finds_the_three_columns_in_any_order_and_strips_only_the_newline(tmp_path):
    """The minimal header (just the three named columns) is a LINK layout; the line's own trailing
    whitespace is part of the last field."""
    night = tmp_path / "captures" / "2026-01-01"
    rows = ["2026-01-01T01:00:00.000;40;H10-01\n", "2026-01-01T02:00:00.000;30;RING-01\t\n"]
    _link(night, "Tepna_1_LINK.csv", rows, header="Phone timestamp;battery_pct;device\n")
    devs = battery_history.build(str(tmp_path / "captures"))["devices"]
    assert sorted(devs) == ["H10-01", "RING-01\t"]
    assert devs["H10-01"]["last"] == 40


def test_read_link_skips_a_bad_or_torn_row_and_keeps_reading(tmp_path):
    night = tmp_path / "captures" / "2026-01-01"
    rows = [
        _row("2026-01-01T01:00:00.000", "H10-01", 70),
        "2026-01-01T01:10:00.000;H10-01\n",  # torn
        _row("2026-01-01T01:20:00.000", "H10-01", 60),
        _row("2026-01-01T01:30:00.000", "H10-01", ""),  # no reading
        _row("2026-01-01T01:40:00.000", "H10-01", 50),
        _row("2026-01-01T01:50:00.000", "H10-01", 50),  # ties the low
    ]
    _link(night, "Tepna_1_LINK.csv", rows)
    lows = {}
    battery_history.read_link(str(night / "Tepna_1_LINK.csv"), lows)
    assert lows == {"H10-01": {1767229200000: 50}}


def test_read_link_replaces_undecodable_bytes_instead_of_raising(tmp_path):
    night = tmp_path / "captures" / "2026-01-01"
    _link(night, "Tepna_1_LINK.csv", [_row("2026-01-01T01:00:00.000", "H10-01", 40)])
    with open(night / "Tepna_1_LINK.csv", "ab") as fh:
        fh.write(b"2026-01-01T02:00:00.000;H10-\xff;1;-60;30;;;1;synthetic\n")
    devs = battery_history.build(str(tmp_path / "captures"))["devices"]
    assert devs["H10-\ufffd"]["last"] == 30 and devs["H10-01"]["last"] == 40


def test_read_link_does_not_depend_on_the_boxes_locale(tmp_path):
    """The device name is the field the decoder reaches: `Ringé-01` is UTF-8 on disk. Run the REAL
    reader under `LC_ALL=C PYTHONUTF8=0` (ASCII locale) and compare with this process, the probe shape
    of test_nightqc's sidecar-reader test."""
    cap = tmp_path / "captures"
    _link(cap / "2026-01-01", "Tepna_1_LINK.csv", [_row("2026-01-01T01:00:00.000", "Ringé-01", 40)])
    here = battery_history.build(str(cap))
    assert list(here["devices"]) == ["Ringé-01"], "decoded as UTF-8 here, or the probe below compares nothing"
    env = {**os.environ, "LC_ALL": "C", "LANG": "C", "PYTHONUTF8": "0", "PYTHONCOERCECLOCALE": "0"}
    script = (
        f"import json,locale,sys; sys.path.insert(0,{os.path.dirname(os.path.abspath(battery_history.__file__))!r});"
        f"import battery_history; print(locale.getencoding());"
        f"print(json.dumps(battery_history.build({str(cap)!r}), sort_keys=True))"
    )
    r = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, env=env)
    assert r.returncode == 0, f"the probe itself failed, which says nothing about encoding:\n{r.stderr[-600:]}"
    enc, got = r.stdout.splitlines()
    if enc.lower().replace("-", "") in ("utf8",):
        pytest.skip(f"this host forces UTF-8 even under LC_ALL=C ({enc}) — the condition was not reached")
    assert got == json.dumps(here, sort_keys=True), f"the history must not depend on the ambient encoding ({enc})"
