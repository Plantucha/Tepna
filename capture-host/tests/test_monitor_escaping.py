# tepna-capture — tests/test_monitor_escaping.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS §3 carried "monitor.html's client side — XSS/escaping of device
# names and error strings, unaudited" as scope the parent audit did NOT cover. Audited 2026-08-05.
#
# WHAT WAS FOUND. `esc()` exists and 11 of the 15 interpolating `innerHTML` sites use it. The cpap
# status card was the exception, and it is the one fed by server text:
#
#     waiting: ['idle', `⏸ waiting — ${c.detail||'a sensor is streaming'}`],
#     error:   ['bad',  `✗ ${c.detail||'harvest failed'}`],
#     $('#cpapStatus').innerHTML = `<span class="data-pill ${cls}"></span> ${label}`;
#
# `c.detail` is CONFIG-DERIVED: capture.py fills `waiting` with "streaming: " + device NAMES and
# `error` with the Wi-Fi profile name, and device names are settable through this monitor's own
# settings API. So a device called `<img src=x onerror=…>` executes in the operator's browser.
#
# The other three unescaped sites were checked and are safe: two interpolate `Math.round(...)`, one a
# ternary over hard-coded literals. Device ADDRESSES reach `onclick` attributes but webmon validates
# them with an anchored MAC regex (`_MAC_RE.fullmatch`), so they cannot carry a quote.
#
# ⚠️ THESE TESTS EXECUTE THE SHIPPED JAVASCRIPT, following test_monitor_rate_staleness.py. A text scan
# for "esc(" would pass against an `esc` that had been redefined to the identity function, and would
# pass against a call site nothing reaches.
import json
import os
import re
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = os.path.join(HERE, "monitor.html")

# The exact payload the suite already uses for this class in tests/dex-tests.js.
PAYLOAD = "<img src=x onerror=alert(1)>"


def _extract():
    """`esc` plus the cpap status line, as executable source, taken from the shipped file."""
    src = open(MON, encoding="utf-8").read()
    m = re.search(r"^const esc = .*?;$", src, re.M)
    assert m, "esc() is gone from monitor.html — extraction is testing nothing"
    line = re.search(r"^\s*\$\('#cpapStatus'\)\.innerHTML = (`.*?`);$", src, re.M)
    assert line, "the cpapStatus render is gone or reshaped — this test is stale, fix it"
    return m.group(0), line.group(1)


def _render(label, cls="idle"):
    node = shutil.which("node")
    if not node:  # pragma: no cover - ubuntu-latest always has node; a dev box might not
        pytest.skip("node is not installed")
    esc_src, tmpl = _extract()
    prog = (f"{esc_src}\nconst cls = {json.dumps(cls)}, label = {json.dumps(label)};\n"
            f"console.log(JSON.stringify({tmpl}));")
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def test_a_device_name_cannot_inject_a_tag_into_the_cpap_card():
    """The stored-XSS path: device name -> cpap.detail -> this label -> innerHTML."""
    out = _render(f"⏸ waiting — streaming: {PAYLOAD}")
    assert "<img" not in out.lower(), f"a live tag reached innerHTML: {out}"
    assert "&lt;img" in out, "the payload must be entity-encoded, not stripped — the text still shows"


def test_a_wifi_profile_name_cannot_inject_either():
    """The `error` arm, fed by capture.py's `Wi-Fi profile {profile!r} would not come up safely`."""
    out = _render(f"✗ Wi-Fi profile '{PAYLOAD}' would not come up safely")
    assert "<img" not in out.lower(), out
    assert "onerror=alert(1)" not in out or "&lt;" in out


def test_the_class_slot_cannot_be_broken_out_of():
    """`cls` is a fixed literal today, but it sits inside an ATTRIBUTE — the one place where a stray
    quote is enough on its own."""
    out = _render("idle", cls='x" onload="alert(1)')
    assert 'onload="alert(1)"' not in out, out
    assert "&quot;" in out, "the quote must be encoded, or the attribute ends early"


def test_ordinary_text_is_still_readable():
    """Escaping must not turn the normal card into entity soup — this is what an operator reads."""
    out = _render("idle · next run 13:00")
    assert "idle · next run 13:00" in out, out


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 2026-09-03 — the audit above cleared `onclick` attributes on an argument-TYPE argument:
#
#     "Device ADDRESSES reach `onclick` attributes but webmon validates them with an anchored MAC
#      regex (`_MAC_RE.fullmatch`), so they cannot carry a quote."
#
# That is true, and it was the wrong question. It reasons about the arguments the sites were expected
# to pass and never asks whether some site passes something ELSE. One does:
#
#     onclick='remember(${JSON.stringify(d)}, this)'
#
# `d` is the whole scan record, including `d.name` — the ADVERTISED name, i.e. a string chosen by
# whoever is within BLE range. `JSON.stringify` does not escape `'` (verified: JSON.stringify({name:
# "x'y"}) → {"name":"x'y"}), and the attribute is single-quoted, so the name closes the attribute and
# the rest executes with the monitor's full API access — /api/daemon stop, /api/forget, config writes.
#
# So this test does NOT reason about which arguments are safe. It pins the STRUCTURAL invariant: every
# interpolation into a single-quoted onclick goes through `esc()`, whatever it carries. A future site
# passing a fresh device-controlled field is then covered by construction rather than by someone
# re-deriving the argument-safety argument correctly.
def test_every_onclick_interpolation_goes_through_esc():
    with open(MON, encoding="utf-8") as fh:
        html = fh.read()
    bad = []
    for m in re.finditer(r"onclick='([^']*)'", html):
        for interp in re.finditer(r"\$\{\s*([^}]*)", m.group(1)):
            expr = interp.group(1).strip()
            if not expr.startswith("esc("):
                line = html[: m.start()].count("\n") + 1
                bad.append(f"line {line}: ${{{expr[:60]}}}")
    assert not bad, (
        "every interpolation into a single-quoted onclick= must be wrapped in esc() — "
        "JSON.stringify does not escape the single quote that closes the attribute:\n  "
        + "\n  ".join(bad)
    )
