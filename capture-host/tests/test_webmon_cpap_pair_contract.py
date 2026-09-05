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

    async def pair(action, *, passkey=None, ble_addr=""):
        calls.append((action, passkey, ble_addr))
        if exc is not None:
            raise exc
        return result if result is not None else {"ok": True, "verified": True, "stored": True}
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
    pair, calls = _recorder(result={"ok": True, "verified": True, "clientId": "abc", "live": False,
                                    "restart_required": True})
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


@pytest.mark.parametrize("action", ["cancel", "status"])
def test_cancel_and_status_need_no_passkey(tmp_path, action):
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
    status, body = _post(tmp_path, {"action": "start", "ble_addr": "AA"}, pair)
    assert status == 500 and body["ok"] is False
    assert "RuntimeError" in body["error"] and "device not in pairing mode" in body["error"]
    assert calls == [("start", None, "AA")]


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
