# tepna-capture — tests/test_artifact_first_row_stamp.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`StreamWriter.first_row_ms` — the stamp that DATES an artifact, and the start it is not.

Residue `2026-10-26-the-acquisition-envelope-dates-an-artifact-by-the-session-start`: the live Polar
acquisition envelope carried the SESSION start as the artifact's `start_time_ms`, so the sidecar a
reader turns to when it distrusts a filename stamp repeated the error it exists to correct. Measured
over the host-written corpus on 2026-10-25: of 478 names with a parseable first row, 4 disagreed with
their own first row by over 5 minutes and the worst by 18.71 h.

The three properties under test, each as a planted control rather than an incidental assertion:

  · a LANDED row sets the stamp, a lost one does not — a row that never reached the disk is not an
    arrival, and dating a file by it would name a time the file holds no sample for.
  · the FIRST landed row sets it once and no later row moves it.
  · an absent stamp stays `None` (§∅). A header-only file has no start, and the session start is a
    different quantity that travels under its own name.
"""

import calendar
import datetime as dt
import errno
import os

import acq_evidence_polar as polar
import writers

_SESSION = dt.datetime(2026, 10, 21, 3, 15, 0)
_FIRST = dt.datetime(2026, 10, 21, 3, 22, 0, 456000)  # 7 min later, and NOT on a second boundary
_LATER = dt.datetime(2026, 10, 21, 4, 1, 2, 7000)


def _ms(when):
    """The floating wall-clock ms the Clock Contract §1 asks for, spelled out rather than imported:
    an expectation computed by the function under test cannot disagree with it."""
    return calendar.timegm(when.timetuple()) * 1000.0 + when.microsecond / 1000.0


# One real row per stream key, with that key's own signature. `rr` is absent on purpose: no caller
# writes it directly — it is the sibling file the `hr` writer derives, and it owns no envelope.
_ROW_BY_STREAM = {
    "ecg": lambda w, t: w.write_ecg(t, 1_000_000_000, 0.0, 120),
    "acc": lambda w, t: w.write_acc(t, 1_000_000_000, 0.0, 1, 2, 3),
    "accraw": lambda w, t: w.write_acc(t, None, 0.0, 1, 2, 3),
    "pletha": lambda w, t: w.write_pletha(t, None, 4096, 0),
    "ppg2w": lambda w, t: w.write_ppg2w(t, None, 7, 8, 9),
    "ppg": lambda w, t: w.write_ppg(t, 1_000_000_000, 0.0, [11, 12, 13], 4),
    "ppg1": lambda w, t: w.write_ppg(t, 1_000_000_000, 0.0, [11], 0),
    "gyro": lambda w, t: w.write_gyro(t, 1_000_000_000, 0.0, 0.5, 0.25, 0.125),
    "mag": lambda w, t: w.write_mag(t, 1_000_000_000, 0.0, 0.5, 0.25, 0.125),
    "ppi": lambda w, t: w.write_ppi(t, 1_000_000_000, 61, 980, 3, 0),
    "hr": lambda w, t: w.write_hr(t, 1_000_000_000, 61, [980, 1002]),
}


def _writer(tmp_path, stream="ecg"):
    return writers.StreamWriter(str(tmp_path / f"X_{stream}.txt"), stream, fsync=False)


class _WriteFailingFH:
    """A handle whose `write` raises the way ENOSPC does — the buffered write, before any flush."""

    def __init__(self):
        self.failing, self.written = True, []

    def write(self, text):
        if self.failing:
            raise OSError(errno.ENOSPC, os.strerror(errno.ENOSPC))
        self.written.append(text)

    def flush(self):
        pass

    def fileno(self):
        return 0

    def close(self):
        pass


# ── the field itself ───────────────────────────────────────────────────────────


def test_a_header_only_file_has_NO_start(tmp_path):
    """§∅: the file holds no sample, so no stamp describes it. `0`, the session start or the open time
    would each read as a measurement, and a consumer cannot tell a substituted start from a real one."""
    wr = _writer(tmp_path)
    try:
        assert wr.first_row_ms is None
        assert wr.rows == 0
    finally:
        wr.close()


def test_the_first_landed_row_dates_the_file_and_no_later_row_moves_it(tmp_path):
    """Both halves in one test because the second is the control for the first: a stamp that tracked
    the LATEST row would satisfy the first assertion and still be the wrong quantity."""
    wr = _writer(tmp_path)
    try:
        _ROW_BY_STREAM["ecg"](wr, _FIRST)
        assert wr.first_row_ms == _ms(_FIRST)
        _ROW_BY_STREAM["ecg"](wr, _LATER)
        assert wr.rows == 2
        assert wr.first_row_ms == _ms(_FIRST), "the FIRST row dates the file, not the most recent one"
    finally:
        wr.close()


def test_the_sub_second_part_of_the_arrival_SURVIVES(tmp_path):
    """`timetuple` drops the microseconds, so a stamp built from it alone is second-resolution while
    the row beside it in the file carries milliseconds. The fractional part is the whole assertion."""
    wr = _writer(tmp_path)
    try:
        _ROW_BY_STREAM["ecg"](wr, _FIRST)
        assert wr.first_row_ms % 1000.0 == 456.0
    finally:
        wr.close()


def test_A_LOST_ROW_IS_NOT_AN_ARRIVAL(tmp_path):
    """🔴 The row the writer could not persist leaves no sample in the file, so it cannot date it. The
    file is dated by the first row that actually reached the disk — here the one after recovery."""
    wr = _writer(tmp_path)
    try:
        fh = _WriteFailingFH()
        wr._fh = fh
        _ROW_BY_STREAM["ecg"](wr, _FIRST)
        assert wr.rows == 0 and wr.rows_lost >= 1
        assert wr.first_row_ms is None, "a row that never landed must not date the artifact"
        fh.failing = False
        _ROW_BY_STREAM["ecg"](wr, _LATER)
        assert wr.rows == 1
        assert wr.first_row_ms == _ms(_LATER)
    finally:
        wr._fh = fh
        fh.failing = False
        wr.close()


def test_EVERY_stream_key_records_its_arrival(tmp_path):
    """A new stream must not be able to forget. The stamp rides the single row sink every write path
    goes through, and this walks the writer's own `HEADERS` table so a key added without a row call
    here fails rather than passing silently."""
    assert set(_ROW_BY_STREAM) | {"rr"} == set(writers.StreamWriter.HEADERS), (
        "a stream key gained or lost a writer — add it to _ROW_BY_STREAM, or say why it has no row call"
    )
    for stream, write in sorted(_ROW_BY_STREAM.items()):
        wr = _writer(tmp_path, stream)
        try:
            assert wr.first_row_ms is None, stream
            write(wr, _FIRST)
            assert wr.first_row_ms == _ms(_FIRST), stream
        finally:
            wr.close()


# ── the envelope that reads it ─────────────────────────────────────────────────


def _env(**kw):
    base = dict(
        device_id="H10-01",
        session_id="20261021031500",
        stream="ecg",
        artifact_path="/n/Polar_H10_H10-01_20261021031500_ECG.txt",
        artifact_rows=1,
        start_time_ms=_ms(_FIRST),
        instance_start_time_ms=_ms(_SESSION),
    )
    base.update(kw)
    return polar.assemble_live(**base)


def test_the_two_starts_are_INDEPENDENT_fields(tmp_path):
    """The defect was one parameter serving both, so the control is two values that cannot be each
    other: the artifact start is the first row and the instance start is 7 minutes earlier."""
    ev = _env()
    assert ev.start_time_ms == _ms(_FIRST)
    assert ev.provenance["instance_start_time_ms"] == _ms(_SESSION)
    assert ev.start_time_ms - ev.provenance["instance_start_time_ms"] == 7 * 60 * 1000.0 + 456.0


def test_an_undated_artifact_reports_no_start_while_the_session_start_SURVIVES(tmp_path):
    """§∅ at the envelope layer: a header-only file gives `first_row_ms=None`, and the absence must
    reach the sidecar as `null`. The instance start is still known and still travels — nulling the
    artifact's start loses nothing a reader had."""
    ev = _env(start_time_ms=None, artifact_rows=0)
    assert ev.start_time_ms is None
    assert ev.provenance["instance_start_time_ms"] == _ms(_SESSION)


def test_an_absent_session_start_does_not_borrow_the_artifact_start(tmp_path):
    """The mirror leg: neither field may stand in for the other, in either direction."""
    ev = _env(instance_start_time_ms=None)
    assert ev.provenance["instance_start_time_ms"] is None
    assert ev.start_time_ms == _ms(_FIRST)


def test_the_capture_seam_passes_the_WRITER_S_stamp(tmp_path):
    """A source scan over the production call, and weaker than the execution witness in
    `test_acq_evidence_polar.py` — say so rather than let it read as one. What it pins is that the
    session-start expression cannot come back as the ARTIFACT's start: the two keywords are named."""
    import inspect

    import capture

    src = inspect.getsource(capture._emit_polar_live_evidence)
    assert "start_time_ms=wr.first_row_ms," in src
    assert "instance_start_time_ms=calendar.timegm(started.timetuple()) * 1000.0," in src
    # ANCHORED ON THE LINE START: the session-start expression is still there under the instance
    # keyword, and an unanchored `in` reads `instance_start_time_ms=…` as the defect it is looking for.
    assert "\n            start_time_ms=calendar.timegm(" not in src
