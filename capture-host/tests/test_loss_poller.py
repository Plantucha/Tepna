# tepna-capture — tests/test_loss_poller.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""capture.loss_poller: each settled night audited once, re-audited only when its files change, the
active night untouched, a daemon-caused night logged as a warning, one bad night does not stop it."""

import asyncio
import json
import os

import capture
from tests.test_capture_coverage_100 import _run, _stop_after


def _night(root, name):
    d = root / "captures" / name
    d.mkdir(parents=True)
    (d / "Polar_H10_0284_20260920220000_ECG.txt").write_text(
        "Phone timestamp;x\n2026-09-20T22:00:00.000;1\n2026-09-20T22:00:01.000;1\n"
    )
    return d


def test_loss_poller_audits_settled_nights_once_and_skips_the_active_one(tmp_path, monkeypatch, caplog):
    for n in ("2026-09-18", "2026-09-19"):
        _night(tmp_path, n)
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: {"2026-09-19"})
    calls = []

    def fake_write(nd, devices, commit=None):
        calls.append(os.path.basename(nd))
        dc = 3.0 if len(calls) == 1 else 0.0  # the re-audit finds a clean night: no warning the second time
        obj = {
            "status": "UNKNOWN",
            "at": "2026-09-21T00:00:00Z",
            "result": {"daemon_caused_min": dc},
            "reason": "no bar",
        }
        open(os.path.join(nd, capture.loss_audit.VERDICT_NAME), "w").write(json.dumps(obj))
        return obj

    monkeypatch.setattr(capture.loss_audit, "write_night", fake_write)
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 2)
    with caplog.at_level("WARNING"):
        _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == ["2026-09-18"], calls  # once, not per tick; the active night skipped
    assert capture.STATUS["loss"]["2026-09-18"]["daemon_caused_min"] == 3.0
    assert any("3 min of the night's gaps were the daemon's own doing" in r.getMessage() for r in caplog.records)
    # the night's files change ⇒ audited again
    d = tmp_path / "captures" / "2026-09-18"
    v = os.path.getmtime(str(d / capture.loss_audit.VERDICT_NAME))
    os.utime(
        str(d / "Polar_H10_0284_20260920220000_ECG.txt"), (v + 5, v + 5)
    )  # the night's file is newer than its audit
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == ["2026-09-18", "2026-09-18"]
    assert sum("the daemon's own doing" in r.getMessage() for r in caplog.records) == 1
    capture._STOP.clear()
    capture._STOP = asyncio.Event()


def test_loss_poller_survives_a_failing_night(tmp_path, monkeypatch, caplog):
    _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    monkeypatch.setattr(capture.loss_audit, "write_night", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    with caplog.at_level("WARNING"):
        _run(capture.loss_poller({"devices": []}, str(tmp_path)))
    assert any("loss-audit: poll failed" in r.getMessage() for r in caplog.records)
    capture._STOP.clear()


def test_a_SIDECAR_touched_after_the_audit_does_not_re_audit_the_night(tmp_path, monkeypatch):
    """⚠️ THE DEFECT THIS REPLACES, measured on vigil 2026-09-23. The skip compared the audit against a
    DIRECTORY-WIDE max mtime, so any marker another actor wrote made a settled night read as changed —
    and the archive mirror writes `.archived` per night on every verified push. Twelve settled nights
    were re-audited on every 30-minute poll, re-reading ~1.9 GB of H10 ECG alone and re-running a
    journal subprocess per device, for nights whose DATA had not moved in days.

    `nightqc.newest_data_mtime` ranks device-capture files only; its own docstring says that exclusion
    is the whole point. The poller's docstring already promised "the night's PRIMARY files"."""
    d = _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    calls = []

    def fake_write(nd, devices, commit=None):
        calls.append(os.path.basename(nd))
        open(os.path.join(nd, capture.loss_audit.VERDICT_NAME), "w").write("{}")
        return {"status": "UNKNOWN", "at": "x", "result": {"daemon_caused_min": 0.0}, "reason": "no bar"}

    monkeypatch.setattr(capture.loss_audit, "write_night", fake_write)
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == ["2026-09-18"]

    v = os.path.getmtime(str(d / capture.loss_audit.VERDICT_NAME))
    for marker in (".archived", "Tepna_20260918220000_LINK.csv", "QC-SUMMARY.json"):
        (d / marker).write_text("x")
        os.utime(str(d / marker), (v + 60, v + 60))      # newer than the audit, and NOT capture data
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == ["2026-09-18"], "a sidecar or marker is not the night's data changing"

    # …and the positive control: the DATA moving still re-audits, or the skip would be a silent stop
    os.utime(str(d / "Polar_H10_0284_20260920220000_ECG.txt"), (v + 90, v + 90))
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == ["2026-09-18", "2026-09-18"], "the night's own data moved: audit again"
    capture._STOP.clear()


def test_a_folder_with_no_capture_file_is_skipped_not_audited(tmp_path, monkeypatch):
    """`newest_data_mtime` answers None there — an absence, not a zero. A 00:00 folder holding only
    sidecars has no primary stream to audit, and auditing it would report on nothing."""
    d = tmp_path / "captures" / "2026-09-18"
    d.mkdir(parents=True)
    (d / "Tepna_20260918000000_LINK.csv").write_text("x")
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    calls = []
    monkeypatch.setattr(capture.loss_audit, "write_night",
                        lambda nd, devices, commit=None: calls.append(nd) or {"status": "UNKNOWN", "at": "x",
                                                                              "result": {}, "reason": ""})
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == []
    capture._STOP.clear()


