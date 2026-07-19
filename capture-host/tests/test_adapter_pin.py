# tepna-capture — tests/test_adapter_pin.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Pinning every BLE connection to the CONFIGURED adapter MAC. Regression for 2026-07-18: a controller
# power-cycle RE-ENUMERATED the hci indices (hci0 <-> hci2), so the BlueZ default became the onboard
# radio that cannot hear our sensors — every connect hung, PMD never started, and nothing in the log
# named the cause. capture.adapter_kw() resolves MAC -> hciN fresh so the pin survives re-enumeration.

import asyncio

import capture
import link_rssi


def _run(coro):
    return asyncio.run(coro)


def test_parse_hci_dev_maps_both_controllers():
    out = "Devices:\n\thci2\tAC:A7:F1:29:9D:1D\n\thci0\t58:10:31:F3:2C:30\n"
    assert link_rssi.parse_hci_dev(out) == {
        "AC:A7:F1:29:9D:1D": "hci2", "58:10:31:F3:2C:30": "hci0"}


def test_adapter_kw_is_empty_when_unconfigured(monkeypatch):
    monkeypatch.setattr(capture, "ADAPTER", None)
    assert _run(capture.adapter_kw()) == {}          # falls back to the BlueZ default, never fails hard


def test_adapter_kw_pins_the_configured_mac(monkeypatch):
    monkeypatch.setattr(capture, "ADAPTER", "AC:A7:F1:29:9D:1D")

    async def fake(mac, refresh=False):
        return "hci2"
    monkeypatch.setattr(link_rssi, "resolve_hci", fake)
    # bluez={"adapter": ...} — the bare `adapter` kwarg bleak deprecated is SWALLOWED once the shim goes,
    # which would drop the pin silently. See tests/test_no_deprecated_apis.py.
    assert _run(capture.adapter_kw()) == {"bluez": {"adapter": "hci2"}}
    assert _run(capture.adapter_hci()) == "hci2"          # bare name, for the PS-FTP path


def test_adapter_kw_follows_reenumeration(monkeypatch):
    """The whole point: the SAME configured MAC must resolve to whatever index it now holds."""
    monkeypatch.setattr(capture, "ADAPTER", "AC:A7:F1:29:9D:1D")
    seq = iter(["hci0", "hci2"])                     # before / after the power-cycle swap

    async def fake(mac, refresh=False):
        return next(seq)
    monkeypatch.setattr(link_rssi, "resolve_hci", fake)
    assert _run(capture.adapter_kw()) == {"bluez": {"adapter": "hci0"}}
    assert _run(capture.adapter_kw()) == {"bluez": {"adapter": "hci2"}}


def test_adapter_kw_degrades_when_adapter_missing(monkeypatch):
    """Configured adapter unplugged → fall back to the default rather than stopping capture."""
    monkeypatch.setattr(capture, "ADAPTER", "AC:A7:F1:29:9D:1D")

    async def fake(mac, refresh=False):
        return None
    monkeypatch.setattr(link_rssi, "resolve_hci", fake)
    assert _run(capture.adapter_kw()) == {}


def test_resolve_hci_refresh_drops_a_stale_cache_entry(monkeypatch):
    """A cached index for an adapter that has vanished must not keep being served."""
    link_rssi._HCI_CACHE["AA:BB:CC:DD:EE:FF"] = "hci9"

    async def fake_run(cmd, timeout=4.0):
        return "Devices:\n\thci0\t58:10:31:F3:2C:30\n"   # the cached MAC is gone
    monkeypatch.setattr(link_rssi, "_run", fake_run)
    assert _run(link_rssi.resolve_hci("AA:BB:CC:DD:EE:FF", refresh=True)) is None
    assert "AA:BB:CC:DD:EE:FF" not in link_rssi._HCI_CACHE
