# tepna-capture — tests/test_tepna_usbreset_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# tepna-usbreset.sh — the fourth NOPASSWD helper, and the fourth .sh outside the coverage denominator.
#
# It re-enumerates a docked Polar by toggling `authorized`, because PS-FTP over USB only answers inside
# a window that opens on re-enumeration. Two things need pinning, and neither is about the happy path:
#
#   1. **The VID:PID allowlist is the entire security surface.** `authorized` is a loaded gun — writing
#      0 to the wrong device detaches the boot disk, or the BLE adapters the capture depends on. If the
#      allowlist ever stops being enforced, a NOPASSWD root grant becomes a denial-of-service
#      primitive. Every refusal path is asserted here, including the ones an attacker would try.
#   2. **It must not return before the device is back.** The caller's whole reason for calling is to
#      spend a one-request window; returning into a race spends it on a device that has not enumerated
#      yet, which looks exactly like "USB does not work".

import os
import subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "tepna-usbreset.sh")

POLAR = ("0da4", "0008")


def _sysfs(tmp_path, devices, authorized_writable=True, devnum=True):
    """Build a fake /sys/bus/usb/devices tree. `devices` maps port -> (vid, pid, devnum)."""
    root = tmp_path / "devices"
    root.mkdir(exist_ok=True)
    for port, (vid, pid, num) in devices.items():
        d = root / port
        d.mkdir(parents=True, exist_ok=True)
        (d / "idVendor").write_text(vid + "\n")
        (d / "idProduct").write_text(pid + "\n")
        if devnum:
            (d / "devnum").write_text(str(num) + "\n")
        auth = d / "authorized"
        auth.write_text("1\n")
        if not authorized_writable:
            auth.chmod(0o444)
    return root


def _run(root, arg="0da4:0008", settle="0", timeout="2"):
    env = dict(os.environ, TEPNA_USB_SYSFS=str(root), TEPNA_USB_SETTLE=settle,
               TEPNA_USB_TIMEOUT=timeout)
    return subprocess.run(["bash", SH, arg], capture_output=True, text=True, env=env, timeout=30)


# ── the allowlist ────────────────────────────────────────────────────────────────────────────────────

def test_a_non_allowlisted_device_is_refused_even_when_it_is_present(tmp_path):
    """The dangerous case: a real, docked device that simply is not ours. Presence must not imply
    permission — this is the difference between a helper and a root-level DoS primitive."""
    root = _sysfs(tmp_path, {"1-1": ("1d6b", "0002", 1)})     # a Linux root hub
    r = _run(root, arg="1d6b:0002")
    assert r.returncode == 2
    assert "refusing" in r.stderr and "allowlist" in r.stderr
    assert (root / "1-1" / "authorized").read_text().strip() == "1", "must not have been touched"


def test_the_bluetooth_adapter_cannot_be_deauthorized(tmp_path):
    """Named explicitly because it is the realistic accident: the box's capture dies without its
    radios, and one adapter is already known to go deaf."""
    root = _sysfs(tmp_path, {"1-4": ("0a12", "0001", 5)})
    r = _run(root, arg="0a12:0001")
    assert r.returncode == 2
    assert (root / "1-4" / "authorized").read_text().strip() == "1"


def test_a_malformed_id_is_rejected_before_anything_is_read(tmp_path):
    root = _sysfs(tmp_path, {"1-1": POLAR + (9,)})
    for bad in ("0da4", "0da4:", "zzzz:0008", "0da4:0008:1", "../../etc", "0da4 0008"):
        r = _run(root, arg=bad)
        assert r.returncode == 2, f"accepted {bad!r}"
        assert (root / "1-1" / "authorized").read_text().strip() == "1"


def test_a_missing_argument_is_a_usage_error_not_a_reset(tmp_path):
    """`${1:?}` exits 1 rather than the validator's 2 — different code, same requirement: nothing
    may be toggled on the way to complaining."""
    root = _sysfs(tmp_path, {"1-1": POLAR + (9,)})
    r = _run(root, arg="")
    assert r.returncode != 0 and "usage" in r.stderr
    assert (root / "1-1" / "authorized").read_text().strip() == "1"


def test_a_shell_metacharacter_in_the_id_is_not_executed(tmp_path):
    root = _sysfs(tmp_path, {"1-1": POLAR + (9,)})
    marker = tmp_path / "pwned"
    r = _run(root, arg=f"0da4:0008; touch {marker}")
    assert r.returncode == 2 and not marker.exists()


