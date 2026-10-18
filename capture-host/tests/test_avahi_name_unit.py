# tepna-capture — tests/test_avahi_name_unit.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""tepna-avahi-name.service reclaims the mDNS name when avahi renamed the box, and says so.

RESIDUE `2026-09-23-avahi-renames-the-box-after-a-quick-reboot`: the 18:42 boot on 2026-09-23 logged
`Host name conflict, retrying with vigil-2` -> `Host name is vigil-2.local`, 26 min after the previous
boot. Nothing else on the LAN held the name, so the conflict was an echo of the box's own stale record.
avahi kept `vigil-2.local` for four hours, so `http://vigil.local/monitor` did not resolve while the
monitor served 200 on localhost. No line in any journal the fleet reads said so. A restart of
avahi-daemon at 22:42 reclaimed the name. Wren's 2026-10-12 box survey found two such renames in 13
boot transitions, each held until a restart.

STRUCTURE IS PART OF THE CONTRACT (owner ruling, 2026-10-17). The check is its own oneshot unit, not an
ExecStartPre of the capture unit, and the capture unit pulls it in with `Wants=` while never ordering
itself after it. So a wedged D-Bus call or a slow avahi restart cannot delay a capture start. The
command stays INLINE in the unit file because root installs that file into /etc from a clone of
origin/main while `vigil` owns /opt/tepna, so no file the checkout can write runs as root
(`tepna-sysfiles.sh` states that boundary).

These tests drive the REAL command text from the unit, after the same continuation, specifier (`%%`)
and dollar (`$$`) unescaping that systemd applies, with `hostname`, `busctl` and `systemctl` stubbed.
"""

import os
import re
import shlex
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNIT = os.path.join(HERE, "systemd", "tepna-avahi-name.service")
CAPTURE_UNIT = os.path.join(HERE, "deploy", "tepna-capture.service")
INSTALLER = os.path.join(HERE, "deploy", "install-services.sh")
MANIFEST = os.path.join(HERE, "deploy", "check-system-files.sh")


def _read(path):
    with open(path, encoding="utf-8") as f:
        # systemd joins a line that ends in a backslash with the next one, and the backslash becomes a space.
        return f.read().replace("\\\n", " ")


def _code(path):
    """The unit with its comments dropped.

    A comment naming a directive is not that directive: the REASON a unit carries no `User=` is
    written beside the absence, so the name appears in the file. Measured 2026-10-17 on the fold
    wrapper, where a comment naming `--jobs` tripped the test that forbids the flag.
    """
    return "\n".join(ln for ln in _read(path).splitlines() if not ln.lstrip().startswith("#"))


def _exec_start():
    """(prefix, argv) of the unit's one ExecStart, or (None, None)."""
    hits = [ln for ln in _read(UNIT).splitlines() if ln.startswith("ExecStart=")]
    if len(hits) != 1:
        return None, None
    cmd = hits[0][len("ExecStart=") :]
    m = re.match(r"^([-+@:!]*)(.*)$", cmd)
    prefix, rest = m.group(1), m.group(2)
    rest = rest.replace("%%", "%").replace("$$", "$")
    return prefix, shlex.split(rest)


def _run(tmp_path, busctl_out, busctl_rc=0, host="vigil"):
    prefix, argv = _exec_start()
    assert argv is not None, "tepna-avahi-name.service has no single ExecStart"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    log = tmp_path / "calls.log"
    log.write_text("")
    stubs = {
        "hostname": f"#!/bin/sh\necho {host}\n",
        "busctl": f"#!/bin/sh\necho \"busctl $*\" >> \"{log}\"\nprintf '%s\\n' '{busctl_out}'\nexit {busctl_rc}\n",
        "systemctl": f'#!/bin/sh\necho "systemctl $*" >> "{log}"\nexit 0\n',
    }
    for name, body in stubs.items():
        p = bin_dir / name
        p.write_text(body)
        p.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    r = subprocess.run(argv, capture_output=True, text=True, env=env, timeout=30)
    return r, log.read_text()


# ── the five behaviours ───────────────────────────────────────────────────────────────────────────


def test_the_check_runs_as_root_and_fails_visibly():
    prefix, argv = _exec_start()
    assert argv is not None, "tepna-avahi-name.service has no single ExecStart"
    assert "User=" not in _code(UNIT), "restarting avahi-daemon needs root"
    # Nothing waits on this unit, so a real failure belongs in `systemctl --failed`.
    assert "-" not in prefix, "a swallowed failure is a unit nobody reads"
    assert re.search(r"^Type=oneshot$", _code(UNIT), re.M)
    assert re.search(r"^After=.*\bavahi-daemon\.service\b", _code(UNIT), re.M)
    assert re.search(r"^Wants=.*\bavahi-daemon\.service\b", _code(UNIT), re.M)


