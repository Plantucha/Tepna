# tepna-capture — tests/test_monitor_power_axis.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""THE O2RING POWER AXIS REACHES AN OPERATOR, or it is not published.

`oxy_power.py` computes the axis, `capture.py` publishes a snapshot per ring into `STATUS["power"]`,
and `webmon.py` forwards it. The monitor read NONE of it until now, so the axis existed for the
daemon's own JSON and for nobody looking at the box (row
2026-11-08-the-monitor-reads-no-o2ring-power-block, from the #4267 census).

⚠️ `find_unwired.py` cannot see this class. Scan 1 counts `webmon.py` as a consumer, so forwarding a
key satisfies it, and scan 2 (`orphan_rendered`) reads the per-DEVICE projection, not a top-level
forwarded block. The scanner stays green over a block the monitor never draws, which is why this
file exists.

⚠️ The executed tests run the SHIPPED functions under `node`, which the capture box does not install,
so they SKIP there and CI is their verdict. A skip is not a pass.

🔴 Every state string in the fixtures comes from `oxy_power` itself. The Radio card next to this one
was written against a guessed vocabulary, so a real DISTRESSED verdict ranked below ok and a storm
drew as "Radio ok". A fixture that spells its own state strings would repeat that defect here.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import pytest

import oxy_power as P
from _srcscan import module_source

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_monitor_device_cards import _extract  # noqa: E402


def _snap(state=P.PowerState.ACTIVE_CAPTURE, band=P.BatteryBand.NORMAL, **over):
    """One ring's snapshot, built by the REAL engine so the key set cannot drift from the producer."""
    snap = P.RingPower("AA:BB", device_id="AA:BB").snapshot()
    snap["state"] = state.value
    snap["radio_on"] = state in P.RADIO_ON
    snap["scan_policy"] = P.scan_policy_for(state).name
    snap["cache"]["battery"] = band.value
    snap.update(over)
    return snap


def _counters(**over):
    c = P.Counters()
    for k, v in over.items():
        setattr(c, k, v)
    return c.as_dict()


CASES = {
    "absent": {},
    "null": None,
    "capture": {"ring-a": _snap()},
    "backoff": {"ring-a": _snap(state=P.PowerState.ERROR_BACKOFF)},
    "cooldown": {"ring-a": _snap(state=P.PowerState.COOLDOWN)},
    "resource_wait": {"ring-a": _snap(state=P.PowerState.RESOURCE_WAIT)},
    # A critical battery under a HEALTHY state: the night ends whatever the link does.
    "critical": {"ring-a": _snap(band=P.BatteryBand.CRITICAL)},
    "low": {"ring-a": _snap(band=P.BatteryBand.LOW)},
    # Two rings, one sick. The glance asks whether any ring is in trouble.
    "two_rings": {"ring-a": _snap(), "ring-b": _snap(state=P.PowerState.ERROR_BACKOFF)},
    "counted": {
        "ring-a": _snap(
            counters=_counters(
                connect_attempts=9,
                connect_successes=7,
                harvest_attempts=4,
                harvests_ok=3,
                connection_seconds=3720.0,
                deferrals_live=2,
                deferrals_busy=1,
            ),
            last_attempt={"trigger": "doff", "ok": False, "failure": "auth_timeout", "duration_s": 12.5},
        )
    },
    # An engine that has never seen a battery reading: the band is the producer's UNKNOWN.
    "unknown_band": {"ring-a": _snap(band=P.BatteryBand.UNKNOWN)},
    "hostile_name": {"<b>x</b>": _snap()},
}


