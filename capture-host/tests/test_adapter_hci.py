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
    assert back == {
        "probed_ms": T0,
        "hci": "hci1",
        "mac": "AA:BB:CC:DD:EE:FF",
        "pinned": False,
        "up": None,
        "responds": False,
        "probe_ms": 12,
    }
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
        assert (
            H.append_rows(
                str(tmp_path / "missing" / "dir"),
                [H.row(T0, "hci0", PIN, True, True, True, 1)],
                log=logging.getLogger("t"),
            )
            is False
        )
    assert any("could not append" in r.getMessage() for r in caplog.records)
    assert H.append_rows(str(tmp_path / "missing" / "dir"), [H.row(T0, "hci0", PIN, True, True, True, 1)]) is False, (
        "no logger: still no raise"
    )


def test_read_rows_filters_to_the_window_and_is_empty_when_the_file_is_absent(tmp_path):
    assert H.read_rows(str(tmp_path), 0, 10**15) == []
    H.append_rows(
        str(tmp_path), [H.row(T0 + i * 60_000, "hci0", PIN, True, True, True, 1) for i in range(5)] + ["torn;line"]
    )
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
    v = ok(
        H.verdict_object(
            _rows([True] * 5) + _rows([True] * 5, mac=OTHER, hci="hci1", pinned=False), night="2026-09-22"
        ),
        "PASS",
    )
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
    assert f"hci0 {PIN} (pinned): 1 isolated" in v["reason"], "a reason names the radio it convicts"


def test_a_FAIL_outranks_a_SHORTFALL_on_another_radio():
    rows = _rows([False, False, True]) + _rows([True, False, True], mac=OTHER, hci="hci1", pinned=False)
    v = ok(H.verdict_object(rows), "FAIL")
    assert OTHER not in v["reason"] and v["result"]["radios"][OTHER]["isolated_misses"] == 1


def test_a_radio_whose_every_probe_was_undeterminable_is_excluded_and_all_such_is_UNKNOWN():
    rows = _rows([True, True]) + _rows([None, None], mac=OTHER, hci="hci1", pinned=False)
    v = ok(H.verdict_object(rows), "PASS")
    assert v["population"] == {"checked": 1, "eligible": 2, "excluded": 1}
    v = ok(H.verdict_object(_rows([None, None, None])), "UNKNOWN")
    assert "no probe was determinable" in v["reason"] and v["population"] == {
        "checked": 0,
        "eligible": 1,
        "excluded": 1,
    }


def test_no_rows_is_NOT_RUN_never_PASS():
    v = ok(H.verdict_object([]), "NOT_RUN")
    assert v["result"] is None and H.FILE_NAME in v["reason"]


