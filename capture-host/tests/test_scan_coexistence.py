# tepna-capture — tests/test_scan_coexistence.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""§2's coexistence matrix — the analysis half, which is where a wrong verdict would be spent.

The `run` half needs a radio and is not unit-tested. Everything that turns arrivals into a PASS is
pure and is tested here, because the output of this tool is what the owner reads before setting
`scan_coexistence_verified` — a permission the code refuses to grant itself.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.scan_coexistence import (  # noqa: E402
    MIN_ARRIVALS_PER_POPULATION, parse_arrivals, split_by_window, verdict,
)

HDR = "Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n"


def _win(on_start, dur=100.0, cycles=1):
    """Interleaved off/on windows, back to back, as `run` writes them."""
    out, t = [], on_start
    for _ in range(cycles):
        out.append({"t_start": t, "t_end": t + dur, "state": "off"}); t += dur
        out.append({"t_start": t, "t_end": t + dur, "state": "on"}); t += dur
    return out


def _arrivals(windows, state, stream, hz, t0_offset=0.0):
    dev, meas = stream.split("/")
    out = []
    for w in windows:
        if w["state"] != state:
            continue
        t = w["t_start"] + t0_offset
        while t < w["t_end"]:
            out.append((t, dev, meas)); t += 1.0 / hz
    return out


def test_parse_arrivals_reads_the_semicolon_schema_and_drops_junk():
    """The file is SEMICOLON-delimited; a comma split matched nothing when this schema was first read
    by hand. A half-written last line is normal on a live night and must not raise."""
    text = (HDR
            + "2026-09-10T06:12:48.018;Wellue O2Ring-S;OXYLIVE_DURATION_S;0;0;1\n"
            + "2026-09-10T06:12:49.038;Polar H10;ECG;1;2;73\n"
            + "not a timestamp;Polar H10;ECG;0;0;1\n"
            + "2026-09-10T06:12:5\n")                       # truncated tail
    got = parse_arrivals(text)
    assert [g[1] for g in got] == ["Wellue O2Ring-S", "Polar H10"]
    assert got[1][2] == "ECG" and got[0][0] < got[1][0]


def test_an_undisturbed_scan_passes_both_bands():
    """The result the matrix is looking for: identical rates in both populations."""
    w = _win(1000.0, cycles=6)
    arr = _arrivals(w, "off", "Polar H10/ECG", 10.0) + _arrivals(w, "on", "Polar H10/ECG", 10.0)
    v = verdict(split_by_window(arr, w), w)
    assert v["overall"] == "PASS", v
    assert v["streams"][0]["delivery_ratio"] == 1.0


def test_LOST_PACKETS_WHILE_SCANNING_FAIL_THE_DELIVERY_BAND():
    """The failure §2 exists to catch: the scan costs the other radio its packets."""
    w = _win(1000.0, cycles=6)
    arr = _arrivals(w, "off", "Polar H10/ECG", 10.0) + _arrivals(w, "on", "Polar H10/ECG", 6.0)
    v = verdict(split_by_window(arr, w), w)
    assert v["overall"] == "FAIL"
    assert "delivery" in v["streams"][0]["why"]


def test_A_BURSTIER_DISTRIBUTION_FAILS_EVEN_WHEN_THE_COUNT_HOLDS():
    """🔴 THE ONE A MEAN WOULD HIDE. Same packets per second, arriving in clumps — PAT needs ~10 ms,
    so a stream that delivers everything in bursts is disturbed even though nothing was lost. If this
    test ever goes green while the tail ratio is large, the band has stopped measuring the thing."""
    w = _win(1000.0, cycles=6)
    arr = _arrivals(w, "off", "Polar H10/ECG", 10.0)
    for win in w:                                  # ON: same count, delivered as one burst per window
        if win["state"] != "on":
            continue
        n = int(10.0 * (win["t_end"] - win["t_start"]))
        arr += [(win["t_start"] + i * 0.001, "Polar H10", "ECG") for i in range(n)]
    v = verdict(split_by_window(arr, w), w)
    row = v["streams"][0]
    assert row["delivery_ratio"] >= 0.95, "the count is intact — that is the point of this case"
    assert v["overall"] == "FAIL" and "longest gap" in row["why"], row


def test_A_THIN_STREAM_IS_INCONCLUSIVE_NEVER_A_PASS():
    """∅ A stream the scan never had a chance to disturb has told us nothing. Reporting it as
    undisturbed is a matrix certifying a radio it did not test."""
    w = _win(1000.0, cycles=1)
    arr = [(1005.0 + i, "CPAP", "POLL") for i in range(5)] + [(1105.0 + i, "CPAP", "POLL") for i in range(5)]
    v = verdict(split_by_window(arr, w), w)
    assert v["streams"][0]["state"] == "INCONCLUSIVE"
    assert v["overall"] == "INCONCLUSIVE", "one inconclusive stream must not be reported as PASS"
    assert str(MIN_ARRIVALS_PER_POPULATION) in v["streams"][0]["why"]


def test_NO_ARRIVALS_AT_ALL_IS_INCONCLUSIVE_NOT_PASS():
    """The vacuous case, and the most dangerous one: a night where nothing was acquiring produces no
    disagreement between the populations, and an `all()` over an empty list is True."""
    w = _win(1000.0, cycles=2)
    v = verdict(split_by_window([], w), w)
    assert v["streams"] == [] and v["overall"] == "INCONCLUSIVE"


