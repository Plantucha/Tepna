# tepna-capture — tests/test_monitor_live_loss.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The live loss guard's CARD (`renderLiveLoss`) — the last link of the chain.

`writers.live_loss_check` finds the loss, `capture.status_loop` publishes it and
`test_webmon_state_contract` pins the forwarding. This is the half that reaches a person: a guard whose
only channel is a log line is the defect this unit was written to close, one layer up.

Three states, and each is a different claim, so each is planted here: a loss happening NOW (bad), a loss
that happened earlier tonight and is no longer in `findings` (warn — a file lost at 02:00 is still the
night's fact at 08:00), and the RESTING state (ok, with the count of files being watched — a guard that
only ever appears when it fires is indistinguishable from one that never runs).

Runs the SHIPPED function, extracted from monitor.html, under node with `$` stubbed — the same recipe
as the device-card and OxyII-chip tests next door, and for the same reason: the whole page cannot be
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

MISSING = {
    "path": "/srv/captures/2026-09-22/Polar_H10_0284_ECG.txt",
    "kind": "missing",
    "detail": "FileNotFoundError: [Errno 2]",
    "was": 81_920,
}
SHRANK = {
    "path": "/srv/captures/2026-09-22/Wellue_O2Ring_S8AW_PPG.txt",
    "kind": "shrank",
    "detail": "81920 → 10 bytes",
    "was": 81_920,
    "now": 10,
}

CASES: dict[str, dict | None] = {
    "absent": None,  # before the guard has run once
    "never_ran": {"findings": [], "open_files": None},  # same shape, no observation yet
    "resting": {"findings": [], "open_files": 4},
    "one_open": {"findings": [], "open_files": 1},
    "now": {
        "findings": [MISSING, SHRANK],
        "open_files": 2,
        "last": [MISSING, SHRANK],
        "last_at": "2026-09-22T02:14:03",
    },
    "earlier": {"findings": [], "open_files": 4, "last": [MISSING], "last_at": "2026-09-22T02:14:03"},
}


def _render():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    prog = (
        "const CASES = " + json.dumps(CASES) + ";\n"
        "let EL = {};\n"
        "const $ = id => EL[id];\n" + _extract("renderLiveLoss") + "\n"
        "const out = {};\n"
        "for (const k in CASES) {\n"
        "  EL = {}; for (const id of ['#llCard','#llPill','#llText','#llDetail'])\n"
        "    EL[id] = {className:'', textContent:'', title:'', hidden:false};\n"
        "  renderLiveLoss(CASES[k]);\n"
        "  out[k] = {hidden: EL['#llCard'].hidden, cls: EL['#llPill'].className,\n"
        "            text: EL['#llText'].textContent, det: EL['#llDetail'].textContent,\n"
        "            title: EL['#llDetail'].title};\n"
        "}\n"
        # The card is looked up by id, so a page that lost the markup must not throw — and must not
        # silently draw nowhere either. `$` returning undefined is exactly that case.
        "EL = {}; renderLiveLoss(CASES.now); out.no_card = 'survived';\n"
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


def test_the_card_is_hidden_until_the_guard_has_actually_LOOKED():
    """`open_files` is the witness that a pass ran. A card that renders "Files ok" from an absent block
    would be the fabricated pass this whole unit exists to prevent (§∅: absence is null, not zero)."""
    o = _render()
    assert o["absent"]["hidden"] is True
    assert o["never_ran"]["hidden"] is True, "an empty findings list is not evidence that anything was checked"


def test_the_RESTING_state_says_how_many_files_are_being_watched():
    o = _render()["resting"]
    assert o["hidden"] is False and o["cls"].endswith("ok")
    assert o["text"] == "Files ok · 4 open"
    assert "4 files watched since this run started" in o["det"], (
        "the denominator is the point: a guard that shows nothing when clean cannot be told from a blind one"
    )
    assert _render()["one_open"]["det"].startswith("1 file watched"), "singular, not '1 files'"


def test_a_loss_HAPPENING_NOW_is_the_loudest_state_and_names_the_files():
    o = _render()["now"]
    assert o["cls"].endswith("bad") and o["text"] == "FILE LOST · 2"
    assert "missing Polar_H10_0284_ECG.txt" in o["det"] and "shrank Wellue_O2Ring_S8AW_PPG.txt" in o["det"]
    assert "81920 → 10 bytes" in o["det"], "the numbers, not just the verdict"
    assert "/srv/captures/2026-09-22/Polar_H10_0284_ECG.txt" in o["title"], "the full path stays reachable"


def test_a_loss_EARLIER_TONIGHT_survives_the_findings_list_going_clean():
    """The failure this state exists for: the next status round finds nothing wrong — because the file
    is already gone — and a card keyed on `findings` alone would go green over a lost night."""
    o = _render()["earlier"]
    assert o["cls"].endswith("warn") and o["text"] == "Lost earlier · 1"
    assert "2026-09-22T02:14:03" in o["det"] and "missing Polar_H10_0284_ECG.txt" in o["det"]
    assert "4 open now" in o["det"], "what is open NOW is a different fact from what was lost"


def test_the_monitor_calls_it_and_has_somewhere_to_write():
    """The mention-is-not-a-rendering rule (test_autopull_drain_and_evidence, same file's lesson):
    extracting the function proves it parses, not that the page ever runs it."""
    src = open(
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "monitor.html"), encoding="utf-8"
    ).read()
    assert "renderLiveLoss(s.live_loss)" in src, "forwarded and never called"
    assert 'id="llPill"' in src and 'id="llDetail"' in src, "called with nothing to write into"


def test_a_page_without_the_card_does_not_throw():
    assert _render()["no_card"] == "survived"
