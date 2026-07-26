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
