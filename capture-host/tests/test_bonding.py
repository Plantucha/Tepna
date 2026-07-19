# tepna-capture — tests/test_bonding.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The bluetoothctl wrapper. A Polar H10 REFUSES PMD on an unauthenticated link and drops ~1-2 s after
# connect, so a correct bond is the difference between a night of ECG and a night of nothing. All of the
# logic here is text-scraping a CLI whose output format is not a contract, which is exactly why it needs
# tests: the failure mode is a silent misparse (a device reported unbonded forever, or a failed pair
# reported as success), not an exception.
#
# _btctl / _delayed_script are the only subprocess surface; both are stubbed, so no BlueZ is touched.

import asyncio

import pytest

import bonding

DEVICES_OUT = """\
Device AA:BB:CC:DD:EE:FF Polar H10 02849638
Device 11:22:33:44:55:66 Polar Verity Sense 0C301E3F
Device 99:88:77:66:55:44 Some Random Speaker
Device AA:BB:CC:DD:EE:FF Polar H10 02849638
"""

INFO_BONDED = """\
Device AA:BB:CC:DD:EE:FF (public)
\tName: Polar H10 02849638
\tPaired: yes
\tBonded: yes
\tConnected: yes
\tRSSI: 0xffffffc8 (-56)
"""

INFO_FRESH = """\
Device 11:22:33:44:55:66 (public)
\tName: Polar Verity Sense
\tPaired: no
\tBonded: no
\tConnected: no
\tRSSI: 0xffffffb0 (-80)
"""


def _run(coro):
    return asyncio.run(coro)


def _stub(monkeypatch, *, delayed="", info_by_addr=None, record=None):
    async def fake_delayed(lines):
        if record is not None:
            record.extend(lines)
        return delayed

    async def fake_btctl(script, timeout=20.0):
        if record is not None:
            record.append(script)
        for addr, out in (info_by_addr or {}).items():
            if addr in script:
                return out
        return delayed
    monkeypatch.setattr(bonding, "_delayed_script", fake_delayed)
    monkeypatch.setattr(bonding, "_btctl", fake_btctl)


# ── adapter selection ───────────────────────────────────────────────────────────────────────────────
def test_adapter_prefix_selects_the_configured_radio_or_nothing():
    assert bonding._adapter_prefix("AA:AA:AA:AA:AA:AA") == [(0, "select AA:AA:AA:AA:AA:AA")]
    assert bonding._adapter_prefix(None) == [], "unconfigured must not emit a select at all"


def test_scan_selects_the_adapter_before_scanning(monkeypatch):
    """On a multi-radio host, scanning the wrong controller finds nothing and looks like a dead sensor."""
    rec = []
    _stub(monkeypatch, delayed=DEVICES_OUT, record=rec)
    _run(bonding.scan("AA:AA:AA:AA:AA:AA", seconds=0))
    assert rec[0] == (0, "select AA:AA:AA:AA:AA:AA"), "select must come first, before scan on"


# ── scan parsing ────────────────────────────────────────────────────────────────────────────────────
def test_scan_parses_devices_and_dedupes_by_address(monkeypatch):
    _stub(monkeypatch, delayed=DEVICES_OUT)
    found = _run(bonding.scan(seconds=0))
    addrs = [f.address for f in found]
    assert len(addrs) == len(set(addrs)) == 3, "a repeated advertisement must not duplicate the device"
    assert "AA:BB:CC:DD:EE:FF" in addrs


def test_scan_flags_known_health_sensors(monkeypatch):
    _stub(monkeypatch, delayed=DEVICES_OUT)
    by = {f.address: f for f in _run(bonding.scan(seconds=0))}
    assert by["AA:BB:CC:DD:EE:FF"].health is True
    assert by["11:22:33:44:55:66"].health is True
    assert by["99:88:77:66:55:44"].health is False, "a speaker must not be foregrounded as a sensor"


