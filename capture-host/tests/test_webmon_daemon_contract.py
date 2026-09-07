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
import pytest  # noqa: E402


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
    status, body = _post(tmp_path, {"verb": "obliterate"}, monkeypatch, fired)
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


@pytest.mark.parametrize("verb", sorted(daemon_control.KILLS_SELF))
def test_a_self_killing_verb_is_REFUSED_while_a_sensor_is_ON_BODY_and_names_which(verb, tmp_path, monkeypatch):
    """⚠️ ENDING THE DAEMON AT 02:00 COSTS THE NIGHT. restart/stop/reboot each drop every BLE link, so
    each is refused while a sensor is recording on-body — measured 2026-08-23, a `restart` mid-capture
    dropped 13 active streams, which is the incident this guard exists for. The guard is server-side, not
    a browser confirm: a direct API call is refused too. It NAMES what is on-body under `worn`, because
    "refused" on its own tells the operator nothing about whether to force it."""
    fired = []
    app, *_ = _mk(tmp_path, devices=[{"name": "H10", "address": "AA"}],
                  status={"H10": {"connected": True, "worn": True}})
    monkeypatch.setattr(daemon_control, "run",
                        lambda v, minutes=None, **kw: fired.append(v))

    async def go(c):
        r = await c.post("/api/daemon", json={"verb": verb})
        return r.status, await r.json()
    status_code, body = _serve(app, go)
    assert status_code == 409, "a state conflict, not a malformed request"
    assert body["ok"] is False and body["worn"] == ["H10"]
    assert "H10" in body["error"] and "force" in body["error"] and verb in body["error"]
    assert fired == [], "nothing may have been scheduled"


@pytest.mark.parametrize("verb", sorted(daemon_control.KILLS_SELF))
def test_a_self_killing_verb_with_force_is_allowed_and_still_answers_before_it_fires(verb, tmp_path, monkeypatch):
    """`force` is an explicit act, not a bypass — the caller was told what was on-body and said it anyway.
    Anyone who could route around this already has sudo and could restart the box directly. The self-
    killing verbs answer BEFORE they fire, so `run` has not been called synchronously by the time the
    response is built."""
    fired = []
    app, *_ = _mk(tmp_path, devices=[{"name": "H10", "address": "AA"}],
                  status={"H10": {"connected": True, "worn": True}})
    monkeypatch.setattr(daemon_control, "run",
                        lambda v, minutes=None, **kw: fired.append(v))

    async def go(c):
        req = {"verb": verb, "force": True}
        if verb == "stop":
            req["minutes"] = 30
        r = await c.post("/api/daemon", json=req)
        return r.status, await r.json()
    status_code, body = _serve(app, go)
    assert status_code == 200 and body["ok"] is True
    assert fired == [], "a self-killing verb kills this server — it must be answered first"


@pytest.mark.parametrize("verb", sorted(daemon_control.KILLS_SELF))
def test_a_CHARGING_sensor_does_NOT_block_a_self_killing_verb(verb, tmp_path, monkeypatch):
    """THE FIX, NOT AN EDGE CASE — and the reason the predicate is on_body, not `connected`. A docked
    sensor reports connected=True while producing nothing, and the old guard gated on `connected`: it
    refused a reboot on the evening every sensor sat idle on its charger (2026-07-26), which is precisely
    when ending the daemon is safest, and is how an operator learns to always force. `charging` wins over
    `worn` here on purpose — a charging device cannot be on a body — so even with worn=True it proceeds
    without force."""
    app, *_ = _mk(tmp_path, devices=[{"name": "H10", "address": "AA"}],
                  status={"H10": {"connected": True, "charging": True, "worn": True}})
    monkeypatch.setattr(daemon_control, "run", lambda v, minutes=None, **kw: None)

    async def go(c):
        req = {"verb": verb}
        if verb == "stop":
            req["minutes"] = 30
        r = await c.post("/api/daemon", json=req)
        return r.status, await r.json()
    status_code, body = _serve(app, go)
    assert status_code == 200 and body["ok"] is True


@pytest.mark.parametrize("verb", sorted(daemon_control.KILLS_SELF))
def test_a_NOT_WORN_or_absent_sensor_does_NOT_block_a_self_killing_verb(verb, tmp_path, monkeypatch):
    """The mirror image, so the guard cannot fire on everything and train the operator to always force. A
    linked-but-not-worn sensor (worn=False) and a disconnected one (connected=False) each read on_body
    False, so nothing is refused and no force is needed."""
    app, *_ = _mk(tmp_path, devices=[{"name": "H10", "address": "AA"}, {"name": "Ring", "address": "BB"}],
                  status={"H10": {"connected": True, "worn": False}, "Ring": {"connected": False}})
    monkeypatch.setattr(daemon_control, "run", lambda v, minutes=None, **kw: None)

    async def go(c):
        req = {"verb": verb}
        if verb == "stop":
            req["minutes"] = 30
        r = await c.post("/api/daemon", json=req)
        return r.status, await r.json()
    status_code, body = _serve(app, go)
    assert status_code == 200 and body["ok"] is True


