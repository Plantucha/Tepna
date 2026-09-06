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
import logging

import pytest

import capture
from tests._srcscan import module_source


_DROP_DEFAULT = capture._DROP_NOT_WORN_SEC
# main() also tunes these process-wide constants from config; snapshot them so a main() test cannot leak an
# override into an unrelated test module (test_drop_not_worn / test_settings_schema assert the defaults).
_GLOBAL_SNAPSHOT = {k: getattr(capture, k) for k in
                    ("_DROP_NOT_WORN_SEC", "_NOT_WORN_RECHECK_S", "_OXYII_RTC_RESYNC_SEC",
                     "O2PPG_FS", "O2PPG_NS_STEP", "_STREAM_STALL_S", "_RECONNECT_BACKOFF_CAP_S")}


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
    # The restart-storm state: a hold left by one test parks EVERY later run_oxyii test on the hold
    # instead of connecting (measured: 35 unrelated failures on the first full run of that group).
    capture._OXYII_RESTARTS.clear(); capture._OXYII_STORMS.clear(); capture._OXYII_HOLD_UNTIL.clear()
    capture._OXYII_LAST_DURATION.clear()
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


def test_status_loop_publishes_the_ALERT_TRANSPORTS_OWN_HEALTH(tmp_path, monkeypatch):
    """The alert path is the last line of defence for every silent-absence failure the daemon guards
    against, so its own health has to reach the same surface as the capture it protects. Measured
    2026-08-11: 32 alerts fired in 24 h and the journal held ONE delivery outcome in 48 h — nothing
    said whether the rest landed, because success was silent and nothing was published anywhere."""
    import alerts as _alerts
    monkeypatch.setattr(capture, "_NOTIFIER", _alerts.Notifier(url="https://hook", enabled=True))
    capture.STATUS.pop("alerts", None)
    _stop_after(monkeypatch, 1)
    _run(capture.status_loop(str(tmp_path)))
    st = capture.STATUS.get("alerts")
    assert st is not None, "the alert transport's health never reached status.json"
    # `enabled and nothing delivered` is UNPROVEN, not healthy — the state the real box was in.
    assert st["enabled"] is True and st["last_ok"] is None and st["delivered"] == 0


def test_status_loop_works_with_NO_notifier_configured(tmp_path, monkeypatch):
    """The other side of the branch: alerting off (or main() not yet reached) must publish nothing
    rather than an empty dict that renders as a card claiming a transport exists."""
    monkeypatch.setattr(capture, "_NOTIFIER", None)
    capture.STATUS.pop("alerts", None)
    _stop_after(monkeypatch, 1)
    _run(capture.status_loop(str(tmp_path)))
    assert "alerts" not in capture.STATUS


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
    # Dispatches on UUID: the runner reads BOTH the battery and (once per connection) the Firmware
    # Revision String, and a fake that returns the battery byte for every characteristic would hand the
    # firmware reader a one-character version it never saw on a device.
    fw = b"2D010002"                                       # what this box's ring actually reports
    async def read_gatt_char(self, c):
        if str(c).lower() == capture.FIRMWARE_UUID:
            if isinstance(self.fw, Exception):
                raise self.fw
            return self.fw
        return b"\x64"                                     # battery 100
    async def write_gatt_char(self, char, data, response=False):
        self.writes.append(bytes(data))
        if self.on_live:
            self.on_live(data)


def _o2ring_live_reply(spo2=96, pr=55, worn=True, batt=90, batt_state=0, duration=900):
    hdr = bytearray(24)
    # contact is byte [5] — what parse_live's `worn` actually reads. [10] is the flag byte; setting only
    # [10] left every runner test driving the UNWORN contact path (found by the rec-axis coverage run).
    hdr[5] = 0x01 if worn else 0x00
    hdr[6] = spo2
    hdr[7] = 14                 # PI (non-zero)
    hdr[8] = pr & 0xFF
    hdr[10] = 0x01 if worn else 0x00
    hdr[11] = 0                 # motion
    hdr[12] = batt_state
    hdr[13] = batt
    hdr[0:4] = int(duration).to_bytes(4, "little")
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


def test_run_oxyii_journals_both_axes_worn_flip_and_recording_close(tmp_path, monkeypatch):
    """One faked poll sequence drives BOTH axes end-to-end through the PRODUCTION callback (execution
    witness, not a helper test): worn advancing frames → link LIVE + rec RECORDING; an unworn frame with
    duration reset → link IDLE_UNWORN + rec END_CANDIDATE, all journalled to OXYLIFE.csv with the axis
    column distinguishing the rows."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    replies = [
        _o2ring_live_reply(worn=True, duration=900),    # UNKNOWN holds (first positive reading)
        _o2ring_live_reply(worn=True, duration=901),    # advancing → RECORDING; worn → LIVE
        _o2ring_live_reply(worn=False, duration=0),     # reset → END_CANDIDATE; unworn → IDLE_UNWORN
    ]
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, replies.pop(0)) if data[1] == oxyii.OP_LIVE and replies else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 6)     # auth + setup + RTC sleeps, then three polls
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    # After the runner exits, the finally path fired observe_link_lost: the axis HONESTLY reads UNKNOWN
    # (link gone ≠ not-recording — the planted control, exercised through the production teardown).
    assert st["oxy_recording"] == "rec_unknown", "post-teardown the axis must read UNKNOWN, not a stale state"
    (life,) = list((tmp_path / "captures").rglob("OXYLIFE.csv"))
    rows = [ln.split(";") for ln in life.read_text().splitlines() if ln and not ln.startswith(("#", "host_wall"))]
    rec = [r for r in rows if r[-1] == "rec"]
    link = [r for r in rows if r[-1] == ""]
    assert [r[3] for r in rec] == ["recording", "end_candidate", "rec_unknown"], "rec axis journals in order"
    assert "901→0" in rec[1][4] and "closed at 901" in rec[1][4], "the close records the counter value"
    assert any(r[3] == "live" for r in link) and any(r[3] == "idle_unworn" for r in link)


def _oxylife_link_rows(tmp_path):
    (life,) = list((tmp_path / "captures").rglob("OXYLIFE.csv"))
    rows = [ln.split(";") for ln in life.read_text().splitlines() if ln and not ln.startswith(("#", "host_wall"))]
    return [r for r in rows if r[-1] == ""]


def test_run_oxyii_an_unworn_ring_streaming_frames_holds_IDLE_UNWORN_instead_of_flapping(tmp_path, monkeypatch):
    """THE vigil 2026-08-28 oscillator, through the production loop. A connected ring on the desk answers
    every ~1 Hz poll with contact=0: the live callback votes IDLE_UNWORN, then the loop's stall guard saw
    a new frame and re-asserted LIVE ("frames flowing"), and the next poll voted IDLE_UNWORN again —
    17,688 episodes, 32k rows each way, median dwell 1.0 s, on a night the ring was never worn. A frame
    from an unworn ring is a heartbeat of the LINK; only the contact vote may move the worn edge."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    replies = [_o2ring_live_reply(worn=False, duration=0) for _ in range(5)]
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, replies.pop(0)) if data[1] == oxyii.OP_LIVE and replies else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 8)     # auth + setup + RTC, then five polls — five chances to flap
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    link = [r[3] for r in _oxylife_link_rows(tmp_path)]
    worn_axis = [x for x in link if x in ("live", "idle_unworn")]
    assert worn_axis == ["idle_unworn"], (
        f"five unworn frames must journal ONE idle_unworn hold, not a live/idle oscillation: {link}")
    assert capture.STATUS["devices"]["Ring"]["oxy_lifecycle"] != "live", "STATUS must not end on a 'live' the ring never earned"


def test_run_oxyii_the_contact_vote_still_owns_the_worn_edge_in_both_directions(tmp_path, monkeypatch):
    """The control for the hold above: holding IDLE_UNWORN against frames must not weld the ring there.
    A worn frame after the unworn ones flips it back to LIVE (the callback's vote), and an unworn one
    flips it to IDLE_UNWORN again — one row per real change, none per frame."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    replies = [
        _o2ring_live_reply(worn=True, duration=900),
        _o2ring_live_reply(worn=False, duration=0),
        _o2ring_live_reply(worn=False, duration=0),
        _o2ring_live_reply(worn=True, duration=10),
        _o2ring_live_reply(worn=True, duration=11),
        _o2ring_live_reply(worn=False, duration=0),
    ]
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, replies.pop(0)) if data[1] == oxyii.OP_LIVE and replies else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 10)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    link = [r[3] for r in _oxylife_link_rows(tmp_path)]
    worn_axis = [x for x in link if x in ("live", "idle_unworn")]
    assert worn_axis == ["live", "idle_unworn", "live", "idle_unworn"], link


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


def test_run_viatom_backoff_grows_when_the_link_carries_no_data(tmp_path, monkeypatch):
    """A connect that SUCCEEDS but yields no rows must not re-arm the retry floor.

    The ring's dominant overnight failure is `failed to discover services, device disconnected`,
    which lands just AFTER connect() returns. The runner used to reset `backoff = 5` on connect, so
    every doomed attempt re-armed the floor and the exponential backoff could never grow — on
    2026-07-19 that produced 178 reconnects at a median 17 s gap, 115 file fragments and 12 % of the
    night lost. Two consecutive data-less sessions must therefore take INCREASING sleeps.
    """
    from bleak.exc import BleakError

    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)

    class _RaisingServices:
        """Iterating the service list is where the real failure surfaces, just after connect()."""
        def __iter__(self):
            raise BleakError("failed to discover services, device disconnected")

    c = FakeGattClient()
    c.services = _RaisingServices()
    _inject_connect(monkeypatch, c)

    slept = []
    async def fake_sleep(secs):
        if secs and secs >= 5:                           # the reconnect backoff, not poll sleeps
            slept.append(secs)
            if len(slept) >= 2:
                capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)

    _run(capture.run_viatom(_o2dev(name="Ring", protocol="legacy"), str(tmp_path)))

    assert len(slept) >= 2, f"expected two reconnect sleeps, got {slept}"
    assert slept[1] > slept[0], (
        f"backoff did not grow across two data-less sessions: {slept} — a connect() that carries no "
        "data must not reset the retry floor"
    )


# ── run_polar (PMD negotiation via the control point) ───────────────────────────────────────────────
import polar_pmd as pmd


class FakePolarClient:
    """A Polar PMD device: answers control-point commands (STOP/GET_SETTINGS/START) with real
    parse_settings_response / START-ack frames, and feeds one ECG data frame once PMD_DATA is subscribed."""
    def __init__(self, start_status=0x00, hr_frame=None, sdk_start_ok=True):
        self.cbs = {}                  # uuid -> notify callback
        self._connected = True
        self.writes = []
        self.start_status = start_status
        self.hr_frame = hr_frame
        # SDK mode is DEVICE STATE, not a canned reply: START sets it, STOP clears it, and the settings
        # menu below is read off it. A fake that answered a fixed flag would let the daemon skip the
        # enter entirely and still look correct. `sdk_start_ok=False` models the real refusal — the
        # device declining with `invalid_state` because a stream was still running.
        self.sdk_start_ok = sdk_start_ok
        self.sdk_mode_on = False

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
        # PARAMETERLESS OPS ARE ONE BYTE LONG. `cmd[1]` IndexErrors on the SDK-mode status query
        # (`06`), and `_ctrl` pairs a reply to its command by `got[1] == cmd[0]`, so the envelope must
        # echo the OPCODE there rather than a measurement type.
        op = cmd[0]
        if len(cmd) < 2:
            ctrl(0, bytes([0xF0, op, pmd.SDK_MODE, 0x00, 0x00, int(self.sdk_mode_on)]))
            return
        meas = cmd[1]
        if op == 0x01:                                    # GET_SETTINGS
            # In SDK mode the device answers with a LARGER menu — that is the entire point of the mode,
            # so a fake answering identically either way could not tell the two states apart.
            rates = [130, 176] if self.sdk_mode_on else [130]
            resp = (bytes([0xF0, 0x01, meas, 0x00, 0x00, 0x00, len(rates)])
                    + b"".join(r.to_bytes(2, "little") for r in rates))
        elif op == 0x02:                                  # START
            if meas == pmd.SDK_MODE:
                self.sdk_mode_on = self.sdk_start_ok
                resp = bytes([0xF0, 0x02, meas, 0x00 if self.sdk_start_ok else pmd.INVALID_STATE])
            else:
                resp = bytes([0xF0, 0x02, meas, self.start_status])
        else:                                             # STOP
            if meas == pmd.SDK_MODE:
                self.sdk_mode_on = False
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


def test_a_stream_the_device_will_not_serve_does_not_make_the_DEVICE_charging(tmp_path, monkeypatch):
    """0x0C invalid_state is a MEASUREMENT state; 0x0D in_charger is a DEVICE state. Reading any
    transient as "charging" cost a whole night: the Verity answers invalid_state to PPI permanently,
    PPI is negotiated LAST, so its refusal overwrote the successful charging=False writes from every
    other stream. The box reported "charging — PMD streams unavailable" while streaming 151k rows with
    a FALLING battery, and because charging_hold ends the session it re-negotiated every ~60 s all
    night — 26 files for one night, and an on-charger auto-pull each time."""
    _polar_common(monkeypatch)
    c = FakePolarClient(start_status=0x0C)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"].get("charging") is not True, \
        "a per-measurement refusal claimed the whole device was on the charger"
    assert "charging" not in (capture.STATUS["devices"]["H10"].get("last_error") or ""), \
        "the device was labelled charging on the strength of one stream"


def test_the_two_transients_are_not_the_same_state():
    """Both mean retry-don't-drop. Only one means the DEVICE is charging — the distinction the fix
    turns on, pinned so it cannot be collapsed again."""
    assert pmd.is_transient(pmd.IN_CHARGER) and pmd.is_transient(pmd.INVALID_STATE)
    assert pmd.IN_CHARGER != pmd.INVALID_STATE
    assert pmd.CTRL_STATUS[pmd.IN_CHARGER] == "in_charger"
    assert pmd.CTRL_STATUS[pmd.INVALID_STATE] == "invalid_state"


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


# ── _connect_scan: the passive→active downgrade ─────────────────────────────────────────────────────
# REGRESSION GUARD. Passive scanning shipped without or_patterns and BlueZ refused it at scanner
# construction, so the O2Ring's scan never ran and the ring stayed dark for a whole night — while these
# tests stayed green, because a stubbed find_device_by_filter swallows any kwargs and can't refuse. So the
# stub has to refuse the way BlueZ does, or this class of break is invisible here again.
def _passive_refuser(found, calls):
    """A find_device_by_filter that rejects passive exactly as bleak's BlueZ backend does."""
    from bleak.exc import BleakError
    async def find(*a, **k):
        calls.append(k.get("scanning_mode"))
        if k.get("scanning_mode") == "passive":
            raise BleakError("passive scanning mode requires bluez or_patterns")
        return found
    return find


def test_connect_scan_falls_back_to_active_when_bluez_refuses_passive(monkeypatch):
    import bleak
    class _Dev:
        address = "D1:98:62:7C:92:B3"; name = "S8-AW"
    events, calls = [], []
    class _BC:
        def __init__(self, dev, **kw): pass
        async def connect(self): events.append("c")
        async def disconnect(self): events.append("d")
    monkeypatch.setattr(capture, "_O2_PASSIVE_SCAN", True)
    monkeypatch.setattr(bleak.BleakScanner, "find_device_by_filter", _passive_refuser(_Dev(), calls))
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)

    async def go():
        async with capture._connect_scan("D1:98:62:7C:92:B3"):
            events.append("u")
    _run(go())
    assert calls == ["passive", None]        # tried passive, then re-scanned actively
    assert events == ["c", "u", "d"]         # …and the ring still got connected
    assert capture._O2_PASSIVE_SCAN is False  # refusal is remembered — no wasted attempt next cycle


def test_connect_scan_skips_passive_once_the_stack_has_refused_it(monkeypatch):
    import bleak
    class _Dev:
        address = "D1:98:62:7C:92:B3"; name = "S8-AW"
    calls = []
    class _BC:
        def __init__(self, dev, **kw): pass
        async def connect(self): pass
        async def disconnect(self): pass
    monkeypatch.setattr(capture, "_O2_PASSIVE_SCAN", False)   # as left by an earlier refusal
    monkeypatch.setattr(bleak.BleakScanner, "find_device_by_filter", _passive_refuser(_Dev(), calls))
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)

    async def go():
        async with capture._connect_scan("D1:98:62:7C:92:B3"):
            pass
    _run(go())
    assert calls == [None]                   # one active scan, no passive retry


def test_connect_scan_propagates_a_real_scan_error(monkeypatch):
    """A wedged adapter must stay an error the retry loop + watchdogs can see — not be masked by a
    second scan on the same broken radio."""
    import bleak
    from bleak.exc import BleakError
    calls = []
    async def find(*a, **k):
        calls.append(k.get("scanning_mode"))
        raise BleakError("org.freedesktop.DBus.Error.NoReply")
    monkeypatch.setattr(capture, "_O2_PASSIVE_SCAN", True)
    monkeypatch.setattr(bleak.BleakScanner, "find_device_by_filter", find)
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)

    async def go():
        async with capture._connect_scan("D1:98:62:7C:92:B3"):
            pass
    with pytest.raises(BleakError):
        _run(go())
    assert calls == ["passive"]               # no fallback rescan
    assert capture._O2_PASSIVE_SCAN is True   # and passive is NOT blamed for it


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


def test_main_with_an_instance_serves_only_that_radios_devices(tmp_path, monkeypatch):
    """`--instance` is how systemd hands `tepna-capture@sena` its identity. This drives the ONE call
    site in main(); apply_instance() itself is unit-tested separately.

    Asserts the pin actually took: ADAPTER must become the INSTANCE's radio, not the config's global.
    If it silently kept the global, every instance would capture on the same adapter — three daemons
    fighting over one radio, which looks healthy from each one's own log."""
    import yaml as _yaml
    cfg = {"adapter": "AC:A7:F1:29:9D:1D", "root": str(tmp_path),
           "adapters": {"sena": "00:01:95:CC:53:02", "ub500": "AC:A7:F1:29:9D:1D"},
           "web": {"enabled": True, "host": "127.0.0.1", "port": 0},
           "devices": [_pdev()]}
    cfgp = tmp_path / "config.yaml"
    cfgp.write_text(_yaml.safe_dump(cfg))

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
        capture._STOP.set()
        return _Runner()
    monkeypatch.setattr(webmon, "start", fake_start)

    import sys as _sys
    monkeypatch.setattr(_sys, "argv", ["capture.py", "--config", str(cfgp), "--instance", "sena"])
    capture._STOP.clear()
    _run(capture.main())
    assert capture.ADAPTER == "00:01:95:CC:53:02", "the instance's radio must win over the global"
    assert capture.INSTANCE == "sena"


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


def test_run_oxyii_reports_the_ppg_frame_ledger_at_session_end(tmp_path, monkeypatch, caplog):
    """The COUNTED half of the session report (O2RING-FRAME-SAMPLE-LOCK §7), driven through the REAL
    runner rather than a hand-built logging call.

    ⚠️ The sibling test above replies with a CONSTANT `duration`, so every step is 0, `device_seconds`
    never advances, and this report line never executes — the code path was exercised while its
    condition never was. Here the ring's session second ADVANCES, and one reply skips a second so a
    `+2` step lands on the record too.

    Asserting the shipped line's WORDING matters as much as its numbers: it is the only place a reader
    meets these counters, and "not lost frames" is the clause that stops a `+2` step being re-read as
    loss for the fourth time (see the ledger's own class docstring)."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    N = 126
    body = N.to_bytes(2, "little") + bytes(i % 256 for i in range(N))
    # 900 -> 901 -> 903: an ordinary tick, then the +2 step this whole brief is about.
    secs, seen = [900, 901, 903, 904, 905, 906, 907, 908], [0]

    def reply():
        d = secs[min(seen[0], len(secs) - 1)]
        seen[0] += 1
        hdr = bytearray(24); hdr[6] = 96; hdr[8] = 55; hdr[10] = 1; hdr[13] = 90
        hdr[0:4] = d.to_bytes(4, "little")
        return oxyii.encode(oxyii.OP_LIVE, bytes(hdr) + body)

    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, reply()) if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    # 8, not 4: the auth/setup/RTC handshake burns three sleeps before the poll loop starts, so a
    # smaller budget delivers ONE frame and one frame closes no step at all.
    _stop_after(monkeypatch, 8)
    caplog.set_level(logging.INFO)
    _run(capture.run_oxyii(_o2dev(name="Ring", streams=["spo2", "ppg"]), str(tmp_path)))
    msg = caplog.text
    assert "PPG frames —" in msg, "the counted half of the report must reach the log"
    assert "quantization — not lost frames" in msg
    assert "declared" in msg and "truncated" in msg


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


def _stop_after_slept(monkeypatch, seconds):
    """Patch capture's sleep to accumulate simulated time and trip _STOP once `seconds` have passed.

    Structure-agnostic on purpose. The charging wait is ticked rather than taken as one long sleep
    (so the link can be released promptly when an offline pull needs it), so a helper that watches
    for a single big sleep can no longer see it — and would hang forever waiting.
    """
    t = {"s": 0.0}
    async def fake_sleep(secs):
        t["s"] += secs
        if t["s"] >= seconds:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    return t


def test_run_polar_charging_recheck_uses_the_charge_cadence_not_the_error_backoff(tmp_path, monkeypatch):
    """START 0x0D → charging → re-attempt every CHARGE_RETRY_S, because this is a device state and
    not a fault. Asserted as a RATE: let ~2.5 recheck periods of simulated time pass and count the
    STARTs. The error backoff (5 s, doubling) would produce far more; a longer cadence, far fewer."""
    _polar_common(monkeypatch)
    c = FakePolarClient(start_status=0x0D)
    _inject_connect(monkeypatch, c)
    _stop_after_slept(monkeypatch, capture.CHARGE_RETRY_S * 2.5)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["charging"] is True
    starts = [w for w in c.writes if w and w[0] == 0x02]
    assert 3 <= len(starts) <= 5, (
        f"{len(starts)} STARTs in 2.5x CHARGE_RETRY_S — expected one per recheck period; the error "
        "backoff would be far more frequent")


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
                 raise_batt=False, spurious_ctrl=False, start_status=0x00,
                 stop_notify=False, wrong_op_ctrl=False):
        super().__init__(start_status=start_status, hr_frame=hr_frame)
        self.data_frames = data_frames if data_frames is not None else [_ecg_frame()]
        self.batt_level = batt_level
        self.raise_feature = raise_feature
        self.raise_batt = raise_batt
        self.spurious_ctrl = spurious_ctrl
        self.stop_notify = stop_notify
        self.wrong_op_ctrl = wrong_op_ctrl
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
        # PARAMETERLESS OPS ARE ONE BYTE — `cmd[1]` IndexErrors on them, `_ctrl` catches the exception
        # and returns b"", and the caller reads that as "the device did not answer". The BASE class has
        # handled this since the SDK-mode work; this override lost it, which silently made every
        # parameterless op (SDK-mode status 0x06, measurement status 0x05) untestable through the fake
        # every test in this file uses. `_ctrl` pairs a reply by `got[1] == cmd[0]`, so the envelope
        # must echo the OPCODE at [1], not a measurement type.
        if len(cmd) < 2:
            ctrl(0, bytes([0xF0, cmd[0], pmd.SDK_MODE, 0x00, 0x00, int(self.sdk_mode_on)]))
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
        if self.stop_notify and self._ctrl_writes == 1:
            # The device pushing ONLINE_MEASUREMENT_STOPPED (0x01, NOT 0xF0) between our write and its
            # indication. This used to be returned AS the response.
            ctrl(0, bytes([pmd.SVC_ONLINE_MEASUREMENT_STOPPED, pmd.ECG, pmd.ACC]))
        if self.wrong_op_ctrl and self._ctrl_writes == 1:
            # A well-formed response to a DIFFERENT command — a previous one that timed out and then
            # answered. Returning it here reads a stale verdict as this command's.
            ctrl(0, bytes([0xF0, (op ^ 0x0F), meas, 0x03]))
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


def test_run_polar_start_without_an_ack_keeps_the_stream(tmp_path, monkeypatch):
    """NO CONTROL RESPONSE IS NOT A REJECTION (pmd.NO_ACK). Every _ctrl times out, so neither START is
    acknowledged. This used to take the "unsupported settings" branch — deleting the writer and
    unregistering the card — so ONE dropped indication cost that stream the entire session, and a control
    channel that never subscribed silently cost ALL of them. The stream is now KEPT, with the stall
    watchdog left to re-negotiate it on a fresh link."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_ecg_frame()], start_status=0x00)
    _inject_connect(monkeypatch, c)
    async def timeout_wait_for(coro, timeout):
        # start_notify is now bounded too (VIGIL-DEEP-ANALYSIS §1.1) — let it COMPLETE and time out only
        # the control round-trips (ctrl_q.get), which is what produces the NO_ACK this test exercises.
        if getattr(getattr(coro, "cr_code", None), "co_name", "") == "start_notify":
            return await coro
        coro.close()                                  # don't leave the ctrl_q.get() pending
        raise capture.asyncio.TimeoutError
    monkeypatch.setattr(capture.asyncio, "wait_for", timeout_wait_for)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    err = (capture.STATUS["devices"]["H10"].get("last_error") or "").lower()
    assert "unacknowledged" in err and "rejected" not in err


