# tepna-capture — tests/test_tepna_restart_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# tepna-restart.sh — the second NOPASSWD helper, and the second .sh that Python coverage cannot see.
#
# THE PROPERTY WORTH PINNING IS THE BLAST RADIUS. The script exists instead of
# `NOPASSWD: /usr/bin/systemctl` precisely so the grant cannot reach every unit on the box: a fixed verb
# set, and the unit named in the script rather than taken from argv. A future edit that accepts `$2` as
# a unit name would look harmless in review and would hand `vigil` the whole system — including masking
# the services that constrain it. Nothing checked that until now.
#
# The other property: a restart that does NOT come back up must not report success. The box already sat
# on stale code for a night once (2026-07-30); an automated deploy that reads exit 0 and moves on would
# do the same thing again, silently.

import os
import re
import subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "tepna-restart.sh")
UNIT = "tepna-capture.service"


def _run(
    tmp_path,
    *args,
    state="active",
    restart_rc=0,
    journal="2026-10-30T14:44:01+0100 vigil tepna-radioclock[811]: anchors re-enabled",
):
    """Drive the real script with systemctl stubbed. `sleep` is stubbed too — the script waits 3–5 s for
    the unit to settle, which is right on the box and pure latency in a test."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    log = tmp_path / "calls.log"
    log.write_text("")
    sysctl = bin_dir / "systemctl"
    sysctl.write_text(
        "#!/bin/sh\n"
        f'echo "systemctl $*" >> "{log}"\n'
        'case "$1" in\n'
        f"  restart) exit {restart_rc} ;;\n"
        f'  is-active) echo {state}; [ "{state}" = active ] || exit 3 ;;\n'
        '  show) echo "Fri 2026-08-01 09:00:00 CEST" ;;\n'
        "esac\n"
        "exit 0\n"
    )
    sysctl.chmod(0o755)
    slp = bin_dir / "sleep"
    slp.write_text("#!/bin/sh\nexit 0\n")
    slp.chmod(0o755)
    # `journalctl` is stubbed for the same reason as systemctl: the real one on this host would read a
    # journal the test does not control, and `journal=None` is the measured "could not read it" case.
    jctl = bin_dir / "journalctl"
    body = f'echo "{journal}"' if journal is not None else "exit 1"
    jctl.write_text(f'#!/bin/sh\necho "journalctl $*" >> "{log}"\n{body}\n')
    jctl.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    r = subprocess.run(["bash", SH, *args], capture_output=True, text=True, env=env)
    return r, log.read_text()


def test_the_verb_surface_is_fixed_and_everything_else_is_refused(tmp_path):
    # `stop` joined the surface on 2026-08-02 (a Polar holds ONE BLE link, so the offline-recording
    # probe has to take it off the daemon). It is covered by its own tests below, including the
    # deadman timer that makes it safe; everything NOT on the list is still refused before systemctl.
    for argv in [
        [],
        ["restart", "extra"],
        ["mask"],
        ["restart-all"],
        [""],
        ["stop", "5", "extra"],
        ["radioclock", "extra"],
        ["radio", "clock"],
    ]:
        r, calls = _run(tmp_path, *argv)
        assert r.returncode == 2, f"{argv!r} was accepted"
        assert "usage:" in r.stderr
        assert calls == "", f"{argv!r} reached systemctl before being refused"


def test_the_unit_is_never_taken_from_argv(tmp_path):
    """THE grant-scoping property. `restart` must act on the daemon, whatever else is on the line —
    and a second argument is refused outright (above) rather than interpreted as a unit."""
    r, calls = _run(tmp_path, "restart")
    assert r.returncode == 0, r.stderr
    assert f"systemctl restart {UNIT}" in calls
    assert len([line for line in calls.splitlines() if line.startswith("systemctl restart")]) == 1
    src = open(SH).read()
    assert "UNIT=tepna-capture.service" in src
    assert '"$2"' not in src and "$@" not in src, (
        "the unit must stay a constant — accepting it from argv is what a bare systemctl grant would do"
    )


def test_restart_reports_the_state_it_actually_reached(tmp_path):
    r, _ = _run(tmp_path, "restart", state="active")
    assert r.returncode == 0
    assert f"{UNIT}: active" in r.stdout


def test_a_restart_that_does_not_come_back_up_fails_loudly(tmp_path):
    """The deploy path reads this exit code. 'restarted but dead' must not look like success."""
    r, _ = _run(tmp_path, "restart", state="failed")
    assert r.returncode == 1
    assert f"{UNIT}: failed" in r.stdout


def test_a_systemctl_restart_that_errors_stops_before_claiming_anything(tmp_path):
    r, calls = _run(tmp_path, "restart", restart_rc=1)
    assert r.returncode == 1
    assert "is-active" not in calls, "no verdict may be reported when the restart itself failed"


def test_status_reports_state_and_when_it_started(tmp_path):
    r, calls = _run(tmp_path, "status")
    assert r.returncode == 0, r.stderr
    assert f"{UNIT}: active since" in r.stdout
    assert "2026-08-01" in r.stdout
    assert "ActiveEnterTimestamp" in calls
    assert "systemctl restart" not in calls, "`status` must be read-only"


def test_radio_restarts_bluetoothd_and_not_the_capture_daemon(tmp_path):
    """The cheap rung of the deaf-radio ladder: re-init the controller without touching USB power."""
    r, calls = _run(tmp_path, "radio")
    assert r.returncode == 0, r.stderr
    assert "systemctl restart bluetooth" in calls
    assert f"systemctl restart {UNIT}" not in calls
    assert "bluetooth: active" in r.stdout


def test_radio_fails_when_bluetoothd_does_not_come_back(tmp_path):
    r, _ = _run(tmp_path, "radio", state="inactive")
    assert r.returncode == 1
    assert "bluetooth: inactive" in r.stdout


# ── radioclock: the second unit, and the only verb that reads a journal (2026-10-30) ───────────────
#
# The collector started by hand once and then sat inactive, because no verb could reach it. Its
# failure mode is the capture box's worst one: nothing errors, no sidecar appears, and the night is
# simply unmeasured. `is-active` alone cannot separate a collector that found the controller from one
# that came up and found nothing, so the journal's last line is part of the verdict.


def test_radioclock_restarts_only_the_collector_and_reports_the_journal(tmp_path):
    r, calls = _run(tmp_path, "radioclock")
    assert r.returncode == 0, r.stderr
    assert "systemctl restart tepna-radioclock.service" in calls
    assert f"systemctl restart {UNIT}" not in calls, "the capture daemon must not be touched"
    assert "systemctl restart bluetooth" not in calls
    assert "tepna-radioclock.service: active" in r.stdout
    assert "journal: 2026-10-30T14:44:01+0100" in r.stdout
    assert "anchors re-enabled" in r.stdout


def test_radioclock_fails_when_the_collector_does_not_come_back(tmp_path):
    """A collector that was asked to run and did not must not read as a started night."""
    r, _ = _run(tmp_path, "radioclock", state="failed")
    assert r.returncode == 1
    assert "tepna-radioclock.service: failed" in r.stdout
    assert "journal:" in r.stdout, "the journal line is the diagnostic; a red run needs it most"


def test_radioclock_names_an_unreadable_journal_rather_than_printing_nothing(tmp_path):
    """ABSENCE IS NULL. An empty journal line would read as silence from the unit, which is a
    different finding from a journal this caller could not read at all."""
    r, _ = _run(tmp_path, "radioclock", journal=None)
    assert r.returncode == 0, r.stderr
    assert "journal: unreadable" in r.stdout


def test_the_usage_line_names_every_implemented_verb(tmp_path):
    """The usage string is the ONLY place in capture-host that spells the verb surface, and until now
    nothing held it against the dispatch. A verb implemented but unspelled is undiscoverable; a verb
    spelled but unimplemented falls through to `usage` and reports exit 2 for a real request."""
    src = open(SH).read()
    spelled = set(re.search(r"usage: \$0 \{([^}]+)\}", src).group(1).replace(" [minutes]", "").split("|"))
    implemented = set(re.findall(r"^  ([a-z]+)\)$", src, re.M))
    assert spelled == implemented, f"spelled-only {spelled - implemented}, implemented-only {implemented - spelled}"
    assert "radioclock" in spelled


# ── stop: the dangerous verb, and the deadman that makes it safe (2026-08-02) ───────────────────────
#
# `stop` exists because a Polar holds exactly ONE BLE link, so talking to a sensor directly means
# taking the link off the daemon. Its failure mode is not an error — it is a silent, total loss: stop
# it at 22:00, get distracted, and the night is simply never recorded. Nothing in the box notices,
# because "no data" and "sensor not worn" look identical. Hence the deadman, and hence these tests.


def _run_stop(tmp_path, *args, systemd_run_rc=0, stop_rc=0):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    log = tmp_path / "calls.log"
    log.write_text("")
    sysctl = bin_dir / "systemctl"
    sysctl.write_text(
        "#!/bin/sh\n"
        f'echo "systemctl $*" >> "{log}"\n'
        f'case "$1" in stop) [ "$2" = tepna-capture.service ] && exit {stop_rc} ;; esac\n'
        "exit 0\n"
    )
    sysctl.chmod(0o755)
    sr = bin_dir / "systemd-run"
    sr.write_text(f'#!/bin/sh\necho "systemd-run $*" >> "{log}"\nexit {systemd_run_rc}\n')
    sr.chmod(0o755)
    slp = bin_dir / "sleep"
    slp.write_text("#!/bin/sh\nexit 0\n")
    slp.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    r = subprocess.run(["bash", SH, "stop", *args], capture_output=True, text=True, env=env)
    return r, log.read_text()


def test_stop_arms_the_deadman_BEFORE_it_stops_anything(tmp_path):
    """Order is the whole safety property. Arm-after-stop means a failed arm leaves a stopped daemon
    and no timer — precisely the dark night this is built to prevent."""
    r, calls = _run_stop(tmp_path)
    assert r.returncode == 0, r.stderr
    lines = [l for l in calls.splitlines() if l.strip()]
    arm = next(i for i, l in enumerate(lines) if l.startswith("systemd-run"))
    stop = next(i for i, l in enumerate(lines) if l.startswith("systemctl stop tepna-capture.service"))
    assert arm < stop, f"armed after stopping:\n{calls}"


def test_a_failed_arm_refuses_to_stop_at_all(tmp_path):
    """The daemon must keep running rather than be left un-restartable."""
    r, calls = _run_stop(tmp_path, systemd_run_rc=1)
    assert r.returncode == 1
    assert "refusing to stop" in r.stderr
    assert "systemctl stop tepna-capture.service" not in calls, "stopped despite an unarmed deadman"


def test_the_default_window_is_bounded_and_stated(tmp_path):
    r, calls = _run_stop(tmp_path)
    assert "--on-active=15min" in calls, "default window"
    assert "15m" in r.stdout and "restart armed" in r.stdout, "the operator must be told it will return"


def test_an_explicit_window_is_honoured(tmp_path):
    r, calls = _run_stop(tmp_path, "5")
    assert "--on-active=5min" in calls


def test_the_window_cannot_be_unbounded_or_nonsense(tmp_path):
    """0 would fire immediately-ish and 61+ is an improvised maintenance window on a live capture box;
    a non-numeric value must never reach systemd-run."""
    for bad in ("0", "61", "999", "abc", "-5", "5min", ""):
        r, calls = _run_stop(tmp_path, bad)
        assert r.returncode == 2, f"accepted {bad!r}"
        assert calls == "", f"{bad!r} reached systemd-run/systemctl"


def test_a_spent_deadman_is_cleared_so_stop_is_not_single_use(tmp_path):
    """A transient unit that already fired stays loaded, and `systemd-run --unit=` then refuses. Found
    on hardware: the evening's second stop failed with "already loaded". The refusal was safe, but a
    maintenance verb that works exactly once per boot is broken in practice."""
    r, calls = _run_stop(tmp_path)
    assert r.returncode == 0, r.stderr
    lines = [l for l in calls.splitlines() if l.strip()]
    reset = next(i for i, l in enumerate(lines) if "reset-failed" in l)
    arm = next(i for i, l in enumerate(lines) if l.startswith("systemd-run"))
    assert reset < arm, f"cleared the spent unit after trying to arm:\n{calls}"


def test_stop_names_only_the_capture_unit(tmp_path):
    r, calls = _run_stop(tmp_path)
    assert "systemctl stop tepna-capture.service" in calls
    assert "bluetooth" not in calls


def test_restart_disarms_a_pending_deadman(tmp_path):
    """Coming back early is the normal case; a stale timer would later 'start' a running unit and make
    the journal lie about why the daemon came up."""
    r, calls = _run(tmp_path, "restart")
    assert r.returncode == 0
    assert "systemctl stop tepna-capture-deadman.timer" in calls
    assert calls.index("deadman") < calls.index("systemctl restart"), "disarm before restarting"
