# tepna-capture — tests/test_webmon_pull_stored_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`POST /api/pull` — the O2Ring onboard-recording download, and what reaches the puller.

The tests next door prove the outcomes: unavailable is a 400, a busy slot is a 409, a generic failure is
a 500, and a malformed body is tolerated rather than fatal. What none of them observe is the pair of
values the handler actually forwards — `which` and `ftype` — and the mutation audit counted 32 survivors
here, most of them in exactly that pass-through.

The tolerance is deliberate and worth restating, because the identical leniency was a bug elsewhere:
this body carries only DEFAULTS, so folding a malformed one to `{}` destroys nothing. `storage_post`
does the opposite, because there the same folding deleted the configured offload target
(CAPTURE-HOST-DEEP-AUDIT §D1). Tolerance is a property of what a handler can damage, not a house style —
so the values that survive the folding are the thing to pin.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import offline_lock  # noqa: E402
from tests.test_webmon_api import _mk, _serve  # noqa: E402


def _post(tmp_path, body=None, puller=None, seen=None, raw=None):
    async def default_puller(which, ftype):
        if seen is not None:
            seen.append((which, ftype))
        return {"ok": True, "which": which, "ftype": ftype}
    app, *_ = _mk(tmp_path, pull_stored=puller or default_puller)

    async def go(c):
        if raw is not None:
            r = await c.post("/api/pull", data=raw,
                             headers={"Content-Type": "application/json"})
        elif body is None:
            r = await c.post("/api/pull")
        else:
            r = await c.post("/api/pull", json=body)
        return r.status, await r.json()
    return _serve(app, go)


# ── what reaches the puller ─────────────────────────────────────────────────────────────────────────
def test_the_requested_session_and_file_type_reach_the_puller(tmp_path):
    seen = []
    status, body = _post(tmp_path, {"which": "20260719010000", "ftype": 2}, seen=seen)
    assert status == 200 and body["ok"] is True
    assert seen == [("20260719010000", 2)]


def test_the_defaults_are_latest_and_ftype_zero(tmp_path):
    """`latest` is the safe default — one session, the newest — and ftype 0 is the format the ring
    actually records. A wrong ftype makes the ring report a nonsense size and the pull is skipped, which
    surfaces as "nothing to download" rather than as an error."""
    seen = []
    status, _b = _post(tmp_path, {}, seen=seen)
    assert status == 200 and seen == [("latest", 0)]


def test_a_string_file_type_is_coerced_to_an_integer(tmp_path):
    """It reaches the BLE frame builder as a number; a string would fail deeper, in a stack frame that
    says nothing about the request that caused it."""
    seen = []
    _post(tmp_path, {"which": "latest", "ftype": "2"}, seen=seen)
    assert seen == [("latest", 2)] and isinstance(seen[0][1], int)


def test_an_unparseable_file_type_falls_back_to_zero_rather_than_failing(tmp_path):
    seen = []
    status, _b = _post(tmp_path, {"ftype": "gibberish"}, seen=seen)
    assert status == 200 and seen == [("latest", 0)]


# ── the deliberate tolerance ────────────────────────────────────────────────────────────────────────
def test_no_body_at_all_pulls_the_latest_session(tmp_path):
    seen = []
    status, _b = _post(tmp_path, seen=seen)
    assert status == 200 and seen == [("latest", 0)]


def test_a_malformed_body_is_folded_to_the_defaults_not_rejected(tmp_path):
    """§D3. Contrast `storage_post`, where the same leniency deleted the configured target — there is no
    state to half-apply here, so a broken body means "use the defaults", not 400."""
    seen = []
    status, _b = _post(tmp_path, raw=b"{not json", seen=seen)
    assert status == 200 and seen == [("latest", 0)]


def test_a_non_object_body_is_folded_to_the_defaults(tmp_path):
    seen = []
    status, _b = _post(tmp_path, raw=b'"just a string"', seen=seen)
    assert status == 200 and seen == [("latest", 0)]


# ── the puller's answer is passed through verbatim ──────────────────────────────────────────────────
def test_the_pullers_result_is_returned_as_the_body(tmp_path):
    async def puller(which, ftype):
        return {"ok": True, "saved": ["/srv/tepna/captures/stored/x.dat"], "bytes": 4096}
    status, body = _post(tmp_path, {}, puller=puller)
    assert status == 200
    assert body == {"ok": True, "saved": ["/srv/tepna/captures/stored/x.dat"], "bytes": 4096}


def test_a_puller_that_reports_failure_is_not_rewritten_as_success(tmp_path):
    async def puller(which, ftype):
        return {"ok": False, "detail": "ring never appeared"}
    status, body = _post(tmp_path, {}, puller=puller)
    assert status == 200 and body["ok"] is False and body["detail"] == "ring never appeared"


# ── refusals ────────────────────────────────────────────────────────────────────────────────────────
def test_a_busy_download_slot_is_a_409_naming_its_holder(tmp_path):
    """One device owns the single download slot at a time. Expected, retryable, and not a fault — so the
    holder is named rather than buried in a 500."""
    async def busy(which, ftype):
        raise offline_lock.OfflineBusy("H10")
    status, body = _post(tmp_path, {}, puller=busy)
    assert status == 409 and body["ok"] is False and body["busy"] == "H10"


def test_the_endpoint_reports_unavailable_when_the_daemon_supplied_no_puller(tmp_path):
    app, *_ = _mk(tmp_path, pull_stored=None)

    async def go(c):
        r = await c.post("/api/pull", json={})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and body["ok"] is False and "not available" in body["detail"]
