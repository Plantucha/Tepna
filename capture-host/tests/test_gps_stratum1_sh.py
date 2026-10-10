# tepna-capture — tests/test_gps_stratum1_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# deploy/enable-gps-stratum1.sh and tepna-m10-tune.sh (VIGIL-GPS-STRATUM1-2026-10-10) — run for real with
# every system binary stubbed on PATH and every /etc path redirected, so what is asserted is what the
# scripts WRITE and CALL, not what their comments promise. The three load-bearing facts: the chrony
# drop-in carries `prefer` and NO `lock GPS`/SHM (the digipi lesson), gpsd runs at 38400 (the sheet's
# 9600 was wrong), and a first-night `lock GPS` drop-in is retired rather than left to fight the new one.
import os
import re
import stat
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTALLER = os.path.join(HERE, "deploy", "enable-gps-stratum1.sh")
TUNE = os.path.join(HERE, "tepna-m10-tune.sh")


def _stub(bin_dir, name, body):
    p = bin_dir / name
    p.write_text("#!/bin/sh\n" + body)
    p.chmod(p.stat().st_mode | stat.S_IEXEC)


def _env(tmp_path, *, with_pps=True, with_usb=True):
    """A fake box: /dev + /sys under TEPNA_DEV_ROOT, every /etc target under tmp, binaries stubbed."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    calls = tmp_path / "calls.log"
    for name in ("apt-get", "systemctl", "journalctl", "chronyc"):
        _stub(bin_dir, name, f'echo "{name} $*" >> "{calls}"\n')
    # `ip` is read-only and answers with documentation addresses (RFC 5737): the subnet the drop-in
    # serves is DERIVED at install time, so the repo never carries the real one
    _stub(
        bin_dir,
        "ip",
        'case "$*" in *route*) echo "default via 192.0.2.1 dev eno1 proto dhcp" ;; *addr*) echo "2: eno1    inet 192.0.2.41/24 brd 192.0.2.255 scope global eno1" ;; esac\n',
    )
    _stub(bin_dir, "sleep", "exit 0\n")  # the 30 s settle is real on a box and pointless here
    dev = tmp_path / "devroot"
    (dev / "dev").mkdir(parents=True)
    (dev / "sys/class/tty/ttyS0").mkdir(parents=True)
    for k, v in (("type", "4"), ("port", "0x3F8"), ("irq", "4")):
        (dev / "sys/class/tty/ttyS0" / k).write_text(v + "\n")
    (dev / "dev/ttyS0").write_text("")
    if with_usb:
        (dev / "dev/ttyUSB0").write_text("")
    if with_pps:
        (dev / "dev/pps0").write_text("")
        (dev / "sys/class/pps/pps0").mkdir(parents=True)
        (dev / "sys/class/pps/pps0/assert").write_text("1791666072.000149549#52\n")
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "TEPNA_ETC_SYSTEMD": str(tmp_path / "systemd"),
        "TEPNA_ETC_CHRONY": str(tmp_path / "chrony"),
        "TEPNA_ETC_DEFAULT": str(tmp_path / "default"),
        "TEPNA_LIB_DIR": str(tmp_path / "lib"),
        "TEPNA_DEV_ROOT": str(dev),
    }
    return env, calls


def _run(env, *args):
    return subprocess.run(["bash", INSTALLER, *args], capture_output=True, text=True, env=env)


@pytest.mark.skipif(
    os.geteuid() == 0, reason="as root the script would really install; the refusal is the non-root contract"
)
def test_it_refuses_to_write_the_real_etc_without_root():
    env = {**os.environ}
    for k in list(env):
        if k.startswith("TEPNA_"):
            del env[k]
    r = _run(env)
    assert r.returncode == 1 and "run with sudo" in r.stdout


def test_it_refuses_a_box_whose_serial_port_is_off(tmp_path):
    env, _ = _env(tmp_path)
    os.remove(os.path.join(env["TEPNA_DEV_ROOT"], "dev", "ttyS0"))
    r = _run(env)
    assert r.returncode == 1 and "enable Serial Port 1 in BIOS" in r.stdout


def test_check_reports_and_writes_nothing(tmp_path):
    env, calls = _env(tmp_path)
    r = _run(env, "--check")
    assert r.returncode == 0
    assert "missing  " in r.stdout and "present  /dev/pps0" in r.stdout
    assert not calls.exists()  # no apt-get, no systemctl
    assert not (tmp_path / "chrony").exists()


def test_it_installs_the_digipi_shape_and_nothing_else(tmp_path):
    env, calls = _env(tmp_path)
    r = _run(env)
    assert r.returncode == 0, r.stdout + r.stderr
    unit = (tmp_path / "systemd/tepna-pps-ldattach.service").read_text()
    assert "ldattach PPS /dev/ttyS0" in unit and "Before=gpsd.service chrony.service" in unit
    gpsd = (tmp_path / "default/gpsd").read_text()
    assert 'DEVICES="/dev/ttyUSB0"' in gpsd and "-s 38400" in gpsd and "pps0" not in gpsd
    tune = tmp_path / "lib/tepna-m10-tune.sh"
    assert tune.stat().st_mode & stat.S_IXUSR
    dropin = (tmp_path / "systemd/gpsd.service.d/tepna-m10-tune.conf").read_text()
    assert f"ExecStartPre=-{tmp_path}/lib/tepna-m10-tune.sh /dev/ttyUSB0 38400" in dropin
    chrony = (tmp_path / "chrony/tepna-gps-pps.conf").read_text()
    directives = [ln for ln in chrony.splitlines() if ln and not ln.startswith("#")]
    assert "refclock PPS /dev/pps0 refid PPS precision 1e-7 prefer" in directives
    assert "allow 192.0.2.0/24" in directives and "local stratum 10 orphan" in directives  # derived from `ip`
    assert "@LAN_CIDR@" not in chrony and "allow 192.0.2.0/24" in r.stdout
    joined = " ".join(directives)  # the comments SAY "no lock GPS"; the directives must not DO it
    assert not re.search(r"\block\b", joined) and "SHM" not in joined  # "refclock" is not "lock"
    log = calls.read_text()
    assert "systemctl enable --now tepna-pps-ldattach.service" in log
    assert "systemctl restart gpsd.service" in log and "systemctl restart chrony" in log
    assert "apt-get install -y pps-tools gpsd gpsd-clients" in log
    assert "assert=52 pulses so far" in r.stdout


def test_a_first_night_lock_gps_dropin_is_retired_not_left_to_fight(tmp_path):
    env, _ = _env(tmp_path)
    (tmp_path / "chrony").mkdir()
    (tmp_path / "chrony/gps-pps.conf").write_text("refclock PPS /dev/pps0 lock GPS refid PPS prefer trust\n")
    r = _run(env)
    assert r.returncode == 0
    assert not (tmp_path / "chrony/gps-pps.conf").exists()
    assert (tmp_path / "chrony/gps-pps.conf.bak-lockgps").exists()
    assert "retired gps-pps.conf" in r.stdout


def test_it_is_idempotent_and_honest_when_the_pulse_is_missing(tmp_path):
    env, calls = _env(tmp_path, with_pps=False, with_usb=False)
    r1 = _run(env)
    r2 = _run(env)
    assert r1.returncode == 0 and r2.returncode == 0
    assert "/dev/pps0 did not appear" in r2.stdout and "ttyUSB0 absent" in r2.stdout
    assert calls.read_text().count("journalctl -u tepna-pps-ldattach") == 2
    assert (tmp_path / "chrony/tepna-gps-pps.conf").exists()


# ── tepna-m10-tune.sh ───────────────────────────────────────────────────────────────────────────────
def _tune_env(tmp_path, ubx_body=None):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    calls = tmp_path / "ubx.log"
    if ubx_body is not None:
        _stub(bin_dir, "ubxtool", ubx_body.replace("CALLS", str(calls)))
    _stub(bin_dir, "sleep", "exit 0\n")
    # TEPNA_UBXTOOL is set in EVERY run: to the stub, or to a name that resolves to nothing — a real
    # ubxtool on PATH is never reachable from a test (test_deploy_sync_apps' guard relies on this)
    ubx = str(bin_dir / "ubxtool") if ubx_body is not None else "tepna-test-no-such-ubxtool"
    return {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "TEPNA_UBXTOOL": ubx}, calls


def test_tune_skips_cleanly_when_ubxtool_is_not_installed(tmp_path):
    env, _ = _tune_env(tmp_path, ubx_body=None)
    r = subprocess.run(["sh", TUNE], capture_output=True, text=True, env=env)
    assert r.returncode == 0 and "ubxtool not installed" in r.stdout


def test_tune_applies_the_stationary_model_then_silences_three_sentences(tmp_path):
    env, calls = _tune_env(tmp_path, 'echo "$*" >> "CALLS"\nexit 0\n')
    r = subprocess.run(["sh", TUNE, "/dev/ttyUSB9", "9600"], capture_output=True, text=True, env=env)
    assert r.returncode == 0
    lines = calls.read_text().splitlines()
    assert lines[0] == "-f /dev/ttyUSB9 -s 9600 -z CFG-NAVSPG-DYNMODEL,2"
    assert lines[1:] == [f"-f /dev/ttyUSB9 -s 9600 -z CFG-MSGOUT-NMEA_ID_{m}_UART1,0" for m in ("GSV", "GLL", "VTG")]


def test_tune_retries_the_model_and_never_fails_gpsd(tmp_path):
    # first DYNMODEL attempt fails (receiver still booting), the second succeeds; a failing MSGOUT is tolerated
    env, calls = _tune_env(
        tmp_path,
        'echo "$*" >> "CALLS"\ncase "$*" in *DYNMODEL*) n=$(grep -c DYNMODEL "CALLS"); [ "$n" -ge 2 ] ;; *) exit 1 ;; esac\n',
    )
    r = subprocess.run(["sh", TUNE], capture_output=True, text=True, env=env)
    assert r.returncode == 0
    assert calls.read_text().count("DYNMODEL") == 2 and calls.read_text().count("MSGOUT") == 3


def test_tune_gives_up_after_three_model_attempts(tmp_path):
    env, calls = _tune_env(tmp_path, 'echo "$*" >> "CALLS"\nexit 1\n')
    r = subprocess.run(["sh", TUNE], capture_output=True, text=True, env=env)
    assert r.returncode == 0 and calls.read_text().count("DYNMODEL") == 3


def test_the_served_subnet_comes_from_the_seam_when_set(tmp_path):
    env, _ = _env(tmp_path)
    env["TEPNA_LAN_CIDR"] = "198.51.100.0/24"
    r = _run(env)
    assert r.returncode == 0
    chrony = (tmp_path / "chrony/tepna-gps-pps.conf").read_text()
    assert "allow 198.51.100.0/24" in chrony.splitlines() and "192.0.2" not in chrony


def test_it_refuses_rather_than_serve_nobody_when_no_subnet_can_be_derived(tmp_path):
    env, _ = _env(tmp_path)
    _stub(tmp_path / "bin", "ip", "exit 0\n")  # no default route, nothing printed
    r = _run(env)
    assert r.returncode == 1 and "set TEPNA_LAN_CIDR" in r.stdout
    assert not (tmp_path / "chrony/tepna-gps-pps.conf").exists()