def test_run_polar_start_rejected_removes_the_file(tmp_path, monkeypatch):
    """A REAL rejection status (0x03 not_supported — neither started, transient, nor NO_ACK) still drops
    the stream and removes its header-only file, and an os.remove that raises there is swallowed (both in
    the rejected path and in the finally's header-only sweep)."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_ecg_frame()], start_status=0x03)
    _inject_connect(monkeypatch, c)
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


def test_run_polar_auto_sync_does_NOT_spend_the_ladder_on_an_absent_device(tmp_path, monkeypatch):
    """THE FIX (2026-08-09). Each ladder attempt holds the GLOBAL _CONNECT_LOCK via polar_offline_op, so
    spending 12 of them on a device the scan cannot see blocks every OTHER sensor's reconnect for nothing.

    Measured on the box with an H10 on a desk: 51 ops in 59.1 min, mean hold 41.1 s — a 59 % duty cycle.
    This is the third time this shape has been fixed here; the first two lowered the TIMEOUT (300 s, then
    45 s) and left the loop. Counting the attempts is what pins the loop itself.

    Nothing is lost by giving up: `clock_sync_due` re-syncs on every reconnect, and a reconnect only
    happens when the device IS reachable — the reconnect loop is already the retry mechanism for absence."""
    _auto_sync_common(monkeypatch)
    calls = {"n": 0}
    async def absent(addr):
        calls["n"] += 1
        raise RuntimeError("BleakDeviceNotFoundError: not advertising")
    monkeypatch.setattr(capture, "sync_device_time", absent)
    _skip_while_loop()
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert calls["n"] == 1, f"an absent device must cost ONE attempt, not 12 (got {calls['n']})"
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


def test_pmd_probe_returns_when_the_probe_is_unset(monkeypatch):
    """Unset PMD_FRAME_PROBE means the diagnostic is OFF, and `_pmd_probe` must return without
    touching anything — including its own seen-counter.

    The only call site is already guarded by `if _PMD_PROBE:`, but a module-global narrowing does
    not cross a function boundary, so the guard is re-established inside. This pins the arm that
    guard creates: without it, `open(None, "a")` raises inside the try and is swallowed, which
    looks identical to a working probe that wrote nothing.
    """
    monkeypatch.setattr(capture, "_PMD_PROBE", None)
    capture._pmd_probe_seen.clear()
    import datetime as _dt
    capture._pmd_probe(pmd.ECG, _ecg_frame(), 3, _dt.datetime(2026, 7, 19, 1, 2, 3))
    assert capture._pmd_probe_seen == {}, "an unarmed probe must not even count the frame"


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


# ── restart STORM: 4 session restarts in 120 s → drop the link, hold off, resume when the hold expires ──
import time as _time  # noqa: E402

_RING = "D1:98:62:7C:92:B3"


def _clear_storm_state():
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_LAST_DURATION.pop(_RING, None)
    capture._OXYII_RESTARTS.clear(); capture._OXYII_STORMS.clear(); capture._OXYII_HOLD_UNTIL.clear()


def _storming_ring():
    """A ring whose session duration goes 900 → 0 → 900 → 0 …: every downward step is a restart (the
    09-05 shape — a ring stuck at run_status 1 that cannot find a pulse and restarts on every poll)."""
    c = FakeGattClient()
    seq = {"i": 0}
    def reply(data):
        if data[1] != oxyii.OP_LIVE:
            return
        seq["i"] += 1
        c.notify(0, _o2ring_live_reply(duration=0 if seq["i"] % 2 == 0 else 900))
    c.on_live = reply
    return c, seq


def test_run_oxyii_restart_storm_drops_the_link_and_holds(tmp_path, monkeypatch, caplog):
    """The execution witness for oxyii_restart_storm inside run_oxyii: the 4th restart latches _storm_hit,
    the poll loop breaks BEFORE the next live poll (no 9th 0x04 write), the outer loop parks on the hold
    with connected=False and a storm last_error, and the storm is recorded for escalation."""
    _clear_storm_state()
    c, seq = _storming_ring()
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 40)                    # far past the break — STOP trips INSIDE the hold wait
    with caplog.at_level(logging.WARNING):
        _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    assert "restart storm" in caplog.text and "4 session restarts" in caplog.text
    assert seq["i"] == 8                              # 4 restarts = 8 polls; the loop broke before a 9th
    assert _RING in capture._OXYII_HOLD_UNTIL and capture._OXYII_HOLD_UNTIL[_RING] > _time.monotonic()
    assert len(capture._OXYII_STORMS[_RING]) == 1 and capture._OXYII_RESTARTS[_RING] == []
    st = capture.STATUS["devices"]["Ring"]
    assert st["connected"] is False and st["last_error"].startswith("restart storm")
    assert "15 min" in st["last_error"]              # the first hold is the base 900 s


def test_run_oxyii_second_storm_holds_twice_as_long(tmp_path, monkeypatch):
    """A storm 20 min ago doubles the hold: 30 min, not 15."""
    _clear_storm_state()
    capture._OXYII_STORMS[_RING] = [_time.monotonic() - 1200.0]
    c, _ = _storming_ring()
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 40)
    _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    assert "30 min" in capture.STATUS["devices"]["Ring"]["last_error"]
    assert len(capture._OXYII_STORMS[_RING]) == 2


def test_run_oxyii_resumes_when_the_hold_has_expired(tmp_path, monkeypatch, caplog):
    """An expired hold is popped, the restart count starts over, and the ring is captured normally."""
    _clear_storm_state()
    capture._OXYII_HOLD_UNTIL[_RING] = _time.monotonic() - 1.0
    capture._OXYII_RESTARTS[_RING] = [_time.monotonic() - 30.0]   # stale count from before the hold
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _o2ring_live_reply()) if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    with caplog.at_level(logging.INFO):
        _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    assert "restart-storm hold over" in caplog.text
    assert _RING not in capture._OXYII_HOLD_UNTIL and _RING not in capture._OXYII_RESTARTS
    assert any(w[1] == oxyii.OP_LIVE for w in c.writes)   # live capture ran


def test_run_oxyii_hold_yields_to_a_stored_pull(tmp_path, monkeypatch):
    """_OXYII_PAUSE set during a hold ends the wait without ending the hold: the pull path takes the link
    (the one interaction measured NOT to restart the ring) and the hold is re-evaluated afterwards."""
    _clear_storm_state()
    capture._OXYII_HOLD_UNTIL[_RING] = _time.monotonic() + 3600.0
    c = FakeGattClient()
    _inject_connect_scan(monkeypatch, c)
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] == 1:
            capture._OXYII_PAUSE.set()                # a pull wants the link mid-hold
        elif calls["n"] >= 3:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    assert c.writes == []                              # never connected: the hold never reached the link
    assert capture._OXYII_HOLD_UNTIL[_RING] > _time.monotonic()   # the hold itself is intact


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
    monkeypatch.setattr(polar_psftp, "PolarPsFtp", lambda *_a, **_k: _FS())
    async def hci(): return "hci0"
    monkeypatch.setattr(capture, "adapter_hci", hci)
    async def _on_air(_a, _b): return True   # presence check is not what this test is about
    monkeypatch.setattr(capture, "_device_on_air", _on_air)
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

    async def no_spare(*a, **k):
        return []                                # P1.5: no healthy spare → the give-up STOP path (1258-60)
    monkeypatch.setattr(capture, "list_adapters", no_spare)
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


def test_host_clock_poller_rolls_the_night_at_midnight(tmp_path, monkeypatch):
    """A session running past midnight must start a fresh CLOCK.csv in the NEW night's folder, not keep
    appending to the folder it opened at boot."""
    import datetime as _dtm
    async def fake_state(): return {"trust": "disciplined", "absolute_ok": True}
    monkeypatch.setattr(capture.host_clock, "read_state", fake_state)
    day = {"n": 0}
    monkeypatch.setattr(capture, "_now",
                        lambda: _dtm.datetime(2026, 7, 18 + day["n"], 23, 30, 0))
    async def fake_sleep(_s):
        day["n"] += 1                      # each poll advances one calendar day → forces a roll
        if day["n"] >= 2:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    _run(capture.host_clock_poller({}, str(tmp_path)))
    nights = {p.parent.name for p in (tmp_path / "captures").rglob("*_CLOCK.csv")}
    assert nights == {"2026-07-18", "2026-07-19"}   # one CSV per night, each in its own folder


# ── rssi_poller: writer-create failure, pause-skip, the device loop, and idle/resume (1416-1458) ───────
def test_rssi_poller_swallows_a_writer_create_error(tmp_path, monkeypatch):
    def boom(path): raise OSError("cannot open link log")
    monkeypatch.setattr(capture, "LinkLogWriter", boom)
    _stop_after(monkeypatch, 1)
    cfg = {"link": {"rssi_enabled": True, "log_enabled": True, "rssi_interval_sec": 25}}
    _run(capture.rssi_poller("hci0", cfg, str(tmp_path)))   # writer stays None; the loop still runs (1416-1417)


def test_rssi_poller_rolls_the_link_at_midnight(tmp_path, monkeypatch):
    """Crossing midnight rolls LINK.csv into the new night's folder — the writer opened at boot must not
    keep appending to the first night's directory forever."""
    import datetime as _dtm
    day = {"n": 0}
    monkeypatch.setattr(capture, "_now",
                        lambda: _dtm.datetime(2026, 7, 18 + day["n"], 23, 45, 0))
    async def fake_sleep(_s):
        day["n"] += 1                      # advance a day AND stop; the body still rolls before exit
        capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    cfg = {"link": {"rssi_enabled": False, "log_enabled": True, "rssi_interval_sec": 25}}
    _run(capture.rssi_poller("hci0", cfg, str(tmp_path)))
    nights = {p.parent.name for p in (tmp_path / "captures").rglob("*_LINK.csv")}
    assert nights == {"2026-07-18", "2026-07-19"}


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


# ── device-runner registry (register_runner / unregister_runner): one runner per BLE link ──────────────
class _FakeTask:
    def __init__(self, done=False): self._done, self.cancelled = done, False
    def done(self): return self._done
    def cancel(self): self.cancelled = True


def test_register_runner_dedupes_a_re_remember_by_address():
    dt, tasks = {}, []
    t1 = _FakeTask()
    capture.register_runner(dt, tasks, "AA", t1)
    assert dt == {"AA": t1} and tasks == [t1]
    t2 = _FakeTask()
    capture.register_runner(dt, tasks, "AA", t2)          # same address again → replace, not duplicate
    assert t1.cancelled and dt == {"AA": t2} and tasks == [t2]


def test_register_runner_leaves_a_finished_incumbent_alone():
    dt, tasks = {}, []
    done = _FakeTask(done=True); dt["AA"] = done; tasks.append(done)
    new = _FakeTask()
    capture.register_runner(dt, tasks, "AA", new)
    assert not done.cancelled and dt["AA"] is new and new in tasks   # nothing live to cancel


def test_register_runner_without_address_tracks_task_only():
    dt, tasks = {}, []
    t = _FakeTask()
    capture.register_runner(dt, tasks, None, t)
    assert tasks == [t] and dt == {}                      # no key to dedupe on, but still shut down


def test_unregister_runner_cancels_and_clears_the_card():
    dt, tasks = {}, []
    t = _FakeTask(); dt["AA"] = t; tasks.append(t)
    sd = {"Ring": {"address": "AA"}, "Other": {"address": "BB"}}
    capture.unregister_runner(dt, tasks, sd, "AA")
    assert t.cancelled and tasks == [] and dt == {} and sd == {"Other": {"address": "BB"}}


def test_unregister_runner_unknown_address_is_a_noop():
    dt, tasks, sd = {}, [], {}
    capture.unregister_runner(dt, tasks, sd, "ZZ")        # nothing registered — must not raise
    assert tasks == [] and dt == {} and sd == {}


def test_main_forget_stops_the_runner(tmp_path, monkeypatch):
    """The forget_device callback main() hands webmon must actually cancel the device's runner and clear
    its status card — otherwise the orphaned task reconnects a device the operator just dropped."""
    import webmon as _wm
    captured = {}

    def fake_make_app(bus, cfg, cfgpath, adapter, status, spawn, **kw):
        captured["forget"] = kw["forget_device"]
        return "APP"

    async def fake_start(app, host, port):
        capture.STATUS["devices"]["Ring"] = {"address": "D1:98:62:7C:92:B3"}
        captured["forget"]("D1:98:62:7C:92:B3")           # forget while the runner task is live
        class _R:
            async def cleanup(self): pass
        return _R()

    monkeypatch.setattr(_wm, "make_app", fake_make_app)
    monkeypatch.setattr(_wm, "start", fake_start)
    cfg = {"root": str(tmp_path), "web": {"enabled": True},
           "devices": [{"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S",
                        "device_id": "S8AW", "address": "D1:98:62:7C:92:B3", "streams": ["spo2"]}]}
    _main_with_cfg(tmp_path, monkeypatch, cfg)
    assert "Ring" not in capture.STATUS["devices"]         # card cleared by the forget path


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
           "power": {"drop_not_worn_sec": 120, "not_worn_recheck_sec": 45, "reconnect_backoff_cap_sec": 240},
           "stream": {"stall_sec": 45},
           "write": {"resume_window_sec": 120},
           "devices": [{"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S",
                        "device_id": "S8AW", "address": "D1:98:62:7C:92:B3", "streams": ["spo2"]}]}
    _main_with_cfg(tmp_path, monkeypatch, cfg)
    assert capture._OXYII_RTC_RESYNC_SEC == 3600
    assert capture._DROP_NOT_WORN_SEC == 120 and capture._NOT_WORN_RECHECK_S == 45
    assert capture._RECONNECT_BACKOFF_CAP_S == 240
    assert capture._STREAM_STALL_S == 45
    assert capture._RESUME_WINDOW_S == 120.0   # CAPTURE-FILESET-RESUME: write.resume_window_sec applies
    ring = next(d for d in capture._CFG["devices"] if d["name"] == "Ring")
    assert "ppg" in ring["streams"], "the implicit 125 Hz pleth was made explicit"
    assert capture.STATUS["host"]["started_at"] and capture.STATUS["host"]["adapter_ok"] is True


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
    async def fake_pull_oxyii(dev, root, which, ftype, **kw): calls["n"] += 1; return {"ok": True}
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


def test_storage_poller_alerts_once_when_disk_is_low(tmp_path, monkeypatch, alert_recorder):
    """A low-free-space episode fires exactly one alert (edge-triggered), even across polls."""
    rec = alert_recorder()
    _stop_after(monkeypatch, 2)                       # two polls; the alert must fire only once
    cfg = {"storage": {"keep_nights": 0, "min_free_gb": 1e9, "poll_sec": 1}}   # always "low"
    _run(capture.storage_poller(cfg, str(tmp_path), rec))
    assert rec.titles == ["Tepna: disk low"]


def test_the_disk_low_alert_states_the_free_space_the_right_way_round(tmp_path, monkeypatch,
                                                                     alert_recorder):
    """THE MESSAGE — which every previous notifier double discarded.

    Found by `tools/find_blindspots.py` (the doubles dropped `message`), then confirmed by mutation:
    swapping `free_gb` and `free_pct` in capture.py's alert body survives the ENTIRE suite — 2851
    passed — so "Only 3 GB free (87%)" for a box at 87 GB and 3% was unobservable. GB and % are not
    interchangeable to the person reading that alert, who is its only audience."""
    monkeypatch.setattr(capture.diskguard, "disk_report",
                        lambda *_a, **_k: {"low": True, "free_gb": 3.5, "free_pct": 87.0})
    rec = alert_recorder()
    _stop_after(monkeypatch, 1)
    _run(capture.storage_poller({"storage": {"keep_nights": 0, "min_free_gb": 1e9, "poll_sec": 1}},
                                str(tmp_path), rec))
    body = rec.messages[0]
    assert "3.5 GB free" in body, f"the GB figure must be the GB figure — got {body!r}"
    assert "(87.0%)" in body, f"the percentage must be the percentage — got {body!r}"


def test_the_disk_low_alert_gives_the_advice_that_would_actually_help(tmp_path, monkeypatch,
                                                                     alert_recorder):
    """capture.py:3243 says a bare "disk low" on a box whose pruning is HELD by a dead backup volume is
    "actively misleading — it reads as 'raise keep_nights', which is the one action that would not
    help". That entire piece of reasoning was carried in the discarded `message`: inverting the held
    sentence AND inverting its no-hold counterpart both survived the suite. Now asserted."""
    monkeypatch.setattr(capture.diskguard, "disk_report",
                        lambda *_a, **_k: {"low": True, "free_gb": 1.0, "free_pct": 2.0})
    rec = alert_recorder()
    _stop_after(monkeypatch, 1)
    _run(capture.storage_poller({"storage": {"keep_nights": 0, "min_free_gb": 1e9, "poll_sec": 1}},
                                str(tmp_path), rec))
    body = rec.messages[0]
    # Nothing is held here, so the advice must be the actionable one — and must not claim a hold.
    assert "free space or raise keep_nights" in body, f"got {body!r}"
    assert "Retention is HELD" not in body, "nothing is held; naming a hold sends the wrong fix"


def test_the_disk_low_alert_names_the_HELD_BACKUP_when_that_is_the_real_cause(tmp_path, monkeypatch,
                                                                             alert_recorder):
    """The other arm, and the one capture.py:3243 actually argues for. When retention is HELD by a dead
    backup volume, telling the operator to raise keep_nights is the one action that cannot help — so
    the alert must name the backup instead. Inverting this sentence survived the whole suite, because
    the arm was never driven AND the message was discarded: two independent reasons it was invisible."""
    monkeypatch.setattr(capture.diskguard, "disk_report",
                        lambda *_a, **_k: {"low": True, "free_gb": 1.0, "free_pct": 2.0})
    monkeypatch.setattr(capture.nightarchive, "unarchived_nights", lambda *_a, **_k: {"2026-01-01"})
    monkeypatch.setattr(capture.nightarchive, "uncovered_subtrees", lambda *_a, **_k: [])
    monkeypatch.setattr(capture.diskguard, "list_nights", lambda *_a, **_k: ["2026-01-01"])
    monkeypatch.setattr(capture.diskguard, "plan_prune", lambda *_a, **_k: ["2026-01-01"])
    monkeypatch.setattr(capture.diskguard, "prune_old_nights", lambda *_a, **_k: [])
    rec = alert_recorder()
    _stop_after(monkeypatch, 1)
    # `archive` is a TOP-LEVEL key, not a member of `storage` (capture.py:3169) — nesting it leaves
    # archive_enabled False, so `blocked` is never computed and the held arm silently cannot fire.
    cfg = {"storage": {"keep_nights": 1, "min_free_gb": 1e9, "poll_sec": 1},
           "archive": {"enabled": True, "dest": "/mnt/backup"}}
    _run(capture.storage_poller(cfg, str(tmp_path), rec))
    body = rec.messages[0]
    assert "Retention is HELD on 1 unmirrored night(s)" in body, f"got {body!r}"
    assert "/mnt/backup" in body, "the alert must name the volume to fix"
    assert "will NOT free space" in body, "raising keep_nights is the one action that cannot help"


def test_storage_poller_swallows_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr(capture.diskguard, "disk_report",
                        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("statvfs boom")))
    _stop_after(monkeypatch, 1)
    _run(capture.storage_poller({"storage": {}}, str(tmp_path)))   # must not raise


def test_alert_poller_fires_on_a_sustained_offline_then_recovers(monkeypatch):
    """A device offline past the threshold alerts once; when it RECORDS again, a recovery alert fires.

    Recovery needs flowing samples, not merely a link — so the device coming back must stamp
    `_LAST_DATA`, exactly as the real stream paths do. Keying this on `connected` alone is what let a
    4.5 h outage report itself recovered four times (see `alerts.device_is_recording`)."""
    sent = []
    class _N:
        # `enabled` and a truthy return are part of Notifier's interface, and the poller now reads
        # BOTH — it latches on the delivery outcome (CAPTURE-HOST-DEEP-AUDIT §C1). A double that
        # omits them is not standing in for the real thing.
        enabled = True
        async def send(self, title, message, **kw): sent.append(title); return True
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 0}, "devices": [_dev(name="H10")]}
    st = {"connected": False}
    capture.STATUS["devices"]["H10"] = st
    capture._LAST_DATA.pop("H10", None)
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] == 2:
            st["connected"] = True               # it comes back on the 2nd poll…
            capture._LAST_DATA["H10"] = 1000.0   # …and, crucially, streams → recovery alert
        if calls["n"] >= 3:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    _run(capture.alert_poller(cfg, _N()))
    capture._LAST_DATA.pop("H10", None)
    assert sent == ["Tepna: sensor offline", "Tepna: sensor recovered"]


def test_alert_poller_does_NOT_call_a_silent_link_recovered(monkeypatch):
    """THE 2026-07-29 REGRESSION GUARD. An unbonded H10 connects for 1–2 s, streams nothing and is torn
    down, over and over. `connected` is TRUE at whichever poll lands inside a connect, so the old poller
    sent four "recovered" notices while not one byte was written after 23:48. A link that produces no
    data must STAY in alarm."""
    sent = []
    class _N:
        enabled = True
        async def send(self, title, message, **kw): sent.append(title); return True
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 0}, "devices": [_dev(name="H10")]}
    st = {"connected": False}
    capture.STATUS["devices"]["H10"] = st
    capture._LAST_DATA.pop("H10", None)          # never streamed this session — the real state that night
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] == 2:
            st["connected"] = True               # linked, but still silent
        if calls["n"] >= 4:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    _run(capture.alert_poller(cfg, _N()))
    assert "Tepna: sensor recovered" not in sent, \
        "a link recording nothing was called recovered — the exact 2026-07-29 false all-clear"
    assert sent == ["Tepna: sensor offline"], "and the outage must still be reported, once"


def test_alert_poller_skips_a_nameless_device_and_a_connected_one(monkeypatch):
    sent = []
    class _N:
        enabled = True
        async def send(self, title, message, **kw): sent.append(title); return True
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


def test_qc_poller_skips_when_the_night_raced_away(tmp_path, monkeypatch):
    """_current_night names a night from the listing, but it can be gone by the stat a line later — skip,
    don't summarise a missing dir."""
    monkeypatch.setattr(capture, "_current_night", lambda *a: "2026-07-19")   # never actually on disk
    _stop_after(monkeypatch, 1)
    _run(capture.qc_poller({"devices": []}, str(tmp_path)))
    assert "qc" not in capture.STATUS


def test_qc_poller_swallows_an_error(tmp_path, monkeypatch):
    import datetime as _dtm
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 23, 0, 0))
    (tmp_path / "captures" / "2026-07-19").mkdir(parents=True)
    monkeypatch.setattr(capture.nightqc, "summarize",
                        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("qc boom")))
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
    # digest_hour: -1 — these tests exercise the MISSING-STREAM ALERT path and assert exact `sent`
    # contents; the unconditional morning digest (own tests in test_capture_coverage_100) would
    # otherwise make them time-of-day dependent: green before 09:00 local, red after.
    return {"qc": {"poll_sec": 1, "alert_after_sec": 3600, "digest_hour": -1},
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
    (cap / "2026-07-18").mkdir(parents=True)                    # a completed night: settled (old writes)
    old = cap / "2026-07-18" / "Polar_H10_1_ECG.txt"; old.write_text("rows\n")
    _os.utime(old, (0, _dtm.datetime(2026, 7, 19).timestamp() - 3600))   # last write well past the settle
    (cap / "2026-07-19").mkdir()                                # tonight — freshly written, still active
    (cap / "2026-07-19" / "Polar_H10_1_ECG.txt").write_text("live\n")
    dest = tmp_path / "backup"; dest.mkdir()                    # operator pre-creates it on the backup disk
    cfg = {"archive": {"enabled": True, "dest": str(dest), "poll_sec": 1}}
    _stop_after(monkeypatch, 1)
    _run(capture.archive_poller(cfg, str(tmp_path)))
    assert (dest / "2026-07-18" / "Polar_H10_1_ECG.txt").exists()
    assert not (dest / "2026-07-19").exists()                   # active night left alone
    assert capture.STATUS["archive"]["last"] == "2026-07-18"
    assert capture.STATUS["archive"]["dest_present"] is True


def test_archive_poller_skips_when_dest_is_not_mounted(tmp_path, monkeypatch):
    """A dest whose backup volume is unmounted must be SKIPPED, never created — blindly makedirs-ing the
    tree would mirror the night onto the boot filesystem and fill it."""
    import datetime as _dtm
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 2, 0, 0))
    cap = tmp_path / "captures"
    (cap / "2026-07-18").mkdir(parents=True)
    f = cap / "2026-07-18" / "Polar_H10_1_ECG.txt"; f.write_text("rows\n")
    _os.utime(f, (0, _dtm.datetime(2026, 7, 19).timestamp() - 3600))
    dest = tmp_path / "gone"                                    # never created → "volume not mounted"
    cfg = {"archive": {"enabled": True, "dest": str(dest), "poll_sec": 1}}
    _stop_after(monkeypatch, 1)
    _run(capture.archive_poller(cfg, str(tmp_path)))
    assert not dest.exists(), "the dest must NOT be created on the boot disk"
    assert capture.STATUS["archive"]["dest_present"] is False


def test_archive_poller_copy_does_not_block_the_event_loop(tmp_path, monkeypatch):
    """A slow/hung destination must not freeze the loop every other task shares.

    archive_night() is a synchronous shutil.copy2 walk (~2 GB / ~1500 files per night). Run inline it
    froze the BLE runners, the stall watchdogs and the sd_notify heartbeat for its whole duration —
    and the unit is Type=notify WatchdogSec=120 (heartbeat at half), so a copy over ~60 s got the
    daemon RESTARTED mid-night. A dest that hangs never returned at all, and the poller's `except`
    cannot catch a blocked syscall. This pins that the copy is off-loop: a concurrent task must still
    get scheduled while archive_night is inside a blocking sleep.
    """
    import datetime as _dtm
    import time as _t
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 2, 0, 0))
    cap = tmp_path / "captures"
    (cap / "2026-07-18").mkdir(parents=True)                    # settled: aged past the settle window
    f18 = cap / "2026-07-18" / "Polar_H10_1_ECG.txt"; f18.write_text("rows\n")
    _os.utime(f18, (0, _dtm.datetime(2026, 7, 19).timestamp() - 3600))
    (tmp_path / "b").mkdir()                                    # dest present (mounted)

    ticks = []

    def slow_archive(captures, night, dest, **kw):
        _t.sleep(0.25)                       # a BLOCKING dest — the whole point
        return 1

    monkeypatch.setattr(capture.nightarchive, "archive_night", slow_archive)

    async def scenario():
        async def ticker():                  # stands in for every other loop task
            for _ in range(10):
                await asyncio.sleep(0.02)
                ticks.append(1)
        cfg = {"archive": {"enabled": True, "dest": str(tmp_path / "b"), "poll_sec": 0.01}}
        t = asyncio.ensure_future(ticker())
        await asyncio.wait_for(capture.archive_poller(cfg, str(tmp_path)), timeout=5)
        t.cancel()

    import asyncio
    capture._STOP.clear()

    async def stopper():
        await asyncio.sleep(0.4)
        capture._STOP.set()

    async def main():
        await asyncio.gather(scenario(), stopper())

    asyncio.run(main())
    capture._STOP.clear()

    # Inline, the 0.25 s copy would have starved the 0.02 s ticker for its whole duration.
    assert len(ticks) >= 5, (
        f"only {len(ticks)} tick(s) ran while archive_night blocked for 0.25 s — the copy is still "
        "on the event loop"
    )


