# tepna-capture — tests/test_writers_sidecars.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The four SIDECAR writers (O2Ring frame log, host-clock provenance, link/RSSI log, SpO2 CSV).
#
# They all share one invariant the source calls "the bug this suite keeps re-learning": an ABSENT value
# is written BLANK, never as 0/false. A fabricated 0 is indistinguishable downstream from a real reading
# of 0 — a missing SpO2 becomes a desaturation to zero, a missing `synchronized` becomes a positive claim
# that the clock was NOT synced. Every writer below is therefore tested for the None/0 distinction in
# both directions, which is the assertion a coverage-driven test would skip.

import datetime as dt

import pytest

from writers import (HostClockLogWriter, LinkLogWriter, OxyFrameLogWriter, RingClockLogWriter, Spo2CsvWriter,
                     OXYFRAME_COLUMNS, OXYFRAME_HEADER)

WHEN = dt.datetime(2026, 7, 19, 3, 4, 5, 678000)


def _lines(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read().splitlines()


def _rows(path):
    return _lines(path)[1:]


# ── OxyFrameLogWriter ───────────────────────────────────────────────────────────────────────────────
def test_oxyframe_header_and_row_layout(tmp_path):
    p = tmp_path / "o.txt"
    w = OxyFrameLogWriter(str(p), fsync=False)
    w.write(WHEN, {"duration": 900, "pi": 1.4, "motion": 0, "spo2": 96, "pr": 54,
                   "contact": 1, "batt": 73, "batt_state": 0, "flag": 0})
    w.close()
    head, row = _lines(str(p))[0], _rows(str(p))[0]
    assert head.split(";") == ["Phone timestamp", "duration_s", "pi_pct", "motion", "spo2", "pr",
                              "contact", "battery_pct", "batt_state", "flag",
                              "ppg_n", "ppg_dur_step", "ppg_offset", "flag_raw", "run_status"]
    cells = row.split(";")
    assert cells[0] == "2026-07-19T03:04:05.678"
    # The appended columns are blank: this caller passed no `ppg`, no `flag_raw` and no `run_status`, and
    # the ORIGINAL ten columns are unmoved — the append-never-insert rule, asserted rather than assumed
    # (O2RING-FRAME-SAMPLE-LOCK, extended by DEVICE-RATE-TRUTH §6.1 and OXYII-PRESENCE-MODEL §5).
    assert cells[1:] == ["900", "1.4", "0", "96", "54", "1", "73", "0", "0", "", "", "", "", ""]
    assert len(cells) == len(head.split(";")), "row must have exactly as many cells as the header"


def test_oxyframe_records_the_ring_stream_offset_and_the_whole_flag_byte(tmp_path):
    """`ppg_offset` is the ring's OWN sequence number and `flag_raw` the whole [10] byte. Both are
    recorded raw and never derived — the point is being able to re-audit a night from the file when the
    interpretation turns out to be wrong, which for this device it repeatedly has."""
    p = tmp_path / "o.txt"
    w = OxyFrameLogWriter(str(p), fsync=False)
    w.write(WHEN, {"duration": 900, "flag": 1, "flag_raw": 0xC7}, {"n": 126, "step": 1, "offset": 0})
    w.write(WHEN, {"duration": 901, "flag": 1, "flag_raw": 0xC7}, {"n": 126, "step": 1, "offset": 126})
    w.close()
    rows = [r.split(";") for r in _rows(str(p))]
    # offset 0 on the first frame is a READING, not an absence — it must not render blank
    assert rows[0][-3] == "0"
    assert rows[1][-3] == "126"
    assert [r[-2] for r in rows] == ["199", "199"]     # 0xC7, reported as the whole byte
    assert [r[-1] for r in rows] == ["", ""]           # run_status: absent from `live` ⇒ blank, never 0


def test_oxyframe_offset_is_blank_when_the_ppg_stream_is_off(tmp_path):
    """A night captured without the PPG stream must not claim `ppg_offset = 0` — that is a real first-
    frame value, and asserting it for a stream that never ran is the fabricated-zero bug this suite keeps
    re-learning."""
    p = tmp_path / "o.txt"
    w = OxyFrameLogWriter(str(p), fsync=False)
    w.write(WHEN, {"duration": 900, "flag": 1, "flag_raw": 0xC7})   # no `ppg` dict at all
    w.close()
    cells = _rows(str(p))[0].split(";")
    assert cells[-3] == "", "ppg_offset must be blank, never 0, when the stream is off"
    assert cells[-2] == "199", "flag_raw comes off `live`, so it survives a PPG-less frame"


def test_oxyframe_records_run_status_when_the_frame_carries_it(tmp_path):
    """`run_status` (payload[4]) was parsed since day one and never persisted — which is why no night
    could ever answer whether it discriminates device states (OXYII-PRESENCE-MODEL §5). Recorded raw,
    blank when absent — the same never-fabricate rule as ppg_offset."""
    p = tmp_path / "o.txt"
    w = OxyFrameLogWriter(str(p), fsync=False)
    w.write(WHEN, {"duration": 900, "flag": 1, "run_status": 2})
    w.write(WHEN, {"duration": 901, "flag": 1, "run_status": 0})
    w.close()
    rows = [r.split(";") for r in _rows(str(p))]
    assert [r[-1] for r in rows] == ["2", "0"], "run_status 0 is a READING, not an absence"


def test_oxyframe_carries_the_per_frame_ppg_arithmetic(tmp_path):
    """The three appended columns are the DEVICE's own numbers — the count it declared, the RAW step in
    its session-second counter, and what that step nominally owes. The step is recorded raw and not as a
    derived "frames missing": a step of 2 resembles a lost frame and measurably is not one, so the file
    keeps the primitive and lets the reader ask again (O2RING-FRAME-SAMPLE-LOCK)."""
    p = tmp_path / "o.txt"
    w = OxyFrameLogWriter(str(p), fsync=False)
    w.write(WHEN, {"spo2": 96}, {"n": 126, "step": 1})
    w.write(WHEN, {"spo2": 96}, {"n": 251, "step": 2})
    w.close()
    a, b = (r.split(";") for r in _rows(str(p)))
    # Sliced to the TWO columns under test, not open-ended: an open `[10:]` asserts "and nothing was
    # ever appended after these", which is the opposite of the append-never-insert rule this file exists
    # to protect, and it breaks every time the writer legitimately grows.
    assert a[10:12] == ["126", "1"]
    assert b[10:12] == ["251", "2"], "a +2 step is recorded as 2, not as '1 frame missing'"


def test_oxyframe_blanks_the_ppg_columns_rather_than_claiming_zero(tmp_path):
    """Same blank-vs-zero rule as the rest of this file, applied to the new columns.

    `step=None` is the first row of a session (and a session restart): no previous frame, so no step
    exists to measure. Writing 0 there would assert a step that was never observed — and 0 is a REAL
    value here (a flat step, 180 of them in one night), so the fabrication would be invisible."""
    p = tmp_path / "o.txt"
    w = OxyFrameLogWriter(str(p), fsync=False)
    w.write(WHEN, {"spo2": 96}, {"n": 250, "step": None})
    w.write(WHEN, {"spo2": 96}, {"n": 0, "step": 0})
    w.close()
    first, second = (r.split(";") for r in _rows(str(p)))
    assert first[10:12] == ["250", ""], "an unmeasurable step must be blank, never 0"
    assert second[10:12] == ["0", "0"], "a real declared count of 0, and a real flat step, survive as 0"


def test_oxyframe_writes_blank_for_absent_but_zero_for_a_real_zero(tmp_path):
    """THE invariant. motion=0 and spo2=None must not look the same on disk."""
    p = tmp_path / "o.txt"
    w = OxyFrameLogWriter(str(p), fsync=False)
    w.write(WHEN, {"motion": 0, "spo2": None, "pr": 0, "pi": None})
    w.close()
    cells = _rows(str(p))[0].split(";")
    assert cells[3] == "0", "a real motion reading of 0 must be written as 0"
    assert cells[4] == "", "an absent SpO2 must be blank, never 0"
    assert cells[5] == "0", "a real pulse rate of 0 must survive as 0"
    assert cells[2] == "", "an absent perfusion index must be blank"


def test_oxyframe_counts_rows(tmp_path):
    p = tmp_path / "o.txt"
    w = OxyFrameLogWriter(str(p), fsync=False)
    for _ in range(5):
        w.write(WHEN, {"spo2": 95})
    assert w.rows == 5
    w.close()
    assert len(_rows(str(p))) == 5


# ── HostClockLogWriter ──────────────────────────────────────────────────────────────────────────────
def test_host_clock_header_and_bool_rendering(tmp_path):
    p = tmp_path / "c.csv"
    w = HostClockLogWriter(str(p), fsync=False)
    w.write(WHEN, {"trust": "ntp", "absolute_ok": True, "synchronized": False, "server": "1.2.3.4",
                   "stratum": 2, "reference": "GPS", "root_dispersion_ms": 3.5, "jitter_us": 120,
                   "packet_count": 9, "reason": "ok", "chrony_skew_ppm": 0.123,
                   "timebase": "device-crystal"})
    w.close()
    assert _lines(str(p))[0].startswith("Phone timestamp;trust;absolute_ok;synchronized;server;")
    assert _lines(str(p))[0].rstrip().endswith(";chrony_skew_ppm;timebase"), "the timebase decision is the last column"
    cells = _rows(str(p))[0].split(";")
    assert cells[1] == "ntp"
    assert cells[2] == "1", "True must render as 1"
    assert cells[3] == "0", "False must render as 0 — it is a real negative claim, not an absence"
    assert cells[-2] == "0.123", "chrony_skew_ppm rides the second-to-last column"
    assert cells[-1] == "device-crystal", "the timebase decision rides the last column"


def test_host_clock_absent_fields_are_blank_not_false(tmp_path):
    """`synchronized` absent means we do not know; writing 0 would assert the clock was NOT synced, which
    is a stronger claim than the data supports and would mis-tier the night's provenance."""
    p = tmp_path / "c.csv"
    w = HostClockLogWriter(str(p), fsync=False)
    w.write(WHEN, {})
    w.close()
    cells = _rows(str(p))[0].split(";")
    assert cells[0] == "2026-07-19T03:04:05.678"
    assert all(c == "" for c in cells[1:]), f"absent provenance must be blank throughout, got {cells}"


def test_host_clock_reason_cannot_break_the_delimiter(tmp_path):
    """`reason` is free text from the system clock daemon. An unescaped ';' would shift every later
    column by one and silently corrupt the sidecar."""
    p = tmp_path / "c.csv"
    w = HostClockLogWriter(str(p), fsync=False)
    w.write(WHEN, {"reason": "step; then slew; done"})
    w.close()
    row = _rows(str(p))[0]
    assert row.count(";") == 12, "one row must keep exactly the header's delimiter count"
    assert "step, then slew, done" in row and "step; then slew" not in row, "the ';' must be escaped"


def test_host_clock_none_reason_is_blank_not_the_string_none(tmp_path):
    p = tmp_path / "c.csv"
    w = HostClockLogWriter(str(p), fsync=False)
    w.write(WHEN, {"reason": None})
    w.close()
    cells = _rows(str(p))[0].split(";")
    assert cells[-3] == "", "a None reason renders blank, never the string 'None'"
    assert cells[-2] == "", "an absent chrony_skew_ppm renders blank, never a fabricated 0"
    assert cells[-1] == "", "an absent timebase renders blank, never a fabricated value"


# ── LinkLogWriter ───────────────────────────────────────────────────────────────────────────────────
def test_link_log_layout_and_connected_flag(tmp_path):
    p = tmp_path / "l.csv"
    w = LinkLogWriter(str(p), fsync=False)
    w.write(WHEN, "Polar H10", True, -56, 80, link_epoch=1)
    w.write(WHEN, "Polar H10", False, None, None)
    w.close()
    # link_epoch (E5) and `address` are APPENDED last so a positional reader of the earlier columns is
    # unaffected. `address` was added 2026-07-26 because `device` is a NAME and a name is not an
    # identity — a mid-night rename split one sensor's history in two.
    assert _lines(str(p))[0].split(";") == ["Phone timestamp", "device", "connected", "rssi_dbm",
                                            "battery_pct", "frames_dropped", "frames_duplicated",
                                            "link_epoch", "address"]
    up, down = (r.split(";") for r in _rows(str(p)))
    assert up[1:5] == ["Polar H10", "1", "-56", "80"]
    assert up[7] == "1", "the reconnect count is recorded"
    assert down[2] == "0" and down[3] == "" and down[4] == "", "absent RSSI/battery must be blank"
    assert down[7] == "", "absent link_epoch must be blank, never a fabricated 0"


def test_link_log_zero_rssi_is_not_confused_with_absent(tmp_path):
    """An RSSI of 0 dBm is implausible but it IS a reading; blanking it would hide a bad sample, and
    writing 0 for an absent one would invent a perfect link."""
    p = tmp_path / "l.csv"
    w = LinkLogWriter(str(p), fsync=False)
    w.write(WHEN, "D", True, 0, 0)
    w.write(WHEN, "D", True, None, None)
    w.close()
    real, absent = (r.split(";") for r in _rows(str(p)))
    assert real[3] == "0" and real[4] == "0"
    assert absent[3] == "" and absent[4] == ""


def test_link_log_optional_frame_counters(tmp_path):
    p = tmp_path / "l.csv"
    w = LinkLogWriter(str(p), fsync=False)
    w.write(WHEN, "D", True, -50, 90, dropped=3, duplicated=0)
    w.close()
    cells = _rows(str(p))[0].split(";")
    assert cells[5] == "3" and cells[6] == "0"


# ── Spo2CsvWriter ───────────────────────────────────────────────────────────────────────────────────
def test_spo2_csv_is_the_vendor_layout(tmp_path):
    """OxyDex's adapter parses this positionally, so the column ORDER is a contract, not a preference."""
    p = tmp_path / "s.csv"
    w = Spo2CsvWriter(str(p), fsync=False)
    w.write(WHEN, 96, 54, 0)
    w.close()
    rows = _rows(str(p))
    assert len(rows) == 1
    cells = rows[0].split(",")
    assert cells[1:] == ["96", "54", "0"], "order must stay Oxygen Level, Pulse Rate, Motion"


def test_spo2_csv_counts_rows(tmp_path):
    p = tmp_path / "s.csv"
    w = Spo2CsvWriter(str(p), fsync=False)
    for _ in range(3):
        w.write(WHEN, 95, 50, 0)
    assert w.rows == 3
    w.close()


# ── flush / close behaviour, shared ─────────────────────────────────────────────────────────────────
ALL_WRITERS = [
    (OxyFrameLogWriter, lambda w: w.write(WHEN, {"spo2": 95})),
    (HostClockLogWriter, lambda w: w.write(WHEN, {"trust": "ntp"})),
    (LinkLogWriter, lambda w: w.write(WHEN, "D", True, -50, 90)),
    (Spo2CsvWriter, lambda w: w.write(WHEN, 96, 54, 0)),
]


@pytest.mark.parametrize("make,write", ALL_WRITERS, ids=lambda v: getattr(v, "__name__", ""))
def test_close_is_idempotent_across_every_writer(tmp_path, make, write):
    """close() runs from `finally` blocks that can execute twice on a teardown race. A raise there
    propagates out of the daemon's shutdown and MASKS whatever actually went wrong.

    LinkLogWriter was the one writer of five that raised here — the other four already swallowed it.
    Parametrised deliberately so the next writer added inherits the contract instead of rediscovering it."""
    w = make(str(tmp_path / "x.csv"), fsync=False)
    write(w)
    w.close()
    w.close()


@pytest.mark.parametrize("make,write", ALL_WRITERS, ids=lambda v: getattr(v, "__name__", ""))
def test_flush_after_close_does_not_raise(tmp_path, make, write):
    """The periodic flush cadence can fire against an already-closed handle during shutdown."""
    w = make(str(tmp_path / "x.csv"), fsync=False)
    write(w)
    w.close()
    w.flush()


def test_a_zero_flush_interval_forces_data_to_disk_immediately(tmp_path):
    """With flush_interval=0 every write flushes, so a hard kill loses nothing. This is what the overnight
    durability argument in the module header depends on."""
    p = tmp_path / "l.csv"
    w = LinkLogWriter(str(p), flush_interval=0, fsync=False)
    w.write(WHEN, "D", True, -50, 90)
    assert len(_rows(str(p))) == 1, "row should be on disk before close()"
    w.close()


# ── ABSENT PULSE RATE IS BLANK, NEVER 0 (VIGIL-PPG-GRID-AUDIT-2026-07-25-BRIEF §5.2) ───────────
# capture.py passed `live["pr"] or 0`, so a pulse rate the ring could not read (parse_live returns
# None outside 20-250) was written as a real-looking 0 into the vendor CSV OxyDex parses positionally.
# Same rule OxyFrameLogWriter's docstring already states: a fabricated 0 is indistinguishable from a
# real reading of 0. Measured against the shipped OxyDex reader, 0 and blank are rejected identically
# (parseInt('') -> NaN and 0 < 20 both `continue`), so this changes no downstream number — it stops the
# FILE asserting a pulse of zero the ring never measured.

def test_absent_pulse_rate_is_written_blank_not_zero(tmp_path):
    p = tmp_path / "spo2.csv"
    w = Spo2CsvWriter(str(p), fsync=False)
    w.write(WHEN, 96, None, 0)
    w.close()
    row = p.read_text().strip().split("\n")[1]
    assert row.split(",")[2] == "", f"absent pulse rate must be blank, got {row.split(',')[2]!r}"
    assert ",0," not in row.split(",", 1)[1] or row.split(",")[3] == "0"


def test_a_real_pulse_rate_still_writes_the_number(tmp_path):
    p = tmp_path / "spo2.csv"
    w = Spo2CsvWriter(str(p), fsync=False)
    w.write(WHEN, 96, 54, 0)
    w.close()
    assert p.read_text().strip().split("\n")[1].split(",")[2] == "54"


def test_a_real_pulse_rate_of_zero_is_impossible_but_would_be_distinguishable(tmp_path):
    """The point of blank-vs-0: the two states must not collide in the file."""
    p = tmp_path / "spo2.csv"
    w = Spo2CsvWriter(str(p), fsync=False)
    w.write(WHEN, 96, None, 0)
    w.write(WHEN, 96, 0, 0)
    w.close()
    rows = p.read_text().strip().split("\n")[1:]
    assert rows[0].split(",")[2] != rows[1].split(",")[2], "absent and zero must be distinguishable"


# ── THE LINK SIDECAR RECORDS AN IDENTITY, NOT JUST A NAME (issue #410 sibling) ─────────────────
# `device` is the human NAME, and a name is not an identity — it is editable from the monitor. On
# 2026-07-25 one re-pair rewrote the Verity's from "Polar Verity Sense" to "Polar Sense 0C301E3F"
# mid-night, so ONE physical sensor was recorded under TWO keys (3 samples vs 1123) and any per-device
# aggregate over that night silently split in half. A MAC cannot be edited and cannot collide.

def test_link_row_carries_the_address(tmp_path):
    p = tmp_path / "link.csv"
    w = LinkLogWriter(str(p), fsync=False)
    w.write(WHEN, "Polar Verity Sense", True, -61, 94, None, None, 3, "24:AC:AC:0C:30:1E")
    w.close()
    head, row = p.read_text().strip().split("\n")
    assert head.endswith(";address"), "address must be the LAST column (never shift an existing one)"
    assert row.split(";")[-1] == "24:AC:AC:0C:30:1E"


def test_a_rename_leaves_the_address_stable(tmp_path):
    """THE regression: the same sensor under two names must still group as one device."""
    p = tmp_path / "link.csv"
    w = LinkLogWriter(str(p), fsync=False)
    w.write(WHEN, "Polar Verity Sense", True, -61, 94, None, None, 3, "24:AC:AC:0C:30:1E")
    w.write(WHEN, "Polar Sense 0C301E3F", True, -63, 94, None, None, 3, "24:AC:AC:0C:30:1E")
    w.close()
    rows = [r.split(";") for r in p.read_text().strip().split("\n")[1:]]
    assert len({r[1] for r in rows}) == 2, "precondition: the NAME did change"
    assert len({r[-1] for r in rows}) == 1, "the address must group them as one device"


def test_the_first_seven_columns_are_unshifted(tmp_path):
    """Positional readers of the original columns must be unaffected by the append."""
    p = tmp_path / "link.csv"
    w = LinkLogWriter(str(p), fsync=False)
    w.write(WHEN, "H10", True, -55, 30, 1, 2, 7, "AA:BB:CC:DD:EE:FF")
    w.close()
    c = p.read_text().strip().split("\n")[1].split(";")
    assert c[1] == "H10" and c[2] == "1" and c[3] == "-55" and c[4] == "30"
    assert c[5] == "1" and c[6] == "2" and c[7] == "7"


def test_a_missing_address_is_blank_not_fabricated(tmp_path):
    p = tmp_path / "link.csv"
    w = LinkLogWriter(str(p), fsync=False)
    w.write(WHEN, "H10", False, None, None)
    w.close()
    assert p.read_text().strip().split("\n")[1].split(";")[-1] == ""


# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# MUTATION PASS 2026-08-02 — the durability default, and the columns nobody read past the third
#
# Measured: 568 mutants, 137 surviving (76 % killed). Two shapes account for most of it.
#
# 1. `fsync: bool = True` is a FAIL-SAFE DEFAULT and every test in this file passes `fsync=False`
#    explicitly — so nothing pinned it, in any of the five writers. Flipped, the box writes a whole
#    night into page cache and calls it recorded. This is the same finding the audit already made once
#    on `alerts.Notifier(enabled=False)`; it is worth stating that it recurs.
# 2. A row is a delimited record and the assertions read the first three cells. Twenty-four mutants of
#    `HostClockLogWriter.write` rename or null a column key — `st.get("stratum")` → `st.get(None)` —
#    and every one survived, because no test ever looked past `cells[3]`.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════

import os as _os

import writers as _w


ALL_WRITERS = [
    (_w.StreamWriter, {"stream": "ecg"}),
    (OxyFrameLogWriter, {}),
    (HostClockLogWriter, {}),
    (LinkLogWriter, {}),
    (Spo2CsvWriter, {}),
]


@pytest.mark.parametrize("cls,kw", ALL_WRITERS, ids=lambda v: getattr(v, "__name__", ""))
def test_every_writer_fsyncs_by_default(tmp_path, monkeypatch, cls, kw):
    """The `fsync=True` default in all five writers, plus `self._fsync` being stored at all.

    This is the difference between "the night is on the disk" and "the night is in page cache", and it
    is the whole reason these writers exist rather than a bare `open()`. The box loses power; the
    capture is the only copy. Every test in this file constructs with `fsync=False` — correctly, to
    stay fast — which is exactly how the default came to be unpinned in five places at once."""
    # patch the real os module: LinkLogWriter.flush does its own `import os` inside the function, so
    # patching writers.os alone would miss it
    synced = []
    monkeypatch.setattr(_os, "fsync", lambda fd: synced.append(fd))
    w = cls(str(tmp_path / "x.dat"), **kw)          # no fsync= — the default is the subject
    try:
        assert w._fsync is True, "durability is opt-OUT, never opt-in"
        w.flush()
        assert synced, "flush() must actually reach the platform, not just the buffer"
        assert all(isinstance(fd, int) for fd in synced), \
            "os.fsync is handed a real descriptor — `os.fsync(None)` raises TypeError past the " \
            "OSError/ValueError the flush catches"
    finally:
        w._fsync = False
        w.close()


def test_the_host_clock_row_carries_every_column_it_promises(tmp_path):
    """Twenty-four survivors lived in this one `";".join(...)`: `st.get("stratum")` → `st.get(None)`,
    `"reference"` → `"REFERENCE"`, a whole field replaced by None. The existing assertions read
    `cells[1]`, `[2]`, `[3]` and the last one — so the six columns in between were free to be anything.

    This sidecar is the evidence that lets a future reader tell "stratum-1 PPS all night" from "the box
    free-ran on its RTC". Every column silently blank is that question becoming unanswerable again."""
    p = tmp_path / "c.csv"
    w = HostClockLogWriter(str(p), fsync=False)
    w.write(WHEN, {"trust": "ntp", "absolute_ok": True, "synchronized": False,
                   "server": "192.168.0.61", "stratum": 2, "reference": "PPS",
                   "root_dispersion_ms": 3.5, "jitter_us": 120, "packet_count": 9,
                   "reason": "normal", "chrony_skew_ppm": 0.123, "timebase": "host-disciplined"})
    w.close()
    header, row = _lines(str(p))[0], _rows(str(p))[0]
    assert header.split(";") == ["Phone timestamp", "trust", "absolute_ok", "synchronized", "server",
                                "stratum", "reference", "root_dispersion_ms", "jitter_us",
                                "packet_count", "reason", "chrony_skew_ppm", "timebase"]
    assert row.split(";") == ["2026-07-19T03:04:05.678", "ntp", "1", "0", "192.168.0.61", "2", "PPS",
                             "3.5", "120", "9", "normal", "0.123", "host-disciplined"], \
        "every column, in the header's order — a reader keys on position"


def test_the_link_row_carries_every_column_it_promises(tmp_path):
    """The sibling assertion, for the sidecar that answers 'were the RADIO conditions degrading' when
    there is a gap at 03:00."""
    p = tmp_path / "l.csv"
    w = LinkLogWriter(str(p), fsync=False)
    w.write(WHEN, "Polar H10", True, -56, 80, link_epoch=3)
    w.close()
    header, row = _lines(str(p))[0], _rows(str(p))[-1]
    assert row.split(";")[:len(header.split(";"))] == row.split(";"), \
        "the row may not carry more fields than the header names"
    assert len(row.split(";")) == len(header.split(";")), \
        "nor fewer — a positional reader cannot tell a short row from a blank field"


def test_the_link_header_records_which_radio_captured_the_night(tmp_path):
    """Mutants 24/25: `hci or 'unknown'` → `'UNKNOWN'` / a mangled literal. The provenance comment is
    the only record of WHICH of the box's three BLE adapters a night came off — and 'unknown' is a
    deliberate honest value, not a placeholder to be restyled."""
    p = tmp_path / "l.csv"
    LinkLogWriter(str(p), fsync=False, adapter="hci1", hci="00:1A:7D:DA:71:13").close()
    assert _lines(str(p))[0] == "# adapter=hci1 hci=00:1A:7D:DA:71:13"
    # the honest half-known case: an adapter was pinned but never resolved to an address
    q = tmp_path / "m.csv"
    LinkLogWriter(str(q), fsync=False, adapter="hci1", hci=None).close()
    assert _lines(str(q))[0] == "# adapter=hci1 hci=unknown", \
        "'unknown' is a deliberate honest value, not a placeholder to restyle"
    # and no pin at all writes no comment, rather than a comment full of defaults
    r = tmp_path / "n.csv"
    LinkLogWriter(str(r), fsync=False).close()
    assert _lines(str(r))[0].startswith("Phone timestamp;")


@pytest.mark.parametrize("cls,kw", ALL_WRITERS, ids=lambda v: getattr(v, "__name__", ""))
def test_a_writer_remembers_the_path_it_opened(tmp_path, cls, kw):
    """`self.path = None` survived in every writer. `nightqc`, the archiver and the monitor all ask a
    live writer where it is writing; None there is a night that cannot be found while it is being
    recorded."""
    p = str(tmp_path / "x.dat")
    w = cls(p, **kw, fsync=False)
    try:
        assert w.path == p
    finally:
        w.close()


@pytest.mark.parametrize("cls,writer", [
    (HostClockLogWriter, lambda w: w.write(WHEN, {"trust": "ntp"})),
    (LinkLogWriter, lambda w: w.write(WHEN, "d", True, -50, 90, link_epoch=1)),
    (Spo2CsvWriter, lambda w: w.write(WHEN, 97, 60, 0)),
], ids=lambda v: getattr(v, "__name__", ""))
def test_the_row_counter_starts_at_zero_and_counts_one_per_row(tmp_path, cls, writer):
    """`self.rows = 0` → `1`, `rows += 1` → `+= 2` / `-= 1`. Nothing asserted the counter's ORIGIN, so
    an off-by-one that persists for the whole night was invisible. `nightqc` reads it to decide whether
    a sidecar has content."""
    w = cls(str(tmp_path / "x.csv"), fsync=False)
    try:
        assert w.rows == 0, "an open, unwritten sidecar has written nothing"
        for _ in range(3):
            writer(w)
        assert w.rows == 3
    finally:
        w.close()


@pytest.mark.parametrize("cls,writer", [
    (HostClockLogWriter, lambda w: w.write(WHEN, {"trust": "ntp"})),
    (LinkLogWriter, lambda w: w.write(WHEN, "d", True, -50, 90, link_epoch=1)),
    (OxyFrameLogWriter, lambda w: w.write(WHEN, {"spo2": 97})),
    (Spo2CsvWriter, lambda w: w.write(WHEN, 97, 60, 0)),
], ids=lambda v: getattr(v, "__name__", ""))
def test_the_flush_clock_survives_more_than_one_flush(tmp_path, cls, writer):
    """`self._last_flush = now` → `None`, in four writers. The FIRST flush still works, which is all any
    test exercised; the SECOND write then evaluates `now - None` and raises out of the write path,
    taking the capture with it. A cadence variable has to survive being used."""
    w = cls(str(tmp_path / "x.csv"), flush_interval=0, fsync=False)
    try:
        writer(w)
        writer(w)                    # the write after the first flush is where None detonates
        writer(w)
    finally:
        w.close()
    assert len(_rows(str(tmp_path / "x.csv"))) == 3, "all three rows survived the flush cadence"


@pytest.mark.parametrize("cls,writer", [
    (HostClockLogWriter, lambda w: w.write(WHEN, {"trust": "ntp"})),
    (LinkLogWriter, lambda w: w.write(WHEN, "d", True, -50, 90, link_epoch=1)),
    (OxyFrameLogWriter, lambda w: w.write(WHEN, {"spo2": 97})),
    (Spo2CsvWriter, lambda w: w.write(WHEN, 97, 60, 0)),
], ids=lambda v: getattr(v, "__name__", ""))
def test_a_long_flush_interval_really_does_defer_the_flush(tmp_path, monkeypatch, cls, writer):
    """`now - self._last_flush` → `now + self._last_flush`, in five places. Monotonic time is a large
    positive number, so the sum always clears any interval and every single row is flushed and fsynced
    — the pathological case these writers are buffered to avoid. Nothing noticed, because a flush that
    happens too OFTEN produces byte-identical output."""
    flushes = []
    w = cls(str(tmp_path / "x.csv"), flush_interval=3600.0, fsync=False)
    monkeypatch.setattr(w, "flush", lambda: flushes.append(1))
    try:
        writer(w)
        writer(w)
        assert flushes == [], "an hour-long interval must not flush on the first two rows"
    finally:
        monkeypatch.undo()
        w.close()


# ── The cross-lane gate: the JS fixture must track this header ───────────────────────────────────────


def test_oxyframe_header_is_the_single_source_the_js_fixture_tracks():
    """`tests/dex-tests.js` asserts `oxydex-dsp.parseCSV` ingests this sidecar byte-identically, using a
    HAND-WRITTEN header string. Two hand-written copies of one layout is how it goes stale: append a
    column here and that fixture passes forever against a layout no capture will ever produce again.
    Its own docstring warns about precisely that and could not prevent it, because nothing connected the
    two strings. This is the connection.

    Asserted from the Python side because this is where the layout is DEFINED — the JS lane is the
    consumer, and a consumer cannot be the authority on its input's shape."""
    import pathlib
    js = pathlib.Path(__file__).resolve().parents[2] / "tests" / "dex-tests.js"
    if not js.exists():                                    # pragma: no cover - capture-host shipped alone
        pytest.skip("JS lane not present in this checkout")
    text = js.read_text(encoding="utf-8")
    hdr = [ln for ln in text.splitlines() if "Phone timestamp;duration_s;pi_pct" in ln]
    assert hdr, "the OXYFRAME fixture vanished from dex-tests.js — it is the only cross-lane check"
    # AT LEAST ONE, not every one. The group deliberately keeps a NARROWER fixture too, proving a reader
    # written against the original 10 columns still parses a widened file — that one must STAY narrow,
    # and demanding the current header from it would force the append-only rule to be broken in order to
    # satisfy the test that protects it. What must track the writer is the WIDEST fixture: the one
    # standing in for what a capture actually produces today.
    assert any(OXYFRAME_HEADER in ln for ln in hdr), (
        "dex-tests.js's widest OXYFRAME fixture is stale against writers.OXYFRAME_COLUMNS.\n"
        f"  writers.py: {OXYFRAME_HEADER}\n"
        + "".join(f"  fixture   : {ln.strip()}\n" for ln in hdr)
        + "APPEND the new column(s) to that fixture's header AND to each of its rows.")


def test_oxyframe_columns_are_append_only_at_the_known_prefix():
    """The first ten names are the original layout and a positional reader still depends on them. This
    pins the PREFIX, not the length, so appending stays free and reordering does not."""
    assert OXYFRAME_COLUMNS[:10] == (
        "Phone timestamp", "duration_s", "pi_pct", "motion", "spo2", "pr", "contact", "battery_pct",
        "batt_state", "flag")
    assert len(set(OXYFRAME_COLUMNS)) == len(OXYFRAME_COLUMNS), "duplicate column name"


# ── RingClockLogWriter — the ring's RTC history on disk ─────────────────────────────────────────────
def test_ring_clock_log_header_and_blank_discipline(tmp_path):
    """Blanks, never fabricated zeros: a push row has no offset (the NEXT read verifies it), and a
    read row has no battery fields."""
    w = RingClockLogWriter(str(tmp_path / "x_RTCLOG.csv"))
    w.write(dt.datetime(2026, 8, 20, 5, 0, 0), "push")
    w.write(dt.datetime(2026, 8, 20, 5, 0, 2), "read", rtc_offset_s=0.3)
    w.write(dt.datetime(2026, 8, 20, 5, 0, 3), "battery", battery_state=0, battery_level=100,
            battery_raw2=242, battery_raw3=16)
    w.close()
    lines = (tmp_path / "x_RTCLOG.csv").read_text().splitlines()
    assert lines[0] == "Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3"
    assert lines[1].endswith(";push;;;;;"), lines[1]
    assert ";read;0.3;;;;" in lines[2]
    assert ";battery;;0;100;242;16" in lines[3]
    assert w.rows == 3


def test_ring_clock_log_close_is_guarded(tmp_path):
    """Same guarantee as every sibling: flush/close after close must swallow, not raise — including a
    handle whose close itself raises (a torn filesystem), which a double-close alone never exercises."""
    w = RingClockLogWriter(str(tmp_path / "y_RTCLOG.csv"))
    w.write(dt.datetime(2026, 8, 20, 5, 0, 0), "read", rtc_offset_s=-1.2)
    w.close()
    w.flush()
    w.close()

    class _Torn:
        def flush(self):
            raise OSError("gone")
        def close(self):
            raise OSError("gone")
        def fileno(self):
            raise OSError("gone")
    w2 = RingClockLogWriter(str(tmp_path / "y2_RTCLOG.csv"))
    w2._fh.close()
    w2._fh = _Torn()
    w2.flush()                                   # OSError swallowed
    w2.close()                                   # OSError swallowed


def test_ring_clock_log_flush_interval(tmp_path, monkeypatch):
    """Rows inside the interval buffer; a row past it flushes — the same cadence contract as LinkLog."""
    import writers as _writers_mod
    t = [1000.0]
    monkeypatch.setattr(_writers_mod._time, "monotonic", lambda: t[0])
    w = RingClockLogWriter(str(tmp_path / "z_RTCLOG.csv"), flush_interval=10, fsync=False)
    w.write(dt.datetime(2026, 8, 20, 5, 0, 0), "read", rtc_offset_s=0.1)
    t[0] = 1011.0
    w.write(dt.datetime(2026, 8, 20, 5, 0, 30), "read", rtc_offset_s=0.2)
    assert "0.2" in (tmp_path / "z_RTCLOG.csv").read_text()
    w.close()


# ── OxyLifeLogWriter (OxyII G4 lifecycle sidecar) ───────────────────────────────────────────────────

class _FakeTransition:
    def __init__(self, row): self._row = row
    def as_row(self): return self._row


def test_oxylife_writer_header_and_rows(tmp_path):
    import writers
    p = tmp_path / "OXYLIFE.csv"
    w = writers.OxyLifeLogWriter(str(p), device="O2R-01")
    w.write(_FakeTransition("W;1.0;not_seen;connecting;scan;O2R-01;s1;"))
    w.write(_FakeTransition("W;2.0;connecting;connected;up;O2R-01;s1;"))
    w.close()
    lines = p.read_text().splitlines()
    assert lines[0] == "# device=O2R-01"
    # `axis` appended 2026-08-24 (blank = link, "rec" = recording axis) — append-never-insert asserted:
    # the original eight names are unmoved and the new name is LAST.
    assert lines[1] == "host_wall;host_monotonic;prev;new;reason;device;session;failure;axis"
    assert lines[1].startswith("host_wall;host_monotonic;prev;new;reason;device;session;failure")
    assert lines[2].endswith("scan;O2R-01;s1;") and lines[3].startswith("W;2.0;connecting;connected")
    assert w.rows == 2


def test_oxylife_writer_omits_the_device_comment_when_absent(tmp_path):
    import writers
    p = tmp_path / "OXYLIFE.csv"
    w = writers.OxyLifeLogWriter(str(p))          # no device
    w.write(_FakeTransition("W;1.0;a;b;r;;;"))
    w.close()
    lines = p.read_text().splitlines()
    assert lines[0].startswith("host_wall;")      # header first, no device comment line
    assert not any(ln.startswith("# device=") for ln in lines)


def test_oxylife_writer_flushes_on_cadence(tmp_path):
    import writers
    p = tmp_path / "OXYLIFE.csv"
    w = writers.OxyLifeLogWriter(str(p), flush_interval=0.0)   # 0 → flush every write (cadence elapsed)
    w.write(_FakeTransition("W;1.0;a;b;r;;;"))
    assert p.read_text().count("\n") >= 2          # header + row already on disk (flushed)
    w.close()


def test_oxylife_writer_close_is_guarded_and_idempotent(tmp_path):
    import writers
    p = tmp_path / "OXYLIFE.csv"
    w = writers.OxyLifeLogWriter(str(p))
    w.close()
    w.close()                                       # double close → guarded, no raise
    w.flush()                                       # flush after close → guarded, no raise


def test_oxylife_writer_without_fsync_still_flushes(tmp_path):
    """fsync=False takes the branch that skips os.fsync — the row is still flushed to the OS buffer."""
    import writers
    p = tmp_path / "OXYLIFE.csv"
    w = writers.OxyLifeLogWriter(str(p), flush_interval=0.0, fsync=False)
    w.write(_FakeTransition("W;1.0;a;b;r;;;"))
    assert "a;b;r" in p.read_text()
    w.close()


def test_oxylife_writer_close_swallows_a_raising_handle(tmp_path):
    """close() is guarded: a handle that raises on close is swallowed, never propagated into a teardown."""
    import writers
    w = writers.OxyLifeLogWriter(str(tmp_path / "OXYLIFE.csv"), fsync=False)

    class _Boom:
        def flush(self): pass
        def close(self): raise ValueError("boom")

    w._fh = _Boom()
    w.close()          # the except swallows it — no raise
