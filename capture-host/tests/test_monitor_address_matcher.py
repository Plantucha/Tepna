# tepna-capture — tests/test_monitor_address_matcher.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""BLE identity is the ADDRESS, never the advertised name — enforced in the monitor's own UI.

Measured 2026-08-29: the Verity (ManufacturerData-only, -30 dBm), the ResMed (whose advertising
address IS the AS11's configured `ble_addr`) and the O2Ring all read as "not recognised — needs
vendor, model", while the H10 matched fine. The H10 advertises a local name and the others did not;
that difference was the whole bug.

EXECUTES the shipped JavaScript under node — a text scan cannot tell present-when-known from
always-present, and would pass against a matcher nothing reaches.
"""

import json
import os
import re
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = os.path.join(HERE, "monitor.html")

# The real configured devices, addresses as config spells them.
CFG = [
    {"name": "Wellue O2Ring-S", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S8AW2100",
     "address": "D1:98:62:7C:92:B3", "streams": ["spo2", "ppg"]},
    {"name": "Polar Verity Sense", "vendor": "Polar", "model": "VeritySense", "device_id": "0C301E3F",
     "address": "24:AC:AC:0C:30:1E", "streams": ["ppg", "acc"]},
]


def _extract():
    src = open(MON, encoding="utf-8").read()
    esc = re.search(r"^const esc = .*?;$", src, re.M)
    assert esc, "esc() is gone from monitor.html — extraction is testing nothing"
    known = re.search(r"^function knownDevice\(address\)\{.*?\n\}$", src, re.M | re.S)
    disc = re.search(r"^function renderDiscovered\(list\)\{.*?\n\}$", src, re.M | re.S)
    guess = re.search(r"^function guessDevice\(d\)\{.*?\n\}$", src, re.M | re.S)
    assert known and disc and guess, "the matcher functions are gone or reshaped — this test is stale"
    return "\n".join([esc.group(0), known.group(0), disc.group(0), guess.group(0)])


def _run(js_body, scan_list, devices=CFG):
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    prog = (
        "let __html='';\n"
        "const $ = () => ({ set innerHTML(v){ __html = v; }, get innerHTML(){ return __html; } });\n"
        f"let DEVICES = {json.dumps(devices)};\n"
        f"{js_body}\n"
        f"const LIST = {json.dumps(scan_list)};\n"
        f"{js_body_call(js_body)}\n"
    )
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return r.stdout


def js_body_call(_b):
    return "renderDiscovered(LIST); console.log(JSON.stringify({html:__html}));"


def _html(scan_list, devices=CFG):
    return json.loads(_run(_extract(), scan_list, devices))["html"]


# ── the three name dependencies ────────────────────────────────────────────────────────────────

def test_a_NAMELESS_configured_device_is_STILL_SHOWN():
    """🔴 A nameless advertisement surfaces with its MAC AS the name, which the placeholder filter
    then rejected — so a device captured every night vanished from the list entirely."""
    html = _html([{"address": "24:AC:AC:0C:30:1E", "name": "24-AC-AC-0C-30-1E", "rssi": -30}])
    assert "24:AC:AC:0C:30:1E" in html, "a configured device was hidden by the name filter"
    assert "Polar Verity Sense" in html, "the CONFIGURED name should label the row"
    assert "configured" in html


def test_a_configured_device_is_NOT_offered_for_remembering():
    """It is already remembered. Offering "Remember" is what produced the owner's error message."""
    html = _html([{"address": "D1:98:62:7C:92:B3", "name": "D1-98-62-7C-92-B3"}])
    assert "remember(" not in html, "a device already in config was offered Remember"
    assert "configured" in html


def test_an_UNKNOWN_device_still_gets_Remember():
    """The control: the fix must not make every row look configured."""
    html = _html([{"address": "AA:BB:CC:DD:EE:FF", "name": "Polar H10 02849638"}])
    assert "remember(" in html and "configured" not in html


def test_the_match_is_CASE_INSENSITIVE():
    """bluez and the config file are different sources; an exact compare on a MAC is the same defect
    one layer down."""
    html = _html([{"address": "d1:98:62:7c:92:b3", "name": "x"}])
    assert "configured" in html, "a lowercase advertisement did not match an uppercase config entry"


def test_guessDevice_answers_from_CONFIG_for_a_known_address():
    """🔴 Re-deriving vendor/model from a standby frame would overwrite a known-good entry with the
    blanks the server rejects — which IS the "needs vendor, model" the owner saw."""
    body = _extract()
    prog = (body + "\n" +
            "const d = {address:'24:AC:AC:0C:30:1E', name:'24-AC-AC-0C-30-1E'};\n"
            "console.log(JSON.stringify(guessDevice(d)));")
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    prog = f"let DEVICES = {json.dumps(CFG)};\n" + prog
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    got = json.loads(r.stdout)
    assert got["vendor"] == "Polar" and got["model"] == "VeritySense"
    assert got["device_id"] == "0C301E3F", "the MAC slice overwrote the configured device_id"


def test_guessDevice_still_GUESSES_for_an_unknown_named_device():
    """The control for the above — the name-based guessing is still the path for a new device."""
    body = _extract()
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    prog = (f"let DEVICES = {json.dumps(CFG)};\n" + body + "\n"
            "console.log(JSON.stringify(guessDevice({address:'AA:BB:CC:DD:EE:FF', name:'Polar H10 02849638'})));")
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    got = json.loads(r.stdout)
    assert got["vendor"] == "Polar" and got["model"] == "H10"


def test_an_empty_scan_and_a_missing_name_do_not_throw():
    """`d.name.match(...)` on an absent name would throw and take the WHOLE list render with it."""
    assert _html([]) == ""
    html = _html([{"address": "AA:BB:CC:DD:EE:00"}])
    assert "AA:BB:CC:DD:EE:00" not in html      # unnamed + unknown + no health: correctly not shown
    html2 = _html([{"address": "AA:BB:CC:DD:EE:01", "health": True}])
    assert "AA:BB:CC:DD:EE:01" in html2         # ...but a health advertiser still is
