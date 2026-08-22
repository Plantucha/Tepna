# tepna-capture — tests/test_webmon_cpap_pair_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`POST /api/cpap/pair` — the monitor's path to ResMed AS11 BLE pairing.

The endpoint validates the passkey at the HTTP boundary and delegates the SRP-6a handshake to a
daemon-injected `cpap_pair` coroutine (the daemon owns the radios). What must hold HERE: a build that
never wired the callable answers 501 rather than pretending; the passkey shown on the CPAP screen must
be 4–10 digits or the request 400s before any BLE work; a malformed body is the shared bad-body 400;
whatever the daemon's pairing op reports is passed straight through; and an exception in the pairing op
becomes a 500 that never crashes the monitor — never a silent success."""
import os
import sys

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

    async def pair(passkey):
        calls.append(passkey)
        if exc is not None:
            raise exc
        return result if result is not None else {"ok": True, "verified": True, "stored": True}
    return pair, calls


def test_a_valid_passkey_pairs_and_passes_the_result_through(tmp_path):
    pair, calls = _recorder(result={"ok": True, "verified": True, "clientId": "abc"})
    status, body = _post(tmp_path, {"passkey": "482913"}, pair)
    assert status == 200 and body["ok"] is True and body["verified"] is True
    assert body["clientId"] == "abc"
    assert calls == ["482913"]


def test_a_non_digit_passkey_is_400_and_never_pairs(tmp_path):
    pair, calls = _recorder()
    status, body = _post(tmp_path, {"passkey": "12ab"}, pair)
    assert status == 400 and "digit" in body["error"]
    assert calls == []


def test_a_too_short_passkey_is_400(tmp_path):
    pair, calls = _recorder()
    status, body = _post(tmp_path, {"passkey": "123"}, pair)
    assert status == 400 and calls == []


def test_a_too_long_passkey_is_400(tmp_path):
    pair, calls = _recorder()
    status, body = _post(tmp_path, {"passkey": "12345678901"}, pair)
    assert status == 400 and calls == []


def test_a_missing_passkey_is_400(tmp_path):
    pair, calls = _recorder()
    status, body = _post(tmp_path, {}, pair)
    assert status == 400 and calls == []


def test_the_passkey_is_stripped_before_validation(tmp_path):
    pair, calls = _recorder()
    status, body = _post(tmp_path, {"passkey": "  482913  "}, pair)
    assert status == 200 and calls == ["482913"]


def test_an_unwired_daemon_answers_501_not_200(tmp_path):
    """A monitor talking to a daemon that predates the feature must get 'not wired', never a 200 that
    quietly pairs nothing."""
    status, body = _post(tmp_path, {"passkey": "482913"}, None)
    assert status == 501 and "not wired" in body["error"]


def test_a_pairing_op_that_raises_is_500_not_a_crash(tmp_path):
    pair, calls = _recorder(exc=RuntimeError("device not in pairing mode"))
    status, body = _post(tmp_path, {"passkey": "482913"}, pair)
    assert status == 500 and body["ok"] is False
    assert "RuntimeError" in body["error"] and "device not in pairing mode" in body["error"]
    assert calls == ["482913"]


def test_a_pairing_op_that_reports_failure_is_passed_through(tmp_path):
    """A device that refused the passkey returns {ok:false}; the endpoint forwards it as a 200-carried
    verdict (the HTTP call succeeded; the pairing did not), never rewrites it to an error status."""
    pair, calls = _recorder(result={"ok": False, "error": "bad passkey (M2 mismatch)"})
    status, body = _post(tmp_path, {"passkey": "000000"}, pair)
    assert status == 200 and body["ok"] is False and "M2" in body["error"]
    assert calls == ["000000"]


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
