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


def _write(tmp_path, name, *, rows, wall_s, step_ns=STEP, gaps=(), t0=None):
    """Synthesize an O2Ring PPG file THE WAY THE BOX WRITES ONE: a constant `sensor_ns` step, plus any
    discrete gap jumps. `gaps` is [(row_index, extra_samples), …].

    ⚠️ This used to take `grid_s` and interpolate the ns column linearly across it, which meant every
    fixture was a UNIFORM grid — including the one named `..._an_inflated_grid_...`, whose "gaps" were
    nothing but ±1 ns rounding between the floor and ceil of a constant step. It passed, for a reason
    that had nothing to do with what it claimed to test. Since the whole §A3-rider distinction is
    "gap insertion versus a uniform step error", a fixture that cannot express the difference cannot
    test it. The ns column is now built the way the grid builds it.

    The phone column is spread evenly across `wall_s` — the host clock is independent of the grid, and
    their divergence is exactly the quantity under measurement."""
    t0 = t0 or _dt.datetime(2026, 7, 25, 2, 7, 23)
    extra = dict(gaps)
    p = tmp_path / name
    lines = ["Phone timestamp;sensor timestamp [ns];channel 0"]
    ns = 0
    for i in range(rows):
        f = i / (rows - 1) if rows > 1 else 0.0
        ph = t0 + _dt.timedelta(seconds=f * wall_s)
        lines.append(f"{ph.strftime('%Y-%m-%dT%H:%M:%S.')}{ph.microsecond // 1000:03d};{ns};1234")
        ns += step_ns * (1 + extra.get(i, 0))
    p.write_text("\n".join(lines) + "\n")
    return str(p)


def _name(stamp="20260725020723"):
    return f"Wellue_O2Ring-S_S8AW2100_{stamp}_PPG.txt"


def test_a_clean_file_reports_no_inflation(tmp_path):
    n = int(600 * FS)
    f = _write(tmp_path, _name(), rows=n, wall_s=(n - 1) * STEP / 1e9)
    m = pgc.grid_inflation(f)
    # 1e-5, not 1e-6: the phone column is ms-quantized (the module header says so), so a 600 s span
    # carries up to 1 ms of endpoint error = 1.7e-6 relative. Asserting below the measurement's own
    # resolution would be asserting noise.
    assert abs(m["inflation"]) < 1e-5
    assert m["gaps"] == 0 and m["distinct_steps"] == 1
    assert pgc._verdict(m, 0.2) == "ok"


