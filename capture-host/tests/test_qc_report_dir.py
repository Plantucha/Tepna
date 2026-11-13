# tepna-capture — tests/test_qc_report_dir.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""A night's own reports go in the folder the BAND names, not in the folder the poller judged.

Row `2026-11-03-a-nights-last-qc-summary-lands-in-the-next-date-folder`, decision #3178. #4324 moved
the night NAME an alert shows; this holds the DESTINATION, which is the other half of that finding.
"""

import asyncio
import datetime as _dtm
import json
import os

import capture
import nightqc
from tests.test_capture_coverage_100 import _run, _stop_after

# 2026-11-02 22:00 and 2026-11-03 04:18 sit in ONE noon-to-noon band, the one named 2026-11-02. The
# second stamp is the ring's real file-set open on the measured night.
EVENING = "20261102220000"
MORNING = "20261103041800"


def _summ(folder, stamp=EVENING, **kw):
    """A summary the poller could have produced over `folder`, judging the band that holds `stamp`."""
    out = {
        "night": folder,
        "missing": [],
        "degraded": [],
        "gaps_in_night": [],
        "span_sec": 23597,
        "devices": [{"name": "Ring", "coverage": {"ppg": 0.975}}],
        "night_window": {"begin": nightqc.floating_stamp_s(stamp), "end": None},
    }
    out.update(kw)
    return out


# ── the resolver (nightqc.report_night) ───────────────────────────────────────────────────────────


def test_the_band_folder_wins_over_the_judged_folder_when_the_two_differ():
    asked = []
    got = nightqc.report_night("2026-11-03", _summ("2026-11-03", MORNING), lambda n: asked.append(n) or True)
    assert got == "2026-11-02", "the summary judged the 11-02 band, so its reports belong in 11-02"
    assert asked == ["2026-11-02"], "the band folder is the one whose existence decides it"


def test_an_ABSENT_band_folder_leaves_the_reports_in_the_judged_folder():
    """A night whose whole file set opened after midnight has no evening folder. Writing one would make
    a night out of a date on which nothing recorded, and the judged folder is the night's only folder."""
    got = nightqc.report_night("2026-11-03", _summ("2026-11-03", MORNING), lambda n: False)
    assert got == "2026-11-03"


def test_the_ORDINARY_night_asks_the_disk_nothing():
    """Folder and band agree on every night that starts before midnight, which is nearly all of them."""
    asked = []
    got = nightqc.report_night("2026-11-02", _summ("2026-11-02"), lambda n: asked.append(n) or True)
    assert got == "2026-11-02" and asked == []


def test_a_summary_with_NO_WINDOW_names_no_band_and_moves_nothing():
    """`digest_night` reads the band off `night_window`. Absent, the band is unknown rather than today."""
    summ = _summ("2026-11-03")
    del summ["night_window"]
    assert nightqc.report_night("2026-11-03", summ, lambda n: True) == "2026-11-03"
    assert nightqc.digest_night(summ) is None


def test_a_summary_that_is_not_an_object_moves_nothing():
    assert nightqc.report_night("2026-11-03", None, lambda n: True) == "2026-11-03"


# ── the daemon's own wiring (capture._report_dir) ─────────────────────────────────────────────────


def test_a_fresh_summary_decides_the_destination_for_its_own_caller(tmp_path):
    os.makedirs(str(tmp_path / "2026-11-02"))
    assert capture._report_dir(str(tmp_path), "2026-11-03", _summ("2026-11-03", MORNING)) == "2026-11-02"


def test_a_caller_WITHOUT_a_summary_reads_the_pollers_live_one(tmp_path, monkeypatch):
    """The CPAP reconciler files beside the summary at the 13:00 harvest and holds no scan of its own."""
    os.makedirs(str(tmp_path / "2026-11-02"))
    monkeypatch.setitem(capture.STATUS, "qc", _summ("2026-11-03", MORNING))
    assert capture._report_dir(str(tmp_path), "2026-11-03") == "2026-11-02"


def test_a_live_summary_of_ANOTHER_folder_decides_nothing(tmp_path, monkeypatch):
    """A band label describes the night it was measured on. Borrowing one would file a harvest beside a
    different night, which is the defect this unit closes, pointing the other way."""
    os.makedirs(str(tmp_path / "2026-11-02"))
    monkeypatch.setitem(capture.STATUS, "qc", _summ("2026-10-30", MORNING))
    assert capture._report_dir(str(tmp_path), "2026-11-03") == "2026-11-03"


