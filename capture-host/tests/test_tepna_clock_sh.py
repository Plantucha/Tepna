# tepna-capture — tests/test_tepna_clock_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# tepna-clock.sh — the privileged CLOCK helper, which until now had NO behavioural test at all.
#
# WHY THIS MATTERS MORE THAN ITS LINE COUNT. Python coverage here is 100% (statement AND branch), but
# coverage measures .py files, and this is a .sh — so the single file that holds a NOPASSWD root grant
# sat entirely outside the denominator. Its header calls its own input validation "defense in depth";
# nothing checked the defence. And the bug it already shipped is the one this suite exists to prevent:
# on a chrony box the `ntp` verb wrote a timesyncd drop-in chrony NEVER READS and restarted a unit that
# does not exist, then reported success. A control that claims success and changes nothing.
#
# Everything below drives the REAL script with `systemctl` / `chronyc` / `timedatectl` stubbed onto PATH
# and (for the write paths) TEPNA_ETC_ROOT pointing at a tmp tree — the same shape
# tests/test_enable_cpap_wifi.py uses for deploy/enable-cpap-wifi.sh.

import os
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "tepna-clock.sh")


def _stubs(tmp_path, active=None, chronyc_rc=0):
    """Build a stub bin dir. `active` is the unit `systemctl is-active` reports as running (None = none).
    Every stub appends its argv to calls.log so a test can assert what was RUN, not just the exit code."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    log = tmp_path / "calls.log"
    log.write_text("")

    def stub(name, body):
        p = bin_dir / name
        p.write_text("#!/bin/sh\n" f'echo "{name} $*" >> "{log}"\n' + body)
        p.chmod(0o755)

    active_case = f'"{active}") echo active; exit 0 ;;' if active else ""
    stub(
        "systemctl",
        "if [ \"$1\" = is-active ]; then\n"
        "  case \"$2\" in\n"
        f"    {active_case}\n"
        "    *) echo inactive; exit 3 ;;\n"
        "  esac\n"
        "fi\n"
        "exit 0\n",
    )
    stub("chronyc", f"exit {chronyc_rc}\n")
    stub("timedatectl", "exit 0\n")
    return bin_dir, log


def _run(tmp_path, *args, active="chrony", chronyc_rc=0, etc_root=True):
    bin_dir, log = _stubs(tmp_path, active=active, chronyc_rc=chronyc_rc)
    etc = tmp_path / "etc-root"
    etc.mkdir(exist_ok=True)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    if etc_root:
        env["TEPNA_ETC_ROOT"] = str(etc)
    r = subprocess.run(["sh", SH, *args], capture_output=True, text=True, env=env)
    return r, etc, log.read_text()


# ── the sudo surface: every input is re-validated HERE, whatever the caller did ──────────────────────

def test_unknown_verb_prints_usage_and_names_the_detected_daemon(tmp_path):
    r, _, _ = _run(tmp_path, "wipe-disk")
    assert r.returncode == 2
    assert "usage:" in r.stderr
    assert "daemon: chrony" in r.stderr, "usage must say which daemon it would have driven"


def test_ntp_refuses_a_server_carrying_shell_metacharacters(tmp_path):
    """The whole point of a narrow helper: a string that reached it must not reach a shell."""
    for bad in ["a;rm -rf /", "$(id)", "host|nc", "two words", "back`tick`"]:
        r, etc, _ = _run(tmp_path, "ntp", "2048", bad)
        assert r.returncode == 2, f"{bad!r} was accepted"
        assert "bad server" in r.stderr
        assert not list(etc.rglob("*.sources")), "nothing may be written when refusing"


def test_ntp_refuses_a_non_numeric_maxpoll_and_an_empty_server_list(tmp_path):
    r, _, _ = _run(tmp_path, "ntp", "soon", "192.168.0.123")
    assert r.returncode == 2 and "bad maxpoll" in r.stderr
    r, _, _ = _run(tmp_path, "ntp", "2048")
    assert r.returncode == 2 and "no NTP server" in r.stderr


def test_tz_refuses_metacharacters_and_zones_that_do_not_exist(tmp_path):
    r, _, _ = _run(tmp_path, "tz", "Europe/Prague; rm -rf /")
    assert r.returncode == 2 and "bad timezone" in r.stderr
    r, _, _ = _run(tmp_path, "tz", "Mars/Olympus_Mons")
    assert r.returncode == 2 and "unknown timezone" in r.stderr, (
        "the name-shape check is not enough — the zone must exist in the tzdata on THIS box"
    )


def test_tz_accepts_a_real_zone(tmp_path):
    r, _, calls = _run(tmp_path, "tz", "UTC")
    assert r.returncode == 0, r.stderr
    assert "timezone=UTC" in r.stdout
    assert "timedatectl set-timezone UTC" in calls


# ── the 2026-07-25 bug: TWO time daemons, and writing to the wrong one is silent ─────────────────────

def test_chrony_box_gets_a_sources_file_and_a_reload_never_a_restart(tmp_path):
    r, etc, calls = _run(tmp_path, "ntp", "2048", "192.168.0.123", "pool.ntp.org", active="chrony")
    assert r.returncode == 0, r.stderr
    src = (etc / "etc" / "chrony" / "sources.d" / "tepna.sources").read_text()
    assert "server 192.168.0.123 iburst prefer maxpoll 11" in src
    assert "server pool.ntp.org iburst prefer maxpoll 11" in src, "every server must land, not just the first"
    assert "do not hand-edit" in src
    assert "chronyc reload sources" in calls
    assert "restart chrony" not in calls, (
        "a restart resets every source to reach 0 and leaves the box UNSYNCHRONISED for ~60 s"
    )
    assert not (etc / "etc" / "systemd").exists(), "a chrony box must not get a timesyncd drop-in"


def test_maxpoll_seconds_are_converted_to_chronys_log2(tmp_path):
    """chrony's maxpoll is log2 seconds. Handing it 2048 verbatim would mean 2^2048 s — i.e. never poll."""
    for seconds, expect in [("2048", 11), ("64", 6), ("1024", 10)]:
        r, etc, _ = _run(tmp_path, "ntp", seconds, "10.0.0.1", active="chrony")
        assert r.returncode == 0, r.stderr
        src = (etc / "etc" / "chrony" / "sources.d" / "tepna.sources").read_text()
        assert f"maxpoll {expect}" in src, f"{seconds}s should be 2^{expect}s, got {src!r}"


