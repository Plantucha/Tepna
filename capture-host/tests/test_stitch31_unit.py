# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The daily 31-day run sits in the fold's fence, runs only the tools that exist, and installs as a timer.

Measured on the capture box 2026-11-07: nothing scheduled `tools/stitch-31d-run.mjs`, so the monitor's
31-day page served "not yet computed" for every tool. The units are asserted against their SOURCE, the
approach test_fold_unit.py takes."""

import os
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(HERE)
UNIT = os.path.join(HERE, "systemd", "tepna-stitch31.service")
TIMER = os.path.join(HERE, "systemd", "tepna-stitch31.timer")
MANIFEST = os.path.join(HERE, "deploy", "check-system-files.sh")
INSTALLER = os.path.join(HERE, "deploy", "install-services.sh")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _directives(path):
    """Unit directives as (key, value) pairs in file order, comments dropped. ExecStart may repeat."""
    out = []
    for line in _read(path).splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("["):
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            out.append((k.strip(), v.strip()))
    return out


def _one(path, key):
    vals = [v for k, v in _directives(path) if k == key]
    assert len(vals) == 1, f"{key}: {vals}"
    return vals[0]


def test_the_run_is_fenced_like_the_fold_so_capture_outranks_it():
    assert _one(UNIT, "MemoryMax") == "4G"
    assert _one(UNIT, "MemorySwapMax") == "0"
    assert _one(UNIT, "OOMScoreAdjust") == "500"
    assert _one(UNIT, "Nice") == "19"
    assert _one(UNIT, "IOSchedulingClass") == "idle"
    assert _one(UNIT, "User") == "vigil"
    assert _one(UNIT, "ProtectSystem") == "strict"
    assert _one(UNIT, "ReadWritePaths") == "/srv/tepna/stitched", "it writes RESULT.json there and nowhere else"


def test_the_quiet_guard_is_success_and_an_absent_manifest_is_not():
    codes = _one(UNIT, "SuccessExitStatus").split()
    assert "3" in codes, "exit 3 is the runner's quiet guard: retry at the next firing"
    assert "2" not in codes, "exit 2 means nothing was stitched, and the operator must see that"


def test_it_runs_the_two_implemented_tools_in_one_oneshot():
    assert _one(UNIT, "Type") == "oneshot"
    execs = [v for k, v in _directives(UNIT) if k == "ExecStart"]
    assert execs == [
        "/usr/bin/node tools/stitch-31d-run.mjs 3corner",
        "/usr/bin/node tools/stitch-31d-run.mjs 3corner_fused",
    ]
    assert _one(UNIT, "WorkingDirectory") == "/opt/tepna"


def test_the_timer_fires_in_the_daytime_after_the_harvest_and_the_archive():
    assert _one(TIMER, "OnCalendar") == "*-*-* 14:00:00"
    assert _one(TIMER, "Persistent") == "true"
    assert _one(TIMER, "WantedBy") == "timers.target"


def test_both_units_are_managed_so_drift_is_visible():
    manifest = _read(MANIFEST)
    for name in ("tepna-stitch31.service", "tepna-stitch31.timer"):
        assert f"systemd/{name}|$ETC_SYSTEMD/{name}|MANAGED|0644" in manifest, name


def test_the_installer_enables_the_timer_and_never_the_oneshot():
    s = _read(INSTALLER)
    assert "systemctl enable --now tepna-stitch31.timer" in s
    assert "enable --now tepna-stitch31.service" not in s


@pytest.mark.skipif(sys.platform != "linux", reason="systemd-analyze is Linux-only")
def test_every_directive_is_one_systemd_accepts():
    """A typo in a directive name is SILENTLY IGNORED by systemd, so the fence would simply be absent."""
    exe = subprocess.run(["sh", "-c", "command -v systemd-analyze"], capture_output=True, text=True)
    if exe.returncode != 0:
        pytest.skip("systemd-analyze absent")
    r = subprocess.run(["systemd-analyze", "verify", UNIT, TIMER], capture_output=True, text=True)
    noise = ("is not executable", "legacy directory", "teamviewerd")
    bad = [
        ln for ln in (r.stdout + r.stderr).splitlines() if "tepna-stitch31" in ln and not any(n in ln for n in noise)
    ]
    assert not bad, "\n".join(bad)
