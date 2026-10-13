# tepna-capture — tests/test_monitor_probe_night.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The PROBE-NIGHT chip and its toggle (`renderProbeNight`, `toggleProbeNight`) — the operator's half
of SOLID-NIGHT-COWEAR-AND-PROBE §2.

The declaration is the only input to the judge that no measurement can supply: a night was testing
because a person says it was, or because the daemon armed the heap probe. So the button and the chip
ARE the feature on this side, and `find_unwired`'s scan cannot be their guard — `probe_armed` and
`marker_on` are forwarded keys, and a page that never drew them would still satisfy a word search.

Runs the SHIPPED functions, extracted from monitor.html under node with `$` and `fetch` stubbed — the
recipe of `test_monitor_solid_night.py` next door.

Two properties here are the ones a wrong chip would hide, and both are §∅ cases:
  · `marker_on: null` is "nobody pressed the button for this night", NOT off;
  · `journal_armed: null` is "no audit has read the journal", NOT "no probe armed".
"""

import json
import os
import re
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_monitor_device_cards import MON, _extract  # noqa: E402


def _extract_async(*names):
    """The named top-level `async function`s, as source. `_extract` matches `function` at the margin
    and these three are async, so the pattern is spelled out here rather than loosening that helper for
    every other test that uses it."""
    src = open(MON, encoding="utf-8").read()
    out = []
    for n in names:
        m = re.search(r"^async function " + n + r"\(.*?\n\}$", src, re.M | re.S)
        assert m, f"{n}() is gone or reshaped in monitor.html — this test is stale, fix it"
        out.append(m.group(0))
    return "\n".join(out)


def _run(prog, body):
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    r = subprocess.run([node, "-e", body + "\n" + prog], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return r.stdout


_STUB = (
    "const __els = {};\n"
    "const __mk = () => ({textContent:'', title:'', hidden:false, disabled:false});\n"
    "const $ = sel => (__els[sel] = __els[sel] || __mk());\n"
)


def _render(pn):
    """`renderProbeNight(pn)` over one block; returns the chip's text, title and button state."""
    prog = (
        _STUB
        + f"renderProbeNight({json.dumps(pn)});\n"
        + "console.log(JSON.stringify({text: $('#pnDetail').textContent, title: $('#pnDetail').title,"
        "  label: $('#pnBtn').textContent, hidden: $('#pnBtn').hidden}));\n"
    )
    return json.loads(_run(prog, _extract("renderProbeNight")))


# One case per state the endpoint can report. Every night date distinct, so a chip that printed a
# constant could not pass.
def test_absent_block_draws_nothing_and_hides_the_button():
    """No block at all — before the first `/api/probe-night` answer. A button that offered to mark a
    night the page has not resolved would write the WRONG night's marker."""
    got = _render(None)
    assert got["text"] == ""
    assert got["hidden"] is True


def test_an_error_is_named_and_the_button_stays_hidden():
    got = _render({"error": "no night folder"})
    assert "no night folder" in got["text"]
    assert got["hidden"] is True


def test_an_undeclared_night_offers_to_mark_it():
    got = _render(
        {
            "night": "2026-10-11",
            "on": False,
            "source": None,
            "at": None,
            "reason": None,
            "marker_on": None,
            "journal_armed": False,
            "error": None,
        }
    )
    assert "2026-10-11" in got["text"]
    assert "judged as a night" in got["text"]
    assert got["label"] == "Mark probe night"
    assert got["hidden"] is False
    # §∅: the untouched toggle is SAID, not silently read as an off.
    assert "no button press for this night" in got["text"]


def test_a_monitor_declared_night_offers_to_clear_it():
    got = _render(
        {
            "night": "2026-10-12",
            "on": True,
            "source": "monitor",
            "at": "2026-10-12T21:04:00",
            "reason": "probe night: declared by monitor toggle at 2026-10-12T21:04:00",
            "marker_on": True,
            "journal_armed": False,
            "error": None,
        }
    )
    assert "probe night" in got["text"]
    assert "marked on the monitor" in got["text"]
    assert "2026-10-12T21:04:00" in got["text"]
    assert got["label"] == "Clear probe night"
    assert got["title"].startswith("probe night: declared by monitor toggle")


def test_a_journal_armed_night_says_the_button_cannot_withdraw_it():
    """🔴 THE CASE THE CHIP EXISTS FOR. The daemon armed the heap probe, so the night is declared
    whatever the toggle says; a chip that showed only the toggle would read as off and an operator
    would believe the night was being judged."""
    got = _render(
        {
            "night": "2026-10-13",
            "on": True,
            "source": "journal",
            "at": "2026-10-13T18:36:15",
            "reason": "probe night: declared by journal heap-probe ARMED at 2026-10-13T18:36:15",
            "marker_on": False,
            "journal_armed": True,
            "error": None,
        }
    )
    assert "the daemon armed the heap probe" in got["text"]
    assert "the button is off, and the armed probe still declares it" in got["text"]
    assert "2026-10-13T18:36:15" in got["text"]
    assert got["label"] == "Mark probe night"


def test_an_unread_journal_is_not_no_probe():
    """§∅ again, the other null: `journal_armed: null` means no audit has looked."""
    got = _render(
        {
            "night": "2026-10-10",
            "on": False,
            "source": None,
            "at": None,
            "reason": None,
            "marker_on": False,
            "journal_armed": None,
            "error": None,
        }
    )
    assert "no audit has read the journal yet" in got["text"]
    assert "no button press" not in got["text"]  # the button WAS pressed, and withdrawn


