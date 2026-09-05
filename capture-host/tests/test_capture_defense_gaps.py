"""capture.py gap-fill — the startup self-test and its sysfs probes.

`startup_defense_check` exists because the P0.1 autosuspend fix was installed but NOT IN FORCE for
weeks (`VIGIL-OVERNIGHT-FINDINGS`, the 50- vs 99- udev prefix), and only a daemon self-test revealed
it. So its own probes must degrade silently on any host that does not look like the box — a self-test
that raises would keep capture from starting, which is strictly worse than the problem it detects.
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import capture  # noqa: E402


# ── _usb_power_control_path ─────────────────────────────────────────────────────────────────────────
def test_usb_power_control_path_walks_up_to_the_usb_device_node(tmp_path, monkeypatch):
    """Generic on purpose: walk `<hci>/device` upward to the first ancestor carrying idVendor, so it
    works on any host rather than being pinned to this box's bus-port."""
    usb = tmp_path / "usb1" / "1-2"
    (usb / "power").mkdir(parents=True)
    (usb / "idVendor").write_text("0bda\n")
    (usb / "power" / "control").write_text("on\n")
    leaf = usb / "1-2:1.0" / "bluetooth" / "hci0"
    leaf.mkdir(parents=True)
    monkeypatch.setattr(capture.os.path, "realpath", lambda _p: str(leaf))
    assert capture._usb_power_control_path("hci0") == str(usb / "power" / "control")


def test_usb_power_control_path_none_when_no_control_file(tmp_path, monkeypatch):
    """An ancestor with idVendor but no power/control — a non-USB or oddly-exported device."""
    usb = tmp_path / "dev"
    usb.mkdir()
    (usb / "idVendor").write_text("8087\n")
    monkeypatch.setattr(capture.os.path, "realpath", lambda _p: str(usb))
    assert capture._usb_power_control_path("hci0") is None


def test_usb_power_control_path_none_for_a_non_usb_adapter(tmp_path, monkeypatch):
    """No idVendor anywhere up the chain — a built-in UART radio, not USB. Not an error."""
    monkeypatch.setattr(capture.os.path, "realpath", lambda _p: str(tmp_path))
    assert capture._usb_power_control_path("hci0") is None


def test_usb_power_control_path_swallows_a_sysfs_error(monkeypatch):
    """Probing sysfs must never raise into startup."""
    def boom(_p):
        raise OSError("EACCES")
    monkeypatch.setattr(capture.os.path, "realpath", boom)
    assert capture._usb_power_control_path("hci0") is None


# ── startup_defense_check ───────────────────────────────────────────────────────────────────────────
def test_startup_defense_check_reads_autosuspend_and_warns(tmp_path, monkeypatch, caplog):
    """`power/control=auto` on the pinned radio is the exact setting that cost ~110 min on 2026-07-23,
    so the daemon says so at boot rather than waiting for the night to lose data."""
    ctrl = tmp_path / "control"
    ctrl.write_text("auto\n")
    monkeypatch.setattr(capture, "_usb_power_control_path", lambda _h: str(ctrl))
    with caplog.at_level("WARNING"):
        asyncio.run(capture.startup_defense_check("hci0"))
    assert any("autosuspend" in r.getMessage().lower() for r in caplog.records)


def test_startup_defense_check_is_quiet_when_autosuspend_is_off(tmp_path, monkeypatch, caplog):
    ctrl = tmp_path / "control"
    ctrl.write_text("on\n")
    monkeypatch.setattr(capture, "_usb_power_control_path", lambda _h: str(ctrl))
    with caplog.at_level("WARNING"):
        asyncio.run(capture.startup_defense_check("hci0"))
    # The ENABLED warning names the offending value; other startup warnings (e.g. missing CAP_NET_ADMIN)
    # are unrelated and may legitimately fire on a dev box.
    assert not any("power/control=auto" in r.getMessage() for r in caplog.records)


