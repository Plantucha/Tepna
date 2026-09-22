# tepna-capture — tests/test_qc_poller_verdicts.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""qc_poller writes the two `tepna.verdict/1` objects beside QC-SUMMARY.json on every tick."""

import json
import os

import asyncio

import capture
from tests.test_capture_coverage_100 import _run, _stop_after


def test_qc_poller_writes_both_verdicts_beside_the_summary(tmp_path, monkeypatch):
    capture._STOP = asyncio.Event()  # per test: an Event binds to the loop that first awaits it
    night = tmp_path / "captures" / "2026-09-19"
    os.makedirs(str(night))
    (night / "Wellue_O2Ring-S_S8AW_20260919_PPG.txt").write_text("hdr\n")
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-09-19")
    monkeypatch.setattr(
        capture.nightqc,
        "summarize",
        lambda n, devices: {
            "night": "2026-09-19",
            "missing": [],
            "degraded": [],
            "gaps_in_night": [],
            "span_sec": 7200,
            "devices": [{"name": "Ring", "coverage": {"ppg": 0.99}}],
            "class_b": [{"file": "Wellue_O2Ring-S_S8AW_20260919_PPG.txt", "clips": {"ppg": 0}, "held": None}],
        },
    )
    _stop_after(monkeypatch, 1)
    _run(
        capture.qc_poller(
            {"qc": {"poll_sec": 1}, "devices": [{"name": "Ring", "device_id": "S8AW", "streams": ["ppg"]}]},
            str(tmp_path),
            None,
        )
    )
    qc = json.load(open(str(night / "QC-VERDICT.json")))
    bc = json.load(open(str(night / "BACKCHECK-VERDICT.json")))
    assert (
        qc["gate"] == "night-qc"
        and qc["status"] == "PASS"
        and qc["population"] == {"checked": 1, "eligible": 1, "excluded": 0}
    )
    assert bc["gate"] == "night-backcheck" and bc["status"] == "PASS"
    assert os.path.exists(str(night / "QC-SUMMARY.json"))
    capture._STOP.clear()
