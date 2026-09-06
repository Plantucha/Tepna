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


# ══ A CONTROLLER WITH NO PUBLIC ADDRESS (2026-07-26) ══════════════════════════════════════════
# An LE-only controller is entitled to have no PUBLIC address. A Raytac MDBT50Q running Zephyr's USB
# HCI reports 00:00:00:00:00:00 to both sysfs and `hcitool dev`, while BlueZ has given it the
# static-random identity C6:CF:3C:4E:75:F0 — the address it bonds with, the one bluetoothctl prints,
# and the one an operator would naturally put in `adapter:`.
#
# Without a source that knows it, resolve_hci returned None, capture logged "configured adapter not
# found — falling back to the BlueZ default", and dropped the pin. On the box that day the BlueZ
# default WAS that same untested controller, so the pin would have failed OPEN onto a different radio
# while the log claimed a fallback. That is worse than no pin at all.

def test_dbus_hci_maps_a_controller_that_has_only_a_static_random_identity(monkeypatch):
    calls = []

    async def fake_run(argv):
        calls.append(argv)
        idx = argv[3].rsplit("/", 1)[1]
        return {"hci0": 's "AC:A7:F1:29:9D:1D"',
                "hci1": 's "F0:D5:BF:1E:79:21"',
                "hci2": 's "C6:CF:3C:4E:75:F0"'}.get(idx, "")

    monkeypatch.setattr(link_rssi, "_run", fake_run)
    monkeypatch.setattr(link_rssi.os, "listdir", lambda _p: ["hci0", "hci1", "hci2"])
    got = asyncio.run(link_rssi.dbus_hci())
    assert got == {"AC:A7:F1:29:9D:1D": "hci0", "F0:D5:BF:1E:79:21": "hci1",
                   "C6:CF:3C:4E:75:F0": "hci2"}


def test_dbus_hci_drops_an_all_zero_address(monkeypatch):
    """A zero address is the absence of an identity, not an identity. Mapping it would let any
    unconfigured controller answer to '00:00:00:00:00:00'."""
    async def fake_run(_argv):
        return 's "00:00:00:00:00:00"'
    monkeypatch.setattr(link_rssi, "_run", fake_run)
    monkeypatch.setattr(link_rssi.os, "listdir", lambda _p: ["hci2"])
    assert asyncio.run(link_rssi.dbus_hci()) == {}


def test_dbus_hci_is_empty_when_busctl_is_absent(monkeypatch):
    """No busctl / BlueZ down must degrade to {}, never raise — the caller keeps hcitool's answer."""
    async def fake_run(_argv):
        return None
    monkeypatch.setattr(link_rssi, "_run", fake_run)
    monkeypatch.setattr(link_rssi.os, "listdir", lambda _p: ["hci0"])
    assert asyncio.run(link_rssi.dbus_hci()) == {}


def test_resolve_hci_falls_through_to_dbus_for_an_addressless_controller(monkeypatch):
    """THE regression. hcitool sees hci2 as all-zero; only BlueZ knows it is C6:CF:3C:4E:75:F0."""
    link_rssi._HCI_CACHE.clear()
    monkeypatch.setattr(link_rssi, "sysfs_hci", lambda *a, **k: {})

    async def fake_run(argv):
        if argv[0] == "hcitool":
            return "Devices:\n\thci2\t00:00:00:00:00:00\n\thci0\tAC:A7:F1:29:9D:1D\n"
        return 's "C6:CF:3C:4E:75:F0"' if argv[3].endswith("hci2") else 's "AC:A7:F1:29:9D:1D"'

    monkeypatch.setattr(link_rssi, "_run", fake_run)
    monkeypatch.setattr(link_rssi.os, "listdir", lambda _p: ["hci0", "hci2"])
    assert asyncio.run(link_rssi.resolve_hci("C6:CF:3C:4E:75:F0", refresh=True)) == "hci2"


