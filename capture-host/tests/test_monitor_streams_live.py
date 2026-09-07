# tepna-capture — tests/test_monitor_streams_live.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""`Streams · N of M live` must count streams that are LIVE, not streams that once produced data.

OWNER-REPORTED 2026-09-07: the monitor read "Streams · 2 of 12 live" with the O2Ring disconnected since
09:49 and every device idle. The two were `motion_o2` and `pi_o2`, both `health:'stall'`, and
`/api/stream/motion_o2` was serving a buffer of zeros — a stale reading pixel-identical to a live one.

The cause is a word. The bus's `_active` is documented as "streams that have produced data this
session": set on the first push, cleared ONLY by `unregister`, which the O2Ring path never calls on
disconnect. So it answers "did this ever flow in this process", and the heading asked it "is this
flowing now". `health` is the field that is recomputed from the age of the last sample.

⚠️ THESE TESTS EXECUTE THE SHIPPED JAVASCRIPT rather than scanning `monitor.html` for a string, which
is this file's house pattern (see `test_monitor_rate_staleness.py`). A text scan cannot tell
`!==` from `===`, and would pass against a function nothing calls.
"""
import json
import os
import re
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _extract() -> str:
    """The real `renderSideStats` computation, with its two DOM writes stubbed.

    Extracted from the shipped file, not retyped: a copy here would drift from the page and pass while
    the page was wrong — which is the failure this whole file exists to catch."""
    src = open(os.path.join(_HERE, "monitor.html"), encoding="utf-8").read()
    i = src.index("function renderSideStats(){")
    body = src[i:src.index("$('#sideStats').innerHTML", i)]
    body = body.replace("const gt = $('#ovGridTitle');", "let gt = {textContent:''};")
    inner = body[body.index("{") + 1:]
    return ("function renderSideStats(STREAMS){\n" + inner +
            "\n  return {heading: gt.textContent, live: live.length, weak: weak};\n}\n")


def _run(streams):
    node = shutil.which("node")
    if not node:  # pragma: no cover - ubuntu-latest always has node; a dev box might not
        pytest.skip("node is not installed")
    prog = _extract() + "\nconsole.log(JSON.stringify(renderSideStats(%s)));" % json.dumps(streams)
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def test_a_STALLED_stream_is_not_counted_as_live():
    """🔴 THE REPORTED DEFECT, with the box's own state. Two O2Ring streams that pushed before the ring
    dropped, both stalled, everything else idle: the heading claimed two live streams while nothing was
    streaming at all."""
    got = _run([
        {"key": "motion_o2", "active": True, "health": "stall"},
        {"key": "pi_o2", "active": True, "health": "stall"},
        {"key": "ecg", "active": False, "health": "idle"},
        {"key": "spo2", "active": False, "health": "idle"},
    ])
    assert got["live"] == 0
    assert got["heading"] == "Streams · 0 of 4 live"


def test_a_stalled_stream_is_not_ALSO_reported_as_weak():
    """`weak` is counted among the LIVE. A stalled stream is silent, not degraded, and counting it under
    both would report the same stream twice in one heading — which the previous code did: the same two
    stalled streams produced `2 live` AND `⚠ 2 weak`."""
    got = _run([
        {"key": "motion_o2", "active": True, "health": "stall"},
        {"key": "pi_o2", "active": True, "health": "stall"},
    ])
    assert got["live"] == 0 and got["weak"] == 0


def test_flowing_streams_still_count_and_weak_is_reported_among_them():
    """The mirror — the fix must not silence a genuinely live page. `good` and `weak` are both flowing,
    so both are live; only `weak` carries the warning."""
    got = _run([
        {"key": "ecg", "active": True, "health": "good"},
        {"key": "ppg", "active": True, "health": "weak"},
        {"key": "acc", "active": True, "health": "stall"},
        {"key": "spo2", "active": False, "health": "idle"},
    ])
    assert got["live"] == 2, "good + weak are flowing; stall is not"
    assert got["weak"] == 1
    assert got["heading"] == "Streams · 2 of 4 live"


def test_the_denominator_stays_every_declared_stream():
    """`M` is deliberately ALL streams, not the live ones — a configured-and-failing stream must stay
    visible rather than vanish from the count. That is the behaviour the 2026-09-06 fix established and
    this change must not undo it: only the numerator was wrong."""
    got = _run([{"key": "a", "active": False, "health": "idle"}] * 5)
    assert got["heading"] == "Streams · 0 of 5 live"


def test_liveness_is_read_from_health_not_from_active():
    """Pins the REASON rather than the number. `active` is a bus flag meaning "pushed at some point this
    process" and nothing retracts it on disconnect; `health` is recomputed from the last sample's age.
    If someone routes the claim back through `active`, the first test reds — and so does this."""
    src = _extract()
    assert re.search(r"const live\s*=\s*active\.filter\(s\s*=>\s*s\.health\s*!==\s*'stall'\)", src), \
        "live must be derived from health, not from active alone"
