# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""`vigil.sh` — the bedside start/stop wrapper that launches every overnight capture.

It ran untracked on the box from 2026-07-25 to 2026-08-04, carrying four fixes that existed in exactly
one copy on one disk (VIGIL-OVERNIGHT-FINDINGS-2026-07-24 §P4.1). These tests are what let it come under
git without taking the fixes on trust: each one re-creates the bug and asserts it stays dead.

The daemon is faked — `VIGIL_PY` is a shell script, not python — so nothing here touches BLE or needs a
real capture.py. It does bind one ephemeral port, because `start`'s success path waits for the web port
to listen and a fake that never binds would only ever exercise the timeout branch. What is under test is
the process bookkeeping, which is where all four bugs lived."""
import os
import socket
import subprocess
import time

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIGIL = os.path.join(HERE, "vigil.sh")


def _free_port():
    """A port nobody else holds — the fake daemon binds it for real, so a fixed number would make this
    collide with a concurrent run (several sessions work this repo at once)."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def box(tmp_path):
    """A fake capture-host: a config, and a `python` that binds the web port and then idles.

    The fake must NOT `exec` a helper — exec replaces /proc/<pid>/cmdline, and `is_vigil()` matches on
    `capture.py` being in it. Staying as `bash <fakepy> capture.py --config …` is what a real daemon
    looks like to the pid checks, which is the whole thing under test here."""
    d = tmp_path / "capture-host"
    d.mkdir()
    port = _free_port()
    (d / "capture.py").write_text("# fake\n")
    (d / "config.yaml").write_text(f"web:\n  host: 127.0.0.1\n  port: {port}\n")
    py = d / "fakepy"
    py.write_text("#!/usr/bin/env bash\n"
                  f"python3 -m http.server {port} --bind 127.0.0.1 >/dev/null 2>&1 &\n"
                  "sleep 300\n")
    py.chmod(0o755)
    return {"dir": d, "pid": tmp_path / "v.pid", "log": tmp_path / "v.log", "py": py, "port": port}


def _run(box, *args, timeout=60):
    env = {**os.environ, "VIGIL_DIR": str(box["dir"]), "VIGIL_CONFIG": str(box["dir"] / "config.yaml"),
           "VIGIL_PY": str(box["py"]), "VIGIL_PIDFILE": str(box["pid"]), "VIGIL_LOG": str(box["log"])}
    return subprocess.run(["bash", VIGIL, *args], capture_output=True, text=True, env=env,
                          timeout=timeout)


def _kill(box):
    """Kill the whole session, not the pid. `setsid` puts the daemon in its own session, so the
    http.server it backgrounded is not reaped by killing the shell alone."""
    try:
        p = int(box["pid"].read_text().strip())
    except (OSError, ValueError):
        return
    for killer in (lambda: os.killpg(os.getpgid(p), 9), lambda: os.kill(p, 9)):
        try:
            killer()
            return
        except OSError:
            continue   # try the next kill strategy; the loop's end reports total failure


# ── the four fixes, one test each ────────────────────────────────────────────────────────────────────

def test_start_returns_instead_of_becoming_the_daemons_parent(box):
    """BUG 1 — the foreground-subshell hang. `./vigil.sh start` once sat for 7 minutes with capture.py
    as its child (wchan=do_wait), holding the caller's stdout so piping it hung too. `setsid --fork`
    reparents the daemon to init and the parent exits at once.

    The timeout IS the assertion: the fake daemon sleeps 300 s, so a script that waits on its child
    cannot return inside 30 and this raises TimeoutExpired."""
    try:
        r = _run(box, "start", timeout=30)
        assert r.returncode == 0, f"start failed: {r.stdout}{r.stderr}"
    finally:
        _kill(box)


def test_the_pidfile_names_the_daemon_not_a_wrapper_corpse(box):
    """BUG 2 — `& echo $!` recorded the setsid wrapper, which dies in milliseconds. The pidfile then
    named a corpse, and after pid reuse, a stranger. The inner `sh` writes its OWN pid and then `exec`s
    over itself, so the number in the file is the daemon's."""
    try:
        _run(box, "start")
        time.sleep(1.0)
        pid = int(box["pid"].read_text().strip())
        os.kill(pid, 0)  # raises if it is a corpse
        cmdline = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode()
        assert "capture.py" in cmdline, f"pidfile names {pid}, which is not the daemon: {cmdline!r}"
    finally:
        _kill(box)