def test_resolve_hci_does_not_pay_for_dbus_when_hcitool_already_answered(monkeypatch):
    """The common case must stay one subprocess: D-Bus is only consulted when the key is missing."""
    link_rssi._HCI_CACHE.clear()
    monkeypatch.setattr(link_rssi, "sysfs_hci", lambda *a, **k: {})
    seen = []

    async def fake_run(argv):
        seen.append(argv[0])
        return "Devices:\n\thci0\tAC:A7:F1:29:9D:1D\n" if argv[0] == "hcitool" else 's "X"'

    monkeypatch.setattr(link_rssi, "_run", fake_run)
    assert asyncio.run(link_rssi.resolve_hci("AC:A7:F1:29:9D:1D", refresh=True)) == "hci0"
    assert "busctl" not in seen, "D-Bus must not be consulted when hcitool already resolved the pin"


def test_a_device_without_its_own_adapter_inherits_the_global():
    """INHERITANCE, ASSERTED BY NAME — residue `2026-09-06-per-device-inheritance-inferred`.

    `PER-DEVICE-ADAPTER-PINNING` ticked "Tests cover: inheritance, explicit pin, pin to an absent MAC",
    but inheritance was only ever INFERRED: `test_the_partition_is_total_and_disjoint` needs it to hold
    for every device to be owned, so it is sound about the OUTCOME and silent about the MECHANISM. This
    names the mechanism, so a reader learns the rule from a test instead of from `instance_devices`.

    The rule (capture.py `instance_devices`): a device with no `adapter:` key takes the config's global
    `adapter:`; a device with one resolves it through the `adapters:` map.

    DISCRIMINATING, not just present: the pinned device must land on the OTHER instance. Asserting only
    that the inheriting device is owned would also pass if every device fell to the global."""
    mac_a = "00:01:95:CC:53:02"
    mac_b = "AC:A7:F1:29:9D:1D"
    cfg = {
        "adapter": mac_a,
        "adapters": {"sena": mac_a, "ub500": mac_b},
        "devices": [{"name": "Inherits"}, {"name": "Pinned", "adapter": "ub500"}],
    }
    assert [d["name"] for d in capture.instance_devices(cfg, "sena")] == ["Inherits"]
    assert [d["name"] for d in capture.instance_devices(cfg, "ub500")] == ["Pinned"]
    assert capture.unowned_devices(cfg) == []


def test_an_inherited_global_named_rather_than_a_mac_does_not_inherit():
    """⚠️ THE ASYMMETRY, pinned as the behaviour it HAS — found while re-deriving the mechanism above.

    A device's OWN `adapter:` is resolved through the `adapters:` map, so `adapter: sena` works. The
    INHERITED global is taken raw — `(cfg or {}).get("adapter")` — so a global written as a declared
    NAME rather than a MAC resolves to nothing and the device inherits NOTHING.

    That is a config an operator can reasonably write (`resolve_adapter_name`'s own docstring says names
    exist so the config and the systemd unit read the same way), and the two forms are not
    interchangeable in this one position.

    It fails LOUDLY rather than silently, which is why this pins rather than fixes: `unowned_devices`
    reports the device, and the caller logs that at startup. Recorded so the next reader meets the
    asymmetry in a test rather than in a capture that quietly served fewer devices than its config
    named. Whether the global should be resolved through the map is a behaviour change, not a test."""
    mac_a = "00:01:95:CC:53:02"
    cfg_mac = {"adapter": mac_a, "adapters": {"sena": mac_a}, "devices": [{"name": "d1"}]}
    cfg_name = {"adapter": "sena", "adapters": {"sena": mac_a}, "devices": [{"name": "d1"}]}
    assert [d["name"] for d in capture.instance_devices(cfg_mac, "sena")] == ["d1"]
    assert capture.instance_devices(cfg_name, "sena") == []
    assert capture.unowned_devices(cfg_mac) == []
    assert capture.unowned_devices(cfg_name) == ["d1"]
