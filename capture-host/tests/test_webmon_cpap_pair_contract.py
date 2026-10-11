# tepna-capture — tests/test_webmon_cpap_pair_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`POST /api/cpap/pair` — the monitor's path to ResMed AS11 BLE pairing, in two requests.

The CPAP shows its passkey only after StartKeyExchange lands on an open link, so the endpoint is a
small action protocol — start · passkey · cancel · status — delegating to a daemon-injected
`cpap_pair(action, passkey=, ble_addr=)` coroutine (the daemon owns the radios and holds the link
between the two requests). What must hold HERE: a build that never wired the callable answers 501
rather than pretending; the passkey must be 4–10 ASCII digits or the request 400s before any BLE work;
an unknown action is 400; a malformed body is the shared bad-body 400; whatever the daemon's pairing
session reports is passed straight through; the old single-shot `{passkey}` body still means the passkey
step; and an exception in the pairing op becomes a 500 that never crashes the monitor."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests.test_webmon_api import _mk, _serve  # noqa: E402


def _post(tmp_path, body, cpap_pair):
    app, *_ = _mk(tmp_path, cpap_pair=cpap_pair)

    async def go(c):
        r = await c.post("/api/cpap/pair", json=body)
        return r.status, await r.json()

    return _serve(app, go)


def _recorder(result=None, exc=None):
    calls = []

    async def pair(action, *, passkey=None, ble_addr="", adapter=None):
        calls.append((action, passkey, ble_addr))
        pair.adapters.append(adapter)
        if exc is not None:
            raise exc
        return result if result is not None else {"ok": True, "verified": True, "stored": True}

    pair.adapters = []
    return pair, calls


def test_start_forwards_the_address_and_passes_the_awaiting_verdict_through(tmp_path):
    pair, calls = _recorder(result={"ok": True, "awaiting": "passkey", "pending": True, "seconds_left": 120.0})
    status, body = _post(tmp_path, {"action": "start", "ble_addr": "AA:BB:CC:DD:EE:FF"}, pair)
    assert status == 200 and body["awaiting"] == "passkey" and body["seconds_left"] == 120.0
    assert calls == [("start", None, "AA:BB:CC:DD:EE:FF")]


def test_start_without_an_address_forwards_an_empty_one_for_the_daemon_to_default(tmp_path):
    pair, calls = _recorder(result={"ok": False, "error": "no CPAP BLE address"})
    status, body = _post(tmp_path, {"action": "start"}, pair)
    assert status == 200 and body["ok"] is False and calls == [("start", None, "")]


def test_a_valid_passkey_reaches_the_session_and_the_result_passes_through(tmp_path):
    pair, calls = _recorder(
        result={"ok": True, "verified": True, "clientId": "abc", "live": False, "restart_required": True}
    )
    status, body = _post(tmp_path, {"action": "passkey", "passkey": "482913"}, pair)
    assert status == 200 and body["verified"] is True and body["restart_required"] is True
    assert calls == [("passkey", "482913", "")]


def test_a_body_with_only_a_passkey_is_the_passkey_step(tmp_path):
    """The pre-two-step shape — a client built against the single-shot contract still reaches step 2."""
    pair, calls = _recorder()
    status, body = _post(tmp_path, {"passkey": "482913"}, pair)
    assert status == 200 and calls == [("passkey", "482913", "")]


@pytest.mark.parametrize("bad", ["12ab", "123", "12345678901", "", "１２３４"])
def test_a_malformed_passkey_is_400_and_never_reaches_the_link(tmp_path, bad):
    pair, calls = _recorder()
    status, body = _post(tmp_path, {"action": "passkey", "passkey": bad}, pair)
    assert status == 400 and "digit" in body["error"]
    assert calls == []


def test_a_missing_passkey_on_the_passkey_step_is_400(tmp_path):
    pair, calls = _recorder()
    status, body = _post(tmp_path, {"action": "passkey"}, pair)
    assert status == 400 and calls == []


def test_the_passkey_is_stripped_before_validation(tmp_path):
    pair, calls = _recorder()
    status, body = _post(tmp_path, {"passkey": "  482913  "}, pair)
    assert status == 200 and calls == [("passkey", "482913", "")]


@pytest.mark.parametrize("action", ["cancel", "status", "forget"])
def test_cancel_status_and_forget_need_no_passkey(tmp_path, action):
    pair, calls = _recorder(result={"ok": True, "pending": False})
    status, body = _post(tmp_path, {"action": action}, pair)
    assert status == 200 and body["pending"] is False and calls == [(action, None, "")]


