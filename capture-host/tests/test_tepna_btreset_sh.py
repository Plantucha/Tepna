# tepna-capture — tests/test_tepna_btreset_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# tepna-btreset.sh — the fifth NOPASSWD helper, and the one that makes the LAST recovery rung reachable.
#
# It unbinds and re-binds a USB Bluetooth adapter, because that is the only thing that clears an RTL8761B
# firmware hang (VIGIL-DEEP-ANALYSIS §2D). capture.py did those writes itself for its whole life and could
# never have succeeded — the sysfs files are `--w-------` root:root and the daemon is unprivileged — while
# logging the refusal at INFO as "skipped". Three things need pinning, and none of them is the happy path:
#
#   1. **The device-class allowlist is the entire security surface.** Unbinding as root detaches whatever
#      you name — the boot disk, the uplink. If the class check ever stops being enforced, a NOPASSWD grant
#      becomes a root-level denial-of-service primitive. Every refusal path is asserted here.
#   2. **It must never leave the adapter unbound.** A helper that unbinds and then fails to re-bind has
#      done strictly more damage than the wedge it was clearing, on a box that is by construction remote.
#   3. **Its allowlist must stay DISJOINT from tepna-usbreset.sh's.** That helper may only touch a Polar
#      dock and must never touch a radio; this one is the exact mirror. Asserted directly, because the
#      obvious future "cleanup" is to merge them into one reset-any-device helper.

import os
import subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "tepna-btreset.sh")

BT = ("e0", "01", "01")          # Wireless Controller / RF Controller / Bluetooth
HUB = ("09", "00", "01")         # every hub on the real box
DISK = ("08", "06", "50")        # USB mass storage — the boot disk on many builds


def _tree(tmp_path, devices, driver_writable=True, rebinds=True):
    """Build a fake /sys/bus/usb/devices + /sys/bus/usb/drivers/usb pair.

    `devices` maps port -> (class, subclass, protocol). A `driver` entry is created for each device up
    front; `unbind` removes it and `bind` puts it back, which is what the real sysfs interface does and
    what the script's completion check reads.
    """
    root = tmp_path / "devices"
    root.mkdir(exist_ok=True)
    for port, (cls, sub, proto) in devices.items():
        d = root / port
        d.mkdir(parents=True, exist_ok=True)
        (d / "bDeviceClass").write_text(cls + "\n")
        (d / "bDeviceSubClass").write_text(sub + "\n")
        (d / "bDeviceProtocol").write_text(proto + "\n")
        (d / "idVendor").write_text("2357\n")
        (d / "idProduct").write_text("0604\n")
        (d / "driver").mkdir()

    drv = tmp_path / "drivers"
    drv.mkdir(exist_ok=True)
    # A real sysfs `unbind`/`bind` is a write-only file with a kernel side effect. A plain file cannot
    # have one, so the effect is driven from the test side: the script writes the port name, and these
    # assertions read what it wrote. `rebinds=False` models a device that never comes back.
    (drv / "unbind").write_text("")
    (drv / "bind").write_text("")
    if not driver_writable:
        (drv / "unbind").chmod(0o444)
        (drv / "bind").chmod(0o444)
    return root, drv


def _run(root, drv, arg="1-2", settle="0", timeout="2"):
    env = dict(os.environ, TEPNA_USB_SYSFS=str(root), TEPNA_USB_DRIVER=str(drv),
               TEPNA_USB_SETTLE=settle, TEPNA_USB_TIMEOUT=timeout)
    return subprocess.run(["bash", SH, arg], capture_output=True, text=True, env=env, timeout=30)


# ── the allowlist ────────────────────────────────────────────────────────────────────────────────────

def test_a_hub_is_refused(tmp_path):
    """The realistic accident. Unbinding the hub takes every device below it — including the radio the
    caller was trying to recover, and on many builds the boot disk."""
    root, drv = _tree(tmp_path, {"1-2": HUB})
    r = _run(root, drv)
    assert r.returncode == 2
    assert "refusing" in r.stderr and "not a Bluetooth radio" in r.stderr
    assert (drv / "unbind").read_text() == "", "must not have been touched"


def test_mass_storage_is_refused(tmp_path):
    """Named explicitly: detaching the boot disk as root is unrecoverable without physical access, and
    this box is 491 km away."""
    root, drv = _tree(tmp_path, {"1-2": DISK})
    r = _run(root, drv)
    assert r.returncode == 2
    assert (drv / "unbind").read_text() == ""


def test_a_device_that_publishes_no_class_is_refused_not_assumed(tmp_path):
    """Fail CLOSED. 'I could not tell what this is' must never resolve to 'proceed' — that is the
    fail-open shape this suite treats as a bug wherever it appears."""
    root, drv = _tree(tmp_path, {"1-2": BT})
    (root / "1-2" / "bDeviceClass").unlink()
    r = _run(root, drv)
    assert r.returncode == 2 and "refusing" in r.stderr
    assert (drv / "unbind").read_text() == ""


def test_a_bluetooth_subclass_mismatch_is_refused(tmp_path):
    """Class e0 alone is 'Wireless Controller', which also covers non-Bluetooth RF. The triple is the
    check; asserting the whole triple stops a future 'simplification' to a single byte."""
    root, drv = _tree(tmp_path, {"1-2": ("e0", "02", "01")})
    r = _run(root, drv)
    assert r.returncode == 2
    assert (drv / "unbind").read_text() == ""