@pytest.mark.parametrize("poller,cfg_key,mod,fn,extra,night", [
    # qc_poller only summarises TONIGHT's dir; storage_poller only prunes OLD ones — so each needs its
    # own fixture night, or the poller hits an early `continue` and the test passes vacuously.
    ("qc_poller", "qc", "nightqc", "summarize", {}, "2026-07-19"),
    ("storage_poller", "storage", "diskguard", "prune_old_nights", {"keep_nights": 1}, "2026-07-18"),
])
def test_pollers_do_their_filesystem_work_off_the_loop(tmp_path, monkeypatch, poller, cfg_key, mod, fn, extra, night):
    """QC's newline count and retention's rmtree are filesystem work, not arithmetic — same rule as
    archive_night. summarize() re-reads the WHOLE growing night every poll_sec (~48 GB across a night
    at the default 600 s); prune_old_nights() rmtree's ~1500 files. Both must stay off the loop, or on
    the target hardware (Pi/N100, too little RAM to cache a night) they stall every capture task."""
    import asyncio as _a
    import datetime as _dtm
    import time as _t
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 2, 0, 0))
    (tmp_path / "captures" / night).mkdir(parents=True)

    def slow(*a, **k):
        _t.sleep(0.25)                                   # blocking storage, the whole point
        # A REALISTIC shape: qc_poller reads summ["night"] downstream, and a stub missing it would be
        # swallowed by the poller's `except` — the test would still pass while exercising half the path.
        return [] if fn == "prune_old_nights" else {"night": night, "ok": True, "devices": [], "missing": [], "files": 0, "total_rows": 0}

    monkeypatch.setattr(getattr(capture, mod), fn, slow)
    ticks = []

    async def main():
        async def ticker():
            for _ in range(10):
                await _a.sleep(0.02)
                ticks.append(1)

        async def stopper():
            await _a.sleep(0.4)
            capture._STOP.set()

        cfg = {cfg_key: {"enabled": True, "poll_sec": 0.01, **extra}, "devices": []}
        t = _a.ensure_future(ticker())
        await _a.gather(getattr(capture, poller)(cfg, str(tmp_path)), stopper())
        t.cancel()

    capture._STOP.clear()
    _a.run(main())
    capture._STOP.clear()
    assert len(ticks) >= 5, f"{poller}: only {len(ticks)} tick(s) ran while {fn} blocked — still on the loop"


def test_archive_poller_swallows_an_error(tmp_path, monkeypatch):
    import datetime as _dtm
    monkeypatch.setattr(capture, "_now", lambda: _dtm.datetime(2026, 7, 19, 2, 0, 0))
    monkeypatch.setattr(capture.nightarchive, "pending_nights",
                        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("archive boom")))
    (tmp_path / "b").mkdir()                                    # dest present → past the mount guard
    cfg = {"archive": {"enabled": True, "dest": str(tmp_path / "b"), "poll_sec": 1}}
    _stop_after(monkeypatch, 1)
    _run(capture.archive_poller(cfg, str(tmp_path)))            # must not raise


# ── BLE robustness: bounded awaits, task supervision, and the stall watchdog ────────────────────────
# Every test below pins a failure mode that leaves the daemon RUNNING while it captures nothing — the
# class that costs an unrecoverable night, because nothing crashes and systemd's Restart never fires.


def test_connect_timeout_disconnects_the_half_open_link(monkeypatch):
    """A wedged BlueZ never answers connect(). Unbounded, that holds the process-global _CONNECT_LOCK
    forever and every other device task queues behind it for the night. It must time out AND tear the
    half-open link down rather than leaking it."""
    import bleak
    events = []
    class _BC:
        def __init__(self, addr, **kw): pass
        async def connect(self): await asyncio.sleep(3600)      # never returns — the wedge
        async def disconnect(self): events.append("disconnect")
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)
    monkeypatch.setattr(capture, "_BLE_CONNECT_TIMEOUT_S", 0.01)

    async def go():
        with pytest.raises(asyncio.TimeoutError):
            async with capture._connect("AA"):
                pass                                            # pragma: no cover — connect never yields
    _run(go())
    assert events == ["disconnect"]
    assert not capture._CONNECT_LOCK.locked()                   # released, so other devices can proceed


def test_connect_scan_timeout_disconnects_the_half_open_link(monkeypatch):
    """_connect_scan (the O2Ring path) carries the same bound as _connect."""
    import bleak
    events = []
    class _BC:
        def __init__(self, dev, **kw): pass
        async def connect(self): await asyncio.sleep(3600)
        async def disconnect(self): events.append("disconnect")
    async def find(*a, **k): return object()
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    monkeypatch.setattr(bleak.BleakScanner, "find_device_by_filter", staticmethod(find))
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)
    monkeypatch.setattr(capture, "_BLE_CONNECT_TIMEOUT_S", 0.01)

    async def go():
        with pytest.raises(asyncio.TimeoutError):
            async with capture._connect_scan("AA"):
                pass                                            # pragma: no cover — connect never yields
    _run(go())
    assert events == ["disconnect"]


def test_safe_disconnect_swallows_a_hanging_disconnect(monkeypatch):
    """Teardown runs against the same wedged stack that caused the failure, so a disconnect that never
    returns must be abandoned — otherwise the timeout that saved us becomes a second deadlock."""
    class _C:
        async def disconnect(self): await asyncio.sleep(3600)
    monkeypatch.setattr(capture, "_BLE_DISCONNECT_TIMEOUT_S", 0.01)
    _run(capture._safe_disconnect(_C()))                        # returns, does not raise


def test_run_polar_forces_stop_and_restart_on_already_streaming(tmp_path, monkeypatch):
    """THE 2026-07-19 BUG. `already_streaming` (0x06) is what a stream still owned by a DEAD subscriber
    answers — the H10 serves one PMD stream and does not free it when a client dies without a clean
    disconnect. is_started() rightly calls that live, so the old code registered the stream and held a
    healthy link over zero rows. Now it forces a STOP and re-STARTs, demanding OUR stream."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_ecg_frame()], start_status=0x06)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    stops = [w for w in c.writes if w and w[0] == 0x03]         # _OP_STOP
    starts = [w for w in c.writes if w and w[0] == 0x02]        # _OP_START
    # One unconditional STOP before negotiation, plus the forced one the already_streaming ACK triggers,
    # and a second START demanding the stream back for THIS subscriber.
    assert len(stops) >= 2 and len(starts) >= 2, f"no forced STOP+re-START: {c.writes!r}"


def test_run_polar_ctrl_write_failure_is_not_a_rejection(tmp_path, monkeypatch):
    """A control-point WRITE that raises (or hangs past its bound) yields no verdict — NO_ACK, not a
    rejected stream."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_ecg_frame()], start_status=0x00)
    async def boom(*a, **k): raise RuntimeError("dbus wedged")
    c.write_gatt_char = boom
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    err = (capture.STATUS["devices"]["H10"].get("last_error") or "").lower()
    assert "unacknowledged" in err and "rejected" not in err


def test_run_polar_stall_watchdog_drops_a_silent_session(tmp_path, monkeypatch):
    """A started stream that delivers NOTHING behind a live link is the silent-night failure. The hold
    loop used to run on client.is_connected alone, so it had no reason to ever end. Now the session is
    torn down so the reconnect re-negotiates against a device that has just freed the stream."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[], start_status=0x00)      # ACKed, then total silence
    _inject_connect(monkeypatch, c)
    # The patched sleep does not advance the wall clock, so drive monotonic() forward by hand. This
    # exercises the REAL 90 s default rather than a shrunk-to-nothing grace.
    clock = {"t": 0.0}
    def fake_monotonic():
        clock["t"] += 50.0
        return clock["t"]
    monkeypatch.setattr(capture._time, "monotonic", fake_monotonic)
    _stop_after(monkeypatch, 6)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    # The session was torn down and a SECOND negotiation ran — which is the whole point: the reconnect
    # is what makes the device free the stream. (last_error is deliberately not asserted here: the new
    # session clears it on entry, so it says nothing about whether the watchdog fired.)
    starts = [w for w in c.writes if w and w[0] == 0x02]        # _OP_START
    assert len(starts) >= 2, f"stall did not force a re-negotiation: {c.writes!r}"


def test_stream_is_stalled_is_pure():
    """Off when disabled, off before anything started, off inside the grace, on past it."""
    assert capture.stream_is_stalled(0.0, 100.0, 0) is False        # feature off
    assert capture.stream_is_stalled(None, 100.0, 90) is False      # nothing started yet
    assert capture.stream_is_stalled(50.0, 100.0, 90) is False      # still inside the grace
    assert capture.stream_is_stalled(0.0, 100.0, 90) is True


def test_keep_running_restarts_a_crashing_task(monkeypatch):
    """A background task that raises must not retire silently — main() never gathers until shutdown, so
    the traceback is not even retrieved and the box loses that capability for the night."""
    calls = {"n": 0}
    async def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")
        capture._STOP.set()
    seen = []
    async def go():
        await capture.keep_running(flaky, "flaky", on_error=seen.append)
    _real_sleep = asyncio.sleep                      # capture BEFORE patching — the lambda would recurse
    monkeypatch.setattr(capture.asyncio, "sleep", lambda _s: _real_sleep(0))
    _run(go())
    assert calls["n"] == 2 and seen and "boom" in seen[0]


def test_keep_running_returns_on_a_clean_exit():
    """A plain return means _STOP was observed — nothing to restart."""
    calls = {"n": 0}
    async def once():
        calls["n"] += 1
    _run(capture.keep_running(once, "once"))
    assert calls["n"] == 1


def test_supervise_surfaces_a_runner_crash_on_the_device_card(monkeypatch):
    """A crashed runner has to show up where the operator looks — the device's monitor card — and push an
    alert, because a device dying at 02:00 is otherwise invisible until morning."""
    sent = []
    class _N:
        async def send(self, title, body): sent.append((title, body))
    async def boom(_dev, _root):
        capture._STOP.set()
        raise OSError("read-only filesystem")
    _real_sleep = asyncio.sleep                      # capture BEFORE patching — the lambda would recurse
    monkeypatch.setattr(capture.asyncio, "sleep", lambda _s: _real_sleep(0))
    _run(capture.supervise(boom, _dev(name="H10"), "/tmp", _N()))
    assert "runner crashed" in capture.STATUS["devices"]["H10"]["last_error"]
    assert sent and "H10 runner" in sent[0][0]


def test_pull_oxyii_session_is_bounded(tmp_path, monkeypatch):
    """The sibling of polar_offline_op inherited neither its timeout nor its connect lock. A ring carried
    out of range mid-transfer left _OXYII_PAUSE SET for the night — and adapter_watchdog, clock_watchdog
    and rssi_poller all skip while it is set, so the wedge disabled the ladder that recovers from it."""
    import pull_session
    async def never(*a, **k): await asyncio.sleep(3600)
    monkeypatch.setattr(pull_session, "pull", never)
    async def hci(): return None
    monkeypatch.setattr(capture, "adapter_hci", hci)
    monkeypatch.setattr(capture, "_OFFLINE_OP_TIMEOUT_S", 0.01)
    dev = {"name": "Ring", "address": "AA", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S1"}

    async def go():
        with pytest.raises(asyncio.TimeoutError):
            await capture.pull_oxyii_session(dev, str(tmp_path))
    _run(go())
    assert not capture._OXYII_PAUSE.is_set()        # resumed — the night is not lost
    assert not capture._CONNECT_LOCK.locked()       # and the radio is free for everyone else


def test_run_polar_silent_control_point_is_not_a_rejection(tmp_path, monkeypatch):
    """The device ACCEPTS the control WRITE but never sends the indication — a real BlueZ behaviour
    (notifications sharing a connection interval get dropped). The write path succeeds, so this exercises
    the indication timeout specifically, and it must still read as NO_ACK rather than a rejection."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[], start_status=0x00)
    async def silent_write(uuid, cmd, response=False):
        c.writes.append(bytes(cmd))                       # accepted, but no ctrl callback is ever invoked
    c.write_gatt_char = silent_write
    _inject_connect(monkeypatch, c)
    monkeypatch.setattr(capture, "_PMD_CTRL_TIMEOUT_S", 0.01)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    err = (capture.STATUS["devices"]["H10"].get("last_error") or "").lower()
    assert "unacknowledged" in err and "rejected" not in err


def test_run_polar_stall_baseline_resets_when_rows_advance(tmp_path, monkeypatch):
    """A stream that IS delivering must never be torn down. Rows advancing mid-hold-loop re-baselines the
    silence clock, so a healthy session survives indefinitely."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[], start_status=0x00)
    _inject_connect(monkeypatch, c)
    clock = {"t": 0.0}
    monkeypatch.setattr(capture._time, "monotonic", lambda: clock.__setitem__("t", clock["t"] + 50.0) or clock["t"])
    # Feed a frame on every hold tick, so rows keep advancing past what would otherwise be the grace.
    calls = {"n": 0}
    async def feeding_sleep(_secs):
        calls["n"] += 1
        cb = c.cbs.get(pmd.PMD_DATA.uuid if hasattr(pmd.PMD_DATA, "uuid") else pmd.PMD_DATA)
        if cb:
            cb(0, bytearray(_ecg_frame()))
        if calls["n"] >= 5:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", feeding_sleep)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    starts = [w for w in c.writes if w and w[0] == 0x02]
    assert len(starts) == 1, f"a delivering stream was torn down: {c.writes!r}"


def test_keep_running_backoff_doubles_between_crashes(monkeypatch):
    """Repeated crashes back off instead of hot-looping — a task that cannot start must not spin the CPU
    all night."""
    delays = []
    calls = {"n": 0}
    async def always_boom():
        calls["n"] += 1
        if calls["n"] >= 3:
            capture._STOP.set()
            return
        raise RuntimeError("boom")
    _real_sleep = asyncio.sleep
    async def rec_sleep(secs):
        delays.append(secs)
        await _real_sleep(0)
    monkeypatch.setattr(capture.asyncio, "sleep", rec_sleep)
    _run(capture.keep_running(always_boom, "boomy"))
    assert delays == [5, 10], f"expected a doubling backoff, got {delays}"


def test_clock_resync_reason_is_pure():
    """A jump always wins; a steady offset is chased only until proven uncorrectable; in-tolerance is
    left alone entirely."""
    R = capture.clock_resync_reason
    assert R(0.5, 0.4, 30, 2.0) is None                     # steady and in tolerance
    assert R(120.0, 0.0, 30, 2.0) == "jump"                 # moved by >= jump
    assert R(10.0, 10.0, 30, 2.0) == "adrift"               # steady but out of tolerance
    assert R(10.0, 10.0, 30, 2.0, failed_adrift=3) is None  # already proven unfixable -> stop
    # ...but a device we gave up on still gets corrected when its clock actually MOVES.
    assert R(120.0, 0.0, 30, 2.0, failed_adrift=99) == "jump"


def test_clock_watchdog_stops_chasing_an_uncorrectable_offset(monkeypatch):
    """THE ~15%-OF-THE-NIGHT BUG. The Verity stamps PMD samples ~4 h ahead and re-syncing does not move
    it, but `adrift` fired on absolute skew and the post-sync re-baseline erased the memory of trying —
    so it re-synced every drift_check_sec forever, each attempt pausing capture and holding the connect
    lock. It must give up, exactly once, and say so."""
    syncs = []
    async def fake_sync(addr):
        syncs.append(addr)                                   # never moves the skew — the real behaviour
    monkeypatch.setattr(capture, "sync_device_time", fake_sync)
    capture.STATUS["devices"]["Verity"] = {"connected": True, "clock_skew_sec": 14400.0}
    cfg = {"time": {"drift_check_sec": 1, "resync_jump_sec": 30},
           "devices": [{"name": "Verity", "vendor": "Polar", "address": "AA"}]}
    _stop_after(monkeypatch, 12)                             # ~12 drift-check cycles
    _run(capture.clock_watchdog(cfg))
    assert len(syncs) == capture.CLOCK_ADRIFT_GIVEUP, \
        f"expected exactly {capture.CLOCK_ADRIFT_GIVEUP} attempts, got {len(syncs)}"
    assert capture.STATUS["devices"]["Verity"].get("clock_uncorrectable") is True


def test_clock_watchdog_still_resyncs_a_real_jump_after_giving_up(monkeypatch):
    """Giving up on a steady offset must not blind the watchdog to a clock that genuinely MOVES — an H10
    dropping to its 2019 firmware default mid-night is still a real fault worth correcting."""
    syncs = []
    skews = iter([14400.0] * 8 + [0.0, 3600.0] + [3600.0] * 20)
    async def fake_sync(addr):
        syncs.append(addr)
    monkeypatch.setattr(capture, "sync_device_time", fake_sync)
    cfg = {"time": {"drift_check_sec": 1, "resync_jump_sec": 30},
           "devices": [{"name": "Verity", "vendor": "Polar", "address": "AA"}]}
    calls = {"n": 0}
    async def stepping_sleep(_s):
        calls["n"] += 1
        capture.STATUS["devices"]["Verity"] = {"connected": True, "clock_skew_sec": next(skews, 3600.0)}
        if calls["n"] >= 14:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", stepping_sleep)
    _run(capture.clock_watchdog(cfg))
    # 3 adrift attempts, then it gives up — and then the skew MOVES, which must trigger again.
    assert len(syncs) > capture.CLOCK_ADRIFT_GIVEUP, f"a real jump was ignored: {len(syncs)} syncs"


def test_run_oxyii_stall_watchdog_drops_a_frameless_link(tmp_path, monkeypatch):
    """A ring that holds its link but decodes NO frames — auth or setup never accepted, every frame
    failing CRC, a handler raising inside bleak's dispatch — used to sit there until dawn with
    `connected: True` and an empty file. The Polar path got a stall guard; the ring did not."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()                                   # on_live stays None → never answers
    _inject_connect_scan(monkeypatch, c)
    clock = {"t": 0.0}
    monkeypatch.setattr(capture._time, "monotonic",
                        lambda: clock.__setitem__("t", clock["t"] + 50.0) or clock["t"])
    _stop_after(monkeypatch, 8)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    assert "no frames" in (capture.STATUS["devices"]["Ring"].get("last_error") or "").lower()


def test_run_oxyii_unworn_ring_is_not_torn_down(tmp_path, monkeypatch):
    """CRITICAL COUNTER-CASE. Vitals stop the instant the ring leaves the finger (spo2 → None) while the
    link and the frames carry on. Guarding on ROWS would drop a healthy link every time it was taken off;
    the guard watches decoded FRAMES precisely so an unworn ring is left alone."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    # Worn=False, spo2 absent → no SpO2 rows are written, but frames keep decoding.
    c.on_live = lambda data: (c.notify(0, _o2ring_live_reply(spo2=0, worn=False))
                              if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    clock = {"t": 0.0}
    monkeypatch.setattr(capture._time, "monotonic",
                        lambda: clock.__setitem__("t", clock["t"] + 50.0) or clock["t"])
    _stop_after(monkeypatch, 8)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    err = (capture.STATUS["devices"]["Ring"].get("last_error") or "").lower()
    assert "no frames" not in err, "an unworn but healthy ring was torn down"


def test_run_oxyii_poll_write_failure_drops_the_link(tmp_path, monkeypatch):
    """The live-frame write is the only thing that makes the ring emit data. Unbounded, a wedged stack
    parks the runner here forever with writers open and the monitor showing `connected`."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    calls = {"n": 0}
    async def flaky_write(char, data, response=False):
        calls["n"] += 1
        if calls["n"] > 3:                                 # let auth/setup/RTC through, then wedge
            raise RuntimeError("dbus wedged")
        c.writes.append(bytes(data))
    c.write_gatt_char = flaky_write
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 6)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    assert calls["n"] >= 4                                 # it tried, failed, and broke out


def test_run_oxyii_discards_header_only_files(tmp_path, monkeypatch):
    """A session that ends without data must not leave a header-only file behind — it is
    indistinguishable from a real capture until opened, and the Dex ingest walks this directory."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()                                   # never answers → zero rows
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    assert not list((tmp_path / "captures").rglob("*_SPO2.csv")), "header-only file was left behind"


def test_run_oxyii_header_only_remove_error_is_swallowed(tmp_path, monkeypatch):
    """Tidying up must never take capture down: an os.remove that fails is skipped, not fatal."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    _inject_connect_scan(monkeypatch, c)
    def boom_remove(_p):
        raise OSError("cannot remove")
    monkeypatch.setattr(capture.os, "remove", boom_remove)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))        # must not raise
    assert capture.STATUS["devices"]["Ring"]["connected"] is True


def _viatom_dev():
    return _o2dev(name="Ring", protocol="legacy")


def test_run_viatom_idles_during_adapter_recovery(tmp_path, monkeypatch):
    """This loop was the ONLY one that ignored _RECOVER: it kept hammering connects at a radio the
    watchdog was powering off, and could hold the global connect lock when the power-off landed."""
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    capture._RECOVER.set()
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= 2:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    _inject_connect(monkeypatch, FakeGattClient())          # must never be reached
    _run(capture.run_viatom(_viatom_dev(), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"]["last_error"] == "adapter recovering"


def test_run_viatom_idles_during_a_stored_pull(tmp_path, monkeypatch):
    """_OXYII_PAUSE means something else owns the ring's single link."""
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    capture._OXYII_PAUSE.set()
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= 2:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    _inject_connect(monkeypatch, FakeGattClient())
    _run(capture.run_viatom(_viatom_dev(), str(tmp_path)))
    assert "pulling stored session" in capture.STATUS["devices"]["Ring"]["last_error"]
    capture._OXYII_PAUSE.clear()


def test_run_viatom_warns_when_no_write_characteristic(tmp_path, monkeypatch, caplog):
    """notify_char has a documented-UUID fallback; write_char has none. A model that puts its control
    point elsewhere never gets START_CMD and then never streams — with a live link and no error."""
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = FakeGattClient()
    class _NotifyOnlyService:                                # notify discoverable, write char absent
        uuid = viatom.VIATOM_SERVICE
        def __init__(self):
            n = _Char(viatom.VIATOM_NOTIFY); n.properties = ["notify"]
            self.characteristics = [n]
    c.services = [_NotifyOnlyService()]
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    with caplog.at_level("WARNING"):
        _run(capture.run_viatom(_viatom_dev(), str(tmp_path)))
    assert any("no writable characteristic" in r.message for r in caplog.records)


def test_run_viatom_stall_watchdog_drops_a_silent_link(tmp_path, monkeypatch):
    """Connected, subscribed, and no rows — the silent-night shape, now ended rather than ridden out."""
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = FakeGattClient(); c.services = [_ViatomService()]   # no on_live → never sends a packet
    _inject_connect(monkeypatch, c)
    clock = {"t": 0.0}
    monkeypatch.setattr(capture._time, "monotonic",
                        lambda: clock.__setitem__("t", clock["t"] + 50.0) or clock["t"])
    _stop_after(monkeypatch, 6)
    _run(capture.run_viatom(_viatom_dev(), str(tmp_path)))
    assert "no data" in (capture.STATUS["devices"]["Ring"].get("last_error") or "").lower()


def test_run_viatom_discards_header_only_files(tmp_path, monkeypatch):
    """A session with no rows must not leave a header-only CSV for the Dex ingest to pick up."""
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = FakeGattClient(); c.services = [_ViatomService()]
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_viatom(_viatom_dev(), str(tmp_path)))
    assert not list((tmp_path / "captures").rglob("*_SPO2.csv"))


def test_run_viatom_header_only_remove_error_is_swallowed(tmp_path, monkeypatch):
    """Tidying up must never take capture down."""
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = FakeGattClient(); c.services = [_ViatomService()]
    _inject_connect(monkeypatch, c)
    def boom_remove(_p):
        raise OSError("cannot remove")
    monkeypatch.setattr(capture.os, "remove", boom_remove)
    _stop_after(monkeypatch, 1)
    _run(capture.run_viatom(_viatom_dev(), str(tmp_path)))  # must not raise


def test_run_viatom_stall_baseline_resets_when_rows_advance(tmp_path, monkeypatch):
    """A ring that IS delivering must never be torn down by the stall guard."""
    async def bonded(*a, **k): return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = FakeGattClient(); c.services = [_ViatomService()]
    _inject_connect(monkeypatch, c)
    clock = {"t": 0.0}
    monkeypatch.setattr(capture._time, "monotonic",
                        lambda: clock.__setitem__("t", clock["t"] + 50.0) or clock["t"])
    calls = {"n": 0}
    async def feeding_sleep(_s):                       # a packet on every hold tick
        calls["n"] += 1
        if c.notify:
            c.notify(0, bytearray(_viatom_packet()))
        if calls["n"] >= 5:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", feeding_sleep)
    _run(capture.run_viatom(_viatom_dev(), str(tmp_path)))
    err = (capture.STATUS["devices"]["Ring"].get("last_error") or "").lower()
    assert "no data" not in err, "a delivering ring was torn down"


def test_connect_timeout_error_says_what_it_means(monkeypatch):
    """`asyncio.wait_for` raises a BARE TimeoutError(), which lands in `last_error` saying nothing — where
    the unbounded code it replaced surfaced 'was not found', i.e. "your strap is off". Observed
    2026-07-20 05:07 as `Polar H10 link error: TimeoutError()`. Keep the bound, restore the meaning —
    and keep the class name so transient_ble_error() still matches on repr()."""
    import bleak
    class _BC:
        def __init__(self, addr, **kw): pass
        async def connect(self): await asyncio.sleep(3600)
        async def disconnect(self): pass
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)
    monkeypatch.setattr(capture, "_BLE_CONNECT_TIMEOUT_S", 0.01)

    async def go():
        with pytest.raises(TimeoutError) as ei:
            async with capture._connect("24:AC:AC:02:84:96"):
                pass                                       # pragma: no cover — connect never yields
        return ei.value
    err = _run(go())
    assert "24:AC:AC:02:84:96" in str(err) and "out of range" in str(err)
    assert capture.transient_ble_error(err), "must still classify as retryable, not a hard failure"


def test_connect_non_timeout_failure_also_tears_down(monkeypatch):
    """A connect that FAILS (rather than hangs) must still not leak a half-open link, and its own error
    must propagate untouched — only the bare-timeout case gets re-worded."""
    import bleak
    events = []
    class _BC:
        def __init__(self, addr, **kw): pass
        async def connect(self): raise RuntimeError("le-connection-abort-by-local")
        async def disconnect(self): events.append("disconnect")
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)

    async def go():
        with pytest.raises(RuntimeError, match="abort-by-local"):
            async with capture._connect("AA"):
                pass                                       # pragma: no cover — connect never yields
    _run(go())
    assert events == ["disconnect"]


def test_connect_scan_non_timeout_failure_also_tears_down(monkeypatch):
    """_connect_scan carries the same teardown guarantee as _connect."""
    import bleak
    events = []
    class _BC:
        def __init__(self, dev, **kw): pass
        async def connect(self): raise RuntimeError("le-connection-abort-by-local")
        async def disconnect(self): events.append("disconnect")
    async def find(*a, **k): return object()
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    monkeypatch.setattr(bleak.BleakScanner, "find_device_by_filter", staticmethod(find))
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)

    async def go():
        with pytest.raises(RuntimeError, match="abort-by-local"):
            async with capture._connect_scan("AA"):
                pass                                       # pragma: no cover — connect never yields
    _run(go())
    assert events == ["disconnect"]


