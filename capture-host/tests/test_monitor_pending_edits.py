# tepna-capture — tests/test_monitor_pending_edits.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""An unsaved stream edit must SURVIVE the 5-second re-render.

`loadState` runs every 5 s and `renderRemembered` rebuilds the device list with
`el.innerHTML = ...`, destroying every control on every card; the checkbox state is then recomputed
from server truth (`d.streams`). So an edit the operator had not yet saved was reverted with no
message — reported from the Devices view as "it lets me click but it changes back in seconds".

Follows test_monitor_ring_rtc_alarm.py / test_monitor_rate_staleness.py: EXECUTE the shipped
JavaScript under node, never scan monitor.html for a string — a text scan cannot tell
present-when-true from always-present, and would pass against an overlay nothing consults.

⚠️ The decisive case is the NEGATIVE one. An overlay that returns the pending value is easy; the bug
this prevents is an overlay that returns a value for a control the operator never touched, which
would make a stale page fight every change made anywhere else. `test_untouched_follows_server` is the
leg that fails if `pendingChecked` is ever "simplified" into a plain form mirror.
"""

import json
import os
import re
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = os.path.join(HERE, "monitor.html")


def _extract():
    """The pending-overlay functions, as executable source, taken from the shipped file."""
    src = open(MON, encoding="utf-8").read()
    key = re.search(r"^const pendKey = .*?;$", src, re.M)
    assert key, "pendKey is gone from monitor.html — extraction is testing nothing"
    checked = re.search(r"^function pendingChecked\(pending, addr, stream, serverOn\) \{.*?\n\}$", src, re.M | re.S)
    assert checked, "pendingChecked() is gone or reshaped — this test is stale, fix it"
    count = re.search(r"^function pendingCount\(pending\) \{.*?\n\}$", src, re.M | re.S)
    assert count, "pendingCount() is gone or reshaped — this test is stale, fix it"
    return key.group(0), checked.group(0), count.group(0)


def _run(expr, pending):
    node = shutil.which("node")
    if not node:  # pragma: no cover - CI always has node; a dev box might not
        pytest.skip("node is not installed")
    key_src, checked_src, count_src = _extract()
    prog = (
        f"{key_src}\n{checked_src}\n{count_src}\n"
        f"const PENDING = Object.assign(Object.create(null), {json.dumps(pending)});\n"
        f"console.log(JSON.stringify({expr}));"
    )
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, f"node failed: {r.stderr}"
    return json.loads(r.stdout)


ADDR = "24:AC:AC:0C:30:1E"


def test_untouched_follows_server():
    """The leg that matters: a control the operator never touched must follow the daemon.

    If this ever returns the pending map's default instead, a page left open would silently
    re-assert its own stale view over every change made elsewhere.
    """
    assert _run(f"pendingChecked(PENDING, {json.dumps(ADDR)}, 'mag', true)", {}) is True
    assert _run(f"pendingChecked(PENDING, {json.dumps(ADDR)}, 'mag', false)", {}) is False


def test_unsaved_off_survives_rerender():
    """The reported bug: `mag` unticked, then the 5 s rebuild recomputes from `d.streams` (still on)."""
    pending = {f"{ADDR}|mag": False}
    assert _run(f"pendingChecked(PENDING, {json.dumps(ADDR)}, 'mag', true)", pending) is False


def test_unsaved_on_survives_rerender():
    """The same in the other direction — ticking `ppi` while the server still has it off."""
    pending = {f"{ADDR}|ppi": True}
    assert _run(f"pendingChecked(PENDING, {json.dumps(ADDR)}, 'ppi', false)", pending) is True


def test_edits_are_per_device_not_per_stream_name():
    """Keyed by ADDRESS+stream. Two Polars both offering `acc` must not share one pending entry."""
    other = "A0:9E:1A:00:00:01"
    pending = {f"{ADDR}|acc": False}
    assert _run(f"pendingChecked(PENDING, {json.dumps(ADDR)}, 'acc', true)", pending) is False
    assert _run(f"pendingChecked(PENDING, {json.dumps(other)}, 'acc', true)", pending) is True


def test_false_is_a_real_edit_not_an_absence():
    """`false` must be distinguishable from "not edited".

    A `pending[k] || serverOn` shortcut passes every other test here and fails exactly this one —
    unticking a box would silently do nothing, which is the original bug wearing a new cause.
    """
    assert _run(f"pendingChecked(PENDING, {json.dumps(ADDR)}, 'gyro', true)", {f"{ADDR}|gyro": False}) is False


def test_count_drives_the_unsaved_cue():
    """The operator is told HOW MANY edits are unsaved; 1 and 6 are different situations when a
    save needs a device reconnect."""
    assert _run("pendingCount(PENDING)", {}) == 0
    assert _run("pendingCount(PENDING)", {f"{ADDR}|mag": False, f"{ADDR}|gyro": False, f"{ADDR}|ppi": True}) == 3


def test_the_render_actually_consults_the_overlay():
    """The wiring leg — and a source scan is the RIGHT instrument here, not a lapse.

    The house rule says exercise monitor.html rather than scanning it, because a scan cannot tell
    present-when-true from always-present. That reasoning is about BEHAVIOUR. This asserts a
    different thing: that the checkbox render CALLS the overlay at all. The defect being prevented is
    an absent call — the six tests above all pass against a `pendingChecked` nothing consults, exactly
    as a behavioural plant passes against a value nothing reads (Tepna #2117/#2122). An absent call is
    a wiring fact, and a scan is how you check wiring.
    """
    src = open(MON, encoding="utf-8").read()
    assert "pendingChecked(PENDING" in src, "the overlay is defined but nothing consults it — the render would still clobber"
    assert re.search(r"data-stream=.*?\$\{shown\?'checked':''\}", src), (
        "the checkbox no longer renders from the overlay result — it is back on raw server truth"
    )


def test_the_save_reaches_the_controls_that_actually_render():
    """The save must collect from where the controls ARE, not where they used to be.

    The per-device controls moved onto the device cards (`deviceSettingsBlock` → `#remembered`).
    `#setStreams` is written in exactly one place — `loadSettings` replaces it with a hint paragraph
    — so it has held no control since that move. Every `#setStreams`-scoped collector in
    `saveSettings` therefore matched NOTHING: the operator ticked a stream, pressed Save, got a
    success message, and an empty payload was submitted. Rendered, edited, never read.

    A scan is the right instrument again: this is a wiring fact (does the query reach the controls),
    not a behaviour, and a behavioural test passes against a collector that finds nothing.
    """
    src = open(MON, encoding="utf-8").read()
    save = re.search(r"async function saveSettings\(btn\)\{.*?\n\}", src, re.S)
    assert save, "saveSettings() is gone or reshaped — this test is stale, fix it"
    body = save.group(0)
    dead = re.findall(r"querySelectorAll\('#setStreams[^']*'\)", body)
    assert not dead, (
        "saveSettings still collects from #setStreams, which holds no controls since they moved to "
        f"the device cards — these match nothing and submit an empty payload: {dead}"
    )
    # And it must still be collecting the three control kinds at all — an empty selector list would
    # satisfy the assertion above while collecting nothing, which is the same bug by omission.
    for kind in ("input[type=checkbox][data-stream]", "input.sdksel", "select.ratesel"):
        assert kind in body, f"saveSettings no longer collects {kind} — the payload lost a control kind"
