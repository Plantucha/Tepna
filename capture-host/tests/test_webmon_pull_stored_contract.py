# tepna-capture — tests/test_webmon_pull_stored_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`POST /api/pull` — the O2Ring onboard-recording download, and what reaches the puller.

The tests next door prove the outcomes: unavailable is a 400, a busy slot is a 409, a generic failure is
a 500, and a malformed body is tolerated rather than fatal. What none of them observe is the pair of
value the handler actually forwards — `which` — and the mutation audit counted 32 survivors here, most
of them in exactly that pass-through.

🔴 THIS FILE USED TO PIN A CONTRACT THAT WAS WRONG TWICE OVER, and it is worth saying which two.
ARITY: the fakes took `(which, ftype)` while `capture.py` supplies `async def _pull(which="latest")`,
so `/api/pull` raised TypeError and returned 500 on every request for as long as these tests were
green — a stub agreeing with the CALLER instead of the CALLEE. MEANING: the docstrings asserted that
"ftype 0 is the format the ring actually records" and that a wrong one makes the ring report a
nonsense size. `oxyii.file_start_frame` refutes both — the trailing u32 is a BYTE OFFSET, and "the
whole 'try a different --ftype' folklore descends from that one wrong name". The parameter is now
dropped at the handler, so what is pinned below is that it is IGNORED.

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
    async def default_puller(which):
        # ONE parameter, because that is `capture._pull`'s signature. A two-parameter stub here is
        # what hid the 500 — see the module docstring.
        if seen is not None:
            seen.append(which)
        return {"ok": True, "which": which}
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
def test_the_requested_session_reaches_the_puller(tmp_path):
    seen = []
    status, body = _post(tmp_path, {"which": "20260719010000"}, seen=seen)
    assert status == 200 and body["ok"] is True
    assert seen == ["20260719010000"]


def test_the_default_is_latest(tmp_path):
    """`latest` is the safe default — one session, the newest."""
    seen = []
    status, _b = _post(tmp_path, {}, seen=seen)
    assert status == 200 and seen == ["latest"]


def test_an_ftype_IN_THE_BODY_IS_IGNORED_NOT_FORWARDED(tmp_path):
    """∅ The retired knob. `ftype` never selected a file type: its value went into the type-0 START
    frame's trailing u32, which is a BYTE OFFSET, so a non-zero one asked the oximetry store to begin
    reading mid-file. `pull_session.py` records that `--ftype` is "GONE rather than deprecated in the
    CLI: it never did what its name said", and `capture.py` warns when config carries `pull.ftype`.

    A stale UI or a scripted caller may still send it. It must be DROPPED — not coerced, not
    forwarded, and not a 500 — so the value cannot reach a frame builder that would honour it as an
    offset. Every kind is tested, because the old handler's `int()` coercion is exactly what made a
    garbage value look survivable."""
    for sent in (2, "2", "gibberish", None, {"nested": 1}):
        seen = []
        status, _b = _post(tmp_path, {"which": "latest", "ftype": sent}, seen=seen)
        assert status == 200, f"ftype={sent!r} must not fail the request"
        assert seen == ["latest"], f"ftype={sent!r} must not reach the puller, got {seen}"


# ── the deliberate tolerance ────────────────────────────────────────────────────────────────────────
def test_no_body_at_all_pulls_the_latest_session(tmp_path):
    seen = []
    status, _b = _post(tmp_path, seen=seen)
    assert status == 200 and seen == ["latest"]


def test_a_malformed_body_is_folded_to_the_defaults_not_rejected(tmp_path):
    """§D3. Contrast `storage_post`, where the same leniency deleted the configured target — there is no
    state to half-apply here, so a broken body means "use the defaults", not 400."""
    seen = []
    status, _b = _post(tmp_path, raw=b"{not json", seen=seen)
    assert status == 200 and seen == ["latest"]


def test_a_non_object_body_is_folded_to_the_defaults(tmp_path):
    seen = []
    status, _b = _post(tmp_path, raw=b'"just a string"', seen=seen)
    assert status == 200 and seen == ["latest"]


# ── the puller's answer is passed through verbatim ──────────────────────────────────────────────────
def test_the_pullers_result_is_returned_as_the_body(tmp_path):
    async def puller(which):
        return {"ok": True, "saved": ["/srv/tepna/captures/stored/x.dat"], "bytes": 4096}
    status, body = _post(tmp_path, {}, puller=puller)
    assert status == 200
    assert body == {"ok": True, "saved": ["/srv/tepna/captures/stored/x.dat"], "bytes": 4096}


def test_a_puller_that_reports_failure_is_not_rewritten_as_success(tmp_path):
    async def puller(which):
        return {"ok": False, "detail": "ring never appeared"}
    status, body = _post(tmp_path, {}, puller=puller)
    assert status == 200 and body["ok"] is False and body["detail"] == "ring never appeared"


# ── refusals ────────────────────────────────────────────────────────────────────────────────────────
def test_a_busy_download_slot_is_a_409_naming_its_holder(tmp_path):
    """One device owns the single download slot at a time. Expected, retryable, and not a fault — so the
    holder is named rather than buried in a 500."""
    async def busy(which):
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
