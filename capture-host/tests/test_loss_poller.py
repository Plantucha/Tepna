# tepna-capture — tests/test_loss_poller.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""capture.loss_poller: each settled night audited once, re-audited only when its files change, the
active night untouched, a daemon-caused night logged as a warning, one bad night does not stop it."""

import asyncio
import json
import os
import time

import capture
from tests.test_capture_coverage_100 import _run, _stop_after


def _night(root, name, quiet_s=7200):
    """A night whose DEVICE data is `quiet_s` seconds old — SETTLED by default.

    The age is part of the fixture, not decoration: the poller's settled loop asks
    `diskguard.active_nights` (any file) and the pending publisher asks `nightqc.data_quiet_s` (capture
    files only), and in production the first is a superset of the second. A fixture that writes its data
    NOW while monkeypatching `active_nights` to empty makes the two disagree in a way the box cannot, and
    the test would then be pinning an arrangement that does not exist. Pass `quiet_s=0` for a night that
    really is still recording."""
    d = root / "captures" / name
    d.mkdir(parents=True)
    f = d / "Polar_H10_0284_20260920220000_ECG.txt"
    f.write_text("Phone timestamp;x\n2026-09-20T22:00:00.000;1\n2026-09-20T22:00:01.000;1\n")
    t = time.time() - quiet_s
    os.utime(f, (t, t))
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
        os.utime(str(d / marker), (v + 60, v + 60))  # newer than the audit, and NOT capture data
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
    monkeypatch.setattr(
        capture.loss_audit,
        "write_night",
        lambda nd, devices, commit=None: (
            calls.append(nd) or {"status": "UNKNOWN", "at": "x", "result": {}, "reason": ""}
        ),
    )
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path)))
    assert calls == []
    capture._STOP.clear()


def _audit_writer(calls, write_file=True):
    def fake_write(nd, devices, commit=None):
        calls.append(os.path.basename(nd))
        if write_file:
            open(os.path.join(nd, capture.loss_audit.VERDICT_NAME), "w").write("{}")
        return {"status": "UNKNOWN", "at": "x", "result": {"daemon_caused_min": 0.0}, "reason": "no bar"}

    return fake_write


def _poll_once(monkeypatch, tmp_path, devices=()):
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": list(devices)}, str(tmp_path)))
    capture._STOP.clear()


def test_the_solid_night_verdict_follows_the_audit_and_only_the_audit(tmp_path, monkeypatch):
    """SOLID-NIGHT §2: composed on the loss audit's OWN trigger — once per audit, again only when the audit
    moved. STATUS is replaced for this test so no other test's state can leak in either direction."""
    d = _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    composed = []
    real = capture.solid_night.write_night
    monkeypatch.setattr(
        capture.solid_night,
        "write_night",
        lambda nd, *a, **k: composed.append(os.path.basename(nd)) or real(nd, *a, **k),
    )
    _poll_once(monkeypatch, tmp_path)
    assert composed == ["2026-09-18"] and (d / capture.solid_night.VERDICT_NAME).exists()
    s = capture.STATUS["solid"]
    assert s["night"] == "2026-09-18" and s["status"] == "UNKNOWN" and s["run"].startswith("0 solid of")
    _poll_once(monkeypatch, tmp_path)
    assert composed == ["2026-09-18"], "the audit did not move, so neither does the verdict"
    v = os.path.getmtime(str(d / capture.solid_night.VERDICT_NAME))
    os.utime(str(d / capture.loss_audit.VERDICT_NAME), (v + 5, v + 5))  # the audit is newer than the verdict
    _poll_once(monkeypatch, tmp_path)
    assert composed == ["2026-09-18", "2026-09-18"]


def test_a_verdict_that_cannot_be_composed_is_logged_and_the_audit_stands(tmp_path, monkeypatch, caplog):
    _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    monkeypatch.setattr(capture.solid_night, "write_night", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    with caplog.at_level("WARNING"):
        _poll_once(monkeypatch, tmp_path)
    assert any("solid-night: 2026-09-18 — verdict not written" in r.getMessage() for r in caplog.records)
    assert "2026-09-18" in capture.STATUS["loss"] and "solid" not in capture.STATUS


def test_no_audit_on_disk_means_no_verdict_is_composed_over_nothing(tmp_path, monkeypatch):
    d = _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    calls = []
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer(calls, write_file=False))
    _poll_once(monkeypatch, tmp_path)
    assert calls == ["2026-09-18"] and not (d / capture.solid_night.VERDICT_NAME).exists()
    assert "solid" not in capture.STATUS


