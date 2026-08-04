# tepna-capture — tests/test_alerts_webhook_url.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`alerts.validate_webhook_url` / `webhook_hint` / `Notifier.configure`.

These exist because the monitor now accepts a webhook URL typed by a human (VIGIL-OBSERVED-ERRORS E6),
which makes this the one place operator input reaches an outbound HTTP client and the journal.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import alerts  # noqa: E402


@pytest.mark.parametrize("v", [
    "https://ntfy.sh/topic",
    "http://192.168.0.5:8080/hook",
    "https://hooks.slack.com/services/T0/B0/xyz",
    "https://[2001:db8::1]/hook",          # IPv6 literal
])
def test_accepts_real_webhook_urls(v):
    assert alerts.validate_webhook_url(v) == v


def test_strips_surrounding_whitespace_a_paste_almost_always_carries():
    assert alerts.validate_webhook_url("  https://ntfy.sh/t \n") == "https://ntfy.sh/t"


@pytest.mark.parametrize("v", ["", "   ", None])
def test_blank_is_an_explicit_clear_not_an_error(v):
    assert alerts.validate_webhook_url(v) == ""


@pytest.mark.parametrize("v,why", [
    ("ftp://h/x",           "scheme not in the allowlist"),
    ("file:///etc/shadow",  "file:// would make the box read a local file"),
    ("//ntfy.sh/t",         "no scheme"),
    ("https://",            "no host"),
    ("ntfy.sh/t",           "bare host, no scheme"),
])
def test_rejects_what_is_not_an_http_webhook(v, why):
    with pytest.raises(alerts.AlertsError):
        alerts.validate_webhook_url(v), why


def test_rejects_a_non_string():
    with pytest.raises(alerts.AlertsError):
        alerts.validate_webhook_url(42)


def test_rejects_control_characters_a_log_and_header_injection_vector():
    with pytest.raises(alerts.AlertsError):
        alerts.validate_webhook_url("https://ntfy.sh/t\r\nX-Evil: 1")


def test_rejects_an_absurdly_long_url():
    with pytest.raises(alerts.AlertsError):
        alerts.validate_webhook_url("https://ntfy.sh/" + "a" * 4000)


def test_rejects_a_url_urlsplit_itself_refuses():
    with pytest.raises(alerts.AlertsError):
        alerts.validate_webhook_url("https://[not-an-ipv6/x")


# ── the hint must never carry the token ───────────────────────────────────────────────────────────

def test_hint_keeps_scheme_and_host_and_drops_the_path():
    assert alerts.webhook_hint("https://hooks.slack.com/services/T0/B0/tok") == "https://hooks.slack.com"


def test_hint_keeps_a_port_because_that_identifies_the_endpoint():
    assert alerts.webhook_hint("http://192.168.0.5:8080/hook") == "http://192.168.0.5:8080"


def test_hint_drops_the_query_too():
    assert alerts.webhook_hint("https://h.example/x?token=sekrit") == "https://h.example"
    assert "sekrit" not in alerts.webhook_hint("https://h.example/x?token=sekrit")


@pytest.mark.parametrize("v", [None, "", "not-a-url"])
def test_hint_degrades_to_empty_rather_than_raising(v):
    """A STORED value can predate this validation; a monitor that 500s on it is worse than no hint."""
    assert alerts.webhook_hint(v) == ""


def test_hint_degrades_on_a_value_urlsplit_refuses():
    assert alerts.webhook_hint("https://[bad/x") == ""


# ── live reconfigure ──────────────────────────────────────────────────────────────────────────────

def test_configure_repoints_without_a_restart():
    n = alerts.Notifier("https://old/x", enabled=True)
    n.configure("https://new/y", True)
    assert n.url == "https://new/y" and n.enabled is True


def test_configure_cannot_leave_alerting_on_with_no_url():
    n = alerts.Notifier("https://old/x", enabled=True)
    n.configure(None, True)
    assert n.url is None and n.enabled is False


def test_a_real_change_clears_dedupe_so_the_first_alert_to_a_new_endpoint_lands():
    """Those timestamps mean "the operator has already been told" — true only of the OLD destination,
    and the first alert to a new one is exactly the one they are waiting for to confirm it works."""
    n = alerts.Notifier("https://old/x", enabled=True)
    n._last["offline:H10"] = 100.0
    n.configure("https://new/y", True)
    assert n._last == {}


def test_an_idempotent_resave_does_not_clear_dedupe():
    """Otherwise clicking Save twice is a dedupe bypass."""
    n = alerts.Notifier("https://same/x", enabled=True)
    n._last["offline:H10"] = 100.0
    n.configure("https://same/x", True)
    assert n._last == {"offline:H10": 100.0}


def test_toggling_enabled_off_counts_as_a_change():
    n = alerts.Notifier("https://same/x", enabled=True)
    n._last["k"] = 1.0
    n.configure("https://same/x", False)
    assert n.enabled is False and n._last == {}