def test_an_inflated_grid_with_samples_at_nominal_is_flagged(tmp_path):
    """The shipped defect: the grid claims 1.8% more time while every sample still arrived, and it did
    so by INSERTING GAPS — 20 discrete jumps, i.e. 20 non-modal deltas the file still carries."""
    n = int(600 * FS)                                  # samples for the REAL 600 s
    holes = [(i * (n // 21), 68) for i in range(1, 21)]   # 20 jumps x 68 samples ~ 10.8 s
    f = _write(tmp_path, _name(), rows=n, wall_s=600.0, gaps=holes)
    m = pgc.grid_inflation(f)
    assert m["inflation"] > 0.017
    assert m["rows_per_wall"] > 0.98 * FS, "samples arrived at nominal — nothing was lost"
    assert m["gaps"] == 20, "the inserted gaps are visible in the delta histogram"
    assert pgc._verdict(m, 0.2) == "inflated"


def test_a_genuinely_lossy_link_is_NOT_called_fabricated(tmp_path):
    """Half the samples missing over the same span: the grid advance records real loss, and calling
    that fabricated would be the mirror-image dishonesty."""
    n = int(600 * FS * 0.5)
    # the grid claims 610.8 s while only half the samples arrived: one big honest gap
    extra = int(round((610.8 * 1e9 - (n - 1) * STEP) / STEP))
    f = _write(tmp_path, _name(), rows=n, wall_s=600.0, gaps=[(n // 2, extra)])
    m = pgc.grid_inflation(f)
    assert m["rows_per_wall"] < 0.98 * FS
    assert pgc._verdict(m, 0.2) == "lossy"


def test_a_short_fragment_is_unjudgeable_not_clean(tmp_path):
    """Endpoint-only measurement over a few seconds is dominated by ms quantization and session edges.
    It must report 'cannot judge', never a reassuring 'ok'."""
    f = _write(tmp_path, _name(), rows=400, wall_s=3.2)
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
    _write(night, _name(), rows=n, wall_s=120.0)
    _write(night, "Polar_VeritySense_0C301E3F_20260725020723_PPG.txt", rows=n, wall_s=120.0)
    _write(night, "Wellue_O2Ring-S_S8AW2100_20260725020723_SPO2.csv", rows=n, wall_s=120.0)
    found = pgc.scan(str(tmp_path))
    assert len(found) == 1, f"only the O2Ring PPG file qualifies, got {[p for p, _ in found]}"
    assert found[0][0].endswith(_name())


def test_cli_exit_code_is_nonzero_only_when_something_is_inflated(tmp_path, capsys):
    night = tmp_path / "2026-07-25"
    night.mkdir()
    n = int(600 * FS)
    _write(night, _name("20260725020723"), rows=n, wall_s=(n - 1) * STEP / 1e9)
    assert pgc.main([str(tmp_path), "--quiet"]) == 0
    _write(night, _name("20260725031500"), rows=n, wall_s=600.0,
           gaps=[(i * (n // 21), 68) for i in range(1, 21)])
    assert pgc.main([str(tmp_path), "--quiet"]) == 1
    assert "PHANTOM GAPS" in capsys.readouterr().out


# ── uniform rate error vs phantom gaps (CAPTURE-HOST-DEEP-AUDIT §A3-rider) ─────────────────────
def test_a_uniform_stretch_is_reported_as_a_rate_error_not_as_phantom_gaps(tmp_path):
    """THE rider. Reproduces the real file the tool mis-attributed: 331 552 rows, ONE distinct
    `sensor_ns` delta across all 331 551 steps, +0.244 % inflation, rows/wall 126.045.

    It was reported `<-- TIMELINE INFLATED, 6.4 s fabricated` under a banner asserting the beat
    timelines are "stretched at each phantom gap" and "cannot be repaired". Both clauses are false
    here: there is no phantom gap to be stretched at, and a uniform stretch IS exactly repairable — the
    endpoints are anchored to the phone clock, so one scale factor recovers the span. Two mechanisms
    produce the same ratio and the tool assumed one of them; the file distinguishes them for free."""
    rows = 331552
    grid_s = (rows - 1) * STEP / 1e9
    f = _write(tmp_path, _name(), rows=rows, wall_s=grid_s / 1.00244)
    m = pgc.grid_inflation(f)
    assert m["distinct_steps"] == 1, "a uniform stretch leaves the delta set a SINGLETON"
    assert m["gaps"] == 0 and m["gap_seconds"] == 0.0
    assert abs(m["inflation"] - 0.00244) < 1e-4
    assert abs(m["rows_per_wall"] - 126.045) < 0.01
    assert pgc._verdict(m, 0.2) == "rate-mismatch"


def test_the_two_mechanisms_are_told_apart_at_the_same_inflation(tmp_path):
    """The discriminator, isolated: identical inflation and identical rows/wall, differing ONLY in
    whether the ns deltas are uniform. Anything that cannot separate these two is the shipped bug."""
    rows = int(300 * FS)
    base = (rows - 1) * STEP / 1e9
    wall = base / 1.005
    uniform = pgc.grid_inflation(_write(tmp_path, _name("20260725020723"), rows=rows, wall_s=wall))
    # same total stretch, delivered as 5 discrete jumps instead of a wrong step
    extra = int(round(0.005 * base * FS))
    gappy = pgc.grid_inflation(_write(
        tmp_path, _name("20260725031500"), rows=rows, wall_s=wall,
        gaps=[(i * (rows // 6), extra // 5) for i in range(1, 6)]))
    assert abs(uniform["inflation"] - 0.005) < 5e-4 and abs(gappy["inflation"] - 0.010) < 2e-3
    assert pgc._verdict(uniform, 0.2) == "rate-mismatch"
    assert pgc._verdict(gappy, 0.2) == "inflated"
    assert uniform["gaps"] == 0 and gappy["gaps"] == 5


def test_the_cli_reports_a_uniform_stretch_as_rescalable(tmp_path, capsys):
    """The remediation must match the measurement. "They cannot be repaired" is right for phantom gaps
    and wrong for a uniform stretch — and with the pre-A3 grid live, freshly written nights landed in
    the second category, so the shipped tool was telling the operator to discard good data."""
    night = tmp_path / "2026-07-26"
    night.mkdir()
    rows = int(600 * FS)
    grid_s = (rows - 1) * STEP / 1e9
    _write(night, _name("20260726020000"), rows=rows, wall_s=grid_s / 1.00244)
    assert pgc.main([str(tmp_path)]) == 1
    out = capsys.readouterr().out
    assert "UNIFORM RATE ERROR" in out
    assert "PHANTOM GAPS" not in out, "a file with zero gaps must not be described as gap-stretched"
    assert "cannot be repaired" not in out
    assert "scale x" in out, "a uniform stretch is exactly rescalable — say by how much"
