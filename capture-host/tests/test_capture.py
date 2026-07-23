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


def test_inprogress_with_a_live_device_is_NOT_a_wedge():
    """MEASURED 2026-07-20: the churny O2Ring threw InProgress 22x while the H10 was streaming ECG. The
    watchdog read that lone InProgress as an ADAPTER wedge and power-cycled the radio 8x, dropping every
    link — a ~25 min self-inflicted outage. A single device's InProgress while ANOTHER is connected is
    device contention, not an adapter wedge: the radio is demonstrably working (it holds the other link)."""
    devs = [
        {"name": "H10", "address": "AA", "connected": True, "last_error": None, "bluez_connected": True},
        {"name": "O2Ring", "address": "BB", "connected": False,
         "last_error": "BleakDBusError('org.bluez.Error.InProgress', 'Operation already in progress')",
         "bluez_connected": False},
    ]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is False, "a lone InProgress while another device streams must NOT power-cycle"


def test_inprogress_with_NO_live_device_is_still_a_wedge():
    """The real-wedge case is preserved: InProgress while the radio serves NOBODY (no device connected)
    is a genuine adapter wedge and still triggers recovery — this is the 2026-07-18 saga the signal exists
    for. Only the 'a live link is present' case is downgraded to benign contention."""
    devs = [
        {"name": "H10", "address": "AA", "connected": False,
         "last_error": "BleakDBusError('org.bluez.Error.InProgress', 'Operation already in progress')",
         "bluez_connected": False},
        {"name": "O2Ring", "address": "BB", "connected": False, "last_error": "not advertising",
         "bluez_connected": False},
    ]
    assert capture.classify_adapter_health(devs)["wedged"] is True


def test_phantom_link_is_a_wedge_even_with_a_live_device():
    """The phantom-link signal is independent of the InProgress gate — a stale BlueZ link nobody can
    re-grab is a wedge regardless of whether another device is streaming."""
    devs = [
        {"name": "H10", "address": "AA", "connected": True, "last_error": None, "bluez_connected": True},
        {"name": "O2Ring", "address": "BB", "connected": False, "last_error": None, "bluez_connected": True},
    ]
    h = capture.classify_adapter_health(devs)
    assert h["wedged"] is True and h["phantom"] == ["BB"]


# ── VIGIL-DEEP-ANALYSIS §2C — per-stream stall watchdog (a dead stream behind a live sibling) ──
def test_any_stream_stalled_catches_one_dead_stream_behind_a_live_one():
    now = 1000.0
    # ECG advanced 1 s ago (live), ACC last advanced 100 s ago (dead) — grace 90 s. The OLD collective
    # check reset a shared timer whenever ECG moved, so it never fired; per-stream catches ACC.
    assert capture.any_stream_stalled([now - 1, now - 100], now, 90.0) is True


def test_any_stream_stalled_false_when_all_recently_flowed():
    now = 1000.0
    assert capture.any_stream_stalled([now - 1, now - 2, now - 3], now, 90.0) is False


def test_any_stream_stalled_off_when_grace_zero_or_empty():
    assert capture.any_stream_stalled([500.0], 1000.0, 0) is False       # feature disabled
    assert capture.any_stream_stalled([], 1000.0, 90.0) is False          # nothing started
    assert capture.any_stream_stalled([None], 1000.0, 90.0) is False      # stream not started yet


# ── VIGIL-DEEP-ANALYSIS §2D — a connection-ceiling error is diagnosable, not "sensor off" ──
def test_connection_ceiling_error_is_recognised():
    assert capture.connection_ceiling_error(RuntimeError("org.bluez.Error.Failed: br-connection-profile-unavailable"))
    assert capture.connection_ceiling_error(Exception("Too many open connections"))


def test_connection_ceiling_error_ignores_an_ordinary_drop():
    assert not capture.connection_ceiling_error(TimeoutError("connect timed out"))
    assert not capture.connection_ceiling_error(RuntimeError("device disconnected"))


# ── on-charger auto-pull trigger (VIGIL-DEEP-ANALYSIS §2C — fast, event-driven vs the hourly cadence) ──
def test_charger_pull_due_fires_after_the_settle_window():
    # on charger 20 s, settle 15 s, not yet pulled → due
    assert capture.charger_pull_due(True, 1000.0, 1020.0, 15.0, False) is True


def test_charger_pull_not_due_before_the_settle_window():
    assert capture.charger_pull_due(True, 1000.0, 1010.0, 15.0, False) is False   # only 10 s on charger


def test_charger_pull_not_due_off_charger_or_not_armed():
    assert capture.charger_pull_due(False, 1000.0, 1020.0, 15.0, False) is False  # off the charger
    assert capture.charger_pull_due(True, None, 1020.0, 15.0, False) is False     # never went on charger


def test_charger_pull_only_once_per_charge_session():
    assert capture.charger_pull_due(True, 1000.0, 1020.0, 15.0, True) is False    # already pulled this session


# ── VIGIL-DEEP-ANALYSIS §2D — stronger adapter recovery (hci reset + gated USB rebind), never raises ──
import asyncio as _aio


def test_adapter_cmd_returns_true_on_success_and_never_raises(monkeypatch):
    class _P:
        async def wait(self): return 0
    async def fake_exec(*a, **k): return _P()
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", fake_exec)
    assert _aio.run(capture._adapter_cmd(["hciconfig", "hci0", "reset"])) is True


def test_adapter_cmd_swallows_a_missing_binary(monkeypatch):
    async def boom(*a, **k): raise FileNotFoundError("hciconfig")
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", boom)
    assert _aio.run(capture._adapter_cmd(["hciconfig", "hci0", "reset"])) is False   # graceful, no raise


def test_usb_rebind_writes_unbind_then_bind(monkeypatch):
    writes = []
    import builtins
    real_open = builtins.open
    def fake_open(path, *a, **k):
        if "/sys/bus/usb/drivers/usb" in str(path):
            class _F:
                def __enter__(s): return s
                def __exit__(s, *e): return False
                def write(s, v): writes.append((str(path).rsplit("/", 1)[-1], v))
            return _F()
        return real_open(path, *a, **k)
    monkeypatch.setattr(builtins, "open", fake_open)
    assert _aio.run(capture._usb_rebind("3-1")) is True
    assert writes == [("unbind", "3-1"), ("bind", "3-1")]


def test_usb_rebind_is_graceful_when_sysfs_is_unwritable(monkeypatch):
    import builtins
    real_open = builtins.open
    def deny(path, *a, **k):
        if "/sys/bus/usb" in str(path): raise PermissionError("EACCES")
        return real_open(path, *a, **k)
    monkeypatch.setattr(builtins, "open", deny)
    assert _aio.run(capture._usb_rebind("3-1")) is False   # no raise on a dev box without the caps