def _verdicts():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    prog = (
        "const CASES = " + json.dumps(CASES) + ";\n" + _extract("pwDur", "powerVerdict") + "\nconst out = {};\n"
        "for (const k in CASES) out[k] = powerVerdict(CASES[k]);\n"
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


# ── the two links of the chain ───────────────────────────────────────────────────────────────────
def test_WEBMON_FORWARDS_IT():
    assert '"power": status.get("power")' in module_source("webmon.py")


def test_THE_MONITOR_DRAWS_IT():
    """The link this row is about. A forwarded block the state handler never passes on is the dead
    end moved one layer out, so both the call and the element it writes into must exist."""
    src = module_source("monitor.html")
    assert "renderPower(s.power);" in src, "forwarded but never called with the forwarded field"
    assert 'id="pwPill"' in src and 'id="pwDetail"' in src, "called but no element to write into"


def test_THE_SHELL_WRITES_TEXT_NEVER_MARKUP():
    """A ring key reaches the card, and the daemon takes it from configuration. The shell writes
    every value with textContent, so the page has no injection surface to escape."""
    src = module_source("monitor.html")
    body = src[src.index("function renderPower(") :][:900]
    # The CODE, without its comments: a comment that names innerHTML to forbid it is not a use of it.
    code = "\n".join(line.split("//")[0] for line in body.splitlines())
    assert "textContent" in code
    assert "innerHTML" not in code


# ── absence ──────────────────────────────────────────────────────────────────────────────────────
def test_AN_UNRUN_AXIS_RENDERS_NOTHING_RATHER_THAN_OK():
    """Absent is not calm. The block is null until a ring's capture task has started, and a green
    "Power ok" there would claim a state nobody measured."""
    src = module_source("monitor.html")
    body = src[src.index("function renderPower(") :][:900]
    assert "card.hidden = true" in body
    assert "never a fake ok" in src[src.index("function powerVerdict(") :][:900]
    v = _verdicts()
    assert v["absent"] is None and v["null"] is None


# ── the vocabulary ───────────────────────────────────────────────────────────────────────────────
def test_THE_SEVERITY_TABLES_HOLD_THE_PRODUCERS_VOCABULARY():
    """The defect the Radio card measured: a renderer ranked against state names its producer never
    emits scores every real verdict at zero. Each key here must be a live `oxy_power` value."""
    src = module_source("monitor.html")
    body = src[src.index("function powerVerdict(") :][:3000]
    m = re.search(r"pwSev\s*=\s*\{([^}]*)\}", body)
    mb = re.search(r"pwBattSev\s*=\s*\{([^}]*)\}", body)
    assert m and mb, "the severity order must be stated, not implied"
    states = {s.value for s in P.PowerState}
    bands = {b.value for b in P.BatteryBand}
    keys = re.findall(r"([A-Za-z_]+)\s*:", m.group(1))
    bkeys = re.findall(r"([A-Za-z_]+)\s*:", mb.group(1))
    assert keys and set(keys) <= states, (keys, sorted(states))
    assert bkeys and set(bkeys) <= bands, (bkeys, sorted(bands))


def test_THE_FIELDS_IT_READS_ARE_FIELDS_THE_PRODUCER_WRITES():
    """A renderer reading a field the snapshot never carries draws a blank and reports nothing. The
    whole set it reads is checked against the real snapshot and the real counters."""
    snap = P.RingPower("AA:BB").snapshot()
    for k in ("state", "radio_on", "scan_policy", "cache", "counters", "last_attempt"):
        assert k in snap, k
    counters = P.Counters().as_dict()
    for k in (
        "connect_attempts",
        "connect_successes",
        "harvest_attempts",
        "harvests_ok",
        "connection_seconds",
        "deferrals_live",
        "deferrals_busy",
        "deferrals_policy",
    ):
        assert k in counters, k
    assert "battery" in snap["cache"] and "generation" in snap["cache"] and "last_failure" in snap["cache"]


# ── the verdict ──────────────────────────────────────────────────────────────────────────────────
def test_A_HEALTHY_RING_READS_OK_AND_NAMES_ITS_STATE():
    v = _verdicts()["capture"]
    assert v["cls"] == "ok"
    assert v["text"].startswith("Power ok · 1 ring")
    assert "active capture" in v["text"]
    assert "battery normal" in v["detail"] and "radio on" in v["detail"]


def test_A_FAILURE_PAUSE_REDS_THE_CARD():
    v = _verdicts()["backoff"]
    assert v["cls"] == "bad"
    assert "error backoff" in v["text"]


def test_A_DELIBERATE_SILENCE_TINTS_AND_SAYS_WHICH_ONE():
    """Cooldown and resource-wait are both quiet on purpose, and an operator must be able to tell
    them from a broken link. Neither reds the card; both name themselves."""
    v = _verdicts()
    assert v["cooldown"]["cls"] == "idle" and "cooldown" in v["cooldown"]["text"]
    assert v["resource_wait"]["cls"] == "idle" and "resource wait" in v["resource_wait"]["text"]


def test_A_CRITICAL_BATTERY_OUTRANKS_A_HEALTHY_LINK():
    """The ring is capturing and the night still ends. A card that reads the link alone would draw
    this as ok."""
    v = _verdicts()
    assert v["critical"]["cls"] == "bad"
    assert "battery critical" in v["critical"]["detail"]
    assert v["low"]["cls"] == "idle" and "battery low" in v["low"]["detail"]


def test_AN_UNREADABLE_BATTERY_SAYS_UNKNOWN_RATHER_THAN_NOTHING():
    v = _verdicts()["unknown_band"]
    assert "battery unknown" in v["detail"]


def test_THE_WORST_RING_WINS_AND_THE_OTHERS_STAY_ON_HOVER():
    """One ring in backoff must not hide the other ring's band, so the title carries every ring."""
    v = _verdicts()["two_rings"]
    assert v["cls"] == "bad"
    assert "ring-b" in v["text"] and "error backoff" in v["text"]
    lines = v["title"].split("\n")
    assert len(lines) == 2
    assert any(line.startswith("ring-a:") for line in lines)
    assert any(line.startswith("ring-b:") for line in lines)


def test_EVERY_COUNT_CARRIES_ITS_DENOMINATOR_AND_THE_LAST_FAILURE_CLASS():
    """Zero failures and never tried are different states, so a count without its attempts is
    unreadable. The last attempt carries the failure class the engine typed."""
    v = _verdicts()["counted"]
    assert "connects 7/9" in v["detail"]
    assert "harvests 3/4" in v["detail"]
    assert "3 deferrals" in v["detail"]
    assert "linked 62m" in v["detail"]
    assert "last doff FAILED (auth_timeout)" in v["detail"]


def test_A_RING_KEY_CARRYING_MARKUP_STAYS_LITERAL_TEXT():
    """The verdict is text, so the key travels verbatim and the shell's textContent renders it as
    characters. Nothing escapes it, because nothing parses it."""
    v = _verdicts()["hostile_name"]
    assert "<b>x</b>" in v["title"]
    assert "&lt;" not in v["title"]