def test_arrivals_outside_every_window_are_not_counted():
    """The rest of the night is not a control — nobody was alternating anything during it."""
    w = _win(1000.0, cycles=1)
    arr = [(500.0, "Polar H10", "ECG"), (5000.0, "Polar H10", "ECG"), (1050.0, "Polar H10", "ECG")]
    pops = split_by_window(arr, w)
    assert pops["off"]["Polar H10/ECG"] == [1050.0] and "Polar H10/ECG" not in pops.get("on", {})


# ── the CLI + the scan loop (the halves that touch files and a radio) ────────────────────────────
def _write_case(tmp_path, on_hz, off_hz=10.0):
    import json
    tmp_path.mkdir(parents=True, exist_ok=True)
    w = _win(1000.0, cycles=6)
    wp = tmp_path / "w.jsonl"
    wp.write_text("\n".join(json.dumps(x) for x in w) + "\n")
    night = tmp_path / "night"; night.mkdir()
    arr = _arrivals(w, "off", "Polar H10/ECG", off_hz) + _arrivals(w, "on", "Polar H10/ECG", on_hz)
    import datetime as dt
    rows = "".join(f"{dt.datetime.fromtimestamp(t).isoformat()};{d};{m};0;0;1\n" for t, d, m in sorted(arr))
    (night / "x_PMDARRIVAL.csv").write_text(HDR + rows)
    return str(wp), str(night)


def test_the_cli_verdict_exits_0_on_pass_and_1_on_fail(tmp_path, capsys):
    """The exit code is what a box session reads — a FAIL that exits 0 would arm on a refusal."""
    from tools.scan_coexistence import main
    wp, night = _write_case(tmp_path / "ok", 10.0)
    assert main(["verdict", "--windows", wp, "--night", night]) == 0
    out = capsys.readouterr().out
    assert "OVERALL: PASS" in out
    assert "YOU set" in out, "a PASS must say the permission is the owner's, not the tool's"
    wp2, night2 = _write_case(tmp_path / "bad", 6.0)
    assert main(["verdict", "--windows", wp2, "--night", night2]) == 1


def test_THE_TOOL_NEVER_PRINTS_THE_CONFIG_KEY_AS_DONE(tmp_path, capsys):
    """🔴 The permission boundary, asserted. `scan_coexistence_verified` is the owner's to set; a tool
    that reported it as set — or offered to — would grant itself the authority the key withholds."""
    from tools.scan_coexistence import main
    wp, night = _write_case(tmp_path / "p", 10.0)
    main(["verdict", "--windows", wp, "--night", night])
    out = capsys.readouterr().out
    assert "scan_coexistence_verified" in out and "true" in out
    assert "this tool will not" in out


def test_the_scan_loop_alternates_windows_and_refuses_a_silent_radio(tmp_path, monkeypatch, capsys):
    """`run` with the radio stubbed: the window ledger must alternate off/on, and a run that saw ZERO
    advertisements must exit non-zero — a verdict from that file would certify a radio that never
    transmitted, which is the vacuous pass this whole tool exists to avoid."""
    import asyncio, json, sys, types
    from tools import scan_coexistence as sc

    class _Scanner:
        def __init__(self, **kw): self.cb = kw.get("detection_callback")
        async def start(self): pass
        async def stop(self): pass

    monkeypatch.setitem(sys.modules, "bleak", types.SimpleNamespace(BleakScanner=_Scanner))
    real_sleep = asyncio.sleep                      # capture BEFORE patching, or the lambda recurses
    monkeypatch.setattr(asyncio, "sleep", lambda *_a, **_k: real_sleep(0))
    out = tmp_path / "w.jsonl"
    rc = asyncio.run(sc._run("", 2, 0.0, str(out)))
    rows = [json.loads(ln) for ln in out.read_text().splitlines()]
    assert [r["state"] for r in rows] == ["off", "on", "off", "on"], "off first — the control leads"
    assert rc == 2 and "ZERO sightings" in capsys.readouterr().out


def test_a_population_too_small_to_have_a_gap_yields_no_rate():
    """∅ One arrival has no inter-arrival time and a zero-length window has no rate. Both return
    `(0.0, None)` rather than dividing — and `None` is what keeps the ratio out of the verdict."""
    from tools.scan_coexistence import _rate_and_gap
    assert _rate_and_gap([], 100.0) == (0.0, None)
    assert _rate_and_gap([5.0], 100.0) == (0.0, None)
    assert _rate_and_gap([1.0, 2.0], 0.0) == (0.0, None), "a zero-length window is not a rate"


def test_a_scan_that_SAW_something_exits_0_and_main_dispatches_run(tmp_path, monkeypatch):
    """The control for the silent-radio refusal: sightings present ⇒ rc 0. Also drives `main`'s `run`
    branch, so the CLI dispatch is exercised rather than assumed."""
    import asyncio, json, sys, types
    from tools import scan_coexistence as sc

    class _Dev:
        address = "AA:BB:CC:DD:EE:FF"

    class _Scanner:
        def __init__(self, **kw): self.cb = kw.get("detection_callback")
        async def start(self): self.cb(_Dev(), None)          # one sighting per ON window
        async def stop(self): pass

    monkeypatch.setitem(sys.modules, "bleak", types.SimpleNamespace(BleakScanner=_Scanner))
    real_sleep = asyncio.sleep
    monkeypatch.setattr(asyncio, "sleep", lambda *_a, **_k: real_sleep(0))
    out = tmp_path / "w2.jsonl"
    assert sc.main(["run", "--adapter", "hci9", "--cycles", "1", "--window", "0", "--out", str(out)]) == 0
    rows = [json.loads(ln) for ln in out.read_text().splitlines()]
    assert [r["sightings"] for r in rows] == [0, 1], "only the ON window sees anything"
    assert rows[1]["adapter"] == "hci9"
