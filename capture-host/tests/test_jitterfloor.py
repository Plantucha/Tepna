# tepna-capture — test_jitterfloor.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""jitterfloor: planted-value recovery, the drawn-axis refusal, and every parse rejection path."""

import json

import jitterfloor as jf


def _row(ts, device, meas, first_ns):
    return "%s;%s;%s;%d;%d;73" % (ts, device, meas, first_ns, first_ns + 500_000_000)


def _stamp(sec):
    return "2026-08-21T21:%02d:%02d.%03d" % (int(sec // 60), int(sec % 60), int((sec * 1000) % 1000))


def _write_night(tmp_path, name, lines):
    p = tmp_path / ("%s_PMDARRIVAL.csv" % name)
    p.write_text("Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n" + "\n".join(lines) + "\n")
    return p


def _real_clock_stream(n=120, base_s=0.5, jitter_ms=(3, -3)):
    """Device clock with CRYSTAL-SCALE wander; host arrivals carry alternating planted jitter.

    The wander term matters: a perfectly exact synthetic clock has constant deltas and is
    INDISTINGUISHABLE from a drawn axis — the detector (matching clock.js semantics) correctly
    refuses it. Real crystals never produce concentration >= 99 %, so neither does this fixture.
    """
    lines = []
    wobble = (0.31, -0.17, 0.23, -0.29, 0.11, -0.37, 0.19, -0.13)  # ms, sub-jitter scale
    for i in range(n):
        host_s = i * base_s + jitter_ms[i % len(jitter_ms)] / 1000.0
        dev_ns = int(i * base_s * 1e9 + wobble[i % len(wobble)] * 1e6)
        lines.append(_row(_stamp(host_s), "Polar H10 X", "ecg", dev_ns))
    return lines


def test_planted_jitter_recovered_vs_device(tmp_path):
    _write_night(tmp_path, "h10", _real_clock_stream())
    out = jf.night_floor(tmp_path)
    f = out["floor"]
    assert f is not None and f["method"] == "vs-device" and not f["device_axis_drawn"]
    # host deltas alternate base±6ms around an exact device schedule → MAD of residual = 6
    assert 5.0 <= f["jitter_ms"] <= 7.0, f
    assert abs(f["base_ms"] - 500.0) < 1.0, f
    assert f["stream"] == "Polar H10 X|ecg"


def test_drawn_axis_refused_and_folded_fallback(tmp_path):
    # device deltas ALL identical (index × rate — the O2Ring shape) while host jitter is real:
    # vs-device would launder host jitter into agreement, so the drawn axis must be detected
    lines = []
    for i in range(120):
        host_s = i * 0.5 + (0.004 if i % 2 else -0.004)
        lines.append(_row(_stamp(host_s), "O2Ring R", "spo2", int(i * 0.5e9)))
    # drawn: device deltas constant → concentration 1.0... but so is a PERFECT real clock; the
    # discriminator is concentration, and a perfect synthetic clock is indistinguishable from a
    # drawn one BY DESIGN (clock.js draws the same conclusion). The refusal is the honest path.
    _write_night(tmp_path, "ring", lines)
    out = jf.night_floor(tmp_path)
    f = out["floor"]
    assert f is not None and f["method"] == "folded" and f["device_axis_drawn"]
    assert 7.0 <= f["jitter_ms"] <= 9.0, f  # ±4 ms POSITION jitter is ±8 ms DELTA jitter
    assert abs(f["base_ms"] - 500.0) < 10.0, f


def test_missed_frames_do_not_inflate_folded_jitter(tmp_path):
    # every 3rd frame missing: gaps of 2×base must fold out, not read as 500 ms of "jitter".
    # The miss rate is deliberately high enough that Q3 lands INSIDE the doubled-gap cluster if
    # the fold formula is broken — half-IQR is translation-invariant, so a fold that merely
    # SHIFTS residuals is invisible unless the k=2 gaps land in the quartile span.
    lines = []
    for i in range(220):
        if i % 3 == 2:
            continue
        host_s = i * 0.5 + (0.002 if i % 2 else -0.002)
        lines.append(_row(_stamp(host_s), "O2Ring R", "spo2", int(i * 0.5e9)))
    _write_night(tmp_path, "ring", lines)
    f = jf.night_floor(tmp_path)["floor"]
    assert f is not None and f["jitter_ms"] < 10.0, f


def test_short_stream_yields_no_floor(tmp_path):
    _write_night(tmp_path, "h10", _real_clock_stream(n=20))
    out = jf.night_floor(tmp_path)
    assert out["floor"] is None and out["streams"] == {}


def test_best_sampled_session_wins_per_stream(tmp_path):
    _write_night(tmp_path, "a", _real_clock_stream(n=110))
    _write_night(tmp_path, "b", _real_clock_stream(n=140))
    out = jf.night_floor(tmp_path)
    assert out["streams"]["Polar H10 X|ecg"]["n_frames"] == 140  # the better-sampled session file wins


def test_malformed_rows_are_dropped_not_guessed(tmp_path):
    # malformed rows FIRST: a parser that stops at the first bad row (break, not continue)
    # would drop every good row after it, which appended-at-the-end bad rows cannot detect
    lines = [
        "not;enough;fields",
        "2026-08-21 21:00:00.000;Polar H10 X;ecg;1;2;3",  # space, not T — wrong format
        "2026-08-21T21:00:00.000;Polar H10 X;ecg;NOTANUMBER;2;3",
    ]
    lines += _real_clock_stream(n=110)
    streams = jf.parse_pmdarrival(_write_night(tmp_path, "h10", lines))
    assert len(streams["Polar H10 X|ecg"]) == 110


def test_stamp_parser_rejects_and_accepts():
    assert jf._parse_stamp_ms("2026-08-21T21:47:00.915") is not None
    assert jf._parse_stamp_ms("21:47:00.915") is None
    assert jf._parse_stamp_ms("2026-08-21T21:47:00") is None  # no millis — not the writer's format


def test_folded_base_prefers_relative_score():
    # 200 ms base with ±20 ms jitter: an absolute argmin folds "better" into ~50 ms (measured on
    # the btmon sibling, 2026-08-23); the relative score must keep the true base
    deltas = [200 + (20 if i % 2 else -20) for i in range(40)]
    assert abs(jf._folded_base([float(d) for d in deltas]) - 200.0) < 25.0


def test_cli_paths(tmp_path, capsys):
    assert jf.main([]) == 0
    assert "usage" in capsys.readouterr().out
    assert jf.main(["--help"]) == 0
    capsys.readouterr()
    _write_night(tmp_path, "h10", _real_clock_stream())
    assert jf.main([str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "DELIVERY-JITTER FLOOR" in out and "vs-device" in out
    assert jf.main([str(tmp_path), "--json"]) == 0
    parsed = json.loads(capsys.readouterr().out)
    assert parsed["floor"]["stream"] == "Polar H10 X|ecg"
    empty = tmp_path / "empty"
    empty.mkdir()
    assert jf.main([str(empty)]) == 1
    assert "no floor claimable" in capsys.readouterr().out


def test_folded_base_small_interval_break():
    # median/m dips under the 8 ms guard → the candidate loop BREAKS rather than folding into it
    deltas = [20.0 + (0.5 if i % 2 else -0.5) for i in range(40)]
    assert jf._folded_base(deltas) >= 8.0


def test_worse_sampled_session_does_not_replace(tmp_path):
    # the smaller session arrives SECOND — the prev-wins branch (n_frames not greater)
    _write_night(tmp_path, "a", _real_clock_stream(n=140))
    _write_night(tmp_path, "b", _real_clock_stream(n=110))
    out = jf.night_floor(tmp_path)
    assert out["streams"]["Polar H10 X|ecg"]["n_frames"] == 140


def test_floor_is_min_across_streams(tmp_path):
    # two streams, second jitterier — the floor keeps the first (floor-not-replaced branch)
    lines = _real_clock_stream(n=120, jitter_ms=(2, -2))
    noisy = []
    wobble = (0.31, -0.17, 0.23, -0.29)
    for i in range(120):
        host_s = i * 0.5 + (0.02 if i % 2 else -0.02)
        dev_ns = int(i * 0.5e9 + wobble[i % len(wobble)] * 1e6)
        noisy.append(_row(_stamp(host_s), "Verity V", "ppg", dev_ns))
    _write_night(tmp_path, "mix", lines + noisy)
    out = jf.night_floor(tmp_path)
    assert len(out["streams"]) == 2
    assert out["floor"]["stream"] == "Polar H10 X|ecg"


def test_jitter_scale_is_quartile_based():
    # pins the exact quantile grid (n=4): quantiles([0..19], n=4) = [4.25, 9.5, 14.75]
    assert jf._jitter_scale([float(x) for x in range(20)]) == 5.25


def test_drawn_concentration_boundary_is_inclusive():
    # exactly 99 of 100 deltas modal → concentration == DRAWN_CONCENTRATION → drawn (>=, not >)
    deltas = [500.0] * 99 + [499.0]
    assert jf._device_axis_is_drawn(deltas) is True
    # and 98/100 is below the bound
    assert jf._device_axis_is_drawn([500.0] * 98 + [499.0, 501.0]) is False


def test_drawn_detector_quantum_is_one_decimal():
    # deltas alternating ±0.4 ms: distinct at 1 decimal (real clock), identical at 0 decimals —
    # an int-rounding detector would misclassify this real crystal as drawn
    wobbly = [500.4 if i % 2 else 499.6 for i in range(100)]
    assert jf._device_axis_is_drawn(wobbly) is False
    # deltas alternating ±0.02 ms: identical at 1 decimal (sub-quantum) → drawn; a 2-decimal
    # detector would see them as distinct and let a drawn axis through
    subq = [500.02 if i % 2 else 499.98 for i in range(100)]
    assert jf._device_axis_is_drawn(subq) is True


def test_folded_base_finds_half_median_grid():
    # deltas alternating 300/900 (grid 300; median lands at 600): only m=2 recovers the true
    # base — dropping the m=2 candidate, or inverting med/m to med*m, returns 600
    deltas = [300.0 + 0.5 * (1 if i % 2 else -1) if i % 4 < 2 else 900.0 for i in range(40)]
    assert abs(jf._folded_base(deltas) - 300.0) < 5.0


def test_folded_base_floor_boundary():
    # a genuine 8.0 ms grid with doubled gaps: c=8.0 must still be SCORED (< 8, not <= 8) and
    # returned; the floor constant is exactly 8.0
    deltas = [8.0 if i % 2 else 24.0 for i in range(40)]
    assert jf._folded_base(deltas) == 8.0
    # grid 8.5: scored (a < 9 guard would break out before scoring it) and returned
    deltas = [8.5 if i % 2 else 25.5 for i in range(40)]
    assert abs(jf._folded_base(deltas) - 8.5) < 0.1


def test_min_frames_boundary(tmp_path):
    # exactly MIN_FRAMES rows is ENOUGH (the guard is <, not <=)
    _write_night(tmp_path, "h10", _real_clock_stream(n=jf.MIN_FRAMES))
    assert jf.night_floor(tmp_path)["floor"] is not None


def test_ns_to_ms_conversion_is_exact(tmp_path):
    # 1000-second frames make a 1-ppm error in the ns→ms constant visible in base_ms
    lines = []
    for i in range(110):
        host_s = i * 1000.0 + (0.003 if i % 2 else -0.003)
        wobble = (0.31, -0.17, 0.23, -0.29)[i % 4]
        lines.append(_row(_stamp_abs(i * 1000.0), "Polar H10 X", "ecg", int(i * 1e12 + wobble * 1e6)))
        del host_s
    _write_night(tmp_path, "h10", lines)
    f = jf.night_floor(tmp_path)["floor"]
    assert f is not None and abs(f["base_ms"] - 1000000.0) < 0.5  # a 1-ppm constant error shifts this by ~1.0


def _stamp_abs(sec):
    h = int(sec // 3600) % 24
    m = int((sec % 3600) // 60)
    s = sec % 60
    return "2026-08-21T%02d:%02d:%06.3f" % (h, m, s)


def test_cli_json_shape_is_pinned(tmp_path, capsys):
    _write_night(tmp_path, "h10", _real_clock_stream())
    assert jf.main([str(tmp_path), "--json"]) == 0
    out = capsys.readouterr().out
    lines = out.splitlines()
    # indent=1 exactly: nested keys start with a single space
    assert any(ln.startswith(' "') and not ln.startswith('  "') for ln in lines)
    # sort_keys: "floor" precedes "streams"
    assert out.index('"floor"') < out.index('"streams"')


def test_cli_help_prints_module_doc(capsys):
    jf.main(["--help"])
    assert "PMDARRIVAL" in capsys.readouterr().out


def test_cli_table_lists_every_stream(tmp_path, capsys):
    _write_night(tmp_path, "h10", _real_clock_stream())
    jf.main([str(tmp_path)])
    out = capsys.readouterr().out
    # the stream appears in its own table row AND in the floor line — a dropped table row
    # (or a broken row format) leaves only one occurrence
    assert out.count("Polar H10 X|ecg") == 2


def test_drawn_axis_missed_frames_fold_out():
    # the O2Ring reality: a drawn device axis stays CONTINUOUS (pure counter) while BLE drops
    # host frames — so host deltas mix 1× and 2× the base while device deltas stay constant.
    # The fold must remove the 2× gaps; a broken fold (sign flip, or dividing instead of
    # multiplying back) leaves a bimodal residual whose half-IQR is ~base/2, not the jitter.
    rows = []
    j = 0
    for i in range(240):
        if i % 3 == 2:
            continue  # host never saw this frame
        host_ms = i * 500.0 + (2.0 if i % 2 else -2.0)
        rows.append((host_ms, int(j * 0.5e9)))  # device counter advances per DELIVERED frame
        j += 1
    r = jf.stream_jitter(rows)
    assert r is not None and r["method"] == "folded" and r["device_axis_drawn"]
    assert r["jitter_ms"] < 10.0, r


def test_folded_base_m3_and_m4_grids():
    # 400/800 mix (median 600): only the m=3 candidate (200) folds both clusters to zero
    d38 = [400.0 + (0.5 if i % 2 else -0.5) if i % 4 < 2 else 800.0 for i in range(40)]
    assert abs(jf._folded_base(d38) - 200.0) < 1.0
    # 100/700 mix (median 400): only the m=4 candidate (100) folds both clusters to zero
    d47 = [100.0 if i % 2 else 700.0 for i in range(40)]
    assert jf._folded_base(d47) == 100.0


def test_folded_base_hysteresis_keeps_incumbent():
    # 30×100 + 10×150 (median 100): c=50 also scores exactly 0, TYING the incumbent — a tie
    # must keep the FIRST (largest) base (strict <, not <=), else the cascade walks to 25
    tie = [100.0] * 30 + [150.0] * 10
    assert jf._folded_base(tie) == 100.0
    # 20×100 + 20×150 (median 125): the smaller candidates score worse but within ~2× — a
    # loosened switch threshold (anything above 0.95) walks down to 31.25
    near = [100.0] * 20 + [150.0] * 20
    assert jf._folded_base(near) == 125.0
