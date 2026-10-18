# tepna-capture — tests/test_qc_child.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""qc_child: the night-QC work the daemon runs OFF its own process.

Every function here is called with plain data and returns plain data, because that is the only shape a
spawned child can be handed. These tests drive the module directly — the seam that decides WHERE it
runs is `capture._qc_offload` and lives in tests/test_qc_offload.py.
"""

import json
import os
import re

import pytest

import loss_audit
import nightqc
import qc_child
import solid_night


def _audit(d, *, mtime=None):
    p = os.path.join(str(d), loss_audit.VERDICT_NAME)
    open(p, "w").write("{}")
    if mtime is not None:
        os.utime(p, (mtime, mtime))
    return p


def _verdict(d, *, mtime=None):
    p = os.path.join(str(d), solid_night.VERDICT_NAME)
    open(p, "w").write("{}")
    if mtime is not None:
        os.utime(p, (mtime, mtime))
    return p


# ── scan_night ──────────────────────────────────────────────────────────────────────────────────────
def test_scan_night_returns_the_summary_and_the_wear_ends_from_ONE_call(tmp_path, monkeypatch):
    """One child per poll carries both scans, so both answers come back in one envelope. `attach_wear`
    is deliberately NOT applied here: it is pure and cheap, and the parent is where the boundary check
    that refuses a non-dict summary already lives."""
    monkeypatch.setattr(nightqc, "summarize", lambda nd, dv: {"night": os.path.basename(nd), "devices": dv})
    # BOTH fakes read BOTH arguments. A fake that ignores them lets the night and the device list swap
    # places unnoticed, which is a real call-site defect and is invisible to an assertion on the shape.
    monkeypatch.setattr(loss_audit, "wear_by_device", lambda nd, dv: {"dir": os.path.basename(nd), "devices": dv})

    out = qc_child.scan_night(str(tmp_path / "2026-10-13"), [{"name": "H10"}])

    assert out == {
        "summary": {"night": "2026-10-13", "devices": [{"name": "H10"}]},
        "wear": {"dir": "2026-10-13", "devices": [{"name": "H10"}]},
        "wear_reason": None,
    }


def test_a_wear_scan_that_raises_is_an_ABSENCE_WITH_A_REASON_and_never_an_empty_mapping(tmp_path, monkeypatch):
    """§∅. `{}` is a legal wear mapping — it says "no configured device has a wear rule" — so returning
    it for a scan that FAILED would publish "nobody was worn" as a measurement. The reason travels back
    as a value because a spawned child has no handler for the daemon's logger."""
    monkeypatch.setattr(nightqc, "summarize", lambda nd, dv: {"night": "n"})
    seen: list = []

    def boom(nd, dv):
        seen.append((nd, dv))
        raise OSError("wear stream unreadable")

    monkeypatch.setattr(loss_audit, "wear_by_device", boom)

    out = qc_child.scan_night(str(tmp_path), [{"name": "H10"}])

    assert seen == [(str(tmp_path), [{"name": "H10"}])], "the scan is asked about THIS night and THESE devices"

    assert out["wear"] is None, "an empty mapping would be a claim about every device"
    assert out["wear_reason"] == "OSError: wear stream unreadable"
    assert out["summary"] == {"night": "n"}, "the QC is kept: the wear scan is a REPORT, not the QC"


def test_a_summary_that_is_not_a_dict_is_carried_to_the_parent_UNTOUCHED(tmp_path, monkeypatch):
    """The child does not second-guess the shape — the parent refuses it at the boundary and names the
    value. Checking here as well would be two frames claiming the same edge, and the one that raised
    first would decide which message the journal got."""
    monkeypatch.setattr(nightqc, "summarize", lambda nd, dv: "not a summary")
    monkeypatch.setattr(loss_audit, "wear_by_device", lambda nd, dv: {})

    assert qc_child.scan_night(str(tmp_path), [])["summary"] == "not a summary"


# ── compose_due ─────────────────────────────────────────────────────────────────────────────────────
def test_no_audit_beside_the_night_means_no_verdict_is_due_over_nothing(tmp_path):
    assert qc_child.compose_due(str(tmp_path)) is False


def test_an_audit_with_no_verdict_beside_it_is_due(tmp_path):
    _audit(tmp_path)
    assert qc_child.compose_due(str(tmp_path)) is True


def test_a_verdict_at_or_after_the_audit_is_not_due_again(tmp_path):
    _audit(tmp_path, mtime=1000)
    _verdict(tmp_path, mtime=1000)  # composed since the audit last changed — equal counts as composed
    assert qc_child.compose_due(str(tmp_path)) is False


def test_an_audit_newer_than_the_verdict_is_due_again(tmp_path):
    """The re-audit trigger: the night's data moved, the audit re-ran, so the verdict follows it."""
    _verdict(tmp_path, mtime=1000)
    _audit(tmp_path, mtime=1060)
    assert qc_child.compose_due(str(tmp_path)) is True