def test_a_renamed_box_is_reported_at_warning_and_avahi_is_restarted(tmp_path):
    r, calls = _run(tmp_path, 's "vigil-2"')
    assert r.returncode == 0, r.stderr
    assert "GetHostName" in calls
    assert "systemctl --no-block restart avahi-daemon.service" in calls
    warn = [ln for ln in r.stdout.splitlines() if ln.startswith("<4>")]
    assert len(warn) == 1 and "vigil-2.local" in warn[0] and "vigil.local" in warn[0], r.stdout


def test_the_hostname_name_is_left_alone(tmp_path):
    r, calls = _run(tmp_path, 's "vigil"')
    assert r.returncode == 0, r.stderr
    assert "GetHostName" in calls
    assert "systemctl" not in calls
    assert "<4>" not in r.stdout


def test_an_unread_name_is_unknown_not_a_mismatch(tmp_path):
    """ABSENCE IS NULL: avahi down or no reply is not evidence of a rename, so nothing is restarted."""
    r, calls = _run(tmp_path, "", busctl_rc=1)
    assert r.returncode == 0, r.stderr
    assert "systemctl" not in calls
    assert "<4>" not in r.stdout
    assert any(ln.startswith("<5>") and "unknown" in ln for ln in r.stdout.splitlines()), r.stdout


def test_a_dotted_hostname_is_cut_at_the_first_dot_as_avahi_cuts_it(tmp_path):
    r, calls = _run(tmp_path, 's "vigil"', host="vigil.lan")
    assert r.returncode == 0, r.stderr
    assert "systemctl" not in calls
    assert "<4>" not in r.stdout


# ── the owner's structural ruling ─────────────────────────────────────────────────────────────────


def test_the_capture_unit_wants_the_check_and_never_waits_for_it():
    """Owner ruling 2026-10-17: `Wants=`, so a stuck avahi restart cannot block a capture start."""
    unit = _code(CAPTURE_UNIT)
    wants = [ln for ln in unit.splitlines() if ln.startswith("Wants=") and "tepna-avahi-name" in ln]
    assert len(wants) == 1, "the capture unit must name tepna-avahi-name.service on exactly one Wants="
    after = [ln for ln in unit.splitlines() if ln.startswith("After=") and "tepna-avahi-name" in ln]
    assert not after, "ordering capture after the name check is the delay the ruling forbids"


def test_the_capture_unit_runs_no_avahi_check_of_its_own():
    """The same ruling: not an ExecStartPre, which would run inside capture's own start job."""
    pres = [
        ln
        for ln in _code(CAPTURE_UNIT).splitlines()
        if ln.startswith(("ExecStartPre=", "ExecStartPost=")) and "avahi" in ln.lower()
    ]
    assert not pres, pres


def test_the_command_names_no_file_the_checkout_can_write():
    """tepna-sysfiles.sh: `vigil` owns /opt/tepna, so root must execute nothing from there."""
    prefix, argv = _exec_start()
    assert argv is not None
    joined = " ".join(argv)
    for writable in ("/opt/tepna", "/srv/tepna", "capture-host/"):
        assert writable not in joined, f"root would execute from {writable}"


def test_the_unit_is_installed_and_manifested():
    name = "tepna-avahi-name.service"
    installer = _code(INSTALLER)
    assert f'install -m644 "$UPD_SRC/{name}" /etc/systemd/system/{name}' in installer
    assert f"systemctl enable --now {name}" in installer
    rows = [ln for ln in _code(MANIFEST).splitlines() if name in ln]
    assert rows == [f"systemd/{name}|$ETC_SYSTEMD/{name}|MANAGED|0644"], rows


def test_the_limit_of_a_start_time_check_is_written_down():
    """A conflict avahi detects later goes unseen until the next start. Say so beside the check."""
    assert "START-TIME check" in _read(UNIT)


@pytest.mark.skipif(sys.platform != "linux", reason="systemd-analyze is Linux-only")
def test_every_directive_is_one_systemd_accepts():
    """A misspelled directive name is silently ignored, so only systemd-analyze catches it."""
    exe = subprocess.run(["sh", "-c", "command -v systemd-analyze"], capture_output=True, text=True)
    if exe.returncode != 0:
        pytest.skip("systemd-analyze absent")
    r = subprocess.run(["systemd-analyze", "verify", UNIT], capture_output=True, text=True)
    noise = ("is not executable", "legacy directory", "teamviewerd")
    bad = [
        ln for ln in (r.stdout + r.stderr).splitlines() if "tepna-avahi-name" in ln and not any(n in ln for n in noise)
    ]
    assert not bad, "\n".join(bad)
