# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""A 0 bpm is the SIG no-measurement sentinel, and must never reach `_HR.txt` as a rate.

The Heart Rate Measurement characteristic (0x2A37) reports 0 when the sensor has no lock. `_parse_hr`
returns that byte verbatim — correctly, it is the wire value — and `write_hr` used to write it into a
column headed `HR [bpm]`.

WHY THIS SURVIVED: both current consumers range-check (`ecgdex-dsp` rejects hr < 20,
`sigma-no-reference-analysis` requires hr >= HR_MIN), so no downstream number was visibly wrong. The
FILE was wrong and every reader defended itself — which is why the vendor-parity test below matters
more than any behavioural one: it is the evidence that 0 was never the format's convention.
"""
from __future__ import annotations
import datetime as _dt
import pathlib

import writers

_PHONE = _dt.datetime(2026, 9, 4, 3, 15, 0)


def _rows(p: pathlib.Path) -> list[str]:
    return [l for l in p.read_text(encoding="utf-8").splitlines()[1:] if l.strip()]


def test_a_zero_bpm_writes_no_hr_row(tmp_path):
    w = writers.StreamWriter(str(tmp_path / "x_HR.txt"), "hr")
    w.write_hr(_PHONE, 0, 58, [])
    w.write_hr(_PHONE, 0, 0, [])          # no lock — must not appear
    w.write_hr(_PHONE, 0, 59, [])
    w.close()
    vals = [r.split(";")[1] for r in _rows(tmp_path / "x_HR.txt")]
    assert vals == ["58", "59"], f"the 0-bpm sentinel reached the file: {vals}"


def test_the_column_is_skipped_not_blanked(tmp_path):
    """`Number('')` is 0 in JavaScript, so a blank field hands the sentinel back to any reader that
    does not range-check. A row that does not exist cannot be misread; a blank one can."""
    w = writers.StreamWriter(str(tmp_path / "y_HR.txt"), "hr")
    w.write_hr(_PHONE, 0, 0, [])
    w.close()
    body = _rows(tmp_path / "y_HR.txt")
    assert body == [], f"expected no row at all, got {body!r}"


def test_rr_survives_a_zero_bpm_notification(tmp_path):
    """One notification can carry valid intervals while the rate byte reads 0. Those intervals are the
    HRV substrate and dropping them with the sentinel would trade one silent loss for another."""
    w = writers.StreamWriter(str(tmp_path / "z_HR.txt"), "hr")
    w.write_hr(_PHONE, 0, 0, [812, 806])
    w.close()
    assert _rows(tmp_path / "z_HR.txt") == [], "the HR row should be absent"
    rr = _rows(tmp_path / "z_RR.txt")
    assert [r.split(";")[1] for r in rr] == ["812", "806"], f"RR was lost with the sentinel: {rr}"


def test_rows_counts_only_rows_actually_written(tmp_path):
    """`rows` is a public property. Bumping it for a row that was skipped would make it a count of
    notifications rather than of file contents — the kind of number that reads plausible and is wrong."""
    w = writers.StreamWriter(str(tmp_path / "n_HR.txt"), "hr")
    w.write_hr(_PHONE, 0, 60, [])
    w.write_hr(_PHONE, 0, 0, [])
    w.close()
    assert w.rows == 1, f"rows should count written rows only, got {w.rows}"


def test_real_polar_sensor_logger_exports_contain_no_zero_bpm():
    """THE EVIDENCE THAT MAKES THIS A FACT RATHER THAN A PREFERENCE. `_HR.txt`'s header is deliberately
    byte-compatible with Polar Sensor Logger, so if PSL wrote 0-bpm rows, mirroring it would be correct
    and this whole change would be wrong. It does not: 0 across every genuine export in `uploads/`.

    SKIPS rather than fails when the goldens are absent — they are gitignored on some checkouts, and a
    test that cannot see its corpus must not claim a verdict about it."""
    up = pathlib.Path(__file__).resolve().parent.parent.parent / "uploads"
    files = sorted(up.glob("Polar_H10_*_HR.txt")) if up.is_dir() else []
    if not files:
        import pytest
        pytest.skip("PSL goldens not present in this checkout")
    total = zeros = 0
    for f in files:
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines()[1:]:
            parts = line.split(";")
            if len(parts) < 2 or not parts[1].strip():
                continue
            total += 1
            if parts[1].strip() == "0":
                zeros += 1
    assert total > 1000, f"expected a substantial PSL sample, saw {total} rows"
    assert zeros == 0, f"PSL DOES write 0-bpm rows ({zeros}/{total}) — re-open this decision"