def test_connect_scan_timeout_error_says_what_it_means(monkeypatch):
    """The ring path carries the same restored message."""
    import bleak
    class _BC:
        def __init__(self, dev, **kw): pass
        async def connect(self): await asyncio.sleep(3600)
        async def disconnect(self): pass
    async def find(*a, **k): return object()
    monkeypatch.setattr(bleak, "BleakClient", _BC)
    monkeypatch.setattr(bleak.BleakScanner, "find_device_by_filter", staticmethod(find))
    async def no_kw(): return {}
    monkeypatch.setattr(capture, "adapter_kw", no_kw)
    monkeypatch.setattr(capture, "_BLE_CONNECT_TIMEOUT_S", 0.01)

    async def go():
        with pytest.raises(TimeoutError) as ei:
            async with capture._connect_scan("D1:98:62:7C:92:B3"):
                pass                                       # pragma: no cover — connect never yields
        return ei.value
    err = _run(go())
    assert "D1:98:62:7C:92:B3" in str(err) and "out of range" in str(err)


# ── shutdown must terminate, and must name what refused to stop ─────────────────────────────────────
def _main_cfg(tmp_path, monkeypatch):
    """main() wired with every runner/poller stubbed out — the shared setup for the shutdown tests."""
    import yaml as _yaml, sys as _sys
    cfg = {"root": str(tmp_path), "web": {"enabled": True, "host": "127.0.0.1", "port": 0},
           "devices": []}
    cfgp = tmp_path / "config.yaml"
    cfgp.write_text(_yaml.safe_dump(cfg))
    for r in ("status_loop", "adapter_watchdog", "rssi_poller", "clock_watchdog", "host_clock_poller",
              "storage_poller", "alert_poller", "qc_poller", "archive_poller", "sd_watchdog"):
        async def _n(*a, **k): return None
        monkeypatch.setattr(capture, r, _n)
    monkeypatch.setattr(_sys, "argv", ["capture.py", "--config", str(cfgp)])
    capture._STOP.clear()
    return cfgp


def test_shutdown_abandons_a_web_server_that_will_not_close(tmp_path, monkeypatch, caplog):
    """MEASURED 2026-07-20: SIGTERM left the daemon alive past 101 s. `AppRunner.cleanup()` waits for
    in-flight requests, and the monitor's SSE stream is one that never ends on its own — so an open
    browser tab blocked the restart. Under systemd that is a hang to TimeoutStopSec then a SIGKILL
    mid-write. Bound it, name it, and carry on."""
    _main_cfg(tmp_path, monkeypatch)
    import webmon
    class _Runner:
        async def cleanup(self): await asyncio.sleep(3600)     # the browser tab that never goes away
    async def fake_start(app, host, port):
        capture._STOP.set()
        return _Runner()
    monkeypatch.setattr(webmon, "start", fake_start)
    monkeypatch.setattr(capture, "_SHUTDOWN_PHASE_S", 0.05)
    with caplog.at_level("ERROR"):
        _run(capture.main())
    assert any("web server did not close" in r.message for r in caplog.records)


def test_shutdown_names_a_task_that_ignores_cancellation(tmp_path, monkeypatch, caplog):
    """A task that swallows CancelledError used to hang `gather()` forever with nothing in the log. Now
    it is abandoned after a bounded wait and NAMED, so the operator knows which one to look at."""
    _main_cfg(tmp_path, monkeypatch)
    async def stubborn(*a, **k):
        seen = {"n": 0}
        while True:
            try:
                await asyncio.sleep(0.01)
            except asyncio.CancelledError:
                seen["n"] += 1
                if seen["n"] >= 2:               # yield on the second ask so asyncio.run() can finish
                    raise
    monkeypatch.setattr(capture, "status_loop", stubborn)
    import webmon
    class _Runner:
        async def cleanup(self): pass
    async def fake_start(app, host, port):
        # Yield first: `_STOP.wait()` on an ALREADY-set event returns without suspending, so main would
        # cancel the background tasks before they had ever run — and a task that never started cannot
        # demonstrate ignoring cancellation.
        await asyncio.sleep(0.05)
        capture._STOP.set()
        return _Runner()
    monkeypatch.setattr(webmon, "start", fake_start)
    monkeypatch.setattr(capture, "_SHUTDOWN_PHASE_S", 0.05)
    with caplog.at_level("ERROR"):
        _run(capture.main())
    msgs = [r.getMessage() for r in caplog.records]
    assert any("ignored cancellation" in m and "status_loop" in m for m in msgs), msgs


def test_run_muse_kills_a_child_that_ignores_terminate(tmp_path, monkeypatch):
    """On shutdown the child MUST be reaped. CancelledError is a BaseException, so the old `except`
    clauses never ran and terminate() was skipped entirely — leaving muselsl alive holding the Muse's
    BLE link, so the NEXT daemon start could not connect. A child that also ignores SIGTERM gets killed
    rather than left owning the radio."""
    events = []
    class _Stubborn:
        def __init__(self): self.returncode = None
        async def wait(self):
            await asyncio.sleep(0)
            return None                                  # never exits on its own
        def terminate(self): events.append("terminate")  # ...and ignores SIGTERM
        def kill(self): events.append("kill"); self.returncode = -9
    async def fake_exec(*cmd, **k): return _Stubborn()
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", fake_exec)
    _real_wait_for = asyncio.wait_for
    async def fast_wait_for(coro, timeout):              # don't really wait 5 s in a unit test
        return await _real_wait_for(coro, 0.05)
    monkeypatch.setattr(capture.asyncio, "wait_for", fast_wait_for)
    _stop_after(monkeypatch, 1)
    _run(capture.run_muse(_dev(vendor="Muse", model="S", muse_tool="muselsl"), str(tmp_path)))
    assert events == ["terminate", "kill"], events


def test_run_muse_reports_a_child_that_exits_with_an_error(tmp_path, monkeypatch):
    """A tool that dies on the first line — device off, bad address, no LSL stream — used to leave a
    GREEN card all night while the loop respawned it every 5 s, and alert_poller keys on `connected`,
    so nothing ever fired."""
    async def fake_exec(*cmd, **k): return _FakeProc(rc=2)
    monkeypatch.setattr(capture.asyncio, "create_subprocess_exec", fake_exec)
    _stop_after(monkeypatch, 1)
    _run(capture.run_muse(_dev(name="Muse", vendor="Muse", model="S", muse_tool="muselsl"),
                          str(tmp_path)))
    st = capture.STATUS["devices"]["Muse"]
    assert st["connected"] is False and "exited with code 2" in st["last_error"]


# ── E5 · reconnect-edge counter (LINK.csv can't miss a dropout the 25 s poll sampled over) ──────────
def test_set_counts_a_reconnect_edge_the_poller_would_miss():
    """A drop+reconnect BETWEEN two 25 s LINK samples reads connected=1 at both ends, so the sidecar used
    to under-count dropouts. _set counts the False→True edge at the source, so the reconnect count moves
    even when no poll observed the drop."""
    capture.STATUS.clear(); capture.STATUS["devices"] = {}
    capture._LINK_EPOCH.clear()
    capture._set("Ring", connected=True, address="AA")         # first connect
    assert capture.STATUS["devices"]["Ring"]["link_epoch"] == 1
    capture._set("Ring", connected=False)                      # a drop the poller never sampled...
    capture._set("Ring", connected=True)                       # ...and the reconnect
    assert capture.STATUS["devices"]["Ring"]["link_epoch"] == 2, "the missed dropout is still counted"
    capture._set("Ring", spo2=97)                              # a non-connection update must not bump it
    assert capture.STATUS["devices"]["Ring"]["link_epoch"] == 2
    capture._set("Ring", connected=True)                       # already connected — no new edge
    assert capture.STATUS["devices"]["Ring"]["link_epoch"] == 2


def test_link_epoch_reaches_the_sidecar(tmp_path, monkeypatch):
    """rssi_poller writes the per-device reconnect count into LINK.csv."""
    capture.STATUS.clear(); capture.STATUS["devices"] = {}
    capture._LINK_EPOCH.clear()
    capture._set("Ring", connected=True, address="AA")
    cfg = {"link": {"rssi_enabled": False, "rssi_interval_sec": 1},
           "devices": [{"name": "Ring", "address": "AA"}]}
    _stop_after(monkeypatch, 1)
    _run(capture.rssi_poller(None, cfg, str(tmp_path)))
    link = list((tmp_path / "captures").rglob("*_LINK.csv"))[0].read_text().splitlines()
    assert link[0].endswith("link_epoch;address")   # address appended 2026-07-26, link_epoch unmoved
    assert link[1].split(";")[7] == "1", "the reconnect count is in the sidecar"
    assert link[1].split(";")[8] == "AA", "the address travels with it — a rename must not split history"


# ── E3 · O2Ring reconnect backoff only resets on a VIABLE session (data flowing), not on bare connect ─
def test_run_oxyii_backoff_grows_when_connect_then_drops_without_data(tmp_path, monkeypatch):
    """THE E3 FIX. A ring that connects then drops during discovery (never sends a frame) must BACK OFF,
    not reset to 5 s and hammer every ~21 s. With no data, backoff climbs 5→10→…"""
    from bleak.exc import BleakError
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    monkeypatch.setattr(capture, "_RETRY_JITTER", 0.0)   # the SCHEDULE is under test, not the jitter
    slept = []
    class _DropClient(FakeGattClient):
        async def start_notify(self, _c, cb):            # connect ok, but drop before any data
            raise BleakError("failed to discover services, device disconnected")
    c = _DropClient()
    _inject_connect_scan(monkeypatch, c)
    _real = asyncio.sleep
    async def rec_sleep(s):
        slept.append(s)
        if len(slept) >= 3:
            capture._STOP.set()
        await _real(0)
    monkeypatch.setattr(capture.asyncio, "sleep", rec_sleep)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    # the reconnect-backoff sleeps (5, then 10) — growing, because no session was ever viable
    backoffs = [s for s in slept if s in (5, 10, 20, 40, 60)]
    assert backoffs[:2] == [5, 10], f"backoff did not grow on connect-then-drop: {slept}"


def test_run_oxyii_backoff_resets_once_data_flows(tmp_path, monkeypatch):
    """A ring that actually streams is viable — its backoff resets to 5 so a later drop recovers fast."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture.STATUS.clear(); capture.STATUS["devices"] = {}
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _o2ring_live_reply()) if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    # let it connect, stream a couple of replies, then stop — never entering the backoff path
    _stop_after(monkeypatch, 5)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"].get("spo2") == 96   # data flowed → the viable path ran


# ── autopull_poller — auto-pull the O2Ring onboard .dat (belt-and-suspenders for a lossy live link) ──
def test_autopull_off_by_default_is_a_noop(tmp_path, monkeypatch):
    """No-op unless pull.auto is set — never surprises a deployment that didn't opt in."""
    calls = []
    async def fake_pull(*a, **k): calls.append(1); return {"new_files": []}
    monkeypatch.setattr(capture, "pull_oxyii_session", fake_pull)
    cfg = {"devices": [_o2dev()]}                      # no pull.auto
    _run(capture.autopull_poller(cfg, str(tmp_path)))  # returns immediately
    assert calls == []


def test_autopull_skips_while_the_ring_is_actively_worn(tmp_path, monkeypatch):
    """It must NEVER interrupt a live sleep capture — an actively worn+streaming ring is left alone."""
    calls = []
    async def fake_pull(*a, **k): calls.append(1); return {"new_files": []}
    monkeypatch.setattr(capture, "pull_oxyii_session", fake_pull)
    capture.STATUS["devices"]["Ring"] = {"connected": True, "worn": True}   # actively worn
    cfg = {"pull": {"auto": True, "auto_interval_sec": 1}, "devices": [_o2dev(name="Ring")]}
    _stop_after(monkeypatch, 1)
    _run(capture.autopull_poller(cfg, str(tmp_path)))
    assert calls == [], "must not pull while the ring is actively worn"


def test_autopull_pulls_when_off_the_finger(tmp_path, monkeypatch):
    """Off the finger (worn False) → it pulls which=all."""
    seen = []
    async def fake_pull(dev, root, which="latest", ftype=0, *, trigger="manual"):
        seen.append(which); return {"new_files": ["Wellue_O2Ring-S_x_STORED.dat"], "out_dir": root}
    monkeypatch.setattr(capture, "pull_oxyii_session", fake_pull)
    capture.STATUS["devices"]["Ring"] = {"connected": True, "worn": False}
    cfg = {"pull": {"auto": True, "auto_interval_sec": 1, "auto_retries": 1}, "devices": [_o2dev(name="Ring")]}
    _stop_after(monkeypatch, 1)
    _run(capture.autopull_poller(cfg, str(tmp_path)))
    assert seen and seen[0] == "all"


def test_autopull_retries_to_drain_the_ring_then_stops(tmp_path, monkeypatch):
    """The ring's flash is small + FIFO — a missed session is lost once new ones pile on. So it retries
    until a pass finds nothing new (drained), capped at auto_retries. Here two passes find sessions, the
    third finds none → it stops without using a 4th."""
    passes = [["a.dat", "b.dat"], ["c.dat"], []]      # pull returns new files, then nothing
    async def fake_pull(dev, root, which="latest", ftype=0, *, trigger="manual"):
        return {"new_files": passes.pop(0) if passes else [], "out_dir": root}
    monkeypatch.setattr(capture, "pull_oxyii_session", fake_pull)
    capture.STATUS["devices"]["Ring"] = {"connected": False, "worn": False}
    cfg = {"pull": {"auto": True, "auto_interval_sec": 1, "auto_retries": 5}, "devices": [_o2dev(name="Ring")]}
    _stop_after(monkeypatch, 1)
    _run(capture.autopull_poller(cfg, str(tmp_path)))
    assert len(passes) == 0, "should have consumed exactly the 3 configured passes (2 with data + 1 empty)"


def test_autopull_survives_an_unreachable_ring(tmp_path, monkeypatch):
    """An out-of-range ring (pull raises) must not take the poller down — it retries, then next cycle."""
    from bleak.exc import BleakError
    async def boom(*a, **k): raise BleakError("not advertising")
    monkeypatch.setattr(capture, "pull_oxyii_session", boom)
    capture.STATUS["devices"]["Ring"] = {"connected": False, "worn": False}
    cfg = {"pull": {"auto": True, "auto_interval_sec": 1, "auto_retries": 2}, "devices": [_o2dev(name="Ring")]}
    _stop_after(monkeypatch, 1)
    _run(capture.autopull_poller(cfg, str(tmp_path)))   # must not raise


def test_autopull_noop_when_no_ring_configured(tmp_path, monkeypatch):
    """pull.auto on but no Wellue/Viatom device → returns immediately."""
    calls = []
    async def fake_pull(*a, **k): calls.append(1); return {"new_files": []}
    monkeypatch.setattr(capture, "pull_oxyii_session", fake_pull)
    cfg = {"pull": {"auto": True}, "devices": [_pdev()]}   # only an H10, no ring
    _run(capture.autopull_poller(cfg, str(tmp_path)))
    assert calls == []


def test_autopull_skips_during_recovery(tmp_path, monkeypatch):
    """No pull while the adapter watchdog is recovering (_RECOVER) — don't fight the radio reset."""
    calls = []
    async def fake_pull(*a, **k): calls.append(1); return {"new_files": []}
    monkeypatch.setattr(capture, "pull_oxyii_session", fake_pull)
    capture.STATUS["devices"]["Ring"] = {"connected": False, "worn": False}
    capture._RECOVER.set()
    cfg = {"pull": {"auto": True, "auto_interval_sec": 1}, "devices": [_o2dev(name="Ring")]}
    _stop_after(monkeypatch, 1)
    _run(capture.autopull_poller(cfg, str(tmp_path)))
    assert calls == []


def test_autopull_yields_the_slot_on_offline_busy(tmp_path, monkeypatch):
    """If another offline op holds the single slot, back off to next cycle (don't hammer)."""
    import offline_lock
    n = {"c": 0}
    async def busy(*a, **k): n["c"] += 1; raise offline_lock.OfflineBusy("held")
    monkeypatch.setattr(capture, "pull_oxyii_session", busy)
    capture.STATUS["devices"]["Ring"] = {"connected": False, "worn": False}
    cfg = {"pull": {"auto": True, "auto_interval_sec": 1, "auto_retries": 5}, "devices": [_o2dev(name="Ring")]}
    _stop_after(monkeypatch, 1)
    _run(capture.autopull_poller(cfg, str(tmp_path)))
    assert n["c"] == 1, "OfflineBusy breaks the retry loop immediately (no hammering)"




# ── VIGIL-DEEP-ANALYSIS §1.1 — every post-connect setup await is bounded by _bounded_setup, so a
#    wedged StartNotify/auth-write raises TimeoutError (→ runner retries) instead of freezing all night. ──
def test_bounded_setup_times_out_a_hanging_await(monkeypatch):
    monkeypatch.setattr(capture, "_BLE_SETUP_TIMEOUT_S", 0.05)
    async def go():
        async def hang():
            await asyncio.Event().wait()          # never fires (the wedged-StartNotify case)
        import pytest
        with pytest.raises(asyncio.TimeoutError):
            await capture._bounded_setup(hang())
    asyncio.run(go())


def test_bounded_setup_passes_a_prompt_await_through(monkeypatch):
    monkeypatch.setattr(capture, "_BLE_SETUP_TIMEOUT_S", 1.0)
    async def go():
        async def ok(): return "done"
        assert await capture._bounded_setup(ok()) == "done"
    asyncio.run(go())


# ── a charging Polar must not churn the adapter ─────────────────────────────────────────────────────
def _count_connects(monkeypatch, client):
    """Inject the fake client and count how many BLE sessions run_polar opens."""
    n = {"connects": 0}
    def _mk(addr, *a, **k):
        n["connects"] += 1
        return _fake_scan_ctx(client)
    monkeypatch.setattr(capture, "_connect", _mk)
    return n


def test_a_charging_polar_retries_start_on_the_link_it_already_holds(tmp_path, monkeypatch):
    """A device on its charger refuses PMD START, and we re-attempt on a cadence so capture resumes
    within a minute of it coming off. That retry must NOT be a full reconnect.

    Observed on the box 2026-07-26: the Verity, sitting on its charger, reconnected every ~67 s —
    17 connects in 19 minutes, writing nothing, logged only as INFO 'connected' so no alert could
    ever see it. Only link_epoch showed it. This dongle has a documented firmware wedge under load,
    so an indefinite connect/disconnect cycle for every charging device is the one load profile
    worth not generating. The link SURVIVES on the charger (see the transient branch in run_polar),
    so the retry can happen in place.
    """
    _polar_common(monkeypatch)
    c = FakePolarClient(start_status=0x0D)          # in_charger, for the whole test
    n = _count_connects(monkeypatch, c)
    _stop_after_slept(monkeypatch, capture.CHARGE_RETRY_S * 3.5)
    _run(capture.run_polar(_pdev(), str(tmp_path)))

    starts = [w for w in c.writes if w and w[0] == 0x02]
    assert len(starts) >= 3, f"the charging retry must keep re-attempting START; saw {len(starts)}"
    assert n["connects"] == 1, (
        f"{n['connects']} BLE connects for {len(starts)} START retries — a charging device must be "
        "polled over the link it already holds, not re-connected every cycle")


# ── charging_retry_in_place: when the held link must be given back ───────────────────────────────────
def test_charging_retry_in_place_holds_the_link_when_nothing_else_needs_it():
    assert capture.charging_retry_in_place(True, False, False, False) is True


def test_charging_retry_in_place_yields_to_an_offline_pull():
    """THE hazard this fix could have created. A pull needs exclusive access; if the charging retry
    kept holding the link through a pause request the pull would fail with org.bluez.Error.InProgress
    — trading a churn bug for a data-loss bug. Releasing beats polling."""
    assert capture.charging_retry_in_place(True, False, True, False) is False


def test_charging_retry_in_place_yields_to_shutdown_and_to_adapter_recovery():
    assert capture.charging_retry_in_place(True, True, False, False) is False
    assert capture.charging_retry_in_place(True, False, False, True) is False


def test_charging_retry_in_place_needs_a_live_link():
    """A dropped link cannot be retried in place; the outer reconnect loop owns that case."""
    assert capture.charging_retry_in_place(False, False, False, False) is False


def test_a_charging_polar_releases_the_held_link_promptly_when_a_pull_asks_for_it(tmp_path, monkeypatch):
    """The hazard, end to end and measured in simulated seconds.

    The pause must arrive DURING the charging wait — the outer loop skips a device that is already
    paused, so pausing up front would prove nothing. What matters is how long we sit on the link
    after the request: the wait is ticked precisely so this is ~1 s and not up to CHARGE_RETRY_S.
    """
    _polar_common(monkeypatch)
    addr = _pdev()["address"]
    c = FakePolarClient(start_status=0x0D)
    _count_connects(monkeypatch, c)

    sleeps, mark = [], {}
    async def fake_sleep(secs):
        sleeps.append(secs)
        if sum(sleeps) >= capture.CHARGE_RETRY_S * 3:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)

    orig_write = c.write_gatt_char
    async def hooked(uuid, cmd, response=False):
        await orig_write(uuid, cmd, response=response)
        if cmd and cmd[0] == 0x02 and "at" not in mark:      # the first START refusal
            capture._POLAR_PAUSED.add(addr)
            mark["at"] = len(sleeps)
    c.write_gatt_char = hooked

    try:
        _run(capture.run_polar(_pdev(), str(tmp_path)))
    finally:
        capture._POLAR_PAUSED.clear()

    assert "at" in mark, "the START refusal never happened — the test set nothing up"
    held = sum(s for s in sleeps[mark["at"]:] if s == 1)     # ticks spent still holding the link
    assert held <= 2, (
        f"held the link for {held} tick(s) after the pull asked for it — a pull that cannot get the "
        "link fails with InProgress, so the charging wait must check the pause every tick")


# ══ UNBOUNDED GATT AWAITS — the 4h25m Verity freeze of 2026-07-25 ═════════════════════════════
# 23:51:20  Polar Sense 0C301E3F connected
# 23:51:21  START ppg  (negotiated) -> ok
# 23:51:22  START acc  (negotiated) -> ok
# 23:51:22  START gyro (negotiated) -> ok
# 23:51:23  START mag  (negotiated) -> ok
#           ... nothing whatsoever ...
# 04:16:01  Polar Sense 0C301E3F connected
#
# Four streams acknowledged `ok`, the link held (680 of 682 poll samples connected), and ZERO bytes for
# four and a half hours. The 90 s stall watchdog never fired because it lives in the hold loop, and the
# task never reached the hold loop: it was parked on an unbounded GATT read.
#
# `_bounded_setup` exists for exactly this and says so — "never a silent all-night freeze at
# connected=True" — but it was applied only to the PMD data subscribe. The battery read sits between
# the last successful START and the hold loop, so a hang there is invisible in the worst possible way:
# every stream reports `started`, `connected` stays True, and the watchdog that would notice is
# downstream of the thing that is stuck. QC logged `missing stream(s)` at 00:02 and 00:12 and nothing
# consumed it.

class HangingPolarClient(FakePolarClient):
    """A Polar whose battery characteristic never answers — a flaky link BlueZ never fails."""
    def __init__(self, hang_uuid, **kw):
        super().__init__(**kw)
        self.hang_uuid = hang_uuid

    async def read_gatt_char(self, uuid):
        if uuid == self.hang_uuid:
            await asyncio.Event().wait()          # never returns, never raises
        return await super().read_gatt_char(uuid)


def _run_bounded(coro, seconds=5.0):
    """Run with a hard wall-clock cap so a regression FAILS instead of hanging the suite forever."""
    async def go():
        return await asyncio.wait_for(coro, seconds)
    return asyncio.run(go())


def test_a_battery_read_that_never_answers_cannot_freeze_the_device_task(tmp_path, monkeypatch):
    """THE bug. Without a bound this awaits forever and the session never reaches its stall watchdog."""
    _polar_common(monkeypatch)
    monkeypatch.setattr(capture, "_BLE_SETUP_TIMEOUT_S", 0.05)
    c = HangingPolarClient(capture.BATTERY_UUID, start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 3)
    _run_bounded(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["connected"] is True


def test_a_battery_read_that_hangs_does_not_lose_the_session(tmp_path, monkeypatch):
    """Battery level is cosmetic. A timeout reading it must skip the reading, not tear down capture —
    otherwise the fix trades an all-night freeze for an all-night reconnect loop."""
    _polar_common(monkeypatch)
    monkeypatch.setattr(capture, "_BLE_SETUP_TIMEOUT_S", 0.05)
    c = HangingPolarClient(capture.BATTERY_UUID, start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 3)
    _run_bounded(capture.run_polar(_pdev(), str(tmp_path)))
    ecgs = list((tmp_path / "captures").rglob("*_ECG.txt"))
    assert ecgs and ecgs[0].stat().st_size > 60, "the ECG stream must still have been captured"


def test_a_control_point_read_that_never_answers_cannot_freeze_the_device_task(tmp_path, monkeypatch):
    """The PMD feature read is on the same path and equally unbounded."""
    _polar_common(monkeypatch)
    monkeypatch.setattr(capture, "_BLE_SETUP_TIMEOUT_S", 0.05)
    c = HangingPolarClient(pmd.PMD_CONTROL, start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 3)
    _run_bounded(capture.run_polar(_pdev(), str(tmp_path)))


def test_an_hr_subscribe_that_never_answers_cannot_freeze_the_device_task(tmp_path, monkeypatch):
    """start_notify on the HR characteristic was bare too."""
    _polar_common(monkeypatch)
    monkeypatch.setattr(capture, "_BLE_SETUP_TIMEOUT_S", 0.05)
    c = FakePolarClient(start_status=0x00)
    orig = c.start_notify
    async def hang(uuid, cb):
        if getattr(uuid, "uuid", uuid) == capture.HR_UUID:
            await asyncio.Event().wait()
        return await orig(uuid, cb)
    c.start_notify = hang
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 3)
    _run_bounded(capture.run_polar(_pdev(streams=["ecg", "hr"]), str(tmp_path)))


