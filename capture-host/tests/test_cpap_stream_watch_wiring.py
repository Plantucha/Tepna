"""`capture._cpap_stream_watch_row` — the I/O half of the stream-silence watchdog.

The decision lives in `cpap_stream_watch` (pure, tested next door). What is tested HERE is the part
that can only fail on this box: which files it reads, and what it does when it cannot read them.

🔴 THE CENTRAL PROPERTY: every unreadable input must produce UNKNOWN, never OK. A watchdog that
reports all-clear because its own input failed is the silence it exists to break, one level up —
the same shape as the archive-pull that never once succeeded and never once said so."""

import capture
import cpap_stream_watch as W

HDR = "host_ms;prior;state;transition;action;trigger;confidence;reachable;fg_state;x;y;z"


def _journal(root, rows):
    (root / "SESSIONDETECT.csv").write_text("\n".join([HDR] + [f"{ms};i;i;;;i;f;True;{st};0;0;" for ms, st in rows]))


def _edf(path, n_records, sec_per_record):
    """A 256-byte EDF header is all the watchdog reads — `n_records` at [236:244], seconds at [244:252]."""
    path.parent.mkdir(parents=True, exist_ok=True)
    h = bytearray(b" " * 256)
    h[236:244] = f"{n_records:<8d}".encode()
    h[244:252] = f"{sec_per_record:<8g}".encode()
    path.write_bytes(bytes(h) + b"\0" * 64)


def _cfg(edf_dir):
    return {"cpap": {"ble_stream": {"edf_dir": str(edf_dir)}}}


def test_the_2026_08_26_night_therapy_ran_and_NOTHING_recorded_it(tmp_path):
    """The case that motivated this: a full session, an empty `edf_dir`, and not one warning anywhere.
    The stream is operator-initiated and nobody clicked."""
    t0 = 1_787_000_000_000
    _journal(tmp_path, [(t0 + i * 30_000, "Therapy") for i in range(720)])  # 6 h
    got = capture._cpap_stream_watch_row(_cfg(tmp_path / "edf"), str(tmp_path), "2026-08-26")
    assert got["state"] == W.NEVER_STARTED
    assert got["therapy_min"] > 300


def test_the_2026_08_27_night_one_record_for_a_six_hour_session(tmp_path):
    """Started and stopped a second later: a 7 KB file for a six-hour night. A bytes>0 check passes it."""
    t0 = 1_787_000_000_000
    _journal(tmp_path, [(t0 + i * 30_000, "Therapy") for i in range(720)])
    _edf(tmp_path / "edf" / "DATALOG" / "20260827" / "20260827_2340_BRP.edf", 1, 60)
    got = capture._cpap_stream_watch_row(_cfg(tmp_path / "edf"), str(tmp_path), "2026-08-27")
    assert got["state"] == W.DIED_EARLY, got


def test_a_covered_night_is_quiet(tmp_path):
    t0 = 1_787_000_000_000
    _journal(tmp_path, [(t0 + i * 30_000, "Therapy") for i in range(720)])
    _edf(tmp_path / "edf" / "DATALOG" / "20260827" / "a_BRP.edf", 300, 60)
    _edf(tmp_path / "edf" / "DATALOG" / "20260827" / "b_BRP.edf.part", 50, 60)
    got = capture._cpap_stream_watch_row(_cfg(tmp_path / "edf"), str(tmp_path), "2026-08-27")
    assert got["state"] == W.OK and got["stream_min"] == 350.0


def test_a_session_in_the_NEIGHBOURING_folder_is_still_found(tmp_path):
    """⚠️ This box's AS11 clock runs ~21 min AHEAD of the host, so a session starting near midnight is
    filed under the next device date. Reading only the night's own folder would report a missed capture
    for a recording sitting one directory away — a false alarm caused by a known clock offset."""
    t0 = 1_787_000_000_000
    _journal(tmp_path, [(t0 + i * 30_000, "Therapy") for i in range(720)])
    _edf(tmp_path / "edf" / "DATALOG" / "20260828" / "a_BRP.edf", 350, 60)
    got = capture._cpap_stream_watch_row(_cfg(tmp_path / "edf"), str(tmp_path), "2026-08-27")
    assert got["state"] == W.OK, "a session filed under the device's date read as a missed capture"


def test_NO_JOURNAL_refuses_rather_than_reporting_ok(tmp_path):
    """The detector being off is not evidence that no therapy ran."""
    got = capture._cpap_stream_watch_row(_cfg(tmp_path / "edf"), str(tmp_path), "2026-08-27")
    assert got["state"] == W.UNKNOWN
    assert "not evidence" in got["detail"]


def test_no_edf_dir_configured_still_reads_the_journal(tmp_path):
    """A box with the live stream unconfigured: therapy is measurable, the stream genuinely is zero."""
    t0 = 1_787_000_000_000
    _journal(tmp_path, [(t0 + i * 30_000, "Therapy") for i in range(120)])
    got = capture._cpap_stream_watch_row({}, str(tmp_path), "2026-08-27")
    assert got["state"] == W.NEVER_STARTED and got["stream_min"] == 0.0


def test_an_UNREADABLE_edf_does_not_stop_the_readable_ones(tmp_path):
    """A file too short to hold a header raises from `cpap_edf.read_span`. It must not abort the walk —
    the verdict then rests on the files that WERE read.

    (An earlier version of this test asserted the skip was distinguishable from counting the file as
    zero records. It is not: both sum to the same minutes, so the test passed under either behaviour
    and proved nothing. The writer rewrites its `.part` atomically with a correct count on every flush,
    so a torn header is not a state this box produces at all.)"""
    t0 = 1_787_000_000_000
    _journal(tmp_path, [(t0 + i * 30_000, "Therapy") for i in range(720)])
    d = tmp_path / "edf" / "DATALOG" / "20260827"
    _edf(d / "good_BRP.edf", 350, 60)
    (d / "short_BRP.edf.part").write_bytes(b"\0" * 12)
    got = capture._cpap_stream_watch_row(_cfg(tmp_path / "edf"), str(tmp_path), "2026-08-27")
    assert got["state"] == W.OK and got["stream_min"] == 350.0


def test_an_UNPARSEABLE_night_name_does_not_crash_the_poller(tmp_path):
    """`_current_night` yields a directory name. If one is ever not a date, QC must keep running."""
    t0 = 1_787_000_000_000
    _journal(tmp_path, [(t0 + i * 30_000, "Therapy") for i in range(720)])
    _edf(tmp_path / "edf" / "DATALOG" / "20260827" / "a_BRP.edf", 350, 60)
    got = capture._cpap_stream_watch_row(_cfg(tmp_path / "edf"), str(tmp_path), "not-a-date")
    assert got["state"] == W.NEVER_STARTED, "no folder is searchable, so nothing was measured as stream"
