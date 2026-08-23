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
    # every 5th frame missing: gaps of 2×base must fold out, not read as 500 ms of "jitter"
    lines = []
    for i in range(150):
        if i % 5 == 4:
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
    lines = _real_clock_stream(n=110)
    lines += [
        "not;enough;fields",
        "2026-08-21 21:00:00.000;Polar H10 X;ecg;1;2;3",  # space, not T — wrong format
        "2026-08-21T21:00:00.000;Polar H10 X;ecg;NOTANUMBER;2;3",
    ]
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