def test_no_post_connect_gatt_await_in_run_polar_is_left_unbounded():
    """A source check, because the next one added will be bare too unless something says otherwise.
    Every start_notify / read_gatt_char inside run_polar must carry a bound."""
    src = module_source("capture.py")
    body = src.split("async def run_polar")[1].split("\nasync def ")[0]
    bare = [ln.strip() for ln in body.splitlines()
            if ("client.start_notify(" in ln or "client.read_gatt_char(" in ln)
            and "_bounded_setup" not in ln and "wait_for" not in ln]
    assert not bare, "unbounded post-connect GATT await(s) in run_polar:\n  " + "\n  ".join(bare)


# ── the alerting path must leave a trace (CAPTURE-HOST-DEEP-AUDIT §C1 / §C2) ────────────────────
def test_a_failed_webhook_does_not_silence_the_offline_alert_for_the_episode(monkeypatch, caplog):
    """THE §C1 regression. `alerted.add(name)` ran BEFORE `await notifier.send(...)` and the return
    value was discarded, while `Notifier.send` swallowed every exception with no log at any level. So
    ONE failed POST silenced the alert for the whole offline episode — which, for the dead-battery case
    the alert exists for, is the whole night. Measured pre-fix: 40 poll iterations, ONE attempt."""
    attempts = []
    class _N:
        enabled = True
        async def send(self, title, message, **kw):
            attempts.append(title)
            return False                       # the webhook is down
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 0}, "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": False}
    _stop_after(monkeypatch, 4)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    with caplog.at_level("WARNING"):
        _run(capture.alert_poller(cfg, _N()))
    assert len(attempts) >= 3, f"a failed delivery must be retried, got {len(attempts)} attempt(s)"
    assert any("offline" in r.message for r in caplog.records), \
        "the condition must reach the journal even when delivery fails"


def test_the_offline_condition_reaches_the_journal_with_no_webhook_configured(monkeypatch, caplog):
    """A box without a webhook has exactly one alerting surface, and it is the journal. `qc_poller`'s
    frozen-device path already said so in a comment one function down; this path did not."""
    class _N:
        enabled = False
        async def send(self, title, message, **kw): return False
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 0}, "devices": [_dev(name="H10")]}
    capture.STATUS["devices"]["H10"] = {"connected": False}
    _stop_after(monkeypatch, 3)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    with caplog.at_level("WARNING"):
        _run(capture.alert_poller(cfg, _N()))
    hits = [r for r in caplog.records if "offline" in r.message]
    assert len(hits) == 1, f"once per episode, not once per poll — got {len(hits)}"


def test_the_low_disk_edge_reaches_the_journal_without_a_webhook(tmp_path, monkeypatch, caplog):
    """§C2. `storage_poller` set `low_alerted` and sent ONLY `if notifier`; there was no log call for
    the low-free-space condition anywhere in capture.py. On a webhook-less box the edge existed solely
    in status.json and /api/storage — both PULL surfaces. diskguard's own header says the emergency
    signal is meant to be loud."""
    cfg = {"storage": {"keep_nights": 0, "min_free_gb": 1e9, "poll_sec": 1}}   # always "low"
    _stop_after(monkeypatch, 2)
    with caplog.at_level("WARNING"):
        _run(capture.storage_poller(cfg, str(tmp_path), None))                # NO notifier
    lows = [r for r in caplog.records if "LOW" in r.message]
    assert len(lows) == 1, f"edge-triggered: one line per low episode, got {len(lows)}"
    assert "GB free" in lows[0].message


def test_notifier_logs_a_swallowed_delivery_failure(caplog):
    """Swallowing the exception must not also swallow the evidence. The webhook must never crash
    capture — that stays — but a delivery that never happened has to be findable afterwards."""
    import alerts as _alerts
    async def _boom(url, payload):
        raise OSError("connection refused")
    n = _alerts.Notifier(url="http://x/", enabled=True, _post=_boom)
    with caplog.at_level("WARNING"):
        assert _run(n.send("Tepna: sensor offline", "body")) is False
    assert any("not delivered" in r.message for r in caplog.records)


def test_notifier_logs_a_non_2xx_rejection(caplog):
    import alerts as _alerts
    async def _rejects(url, payload):
        return False
    n = _alerts.Notifier(url="http://x/", enabled=True, _post=_rejects)
    with caplog.at_level("WARNING"):
        assert _run(n.send("Tepna: disk low", "body")) is False
    assert any("rejected" in r.message for r in caplog.records)


def test_an_unreadable_rssi_poll_writes_a_blank_not_the_last_good_value(tmp_path, monkeypatch):
    """§B1. `_set(name, rssi=...)` ran only when the read SUCCEEDED, while the LINK row unconditionally
    wrote `st.get("rssi")` — so every unreadable poll re-recorded the last good dBm at a NEW timestamp,
    indistinguishable from a real measurement:

        2026-07-26T21:02:50.422;H10;1;-55;...
        2026-07-26T21:02:50.422;H10;1;-55;...   (1 real measurement -> 4 recorded readings)

    Worse after the fix that preceded it: VIGIL-PPG-GRID-AUDIT §4 tightened `parse_rssi` to -127..-1 so
    BlueZ's sentinels return None — "Recording 'unknown' is the honest answer" — which strictly
    INCREASED how often the stale value was logged instead of a blank. `timeline.bucket_link` then
    medians the column and the monitor renders it as the night's signal trace."""
    reads = iter([-55, None, None, None])
    async def _read(_adapter, _addr):
        return next(reads, None)
    monkeypatch.setattr(capture.link_rssi, "read_rssi", _read)
    async def _hci(mac, refresh=False): return "hci0"
    monkeypatch.setattr(capture.link_rssi, "resolve_hci", _hci)
    capture.STATUS["devices"]["H10"] = {"connected": True}
    cfg = {"link": {"rssi_interval_sec": 1, "log_enabled": True},
           "devices": [_dev(name="H10", address="AA:BB:CC:DD:EE:FF")]}
    _stop_after(monkeypatch, 4)
    _run(capture.rssi_poller("AA:BB:CC:DD:EE:00", cfg, str(tmp_path)))

    import glob
    links = glob.glob(str(tmp_path / "captures" / "*" / "*_LINK.csv"))
    assert links, "the sidecar must have been written"
    rows = [r for r in open(links[0]).read().splitlines()[1:] if r]
    dbm = [r.split(";")[3] for r in rows]
    assert dbm[0] == "-55", "a real reading is recorded"
    assert all(v == "" for v in dbm[1:]), (
        f"an unreadable poll must write a blank, not the last good value — got {dbm}")


def test_alert_poller_stays_quiet_for_an_optional_device_that_never_joined(monkeypatch):
    """The COOSPO case. The connect loop already logs "optional backup device not present — keeping a
    quiet eye out" once and backs off deliberately, "instead of a warning every backoff cycle (the COOSPO
    spam)"; the alert loop never asked, so the same absent strap still produced a WARNING and a webhook on
    every service start. An alert channel that cries over a non-event is one an operator learns to
    ignore — which costs the alerts that matter."""
    sent = []
    class _N:
        enabled = True
        async def send(self, title, message, **kw): sent.append(title); return True
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 0},
           "devices": [dict(_dev(name="COOSPO"), optional=True)]}
    capture.STATUS["devices"]["COOSPO"] = {"connected": False}
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= 3:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    _run(capture.alert_poller(cfg, _N()))
    assert sent == [], "an optional device that never joined is not something capture is missing"


def test_alert_poller_DOES_alert_an_optional_device_that_joined_then_dropped(monkeypatch):
    """The nuance that keeps the suppression honest. An optional device that WAS contributing and then
    went offline is a real event — precisely what this alert is for. Silence is only correct for one that
    never showed up at all, so the loop has to remember which happened."""
    sent = []
    class _N:
        enabled = True
        async def send(self, title, message, **kw): sent.append(title); return True
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 0},
           "devices": [dict(_dev(name="COOSPO"), optional=True)]}
    st = {"connected": True}                       # it IS here to begin with
    capture.STATUS["devices"]["COOSPO"] = st
    calls = {"n": 0}
    async def fake_sleep(_s):
        # The loop sleeps BEFORE it reads state, so poll 1 must observe it connected — that is what
        # records "this device did join". Dropping it any earlier would test the never-joined path.
        calls["n"] += 1
        if calls["n"] == 2:
            st["connected"] = False                # …and then it drops
        if calls["n"] >= 4:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    _run(capture.alert_poller(cfg, _N()))
    assert sent == ["Tepna: sensor offline"], "a device that stopped contributing must still alert"


# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# MUTATION PASS 2026-08-03 — the sample-write dispatch, and the bond guards
#
# `run_polar` measured 1 241 mutants with 641 surviving — **44 % killed**, the weakest surface in
# capture-host. It is also the function that records a night, so a wrong answer here is silent by
# construction: the file exists, the row count looks right, and the numbers in it are wrong.
#
# The sharpest cluster is the six-way `meas` dispatch that writes every sample. Its arguments could be
# nulled one at a time and nothing noticed, because the existing tests assert that a FILE APPEARS and
# that rows were counted — never what is IN a row. `smp.sensor_ns` nulled writes a file whose device
# clock column is empty; `smp.t_ms` nulled loses the relative-ms column ECGDex infers fs from (the
# ~10 % HR bug `test_writers` was written for); `v[0]` nulled writes a null sample value.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════

def _ecg_row(tmp_path):
    """Drive one real ECG frame through run_polar and return the written data row, split."""
    files = [p for p in tmp_path.rglob("*_ECG.txt")]
    assert len(files) == 1, f"expected exactly one ECG file, got {files}"
    rows = files[0].read_text().splitlines()
    assert len(rows) >= 2, f"header + at least one sample, got {rows}"
    return rows[0].split(";"), rows[1].split(";")


def test_an_ecg_sample_is_written_with_every_column_populated(tmp_path, monkeypatch):
    """The `wr.write_ecg(smp.phone, smp.sensor_ns, smp.t_ms, v[0])` dispatch — four arguments, each of
    which could be nulled undetected. The fixture frame carries sensor_ns = 1e9 and three samples of
    +7 uV, so every column has a value that is checkable rather than incidentally zero."""
    _polar_common(monkeypatch)
    c = FakePolarClient(start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))

    head, row = _ecg_row(tmp_path)
    assert head == ["Phone timestamp", "sensor timestamp [ns]", "timestamp [ms]", "ecg [uV]"]
    assert len(row) == 4, "a row carries every column the header promises"
    assert row[0], "the phone timestamp is present — an empty one is an unstamped sample"
    # PMD stamps a FRAME, not a sample: the frame's ns is its LAST sample and the earlier ones are
    # back-computed across the rate. So the first row is BEFORE 1e9 and the last row IS 1e9.
    f = [p for p in tmp_path.rglob("*_ECG.txt")][0]
    ns = [r.split(";")[1] for r in f.read_text().splitlines()[1:]]
    assert all(n and n.isdigit() for n in ns), f"every row carries a device clock: {ns}"
    assert ns == sorted(ns, key=int) and len(set(ns)) == 3, "distinct and increasing across the frame"
    assert ns[-1] == "1000000000", "the frame's own stamp lands on its LAST sample"
    assert row[2] == "0.0", "the relative-ms column ECGDex infers fs from — first sample is 0.0"
    assert row[3] == "7", "the sample VALUE, not a null"


def test_every_ecg_sample_in_a_frame_is_written(tmp_path, monkeypatch):
    """The `for smp in samples` loop. A frame carries three samples; writing one and dropping two is a
    row count that looks plausible and a night that is a third of its real length."""
    _polar_common(monkeypatch)
    c = FakePolarClient(start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))

    f = [p for p in tmp_path.rglob("*_ECG.txt")][0]
    data = f.read_text().splitlines()[1:]
    assert len(data) == 3, f"the fixture frame carries three samples, got {len(data)}"
    assert [r.split(";")[3] for r in data] == ["7", "7", "7"], "each sample's value, in order"
    assert capture.STATUS["devices"]["H10"][f"rows_{pmd.ECG}"] == 3, \
        "and the surfaced row count matches what was written"


def test_the_live_bus_push_carries_the_sample_values_not_the_sample_objects(tmp_path, monkeypatch):
    """`BUS.push(key, [s.values[0] for s in samples], hz)` — the monitor's live trace. Nulling the list
    or the rate leaves the chart drawing nothing while the file fills normally, so the operator watching
    it concludes the sensor is dead when it is recording perfectly."""
    _polar_common(monkeypatch)
    pushed = []
    monkeypatch.setattr(capture.BUS, "push",
                        lambda k, v, hz=None, dev_ns=None: pushed.append((k, v, hz, dev_ns)))
    c = FakePolarClient(start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))

    ecg = [p for p in pushed if p[0].endswith("ecg") or "ecg" in p[0]]
    assert ecg, f"an ecg frame must reach the live bus, got keys {[p[0] for p in pushed]}"
    _key, vals, hz, dev_ns = ecg[0]
    assert vals == [7, 7, 7], "the VALUES, one per sample, in order"
    assert hz, "and a sample rate — a trace with no rate cannot be drawn to a time axis"
    # …and the frame's DEVICE stamp (DEVICE-RATE-TRUTH §6.3). Without it `effFs` falls back to arrival
    # times, which measure how the radio BATCHED the frames rather than how fast the sensor sampled — so
    # a missing `dev_ns` here is not a cosmetic omission, it silently restores the old statistic.
    assert dev_ns is not None and dev_ns > 0, "the frame's device stamp must reach the bus"


# ── the bond guards: four conditions, each earning its place ─────────────────────────────────────────
def test_a_strap_with_no_pmd_stream_is_never_bonded(tmp_path, monkeypatch):
    """`if needs_pmd:` around `ensure_bonded`. The SIG Heart Rate characteristic needs no
    authentication and most third-party straps cannot pair at all — the module's own comment records
    that bonding one cost 'a pointless bond attempt, an 18-SECOND GLOBAL CAPTURE PAUSE ... and a
    phantom link that then tripped the watchdog'."""
    _polar_common(monkeypatch)
    seen = []

    async def spy_bond(addr, adapter):
        seen.append((addr, adapter))
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", spy_bond)
    c = FakePolarClient(start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(vendor="Coospo", streams=["hr"]), str(tmp_path)))
    assert seen == [], "an hr-only strap is not bonded"


def test_a_pmd_device_is_bonded_with_its_own_address_and_the_pinned_adapter(tmp_path, monkeypatch):
    """`ensure_bonded(addr, ADAPTER)` — four mutants null or drop an argument, including one that
    passes the ADAPTER as the address. Three BLE radios on this box, so an unpinned bond is a bond on
    whichever controller BlueZ picks."""
    _polar_common(monkeypatch)
    seen = []

    async def spy_bond(addr, adapter):
        seen.append((addr, adapter))
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", spy_bond)
    c = FakePolarClient(start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert seen and seen[0] == ("24:AC:AC:02:84:96", capture.ADAPTER), \
        "the device's own address, and the pinned adapter"


# ── MULTI-SESSION: the state run_polar infers ACROSS reconnects (2026-08-03) ─────────────────────────
#
# `run_polar` measured 44 % — the weakest surface in capture-host — and the reason its survivors are
# hard to reach is SHAPE, not volume. The existing fixtures drive ONE connect cycle against a static
# device, while the surviving mutants live in state inferred from CHANGE ACROSS SESSIONS: battery
# direction, stale-bond counting, rebond cadence.
#
# Driving a second session needs one thing the harness did not do: `capture._STOP` is a module global
# that `_stop_after` SETS, and the autouse fixture only recreates it per TEST. A second `run_polar` in
# the same test therefore saw it already set and returned instantly — which is why an earlier attempt
# at these tests kept reading the FIRST session's battery. `_next_session` gives each cycle a fresh
# Event, and a fresh one per cycle is also required because every `_run` is a new event loop.

def _next_session(monkeypatch, client, rounds=1):
    """Arm one more connect cycle: fresh _STOP (new loop each time), fresh sleep counter, this client."""
    capture._STOP = asyncio.Event()
    _inject_connect(monkeypatch, client)
    _stop_after(monkeypatch, rounds)


class _BatteryPolarClient(FakePolarClient):
    """A Polar reporting a fixed battery percentage."""
    def __init__(self, level, **kw):
        super().__init__(**kw)
        self._level = level

    async def read_gatt_char(self, uuid):
        if uuid == capture.BATTERY_UUID:
            return bytes([self._level])
        return await super().read_gatt_char(uuid)


def _battery_session(tmp_path, monkeypatch, level):
    """One connect cycle at `level` %. STATUS persists between calls, which is exactly how the real
    inference works: the previous session's reading is the `prev` the next one compares against."""
    _next_session(monkeypatch, _BatteryPolarClient(level, start_status=0x00))
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    return capture.STATUS["devices"]["H10"]


def test_the_multi_session_harness_actually_runs_a_second_session(tmp_path, monkeypatch):
    """The fixture's own guard. Without the fresh `_STOP` the second cycle is a silent no-op and every
    test built on it passes while measuring the first session twice — a hollow harness, which is worse
    than a missing one."""
    _polar_common(monkeypatch)
    capture.STATUS["devices"].pop("H10", None)
    first = _battery_session(tmp_path, monkeypatch, 40)["battery"]
    second = _battery_session(tmp_path, monkeypatch, 55)["battery"]
    assert (first, second) == (40, 55), "the second session must actually reach the device"


def test_a_rising_battery_is_read_as_charging(tmp_path, monkeypatch):
    """`lvl > prev` -> `charging=True`. A Polar exposes no charge flag mid-session — `in_charger` only
    appears when a PMD START is REFUSED, which cannot happen to a device already streaming when it went
    on the dock. Measured 2026-07-19: a Verity climbed 35 -> 61 % while the monitor said charging=False
    the whole way. These cells do not self-charge, so a RISE is unambiguous."""
    _polar_common(monkeypatch)
    capture.STATUS["devices"].pop("H10", None)
    _battery_session(tmp_path, monkeypatch, 35)
    st = _battery_session(tmp_path, monkeypatch, 61)
    assert st["battery"] == 61 and st["charging"] is True


def test_a_falling_battery_is_read_as_back_on_the_body(tmp_path, monkeypatch):
    """`lvl < prev` -> `charging=False`. Not collapsible into the first arm: a device that never goes
    False stays flagged charging for the session, and `classify_adapter_health` discounts a charging
    device as evidence the radio works — so a stuck flag can suppress a real adapter wedge."""
    _polar_common(monkeypatch)
    capture.STATUS["devices"].pop("H10", None)
    _battery_session(tmp_path, monkeypatch, 40)
    assert _battery_session(tmp_path, monkeypatch, 70)["charging"] is True
    st = _battery_session(tmp_path, monkeypatch, 61)
    assert st["battery"] == 61 and st["charging"] is False


def test_only_a_STRICT_rise_infers_charging(tmp_path, monkeypatch):
    """`lvl > prev`, and the boundary it shares with `lvl < prev`. These report in whole percent and
    move slowly, so a FLAT reading is the common case and equality must infer nothing.

    Note what this test discovered: `charging` is NOT carried across sessions — a successful PMD START
    re-derives it, so it is False again by the time the next battery read happens. Only a strict rise
    turns it back on. That makes the `>` boundary load-bearing in a way a persisted flag would not: on
    an unchanged reading the device reports NOT charging, which is the honest answer when the only
    evidence is a number that did not move."""
    _polar_common(monkeypatch)
    capture.STATUS["devices"].pop("H10", None)
    _battery_session(tmp_path, monkeypatch, 50)
    assert _battery_session(tmp_path, monkeypatch, 61)["charging"] is True, "a rise infers charging"
    assert _battery_session(tmp_path, monkeypatch, 61)["charging"] is not True, \
        "an UNCHANGED level is not a rise — equality infers nothing"


def test_a_first_reading_cannot_imply_a_direction(tmp_path, monkeypatch):
    """`isinstance(prev, int)` on both arms. With no prior reading there is nothing to compare, and
    guessing is the fabrication this module refuses everywhere else."""
    _polar_common(monkeypatch)
    capture.STATUS["devices"].pop("H10", None)
    st = _battery_session(tmp_path, monkeypatch, 60)
    assert st["battery"] == 60
    assert st.get("charging") is not True, "one reading is not a direction"


# ── WORN-SINCE: the grace clock that must SURVIVE the duty-cycle reconnects ──────────────────────────
#
# A chest strap off the body does not go quiet — it streams electrode noise at the full 130 Hz, which
# records nothing real AND flattens the battery over a day. So after a generous grace of CONTINUOUS
# not-worn contact the link is dropped, then re-checked on a slow cadence to see whether it has been put
# back on.
#
# `_WORN_SINCE` is MODULE-LEVEL and only-set-if-absent, and the source says exactly why: the drop
# re-checks by RECONNECTING, so a per-session clock would be restarted by each probe and the grace would
# never elapse — the strap would drain forever. That persistence is the contract, and it is invisible to
# any single-session fixture: within one session, set-if-absent and set-always are identical.

def _hr_session(tmp_path, monkeypatch, hr_frame, clear=False):
    """One connect cycle delivering `hr_frame`. `_WORN_SINCE` deliberately persists between calls —
    that is the behaviour under test."""
    if clear:
        capture._WORN_SINCE.clear()
        capture.STATUS["devices"].pop("H10", None)
    capture._STOP = asyncio.Event()
    async def bonded(*a, **k):
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    capture._CFG.clear(); capture._CFG.update({"time": {"auto_sync_devices": False}})
    _inject_connect(monkeypatch, FakePolarClient(start_status=0x00, hr_frame=hr_frame))
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(streams=["ecg", "hr"]), str(tmp_path)))
    return capture.STATUS["devices"]["H10"]


_NOT_WORN = bytes([0x04, 57])      # contact supported, absent
_WORN     = bytes([0x06, 57])      # contact supported, present


def test_a_not_worn_strap_starts_the_grace_clock_once(tmp_path, monkeypatch):
    """`elif addr not in _WORN_SINCE` — only-set-if-absent. The re-check after a power drop RECONNECTS,
    so a clock restarted on every probe never elapses and the strap drains forever. Within one session
    set-if-absent and set-always are indistinguishable; two sessions separate them."""
    addr = _pdev()["address"]
    st = _hr_session(tmp_path, monkeypatch, _NOT_WORN, clear=True)
    assert st["worn"] is False
    first = capture._WORN_SINCE[addr]
    _hr_session(tmp_path, monkeypatch, _NOT_WORN)          # a second not-worn probe
    assert capture._WORN_SINCE[addr] == first, \
        "the grace clock must NOT restart on each reconnect, or the grace never elapses"


def test_putting_the_strap_back_on_clears_the_grace_clock(tmp_path, monkeypatch):
    """`if contact: _WORN_SINCE.pop(addr, None)`. Without the clear, a strap worn again still carries
    its old not-worn timestamp and gets dropped for power while it is on the body and recording."""
    addr = _pdev()["address"]
    _hr_session(tmp_path, monkeypatch, _NOT_WORN, clear=True)
    assert addr in capture._WORN_SINCE
    st = _hr_session(tmp_path, monkeypatch, _WORN)
    assert st["worn"] is True
    assert addr not in capture._WORN_SINCE, "worn again clears the clock"
    assert st["last_error"] is None, "and clears the not-worn note with it"


def test_a_strap_with_no_contact_bit_is_never_given_a_grace_clock(tmp_path, monkeypatch):
    """`if contact is not None`. The H10 does not advertise contact support, and leaving `worn` unknown
    is honest — but an unknown must also never start the drop clock, or a strap that CANNOT report
    contact would be dropped for power on a timer while recording perfectly."""
    addr = _pdev()["address"]
    st = _hr_session(tmp_path, monkeypatch, bytes([0x00, 57]), clear=True)   # no contact-support bit
    assert st.get("worn") is None, "unknown, not fabricated as False"
    assert addr not in capture._WORN_SINCE, "and no grace clock — it can never be known not-worn"


# ── the live bus seam: keys, shapes and lifecycle ───────────────────────────────────────────────────
# `run_polar` holds 502 reachable mutants and they are SCATTERED — the densest single line is 13 of
# them. The one coherent sub-cluster is the telemetry bus: register / push / unregister, all keyed by
# `_live_key`. Nothing asserted the key it registers under, the SHAPE it pushes, or that what it
# registers is what it later unregisters — so a stream could be published under one key and torn down
# under another, leaving a dead card in the monitor for the daemon's lifetime.

def test_the_live_key_is_device_qualified_except_for_ecg():
    """Issue #410, recorded in the docstring: `ppg` WAS in the unique set and is not any more, because
    the O2Ring streams a finger pleth too. Both it and the Verity declare `ppg`, and monitor.html's
    deviceForStream() falls back to "first device whose stream list contains this name" — so on the real
    box the Verity's PPG card showed the RING's battery and RSSI. Order-dependent, so it would flip
    silently if config.yaml were reordered.

    ECG stays bare because only the H10 produces it. That asymmetry is the whole function."""
    assert capture._live_key("ecg", "h10") == "ecg", "ecg is genuinely device-unique — no suffix"
    assert capture._live_key("ppg", "verity") == "ppg_verity", "ppg is NOT unique; it must be qualified"
    assert capture._live_key("acc", "h10") == "acc_h10"
    assert capture._live_key("ppi", "verity") == "ppi_verity"
    assert capture._live_key("ppg", "ring") != capture._live_key("ppg", "verity"), \
        "two devices streaming ppg must not collide — that collision IS #410"


def test_what_is_registered_is_what_is_unregistered(monkeypatch):
    """register() and unregister() derive the key SEPARATELY — one via `MEAS_NAME[meas]`, the other via
    `MEAS_NAME.get(meas, str(meas))`. They must agree for every measurement the runner handles, or a
    stream is published under one key and torn down under another and the monitor keeps a dead card."""
    import polar_pmd as pmd

    for meas in (pmd.ECG, pmd.ACC, pmd.PPG, pmd.PPI, pmd.GYRO, pmd.MAG):
        reg = capture._live_key(pmd.MEAS_NAME[meas], "h10")
        unreg = capture._live_key(pmd.MEAS_NAME.get(meas, str(meas)), "h10")
        assert reg == unreg, f"{pmd.MEAS_NAME[meas]}: registered as {reg!r} but torn down as {unreg!r}"


# NOT WRITTEN: the PPI push order. A first attempt asserted on a list comprehension the TEST itself
# evaluated — `[[s.values[1], s.values[0]] for s in samples]` computed in the test, then compared to its
# own output. It never called capture and would have passed with that line deleted from the source: a
# test encoding the SHAPE of the code instead of its contract, which is the exact defect this campaign
# exists to find. Reaching that push for real means driving `run_polar` far enough to decode a PPI
# frame, which is a fixture, not an assertion. Worth doing; not worth faking.


