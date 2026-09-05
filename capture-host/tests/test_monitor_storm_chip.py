# tepna-capture — tests/test_monitor_storm_chip.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The restart-storm chip (`oxyStormChip`) — the last link of the storm publication.

The chain is STATUS -> webmon `_remembered()` -> monitor.html, and each link has its own way of
silently dropping the field: the daemon can publish a key nothing forwards (the thirteen-night
`oxy_lifecycle` case), and webmon can forward a field nothing draws. `find_unwired.py` caught this
change in the SECOND state — forwarded, never rendered — which is why this file exists.

⚠️ These run the SHIPPED function under `node`, which is NOT installed on the capture box, so they
SKIP there and CI is their verdict. A skip is not a pass: `_render` skips loudly rather than
returning an empty result that would let every assertion below vacuously succeed.
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
    # The state an operator MUST be able to tell from a broken link: the daemon is deliberately not
    # talking to the ring.
    "held": {"oxy_storm": {"hold_remaining_s": 900, "hold_until": "2026-09-05T22:45:00",
                           "trips": ["2026-09-05T22:30:00"], "last_trip": "2026-09-05T22:30:00"}},
    # Hold over, but the night's evidence must still be visible in the morning.
    "cleared": {"oxy_storm": {"hold_remaining_s": 0, "hold_until": None,
                              "trips": ["2026-09-05T02:30:00", "2026-09-05T02:51:00"],
                              "last_trip": "2026-09-05T02:51:00"}},
    # A quiet night draws NOTHING — a chip that always renders teaches an operator to ignore it.
    "quiet": {"oxy_storm": {"hold_remaining_s": 0, "hold_until": None, "trips": [], "last_trip": None,
                            "restarts_total": 2}},
    # Devices without the axis (H10, Verity, AirSense) and pre-deploy daemons draw nothing.
    "absent": {"connected": True},
    "xss": {"oxy_storm": {"hold_remaining_s": 0, "trips": ["<b>x</b>"], "last_trip": "<img src=x>"}},
}


def _render():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    prog = (
        "const CASES = " + json.dumps(CASES) + ";\n"
        "const esc = s => String(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"
        "'\"':'&quot;',\"'\":'&#39;'}[c]));\n"
        + _extract("oxyStormChip") + "\n"
        "const out = {};\n"
        "for (const k in CASES) out[k] = oxyStormChip(CASES[k]);\n"
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


def test_an_active_hold_says_it_is_deliberate_and_how_long_is_left():
    out = _render()
    assert "storm hold 15m" in out["held"]
    assert "left alone deliberately" in out["held"], "an operator must not read a hold as a failed link"
    assert "2026-09-05T22:45:00" in out["held"], "the resume time belongs in the title"


def test_a_cleared_hold_still_shows_the_night_had_storms():
    """A hold that fires at 02:00 and clears at 02:15 is invisible by morning otherwise — and morning
    is when anyone reads this."""
    out = _render()
    assert "storm ×2" in out["cleared"]
    assert "2026-09-05T02:51:00" in out["cleared"]


def test_a_quiet_night_and_a_device_without_the_axis_draw_nothing():
    """A chip that renders on every card teaches an operator to stop seeing it."""
    out = _render()
    assert out["quiet"] == ""
    assert out["absent"] == ""


def test_values_are_escaped():
    """`trips`/`last_trip` are strings the daemon composes, but the chip must not be the one place
    that trusts them — the sibling chips all escape."""
    out = _render()
    assert "<b>" not in out["xss"] and "<img" not in out["xss"]
