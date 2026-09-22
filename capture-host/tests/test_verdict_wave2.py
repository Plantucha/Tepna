# tepna-capture — tests/test_verdict_wave2.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""VERDICT-CONTRACT wave 2 — seven capture-host producers emit `tepna.verdict/1` through `verdict.make`.

Every object each builder can produce is run through verdict.js (THE validator, #2797) via
`test_verdict.js_validate`, never through a hand-copied rule set. Each builder is PURE over the record
its tool already computed, so the statuses are driven here from synthetic records — no corpus, no
radio, no box — exactly as the `--verdict-sample` each producer exposes for `tools/verdict-adoption.mjs`.
"""

from __future__ import annotations

import importlib
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "tools"))

import ble_sniff  # noqa: E402
import o2ring  # noqa: E402
import parse_dat  # noqa: E402
import probe_oxyii_0x03 as oxy03  # noqa: E402
import probe_rtc_read as rtc  # noqa: E402
import ax210_postinstall as ax  # noqa: E402
from tools import scan_coexistence as sc  # noqa: E402
from test_verdict import js_validate  # noqa: E402


def ok(v, status):
    """Python-validated at build (verdict.make raises), JS-validated here, scope internal, the status named."""
    js = js_validate(v)
    assert js["ok"], js["errors"]
    assert v["status"] == status and v["scope"] == "internal" and v["schema"] == "tepna.verdict/1"
    return v


# ── ble_sniff ─────────────────────────────────────────────────────────────────────────────────────
def _sniff(total, crc_bad, data_channel, follow=None, fc=0, fa=0):
    return {
        "total": total,
        "crc_bad": crc_bad,
        "adv_channel": total - crc_bad - data_channel,
        "data_channel": data_channel,
        "follow": follow,
        "follow_connects": fc,
        "follow_adv_packets": fa,
    }


def test_ble_sniff_a_followed_link_is_PASS_and_crc_bad_records_are_the_excluded_population():
    v = ok(ble_sniff.verdict_object(_sniff(10, 3, 2), "x.pcap"), "PASS")
    assert v["population"] == {"checked": 7, "eligible": 10, "excluded": 3}
    assert v["result"]["data_channel"] == 2 and v["reason"] is None and "x.pcap" in v["evidence"]


def test_ble_sniff_no_data_channel_is_FAIL_with_the_prose_verdict_as_the_reason():
    v = ok(ble_sniff.verdict_object(_sniff(5, 0, 0, follow="AA:BB", fa=4)), "FAIL")
    assert "NO connection was followed" in v["reason"] and "advertised 4 time(s)" in v["reason"]


def test_ble_sniff_an_empty_capture_is_NOT_RUN_not_a_silent_ring():
    v = ok(ble_sniff.verdict_object(_sniff(0, 0, 0)), "NOT_RUN")
    assert v["result"] is None and v["population"]["eligible"] == 0


def test_ble_sniff_sample_and_cli(capsys):
    ok(ble_sniff.verdict_sample(), "PASS")
    assert ble_sniff.main(["--verdict-sample"]) == 0
    assert ok(json.loads(capsys.readouterr().out), "PASS")["gate"] == "ble-sniff-follow"


# ── parse_dat ─────────────────────────────────────────────────────────────────────────────────────
def _dat_samples(n, spo2=96):
    return [{"sec": i, "spo2": spo2, "pulse": 60, "motion": 0} for i in range(n)]


def test_parse_dat_both_bands_hold_is_PASS_and_the_count_agrees_with_self_consistency():
    s = _dat_samples(120)
    t = {"avg_spo2": 96, "total_seconds": 121}
    v = ok(parse_dat.consistency_verdict(s, t, "a.dat"), "PASS")
    assert v["result"]["bands_violated"] == 0 and parse_dat.self_consistency(s, t)[0]
    assert v["population"] == {"checked": 120, "eligible": 120, "excluded": 0}


def test_parse_dat_a_violated_band_is_FAIL_and_none_spo2_is_excluded():
    s = _dat_samples(100) + [{"sec": 100, "spo2": None, "pulse": 60, "motion": 0}]
    t = {"avg_spo2": 90, "total_seconds": 101}  # mean 96 vs 90: the SpO₂ band fails, the count band holds
    v = ok(parse_dat.consistency_verdict(s, t), "FAIL")
    assert v["result"]["bands_violated"] == 1 and not parse_dat.self_consistency(s, t)[0]
    assert v["population"] == {"checked": 100, "eligible": 101, "excluded": 1}
    assert "want <=1" in v["reason"]


def test_parse_dat_no_valid_spo2_counts_the_mean_band_as_violated_like_self_consistency_does():
    s = [{"sec": 0, "spo2": None, "pulse": 60, "motion": 0}]
    v = ok(parse_dat.consistency_verdict(s, {"avg_spo2": 95, "total_seconds": 1}), "FAIL")
    assert v["result"]["spo2_mean"] is None and v["result"]["bands_violated"] == 1


def test_parse_dat_both_bands_violated_counts_two():
    v = ok(parse_dat.consistency_verdict(_dat_samples(10, 80), {"avg_spo2": 95, "total_seconds": 100}), "FAIL")
    assert v["result"]["bands_violated"] == 2


def test_parse_dat_no_trailer_is_NOT_RUN():
    v = ok(parse_dat.consistency_verdict(_dat_samples(3), None, "b.dat"), "NOT_RUN")
    assert v["result"] is None and "no valid 48-byte trailer" in v["reason"]


def test_parse_dat_sample_and_cli(monkeypatch, capsys):
    ok(parse_dat.verdict_sample(), "PASS")
    monkeypatch.setattr(sys, "argv", ["parse_dat.py", "--verdict-sample"])
    with pytest.raises(SystemExit) as e:
        parse_dat.main()
    assert e.value.code == 0
    assert ok(json.loads(capsys.readouterr().out), "PASS")["gate"] == "parse-dat-self-consistency"


# ── o2ring ────────────────────────────────────────────────────────────────────────────────────────
def test_o2ring_selftest_vectors_reproduce_and_the_verdict_is_PASS_over_all_three():
    checks = o2ring.selftest_checks()
    assert [c["ok"] for c in checks] == [True, True, True]
    v = ok(o2ring.selftest_verdict(checks), "PASS")
    assert v["population"] == {"checked": 3, "eligible": 3, "excluded": 0} and v["result"]["mismatched"] == 0


def test_o2ring_a_mismatched_vector_is_FAIL_naming_it():
    checks = o2ring.selftest_checks()
    checks[1]["ok"] = False
    v = ok(o2ring.selftest_verdict(checks), "FAIL")
    assert "a5-variant" in v["reason"] and v["result"]["mismatched"] == 1


def test_o2ring_cli_sample_needs_no_device(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["o2ring.py", "--verdict-sample"])
    monkeypatch.setattr(o2ring, "open_device", lambda: (_ for _ in ()).throw(AssertionError("opened a device")))
    o2ring.main()
    assert ok(json.loads(capsys.readouterr().out), "PASS")["gate"] == "o2ring-selftest"


# ── probe_oxyii_0x03 ──────────────────────────────────────────────────────────────────────────────
def _replies(counts, dt=0.2):
    return [{"t": i * dt, "count": c, "markers": 0, "isolated": 0} for i, c in enumerate(counts)]


def test_oxy03_a_rate_within_2pct_of_one_candidate_is_PASS_naming_it_in_the_result():
    v = ok(oxy03.verdict_object(oxy03.summarise(_replies([25] * 51))), "PASS")
    assert v["result"]["matched_hz"] == [125.0] and v["criterion"]["threshold"] == 0.02
    assert v["population"] == {"checked": 51, "eligible": 51, "excluded": 0}


def test_oxy03_neither_candidate_is_FAIL_a_third_answer():
    v = ok(oxy03.verdict_object(oxy03.summarise(_replies([20] * 51))), "FAIL")  # 100 Hz
    assert v["result"]["matched_hz"] == [] and "third answer" in v["reason"]


def test_oxy03_every_pair_saturated_is_UNDERPOWERED_with_the_counts_as_numbers():
    v = ok(oxy03.verdict_object(oxy03.summarise(_replies([250] * 5))), "UNDERPOWERED")
    assert "0 unsaturated reply pairs, minimum 1" in v["reason"] and v["result"]["rate_unsaturated_hz"] is None


def test_oxy03_no_records_is_UNKNOWN_and_empty_replies_are_excluded():
    v = ok(oxy03.verdict_object(oxy03.summarise(_replies([0, 0, 0]))), "UNKNOWN")
    assert v["population"] == {"checked": 0, "eligible": 3, "excluded": 3} and "indistinguishable" in v["reason"]


def test_oxy03_sample_cli_and_the_json_log_carries_the_object(monkeypatch, capsys, tmp_path):
    ok(oxy03.verdict_sample(), "PASS")
    assert oxy03.main(["--verdict-sample"]) == 0
    assert ok(json.loads(capsys.readouterr().out), "PASS")["gate"] == "oxyii-0x03-record-rate"

    async def fake_run(addr, seconds, hz, arg):
        return {"summary": oxy03.summarise(_replies([25] * 51)), "samples": [], "beats": []}

    monkeypatch.setattr(oxy03, "run", fake_run)
    log = tmp_path / "log.json"
    assert oxy03.main(["--json", str(log)]) == 0
    assert ok(json.load(open(log))["verdict"], "PASS")["gate"] == "oxyii-0x03-record-rate"


def test_oxy03_without_bleak_the_pure_halves_import_and_a_real_run_refuses_by_name(monkeypatch):
    monkeypatch.setitem(sys.modules, "bleak", None)  # `import bleak` now raises ImportError
    mod = importlib.reload(oxy03)
    try:
        assert mod.BleakScanner is None
        ok(mod.verdict_sample(), "PASS")
        with pytest.raises(SystemExit, match="bleak is not installed"):
            mod.main([])
    finally:
        monkeypatch.delitem(sys.modules, "bleak")
        importlib.reload(oxy03)
    assert oxy03.BleakScanner is not None


# ── probe_rtc_read ────────────────────────────────────────────────────────────────────────────────
def _u32_at(v, n=60, at=4):
    b = bytearray(n)
    b[at : at + 4] = v.to_bytes(4, "little")
    return bytes(b)


def test_rtc_classify_covers_the_four_outcomes_from_the_same_rule_diff_prints():
    assert rtc.classify(None, bytes(4), 10.0) == "unreadable"
    assert rtc.classify(bytes(4), None, 10.0) == "unreadable"
    assert rtc.classify(bytes(8), bytes(8), 10.0) == "identical"
    assert rtc.classify(_u32_at(1000), _u32_at(1010), 10.0) == "candidate"
    assert rtc.classify(_u32_at(1000), _u32_at(5000), 10.0) == "changed"  # moved, but not by the gap
    assert rtc.clock_candidates(_u32_at(1000), _u32_at(1010), 10.0)[0][1:] == (4, 1000, 1010, 10)


def test_rtc_a_candidate_is_PASS_unreadable_is_excluded():
    v = ok(
        rtc.verdict_object({"GET_INFO": "candidate", "GET_CONFIG": "identical", "GET_BATTERY": "unreadable"}, 10.0),
        "PASS",
    )
    assert v["population"] == {"checked": 2, "eligible": 3, "excluded": 1} and v["result"]["candidates"] == ["GET_INFO"]


def test_rtc_all_identical_is_FAIL_the_no_rtc_verdict():
    v = ok(rtc.verdict_object({"GET_INFO": "identical", "GET_CONFIG": "identical"}, 10.0), "FAIL")
    assert "no read opcode carries the RTC" in v["reason"]


def test_rtc_bytes_moved_without_tracking_the_gap_is_UNKNOWN():
    v = ok(rtc.verdict_object({"GET_INFO": "changed", "GET_CONFIG": "identical"}, 10.0), "UNKNOWN")
    assert "GET_INFO" in v["reason"]


def test_rtc_nothing_readable_on_both_sides_is_NOT_RUN():
    v = ok(rtc.verdict_object({"GET_INFO": "unreadable"}, 10.0), "NOT_RUN")
    assert v["result"] is None and v["population"] == {"checked": 0, "eligible": 1, "excluded": 1}


def test_rtc_sample_and_the_import_fallback_without_bleak(monkeypatch):
    ok(rtc.verdict_sample(), "PASS")
    monkeypatch.setitem(sys.modules, "bleak", None)
    mod = importlib.reload(rtc)
    try:
        assert mod.BleakClient is None
        ok(mod.verdict_sample(), "PASS")
    finally:
        monkeypatch.delitem(sys.modules, "bleak")
        importlib.reload(rtc)
    assert rtc.BleakClient is not None


# ── tools/ax210_postinstall ───────────────────────────────────────────────────────────────────────
def _assessment(*states):
    return {
        "ok": all(s == ax.OK for s in states),
        "checks": [{"name": f"c{i}", "state": s, "detail": f"d{i}"} for i, s in enumerate(states)],
    }


def test_ax210_all_ok_is_PASS():
    v = ok(ax.verdict_object(_assessment(ax.OK, ax.OK, ax.OK)), "PASS")
    assert v["population"] == {"checked": 3, "eligible": 3, "excluded": 0} and v["result"]["states"] == {
        "c0": "ok",
        "c1": "ok",
        "c2": "ok",
    }


def test_ax210_a_failed_check_is_FAIL_naming_it_even_beside_an_unknown():
    v = ok(ax.verdict_object(_assessment(ax.OK, ax.FAIL, ax.UNKNOWN)), "FAIL")
    assert v["reason"] == "c1: d1" and v["population"] == {"checked": 2, "eligible": 3, "excluded": 1}


def test_ax210_an_unknown_check_with_no_failure_is_UNKNOWN_never_folded_into_a_pass():
    v = ok(ax.verdict_object(_assessment(ax.OK, ax.UNKNOWN)), "UNKNOWN")
    assert v["reason"] == "c1: d1" and v["result"]["unknown"] == 1


def test_ax210_sample_is_a_PASS_over_synthetic_probe_text():
    v = ok(ax.verdict_sample(), "PASS")
    assert v["gate"] == "ax210-postinstall" and v["population"]["eligible"] == 5


# ── tools/scan_coexistence ────────────────────────────────────────────────────────────────────────
def _pops(on_n, off_n, *, on_dt=0.4, off_dt=0.4, stream="H10/ECG"):
    return {"off": {stream: [i * off_dt for i in range(off_n)]}, "on": {stream: [100 + i * on_dt for i in range(on_n)]}}


WINDOWS = [{"t_start": 0.0, "t_end": 100.0, "state": "off"}, {"t_start": 100.0, "t_end": 200.0, "state": "on"}]


def test_scan_coexistence_within_both_bands_is_PASS_with_the_bands_in_the_result():
    v = ok(sc.verdict_object(sc.verdict(_pops(250, 250), WINDOWS), "night-1"), "PASS")
    assert v["result"]["bands"]["min_delivery_ratio"] == sc.MIN_DELIVERY_RATIO
    assert v["population"] == {"checked": 1, "eligible": 1, "excluded": 0} and "night-1" in v["evidence"]


def test_scan_coexistence_a_stream_outside_a_band_is_FAIL_naming_it():
    v = ok(sc.verdict_object(sc.verdict(_pops(200, 250), WINDOWS)), "FAIL")  # delivery 0.8 < 0.95
    assert "H10/ECG: delivery" in v["reason"] and v["result"]["outside_bands"] == 1


def test_scan_coexistence_an_inconclusive_stream_is_UNDERPOWERED_with_the_minimum_and_counts():
    pops = _pops(250, 250)
    pops["on"]["VS/PPG"] = [100 + i for i in range(10)]
    pops["off"]["VS/PPG"] = [i for i in range(10)]
    v = ok(sc.verdict_object(sc.verdict(pops, WINDOWS)), "UNDERPOWERED")
    assert "1 of 2 stream(s) had fewer than 200" in v["reason"] and "VS/PPG on=10 off=10" in v["reason"]
    assert v["population"] == {"checked": 1, "eligible": 2, "excluded": 1}


def test_scan_coexistence_no_stream_at_all_is_NOT_RUN():
    v = ok(sc.verdict_object(sc.verdict({"on": {}, "off": {}}, WINDOWS)), "NOT_RUN")
    assert v["result"] is None


def test_scan_coexistence_sample_and_cli(capsys):
    ok(sc.verdict_sample(), "PASS")
    assert sc.main(["--verdict-sample"]) == 0
    assert ok(json.loads(capsys.readouterr().out), "PASS")["gate"] == "scan-coexistence"


# ── the adoption manifest names each producer's sample, and every sample validates ────────────────
def test_every_wave2_row_is_adopted_with_a_corpus_free_cmd_that_validates():
    m = json.load(open(os.path.join(os.path.dirname(HERE), "tools", "verdict-adoption.json")))
    rows = {
        k: m["producers"][k]
        for k in (
            "capture-host/ble_sniff.py",
            "capture-host/o2ring.py",
            "capture-host/parse_dat.py",
            "capture-host/probe_oxyii_0x03.py",
            "capture-host/probe_rtc_read.py",
            "capture-host/tools/ax210_postinstall.py",
            "capture-host/tools/scan_coexistence.py",
            "capture-host/unseal.py",
        )
    }
    for path, r in rows.items():
        assert r["status"] == "adopted", path
        assert "cmd" in r["emits"] or "file" in r["emits"], path
        if "cmd" in r["emits"]:
            assert r["emits"]["cmd"][-1] == "--verdict-sample" and r["emits"]["cmd"][1] == path, path