def test_run_polar_ignores_a_device_pushed_stop_notification(tmp_path, monkeypatch):
    """ONLINE_MEASUREMENT_STOPPED (byte0 = 0x01) is a DEVICE PUSH, not a response. It arrives on the same
    characteristic between our write and its indication, and taking it as the answer desynchronises every
    later command — the real response is then dropped by the next _ctrl's drain. It must be routed away
    and logged, and the START must still see its own ack."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_ecg_frame()], stop_notify=True, start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["connected"] is True


def test_run_polar_discards_a_response_to_a_different_command(tmp_path, monkeypatch):
    """A well-formed 0xF0 response echoing the WRONG opcode is a stale answer from a command that timed
    out and then replied. Accepting it is how a rejected START reads as accepted — here the stale frame
    carries status 0x03 (not_supported), so if it were taken as the verdict the stream would be torn
    down. The real ack follows and must be the one that counts."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_ecg_frame()], wrong_op_ctrl=True, start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert capture.STATUS["devices"]["H10"]["connected"] is True
    # `connected is True` alone does NOT discriminate — it holds whether the stale frame was accepted or
    # not. The stale frame carries status 0x03 (not_supported), so if it were taken as this command's
    # verdict the START would read as REJECTED, which deletes the writer for the whole session. NO_ACK
    # ("ask again") is the only correct outcome; this is the same discriminator
    # test_run_polar_start_without_an_ack_keeps_the_stream uses.
    err = (capture.STATUS["devices"]["H10"].get("last_error") or "").lower()
    assert "rejected" not in err, f"a stale reply was taken as this command's verdict: {err!r}"


def test_run_oxyii_captures_the_raw_two_wavelength_buffer(tmp_path, monkeypatch):
    """The `ppg2w` stream end-to-end through the REAL runner: cmd 0x05 reply -> decoded -> written.

    Driven through `run_oxyii` rather than the parser alone because the decode branch sits AHEAD of the
    `OP_LIVE` gate — a 0x05 reply routed through the live path would be dropped as a short frame, and a
    parser-only test cannot see that.
    """
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    recs = [(1000 + i, 2000 + i, i) for i in range(4)]
    body = b"".join(a.to_bytes(4, "little") + b.to_bytes(4, "little") + bytes([m]) for a, b, m in recs)
    payload = len(recs).to_bytes(2, "little") + body + b"\xff\xff"   # the real reply's 2-byte trailer

    c = FakeGattClient()

    def on_live(data):
        if data[1] == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
        elif data[1] == oxyii.OP_RT_PPG:
            c.notify(0, oxyii.encode(oxyii.OP_RT_PPG, payload))

    c.on_live = on_live
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 6)
    _run(capture.run_oxyii(_o2dev(name="Ring", streams=["spo2", "ppg2w"]), str(tmp_path)))

    hits = list((tmp_path / "captures").rglob("*_PPG2W.txt"))
    assert hits, "a PPG2W file must be written when the stream is enabled"
    rows = hits[0].read_text().strip().split("\n")
    assert rows[0] == "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion"
    # The runner polls once per loop iteration, so the file holds a whole number of identical buffers.
    # Asserting the MULTIPLE (not a fixed total) keeps the trailer check sharp without pinning the test
    # to the loop count: absorbing the 2-byte trailer would yield 5 records per cycle, and 5 per cycle
    # is not a multiple of 4.
    assert len(rows) - 1 > 0 and (len(rows) - 1) % len(recs) == 0, \
        "one row per record, and the trailer is not a record"
    assert [r.split(";")[2:] for r in rows[1:1 + len(recs)]] == [["1000", "2000", "0"], ["1001", "2001", "1"],
                                                                 ["1002", "2002", "2"], ["1003", "2003", "3"]]
    assert all(r.split(";")[1] == "0" for r in rows[1:]), "no device clock exists on this opcode"


def test_run_oxyii_writes_no_two_wavelength_file_when_the_stream_is_off(tmp_path, monkeypatch):
    """Opt-in means opt-in: an experimental stream must not appear on a plain spo2 night."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _o2ring_live_reply()) if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(name="Ring"), str(tmp_path)))
    assert not list((tmp_path / "captures").rglob("*_PPG2W.txt"))


def test_run_oxyii_survives_an_empty_two_wavelength_reply(tmp_path, monkeypatch):
    """A 0x05 reply declaring zero records must write nothing and must not break the session.

    The ring answers this way while the finger is off the sensor, so it is the ordinary case rather
    than a corruption case — and the empty file is then pruned at teardown like any other.
    """
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()

    def on_live(data):
        if data[1] == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
        elif data[1] == oxyii.OP_RT_PPG:
            c.notify(0, oxyii.encode(oxyii.OP_RT_PPG, (0).to_bytes(2, "little")))

    c.on_live = on_live
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 6)
    _run(capture.run_oxyii(_o2dev(name="Ring", streams=["spo2", "ppg2w"]), str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"]["spo2"] == 96, "vitals keep flowing"
    assert not list((tmp_path / "captures").rglob("*_PPG2W.txt")), "a row-less file is pruned, not kept"


def test_run_oxyii_keeps_the_link_when_the_two_wavelength_poll_fails(tmp_path, monkeypatch):
    """THE reason this poll has its own try/except. A failed VITALS poll deliberately drops the link to
    re-establish it; doing that for an optional experimental stream would let `ppg2w` cost a night of
    oximetry. The refusal must cost its own samples and nothing else.
    """
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    real_write = c.write_gatt_char

    async def write(ch, data, response=False):
        if len(data) > 1 and data[1] == oxyii.OP_RT_PPG:
            raise RuntimeError("characteristic write refused")
        return await real_write(ch, data, response=response)

    c.write_gatt_char = write
    c.on_live = lambda data: (c.notify(0, _o2ring_live_reply()) if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 8)
    _run(capture.run_oxyii(_o2dev(name="Ring", streams=["spo2", "ppg2w"]), str(tmp_path)))
    # The session ran on: vitals were parsed and the SpO2 sidecar was written despite every 0x05 refusal.
    assert capture.STATUS["devices"]["Ring"]["spo2"] == 96
    assert list((tmp_path / "captures").rglob("*_SPO2.csv")), "the vitals stream is unaffected"


def test_auto_sync_ladder_stops_at_its_wall_clock_budget(tmp_path, monkeypatch):
    """THE BOUND THAT DOES NOT DEPEND ON CLASSIFYING THE ERROR (2026-08-09).

    Every ladder attempt runs through `polar_offline_op`, which holds the GLOBAL `_CONNECT_LOCK`, so the
    ladder's real cost is lock-seconds — and 12 x 45 s is ~9 min of it per reconnect cycle. The two
    previous fixes for this shape both bounded ONE op (300 s, then 45 s) and left the LOOP; measured
    2026-08-09 the loop still ran at a 59 % duty cycle.

    Uses a CONTENTION error on purpose: `device_absent_error` must not be what saves us here. If the
    budget is what stops the ladder, it stops even for the error the ladder is legitimately for."""
    _auto_sync_common(monkeypatch)
    calls = {"n": 0}
    clock = {"t": 0.0}
    monkeypatch.setattr(capture._time, "monotonic", lambda: clock["t"])
    async def busy_and_slow(addr):
        calls["n"] += 1
        clock["t"] += 45.0                      # each attempt burns the op ceiling
        raise RuntimeError("org.bluez.Error.InProgress")   # CONTENTION, not absence
    monkeypatch.setattr(capture, "sync_device_time", busy_and_slow)
    _skip_while_loop()
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    # 120 s budget / 45 s per attempt -> the 3rd attempt's check sees 135 s and stops.
    assert calls["n"] == 3, f"budget must cap the ladder well short of 12 (got {calls['n']})"
    assert capture.STATUS.get("devices", {}).get("H10", {}).get("clock_synced") is None


def test_the_budget_does_not_cut_a_fast_contention_recovery_short(tmp_path, monkeypatch):
    """The regression the budget must NOT cause. `InProgress` after a daemon restart clears in seconds —
    that is the 2026-07-18 failure the ladder exists for (both Polars unsynced for an evening). A budget
    that fired before contention could clear would re-break it."""
    _auto_sync_common(monkeypatch)
    calls = {"n": 0}
    clock = {"t": 0.0}
    monkeypatch.setattr(capture._time, "monotonic", lambda: clock["t"])
    async def busy_then_ok(addr):
        calls["n"] += 1
        clock["t"] += 2.0                       # a fast, realistic contention clear
        if calls["n"] < 4:
            raise RuntimeError("org.bluez.Error.InProgress")
    monkeypatch.setattr(capture, "sync_device_time", busy_then_ok)
    _skip_while_loop()
    _run(capture.run_polar(_pdev(), str(tmp_path)))
    assert calls["n"] == 4, "a fast contention clear must still be waited out"
    assert capture.STATUS["devices"]["H10"].get("clock_synced")


def test_the_budget_is_measured_monotonically():
    """`_now()` is civil-time-anchored and re-anchors on an NTP step — which this daemon does, twice in
    one week on the live box. An elapsed-time bound read off it could go negative or jump."""
    import inspect
    src = inspect.getsource(capture.auto_sync_clock)
    assert "_time.monotonic()" in src, "elapsed time must come from a monotonic source"
    assert "_now()" not in src.split("started =")[1].split("for attempt")[0]


# ══ PRESENCE PRE-CHECK — absence must not cost the global lock (2026-08-09) ═══════════════════════════
# #1062 stopped the ladder at attempt 1 for an absent device and works — but the deferral lands AFTER a
# 45 s doomed connect that held _CONNECT_LOCK the whole time. Measured on the box: 53 % duty cycle even
# with the ladder fixed. Absence is a scan; it was being paid for at connect-timeout prices.

def _offline_env(monkeypatch, on_air, connected=False):
    """polar_offline_op with the adapter/slot machinery stubbed and the scanner answering `on_air`."""
    capture.STATUS.setdefault("devices", {})["H10"] = {"address": "AA:BB", "connected": connected}
    monkeypatch.setattr(capture, "_device_on_air", lambda a, b: _aio_val(on_air))
    monkeypatch.setattr(capture, "adapter_hci", lambda: _aio_val("hci0"))
    return {"took_lock": False}


def _aio_val(v):
    async def _c(): return v
    return _c()


def test_an_absent_device_never_takes_the_connect_lock(monkeypatch):
    """THE FIX. The op must not run and the global lock must not be touched — the whole cost is a scan."""
    _offline_env(monkeypatch, on_air=False)
    ran = {"op": False}
    async def op(): ran["op"] = True
    async def go():
        return await capture.polar_offline_op("AA:BB", op, presence_check_s=1.0)
    with pytest.raises(capture.DeviceNotAdvertising):
        _run(go())
    assert ran["op"] is False, "the op must not run for an absent device"
    assert not capture._CONNECT_LOCK.locked()
    assert "AA:BB" not in capture._POLAR_PAUSED, "capture must never have been paused"


def test_the_absence_error_flows_through_the_existing_predicates(monkeypatch):
    """Deliberate: a bespoke class no predicate recognised would be a THIRD way to be wrong about a
    string. `auto_sync_clock` must defer on it and the reconnect loop must keep looking.

    ⚠️ Asserts on the exception the CODE ACTUALLY RAISES, not one this test writes. The first version
    constructed its own message and passed happily while a mutant rewrote the real raise site to a
    message no predicate matches — the exact 'assertion encodes shape, not contract' failure, caught by
    re-applying that mutant."""
    _offline_env(monkeypatch, on_air=False)
    async def op(): pass
    async def go():
        return await capture.polar_offline_op("AA:BB", op, presence_check_s=1.0)
    with pytest.raises(capture.DeviceNotAdvertising) as ei:
        _run(go())
    e = ei.value
    assert capture.device_absent_error(e) is True, f"the RAISED message must read as absence: {e!r}"
    assert capture.transient_ble_error(e) is True, f"and as transient: {e!r}"


def test_the_presence_check_runs_BEFORE_anything_exclusive_is_taken():
    """Structural, because ordering is the entire value. Moving the check below `offline_lock.slot()`
    would keep every test above green while restoring the 45 s-under-lock cost it exists to remove."""
    import inspect
    # CODE, not prose. The comment above the check names all three of these while explaining why they
    # must come after it — so a whole-source scan finds them FIRST and fails on correct code. (It did.)
    src = "\n".join(l for l in inspect.getsource(capture.polar_offline_op).splitlines()
                    if l.strip() and not l.lstrip().startswith("#"))
    i_check = src.index("presence_check_s and not")
    for taken in ("offline_lock.slot(", "_POLAR_PAUSED.add(", "_CONNECT_LOCK"):
        assert i_check < src.index(taken), f"presence check must precede {taken}"


def test_a_present_device_proceeds_normally(monkeypatch):
    _offline_env(monkeypatch, on_air=True)
    ran = {"op": False}
    async def op():
        ran["op"] = True
        return "result"
    async def go():
        return await capture.polar_offline_op("AA:BB", op, presence_check_s=1.0)
    assert _run(go()) == "result"
    assert ran["op"] is True


def test_an_UNANSWERABLE_scan_proceeds_rather_than_skipping(monkeypatch):
    """FAILS SAFE. `_device_on_air` returns None when it cannot ask — a broken scanner, a missing bleak,
    a busy adapter. None is not False: the caller must do exactly what it did before, or a scan outage
    silently stops every clock sync on the box."""
    _offline_env(monkeypatch, on_air=None)
    ran = {"op": False}
    async def op(): ran["op"] = True
    async def go():
        return await capture.polar_offline_op("AA:BB", op, presence_check_s=1.0)
    _run(go())
    assert ran["op"] is True, "an unanswerable presence question must not skip the op"


def test_a_CONNECTED_device_is_never_scanned_for(monkeypatch):
    """A connected device does not advertise, so scanning for one would 'prove' absence about the single
    case that is certainly present — and would skip the op for the device most obviously reachable."""
    _offline_env(monkeypatch, on_air=False, connected=True)
    ran = {"op": False}
    async def op(): ran["op"] = True
    async def go():
        return await capture.polar_offline_op("AA:BB", op, presence_check_s=1.0)
    _run(go())
    assert ran["op"] is True, "a connected device must skip the presence check, not the op"


def test_the_check_is_OPT_IN_so_user_pulls_are_unchanged(monkeypatch):
    """A person who pressed a button has information a 6 s sample does not, and must not be
    second-guessed by it. Only the unattended clock sync opts in."""
    _offline_env(monkeypatch, on_air=False)
    ran = {"op": False}
    async def op(): ran["op"] = True
    async def go():
        return await capture.polar_offline_op("AA:BB", op)      # no presence_check_s
    _run(go())
    assert ran["op"] is True, "without presence_check_s the behaviour must be exactly as before"


def test_only_the_clock_sync_call_site_opts_in():
    """Pins the wiring: if a future edit passes presence_check_s from the pull path, a user-clicked pull
    starts silently skipping on a bad scan."""
    src = module_source("capture.py")
    sites = [l for l in src.splitlines() if "presence_check_s=" in l and "def " not in l]
    assert len(sites) == 1, f"exactly one caller may opt in, found: {sites}"
    assert "_CLOCK_SYNC_PRESENCE_S" in sites[0]


# ── the arrival sidecar's failure paths (PAT-PACKET-ARRIVAL §3) ─────────────────────────────────────
def test_run_polar_swallows_a_raising_arrival_writer(tmp_path, monkeypatch):
    """A failing arrival sidecar must NOT disturb the data callback, and must not cost the ECG file.

    The write is wrapped in a bare `except Exception` on purpose — telemetry can never be allowed to
    break capture — which is exactly why the failure is otherwise invisible and why `alerts.arrival_canary`
    exists to notice it. This pins the swallow; the canary tests pin the noticing.
    """
    _polar_common(monkeypatch)

    class _Boom(capture.PmdArrivalLogWriter):
        def write(self, *a, **k):
            raise RuntimeError("sidecar disk full")

    monkeypatch.setattr(capture, "PmdArrivalLogWriter", _Boom)
    c = FlexPolarClient(data_frames=[_ecg_frame()], start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(streams=["ecg"]), str(tmp_path)))
    assert list((tmp_path / "captures").rglob("*_ECG.txt")), "a raising sidecar cost the ECG capture"


def test_run_polar_writes_the_arrival_sidecar(tmp_path, monkeypatch):
    """The happy path: one PMD frame yields one arrival row carrying the packet's own device stamps."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[_ecg_frame()], start_status=0x00)
    _inject_connect(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(_pdev(streams=["ecg"]), str(tmp_path)))
    found = list((tmp_path / "captures").rglob("*_PMDARRIVAL.csv"))
    assert found, "no arrival sidecar was written"
    lines = found[0].read_text().splitlines()
    assert lines[0].startswith("Phone timestamp;device;meas;first_sensor_ns")
    assert len(lines) >= 2, "the sidecar has a header but no rows"
    # `pmd.MEAS_NAME` is lower-case; asserted as it actually is rather than as assumed
    assert lines[1].split(";")[2] == "ecg"


def test_run_oxyii_writes_the_arrival_sidecar(tmp_path, monkeypatch):
    """The ring gets the same arrival pairing as the Polars, from `duration` — its only device clock.

    The ring exposes no `sensor_ns` on any streaming opcode, but `duration` (seconds into its session)
    measures 1-55 ppm against the host, so pairing it with the true frame arrival gives the ring an
    offset estimator too. ⚠️ 1 s quantised, so it must be FITTED, not min-filtered — which is why the
    `meas` column names it and nightqc refuses to floor-judge it.
    """
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _o2ring_live_reply()) if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    found = list((tmp_path / "captures").rglob("*_PMDARRIVAL.csv"))
    assert found, "the ring wrote no arrival sidecar"
    lines = found[0].read_text().splitlines()
    assert len(lines) >= 2 and lines[1].split(";")[2] == "OXYLIVE_DURATION_S", lines[:2]


def test_run_oxyii_swallows_a_raising_arrival_writer(tmp_path, monkeypatch):
    """A failing sidecar must not cost the SpO2 capture — telemetry never disturbs the data path.

    Its own test rather than a second run inside the previous one: two runner invocations in one test
    share `_stop_after`'s counter and the module globals, and the second silently produced nothing —
    which read as a swallow failure when it was fixture bleed.
    """
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()

    class _Boom(capture.PmdArrivalLogWriter):
        def write(self, *a, **k):
            raise RuntimeError("sidecar disk full")

    monkeypatch.setattr(capture, "PmdArrivalLogWriter", _Boom)
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _o2ring_live_reply()) if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    assert list((tmp_path / "captures").rglob("*_SPO2.csv")), "a raising sidecar cost the SpO2 capture"


def test_the_autopull_gate_now_asks_on_body_not_worn_alone():
    """§4 of CAPTURE-HOST-UNWIRED-MACHINERY: the same rule was written twice and only one copy checked
    `charging`. A docked ring reporting contact would have blocked its own backup pull — at the one
    moment it is free to run, which is the exact complaint `blocking_devices`' docstring records from
    2026-07-26: "the gate was unreachable on any evening the sensors were charging, which is precisely
    when a pull is safest"."""
    from tests._srcscan import function_source, strip_comments
    # ⚠️ BOUNDED ON THE FUNCTION, NOT ON A BYTE WINDOW. This used to slice `code[i:i + 4000]`, and the
    # function is 4907 chars — so the window was ALREADY cutting off its last 907 characters, and the
    # `not in` assertion below was guarding only 82 % of the code it names. A negative assertion under
    # a short window fails OPEN: the forbidden text drifts past the edge and the guard silently stops
    # guarding, which is worse than the false RED a positive assertion would have given.
    #
    # `function_source` also subsumes the anchor note this replaced: it resolves the DEFINITION via
    # `ast`, so it cannot land on the earlier docstring mention of the name.
    #
    # Comments still stripped — the block carries a long one naming on_body, and a source scan that
    # reads comments asserts the documentation rather than the code (learned 2026-08-14, twice).
    seg = strip_comments(function_source("capture.py", "autopull_poller"))
    assert "on_body(st) is True" in seg, "the auto-pull gate must route through the shared predicate"
    assert 'st.get("worn") is True' not in seg, "…and must not keep the old worn-only test beside it"


# ── SHUTDOWN REACHES THE HOLD LOOPS — with a REAL sleep (RUN-POLAR-MUTATION-STOP-HERE §5) ───────────
# §5 asked whether the sweep's 13 loop-condition TIMEOUTS were real non-termination or an artefact of
# `_stop_after`, which patches `asyncio.sleep` to a no-op — the hypothesis being that a loop which no
# longer awaits a real sleep never sees `_STOP`.
#
# MEASURED 2026-08-15 by running the real `run_polar` under the REAL `asyncio.sleep` with a real
# deadline, one mutant at a time. THE HYPOTHESIS IS REFUTED, and the answer is not uniform:
#
#   site           mutant                                    real sleep + _STOP set
#   hold loop      `client.is_connected and not _STOP` → or  HUNG   (exits only once the link drops)
#   pause loop     `(paused or recovering) and not _STOP`→or  EXITED — the siblings were false
#   pause loop     …the same mutant with the pause HELD       HUNG
#
# So the operator is not what decides it. **A `… and not _STOP.is_set()` → `or` mutant is REAL exactly
# when its SIBLING condition can still be true at shutdown**, because `or` then makes `_STOP`
# unreachable. For the hold loop the sibling is `client.is_connected`, which is true by definition
# during a session and is cleared only by the `finally` AFTER the loop — so nothing inside the process
# can end it. For the pause loop the sibling is transient, which is why the same mutation is inert in
# the ordinary path and fatal when a pull owns the link at shutdown.
#
# These two tests pin the property that makes the difference: SHUTDOWN MUST REACH THE LOOP. They use a
# real sleep deliberately — under `_stop_after` they would pass against the mutant, which is the whole
# finding — and `_run_bounded` so a regression FAILS instead of hanging the suite.
def _stop_shortly(cap, after=0.05):
    """A task that sets `_STOP` on the real clock — the shutdown a running daemon actually receives."""
    async def go():
        await asyncio.sleep(after)
        cap._STOP.set()
    return go


def test_stop_ends_a_live_session_even_with_a_real_sleep(tmp_path, monkeypatch):
    """The connected hold loop must exit on `_STOP` WITHOUT waiting for the link to drop. The mutant
    that makes `client.is_connected` the sole exit condition hangs here — measured, not assumed."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[], start_status=0x00)
    _inject_connect(monkeypatch, c)
    capture._STOP.clear()

    async def go():
        t = asyncio.create_task(_stop_shortly(capture)())
        try:
            await capture.run_polar(_pdev(), str(tmp_path))
        finally:
            t.cancel()
    try:
        _run_bounded(go(), 6.0)                      # returns ⇒ shutdown reached the loop
    finally:
        capture._STOP.set()
    assert c.is_connected, "it must exit on _STOP, not by waiting for the link to go down"


def test_stop_ends_a_PAUSED_session_even_with_a_real_sleep(tmp_path, monkeypatch):
    """The mirror case, and the one the standard arms miss: while a pull owns the link the pause loop's
    sibling condition is TRUE, so an `or` mutant makes `_STOP` unreachable there too. A run that never
    pauses cannot see this — the sweep's own scenario is what made the mutant look inert."""
    _polar_common(monkeypatch)
    c = FlexPolarClient(data_frames=[], start_status=0x00)
    _inject_connect(monkeypatch, c)
    capture._STOP.clear()
    dev = _pdev()
    capture._POLAR_PAUSED.add(dev["address"])        # a pull owns the link, and never lets go

    async def go():
        t = asyncio.create_task(_stop_shortly(capture)())
        try:
            await capture.run_polar(dev, str(tmp_path))
        finally:
            t.cancel()
    try:
        _run_bounded(go(), 6.0)
    finally:
        capture._STOP.set()
        capture._POLAR_PAUSED.clear()


# ── run_oxyii: RTC readback + monitor-queued settings writes (2026-08-19) ───────────────────────────
import datetime as _dt


def _o2_info_reply(y=2026, mo=8, d=19, h=21, mi=50, s=0):
    p = bytearray(60)
    p[9:17] = b"2D010002"
    p[24:31] = bytes([y & 0xFF, (y >> 8) & 0xFF, mo, d, h, mi, s])
    return oxyii.encode(oxyii.OP_GET_INFO, bytes(p))


def _o2_config_reply(brightness=0, motor=60):
    p = bytearray(40)
    p[1], p[2], p[3] = 88, 50, 120
    p[4], p[7], p[8] = motor, brightness, 1
    return oxyii.encode(oxyii.OP_GET_CONFIG, bytes(p))


def _o2_ring_responder(c, cfg_state):
    """A ring that answers live, info, and config — and APPLIES a 0x01 settings write to cfg_state
    (write-field 9 → brightness, 6 → motor), exactly as the real firmware was measured to."""
    def on(data):
        op = data[1]
        if op == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
        elif op == oxyii.OP_GET_INFO:
            c.notify(0, _o2_info_reply(mi=50, s=0))
        elif op == oxyii.OP_GET_CONFIG:
            c.notify(0, _o2_config_reply(**cfg_state))
        elif op == oxyii.OP_GET_BATTERY:
            c.notify(0, oxyii.encode(oxyii.OP_GET_BATTERY, bytes([0, 100, 0xF2, 0x10])))
        elif op == oxyii.OP_SET_CONFIG:
            fld, val = data[7], data[11]
            if fld == 9:
                cfg_state["brightness"] = val
            elif fld == 6:
                cfg_state["motor"] = val
    return on


def test_ring_clock_offset_is_component_arithmetic():
    rtc = {"year": 2026, "month": 8, "day": 19, "hour": 19, "minute": 48, "second": 26}
    assert capture.ring_clock_offset_s(rtc, _dt.datetime(2026, 8, 19, 19, 48, 26)) == 0
    assert capture.ring_clock_offset_s(rtc, _dt.datetime(2026, 8, 19, 19, 48, 25)) == 1
    assert capture.ring_clock_offset_s(rtc, _dt.datetime(2026, 8, 19, 19, 49, 0)) == -34


def test_queue_ring_config_validates_at_enqueue():
    """Nothing invalid may sit in the queue waiting for a link: the whitelist raises HERE."""
    import pytest
    capture._OXYII_CFG_PENDING.clear()
    with pytest.raises(ValueError):
        capture.queue_ring_config("AA:BB:CC:DD:EE:FF", "factory_reset", 1)
    with pytest.raises(ValueError):
        capture.queue_ring_config("AA:BB:CC:DD:EE:FF", "brightness", 3)
    assert capture._OXYII_CFG_PENDING == {}, "a refused write must leave no queue entry"
    capture.queue_ring_config("AA:BB:CC:DD:EE:FF", "brightness", 1)
    capture.queue_ring_config("AA:BB:CC:DD:EE:FF", "brightness", 2)   # last click wins
    assert capture._OXYII_CFG_PENDING["AA:BB:CC:DD:EE:FF"] == ("brightness", 2)
    capture._OXYII_CFG_PENDING.clear()