def test_a_RECOVERY_verb_is_NOT_worn_guarded_because_the_link_is_already_stuck(tmp_path, monkeypatch):
    """DROPS_LINKS (radio/rebind) is deliberately EXEMPT from the on-body guard: those are the BLE-
    recovery rungs, run precisely when a link is already stuck, so a worn-gate would block the one fix
    that clears it. A sensor reading on-body must NOT refuse a `radio`."""
    app, *_ = _mk(tmp_path, devices=[{"name": "H10", "address": "AA"}],
                  status={"H10": {"connected": True, "worn": True}})
    ran = []
    monkeypatch.setattr(daemon_control, "run",
                        lambda v, minutes=None, **kw: (ran.append(v), {"ok": True, "verb": v})[1])

    async def go(c):
        r = await c.post("/api/daemon", json={"verb": "radio"})
        return r.status, await r.json()
    status_code, body = _serve(app, go)
    assert status_code == 200 and body.get("ok") is True
    assert ran == ["radio"], "a recovery verb runs even with a sensor on-body"




def test_the_USB_PORT_COMES_FROM_CONFIG_and_a_port_in_the_BODY_IS_IGNORED(tmp_path, monkeypatch):
    """⚠️ THE SECURITY PROPERTY OF `rebind`, and it was untested until a surviving mutant said so.

    `rebind` unbinds and re-binds a USB device as root. The helper's real allowlist is the device CLASS
    it reads off the hardware, so a hostile port cannot reach a non-radio — but the fixed-surface pattern
    exists so that a REQUEST cannot name the target at all. The body's value must therefore be discarded
    and replaced, not merely defaulted from; those two differ only when an attacker supplies one, which
    is the only case that matters.

    Written after mutating the handler to take the port from the body: every other test still passed."""
    seen = []
    app, cfg, *_ = _mk(tmp_path, devices=[], status={})
    cfg["watchdog"] = {"usb_path": "1-2"}
    monkeypatch.setattr(daemon_control, "run",
                        lambda verb, minutes=None, **kw: seen.append((verb, minutes)) or
                        {"ok": True, "verb": verb, "detail": "re-bound"})

    async def go(c):
        r = await c.post("/api/daemon", json={"verb": "rebind", "minutes": "9-9"})
        return r.status, await r.json()
    status_code, body = _serve(app, go)
    assert status_code == 200 and body["ok"] is True
    assert seen == [("rebind", "1-2")], f"the CONFIG port, never the body's: {seen}"


def test_rebind_is_REFUSED_when_the_box_has_no_configured_adapter_port(tmp_path, monkeypatch):
    """No `watchdog.usb_path` means this box has no adapter to re-bind. Refuse and say so, rather than
    fall back to a guess — there is no safe default for "which USB device should I reset as root"."""
    fired = []
    app, *_ = _mk(tmp_path, devices=[], status={})
    monkeypatch.setattr(daemon_control, "run",
                        lambda verb, minutes=None, **kw: fired.append(verb))

    async def go(c):
        r = await c.post("/api/daemon", json={"verb": "rebind"})
        return r.status, await r.json()
    status_code, body = _serve(app, go)
    assert status_code == 400 and body["ok"] is False
    assert "usb_path" in body["error"]
    assert fired == [], "no port means no call, not a defaulted one"


def test_RADIO_is_answered_INLINE_because_it_drops_links_without_killing_this_server(tmp_path, monkeypatch):
    """`radio` restarts bluetoothd — every BLE link drops, but this process survives, so the helper's
    real output must come back. It is the rung the adapter watchdog structurally cannot fire itself: a
    deaf-but-UP adapter is indistinguishable from nobody wearing the sensors."""
    seen = []
    monkeypatch.setattr(daemon_control, "run",
                        lambda verb, minutes=None, **kw: seen.append(verb) or
                        {"ok": True, "verb": verb, "detail": "bluetooth: active"})
    app, *_ = _mk(tmp_path, devices=[], status={})

    async def go(c):
        r = await c.post("/api/daemon", json={"verb": "radio"})
        return r.status, await r.json()
    status_code, body = _serve(app, go)
    assert status_code == 200 and body["detail"] == "bluetooth: active"
    assert seen == ["radio"], "inline, during the request"
    assert "scheduled_in_s" not in body