def test_startup_defense_check_uses_ISMOUNT_not_isdir_for_the_archive_dest(tmp_path, monkeypatch, caplog):
    """THE trap `storage_targets` names, reached through the real wiring.

    An unmounted mountpoint is a present, empty, WRITABLE directory on the boot disk. `isdir` says yes, so
    ~350 MB/night lands on the wrong filesystem while the mirror reports success and the operator believes
    the nights are on the NAS. Only `ismount` can tell those apart.

    The pure-function tests above take `archive_dest_ready` as an argument, so they cannot see which probe
    produced it — this one drives `startup_defense_check` against a real directory that exists and is not a
    mount, which is exactly the failing shape."""
    ctrl = tmp_path / "control"
    ctrl.write_text("on\n")
    monkeypatch.setattr(capture, "_usb_power_control_path", lambda _h: str(ctrl))
    dest = tmp_path / "archive"                 # exists, writable, NOT a mountpoint
    dest.mkdir()
    cfg = {"watchdog": {"usb_path": "11-1.2"},
           "archive": {"enabled": True, "dest": str(dest)}}
    with caplog.at_level("WARNING"):
        asyncio.run(capture.startup_defense_check("hci0", cfg))
    assert any("NOT ready (not mounted)" in r.getMessage() for r in caplog.records), \
        [r.getMessage() for r in caplog.records]


def test_startup_defense_check_warns_when_nothing_offloads(tmp_path, monkeypatch, caplog):
    """Measured on the live box 2026-08-04: no archive configured, 0 `.archived` markers across 11 nights.
    Capture was working perfectly, which is precisely why nothing surfaced it."""
    ctrl = tmp_path / "control"
    ctrl.write_text("on\n")
    monkeypatch.setattr(capture, "_usb_power_control_path", lambda _h: str(ctrl))
    with caplog.at_level("WARNING"):
        asyncio.run(capture.startup_defense_check("hci0", {"watchdog": {"usb_path": "x"}}))
    msgs = [r.getMessage() for r in caplog.records]
    assert any("archive is NOT configured" in m for m in msgs), msgs


def test_archive_enabled_with_NO_destination_still_counts_as_unconfigured(tmp_path, monkeypatch, caplog):
    """`enabled: true` with no `dest`/`target` is the most reassuring possible misconfiguration: the config
    reads as if offloading is on, and nothing is ever copied. Armed-looking is the failure mode this whole
    self-test exists to catch, so the flag alone is not enough — a destination has to exist too."""
    ctrl = tmp_path / "control"
    ctrl.write_text("on\n")
    monkeypatch.setattr(capture, "_usb_power_control_path", lambda _h: str(ctrl))
    cfg = {"watchdog": {"usb_path": "x"}, "archive": {"enabled": True}}      # no dest, no target
    with caplog.at_level("WARNING"):
        asyncio.run(capture.startup_defense_check("hci0", cfg))
    msgs = [r.getMessage() for r in caplog.records]
    assert any("archive is NOT configured" in m for m in msgs), msgs


def test_an_unprobeable_archive_dest_is_silent_rather_than_alarming(tmp_path, monkeypatch, caplog):
    """`ismount` can raise on a path the process cannot stat. Neither answer is knowable then, so the
    check says nothing about mountedness rather than guessing — the same rule as every other probe here.
    The "not configured" warning is separate and correctly stays quiet, since a dest IS set."""
    ctrl = tmp_path / "control"
    ctrl.write_text("on\n")
    monkeypatch.setattr(capture, "_usb_power_control_path", lambda _h: str(ctrl))

    def boom(_p):
        raise OSError("permission denied")
    monkeypatch.setattr(capture.os.path, "ismount", boom)
    cfg = {"watchdog": {"usb_path": "x"},
           "archive": {"enabled": True, "dest": str(tmp_path / "arch")}}
    with caplog.at_level("WARNING"):
        asyncio.run(capture.startup_defense_check("hci0", cfg))
    msgs = [r.getMessage() for r in caplog.records]
    assert not any("NOT ready (not mounted)" in m for m in msgs), msgs
    assert not any("archive is NOT configured" in m for m in msgs), msgs


def test_startup_defense_check_without_a_cfg_judges_no_config_defense(tmp_path, monkeypatch, caplog):
    """A check that cannot see its input must not report on it — in either direction. Called without a
    cfg (the pre-existing signature), the config-derived defenses are simply not assessed."""
    ctrl = tmp_path / "control"
    ctrl.write_text("on\n")
    monkeypatch.setattr(capture, "_usb_power_control_path", lambda _h: str(ctrl))
    with caplog.at_level("WARNING"):
        asyncio.run(capture.startup_defense_check("hci0"))
    msgs = [r.getMessage() for r in caplog.records]
    assert not any("usb_path is UNSET" in m or "archive is NOT" in m for m in msgs), msgs


def test_startup_defense_check_survives_an_unreadable_control_file(monkeypatch):
    """The path resolved but the read failed. Report what it can, never raise."""
    monkeypatch.setattr(capture, "_usb_power_control_path", lambda _h: "/nonexistent/control")
    asyncio.run(capture.startup_defense_check("hci0"))          # must not raise


