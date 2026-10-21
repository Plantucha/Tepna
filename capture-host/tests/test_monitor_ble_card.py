# tepna-capture — tests/test_monitor_ble_card.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The BLE counters' CARD (`renderBle`) — the half of row `2026-09-16-ble-counters-not-drawn` that
reaches a person.

`blestats` counts the retries, `capture.status_loop` publishes the block and its windowed backoff rate,
`test_webmon_state_contract` pins the forwarding, and this file pins the drawing. The row stayed open
because the counters existed and nobody could see them; a renderer that is never asserted is the same
defect one layer up.

Four states, each a different claim, so each is planted:

* **no tick yet** — the block is absent, or carries no op. The card stays hidden. An "all ok" drawn
  from nothing is the fabricated pass §∅ forbids.
* **measuring** — the window is not yet covered, so the rate is `null` and the card says so.
* **a measured zero** — the window IS covered and held no backoff. That is a FIGURE, not an absence,
  and it is the one an operator wants the morning after a bad night. It must never read like the state
  above it.
* **over budget** — some device passed the 20/h of VIGIL-OVERNIGHT-FINDINGS P2.1 and the card is loud,
  naming the device and the rate.

`bleBudgetPerHour` is extracted for REAL rather than stubbed: it is the ONE source of the 20/h budget
in the page — the rate CURVE draws the same line (row
`2026-10-20-ble-backoff-rate-is-drawn-as-a-level-not-a-curve`) — so a stub here would let the
over-budget case below pass against a page whose two readers had drifted apart.

Runs the SHIPPED function, extracted from monitor.html, under node with `$` stubbed — the same recipe as
the live-loss and device-card tests next door, and for the same reason: the whole page cannot be
evaluated here without hitting its own `const` dead zones.
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


def _op(attempts, successes, rate, failures=None):
    return {
        "attempts": attempts,
        "successes": successes,
        "rate": rate,
        "failures": failures or {},
    }


def _rate(rate, reason=None, window_sec=3600.0):
    return {"rate": rate, "window_sec": window_sec, "observed_s": 3600.0, "reason": reason}


MEASURING = _rate(None, reason="backoff rate H10: observed 600 s of the 3600 s window")

CASES: dict[str, dict | None] = {
    "absent": None,  # before the first status tick
    "no_ops": {"ops": {}, "retries": {}, "backoff_rate": {}},  # the block exists, nothing counted
    "measuring": {
        "ops": {"connect/H10": _op(4, 4, 1.0)},
        "retries": {"H10": {"backoff": 2}},
        "backoff_rate": {"H10": MEASURING},
    },
    "measured_zero": {
        "ops": {"connect/H10": _op(4, 4, 1.0)},
        "retries": {"H10": {"backoff": 0}},
        "backoff_rate": {"H10": _rate(0.0)},
    },
    "under_budget": {
        "ops": {"connect/H10": _op(10, 9, 0.9, {"timeout": 1})},
        "retries": {"H10": {"backoff": 7}},
        "backoff_rate": {"H10": _rate(7.0)},
    },
    "over_budget": {
        "ops": {"connect/H10": _op(30, 6, 0.2, {"timeout": 24})},
        "retries": {"H10": {"backoff": 24}},
        "backoff_rate": {"H10": _rate(24.0), "VeritySense": _rate(3.0)},
    },
    "mixed": {  # one device covered, one still measuring — the pair the row asked to keep distinct
        "ops": {"connect/H10": _op(4, 4, 1.0), "link/H10": _op(0, 0, None, {"disconnect": 3})},
        "retries": {"H10": {"backoff": 1}},
        "backoff_rate": {"H10": _rate(1.0), "VeritySense": MEASURING},
    },
}

IDS = ["#bleCard", "#blePill", "#bleText", "#bleDetail"]


