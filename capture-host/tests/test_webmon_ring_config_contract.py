# tepna-capture — tests/test_webmon_ring_config_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`POST /api/ring/config` — the monitor's path to the ring's gated settings writer.

The endpoint QUEUES; the oxyii live session applies and read-backs (its tests live in
test_capture_runners). What must hold HERE: validation happens at the HTTP boundary via the same
whitelist the frame builder enforces (an off-whitelist field or out-of-range value 400s and queues
nothing), a daemon that never wired the callback answers 501 rather than pretending, and the queued
response never claims the write happened — only that it will be attempted and read back."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests.test_webmon_api import _mk, _serve  # noqa: E402


def _post(tmp_path, body, ring_config):
    app, *_ = _mk(tmp_path, ring_config=ring_config)

    async def go(c):
        r = await c.post("/api/ring/config", json=body)
        return r.status, await r.json()
    return _serve(app, go)


def _recorder():
    calls = []

    def rc(addr, field, value):
        import oxyii
        oxyii.set_config_frame(field, value)      # the real gate, exactly as capture.queue_ring_config
        calls.append((addr, field, value))
    return rc, calls


def test_a_valid_write_queues_and_says_so(tmp_path):
    rc, calls = _recorder()
    status, body = _post(tmp_path, {"address": "AA:BB:CC:DD:EE:FF", "field": "brightness", "value": 1}, rc)
    assert status == 200 and body["ok"] is True
    assert body["queued"] == {"field": "brightness", "value": 1}
    assert "read-back" in body["note"] or "ring_config" in body["note"], \
        "the response must say verification comes from the ring, not from this 200"
    assert calls == [("AA:BB:CC:DD:EE:FF", "brightness", 1)]


def test_an_off_whitelist_field_is_400_and_queues_nothing(tmp_path):
    rc, calls = _recorder()
    status, body = _post(tmp_path, {"address": "AA:BB:CC:DD:EE:FF", "field": "factory_reset", "value": 1}, rc)
    assert status == 400 and body["ok"] is False
    assert "unknown SET_CONFIG field" in body["error"]
    assert calls == []


def test_an_out_of_range_value_is_400(tmp_path):
    rc, calls = _recorder()
    status, body = _post(tmp_path, {"address": "AA:BB:CC:DD:EE:FF", "field": "brightness", "value": 3}, rc)
    assert status == 400 and "out of range" in body["error"]
    assert calls == []


def test_a_non_integer_value_is_400(tmp_path):
    rc, calls = _recorder()
    status, body = _post(tmp_path, {"address": "AA:BB:CC:DD:EE:FF", "field": "brightness", "value": "hi"}, rc)
    assert status == 400 and "integer" in body["error"]
    assert calls == []


def test_a_bad_address_is_400(tmp_path):
    rc, calls = _recorder()
    status, body = _post(tmp_path, {"address": "not-a-mac", "field": "brightness", "value": 1}, rc)
    assert status == 400 and "address" in body["error"]
    assert calls == []


def test_an_unwired_daemon_answers_501_not_200(tmp_path):
    """A monitor talking to a daemon that predates the feature must get 'not wired', never a 200 that
    quietly queues into nothing."""
    status, body = _post(tmp_path, {"address": "AA:BB:CC:DD:EE:FF", "field": "brightness", "value": 1}, None)
    assert status == 501 and "not wired" in body["error"]


def test_a_malformed_body_is_the_shared_bad_body_response(tmp_path):
    """Same malformed-JSON contract as every other POST: reject before touching the queue."""
    rc, calls = _recorder()
    app, *_ = _mk(tmp_path, ring_config=rc)

    async def go(c):
        r = await c.post("/api/ring/config", data=b"{not json", headers={"content-type": "application/json"})
        return r.status
    status = _serve(app, go)
    assert status == 400
    assert calls == []
