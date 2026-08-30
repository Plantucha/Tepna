# tepna-capture — tests/test_ax210_postinstall.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The AX210 post-install checklist — every verdict, including the ones that must refuse.

Verified against the REAL pre-install box before these were written: it correctly reports BT 5.1
(fail, the card is not in yet), 3 adapters (unknown, 4 expected), both pinned MACs resolving (ok),
and — against the actually-running daemon — UNKNOWN for the wifi pin, because that daemon predates
the publish. A checker that could not distinguish before from after would be decoration.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))

import ax210_postinstall as A  # noqa: E402

# The box's real output, trimmed to the shape the parser must handle.
REAL = """hci2:\tType: Primary  Bus: USB
\tBD Address: F0:D5:BF:1E:79:21  ACL MTU: 1021:4  SCO MTU: 96:6
\tUP RUNNING
\tHCI Version: 5.1 (0xa)
hci1:\tType: Primary  Bus: USB
\tBD Address: 00:01:95:CC:53:02  ACL MTU: 310:10  SCO MTU: 64:8
\tUP RUNNING
\tHCI Version: 4.2 (0x8)
hci0:\tType: Primary  Bus: USB
\tBD Address: AC:A7:F1:29:9D:1D  ACL MTU: 1021:6  SCO MTU: 255:12
\tUP RUNNING
\tHCI Version: 5.1 (0xa)
"""

AFTER = (
    REAL
    + """hci3:\tType: Primary  Bus: PCI
\tBD Address: 11:22:33:44:55:66  ACL MTU: 1021:4  SCO MTU: 96:6
\tUP RUNNING
\tHCI Version: 5.3 (0xc)
"""
)


def test_the_parser_is_indifferent_to_hci_NUMBERING():
    """Keyed on MAC, never on hci0/1/2 — a checker keyed on numbering would fail the exact situation
    the MAC pins exist to bless, namely a new card shuffling enumeration."""
    ad = A.adapters_from_hciconfig(REAL)
    assert ad == {"hci2": "F0:D5:BF:1E:79:21", "hci1": "00:01:95:CC:53:02", "hci0": "AC:A7:F1:29:9D:1D"}
    shuffled = REAL.replace("hci0:", "hciX:").replace("hci2:", "hci0:").replace("hciX:", "hci2:")
    assert A.expected_macs_present(A.adapters_from_hciconfig(shuffled))[0] == A.OK


def test_a_missing_pinned_adapter_FAILS_and_names_it():
    ad = A.adapters_from_hciconfig(REAL.replace("00:01:95:CC:53:02", "DE:AD:BE:EF:00:01"))
    state, detail = A.expected_macs_present(ad)
    assert state == A.FAIL and "00:01:95:CC:53:02" in detail


def test_UNREADABLE_hciconfig_is_UNKNOWN_not_a_failure():
    """We did not look; we failed to read. Reporting FAIL would send someone hunting a missing radio
    that is present."""
    for bad in ("", None, "garbage with no adapters"):
        assert A.expected_macs_present(A.adapters_from_hciconfig(bad))[0] == A.UNKNOWN


def test_the_wifi_pin_is_read_from_the_DAEMON_and_a_missing_key_REFUSES():
    """🔴 The file is not evidence: capture.py reads config once at startup, and a monitor save
    re-emits what it loaded — dropping a hand-added key with no error. A daemon that cannot answer
    must say so, because OK here would be that same file-check mistake one layer up."""
    assert A.wifi_pin_intact({"wifi_iface": "wlp1s0"})[0] == A.OK
    state, detail = A.wifi_pin_intact({"at_hour": 13, "dest": "/x"})
    assert state == A.UNKNOWN and "does not publish" in detail
    assert A.wifi_pin_intact(None)[0] == A.UNKNOWN
    state, detail = A.wifi_pin_intact({"wifi_iface": "wlo1"})
    assert state == A.FAIL and "wlo1" in detail and "Save settings" in detail


def test_bt_version_takes_the_HIGHEST_adapter_and_refuses_without_one():
    assert A.bt_version_at_least(REAL)[0] == A.FAIL  # 5.1 today — the card is not in yet
    assert A.bt_version_at_least(AFTER)[0] == A.OK  # 5.3 once it is
    assert A.bt_version_at_least("no version here")[0] == A.UNKNOWN


def test_the_whole_checklist_says_NOT_YET_today_and_OK_after():
    """The control that matters: the same code must distinguish the two states. A checklist that
    passes before the install verifies nothing."""
    before = A.assess(hciconfig=REAL, status_cpap={"wifi_iface": "wlp1s0"}, hci_versions=REAL, devices=[1, 2, 3, 4])
    assert before["ok"] is False
    by = {c["name"]: c["state"] for c in before["checks"]}
    assert by["bt-version"] == A.FAIL and by["adapter-count"] == A.UNKNOWN
    assert by["pinned-adapters"] == A.OK and by["devices"] == A.OK

    after = A.assess(hciconfig=AFTER, status_cpap={"wifi_iface": "wlp1s0"}, hci_versions=AFTER, devices=[1, 2, 3, 4])
    assert after["ok"] is True, after["checks"]


def test_an_UNKNOWN_anywhere_keeps_the_overall_verdict_FALSE():
    """An install verified by a probe that did not run is not verified."""
    r = A.assess(hciconfig=AFTER, status_cpap={}, hci_versions=AFTER, devices=[1])
    assert r["ok"] is False
    assert [c["state"] for c in r["checks"] if c["name"] == "wifi-pin"] == [A.UNKNOWN]


def test_ZERO_devices_is_a_FAILURE_not_an_empty_pass():
    """A restart that lost the config comes up with no devices and records nothing, all night. That
    is the loudest thing this checklist can catch, so it must not read as 'nothing to check'."""
    r = A.assess(hciconfig=AFTER, status_cpap={"wifi_iface": "wlp1s0"}, hci_versions=AFTER, devices=[])
    by = {c["name"]: c["state"] for c in r["checks"]}
    assert by["devices"] == A.FAIL and r["ok"] is False
    r2 = A.assess(hciconfig=AFTER, status_cpap={"wifi_iface": "wlp1s0"}, hci_versions=AFTER)
    assert {c["name"]: c["state"] for c in r2["checks"]}["devices"] == A.UNKNOWN