def test_scan_enriches_from_info(monkeypatch):
    _stub(monkeypatch, delayed=DEVICES_OUT,
          info_by_addr={"AA:BB:CC:DD:EE:FF": INFO_BONDED, "11:22:33:44:55:66": INFO_FRESH})
    by = {f.address: f for f in _run(bonding.scan(seconds=0))}
    h10 = by["AA:BB:CC:DD:EE:FF"]
    assert h10.bonded is True and h10.connected is True and h10.rssi == -56
    verity = by["11:22:33:44:55:66"]
    assert verity.bonded is False and verity.connected is False and verity.rssi == -80


def test_scan_reads_the_signed_rssi_not_the_hex_word(monkeypatch):
    """bluetoothctl prints `RSSI: 0xffffffc8 (-56)`. Taking the hex would yield 4294967240."""
    _stub(monkeypatch, delayed="Device AA:BB:CC:DD:EE:FF X\n",
          info_by_addr={"AA:BB:CC:DD:EE:FF": INFO_BONDED})
    assert _run(bonding.scan(seconds=0))[0].rssi == -56


def test_scan_leaves_rssi_none_when_absent(monkeypatch):
    """No RSSI line means unknown. A fabricated 0 would sort as the strongest signal on the list."""
    _stub(monkeypatch, delayed="Device AA:BB:CC:DD:EE:FF Polar H10\n",
          info_by_addr={"AA:BB:CC:DD:EE:FF": "Device AA:BB:CC:DD:EE:FF\n\tBonded: no\n"})
    assert _run(bonding.scan(seconds=0))[0].rssi is None


def test_scan_orders_health_first_then_strongest_signal(monkeypatch):
    """Ordering is what the UI shows first — a bedside user picking their strap should not have to hunt
    past a neighbour's speaker."""
    out = ("Device 99:88:77:66:55:44 Loud Speaker\n"
           "Device AA:BB:CC:DD:EE:FF Polar H10\n"
           "Device 11:22:33:44:55:66 Polar Verity Sense\n")
    _stub(monkeypatch, delayed=out, info_by_addr={
        "99:88:77:66:55:44": "\tRSSI: 0x0 (-30)\n",     # strongest, but not a sensor
        "AA:BB:CC:DD:EE:FF": "\tRSSI: 0x0 (-70)\n",
        "11:22:33:44:55:66": "\tRSSI: 0x0 (-50)\n",
    })
    order = [f.address for f in _run(bonding.scan(seconds=0))]
    assert order[0] == "11:22:33:44:55:66", "health sensors first, strongest of them leading"
    assert order[1] == "AA:BB:CC:DD:EE:FF"
    assert order[2] == "99:88:77:66:55:44", "non-sensor sorts last despite the best RSSI"


def test_scan_puts_unknown_rssi_after_known_within_the_same_class(monkeypatch):
    out = "Device AA:BB:CC:DD:EE:FF Polar A\nDevice 11:22:33:44:55:66 Polar B\n"
    _stub(monkeypatch, delayed=out, info_by_addr={
        "AA:BB:CC:DD:EE:FF": "\tBonded: no\n",           # no RSSI at all
        "11:22:33:44:55:66": "\tRSSI: 0x0 (-90)\n",      # weak, but known
    })
    assert [f.address for f in _run(bonding.scan(seconds=0))][0] == "11:22:33:44:55:66"


# ── is_bonded / ensure_bonded ───────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("info,expected", [
    ("\tBonded: yes\n", True),
    ("\tPaired: yes\n", True),          # older BlueZ reports Paired only
    ("\tBonded: no\n\tPaired: no\n", False),
    ("", False),                        # device unknown to the controller
])
def test_is_bonded_accepts_either_bluez_spelling(monkeypatch, info, expected):
    _stub(monkeypatch, delayed=info)
    assert _run(bonding.is_bonded("AA:BB:CC:DD:EE:FF")) is expected


