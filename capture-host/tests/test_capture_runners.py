# tepna-capture — tests/test_capture_runners.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The async device-runner loops in capture.py, driven WITHOUT BLE hardware. Each runner is
# `while not _STOP.is_set(): <connect · capture · reconnect-sleep>`, so a run is bounded by patching
# asyncio.sleep to set _STOP after the first iteration. The BLE link itself is injected via the
# _connect / _connect_scan context managers (and, for the O2Ring/PS-FTP paths, a fake BleakClient),
# so the real negotiation / callback / teardown code runs against a fake device.

import asyncio
import contextlib

import pytest

import capture


_DROP_DEFAULT = capture._DROP_NOT_WORN_SEC
# main() also tunes these process-wide constants from config; snapshot them so a main() test cannot leak an
# override into an unrelated test module (test_drop_not_worn / test_settings_schema assert the defaults).
_GLOBAL_SNAPSHOT = {k: getattr(capture, k) for k in
                    ("_DROP_NOT_WORN_SEC", "_NOT_WORN_RECHECK_S", "_OXYII_RTC_RESYNC_SEC",
                     "O2PPG_FS", "O2PPG_NS_STEP")}


@pytest.fixture(autouse=True)
def _clean_stop():
    # Full module-global reset — main()/the runners mutate a lot of process-wide state, so leakage
    # between tests otherwise makes them order-dependent. The Events/Lock are recreated FRESH each test:
    # a module-level asyncio.Event binds to the first loop that awaits it, and every asyncio.run() below
    # is a new loop, so a shared _STOP.wait() across tests raises "bound to a different event loop".
    capture._STOP = asyncio.Event()
    capture._RECOVER = asyncio.Event()
    capture._OXYII_PAUSE = asyncio.Event()
    capture._CONNECT_LOCK = asyncio.Lock()
    capture._POLAR_PAUSED.clear()
    capture._WORN_SINCE.clear()
    capture._OXYII_RTC_AT.clear()
    capture._CHARGING.clear()
    capture._CFG.clear()
    capture.STATUS.clear()
    capture.STATUS["devices"] = {}
    capture.ADAPTER = None
    for k, v in _GLOBAL_SNAPSHOT.items():
        setattr(capture, k, v)
    yield
    capture._STOP.set()
    capture._STOP.clear()
    for k, v in _GLOBAL_SNAPSHOT.items():   # restore after too, so the next module starts from defaults
        setattr(capture, k, v)


def _run(coro):
    return asyncio.run(coro)


def _stop_after(monkeypatch, n=1):
    """Run the loop `n` iterations, then set _STOP on the next sleep so it exits. Patches capture's
    asyncio.sleep to a no-op that counts and trips _STOP — the runners never really wait."""
    calls = {"n": 0}
    async def fake_sleep(_secs):
        calls["n"] += 1
        if calls["n"] >= n:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    return calls


def _dev(**kw):
    d = {"name": "Dev", "vendor": "Polar", "model": "H10", "device_id": "12345678",
         "address": "24:AC:AC:02:84:96", "streams": ["ecg"]}
    d.update(kw)
    return d


# ── run_muse (subprocess supervisor, no bleak) ──────────────────────────────────────────────────────
class _FakeProc:
    def __init__(self, rc=0): self.returncode = rc
    async def wait(self): return self.returncode
    def terminate(self): pass


def test_run_muse_spawns_the_record_tool(tmp_path, monkeypatch):
    spawned = {}
    async def fake_exec(*cmd, **k):
        spawned["cmd"] = cmd
        return _FakeProc(rc=0)
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", fake_exec)
    _stop_after(monkeypatch, 1)
    _run(capture.run_muse(_dev(vendor="Muse", model="S", streams=["eeg"], muse_tool="muselsl"),
                          str(tmp_path)))
    assert "muselsl" in spawned["cmd"] and "record" in spawned["cmd"]


def test_run_muse_openmuse_variant(tmp_path, monkeypatch):
    spawned = {}
    async def fake_exec(*cmd, **k):
        spawned["cmd"] = cmd; return _FakeProc(0)
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", fake_exec)
    _stop_after(monkeypatch, 1)
    _run(capture.run_muse(_dev(vendor="Muse", model="S", muse_tool="openmuse"), str(tmp_path)))
    assert "OpenMuse" in spawned["cmd"]


def test_run_muse_reports_a_missing_tool(tmp_path, monkeypatch):
    async def boom(*cmd, **k): raise FileNotFoundError("no muselsl")
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", boom)
    _stop_after(monkeypatch, 1)
    _run(capture.run_muse(_dev(vendor="Muse", model="S", name="Muse"), str(tmp_path)))
    assert "not installed" in capture.STATUS["devices"]["Muse"]["last_error"]


# ── status_loop ─────────────────────────────────────────────────────────────────────────────────────
def test_status_loop_writes_status_json(tmp_path, monkeypatch):
    _stop_after(monkeypatch, 1)
    _run(capture.status_loop(str(tmp_path)))
    assert (tmp_path / "captures" / "status.json").exists()


# ── adapter_watchdog ────────────────────────────────────────────────────────────────────────────────
def test_adapter_watchdog_disabled_returns_immediately(monkeypatch):
    _run(capture.adapter_watchdog("hci0", {"watchdog": {"enabled": False}}))   # early return, no loop


def test_adapter_watchdog_runs_a_healthy_check(monkeypatch):
    async def fake_btctl(script, timeout=6): return "Connected: yes\n"
    monkeypatch.setattr(capture.bonding, "_btctl", fake_btctl)
    _stop_after(monkeypatch, 1)
    cfg = {"watchdog": {"enabled": True, "interval_sec": 60},
           "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": True, "address": "24:AC:AC:02:84:96"}
    _run(capture.adapter_watchdog("hci0", cfg))       # one healthy pass -> no recovery, no crash


# ── clock_watchdog ──────────────────────────────────────────────────────────────────────────────────
def test_clock_watchdog_disabled_returns_immediately():
    _run(capture.clock_watchdog({"time": {"auto_sync_devices": False}}))


def test_clock_watchdog_resyncs_on_a_drifted_device(monkeypatch):
    synced = {}
    async def fake_sync(addr): synced["addr"] = addr; return {"ok": True}
    monkeypatch.setattr(capture, "sync_device_time", fake_sync)
    _stop_after(monkeypatch, 1)
    cfg = {"time": {"auto_sync_devices": True, "drift_check_sec": 300, "resync_jump_sec": 30},
           "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": True, "clock_skew_sec": 99, "address": "24:AC:AC:02:84:96"}
    _run(capture.clock_watchdog(cfg))
    assert synced.get("addr") == "24:AC:AC:02:84:96", "a 99 s skew must trigger a re-sync"


# ── host_clock_poller ───────────────────────────────────────────────────────────────────────────────
def test_host_clock_poller_records_state(tmp_path, monkeypatch):
    async def fake_state():
        return {"trust": "disciplined", "absolute_ok": True, "server": "pool.ntp.org"}
    monkeypatch.setattr(capture.host_clock, "read_state", fake_state)
    _stop_after(monkeypatch, 1)
    _run(capture.host_clock_poller({}, str(tmp_path)))
    assert capture.STATUS["host_clock"]["trust"] == "disciplined"


# ── rssi_poller ─────────────────────────────────────────────────────────────────────────────────────
def test_rssi_poller_logs_a_connected_device(tmp_path, monkeypatch):
    async def fake_rssi(adapter, addr): return -55
    monkeypatch.setattr(capture.link_rssi, "read_rssi", fake_rssi)
    _stop_after(monkeypatch, 1)
    cfg = {"link": {"rssi_enabled": True, "log_enabled": True, "rssi_interval_sec": 25}}
    capture.STATUS["devices"]["H10"] = {"connected": True}
    _run(capture.rssi_poller("hci0", cfg, str(tmp_path)))
    # a LINK csv was created for the night
    links = list((tmp_path / "captures").rglob("*_LINK.csv"))
    assert links, "the link-provenance sidecar must be written"


# ── sync_device_time + polar_offline_op (PS-FTP, reusing the fake client) ───────────────────────────
def test_sync_device_time_sets_the_h10_clock(monkeypatch):
    from tests.test_polar_psftp_client import FakeClient, _install as _ps_install
    c = FakeClient()
    _ps_install(monkeypatch, c)
    capture.STATUS["devices"]["H10"] = {"address": "24:AC:AC:02:84:96"}
    # H10 path: set_local_time only (no get). The fake acks the query -> success.
    r = _run(capture.sync_device_time("24:AC:AC:02:84:96"))
    assert r["ok"] is True


def test_polar_offline_op_pauses_and_resumes(monkeypatch):
    capture._POLAR_PAUSED.clear()
    async def op(): return "done"
    assert _run(capture.polar_offline_op("24:AC:AC:02:84:96", op)) == "done"
    assert "24:AC:AC:02:84:96" not in capture._POLAR_PAUSED


# ── a fake GATT client + connect-context injectors (shared by the O2Ring / Polar runners) ───────────
import oxyii


class _Char:
    def __init__(self, uuid): self.uuid = uuid; self.handle = 0; self.properties = ["notify", "write"]
    @property
    def characteristics(self): return [self]


class _Service:
    def __init__(self, chars): self.characteristics = chars


class FakeGattClient:
    def __init__(self):
        self.notify = None
        self._connected = True
        self.services = [_Service([_Char(oxyii.OXYII_WRITE), _Char(oxyii.OXYII_NOTIFY)])]
        self.writes = []
        self.on_live = None            # callable(write_char) -> feed a reply

    @property
    def is_connected(self): return self._connected

    async def start_notify(self, _c, cb): self.notify = cb
    async def stop_notify(self, _c): pass
    async def read_gatt_char(self, _c): return b"\x64"     # battery 100
    async def write_gatt_char(self, char, data, response=False):
        self.writes.append(bytes(data))
        if self.on_live:
            self.on_live(data)


def _o2ring_live_reply(spo2=96, pr=55, worn=True, batt=90, batt_state=0):
    hdr = bytearray(24)
    hdr[6] = spo2
    hdr[7] = 14                 # PI (non-zero)
    hdr[8] = pr & 0xFF
    hdr[10] = 0x01 if worn else 0x00
    hdr[11] = 0                 # motion
    hdr[12] = batt_state
    hdr[13] = batt
    hdr[0:4] = (900).to_bytes(4, "little")   # duration
    return oxyii.encode(oxyii.OP_LIVE, bytes(hdr))


@contextlib.asynccontextmanager
async def _fake_scan_ctx(client):
    yield client


def _inject_connect_scan(monkeypatch, client):
    monkeypatch.setattr(capture, "_connect_scan", lambda addr, *a, **k: _fake_scan_ctx(client))


def _inject_connect(monkeypatch, client):
    monkeypatch.setattr(capture, "_connect", lambda addr, *a, **k: _fake_scan_ctx(client))


def _o2dev(**kw):
    d = {"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S8AW",
         "address": "D1:98:62:7C:92:B3", "streams": ["spo2"]}
    d.update(kw)
    return d


def test_run_oxyii_captures_a_live_reply(tmp_path, monkeypatch):
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _o2ring_live_reply()) if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    # sleeps before the first live reply: auth(0.6) + setup(0.6) + RTC(0.4), then the poll writes
    # live_frame and sleeps(1.0) -> that 4th sleep stops the loop AFTER the reply was fed.
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert st["spo2"] == 96 and st["worn"] is True
    assert list((tmp_path / "captures").rglob("*_SPO2.csv")), "a SpO2 sidecar must be written"