def test_a_malformed_port_is_rejected_before_anything_is_read(tmp_path):
    root, drv = _tree(tmp_path, {"1-2": BT})
    for bad in ("1", "1-", "-2", "a-b", "1-2/../../x", "1 2", "../devices/1-2", "1-2;x"):
        r = _run(root, drv, arg=bad)
        assert r.returncode == 2, f"accepted {bad!r}"
        assert (drv / "unbind").read_text() == "", f"{bad!r} reached the write"


def test_a_missing_argument_is_a_usage_error_not_a_rebind(tmp_path):
    root, drv = _tree(tmp_path, {"1-2": BT})
    r = _run(root, drv, arg="")
    assert r.returncode != 0 and "usage" in r.stderr
    assert (drv / "unbind").read_text() == ""


def test_a_shell_metacharacter_in_the_port_is_not_executed(tmp_path):
    root, drv = _tree(tmp_path, {"1-2": BT})
    marker = tmp_path / "pwned"
    r = _run(root, drv, arg=f"1-2; touch {marker}")
    assert r.returncode == 2 and not marker.exists()


def test_an_absent_port_is_reported_rather_than_silently_succeeding(tmp_path):
    root, drv = _tree(tmp_path, {"1-9": BT})
    r = _run(root, drv, arg="1-2")
    assert r.returncode == 3 and "no usb device" in r.stderr


def test_a_dotted_hub_port_is_accepted(tmp_path):
    """The 2026-07-24 wedge identified the dongle as `11-1.2`. A validator that rejected dots would
    refuse the exact device this helper exists for."""
    root, drv = _tree(tmp_path, {"11-1.2": BT})
    r = _run(root, drv, arg="11-1.2")
    assert r.returncode == 0, r.stderr


# ── the rebind itself ────────────────────────────────────────────────────────────────────────────────

def test_the_happy_path_writes_the_port_to_both_files(tmp_path):
    root, drv = _tree(tmp_path, {"1-2": BT})
    r = _run(root, drv)
    assert r.returncode == 0, r.stderr
    assert "re-bound: 1-2" in r.stdout
    assert (drv / "unbind").read_text().strip() == "1-2"
    assert (drv / "bind").read_text().strip() == "1-2"


def test_the_vid_pid_is_reported_so_the_caller_can_prove_which_radio_moved(tmp_path):
    root, drv = _tree(tmp_path, {"1-2": BT})
    r = _run(root, drv)
    assert "2357:0604" in r.stdout


def test_running_unprivileged_says_so_instead_of_failing_obscurely(tmp_path):
    """This is the whole bug, at helper scope: capture.py's own version of these writes failed exactly
    here and reported nothing above INFO."""
    if os.geteuid() == 0:
        import pytest
        pytest.skip("root can write a 0444 file")
    root, drv = _tree(tmp_path, {"1-2": BT}, driver_writable=False)
    r = _run(root, drv)
    assert r.returncode == 4 and "root" in r.stderr


def test_a_device_that_never_rebinds_times_out_loudly(tmp_path):
    """Reporting success here would tell the watchdog its wedge is cleared and send it straight back to
    a dead radio — the false-'healthy' loop that cost ~110 minutes on 2026-07-23."""
    root, drv = _tree(tmp_path, {"1-2": BT})
    (root / "1-2" / "driver").rmdir()          # never comes back
    r = _run(root, drv, timeout="1")
    assert r.returncode == 5 and "did not re-bind" in r.stderr


def test_the_script_parses_and_is_strict_mode():
    assert subprocess.run(["bash", "-n", SH], capture_output=True).returncode == 0
    src = open(SH, encoding="utf-8").read()
    assert "set -euo pipefail" in src
    assert "SPDX-License-Identifier: Apache-2.0" in src


# ── the invariant, not the behaviour ─────────────────────────────────────────────────────────────────

def test_the_allowlist_is_a_literal_not_derived_from_the_argument():
    """Pins the invariant rather than a behaviour: if the class check ever starts interpolating the
    caller's input, every refusal test above would still pass while the surface became universal."""
    src = open(SH, encoding="utf-8").read()
    line = next(l for l in src.splitlines() if '"${cls,,}"' in l and "!=" in l)
    assert '"e0"' in line and '"01"' in line, f"class check must compare literals: {line}"
    assert "$1" not in line and "$port" not in line


def test_its_allowlist_is_disjoint_from_the_polar_dock_helpers():
    """The two helpers are deliberate mirror images — usbreset may only touch the Polar dock, btreset may
    only touch radios — and merging them is the obvious, wrong future cleanup. usbreset's own header
    names 'the very BLE adapters the capture depends on' as the thing it must never reach."""
    usb = open(os.path.join(HERE, "tepna-usbreset.sh"), encoding="utf-8").read()
    allowed = next(l for l in usb.splitlines() if l.startswith("ALLOWED="))
    assert "0da4:0008" in allowed and "e0" not in allowed, allowed
    # CODE, not prose — btreset's header cites `0da4:0008` precisely to say it must never reach it, and a
    # whole-file scan would read that explanation as the violation it warns against.
    code = "\n".join(l for l in open(SH, encoding="utf-8").read().splitlines()
                     if l.strip() and not l.lstrip().startswith("#"))
    assert "0da4" not in code, "btreset must not know about the Polar dock"
    assert "authorized" not in code, "btreset rebinds a driver; it must not toggle `authorized`"