def test_DEPLOY_is_answered_INLINE_with_the_report_and_the_restart_flag(tmp_path, monkeypatch):
    """The whole point of the button: it returns what moved and whether the daemon is still on the old
    build. Deferring it would return a cheerful 200 carrying neither."""
    monkeypatch.setattr(daemon_control, "run",
                        lambda verb, minutes=None, **kw: {"ok": True, "verb": verb,
                                                          "detail": "updated abc → def\nRESTART-OWED",
                                                          "restart_owed": True})
    app, *_ = _mk(tmp_path, devices=[], status={})

    async def go(c):
        r = await c.post("/api/daemon", json={"verb": "deploy"})
        return r.status, await r.json()
    status_code, body = _serve(app, go)
    assert status_code == 200 and body["ok"] is True
    assert body["restart_owed"] is True and "updated" in body["detail"]
    assert "scheduled_in_s" not in body


def test_an_inline_verb_gets_ITS_OWN_timeout_not_the_default(tmp_path, monkeypatch):
    """Found while wiring deploy: the inline path passed no timeout at all, so a network fetch would
    have been bounded at the systemctl default. The handler must ask `timeout_for`, not hardcode."""
    seen = {}

    def _fake_run(verb, minutes=None, **kw):
        seen[verb] = kw.get("timeout")
        return {"ok": True, "verb": verb, "detail": ""}

    monkeypatch.setattr(daemon_control, "run", _fake_run)
    app, *_ = _mk(tmp_path, devices=[], status={})

    async def go(c):
        await c.post("/api/daemon", json={"verb": "deploy"})
        await c.post("/api/daemon", json={"verb": "status"})
        return None
    _serve(app, go)
    assert seen["deploy"] == daemon_control.DEPLOY_TIMEOUT_S, seen
    assert seen["status"] == 30.0, seen


@pytest.mark.parametrize("verb", sorted(daemon_control.KILLS_SELF))
def test_a_self_killing_verb_is_REFUSED_while_a_CPAP_HARVEST_is_running(verb, tmp_path, monkeypatch):
    """A HARVEST IS WORK IN FLIGHT TOO, and it is cheaper to wait for than a recording. Measured on
    the box 2026-09-06: a deploy restart landed 108 s into a post-therapy harvest, the boot path read
    the fired marker as "already harvested", and the card was not read for another 5.5 h. A harvest
    runs 16-23 s — so this refusal costs seconds and protects a night of therapy data.

    `running` is the value `capture.py` actually writes across the transfer (set before the first byte,
    cleared after the walk returns), which is the half worth pinning: a guard keyed to a state nothing
    emits would pass its own unit test and never once fire in production."""
    fired = []
    # ⚠️ `cpap` is a TOP-LEVEL key of STATUS, beside `devices` — it is not a device. `_mk`'s `status=`
    # kwarg fills `STATUS["devices"]`, so passing it there leaves the guard reading None and the test
    # green for the wrong reason (it was, first time). The app closes over the dict, and mutating it
    # is exactly what the daemon does: `STATUS["cpap"] = {...}` at capture.py:7111.
    app, _cfg, st, *_ = _mk(tmp_path, devices=[], status={})
    st["cpap"] = {"state": "running"}
    monkeypatch.setattr(daemon_control, "run", lambda v, minutes=None, **kw: fired.append(v))

    async def go(c):
        r = await c.post("/api/daemon", json={"verb": verb})
        return r.status, await r.json()
    status_code, body = _serve(app, go)
    assert status_code == 409, "a state conflict, not a malformed request"
    assert body["ok"] is False and body["harvesting"] is True
    assert "force" in body["error"] and verb in body["error"]
    assert fired == [], "nothing may have been scheduled"


@pytest.mark.parametrize("state", ["idle", "waiting", "error", "ok", "barren", "partial"])
def test_every_NON_running_cpap_state_still_allows_a_restart(state, tmp_path, monkeypatch):
    """The mirror of the test above, and the reason it is parametrised over the whole vocabulary: only
    the transfer itself blocks. `waiting` means the harvest DEFERRED to something else and is not
    holding the card; the terminal states are answers, not work. Blocking on any of them would refuse
    restarts for the rest of the day on a box whose last harvest merely failed."""
    fired = []
    app, _cfg, st, *_ = _mk(tmp_path, devices=[], status={})
    st["cpap"] = {"state": state}
    monkeypatch.setattr(daemon_control, "run", lambda v, minutes=None, **kw: fired.append(v))

    async def go(c):
        r = await c.post("/api/daemon", json={"verb": "restart"})
        return r.status, await r.json()
    status_code, body = _serve(app, go)
    assert status_code == 200 and body["ok"] is True
