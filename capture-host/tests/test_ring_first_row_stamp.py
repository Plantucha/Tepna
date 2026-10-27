# tepna-capture — tests/test_ring_first_row_stamp.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`Spo2CsvWriter.first_row_ms` and the ring envelope — the stamp that DATES an artifact.

Residue `2026-09-22-filename-stamp-still-wrong-for-other-consumers`, part (a): the capture host
derives every ring filename from `started = _now()`, taken before it connects, so a name claims a
session start the file holds no sample for. The bytes are immutable (§∅), and the name must exist
before any sample arrives because the file opens to receive it — CAPTURE-FILESET-RESUME then
re-derives that same name inside a 300 s window from a value a first sample would move. So the
remedy is the ENVELOPE beside the file, which is what a reader turns to when it distrusts the name.

The Polar rail already carries it (`test_artifact_first_row_stamp.py`, residue
`2026-10-26-the-acquisition-envelope-dates-an-artifact-by-the-session-start`). This is the ring half,
and the ring differs in one way that makes the defect worse: `end_time_ms` is DERIVED as
`start + rows * 1000`, so a late first row moved both ends of the reported span rather than one field.

The properties under test, each stated as a control rather than an incidental assertion:

  · a LANDED row sets the stamp, a lost one does not — a row the health object could not persist left
    no sample in the file, so it cannot date it.
  · the FIRST landed row sets it once, and no later row moves it.
  · a header-only file reports `None` (§∅), while the session start survives under its own name.
  · a RESUMED file reports neither a start nor a sample count, because this instance saw neither.
  · the derived end follows the corrected start, which is the amplification the ring adds.
"""

import calendar
import datetime as dt
import errno
import logging
import os

import acq_evidence as ae
import acq_evidence_o2ring as o2
import writers

_SESSION = dt.datetime(2026, 10, 21, 3, 15, 0)
_FIRST = dt.datetime(2026, 10, 21, 5, 42, 7, 456000)  # 2 h 27 m later, and NOT on a second boundary
_LATER = dt.datetime(2026, 10, 21, 5, 42, 8, 7000)


def _ms(when):
    """The floating wall-clock ms the Clock Contract §1 asks for, spelled out rather than imported:
    an expectation computed by the function under test cannot disagree with it."""
    return calendar.timegm(when.timetuple()) * 1000.0 + when.microsecond / 1000.0


def _writer(tmp_path, name="Viatom_O2Ring_O2-1_20261021031500_SPO2.csv"):
    return writers.Spo2CsvWriter(str(tmp_path / name), fsync=False)


class _WriteFailingFH:
    """A file handle that refuses every write, so a row is handed over and never lands.

    `fileno` and `close` exist because `Spo2CsvWriter.close` reads both over a spied writer.
    """

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
    """§∅: the file holds no reading, so no stamp describes it. `0`, the session start or the open
    time would each read as a measurement, and a consumer cannot tell a substituted start from a
    real one."""
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
        wr.write(_FIRST, 96, 58, 0)
        assert wr.first_row_ms == _ms(_FIRST)
        wr.write(_LATER, 95, 59, 1)
        assert wr.rows == 2
        assert wr.first_row_ms == _ms(_FIRST), "the FIRST row dates the file, not the most recent one"
    finally:
        wr.close()


def test_the_sub_second_part_of_the_arrival_SURVIVES(tmp_path):
    """`timetuple` drops the microseconds, so a stamp built from it alone is second-resolution. The
    CSV's own stamp column is `HH:MM:SS`, so this field is the only place the fraction can live."""
    wr = _writer(tmp_path)
    try:
        wr.write(_FIRST, 96, 58, 0)
        assert wr.first_row_ms % 1000.0 == 456.0
    finally:
        wr.close()


def test_A_LOST_ROW_IS_NOT_AN_ARRIVAL(tmp_path):
    """🔴 The row the writer could not persist leaves no reading in the file, so it cannot date it.
    The file is dated by the first row that actually reached the disk — here the one after recovery."""
    wr = _writer(tmp_path)
    fh = _WriteFailingFH()
    try:
        wr._fh = fh
        wr.write(_FIRST, 96, 58, 0)
        assert wr.rows == 0 and wr.rows_lost >= 1
        assert wr.first_row_ms is None, "a row that never landed must not date the artifact"
        fh.failing = False
        wr.write(_LATER, 95, 59, 1)
        assert wr.rows == 1
        assert wr.first_row_ms == _ms(_LATER)
    finally:
        fh.failing = False
        wr.close()