# ── audit_and_compose ───────────────────────────────────────────────────────────────────────────────
#: One real device list, so every call-site assertion below reads a value and not an empty list — an
#: empty one is equal to almost anything a wrong call site could hand the audit.
DEV = [{"name": "H10", "kind": "polar"}]


def _job(d, night="2026-10-12", *, audit=True, why=None):
    return {"dir": str(d), "night": night, "audit": audit, "why": why}


def _writer(calls, *, write_file=True, dc=0.0):
    def write_night(nd, devices, commit=None):
        calls.append((os.path.basename(nd), devices, commit))
        if write_file:
            _audit(nd)
        return {"status": "FAIL", "at": "2026-10-12T00:00:00Z", "result": {"daemon_caused_min": dc}, "reason": "a bar"}

    return write_night


def _composer(calls):
    def write_night(nd, devices, *, nights, active, commit=None, reason=None):
        calls.append(
            {
                "night": os.path.basename(nd),
                "devices": devices,
                "nights": nights,
                "active": active,
                "commit": commit,
                "reason": reason,
            }
        )
        _verdict(nd)
        return (
            {"status": "UNKNOWN", "reason": "not scored"},
            {"statement": "0 solid of 1", "solid": 0, "exit": "none"},
        )

    return write_night


def test_a_job_is_audited_then_composed_and_only_the_PROJECTIONS_come_back(tmp_path, monkeypatch):
    """🔴 THE POINT OF THE MODULE. The verdict objects are what the +311..+605 MB peak is made of
    (vigil 2026-10-12); pickling them back to the parent would undo the move. Only the fields the status
    surface publishes cross the boundary."""
    a, c = [], []
    monkeypatch.setattr(loss_audit, "write_night", _writer(a, dc=3.0))
    monkeypatch.setattr(solid_night, "write_night", _composer(c))

    out = qc_child.audit_and_compose([_job(tmp_path, why="judge moved")], DEV, ["2026-10-12"], {"x"}, "abc1234")

    assert a == [(os.path.basename(str(tmp_path)), DEV, "abc1234")], "the night, the devices and the commit"
    assert c == [
        {
            "night": os.path.basename(str(tmp_path)),
            "devices": DEV,
            "nights": ["2026-10-12"],
            "active": {"x"},
            "commit": "abc1234",
            "reason": "judge moved",
        }
    ], "every argument the verdict is composed from comes from the parent, unchanged"
    assert out == [
        {
            "night": "2026-10-12",
            "loss": {"status": "FAIL", "at": "2026-10-12T00:00:00Z", "daemon_caused_min": 3.0, "reason": "a bar"},
            "solid": {
                "status": "UNKNOWN",
                "reason": "not scored",
                "statement": "0 solid of 1",
                "solid": 0,
                "exit": "none",
            },
            "loss_error": None,
            "solid_error": None,
            "stitch": None,
        }
    ]


def test_a_job_that_needs_no_audit_is_still_composed(tmp_path, monkeypatch):
    """The parent sends a night whose audit is current but whose verdict is absent — the case a failed
    composition on an earlier poll leaves behind. Auditing it again would re-read the whole night to
    answer a question already answered on disk."""
    a, c = [], []
    monkeypatch.setattr(loss_audit, "write_night", _writer(a))
    monkeypatch.setattr(solid_night, "write_night", _composer(c))
    _audit(tmp_path)

    out = qc_child.audit_and_compose([_job(tmp_path, audit=False)], [], [], set(), None)

    assert a == [], "no audit was asked for"
    assert out[0]["loss"] is None and out[0]["solid"]["solid"] == 0


def test_an_audit_that_writes_no_verdict_file_composes_over_nothing(tmp_path, monkeypatch):
    """`compose_due` is re-read AFTER the audit, so an audit that wrote no file leaves nothing to
    compose — and the night comes back with its audit projection and no verdict."""
    a, c = [], []
    monkeypatch.setattr(loss_audit, "write_night", _writer(a, write_file=False))
    monkeypatch.setattr(solid_night, "write_night", _composer(c))

    out = qc_child.audit_and_compose([_job(tmp_path)], [], [], set(), None)

    assert a and c == []
    assert out[0]["loss"]["status"] == "FAIL" and out[0]["solid"] is None


