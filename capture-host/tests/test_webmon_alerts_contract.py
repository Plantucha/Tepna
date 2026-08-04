# tepna-capture — tests/test_webmon_alerts_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`/api/alerts` — the webhook destination, settable from the monitor (VIGIL-OBSERVED-ERRORS E6).

The alert half of E6 sat open for two weeks because `alerts.webhook_url` could only be set by
hand-editing config.yaml on a headless box, so the low-disk and sensor-offline alerts fired to nobody.

The property that needs guarding hardest is NOT that the field saves — it is that the URL never comes
back out. For ntfy / Discord / Slack / Telegram the URL *is* the bearer credential, and this page is
LAN-reachable through Caddy, so an echo would publish the secret to anyone who can reach the box. Every
response shape below is asserted to be URL-free, including the error paths, where a validator that
helpfully quotes the offending value would leak it just as effectively.

The second load-bearing rule is "absent means keep, empty-string means clear". The input renders empty
even when a destination IS stored (because it is never echoed), so if an omitted field meant "delete",
merely toggling the checkbox would silently wipe the destination.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import alerts  # noqa: E402
import telemetry  # noqa: E402
import webmon  # noqa: E402
from tests.test_webmon_api import _serve  # noqa: E402

SECRET = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXtokenXXXX"


class _Spy(alerts.Notifier):
    """A real Notifier (so `configure` is the shipped code) with the transport stubbed."""

    def __init__(self, url=None, enabled=False, ok=True):
        super().__init__(url, enabled, _post=self._fake)
        self.sent = []
        self._ok = ok

    async def _fake(self, url, payload):
        self.sent.append((url, payload))
        if isinstance(self._ok, Exception):
            raise self._ok
        return self._ok


def _app(tmp_path, alerts_cfg=None, notifier=None):
    cfg = {"root": str(tmp_path), "clock": {"sudo": False}, "devices": []}
    if alerts_cfg is not None:
        cfg["alerts"] = alerts_cfg
    app = webmon.make_app(telemetry.TelemetryBus(), cfg, str(tmp_path / "config.yaml"),
                          "AA:AA:AA:AA:AA:AA", {"devices": {}}, None, notifier=notifier)
    return app, cfg


def _get(tmp_path, alerts_cfg=None):
    app, _ = _app(tmp_path, alerts_cfg)

    async def go(c):
        return await (await c.get("/api/alerts")).json()
    return _serve(app, go)


def _post(tmp_path, body, alerts_cfg=None, notifier=None, path="/api/alerts", send_body=True):
    app, cfg = _app(tmp_path, alerts_cfg, notifier)
    out = {}

    async def go(c):
        r = await (c.post(path, json=body) if send_body else c.post(path))
        out["status"] = r.status
        out["json"] = await r.json()
        return out
    res = _serve(app, go)
    return res, cfg


# ── the secret must never come back ───────────────────────────────────────────────────────────────

def test_get_never_returns_the_url_only_whether_and_where(tmp_path):
    body = _get(tmp_path, {"enabled": True, "webhook_url": SECRET})
    assert SECRET not in repr(body), body
    assert "XXXXtokenXXXX" not in repr(body)
    assert body == {"enabled": True, "configured": True, "hint": "https://hooks.slack.com"}


def test_the_hint_strips_the_path_because_that_is_where_the_token_lives(tmp_path):
    body = _get(tmp_path, {"enabled": True, "webhook_url": "https://ntfy.sh/a-very-secret-topic"})
    assert body["hint"] == "https://ntfy.sh"
    assert "a-very-secret-topic" not in repr(body)


def test_post_response_does_not_echo_the_url_either(tmp_path):
    (res, _) = _post(tmp_path, {"webhook_url": SECRET, "enabled": True})
    assert res["status"] == 200
    assert SECRET not in repr(res["json"]), res["json"]
    assert res["json"]["configured"] is True and res["json"]["hint"] == "https://hooks.slack.com"


def test_a_rejected_url_is_not_quoted_back_in_the_error(tmp_path):
    """A validator that says `'<url>' is not valid` leaks the secret on the error path."""
    bad = "ftp://hooks.example.com/secret-token-here"
    (res, _) = _post(tmp_path, {"webhook_url": bad})
    assert res["status"] == 400
    assert "secret-token-here" not in repr(res["json"]), res["json"]


def test_an_unconfigured_box_says_so_rather_than_looking_healthy(tmp_path):
    assert _get(tmp_path) == {"enabled": False, "configured": False, "hint": ""}


# ── absent means keep, "" means clear ─────────────────────────────────────────────────────────────

def test_omitting_the_url_keeps_the_stored_one(tmp_path):
    """The field renders empty because it is never echoed, so an omitted URL must NOT clear."""
    (res, cfg) = _post(tmp_path, {"enabled": False}, {"enabled": True, "webhook_url": SECRET})
    assert res["status"] == 200
    assert cfg["alerts"]["webhook_url"] == SECRET      # still there
    assert cfg["alerts"]["enabled"] is False           # only the toggle moved
    assert res["json"]["configured"] is True


