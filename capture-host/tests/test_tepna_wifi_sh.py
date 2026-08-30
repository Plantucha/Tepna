# tepna-capture — tests/test_tepna_wifi_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# tepna-wifi.sh — the NOPASSWD helper that owns the box's Wi-Fi UPLINK.
#
# It handles a CREDENTIAL, which makes its argument handling the whole security surface. Two things
# need pinning, and neither is visible from Python coverage (a .sh is outside that denominator):
#
#   1. THE PSK ARRIVES ON STDIN AND MUST NEVER APPEAR IN ARGV. Every argument of every process is
#      world-readable through /proc/<pid>/cmdline for the lifetime of the call. The stubs below record
#      their own argv, so the assertion is on what the child processes actually saw.
#   2. `status` MUST NOT START A SUPPLICANT. A question about the uplink that brings the uplink up is
#      not a question — and during a CPAP harvest it would fight the harvest for the one radio.

import os
import subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "tepna-wifi.sh")
PSK = "6a4c6233c07e5ca2a9eb92472aff2b8c200be20561592c9dcc5124d880ab49ec"

# `wpa_cli status` is what the script polls for association. COMPLETED means associated.
STATUS_OK = "bssid=aa:bb:cc:dd:ee:ff\\nssid=HotelWifi\\nwpa_state=COMPLETED\\n"