def test_run_oxyii_publishes_the_ring_rtc_offset(tmp_path, monkeypatch):
    """The session's first poll reads GET_INFO; on_data publishes ring-vs-host offset to STATUS."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_CFG_PENDING.clear()
    c = FakeGattClient()
    c.on_live = _o2_ring_responder(c, {"brightness": 0, "motor": 60})
    _inject_connect_scan(monkeypatch, c)
    monkeypatch.setattr(capture, "_now", lambda: _dt.datetime(2026, 8, 19, 21, 50, 5))
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert st["ring_rtc_offset_s"] == -5.0            # ring reads 21:50:00 vs host 21:50:05
    assert st["ring_rtc_read"].startswith("2026-08-19T21:50")
    # the session-start config read populated the struct without any write happening
    assert st["ring_config"]["brightness"] == 0 and st["ring_config"]["motor"] == 60


# ── run_oxyii: IDENTITY from the same 0xE1 reply (VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT §6.2 Mitigation C) ──
def _o2_info_reply_from(serial: str, fw: bytes = b"2D010002"):
    """A GET_INFO reply carrying a WIRE serial at [37]/[38:], as the real ring lays it out."""
    p = bytearray(60)
    p[9:17] = fw
    p[24:31] = bytes([2026 & 0xFF, 2026 >> 8, 8, 19, 21, 50, 0])
    sn = serial.encode("ascii")
    p[37] = len(sn)
    p[38:38 + len(sn)] = sn
    return oxyii.encode(oxyii.OP_GET_INFO, bytes(p))


def _o2_identity_responder(c, serial, fw: bytes = b"2D010002"):
    def on(data):
        op = data[1]
        if op == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
        elif op == oxyii.OP_GET_INFO:
            c.notify(0, _o2_info_reply_from(serial, fw))
    return on


def _run_ring_session(tmp_path, monkeypatch, dev, serial_on_air, fw: bytes = b"2D010002"):
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture.STATUS["devices"].pop("Ring", None)
    c = FakeGattClient()
    c.on_live = _o2_identity_responder(c, serial_on_air, fw)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(dev, str(tmp_path)))
    return capture.STATUS["devices"]["Ring"]


def test_run_oxyii_PUBLISHES_the_wire_serial_and_firmware_it_used_to_drop(tmp_path, monkeypatch):
    """Until 2026-09-05 parse_get_info's serial/firmware were computed in on_data and kept by nobody."""
    st = _run_ring_session(tmp_path, monkeypatch, _o2dev(), "2592302100")
    assert st["ring_serial"] == "2592302100"
    assert st["ring_firmware"] == "2D010002"
    assert st["ring_identity_mismatch"] is None, "no `serial:` configured — the check is inert, not firing"


def test_run_oxyii_a_MATCHING_configured_serial_publishes_no_mismatch(tmp_path, monkeypatch):
    st = _run_ring_session(tmp_path, monkeypatch, _o2dev(serial=2592302100), "2592302100")  # YAML int
    assert st["ring_identity_mismatch"] is None


def test_run_oxyii_a_WRONG_RING_is_flagged_in_STATUS_and_the_journal(tmp_path, monkeypatch, caplog):
    """The impostor shape: the peer at the configured address answers 0xE1 with a different serial. It
    streams SpO₂ like the real ring, so every other field reads healthy — this flag is the only one
    that can say the link is the wrong device. ERROR in the journal on the transition, once."""
    import logging
    caplog.set_level(logging.ERROR, logger="tepna-capture")
    st = _run_ring_session(tmp_path, monkeypatch, _o2dev(serial="2592302100"), "2592399999")
    assert st["ring_serial"] == "2592399999"
    assert st["ring_identity_mismatch"], "a wrong serial must publish the mismatch"
    assert "2592399999" in st["ring_identity_mismatch"] and "2592302100" in st["ring_identity_mismatch"]
    hits = [r for r in caplog.records if "RING IDENTITY MISMATCH" in r.getMessage()]
    assert len(hits) == 1, f"journal on the TRANSITION only, got {len(hits)}"


def test_run_oxyii_journals_a_PERSISTING_mismatch_once_not_per_readback(tmp_path, monkeypatch, caplog):
    """GET_INFO is re-read every _OXYII_INFO_EVERY_S all night. A wrong ring that stays connected would
    otherwise write an ERROR line per readback — hours of identical lines that bury the one that matters.
    The journal gets the TRANSITION; STATUS carries the standing state. Planted: dropping the guard
    survived the single-read tests above, so this one forces several readbacks in one session."""
    import logging
    caplog.set_level(logging.ERROR, logger="tepna-capture")
    monkeypatch.setattr(capture, "_OXYII_INFO_EVERY_S", 0)          # re-read on every loop pass
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture.STATUS["devices"].pop("Ring", None)
    c = FakeGattClient()
    served = {"info": 0}
    inner = _o2_identity_responder(c, "2592399999")
    def on(data):
        if data[1] == oxyii.OP_GET_INFO:
            served["info"] += 1
        inner(data)
    c.on_live = on
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 6)
    _run(capture.run_oxyii(_o2dev(serial="2592302100"), str(tmp_path)))
    assert served["info"] >= 2, f"the fixture must exercise repeated readbacks; served {served['info']}"
    hits = [r for r in caplog.records if "RING IDENTITY MISMATCH" in r.getMessage()]
    assert len(hits) == 1, f"{served['info']} readbacks of one persisting mismatch must journal ONCE, got {len(hits)}"
    assert capture.STATUS["devices"]["Ring"]["ring_identity_mismatch"], "…while STATUS keeps carrying it"


def test_run_oxyii_a_peer_with_NO_serial_against_a_configured_one_is_a_mismatch(tmp_path, monkeypatch):
    """A 60-byte reply with an empty serial field (the unset-RTC fixture's shape) is not a pass when the
    operator has said which ring to expect."""
    st = _run_ring_session(tmp_path, monkeypatch, _o2dev(serial="2592302100"), "")
    assert st["ring_serial"] is None, "an empty serial is published as absence, not as ''"
    assert st["ring_identity_mismatch"] and "no serial at all" in st["ring_identity_mismatch"]


def test_alert_poller_carries_an_identity_mismatch_to_the_webhook_ONCE_and_clears_on_match(monkeypatch):
    """The wrong ring is `recording`, so the offline path never speaks — the identity clause must. One
    webhook per episode, latched on delivery; the latch clears when the mismatch clears so a later wrong
    ring alerts again."""
    sent = []
    class _N:
        enabled = True
        async def send(self, title, message, **kw): sent.append((title, message)); return True
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 1e9}, "devices": [_o2dev()]}
    st = {"connected": True, "ring_identity_mismatch": "connected peer reports '9', config expects '1'"}
    capture.STATUS["devices"]["Ring"] = st
    capture._LAST_DATA["Ring"] = 1000.0                  # streaming — a wrong ring records like the right one
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] == 3:
            st["ring_identity_mismatch"] = None           # the right ring is back
        if calls["n"] == 4:
            st["ring_identity_mismatch"] = "connected peer reports '8', config expects '1'"   # new episode
        if calls["n"] >= 5:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    _run(capture.alert_poller(cfg, _N()))
    capture._LAST_DATA.pop("Ring", None)
    titles = [t for t, _ in sent]
    assert titles == ["Tepna: ring identity mismatch", "Tepna: ring identity mismatch"], titles
    assert "'9'" in sent[0][1] and "'8'" in sent[1][1]
    assert "Ring" in sent[0][1]


def test_alert_poller_RETRIES_an_undelivered_identity_alert_next_poll(monkeypatch):
    """Latch on the OUTCOME (CAPTURE-HOST-DEEP-AUDIT §C1): a failed POST is retried, not remembered as told."""
    sent = []
    class _N:
        enabled = True
        async def send(self, title, message, **kw): sent.append(title); return len(sent) >= 2
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 1e9}, "devices": [_o2dev()]}
    capture.STATUS["devices"]["Ring"] = {"connected": True, "ring_identity_mismatch": "peer reports '9', config expects '1'"}
    capture._LAST_DATA["Ring"] = 1000.0
    _stop_after(monkeypatch, 4)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    _run(capture.alert_poller(cfg, _N()))
    capture._LAST_DATA.pop("Ring", None)
    assert sent == ["Tepna: ring identity mismatch"] * 2, f"one failed attempt, one delivery, then latched: {sent}"


def test_run_oxyii_unset_rtc_publishes_none_not_year_zero(tmp_path, monkeypatch):
    """Clock Contract §2.7 at the STATUS boundary: an unset RTC region is absence, never arithmetic."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    def on(data):
        op = data[1]
        if op == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
        elif op == oxyii.OP_GET_INFO:
            c.notify(0, oxyii.encode(oxyii.OP_GET_INFO, bytes(60)))   # zeros: unset RTC
    c.on_live = on
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert st["ring_rtc_offset_s"] is None
    assert st["ring_rtc_read"] is not None            # the READ happened; the value is honestly absent


def test_run_oxyii_applies_a_queued_settings_write_and_verifies_it(tmp_path, monkeypatch):
    """queue_ring_config → the live loop sends 0x01 + a 0x00 read-back → on_data publishes the verdict
    from what the RING reports. The fake ring APPLIES the write, so the verdict must be 'applied'."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_CFG_PENDING.clear()
    dev = _o2dev()
    cfg_state = {"brightness": 0, "motor": 60}
    c = FakeGattClient()
    c.on_live = _o2_ring_responder(c, cfg_state)
    _inject_connect_scan(monkeypatch, c)
    capture.queue_ring_config(dev["address"], "brightness", 2)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(dev, str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert cfg_state["brightness"] == 2, "the write must actually reach the ring"
    assert st["ring_config"]["brightness"] == 2
    assert st["ring_config_verdict"] == "brightness=2 applied"
    assert capture._OXYII_CFG_PENDING == {}, "a sent write must not requeue"


def test_run_oxyii_reports_a_settings_write_the_ring_ignored(tmp_path, monkeypatch, caplog):
    """The ring acks nothing and applies nothing: the verdict must say NOT applied, loudly."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_CFG_PENDING.clear()
    dev = _o2dev()
    c = FakeGattClient()
    def on(data):
        op = data[1]
        if op == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
        elif op == oxyii.OP_GET_INFO:
            c.notify(0, _o2_info_reply())
        elif op == oxyii.OP_GET_CONFIG:
            c.notify(0, _o2_config_reply(brightness=0))     # never changes — the write was ignored
    c.on_live = on
    _inject_connect_scan(monkeypatch, c)
    capture.queue_ring_config(dev["address"], "brightness", 2)
    _stop_after(monkeypatch, 4)
    with caplog.at_level("WARNING"):
        _run(capture.run_oxyii(dev, str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert "NOT applied" in st["ring_config_verdict"]
    assert any("did not land" in r.getMessage() for r in caplog.records)


def test_run_oxyii_settings_write_failure_surfaces_in_the_verdict(tmp_path, monkeypatch):
    """The 0x01 write itself raises: the verdict says so instead of silently retrying forever."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_CFG_PENDING.clear()
    dev = _o2dev()
    c = FakeGattClient()
    real_write = c.write_gatt_char
    async def write(char, data, response=False):
        if data[1] == oxyii.OP_SET_CONFIG:
            raise RuntimeError("gatt refused")
        await real_write(char, data, response)
    c.write_gatt_char = write
    def on(data):
        if data[1] == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
    c.on_live = on
    _inject_connect_scan(monkeypatch, c)
    capture.queue_ring_config(dev["address"], "brightness", 1)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(dev, str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert "write failed" in st["ring_config_verdict"]
    assert capture._OXYII_CFG_PENDING == {}


def test_run_oxyii_rtc_poll_failure_costs_only_the_reading(tmp_path, monkeypatch):
    """The GET_INFO write raises: vitals continue, the link survives, no offset is published."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_CFG_PENDING.clear()
    c = FakeGattClient()
    real_write = c.write_gatt_char
    async def write(char, data, response=False):
        if data[1] == oxyii.OP_GET_INFO:
            raise RuntimeError("gatt refused the info read")
        await real_write(char, data, response)
    c.write_gatt_char = write
    def on(data):
        if data[1] == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
    c.on_live = on
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert st["spo2"] == 96, "vitals must survive a failed optional read"
    assert st.get("ring_rtc_offset_s") is None and st.get("ring_rtc_read") is None


def test_run_oxyii_unparseable_config_reply_publishes_nothing(tmp_path, monkeypatch):
    """A short 0x00 reply parses to None: no ring_config, no verdict — never a partial struct."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_CFG_PENDING.clear()
    c = FakeGattClient()
    def on(data):
        op = data[1]
        if op == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
        elif op == oxyii.OP_GET_INFO:
            c.notify(0, _o2_info_reply())
        elif op == oxyii.OP_GET_CONFIG:
            c.notify(0, oxyii.encode(oxyii.OP_GET_CONFIG, bytes(4)))    # 4 B — too short to parse
    c.on_live = on
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert st.get("ring_config") is None and st.get("ring_config_verdict") is None
def test_run_polar_resumes_a_recent_fileset(tmp_path, monkeypatch, caplog):
    """CAPTURE-FILESET-RESUME §2 wiring: when this device's newest set wrote within the window, the
    runner adopts its stamp — so every capture_filename() regenerates the identical names. Tested at
    the decision point (resumable_stamp is consulted and `started` replaced) rather than by driving the
    whole BLE stack: the writers' append behaviour has its own tests."""
    import datetime as dt
    calls = {}

    def spy(ndir, vendor, model, device_id, now, window):
        calls["args"] = (vendor, model, device_id, window)
        return dt.datetime(2026, 8, 19, 21, 0, 0)
    monkeypatch.setattr(capture, "resumable_stamp", spy)

    async def _bonded(addr, adapter, force=False):
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", _bonded)
    monkeypatch.setattr(capture.bonding, "is_bonded", _bonded)

    async def _no_sync(name, addr, root=None):
        return None                        # the real one runs a ~30 s BLE discovery — not in a unit test
    monkeypatch.setattr(capture, "auto_sync_clock", _no_sync)
    def _no_ble(addr):
        raise RuntimeError("stop before BLE")   # _connect is the first thing after the resume decision
    monkeypatch.setattr(capture, "_connect", _no_ble)
    monkeypatch.setattr(capture, "night_dir", lambda root, when: str(tmp_path))
    dev = {"name": "H10", "address": "C2:11:44:AB:9E:01", "vendor": "Polar",
           "model": "H10", "device_id": "02849638", "streams": ["ecg"]}
    _stop_after(monkeypatch, 1)
    with caplog.at_level("INFO"):
        _run(capture.run_polar(dev, str(tmp_path)))
    assert calls["args"] == ("Polar", "H10", "02849638", capture._RESUME_WINDOW_S)
    msgs = [r.getMessage() for r in caplog.records]
    assert any("resuming file-set 20260819210000" in m for m in msgs), \
        f"the adopt decision must be logged: {[m for m in msgs if 'resum' in m.lower()]}"


def test_run_polar_resume_disabled_by_zero_window(tmp_path, monkeypatch):
    """DENY twin: write.resume_window_sec 0 must not even consult the resolver."""
    consulted = []
    monkeypatch.setattr(capture, "resumable_stamp", lambda *a: consulted.append(a))

    async def _bonded(addr, adapter, force=False):
        return True
    monkeypatch.setattr(capture.bonding, "ensure_bonded", _bonded)
    monkeypatch.setattr(capture.bonding, "is_bonded", _bonded)

    async def _no_sync(name, addr, root=None):
        return None                        # the real one runs a ~30 s BLE discovery — not in a unit test
    monkeypatch.setattr(capture, "auto_sync_clock", _no_sync)

    def _no_ble(addr):
        raise RuntimeError("stop before BLE")   # _connect is the first thing after the decision
    monkeypatch.setattr(capture, "_connect", _no_ble)
    monkeypatch.setattr(capture, "night_dir", lambda root, when: str(tmp_path))
    monkeypatch.setattr(capture, "_RESUME_WINDOW_S", 0.0)
    dev = {"name": "H10", "address": "C2:11:44:AB:9E:01", "vendor": "Polar",
           "model": "H10", "device_id": "02849638", "streams": ["ecg"]}
    _stop_after(monkeypatch, 1)
    _run(capture.run_polar(dev, str(tmp_path)))
    assert consulted == [], "window 0 must not consult the resolver"


def test_run_oxyii_fires_a_queued_buzz_exactly_once(tmp_path, monkeypatch):
    """queue_ring_buzz → ONE 0x83 on the next poll, the command instant published to STATUS. Exactly
    one: the fiducial is a marker, and a repeat would write a second artifact into every stream."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_BUZZ_PENDING.clear()
    dev = _o2dev()
    c = FakeGattClient()
    c.on_live = _o2_ring_responder(c, {"brightness": 0, "motor": 60})
    _inject_connect_scan(monkeypatch, c)
    capture.queue_ring_buzz(dev["address"])
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(dev, str(tmp_path)))
    buzzes = [w for w in c.writes if w[1] == 0x83]
    assert len(buzzes) == 1, f"exactly ONE buzz frame, got {len(buzzes)}"
    assert capture.STATUS["devices"]["Ring"]["ring_buzz_at"] is not None
    assert capture._OXYII_BUZZ_PENDING == set()


def test_run_oxyii_buzz_write_failure_is_reported_not_retried(tmp_path, monkeypatch, caplog):
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_BUZZ_PENDING.clear()
    dev = _o2dev()
    c = FakeGattClient()
    real_write = c.write_gatt_char
    async def write(char, data, response=False):
        if data[1] == 0x83:
            raise RuntimeError("gatt refused the buzz")
        await real_write(char, data, response)
    c.write_gatt_char = write
    def on(data):
        if data[1] == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
    c.on_live = on
    _inject_connect_scan(monkeypatch, c)
    capture.queue_ring_buzz(dev["address"])
    _stop_after(monkeypatch, 4)
    with caplog.at_level("WARNING"):
        _run(capture.run_oxyii(dev, str(tmp_path)))
    assert capture.STATUS["devices"]["Ring"]["ring_buzz_at"] is None
    assert any("buzz command failed" in r.getMessage() for r in caplog.records)
    assert capture._OXYII_BUZZ_PENDING == set(), "a failed buzz must not silently retry forever"


# ── the ring-clock sidecar (RTCLOG): drift history, push claims, reset detection ────────────────────
def _rtclog_rows(tmp_path):
    files = list((tmp_path / "captures").rglob("*_RTCLOG.csv"))
    assert len(files) == 1, f"exactly one rtclog expected, got {files}"
    lines = files[0].read_text().splitlines()
    assert lines[0].startswith("Phone timestamp;event;rtc_offset_s;battery_state;battery_level")
    return [l.split(";") for l in lines[1:]]


def test_run_oxyii_writes_the_ring_clock_sidecar(tmp_path, monkeypatch):
    """A session writes read + battery rows (the first poll fires both), and the 0xC0 first-contact
    push writes its claim row — history on disk, not just the latest value in STATUS."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_LAST_RTC_OFF.clear()
    c = FakeGattClient()
    c.on_live = _o2_ring_responder(c, {"brightness": 0, "motor": 60})
    _inject_connect_scan(monkeypatch, c)
    monkeypatch.setattr(capture, "_now", lambda: _dt.datetime(2026, 8, 20, 5, 30, 5))
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    rows = _rtclog_rows(tmp_path)
    events = [r[1] for r in rows]
    assert "push" in events, "the first-contact 0xC0 must leave its claim row"
    assert "read" in events, "the readback row is the push's verification"
    assert "battery" in events
    read = next(r for r in rows if r[1] == "read")
    assert read[2] != "", "a decoded RTC read carries its offset"
    batt = next(r for r in rows if r[1] == "battery")
    assert batt[4] == "100" and batt[5] == "242" and batt[6] == "16", \
        "battery level + the ANALOG raw2 byte + const raw3 land as data, not assumptions"


def test_run_oxyii_flags_an_rtc_jump_as_a_battery_reset(tmp_path, monkeypatch, caplog):
    """The offset moved > _OXYII_RTC_JUMP_S between reads with no push of ours: reset-suspect is
    published, the sidecar rows say so, and the re-push is queued by clearing _OXYII_RTC_AT."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_LAST_RTC_OFF.clear()
    dev = _o2dev()
    capture._OXYII_LAST_RTC_OFF[dev["address"]] = 0.0     # a previous session read the RTC on time
    c = FakeGattClient()
    def on(data):
        op = data[1]
        if op == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
        elif op == oxyii.OP_GET_INFO:
            c.notify(0, _o2_info_reply(h=19, mi=0, s=0))   # ring says 19:00:00 — hours off the host
    c.on_live = on
    _inject_connect_scan(monkeypatch, c)
    monkeypatch.setattr(capture, "_now", lambda: _dt.datetime(2026, 8, 19, 21, 50, 0))
    _stop_after(monkeypatch, 4)
    with caplog.at_level("WARNING"):
        _run(capture.run_oxyii(dev, str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert st["ring_rtc_reset_suspect"] is not None
    assert any("RTC JUMPED" in r.getMessage() for r in caplog.records)
    assert dev["address"] not in capture._OXYII_RTC_AT, "the re-push must be queued (first-contact state)"
    rows = _rtclog_rows(tmp_path)
    assert any(r[1] == "reset-suspect" for r in rows)
    capture._OXYII_LAST_RTC_OFF.clear()


def test_run_oxyii_small_drift_is_a_read_not_a_reset(tmp_path, monkeypatch):
    """The DENY twin: a 1 s move between reads (quantum-level) must stay an ordinary read row."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_LAST_RTC_OFF.clear()
    dev = _o2dev()
    capture._OXYII_LAST_RTC_OFF[dev["address"]] = -6.0
    c = FakeGattClient()
    def on(data):
        op = data[1]
        if op == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
        elif op == oxyii.OP_GET_INFO:
            c.notify(0, _o2_info_reply(h=21, mi=49, s=55))   # host 21:50:00 → offset −5.0 (Δ=1.0 s)
    c.on_live = on
    _inject_connect_scan(monkeypatch, c)
    monkeypatch.setattr(capture, "_now", lambda: _dt.datetime(2026, 8, 19, 21, 50, 0))
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(dev, str(tmp_path)))
    st = capture.STATUS["devices"]["Ring"]
    assert st.get("ring_rtc_reset_suspect") is None
    rows = _rtclog_rows(tmp_path)
    assert any(r[1] == "read" for r in rows) and not any(r[1] == "reset-suspect" for r in rows)
    capture._OXYII_LAST_RTC_OFF.clear()


def test_run_oxyii_short_battery_reply_logs_blanks_not_fabrications(tmp_path, monkeypatch):
    """A 2-byte 0xE4 reply has no raw2/raw3: the sidecar row carries blanks, never invented bytes."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_LAST_RTC_OFF.clear()
    c = FakeGattClient()
    def on(data):
        op = data[1]
        if op == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
        elif op == oxyii.OP_GET_INFO:
            c.notify(0, _o2_info_reply())
        elif op == oxyii.OP_GET_BATTERY:
            c.notify(0, oxyii.encode(oxyii.OP_GET_BATTERY, bytes([0, 87])))   # state+level only
    c.on_live = on
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    rows = _rtclog_rows(tmp_path)
    batt = next(r for r in rows if r[1] == "battery")
    assert batt[4] == "87" and batt[5] == "" and batt[6] == ""


def test_run_oxyii_unparseable_battery_reply_writes_no_row(tmp_path, monkeypatch):
    """A 1-byte 0xE4 reply parses to None: no sidecar row at all — a row of blanks would claim a
    reading happened when nothing was decoded."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture._OXYII_LAST_RTC_OFF.clear()
    c = FakeGattClient()
    def on(data):
        op = data[1]
        if op == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
        elif op == oxyii.OP_GET_INFO:
            c.notify(0, _o2_info_reply())
        elif op == oxyii.OP_GET_BATTERY:
            c.notify(0, oxyii.encode(oxyii.OP_GET_BATTERY, bytes([0])))   # 1 byte — unparseable
    c.on_live = on
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    rows = _rtclog_rows(tmp_path)
    assert not any(r[1] == "battery" for r in rows)
    assert any(r[1] == "read" for r in rows), "the info read still lands — only the battery row is absent"


def test_run_oxyii_drains_the_raw_buffer_twice_per_cycle(tmp_path, monkeypatch):
    """The 0x05 SATURATION FIX (RAW-DUAL-WAVELENGTH §2.1, measured 2026-08-20): at a 1 Hz drain the raw
    buffer pins at its 102-record reply cap on 282,402 of 284,420 real buffers, silently losing the
    excess — so the runner must ask for it a SECOND time mid-cycle (~0.5 s drains stay under the cap,
    making capture complete and every night's counts a fill-rate measurement). The vitals cadence is
    untouched: 0x04 still rides the full cycle. Without the stream, no raw asks at all — and the loop
    keeps its original single sleep."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    counts = {"live": 0, "raw": 0}
    payload = (2).to_bytes(2, "little") + b"".join(
        a.to_bytes(4, "little") + b.to_bytes(4, "little") + bytes([m]) for a, b, m in [(1, 2, 0), (3, 4, 1)])

    c = FakeGattClient()

    def on_live(data):
        if data[1] == oxyii.OP_LIVE:
            counts["live"] += 1
            c.notify(0, _o2ring_live_reply())
        elif data[1] == oxyii.OP_RT_PPG:
            counts["raw"] += 1
            c.notify(0, oxyii.encode(oxyii.OP_RT_PPG, payload))

    c.on_live = on_live
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 8)
    _run(capture.run_oxyii(_o2dev(name="Ring", streams=["spo2", "ppg2w"]), str(tmp_path)))
    assert counts["live"] >= 2, f"the live loop must have cycled: {counts}"
    # two raw drains per completed cycle (one beside the vitals poll, one mid-sleep). The loop's tail
    # cycle can be cut by _STOP between the two asks, so allow exactly one straggler less.
    assert counts["raw"] >= 2 * counts["live"] - 1, f"raw drains must run 2x the vitals cadence: {counts}"

    # DENY twin: without the stream, zero raw asks (and no crash from the split-sleep branch).
    # Fresh _STOP: the first run's _stop_after left it SET, and an Event binds to the loop that made it.
    capture._STOP = asyncio.Event()
    counts2 = {"live": 0, "raw": 0}
    c2 = FakeGattClient()

    def on_live2(data):
        if data[1] == oxyii.OP_LIVE:
            counts2["live"] += 1
            c2.notify(0, _o2ring_live_reply())
        elif data[1] == oxyii.OP_RT_PPG:
            counts2["raw"] += 1
    c2.on_live = on_live2
    _inject_connect_scan(monkeypatch, c2)
    _stop_after(monkeypatch, 6)
    _run(capture.run_oxyii(_o2dev(name="Ring2", streams=["spo2"]), str(tmp_path)))
    assert counts2["live"] >= 2 and counts2["raw"] == 0, f"no raw stream -> no raw asks: {counts2}"


# ── G4 lifecycle wiring: the _oxy_emit helper + the run_oxyii emit paths ─────────────────────────────
def test_oxy_emit_is_guarded_and_writes_the_row_and_status(tmp_path):
    import oxy_lifecycle
    import writers
    lc = oxy_lifecycle.OxyLifecycle(device_id="d", session_id="s", mono=lambda: 1.0, wall=lambda: "W")
    w = writers.OxyLifeLogWriter(str(tmp_path / "OXYLIFE.csv"))
    capture._oxy_emit(lc, w, "RingX", oxy_lifecycle.OxyState.CONNECTING, "scan")
    w.close()
    assert lc.state is oxy_lifecycle.OxyState.CONNECTING
    assert capture.STATUS["devices"]["RingX"]["oxy_lifecycle"] == "connecting"
    assert "connecting" in (tmp_path / "OXYLIFE.csv").read_text()
    # an ILLEGAL edge is SKIPPED, not raised, and mutates nothing (the daemon must not die on it)
    capture._oxy_emit(lc, w, "RingX", oxy_lifecycle.OxyState.PULLING, "cannot pull from connecting")
    assert lc.state is oxy_lifecycle.OxyState.CONNECTING


def test_oxy_emit_tolerates_no_writer():
    import oxy_lifecycle
    lc = oxy_lifecycle.OxyLifecycle(mono=lambda: 1.0, wall=lambda: "W")
    capture._oxy_emit(lc, None, "RingY", oxy_lifecycle.OxyState.CONNECTING, "scan")   # writer=None
    assert capture.STATUS["devices"]["RingY"]["oxy_lifecycle"] == "connecting"


def test_run_oxyii_journals_a_paused_state(tmp_path, monkeypatch):
    capture._OXYII_PAUSE.set(); capture._RECOVER.clear()
    _stop_after(monkeypatch, 1)
    try:
        _run(capture.run_oxyii(_o2dev(name="RingP"), str(tmp_path)))
    finally:
        capture._OXYII_PAUSE.clear()
    assert capture.STATUS["devices"]["RingP"]["oxy_lifecycle"] == "shutting_down"


def test_run_oxyii_journals_an_adapter_recovery_state(tmp_path, monkeypatch):
    capture._OXYII_PAUSE.clear(); capture._RECOVER.set()
    _stop_after(monkeypatch, 1)
    try:
        _run(capture.run_oxyii(_o2dev(name="RingR"), str(tmp_path)))
    finally:
        capture._RECOVER.clear()
    assert capture.STATUS["devices"]["RingR"]["oxy_lifecycle"] == "shutting_down"


def test_run_oxyii_journals_an_interruption_on_a_stall(tmp_path, monkeypatch):
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()                          # NO live reply -> frames never advance -> the stall elif
    _inject_connect_scan(monkeypatch, c)
    monkeypatch.setattr(capture, "stream_is_stalled", lambda *a, **k: True)   # force the stall branch
    _stop_after(monkeypatch, 6)
    _run(capture.run_oxyii(_o2dev(name="RingS"), str(tmp_path)))
    life = (tmp_path / "captures").rglob("OXYLIFE.csv")
    txt = "".join(p.read_text() for p in life)
    assert "interrupted" in txt, "a stall must journal an INTERRUPTED transition"


def test_run_oxyii_absent_ring_does_not_claim_an_unflushed_arrival_tail(tmp_path, monkeypatch, caplog):
    """A ring that never advertises raises BEFORE any writer exists — so the finally must close
    nothing and, above all, must not report a tail it never opened.

    Observed on vigil 2026-09-01: BleakDeviceNotFoundError at connect, then a full traceback plus
    'the arrival writer did not close cleanly — its tail may be unflushed', once per reconnect for
    hours. `oxy_arr_wr` was the one writer missing from the pre-try None binding, so its close read an
    unbound local; the guard caught it and warned about data that was never written. The existing
    'recording mode' test could not see this: it asserts only that nothing propagated, which stayed
    true the whole time.
    """
    from bleak.exc import BleakDeviceNotFoundError
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()

    def _boom(addr, *a, **k):
        raise BleakDeviceNotFoundError("O2Ring not advertising (wear it finger-in + close the phone app)")

    monkeypatch.setattr(capture, "_connect_scan", _boom)
    _stop_after(monkeypatch, 1)
    with caplog.at_level(logging.WARNING):
        _run(capture.run_oxyii(_o2dev(name="RingGone"), str(tmp_path)))
    assert "BleakDeviceNotFoundError" in capture.STATUS["devices"]["RingGone"]["last_error"], \
        "the link error is still reported — this test must not pass by skipping the failure path"
    assert not any("arrival writer did not close" in r.getMessage() for r in caplog.records), \
        "no writer was opened, so there is no tail to warn about"
    assert not any(r.exc_info and r.exc_info[0] is UnboundLocalError for r in caplog.records), \
        "the finally must not read an unbound local"


def test_run_oxyii_still_warns_when_a_real_arrival_close_fails(tmp_path, monkeypatch, caplog):
    """The guard is not being removed: a writer that WAS opened and fails to close still warns,
    because that message describes a real unflushed tail."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()

    class _BadClose:
        rows = []
        def write(self, *a, **k): pass
        def close(self): raise OSError("disk went away")

    monkeypatch.setattr(capture, "PmdArrivalLogWriter", lambda *a, **k: _BadClose())
    c = FakeGattClient()
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 2)
    with caplog.at_level(logging.WARNING):
        _run(capture.run_oxyii(_o2dev(name="RingBad"), str(tmp_path)))
    assert any("arrival writer did not close" in r.getMessage() for r in caplog.records), \
        "a genuine close failure must still be reported"