@pytest.mark.parametrize("body", [{}, {"action": "reboot"}, {"action": ""}])
def test_an_unknown_or_absent_action_is_400(tmp_path, body):
    pair, calls = _recorder()
    status, out = _post(tmp_path, body, pair)
    assert status == 400 and "action must be" in out["error"] and calls == []


def test_an_unwired_daemon_answers_501_not_200(tmp_path):
    """A monitor talking to a daemon that predates the feature must get 'not wired', never a 200 that
    quietly pairs nothing."""
    status, body = _post(tmp_path, {"action": "start"}, None)
    assert status == 501 and "not wired" in body["error"]


def test_a_pairing_op_that_raises_is_500_not_a_crash(tmp_path):
    pair, calls = _recorder(exc=RuntimeError("device not in pairing mode"))
    status, body = _post(tmp_path, {"action": "start", "ble_addr": "AA:BB:CC:DD:EE:FF"}, pair)
    assert status == 500 and body["ok"] is False
    assert "RuntimeError" in body["error"] and "device not in pairing mode" in body["error"]
    assert calls == [("start", None, "AA:BB:CC:DD:EE:FF")]


def test_a_pairing_op_that_reports_failure_is_passed_through(tmp_path):
    """A device that refused the passkey returns {ok:false}; the endpoint forwards it as a 200-carried
    verdict (the HTTP call succeeded; the pairing did not), never rewrites it to an error status."""
    pair, calls = _recorder(result={"ok": False, "verified": False, "error": "bad passkey (M2 mismatch)"})
    status, body = _post(tmp_path, {"action": "passkey", "passkey": "000000"}, pair)
    assert status == 200 and body["ok"] is False and "M2" in body["error"]
    assert calls == [("passkey", "000000", "")]


def test_a_malformed_body_is_the_shared_bad_body_response(tmp_path):
    """Same malformed-JSON contract as every other POST: reject before touching the pairing op."""
    pair, calls = _recorder()
    app, *_ = _mk(tmp_path, cpap_pair=pair)

    async def go(c):
        r = await c.post("/api/cpap/pair", data=b"{not json", headers={"content-type": "application/json"})
        return r.status

    status = _serve(app, go)
    assert status == 400
    assert calls == []


def test_forget_is_ACCEPTED_and_is_not_the_same_action_as_cancel(tmp_path):
    """Until 2026-09-06 the whitelist was start/passkey/cancel/status and nothing anywhere deleted
    `as11_creds.json` — so a stale key could only be displaced by a successful re-pair, the one
    operation a stale key breaks. `cancel` is not a substitute: it drops an exchange in flight and
    stores nothing, which does not touch a key already written."""
    pair, calls = _recorder(result={"ok": True, "forgotten": True})
    status, body = _post(tmp_path, {"action": "forget"}, pair)
    assert status == 200 and body["forgotten"] is True
    assert calls == [("forget", None, "")], "forget must reach the daemon as its own action"


def test_the_rejection_message_lists_forget_so_the_whitelist_cannot_drift_silently(tmp_path):
    pair, _calls = _recorder()
    _status, out = _post(tmp_path, {"action": "nope"}, pair)
    assert "forget" in out["error"], "an action the endpoint accepts must appear in the error that lists them"


# ── documented pairing sequence (2026-10-10): radio choice, scan, and one log line per step ───────────────────
def test_a_chosen_radio_reaches_the_session_on_start_and_scan(tmp_path):
    pair, calls = _recorder(result={"ok": True, "found": []})
    _post(tmp_path, {"action": "scan", "adapter": "AA:BB:CC:10:00:01"}, pair)
    _post(tmp_path, {"action": "start", "adapter": "hci1", "ble_addr": "AA:BB:CC:00:00:01"}, pair)
    _post(tmp_path, {"action": "radios"}, pair)
    assert [c[0] for c in calls] == ["scan", "start", "radios"]
    assert pair.adapters == ["AA:BB:CC:10:00:01", "hci1", None]


@pytest.mark.parametrize("field,bad", [("adapter", "hci1; rm"), ("adapter", "radio"), ("ble_addr", "AA:BB:CC:00:00")])
def test_a_malformed_radio_or_address_is_refused_before_any_ble_work(tmp_path, field, bad):
    pair, calls = _recorder()
    status, body = _post(tmp_path, {"action": "start", field: bad}, pair)
    assert status == 400 and body["ok"] is False and calls == []