def test_an_explicit_empty_string_clears_it(tmp_path):
    (res, cfg) = _post(tmp_path, {"webhook_url": "", "enabled": False},
                       {"enabled": True, "webhook_url": SECRET})
    assert res["status"] == 200
    assert "webhook_url" not in cfg["alerts"]
    assert res["json"] == {"ok": True, "enabled": False, "configured": False, "hint": ""}


def test_enabled_cannot_survive_without_a_destination(tmp_path):
    """`enabled: true` with no URL would be alerting that is nominally on and silently dead."""
    (res, cfg) = _post(tmp_path, {"webhook_url": "", "enabled": True})
    assert cfg["alerts"]["enabled"] is False
    assert res["json"]["enabled"] is False


def test_a_new_url_replaces_the_old_one(tmp_path):
    (res, cfg) = _post(tmp_path, {"webhook_url": "https://ntfy.sh/new", "enabled": True},
                       {"enabled": True, "webhook_url": SECRET})
    assert cfg["alerts"]["webhook_url"] == "https://ntfy.sh/new"
    assert res["json"]["hint"] == "https://ntfy.sh"


# ── the live notifier is re-pointed without a restart ─────────────────────────────────────────────

def test_saving_repoints_the_running_notifier(tmp_path):
    """Restarting to pick up a webhook change would drop every BLE link mid-night."""
    n = _Spy(url=None, enabled=False)
    (res, _) = _post(tmp_path, {"webhook_url": "https://ntfy.sh/t", "enabled": True}, notifier=n)
    assert res["status"] == 200
    assert n.url == "https://ntfy.sh/t" and n.enabled is True


def test_clearing_disarms_the_running_notifier(tmp_path):
    n = _Spy(url=SECRET, enabled=True)
    _post(tmp_path, {"webhook_url": "", "enabled": False}, {"enabled": True, "webhook_url": SECRET},
          notifier=n)
    assert n.url is None and n.enabled is False


def test_a_box_with_no_notifier_still_saves(tmp_path):
    """capture.py always passes one, but make_app's other callers (and the tests) may not."""
    (res, cfg) = _post(tmp_path, {"webhook_url": "https://ntfy.sh/t", "enabled": True}, notifier=None)
    assert res["status"] == 200 and cfg["alerts"]["webhook_url"] == "https://ntfy.sh/t"


# ── the test button ───────────────────────────────────────────────────────────────────────────────

def test_test_alert_goes_through_the_live_notifier(tmp_path):
    n = _Spy(url="https://ntfy.sh/t", enabled=True)
    (res, _) = _post(tmp_path, {}, notifier=n, path="/api/alerts/test")
    assert res["json"]["ok"] is True
    assert n.sent and n.sent[0][0] == "https://ntfy.sh/t"


def test_test_alert_refuses_when_alerting_is_off(tmp_path):
    (res, _) = _post(tmp_path, {}, notifier=_Spy(url=None, enabled=False), path="/api/alerts/test")
    assert res["status"] == 400 and "not enabled" in res["json"]["error"]


def test_test_alert_with_no_notifier_refuses(tmp_path):
    (res, _) = _post(tmp_path, {}, notifier=None, path="/api/alerts/test")
    assert res["status"] == 400


def test_a_webhook_that_rejects_is_reported_not_celebrated(tmp_path):
    n = _Spy(url="https://ntfy.sh/t", enabled=True, ok=False)
    (res, _) = _post(tmp_path, {}, notifier=n, path="/api/alerts/test")
    assert res["json"]["ok"] is False and res["json"]["error"]


def test_a_probe_never_500s_the_monitor(tmp_path):
    n = _Spy(url="https://ntfy.sh/t", enabled=True)

    async def boom(*_a, **_k):
        raise RuntimeError("dns")
    n.send = boom
    (res, _) = _post(tmp_path, {}, notifier=n, path="/api/alerts/test")
    assert res["status"] == 200 and res["json"]["ok"] is False
    assert "RuntimeError" in res["json"]["error"]


# ── malformed requests ────────────────────────────────────────────────────────────────────────────

def test_a_bodyless_post_is_a_400_not_a_clear(tmp_path):
    """Same rule as storage_post: an absent body is a broken client, never an instruction to delete."""
    (res, cfg) = _post(tmp_path, None, {"enabled": True, "webhook_url": SECRET}, send_body=False)
    assert res["status"] == 400
    assert cfg["alerts"]["webhook_url"] == SECRET

def test_a_non_object_body_is_a_400(tmp_path):
    (res, _) = _post(tmp_path, ["not", "an", "object"])
    assert res["status"] == 400


def test_a_config_that_cannot_be_written_is_a_500_not_a_silent_success(tmp_path):
    """The operator must not be told "saved" when nothing reached the disk."""
    d = tmp_path / "nodir"
    cfg = {"root": str(tmp_path), "clock": {"sudo": False}, "devices": []}
    app = webmon.make_app(telemetry.TelemetryBus(), cfg, str(d / "sub" / "config.yaml"),
                          "AA:AA:AA:AA:AA:AA", {"devices": {}}, None, notifier=None)
    out = {}

    async def go(c):
        r = await c.post("/api/alerts", json={"webhook_url": "https://ntfy.sh/t", "enabled": True})
        out["status"] = r.status
        return out
    assert _serve(app, go)["status"] == 500
