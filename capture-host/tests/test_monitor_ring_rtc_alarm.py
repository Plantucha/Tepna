# tepna-capture — tests/test_monitor_ring_rtc_alarm.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The ring RTC battery-reset alarm must actually RENDER when STATUS carries `ring_rtc_reset_suspect`.

`find_unwired` flagged `ring_rtc_reset_suspect` as forwarded-by-webmon / drawn-by-nobody (#1564 ring
clock sidecar residue). The draw was added as `renderRingRtc(status)`; this pins it. Follows
test_monitor_rate_staleness.py / test_monitor_escaping.py: EXECUTE the shipped JavaScript under node,
never scan monitor.html for a string — a text scan cannot tell present-when-true from always-present,
and would pass against a draw nothing reaches. This is the DYNAMIC complement to `find_unwired`: the
static gate proves the field is drawn by *something*; this proves it draws the *right* thing.
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
    """`esc` + `renderRingRtc`, as executable source, taken from the shipped file."""
    src = open(MON, encoding="utf-8").read()
    esc = re.search(r"^const esc = .*?;$", src, re.M)
    assert esc, "esc() is gone from monitor.html — extraction is testing nothing"
    fn = re.search(r"^function renderRingRtc\(status\) \{.*?\n\}$", src, re.M | re.S)
    assert fn, "renderRingRtc() is gone or reshaped — this test is stale, fix it"
    return esc.group(0), fn.group(0)


def _render(status):
    node = shutil.which("node")
    if not node:  # pragma: no cover - ubuntu-latest always has node; a dev box might not
        pytest.skip("node is not installed")
    esc_src, fn_src = _extract()
    prog = f"{esc_src}\n{fn_src}\nconsole.log(JSON.stringify(renderRingRtc({json.dumps(status)})));"
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def test_the_alarm_renders_with_its_id_when_the_flag_is_an_active_stamp():
    """`ring_rtc_reset_suspect` is an ISO stamp when the ring's RTC battery-reset is suspected."""
    out = _render({"ring_rtc_reset_suspect": "2026-08-20T05:02:11"})
    assert 'id="ring-rtc-alarm"' in out, f"the alarm span/id is missing: {out!r}"
    assert "ring RTC reset suspected" in out
    assert "2026-08-20 05:02:11" in out, "the stamp must render (T→space, per the draw)"


def test_no_element_at_all_when_the_flag_is_null():
    """Absence contract: a null stamp renders NOTHING — no element, no fabricated dash."""
    assert _render({"ring_rtc_reset_suspect": None}) == ""


def test_no_element_when_the_key_is_absent_entirely():
    assert _render({}) == ""


def test_no_element_when_the_flag_is_false():
    assert _render({"ring_rtc_reset_suspect": False}) == ""


def test_a_hostile_stamp_is_entity_encoded_before_innerHTML():
    """Defense-in-depth (test_monitor_escaping.py discipline): the stamp is server-derived text reaching
    innerHTML, so it goes through esc(). A live tag must never survive — even though the draw also
    slice(0,19)-truncates it first."""
    out = _render({"ring_rtc_reset_suspect": "<img src=x onerror=alert(1)>"})
    assert "<img" not in out.lower(), f"a live tag reached innerHTML: {out}"
    assert "&lt;img" in out, "the payload must be entity-encoded, not stripped"
