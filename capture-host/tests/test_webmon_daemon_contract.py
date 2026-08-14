# tepna-capture — tests/test_webmon_daemon_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`POST /api/daemon` — the ordering contract, which is the whole reason this is not three lines inline.

THE UNIT BEING RESTARTED SERVES THIS RESPONSE. A synchronous call stops the process mid-write, the
client sees a dropped connection, and a restart that WORKED is indistinguishable from a crash — which
is how an operator learns not to trust the button. So the handler answers first and fires afterwards.

That ordering creates its own trap, and it is the one asserted hardest here: an answer-then-fire design
that validates in the DEFERRED half returns a cheerful 200 and then does nothing. Validation happens
before the answer, so a bad verb or an impossible `minutes` is a 400 and never a silent no-op — the
same silent-success shape this suite keeps finding in other layers.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.test_webmon_api import _mk, _serve  # noqa: E402

import daemon_control  # noqa: E402


def _post(tmp_path, body, monkeypatch, fired=None):
    """Drive a real request through the real app. `_schedule` is replaced so the deferred half is
    OBSERVABLE without stopping the unit the test runner is inside — the seam exists for this."""
    app, *_ = _mk(tmp_path, devices=[], status={})
    if fired is not None:
        # The app closes over `_schedule`; patch the module function it calls instead.
        monkeypatch.setattr(daemon_control, "run",
                            lambda verb, minutes=None, **kw: fired.append((verb, minutes)))

    async def go(c):
        r = await c.post("/api/daemon", json=body)
        return r.status, await r.json()
    return _serve(app, go)


def test_an_unknown_verb_is_a_400_and_fires_NOTHING(tmp_path, monkeypatch):
    fired = []
    status, body = _post(tmp_path, {"verb": "reboot"}, monkeypatch, fired)
    assert status == 400
    assert body["ok"] is False and "unknown verb" in body["error"]
    assert fired == [], "a refused request must not reach the helper"


def test_an_IMPOSSIBLE_minutes_is_a_400_not_a_cheerful_200(tmp_path, monkeypatch):
    """⚠️ THE TRAP THE ORDERING CREATES. Validation lives BEFORE the answer. If it lived in the
    deferred half this would return 200 and then quietly do nothing, which is worse than an error
    because the operator believes capture stopped when it did not."""
    fired = []
    status, body = _post(tmp_path, {"verb": "stop", "minutes": 9999}, monkeypatch, fired)
    assert status == 400
    assert body["ok"] is False and "480" in body["error"]
    assert fired == []


