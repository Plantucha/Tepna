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


def test_the_identity_line_renders_serial_and_branch_once_read():
    out = _render({"ring_serial": "2592302100", "ring_firmware": "2D010002", "ring_identity_mismatch": None})
    assert 'id="ring-identity"' in out
    assert "2592302100" in out and "2D010002" in out
    assert 'id="ring-identity-alarm"' not in out, "a matching (or unconfigured) ring shows no alarm"


def test_the_branch_code_is_NOT_labelled_firmware():
    """oxyii.py:272-278: the ring reports branch 2D010001 AND firmware 1.13.1.0 — two fields of one
    0xE1 reply — and `parse_get_info` returns the BRANCH under the key "firmware". The STATUS key
    keeps the parser's name (renaming both is residue 2026-09-02-oxyii-branchcode-named-firmware),
    but the OPERATOR must not be shown a branch code labelled as a firmware version: that is a number
    under the wrong name, on the one panel whose whole job is saying which device this is."""
    out = _render({"ring_serial": "2592302100", "ring_firmware": "2D010002"})
    assert "branch" in out
    assert "firmware <b>" not in out, "the branch code must not be drawn as the firmware version"
    assert "not the firmware version" in out, "…and the difference is stated, not merely avoided"


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


def test_the_barren_run_is_DRAWN_not_merely_forwarded():
    """Clause 2, and the reason this test exists in this shape: the count was first forwarded by
    webmon and drawn by nothing, which `find_unwired` reds as the half-wired shape (O2RING §20 — a
    field that reaches /api/state and no further is exposed to nobody). A number no surface shows is
    not restraint. Below the threshold it is a quiet line; at the threshold the alarm joins it."""
    bar = "3 consecutive connects answered the identity query and delivered no frames"
    out = _render({"ring_serial": "2592302100", "ring_barren_connects": 3, "ring_barren_alert": bar})
    assert 'id="ring-barren"' in out and ">3<" in out, f"the run is not drawn: {out!r}"
    assert 'id="ring-barren-alarm"' in out, f"the clause-2 alarm is missing: {out!r}"
    assert "3 consecutive connects" in out
    below = _render({"ring_serial": "2592302100", "ring_barren_connects": 1, "ring_barren_alert": None})
    assert 'id="ring-barren"' in below and ">1<" in below, "a below-threshold run is still a fact"
    assert "ring-barren-alarm" not in below, "…but it is not yet an alarm"


def test_a_healthy_box_draws_no_barren_line_at_all():
    """Zero is drawn as ABSENCE, not as `0`. The field is still forwarded — the count is the alarm's
    denominator — but a per-device zero on every card is a number an operator learns to skip."""
    out = _render({"ring_serial": "2592302100", "ring_barren_connects": 0, "ring_barren_alert": None})
    assert "ring-barren" not in out
    assert _render({"ring_serial": "2592302100"}) .count("ring-barren") == 0, "absent reads like zero"


def test_a_hostile_barren_alert_string_is_entity_encoded_too():
    """It is assembled from a number this box counted, but it lands in the same innerHTML sink as the
    device-supplied fields beside it, and the next thing appended to that sentence may not be ours."""
    out = _render({"ring_barren_alert": "<img src=x onerror=alert(1)>"})
    assert "<img" not in out.lower() and "&lt;img" in out
