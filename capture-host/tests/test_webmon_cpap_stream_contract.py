# tepna-capture — tests/test_webmon_cpap_stream_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`POST /api/cpap/stream` — the monitor's start/stop for the live CPAP waveform.

The endpoint validates the action at the HTTP boundary and delegates to a daemon-injected `cpap_stream`
coroutine (the daemon owns the radios and pushes samples onto the telemetry bus). What must hold HERE: a
build that never wired the callable answers 501; only 'start'/'stop' are accepted; a malformed body is
the shared bad-body 400; whatever the daemon reports is passed straight through (including a gated
ok:false); and an exception in the op becomes a 500 that never crashes the monitor."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests.test_webmon_api import _mk, _serve  # noqa: E402


def _post(tmp_path, body, cpap_stream):
    app, *_ = _mk(tmp_path, cpap_stream=cpap_stream)

    async def go(c):
        r = await c.post("/api/cpap/stream", json=body)
        return r.status, await r.json()
    return _serve(app, go)


def _recorder(result=None, exc=None):
    calls = []

    async def op(action):
        calls.append(action)
        if exc is not None:
            raise exc
        return result if result is not None else {"ok": True, "streaming": action == "start"}
    return op, calls


def test_start_is_forwarded_and_the_result_passed_through(tmp_path):
    op, calls = _recorder(result={"ok": True, "streaming": True, "channels": ["cpap_flow", "cpap_pressure"]})
    status, body = _post(tmp_path, {"action": "start"}, op)
    assert status == 200 and body["ok"] is True and body["streaming"] is True
    assert body["channels"] == ["cpap_flow", "cpap_pressure"]
    assert calls == ["start"]


def test_stop_is_forwarded(tmp_path):
    op, calls = _recorder(result={"ok": True, "streaming": False})
    status, body = _post(tmp_path, {"action": "stop"}, op)
    assert status == 200 and body["streaming"] is False and calls == ["stop"]


def test_an_unknown_action_is_400_and_never_calls_the_op(tmp_path):
    op, calls = _recorder()
    status, body = _post(tmp_path, {"action": "pause"}, op)
    assert status == 400 and "start" in body["error"] and calls == []


def test_a_missing_action_is_400(tmp_path):
    op, calls = _recorder()
    status, body = _post(tmp_path, {}, op)
    assert status == 400 and calls == []


def test_an_unwired_daemon_answers_501_not_200(tmp_path):
    status, body = _post(tmp_path, {"action": "start"}, None)
    assert status == 501 and "not wired" in body["error"]


def test_a_gated_refusal_is_passed_through_as_a_200_verdict(tmp_path):
    """A daemon that refuses because a wearable is live returns ok:false; the endpoint forwards that as a
    200-carried verdict (the HTTP call succeeded; the stream did not start), never rewrites the status."""
    op, calls = _recorder(result={"ok": False, "error": "wearable capture is live (ecg_h10) — refusing"})
    status, body = _post(tmp_path, {"action": "start"}, op)
    assert status == 200 and body["ok"] is False and "ecg_h10" in body["error"]
    assert calls == ["start"]


def test_an_op_that_raises_is_500_not_a_crash(tmp_path):
    op, calls = _recorder(exc=RuntimeError("adapter hci1 not found"))
    status, body = _post(tmp_path, {"action": "start"}, op)
    assert status == 500 and body["ok"] is False
    assert "RuntimeError" in body["error"] and "hci1" in body["error"]
    assert calls == ["start"]


def test_a_malformed_body_is_the_shared_bad_body_response(tmp_path):
    op, calls = _recorder()
    app, *_ = _mk(tmp_path, cpap_stream=op)

    async def go(c):
        r = await c.post("/api/cpap/stream", data=b"{not json", headers={"content-type": "application/json"})
        return r.status
    status = _serve(app, go)
    assert status == 400 and calls == []