def test_a_night_with_nothing_to_compose_does_not_END_the_poll(tmp_path, monkeypatch):
    """The not-due branch goes on to the next job. A `break` there would let one quiet night hide every
    later night of the same poll — and the parent sends them oldest first, so the newest would go."""
    one, two = tmp_path / "2026-10-12", tmp_path / "2026-10-13"
    for d in (one, two):
        d.mkdir()
    a, c = [], []
    rec = _writer(a)

    def write_night(nd, devices, commit=None):
        obj = rec(nd, devices, commit=commit)
        if os.path.basename(nd) == "2026-10-12":
            os.remove(os.path.join(nd, loss_audit.VERDICT_NAME))  # this night's audit wrote no file
        return obj

    monkeypatch.setattr(loss_audit, "write_night", write_night)
    monkeypatch.setattr(solid_night, "write_night", _composer(c))

    out = qc_child.audit_and_compose([_job(one, "2026-10-12"), _job(two, "2026-10-13")], DEV, [], set(), None)

    assert [r["night"] for r in out] == ["2026-10-12", "2026-10-13"], "the quiet night did not end the poll"
    assert out[0]["solid"] is None and out[1]["solid"]["solid"] == 0
    assert [x["night"] for x in c] == ["2026-10-13"], "only the night with an audit beside it was composed"


def test_an_audit_that_raises_STOPS_the_batch_and_the_nights_already_done_still_come_back(tmp_path, monkeypatch):
    """What the in-process loop did: the exception left the per-night loop, so the remaining nights were
    not audited this poll — and the STATUS rows written before it stood. The batch keeps both halves."""
    good = tmp_path / "2026-10-11"
    bad = tmp_path / "2026-10-12"
    last = tmp_path / "2026-10-13"
    for d in (good, bad, last):
        d.mkdir()
    c: list = []
    monkeypatch.setattr(solid_night, "write_night", _composer(c))

    def write_night(nd, devices, commit=None):
        if os.path.basename(nd) == "2026-10-12":
            raise RuntimeError("boom")
        _audit(nd)
        return {"status": "PASS", "at": "t", "result": {}, "reason": None}

    monkeypatch.setattr(loss_audit, "write_night", write_night)

    out = qc_child.audit_and_compose(
        [_job(good, "2026-10-11"), _job(bad, "2026-10-12"), _job(last, "2026-10-13")], [], [], set(), None
    )

    assert [r["night"] for r in out] == ["2026-10-11", "2026-10-12"], "the batch stopped at the bad night"
    assert out[0]["loss"]["status"] == "PASS" and out[0]["solid"] is not None
    assert out[1]["loss"] is None and "RuntimeError: boom" in out[1]["loss_error"]
    assert "Traceback" in out[1]["loss_error"], "the frames travel as text: an exception may not unpickle"
    assert [x["night"] for x in c] == ["2026-10-11"]


def test_a_verdict_that_cannot_be_composed_is_THIS_nights_failure_and_the_audit_beside_it_stands(tmp_path, monkeypatch):
    """A composition failure is per night, where an audit failure is the poll's: the audit has already
    written its file and is not undone by the verdict, and the next night is still judged."""
    one = tmp_path / "2026-10-12"
    two = tmp_path / "2026-10-13"
    for d in (one, two):
        d.mkdir()
    a: list = []
    monkeypatch.setattr(loss_audit, "write_night", _writer(a))

    def boom(nd, devices, **kw):
        raise RuntimeError("no verdict")

    monkeypatch.setattr(solid_night, "write_night", boom)

    out = qc_child.audit_and_compose([_job(one, "2026-10-12"), _job(two, "2026-10-13")], [], [], set(), None)

    assert len(out) == 2, "the batch went on"
    for r in out:
        assert r["loss"]["status"] == "FAIL" and r["solid"] is None
        assert "RuntimeError: no verdict" in r["solid_error"] and r["loss_error"] is None


def test_an_empty_job_list_runs_nothing_and_returns_nothing(monkeypatch):
    """The parent already skips the call when there is no work; this pins that the child is not the
    thing that would have to notice."""
    monkeypatch.setattr(loss_audit, "write_night", lambda *a, **k: pytest.fail("audited with no job"))
    assert qc_child.audit_and_compose([], [], [], set(), None) == []


# ── provenance helpers: _git_sha / _utc_now / _verdict_sample ─────────────────


def test_git_sha_reports_the_running_tree():
    sha = qc_child._git_sha()
    assert sha and re.fullmatch(r"[0-9a-f]{7,40}", sha), "short sha of the checkout"


def test_git_sha_is_absence_when_git_fails(monkeypatch):
    def boom(*a, **k):
        raise OSError("no git here")

    monkeypatch.setattr("subprocess.run", boom)
    assert qc_child._git_sha() is None


def test_utc_now_is_a_zulu_timestamp():
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", qc_child._utc_now())


def test_verdict_sample_is_a_pass_hook_object():
    v = json.loads(qc_child._verdict_sample())
    assert v["schema"] == "tepna.verdict/1"
    assert v["status"] == "PASS"
    assert v["gate"] == "qc-child-stitch-hook"
    assert v["result"]["trigger"] == "PASS"