def test_a_malformed_body_is_refused_by_the_shared_contract(tmp_path, monkeypatch):
    app, *_ = _mk(tmp_path, devices=[], status={})

    async def go(c):
        r = await c.post("/api/daemon", data="not json",
                         headers={"content-type": "application/json"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and body["ok"] is False


def test_RESTART_answers_BEFORE_it_fires(tmp_path, monkeypatch):
    """The response must exist and say what will happen. If the helper ran inline, this request would
    never complete — the process serving it would be gone."""
    fired = []
    status, body = _post(tmp_path, {"verb": "restart"}, monkeypatch, fired)
    assert status == 200
    assert body["ok"] is True and body["verb"] == "restart"
    assert body["scheduled_in_s"] == daemon_control.RESTART_DELAY_S
    assert "disconnect" in body["detail"], "the operator must be told the page will drop"
    # THE ASSERTION THAT MAKES THIS TEST NON-VACUOUS. Without it the test passes just as happily
    # against a handler that fires INLINE, because the patched runner returns instantly. An empty
    # `fired` at response time is the only evidence the helper had not been invoked yet.
    assert fired == [], "the helper must NOT have run by the time the response was produced"


def test_STOP_reports_the_duration_it_will_actually_use(tmp_path, monkeypatch):
    """The detail carries the RESOLVED minutes, not the raw input — a default that silently differed
    from what the card shows is how an operator mis-plans a probe window."""
    fired = []
    status, body = _post(tmp_path, {"verb": "stop", "minutes": 12}, monkeypatch, fired)
    assert status == 200 and body["ok"] is True
    assert "12 min" in body["detail"]
    assert fired == [], "stop kills this process too — it must be answered before it is fired"


def test_STOP_with_no_minutes_uses_the_declared_default(tmp_path, monkeypatch):
    fired = []
    _status, body = _post(tmp_path, {"verb": "stop"}, monkeypatch, fired)
    assert f"{daemon_control.DEFAULT_STOP_MINUTES} min" in body["detail"]


def test_STATUS_is_answered_INLINE_because_it_does_not_kill_the_server(tmp_path, monkeypatch):
    """The read-only verb must not be deferred: a deferred read reports nothing, so the caller would
    get an empty success for a question it asked in order to get an answer."""
    seen = []

    def _fake_run(verb, minutes=None, **kw):
        seen.append(verb)
        return {"ok": True, "verb": verb, "detail": "tepna-capture.service: active"}

    monkeypatch.setattr(daemon_control, "run", _fake_run)
    app, *_ = _mk(tmp_path, devices=[], status={})

    async def go(c):
        r = await c.post("/api/daemon", json={"verb": "status"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True
    assert body["detail"] == "tepna-capture.service: active", "an inline verb returns the REAL output"
    assert seen == ["status"], "status must run during the request, not after it"


def test_the_DEFERRED_HALF_FIRES_with_the_verb_and_minutes_that_were_ASKED_FOR(tmp_path, monkeypatch):
    """⚠️ THE OTHER HALF OF THE ORDERING CONTRACT, and the one every other test here is blind to.

    Every test above asserts `fired == []` — which proves the answer came FIRST, and proves nothing at
    all about what happens next. The mutation gate found this: ten separate mutants of the scheduling
    line survived, including `_schedule(delay, verb, None)` and `daemon_control.run(verb, None)`. Under
    any of them the operator asks to stop capture for 12 minutes, gets a cheerful 200 saying '12 min',
    and the box comes back after the 30-minute default — a silent success, which is this suite's most
    frequently re-found failure shape.

    So this one lets the timer actually elapse and reads what came out the other side."""
    fired = []
    app, *_ = _mk(tmp_path, devices=[], status={})
    monkeypatch.setattr(daemon_control, "run",
                        lambda verb, minutes=None, **kw: fired.append((verb, minutes)))

    async def go(c):
        r = await c.post("/api/daemon", json={"verb": "stop", "minutes": 12})
        body = await r.json()
        assert fired == [], "still answer-then-fire: nothing may have run at response time"
        await asyncio.sleep(daemon_control.RESTART_DELAY_S + 0.35)   # let call_later come due
        return body
    _serve(app, go)
    assert fired == [("stop", 12)], f"the deferred call must carry BOTH arguments through: {fired}"


def test_a_deferred_RESTART_fires_the_restart_verb_and_no_other(tmp_path, monkeypatch):
    """The verb travels through the same seam and was mutable to `None` there too — a restart that
    fired `None` would raise inside a timer callback, where nothing is watching."""
    fired = []
    app, *_ = _mk(tmp_path, devices=[], status={})
    monkeypatch.setattr(daemon_control, "run",
                        lambda verb, minutes=None, **kw: fired.append((verb, minutes)))

    async def go(c):
        await c.post("/api/daemon", json={"verb": "restart"})
        await asyncio.sleep(daemon_control.RESTART_DELAY_S + 0.35)
        return None
    _serve(app, go)
    assert [v for v, _ in fired] == ["restart"], f"exactly the restart verb, once: {fired}"


def test_RELOAD_is_answered_INLINE_with_the_real_output_not_deferred(tmp_path, monkeypatch):
    """The mirror of the STATUS test, for the same reason and a sharper one: a deferred reload would
    report nothing about the only two questions the verb exists to answer — whether a reload was owed,
    and whether it cleared. `reload` does not stop this server, so there is nothing to defer for."""
    seen = []

    def _fake_run(verb, minutes=None, **kw):
        seen.append((verb, minutes))
        return {"ok": True, "verb": verb,
                "detail": "tepna-capture.service: unit files re-read — a reload WAS owed"}

    monkeypatch.setattr(daemon_control, "run", _fake_run)
    app, *_ = _mk(tmp_path, devices=[], status={})

    async def go(c):
        r = await c.post("/api/daemon", json={"verb": "reload"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True
    assert "WAS owed" in body["detail"], "the helper's real answer must reach the caller"
    assert seen == [("reload", None)], "reload must run DURING the request, not after it"
    assert "scheduled_in_s" not in body, "an inline verb has nothing scheduled — saying so would lie"
