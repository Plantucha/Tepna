# tepna-capture — tests/test_link_rssi.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Tests for the pure parsing surface of link_rssi (the RSSI side of the weak-signal warning). The
# subprocess/sudo path needs a privileged helper + a real adapter, so only the parsers are unit-tested;
# link_rssi.py is stdlib-only (asyncio/os/re), no bleak → imports cleanly in the hardware-free CI.

import link_rssi


def test_parse_rssi_from_hcitool_output():
    assert link_rssi.parse_rssi("RSSI return value: -63") == -63
    # `0` was asserted to parse as a READING here until 2026-07-25. It is not one: BlueZ returns 0 from
    # HCI_Read_RSSI when it has no valid measurement, so accepting it wrote a fabricated -0 dBm into the
    # LINK sidecar. Changed deliberately, not to make the new bound pass — see VIGIL-PPG-GRID-AUDIT §4
    # and `test_zero_and_positive_rssi_are_rejected_as_unknown` below.
    assert link_rssi.parse_rssi("RSSI return value: 0") is None


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


# ── VIGIL-DEEP-ANALYSIS §1.3 — sysfs adapter resolution (works on Pi 5 where hcitool is absent) ──
def test_sysfs_hci_maps_controller_mac_to_hci(tmp_path):
    import link_rssi
    base = tmp_path / "bluetooth"
    for name, mac in [("hci0", "AC:A7:F1:29:9D:1D"), ("hci1", "58:10:31:F3:2C:30")]:
        d = base / name; d.mkdir(parents=True)
        (d / "address").write_text(mac + "\n")
    got = link_rssi.sysfs_hci(str(base))
    assert got == {"AC:A7:F1:29:9D:1D": "hci0", "58:10:31:F3:2C:30": "hci1"}


def test_sysfs_hci_empty_when_base_absent():
    import link_rssi
    assert link_rssi.sysfs_hci("/no/such/path/bluetooth") == {}


def test_sysfs_hci_skips_a_garbage_address(tmp_path):
    import link_rssi
    base = tmp_path / "bt"; d = base / "hci0"; d.mkdir(parents=True)
    (d / "address").write_text("not-a-mac")
    assert link_rssi.sysfs_hci(str(base)) == {}


def test_sysfs_hci_skips_a_controller_whose_address_cannot_be_read(tmp_path):
    """A per-ENTRY failure, distinct from the base being absent: sysfs listed the controller but its
    `address` cannot be opened — a device mid-teardown, or one the kernel exposes without the attribute.
    That entry is skipped and the OTHERS still map, because dropping the whole table would send
    resolve_hci to the hcitool fallback and, on a Pi 5 where hcitool is absent, silently back to the
    BlueZ default radio — the 2026-07-18 deaf-onboard mis-pin.

    Covered here explicitly because it was previously reached only by accident, via the real
    /sys/class/bluetooth on a developer's machine — so it read as covered locally and was uncovered in
    CI, on a line whose whole job is to survive an unreadable host."""
    base = tmp_path / "bt"
    (base / "hci0").mkdir(parents=True)                       # listed, but has no `address` file
    good = base / "hci1"; good.mkdir()
    (good / "address").write_text("AC:A7:F1:29:9D:1D\n")
    assert link_rssi.sysfs_hci(str(base)) == {"AC:A7:F1:29:9D:1D": "hci1"}


# ── POSITIVE RSSI IS NOT A MEASUREMENT (VIGIL-PPG-GRID-AUDIT-2026-07-25-BRIEF §4) ──────────────
# BlueZ returns 0 (sometimes a small positive) from HCI_Read_RSSI when it has no valid reading —
# a stale handle, a link being torn down. The old +20 upper bound admitted those sentinels as real
# dBm, so a night's LINK sidecar carried impossible values that poison any min/max over the column.

def test_zero_and_positive_rssi_are_rejected_as_unknown():
    """Measured on the real 2026-07-25 capture: 0, +1 and +8 dBm reached the LINK sidecar."""
    for junk in ("RSSI return value: 0", "RSSI return value: 1", "RSSI return value: 8", "0", "+8"):
        assert link_rssi.parse_rssi(junk) is None, f"{junk!r} is not a physically possible BLE RSSI"


def test_real_negative_rssi_still_parses():
    assert link_rssi.parse_rssi("RSSI return value: -63") == -63
    assert link_rssi.parse_rssi("RSSI return value: -1") == -1
    assert link_rssi.parse_rssi("-84") == -84


def test_out_of_range_negative_is_still_rejected():
    assert link_rssi.parse_rssi("RSSI return value: -128") is None
