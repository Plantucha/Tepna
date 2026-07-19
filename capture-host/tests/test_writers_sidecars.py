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

from writers import HostClockLogWriter, LinkLogWriter, OxyFrameLogWriter, Spo2CsvWriter

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
                              "contact", "battery_pct", "batt_state", "flag"]
    cells = row.split(";")
    assert cells[0] == "2026-07-19T03:04:05.678"
    assert cells[1:] == ["900", "1.4", "0", "96", "54", "1", "73", "0", "0"]
    assert len(cells) == len(head.split(";")), "row must have exactly as many cells as the header"


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
                   "packet_count": 9, "reason": "ok"})
    w.close()
    assert _lines(str(p))[0].startswith("Phone timestamp;trust;absolute_ok;synchronized;server;")
    cells = _rows(str(p))[0].split(";")
    assert cells[1] == "ntp"
    assert cells[2] == "1", "True must render as 1"
    assert cells[3] == "0", "False must render as 0 — it is a real negative claim, not an absence"


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
    assert row.count(";") == 10, "one row must keep exactly the header's delimiter count"
    assert row.endswith("step, then slew, done")


def test_host_clock_none_reason_is_blank_not_the_string_none(tmp_path):
    p = tmp_path / "c.csv"
    w = HostClockLogWriter(str(p), fsync=False)
    w.write(WHEN, {"reason": None})
    w.close()
    assert _rows(str(p))[0].split(";")[-1] == ""


# ── LinkLogWriter ───────────────────────────────────────────────────────────────────────────────────
def test_link_log_layout_and_connected_flag(tmp_path):
    p = tmp_path / "l.csv"
    w = LinkLogWriter(str(p), fsync=False)
    w.write(WHEN, "Polar H10", True, -56, 80)
    w.write(WHEN, "Polar H10", False, None, None)
    w.close()
    assert _lines(str(p))[0].split(";") == ["Phone timestamp", "device", "connected", "rssi_dbm",
                                            "battery_pct", "frames_dropped", "frames_duplicated"]
    up, down = (r.split(";") for r in _rows(str(p)))
    assert up[1:5] == ["Polar H10", "1", "-56", "80"]
    assert down[2] == "0" and down[3] == "" and down[4] == "", "absent RSSI/battery must be blank"


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