def test_an_ABSENT_reading_still_dates_the_file(tmp_path):
    """§∅ cuts the other way here, and the distinction is worth a leg. A row with no SpO2 and no
    pulse is written with BLANK columns, so a reading LANDED in the file and the stamp is real — the
    absence is in the value, not in the arrival. A stamp read off the first row carrying a NUMBER
    would date the file later than its first sample."""
    wr = _writer(tmp_path)
    try:
        wr.write(_FIRST, None, None, 0)
        assert wr.rows == 1
        assert wr.first_row_ms == _ms(_FIRST)
    finally:
        wr.close()


# ── the constructor both fields are set in ─────────────────────────────
#
# `first_row_ms` and `resumed` are both set in `__init__`, and the envelope reads BOTH, so the whole
# constructor is this unit's business rather than its neighbour. The mutation gate scopes to changed
# FUNCTIONS, which is how it named these properties: each one is a line a reader would call obvious
# and no leg observed.


def test_ANY_byte_already_in_the_file_is_a_RESUME(tmp_path):
    """A file that holds data is appended to, never truncated — #2166 cost one writer exactly that
    way, and the pruners read `resumed` before `os.remove`. The bound is ANY byte, because the
    question a resume answers is whether an earlier episode's rows are in there."""
    p = tmp_path / "Viatom_O2Ring_O2-1_20261021031500_SPO2.csv"
    p.write_text("x")
    wr = writers.Spo2CsvWriter(str(p), fsync=False)
    try:
        assert wr.resumed is True
        assert wr._fh.mode == "a", "a resumed file is appended to"
    finally:
        wr.close()
    assert p.read_text().startswith("x"), "the byte that made this a resume has to survive the open"


def test_an_EMPTY_file_is_NOT_a_resume_and_still_gets_its_header(tmp_path):
    """The control for the leg above, and the reason the bound is a byte count rather than existence:
    a zero-length file holds no earlier rows, so appending to it would leave a CSV with no header
    line and every consumer reading its first row as the column names."""
    p = tmp_path / "Viatom_O2Ring_O2-1_20261021031500_SPO2.csv"
    p.write_text("")
    wr = writers.Spo2CsvWriter(str(p), fsync=False)
    try:
        assert wr.resumed is False
        assert wr._fh.mode == "w", "a file with nothing in it is opened fresh"
    finally:
        wr.close()
    assert p.read_text().startswith("Time,Oxygen Level,Pulse Rate,Motion")


def test_a_FRESH_path_is_opened_for_writing_not_appending(tmp_path):
    """The mode is the only place the resume decision becomes visible before a row is written, and an
    unconditional append would leave the decision correct and the open wrong."""
    wr = _writer(tmp_path)
    try:
        assert wr.resumed is False
        assert wr._fh.mode == "w"
    finally:
        wr.close()


def test_the_writer_JOINS_the_open_set_under_its_own_path_and_LEAVES_it(tmp_path):
    """`live_loss_check` examines the paths the daemon believes it has open, so a writer missing from
    that set, or sitting in it under the wrong key, is a file the guard reports clean about without
    looking. The Polar twin states the same property in `test_live_loss_guard.py`.

    The close half is not decoration: a writer registered under a token its own close cannot match
    stays in the set for the life of the process, which turns every later guard pass into a finding
    about a file nobody is writing."""
    before = writers.open_writer_paths()
    wr = _writer(tmp_path)
    path = str(tmp_path / "Viatom_O2Ring_O2-1_20261021031500_SPO2.csv")
    try:
        assert path in writers.open_writer_paths()
        assert len(writers.open_writer_paths()) == len(before) + 1 == writers.open_sample_writers()
    finally:
        wr.close()
    assert writers.open_writer_paths() == before