# ── the pending statement: the night that has NOT settled ───────────────────────────────────────────


def _cfg_devices():
    return [{"name": "Polar H10 0284", "model": "H10"}]


def test_a_night_still_receiving_data_is_published_as_pending_with_its_settle_countdown(tmp_path, monkeypatch):
    """The morning case: between doff and the audit the surface had nothing new to say and kept the
    PREVIOUS night's verdict under the previous night's date."""
    _night(tmp_path, "2026-09-18")  # settled, audited by the loop
    _night(tmp_path, "2026-09-19", quiet_s=120)  # still recording
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: {"2026-09-19"})
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    _poll_once(monkeypatch, tmp_path, devices=_cfg_devices())
    s = capture.STATUS["solid"]
    assert s["night"] == "2026-09-19"
    assert s["status"] == "UNKNOWN" and s["reason"] == capture.solid_night.NOT_SETTLED
    assert 110 <= s["quiet_s"] <= 130
    # The window is the config's, not a number spelled twice: `settles_in_s` is what is LEFT of it.
    assert s["quiet_s"] + s["settles_in_s"] == capture._NIGHT_SETTLE_S
    assert not (tmp_path / "captures" / "2026-09-19" / capture.solid_night.VERDICT_NAME).exists()


def test_the_live_vitals_file_in_last_nights_folder_does_not_nominate_it_as_pending(tmp_path, monkeypatch):
    """The box's own state, 2026-09-29: `OXYLIFE.csv` is appended into the session's START-date folder for
    as long as the run lasts, so `2026-09-28` was `active` 11 h after its last device sample and 8 h after
    its own verdict. Nominating on `active` would have replaced that verdict with "pending" all day."""
    d = _night(tmp_path, "2026-09-28")  # device data 2 h quiet
    (d / "OXYLIFE.csv").write_text("live\n")  # touched seconds ago — activity, but not device data
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: {"2026-09-28"})
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    _poll_once(monkeypatch, tmp_path, devices=_cfg_devices())
    assert "solid" not in capture.STATUS, "a lifecycle append is not a reason to call a night pending"


def test_a_pending_night_older_than_what_is_published_does_not_pull_the_surface_back(tmp_path, monkeypatch):
    _night(tmp_path, "2026-09-18", quiet_s=60)
    monkeypatch.setattr(capture, "STATUS", {"solid": {"night": "2026-09-19", "status": "FAIL"}})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: {"2026-09-18"})
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    _poll_once(monkeypatch, tmp_path, devices=_cfg_devices())
    assert capture.STATUS["solid"] == {"night": "2026-09-19", "status": "FAIL"}


def test_a_folder_with_no_device_data_is_never_the_pending_night(tmp_path, monkeypatch):
    """The midnight decoy: at 00:00 the box creates tomorrow's folder and writes SIDECARS into it while
    every sensor keeps appending to the session's start-date folder."""
    _night(tmp_path, "2026-09-18", quiet_s=60)
    d = tmp_path / "captures" / "2026-09-19"
    d.mkdir(parents=True)
    (d / "Tepna_20260919000000_LINK.csv").write_text("x\n")  # a sidecar, and lexically newer
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: {"2026-09-18", "2026-09-19"})
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    _poll_once(monkeypatch, tmp_path, devices=_cfg_devices())
    assert capture.STATUS["solid"]["night"] == "2026-09-18"


def test_a_pending_verdict_that_cannot_be_composed_is_logged_and_nothing_is_published(tmp_path, monkeypatch, caplog):
    _night(tmp_path, "2026-09-19", quiet_s=60)
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: {"2026-09-19"})
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    monkeypatch.setattr(
        capture.solid_night, "pending_verdict", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    with caplog.at_level("WARNING"):
        _poll_once(monkeypatch, tmp_path, devices=_cfg_devices())
    assert any("solid-night: 2026-09-19 — pending verdict not composed" in r.getMessage() for r in caplog.records)
    assert "solid" not in capture.STATUS


def test_an_empty_captures_tree_publishes_nothing_rather_than_a_night_shaped_null(tmp_path, monkeypatch):
    (tmp_path / "captures").mkdir(parents=True)
    monkeypatch.setattr(capture, "STATUS", {})
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    _poll_once(monkeypatch, tmp_path, devices=_cfg_devices())
    assert "solid" not in capture.STATUS