def _render():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    prog = (
        "const CASES = " + json.dumps(CASES) + ";\n"
        "let EL = {};\n"
        "const $ = id => EL[id];\n" + _extract("renderBle", "bleBudgetPerHour") + "\n"
        "const out = {};\n"
        "for (const k in CASES) {\n"
        "  EL = {}; for (const id of " + json.dumps(IDS) + ")\n"
        "    EL[id] = {className:'', textContent:'', title:'', hidden:false};\n"
        "  renderBle(CASES[k]);\n"
        "  out[k] = {hidden: EL['#bleCard'].hidden, cls: EL['#blePill'].className,\n"
        "            text: EL['#bleText'].textContent, det: EL['#bleDetail'].textContent,\n"
        "            title: EL['#bleDetail'].title};\n"
        "}\n"
        # The card is looked up by id, so a page that lost the markup must not throw — and the guard
        # that prevents it is the only reason an absent card is survivable rather than fatal.
        "EL = {}; renderBle(CASES.over_budget); out.no_card = 'survived';\n"
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


def test_the_card_is_hidden_until_a_tick_has_actually_COUNTED_something():
    """`ops` is the witness that `snapshot()` ran. A card drawing "no error backoff yet" from an absent
    block would report a quiet radio where in fact nobody looked (§∅: absence is null, not zero)."""
    o = _render()
    assert o["absent"]["hidden"] is True
    assert o["no_ops"]["hidden"] is True, "an empty ops map is not evidence that any op was attempted"
    assert o["no_card"] == "survived", "a page without the markup must not throw"


def test_PLANT_a_null_rate_and_a_measured_zero_do_not_read_alike_on_the_card():
    """The row's whole point, at the surface. An uncovered window has no rate; a covered window holding
    no backoff is the figure 0.0/h. Collapsing the first into the second draws a clean night over every
    daemon start, which is the alert nobody would trust twice."""
    o = _render()
    measuring, zero = o["measuring"], o["measured_zero"]
    assert measuring["text"] == "BLE counters · backoff rate measuring"
    assert zero["text"] == "BLE 0.0 backoffs/h · under the 20/h budget"
    assert measuring["text"] != zero["text"]
    assert measuring["cls"].endswith("idle") and zero["cls"].endswith("ok")
    assert "observed 600 s of the 3600 s window" in measuring["title"], (
        "the reason the rate is absent is the operator's next question — it stays reachable"
    )


def test_a_rate_OVER_the_budget_is_the_loudest_state_and_names_the_device():
    o = _render()["over_budget"]
    assert o["cls"].endswith("bad")
    assert o["text"] == "BLE 24.0 backoffs/h · H10 over the 20/h budget"
    assert "connect/H10: 6/30 attempts · timeout=24" in o["title"], "the failure classes, not just the verdict"
    assert "VeritySense: 3.0/h over 60 min" in o["title"], "the device under budget is still reported"


def test_a_rate_UNDER_the_budget_still_reaches_the_card():
    """The defect this build closed: `retry_budget_alert` spent the rate on a warning, so the box read
    identically at 0/h and at 19/h against a 20/h budget. Only the device already over budget had a
    number anyone could see."""
    o = _render()["under_budget"]
    assert o["cls"].endswith("ok") and o["text"] == "BLE 7.0 backoffs/h · under the 20/h budget"
    assert "connect/H10 9/10 90%" in o["det"] and "1 failure" in o["det"]


def test_a_failures_only_op_says_no_attempts_counted_rather_than_a_rate_of_zero():
    """`link/` and `offline_op/` only ever call `fail()`, so they have no denominator — `snapshot()`
    publishes `rate: None` and the card must not render that as 0 %."""
    o = _render()["mixed"]
    assert "link/H10 0/0 (no attempts counted)" in o["det"]
    # Not a substring search for "0%" — "100%" carries one. The failing form is the whole segment.
    assert "link/H10 0/0 0%" not in o["det"], "a missing denominator is not a rate of zero"
    assert "1 device measuring" in o["det"], "a device whose window is not covered is counted, not hidden"
    assert "VeritySense: backoff rate" in o["title"]


def test_the_monitor_calls_it_and_has_somewhere_to_write():
    """Extracting the function proves it parses, not that the page ever runs it — the
    mention-is-not-a-rendering rule the live-loss file states next door."""
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "monitor.html"), encoding="utf-8").read()
    assert "\n  renderBle(s.ble);" in src, "the dispatcher must call it on every poll"
    for ident in IDS:
        assert f'id="{ident[1:]}"' in src, f"{ident} has no element to write into"
