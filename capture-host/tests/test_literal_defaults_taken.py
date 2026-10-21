# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Michal Planicka — Tepna
"""Each literal default below is taken by a production call that omits the parameter.

The row `2026-10-20-thirty-six-literal-defaults-are-taken-by-no-call-in-the-tree` found that no test
omitted these parameters, so a mutant on the default survived. A test that reads the signature cannot
see such a mutant: mutmut keeps the original default on the visible `def`. Each test here calls the
function WITHOUT the parameter and observes the value at the place where the function uses it.
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import capture  # noqa: E402
import clockcfg  # noqa: E402
import link_rssi  # noqa: E402
import oxyii  # noqa: E402


def test_the_rung_probe_reads_the_real_usb_and_bluetooth_roots(monkeypatch):
    seen = []
    with monkeypatch.context() as m:
        m.setattr(capture.os.path, "isdir", lambda p: seen.append(("isdir", p)) or True)
        m.setattr(capture.os, "listdir", lambda p: seen.append(("listdir", p)) or [])
        capture.usb_rung_probe("1-2")
    assert seen == [("isdir", "/sys/bus/usb/devices/1-2"), ("listdir", "/sys/class/bluetooth")]


def test_the_usb_device_walk_starts_at_the_bluetooth_class_root(monkeypatch):
    seen = []
    with monkeypatch.context() as m:
        m.setattr(capture.os.path, "realpath", lambda p: seen.append(p) or "/")
        assert capture._usb_dev_dir("hci9") is None
        assert capture.adapter_usb_id("hci8") is None
    assert seen == ["/sys/class/bluetooth/hci9/device", "/sys/class/bluetooth/hci8/device"]


def test_the_rss_read_opens_this_process_status_file(monkeypatch):
    seen = []

    def _open(path, *a, **k):
        seen.append(path)
        raise OSError("not read in this test")

    with monkeypatch.context() as m:
        m.setattr(capture, "open", _open, raising=False)
        out = capture.proc_rss_kb()
    assert seen == ["/proc/self/status"]
    assert out == {k: None for k in capture._RSS_KEYS}


def test_the_cpap_autostart_loop_polls_every_five_seconds(monkeypatch, tmp_path):
    slept = []

    async def _sleep(s):
        slept.append(s)
        capture._STOP.set()

    monkeypatch.setattr(capture, "_CPAP_AUTOSTART", {})
    capture._STOP.clear()
    try:
        asyncio.run(
            capture._cpap_autostart_loop(
                root=str(tmp_path),
                op=None,
                is_running=lambda: False,
                retain_s=120.0,
                hold_s=120.0,
                max_attempts=3,
                sleep=_sleep,
                now_ms=lambda: 0.0,
                get_therapy=lambda: None,
            )
        )
    finally:
        capture._STOP.clear()
    assert slept == [5.0]


def test_the_cpap_connect_gives_each_adapter_twenty_seconds():
    got = []

    async def _connect(addr, adapter, timeout):
        got.append(timeout)
        return "link"

    result, used, _attempts = asyncio.run(
        capture._cpap_connect_any_adapter("04:CD", "hci1", connect=_connect, adapters=["hci1"])
    )
    assert (result, used, got) == ("link", "hci1", [20.0])


def test_the_loop_monitor_sleeps_one_second_per_tick(monkeypatch):
    slept = []

    async def _sleep(s):
        slept.append(s)
        capture._STOP.set()

    monkeypatch.setitem(capture.STATUS, "loop", {"lag_last_ms": 0.0, "lag_max_ms": 0.0, "stalls": 0, "ticks": 0})
    capture._STOP.clear()
    try:
        with monkeypatch.context() as m:
            m.setattr(capture.asyncio, "sleep", _sleep)
            asyncio.run(capture.loop_monitor())
    finally:
        capture._STOP.clear()
    assert slept == [1.0]


def test_the_clock_helper_gives_the_command_twenty_seconds(monkeypatch):
    got = []

    async def _run(*cmd, timeout):
        got.append(timeout)
        return 0, "ok"

    monkeypatch.setattr(clockcfg.os, "access", lambda p, mode: True)
    monkeypatch.setattr(clockcfg, "_run", _run)
    assert asyncio.run(clockcfg._helper("sync")) == {"ok": True, "detail": "ok"}
    assert got == [20]


def test_the_rssi_address_map_lists_the_bluetooth_class_root(monkeypatch):
    seen = []
    with monkeypatch.context() as m:
        m.setattr(link_rssi.os, "listdir", lambda p: seen.append(p) or [])
        assert link_rssi.sysfs_hci() == {}
    assert seen == ["/sys/class/bluetooth"]


def test_the_ring_frames_default_to_sequence_zero():
    assert oxyii.file_list_frame() == oxyii.encode(0xF1, b"", 0)
    assert oxyii.file_end_frame() == oxyii.encode(0xF4, b"", 0)
    assert oxyii.info_frame() == oxyii.encode(0xE1, b"", 0)


def test_the_ring_auth_defaults_to_serial_0000(monkeypatch):
    t = 1_788_000_000
    assert oxyii.auth_payload(ts=t) == oxyii.auth_payload("0000", t)
    monkeypatch.setattr(oxyii.time, "time", lambda: t)
    assert oxyii.auth_frame() == oxyii.encode(oxyii.OP_AUTH, oxyii.auth_payload("0000", t))