# ── ring firmware revision (the observable the AES-session trigger needs) ────────────────────────────
def test_run_oxyii_publishes_the_rings_firmware_revision(tmp_path, monkeypatch):
    """The measured-plaintext firmware reaches STATUS and says nothing alarming."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_oxyii(_o2dev(name="RingFw"), str(tmp_path)))
    assert capture.STATUS["devices"]["RingFw"]["firmware"] == "2D010002"


def test_run_oxyii_publishes_DIS_as_a_diagnostic_and_does_NOT_gate_on_it(
        tmp_path, monkeypatch, caplog):
    """DIS IS NO LONGER THE GATE — residue `2026-09-05-dis-firmware-compared-to-a-branch-code`.

    This test previously fed a BRANCH-CODE-shaped string through the DIS Firmware Revision
    characteristic and required the AES warning, which encoded the defect: DIS 0x2A26 carries a
    firmware VERSION (`1.13.1.0`), not a branch code, so the old comparison could never be true on a
    ring that implements DIS — and this box's ring does not implement it at all, so the guard never
    ran on any link.

    The guard now keys on the branch code from GET_INFO, which every ring answers in our own
    handshake (`capture.aes_session_suspect`, unit-tested with the branch plants). DIS keeps
    publishing as a DIAGNOSTIC — a real version string is useful beside the branch — but it decides
    nothing.

    The premise the old test defended is unchanged and still holds: an AES session after AUTH surfaces
    as "connects, auths, no decoded frames", which reads as a bad link. Only the field that detects it
    was wrong."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient(); c.fw = b"1.13.1.0"      # a REAL DIS version string, as a DIS ring reports
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    with caplog.at_level(logging.WARNING):
        _run(capture.run_oxyii(_o2dev(name="RingNew"), str(tmp_path)))
    assert capture.STATUS["devices"]["RingNew"]["firmware"] == "1.13.1.0", \
        "the DIS string must still be published — it is a diagnostic, not a secret"
    msg = " ".join(r.getMessage() for r in caplog.records)
    assert "AES" not in msg, \
        "a DIS firmware version must not raise the AES-session warning: that comparison was the defect"


def test_run_oxyii_treats_an_unreadable_firmware_as_a_skip_not_a_lost_session(tmp_path, monkeypatch):
    """A ring that does not implement DIS must still record. And the field must stay ABSENT rather than
    becoming a fabricated 'unknown', which would read as a measurement that was taken."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient(); c.fw = RuntimeError("no such characteristic")
    c.on_live = lambda data: (c.notify(0, _o2ring_live_reply()) if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(name="RingNoDis"), str(tmp_path)))
    st = capture.STATUS["devices"]["RingNoDis"]
    assert "firmware" not in st, "an unread revision must be absent, never a fabricated value"
    assert st.get("spo2") is not None, "the session must survive a ring without DIS"


@pytest.mark.parametrize("raw,label", [(b"", "empty read"), (b"\x00\x00  ", "NUL/space padding")])
def test_run_oxyii_does_not_publish_an_empty_firmware_string(tmp_path, monkeypatch, raw, label):
    """A padded or empty DIS value is not a version. Same rule as above: absent beats fabricated.
    Both shapes are exercised because they leave the reader by DIFFERENT branches — a falsy read
    never reaches the decode, a padded one is only empty after stripping."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient(); c.fw = raw
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 1)
    _run(capture.run_oxyii(_o2dev(name="RingBlank"), str(tmp_path)))
    assert "firmware" not in capture.STATUS["devices"]["RingBlank"], f"{label} must publish nothing"


def test_run_oxyii_publishes_the_perfusion_index(tmp_path, monkeypatch):
    """PI is the field that says WHY an SpO2 reading is poor. It was parsed and written to the sidecar
    for weeks without ever being published, so no card could exist. Driven through the production
    callback rather than scanned for in the source."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    seen = []
    monkeypatch.setattr(capture.BUS, "push",
                        lambda stream, values, *a, **k: seen.append((stream, values)))
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, _o2ring_live_reply()) if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    assert [v for s, v in seen if s == "pi_o2"][:1] == [[1.4]], "pi is [7]/10, in percent"


def test_run_oxyii_treats_a_zero_perfusion_index_as_a_READING(tmp_path, monkeypatch):
    """0.0 is a real perfusion index — the ring reporting no usable pulse — and the guard is
    `is not None` precisely so it survives. A falsy-but-present value dropped by a truthiness test is
    how "no signal" becomes "no data", which are different facts.

    ⚠️ The frame is REBUILT, never patched in place: editing an encoded frame invalidates its CRC-8, so
    `decode()` drops it and nothing is published — which reads exactly like the guard working."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    seen = []
    monkeypatch.setattr(capture.BUS, "push",
                        lambda stream, values, *a, **k: seen.append((stream, values)))
    body = bytearray(24)
    body[5] = body[10] = 0x01
    body[6], body[8], body[13] = 96, 55, 90
    body[7] = 0                                     # the PI byte under test
    reply = oxyii.encode(oxyii.OP_LIVE, bytes(body))
    c = FakeGattClient()
    c.on_live = lambda data: (c.notify(0, reply) if data[1] == oxyii.OP_LIVE else None)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    assert [v for s, v in seen if s == "pi_o2"][:1] == [[0.0]], "a zero PI is a reading, not an absence"


def _o2ring_acc_reply(samples=((-2000, 16, 1000),)):
    body = bytearray(len(samples).to_bytes(2, "little"))
    for x, y, z in samples:
        for a in (x, y, z):
            body += int(a).to_bytes(2, "little", signed=True)
    return oxyii.encode(oxyii.OP_RT_ACC, bytes(body), flag=1)


def test_run_oxyii_captures_a_pushed_acc_frame_when_acc_was_requested(tmp_path, monkeypatch):
    """The ring's 3-axis accelerometer arrives UNSOLICITED — nothing polls it; it appears only because
    the AUTO_RT_SWITCH handshake asked for it. Driven through the production callback."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    seen, reg = [], []
    monkeypatch.setattr(capture.BUS, "push",
                        lambda stream, values, *a, **k: seen.append((stream, values)))
    monkeypatch.setattr(capture.BUS, "register", lambda key, *a, **k: reg.append((key, a, k)))
    c = FakeGattClient()

    def _feed(data):
        if data[1] == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
            c.notify(0, _o2ring_acc_reply())

    c.on_live = _feed
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(streams=["spo2", "acc"]), str(tmp_path)))
    acc = [v for s, v in seen if s == "acc_o2"]
    assert acc and [list(map(int, r)) for r in acc[0]] == [[-2000, 16, 1000]], \
        f"a requested ACC push must parse as signed 3-axis, got {acc}"
    decl = [k for k in reg if k[0] == "acc_o2"]
    assert decl, "acc_o2 must be REGISTERED before it is pushed — the bus treats shape as declared"
    assert decl[0][2].get("chans") == 3, "three axes, like the H10's"
    assert "raw" in decl[0][1], "unit stays raw: no scale is published for this ring"


def test_run_oxyii_drops_an_acc_frame_nobody_asked_for(tmp_path, monkeypatch, caplog):
    """A stream nobody enabled becoming data nobody can explain is the failure this guards. The frame is
    logged ONCE per link — a fact about the ring worth seeing — and never parsed.

    Its own session, deliberately: two `run_oxyii` runs inside one test share module state and the second
    silently does not drive the callback, which reads exactly like the drop working."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    seen = []
    monkeypatch.setattr(capture.BUS, "push",
                        lambda stream, values, *a, **k: seen.append((stream, values)))
    c = FakeGattClient()

    def _feed(data):
        if data[1] == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
            c.notify(0, _o2ring_acc_reply())
            c.notify(0, _o2ring_acc_reply())      # a second one must NOT log again

    c.on_live = _feed
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    with caplog.at_level("WARNING"):
        _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    assert not [v for s, v in seen if s == "acc_o2"], "an unrequested ACC frame must not become data"
    warned = [r for r in caplog.records if "never asked for" in r.getMessage()]
    assert len(warned) == 1, f"warn ONCE per link, got {len(warned)} — a per-frame warning is a flood"


def test_run_oxyii_ignores_an_EMPTY_acc_frame_without_publishing(tmp_path, monkeypatch):
    """A requested ACC push whose record count is zero must publish nothing rather than an empty frame.

    This exists because the coverage floor found `if _acc:` had never been false — every test fed a
    frame with samples in it, so the empty path was reachable code nothing had reached. An empty push
    would put a zero-length frame on the bus, which `push()` drops anyway, but `note_data` would still
    mark the stream as having delivered — a stream reporting liveness on no data."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    seen = []
    monkeypatch.setattr(capture.BUS, "push",
                        lambda stream, values, *a, **k: seen.append((stream, values)))
    c = FakeGattClient()

    def _feed(data):
        if data[1] == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
            c.notify(0, _o2ring_acc_reply(samples=()))     # count 0, no records

    c.on_live = _feed
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(_o2dev(streams=["spo2", "acc"]), str(tmp_path)))
    assert not [v for s, v in seen if s == "acc_o2"], "an empty ACC frame must publish nothing"


# ── run_oxyii: connects that REACH IDENTITY and deliver nothing (Mitigation C, clause 2) ────────────
def _o2_identity_then_drop(c, serial, episodes, *, answer=True):
    """Answer 0xE1, then drop the link: the clause-2 shape, once per reconnect.

    The real ring talks whether or not it is worn, so "answered identity, then silence" is not any
    healthy state — it is a peer that responds to our queries and never serves data. With
    `answer=False` the same link drops at the same point WITHOUT answering: a plain failed connect,
    which must not enter this counter at all.
    """
    def on(data):
        if data[1] == oxyii.OP_GET_INFO:
            if answer:
                c.notify(0, _o2_info_reply_from(serial))
            c._connected = False
            episodes.append(1)
    return on


def _rearming_scan(monkeypatch, c):
    """Every reconnect gets a LIVE client again — otherwise the second episode connects to a client
    already marked down and the run is one episode wearing the shape of many."""
    @contextlib.asynccontextmanager
    async def ctx(_addr, *a, **k):
        c._connected = True
        yield c
    monkeypatch.setattr(capture, "_connect_scan", ctx)


def _run_barren(tmp_path, monkeypatch, sleeps, *, deliver_on=None, answer_identity=True):
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    capture.STATUS["devices"].pop("Ring", None)
    c = FakeGattClient()
    episodes: list[int] = []
    barren_on = _o2_identity_then_drop(c, "2592302100", episodes, answer=answer_identity)

    def on(data):
        # `deliver_on` names the episode (1-based) that behaves like a real ring: one live frame, then
        # the same drop. That is the reset arm — a delivering connect ends the run.
        if deliver_on is not None and len(episodes) + 1 == deliver_on and data[1] == oxyii.OP_LIVE:
            c.notify(0, _o2ring_live_reply())
        barren_on(data)
    c.on_live = on
    _rearming_scan(monkeypatch, c)
    _stop_after(monkeypatch, sleeps)
    _run(capture.run_oxyii(_o2dev(), str(tmp_path)))
    return capture.STATUS["devices"]["Ring"], len(episodes)


def test_run_oxyii_one_connect_that_serves_nothing_is_counted_and_NOT_alerted(tmp_path, monkeypatch):
    """A single barren connect is an ordinary dropped link. The count is published from the first one
    — the number is the alarm's denominator and an absent field would hide it — but nothing fires."""
    st, eps = _run_barren(tmp_path, monkeypatch, sleeps=4)
    assert eps >= 1
    assert st["ring_barren_connects"] == 1, st["ring_barren_connects"]
    assert st["ring_barren_alert"] is None, "one is not a run"


def test_run_oxyii_a_RUN_of_identity_only_connects_alerts_once(tmp_path, monkeypatch, caplog):
    """The clause-2 finding: three consecutive connects answered identity and delivered no frames.
    Journalled on the transition only — the run keeps growing and the operator gets one line."""
    import logging
    caplog.set_level(logging.ERROR, logger="tepna-capture")
    st, eps = _run_barren(tmp_path, monkeypatch, sleeps=17)
    assert eps >= 4, f"the fixture must produce a RUN, not a single episode (got {eps})"
    assert st["ring_barren_connects"] >= 3
    assert st["ring_barren_alert"] and "delivered no frames" in st["ring_barren_alert"]
    hits = [r for r in caplog.records if "delivered no frames" in r.getMessage()]
    assert len(hits) == 1, (
        f"the ERROR belongs to the TRANSITION INTO the alerting state, got {len(hits)}: "
        + "; ".join(r.getMessage() for r in hits))


def test_run_oxyii_a_connect_that_DELIVERS_ends_the_run(tmp_path, monkeypatch):
    """The reset arm. Without it the counter is a lifetime total and every long-running box eventually
    alerts — the finding is a RUN of barren connects, not their sum since boot."""
    st, eps = _run_barren(tmp_path, monkeypatch, sleeps=17, deliver_on=3)
    assert eps >= 4
    assert st["ring_barren_connects"] < 3, (
        f"a delivering connect must reset the run, got {st['ring_barren_connects']} after {eps} episodes")
    assert st["ring_barren_alert"] is None


def test_alert_poller_carries_a_barren_run_to_the_webhook_ONCE_and_says_when_it_recovers(monkeypatch):
    """Its own latch and its own recovery line: the ring is NOT offline while this fires (it connects,
    every poll), so the offline alarm never speaks for it, and an operator told the link is dead is
    owed the news that it is serving again."""
    sent = []
    class _N:
        enabled = True
        async def send(self, title, message, **kw): sent.append((title, message)); return True
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 1e9}, "devices": [_o2dev()]}
    st = {"connected": True, "ring_barren_alert": "3 consecutive connects answered the identity "
          "query and delivered no frames — this link reaches something that is not serving data"}
    capture.STATUS["devices"]["Ring"] = st
    capture._LAST_DATA["Ring"] = 1000.0
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] == 3:
            st["ring_barren_alert"] = None          # a connect delivered — the run ended
        if calls["n"] >= 5:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    _run(capture.alert_poller(cfg, _N()))
    capture._LAST_DATA.pop("Ring", None)
    titles = [t for t, _ in sent]
    assert titles == ["Tepna: ring connects but serves nothing", "Tepna: ring serving again"], titles
    assert "Ring" in sent[0][1] and "delivered no frames" in sent[0][1]


def test_run_oxyii_a_connect_that_never_REACHED_identity_is_not_counted(tmp_path, monkeypatch):
    """The counter's subject is "answered us, then served nothing", not "failed". A link that drops
    before the identity reply is an ordinary connect failure — the offline alarm's business — and
    counting it here would let a flapping radio raise an impostor-shaped alarm about itself."""
    st, eps = _run_barren(tmp_path, monkeypatch, sleeps=17, answer_identity=False)
    assert eps >= 4, f"the fixture must produce several failed connects (got {eps})"
    assert st["ring_barren_connects"] == 0, st["ring_barren_connects"]
    assert st["ring_barren_alert"] is None


def test_alert_poller_RETRIES_a_barren_webhook_that_was_not_delivered(monkeypatch):
    """The latch closes on DELIVERY, never on the attempt (CAPTURE-HOST-DEEP-AUDIT §C1). A webhook
    that failed to send must be tried again on the next poll — latching on the attempt would turn one
    transient network error into permanent silence about a link that is serving nothing."""
    sent = []
    class _N:
        enabled = True
        async def send(self, title, message, **kw):
            sent.append(title)
            return False                                   # every attempt fails
    cfg = {"alerts": {"poll_sec": 1, "offline_sec": 1e9}, "devices": [_o2dev()]}
    capture.STATUS["devices"]["Ring"] = {
        "connected": True,
        "ring_barren_alert": "3 consecutive connects answered the identity query and delivered no frames"}
    capture._LAST_DATA["Ring"] = 1000.0
    calls = {"n": 0}
    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= 3:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: 1000.0)
    _run(capture.alert_poller(cfg, _N()))
    capture._LAST_DATA.pop("Ring", None)
    assert sent.count("Tepna: ring connects but serves nothing") == 3, (
        f"an undelivered alarm must be retried every poll, got {sent}")


def test_run_oxyii_attributes_a_barren_run_to_a_STORM_the_daemon_itself_declared(tmp_path, monkeypatch):
    """The wiring half: the daemon holds `_OXYII_STORMS` in memory, so the alert can name the cause
    without waiting for that state to be published anywhere. A storm inside the attribution window
    (`_OXYII_STORM_MEMORY_S`, the same span the hold escalates over) changes the sentence."""
    addr = _o2dev()["address"]
    capture._OXYII_STORMS[addr] = [_time.monotonic() - 300.0]
    try:
        st, eps = _run_barren(tmp_path, monkeypatch, sleeps=17)
        assert eps >= 4
        assert st["ring_barren_alert"] and "restart storm tripped 5 min ago" in st["ring_barren_alert"]
    finally:
        capture._OXYII_STORMS.pop(addr, None)


def test_a_storm_OUTSIDE_the_window_no_longer_excuses_the_run(tmp_path, monkeypatch):
    """An hours-old storm is not an explanation for what the link is doing now. The window is the
    daemon's own `_OXYII_STORM_MEMORY_S`; past it the neutral wording returns."""
    addr = _o2dev()["address"]
    capture._OXYII_STORMS[addr] = [_time.monotonic() - (capture._OXYII_STORM_MEMORY_S + 60)]
    try:
        st, _ = _run_barren(tmp_path, monkeypatch, sleeps=17)
        assert st["ring_barren_alert"] and "storm" not in st["ring_barren_alert"]
    finally:
        capture._OXYII_STORMS.pop(addr, None)


# ── the AES-session guard fires on the BRANCH from GET_INFO ───────────────────────────────────────
# Residue `2026-09-05-dis-firmware-compared-to-a-branch-code`. The guard used to key on the DIS
# Firmware Revision String, so it never ran on this box's ring (no DIS) and could never be true on a
# ring that has it. GET_INFO is answered by EVERY ring in our own handshake.


def test_an_unmeasured_BRANCH_raises_the_AES_warning(tmp_path, monkeypatch, caplog):
    with caplog.at_level(logging.WARNING):
        st = _run_ring_session(tmp_path, monkeypatch, _o2dev(), "2592302100", fw=b"2D010001")
    assert st["ring_branch_code"] == "2D010001"
    msg = " ".join(r.getMessage() for r in caplog.records)
    assert "2D010001" in msg and "AES" in msg, \
        "an unmeasured branch must be named on the link that reported it"
    # the REAL version is reported beside it, never compared
    assert st["ring_firmware_version"] == "0.0.0.0", st.get("ring_firmware_version")


def test_the_measured_BRANCH_stays_silent(tmp_path, monkeypatch, caplog):
    """The discriminator. A guard keyed on a firmware VERSION would fire here too, because a version
    string never equals a branch code — so this is the case that reds the wrong fix, not the one
    above."""
    with caplog.at_level(logging.WARNING):
        st = _run_ring_session(tmp_path, monkeypatch, _o2dev(), "2592302100", fw=b"2D010002")
    assert st["ring_branch_code"] == "2D010002"
    assert "AES" not in " ".join(r.getMessage() for r in caplog.records), \
        "the measured-plaintext branch must not raise the warning"


def test_the_branch_warning_fires_on_the_TRANSITION_not_once_per_reply(tmp_path, monkeypatch, caplog):
    """The ring answers GET_INFO on every poll, so an unconditional warning would fill the journal with
    one line per reply and bury the transition that matters. Asserted by running a SECOND session on a
    ring already published as `2D010001`: the branch has not changed, so it must stay silent."""
    capture.STATUS["devices"]["Ring"] = {"ring_branch_code": "2D010001"}
    with caplog.at_level(logging.WARNING):
        st = _run_ring_session_keep(tmp_path, monkeypatch, _o2dev(), "2592302100", fw=b"2D010001")
    assert st["ring_branch_code"] == "2D010001"
    assert "AES" not in " ".join(r.getMessage() for r in caplog.records), \
        "an unchanged branch must not re-warn — the guard reports the transition, not the state"


def _run_ring_session_keep(tmp_path, monkeypatch, dev, serial_on_air, fw: bytes = b"2D010002"):
    """`_run_ring_session` clears the device's STATUS first; this one PRESERVES it, so a test can set
    the previous branch and observe the transition logic rather than a first sighting."""
    capture._OXYII_PAUSE.clear(); capture._RECOVER.clear(); capture._OXYII_RTC_AT.clear()
    c = FakeGattClient()
    c.on_live = _o2_identity_responder(c, serial_on_air, fw)
    _inject_connect_scan(monkeypatch, c)
    _stop_after(monkeypatch, 4)
    _run(capture.run_oxyii(dev, str(tmp_path)))
    return capture.STATUS["devices"]["Ring"]
