# tepna-capture — tests/test_monitor_nights_probe_verdict.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The Nights table/matrix verdict display for a probe night.

`solid_night.compose` emits NOT_APPLICABLE for a declared probe night, and the Nights view
must render it as "probe night" — not the raw status string, not "a check could not run",
and not the black/empty square of an unknown verdict.

Runs the SHIPPED functions (`nSolidTxt`, `nSolidCls`), extracted from monitor.html, under
node — the same recipe as the solid-night card tests.
"""

import json
import re
import shutil
import subprocess

import pytest

MON = "monitor.html"


def _extract():
    src = open(MON, encoding="utf-8").read()
    out = []
    for name in ("NIGHT_SOLID", "N_SOLID_CLS", "N_SOLID_TXT"):
        m = re.search(r"^(?:const|let) %s = .*?;" % re.escape(name), src, re.M)
        assert m, f"{name} is gone from monitor.html — extraction is testing nothing"
        out.append(m.group(0))
    for name in ("nSolidCls", "nSolidTxt"):
        fn = re.search(r"^function %s\(.*?^\}" % re.escape(name), src, re.M | re.S)
        assert fn, f"{name}() not found in monitor.html — extraction is testing nothing"
        out.append(fn.group(0))
    return "\n".join(out)


def _run(verdict_status):
    node = shutil.which("node")
    if not node:  # pragma: no cover
        pytest.skip("node is not installed")
    prog = (
        _extract()
        + f"\nNIGHT_SOLID['2026-10-13'] = {{state:'ok', v:{{status:'{verdict_status}', result:{{}}}}}};\n"
        + "console.log(JSON.stringify({txt: nSolidTxt('2026-10-13'), cls: nSolidCls('2026-10-13')}));\n"
    )
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def test_a_probe_night_reads_probe_night_not_the_raw_status():
    """NOT_APPLICABLE must render as "probe night", not the raw status string."""
    o = _run("NOT_APPLICABLE")
    assert o["txt"][0] == "probe night", f"got {o['txt'][0]!r}"


def test_a_probe_night_gets_its_own_square_not_the_unknown_one():
    """The matrix square for a probe night is 'probe' (blue), not 'unk' (black/empty)."""
    o = _run("NOT_APPLICABLE")
    assert o["cls"] == "probe", f"got {o['cls']!r}"


def test_a_probe_night_explains_the_skip_not_a_failed_check():
    """The sub-text must say the night was skipped by declaration, not that a check failed."""
    o = _run("NOT_APPLICABLE")
    assert o["txt"][1] == "declared a probe night — skipped by the run"
    assert "could not run" not in o["txt"][1]


def test_pass_and_fail_labels_are_unchanged():
    """The new status does not disturb the existing verdict labels."""
    assert _run("PASS")["txt"][0] == "solid"
    assert _run("FAIL")["txt"][0] == "not solid"
    assert _run("UNKNOWN")["txt"][0] == "unknown"