def test_the_LOST_ROW_line_names_the_FILE_the_row_was_lost_from(tmp_path, caplog):
    """The transition line is the only place a 3am reader learns WHICH file stopped taking rows, and
    it reads its path from the health object this constructor builds."""
    wr = _writer(tmp_path)
    fh = _WriteFailingFH()
    path = str(tmp_path / "Viatom_O2Ring_O2-1_20261021031500_SPO2.csv")
    try:
        wr._fh = fh
        with caplog.at_level(logging.WARNING, logger="tepna-capture"):
            wr.write(_FIRST, 96, 58, 0)
        assert wr.rows_lost >= 1
        said = [r.getMessage() for r in caplog.records if "ROW LOST" in r.getMessage()]
        assert said, "a lost row says so once"
        assert path in said[0], "and it names the file it was lost from"
    finally:
        fh.failing = False
        wr.close()


def test_the_rows_WAIT_IN_A_BUFFER_rather_than_costing_a_write_each(tmp_path):
    """One row per second for a night is ~29k rows, and the flush policy — not the buffer size — is
    what bounds crash loss. So the buffer is explicit and larger than the interpreter's default.

    Stated as two checkpoints because one is satisfiable from either side. Measured 2026-10-27 with
    a 28-byte row and no flush: the shipped 64 KiB buffer holds 56,036 bytes (0 on disk) and has
    written 57,436 by 84,036; the interpreter default of 8,192 is already on disk at the first
    checkpoint; a 128 KiB buffer is still holding everything at the second."""
    wr = writers.Spo2CsvWriter(str(tmp_path / "buf_SPO2.csv"), flush_interval=1e9, fsync=False)
    try:
        for _ in range(2000):
            wr.write(_FIRST, 96, 58, 0)
        assert wr.rows == 2000
        held = os.path.getsize(wr.path)
        assert held == 0, f"56k of rows fit in the buffer; {held} bytes reached the disk"
        for _ in range(1000):
            wr.write(_FIRST, 96, 58, 0)
        assert os.path.getsize(wr.path) > 0, "84k of rows does not fit, so the buffer has turned over"
    finally:
        wr.close()
    assert os.path.getsize(wr.path) == 28 * 3000 + 36, "and close writes the tail out"


# ── what the envelope does with it ─────────────────────────────────────────────


def _env(**kw):
    base = dict(
        device_id="O2-1",
        session_id="20261021031500",
        artifact_path="/n/Viatom_O2Ring_O2-1_20261021031500_SPO2.csv",
        artifact_rows=3,
        start_time_ms=_ms(_FIRST),
        instance_start_time_ms=_ms(_SESSION),
    )
    base.update(kw)
    return o2.assemble_live(**base)


def test_the_two_starts_are_INDEPENDENT_fields():
    """The defect was one parameter serving both, so the control is two values that cannot be each
    other: the artifact start is the first row and the instance start is 2 h 27 m earlier."""
    ev = _env()
    assert ev.start_time_ms == _ms(_FIRST)
    assert ev.provenance["instance_start_time_ms"] == _ms(_SESSION)
    assert ev.start_time_ms - ev.provenance["instance_start_time_ms"] == 147 * 60 * 1000.0 + 7456.0


def test_THE_DERIVED_END_FOLLOWS_THE_CORRECTED_START():
    """🔴 The ring's amplification, which the Polar twin does not have: `end_time_ms` is
    `start + rows * 1000`, so the session start standing in for the artifact's moved the whole span.
    Stated as the arithmetic rather than as a snapshot — one row per second, three rows."""
    ev = _env()
    assert ev.end_time_ms == _ms(_FIRST) + 3000
    # and the control: against the session start, the same three rows would have reported a span
    # 2 h 27 m too early, which is a night in the wrong place rather than a field in the wrong place
    wrong = _env(start_time_ms=_ms(_SESSION))
    assert wrong.end_time_ms == _ms(_SESSION) + 3000
    assert ev.end_time_ms - wrong.end_time_ms == 147 * 60 * 1000.0 + 7456.0


def test_an_undated_artifact_reports_no_start_while_the_session_start_SURVIVES():
    """§∅ at the envelope layer: a header-only file gives `first_row_ms=None`, and the absence must
    reach the sidecar as `null`. The instance start is still known and still travels — nulling the
    artifact's start loses nothing a reader had. The derived end cannot survive the start."""
    ev = _env(start_time_ms=None, artifact_rows=0)
    assert ev.start_time_ms is None
    assert ev.end_time_ms is None
    assert ev.provenance["instance_start_time_ms"] == _ms(_SESSION)


