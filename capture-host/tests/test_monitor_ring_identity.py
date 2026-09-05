# tepna-capture — tests/test_monitor_ring_identity.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The ring identity line and the §6.2 Mitigation C alarm must actually RENDER from `/api/state`.

`ring_serial` / `ring_firmware` / `ring_identity_mismatch` are forwarded by webmon since 2026-09-05; a
field forwarded and drawn by nobody is the `find_unwired` class. Same discipline as
test_monitor_ring_rtc_alarm.py: EXECUTE the shipped `renderRingIdentity(status)` under node, never scan
monitor.html for a string — a text scan cannot tell present-when-set from always-present.
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
    src = open(MON, encoding="utf-8").read()
    esc = re.search(r"^const esc = .*?;$", src, re.M)
    assert esc, "esc() is gone from monitor.html — extraction is testing nothing"
    fn = re.search(r"^function renderRingIdentity\(status\) \{.*?\n\}$", src, re.M | re.S)
    assert fn, "renderRingIdentity() is gone or reshaped — this test is stale, fix it"
    return esc.group(0), fn.group(0)


def _render(status):
    node = shutil.which("node")
    if not node:  # pragma: no cover - ubuntu-latest always has node; a dev box might not
        pytest.skip("node is not installed")
    esc_src, fn_src = _extract()
    prog = f"{esc_src}\n{fn_src}\nconsole.log(JSON.stringify(renderRingIdentity({json.dumps(status)})));"
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def test_the_identity_line_renders_serial_and_firmware_once_read():
    out = _render({"ring_serial": "2592302100", "ring_firmware": "2D010002", "ring_identity_mismatch": None})
    assert 'id="ring-identity"' in out
    assert "2592302100" in out and "2D010002" in out
    assert 'id="ring-identity-alarm"' not in out, "a matching (or unconfigured) ring shows no alarm"


def test_the_alarm_renders_with_its_id_and_the_verdict_sentence():
    mm = "connected peer reports '2592399999', config expects '2592302100'"
    out = _render({"ring_serial": "2592399999", "ring_firmware": "2D010002", "ring_identity_mismatch": mm})
    assert 'id="ring-identity-alarm"' in out, f"the alarm is missing: {out!r}"
    assert "RING IDENTITY MISMATCH" in out
    assert "2592399999" in out and "2592302100" in out, "both sides of the verdict must reach the operator"


def test_nothing_at_all_before_the_first_readback():
    """Absence contract: no serial, no firmware, no verdict ⇒ no element, no fabricated dash."""
    assert _render({"ring_serial": None, "ring_firmware": None, "ring_identity_mismatch": None}) == ""
    assert _render({}) == ""
    assert _render(None) == ""


def test_a_hostile_serial_is_entity_encoded_before_innerHTML():
    """The serial is DEVICE-SUPPLIED text — on an unbonded plaintext link, exactly the string an impostor
    controls — reaching innerHTML. It goes through esc(); a live tag must never survive."""
    out = _render({"ring_serial": "<img src=x onerror=alert(1)>", "ring_firmware": "<svg onload=1>",
                   "ring_identity_mismatch": "peer reports <script>1</script>"})
    for live in ("<img", "<svg", "<script"):
        assert live not in out.lower(), f"a live tag reached innerHTML: {out}"
    for escaped in ("&lt;img", "&lt;svg", "&lt;script&gt;"):
        assert escaped in out, f"the payload must be entity-encoded, not stripped: {out}"
