# tepna-capture — tests/test_monitor_absence.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The monitor states what it could not read (Muse hunt record M-4 to M-7).

Four places drew an unread or old value as a current one: a page whose poll fails after boot, a battery level
from a device that is not connected, a night index that did not load, and a CPAP state the page does not know.
Every test runs the SHIPPED source out of monitor.html under node; nothing here is a copy of it."""

import json
import os
import re
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(os.path.join(HERE, "monitor.html"), encoding="utf-8").read()

# A DOM just wide enough for the functions under test: every selector yields one persistent element.
_DOM = """
const _els = {};
const _mk = () => { const cls = new Set(), at = {}; return {innerHTML:'', textContent:'', style:{setProperty(){}}, at, cls,
  classList:{add:c=>cls.add(c), remove:c=>cls.delete(c)},
  setAttribute:(k,v)=>{at[k]=v}, removeAttribute:k=>{delete at[k]}}; };
const $ = sel => (_els[sel] = _els[sel] || _mk());
const document = {body:_mk(), querySelectorAll:()=>[]};
"""


def _one(pattern, flags=re.M | re.S):
    m = re.search(pattern, SRC, flags)
    assert m, f"{pattern!r} is gone from monitor.html — extraction is testing nothing"
    return m.group(0)


def _fn(name):
    """A multi-line top-level function, brace column 0 to brace column 0."""
    return _one(r"^(?:async )?function %s\(.*?^\}" % re.escape(name))


ESC = _one(r"^const esc = .*?;$")


def _node(prog):
    node = shutil.which("node")
    if not node:  # pragma: no cover
        pytest.skip("node is not installed")
    r = subprocess.run([node, "-e", _DOM + ESC + prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


# ── M-4 · the poll after boot ────────────────────────────────────────────────────────────────────────

CONN = _one(r"^function hms\(.*?$", re.M) + "\n" + _one(r"^const STATE_STALE_MS.*?(?=^setInterval\(tick)")
_CONN_STUBS = """
let NOW = Date.UTC(2026, 0, 2, 3, 4, 5); Date.now = () => NOW;
let reply = async () => ({});
const api = () => reply();
async function loadState(){ await fetchState(); if(globalThis.RENDER_THROWS) throw new Error('render'); $('#connText').textContent = '3 streams live'; $('#connPill').classList.remove('idle'); }
const seen = () => ({conn: document.body.at['data-conn'] ?? null, at: document.body.at['data-conn-at'] ?? null, text: $('#connText').textContent, idle: $('#connPill').cls.has('idle')});
const down = async () => { throw new TypeError('Failed to fetch'); };
"""


def _conn(body):
    return _node(
        CONN + _CONN_STUBS + "(async () => { const out = [];" + body + "console.log(JSON.stringify(out)); })();"
    )


def test_a_failed_poll_after_a_good_one_says_so_and_the_next_good_one_clears_it():
    good, lost, back = _conn(
        "await pollState(); out.push(seen());"
        "reply = down; await pollState(); out.push(seen());"
        "reply = async () => ({}); await pollState(); NOW += 1000; paintConn(); out.push(seen());"
    )
    assert good["conn"] is None and good["text"] == "3 streams live" and not good["idle"]
    assert lost["conn"] == "lost" and lost["idle"]
    assert lost["text"].startswith("No answer from the box · last state ") and lost["text"].endswith(lost["at"])
    assert re.fullmatch(r"\d\d:\d\d:\d\d", lost["at"])
    assert back["conn"] is None and back["text"] == "3 streams live" and not back["idle"]


def test_the_stated_time_is_the_last_GOOD_poll_not_the_failure():
    first, later = _conn(
        "await pollState(); NOW += 5000; reply = down; await pollState(); out.push(seen());"
        "NOW += 60000; await pollState(); out.push(seen());"
    )
    assert first["at"] == later["at"] and first["at"].endswith(":04:05")


def test_a_poll_that_never_returns_is_lost_after_15_s_and_not_before():
    at15, past = _conn(
        "await pollState(); reply = () => new Promise(() => {}); pollState();"
        "NOW += 15000; paintConn(); out.push(seen()); NOW += 1; paintConn(); out.push(seen());"
    )
    assert at15["conn"] is None and past["conn"] == "lost"


def test_before_the_first_good_poll_the_boot_banner_owns_the_page():
    (seen,) = _conn("reply = down; try{ await loadState(); out.push('no throw'); }catch(_){ out.push(seen()); }")
    assert seen["conn"] is None, "fetchState re-throws to the boot retry and paints nothing before a first state"


def test_a_render_fault_is_not_reported_as_an_unanswered_box():
    got = _conn(
        "await pollState(); globalThis.RENDER_THROWS = true;"
        "let threw = null; try{ await pollState(); }catch(e){ threw = e.message; } out.push(threw, seen());"
    )
    assert got[0] == "render" and got[1]["conn"] is None


def test_every_repeating_poll_has_the_failure_path_and_the_banner_has_its_reader():
    assert "setInterval(loadState" not in SRC and SRC.count("setInterval(pollState") == 2
    assert 'body[data-conn="lost"]::before' in SRC and "attr(data-conn-at)" in SRC
    assert "paintConn();" in _one(r"^function tick\(.*?$", re.M)
    assert "await fetchState()" in _fn("loadState") and "api('/api/state')" not in _fn("loadState")


# ── M-5 · the Batteries card ─────────────────────────────────────────────────────────────────────────

BATT = _fn("battAsOf")


def _as_of(dev, h):
    return _node(BATT + f"console.log(JSON.stringify(battAsOf({json.dumps(dev)}, {json.dumps(h)})));")


H = {"last": 30, "points": [[1767261600000, 80], [1767348000000, 30]]}  # floating 2026-01-01 10:00, 01-02 10:00


def test_a_connected_level_carries_no_stamp():
    assert _as_of({"connected": True, "battery": 100}, H) == ""


@pytest.mark.parametrize(
    "dev",
    [
        {"connected": False, "battery": 30},  # the daemon keeps the last level after the link drops
        {"connected": True, "battery": None},  # linked, not read yet: the number on the card is the history's
        None,  # a device that is in the log and no longer in the roster
    ],
)
def test_a_level_that_is_not_live_names_the_hour_it_was_read(dev):
    assert _as_of(dev, H) == "last read 2026-01-02 10:00–10:59"


@pytest.mark.parametrize("h", [None, {"points": []}, {}])
def test_a_level_with_no_logged_hour_says_that(h):
    assert _as_of({"connected": False, "battery": 30}, h) == "not connected · time of this reading not recorded"


def test_the_stamp_is_drawn_in_the_row_and_escaped():
    prog = (
        "let BH = {devices:{'H10-01':" + json.dumps({**H, "d24": None}) + "}};"
        "const DEVICES = [{name:'H10-01', connected:false, battery:30, battery_alert:{pct:'<b>', at:'x'}}];"
        "const battChip = p => 'CHIP'+p, battSpark = () => '';"
    )
    out = _node(
        prog
        + BATT
        + "\n"
        + _fn("renderBatt")
        + "\nrenderBatt(); console.log(JSON.stringify($('#battList').innerHTML));"
    )
    assert "CHIP30" in out and "last read 2026-01-02 10:00–10:59 · alerted &lt;b&gt; % · x" in out


# ── M-6 · the Nights index ───────────────────────────────────────────────────────────────────────────

# renderNights' own empty branch, up to the first line that needs rows.
NIGHTS = (
    _one(r"^let NIGHTS = null.*?$", re.M)
    + "\n"
    + _one(r"^function renderNights\(\)\{.*?(?=^  const rows=)")
    + "  DRAWN++; }\n"
    + _one(r"^let nightsPoll.*?^\}$(?=\n// THE LOAD)")
)
_NIGHT_STUBS = """
let VIEW = 'nights', DRAWN = 0, toasts = 0, timer = null, reply;
const nToast = () => { toasts++; };
const clearTimeout = () => { timer = null; }, setTimeout = (f, ms) => { timer = {f, ms}; return 1; };
const ok = (j) => async () => ({json: async () => j});
const bad = async () => { throw new Error('down <b>'); };
const fetch = () => reply();
const seen = () => ({html: $('#nightsTable').innerHTML, toasts, drawn: DRAWN, ms: timer && timer.ms, n: NIGHTS && NIGHTS.length});
"""


def _nights(body):
    return _node(
        _NIGHT_STUBS + NIGHTS + "\n(async () => { const out = [];" + body + "console.log(JSON.stringify(out)); })();"
    )


def test_an_index_that_was_not_read_is_never_no_nights_on_disk():
    first, again, back = _nights(
        "reply = bad; await loadNights(); out.push(seen());"
        "await timer.f(); out.push(seen());"
        "reply = ok({nights:[], pending:0}); await timer.f(); out.push(seen());"
    )
    for s in (first, again):
        assert "no nights on disk" not in s["html"]
        assert "the night index was not read: down &lt;b&gt; · trying again" in s["html"]
        assert s["ms"] == 10000 and s["n"] is None
    assert first["toasts"] == again["toasts"] == 1, "one toast per outage, not one per retry"
    assert "no nights on disk" in back["html"] and back["ms"] is None, "read, and empty: now the claim is true"


def test_an_error_body_from_the_box_is_an_unread_index_too():
    (s,) = _nights("reply = ok({error:'RuntimeError: disk gone'}); await loadNights(); out.push(seen());")
    assert "RuntimeError: disk gone" in s["html"] and "no nights on disk" not in s["html"]


def test_a_failed_pending_poll_keeps_the_nights_already_drawn():
    good, lost, back = _nights(
        "reply = ok({nights:[{}], pending:2}); await loadNights(); out.push(seen());"
        "reply = bad; await timer.f(); out.push(seen());"
        "reply = ok({nights:[{},{}], pending:0}); await timer.f(); out.push(seen());"
    )
    assert good["n"] == 1 and good["ms"] == 4000
    assert lost["n"] == 1 and lost["drawn"] == 2 and lost["ms"] == 4000 and lost["toasts"] == 1
    assert back["n"] == 2 and back["ms"] is None


def test_the_retry_stops_when_the_operator_leaves_the_view():
    (s,) = _nights("VIEW = 'overview'; reply = bad; await loadNights(); out.push(seen());")
    assert s["ms"] is None


# ── M-7 · the CPAP states ────────────────────────────────────────────────────────────────────────────

LABEL = _fn("cpapStatusLabel")


def _label(c):
    return _node(LABEL + f"console.log(JSON.stringify(cpapStatusLabel({json.dumps(c)})));")


def test_an_unknown_cpap_state_is_a_warning_that_names_it():
    assert _label({"state": "rebooting"}) == ["warn", 'state "rebooting" is not known to this page']
    assert _label({}) == ["warn", 'state "not stated" is not known to this page']
    assert _label({"state": "constructor"})[0] == "warn", "an inherited key is not a known state"


def test_idle_states_the_hour_it_was_given_and_never_a_default():
    assert _label({"state": "idle", "at_hour": 9}) == ["idle", "idle · next run 09:00"]
    assert _label({"state": "idle", "at_hour": 0}) == ["idle", "idle · next run 00:00"]
    assert _label({"state": "idle"}) == ["idle", "idle · next run time not stated"]


def test_the_spool_line_names_an_unknown_state_and_keeps_idle_quiet():
    prog = _fn("renderCpapSpool")
    got = lambda s: _node(  # noqa: E731
        prog + f"\nrenderCpapSpool({json.dumps(s)}); console.log(JSON.stringify($('#cpapSpoolStatus').innerHTML));"
    )
    assert "data-pill idle" in got({"state": "idle"}) and "spool pull · idle" in got({"state": "idle"})
    odd = got({"state": "<i>"})
    assert "data-pill warn" in odd and "state &quot;&lt;i&gt;&quot; is not known to this page" in odd


def test_the_overview_tile_does_not_call_an_unknown_state_idle():
    tile = _one(r"^    const \[ccls, clabel\] = cpapStatusLabel\(cpap\);.*?$.*?\[cpap\.state\][^\n]*$")
    assert "|| 'Idle'" not in tile and "|| 'Unknown'" in tile and "idle:'Idle'" in tile