def test_each_step_logs_one_line_without_the_passkey_and_status_polls_log_nothing(tmp_path, caplog):
    import logging

    pair, _ = _recorder(result={"ok": False, "verified": False, "error": "As11Error: RPC 2 failed", "clientId": "c"})
    with caplog.at_level(logging.INFO, logger="tepna.webmon"):
        _post(tmp_path, {"action": "passkey", "passkey": "4867"}, pair)
        _post(tmp_path, {"action": "status"}, pair)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("cpap pair")]
    assert lines == ["cpap pair passkey: ok=False verified=False error=As11Error: RPC 2 failed"]
    assert "4867" not in caplog.text and "clientId" not in caplog.text


def test_a_scan_logs_its_hits_or_none(tmp_path, caplog):
    import logging

    hits, _ = _recorder(result={"ok": True, "adapter": "hci1", "found": [{"addr": "AA:BB:CC:00:00:01"}, "junk"]})
    none, _ = _recorder(result={"ok": True, "found": []})
    radios, _ = _recorder(result={"ok": True, "radios": [{}, {}]})
    with caplog.at_level(logging.INFO, logger="tepna.webmon"):
        _post(tmp_path, {"action": "scan"}, hits)
        _post(tmp_path, {"action": "scan"}, none)
        _post(tmp_path, {"action": "radios"}, radios)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("cpap pair")]
    assert lines == [
        "cpap pair scan: ok=True adapter=hci1 found=AA:BB:CC:00:00:01",
        "cpap pair scan: ok=True found=none",
        "cpap pair radios: ok=True radios=2",
    ]


def test_a_raising_pair_op_is_logged(tmp_path, caplog):
    import logging

    pair, _ = _recorder(exc=RuntimeError("boom"))
    with caplog.at_level(logging.WARNING, logger="tepna.webmon"):
        status, _ = _post(tmp_path, {"action": "start"}, pair)
    assert status == 500 and "cpap pair start: raised RuntimeError: boom" in caplog.text


def test_pair_summary_of_a_non_dict_is_its_repr():
    import webmon

    assert webmon._pair_summary(None) == "None"


# ── /api/scan {adapter} and /api/unbond ─────────────────────────────────────────────────────────────
def _with_bonding(monkeypatch, tmp_path, *, calls):
    import bonding

    async def scan(adapter):
        calls.append(("scan", adapter))
        return [bonding.Found(address="AA:BB:CC:00:00:01", name="ResMed 000001", kind="cpap", label="maker 0x038d")]

    async def forget(address, adapter):
        calls.append(("forget", address, adapter))
        return {"ok": True, "address": address}

    monkeypatch.setattr(bonding, "scan", scan)
    monkeypatch.setattr(bonding, "forget", forget)
    app, *_ = _mk(tmp_path)
    return app


def test_scan_runs_on_the_chosen_radio_or_the_wearables_one(tmp_path, monkeypatch):
    calls = []
    app = _with_bonding(monkeypatch, tmp_path, calls=calls)

    async def go(c):
        r1 = await c.post("/api/scan", json={"adapter": "AA:BB:CC:10:00:02"})
        r2 = await c.post("/api/scan")
        r3 = await c.post("/api/scan", json={"adapter": "hci1"})
        return r1.status, await r1.json(), r2.status, r3.status

    s1, body, s2, s3 = _serve(app, go)
    assert s1 == 200 and body[0]["kind"] == "cpap" and body[0]["label"] == "maker 0x038d"
    assert s2 == 200 and s3 == 400
    assert calls[0] == ("scan", "AA:BB:CC:10:00:02") and calls[1][0] == "scan" and len(calls) == 2


def test_unbond_removes_the_bond_and_leaves_config_alone(tmp_path, monkeypatch):
    calls = []
    app = _with_bonding(monkeypatch, tmp_path, calls=calls)

    async def go(c):
        ok = await c.post("/api/unbond", json={"address": "AA:BB:CC:00:00:01"})
        bad = await c.post("/api/unbond", json={"address": "nope"})
        junk = await c.post("/api/unbond", data="{", headers={"content-type": "application/json"})
        return ok.status, await ok.json(), bad.status, junk.status

    s, body, sbad, sjunk = _serve(app, go)
    assert s == 200 and body == {"ok": True, "address": "AA:BB:CC:00:00:01"}
    assert sbad == 400 and sjunk == 400 and [c[0] for c in calls] == ["forget"]


def test_a_malformed_scan_body_is_refused(tmp_path, monkeypatch):
    calls = []
    app = _with_bonding(monkeypatch, tmp_path, calls=calls)

    async def go(c):
        r = await c.post("/api/scan", data="{", headers={"content-type": "application/json"})
        return r.status

    assert _serve(app, go) == 400 and calls == []
