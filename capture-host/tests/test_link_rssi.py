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


# ── privilege path: DIRECT (ambient caps, the appliance) vs SUDO (dev fallback) ──────────────────────
# The Pi's unit sets NoNewPrivileges=true, which forbids sudo outright, so `direct` is the only path
# that can work there; the dev box has no caps and needs `sudo -n`. Same binary must serve both.
import asyncio  # noqa: E402


def _read(monkeypatch, responses, mac="24:AC:AC:02:84:96"):
    """Drive read_rssi with a fake _run; returns (value, commands_tried)."""
    tried = []

    async def fake_run(cmd, timeout=4.0):
        tried.append("sudo" if cmd[0] == "sudo" else "direct")
        return responses.get(tried[-1])

    async def fake_hci(mac_, refresh=False):
        return "hci2"
    monkeypatch.setattr(link_rssi, "_run", fake_run)
    monkeypatch.setattr(link_rssi, "resolve_hci", fake_hci)
    monkeypatch.setattr(link_rssi.os.path, "exists", lambda p: True)
    return asyncio.run(link_rssi.read_rssi("AC:A7:F1:29:9D:1D", mac)), tried


def test_direct_path_used_when_capabilities_present(monkeypatch):
    monkeypatch.setattr(link_rssi, "_MODE", None)
    val, tried = _read(monkeypatch, {"direct": "RSSI return value: -53"})
    assert val == -53 and tried == ["direct"]          # never needed sudo


def test_falls_back_to_sudo_when_direct_denied(monkeypatch):
    monkeypatch.setattr(link_rssi, "_MODE", None)
    val, tried = _read(monkeypatch, {"direct": None, "sudo": "RSSI return value: -62"})
    assert val == -62 and tried == ["direct", "sudo"]


def test_working_mode_is_remembered_not_reprobed(monkeypatch):
    monkeypatch.setattr(link_rssi, "_MODE", "sudo")
    val, tried = _read(monkeypatch, {"sudo": "RSSI return value: -70"})
    assert val == -70 and tried == ["sudo"]            # cached mode tried first, alone


def test_both_failing_clears_mode_so_a_later_grant_is_picked_up(monkeypatch):
    monkeypatch.setattr(link_rssi, "_MODE", "sudo")
    val, tried = _read(monkeypatch, {})
    assert val is None and sorted(tried) == ["direct", "sudo"]
    assert link_rssi._MODE is None                      # re-probes both next call
