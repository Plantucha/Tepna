# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""AN UNREADABLE FILE MUST NOT READ AS A JUDGED ONE.

Night-QC's three per-file `except OSError: continue` sites each dropped a whole file in silence.
That is a different failure from the per-row parse drops beside them: a torn row at a live file's
tail is expected and bounded by a downstream floor, whereas a lost file removes a stream from the
report entirely — and an absent stream reads exactly like one that was never recorded.
"""
import os

import nightqc


def _unreadable(path):
    """A file that exists, is listed, and raises OSError when opened — a failing drive, a bad
    permission, a vanished mount. NOT a missing file: missing is already handled honestly."""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("x")
    os.chmod(path, 0o000)
    return path


def test_A_NIGHT_CANNOT_BE_AGED_BY_A_FILE_IT_COULD_NOT_READ(tmp_path, caplog):
    """`newest_data_mtime` decides which night is the ACTIVE one. Skipping a file makes the night
    look older than it is — a wrong answer, not a partial total."""
    good = tmp_path / "2026-08-31_H10-01_HR.csv"
    good.write_text("t;v\n")
    with caplog.at_level("WARNING"):
        got = nightqc.newest_data_mtime(str(tmp_path))
    assert got is not None
    assert "unreadable" not in caplog.text, "control: a readable night must say nothing"


def test_AN_UNREADABLE_FILE_IS_ANNOUNCED_NOT_SILENTLY_DROPPED(tmp_path, caplog, monkeypatch):
    real = os.path.getmtime

    def boom(p):
        if p.endswith("_HR.csv"):
            raise OSError(5, "Input/output error")
        return real(p)

    (tmp_path / "2026-08-31_H10-01_HR.csv").write_text("t;v\n")
    monkeypatch.setattr(nightqc.os.path, "getmtime", boom)
    with caplog.at_level("WARNING"):
        nightqc.newest_data_mtime(str(tmp_path))
    assert "cannot age this night" in caplog.text


def test_A_LOST_ARRIVAL_FILE_IS_ABSENT_NOT_GOOD(tmp_path, caplog, monkeypatch):
    """The distinction the log exists to preserve: no row in the report can mean 'this stream was
    never recorded' or 'we could not read it', and only one of those is the sensor's fault."""
    p = tmp_path / "2026-08-31_H10-01_PMDARRIVAL.csv"
    p.write_text("phone_ts;device;meas;ns\n")
    _unreadable(str(p))
    with caplog.at_level("WARNING"):
        out = nightqc.arrival_quality(str(tmp_path))
    if os.geteuid() != 0:                    # root ignores the mode and would read it happily
        assert out == [] and "absent from this report" in caplog.text
