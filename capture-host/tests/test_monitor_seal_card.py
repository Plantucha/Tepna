# tepna-capture — tests/test_monitor_seal_card.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The night-seal card (CAPTURE-NIGHT-SEAL §13), by EXECUTING the shipped `renderSealStatus`.

`capture.py` publishes `STATUS["seal"]` in three distinguishable states and `webmon.state()` forwarded
none of them, so `STATE.seal` was null on every box: the card printed "off — seal.enabled is false" on
an ARMED one and both §13 operator actions — re-display a lost card, rotate a stolen one — stayed
disabled. The endpoints themselves read `status` directly and always worked, which is why no error
reached a log. `tests/test_webmon_state_contract.py` pins the forwarding; this file pins the card.

What must hold here, following test_monitor_boxhealth_tiles.py's discipline of running the shipped
JavaScript rather than scanning it:

* the three states render as three different things, and the button pair follows `armed` alone;
* an ABSENT block names the absence and BOTH states that produce it. The daemon writes no block when
  `seal.enabled` is false and also before the poller arms, and this surface cannot tell them apart, so
  it may not assert either one;
* server-derived text (`error`, `box_id`, a night name) is entity-encoded before it reaches innerHTML —
  the stored-XSS path test_monitor_escaping.py pins for the Devices card, at a third sink.

⚠️ These run the SHIPPED function under `node`, which is NOT installed on the capture box, so they SKIP
there and CI is their verdict. A skip is not a pass.
"""

import json
import os
import re
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = os.path.join(HERE, "monitor.html")

PAYLOAD = "<img src=x onerror=alert(1)>"


def _extract():
    """`esc` and `renderSealStatus` as executable source.

    ⚠️ A function `renderSealStatus` CALLS must be listed here or the render dies with a ReferenceError
    rather than a wrong answer."""
    src = open(MON, encoding="utf-8").read()
    m = re.search(r"^const esc = .*?;$", src, re.M)
    assert m, "esc() is gone from monitor.html — extraction is testing nothing"
    out = [m.group(0)]
    for name in ("renderSealStatus",):
        fn = re.search(r"^function %s\(.*?^\}" % re.escape(name), src, re.M | re.S)
        assert fn, f"{name}() not found in monitor.html — extraction is testing nothing"
        out.append(fn.group(0))
    return "\n".join(out)


# The card's three DOM nodes, stubbed: the function writes one innerHTML and two `disabled` flags.
_STUB = """
const els = {'#stSeal':{innerHTML:''}, '#sealShowCard':{disabled:null}, '#sealRotate':{disabled:null}};
const $ = sel => els[sel];
"""


def _card(seal_js):
    """Render the card for `STATE = {seal: <seal_js>}` and return html + both button flags."""
    node = shutil.which("node")
    if not node:  # pragma: no cover - ubuntu-latest always has node; the capture box has none
        pytest.skip("node is not installed")
    prog = (
        _extract()
        + _STUB
        + f"const STATE = {{seal: {seal_js}}};\n"
        + "renderSealStatus();\n"
        + "console.log(JSON.stringify({html: els['#stSeal'].innerHTML, "
        + "show: els['#sealShowCard'].disabled, rotate: els['#sealRotate'].disabled}));"
    )
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


ARMED = (
    "{armed:true, box_id:'vigil', key_id:3, fingerprint:'ab:cd', outbox:'/srv/tepna/outbox', "
    "consent:true, nights:{'2026-11-05':{status:'PASS', revision:2}, '2026-11-06':{status:'FAIL'}}}"
)


def test_an_absent_seal_block_names_the_absence_and_not_one_invented_cause():
    """§∅ applied to this card: the daemon writes no block when `seal.enabled` is false AND before the
    poller arms, so a surface that cannot separate them states both."""
    out = _card("null")
    assert "no seal block" in out["html"], out["html"]
    assert "seal.enabled" in out["html"], "the likelier of the two states is still named"
    assert "has not armed yet" in out["html"], "the other state is named too, so neither is asserted"
    assert not out["html"].startswith("off"), "the old text claimed one cause it could not observe"


def test_an_absent_block_disables_both_operator_actions():
    out = _card("null")
    assert out["show"] is True and out["rotate"] is True


def test_a_REFUSED_seal_says_not_armed_and_carries_sealbox_own_reason():
    out = _card("{armed:false, error:'key dir is not writable'}")
    assert "not armed" in out["html"] and "key dir is not writable" in out["html"]
    assert "no seal block" not in out["html"], "a published refusal is not an absence"
    assert out["show"] is True and out["rotate"] is True, "nothing to show or rotate while it never armed"


def test_an_ARMED_seal_states_the_box_the_key_and_the_outbox():
    out = _card(ARMED)
    for frag in ("vigil", "card key", "3", "ab:cd", "/srv/tepna/outbox"):
        assert frag in out["html"], f"{frag!r} absent from {out['html']!r}"
    assert "no seal block" not in out["html"]


def test_an_ARMED_seal_ENABLES_both_operator_actions():
    """The defect this file exists for: on an armed box both buttons read disabled, because the card
    never saw the block that arms them."""
    out = _card(ARMED)
    assert out["show"] is False and out["rotate"] is False


def test_each_sealed_night_keeps_its_own_verdict_word():
    out = _card(ARMED)
    assert "2026-11-05" in out["html"] and "PASS" in out["html"]
    assert "2026-11-06" in out["html"] and "FAIL" in out["html"]
    assert "r2" in out["html"], "a re-issued seal states its revision"


def test_an_armed_box_with_no_settled_night_says_so_rather_than_drawing_nothing():
    out = _card("{armed:true, box_id:'vigil', key_id:1, fingerprint:'ab', outbox:'/o', consent:null, nights:{}}")
    assert "no settled night sealed yet" in out["html"]
    assert "not asked" in out["html"], "an unasked consent is not a false one"


def test_a_sealbox_error_cannot_inject_a_tag_into_the_card():
    out = _card("{armed:false, error:%s}" % json.dumps("refused: " + PAYLOAD))
    assert "<img" not in out["html"].lower(), f"a live tag reached the seal card: {out['html']}"
    assert "&lt;img" in out["html"], "the payload must be entity-encoded, not stripped"


def test_a_box_id_cannot_inject_a_tag_into_the_card():
    out = _card("{armed:true, box_id:%s, key_id:1, fingerprint:'ab', outbox:'/o', nights:{}}" % json.dumps(PAYLOAD))
    assert "<img" not in out["html"].lower(), f"a live tag reached the seal card: {out['html']}"
    assert "&lt;img" in out["html"]


def test_a_night_name_cannot_inject_a_tag_into_the_card():
    seal = "{armed:true, box_id:'v', key_id:1, fingerprint:'ab', outbox:'/o', nights:{%s:{status:'PASS'}}}" % (
        json.dumps(PAYLOAD)
    )
    out = _card(seal)
    assert "<img" not in out["html"].lower(), f"a live tag reached the seal card: {out['html']}"
    assert "&lt;img" in out["html"]