def test_no_live_summary_at_all_leaves_the_destination_where_it_was(tmp_path, monkeypatch):
    os.makedirs(str(tmp_path / "2026-11-02"))
    monkeypatch.delitem(capture.STATUS, "qc", raising=False)
    assert capture._report_dir(str(tmp_path), "2026-11-03") == "2026-11-03"


def test_a_live_summary_that_is_not_an_object_leaves_the_destination_where_it_was(tmp_path, monkeypatch):
    os.makedirs(str(tmp_path / "2026-11-02"))
    monkeypatch.setitem(capture.STATUS, "qc", "the scan refused")
    assert capture._report_dir(str(tmp_path), "2026-11-03") == "2026-11-03"


# ── the poller end to end ─────────────────────────────────────────────────────────────────────────


def test_the_poller_writes_the_summary_and_the_verdicts_into_the_BAND_folder(tmp_path, monkeypatch):
    """The measured shape: the ring opened a file set at 04:18 in a fresh 11-03 folder while the Polars
    kept writing to 11-02, so the poller judged 11-03 over the 11-02 band."""
    capture._STOP = asyncio.Event()
    band = tmp_path / "captures" / "2026-11-02"
    judged = tmp_path / "captures" / "2026-11-03"
    os.makedirs(str(band))
    os.makedirs(str(judged))
    (band / "Polar_H10_02849638_20261102_ECG.txt").write_text("h\n1\n")
    (judged / "Wellue_O2Ring-S_S8AW_20261103_PPG.txt").write_text("h\n1\n")
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 11, 3, 10, 20, 0))
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-11-03")
    monkeypatch.setattr(capture.nightqc, "summarize", lambda n, devices: _summ("2026-11-03", MORNING))
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller({"qc": {"poll_sec": 1}, "devices": []}, str(tmp_path), None))
    capture._STOP.clear()
    for name in ("QC-SUMMARY.json", "QC-VERDICT.json", "BACKCHECK-VERDICT.json"):
        assert os.path.exists(str(band / name)), f"{name} belongs in the band's own folder"
        assert not os.path.exists(str(judged / name)), f"{name} must not land in the morning folder"
    got = json.loads((band / "QC-SUMMARY.json").read_text())
    assert got["night"] == "2026-11-03", "the judged folder stays on the record"
    assert got["report_night"] == "2026-11-02", "the summary names the folder it was written into"
    # The reports are in the band folder, so the label names no other folder (box, 2026-11-12).
    assert nightqc.night_label(got) == "2026-11-02"


def test_the_poller_still_writes_into_the_judged_folder_when_it_IS_the_bands(tmp_path, monkeypatch):
    """The anti-vacuous twin: one changed stamp is the whole difference between the two destinations."""
    capture._STOP = asyncio.Event()
    band = tmp_path / "captures" / "2026-11-02"
    os.makedirs(str(band))
    (band / "Polar_H10_02849638_20261102_ECG.txt").write_text("h\n1\n")
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 11, 3, 10, 20, 0))
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-11-02")
    monkeypatch.setattr(capture.nightqc, "summarize", lambda n, devices: _summ("2026-11-02", EVENING))
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller({"qc": {"poll_sec": 1}, "devices": []}, str(tmp_path), None))
    capture._STOP.clear()
    assert os.path.exists(str(band / "QC-SUMMARY.json"))
    assert not os.path.exists(str(tmp_path / "captures" / "2026-11-01"))


def test_the_CPAP_reconciler_files_beside_the_summary_in_the_BAND_folder(tmp_path, monkeypatch):
    """`write_reports` MERGES into the summary and creates one where it finds none, so a reconciler left
    on the judged folder would write a lone CPAP field into a morning folder that gets no summary."""
    band = tmp_path / "captures" / "2026-11-02"
    judged = tmp_path / "captures" / "2026-11-03"
    os.makedirs(str(band))
    os.makedirs(str(judged))
    (band / "QC-SUMMARY.json").write_text(json.dumps(_summ("2026-11-03", MORNING)))
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-11-03")
    monkeypatch.setitem(capture.STATUS, "qc", _summ("2026-11-03", MORNING))
    capture._cpap_inventory_report({"files": 1, "consulted": True}, {}, str(tmp_path), str(tmp_path / "dest"))
    assert "cpap_inventory" in json.loads((band / "QC-SUMMARY.json").read_text())
    assert os.path.exists(str(band / "CPAP-INVENTORY.jsonl"))
    assert not os.path.exists(str(judged / "QC-SUMMARY.json")), "no summary is manufactured for a morning"