def test_sample_is_the_shortfall_shape_and_the_cli_prints_it(capsys):
    ok(H.verdict_sample(), "SHORTFALL")
    import subprocess

    r = subprocess.run(
        [
            sys.executable,
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "adapter_hci.py"),
            "--verdict-sample",
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
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
        return [
            {"hci": "hci0", "mac": PIN, "up": True},
            {"hci": "hci1", "mac": OTHER, "up": True},
            {"hci": "", "mac": "", "up": True},
        ]

    monkeypatch.setattr(capture, "adapter_hci", hci)
    monkeypatch.setattr(capture, "_adapter_is_up", is_up)
    monkeypatch.setattr(capture, "_adapter_responds", responds)
    monkeypatch.setattr(capture, "list_adapters", adapters)
    cfg = {
        "root": str(tmp_path),
        "watchdog": {
            "enabled": True,
            "interval_sec": 1,
            "grace_checks": 5,
            "max_adapter_cycles": 1,
            "recover_checks": 1,
            "deaf_scan_sec": 0,
        },
        "devices": [_dev(name="H10")],
    }
    capture.STATUS["devices"]["H10"] = {"connected": True, "address": "24:AC:AC:02:84:96", "last_error": None}
    cfg["_probed"] = probed
    return cfg


def test_the_recorder_writes_one_row_per_radio_reusing_the_pinned_verdict_and_publishes_status(
    tmp_path, monkeypatch, caplog
):
    cfg = _watchdog_rig(monkeypatch, tmp_path)
    with caplog.at_level("WARNING"):
        rows = _run(capture._record_adapter_hci(cfg, "hci0", True, True))
    assert [(r["hci"], r["mac"], r["pinned"], r["responds"]) for r in rows] == [
        ("hci0", PIN, True, True),
        ("hci1", OTHER, False, False),
    ]
    lines = (tmp_path / H.FILE_NAME).read_text().splitlines()
    assert lines[0] == H.HEADER and len(lines) == 3 and lines[1].split(";")[1:4] == ["hci0", PIN, "1"]
    assert capture.STATUS["adapter_hci"][OTHER] == {"hci": "hci1", "pinned": False, "up": True, "responds": False}
    assert any("REPORTED, not reset" in r.getMessage() and "hci1" in r.getMessage() for r in caplog.records)
    assert cfg["_probed"] == ["hci1"], (
        "the pinned radio's round trip is taken once by the watchdog, not again by the recorder"
    )


def test_a_failed_enumeration_still_writes_the_pinned_radio_s_measured_row(tmp_path, monkeypatch):
    cfg = _watchdog_rig(monkeypatch, tmp_path)

    async def boom():
        raise RuntimeError("hciconfig exploded")

    monkeypatch.setattr(capture, "list_adapters", boom)
    monkeypatch.setattr(capture, "ADAPTER", PIN)
    rows = _run(capture._record_adapter_hci(cfg, "hci0", False, False))
    assert rows == [
        {
            "probed_ms": rows[0]["probed_ms"],
            "hci": "hci0",
            "mac": PIN,
            "pinned": True,
            "up": False,
            "responds": False,
            "probe_ms": 0.0,
        }
    ]
    assert (tmp_path / H.FILE_NAME).read_text().count("\n") == 2


def test_no_pinned_radio_and_no_root_records_nothing_and_raises_nothing(tmp_path, monkeypatch):
    cfg = _watchdog_rig(monkeypatch, tmp_path)
    cfg["root"] = ""
    rows = _run(capture._record_adapter_hci(cfg, None, False, None))
    assert [r["mac"] for r in rows] == [PIN, OTHER] and not (tmp_path / H.FILE_NAME).exists()


@pytest.mark.sets_capture_events  # `_stop_after` sets _STOP as the scenario's end; the fixture resets it
def test_the_watchdog_calls_the_recorder_every_poll(tmp_path, monkeypatch):
    cfg = _watchdog_rig(monkeypatch, tmp_path, other_responds=True)
    _stop_after(monkeypatch, 3)
    _run(capture.adapter_watchdog(PIN, cfg))
    lines = (tmp_path / H.FILE_NAME).read_text().splitlines()
    assert len(lines) >= 1 + 2 * 2, lines  # header + (pinned + other) per poll, at least two polls
    v = ok(H.verdict_object(H.read_rows(str(tmp_path), 0, 10**15), night="rig", root=str(tmp_path)), "PASS")
    assert v["population"]["eligible"] == 2


# ── the sniffer: a recorded decision in `result`, never a verdict of its own ──────────────────────
class _Said:
    """What `systemctl` printed, and the exit code the reader must ignore."""

    def __init__(self, stdout: str, returncode: int = 1):
        self.stdout, self.returncode = stdout, returncode


def test_the_sniffer_state_table_is_pre_stated_over_every_tri_state_pair():
    table = {
        (True, True): "armed",
        (True, False): "armed",
        (True, None): "armed",
        (False, True): "armed",
        (None, True): "armed",
        (False, False): "inert",
        (False, None): "unknown",
        (None, False): "unknown",
        (None, None): "unknown",
    }
    for (enabled, active), state in table.items():
        b = H.sniffer_block(enabled, active)
        assert b["state"] == state, (enabled, active, b)
        assert b["enabled"] is enabled and b["active"] is active, "the inputs travel with the verdict"
        assert (b["why"] is None) is (state != "unknown"), b
    assert H.sniffer_block(None, None)["state"] != "inert", "an unread timer is not a disabled one"


def test_the_unknown_reason_names_both_inputs_and_the_decision_it_cannot_vouch_for():
    why = H.sniffer_block(None, False)["why"]
    assert "enabled=None" in why and "active=False" in why
    assert H.SNIFF_DECISION["id"] in why, "a reason says which ruling is left unevidenced"


def test_the_block_cites_the_decision_and_hands_out_a_copy_of_it():
    b = H.sniffer_block(False, False, radios_on_hci=4)
    assert b == {
        "unit": "tepna-sniff.timer",
        "state": "inert",
        "enabled": False,
        "active": False,
        "radios_on_hci": 4,
        "decision": dict(H.SNIFF_DECISION),
        "why": None,
    }
    assert b["decision"]["doc"].endswith("-BRIEF.md") and "SNIFFER" in b["decision"]["doc"]
    b["decision"]["id"] = "D9"
    assert H.SNIFF_DECISION["id"] != "D9", "the constant is copied out, never handed out"


def test_the_timer_reader_answers_on_the_word_never_on_the_exit_code():
    said = {"is-enabled": "disabled", "is-active": "inactive"}

    def run(argv):
        assert argv[0] == "systemctl" and argv[2] == H.SNIFF_UNIT, argv
        return _Said(said[argv[1]] + "\n")

    assert H.sniffer_timer(run=run) == (False, False), "a non-zero exit saying `disabled` is disabled"
    said["is-enabled"], said["is-active"] = "enabled", "active"
    assert H.sniffer_timer(run=run) == (True, True)
    said["is-enabled"] = "static"
    assert H.sniffer_timer(run=run) == (None, True), "a third word is unread, never False"


def test_a_reader_that_raises_is_unread_not_disabled():
    def boom(_argv):
        raise FileNotFoundError("systemctl")

    assert H.sniffer_timer(run=boom) == (None, None)
    assert H.sniffer_block(*H.sniffer_timer(run=boom))["state"] == "unknown"


def test_the_default_reader_shells_out_and_an_absent_unit_is_never_inert():
    # No injected runner: the real `systemctl` path. Either answer is honest — no systemd at all raises
    # and reads (None, None), and a systemd that never heard of the unit prints nothing for `is-enabled`.
    enabled, active = H.sniffer_timer(f"tepna-no-such-unit-{os.getpid()}.timer")
    assert enabled is None, enabled
    assert H.sniffer_block(enabled, active)["state"] == "unknown", "an absent unit is not an inert one"


def test_the_sniffer_moves_neither_status_nor_reason_nor_population():
    rows = _rows([True, False, False, True])
    base = ok(H.verdict_object(rows), "FAIL")
    assert base["result"]["sniffer"]["state"] == "unknown", "unread by default, never inert"
    for enabled, active in ((False, False), (True, False), (None, None)):
        v = ok(H.verdict_object(rows, sniff_enabled=enabled, sniff_active=active), "FAIL")
        assert v["status"] == base["status"] and v["reason"] == base["reason"]
        assert v["population"] == base["population"]
        assert v["result"]["sniffer"]["state"] == H.sniffer_block(enabled, active)["state"]


def test_radios_on_hci_counts_the_radios_that_answered_not_the_determinable_ones():
    rows = _rows([True, True]) + _rows([False, False], mac=OTHER, hci="hci1", pinned=False)
    v = ok(H.verdict_object(rows, sniff_enabled=False, sniff_active=False), "FAIL")
    assert v["result"]["radios"][OTHER]["determinable"] == 2, "an all-False radio is determinable"
    assert v["result"]["sniffer"]["radios_on_hci"] == 1, "and it answered nothing"
    v = ok(H.verdict_object(_rows([None, None]), sniff_enabled=False, sniff_active=False), "UNKNOWN")
    assert v["result"]["sniffer"]["radios_on_hci"] == 0


def test_a_night_with_no_rows_keeps_no_result_even_once_the_timer_was_read():
    v = ok(H.verdict_object([], sniff_enabled=False, sniff_active=False), "NOT_RUN")
    assert v["result"] is None, "nothing was examined, so there is nothing to report about the sniffer"


def test_nightqc_reads_the_timer_once_and_a_night_with_no_rows_never_asks_the_box(tmp_path):
    root, night = _night(tmp_path)
    H.append_rows(str(root), [H.row(T0 + i * 60_000, "hci0", PIN, True, True, True, 1) for i in range(3)])
    calls: list[int] = []

    def timer():
        calls.append(1)
        return (False, False)

    inside = {"sessions": [{"start": T0 // 1000, "end": T0 // 1000 + 180}]}
    v = ok(nightqc.adapter_hci_verdict(str(night), inside, sniffer_timer=timer), "PASS")
    assert v["result"]["sniffer"] == H.sniffer_block(False, False, radios_on_hci=1)
    assert len(calls) == 1
    assert ok(nightqc.adapter_hci_verdict(str(night), {"sessions": []}, sniffer_timer=timer), "NOT_RUN")
    assert len(calls) == 1, "no rows means no result, so the box is never asked"


# ── the rule's own reads, in scope because this branch changed these functions ────────────────────
def test_the_default_runner_asks_systemctl_for_captured_text_under_a_timeout(monkeypatch):
    # The default reader is the one the box uses, so its arguments are part of the rule: without
    # `capture_output` and `text` there is no word to read, and without a timeout a wedged systemctl
    # hangs the nightly verdict. `subprocess` is imported inside the function, so patching the module
    # attribute reaches it.
    import subprocess

    seen: list[tuple] = []

    def fake(argv, **kw):
        seen.append((list(argv), kw))
        return _Said("enabled\n" if argv[1] == "is-enabled" else "active\n", 0)

    monkeypatch.setattr(subprocess, "run", fake)
    assert H.sniffer_timer() == (True, True)
    assert [a for a, _ in seen] == [
        ["systemctl", "is-enabled", H.SNIFF_UNIT],
        ["systemctl", "is-active", H.SNIFF_UNIT],
    ]
    assert all(kw == {"capture_output": True, "text": True, "timeout": 10} for _, kw in seen), seen


def test_the_evidence_names_the_sidecar_under_the_root_it_was_read_from():
    v = ok(H.verdict_object(_rows([True, True]), night="2026-09-22", root="/srv/cap"), "PASS")
    assert v["evidence"] == [H.TOOL, os.path.join("/srv/cap", H.FILE_NAME), "2026-09-22"]


def test_a_radio_takes_its_hci_name_from_the_LAST_poll_not_an_earlier_one():
    # Re-enumeration moves a radio between hci names mid-night; the report says where it ended up.
    rows = [
        H.parse_row(H.row(T0 + i * 60_000, h, PIN, True, True, True, 10))
        for i, h in enumerate(("hci0", "hci1", "hci2"))
    ]
    v = ok(H.verdict_object(rows), "PASS")
    assert v["result"]["radios"][PIN]["hci"] == "hci2"


def test_one_determinable_poll_is_enough_to_be_checked():
    v = ok(H.verdict_object(_rows([True, None])), "PASS")
    assert v["result"]["radios"][PIN]["determinable"] == 1
    assert v["population"] == {"checked": 1, "eligible": 1, "excluded": 0}


def test_an_unpinned_radio_is_never_named_pinned():
    v = ok(H.verdict_object(_rows([True, False, False], mac=OTHER, hci="hci1", pinned=False)), "FAIL")
    assert v["reason"].startswith(f"hci1 {OTHER}: ")
    assert "(pinned)" not in v["reason"]


def test_nightqc_trims_a_trailing_slash_before_it_names_the_night(tmp_path):
    root, night = _night(tmp_path)
    H.append_rows(str(root), [H.row(T0, "hci0", PIN, True, True, True, 1)])
    inside = {"sessions": [{"start": T0 // 1000, "end": T0 // 1000 + 60}]}
    v = ok(nightqc.adapter_hci_verdict(str(night) + "/", inside, sniffer_timer=lambda: (False, False)), "PASS")
    assert v["evidence"] == [H.TOOL, os.path.join(str(root), H.FILE_NAME), "2026-09-22"]


def test_nightqc_the_window_start_is_seconds_and_leaves_earlier_rows_out(tmp_path):
    root, night = _night(tmp_path)
    H.append_rows(str(root), [H.row(T0 + i * 60_000, "hci0", PIN, True, True, True, 1) for i in range(10)])
    late = {"sessions": [{"start": T0 // 1000 + 5 * 60, "end": T0 // 1000 + 9 * 60}]}
    v = ok(nightqc.adapter_hci_verdict(str(night), late, sniffer_timer=lambda: (False, False)), "PASS")
    assert v["result"]["polls"] == 5, "the five rows before the window start are not this night's"


def test_nightqc_hands_the_two_timer_facts_over_in_order(tmp_path):
    root, night = _night(tmp_path)
    H.append_rows(str(root), [H.row(T0, "hci0", PIN, True, True, True, 1)])
    inside = {"sessions": [{"start": T0 // 1000, "end": T0 // 1000 + 60}]}
    v = ok(nightqc.adapter_hci_verdict(str(night), inside, sniffer_timer=lambda: (True, False)), "PASS")
    assert v["result"]["sniffer"]["enabled"] is True and v["result"]["sniffer"]["active"] is False
    assert v["result"]["sniffer"]["state"] == "armed", "enabled alone arms it"


def test_nightqc_a_crash_still_names_the_sidecar_it_was_reading(tmp_path):
    root, night = _night(tmp_path)
    v = ok(nightqc.adapter_hci_verdict(str(night), {"sessions": [{"start": "x", "end": 1}]}), "UNKNOWN")
    assert v["evidence"][:2] == [H.TOOL, os.path.join(str(root), H.FILE_NAME)]
