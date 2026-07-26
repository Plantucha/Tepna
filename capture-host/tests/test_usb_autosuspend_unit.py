# tepna-capture — tests/test_usb_autosuspend_unit.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Arming USB autosuspend-off must not depend on winning a race.

2026-07-26, after a reboot:

    13:55:34  usbcore: registered new device driver usb      <- adapters enumerate
    13:55:38  systemd-udevd started                          <- udev arrives 4 s later
    13:55:41  STARTUP WARNING: USB autosuspend is ENABLED

The adapters existed before udevd did, so `99-tepna-btdongle.rules` never got its turn and both BLE
adapters came up on the kernel's `usbcore.autosuspend=2` default. `udevadm test` confirmed the rule
matched and WOULD have set `on` — which is what makes this nasty: every static check of the rule
passes while the live value is wrong. Distinct from the 50->99 rename, which fixed rule PRECEDENCE;
this is rule TIMING.

The second gap found the same day: the rule lists idVendor 2357 and 8087, and a third adapter (a
Raytac MDBT50Q on Zephyr USB HCI, idVendor 2fe3) matched neither clause and sat at control=auto with
delay=2000 ms. A vendor allowlist only protects the adapters you already thought of.
"""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "systemd", "tepna-usb-autosuspend.sh")
UNIT = os.path.join(HERE, "systemd", "tepna-usb-autosuspend.service")
RULE = os.path.join(HERE, "systemd", "99-tepna-btdongle.rules")


def _sh():
    return open(SH, encoding="utf-8").read()


def _unit():
    return open(UNIT, encoding="utf-8").read()


# ── ordering: the whole point ─────────────────────────────────────────────────────────────────
def test_the_unit_runs_after_udev_has_settled():
    """Acting on already-present hardware is the one job udev-settle is genuinely correct for."""
    assert re.search(r"^After=.*systemd-udev-settle", _unit(), re.M), \
        "without this the unit can race enumeration exactly as the udev rule did"


def test_the_unit_runs_before_capture_opens_the_adapter():
    """Arming after capture has the adapter open is arming too late."""
    m = re.search(r"^Before=(.*)$", _unit(), re.M)
    assert m and "tepna-capture.service" in m.group(1)


def test_the_unit_is_a_oneshot_that_stays_active():
    u = _unit()
    assert re.search(r"^Type=oneshot", u, re.M)
    assert re.search(r"^RemainAfterExit=yes", u, re.M), \
        "without this systemd treats the arming as never having happened"


# ── vendor-agnostic matching ──────────────────────────────────────────────────────────────────
def test_adapters_are_matched_by_usb_bluetooth_class_not_by_vendor():
    """e0/01/01 is the USB class triple every conformant BT adapter reports. The Raytac was missed
    precisely because the udev rule enumerates vendors."""
    s = _sh()
    assert 'bInterfaceClass' in s and 'bInterfaceSubClass' in s and 'bInterfaceProtocol' in s
    assert '"e0"' in s and '"01"' in s


def test_the_script_hardcodes_no_vendor_id():
    """Any idVendor literal here would recreate the allowlist this replaces."""
    s = _sh()
    for vid in ("2357", "8087", "2fe3"):
        assert f'"{vid}"' not in s and f"'{vid}'" not in s, \
            f"vendor {vid} hardcoded — match on the class triple instead"


def test_the_vendor_allowlist_still_lives_only_in_the_udev_rule():
    """The rule keeps its vendor clauses (it is a hotplug matcher and that is fine) — this is a guard
    that the two files did not drift into one another's job."""
    assert os.path.exists(RULE), "the hotplug rule must still exist; the unit does not replace it"


# ── both attributes, and the read-back ────────────────────────────────────────────────────────
def test_both_power_attributes_are_written():
    """control=on opts out of runtime PM; a negative delay keeps it awake even if something later
    flips control back. Either alone is one stray power-tuner from being undone."""
    s = _sh()
    assert "power/control" in s and "power/autosuspend_delay_ms" in s
    assert "echo on >" in s and "echo -1 >" in s


def test_the_script_reports_the_read_back_not_the_intention():
    """A write that silently did not take is the entire failure being fixed. It must re-read."""
    s = _sh()
    body = s.split("CHECK=0")[1]
    assert body.count("cat \"$dev/power/control\"") >= 2, \
        "the value must be re-read after writing, not assumed"


def test_a_box_with_no_adapter_is_not_a_boot_failure():
    """The box can power on before a dongle is plugged; the udev rule owns that case."""
    s = _sh()
    assert "nothing to arm" in s and re.search(r"nothing to arm\"\n\s*exit 0", s), \
        "no adapter must exit 0, or every dongle-less boot degrades into a failed unit"


def test_check_mode_exists_and_fails_when_an_adapter_is_exposed():
    """A verifier that cannot go red is not a verifier."""
    s = _sh()
    assert "--check" in s
    assert "AUTOSUSPEND LIVE" in s
    assert re.search(r'\[ "\$problems" = "0" \] \|\| exit 1', s)


def test_a_device_with_two_bluetooth_interfaces_is_counted_once():
    """Found on real hardware, not in review: a BT USB device exposes TWO interfaces matching
    e0/01/01 — interface 0 for HCI commands/events/ACL, interface 1 for SCO audio — and both resolve
    to the same parent. The first cut reported '6 adapter(s)' for three dongles and would have
    written every attribute twice."""
    s = _sh()
    assert "seen=" in s, "the script must remember which parent devices it has already handled"
    assert re.search(r'case " \$seen " in \*" \$port "\*\) continue', s), \
        "dedupe must key on the parent device, not the interface"
