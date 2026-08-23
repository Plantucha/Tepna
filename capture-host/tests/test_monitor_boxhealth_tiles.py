# tepna-capture — tests/test_monitor_boxhealth_tiles.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The Overview box-health strip's Clock + CPAP tiles.

The strip is the page people actually watch; the clock facts (stratum, last sync, jitter, skew) and the
CPAP harvest verdict lived only in the Devices view. What must hold HERE, following
test_monitor_rate_staleness.py's discipline of EXECUTING the shipped JavaScript rather than scanning it:

* the CPAP tile goes through `cpapStatusLabel` — the ONE map the Devices card uses — and its label
  (which carries server-derived text: device names, the Wi-Fi profile) is entity-encoded before it
  reaches innerHTML. This is the same stored-XSS path test_monitor_escaping.py pinned for the Devices
  card, now at a second sink.
* absence rules: no `cpap.enabled` ⇒ no CPAP tile at all (an always-visible "—" invites the reading
  that the harvest ran and found nothing); no host_clock block ⇒ no Clock tile.
* `agoUtc` follows the Clock Contract: explicit regex + Date.UTC, and an unparseable stamp renders as
  NOTHING, never a fabricated age.
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
    """`esc`, `agoUtc`, `cpapStatusLabel`, `renderBoxHealth` as executable source from the shipped file."""
    src = open(MON, encoding="utf-8").read()
    m = re.search(r"^const esc = .*?;$", src, re.M)
    assert m, "esc() is gone from monitor.html — extraction is testing nothing"
    out = [m.group(0)]
    for name in ("agoUtc", "cpapStatusLabel", "renderBoxHealth"):
        fn = re.search(r"^function %s\(.*?^\}" % re.escape(name), src, re.M | re.S)
        assert fn, f"{name}() not found in monitor.html — extraction is testing nothing"
        out.append(fn.group(0))
    return "\n".join(out)


# The strip's two DOM nodes, stubbed: renderBoxHealth writes innerHTML/display, the test reads them.
_STUB = """
const els = {strip:{innerHTML:'',style:{}}, title:{style:{}}};
const $ = sel => sel === '#boxHealth' ? els.strip : els.title;
"""


def _render(args_js, now_ms=None):
    node = shutil.which("node")
    if not node:  # pragma: no cover - ubuntu-latest always has node; a dev box might not
        pytest.skip("node is not installed")
    clock = f"Date.now = () => {now_ms};\n" if now_ms is not None else ""
    prog = (_extract() + _STUB + clock
            + f"renderBoxHealth({args_js});\n"
            + "console.log(JSON.stringify(els.strip.innerHTML));")
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def _eval(expr, now_ms=None):
    node = shutil.which("node")
    if not node:  # pragma: no cover
        pytest.skip("node is not installed")
    clock = f"Date.now = () => {now_ms};\n" if now_ms is not None else ""
    prog = _extract() + _STUB + clock + f"console.log(JSON.stringify({expr}));"
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


# ── the CPAP tile ────────────────────────────────────────────────────────────────────────────────────

def test_cpap_tile_appears_only_when_the_poller_is_enabled():
    out = _render("null, null, null, null, null, {enabled:true, state:'idle', at_hour:13}")
    assert "CPAP" in out and "Idle" in out
    for absent in ("null, null, null, null, null, null",
                   "null, null, null, null, null, {enabled:false, state:'ok'}"):
        assert "CPAP" not in _render(absent), "a disabled/absent poller must render NO tile at all"


def test_cpap_tile_wording_comes_from_the_shared_map():
    """The tile's sub IS cpapStatusLabel's label — one map, two surfaces, no drift."""
    out = _render("null, null, null, null, null, {enabled:true, state:'ok', files:3, bytes:13002342, nights:1}")
    assert "✓ 3 files · 12.4 MB · 1 night" in out
    assert "OK" in out


def test_cpap_tile_barren_and_error_are_red_not_green():
    out = _render("null, null, null, null, null, {enabled:true, state:'barren'}")
    assert "Nothing found" in out and "var(--status-bad)" in out
    out = _render("null, null, null, null, null, {enabled:true, state:'error', detail:'harvest failed'}")
    assert "FAILED" in out and "var(--status-bad)" in out


def test_a_device_name_cannot_inject_a_tag_into_the_cpap_tile():
    """The same stored-XSS path test_monitor_escaping.py pins for the Devices card: device name ->
    cpap.detail -> label -> innerHTML, now at the Overview sink."""
    out = _render("null, null, null, null, null, "
                  + f"{{enabled:true, state:'waiting', detail:'streaming: {PAYLOAD}'}}")
    assert "<img" not in out.lower(), f"a live tag reached the box-health strip: {out}"
    assert "&lt;img" in out, "the payload must be entity-encoded, not stripped — the text still shows"


# ── the Clock tile ───────────────────────────────────────────────────────────────────────────────────

def test_clock_tile_carries_stratum_sync_age_jitter_and_skew():
    clk = ("{absolute_ok:true, stratum:1, time_source:'chrony', last_sync_utc:'2026-07-26T01:07:19Z',"
           " jitter_us:2.3, chrony_skew_ppm:0.123, server:'192.168.0.123'}")
    # 2026-07-26T01:07:19Z is 1785028039000 ms; render "now" 60 s later.
    out = _render(f"null, null, null, null, {clk}, null", now_ms=1785028039000 + 60000)
    assert "S1 · chrony" in out
    assert "synced 60s ago" in out
    assert "jitter 2.3 us" in out
    assert "skew 0.123 ppm" in out
    assert "via 192.168.0.123" in out
    assert "var(--status-ok)" in out


def test_clock_tile_says_unsourced_with_the_reason_when_not_disciplined():
    out = _render("null, null, null, null, {absolute_ok:false, reason:'network time is disabled'}, null")
    assert "unsourced" in out and "network time is disabled" in out
    assert "var(--status-caution)" in out


def test_clock_tile_absent_until_the_poller_has_run():
    assert "Clock" not in _render("null, null, null, null, null, null")


# ── agoUtc: the Clock Contract at the display boundary ───────────────────────────────────────────────

def test_ago_utc_is_explicit_parse_never_date_parse():
    """An unparseable stamp renders as NOTHING — never a fabricated age — and the parse is the explicit
    regex + Date.UTC, so a vendor-prose stamp cannot ride the browser's locale parser."""
    assert _eval("agoUtc('Sun Jul 26 01:07:19 2026')") == ""
    assert _eval("agoUtc(null)") == ""
    assert _eval("agoUtc('')") == ""
    src = _extract()
    fn = src[src.index("function agoUtc"):src.index("function cpapStatusLabel")]
    assert "Date.UTC" in fn and "Date.parse" not in fn


def test_ago_utc_scales_seconds_minutes_hours():
    t0 = 1785028039000  # 2026-07-26T01:07:19Z
    assert _eval("agoUtc('2026-07-26T01:07:19Z')", now_ms=t0 + 5000) == "5s ago"
    assert _eval("agoUtc('2026-07-26T01:07:19Z')", now_ms=t0 + 600000) == "10m ago"
    assert _eval("agoUtc('2026-07-26T01:07:19Z')", now_ms=t0 + 7200000) == "2.0h ago"


def test_ago_utc_clamps_a_future_stamp_to_zero_not_negative():
    """A stamp slightly ahead of the viewer's clock (NTP step between poll and render) must read 0s,
    never a negative age."""
    assert _eval("agoUtc('2026-07-26T01:07:19Z')", now_ms=1785028039000 - 3000) == "0s ago"
