# tepna-capture — tests/test_monitor_oxylife_chips.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The OxyII lifecycle chips (`oxyLifeChip`, `oxyRecChip`) — OXYII-ACQUISITION-CHARTER G4's "liveness
states visible in STATUS", drawn.

The forwarding half is pinned in test_webmon_state_contract.py. This is the rendering half, and it is
not optional: a field that reaches `/api/state` and is rendered by nobody is not exposed to an operator
(the presence-witness argument in monitor.html, one row up). These run the SHIPPED functions, extracted
from monitor.html, under node with only `esc` supplied, so a chip that quietly stops rendering fails
here rather than on the box.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_monitor_device_cards import _extract  # noqa: E402

CASES = {
    "life_live": {"oxy_lifecycle": "live"},
    "life_idle": {"oxy_lifecycle": "idle_unworn"},
    "life_conn": {"oxy_lifecycle": "connected"},
    "life_none": {"worn": True},
    "rec_rec": {"oxy_recording": "recording"},
    "rec_end": {"oxy_recording": "end_candidate"},
    "rec_unk": {"oxy_recording": "rec_unknown"},
    "rec_none": {"connected": True},
    "xss": {"oxy_lifecycle": "<b>live</b>", "oxy_recording": "<i>x</i>"},
}


def _render():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    # The two chips are extracted from the shipped file for REAL (same recipe as the device-card
    # tests — the whole page cannot be evaluated here without hitting its own `const` dead zones);
    # `esc` is the page's own one-liner, restated.
    prog = (
        "const CASES = " + json.dumps(CASES) + ";\n"
        "const esc = s => String(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"
        "'\"':'&quot;',\"'\":'&#39;'}[c]));\n"
        + _extract("oxyLifeChip", "oxyRecChip") + "\n"
        "const out = {};\n"
        "for (const k in CASES) out[k] = {life: oxyLifeChip(CASES[k]), rec: oxyRecChip(CASES[k])};\n"
        "console.log(JSON.stringify(out));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
        fh.write(prog)
        path = fh.name
    try:
        r = subprocess.run([node, path], capture_output=True, text=True, timeout=30)
    finally:
        os.unlink(path)
    assert r.returncode == 0, r.stderr[:2000]
    return json.loads(r.stdout)


def test_the_link_axis_chip_names_the_journal_state_and_colours_the_unworn_hold():
    got = _render()
    assert 'class="dbadge on"' in got["life_live"]["life"] and ">live<" in got["life_live"]["life"]
    # idle_unworn is the state that ran unjournalled for 6 h on 2026-08-24 and then flapped 17,688 times
    # on 08-28 — it must be VISIBLE and it must not look healthy.
    assert 'class="dbadge warn"' in got["life_idle"]["life"] and ">idle_unworn<" in got["life_idle"]["life"]
    assert 'class="dbadge "' in got["life_conn"]["life"] and ">connected<" in got["life_conn"]["life"]


def test_the_recording_axis_chip_strips_only_the_rec_prefix():
    got = _render()
    assert 'class="dbadge on"' in got["rec_rec"]["rec"] and ">recording<" in got["rec_rec"]["rec"]
    assert 'class="dbadge warn"' in got["rec_end"]["rec"] and ">end_candidate<" in got["rec_end"]["rec"]
    assert ">unknown<" in got["rec_unk"]["rec"], "rec_unknown reads as 'unknown', the axis word is the chip's title"


def test_a_device_without_the_axis_draws_nothing():
    """H10 / Verity / AirSense have no OxyII lifecycle — an empty string, not a chip reading 'null'."""
    got = _render()
    assert got["life_none"]["life"] == "" and got["life_none"]["rec"] == ""
    assert got["rec_none"]["life"] == "" and got["rec_none"]["rec"] == ""


def test_the_state_string_is_escaped():
    got = _render()
    assert "<b>" not in got["xss"]["life"] and "&lt;b&gt;live" in got["xss"]["life"]
    assert "<i>" not in got["xss"]["rec"] and "&lt;i&gt;x" in got["xss"]["rec"]


def test_the_chips_are_composed_into_the_device_row():
    """Defined and never called is the same as not defined (test_monitor_chip_scope's own lesson)."""
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "monitor.html"),
               encoding="utf-8").read()
    assert "${oxyLifeChip(d)} ${oxyRecChip(d)}" in src
