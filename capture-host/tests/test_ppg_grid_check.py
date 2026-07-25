# tepna-capture — tests/test_ppg_grid_check.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""ppg_grid_check — marking the O2Ring PPG files written by the pre-fix grid.

The tool's whole value is the distinction it draws: a grid that ran ahead of the host clock because the
link LOST time (legitimate — the gap insertion exists for that) versus one that ran ahead because the
code INVENTED it. `rows/wall` is what separates them, and these tests pin that separation in both
directions. A tool that called every advance fabricated would be as dishonest as the bug.

VIGIL-PPG-GRID-AUDIT-2026-07-25-BRIEF §5.1.
"""
import datetime as _dt

import ppg_grid_check as pgc

FS = 125.738
STEP = int(1e9 / FS)


def _write(tmp_path, name, *, rows, wall_s, grid_s, t0=None):
    """Synthesize an O2Ring PPG file with an exact host span and an exact device-clock span."""
    t0 = t0 or _dt.datetime(2026, 7, 25, 2, 7, 23)
    p = tmp_path / name
    lines = ["Phone timestamp;sensor timestamp [ns];channel 0"]
    for i in range(rows):
        f = i / (rows - 1) if rows > 1 else 0.0
        ph = t0 + _dt.timedelta(seconds=f * wall_s)
        ns = int(round(f * grid_s * 1e9))
        lines.append(f"{ph.strftime('%Y-%m-%dT%H:%M:%S.')}{ph.microsecond // 1000:03d};{ns};1234")
    p.write_text("\n".join(lines) + "\n")
    return str(p)


def _name(stamp="20260725020723"):
    return f"Wellue_O2Ring-S_S8AW2100_{stamp}_PPG.txt"


def test_a_clean_file_reports_no_inflation(tmp_path):
    n = int(600 * FS)
    f = _write(tmp_path, _name(), rows=n, wall_s=600.0, grid_s=600.0)
    m = pgc.grid_inflation(f)
    assert abs(m["inflation"]) < 1e-6
    assert pgc._verdict(m, 0.2) == "ok"


def test_an_inflated_grid_with_samples_at_nominal_is_flagged(tmp_path):
    """The shipped defect: the grid claims 1.8% more time while every sample still arrived."""
    n = int(600 * FS)                                  # samples for the REAL 600 s
    f = _write(tmp_path, _name(), rows=n, wall_s=600.0, grid_s=610.8)
    m = pgc.grid_inflation(f)
    assert m["inflation"] > 0.017
    assert m["rows_per_wall"] > 0.98 * FS, "samples arrived at nominal — nothing was lost"
    assert pgc._verdict(m, 0.2) == "inflated"


def test_a_genuinely_lossy_link_is_NOT_called_fabricated(tmp_path):
    """Half the samples missing over the same span: the grid advance records real loss, and calling
    that fabricated would be the mirror-image dishonesty."""
    n = int(600 * FS * 0.5)
    f = _write(tmp_path, _name(), rows=n, wall_s=600.0, grid_s=610.8)
    m = pgc.grid_inflation(f)
    assert m["rows_per_wall"] < 0.98 * FS
    assert pgc._verdict(m, 0.2) == "lossy"


def test_a_short_fragment_is_unjudgeable_not_clean(tmp_path):
    """Endpoint-only measurement over a few seconds is dominated by ms quantization and session edges.
    It must report 'cannot judge', never a reassuring 'ok'."""
    f = _write(tmp_path, _name(), rows=400, wall_s=3.2, grid_s=3.3)
    m = pgc.grid_inflation(f)
    assert pgc._verdict(m, 0.2) == "unjudgeable"


def test_header_only_and_malformed_files_return_None_not_zero(tmp_path):
    p = tmp_path / _name()
    p.write_text("Phone timestamp;sensor timestamp [ns];channel 0\n")
    assert pgc.grid_inflation(str(p)) is None, "a file with no data is unjudgeable, not clean"
    p.write_text("Phone timestamp;sensor timestamp [ns];channel 0\ngarbage\nmore garbage\n")
    assert pgc.grid_inflation(str(p)) is None
    assert pgc.grid_inflation(str(tmp_path / "does-not-exist.txt")) is None


def test_scan_picks_up_only_o2ring_ppg_files(tmp_path):
    night = tmp_path / "2026-07-25"
    night.mkdir()
    n = int(120 * FS)
    _write(night, _name(), rows=n, wall_s=120.0, grid_s=120.0)
    _write(night, "Polar_VeritySense_0C301E3F_20260725020723_PPG.txt", rows=n, wall_s=120.0, grid_s=120.0)
    _write(night, "Wellue_O2Ring-S_S8AW2100_20260725020723_SPO2.csv", rows=n, wall_s=120.0, grid_s=120.0)
    found = pgc.scan(str(tmp_path))
    assert len(found) == 1, f"only the O2Ring PPG file qualifies, got {[p for p, _ in found]}"
    assert found[0][0].endswith(_name())


def test_cli_exit_code_is_nonzero_only_when_something_is_inflated(tmp_path, capsys):
    night = tmp_path / "2026-07-25"
    night.mkdir()
    n = int(600 * FS)
    _write(night, _name("20260725020723"), rows=n, wall_s=600.0, grid_s=600.0)
    assert pgc.main([str(tmp_path), "--quiet"]) == 0
    _write(night, _name("20260725031500"), rows=n, wall_s=600.0, grid_s=610.8)
    assert pgc.main([str(tmp_path), "--quiet"]) == 1
    assert "TIMELINE INFLATED" in capsys.readouterr().out