def test_a_timesyncd_box_gets_the_dropin_and_the_restart_instead(tmp_path):
    r, etc, calls = _run(tmp_path, "ntp", "2048", "192.168.0.123", active="systemd-timesyncd")
    assert r.returncode == 0, r.stderr
    dropin = (etc / "etc" / "systemd" / "timesyncd.conf.d" / "tepna-ntp.conf").read_text()
    assert "NTP=192.168.0.123" in dropin
    assert "PollIntervalMaxSec=2048" in dropin, "timesyncd takes SECONDS, unlike chrony's log2"
    assert "restart systemd-timesyncd" in calls
    assert not (etc / "etc" / "chrony").exists()


def test_a_box_with_neither_daemon_running_still_falls_back_to_what_is_installed(tmp_path):
    """`chronyc` present but nothing active ⇒ chrony. A stopped daemon must stay configurable."""
    r, etc, _ = _run(tmp_path, "ntp", "2048", "10.0.0.1", active=None)
    assert r.returncode == 0, r.stderr
    assert (etc / "etc" / "chrony" / "sources.d" / "tepna.sources").exists()


def test_a_failed_chronyc_reload_is_reported_not_swallowed(tmp_path):
    """The file is written but chronyd never picked it up. Reporting success here is the original bug."""
    r, etc, _ = _run(tmp_path, "ntp", "2048", "10.0.0.1", active="chrony", chronyc_rc=1)
    assert r.returncode == 1
    assert "reload sources' failed" in r.stderr
    assert (etc / "etc" / "chrony" / "sources.d" / "tepna.sources").exists(), (
        "the file IS written — the error must say so, or an operator re-runs a step that already happened"
    )


# ── sync: burst + conditional step, deliberately NOT a service restart ───────────────────────────────

def test_sync_on_chrony_bursts_and_conditionally_steps(tmp_path):
    r, _, calls = _run(tmp_path, "sync", active="chrony")
    assert r.returncode == 0, r.stderr
    assert "chronyc burst 4/4" in calls
    assert "chronyc makestep 0.1 3" in calls, "a BARE makestep would step the clock unconditionally"
    assert "restart chrony" not in calls, (
        "restarting chrony to 'sync' it destroys the clock for ~60 s on a box whose job is stamping captures"
    )


def test_sync_reports_failure_when_chronyd_cannot_be_reached(tmp_path):
    r, _, _ = _run(tmp_path, "sync", active="chrony", chronyc_rc=1)
    assert r.returncode == 1
    assert "is chronyd running" in r.stderr


def test_sync_on_timesyncd_toggles_ntp_and_try_restarts(tmp_path):
    r, _, calls = _run(tmp_path, "sync", active="systemd-timesyncd")
    assert r.returncode == 0, r.stderr
    assert "timedatectl set-ntp false" in calls and "timedatectl set-ntp true" in calls
    assert "try-restart systemd-timesyncd" in calls


# ── the seam itself must not become the hole ─────────────────────────────────────────────────────────

@pytest.mark.skipif(os.geteuid() == 0, reason="as root this would WRITE the real /etc/chrony — the one "
                                              "case tests must never reach (test_deploy_sync_apps.py's "
                                              "host-mutation guard)")
def test_the_test_seam_is_ignored_when_the_variable_is_unset(tmp_path):
    """With no TEPNA_ETC_ROOT the script targets the real /etc — proven by the write FAILING as non-root,
    which is also what proves the seam is not silently on by default."""
    r, _, _ = _run(tmp_path, "ntp", "2048", "10.0.0.1", active="chrony", etc_root=False)
    assert r.returncode != 0, "an unprivileged run must not have written to the real /etc"


def test_the_seam_is_documented_as_inert_under_sudo(tmp_path):
    """The guard is `id -u != 0`. Assert the SOURCE keeps it, because a future edit that drops the check
    turns a NOPASSWD grant into 'root writes any path you name' — untestable from outside as non-root."""
    src = open(SH).read()
    assert 'if [ "$(id -u)" -ne 0 ] && [ -n "${TEPNA_ETC_ROOT:-}" ]' in src
    assert "privilege-escalation" in src, "the reason must stay at the line, not just in a commit message"
