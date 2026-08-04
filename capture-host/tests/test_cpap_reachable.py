# tepna-capture — tests/test_cpap_reachable.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `reachable()` decides whether the harvest escalates. CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04 §3.
#
# WHY IT MATTERS THAT THIS PROBE IS EXACT. Everything privileged in the harvest — `ip link`,
# `wpa_supplicant`, `wpa_cli`, `ip addr`, the teardown — exists only to join the card's own AP, and all
# of it is `sudo -n` against sudoers entries a stock box does not have. On 2026-07-28 the 13:00 run died
# at `sudo -n mkdir -p` with "interactive authentication is required" and skipped the day, with the
# previous night's therapy data one plain HTTP GET away. An ez Share card put in station mode joins the
# house network like any other client, and then the whole privileged branch is dead code. This probe is
# what lets one build serve both deployments: if the card answers, associate nothing.
#
# A probe that answers wrongly therefore either escalates when it need not, or skips a day when the card
# was there all along. The existing tests in test_cpap_no_sudo.py drive a real listener and prove the
# happy path and two failure paths; nothing observes the REQUEST, so the URL it builds, the method, the
# deadline and the accepted status range were all unobservable.

import urllib.error
import urllib.request

import pytest

import cpap_harvest as ch


class _Resp:
    """Context-manager stand-in for what urlopen returns. `status` is settable, and DELETABLE, because
    the production code reads it via getattr with a default."""

    def __init__(self, status=200):
        if status is not None:
            self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def urlopen_spy(monkeypatch):
    """Records every urlopen call and returns a configurable response."""
    calls = []

    def fake(req, **kw):
        calls.append({"req": req, "kw": kw})
        r = fake.reply
        if isinstance(r, BaseException):
            raise r
        return r

    fake.reply = _Resp(200)
    fake.calls = calls
    monkeypatch.setattr(ch.urllib.request, "urlopen", fake)
    return fake


# ── the request itself ──────────────────────────────────────────────────────────────────────────────
def test_the_probe_is_one_unretried_get_at_the_listing_url(urlopen_spy):
    """`/dir?dir=A:` is the card's listing endpoint — the probe asks the question the harvest will
    actually ask, so a card that answers here is a card the harvest can use. Asking a different path
    (or with no method) can answer 200 from a device that cannot serve the listing at all.

    ONE call, no retry: this runs before association to decide whether to escalate, so a retry loop
    here delays every harvest on every box where the card genuinely is not on the network."""
    assert ch.reachable("http://192.168.4.1") is True
    assert len(urlopen_spy.calls) == 1, "one probe — a retry belongs in EzShare, not in the decision"
    req = urlopen_spy.calls[0]["req"]
    assert req.full_url == "http://192.168.4.1/dir?dir=A:"
    assert req.get_method() == "GET"


def test_a_trailing_slash_on_the_base_does_not_double_up(urlopen_spy):
    """`base.rstrip("/")`. Config carries the base as an operator typed it, and `http://host//dir?...`
    is a different path to a card that serves its listing from an exact route. `lstrip` would leave the
    trailing slash and strip nothing, and `rstrip(None)` strips whitespace instead — both produce the
    doubled path, and neither is visible unless the base under test HAS a trailing slash."""
    ch.reachable("http://192.168.4.1/")
    assert urlopen_spy.calls[0]["req"].full_url == "http://192.168.4.1/dir?dir=A:"


def test_the_default_deadline_is_five_seconds_and_reaches_urlopen(urlopen_spy):
    """The default is the one every caller uses — `harvest()` calls `reachable()` bare. It is short on
    purpose: this is a pre-flight question asked before any work, so a slow default delays the harvest
    on exactly the boxes where the card is absent."""
    ch.reachable("http://192.168.4.1")
    assert urlopen_spy.calls[0]["kw"]["timeout"] == 5.0

    ch.reachable("http://192.168.4.1", timeout=0.25)
    assert urlopen_spy.calls[1]["kw"]["timeout"] == 0.25, "an explicit bound must override, not be ignored"


# ── the accepted status range ───────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "status, expected",
    [(200, True), (204, True), (301, True), (399, True), (400, False), (401, False), (500, False)],
)
def test_only_2xx_and_3xx_count_as_answering(urlopen_spy, status, expected):
    """`200 <= status < 400`. 400 is the first REJECTION and must not count — a card answering 401 or
    404 is a host on the network that cannot serve the listing, which is precisely the case where the
    harvest must associate instead of assuming it can download. The bound is exclusive: `<= 400` and
    `< 401` both admit it, and neither is visible without landing on 400 itself."""
    urlopen_spy.reply = _Resp(status)
    assert ch.reachable("http://192.168.4.1") is expected


def test_a_response_without_a_status_attribute_is_treated_as_answering(urlopen_spy):
    """`getattr(r, "status", 200)`. Not every file-like urlopen returns carries `.status`; the default
    says "it answered at all, which is what was asked". A default of None crashes the comparison and a
    default of 201 is a lie about what happened — both turn a reachable card into an unreachable one,
    and the harvest escalates for nothing."""
    urlopen_spy.reply = _Resp(status=None)          # no .status attribute at all
    assert ch.reachable("http://192.168.4.1") is True


# ── failure is an answer, not an error ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "exc",
    [
        urllib.error.URLError("no route"),
        urllib.error.HTTPError("u", 500, "boom", {}, None),
        TimeoutError("slow"),
        OSError("down"),
    ],
)
def test_any_failure_answers_false_rather_than_raising(urlopen_spy, exc):
    """The blanket except is deliberate: unreachable IS the answer. A raise here takes down a harvest
    that would otherwise have associated and succeeded."""
    urlopen_spy.reply = exc
    assert ch.reachable("http://192.168.4.1") is False