def test_an_absent_session_start_does_not_borrow_the_artifact_start():
    """The mirror leg: neither field may stand in for the other, in either direction."""
    ev = _env(instance_start_time_ms=None)
    assert ev.provenance["instance_start_time_ms"] is None
    assert ev.start_time_ms == _ms(_FIRST)


def test_A_RESUMED_FILE_REPORTS_NEITHER_A_START_NOR_A_COUNT():
    """🔴 §∅ over a quantity this instance cannot see. The writer reopens the same path in append
    mode at `rows=0`, so both figures describe THIS instance while the file holds an earlier
    session's rows. A start after the file began and a count smaller than the artifact are each
    wrong in a way no consumer could detect, so both are absent and the instance's own figures
    travel under names that say what they measure."""
    ev = _env(resumed=True)
    assert ev.start_time_ms is None
    assert ev.sample_count is None
    assert ev.end_time_ms is None
    assert ev.provenance["resumed"] is True
    assert ev.provenance["rows_this_instance"] == 3
    assert ev.provenance["instance_start_time_ms"] == _ms(_SESSION)


def test_the_unresumed_case_keeps_BOTH_figures():
    """The control for the leg above: a blanket `None` would satisfy it and lose every ordinary
    night. The default is not resumed, and both figures are then the artifact's own."""
    ev = _env()
    assert ev.sample_count == 3
    assert ev.start_time_ms == _ms(_FIRST)
    assert ev.provenance["resumed"] is False
    assert ev.provenance["rows_this_instance"] == 3


def test_the_capture_seam_passes_the_WRITER_S_stamp():
    """A source scan over the production call, and weaker than the execution witness in
    `test_acq_evidence.py` — say so rather than let it read as one. What it pins is that the
    session-start expression cannot come back as the ARTIFACT's start: the two keywords are named."""
    import inspect

    import capture

    src = inspect.getsource(capture._emit_oxy_live_evidence)
    assert "start_time_ms=wr.first_row_ms," in src
    assert "instance_start_time_ms=calendar.timegm(started.timetuple()) * 1000.0," in src
    assert "resumed=wr.resumed," in src
    # ANCHORED ON THE LINE START: the session-start expression is still there under the instance
    # keyword, and an unanchored `in` reads `instance_start_time_ms=…` as the defect it looks for.
    assert "\n            start_time_ms=calendar.timegm(" not in src


# ── the fields the envelope carries past them ─────────────────────────────────
#
# Adding two parameters to `assemble_live` put every line of it in scope, and these are the ones no
# leg observed: a pass-through reads as obvious until it passes something else through.


def test_the_envelope_carries_the_IDENTITY_it_was_given():
    """A live envelope that named no device, or named the wrong signal, would still serialise and
    still validate — the fields are free strings. So the identity is asserted, not assumed."""
    ev = _env()
    assert ev.device_id == "O2-1"
    assert ev.session_id == "20261021031500"
    assert ev.signal == o2._SIGNAL
    assert ev.source == ae.SOURCE_LIVE
    assert ev.artifact_path == "/n/Viatom_O2Ring_O2-1_20261021031500_SPO2.csv"


def test_an_UNMEASURED_clock_offset_and_device_state_are_the_SENTINELS_not_None():
    """§∅ at the envelope's edge: the honest absence of a clock offset is `ClockOffset.unknown()`,
    whose every member says unknown, and not a `None` a consumer reads as a field that was never
    wired. `device_state` is the same shape in a plain string."""
    ev = _env()
    assert ev.clock_offset == ae.ClockOffset.unknown()
    assert ev.device_state == ae.UNKNOWN
    assert ev.duration_check == ae.DurationCheck.build(stored_s=None, observed_s=None)


def test_a_MEASURED_clock_offset_and_device_state_SURVIVE_the_envelope():
    """The control for the leg above, and it is the half that can break quietly: a substitution that
    always reports the sentinel satisfies the absence test and discards every real measurement.
    Declare-never-correct means this offset is the only record that a measurement happened."""
    offset = ae.ClockOffset(
        offset_sec=-1.25,
        measured_at_ms=_ms(_SESSION),
        reference="host-stratum1",
        method="GetDateTime",
    )
    ev = _env(clock_offset=offset, device_state="charging")
    assert ev.clock_offset == offset
    assert ev.clock_offset.offset_sec == -1.25
    assert ev.device_state == "charging"