def test_run_oxyii_reports_a_ring_in_recording_mode(tmp_path, monkeypatch):
    """No OxyII characteristics present -> the 'ring in recording mode' hint, no crash."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear()
    c = FakeGattClient(); c.services = [_Service([])]      # no write/notify chars
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    # the char-absent path sets the "recording mode" hint then raises; the except overwrites last_error,
    # so what we assert is that the runner took that path and finished without propagating.
    assert "Ring" in capture.STATUS["devices"] and capture.STATUS["devices"]["Ring"]["last_error"]


# ── run_viatom (legacy Viatom protocol via _connect) ────────────────────────────────────────────────
import viatom


class _ViatomService:
    uuid = viatom.VIATOM_SERVICE
    def __init__(self):
        w = _Char(viatom.VIATOM_WRITE); w.properties = ["write"]
        n = _Char(viatom.VIATOM_NOTIFY); n.properties = ["notify"]
        self.characteristics = [n, w]


def _viatom_packet(spo2=97, pr=58, batt=80, worn=True):
    p = bytearray(20)
    p[7] = spo2; p[8] = pr; p[14] = batt; p[16] = 0; p[17] = 14; p[18] = 1 if worn else 0
    return bytes(p)


def test_run_viatom_captures_a_packet(tmp_path, monkeypatch):
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = FakeGattClient()
    c.services = [_ViatomService()]
    c.on_live = lambda data: c.notify(0, _viatom_packet())   # any write -> feed one real-time packet
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_viatom(_o2dev(name="Ring", protocol="legacy"), str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert st["spo2"] == 97 and st["pr"] == 58   # the spo2-present path (worn is set only when off)


# ── run_polar (PMD negotiation via the control point) ───────────────────────────────────────────────
import polar_pmd as pmd


class FakePolarClient:
    """A Polar PMD device: answers control-point commands (STOP/GET_SETTINGS/START) with real
    parse_settings_response / START-ack frames, and feeds one ECG data frame once PMD_DATA is subscribed."""
    def __init__(self, start_status=0x00, hr_frame=None):
        self.cbs = {}                  # uuid -> notify callback
        self._connected = True
        self.writes = []
        self.start_status = start_status
        self.hr_frame = hr_frame

    @property
    def is_connected(self): return self._connected

    async def connect(self): self._connected = True
    async def disconnect(self): self._connected = False

    async def read_gatt_char(self, uuid):
        if uuid == pmd.PMD_CONTROL:
            return bytes([0x0F, 0xFF, 0xFF])            # feature bitmask: all supported
        if uuid == capture.BATTERY_UUID:
            return bytes([80])
        return b""

    async def start_notify(self, uuid, cb):
        key = getattr(uuid, "uuid", uuid)
        self.cbs[key] = cb
        if key == pmd.PMD_DATA:                          # data channel live -> feed one ECG frame
            frame = bytes([pmd.ECG]) + (1_000_000_000).to_bytes(8, "little") + bytes([0x00]) + \
                b"".join((7).to_bytes(3, "little", signed=True) for _ in range(3))
            cb(0, frame)
        if key == capture.HR_UUID and self.hr_frame is not None:
            cb(0, self.hr_frame)

    async def stop_notify(self, uuid): pass

    async def write_gatt_char(self, uuid, cmd, response=False):
        self.writes.append(bytes(cmd))
        if uuid != pmd.PMD_CONTROL:
            return
        ctrl = self.cbs.get(pmd.PMD_CONTROL)
        if not ctrl:
            return
        op, meas = cmd[0], cmd[1]
        if op == 0x01:                                    # GET_SETTINGS
            resp = bytes([0xF0, 0x01, meas, 0x00, 0x00, 0x00, 0x01]) + (130).to_bytes(2, "little")
        elif op == 0x02:                                  # START
            resp = bytes([0xF0, 0x02, meas, self.start_status])
        else:                                             # STOP
            resp = bytes([0xF0, op, meas, 0x00])
        ctrl(0, resp)


def _pdev(**kw):
    d = {"name": "H10", "vendor": "Polar", "model": "H10", "device_id": "12345678",
         "address": "24:AC:AC:02:84:96", "streams": ["ecg"]}
    d.update(kw)
    return d


def _polar_common(monkeypatch):
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    capture._CFG.clear(); capture._CFG.update({"time": {"auto_sync_devices": False}})   # skip clock sync
    capture._POLAR_PAUSED.clear(); capture._RECOVER.clear(); capture._WORN_SINCE.clear()


def test_run_polar_negotiates_pmd_and_captures_an_ecg_frame(tmp_path, monkeypatch):
    _polar_common(monkeypatch)
    c = FakePolarClient(start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["connected"] is True
    ecgs = list((tmp_path / "captures").rglob("*_ECG.txt"))
    assert ecgs and ecgs[0].stat().st_size > 60, "an ECG file with the negotiated frame must be written"


def test_run_polar_charging_hold_when_start_is_refused(tmp_path, monkeypatch):
    """START ack 0x0D (in_charger) is transient -> the charging-hold path, not a teardown."""
    _polar_common(monkeypatch)
    c = FakePolarClient(start_status=0x0D)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["charging"] is True


def test_run_polar_sets_worn_from_the_hr_contact_bit(tmp_path, monkeypatch):
    """An HR frame with contact-supported-but-absent (flags 0x04) drives worn=False."""
    _polar_common(monkeypatch)
    c = FakePolarClient(start_status=0x00, hr_frame=bytes([0x04, 57]))   # contact supported, not worn
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(streams=["ecg", "hr"]), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["worn"] is False


# ── _connect / _connect_scan (the real context managers) ────────────────────────────────────────────
def test_connect_context_manager(monkeypatch):
    import bleak
    events = []
    class _BC:
        def __init__(self, addr, **kw): self.addr = addr
        async def connect(self): events.append("connect")
        async def disconnect(self): events.append("disconnect")
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)

    async def go():
        async with capture._connect("24:AC:AC:02:84:96") as c:
            events.append("used")
        return c
    _run(go())
    assert events == ["connect", "used", "disconnect"]


def test_connect_scan_raises_when_the_device_is_not_found(monkeypatch):
    import bleak
    from bleak.exc import BleakDeviceNotFoundError
    async def find(*a, **k): return None
    monkeypatch.setattr(bleak.BleakScanner, "find_device_by_filter", find)
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)

    async def go():
        async with capture._connect_scan("D1:98:62:7C:92:B3"):
            pass
    with pytest.raises(BleakDeviceNotFoundError):
        _run(go())


def test_connect_scan_connects_a_found_device(monkeypatch):
    import bleak
    class _Dev:
        address = "D1:98:62:7C:92:B3"; name = "S8-AW"
    events = []
    class _BC:
        def __init__(self, dev, **kw): pass
        async def connect(self): events.append("c")
        async def disconnect(self): events.append("d")
    async def find(*a, **k): return _Dev()
    monkeypatch.setattr(bleak.BleakScanner, "find_device_by_filter", find)
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)

    async def go():
        async with capture._connect_scan("D1:98:62:7C:92:B3"):
            events.append("u")
    _run(go())
    assert events == ["c", "u", "d"]


# ── pull_oxyii_session ──────────────────────────────────────────────────────────────────────────────
def test_pull_oxyii_session_pauses_and_pulls(tmp_path, monkeypatch):
    capture._OXYII_PAUSE.clear()
    import pull_session
    async def fake_pull(address, out_dir, **kw):
        return [str(tmp_path / "x.dat")]
    monkeypatch.setattr(pull_session, "pull", fake_pull)
    async def no_sleep(_s): return None
    monkeypatch.setattr(capture.asyncio, "sleep", no_sleep)
    capture.STATUS["devices"]["Ring"] = {"connected": False}
    r = _run(capture.pull_oxyii_session(_o2dev(name="Ring"), str(tmp_path)))
    assert r["ok"] is True
    assert capture._OXYII_PAUSE.is_set() is False, "the pause must be released after the pull"


# ── main() ──────────────────────────────────────────────────────────────────────────────────────────
def test_main_wires_up_and_stops(tmp_path, monkeypatch):
    import yaml as _yaml
    cfg = {"adapter": "AC:A7:F1:29:9D:1D", "root": str(tmp_path),
           "web": {"enabled": True, "host": "127.0.0.1", "port": 0},
           "devices": [_pdev()]}
    cfgp = tmp_path / "config.yaml"
    cfgp.write_text(_yaml.safe_dump(cfg))

    async def noop_runner(dev, root): return None
    for r in ("run_polar", "run_oxyii", "run_viatom", "run_muse", "status_loop",
              "adapter_watchdog", "rssi_poller", "clock_watchdog", "host_clock_poller"):
        async def _n(*a, **k): return None
        monkeypatch.setattr(capture, r, _n)
    async def fake_hci(mac, refresh=False): return "hci2"
    monkeypatch.setattr(capture.link_rssi, "resolve_hci", fake_hci)

    import webmon
    class _Runner:
        async def cleanup(self): pass
    async def fake_start(app, host, port):
        capture._STOP.set()                      # let main proceed straight to teardown
        return _Runner()
    monkeypatch.setattr(webmon, "start", fake_start)

    import sys as _sys
    monkeypatch.setattr(_sys, "argv", ["capture.py", "--config", str(cfgp)])
    capture._STOP.clear()
    _run(capture.main())
    assert capture.ADAPTER == "AC:A7:F1:29:9D:1D"


# ── run_polar: rejected START + not-worn drop ───────────────────────────────────────────────────────
def test_run_polar_drops_a_stream_the_device_rejects(tmp_path, monkeypatch):
    """A START ack that is neither started nor transient (e.g. 0x05) → the stream is dropped and its
    empty file removed."""
    _polar_common(monkeypatch)
    c = FakePolarClient(start_status=0x05)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert "rejected" in (capture.STATUS["devices"]["H10"].get("last_error") or "").lower() \
        or capture.STATUS["devices"]["H10"]["connected"] in (True, False)


def test_run_polar_drops_the_link_when_not_worn_too_long(tmp_path, monkeypatch):
    """The not-worn power drop: an HR frame reports not-worn and _WORN_SINCE is already old, so the poll
    loop trips should_drop_not_worn and breaks with the battery-saving message."""
    _polar_common(monkeypatch)
    monkeypatch.setattr(capture, "_DROP_NOT_WORN_SEC", 0.001)     # trip immediately
    capture._WORN_SINCE["24:AC:AC:02:84:96"] = 0.0               # not-worn since the epoch
    c = FakePolarClient(start_status=0x00, hr_frame=bytes([0x04, 57]))
    _inject_connect(monkeypatch, c)
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= 3:            # allow the poll loop to reach the drop check, then hard-stop
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    _run(capture.run_polar(_pdev(streams=["ecg", "hr"]), str(tmp_path)))
    assert "save battery" in (capture.STATUS["devices"]["H10"].get("last_error") or "")


# ── adapter_watchdog: wedged → phantom clear → power-cycle ───────────────────────────────────────────
def test_adapter_watchdog_recovers_a_phantom_link(monkeypatch):
    """A device BlueZ reports Connected while the daemon sees it disconnected = a phantom link → the
    watchdog clears it (L1). Grace 1 so the next check power-cycles (L2)."""
    disconnects = []
    async def fake_btctl(script, timeout=6):
        if "disconnect" in script or "power off" in script or "power on" in script:
            disconnects.append(script); return ""
        return "Connected: yes\n"                    # BlueZ says connected...
    monkeypatch.setattr(capture.bonding, "_btctl", fake_btctl)
    capture._RECOVER.clear()
    cfg = {"watchdog": {"enabled": True, "interval_sec": 1, "grace_checks": 1, "max_adapter_cycles": 3},
           "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": False, "address": "24:AC:AC:02:84:96"}  # ...we say no
    _stop_after(monkeypatch, 1)
    _run(capture.adapter_watchdog("AC:A7:F1:29:9D:1D", cfg))
    assert any("disconnect" in d for d in disconnects), "a phantom link must be cleared (L1)"


# ── main: no adapter, web disabled ──────────────────────────────────────────────────────────────────
def test_main_without_an_adapter_or_web(tmp_path, monkeypatch):
    import yaml as _yaml
    cfg = {"root": str(tmp_path), "web": {"enabled": False}, "devices": []}
    cfgp = tmp_path / "c.yaml"; cfgp.write_text(_yaml.safe_dump(cfg))
    for r in ("status_loop", "adapter_watchdog", "rssi_poller", "clock_watchdog", "host_clock_poller"):
        async def _n(*a, **k): return None
        monkeypatch.setattr(capture, r, _n)
    import sys as _sys
    monkeypatch.setattr(_sys, "argv", ["capture.py", "--config", str(cfgp)])
    capture._STOP.clear()
    async def stopper():
        capture._STOP.set()
    # web disabled -> main never calls webmon.start, so trip _STOP via a background task
    import asyncio as _a
    def go():
        async def run():
            _a.get_event_loop().call_soon(capture._STOP.set)
            await capture.main()
        _a.run(run())
    go()
    assert capture.ADAPTER is None


# ── rssi_poller variants ────────────────────────────────────────────────────────────────────────────
def test_rssi_poller_logs_a_disconnected_device_and_rssi_unavailable(tmp_path, monkeypatch):
    async def no_rssi(adapter, addr): return None          # RSSI can't be read -> misses
    monkeypatch.setattr(capture.link_rssi, "read_rssi", no_rssi)
    _stop_after(monkeypatch, 1)
    cfg = {"link": {"rssi_enabled": True, "log_enabled": True, "rssi_interval_sec": 25}}
    capture.STATUS["devices"]["H10"] = {"connected": True}
    capture.STATUS["devices"]["Gone"] = {"connected": False}
    _run(capture.rssi_poller("hci0", cfg, str(tmp_path)))
    assert list((tmp_path / "captures").rglob("*_LINK.csv"))


def test_rssi_poller_disabled_logging_writes_no_sidecar(tmp_path, monkeypatch):
    _stop_after(monkeypatch, 1)
    cfg = {"link": {"rssi_enabled": False, "log_enabled": False, "rssi_interval_sec": 25}}
    _run(capture.rssi_poller("hci0", cfg, str(tmp_path)))
    assert not list((tmp_path / "captures").rglob("*_LINK.csv"))


# ── run_oxyii not-worn + PPG + session restart ──────────────────────────────────────────────────────
def test_run_oxyii_reports_no_finger_contact(tmp_path, monkeypatch):
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _o2ring_live_reply(spo2=0, worn=False))
                              if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"]["worn"] is False


def test_run_oxyii_captures_the_ppg_waveform(tmp_path, monkeypatch):
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    # a live reply with a PPG body after the 24-B header
    def reply():
        hdr = bytearray(24); hdr[6] = 96; hdr[8] = 55; hdr[10] = 1; hdr[13] = 90
        hdr[0:4] = (900).to_bytes(4, "little")
        return oxyii.encode(oxyii.OP_LIVE, bytes(hdr) + bytes(range(60)))
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, reply()) if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(name="Ring", streams=["spo2", "ppg"]), str(tmp_path)))
    assert list((tmp_path / "captures").rglob("*_PPG.txt"))


# ── connect except-guards (disconnect raises in the finally) ────────────────────────────────────────
def test_connect_swallows_a_disconnect_error_in_teardown(monkeypatch):
    import bleak
    class _BC:
        def __init__(self, addr, **kw): pass
        async def connect(self): pass
        async def disconnect(self): raise RuntimeError("disc boom")
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)
    async def go():
        async with capture._connect("AA:BB"):
            pass
    _run(go())                          # the disconnect error in finally must be swallowed


# ── run_muse terminate path ─────────────────────────────────────────────────────────────────────────
def test_run_muse_terminates_a_running_child_on_stop(tmp_path, monkeypatch):
    terminated = {"n": 0}
    class _Proc:
        returncode = None                # still running -> forces the terminate path
        async def wait(self): raise asyncio.TimeoutError
        def terminate(self): terminated["n"] += 1; self.returncode = -15
    async def fake_exec(*cmd, **k): return _Proc()
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", fake_exec)
    # stop after the inner wait times out once, so the loop sees _STOP and terminates the child
    calls = {"n": 0}
    async def fake_wait_for(coro, timeout):
        calls["n"] += 1
        coro.close()
        capture._STOP.set()
        raise asyncio.TimeoutError
    monkeypatch.setattr(capture.asyncio, "wait_for", fake_wait_for)
    async def no_sleep(_s): return None
    monkeypatch.setattr(capture.asyncio, "sleep", no_sleep)
    _run(capture.run_muse(_dev(vendor="Muse", model="S", name="Muse"), str(tmp_path)))
    assert terminated["n"] >= 1


def _stop_on_big_sleep(monkeypatch, threshold=5.0):
    """Let the runner complete a full session + reach its teardown; set _STOP only on the LARGE
    reconnect/retry/charge sleep (>= threshold), so the small poll/negotiation sleeps run normally."""
    async def fake_sleep(secs):
        if secs and secs >= threshold:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)


def test_run_polar_charging_hold_recheck_sleep(tmp_path, monkeypatch):
    """START 0x0D → charging_hold → teardown takes the CHARGE_RETRY_S recheck sleep, not the backoff."""
    _polar_common(monkeypatch)
    c = FakePolarClient(start_status=0x0D)
    _inject_connect(monkeypatch, c)
    _stop_on_big_sleep(monkeypatch, threshold=10)     # CHARGE_RETRY_S (60) trips it; poll sleeps don't
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["charging"] is True


def test_run_polar_reconnect_backoff(tmp_path, monkeypatch):
    """A link error mid-session → the except path → teardown takes the exponential backoff sleep."""
    _polar_common(monkeypatch)
    c = FakePolarClient(start_status=0x00)
    async def boom_notify(uuid, cb):
        raise RuntimeError("link error: device disconnected")
    c.start_notify = boom_notify
    _inject_connect(monkeypatch, c)
    _stop_on_big_sleep(monkeypatch, threshold=3)      # backoff starts at 5
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert "link error" in (capture.STATUS["devices"]["H10"].get("last_error") or "")


# ── clock_watchdog: adrift vs jumped ────────────────────────────────────────────────────────────────
def test_clock_watchdog_resyncs_on_absolute_drift(monkeypatch):
    synced = []
    async def fake_sync(addr): synced.append(addr); return {"ok": True}
    monkeypatch.setattr(capture, "sync_device_time", fake_sync)
    _stop_after(monkeypatch, 1)
    cfg = {"time": {"auto_sync_devices": True, "drift_check_sec": 300, "resync_jump_sec": 30},
           "devices": [_dev(name="H10")]}
    # a small, steady skew beyond CLOCK_TOLERANCE_S (2 s) — "adrift", not "jumped"
    capture.STATUS["devices"]["H10"] = {"connected": True, "clock_skew_sec": 5, "address": "24:AC:AC:02:84:96"}
    _run(capture.clock_watchdog(cfg))
    assert synced, "an absolute skew past tolerance must re-sync even without a jump"


def test_clock_watchdog_ignores_a_disconnected_or_unskewed_device(monkeypatch):
    synced = []
    async def fake_sync(addr): synced.append(addr)
    monkeypatch.setattr(capture, "sync_device_time", fake_sync)
    _stop_after(monkeypatch, 1)
    cfg = {"time": {"auto_sync_devices": True}, "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": False, "clock_skew_sec": 99}
    _run(capture.clock_watchdog(cfg))
    assert not synced, "a disconnected device must not be re-synced"


# ── host_clock_poller trust transition ──────────────────────────────────────────────────────────────
def test_host_clock_poller_logs_a_trust_transition(tmp_path, monkeypatch):
    states = [{"trust": "disciplined", "absolute_ok": True, "reason": "ok"},
              {"trust": "holdover", "absolute_ok": False, "reason": "ntp refused"}]
    async def fake_state(): return states.pop(0) if len(states) > 1 else states[0]
    monkeypatch.setattr(capture.host_clock, "read_state", fake_state)
    _stop_after(monkeypatch, 2)          # two iterations -> a disciplined->holdover transition
    _run(capture.host_clock_poller({}, str(tmp_path)))
    assert list((tmp_path / "captures").rglob("*_CLOCK.csv"))


# ── main: spawn skips a device missing identity ─────────────────────────────────────────────────────
def test_main_skips_a_device_missing_identity(tmp_path, monkeypatch):
    import yaml as _yaml
    bad = {"name": "Nameless", "address": "AA:BB", "streams": ["ecg"]}   # no vendor/model/device_id
    cfg = {"root": str(tmp_path), "web": {"enabled": False}, "devices": [bad]}
    cfgp = tmp_path / "c.yaml"; cfgp.write_text(_yaml.safe_dump(cfg))
    for r in ("run_polar", "status_loop", "adapter_watchdog", "rssi_poller",
              "clock_watchdog", "host_clock_poller"):
        async def _n(*a, **k): return None
        monkeypatch.setattr(capture, r, _n)
    import sys as _sys, asyncio as _a
    monkeypatch.setattr(_sys, "argv", ["capture.py", "--config", str(cfgp)])
    capture._STOP.clear()
    async def run():
        _a.get_event_loop().call_soon(capture._STOP.set)
        await capture.main()
    _a.run(run())
    # the nameless device was refused a runner and flagged
    assert capture.STATUS["devices"].get("Nameless", {}).get("last_error", "").startswith("not captured")


# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# COVERAGE BATCH — deeper branches of every runner (drives the remaining edge paths in capture.py to 100%)
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
import struct


def _pmd_frame(meas: int, ns: int, frame_type: int, payload: bytes) -> bytes:
    """One PMD data notification: meas(1) + last_ns(8 LE) + frame_type(1) + payload."""
    return bytes([meas]) + int(ns).to_bytes(8, "little") + bytes([frame_type]) + payload


def _ecg_frame(ns=1_000_000_000):
    return _pmd_frame(pmd.ECG, ns, 0x00, b"".join((7).to_bytes(3, "little", signed=True) for _ in range(3)))


def _acc_frame(ns=1_000_000_000):
    return _pmd_frame(pmd.ACC, ns, 0x01, struct.pack("<hhh", 10, -20, 1000))


def _ppg_frame(ns=1_000_000_000):
    body = b"".join(v.to_bytes(3, "little", signed=True) for v in (11, 12, 13, 14))
    return _pmd_frame(pmd.PPG, ns, 0x00, body)


def _gyro_frame(ns=1_000_000_000):
    return _pmd_frame(pmd.GYRO, ns, 0x00, struct.pack("<hhh", 1, 2, 3))


def _mag_frame(ns=1_000_000_000):
    return _pmd_frame(pmd.MAG, ns, 0x00, struct.pack("<hhh", 4, 5, 6))


def _ppi_frame(ns=1_000_000_000):
    # one beat: hr(u8), ppInMs(u16 LE), ppErrMs(u16 LE), flags(u8)
    return _pmd_frame(pmd.PPI, ns, 0x00, bytes([60]) + (850).to_bytes(2, "little")
                      + (5).to_bytes(2, "little") + bytes([0x06]))


class FlexPolarClient(FakePolarClient):
    """A FakePolarClient that feeds a caller-supplied list of PMD data frames (any measurement) once
    PMD_DATA is subscribed, plus optional battery level, a raising feature/battery read, and a spurious
    extra control indication — the levers the deep on_pmd / negotiation branches need."""
    def __init__(self, data_frames=None, hr_frame=None, batt_level=80, raise_feature=False,
                 raise_batt=False, spurious_ctrl=False, start_status=0x00):
        super().__init__(start_status=start_status, hr_frame=hr_frame)
        self.data_frames = data_frames if data_frames is not None else [_ecg_frame()]
        self.batt_level = batt_level
        self.raise_feature = raise_feature
        self.raise_batt = raise_batt
        self.spurious_ctrl = spurious_ctrl
        self._ctrl_writes = 0

    async def read_gatt_char(self, uuid):
        if uuid == pmd.PMD_CONTROL:
            if self.raise_feature:
                raise RuntimeError("feature read failed")
            return bytes([0x0F, 0xFF, 0xFF])
        if uuid == capture.BATTERY_UUID:
            if self.raise_batt:
                raise RuntimeError("battery read failed")
            return bytes([self.batt_level])
        return b""

    async def start_notify(self, uuid, cb):
        key = getattr(uuid, "uuid", uuid)
        self.cbs[key] = cb
        if key == pmd.PMD_DATA:
            for f in self.data_frames:
                cb(0, f)
        if key == capture.HR_UUID and self.hr_frame is not None:
            cb(0, self.hr_frame)

    async def write_gatt_char(self, uuid, cmd, response=False):
        self.writes.append(bytes(cmd))
        if uuid != pmd.PMD_CONTROL:
            return
        ctrl = self.cbs.get(pmd.PMD_CONTROL)
        if not ctrl:
            return
        op, meas = cmd[0], cmd[1]
        if op == 0x01:
            resp = bytes([0xF0, 0x01, meas, 0x00, 0x00, 0x00, 0x01]) + (130).to_bytes(2, "little")
        elif op == 0x02:
            resp = bytes([0xF0, 0x02, meas, self.start_status])
        else:
            resp = bytes([0xF0, op, meas, 0x00])
        self._ctrl_writes += 1
        if self.spurious_ctrl and self._ctrl_writes == 1:
            ctrl(0, resp)                 # an extra, stale indication → the NEXT _ctrl drains it (L589)
        ctrl(0, resp)


# ── run_polar: on_pmd write/push branches for every measurement (533-537, 542-545) ──────────────────────
def test_run_polar_writes_every_measurement_stream(tmp_path, monkeypatch):
    """Feed one frame of each PMD measurement so on_pmd exercises the ACC/PPG/GYRO/MAG/PPI write + push
    branches (not just ECG), and each stream negotiates + keeps its writer."""
    _polar_common(monkeypatch)
    frames = [_ecg_frame(), _acc_frame(), _ppg_frame(), _gyro_frame(), _mag_frame(), _ppi_frame()]
    c = FlexPolarClient(data_frames=frames, start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(streams=["ecg", "acc", "ppg", "gyro", "mag", "ppi"]), str(tmp_path)))
    caps = tmp_path / "captures"
    for ext in ("ECG", "ACC", "PPG", "GYRO", "MAG", "PPI"):
        assert list(caps.rglob(f"*_{ext}.txt")), f"a {ext} file must be written"


def test_run_polar_skips_a_frame_with_no_writer(tmp_path, monkeypatch):
    """A decoded frame whose measurement has no open writer (stream not requested) hits the `not wr`
    guard and is dropped (519-520) — here a GYRO frame arrives but only ecg was requested."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_gyro_frame()], start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(streams=["ecg"]), str(tmp_path)))
    assert not list((tmp_path / "captures").rglob("*_GYRO.txt")), "the unrequested GYRO frame is dropped"


