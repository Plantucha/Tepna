# tepna-capture — tests/test_adapter_hci.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`adapter_hci` — the pre-stated rule over the per-poll rows, the sidecar's honesty about absence, the
watchdog writing a row per radio every poll (report only), and the nightly `adapter-hci` verdict beside
the other two. Every object through verdict.js."""

from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import adapter_hci as H  # noqa: E402
import capture  # noqa: E402
import nightqc  # noqa: E402
from test_capture_runners import _dev, _run, _stop_after  # noqa: E402
from test_verdict import js_validate  # noqa: E402

T0 = 1_700_000_000_000
PIN = "00:01:95:CC:53:02"
OTHER = "28:0C:50:0C:18:FD"


def ok(v, status):
    r = js_validate(v)
    assert r["ok"], r["errors"]
    assert v["status"] == status and v["gate"] == "adapter-hci" and v["scope"] == "internal"
    return v


def _rows(flags, mac=PIN, hci="hci0", pinned=True, up=True):
    return [H.parse_row(H.row(T0 + i * 60_000, hci, mac, pinned, up, f, 10)) for i, f in enumerate(flags)]


# ── the row format: absence is empty, never 0 ─────────────────────────────────────────────────────
def test_row_writes_tri_state_as_empty_for_none_and_round_trips():
    r = H.row(T0 + 0.7, "hci1", "aa:bb:cc:dd:ee:ff", False, None, False, 12.9)
    assert r == f"{T0};hci1;AA:BB:CC:DD:EE:FF;0;;0;12"
    back = H.parse_row(r)
    assert back == {"probed_ms": T0, "hci": "hci1", "mac": "AA:BB:CC:DD:EE:FF", "pinned": False, "up": None, "responds": False, "probe_ms": 12}
    assert H.parse_row(H.HEADER) is None and H.parse_row("") is None and H.parse_row("x;y") is None
    assert H.parse_row("abc;hci0;M;1;1;1;1") is None, "a torn line is None, not a crash"


def test_append_rows_writes_the_header_once_and_never_raises(tmp_path, caplog):
    assert H.append_rows(str(tmp_path), [H.row(T0, "hci0", PIN, True, True, True, 1)]) is True
    assert H.append_rows(str(tmp_path), [H.row(T0 + 1, "hci0", PIN, True, True, True, 1)]) is True
    lines = (tmp_path / H.FILE_NAME).read_text().splitlines()
    assert lines[0] == H.HEADER and len(lines) == 3
    assert H.append_rows("", [H.row(T0, "hci0", PIN, True, True, True, 1)]) is False, "no root, no journal"
    assert H.append_rows(str(tmp_path), []) is False
    import logging
    with caplog.at_level("WARNING"):
        assert H.append_rows(str(tmp_path / "missing" / "dir"), [H.row(T0, "hci0", PIN, True, True, True, 1)], log=logging.getLogger("t")) is False
    assert any("could not append" in r.getMessage() for r in caplog.records)
    assert H.append_rows(str(tmp_path / "missing" / "dir"), [H.row(T0, "hci0", PIN, True, True, True, 1)]) is False, "no logger: still no raise"


def test_read_rows_filters_to_the_window_and_is_empty_when_the_file_is_absent(tmp_path):
    assert H.read_rows(str(tmp_path), 0, 10**15) == []
    H.append_rows(str(tmp_path), [H.row(T0 + i * 60_000, "hci0", PIN, True, True, True, 1) for i in range(5)] + ["torn;line"])
    got = H.read_rows(str(tmp_path), T0 + 60_000, T0 + 180_000)
    assert [r["probed_ms"] for r in got] == [T0 + 60_000, T0 + 120_000, T0 + 180_000]


# ── the pre-stated rule ───────────────────────────────────────────────────────────────────────────
def test_runs_counts_the_longest_false_run_and_isolated_misses_skipping_none():
    assert H._runs([True, True, True]) == (0, 0, 0)
    assert H._runs([True, False, True]) == (1, 1, 1)
    assert H._runs([False, False, True, False]) == (2, 1, 3)
    assert H._runs([True, False, None, False, True]) == (2, 0, 2), "None neither extends nor breaks a run"
    assert H._runs([None, None]) == (0, 0, 0)
    assert H._runs([True, False]) == (1, 1, 1), "a trailing single miss is isolated"


def test_every_probe_answered_is_PASS_over_every_radio():
    v = ok(H.verdict_object(_rows([True] * 5) + _rows([True] * 5, mac=OTHER, hci="hci1", pinned=False), night="2026-09-22"), "PASS")
    assert v["population"] == {"checked": 2, "eligible": 2, "excluded": 0}
    assert v["result"]["radios"][PIN]["pinned"] is True and v["result"]["radios"][OTHER]["unanswered"] == 0
    assert "2026-09-22" in v["evidence"]


def test_two_consecutive_unanswered_polls_is_FAIL_naming_the_radio_the_run_and_the_times():
    rows = _rows([True, False, False, True]) + _rows([True] * 4, mac=OTHER, hci="hci1", pinned=False)
    v = ok(H.verdict_object(rows), "FAIL")
    assert "hci0 00:01:95:CC:53:02 (pinned): 2 of 4 polls unanswered, longest run 2" in v["reason"]
    assert f"first at {T0 + 60_000} ms, last at {T0 + 120_000} ms" in v["reason"]
    assert v["result"]["radios"][PIN]["longest_run"] == 2 and OTHER not in v["reason"]


def test_an_isolated_miss_is_SHORTFALL_not_a_conviction():
    v = ok(H.verdict_object(_rows([True, False, True, True])), "SHORTFALL")
    assert "1 isolated unanswered poll(s) of 4" in v["reason"]


def test_a_FAIL_outranks_a_SHORTFALL_on_another_radio():
    rows = _rows([False, False, True]) + _rows([True, False, True], mac=OTHER, hci="hci1", pinned=False)
    v = ok(H.verdict_object(rows), "FAIL")
    assert OTHER not in v["reason"] and v["result"]["radios"][OTHER]["isolated_misses"] == 1


def test_a_radio_whose_every_probe_was_undeterminable_is_excluded_and_all_such_is_UNKNOWN():
    rows = _rows([True, True]) + _rows([None, None], mac=OTHER, hci="hci1", pinned=False)
    v = ok(H.verdict_object(rows), "PASS")
    assert v["population"] == {"checked": 1, "eligible": 2, "excluded": 1}
    v = ok(H.verdict_object(_rows([None, None, None])), "UNKNOWN")
    assert "no probe was determinable" in v["reason"] and v["population"] == {"checked": 0, "eligible": 1, "excluded": 1}


def test_no_rows_is_NOT_RUN_never_PASS():
    v = ok(H.verdict_object([]), "NOT_RUN")
    assert v["result"] is None and H.FILE_NAME in v["reason"]


def test_sample_is_the_shortfall_shape_and_the_cli_prints_it(capsys):
    ok(H.verdict_sample(), "SHORTFALL")
    import subprocess
    r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "adapter_hci.py"), "--verdict-sample"],
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 0 and ok(json.loads(r.stdout), "SHORTFALL")["gate"] == "adapter-hci"


# ── nightqc: the third object, from the night's session window ────────────────────────────────────
def _night(tmp_path):
    root = tmp_path / "root"
    night = root / "captures" / "2026-09-22"
    night.mkdir(parents=True)
    return root, night


def test_nightqc_reads_the_rows_inside_the_session_window_only(tmp_path):
    root, night = _night(tmp_path)
    H.append_rows(str(root), [H.row(T0 + i * 60_000, "hci0", PIN, True, True, i not in (3, 4), 1) for i in range(10)])
    inside = {"sessions": [{"start": T0 // 1000, "end": T0 // 1000 + 9 * 60}]}
    v = ok(nightqc.adapter_hci_verdict(str(night), inside), "FAIL")
    assert v["result"]["polls"] == 10 and v["evidence"][2] == "2026-09-22"
    before = {"sessions": [{"start": T0 // 1000 - 3600, "end": T0 // 1000 - 60}]}
    assert ok(nightqc.adapter_hci_verdict(str(night), before), "NOT_RUN")["result"] is None
    assert ok(nightqc.adapter_hci_verdict(str(night), {"sessions": []}), "NOT_RUN")
    assert ok(nightqc.adapter_hci_verdict(str(night), {}), "NOT_RUN")


def test_nightqc_a_malformed_session_is_UNKNOWN_never_a_verdict(tmp_path):
    root, night = _night(tmp_path)
    v = ok(nightqc.adapter_hci_verdict(str(night), {"sessions": [{"start": "x", "end": 1}]}), "UNKNOWN")
    assert "ValueError" in v["reason"]


# ── the watchdog: a row per radio every poll, pinned verdict reused, report only ──────────────────
def _watchdog_rig(monkeypatch, tmp_path, *, other_responds=False):
    probed: list[str] = []

    async def hci():
        return "hci0"

    async def is_up(_h):
        return True

    async def responds(h):
        probed.append(h)
        return other_responds

    async def adapters():
        return [{"hci": "hci0", "mac": PIN, "up": True}, {"hci": "hci1", "mac": OTHER, "up": True}, {"hci": "", "mac": "", "up": True}]

    monkeypatch.setattr(capture, "adapter_hci", hci)
    monkeypatch.setattr(capture, "_adapter_is_up", is_up)
    monkeypatch.setattr(capture, "_adapter_responds", responds)
    monkeypatch.setattr(capture, "list_adapters", adapters)
    cfg = {"root": str(tmp_path), "watchdog": {"enabled": True, "interval_sec": 1, "grace_checks": 5, "max_adapter_cycles": 1,
                                             "recover_checks": 1, "deaf_scan_sec": 0}, "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": True, "address": "24:AC:AC:02:84:96", "last_error": None}
    cfg["_probed"] = probed
    return cfg


def test_the_recorder_writes_one_row_per_radio_reusing_the_pinned_verdict_and_publishes_status(tmp_path, monkeypatch, caplog):
    cfg = _watchdog_rig(monkeypatch, tmp_path)
    with caplog.at_level("WARNING"):
        rows = _run(capture._record_adapter_hci(cfg, "hci0", True, True))
    assert [(r["hci"], r["mac"], r["pinned"], r["responds"]) for r in rows] == [("hci0", PIN, True, True), ("hci1", OTHER, False, False)]
    lines = (tmp_path / H.FILE_NAME).read_text().splitlines()
    assert lines[0] == H.HEADER and len(lines) == 3 and lines[1].split(";")[1:4] == ["hci0", PIN, "1"]
    assert capture.STATUS["adapter_hci"][OTHER] == {"hci": "hci1", "pinned": False, "up": True, "responds": False}
    assert any("REPORTED, not reset" in r.getMessage() and "hci1" in r.getMessage() for r in caplog.records)
    assert cfg["_probed"] == ["hci1"], "the pinned radio's round trip is taken once by the watchdog, not again by the recorder"


def test_a_failed_enumeration_still_writes_the_pinned_radio_s_measured_row(tmp_path, monkeypatch):
    cfg = _watchdog_rig(monkeypatch, tmp_path)

    async def boom():
        raise RuntimeError("hciconfig exploded")

    monkeypatch.setattr(capture, "list_adapters", boom)
    monkeypatch.setattr(capture, "ADAPTER", PIN)
    rows = _run(capture._record_adapter_hci(cfg, "hci0", False, False))
    assert rows == [{"probed_ms": rows[0]["probed_ms"], "hci": "hci0", "mac": PIN, "pinned": True, "up": False, "responds": False, "probe_ms": 0.0}]
    assert (tmp_path / H.FILE_NAME).read_text().count("\n") == 2


def test_no_pinned_radio_and_no_root_records_nothing_and_raises_nothing(tmp_path, monkeypatch):
    cfg = _watchdog_rig(monkeypatch, tmp_path)
    cfg["root"] = ""
    rows = _run(capture._record_adapter_hci(cfg, None, False, None))
    assert [r["mac"] for r in rows] == [PIN, OTHER] and not (tmp_path / H.FILE_NAME).exists()


@pytest.mark.sets_capture_events   # `_stop_after` sets _STOP as the scenario's end; the fixture resets it
def test_the_watchdog_calls_the_recorder_every_poll(tmp_path, monkeypatch):
    cfg = _watchdog_rig(monkeypatch, tmp_path, other_responds=True)
    _stop_after(monkeypatch, 3)
    _run(capture.adapter_watchdog(PIN, cfg))
    lines = (tmp_path / H.FILE_NAME).read_text().splitlines()
    assert len(lines) >= 1 + 2 * 2, lines   # header + (pinned + other) per poll, at least two polls
    v = ok(H.verdict_object(H.read_rows(str(tmp_path), 0, 10**15), night="rig", root=str(tmp_path)), "PASS")
    assert v["population"]["eligible"] == 2
