# tepna-capture — tests/test_monitor_solid_night.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The SOLID-NIGHT verdict's CARD (`renderSolidNight`) — the last link of that chain.

`solid_night.compose` decides the night, `capture.solid_night_compose` publishes it into STATUS, and
`test_webmon_state_contract` pins the forwarding. This is the half that reaches a person, and it is the
half that was missing: the capture-quality programme's exit condition is 14 consecutive solid nights, and
until now its one nightly answer lived in a log line and a file on the box.

⚠️ `find_unwired`'s scan 3 CANNOT be the guard here, and that is worth stating rather than assuming.
It asks whether the forwarded key appears as a word in `monitor.html` — and `solid` is a CSS keyword, so
33 `px solid` borders already satisfy it. The scan reads green whether or not anything draws the verdict.
These tests are the guard that can actually fail.

Runs the SHIPPED function, extracted from monitor.html, under node with `$` stubbed — the same recipe as
the live-loss and device-card tests next door, and for the same reason.
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

# One case per status `solid_night.compose` can emit, plus the two absences. Every night date distinct,
# so a card that rendered a constant could not pass.
CASES: dict[str, dict | None] = {
    "absent": None,  # before the poller has composed anything
    "no_status": {"night": "2026-09-01", "reason": "x"},  # a malformed block is not a verdict
    "pass": {
        "night": "2026-09-22",
        "status": "PASS",
        "reason": None,
        "run": "3 solid of 3 nights over 3 days",
        "solid": 3,
        "exit": False,
    },
    "fail": {
        "night": "2026-09-23",
        "status": "FAIL",
        "reason": "h10 — timebase: -50000 ppm over 21 s; verity — completeness: 61% of expected",
        "run": "0 solid of 0 nights over 0 days",
        "solid": 0,
        "exit": False,
    },
    "pending": {
        "night": "2026-09-24",
        "status": "UNKNOWN",
        "reason": "not settled",
        "run": "3 solid of 3 nights over 3 days",
        "solid": 3,
        "exit": False,
    },
    "unassessed": {
        "night": "2026-09-25",
        "status": "UNKNOWN",
        "reason": "h10 — timebase: fewer than 3 anchors, the axis was not measured",
        "run": "0 solid of 0 nights over 0 days",
        "solid": 0,
        "exit": False,
    },
    "nobody_wore": {
        "night": "2026-09-26",
        "status": "NOT_APPLICABLE",
        "reason": "nobody wore anything: h10 — witnessed off-body all night",
        "run": "3 solid of 3 nights over 3 days",
        "solid": 3,
        "exit": False,
    },
}


def _render():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    prog = (
        "const CASES = " + json.dumps(CASES) + ";\n"
        "let EL = {};\n"
        "const $ = id => EL[id];\n" + _extract("renderSolidNight") + "\n"
        "const out = {};\n"
        "for (const k in CASES) {\n"
        "  EL = {}; for (const id of ['#snCard','#snPill','#snText','#snDetail'])\n"
        "    EL[id] = {className:'', textContent:'', title:'', hidden:false};\n"
        "  renderSolidNight(CASES[k]);\n"
        "  out[k] = {hidden: EL['#snCard'].hidden, cls: EL['#snPill'].className,\n"
        "            text: EL['#snText'].textContent, det: EL['#snDetail'].textContent,\n"
        "            title: EL['#snDetail'].title};\n"
        "}\n"
        # Looked up by id, so a page that lost the markup must not throw — and must not silently draw
        # nowhere either. `$` returning undefined is exactly that case.
        "EL = {}; renderSolidNight(CASES.fail); out.no_card = 'survived';\n"
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


def test_the_card_is_hidden_until_a_verdict_EXISTS():
    """§∅: absence is null, never a green. A card that rendered PASS from an absent block would be a
    fabricated solid night — and a fabricated solid night advances a 14-night run."""
    o = _render()
    assert o["absent"]["hidden"] is True
    assert o["no_status"]["hidden"] is True, "a block without a status word is not a verdict"


def test_a_PASS_names_the_night_and_stays_quiet():
    o = _render()["pass"]
    assert o["hidden"] is False and o["cls"].endswith("ok")
    assert o["text"] == "PASS · 2026-09-22", "the status word and the night, which night being the point"
    assert o["det"] == "", "a PASS has no failing term, and inventing one is the defect next door"


def test_a_FAIL_names_the_TERM_that_failed_not_just_the_verdict():
    """The whole reason the card exists: "last night was not solid" is not actionable, "the H10's
    timebase refused at -50000 ppm" is."""
    o = _render()["fail"]
    assert o["cls"].endswith("bad") and o["text"] == "FAIL · 2026-09-23"
    assert "timebase: -50000 ppm over 21 s" in o["det"]
    assert "completeness: 61% of expected" in o["det"], "every failing term, not the first one"
    assert o["title"] == o["det"], "the full reason stays reachable when the card clips it"


def test_a_night_still_in_progress_is_NEUTRAL_not_a_warning():
    """`not settled` is the designed state every evening — solid_night §3.1 excludes the latest night
    from the run rather than resetting it. Amber here would mean the monitor read amber by construction
    on every night of the programme, which is how a real warning stops being read."""
    o = _render()["pending"]
    assert o["cls"].endswith("idle") and o["text"] == "UNKNOWN · 2026-09-24"
    assert o["det"] == "not settled", "the state is still named — neutral is not silent"


def test_an_UNKNOWN_that_is_NOT_pending_IS_a_warning():
    """The distinction the colour carries: a night that could not be ASSESSED resets the run (§∅ — an
    unassessable night must not bridge one), so it is not the same state as a night still running."""
    o = _render()["unassessed"]
    assert o["cls"].endswith("warn") and o["text"] == "UNKNOWN · 2026-09-25"
    assert "fewer than 3 anchors" in o["det"]


def test_NOBODY_WORE_ANYTHING_is_a_skip_not_a_failure():
    o = _render()["nobody_wore"]
    assert o["cls"].endswith("idle") and o["text"] == "NOT_APPLICABLE · 2026-09-26"
    assert "witnessed off-body all night" in o["det"]


def test_the_monitor_calls_it_and_has_somewhere_to_write():
    """The mention-is-not-a-rendering rule. Extracting the function proves it parses, not that the page
    ever runs it — and for THIS key the scan-3 grep is vacuous (see the module docstring), so this
    assertion is the only thing standing between the forward and another published-and-undrawn field."""
    src = open(
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "monitor.html"), encoding="utf-8"
    ).read()
    assert "renderSolidNight(s.solid)" in src, "forwarded and never called"
    assert 'id="snPill"' in src and 'id="snDetail"' in src, "called with nothing to write into"


def test_a_page_without_the_card_does_not_throw():
    assert _render()["no_card"] == "survived"