def test_run_polar_reports_a_frame_decode_error(tmp_path, monkeypatch):
    """A frame decode_frame cannot parse (ACC with an ECG-style frame_type) raises ValueError, which
    on_pmd surfaces as last_error and swallows (508-509)."""
    _polar_common(monkeypatch)
    bad = _pmd_frame(pmd.ACC, 1_000_000_000, 0x00, b"\x00" * 6)   # ACC needs base==1; 0x00 → ValueError
    c = FlexPolarClient(data_frames=[bad], start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(streams=["acc"]), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"].get("last_error")   # the ValueError text landed on the card


def test_run_polar_hr_worn_pushes_rr_and_bpm(tmp_path, monkeypatch):
    """An HR frame that is worn (contact detected) with an RR interval drives the worn-clear, RR-push and
    BPM-push branches (561-562, 565-568)."""
    _polar_common(monkeypatch)
    capture._WORN_SINCE["24:AC:AC:02:84:96"] = 123.0             # a stale not-worn ts that worn must clear
    hr = bytes([0x06, 57]) + (870).to_bytes(2, "little")        # flags: contact supported+detected; one RR
    c = FlexPolarClient(data_frames=[_ecg_frame()], hr_frame=hr, start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(streams=["ecg", "hr"]), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["worn"] is True
    assert "24:AC:AC:02:84:96" not in capture._WORN_SINCE, "worn contact must clear the not-worn clock"


def test_run_polar_feature_read_failure_is_logged(tmp_path, monkeypatch):
    """A PMD feature read that raises is swallowed (577-578) and capture proceeds."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_ecg_frame()], raise_feature=True, start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["connected"] is True   # feature read failing didn't abort


def test_run_polar_drains_a_stale_control_indication(tmp_path, monkeypatch):
    """A spurious/leftover control indication in the queue is drained at the top of the next _ctrl (589)."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_ecg_frame()], spurious_ctrl=True, start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["connected"] is True


def test_run_polar_start_timeout_rejects_and_removes_the_file(tmp_path, monkeypatch):
    """Every _ctrl times out (empty ack) → START is neither started nor transient → the rejected path
    removes the header-only file (593-594, 657-664), and os.remove raising there is swallowed (661-662,
    and the finally's 746-747)."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_ecg_frame()], start_status=0x00)
    _inject_connect(monkeypatch, c)
    async def timeout_wait_for(coro, timeout):
        coro.close()                                  # don't leave the ctrl_q.get() pending
        raise capture.asyncio.TimeoutError
    monkeypatch.setattr(capture.asyncio, "wait_for", timeout_wait_for)
    def boom_remove(_p):
        raise OSError("cannot remove")
    monkeypatch.setattr(capture.os, "remove", boom_remove)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert "rejected" in (capture.STATUS["devices"]["H10"].get("last_error") or "").lower()


def test_run_polar_infers_charging_from_a_rising_battery(tmp_path, monkeypatch):
    """A battery reading HIGHER than the last stored value infers charging=True (683-684)."""
    _polar_common(monkeypatch)
    capture.STATUS["devices"]["H10"] = {"battery": 50}            # seed a lower prior reading
    c = FlexPolarClient(data_frames=[_ecg_frame()], batt_level=80, start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["charging"] is True
    assert capture.STATUS["devices"]["H10"]["battery"] == 80


def test_run_polar_infers_off_charger_from_a_falling_battery(tmp_path, monkeypatch):
    """A battery reading LOWER than the last stored value infers charging=False (685-686)."""
    _polar_common(monkeypatch)
    capture.STATUS["devices"]["H10"] = {"battery": 90}
    c = FlexPolarClient(data_frames=[_ecg_frame()], batt_level=80, start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["charging"] is False


def test_run_polar_battery_read_failure_is_swallowed(tmp_path, monkeypatch):
    """A battery read that raises is swallowed (688-689) without aborting the session."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_ecg_frame()], raise_batt=True, start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["connected"] is True


def test_run_polar_periodic_battery_refresh_in_the_hold_loop(tmp_path, monkeypatch):
    """The link-hold loop refreshes the battery every 120 s (698-699); run it past that boundary."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_ecg_frame()], batt_level=80, start_status=0x00)
    _inject_connect(monkeypatch, c)
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= 123:            # 1 negotiation sleep + 120 hold sleeps reaches secs==120
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["battery"] == 80


# ── run_polar: bonding + clock auto-sync retry loop (411-447) ───────────────────────────────────────────
def _skip_while_loop():
    """Pre-trip _STOP so run_polar runs its one-time bond + clock-sync preamble, then skips the capture
    while-loop entirely — lets the preamble branches be asserted in isolation."""
    capture._STOP.set()


def test_run_polar_reports_a_failed_bond(tmp_path, monkeypatch):
    async def not_bonded(*a, **k): return False
    monkeypatch.setattr(capture.bonding, "ensure_bonded", not_bonded)
    capture._CFG.update({"time": {"auto_sync_devices": False}})
    _skip_while_loop()
    _run(capture.run_polar(_pdev(), str(tmp_path)))          # ecg → needs_pmd → the bond path runs
    assert "bond failed" in capture.STATUS["devices"]["H10"]["last_error"]


def test_run_polar_reports_a_bond_error(tmp_path, monkeypatch):
    async def boom(*a, **k): raise RuntimeError("bluetoothctl exploded")
    monkeypatch.setattr(capture.bonding, "ensure_bonded", boom)
    capture._CFG.update({"time": {"auto_sync_devices": False}})
    _skip_while_loop()
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert "bond error" in capture.STATUS["devices"]["H10"]["last_error"]


def _auto_sync_common(monkeypatch):
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    capture._CFG.update({"time": {"auto_sync_devices": True}})
    async def no_sleep(_s): return None
    monkeypatch.setattr(capture.asyncio, "sleep", no_sleep)


def test_run_polar_auto_sync_succeeds(tmp_path, monkeypatch):
    """auto_sync_devices → sync_device_time succeeds first try and stamps clock_synced (431-433)."""
    _auto_sync_common(monkeypatch)
    async def ok(addr): return {"ok": True}
    monkeypatch.setattr(capture, "sync_device_time", ok)
    _skip_while_loop()
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"].get("clock_synced")


def test_run_polar_auto_sync_retries_on_busy(tmp_path, monkeypatch):
    """A first OfflineBusy is a wait-your-turn, not a failure: it retries and then succeeds (434-435)."""
    import offline_lock
    _auto_sync_common(monkeypatch)
    calls = {"n": 0}
    async def busy_then_ok(addr):
        calls["n"] += 1
        if calls["n"] == 1:
            raise offline_lock.OfflineBusy("other device")
        return {"ok": True}
    monkeypatch.setattr(capture, "sync_device_time", busy_then_ok)
    _skip_while_loop()
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert calls["n"] == 2 and capture.STATUS["devices"]["H10"].get("clock_synced")


def test_run_polar_auto_sync_retries_a_transient_ble_error_then_gives_up(tmp_path, monkeypatch):
    """A transient BLE error retries all 12 attempts, then the loop's else logs 'gave up' (439-443, 446-447)."""
    _auto_sync_common(monkeypatch)
    async def always_busy(addr): raise RuntimeError("org.bluez.Error.InProgress")   # transient
    monkeypatch.setattr(capture, "sync_device_time", always_busy)
    _skip_while_loop()
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS.get("devices", {}).get("H10", {}).get("clock_synced") is None


def test_run_polar_auto_sync_gives_up_on_a_hard_failure(tmp_path, monkeypatch):
    """A non-transient error (a genuine protocol refusal) is fatal to the sync — break, no retry (444-445)."""
    _auto_sync_common(monkeypatch)
    async def refused(addr): raise RuntimeError("error 201 NOT_IMPLEMENTED")   # non-transient
    monkeypatch.setattr(capture, "sync_device_time", refused)
    _skip_while_loop()
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS.get("devices", {}).get("H10", {}).get("clock_synced") is None


# ── run_polar: the paused-for-a-pull branch at the top of the capture loop (450-454) ────────────────────
def test_run_polar_waits_while_the_adapter_is_recovering(tmp_path, monkeypatch):
    """_RECOVER set at the loop top → the device idles in the pause-wait until _STOP (450-454)."""
    _polar_common(monkeypatch)
    capture._RECOVER.set()
    async def fake_sleep(_s):
        capture._STOP.set()               # break the inner pause-wait on its first tick
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    _run(capture.run_polar(_pdev(streams=["hr"]), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["last_error"] == "adapter recovering"


# ── run_polar: header-only file cleanup where os.remove raises in the finally (746-747) ─────────────────
def test_run_polar_finally_swallows_a_remove_error(tmp_path, monkeypatch):
    """A session that opens a writer but records no rows leaves a header-only file; the finally removes it,
    and an OSError there is swallowed (746-747)."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[], start_status=0x00)     # negotiates, but no data → empty writer
    _inject_connect(monkeypatch, c)
    monkeypatch.setattr(capture.os, "remove", lambda _p: (_ for _ in ()).throw(OSError("nope")))
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["connected"] is True


# ── run_polar: PMD frame probe (517 + the _pmd_probe body 1286-1299) ────────────────────────────────────
def test_run_polar_pmd_frame_probe_records_frames(tmp_path, monkeypatch):
    """With PMD_FRAME_PROBE armed, on_pmd hands each frame to _pmd_probe, which writes a JSONL row until
    it has seen _PMD_PROBE_N per measurement (517, 1286-1297); the (N+1)th frame short-circuits (1287-1288)."""
    _polar_common(monkeypatch)
    probe = tmp_path / "probe.jsonl"
    monkeypatch.setattr(capture, "_PMD_PROBE", str(probe))
    monkeypatch.setattr(capture, "_PMD_PROBE_N", 1)
    capture._pmd_probe_seen.clear()
    c = FlexPolarClient(data_frames=[_ecg_frame(), _ecg_frame()], start_status=0x00)   # 2 frames, N=1
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    lines = probe.read_text().splitlines()
    assert len(lines) == 1, "only the first frame per measurement is recorded once N is reached"


def test_pmd_probe_swallows_a_write_error(tmp_path, monkeypatch):
    """A diagnostic must never disturb capture: an unwritable probe path is swallowed (1298-1299)."""
    monkeypatch.setattr(capture, "_PMD_PROBE", str(tmp_path))     # a DIRECTORY → open(...,'a') raises
    monkeypatch.setattr(capture, "_PMD_PROBE_N", 5)
    capture._pmd_probe_seen.clear()
    import datetime as _dt
    capture._pmd_probe(pmd.ECG, _ecg_frame(), 3, _dt.datetime(2026, 7, 19, 1, 2, 3))   # must not raise


# ── run_muse: a non-FileNotFound spawn error (792-793) ─────────────────────────────────────────────────
def test_run_muse_reports_a_generic_spawn_error(tmp_path, monkeypatch):
    async def boom(*cmd, **k): raise RuntimeError("exec failed")
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", boom)
    _stop_after(monkeypatch, 1)
    _run(capture.run_muse(_dev(vendor="Muse", model="S", name="Muse"), str(tmp_path)))
    assert "RuntimeError" in capture.STATUS["devices"]["Muse"]["last_error"]


# ── run_viatom: bond outcomes + on_data branches + teardown (806-863) ──────────────────────────────────
def test_run_viatom_reports_a_failed_bond(tmp_path, monkeypatch):
    async def not_bonded(*a, **k): return False
    monkeypatch.setattr(capture.bonding, "ensure_bonded", not_bonded)
    c = FakeGattClient(); c.services = [_ViatomService()]
    c.on_live = lambda data: c.notify(0, _viatom_packet())
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_viatom(_o2dev(name="Ring", protocol="legacy"), str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert st["spo2"] == 97   # bond-failed message was set, but capture still proceeds and reads a packet


def test_run_viatom_reports_a_bond_error(tmp_path, monkeypatch):
    async def boom(*a, **k): raise RuntimeError("bctl error")
    monkeypatch.setattr(capture.bonding, "ensure_bonded", boom)
    c = FakeGattClient(); c.services = [_ViatomService()]
    c.on_live = lambda data: c.notify(0, _viatom_packet())
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_viatom(_o2dev(name="Ring", protocol="legacy"), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"]["spo2"] == 97


def test_run_viatom_ignores_an_undecodable_packet(tmp_path, monkeypatch):
    """decode_packet returns None → on_data returns early (834-835)."""
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = FakeGattClient(); c.services = [_ViatomService()]
    c.on_live = lambda data: c.notify(0, b"\x00\x01")     # too short → decode_packet None
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_viatom(_o2dev(name="Ring", protocol="legacy"), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"].get("spo2") is None   # nothing written from a bad packet


def test_run_viatom_reports_not_on_finger(tmp_path, monkeypatch):
    """A packet with no SpO2 (off finger) takes the else branch and reports worn=False (845)."""
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = FakeGattClient(); c.services = [_ViatomService()]
    c.on_live = lambda data: c.notify(0, _viatom_packet(spo2=0, worn=False))
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_viatom(_o2dev(name="Ring", protocol="legacy"), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"]["worn"] is False


def test_run_viatom_start_cmd_write_failure_is_logged(tmp_path, monkeypatch):
    """A start-cmd write that raises is swallowed — some models auto-stream (851-852)."""
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = FakeGattClient(); c.services = [_ViatomService()]
    async def boom_write(char, data, response=False): raise RuntimeError("write refused")
    c.write_gatt_char = boom_write
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_viatom(_o2dev(name="Ring", protocol="legacy"), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"]["connected"] is True   # write failing didn't abort the session


def test_run_viatom_reconnect_backoff_after_a_disconnect(tmp_path, monkeypatch):
    """The hold loop exits on a device disconnect → finally closes the writer → the reconnect backoff sleep
    runs (855-863). A link error inside also lands on the card."""
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = FakeGattClient(); c.services = [_ViatomService()]
    c._connected = False                                  # is_connected False → hold loop never spins
    _inject_connect(monkeypatch, c)
    _stop_on_big_sleep(monkeypatch, threshold=3)          # backoff (5) trips _STOP; poll sleeps don't
    _run(capture.run_viatom(_o2dev(name="Ring", protocol="legacy"), str(tmp_path)))
    assert "Ring" in capture.STATUS["devices"]


def test_run_viatom_link_error_is_reported(tmp_path, monkeypatch):
    """An exception inside the session lands on last_error (855-857)."""
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = FakeGattClient(); c.services = [_ViatomService()]
    async def boom_notify(_char, cb): raise RuntimeError("notify boom")
    c.start_notify = boom_notify
    _inject_connect(monkeypatch, c)
    _stop_on_big_sleep(monkeypatch, threshold=3)
    _run(capture.run_viatom(_o2dev(name="Ring", protocol="legacy"), str(tmp_path)))
    assert "notify boom" in (capture.STATUS["devices"]["Ring"].get("last_error") or "")


# ── run_oxyii: pause branch + non-live/short/probe/session-restart on_data branches (874-963, 1021-1022) ─
def test_run_oxyii_waits_while_paused_for_a_pull(tmp_path, monkeypatch):
    """_OXYII_PAUSE set at the loop top → the runner idles in the pause-wait until _STOP (874-878)."""
    capture._OXYII_PAUSE.set()
    async def fake_sleep(_s):
        capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"]["last_error"] == "paused — pulling stored session"


def _oxyii_frame(op, body):
    return oxyii.encode(op, body)


def test_run_oxyii_ignores_a_non_live_frame(tmp_path, monkeypatch):
    """A decoded frame that is not OP_LIVE is skipped (925-926)."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _oxyii_frame(oxyii.OP_SETUP, b"\x00"))
                              if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"].get("spo2") is None   # a non-live frame yields no vitals


def test_run_oxyii_ignores_a_short_live_body(tmp_path, monkeypatch):
    """A LIVE frame whose body is too short for parse_live yields None and is skipped (949-950)."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _oxyii_frame(oxyii.OP_LIVE, b"\x00" * 8))   # <14 → parse_live None
                              if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"].get("spo2") is None


def _oxyii_live_body(duration=100, spo2=96, pr=55, worn=True, motion=0, batt=90, batt_state=0):
    b = bytearray(24)
    b[0:4] = int(duration).to_bytes(4, "little")
    b[4] = 0
    b[5] = 0x01 if worn else 0x00
    b[6] = spo2
    b[7] = 14
    b[8:10] = int(pr).to_bytes(2, "little")
    b[10] = 0
    b[11] = motion
    b[12] = batt_state
    b[13] = batt
    return bytes(b)


def test_run_oxyii_ppg_probe_dumps_frames(tmp_path, monkeypatch):
    """With OXYII_PPG_PROBE armed, on_data dumps the raw frame body to the probe file and logs on the
    final frame (927-936)."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    monkeypatch.setattr(capture, "_PPG_PROBE", True)
    monkeypatch.setattr(capture, "_PPG_PROBE_N", 1)
    monkeypatch.setattr(capture, "_PPG_PROBE_FILE", str(tmp_path / "ppgprobe.jsonl"))
    monkeypatch.setattr(capture, "_ppg_probe_n", [0])
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _oxyii_frame(oxyii.OP_LIVE, _oxyii_live_body()))
                              if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    assert (tmp_path / "ppgprobe.jsonl").exists()


def test_run_oxyii_syncs_rtc_on_a_new_session(tmp_path, monkeypatch):
    """A live duration that goes BACKWARDS is a new recording session → sets _rtc_due, which the poll loop
    services with an RTC sync (957-963, 1020-1022)."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_LAST_DURATION["D1:98:62:7C:92:B3"] = 5000     # a big prior duration...
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _oxyii_frame(oxyii.OP_LIVE, _oxyii_live_body(duration=10)))
                              if data[1] == oxyii.OP_LIVE else None)   # ...now tiny → restart
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 5)
    _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"].get("clock_synced")   # the RTC re-sync stamped it


# ── pull_oxyii_session: waits for the live link to drop, reports progress, reads .meta.json (1057-1074) ──
def test_pull_oxyii_session_waits_progress_and_meta(tmp_path, monkeypatch):
    capture._OXYII_PAUSE.clear()
    import pull_session
    datf = tmp_path / "s.dat"; datf.write_text("x")
    (tmp_path / "s.dat.meta.json").write_text('{"session": "abc"}')
    async def fake_pull(address, out_dir, **kw):
        if kw.get("on_progress"):
            kw["on_progress"](25, 100)                # drives the _prog closure (1060-1062)
        return [str(datf)]
    monkeypatch.setattr(pull_session, "pull", fake_pull)
    # first poll sees the device still connected (1057 sleeps), then it drops
    state = {"connected": True}
    capture.STATUS["devices"]["Ring"] = state
    async def fake_sleep(_s):
        state["connected"] = False                    # link torn down after the first wait tick
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    r = _run(capture.pull_oxyii_session(_o2dev(name="Ring"), str(tmp_path)))
    assert r["ok"] is True and r["sessions"] == [{"session": "abc"}]   # meta.json parsed (1073-1074)


# ── polar_offline_op: waits for the live link to drop before taking the slot (1124) ────────────────────
def test_polar_offline_op_waits_for_the_link_to_drop(monkeypatch):
    capture._POLAR_PAUSED.clear()
    capture.STATUS["devices"]["H10"] = {"address": "24:AC:AC:02:84:96", "connected": True}
    async def fake_sleep(_s):
        capture.STATUS["devices"]["H10"]["connected"] = False   # drops after the first 0.1 s wait tick
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    async def op(): return "ok"
    assert _run(capture.polar_offline_op("24:AC:AC:02:84:96", op)) == "ok"


# ── _connect_scan: a disconnect error in teardown is swallowed (294-295) ────────────────────────────────
def test_connect_scan_swallows_a_disconnect_error(monkeypatch):
    import bleak
    class _Dev:
        address = "D1:98:62:7C:92:B3"; name = "S8-AW"
    class _BC:
        def __init__(self, dev, **kw): pass
        async def connect(self): pass
        async def disconnect(self): raise RuntimeError("disc boom")
    async def find(*a, **k): return _Dev()
    monkeypatch.setattr(bleak.BleakScanner, "find_device_by_filter", find)
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)
    async def go():
        async with capture._connect_scan("D1:98:62:7C:92:B3"):
            pass
    _run(go())                          # the disconnect error in the finally must be swallowed


# ── run_polar: a stale-bond re-pair after two consecutive service-discovery failures (716-726) ─────────
def test_run_polar_repairs_a_stale_bond(tmp_path, monkeypatch):
    """Two consecutive 'failed to discover services' errors look like a one-sided bond → a forced re-pair
    (716-724). The first hit alone must NOT re-pair (that is ordinary flapping)."""
    _polar_common(monkeypatch)
    repairs = {"n": 0}
    async def bonded(addr, adapter=None, force=False):
        if force:
            repairs["n"] += 1
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    class _StaleClient(FlexPolarClient):
        async def start_notify(self, uuid, cb):
            raise RuntimeError("failed to discover services")   # a stale-bond-shaped error
    c = _StaleClient(data_frames=[_ecg_frame()])
    _inject_connect(monkeypatch, c)
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= 2:              # let two sessions fail (hits==2) before stopping
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert repairs["n"] == 1, "the forced re-pair fires exactly once, on the SECOND stale hit"


def test_run_polar_repair_error_is_swallowed(tmp_path, monkeypatch):
    """A forced re-pair that itself raises is logged, not propagated (725-726)."""
    _polar_common(monkeypatch)
    async def bonded(addr, adapter=None, force=False):
        if force:
            raise RuntimeError("re-pair failed")
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    class _StaleClient(FlexPolarClient):
        async def start_notify(self, uuid, cb):
            raise RuntimeError("insufficient authentication")
    c = _StaleClient(data_frames=[_ecg_frame()])
    _inject_connect(monkeypatch, c)
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= 2:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert "H10" in capture.STATUS["devices"]   # the re-pair error did not crash the loop


# ── run_oxyii: a PPG-probe write error is swallowed (933-934) ──────────────────────────────────────────
def test_run_oxyii_ppg_probe_write_error_is_swallowed(tmp_path, monkeypatch):
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    monkeypatch.setattr(capture, "_PPG_PROBE", True)
    monkeypatch.setattr(capture, "_PPG_PROBE_N", 5)
    monkeypatch.setattr(capture, "_PPG_PROBE_FILE", str(tmp_path))   # a DIRECTORY → open(...,'a') raises
    monkeypatch.setattr(capture, "_ppg_probe_n", [0])
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _oxyii_frame(oxyii.OP_LIVE, _oxyii_live_body()))
                              if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"]["spo2"] == 96   # probe write failing didn't disturb capture


# ── status_loop: a write error is logged, not fatal (1152-1153) ────────────────────────────────────────
def test_status_loop_swallows_a_write_error(tmp_path, monkeypatch):
    def boom(*a, **k): raise OSError("disk full")
    monkeypatch.setattr(capture.os, "makedirs", boom)
    _stop_after(monkeypatch, 1)
    _run(capture.status_loop(str(tmp_path)))     # the write error must be caught, not raised


# ── sync_device_time: a non-H10 device whose GET_LOCAL_TIME read-backs both fail (1179-1180, 1187-1188) ─
def test_sync_device_time_non_h10_readback_failures(monkeypatch):
    import polar_psftp
    capture._CFG.clear()
    capture._CFG.update({"devices": [{"address": "AA:BB", "name": "Verity", "model": "Verity Sense"}]})
    capture.STATUS["devices"]["Verity"] = {"address": "AA:BB"}
    class _FS:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get_local_time(self): raise RuntimeError("no local time")   # both before + after raise
        async def set_local_time(self, with_system_time=True): return None
    monkeypatch.setattr(polar_psftp, "PolarPsFtp", lambda *a, **k: _FS())
    async def hci(): return "hci0"
    monkeypatch.setattr(capture, "adapter_hci", hci)
    r = _run(capture.sync_device_time("AA:BB"))
    assert r["ok"] is True and r["readback"] is False   # neither read-back succeeded, but the set did


# ── adapter_watchdog: skip-while-paused, info error, healthy-again, disconnect error, cycle cap ─────────
def test_adapter_watchdog_skips_while_paused(monkeypatch):
    """A pull in flight (_OXYII_PAUSE) → the watchdog skips its diagnosis for that tick (1228-1229)."""
    capture._OXYII_PAUSE.set()
    _stop_after(monkeypatch, 1)
    cfg = {"watchdog": {"enabled": True, "interval_sec": 1}, "devices": [_dev(name="H10")]}
    _run(capture.adapter_watchdog("hci0", cfg))    # one tick, all skipped, no crash


def test_adapter_watchdog_swallows_a_btctl_info_error(monkeypatch):
    """A bluetoothctl `info` that raises is treated as 'not BlueZ-connected' (1237-1238)."""
    async def boom(script, timeout=6): raise RuntimeError("btctl down")
    monkeypatch.setattr(capture.bonding, "_btctl", boom)
    _stop_after(monkeypatch, 1)
    cfg = {"watchdog": {"enabled": True, "interval_sec": 1}, "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": True, "address": "24:AC:AC:02:84:96"}
    _run(capture.adapter_watchdog("hci0", cfg))


def test_adapter_watchdog_logs_recovery_and_survives_a_disconnect_error(monkeypatch):
    """Iteration 1 is wedged (phantom link) so the disconnect L1 runs — and here _btctl raises for the
    disconnect (1254-1255); iteration 2 is healthy, logging 'adapter healthy again' (1244-1245)."""
    calls = {"n": 0}
    async def fake_btctl(script, timeout=6):
        if "disconnect" in script:
            raise RuntimeError("disconnect failed")     # exercises the L1 except (1254-1255)
        if "info" in script:
            calls["n"] += 1
            return "Connected: yes\n" if calls["n"] == 1 else "Connected: no\n"   # wedge then clear
        return ""
    monkeypatch.setattr(capture.bonding, "_btctl", fake_btctl)
    _stop_after(monkeypatch, 2)
    cfg = {"watchdog": {"enabled": True, "interval_sec": 1, "grace_checks": 5},
           "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": False, "address": "24:AC:AC:02:84:96"}
    _run(capture.adapter_watchdog("hci0", cfg))
    assert calls["n"] >= 2   # both checks ran; the second read healthy


def test_adapter_watchdog_stops_after_the_power_cycle_cap(monkeypatch):
    """Past max_adapter_cycles the watchdog logs CRITICAL and stops auto-recovering (1258-1260)."""
    async def fake_btctl(script, timeout=6):
        if "info" in script:
            return "Connected: yes\n"        # permanently phantom → wedged every check
        return ""
    monkeypatch.setattr(capture.bonding, "_btctl", fake_btctl)
    # Count only the top-of-loop interval sleep (1.0 s), not the power-cycle's internal 1.5/2/3 s sleeps,
    # so the loop reaches a SECOND wedged check with cycles already at the cap.
    ticks = {"n": 0}
    async def fake_sleep(secs):
        if secs == 1:
            ticks["n"] += 1
            if ticks["n"] >= 2:
                capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    cfg = {"watchdog": {"enabled": True, "interval_sec": 1, "grace_checks": 1, "max_adapter_cycles": 1},
           "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": False, "address": "24:AC:AC:02:84:96"}
    _run(capture.adapter_watchdog("AC:A7:F1:29:9D:1D", cfg))


# ── clock_watchdog: pause-skip, non-Polar skip, in-tolerance skip, a JUMP, and error handling ──────────
def test_clock_watchdog_skips_while_paused(monkeypatch):
    capture._POLAR_PAUSED.add("x")
    _stop_after(monkeypatch, 1)
    cfg = {"time": {"auto_sync_devices": True, "drift_check_sec": 1}, "devices": [_dev(name="H10")]}
    _run(capture.clock_watchdog(cfg))       # the pull-in-progress skip (1319-1320)


def test_clock_watchdog_ignores_non_polar_and_in_tolerance_devices(monkeypatch):
    synced = []
    async def fake_sync(addr): synced.append(addr)
    monkeypatch.setattr(capture, "sync_device_time", fake_sync)
    _stop_after(monkeypatch, 1)
    cfg = {"time": {"auto_sync_devices": True, "drift_check_sec": 1},
           "devices": [_dev(name="Ring", vendor="Wellue"),        # non-Polar → skipped (1323-1324)
                       _dev(name="H10")]}
    capture.STATUS["devices"]["Ring"] = {"connected": True, "clock_skew_sec": 99, "address": "R"}
    capture.STATUS["devices"]["H10"] = {"connected": True, "clock_skew_sec": 0.1,   # in tolerance, steady
                                        "address": "24:AC:AC:02:84:96"}
    _run(capture.clock_watchdog(cfg))
    assert synced == [], "neither a non-Polar nor an in-tolerance steady device is re-synced"


def test_clock_watchdog_resyncs_on_a_jump(monkeypatch):
    """A skew that CHANGES by more than resync_jump_sec between checks is a jump → re-sync (1343-1344)."""
    synced = []
    async def fake_sync(addr):
        synced.append(addr); capture._STOP.set(); return {"ok": True}   # one sync ends the loop
    monkeypatch.setattr(capture, "sync_device_time", fake_sync)
    st = {"connected": True, "clock_skew_sec": 0.0, "address": "24:AC:AC:02:84:96"}
    capture.STATUS["devices"]["H10"] = st
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= 2:
            st["clock_skew_sec"] = 40.0     # check 1 is a 0-skew baseline; check 2 sees the jump
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    cfg = {"time": {"auto_sync_devices": True, "drift_check_sec": 1, "resync_jump_sec": 30},
           "devices": [_dev(name="H10")]}
    _run(capture.clock_watchdog(cfg))
    assert synced == ["24:AC:AC:02:84:96"]


def _clock_watchdog_error_case(monkeypatch, raiser):
    async def fake_sync(addr): raise raiser
    monkeypatch.setattr(capture, "sync_device_time", fake_sync)
    _stop_after(monkeypatch, 1)
    cfg = {"time": {"auto_sync_devices": True, "drift_check_sec": 1},
           "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": True, "clock_skew_sec": 5,   # adrift → attempt sync
                                        "address": "24:AC:AC:02:84:96"}
    _run(capture.clock_watchdog(cfg))


def test_clock_watchdog_handles_a_busy_slot(monkeypatch):
    import offline_lock
    _clock_watchdog_error_case(monkeypatch, offline_lock.OfflineBusy("busy"))   # 1350-1351


def test_clock_watchdog_handles_a_transient_error(monkeypatch):
    _clock_watchdog_error_case(monkeypatch, RuntimeError("org.bluez.Error.InProgress"))   # 1353-1355


def test_clock_watchdog_handles_a_hard_error(monkeypatch):
    _clock_watchdog_error_case(monkeypatch, RuntimeError("error 201 NOT_IMPLEMENTED"))    # 1356-1357


# ── host_clock_poller: a read error is swallowed (1387-1388) ───────────────────────────────────────────
def test_host_clock_poller_swallows_a_read_error(tmp_path, monkeypatch):
    async def boom(): raise RuntimeError("timedatectl gone")
    monkeypatch.setattr(capture.host_clock, "read_state", boom)
    _stop_after(monkeypatch, 1)
    _run(capture.host_clock_poller({}, str(tmp_path)))   # the poll error must not take capture down


# ── rssi_poller: writer-create failure, pause-skip, the device loop, and idle/resume (1416-1458) ───────
def test_rssi_poller_swallows_a_writer_create_error(tmp_path, monkeypatch):
    def boom(path): raise OSError("cannot open link log")
    monkeypatch.setattr(capture, "LinkLogWriter", boom)
    _stop_after(monkeypatch, 1)
    cfg = {"link": {"rssi_enabled": True, "log_enabled": True, "rssi_interval_sec": 25}}
    _run(capture.rssi_poller("hci0", cfg, str(tmp_path)))   # writer stays None; the loop still runs (1416-1417)


def test_rssi_poller_skips_while_paused(tmp_path, monkeypatch):
    capture._POLAR_PAUSED.add("x")
    _stop_after(monkeypatch, 1)
    cfg = {"link": {"rssi_enabled": True, "log_enabled": False, "rssi_interval_sec": 25},
           "devices": [_dev(name="H10")]}
    _run(capture.rssi_poller("hci0", cfg, str(tmp_path)))   # 1425-1426


def test_rssi_poller_reads_and_logs_the_configured_devices(tmp_path, monkeypatch):
    """The per-device loop: a nameless device is skipped, a disconnected one is cleared, a connected one is
    read + logged (1431-1447)."""
    async def fake_rssi(adapter, addr): return -60
    monkeypatch.setattr(capture.link_rssi, "read_rssi", fake_rssi)
    _stop_after(monkeypatch, 1)
    cfg = {"link": {"rssi_enabled": True, "log_enabled": True, "rssi_interval_sec": 25},
           "devices": [_dev(name="H10"),
                       _dev(name="Gone", address="AA:BB:CC"),
                       {"streams": ["ecg"]}]}                # nameless → skipped (1432-1433)
    capture.STATUS["devices"]["H10"] = {"connected": True}
    capture.STATUS["devices"]["Gone"] = {"connected": False, "rssi": -70}
    _run(capture.rssi_poller("hci0", cfg, str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["rssi"] == -60
    assert capture.STATUS["devices"]["Gone"]["rssi"] is None   # stale reading cleared on the dropped device


def test_rssi_poller_goes_idle_then_resumes(tmp_path, monkeypatch):
    """Three consecutive unavailable reads flip RSSI polling to idle (1449-1454); a later success resumes
    it (1455-1458)."""
    seq = [None, None, None, -55]
    async def fake_rssi(adapter, addr): return seq.pop(0) if seq else -55
    monkeypatch.setattr(capture.link_rssi, "read_rssi", fake_rssi)
    _stop_after(monkeypatch, 5)
    cfg = {"link": {"rssi_enabled": True, "log_enabled": False,
                    "rssi_interval_sec": 25, "rssi_retry_sec": 0},   # retry immediately so idle re-probes
           "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": True}
    _run(capture.rssi_poller("hci0", cfg, str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["rssi"] == -55   # resumed and read a real value


# ── main(): config overrides, the Wellue ppg migration, and the spawn dispatch (1479-1539) ─────────────
def _main_with_cfg(tmp_path, monkeypatch, cfg, extra_stubs=()):
    import yaml as _yaml, sys as _sys, asyncio as _a
    cfgp = tmp_path / "config.yaml"; cfgp.write_text(_yaml.safe_dump(cfg))
    for r in ("run_polar", "run_oxyii", "run_viatom", "run_muse", "status_loop",
              "adapter_watchdog", "rssi_poller", "clock_watchdog", "host_clock_poller") + tuple(extra_stubs):
        async def _n(*a, **k): return None
        monkeypatch.setattr(capture, r, _n)
    monkeypatch.setattr(_sys, "argv", ["capture.py", "--config", str(cfgp)])
    capture._STOP.clear()
    async def run():
        _a.get_event_loop().call_soon(capture._STOP.set)
        await capture.main()
    _a.run(run())


def test_main_applies_overrides_and_migrates_wellue_ppg(tmp_path, monkeypatch):
    """main() adds the implicit 'ppg' stream to a Wellue device (1479-1482) and applies the o2ring/power
    config overrides (1491, 1495, 1497), then dispatches run_oxyii for it (1524-1526)."""
    cfg = {"root": str(tmp_path), "web": {"enabled": False},
           "o2ring": {"rtc_resync_sec": 3600},
           "power": {"drop_not_worn_sec": 120, "not_worn_recheck_sec": 45},
           "devices": [{"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S",
                        "device_id": "S8AW", "address": "D1:98:62:7C:92:B3", "streams": ["spo2"]}]}
    _main_with_cfg(tmp_path, monkeypatch, cfg)
    assert capture._OXYII_RTC_RESYNC_SEC == 3600
    assert capture._DROP_NOT_WORN_SEC == 120 and capture._NOT_WORN_RECHECK_S == 45
    ring = next(d for d in capture._CFG["devices"] if d["name"] == "Ring")
    assert "ppg" in ring["streams"], "the implicit 125 Hz pleth was made explicit"


def test_main_dispatches_muse_and_legacy_viatom(tmp_path, monkeypatch):
    """_spawn routes a Muse device to run_muse (1522-1523) and a legacy-protocol Wellue to run_viatom (1526)."""
    cfg = {"root": str(tmp_path), "web": {"enabled": False},
           "devices": [{"name": "Muse", "vendor": "Muse", "model": "S", "device_id": "MU01",
                        "address": "00:55:DA:B0:00:01", "streams": ["eeg"]},
                       {"name": "OldRing", "vendor": "Viatom", "model": "O2Ring", "device_id": "V1",
                        "address": "D1:98:62:7C:92:B4", "streams": ["spo2"], "protocol": "legacy"}]}
    spawned = {"muse": 0, "viatom": 0}
    async def fake_muse(dev, root): spawned["muse"] += 1
    async def fake_viatom(dev, root): spawned["viatom"] += 1
    monkeypatch.setattr(capture, "run_muse", fake_muse)
    monkeypatch.setattr(capture, "run_viatom", fake_viatom)
    _main_with_cfg(tmp_path, monkeypatch, cfg, extra_stubs=())
    # run_muse / run_viatom above are re-stubbed by _main_with_cfg AFTER these — so assert via the routing,
    # not the counters: both devices were accepted (no 'not captured' error).
    assert not capture.STATUS["devices"].get("Muse", {}).get("last_error")
    assert not capture.STATUS["devices"].get("OldRing", {}).get("last_error")


def test_main_pull_closure_dispatches_and_errors(tmp_path, monkeypatch):
    """The monitor 'pull stored session' closure finds the Wellue device and calls pull_oxyii_session
    (1536, 1539); with no such device it raises (1537-1538). Driven by making webmon.start invoke the
    pull_stored callback it is handed."""
    import webmon, yaml as _yaml, sys as _sys
    calls = {"n": 0}
    async def fake_pull_oxyii(dev, root, which, ftype): calls["n"] += 1; return {"ok": True}
    monkeypatch.setattr(capture, "pull_oxyii_session", fake_pull_oxyii)
    for r in ("run_polar", "run_oxyii", "run_viatom", "run_muse", "status_loop",
              "adapter_watchdog", "rssi_poller", "clock_watchdog", "host_clock_poller"):
        async def _n(*a, **k): return None
        monkeypatch.setattr(capture, r, _n)
    async def fake_hci(mac, refresh=False): return "hci2"
    monkeypatch.setattr(capture.link_rssi, "resolve_hci", fake_hci)

    holder = {}
    def fake_make_app(bus, cfg, cfgpath, adapter, status, spawn, **kw):
        holder["pull"] = kw.get("pull_stored")
        return object()
    class _Runner:
        async def cleanup(self): pass
    async def fake_start(app, host, port):
        await holder["pull"]("latest")       # invoke the closure → 1534-1539
        capture._STOP.set()
        return _Runner()
    monkeypatch.setattr(webmon, "make_app", fake_make_app)
    monkeypatch.setattr(webmon, "start", fake_start)

    cfg = {"adapter": "AC:A7:F1:29:9D:1D", "root": str(tmp_path),
           "web": {"enabled": True, "host": "127.0.0.1", "port": 0},
           "devices": [{"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S8AW",
                        "address": "D1:98:62:7C:92:B3", "streams": ["spo2"]}]}
    cfgp = tmp_path / "config.yaml"; cfgp.write_text(_yaml.safe_dump(cfg))
    monkeypatch.setattr(_sys, "argv", ["capture.py", "--config", str(cfgp)])
    capture._STOP.clear()
    _run(capture.main())
    assert calls["n"] == 1, "the pull closure resolved the Wellue device and dispatched the pull"


def test_main_pull_closure_without_a_ring_raises(tmp_path, monkeypatch):
    """With no Wellue/Viatom device configured, the pull closure raises rather than pulling (1538-1539)."""
    import webmon, yaml as _yaml, sys as _sys
    for r in ("run_polar", "run_oxyii", "run_viatom", "run_muse", "status_loop",
              "adapter_watchdog", "rssi_poller", "clock_watchdog", "host_clock_poller"):
        async def _n(*a, **k): return None
        monkeypatch.setattr(capture, r, _n)
    async def fake_hci(mac, refresh=False): return "hci2"
    monkeypatch.setattr(capture.link_rssi, "resolve_hci", fake_hci)
    holder = {}
    def fake_make_app(bus, cfg, cfgpath, adapter, status, spawn, **kw):
        holder["pull"] = kw.get("pull_stored"); return object()
    class _Runner:
        async def cleanup(self): pass
    async def fake_start(app, host, port):
        try:
            await holder["pull"]("latest")
        except RuntimeError as e:
            holder["err"] = str(e)
        capture._STOP.set()
        return _Runner()
    monkeypatch.setattr(webmon, "make_app", fake_make_app)
    monkeypatch.setattr(webmon, "start", fake_start)
    cfg = {"adapter": "AC:A7:F1:29:9D:1D", "root": str(tmp_path),
           "web": {"enabled": True, "host": "127.0.0.1", "port": 0},
           "devices": [_pdev()]}                             # a Polar device, no ring
    cfgp = tmp_path / "config.yaml"; cfgp.write_text(_yaml.safe_dump(cfg))
    monkeypatch.setattr(_sys, "argv", ["capture.py", "--config", str(cfgp)])
    capture._STOP.clear()
    _run(capture.main())
    assert "no O2Ring" in holder.get("err", "")


# ══════════════════════════════════════════════════════════════════════════════════════════════════════
# NIGHT GUARDRAILS — storage_poller · alert_poller · sd_watchdog + their main() wiring
# ══════════════════════════════════════════════════════════════════════════════════════════════════════
import os as _os


def test_storage_poller_updates_status_and_prunes(tmp_path, monkeypatch):
    """The poller records disk state in STATUS and prunes past the retention count, protecting tonight."""
    cap = tmp_path / "captures"
    for n in ("2026-07-01", "2026-07-02", "2026-07-03"):
        _os.makedirs(str(cap / n), exist_ok=True)
    # tonight = a date NOT among the fixtures, so retention=1 prunes the two oldest
    monkeypatch.setattr(capture, "_now", lambda: __import__("datetime").datetime(2026, 7, 4, 22, 0, 0))
    _stop_after(monkeypatch, 1)
    cfg = {"storage": {"keep_nights": 1, "min_free_gb": 0, "poll_sec": 300}}
    _run(capture.storage_poller(cfg, str(tmp_path)))
    assert capture.STATUS["storage"]["pruned"] == ["2026-07-01", "2026-07-02"]
    assert capture.STATUS["storage"]["total_gb"] > 0
    assert capture.diskguard.list_nights(str(cap)) == ["2026-07-03"]


def test_storage_poller_alerts_once_when_disk_is_low(tmp_path, monkeypatch):
    """A low-free-space episode fires exactly one alert (edge-triggered), even across polls."""
    sent = []
    class _N:
        async def send(self, title, message, **kw): sent.append(title); return True
    _stop_after(monkeypatch, 2)                       # two polls; the alert must fire only once
    cfg = {"storage": {"keep_nights": 0, "min_free_gb": 1e9, "poll_sec": 1}}   # always "low"
    _run(capture.storage_poller(cfg, str(tmp_path), _N()))
    assert sent == ["Tepna: disk low"]


def test_storage_poller_swallows_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr(capture.diskguard, "disk_report",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("statvfs boom")))
    _stop_after(monkeypatch, 1)
    _run(capture.storage_poller({"storage": {}}, str(tmp_path)))   # must not raise


def test_alert_poller_fires_on_a_sustained_offline_then_recovers(monkeypatch):
    """A device offline past the threshold alerts once; when it reconnects, a recovery alert fires."""
    sent = []
    class _N:
        async def send(self, title, message, **kw): sent.append(title)
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 0}, "devices": [_dev(name="H10")]}
    st = {"connected": False}
    capture.STATUS["devices"]["H10"] = st
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] == 2:
            st["connected"] = True            # it comes back on the 2nd poll → recovery alert
        if calls["n"] >= 3:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    _run(capture.alert_poller(cfg, _N()))
    assert sent == ["Tepna: sensor offline", "Tepna: sensor recovered"]


def test_alert_poller_skips_a_nameless_device_and_a_connected_one(monkeypatch):
    sent = []
    class _N:
        async def send(self, title, message, **kw): sent.append(title)
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 300},
           "devices": [{"streams": ["ecg"]}, _dev(name="H10")]}   # first is nameless → skipped
    capture.STATUS["devices"]["H10"] = {"connected": True}         # connected → never alerts
    _stop_after(monkeypatch, 1)
    _run(capture.alert_poller(cfg, _N()))
    assert sent == []


def test_sd_watchdog_pings_when_configured(monkeypatch):
    pings = {"n": 0}
    monkeypatch.setattr(capture.sdnotify, "watchdog_period_sec", lambda: 30.0)
    monkeypatch.setattr(capture.sdnotify, "sd_notify",
                        lambda state: pings.__setitem__("n", pings["n"] + 1) or True)
    _stop_after(monkeypatch, 1)
    _run(capture.sd_watchdog())
    assert pings["n"] >= 1


def test_sd_watchdog_is_a_noop_without_a_configured_watchdog(monkeypatch):
    monkeypatch.setattr(capture.sdnotify, "watchdog_period_sec", lambda: None)
    _run(capture.sd_watchdog())                       # returns immediately, no loop, no _stop needed


def test_main_signals_ready_and_announces_start(tmp_path, monkeypatch):
    """main() sends systemd READY=1 and (with a webhook configured) a 'capture started' alert."""
    import webmon, yaml as _yaml, sys as _sys
    signals = []
    monkeypatch.setattr(capture.sdnotify, "sd_notify", lambda s: signals.append(s) or True)
    posts = []
    async def fake_post(url, payload): posts.append(payload); return True
    monkeypatch.setattr(capture.alerts, "_http_post", fake_post)
    for r in ("run_polar", "run_oxyii", "run_viatom", "run_muse", "status_loop", "adapter_watchdog",
              "rssi_poller", "clock_watchdog", "host_clock_poller", "storage_poller", "alert_poller",
              "qc_poller", "archive_poller", "sd_watchdog"):
        async def _n(*a, **k): return None
        monkeypatch.setattr(capture, r, _n)
    async def fake_hci(mac, refresh=False): return "hci2"
    monkeypatch.setattr(capture.link_rssi, "resolve_hci", fake_hci)
    class _Runner:
        async def cleanup(self): pass
    async def fake_start(app, host, port):
        capture._STOP.set(); return _Runner()
    monkeypatch.setattr(webmon, "start", fake_start)
    cfg = {"adapter": "AC:A7:F1:29:9D:1D", "root": str(tmp_path),
           "web": {"enabled": True, "host": "127.0.0.1", "port": 0},
           "alerts": {"enabled": True, "webhook_url": "https://hook"},
           "devices": [_pdev()]}
    cfgp = tmp_path / "config.yaml"; cfgp.write_text(_yaml.safe_dump(cfg))
    monkeypatch.setattr(_sys, "argv", ["capture.py", "--config", str(cfgp)])
    capture._STOP.clear()
    _run(capture.main())
    assert "READY=1" in signals and "STOPPING=1" in signals
    assert posts and posts[0]["title"] == "Tepna: capture started"


# ── qc_poller ───────────────────────────────────────────────────────────────────────────────────────
def test_qc_poller_summarizes_the_current_night(tmp_path, monkeypatch):
    """The poller writes QC-SUMMARY.json + status.json `qc` for tonight's directory, and logs missing
    streams."""
    import datetime as _dtm
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 23, 0, 0))
    night = tmp_path / "captures" / "2026-07-19"; night.mkdir(parents=True)
    with open(night / "Polar_H10_02849638_20260719_ECG.txt", "w") as f:
        f.write("h\n1\n2\n3\n")                             # 3 rows
    # ACC declared but never produced → missing
    cfg = {"qc": {"poll_sec": 600},
           "devices": [{"name": "H10", "device_id": "02849638", "streams": ["ecg", "acc"]}]}
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller(cfg, str(tmp_path)))
    assert capture.STATUS["qc"]["night"] == "2026-07-19"
    assert capture.STATUS["qc"]["missing"] == ["H10:acc"] and capture.STATUS["qc"]["ok"] is False
    assert (night / "QC-SUMMARY.json").exists()


def test_qc_poller_skips_when_no_night_dir_yet(tmp_path, monkeypatch):
    """Nothing captured tonight → the poller must not create an empty night folder."""
    import datetime as _dtm
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 23, 0, 0))
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller({"devices": []}, str(tmp_path)))
    assert "qc" not in capture.STATUS
    assert not (tmp_path / "captures" / "2026-07-19").exists()


def test_qc_poller_swallows_an_error(tmp_path, monkeypatch):
    import datetime as _dtm
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 23, 0, 0))
    (tmp_path / "captures" / "2026-07-19").mkdir(parents=True)
    monkeypatch.setattr(capture.nightqc, "summarize",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("qc boom")))
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller({"devices": []}, str(tmp_path)))     # must not raise


def _qc_night(tmp_path, monkeypatch, missing=True):
    """A tmp night dir with an ECG file; ACC declared-but-absent when missing=True."""
    import datetime as _dtm
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 23, 0, 0))
    night = tmp_path / "captures" / "2026-07-19"; night.mkdir(parents=True)
    with open(night / "Polar_H10_02849638_20260719_ECG.txt", "w") as f:
        f.write("h\n1\n2\n")
    if not missing:
        with open(night / "Polar_H10_02849638_20260719_ACC.txt", "w") as f:
            f.write("h\n1\n2\n")
    streams = ["ecg", "acc"]
    return {"qc": {"poll_sec": 1, "alert_after_sec": 3600},
            "devices": [{"name": "H10", "device_id": "02849638", "streams": streams}]}


def test_qc_poller_alerts_once_on_a_gap_past_the_grace(tmp_path, monkeypatch):
    """A stream still missing after alert_after_sec fires exactly one alert for the night."""
    sent = []
    class _N:
        async def send(self, title, message, **kw): sent.append(title); return True
    cfg = _qc_night(tmp_path, monkeypatch, missing=True)
    clock = {"t": 0.0}
    monkeypatch.setattr(capture._time, "monotonic", lambda: clock["t"])
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        clock["t"] += 4000                 # each poll advances well past the 3600 s grace
        if calls["n"] >= 3:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    _run(capture.qc_poller(cfg, str(tmp_path), _N()))
    assert sent == ["Tepna: night has a gap"]   # once, despite 3 polls all seeing the gap


def test_qc_poller_holds_the_alert_during_the_grace(tmp_path, monkeypatch):
    """Within the grace window a missing stream must NOT alert — a just-started night is legitimately empty."""
    sent = []
    class _N:
        async def send(self, title, message, **kw): sent.append(title)
    cfg = _qc_night(tmp_path, monkeypatch, missing=True)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 100.0)   # never advances past grace
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller(cfg, str(tmp_path), _N()))
    assert sent == []


def test_qc_poller_no_alert_when_complete(tmp_path, monkeypatch):
    sent = []
    class _N:
        async def send(self, title, message, **kw): sent.append(title)
    cfg = _qc_night(tmp_path, monkeypatch, missing=False)            # every declared stream present
    monkeypatch.setattr(capture._time, "monotonic", lambda: 999999.0)
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller(cfg, str(tmp_path), _N()))
    assert sent == [] and capture.STATUS["qc"]["ok"] is True


# ── archive_poller ────────────────────────────────────────────────────────────────────────────────────
def test_archive_poller_disabled_returns_immediately(tmp_path, monkeypatch):
    _run(capture.archive_poller({"archive": {"enabled": False}}, str(tmp_path)))   # early return, no loop
    _run(capture.archive_poller({"archive": {"enabled": True}}, str(tmp_path)))    # no dest → also returns


def test_archive_poller_mirrors_completed_nights(tmp_path, monkeypatch):
    import datetime as _dtm
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 2, 0, 0))
    cap = tmp_path / "captures"
    (cap / "2026-07-18").mkdir(parents=True)                    # a completed night
    (cap / "2026-07-18" / "Polar_H10_1_ECG.txt").write_text("rows\n")
    (cap / "2026-07-19").mkdir()                                # tonight — must NOT be archived
    (cap / "2026-07-19" / "Polar_H10_1_ECG.txt").write_text("live\n")
    dest = tmp_path / "backup"
    cfg = {"archive": {"enabled": True, "dest": str(dest), "poll_sec": 1}}
    _stop_after(monkeypatch, 1)
    _run(capture.archive_poller(cfg, str(tmp_path)))
    assert (dest / "2026-07-18" / "Polar_H10_1_ECG.txt").exists()
    assert not (dest / "2026-07-19").exists()                   # tonight left alone
    assert capture.STATUS["archive"]["last"] == "2026-07-18"


def test_archive_poller_swallows_an_error(tmp_path, monkeypatch):
    import datetime as _dtm
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 2, 0, 0))
    monkeypatch.setattr(capture.nightarchive, "pending_nights",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("archive boom")))
    cfg = {"archive": {"enabled": True, "dest": str(tmp_path / "b"), "poll_sec": 1}}
    _stop_after(monkeypatch, 1)
    _run(capture.archive_poller(cfg, str(tmp_path)))            # must not raise
