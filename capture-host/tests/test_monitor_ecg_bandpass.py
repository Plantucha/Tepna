# tepna-capture — tests/test_monitor_ecg_bandpass.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The live strip's R-peak detector runs on a 5–15 Hz bandpassed copy of the buffer
(VIGIL-DEEP-ANALYSIS §1.2, residue 2026-09-02-box-detector-lacks-bandpass).

On the RAW buffer, a baseline wander of a few R amplitudes over the 5–7 s window puts every sample
beyond 5·MAD of the median and `detectRs` returns NO beats — honest, but a dash for a signal that
carried every beat. EXECUTES the shipped JavaScript under node, and proves the mechanism by running the
same detector with the bandpass stubbed to identity: the plant must FAIL without the filter.

Validated on real H10 nights against the device's own RR stream, per 7 s window (2026-09-21, rig):
09-13 (3457 windows) within-3-bpm 3168 → 3257, p90 |err| 2.55 → 2.14 bpm, 13 dash windows recovered,
6 "lost" — all six in one 40 s strap-handling artefact (raw range ~30 mV) where main read 150–173 bpm
off noise; 09-19 (568 windows) 563 → 568 read, median |err| 1.13 → 1.03 bpm, none lost."""

import json
import os
import re
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = os.path.join(HERE, "monitor.html")
FS = 130


def _extract():
    src = open(MON, encoding="utf-8").read()
    bp = re.search(r"^function bandpassIIR\(s,fs,lo=5,hi=15\)\{.*?\n\}$", src, re.M | re.S)
    rs = re.search(r"^function detectRs\(s,fs\)\{.*?\n\}$", src, re.M | re.S)
    assert bp and rs, "bandpassIIR/detectRs are gone or reshaped — this test is stale"
    assert "const f=bandpassIIR(s,fs);" in rs.group(0), "detectRs no longer detects on the bandpassed copy"
    return bp.group(0) + "\n" + rs.group(0)


def _run(js, calls):
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    prog = js + "\nconst OUT = [];\n" + "\n".join(calls) + "\nconsole.log(JSON.stringify(OUT));\n"
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _ecg(seconds=7.0, bpm=60, r_amp=1000.0, wander_amp=0.0, wander_hz=0.2, t_rel=0.15, r_scale=None):
    """A toy ECG at FS in µV: a 40 ms triangular R every 60/bpm s (+ a small T hump), on a slow sine
    wander, over a deterministic ~15 µV noise floor (a real H10 sits at 10–30 µV; an exactly-zero floor
    would trip the detector's own `mad<1` presence gate and test nothing). Returns (samples, planted R indices)."""
    import math

    n = int(seconds * FS)
    x = 12345
    s = []
    for _ in range(n):  # LCG noise, uniform in ±26 µV → σ ≈ 15 µV, same sequence every run
        x = (1103515245 * x + 12345) % 2**31
        s.append((x / 2**31 - 0.5) * 52.0)
    rs = []
    period = int(round(FS * 60.0 / bpm))
    for r in range(period // 2, n, period):
        amp = r_amp * (r_scale(len(rs)) if r_scale else 1.0)
        rs.append(r)
        for k in range(-3, 4):
            if 0 <= r + k < n:
                s[r + k] += amp * (1 - abs(k) / 3.5)
        for k in range(20, 45):  # T wave: low, wide, ~150–350 ms after R
            if r + k < n:
                s[r + k] += t_rel * amp * math.sin(math.pi * (k - 20) / 25)
    for i in range(n):
        s[i] += wander_amp * math.sin(2 * math.pi * wander_hz * i / FS)
    return s, rs


def test_the_plant_wander_hides_every_beat_from_the_raw_detector_and_the_bandpass_recovers_them():
    js = _extract()
    sig, planted = _ecg(wander_amp=4000.0)
    stub = "const _bp = bandpassIIR; bandpassIIR = (s) => s;"  # the same detector with the filter removed
    out = _run(js, [
        f"const S = {json.dumps(sig)};",
        "OUT.push(detectRs(S, %d));" % FS,
        stub,
        "OUT.push(detectRs(S, %d));" % FS,
    ])
    with_filter, without = out
    assert without == [], f"the plant was not seen: the raw detector found {len(without)} beats under wander"
    assert len(with_filter) == len(planted), (with_filter, planted)
    assert all(abs(a - b) <= 3 for a, b in zip(with_filter, planted)), (with_filter, planted)


def test_clean_ecg_indices_point_at_the_raw_r_peaks():
    js = _extract()
    sig, planted = _ecg()
    (got,) = _run(js, [f"OUT.push(detectRs({json.dumps(sig)}, {FS}));"])
    assert got == planted, (got, planted)  # refined to the raw extremum, so the filter's group delay is gone


def test_flat_and_low_rate_inputs():
    js = _extract()
    flat = [500.0] * (7 * FS)
    sig, planted = _ecg()
    flat_out, low_pass, low_beats = _run(js, [
        f"OUT.push(detectRs({json.dumps(flat)}, {FS}));",
        # below 4·hi the band would sit against Nyquist: the signal must pass through unfiltered (same object)
        f"{{ const S={json.dumps(sig[:40])}; OUT.push(bandpassIIR(S, 50) === S); }}",
        f"OUT.push(detectRs({json.dumps(sig)}, 50).length);",
    ])
    assert flat_out == []
    assert low_pass is True
    assert low_beats >= 1  # the unfiltered path still detects on a clean signal


def test_spikes_and_a_beatless_floor_keep_the_raw_detector_s_validated_behaviour():
    """The raw detector was validated live: clean / 1-spike / 5-spike all track the same HR, and a flat
    or noise-only buffer gives an honest dash. The bandpassed one must keep both: every planted R still
    found with the spikes present (a spike may add itself as at most one extra candidate each — the HR is
    a median IBI, so that is harmless), and pure noise finds nothing."""
    js = _extract()
    sig, planted = _ecg()
    one = list(sig)
    one[400] += 12000.0  # a 12× electrode spike between beats
    five = list(sig)
    for k in (150, 400, 520, 660, 800):
        five[k] += 12000.0
    noise, _ = _ecg(r_amp=0.0)
    got1, got5, got0 = _run(js, [
        f"OUT.push(detectRs({json.dumps(one)}, {FS}));",
        f"OUT.push(detectRs({json.dumps(five)}, {FS}));",
        f"OUT.push(detectRs({json.dumps(noise)}, {FS}));",
    ])
    for got, spikes in ((got1, 1), (got5, 5)):
        assert all(any(abs(g - p) <= 3 for g in got) for p in planted), (got, planted)
        assert len(got) <= len(planted) + spikes, (got, planted)
    assert got0 == [], got0


def _without_t_rule(js):
    assert "tRel=0.6" in js, "the T-after-R rule is gone or renamed — this test is stale"
    return js.replace("tRel=0.6", "tRel=0")  # the same detector with the rule disabled


def test_a_tall_t_wave_is_not_a_second_beat():
    """2026-09-24, live: the owner's H10 T wave sat at 38–46 % of R, cleared the 35 %-of-median cut, and the
    tile read 167 bpm against 53–55 on the H10's own HR. Planted at 70 % of R in the RAW trace: the 5–15 Hz
    bandpass shrinks this wide T far more than the sharp R, which leaves it inside the band the rule
    separates. With the rule disabled the same detector must double-count, or this plant proves nothing.
    (A T as tall as R even after filtering cannot be told from a beat by amplitude, and this does not try.)"""
    js = _extract()
    sig, planted = _ecg(t_rel=0.7)
    (fixed,) = _run(js, [f"OUT.push(detectRs({json.dumps(sig)}, {FS}));"])
    (unfixed,) = _run(_without_t_rule(js), [f"OUT.push(detectRs({json.dumps(sig)}, {FS}));"])
    assert len(unfixed) >= 2 * len(planted) - 1, f"the plant was not seen: {len(unfixed)} beats for {len(planted)} R's"
    assert fixed == planted, (fixed, planted)


def test_a_fast_rhythm_keeps_every_beat():
    """150 bpm puts the next R 400 ms after the last one, inside the 450 ms T window. It is R-sized, so it
    stays: the rule rejects only what is BOTH close AND small."""
    js = _extract()
    sig, planted = _ecg(bpm=150, t_rel=0.15)
    (got,) = _run(js, [f"OUT.push(detectRs({json.dumps(sig)}, {FS}));"])
    assert got == planted, (got, planted)


def test_r_amplitude_swinging_twenty_percent_beat_to_beat_keeps_every_beat():
    """Respiration swings R amplitude beat to beat. A 0.8 R right after a 1.0 R is a beat, not a T wave."""
    js = _extract()
    sig, planted = _ecg(bpm=100, t_rel=0.15, r_scale=lambda i: 1.0 if i % 2 == 0 else 0.8)
    (got,) = _run(js, [f"OUT.push(detectRs({json.dumps(sig)}, {FS}));"])
    assert got == planted, (got, planted)