def test_startup_defense_check_with_no_adapter_pinned(monkeypatch):
    """`hci` is None when no adapter is configured — skip the probe entirely rather than guessing."""
    monkeypatch.setattr(capture, "_usb_power_control_path",
                        lambda _h: pytest.fail("must not probe without a pinned adapter"))
    asyncio.run(capture.startup_defense_check(None))


def test_startup_defense_check_survives_an_unreadable_proc_status(tmp_path, monkeypatch):
    """CapEff tells the watchdog whether its recovery ladder can actually fire. Unreadable /proc is a
    container quirk, not a reason to refuse to start."""
    ctrl = tmp_path / "control"
    ctrl.write_text("on\n")
    monkeypatch.setattr(capture, "_usb_power_control_path", lambda _h: str(ctrl))
    real = open

    def boom(path, *a, **k):
        if str(path) == "/proc/self/status":
            raise OSError("EACCES")
        return real(path, *a, **k)
    monkeypatch.setattr("builtins.open", boom)
    asyncio.run(capture.startup_defense_check("hci0"))          # must not raise


# ── §B2 — the Trusted-sensor tripwire (VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT 2026-09-05) ────────────────
# A sensor left `Trusted` on the capture adapter arms the kernel's autoconnect, which races bleak for
# the single ACL slot. bond() no longer sets trust, but a flag leaked by the old script is invisible
# until the race bites — measured live: both Polars `Trusted: yes` months after the untrust shipped.

def test_defense_warnings_name_each_trusted_sensor():
    out = capture.defense_warnings("on", None,
                                   trusted_sensors=["AA:AA:AA:AA:AA:AA", "BB:BB:BB:BB:BB:BB"])
    hits = [w for w in out if "Trusted on the capture adapter" in w]
    assert len(hits) == 2
    assert "AA:AA:AA:AA:AA:AA" in hits[0] and "untrust AA:AA:AA:AA:AA:AA" in hits[0]
    assert "BB:BB:BB:BB:BB:BB" in hits[1]


def test_defense_warnings_are_quiet_when_no_sensor_is_trusted():
    for kw in ({}, {"trusted_sensors": ()}):
        assert not any("Trusted" in w for w in capture.defense_warnings("on", None, **kw))


def test_startup_defense_check_reads_trusted_flags_for_the_configured_sensors(tmp_path, monkeypatch, caplog):
    """The gather side: addresses come from cfg.devices, the adapter from cfg.adapter — the flag is
    PER-ADAPTER (measured: Trusted no on hci0, yes on hci1, same device), so querying the default
    controller would under-warn."""
    ctrl = tmp_path / "control"
    ctrl.write_text("on\n")
    monkeypatch.setattr(capture, "_usb_power_control_path", lambda _h: str(ctrl))
    seen = {}

    async def fake(addrs, adapter=None):
        seen["addrs"], seen["adapter"] = list(addrs), adapter
        return ["D1:98:62:7C:92:B3"]
    monkeypatch.setattr(capture.bonding, "trusted_flags", fake)
    cfg = {"adapter": "00:01:95:CC:53:02",
           "devices": [{"address": "D1:98:62:7C:92:B3"}, {"address": "24:AC:AC:02:84:96"}, {}]}
    with caplog.at_level("WARNING"):
        asyncio.run(capture.startup_defense_check("hci0", cfg))
    assert seen == {"addrs": ["D1:98:62:7C:92:B3", "24:AC:AC:02:84:96"],
                    "adapter": "00:01:95:CC:53:02"}
    assert any("D1:98:62:7C:92:B3 is Trusted" in r.getMessage() for r in caplog.records)


def test_startup_defense_check_survives_a_trusted_flags_failure(tmp_path, monkeypatch, caplog):
    """The tripwire must never keep capture from starting, and a failed read is silence, not a warn."""
    ctrl = tmp_path / "control"
    ctrl.write_text("on\n")
    monkeypatch.setattr(capture, "_usb_power_control_path", lambda _h: str(ctrl))

    async def boom(addrs, adapter=None):
        raise RuntimeError("no bluetoothctl here")
    monkeypatch.setattr(capture.bonding, "trusted_flags", boom)
    with caplog.at_level("WARNING"):
        asyncio.run(capture.startup_defense_check(
            "hci0", {"adapter": "X", "devices": [{"address": "AA:AA:AA:AA:AA:AA"}]}))
    assert not any("Trusted" in r.getMessage() for r in caplog.records)