def test_ensure_bonded_short_circuits_when_already_bonded(monkeypatch):
    """Called before every connect. Re-pairing an already-bonded strap costs ~20 s of scripted
    bluetoothctl and can drop a live link, so the fast path must not touch bond()."""
    _stub(monkeypatch, delayed="\tBonded: yes\n")
    called = []
    monkeypatch.setattr(bonding, "bond", lambda *a, **k: called.append(a))
    assert _run(bonding.ensure_bonded("AA:BB:CC:DD:EE:FF")) is True
    assert not called, "must not re-bond an already-bonded device"


def test_ensure_bonded_bonds_when_not_yet_paired(monkeypatch):
    _stub(monkeypatch, delayed="\tBonded: no\n")

    async def fake_bond(address, adapter_mac=None):
        return {"ok": True, "detail": "paired", "address": address}
    monkeypatch.setattr(bonding, "bond", fake_bond)
    assert _run(bonding.ensure_bonded("AA:BB:CC:DD:EE:FF")) is True


def test_ensure_bonded_reports_failure_rather_than_raising(monkeypatch):
    _stub(monkeypatch, delayed="\tBonded: no\n")

    async def fake_bond(address, adapter_mac=None):
        return {"ok": False, "detail": "auth-failed", "address": address}
    monkeypatch.setattr(bonding, "bond", fake_bond)
    assert _run(bonding.ensure_bonded("AA:BB:CC:DD:EE:FF")) is False


# ── bond ────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("out,ok,detail", [
    ("Pairing successful", True, "paired"),
    ("\tBonded: yes\n", True, "paired"),
    ("Failed to pair: org.bluez.Error.AuthenticationFailed", False, "auth-failed"),
    ("Device AA:BB:CC:DD:EE:FF not available", False, "not-found"),
    ("some other noise", False, "failed"),
])
def test_bond_classifies_the_outcome(monkeypatch, out, ok, detail):
    """The detail string drives what the UI tells the user to do — retry, move closer, or wake the
    device. Collapsing these into a bare False sends them to the wrong remedy."""
    _stub(monkeypatch, delayed=out)
    r = _run(bonding.bond("AA:BB:CC:DD:EE:FF"))
    assert r["ok"] is ok and r["detail"] == detail and r["address"] == "AA:BB:CC:DD:EE:FF"


def test_bond_registers_a_just_works_agent_before_pairing(monkeypatch):
    """Headless: with no agent registered the pair prompts on a console nobody is watching and times out."""
    rec = []
    _stub(monkeypatch, delayed="Pairing successful", record=rec)
    _run(bonding.bond("AA:BB:CC:DD:EE:FF"))
    cmds = [c for _d, c in rec if isinstance(_d, (int, float))]
    assert "agent NoInputNoOutput" in cmds and "default-agent" in cmds
    assert cmds.index("agent NoInputNoOutput") < cmds.index("pair AA:BB:CC:DD:EE:FF")
    assert cmds.index("trust AA:BB:CC:DD:EE:FF") < cmds.index("pair AA:BB:CC:DD:EE:FF"), \
        "trust must precede pair — the verified 2026-07-16 sequence"


# ── forget ──────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("out,ok", [
    ("Device has been removed", True),
    ("[DEL] Device AA:BB:CC:DD:EE:FF removed", True),
    ("Device AA:BB:CC:DD:EE:FF not available", False),
])
def test_forget_reports_removal(monkeypatch, out, ok):
    _stub(monkeypatch, delayed=out)
    assert _run(bonding.forget("AA:BB:CC:DD:EE:FF"))["ok"] is ok


def test_forget_targets_the_configured_adapter(monkeypatch):
    rec = []
    _stub(monkeypatch, delayed="Device has been removed", record=rec)
    _run(bonding.forget("AA:BB:CC:DD:EE:FF", "AA:AA:AA:AA:AA:AA"))
    assert "select AA:AA:AA:AA:AA:AA" in rec[0]
    assert "remove AA:BB:CC:DD:EE:FF" in rec[0]