def test_the_allowlisted_id_is_case_insensitive(tmp_path):
    """lsusb prints lowercase, sysfs stores lowercase, humans type either."""
    root = _sysfs(tmp_path, {"1-1": POLAR + (9,)})
    r = _run(root, arg="0DA4:0008")
    assert r.returncode == 0, r.stderr


# ── finding the device ───────────────────────────────────────────────────────────────────────────────

def test_the_right_port_is_chosen_out_of_a_populated_bus(tmp_path):
    root = _sysfs(tmp_path, {
        "1-1": ("1d6b", "0002", 1),
        "1-3": ("0a12", "0001", 4),
        "1-5": POLAR + (9,),
    })
    r = _run(root)
    assert r.returncode == 0, r.stderr
    assert "1-5" in r.stdout
    assert (root / "1-1" / "authorized").read_text().strip() == "1", "neighbours untouched"
    assert (root / "1-3" / "authorized").read_text().strip() == "1"


def test_an_absent_device_is_reported_rather_than_silently_succeeding(tmp_path):
    root = _sysfs(tmp_path, {"1-1": ("1d6b", "0002", 1)})
    r = _run(root)
    assert r.returncode == 3 and "no device" in r.stderr


def test_a_directory_without_usb_id_files_is_skipped_not_fatal(tmp_path):
    """`/sys/bus/usb/devices` also holds interface nodes (`1-1:1.0`) with no idVendor at all."""
    root = _sysfs(tmp_path, {"1-1": POLAR + (9,)})
    (root / "1-1:1.0").mkdir()
    r = _run(root)
    assert r.returncode == 0, r.stderr


def test_running_unprivileged_says_so_instead_of_failing_obscurely(tmp_path):
    if os.geteuid() == 0:
        import pytest
        pytest.skip("root can write a 0444 file")
    root = _sysfs(tmp_path, {"1-1": POLAR + (9,)}, authorized_writable=False)
    r = _run(root)
    assert r.returncode == 4 and "root" in r.stderr


# ── the toggle itself ────────────────────────────────────────────────────────────────────────────────

def test_authorized_ends_up_back_at_one(tmp_path):
    """A helper that deauthorizes and fails to re-authorize has bricked the port until a human
    intervenes — on a box that is, by construction, remote."""
    root = _sysfs(tmp_path, {"1-1": POLAR + (9,)})
    r = _run(root)
    assert r.returncode == 0, r.stderr
    assert (root / "1-1" / "authorized").read_text().strip() == "1"


def test_the_devnum_change_is_reported_so_the_caller_can_prove_re_enumeration(tmp_path):
    root = _sysfs(tmp_path, {"1-1": POLAR + (7,)})
    r = _run(root)
    assert "devnum 7" in r.stdout and "re-enumerated" in r.stdout


def test_a_device_that_never_comes_back_times_out_loudly(tmp_path):
    """Sysfs is a real kernel interface; a device can fail to re-enumerate. Reporting success here
    would send the caller to spend its one request on nothing."""
    # Deterministic rather than raced: a node with no `devnum` is exactly what a half-enumerated
    # device looks like, so the post-toggle wait never sees it come back.
    root = _sysfs(tmp_path, {"1-1": POLAR + (9,)}, devnum=False)
    r = _run(root, timeout="1")
    assert r.returncode == 5 and "did not re-enumerate" in r.stderr
    assert (root / "1-1" / "authorized").read_text().strip() == "1", "re-authorized even on failure"


def test_the_script_parses_and_is_strict_mode(tmp_path):
    assert subprocess.run(["bash", "-n", SH], capture_output=True).returncode == 0
    src = open(SH, encoding="utf-8").read()
    assert "set -euo pipefail" in src
    assert "SPDX-License-Identifier: Apache-2.0" in src


def test_the_allowlist_is_a_literal_not_derived_from_the_argument(tmp_path):
    """Pins the invariant rather than a behaviour: if ALLOWED ever starts interpolating the caller's
    input, every refusal test above would still pass while the surface silently became universal."""
    src = open(SH, encoding="utf-8").read()
    line = next(l for l in src.splitlines() if l.startswith("ALLOWED="))
    assert "$" not in line, f"allowlist must be a literal: {line}"
    assert "0da4:0008" in line
