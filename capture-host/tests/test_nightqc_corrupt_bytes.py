# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""A CORRUPT FILE MUST NOT TAKE THE WHOLE NIGHT'S QC WITH IT.

#2017 made an UNREADABLE file honest — but only for `OSError`. The likelier corruption here is
invalid BYTES: a torn write, a truncated flush, a sidecar cut off mid-row. That raises
`UnicodeDecodeError`, which is a `ValueError` and therefore sails straight through every
`except OSError` in this module, killing the whole report.

⚠️ AND IT LANDS EXACTLY WHERE IT HURTS MOST. A night whose flushes were failing (#2016) is
precisely a night likely to hold a truncated sidecar — so QC would die on the nights that most
need judging.

With `errors="replace"` the bad bytes become a row that fails to parse, which is already handled
honestly and bounded by each function's own minimum-sample floor.
"""
import nightqc

BAD = b"\xff\xfe"


def test_ARRIVAL_QUALITY_SURVIVES_INVALID_BYTES(tmp_path):
    p = tmp_path / "2026-08-31_H10-01_PMDARRIVAL.csv"
    p.write_bytes(b"phone_ts;device;meas;ns\n" + BAD + b" torn;H10;ECG;1\n")
    assert nightqc.arrival_quality(str(tmp_path)) == []      # judged as nothing, not crashed


def test_MEASURED_HZ_SURVIVES_INVALID_BYTES(tmp_path):
    p = tmp_path / "s.csv"
    p.write_bytes(b"t;ns\n" + BAD + b";1\n" * 3)
    assert nightqc.measured_hz(str(p)) is None               # refused by the floor, not raised


def test_RTC_DRIFT_SUMMARY_SURVIVES_INVALID_BYTES(tmp_path):
    p = tmp_path / "rtc.csv"
    p.write_bytes(b"ts;event;offset\n" + BAD + b";read;1.0\n")
    got = nightqc.rtc_drift_summary(str(p))
    # The OFFSET is real data and survives; only the timestamp was corrupt. So the honest result is
    # a summary that reports the read and refuses the span — `span_h: None` rather than a fabricated
    # duration. (My first version of this test asserted None for the whole thing and was wrong: the
    # code degrades better than I expected, and asserting the weaker outcome would have locked in a
    # loss of real data.)
    assert got["reads"] == 1 and got["first_offset_s"] == 1.0
    assert got["span_h"] is None


def test_A_CLEAN_FILE_STILL_PARSES(tmp_path):
    """The control. Every assertion above is satisfied by a function that returns None for
    everything, so without this they would pass against a module that reads nothing at all."""
    p = tmp_path / "rtc.csv"
    p.write_text("ts;event;offset\n2026-08-31T00:00:00;read;1.0\n2026-08-31T01:00:00;read;2.5\n")
    got = nightqc.rtc_drift_summary(str(p))
    assert got and got["reads"] == 2 and got["drift_s"] == 1.5