def test_restart_starts_a_stopped_daemon_instead_of_silently_doing_nothing(box):
    """BUG 3 — `stop`'s `exit 0` on the not-running path killed the whole script before `start` ever
    ran, so `restart` on an already-stopped box was a silent no-op that reported success. This is the
    one that loses a night: you think you restarted it, and nothing is recording."""
    try:
        assert not box["pid"].exists()
        r = _run(box, "restart")
        assert r.returncode == 0, f"restart failed: {r.stdout}{r.stderr}"
        time.sleep(1.0)
        assert box["pid"].exists(), "restart from stopped left no pidfile — the exit-0 no-op is back"
        os.kill(int(box["pid"].read_text().strip()), 0)
    finally:
        _kill(box)


def test_a_recycled_pid_running_something_else_is_not_our_daemon(box):
    """BUG 4 — pid-recycle safety. `kill -0 $p` says only "some process exists", so `stop` acting on a
    reused number signals a stranger. Every decision is made against /proc/<pid>/cmdline instead.

    Here the pidfile names a live process that is NOT capture.py; status must report not-running.

    The stranger is started WITH cwd == VIGIL_DIR on purpose. is_vigil() has two independent rejects —
    the cmdline check and a cwd check — and a stranger sitting in some other directory is caught by the
    cwd one, so the test would pass with the cmdline check deleted. Verified: with `case "$args" in
    *capture.py*` removed, the cwd-agnostic version of this test still passed. Pinning cwd to the match
    leaves the cmdline check as the only thing standing between the pidfile and a `kill`."""
    other = subprocess.Popen(["sleep", "300"], cwd=str(box["dir"]))
    try:
        box["pid"].write_text(str(other.pid))
        r = _run(box, "status")
        assert r.returncode == 3, f"a stranger's pid was accepted as our daemon: {r.stdout}"
        assert "not running" in r.stdout.lower()
    finally:
        other.kill()


# ── read-only verbs must not start anything ──────────────────────────────────────────────────────────

def test_url_prints_an_address_without_launching_a_daemon(box):
    """`url` is the verb you run to find the address from a phone; it must be inert."""
    r = _run(box, "url")
    assert r.returncode == 0
    assert str(box["port"]) in r.stdout, f"port from config.yaml not announced: {r.stdout}"
    assert not box["pid"].exists(), "the read-only `url` verb started a daemon"


def test_status_on_a_cold_box_reports_not_running(box):
    r = _run(box, "status")
    assert r.returncode == 3
    assert "not running" in r.stdout.lower()


# ── the sandbox these tests rely on ──────────────────────────────────────────────────────────────────

def test_vigil_sh_has_no_privileged_command():
    """These tests EXECUTE vigil.sh, so `test_no_test_executes_a_deploy_script_that_mutates_host_state
    _unguarded` requires a confirmation that it cannot reach real host state. That confirmation is this
    test, not the comment beside the allowlist — a prose claim is exactly what this repo keeps getting
    burned by.

    `ip` is deliberately absent from the list: lan_ip() calls `ip -4 route get`, which is a read. What
    must never appear is an address- or link-mutating form, so the check is on the mutating subcommands."""
    body = open(VIGIL, encoding="utf-8").read()
    code = "\n".join(ln for ln in body.splitlines() if not ln.lstrip().startswith("#"))
    for bad in ("sudo", "systemctl", "udevadm", "install -", "mount ", "chown", "chmod",
                "ip link", "ip addr", "ip route add", "ip route del"):
        assert bad not in code, f"{bad!r} appears in vigil.sh — the test sandbox is no longer sound"


def test_every_path_vigil_sh_writes_is_redirectable():
    """The sandbox holds only because `_run()` can point every write somewhere harmless. VIGIL_DIR is the
    one that matters: its fallback is a hard-coded developer path, so a `stop` resolved against the
    default would signal the author's own live daemon rather than the fake."""
    code = open(VIGIL, encoding="utf-8").read()
    for var in ("VIGIL_DIR", "VIGIL_CONFIG", "VIGIL_PY", "VIGIL_PIDFILE", "VIGIL_LOG"):
        assert f"${{{var}:-" in code, f"{var} is no longer an override — tests could hit the real default"
