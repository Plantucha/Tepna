# tepna-capture — tests/test_monitor_drift_chip.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The drift pill reads `clock_rate_*` and never shows a ppm without its windows and span.

Owner request 2026-11-26: a live drift badge for every device. `driftChip` runs in node over the
page's own source, so the test reads what ships.
"""

import json
import shutil
import subprocess

import pytest
from _monitor_chips import _body, _monitor_src  # noqa: E402


def _chips(devs):
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    src = _monitor_src()
    esc = next(ln for ln in src.splitlines() if ln.startswith("const esc = "))
    js = (
        esc
        + "\nfunction clockStatus(dev){ return null; }\n"
        + "function driftChip(dev)"
        + _body(src, "driftChip")
        + "\nfunction clkChip(dev)"
        + _body(src, "clkChip")
        + "\nconsole.log(JSON.stringify("
        + json.dumps(devs)
        + ".map(clkChip)));"
    )
    r = subprocess.run([node, "-e", js], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_the_drift_pill_shows_the_rate_with_its_windows_and_span():
    rate, measuring, absent, idle, wild = _chips(
        [
            {"connected": True, "clock_rate_ppm": 49.6, "clock_rate_span_s": 9000, "clock_rate_windows": 15},
            {"connected": True, "clock_rate_ppm": None, "clock_rate_span_s": None, "clock_rate_windows": 2},
            {"connected": True},
            {"connected": False, "clock_rate_ppm": 49.6, "clock_rate_windows": 15},
            {"connected": True, "clock_rate_ppm": -812.0, "clock_rate_span_s": 3600, "clock_rate_windows": 6},
        ]
    )
    assert "+50 ppm" in rate and "clk ok" in rate
    assert "15 ten-minute floors spanning 2.5 h" in rate
    assert "rate 2/6" in measuring and "ppm" not in measuring
    assert absent == "" and idle == ""
    assert "clk warn" in wild and "-812 ppm" in wild
