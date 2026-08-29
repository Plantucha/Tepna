"""The seam between the harvest and the inventory reconciler — `capture._cpap_inventory_report`, and
the QC-SUMMARY.json carry-forward that lets its field survive.

🔴 THE FILE HAS TWO WRITERS. `qc_poller` rewrites QC-SUMMARY.json wholesale every `poll_sec`; the
reconciler merges one field into it after the 13:00 harvest. Wired naively, that field lived at most
ten minutes and was always gone by the morning anyone would read it — a reconciliation that ran,
wrote, and was erased before it was seen. These tests pin the fix from both sides."""

import datetime as _dtm
import json

import pytest

import capture
from test_capture_runners import _run, _stop_after


@pytest.fixture(autouse=True)
def _reset_stop():
    """⚠️ `_stop_after` trips `capture._STOP`, a MODULE GLOBAL, and the fixture that clears it lives in
    `test_capture_runners` as a module-scoped autouse — importing the helper does not import the
    fixture that makes it safe. Without this, the first test here poisons every later one: the poller
    exits at the top of its loop, writes nothing, and the assertion fails on a file that was never
    touched. Passes alone, fails in file order — a shape worth recognising rather than re-debugging."""
    capture._STOP.clear()
    yield
    capture._STOP.clear()


def test_a_foreign_QC_field_SURVIVES_the_next_poller_cycle(tmp_path, monkeypatch):
    """The reconciler's field is written by another writer at a different cadence. Losing it would be
    invisible: the file still exists, still parses, and still looks complete."""
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 23, 0, 0))
    night = tmp_path / "captures" / "2026-07-19"
    night.mkdir(parents=True)
    (night / "Polar_H10_02849638_20260719_ECG.txt").write_text("h\n1\n2\n3\n")
    qc = night / "QC-SUMMARY.json"
    qc.write_text(json.dumps({"cpap_inventory": {"discrepancies": 2}, "night": "STALE"}))
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller({"qc": {"poll_sec": 600}, "devices": []}, str(tmp_path)))
    got = json.loads(qc.read_text())
    assert got["cpap_inventory"] == {"discrepancies": 2}, "another writer's field was clobbered"
    assert got["night"] == "2026-07-19", "a carried-forward key beat the key we actually produce"


def test_an_UNREADABLE_prior_summary_does_not_stop_the_poller(tmp_path, monkeypatch):
    """Carrying forward must never be able to break the write it precedes — a half-written or corrupt
    file is exactly the state a merge step is most likely to meet."""
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 23, 0, 0))
    night = tmp_path / "captures" / "2026-07-19"
    night.mkdir(parents=True)
    (night / "Polar_H10_02849638_20260719_ECG.txt").write_text("h\n1\n")
    (night / "QC-SUMMARY.json").write_text("{not json")
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller({"qc": {"poll_sec": 600}, "devices": []}, str(tmp_path)))
    assert json.loads((night / "QC-SUMMARY.json").read_text())["night"] == "2026-07-19"


def test_a_prior_summary_that_is_not_an_object_is_ignored(tmp_path, monkeypatch):
    """`json.load` succeeding says nothing about the shape. A list would make `.items()` raise."""
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 23, 0, 0))
    night = tmp_path / "captures" / "2026-07-19"
    night.mkdir(parents=True)
    (night / "Polar_H10_02849638_20260719_ECG.txt").write_text("h\n1\n")
    (night / "QC-SUMMARY.json").write_text("[1, 2, 3]")
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller({"qc": {"poll_sec": 600}, "devices": []}, str(tmp_path)))
    assert json.loads((night / "QC-SUMMARY.json").read_text())["night"] == "2026-07-19"


def test_the_report_writes_into_TONIGHTS_dir_beside_the_qc_summary(tmp_path, monkeypatch):
    """A night's evidence stays in one place: the QC field and the journal land in the night dir."""
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 23, 0, 0))
    night = tmp_path / "captures" / "2026-07-19"
    night.mkdir(parents=True)
    (night / "Polar_H10_02849638_20260719_ECG.txt").write_text("h\n1\n")
    seen = {}

    def fake(result, **kw):
        seen.update(kw)
        seen["result"] = result
        return {"discrepancies": 0}

    import cpap_inventory_adapter

    monkeypatch.setattr(cpap_inventory_adapter, "on_harvest_complete", fake)
    out = capture._cpap_inventory_report(
        {"files": 3}, {"cpap": {"ble_stream": {"edf_dir": "/e"}}}, str(tmp_path), str(tmp_path / "captures" / "cpap")
    )
    assert out == {"discrepancies": 0}
    assert seen["qc_path"] == str(night / "QC-SUMMARY.json")
    assert seen["journal_path"] == str(night / "CPAP-INVENTORY.jsonl")
    assert seen["envelope_root"] == "/e" and seen["spool_root"] == str(tmp_path)
    assert seen["dest_root"].endswith("captures/cpap") and seen["result"] == {"files": 3}


def test_a_box_with_NO_live_stream_passes_envelope_root_None_not_a_guess(tmp_path, monkeypatch):
    """None is read by the adapter as UNCONSULTED. Substituting a plausible path would turn "we did not
    look" into "we looked and found nothing" — the distinction the whole reconciliation rests on."""
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 23, 0, 0))
    (tmp_path / "captures" / "2026-07-19").mkdir(parents=True)
    seen = {}
    import cpap_inventory_adapter

    monkeypatch.setattr(cpap_inventory_adapter, "on_harvest_complete", lambda result, **kw: seen.update(kw) or None)
    assert capture._cpap_inventory_report({}, {}, str(tmp_path), "/d") is None
    assert seen["envelope_root"] is None


def test_NO_NIGHT_DIR_means_nowhere_to_file_a_report(tmp_path, monkeypatch):
    """A harvest can complete on a box that captured nothing tonight. The reporter must not invent a
    night directory to write into — `qc_poller` deliberately never creates one either."""
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 23, 0, 0))
    import cpap_inventory_adapter

    monkeypatch.setattr(cpap_inventory_adapter, "on_harvest_complete", lambda *a, **k: pytest_fail())

    def pytest_fail():
        raise AssertionError("the reporter ran with no night dir to write into")

    assert capture._cpap_inventory_report({}, {}, str(tmp_path), "/d") is None
    assert not (tmp_path / "captures").exists()
