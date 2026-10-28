"""A bar starts where its stream's first row landed, not where the capture session began.

The filename stamp is the session's start, taken before the link is up, and a stream can open hours
later (residue `2026-09-22-filename-stamp-still-wrong-for-other-consumers`). The acquisition sidecar
states the first landed row; the timeline places a bar there when it can, and names the source of
every start so a reader can weigh a bar the stamp placed.
"""

import calendar
import datetime as dt
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nightqc  # noqa: E402
import timeline  # noqa: E402
from tests.test_timeline import _build, _capture_file, _dev, _f  # noqa: E402

SYN = "A1B2C3D4"  # a synthetic device id; tests never carry a real serial


def _floating_ms(stamp: str) -> int:
    """The floating wall-clock ms of a 14-digit stamp, the frame `writers._phone_ms` writes."""
    return calendar.timegm(dt.datetime.strptime(stamp, "%Y%m%d%H%M%S").timetuple()) * 1000


def _sidecar(path, evidence):
    """`capture.py` writes the sidecar when the file closes, so its mtime is the data file's, not now."""
    side = str(path) + ".meta.json"
    with open(side, "w") as fh:
        json.dump({"acquisition_evidence": evidence} if evidence is not ... else [], fh)
    if os.path.exists(str(path)):
        st = os.stat(str(path))
        os.utime(side, (st.st_mtime, st.st_mtime))


# ── nightqc.artifact_start_s — the sidecar reader ───────────────────────────────────────────────
def test_artifact_start_s_is_none_without_a_sidecar(tmp_path):
    assert nightqc.artifact_start_s(str(tmp_path / "a.txt")) is None


def test_artifact_start_s_is_none_for_an_unreadable_sidecar(tmp_path):
    (tmp_path / "a.txt.meta.json").write_text("{torn")
    assert nightqc.artifact_start_s(str(tmp_path / "a.txt")) is None


def test_artifact_start_s_is_none_when_the_sidecar_is_not_an_object(tmp_path):
    _sidecar(tmp_path / "a.txt", ...)
    assert nightqc.artifact_start_s(str(tmp_path / "a.txt")) is None


@pytest.mark.parametrize(
    "evidence", [None, {}, {"start_time_ms": None}, {"start_time_ms": True}, {"start_time_ms": "1"}]
)
def test_artifact_start_s_is_none_when_the_sidecar_states_no_start(tmp_path, evidence):
    """A resumed or header-only file writes no start (§∅). A bool is not a time, though Python counts it
    as an int."""
    _sidecar(tmp_path / "a.txt", evidence)
    assert nightqc.artifact_start_s(str(tmp_path / "a.txt")) is None


def test_artifact_start_s_reads_the_first_row_in_seconds(tmp_path):
    _sidecar(tmp_path / "a.txt", {"start_time_ms": 1_752_000_000_500})
    assert nightqc.artifact_start_s(str(tmp_path / "a.txt")) == 1_752_000_000.5


# ── timeline — which start places the bar ───────────────────────────────────────────────────────
def test_start_of_prefers_the_first_row_and_names_each_source():
    f = _f("Polar_H10_A1B2C3D4_20260725223000_ECG.txt", "ECG", 10)
    stamp, src = timeline._start_of(f)
    assert src == timeline.START_FILENAME_STAMP and stamp is not None
    f["first_row_s"] = stamp + 3600.0
    assert timeline._start_of(f) == (stamp + 3600.0, timeline.START_FIRST_ROW)


def _late_stream(tmp_path):
    """A session stamped 22:00 whose ECG stream landed its first row at 01:00 and ran one hour. The
    rows carry their own times, so the file is written from 01:00 and then named with the session stamp."""
    p = _capture_file(tmp_path, "20260711010000", "ecg", 130 * 3600, 130, did=SYN)
    late = p.with_name(p.name.replace("20260711010000", "20260710220000"))
    os.rename(p, late)
    return late


def test_a_late_stream_is_placed_at_its_first_row_and_says_so(tmp_path):
    """The session window stays 22:00 to 02:00: the session was open, and a reader must see the three
    hours with no ECG. The stamp painted the ECG hour at 22:00, the first three of four hours."""
    _sidecar(_late_stream(tmp_path), {"start_time_ms": _floating_ms("20260711010000")})
    out = _build(str(tmp_path), [_dev(["ecg"], did=SYN)], buckets=4)
    ecg = out["devices"][0]["streams"]["ecg"]
    assert ecg["start_source"] == {timeline.START_FIRST_ROW: 1, timeline.START_FILENAME_STAMP: 0}
    assert round(out["t1"] - out["t0"]) == 4 * 3600
    st = ecg["states"]
    assert len(set(st[:3])) == 1 and st[3] != st[0], f"the ECG hour is the LAST bucket, got {st}"


def test_without_the_sidecar_the_same_stream_is_painted_at_the_session_start(tmp_path):
    """The control for the test above: the same file with no sidecar is placed by the stamp, and the
    output says so. This is the defect the sidecar fixes, kept visible."""
    _late_stream(tmp_path)
    out = _build(str(tmp_path), [_dev(["ecg"], did=SYN)], buckets=4)
    ecg = out["devices"][0]["streams"]["ecg"]
    assert ecg["start_source"] == {timeline.START_FIRST_ROW: 0, timeline.START_FILENAME_STAMP: 1}
    assert ecg["states"][0] != ecg["states"][3], f"the stamp paints the FIRST bucket, got {ecg['states']}"


def test_a_file_with_no_sidecar_start_is_counted_as_stamp_placed(tmp_path):
    _capture_file(tmp_path, "20260710220000", "ecg", 130 * 60, 130, did=SYN)
    p = _capture_file(tmp_path, "20260710230000", "ecg", 130 * 60, 130, did=SYN)
    _sidecar(p, {"start_time_ms": None})
    out = _build(str(tmp_path), [_dev(["ecg"], did=SYN)], buckets=12)
    assert out["devices"][0]["streams"]["ecg"]["start_source"] == {
        timeline.START_FIRST_ROW: 0,
        timeline.START_FILENAME_STAMP: 2,
    }
