# tepna-capture — tests/test_tepna_watchdog_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# deploy/tepna-watchdog.sh — the cron watchdog, run end to end against a temp captures directory with
# `sudo`, `systemctl` and `sleep` stubbed on PATH. Pinned: an explained silence restarts nothing, an
# unexplained one restarts once, the daily budget holds, a stale status file restarts, and a wedge
# seen twice resets the radio. Device names and addresses are synthetic.

import datetime as dt
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "deploy", "tepna-watchdog.sh")
OLD = (dt.datetime.now() - dt.timedelta(hours=2)).isoformat()


def _run(tmp_path, status, *, active=True, fixes=None, status_age=0):
    cap = tmp_path / "cap"
    cap.mkdir(exist_ok=True)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    calls = tmp_path / "calls.log"
    (bin_dir / "sudo").write_text(f'#!/bin/sh\necho "sudo $*" >> "{calls}"\n')
    rc = 0 if active else 3
    (bin_dir / "systemctl").write_text(f'#!/bin/sh\n[ "$1" = is-active ] || exit 1\nexit {rc}\n')
    (bin_dir / "sleep").write_text("#!/bin/sh\nexit 0\n")
    for f in ("sudo", "systemctl", "sleep"):
        (bin_dir / f).chmod(0o755)
    if status is not None:
        p = cap / "status.json"
        p.write_text(json.dumps(status))
        t = dt.datetime.now().timestamp() - status_age
        os.utime(p, (t, t))
    if fixes is not None:
        (cap / ".watchdog-fixes").write_text(f"{dt.date.today().isoformat()} {fixes}\n")
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "TEPNA_CAPTURES": str(cap),
        "TEPNA_PY": sys.executable,
        "TEPNA_RESTART": "/x/tepna-restart.sh",
    }
    r = subprocess.run(["bash", SH], capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    log = (cap / "watchdog.log").read_text()
    sudo = calls.read_text() if calls.exists() else ""
    return log, sudo


def _status(**dev):
    return {"gates": {}, "devices": {"Strap A": {"connected": True, "last_sample": OLD, "address": "AA:01", **dev}}}


def test_executable_in_git_terms():
    assert os.access(SH, os.X_OK)


def test_explained_silence_restarts_nothing(tmp_path):
    st = _status()
    st["gates"] = {"offline_slot": "Strap A"}
    log, sudo = _run(tmp_path, st)
    assert sudo == ""
    assert "SKIP explained silence: Strap A=" in log and ":offline-slot" in log
    assert "OK  status" in log and "Strap:up" in log


def test_charging_silence_restarts_nothing(tmp_path):
    log, sudo = _run(tmp_path, _status(charging=True))
    assert sudo == ""
    assert ":charging" in log


def test_unexplained_silence_restarts_once(tmp_path):
    log, sudo = _run(tmp_path, _status())
    assert sudo == "sudo -n /x/tepna-restart.sh restart\n"
    assert "FAULT connected-but-silent: Strap A=" in log
    assert "restart 1/3" in log
    assert (tmp_path / "cap" / ".watchdog-fixes").read_text().split()[1] == "1"


def test_budget_holds(tmp_path):
    log, sudo = _run(tmp_path, _status(), fixes=3)
    assert sudo == ""
    assert "WOULD-FIX" in log


def test_stale_status_restarts(tmp_path):
    log, sudo = _run(tmp_path, _status(charging=True), status_age=900)
    assert "FAULT status.json stale" in log
    assert sudo.endswith("restart\n")


def test_no_status_and_inactive_daemon_restart(tmp_path):
    log, sudo = _run(tmp_path, None)
    assert "FAULT no status.json" in log and sudo.endswith("restart\n")
    log, sudo = _run(tmp_path, _status(), active=False)
    assert "FAULT daemon inactive" in log


def test_wedge_twice_resets_the_radio(tmp_path):
    st = {"devices": {"Strap A": {"connected": False, "last_error": "org.bluez.Error.InProgress"}}}
    log, sudo = _run(tmp_path, st)
    assert "adapter wedge seen (1x" in log and sudo == ""
    log, sudo = _run(tmp_path, st)
    assert "radio reset 1/2" in log
    assert sudo == "sudo -n /x/tepna-restart.sh radio\n"
