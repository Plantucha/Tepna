# tepna-capture — tests/test_link_rssi.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Tests for the pure parsing surface of link_rssi (the RSSI side of the weak-signal warning). The
# subprocess/sudo path needs a privileged helper + a real adapter, so only the parsers are unit-tested;
# link_rssi.py is stdlib-only (asyncio/os/re), no bleak → imports cleanly in the hardware-free CI.

import link_rssi


def test_parse_rssi_from_hcitool_output():
    assert link_rssi.parse_rssi("RSSI return value: -63") == -63
    assert link_rssi.parse_rssi("RSSI return value: 0") == 0


def test_parse_rssi_bare_number_fallback():
    assert link_rssi.parse_rssi("-71") == -71


def test_parse_rssi_rejects_junk_and_out_of_range():
    assert link_rssi.parse_rssi("") is None
    assert link_rssi.parse_rssi("Connection timed out") is None
    assert link_rssi.parse_rssi("RSSI return value: 999") is None   # implausible → None, not a fake reading


def test_parse_hci_dev_maps_addr_to_hci():
    out = "Devices:\n\thci1\t58:10:31:F3:2C:30\n\thci0\tAC:A7:F1:29:9D:1D\n"
    m = link_rssi.parse_hci_dev(out)
    assert m == {"58:10:31:F3:2C:30": "hci1", "AC:A7:F1:29:9D:1D": "hci0"}


def test_parse_hci_dev_empty_when_no_controllers():
    assert link_rssi.parse_hci_dev("Devices:\n") == {}
