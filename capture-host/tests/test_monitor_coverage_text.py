# tepna-capture — tests/test_monitor_coverage_text.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""WHAT THE COVERAGE LINE ON A STREAM CARD SAYS — taken from the shipped page and run for real.

The defect this file exists for was visible only as text: `ACC (O2Ring)` reading LIVE and
`0.0 % captured` in the same pill row (owner, 2026-09-27 05:52). The percentage was a division by an
absent denominator — `_expected_hz` is None for the ring's three raw-buffer opcodes, and those files
carry no device clock either — so `timeline.py` now publishes `coverage_pct: null` with a reason where
nothing could be measured, and this is the half that decides what a reader sees.

The real zero is the case worth naming twice: a declared stream with NO files genuinely captured
nothing, that IS a measurement, and it must not read the same as one that cannot be measured — or a
dead sensor hides behind the words meant for a missing denominator.
"""

from __future__ import annotations

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
    "no_basis": {"coverage_pct": None, "coverage_reason": "no-duration-basis", "coverage_unmeasured": 1},
    "unmeasurable": {"coverage_pct": None, "coverage_reason": None, "coverage_unmeasured": 0},
    "measured": {"coverage_pct": 30.6, "coverage_reason": None, "coverage_unmeasured": 0},
    "partial_one": {"coverage_pct": 30.6, "coverage_reason": None, "coverage_unmeasured": 1},
    "partial_many": {"coverage_pct": 30.6, "coverage_reason": None, "coverage_unmeasured": 3},
    "real_zero": {"coverage_pct": 0.0, "coverage_reason": None, "coverage_unmeasured": 0},
    "whole": {"coverage_pct": 100.0, "coverage_reason": None, "coverage_unmeasured": 0},
}


def _render():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    prog = (
        "const CASES = " + json.dumps(CASES) + ";\n" + _extract("coverageText") + "\n"
        "const out = {};\n"
        # Each case is evaluated on its OWN, so a case that THROWS is recorded rather than killing
        # the program and failing every assertion in this file alike. Without this, restoring the
        # old `coverage_pct.toFixed(1)` render fails even the real-zero control — which that render
        # got right — and the arm check would have read as three defects where there is one.
        "for (const k in CASES) { try { out[k] = coverageText(CASES[k]); }\n"
        "  catch (e) { out[k] = 'THREW: ' + e.message; } }\n"
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


def test_an_absent_denominator_is_NAMED_and_never_rendered_as_a_percentage():
    """THE PLANT. `null` must not reach `.toFixed` — which would throw and blank the line — and must not
    be coerced to 0.0 either, which is what the previous `coverage_pct.toFixed(1)` would have printed
    had the producer simply defaulted. The reason travels to the reader."""
    got = _render()
    assert not got["no_basis"].startswith("THREW"), ("null reached .toFixed", got)
    assert got["no_basis"] == "no rate to measure against", got
    assert "%" not in got["no_basis"], got
    assert got["unmeasurable"] == "coverage not measurable", got


def test_a_REAL_zero_still_reads_as_a_measurement():
    """THE CONTROL that keeps the fix from swallowing the honest zero: a stream with no files captured
    nothing, and that must stay a number. If this ever reads like the refusal above, a sensor that never
    recorded is indistinguishable from one nothing could be measured on."""
    got = _render()
    assert got["real_zero"] == "0.0% captured", got
    assert got["real_zero"] != got["unmeasurable"], got


def test_a_measured_percentage_is_unchanged_and_a_partial_one_says_so():
    """The other control — every stream that could be measured reads exactly as before — plus the §∅
    annotation: reduced coverage annotates, so a percentage built from only some of the stream's files
    carries the count of those it could not use, and pluralises like a sentence."""
    got = _render()
    assert got["measured"] == "30.6% captured", got
    assert got["whole"] == "100.0% captured", got
    assert got["partial_one"] == "30.6% captured (1 file unmeasured)", got
    assert got["partial_many"] == "30.6% captured (3 files unmeasured)", got