def _run(tmp_path, *args, stdin="", status_out=STATUS_OK, supplicant_rc=0):
    """Run the real script with every privileged binary stubbed, and return (proc, calls-log)."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    log = tmp_path / "calls.log"
    log.write_text("")
    link_state = tmp_path / "link.state"
    if not link_state.exists():
        link_state.write_text("down\n")          # the state the box actually sits in after a wifi_down
    for name, body in (
        # Records argv, then answers `status` with a canned association state.
        ("wpa_cli", f'echo "wpa_cli $*" >> "{log}"\n'
                    f'case " $* " in *" status "*) printf "{status_out}" ;; esac\nexit 0\n'),
        ("wpa_supplicant", f'echo "wpa_supplicant $*" >> "{log}"\nexit {supplicant_rc}\n'),
        # Tracks link state in a file, so a test can assert the radio ENDS UP enabled rather than
        # merely that a command was issued. `$3` is the interface, `$4` the verb in `ip link set X up`.
        ("ip", f'echo "ip $*" >> "{log}"\n'
               f'if [ "$1" = link ] && [ "$2" = set ]; then echo "$4" > "{link_state}"; fi\nexit 0\n'),
        ("dhcpcd", f'echo "dhcpcd $*" >> "{log}"\nexit 0\n'),
    ):
        f = bin_dir / name
        f.write_text("#!/bin/sh\n" + body)
        f.chmod(0o755)
    env = dict(os.environ,
               PATH=f"{bin_dir}:{os.environ['PATH']}",
               TEPNA_WIFI_RUNDIR=str(tmp_path),
               TEPNA_WIFI_IFACE="wlantest0")
    proc = subprocess.run(["bash", SH, *args], input=stdin, env=env,
                          capture_output=True, text=True, timeout=90)
    return proc, log.read_text()


def _link_state(tmp_path):
    f = tmp_path / "link.state"
    return f.read_text().strip() if f.exists() else "unknown"


# ── the security surface ──────────────────────────────────────────────────────────────────────────
def test_THE_PSK_NEVER_APPEARS_IN_ANY_CHILD_PROCESS_ARGV(tmp_path):
    proc, calls = _run(tmp_path, "join", "HotelWifi", stdin=PSK + "\n")
    assert proc.returncode == 0, proc.stderr
    assert PSK not in calls, "the key reached a command line — /proc makes that world-readable"
    # ...and it did reach the config, which is where a supplicant must read it from.
    assert PSK in (tmp_path / "tepna-uplink.conf").read_text()


def test_THE_CONFIG_HOLDING_THE_KEY_IS_NOT_WORLD_READABLE(tmp_path):
    _run(tmp_path, "join", "HotelWifi", stdin=PSK + "\n")
    mode = (tmp_path / "tepna-uplink.conf").stat().st_mode & 0o777
    assert mode == 0o600, f"credential config is {oct(mode)}"


def test_A_PASSPHRASE_INSTEAD_OF_A_DERIVED_KEY_IS_REFUSED(tmp_path):
    # The helper takes a 64-hex PSK, never a human passphrase — derivation happens in wifi_join, in
    # process, precisely so the plaintext never travels. Accepting one here would re-open that door.
    proc, calls = _run(tmp_path, "join", "HotelWifi", stdin="correct horse battery\n")
    assert proc.returncode == 5
    assert "64 hex" in proc.stderr
    assert "wpa_supplicant" not in calls


def test_A_TRUNCATED_KEY_IS_REFUSED_RATHER_THAN_PADDED(tmp_path):
    proc, _c = _run(tmp_path, "join", "HotelWifi", stdin=PSK[:32] + "\n")
    assert proc.returncode == 5


def test_AN_OPEN_NETWORK_IS_WRITTEN_WITH_NO_KEY_AT_ALL(tmp_path):
    proc, _c = _run(tmp_path, "join", "FreeWifi", stdin="OPEN\n")
    assert proc.returncode == 0
    conf = (tmp_path / "tepna-uplink.conf").read_text()
    assert "key_mgmt=NONE" in conf and "psk=" not in conf


def test_THE_SSID_IS_QUOTED_SO_A_SPACE_DOES_NOT_SPLIT_THE_BLOCK(tmp_path):
    proc, _c = _run(tmp_path, "join", "The Hotel WiFi", stdin=PSK + "\n")
    assert proc.returncode == 0
    assert 'ssid="The Hotel WiFi"' in (tmp_path / "tepna-uplink.conf").read_text()


# ── status must observe, never act ────────────────────────────────────────────────────────────────
def test_STATUS_STARTS_NOTHING(tmp_path):
    proc, calls = _run(tmp_path, "status")
    assert proc.returncode == 0
    assert "wpa_supplicant" not in calls, "a status query started a supplicant"
    assert "ip link set" not in calls, "a status query brought the interface up"


def test_STATUS_ON_A_DEAD_INTERFACE_SAYS_SO_RATHER_THAN_FAILING(tmp_path):
    # No stub answers, so `wpa_cli status` produces nothing — the caller still needs a parseable state.
    proc, _c = _run(tmp_path, "status", status_out="")
    assert proc.returncode == 0
    assert "wpa_state=" in proc.stdout


# ── teardown and argument handling ────────────────────────────────────────────────────────────────
def test_LEAVE_RELEASES_THE_LEASE_AND_REMOVES_THE_CREDENTIAL_FILE(tmp_path):
    _run(tmp_path, "join", "HotelWifi", stdin=PSK + "\n")
    assert (tmp_path / "tepna-uplink.conf").exists()
    proc, calls = _run(tmp_path, "leave")
    assert proc.returncode == 0 and proc.stdout.strip() == "down"
    assert "dhcpcd -k" in calls and "terminate" in calls
    assert not (tmp_path / "tepna-uplink.conf").exists(), "the stored key outlived the disconnect"


def test_EVERY_PRIVILEGED_CALL_IS_PINNED_TO_OUR_OWN_CONTROL_DIRECTORY(tmp_path):
    # A bare `wpa_cli` resolves through the SYSTEM supplicant's directory. During a CPAP harvest that
    # is a different supplicant on the same interface, and talking to it would tear down the harvest.
    _run(tmp_path, "join", "HotelWifi", stdin=PSK + "\n")
    _proc, calls = _run(tmp_path, "status")
    for line in [ln for ln in calls.splitlines() if ln.startswith("wpa_cli")]:
        assert f"-p {tmp_path}/tepna-uplink" in line, f"unpinned wpa_cli call: {line}"


def test_JOIN_WITHOUT_AN_SSID_REFUSES(tmp_path):
    proc, calls = _run(tmp_path, "join")
    assert proc.returncode == 4 and "ssid" in proc.stderr
    assert calls == ""


def test_AN_UNKNOWN_ACTION_PRINTS_USAGE_AND_DOES_NOTHING(tmp_path):
    proc, calls = _run(tmp_path, "reboot-everything")
    assert proc.returncode == 64 and "usage:" in proc.stderr
    assert calls == ""


def test_A_SUPPLICANT_THAT_NEVER_ASSOCIATES_FAILS_RATHER_THAN_REPORTING_SUCCESS(tmp_path):
    proc, _c = _run(tmp_path, "join", "HotelWifi", stdin=PSK + "\n",
                    status_out="wpa_state=SCANNING\\n")
    assert proc.returncode == 6 and "did not associate" in proc.stderr


# ── the sandbox the helper actually runs inside ───────────────────────────────────────────────────
# The daemon invokes this helper through `sudo -n`, and sudo does NOT create a new mount namespace —
# so the helper runs as root INSIDE the daemon's sandbox. Under `ProtectSystem=strict` the whole
# hierarchy is read-only apart from `ReadWritePaths`, which means being root is not the missing
# permission; the mount is. Measured on vigil 2026-08-30, the first time Scan was pressed after the
# sudoers grant landed: "mkdir: Read-only file system", "/run/tepna-uplink.conf: Read-only file system".
def _rw_paths():
    """Every path the shipped unit and its drop-ins make writable."""
    paths = []
    for f in ("deploy/tepna-capture.service", "deploy/enable-clock-control.sh"):
        for line in open(os.path.join(HERE, f), encoding="utf-8").read().splitlines():
            t = line.strip()
            if t.startswith("ReadWritePaths="):          # a commented line is prose, not a directive
                paths += [p.lstrip("-") for p in t.split("=", 1)[1].split()]
    return paths


def test_THE_DEFAULT_RUNDIR_IS_SOMEWHERE_THE_SANDBOX_CAN_ACTUALLY_WRITE():
    default = None
    for line in open(SH, encoding="utf-8").read().splitlines():
        if line.startswith("RUNDIR="):
            default = line.split(":-", 1)[1].rstrip('}"')
    assert default, "could not read the helper's default RUNDIR"
    writable = _rw_paths()
    assert writable, "found no ReadWritePaths at all — the scan has stopped working"
    assert any(default == p or default.startswith(p.rstrip("/") + "/") for p in writable), (
        f"the helper writes to {default}, which is not under any ReadWritePaths ({writable}). "
        f"Under ProtectSystem=strict that is a read-only mount and every join fails as root."
    )


def test_THE_HELPER_DOES_NOT_REACH_FOR_RUN_ANY_MORE():
    # Pinned by name because /run is the obvious place to put a control socket and the one place this
    # daemon cannot write. A future edit reaching for it should fail here, not on the box.
    import re
    body = open(SH, encoding="utf-8").read()
    # Anchored to a ROOT-level /run — a plain substring test matches "/srv/tepna/run" and would fail
    # against the fix itself, which is how this assertion first went wrong.
    at_run = re.compile(r"(?:^|[\s:=\-\"'])/run(?:/|[\s\"'}$]|$)")
    directives = [ln for ln in body.splitlines()
                  if ln.startswith(("RUNDIR=", "CTRL=", "CONF=")) and at_run.search(ln)]
    assert not directives, f"a path directive points at the root /run: {directives}"


# ── a live supplicant is not a live radio ─────────────────────────────────────────────────────────
def test_A_SCAN_BRINGS_THE_INTERFACE_UP_EVEN_WHEN_A_SUPPLICANT_ALREADY_ANSWERS():
    """The stub `wpa_cli` always answers `status`, which is exactly the state that broke it.

    A live control socket proves a SUPPLICANT EXISTS, not that the radio is enabled. The two come
    apart whenever something downs the link while leaving our supplicant running — the CPAP harvest's
    `wifi_down` does precisely that. `ensure_supplicant` used to short-circuit on the status check and
    never run `ip link set up`, so the scan ran against a DOWN radio and honestly reported what it saw.

    ⚠️ AND THAT IS THE WORST SHAPE THIS FAILURE COULD TAKE: `ok:true` with an empty list is
    indistinguishable from "no networks in range". Measured on vigil 2026-08-30 — three consecutive
    scans returning ok:true / 0 networks with wlp1s0 DOWN, then 15 networks the moment the interface
    came up, nothing else changed."""
    with __import__("tempfile").TemporaryDirectory() as td:
        import pathlib
        proc, calls = _run(pathlib.Path(td), "scan")
    assert proc.returncode == 0, proc.stderr
    ups = [ln for ln in calls.splitlines() if ln.startswith("ip ") and " up" in ln]
    assert ups, (
        "a scan short-circuited on a live supplicant and never enabled the radio — it would return "
        f"an empty network list with a successful exit. calls: {calls.splitlines()}"
    )
    assert any("wlantest0" in ln for ln in ups), ups


def test_JOINING_ALSO_ENSURES_THE_RADIO_IS_ON():
    # Same reasoning for the join path: associating on a down interface fails in a way that looks like
    # a wrong password.
    with __import__("tempfile").TemporaryDirectory() as td:
        import pathlib
        proc, calls = _run(pathlib.Path(td), "join", "HotelWifi", stdin=PSK + "\n")
    assert proc.returncode == 0, proc.stderr
    assert any(ln.startswith("ip ") and " up" in ln for ln in calls.splitlines()), calls


def test_A_SCAN_LEAVES_THE_RADIO_ENABLED_NOT_MERELY_COMMANDED(tmp_path):
    """The contract, not the call. The test above asserts `ip link set … up` was ISSUED; this one
    asserts the interface ENDS UP enabled, starting from `down` — the state the CPAP harvest's
    `wifi_down` legitimately and repeatedly produces while our supplicant keeps answering.

    That producer is why this cannot be treated as a one-off: `wifi_down` runs after every harvest
    that had to associate, so the stale-supplicant-on-a-down-interface state is manufactured on a
    schedule. `ensure_supplicant`'s early return therefore has to mean "the radio is on", not "a
    control socket answered"."""
    # Start the interface DOWN explicitly, rather than relying on the stub's default — the whole
    # assertion is about a transition, and a test that cannot see its own starting point proves nothing.
    (tmp_path / "link.state").write_text("down\n")
    assert _link_state(tmp_path) == "down"
    proc, _calls = _run(tmp_path, "scan")
    assert proc.returncode == 0, proc.stderr
    assert _link_state(tmp_path) == "up", (
        "the scan returned successfully with the radio still down — an empty network list that reads "
        "as 'no networks in range'"
    )


def test_THE_JOIN_PATH_ALSO_LEAVES_THE_RADIO_ENABLED(tmp_path):
    proc, _calls = _run(tmp_path, "join", "HotelWifi", stdin=PSK + "\n")
    assert proc.returncode == 0, proc.stderr
    assert _link_state(tmp_path) == "up"


def test_LEAVE_PUTS_THE_RADIO_BACK_DOWN(tmp_path):
    # The other side of the contract: teardown must actually disable the interface, or the next
    # harvest inherits a radio we still hold.
    _run(tmp_path, "join", "HotelWifi", stdin=PSK + "\n")
    assert _link_state(tmp_path) == "up"
    _run(tmp_path, "leave")
    assert _link_state(tmp_path) == "down"
