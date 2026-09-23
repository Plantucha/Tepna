# tepna-capture — tests/test_link_rssi.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Tests for the pure parsing surface of link_rssi (the RSSI side of the weak-signal warning). The
# subprocess/sudo path needs a privileged helper + a real adapter, so only the parsers are unit-tested;
# link_rssi.py is stdlib-only (asyncio/os/re), no bleak → imports cleanly in the hardware-free CI.

import link_rssi


def _run(coro):
    return asyncio.run(coro)


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


# ── parse_rssi: the two shapes, the plausibility window, and case-insensitivity ─────────────────────
def test_rssi_is_read_from_hcitools_wording_and_from_a_bare_number():
    """Two producers, one parser. hcitool prints `RSSI return value: -63`; the helper prints just the
    number. Losing either shape silently returns None, and a None RSSI reads as "no link data" rather
    than as "the parser did not understand" — so a working adapter looks like an absent one."""
    assert link_rssi.parse_rssi("RSSI return value: -63") == -63
    assert link_rssi.parse_rssi("rssi RETURN value:  -70") == -70, "re.I — the case varies by tool version"
    assert link_rssi.parse_rssi("-55\n") == -55, "the helper prints a bare number"
    assert link_rssi.parse_rssi("") is None
    assert link_rssi.parse_rssi("no signal here") is None


def test_the_plausible_rssi_window_is_closed_at_both_ends():
    """`-127 <= val <= -1`. BLE RSSI is negative dBm; -127 is the floor the controller reports for
    "no measurement" boundary cases and IS a real reading, while 0 or positive means the parser picked
    up the wrong number (a count, a handle) and must be rejected rather than logged as a signal."""
    assert link_rssi.parse_rssi("RSSI return value: -127") == -127, "the floor is a real reading"
    assert link_rssi.parse_rssi("RSSI return value: -1") == -1
    assert link_rssi.parse_rssi("RSSI return value: -128") is None, "below the floor is a misparse"
    assert link_rssi.parse_rssi("RSSI return value: 0") is None, "0 dBm is not a BLE RSSI"


def test_read_rssi_refuses_without_a_device_or_without_the_helper(monkeypatch, tmp_path):
    """`not dev_mac OR not exists(_HELPER)` — either alone is disqualifying. As `and`, a missing MAC
    with the helper present would proceed and query the wrong thing; the guard exists because vigil
    runs without hcitool at all (Pi 5), which is what the nmcli-only first cut discovered the hard way.
    """
    monkeypatch.setattr(link_rssi.os.path, "exists", lambda p: True)
    assert _run(link_rssi.read_rssi("", "AA:BB")) is None, "no device MAC -> refuse, even with a helper"

    monkeypatch.setattr(link_rssi.os.path, "exists", lambda p: False)
    assert _run(link_rssi.read_rssi("AA:BB:CC:DD:EE:FF", "AA:BB")) is None, "no helper -> refuse"


# ── THE DEPENDENCY-FREE LAYER IS GONE, SO THE OVERLAY MUST BE REACHABLE ────────────────────────────
# residue 2026-09-12-sysfs-hci-address-attr-gone. `sysfs_hci` returns {} on a current kernel (the
# `address` attribute was REMOVED, measured on both boxes), so on a box without `hcitool` the cheap
# sources yield nothing at all — and the old overlay guard asked D-Bus only on behalf of a PINNED
# adapter. With nothing pinned, `resolve_hci` returned None with no error.


def _hci_env(monkeypatch, *, sysfs, hcitool, dbus):
    """Drive resolve_hci's three sources independently and COUNT the D-Bus calls, because the cost
    argument in the code ("the common case still costs one subprocess") is part of the contract."""
    import link_rssi

    calls = {"dbus": 0}

    async def _fake_run(argv):
        return hcitool if argv and argv[0] == "hcitool" else None

    async def _fake_dbus():
        calls["dbus"] += 1
        return dict(dbus)

    monkeypatch.setattr(link_rssi, "sysfs_hci", lambda *a, **k: dict(sysfs))
    monkeypatch.setattr(link_rssi, "_run", _fake_run)
    monkeypatch.setattr(link_rssi, "dbus_hci", _fake_dbus)
    link_rssi._HCI_CACHE.clear()
    return calls


def test_resolve_hci_asks_dbus_WHEN_THE_CHEAP_SOURCES_ANSWERED_NOTHING(monkeypatch):
    """THE DEFECT. The Pi 5 target: sysfs dead, no hcitool, no `adapter:` pinned. `key` is "", so the
    old `key and key not in devs` guard was False and D-Bus was never asked — resolve_hci returned None
    and RSSI read as simply unavailable, with nothing logged."""
    calls = _hci_env(monkeypatch, sysfs={}, hcitool=None, dbus={"C6:CF:3C:4E:75:F0": "hci0"})
    assert _run(link_rssi.resolve_hci(None)) == "hci0"
    assert calls["dbus"] == 1


def test_resolve_hci_does_NOT_ask_dbus_WHEN_A_CHEAP_SOURCE_ANSWERED(monkeypatch):
    """The cost guarantee, and the reason the guard is `not devs` rather than an unconditional overlay.
    This is also the vigil case — `hcitool dev` lists controllers there — so the change is inert on the
    production box by the same assertion that pins the cost."""
    calls = _hci_env(monkeypatch, sysfs={}, hcitool="Devices:\n\thci0\t00:01:95:CC:53:02\n", dbus={})
    assert _run(link_rssi.resolve_hci(None)) == "hci0"
    assert calls["dbus"] == 0, "a cheap source answered; D-Bus must not be paid for"


def test_resolve_hci_STILL_asks_dbus_for_a_pinned_adapter_the_cheap_sources_missed(monkeypatch):
    """The pre-existing behaviour the widening must not disturb: a static-random controller is invisible
    to sysfs/hcitool, so a pinned key absent from `devs` still reaches the overlay."""
    calls = _hci_env(
        monkeypatch, sysfs={}, hcitool="Devices:\n\thci0\t00:01:95:CC:53:02\n", dbus={"C6:CF:3C:4E:75:F0": "hci1"}
    )
    assert _run(link_rssi.resolve_hci("c6:cf:3c:4e:75:f0")) == "hci1"
    assert calls["dbus"] == 1


def test_resolve_hci_is_still_None_when_NO_source_knows_anything(monkeypatch):
    """Widening the guard must not invent an answer: every source empty still resolves to None, and the
    overlay is asked exactly once rather than in a loop."""
    calls = _hci_env(monkeypatch, sysfs={}, hcitool=None, dbus={})
    assert _run(link_rssi.resolve_hci(None)) is None
    assert calls["dbus"] == 1


def test_sysfs_hci_returns_EMPTY_when_the_kernel_publishes_no_address_attribute(tmp_path):
    """The measured state of a current kernel, as a positive control: the nodes are LISTED and carry
    `device power reset rfkill0 subsystem uevent` with no `address`. The function must return {} — an
    honest "I know nothing" — rather than raising or inventing an entry."""
    import link_rssi

    base = tmp_path / "bt"
    for n in ("hci0", "hci1"):
        d = base / n
        d.mkdir(parents=True)
        (d / "uevent").write_text("DEVTYPE=host\n")  # exactly what kernel 7.0 exposes
    assert link_rssi.sysfs_hci(str(base)) == {}
