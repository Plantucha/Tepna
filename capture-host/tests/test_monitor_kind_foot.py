# tepna-capture — tests/test_monitor_kind_foot.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The stream card foot names what the card draws.

OWNER-REPORTED 2026-11-17: the Muse EEG card read "raw 3-axis". The EEG stream has 4 channels, so
`streamKind` gives it the `multi` kind for its electrode legend, and the foot took the motion caption
of that kind. These tests execute the shipped JavaScript, as `test_monitor_streams_live.py` does.
"""

import json
import re
import os
import shutil
import subprocess

import pytest

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _extract() -> str:
    src = open(os.path.join(_HERE, "monitor.html"), encoding="utf-8").read()
    ppg = src[src.index("const isPpgKey") : src.index("\n", src.index("const isPpgKey"))]
    i = src.index("function streamKind(s){")
    kind = src[i : src.index("\n}\n", i) + 3]
    j = src.index("const KIND_FOOT")
    foot = src[j : src.index("function kindFoot(s){", j)]
    k = src.index("function kindFoot(s){")
    return ppg + "\n" + kind + foot + src[k : src.index("\n", k)] + "\n"


def _foot(stream):
    node = shutil.which("node")
    if not node:  # pragma: no cover - ubuntu-latest always has node; a dev box might not
        pytest.skip("node is not installed")
    prog = _extract() + "\nconsole.log(JSON.stringify(kindFoot(%s)));" % json.dumps(stream)
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def test_the_eeg_card_foot_reads_raw_eeg_not_raw_3_axis():
    assert _foot({"key": "eeg_TEST0001", "chans": 4}) == "raw EEG"


def test_a_bare_eeg_key_reads_raw_eeg_too():
    assert _foot({"key": "eeg", "chans": 4}) == "raw EEG"


def test_control_an_acc_stream_keeps_raw_3_axis():
    assert _foot({"key": "acc_TEST0001", "chans": 3}) == "raw 3-axis"


def test_control_a_key_that_only_starts_with_eeg_letters_is_not_eeg():
    assert _foot({"key": "eegx_TEST0001", "chans": 3}) == "raw 3-axis"


def test_control_the_other_kinds_keep_their_feet():
    assert [_foot(s) for s in ({"key": "ecg"}, {"key": "spo2"}, {"key": "ppi_TEST0001", "chans": 2})] == [
        "derived rate",
        "current",
        "per beat",
    ]


def test_the_card_render_reads_its_foot_through_kindfoot():
    """Pins the CALL SITE. The tests above run `kindFoot` itself, so a card that still read
    `KIND_FOOT[streamKind(s)]` would pass them and show "raw 3-axis" again."""
    src = open(os.path.join(_HERE, "monitor.html"), encoding="utf-8").read()
    feet = re.findall(r"<div class=\"ov-foot\"><span>\$\{([^}]*)\}</span>", src)
    assert feet == ["kindFoot(s)"], feet


# ── the PPG card: ambient by label, not by position ─────────────────────────────────────────────────
# The Muse PPG card has 4 pulsing optical channels. Drawn by position, its 4th trace read as the
# Verity's dashed ambient line.


def _ambient(stream):
    node = shutil.which("node")
    if not node:  # pragma: no cover - ubuntu-latest always has node; a dev box might not
        pytest.skip("node is not installed")
    src = open(os.path.join(_HERE, "monitor.html"), encoding="utf-8").read()
    lines = [src[i : src.index("\n", i)] for i in (src.index("const isPpgKey"), src.index("const isAmbientChan"))]
    prog = "\n".join(lines) + "\nconsole.log(JSON.stringify([0,1,2,3].map(c=>isAmbientChan(%s,c))));" % json.dumps(
        stream
    )
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def test_PLANT_the_muse_ppg_card_draws_no_channel_as_ambient():
    s = {"key": "ppg_TEST0001", "chans": 4, "labels": ["optic 1", "optic 2", "optic 3", "optic 4"]}
    assert _ambient(s) == [False, False, False, False]


def test_control_the_verity_ppg_card_keeps_its_4th_channel_ambient():
    assert _ambient({"key": "ppg_vs", "chans": 4, "labels": ["LED1", "LED2", "LED3", "ambient"]}) == [
        False,
        False,
        False,
        True,
    ]


def test_control_a_non_ppg_stream_labelled_ambient_is_not_dashed():
    assert _ambient({"key": "acc_vs", "chans": 4, "labels": ["a", "b", "c", "ambient"]}) == [False] * 4


def test_the_muse_ppg_card_takes_the_derived_rate_foot():
    assert _foot({"key": "ppg_TEST0001", "chans": 4}) == "derived rate"