def test_a_declaration_with_no_source_still_names_the_night():
    """A block that says `on` and names no source — the field is forwarded, so the chip must not
    depend on it to say the night is a probe night."""
    got = _render(
        {
            "night": "2026-10-09",
            "on": True,
            "source": None,
            "at": None,
            "reason": None,
            "marker_on": True,
            "journal_armed": False,
            "error": None,
        }
    )
    assert "2026-10-09: probe night" in got["text"]
    assert got["label"] == "Clear probe night"


def _toggle(initial, reply, status=200):
    """`toggleProbeNight` against a stubbed `fetch`; returns the posted body and the chip after it."""
    prog = (
        _STUB
        + f"let PROBE_NIGHT = {json.dumps(initial)};\n"
        + "let __sent = null;\n"
        + "const fetch = async (url, opt) => { __sent = {url, body: JSON.parse(opt.body), "
        f"  method: opt.method}}; return {{ok: {str(status == 200).lower()}, status: {status},"
        f"  json: async () => ({json.dumps(reply)})}}; }};\n"
        + "toggleProbeNight($('#pnBtn')).then(() => console.log(JSON.stringify({sent: __sent,"
        "  text: $('#pnDetail').textContent, label: $('#pnBtn').textContent,"
        "  disabled: $('#pnBtn').disabled})));\n"
    )
    return json.loads(_run(prog, _extract("renderProbeNight") + "\n" + _extract_async("toggleProbeNight")))


_ON_BLOCK = {
    "night": "2026-10-12",
    "on": True,
    "source": "monitor",
    "at": "2026-10-12T21:04:00",
    "reason": "r",
    "marker_on": True,
    "journal_armed": False,
    "error": None,
}
_OFF_BLOCK = dict(_ON_BLOCK, on=False, source=None, at=None, reason=None, marker_on=False)


def test_the_toggle_posts_the_opposite_of_the_marker_not_of_the_declaration():
    """🔴 THE OTHER HALF OF THE JOURNAL CASE. With a journal-armed night whose toggle is off, the
    button must ask for `on: true` — asking for `false` would write a withdrawal of a statement nobody
    made and leave the operator pressing a button that never changes anything."""
    got = _toggle(
        dict(_OFF_BLOCK, on=True, source="journal", journal_armed=True), {"ok": True, "probe_night": _ON_BLOCK}
    )
    assert got["sent"]["body"] == {"on": True}
    assert got["sent"]["method"] == "POST"
    assert got["sent"]["url"] == "/api/probe-night"


def test_the_toggle_withdraws_a_marked_night():
    got = _toggle(_ON_BLOCK, {"ok": True, "probe_night": _OFF_BLOCK})
    assert got["sent"]["body"] == {"on": False}
    assert "judged as a night" in got["text"]
    assert got["label"] == "Mark probe night"
    assert got["disabled"] is False  # re-enabled by the re-render, or the button is dead after one press


def test_the_toggle_draws_the_servers_refusal():
    got = _toggle(_OFF_BLOCK, {"ok": False, "error": "no night folder to mark"}, status=404)
    assert "no night folder to mark" in got["text"]


def test_a_reply_without_a_block_is_an_error_not_a_silent_success():
    got = _toggle(_OFF_BLOCK, {"ok": True}, status=200)
    assert "HTTP 200" in got["text"] or "probe night" not in got["text"]


def test_the_page_polls_the_endpoint():
    """The chip has to refresh without a reload: the daemon can arm a probe at any restart, and
    another operator's press must appear here."""
    src = open(MON, encoding="utf-8").read()
    assert "loadProbeNight()" in src
    assert re.search(r"setInterval\(loadProbeNight,\s*\d+\)", src), "the probe chip is never refreshed"
    assert re.search(r"onclick='toggleProbeNight\(this\)'", src), "the button is not wired"


def test_the_loader_reports_a_failed_fetch_rather_than_leaving_the_last_answer():
    prog = (
        _STUB
        + "let PROBE_NIGHT = null;\n"
        + "const fetch = async () => { throw new Error('boom'); };\n"
        + "loadProbeNight().then(() => console.log(JSON.stringify({text: $('#pnDetail').textContent,"
        "  on: PROBE_NIGHT})));\n"
    )
    got = json.loads(_run(prog, _extract("renderProbeNight") + "\n" + _extract_async("loadProbeNight")))
    assert "boom" in got["text"]
    assert got["on"]["error"] == "boom"


def test_the_loader_reports_a_non_ok_status():
    prog = (
        _STUB
        + "let PROBE_NIGHT = null;\n"
        + "const fetch = async () => ({ok: false, status: 503, json: async () => ({})});\n"
        + "loadProbeNight().then(() => console.log(JSON.stringify({text: $('#pnDetail').textContent})));\n"
    )
    got = json.loads(_run(prog, _extract("renderProbeNight") + "\n" + _extract_async("loadProbeNight")))
    assert "HTTP 503" in got["text"]


def test_the_loader_draws_the_block_it_fetched():
    prog = (
        _STUB
        + "let PROBE_NIGHT = null;\n"
        + f"const fetch = async () => ({{ok: true, status: 200, json: async () => ({json.dumps(_ON_BLOCK)})}});\n"
        + "loadProbeNight().then(() => console.log(JSON.stringify({text: $('#pnDetail').textContent})));\n"
    )
    got = json.loads(_run(prog, _extract("renderProbeNight") + "\n" + _extract_async("loadProbeNight")))
    assert "2026-10-12: probe night" in got["text"]


def test_the_chip_and_the_button_are_in_the_solid_night_card():
    """The declaration belongs beside the verdict it overrides, not in a settings pane."""
    src = open(MON, encoding="utf-8").read()
    card = src[src.index('id="snCard"') :]
    card = card[: card.index("</div>\n    </div>") if "</div>\n    </div>" in card else 4000]
    assert 'id="pnDetail"' in card
    assert 'id="pnBtn"' in card
