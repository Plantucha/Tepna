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
    n = int(600 * FS)  # samples for the REAL 600 s
    holes = [(i * (n // 21), 68) for i in range(1, 21)]  # 20 jumps x 68 samples ~ 10.8 s
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
    _write(night, _name("20260725031500"), rows=n, wall_s=600.0, gaps=[(i * (n // 21), 68) for i in range(1, 21)])
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
    gappy = pgc.grid_inflation(
        _write(
            tmp_path,
            _name("20260725031500"),
            rows=rows,
            wall_s=wall,
            gaps=[(i * (rows // 6), extra // 5) for i in range(1, 6)],
        )
    )
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


# ── THE ARITHMETIC CORE, which the mutation gate found unobserved (2026-10-04) ─────────────────────
# A mypy fix inside `grid_inflation` pulled the whole function into the gate's scope, and 12 of its
# mutants had no test that could see them — every one on a line the fix never touched. The existing
# tests assert the VERDICT (`ok`, `gaps`, `distinct_steps`) and the inflation to 1e-5; none pins the
# intermediate quantities the verdict is computed from, so the subtraction, the divisor and the
# field index were all free to change.
def _raw(tmp_path, rows, name=None):
    """A PPG file written row by row, for fixtures `_write` cannot express — a non-zero first
    `sensor_ns`, a sub-second wall span, a torn first row."""
    p = tmp_path / (name or _name())
    p.write_text("Phone timestamp;sensor timestamp [ns];channel 0\n" + "\n".join(rows) + "\n")
    return str(p)


def _row(ms, ns, ch=1234):
    t = _dt.datetime(2026, 7, 25, 2, 7, 23) + _dt.timedelta(milliseconds=ms)
    return f"{t.strftime('%Y-%m-%dT%H:%M:%S.')}{t.microsecond // 1000:03d};{ns};{ch}"


def test_the_grid_span_is_the_DIFFERENCE_of_the_two_sensor_stamps(tmp_path):
    """Kills `(ns1 - ns0)` → `(ns1 + ns0)` and `int(fp[1])` → `int(fp[2])`.

    ⚠️ Every existing fixture starts `sensor_ns` at ZERO, where `ns1 - ns0` and `ns1 + ns0` are the
    same number — so the subtraction was never observed. A real O2Ring file starts wherever the ring's
    counter happens to be."""
    f = _raw(tmp_path, [_row(0, 1_000_000_000, ch=7), _row(2000, 3_000_000_000, ch=9)])
    m = pgc.grid_inflation(f)
    assert m["grid_s"] == 2.0, m["grid_s"]  # (3e9 - 1e9) / 1e9, not 4.0 and not (3e9 - 7)/1e9


def test_the_grid_span_is_divided_by_EXACTLY_one_billion(tmp_path):
    """Kills `/ 1e9` → `/ 1000000001.0` on the grid span. The spans in the other fixtures are long
    enough that a one-part-in-1e9 divisor error hides under the 1e-5 inflation tolerance; an exact
    equality on a span that divides evenly does not let it."""
    f = _raw(tmp_path, [_row(0, 0), _row(2000, 2_000_000_000)])
    assert pgc.grid_inflation(f)["grid_s"] == 2.0


def test_a_SUB_SECOND_file_is_still_measured(tmp_path):
    """Kills `if wall <= 0` → `wall <= 1`. The guard rejects a file whose host clock did not advance;
    widening it to a second silently discards every short fragment as unjudgeable."""
    f = _raw(tmp_path, [_row(0, 0), _row(500, 500_000_000)])
    m = pgc.grid_inflation(f)
    assert m is not None, "a 0.5 s file was discarded as if its clock had not advanced"
    assert m["wall_s"] == 0.5


def test_a_torn_row_on_EITHER_side_makes_the_file_unjudgeable(tmp_path):
    """Kills `len(fp) < 3 or len(lp) < 3` → `and`. With `and`, one torn row is tolerated as long as
    the other is intact, and the file is judged from a row it could not read."""
    short_first = _raw(tmp_path, ["2026-07-25T02:07:23.000;0", _row(2000, 2_000_000_000)])
    assert pgc.grid_inflation(short_first) is None
    short_last = _raw(tmp_path, [_row(0, 0), "2026-07-25T02:07:25.000;2000000000"], name=_name("20260725020724"))
    assert pgc.grid_inflation(short_last) is None


def _gappy(tmp_path):
    """Two gap jumps of known size on a 10-row grid: modal step 1e6 ns, two deltas of 3e6."""
    ns, rows = 0, []
    for i in range(10):
        rows.append(_row(i * 10, ns))
        ns += 3_000_000 if i in (3, 6) else 1_000_000
    return _raw(tmp_path, rows)


def test_the_fabricated_seconds_are_the_SUM_OF_THE_EXCESS_over_the_modal_step(tmp_path):
    """Kills six mutants on the `gap_seconds` line at once — `/ 1e9` → `* 1e9`, `c * (d - modal)` →
    `c / (d - modal)`, `(d - modal)` → `(d + modal)`, `and` → `or`, `modal is not None` → `is None`,
    and `/ 1e9` → `/ 1000000001.0`. The quantity was computed and returned and never asserted.

    Two jumps of 3e6 ns against a modal step of 1e6 ns: each contributes 2e6 ns of fabricated time,
    so 4e6 ns = 0.004 s."""
    m = pgc.grid_inflation(_gappy(tmp_path))
    assert m["modal_step_ns"] == 1_000_000
    assert m["gaps"] == 2
    assert m["gap_seconds"] == 0.004, m["gap_seconds"]


def test_fabricated_seconds_are_the_grid_MINUS_the_wall(tmp_path):
    """Kills `grid - wall` → `grid + wall`. A sign error here reports a file that LOST time as one
    that invented it, which is the whole distinction this module exists to make."""
    f = _raw(tmp_path, [_row(0, 0), _row(2000, 1_000_000_000)])  # grid 1.0 s over a 2.0 s wall
    m = pgc.grid_inflation(f)
    assert m["wall_s"] == 2.0 and m["grid_s"] == 1.0
    assert m["fabricated_s"] == -1.0, "a file that lost a second was reported as fabricating three"


def test_a_step_SHORTER_than_the_modal_one_does_not_count_as_fabricated_time(tmp_path):
    """Kills `modal is not None and d > modal` → `or`.

    ⚠️ MY FIRST GAP FIXTURE COULD NOT SEE THIS, for the third instance of the same trap today: with
    `or` the condition is true for every delta, but the modal term contributes `c * (d - modal)` = 0
    and the only other deltas were LARGER, so the sum was unchanged. A delta BELOW the modal step is
    what separates them — it contributes a negative term, and fabricated time that goes DOWN because
    one step was short is exactly the arithmetic this guard exists to prevent.

    Deltas here: 7 × 1e6 (modal), one 5e5, one 3e6. Only the 3e6 is fabricated: 2e6 ns = 0.002 s.
    Under `or` the short step subtracts 5e5 and the answer becomes 0.0015."""
    ns, rows, steps = 0, [], [1_000_000] * 3 + [500_000] + [1_000_000] * 3 + [3_000_000] + [1_000_000]
    rows.append(_row(0, ns))
    for i, st in enumerate(steps):
        ns += st
        rows.append(_row((i + 1) * 10, ns))
    m = pgc.grid_inflation(_raw(tmp_path, rows))
    assert m["modal_step_ns"] == 1_000_000
    assert m["gaps"] == 2, m["gaps"]
    assert m["gap_seconds"] == 0.002, m["gap_seconds"]


# ── THE EQUIVALENCE BATTERY (tools/mutate-equivalence.json, ppg_grid_check.py) ─────────────────────
# Two mutants in `grid_inflation` survive every test, and the claim that they CANNOT be killed is only
# worth recording if the instrument making it can detect a difference at all. So the canaries run
# FIRST and must all be caught: a battery that distinguishes nothing is indistinguishable from one too
# narrow to distinguish anything (tools/probe_equivalence.py's rule).
import types

from _srcscan import module_source

_PGC_CANARIES = [
    # (before, after, why it MUST be caught)
    ("(ns1 - ns0) / 1e9", "(ns1 + ns0) / 1e9", "the grid span is a difference, not a sum"),
    ("if modal is not None and d > modal", "if modal is not None and d < modal", "the gap filter flips"),
    ("if wall <= 0", "if wall <= 1", "the unjudgeable-file guard widens to a second"),
]
_PGC_CANDIDATES = [
    ("if deltas else None", "if (deltas) or True else None"),
    ("if modal is not None and d > modal", "if modal is not None and d >= modal"),
]


def _pgc_variant(before=None, after=None):
    src = module_source("ppg_grid_check.py")
    if before is not None:
        assert src.count(before) == 1, f"anchor {before!r} is not unique — the battery would test nothing"
        src = src.replace(before, after)
    mod = types.ModuleType("pgc_variant")
    exec(compile(src, pgc.__file__, "exec"), mod.__dict__)
    return mod


def _pgc_corpus(tmp_path):
    """Files spanning every shape `grid_inflation` branches on: clean, gappy above the modal step,
    gappy BELOW it, both at once, a non-zero start, a sub-second span, a single step."""
    out, mk = [], lambda i, steps, ns0=0: _raw(
        tmp_path,
        [_row(0, ns0)] + [_row((j + 1) * 10, ns0 + sum(steps[: j + 1])) for j in range(len(steps))],
        name=_name(f"2026072502{i:04d}"),
    )
    out.append(mk(1, [1_000_000] * 9))
    out.append(mk(2, [1_000_000] * 3 + [3_000_000] + [1_000_000] * 5))
    out.append(mk(3, [1_000_000] * 3 + [500_000] + [1_000_000] * 5))
    out.append(mk(4, [1_000_000, 500_000, 3_000_000, 1_000_000, 1_000_000, 250_000, 1_000_000]))
    out.append(mk(5, [1_000_000] * 9, ns0=7_000_000_000))
    out.append(mk(6, [50_000] * 9))
    out.append(mk(7, [2_000_000_000]))
    return out


def _pgc_observe(mod, files):
    return [mod.grid_inflation(f) for f in files]


def test_the_two_inert_grid_mutants_are_unkillable_and_the_battery_can_PROVE_it(tmp_path):
    files = _pgc_corpus(tmp_path)
    base = _pgc_observe(_pgc_variant(), files)
    assert any(r is not None for r in base), "the corpus produced no judgeable file — it measures nothing"

    caught = 0
    for before, after, why in _PGC_CANARIES:
        if _pgc_observe(_pgc_variant(before, after), files) != base:
            caught += 1
        else:
            raise AssertionError(f"canary NOT caught ({why}) — this battery cannot detect a difference")
    assert caught == len(_PGC_CANARIES)

    for before, after in _PGC_CANDIDATES:
        assert _pgc_observe(_pgc_variant(before, after), files) == base, (
            f"{before!r} -> {after!r} IS distinguishable on this corpus — it is a test gap, not an "
            "equivalence, and the ledger entry must be withdrawn"
        )
