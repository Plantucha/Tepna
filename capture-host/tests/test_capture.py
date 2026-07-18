# tepna-capture — capture watchdog tests
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# The adapter watchdog's whole job is to auto-recover a WEDGED radio WITHOUT reacting to the benign
# 'sensors simply not worn' state — so its classifier is where that distinction must be locked down.
import capture   # importable with stdlib + local modules only (yaml/bleak/aiohttp are lazy/runtime)


def test_not_worn_is_benign():
    # clean 'not found' on every device, no phantom link, no InProgress → NOT a wedge (user took them off)
    devs = [
        {"name": "H10", "address": "AA", "connected": False,
         "last_error": "BleakDeviceNotFoundError('... was not found.')", "bluez_connected": False},
        {"name": "O2Ring", "address": "BB", "connected": False,
         "last_error": "O2Ring not advertising (wear it finger-in + close the phone app)", "bluez_connected": False},
    ]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is False and h["reasons"] == [] and h["phantom"] == []


def test_inprogress_is_wedge():
    devs = [{"name": "H10", "address": "AA", "connected": False,
             "last_error": "BleakDBusError('org.bluez.Error.InProgress', 'Operation already in progress')",
             "bluez_connected": False}]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is True and "InProgress" in h["reasons"][0]


def test_phantom_link_is_wedge_and_names_address():
    # BlueZ says Connected: yes but our daemon has no link → stale phantom link (blocks re-advertise)
    devs = [{"name": "O2Ring", "address": "D1:98:62:7C:92:B3", "connected": False,
             "last_error": None, "bluez_connected": True}]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is True and h["phantom"] == ["D1:98:62:7C:92:B3"]


def test_connected_device_not_flagged():
    # a device BlueZ-connected AND owned by the daemon (streaming) is healthy, not a phantom
    devs = [{"name": "H10", "address": "AA", "connected": True, "last_error": None, "bluez_connected": True}]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is False and h["phantom"] == []


def test_mixed_one_streaming_one_notworn_is_benign():
    devs = [
        {"name": "H10", "address": "AA", "connected": True, "last_error": None, "bluez_connected": True},
        {"name": "O2Ring", "address": "BB", "connected": False,
         "last_error": "not advertising", "bluez_connected": False},
    ]
    assert capture.classify_adapter_health(devs)["wedged"] is False


def test_import_capture_needs_no_bleak():
    """`import capture` MUST work with stdlib + local modules only — the hardware-free CI has no bleak,
    yaml or aiohttp. Regression for 2026-07-18, when a top-level `import polar_psftp` (which imports
    bleak eagerly) turned the whole capture-host test job red; it passed locally only because the dev
    venv happens to have bleak installed. Runtime-only deps must be imported at their call site.

    Blocks the import via `sys.modules[name] = None`, which makes `import bleak` raise. (An earlier
    version of this test used a meta_path finder with find_module/load_module — an API REMOVED in
    Python 3.12 — so it blocked nothing and passed even with the bug present.)"""
    import subprocess
    import sys
    code = (
        "import sys\n"
        "for m in ('bleak', 'bleak.exc', 'bleak.backends', 'aiohttp', 'yaml'):\n"
        "    sys.modules[m] = None\n"
        "import capture\n"
        "print('ok')\n"
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=".")
    assert r.returncode == 0, f"import capture pulled in a runtime-only dep:\n{r.stderr[-900:]}"
