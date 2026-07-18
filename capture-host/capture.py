# tepna-capture — capture.py  (entrypoint: python capture.py --config config.yaml)
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Async supervisor: holds the live BLE links overnight, routes frames to the vendor-layout writers,
# supervises the Muse child tool, and writes status.json. Per-device reconnect loops keep an
# unattended night alive across transient drops; onboard recording (O2Ring/Verity/H10) is the backstop.
#
# ⚠️ The BLE paths are UNVERIFIED on hardware here (see polar_pmd.py header). This is a correct-shaped
#    scaffold honoring the §7 integration contract; validate against real frames + PSL output first.

from __future__ import annotations
import argparse, asyncio, contextlib, json, logging, os, signal, time as _time, datetime as _dt
from writers import StreamWriter, Spo2CsvWriter, capture_filename, night_dir
import polar_pmd as pmd
import viatom
import oxyii
import bonding
import link_rssi
import offline_lock
from telemetry import TelemetryBus

HR_UUID = "00002a37-0000-1000-8000-00805f9b34fb"   # standard Heart Rate Measurement (RR intervals)
BATTERY_UUID = "00002a19-0000-1000-8000-00805f9b34fb"   # standard Battery Level (0x2A19) — uint8 percent
log = logging.getLogger("tepna-capture")
STATUS: dict = {"updated": None, "devices": {}}
_STOP = asyncio.Event()
BUS = TelemetryBus()          # live-sample bus feeding the monitor page (webmon.py)
ADAPTER: str | None = None    # BLE adapter MAC for bonding (config `adapter:`); None = default controller
# Live-stream metadata per PMD stream name: (base label, unit, channels, per-channel labels). fs comes
# from pmd.SAMPLE_HZ. Everything is pushed RAW to the monitor — no signal processing on the box.
_LIVE_META = {
    "ecg":  ("ECG",  "µV",  1, ()),
    "acc":  ("ACC",  "mg",  3, ("X", "Y", "Z")),
    "ppg":  ("PPG",  "raw", 4, ("LED1", "LED2", "LED3", "ambient")),
    "gyro": ("Gyro", "dps", 3, ("X", "Y", "Z")),
    "mag":  ("Mag",  "G",   3, ("X", "Y", "Z")),
    "ppi":  ("PPI",  "ms",  2, ("PP-int", "HR")),
    "hr":   ("RR",   "ms",  1, ()),
}


def _dev_tag(dev: dict) -> str:
    """Short per-device tag so two sensors' same stream (H10 ACC vs Verity ACC) get distinct bus keys."""
    t = (dev.get("model") or dev.get("name") or "").lower()
    return "h10" if "h10" in t else "vs" if ("verity" in t or "sense" in t) else dev.get("device_id", "x")


def _live_key(stream: str, tag: str) -> str:
    return stream if stream in ("ecg", "ppg") else f"{stream}_{tag}"   # ecg/ppg are device-unique


# Monotonic-anchored wall clock (Clock Contract §🔒). CLOCK_MONOTONIC (via time.monotonic) measures
# elapsed time independent of the wall clock; we anchor it to civil time ONCE so a mid-capture NTP
# correction can't silently STEP the stamps. A genuine step (> _STEP_THRESH_S — e.g. an RTC-less Pi that
# first NTP-syncs minutes after boot, or a DST change) re-anchors and is LOGGED — a jump you can see
# beats one you can't. Returns LOCAL civil time, byte-for-byte the same type as datetime.now().
_STEP_THRESH_S = 2.0
_anchor_wall: _dt.datetime | None = None
_anchor_mono: float = 0.0


def _reanchor() -> None:
    global _anchor_wall, _anchor_mono
    _anchor_wall = _dt.datetime.now()
    _anchor_mono = _time.monotonic()


def _now() -> _dt.datetime:
    global _anchor_wall
    if _anchor_wall is None:
        _reanchor()
    predicted = _anchor_wall + _dt.timedelta(seconds=_time.monotonic() - _anchor_mono)
    actual = _dt.datetime.now()
    drift = (actual - predicted).total_seconds()   # wall-vs-monotonic divergence == a clock step
    if abs(drift) > _STEP_THRESH_S:
        log.warning("wall-clock step %.3fs — re-anchoring capture stamps here (NTP correction / DST?)", drift)
        _reanchor()
        return actual
    return predicted


# BlueZ serialises connection ESTABLISHMENT per adapter — two devices connecting at once yields
# org.bluez.Error.InProgress. Hold this lock only across connect(); the links themselves run concurrently.
_CONNECT_LOCK = asyncio.Lock()

# The O2Ring exposes exactly ONE BLE link, so live capture and a stored-session (.dat) pull cannot both
# hold it. Setting this event tells run_oxyii to drop its link and idle; pull_oxyii_session then owns the
# ring for the download and clears the event to resume live capture. (Only the O2Ring path honors it.)
_OXYII_PAUSE = asyncio.Event()

# Phase-0/1 diagnostic (O2RING-LIVE-PPG-WAVEFORM brief): with OXYII_PPG_PROBE=1, DUMP the first N live 0x04
# replies (full hex + host timestamp) to a JSONL file so the ~100 Hz PPG body can be reconstructed +
# decoded offline and its pulse rate cross-checked vs the ECG. Inert without the env var.
_PPG_PROBE = os.environ.get("OXYII_PPG_PROBE") == "1"
_PPG_PROBE_N = int(os.environ.get("OXYII_PPG_PROBE_N", "90"))
_PPG_PROBE_FILE = os.environ.get("OXYII_PPG_PROBE_FILE", "/home/michal/tepna-smoketest/o2ppg-probe.jsonl")
_ppg_probe_n = [0]

# O2Ring live PPG waveform (O2RING-LIVE-PPG-WAVEFORM Phase 2). The 0x04 body carries a ~125 Hz single-
# channel pleth (decoded in oxyii.parse_ppg). We capture it into the SAME PSL "ppg" layout the Verity uses
# (single channel replicated across ppg0/1/2, ambient 0) so it routes with NO new parser branch. Samples
# are back-timed from the frame's host arrival across the ~125 Hz grid (the ring clock is unsynced, so
# never stamp with it); the synthesized sensor_ns gives the PSL relative-ms column an 8 ms step.
# NOMINAL rate — the ring's actual delivery is SLIGHTLY VARIABLE (~123-132 Hz observed across captures), so
# 125 is a round central estimate. The phone timestamp re-anchors to each frame's host arrival, so wall-clock
# error does NOT accumulate; only the synthesized relative-ms column carries the nominal-fs approximation.
# TODO(Phase-2 refine): pin fs better or derive the ms column from arrival deltas per frame.
O2PPG_FS = 125.0
O2PPG_NS_STEP = int(1e9 / O2PPG_FS)   # 8_000_000 ns → relative-ms column steps of 8.0 ms (reads as ~125 Hz)

# Same one-link constraint for Polar (H10 / Verity) offline-recording pulls over PS-FTP: a device address
# in this set tells its run_polar task to drop the link and idle, so polar_offline_op can own it for the
# download, then resume live capture. Per-address (not a single event) so pulling the Verity doesn't pause
# the H10. Without this a pull collides with run_polar's reconnect loop → org.bluez.Error.InProgress.
_POLAR_PAUSED: set = set()

# Set by the adapter watchdog while it resets a WEDGED BLE controller — every device task idles so the
# power-cycle doesn't fight an in-flight connect. Cleared when recovery finishes.
_RECOVER = asyncio.Event()


def classify_adapter_health(devices: list[dict]) -> dict:
    """PURE (testable): from each configured device's {name, connected, last_error, bluez_connected},
    decide whether the BLE ADAPTER looks WEDGED vs merely idle because the devices AREN'T WORN — the
    distinction the whole watchdog turns on. Returns {wedged, reasons, phantom:[addresses]}.

      • `InProgress` in last_error → adapter-level connection contention. This is NEVER a not-worn state
        (a not-worn device fails cleanly with 'not found'), so it is an unambiguous wedge signal.
      • `bluez_connected` (BlueZ reports Connected: yes) while our daemon's `connected` is False → a
        PHANTOM stale link: a 'connected' device does not advertise, so nobody can re-grab it. Unambiguous
        wedge, and it names the address that needs a targeted `disconnect`.
      • Everything else — clean not-found / not connected, no phantom, no InProgress — is NOT WORN and
        BENIGN. We deliberately do NOT auto-recover on it: yanking the adapter because the user took a
        sensor off would be worse than the problem.
    """
    reasons: list[str] = []
    phantom: list[str] = []
    for d in devices:
        err = d.get("last_error") or ""
        if "InProgress" in err:
            reasons.append(f"{d.get('name')}: InProgress")
        if d.get("bluez_connected") and not d.get("connected"):
            phantom.append(d["address"])
            reasons.append(f"{d.get('name')}: phantom BlueZ link")
    return {"wedged": bool(reasons), "reasons": reasons, "phantom": phantom}


async def adapter_kw() -> dict:
    """bleak kwargs pinning a connection to the CONFIGURED adapter (config `adapter:`), or {} when
    unconfigured/unresolvable so we fall back to the BlueZ default instead of failing hard.

    WHY this exists: we configure a stable adapter MAC, but bleak wants an `hciN` name — and hci indices
    RE-ENUMERATE. On 2026-07-18 a controller power-cycle swapped hci0/hci2, so the BlueZ default became
    the onboard radio that cannot hear our sensors; every connect hung and PMD never started, with no
    error naming the cause. Resolving MAC→hciN fresh on each connect keeps the pin correct across
    re-enumeration (one cheap subprocess, and connects are infrequent)."""
    if not ADAPTER:
        return {}
    hci = await link_rssi.resolve_hci(ADAPTER, refresh=True)
    if not hci:
        log.warning("configured adapter %s not found — falling back to the BlueZ default", ADAPTER)
        return {}
    return {"adapter": hci}


@contextlib.asynccontextmanager
async def _connect(addr: str):
    from bleak import BleakClient as _BC
    client = _BC(addr, **(await adapter_kw()))
    async with _CONNECT_LOCK:
        await client.connect()
    try:
        yield client
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


# The O2Ring advertises only in SHORT bursts while worn (finger-in) and its MAC can rotate on a factory
# reset, so a bare BleakClient(addr).connect() (fixed-timeout resolve) routinely misses the window after a
# drop → BleakDeviceNotFoundError. Mirror pull_session.py: an EARLY-EXIT scan that returns the instant the
# ring advertises, matching address OR name. The Polar straps are bonded + advertise continuously, so they
# keep the plain _connect above.
_O2_NAME_HINTS = ("o2ring", "s8-aw", "s8aw", "wellue", "checkme")


@contextlib.asynccontextmanager
async def _connect_scan(addr: str, name_hints=_O2_NAME_HINTS, timeout: float = 15.0):
    from bleak import BleakClient as _BC, BleakScanner as _BS
    from bleak.exc import BleakDeviceNotFoundError as _NotFound
    akw = await adapter_kw()                      # pin scan AND connect to the configured radio
    device = await _BS.find_device_by_filter(
        lambda d, adv: d.address.upper() == addr.upper()
        or any(h in ((adv.local_name or d.name or "").lower()) for h in name_hints),
        timeout=timeout, **akw)
    if device is None:
        raise _NotFound(addr, "O2Ring not advertising (wear it finger-in + close the phone app)")
    client = _BC(device, **akw)
    async with _CONNECT_LOCK:
        await client.connect()
    try:
        yield client
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


def _set(name, **kv):
    STATUS["devices"].setdefault(name, {}).update(kv)


def _parse_hr(data: bytes):
    """Standard HR Measurement char → (bpm, [rr_ms,...])."""
    flags = data[0]; i = 1
    if flags & 0x01:
        bpm = int.from_bytes(data[1:3], "little"); i = 3
    else:
        bpm = data[1]; i = 2
    if flags & 0x08:   # energy expended present
        i += 2
    rr = []
    while i + 1 < len(data) + 1 and i + 1 <= len(data):
        if i + 2 > len(data):
            break
        raw = int.from_bytes(data[i:i + 2], "little"); i += 2
        rr.append(round(raw / 1024 * 1000))   # 1/1024 s units -> ms
    return bpm, rr


async def run_polar(dev: dict, root: str):
    name, addr = dev["name"], dev["address"]
    streams = dev.get("streams", ["ecg"])
    backoff = 5
    # One-time bond BEFORE any PMD attempt — the H10 drops an un-authenticated link ~1-2 s after
    # connect (bleak #1943). ensure_bonded is a no-op if the bond already exists. (Reconnects after a
    # transient drop reuse the stored bond, so we don't re-bond in the loop.)
    try:
        if not await bonding.ensure_bonded(addr, ADAPTER):
            _set(name, last_error="bond failed — pair the sensor from the monitor page")
            log.warning("%s not bonded; PMD will likely drop until bonded", name)
    except Exception as e:
        _set(name, last_error=f"bond error: {e!r}")
    while not _STOP.is_set():
        if addr in _POLAR_PAUSED or _RECOVER.is_set():   # a pull owns the link, or the watchdog is resetting the adapter
            _set(name, connected=False,
                 last_error="paused — pulling offline recording" if addr in _POLAR_PAUSED else "adapter recovering")
            while (addr in _POLAR_PAUSED or _RECOVER.is_set()) and not _STOP.is_set():
                await asyncio.sleep(0.3)
            continue
        writers: dict[int, StreamWriter] = {}
        stream_fs: dict[int, float] = {}   # actual negotiated sample rate per meas (ACC differs per device)
        hr_writer = None
        started = _now()
        ndir = night_dir(root, started)
        try:
            _set(name, connected=False, address=addr, last_error=None)
            async with _connect(addr) as client:
                _set(name, connected=True)
                log.info("%s connected", name)
                backoff = 5

                # Open one writer per requested stream.
                def w(stream, ext="txt"):
                    p = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, stream, ext))
                    return StreamWriter(p, stream)
                tag = _dev_tag(dev)
                meas_of = {"ecg": pmd.ECG, "acc": pmd.ACC, "ppg": pmd.PPG,
                           "gyro": pmd.GYRO, "mag": pmd.MAG, "ppi": pmd.PPI}

                def _register(meas: int, fs_val: float) -> None:
                    base, unit, ch, labs = _LIVE_META[pmd.MEAS_NAME[meas]]
                    BUS.register(_live_key(pmd.MEAS_NAME[meas], tag), f"{base} ({name})", unit, fs_val, ch, labs)

                for s in streams:
                    if s in meas_of:
                        writers[meas_of[s]] = w(s)
                        _register(meas_of[s], pmd.SAMPLE_HZ.get(meas_of[s], 0))   # placeholder fs until negotiated
                if "hr" in streams:
                    hr_writer = w("hr")
                    BUS.register(_live_key("hr", tag), f"RR ({name})", "ms", 0)

                # PMD data handler — one char carries all PMD streams; route by measurement type.
                def on_pmd(_sender, data: bytearray):
                    arrival = _now()
                    try:
                        meas, samples = pmd.decode_frame(bytes(data), arrival, fs=stream_fs.get(data[0]))
                    except ValueError as e:
                        _set(name, last_error=str(e)); return
                    wr = writers.get(meas)
                    if not wr or not samples:
                        return
                    for smp in samples:
                        v = smp.values
                        if meas == pmd.ECG:    wr.write_ecg(smp.phone, smp.sensor_ns, smp.t_ms, v[0])
                        elif meas == pmd.ACC:  wr.write_acc(smp.phone, smp.sensor_ns, smp.t_ms, *v)
                        elif meas == pmd.PPG:  wr.write_ppg(smp.phone, smp.sensor_ns, smp.t_ms, v[:3], v[3])
                        elif meas == pmd.GYRO: wr.write_gyro(smp.phone, smp.sensor_ns, smp.t_ms, *v)
                        elif meas == pmd.MAG:  wr.write_mag(smp.phone, smp.sensor_ns, smp.t_ms, *v)
                        elif meas == pmd.PPI:  wr.write_ppi(smp.phone, smp.sensor_ns, v[0], v[1], v[2], v[3])
                    # Live push — RAW, per-stream shape (no on-box DSP):
                    key, hz = _live_key(pmd.MEAS_NAME[meas], tag), stream_fs.get(meas) or pmd.SAMPLE_HZ.get(meas)
                    if meas == pmd.ECG:
                        BUS.push(key, [s.values[0] for s in samples], hz)
                    elif meas in (pmd.PPG, pmd.ACC, pmd.GYRO, pmd.MAG):
                        BUS.push(key, [list(s.values) for s in samples], hz)      # multi-channel
                    elif meas == pmd.PPI:
                        BUS.push(key, [[s.values[1], s.values[0]] for s in samples], hz)  # [PP-int ms, HR]
                    _set(name, **{f"rows_{meas}": wr.rows, "last_sample": samples[-1].phone.isoformat()})

                def on_hr(_sender, data: bytearray):
                    if not hr_writer:
                        return
                    bpm, rr = _parse_hr(bytes(data))
                    hr_writer.write_hr(_now(), 0, bpm, rr)
                    if rr:                        # raw RR intervals to the monitor (no HRV computed on-box)
                        BUS.push(_live_key("hr", tag), [float(x) for x in rr], 0)

                if writers:
                    # Log which PMD measurement types the device actually supports (feature bitmask).
                    try:
                        feat = pmd.parse_features(bytes(await client.read_gatt_char(pmd.PMD_CONTROL)))
                        names = sorted(pmd.MEAS_NAME.get(t, hex(t)) for t in feat)
                        log.info("%s PMD supports: %s", name, " ".join(names))
                        _set(name, pmd_supported=names)
                    except Exception as e:
                        log.info("%s feature read skipped: %r", name, e)

                    # Control-point responses (settings + START acks) arrive as indications; queue them.
                    ctrl_q: asyncio.Queue = asyncio.Queue()
                    try:
                        await client.start_notify(pmd.PMD_CONTROL, lambda _s, d: ctrl_q.put_nowait(bytes(d)))
                    except Exception as e:
                        log.info("%s control indications unavailable: %r", name, e)

                    async def _ctrl(cmd: bytes, timeout: float = 3.0) -> bytes:
                        while not ctrl_q.empty():
                            ctrl_q.get_nowait()
                        await client.write_gatt_char(pmd.PMD_CONTROL, cmd, response=True)
                        try:
                            return await asyncio.wait_for(ctrl_q.get(), timeout)
                        except asyncio.TimeoutError:
                            return b""

                    await client.start_notify(pmd.PMD_DATA, on_pmd)
                    for meas in list(writers):
                        await _ctrl(pmd.stop_cmd(meas))   # clear any stale stream from a prior session
                        # Ask the device what settings it offers, then START from THOSE (fixed table is a
                        # fallback). Devices differ: Verity ACC isn't 200 Hz, MAG needs a range, etc.
                        settings = pmd.parse_settings_response(await _ctrl(pmd.get_settings_cmd(meas)))
                        used_fs = pmd.chosen_rate(meas, settings)
                        started = False
                        for cmd, how in ((pmd.build_start(meas, settings), "negotiated"),
                                         (pmd.START.get(meas), "fixed")):
                            if not cmd:
                                continue
                            ack = await _ctrl(cmd)
                            st = ack[3] if len(ack) >= 4 else 0xFF
                            (log.info if st in (0x00, 0x06) else log.warning)(
                                "%s START %s (%s) → %s", name, pmd.MEAS_NAME.get(meas, meas), how,
                                pmd.CTRL_STATUS.get(st, hex(st)))
                            if st in (0x00, 0x06):    # ok, or already-streaming
                                started = True
                                break
                        if started:                  # record + re-register at the ACTUAL negotiated rate
                            stream_fs[meas] = used_fs
                            _register(meas, used_fs)
                        else:                        # truly unsupported settings — drop it, don't leave an empty file / idle card
                            _set(name, last_error=f"{pmd.MEAS_NAME.get(meas, meas)} START rejected")
                            try:
                                p = writers[meas].path; writers[meas].close(); os.remove(p)
                            except OSError:
                                pass
                            del writers[meas]
                            BUS.unregister(_live_key(pmd.MEAS_NAME.get(meas, str(meas)), tag))
                        await asyncio.sleep(0.2)
                if hr_writer:
                    await client.start_notify(HR_UUID, on_hr)

                # Battery level via the standard Battery Service (0x2A19). Polar H10 + Verity both expose
                # it; read once now and refresh every ~2 min. Silent no-op if a firmware lacks the char.
                async def _read_batt():
                    try:
                        b = await client.read_gatt_char(BATTERY_UUID)
                        if b:
                            _set(name, battery=int(b[0]))
                    except Exception:
                        pass
                await _read_batt()

                # Hold the link until disconnect, shutdown, or an offline-pull pause request.
                secs = 0
                while client.is_connected and not _STOP.is_set() and addr not in _POLAR_PAUSED and not _RECOVER.is_set():
                    await asyncio.sleep(1)
                    secs += 1
                    if secs % 120 == 0:
                        await _read_batt()
        except Exception as e:
            _set(name, connected=False, last_error=repr(e))
            log.warning("%s link error: %r", name, e)
        finally:
            for wr in writers.values():
                wr.close()
            if hr_writer:
                hr_writer.close()
        if not _STOP.is_set():
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)   # exponential backoff, capped


async def run_muse(dev: dict, root: str):
    """Muse EEG is captured by a child tool (muselsl / OpenMuse), not bleak. Supervise + restart it."""
    name, addr = dev["name"], dev["address"]
    tool = dev.get("muse_tool", "muselsl")
    while not _STOP.is_set():
        started = _now()
        ndir = night_dir(root, started)
        out = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, "eeg", "csv"))
        # NOTE: verify the exact CLI for YOUR tool/version. Defaults below are the common forms:
        #   muselsl : needs a `stream` running, then `record`; or use a wrapper. OpenMuse: one-shot `record`.
        if tool == "openmuse":
            cmd = ["OpenMuse", "record", "--address", addr, "--outfile", out]
        else:
            cmd = ["muselsl", "record", "--address", addr, "--filename", out]
        try:
            _set(name, connected=True, address=addr, tool=tool, last_error=None, file=out)
            log.info("%s: %s", name, " ".join(cmd))
            proc = await asyncio.create_subprocess_exec(*cmd)
            while proc.returncode is None and not _STOP.is_set():
                try:
                    await asyncio.wait_for(proc.wait(), timeout=1)
                except asyncio.TimeoutError:
                    pass
            if proc.returncode is None:
                proc.terminate()
        except FileNotFoundError:
            _set(name, connected=False, last_error=f"{tool} not installed (pipx install {tool})")
            await asyncio.sleep(30)
        except Exception as e:
            _set(name, connected=False, last_error=repr(e))
        if not _STOP.is_set():
            await asyncio.sleep(5)


async def run_viatom(dev: dict, root: str):
    """Wellue/Viatom O2Ring — real-time SpO2 + pulse over the Viatom protocol (NOT PMD). Emits the
    ViHealth CSV layout OxyDex parses, and pushes spo2/pr to the live monitor. The ring only advertises
    while worn (finger in), so a bond/connect only succeeds when it's on the finger."""
    name, addr = dev["name"], dev["address"]
    backoff = 5
    try:
        if not await bonding.ensure_bonded(addr, ADAPTER):
            _set(name, last_error="bond failed — pair the ring from the monitor page (wear it first)")
    except Exception as e:
        _set(name, last_error=f"bond error: {e!r}")
    while not _STOP.is_set():
        started = _now()
        ndir = night_dir(root, started)
        path = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, "spo2", "csv"))
        wr = None
        try:
            _set(name, connected=False, address=addr, last_error=None)
            async with _connect(addr) as client:
                _set(name, connected=True); log.info("%s connected", name); backoff = 5
                # Discover the notify + write chars under the Viatom service by PROPERTY (UUIDs vary by
                # model/firmware), falling back to the documented UUIDs.
                notify_char, write_char = None, None
                for s in client.services:
                    if s.uuid.lower() == viatom.VIATOM_SERVICE:
                        for ch in s.characteristics:
                            p = ch.properties
                            if ("notify" in p or "indicate" in p) and notify_char is None:
                                notify_char = ch
                            if ("write" in p or "write-without-response" in p) and write_char is None:
                                write_char = ch
                notify_char = notify_char or viatom.VIATOM_NOTIFY
                wr = Spo2CsvWriter(path)

                def on_data(_sender, data: bytearray):
                    pkt = viatom.decode_packet(bytes(data))
                    if not pkt:
                        return
                    now = _now()
                    if pkt["spo2"] is not None:
                        wr.write(now, pkt["spo2"], pkt["pr"] or 0, pkt["motion"])
                        BUS.push("spo2", [pkt["spo2"]])
                        if pkt["pr"]:
                            BUS.push("pr", [pkt["pr"]])
                        _set(name, rows=wr.rows, spo2=pkt["spo2"], pr=pkt["pr"], battery=pkt["batt"],
                             last_sample=now.isoformat(), last_error=None)
                    else:
                        _set(name, worn=pkt["worn"], last_error=None if pkt["worn"] else "not on finger")

                await client.start_notify(notify_char, on_data)
                if write_char is not None:
                    try:
                        await client.write_gatt_char(write_char, viatom.START_CMD, response=False)
                    except Exception as e:
                        log.info("%s start-cmd write skipped: %r", name, e)   # some models auto-stream
                while client.is_connected and not _STOP.is_set():
                    await asyncio.sleep(1)
        except Exception as e:
            _set(name, connected=False, last_error=repr(e))
            log.warning("%s link error: %r", name, e)
        finally:
            if wr:
                wr.close()
        if not _STOP.is_set():
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


async def run_oxyii(dev: dict, root: str):
    """Wellue O2Ring-S / T8520 ("S8-AW…") — live SpO2 + pulse over the OxyII protocol (NOT legacy Viatom).
    No bonding. Flow: connect → auth(0xFF) → setup(0x10) → poll cmd=0x04 ~1/s. Emits the ViHealth CSV
    OxyDex parses + pushes spo2/pr to the monitor."""
    name, addr = dev["name"], dev["address"]
    backoff = 5
    while not _STOP.is_set():
        if _OXYII_PAUSE.is_set() or _RECOVER.is_set():   # a stored-session pull owns the link, or the adapter is recovering
            _set(name, connected=False,
                 last_error="paused — pulling stored session" if _OXYII_PAUSE.is_set() else "adapter recovering")
            while (_OXYII_PAUSE.is_set() or _RECOVER.is_set()) and not _STOP.is_set():
                await asyncio.sleep(0.3)
            continue
        started = _now()
        ndir = night_dir(root, started)
        path = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, "spo2", "csv"))
        ppg_path = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, "ppg", "txt"))
        wr = ppgwr = None
        ppg_idx = [0]                                 # running sample index → synthesized sensor_ns
        try:
            _set(name, connected=False, address=addr, last_error=None)
            async with _connect_scan(addr) as client:
                _set(name, connected=True); log.info("%s connected", name); backoff = 5
                # Resolve write/notify chars by UUID (robust to a stale BlueZ service cache).
                wch = nch = None
                for s in client.services:
                    for ch in s.characteristics:
                        u = ch.uuid.lower()
                        if u == oxyii.OXYII_WRITE: wch = ch
                        if u == oxyii.OXYII_NOTIFY: nch = ch
                if not (wch and nch):
                    _set(name, last_error="OxyII service absent (ring in recording mode? press its button)")
                    raise RuntimeError("no oxyii chars")
                wr = Spo2CsvWriter(path)
                ppgwr = StreamWriter(ppg_path, "ppg")   # ~125 Hz finger pleth (Phase 2)
                reasm = oxyii.Reassembler()

                def on_data(_s, d):
                    for frame in reasm.feed(bytes(d)):
                        r = oxyii.decode(frame)
                        if not r or r[0] != oxyii.OP_LIVE:
                            continue
                        if _PPG_PROBE and _ppg_probe_n[0] < _PPG_PROBE_N:   # Phase-0/1 dump (OXYII_PPG_PROBE=1)
                            _ppg_probe_n[0] += 1
                            try:
                                with open(_PPG_PROBE_FILE, "a") as _pf:
                                    _pf.write(json.dumps({"n": _ppg_probe_n[0], "t": _now().isoformat(),
                                                          "len": len(r[1]), "hex": r[1].hex()}) + "\n")
                            except Exception:
                                pass
                            if _ppg_probe_n[0] == _PPG_PROBE_N:
                                log.info("O2RING-PPG-PROBE: dumped %d frames → %s", _PPG_PROBE_N, _PPG_PROBE_FILE)
                        # ~125 Hz PPG waveform body (Phase 2): back-time each sample across the frame from
                        # its host arrival, write the PSL ppg layout, and push a live trace to the monitor.
                        ppg = oxyii.parse_ppg(r[1])
                        if ppg:
                            arr = _now()
                            nps = len(ppg)
                            for i, v in enumerate(ppg):
                                ph = arr - _dt.timedelta(seconds=(nps - 1 - i) / O2PPG_FS)
                                ppgwr.write_ppg(ph, ppg_idx[0] * O2PPG_NS_STEP, 0.0, (v, v, v), 0)
                                ppg_idx[0] += 1
                            BUS.push("o2ppg", ppg)
                        live = oxyii.parse_live(r[1])
                        if not live:
                            continue
                        now = _now()
                        if live["spo2"] is not None:
                            wr.write(now, live["spo2"], live["pr"] or 0, live["motion"])
                            BUS.push("spo2", [live["spo2"]])
                            if live["pr"]:
                                BUS.push("pr", [live["pr"]])
                            BUS.push("motion_o2", [live["motion"]])   # raw movement level (~1/s)
                            _set(name, rows=wr.rows, spo2=live["spo2"], pr=live["pr"], battery=live["batt"],
                                 motion=live["motion"], worn=True, last_sample=now.isoformat(), last_error=None)
                        else:
                            BUS.push("motion_o2", [live["motion"]])
                            _set(name, worn=live["worn"], motion=live["motion"],
                                 last_error=None if live["worn"] else "no finger contact")

                BUS.register("motion_o2", "Motion (O2Ring)", "lvl", 0)
                BUS.register("o2ppg", "PPG (O2Ring)", "raw", O2PPG_FS)   # finger pleth, Phase 2
                await client.start_notify(nch, on_data)
                await client.write_gatt_char(wch, oxyii.auth_frame(), response=False)   # 0xFF: no reply
                await asyncio.sleep(0.6)
                await client.write_gatt_char(wch, oxyii.setup_frame(), response=False)  # 0x10: ack
                await asyncio.sleep(0.6)
                # Sync the ring's free-running RTC to the NTP-synced host once per connect, so its stored
                # .dat timestamps match the live capture (they drifted ~+151 s — see oxyii.set_time_frame).
                _clk = _now()
                await client.write_gatt_char(wch, oxyii.set_time_frame(_clk), response=False)   # 0xC0
                log.info("%s RTC synced to host %s", name, _clk.strftime("%Y-%m-%d %H:%M:%S"))
                await asyncio.sleep(0.4)
                while client.is_connected and not _STOP.is_set() and not _OXYII_PAUSE.is_set() and not _RECOVER.is_set():   # poll live ~1/s
                    await client.write_gatt_char(wch, oxyii.live_frame(), response=False)
                    await asyncio.sleep(1.0)
        except Exception as e:
            _set(name, connected=False, last_error=repr(e))
            log.warning("%s link error: %r", name, e)
        finally:
            if wr:
                wr.close()
            if ppgwr:
                ppgwr.close()
        if not _STOP.is_set():
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


async def pull_oxyii_session(dev: dict, root: str, which: str = "latest", ftype: int = 0) -> dict:
    """Pull the O2Ring's ONBOARD-recorded session(s) off flash to <root>/captures/stored/*.dat, driven from
    the monitor. Pauses live capture first (the ring has one BLE link), runs the same pull_session flow the
    CLI uses, then resumes. Returns the newly written files + their .meta.json so the UI can report them."""
    import pull_session
    name = dev["name"]
    out_dir = os.path.join(root, "captures", "stored")
    os.makedirs(out_dir, exist_ok=True)
    saved = []
    # ONE download at a time across ALL devices — a concurrent pull fights for the single radio and both
    # fail (2026-07-18 09:00: three overlapping ops → org.bluez.Error.InProgress). Raises OfflineBusy.
    async with offline_lock.slot(name):
        _OXYII_PAUSE.set()
        try:
            for _ in range(120):                      # wait up to ~12 s for run_oxyii to drop its link
                if not STATUS.get("devices", {}).get(name, {}).get("connected"):
                    break
                await asyncio.sleep(0.1)
            await asyncio.sleep(0.8)                   # let BlueZ fully tear the link down before re-scanning
            log.info("%s: pulling stored session (which=%s) — live capture paused", name, which)
            saved = await pull_session.pull(dev["address"], out_dir, which=which, ftype=ftype,
                                            adapter=(await adapter_kw()).get("adapter"),
                                            serial="0000", wait=45) or []
        finally:
            _OXYII_PAUSE.clear()                      # resume live capture no matter how the pull ended
            log.info("%s: stored-session pull finished — resuming live capture", name)

    def _meta(f):
        try:
            with open(f + ".meta.json") as fh:
                return json.load(fh)
        except Exception:
            return {}
    return {"ok": True, "new_files": [os.path.basename(f) for f in saved],
            "sessions": [_meta(f) for f in saved], "out_dir": out_dir}


async def polar_offline_op(address: str, op):
    """Run a PS-FTP offline op (list/pull) while the daemon's run_polar for `address` is paused, so the
    pull owns the device's single BLE link instead of colliding with the live-capture reconnect loop
    (org.bluez.Error.InProgress). `op` is a zero-arg coroutine factory; its result is returned. Resumes
    live capture no matter how `op` ends."""
    name = next((n for n, s in STATUS.get("devices", {}).items() if s.get("address") == address), None)
    # ONE download at a time across ALL devices (see offline_lock) — raises OfflineBusy if another device
    # is mid-download, instead of letting two pulls fight over the single radio.
    async with offline_lock.slot(name or address):
        _POLAR_PAUSED.add(address)
        try:
            for _ in range(120):                      # wait up to ~12 s for run_polar to drop its link
                if not (name and STATUS["devices"].get(name, {}).get("connected")):
                    break
                await asyncio.sleep(0.1)
            await asyncio.sleep(0.8)                   # let BlueZ fully tear the link down before re-connecting
            log.info("Polar %s: offline-recording op — live capture paused", address)
            # Hold _CONNECT_LOCK for the whole op: BlueZ serialises connection ESTABLISHMENT per adapter, so
            # the PS-FTP connect must not race a concurrent H10/O2Ring reconnect (→ org.bluez.Error.InProgress).
            # The other tasks' reconnects simply queue behind the pull; it's a deliberate, finite user action.
            async with _CONNECT_LOCK:
                return await op()
        finally:
            _POLAR_PAUSED.discard(address)
            log.info("Polar %s: offline op finished — resuming live capture", address)


async def status_loop(root: str):
    path = os.path.join(root, "captures", "status.json")
    while not _STOP.is_set():
        STATUS["updated"] = _now().isoformat()
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                json.dump(STATUS, f, indent=2)
        except Exception as e:
            log.warning("status write: %r", e)
        await asyncio.sleep(10)


async def adapter_watchdog(adapter_mac, cfg: dict):
    """Detect a WEDGED BLE adapter (all worn sensors unreachable though the radio is up — the frozen-
    monitor failure) and auto-recover, WITHOUT reacting to the benign 'sensors simply not worn' state.

    Signals & the not-worn distinction live in `classify_adapter_health` (InProgress / phantom BlueZ link
    = wedge; clean not-found = not worn = leave alone). Recovery LADDER, gentlest first, with grace +
    a hard cap so it can never loop:
      L1 (every wedged check, cheap): `bluetoothctl disconnect` any phantom-linked device → it re-advertises.
      L2 (after `grace_checks` consecutive wedged checks): power-cycle the controller (bonds survive) while
         _RECOVER pauses the device tasks. Capped at `max_adapter_cycles`; past that it logs CRITICAL and
         stops (an external supervisor / systemd is the outer layer on the real box).
    A single connected+streaming device, or a clean not-worn read, resets the counters."""
    wcfg = cfg.get("watchdog") or {}
    if not wcfg.get("enabled", True):
        log.info("adapter watchdog disabled by config")
        return
    interval = float(wcfg.get("interval_sec", 60))
    grace = int(wcfg.get("grace_checks", 2))
    max_cycles = int(wcfg.get("max_adapter_cycles", 3))
    consecutive = cycles = 0
    sel = f"select {adapter_mac}\n" if adapter_mac else ""
    while not _STOP.is_set():
        await asyncio.sleep(interval)
        if _RECOVER.is_set() or _OXYII_PAUSE.is_set() or _POLAR_PAUSED:
            continue                                  # don't diagnose during a pull / recovery
        devs = []
        for d in cfg.get("devices", []):
            st = STATUS.get("devices", {}).get(d["name"], {})
            bluez = False
            try:
                info = await bonding._btctl(f"info {d['address']}\nquit\n", timeout=6)
                bluez = "Connected: yes" in info
            except Exception:
                pass
            devs.append({"name": d["name"], "address": d["address"],
                         "connected": bool(st.get("connected")), "last_error": st.get("last_error"),
                         "bluez_connected": bluez})
        h = classify_adapter_health(devs)
        if not h["wedged"]:
            if consecutive:
                log.info("watchdog: adapter healthy again")
            consecutive = cycles = 0
            continue
        consecutive += 1
        log.warning("watchdog: wedge sign %d/%d — %s", consecutive, grace, "; ".join(h["reasons"]))
        for addr in h["phantom"]:                     # L1: clear stale links (cheap, non-disruptive)
            log.warning("watchdog: clearing phantom link %s", addr)
            try:
                await bonding._btctl(f"disconnect {addr}\nquit\n", timeout=8)
            except Exception:
                pass
        if consecutive >= grace:                      # L2: power-cycle the controller
            if cycles >= max_cycles:
                log.error("watchdog: adapter STILL wedged after %d power-cycles — stopping auto-recovery "
                          "(needs external supervisor / manual reset)", max_cycles)
                continue
            cycles += 1
            consecutive = 0
            log.warning("watchdog: power-cycling adapter %s (attempt %d/%d)", adapter_mac, cycles, max_cycles)
            _RECOVER.set()
            try:
                await asyncio.sleep(1.5)              # let device tasks drop their links first
                await bonding._btctl(f"{sel}power off\nquit\n", timeout=8)
                await asyncio.sleep(2)
                await bonding._btctl(f"{sel}power on\nquit\n", timeout=8)
                await asyncio.sleep(3)
            finally:
                _RECOVER.clear()                      # device tasks resume + reconnect on the fresh radio


async def rssi_poller(adapter_mac, cfg: dict):
    """Poll each CONNECTED sensor's connection RSSI (dBm) via the privileged helper and surface it in
    STATUS → the monitor's weak-signal warning. Enrichment only: where the sudoers grant is absent (e.g. a
    dev desktop) every read is None, so the poller disables itself after a few tries and the UI falls back
    to the always-available stream-rate health. hcitool reads an EXISTING ACL link, so this never disturbs
    capture. See link_rssi.py for why connection RSSI needs a privileged helper on BlueZ."""
    lcfg = cfg.get("link") or {}
    if not lcfg.get("rssi_enabled", True):
        return
    interval = float(lcfg.get("rssi_interval_sec", 25))
    # When the helper/grant is absent every read is None. Back OFF to a slow retry rather than exiting:
    # the sudoers grant is often installed while the daemon is already running, and a poller that gave up
    # permanently meant RSSI stayed dead until the next restart (observed 2026-07-18).
    retry_idle = float(lcfg.get("rssi_retry_sec", 600))
    misses = 0                       # consecutive polls where a device was connected but every read failed
    idle = False                     # True once we've concluded the helper isn't usable (slow re-probe)
    while not _STOP.is_set():
        await asyncio.sleep(retry_idle if idle else interval)
        if _RECOVER.is_set() or _OXYII_PAUSE.is_set() or _POLAR_PAUSED:
            continue                 # don't poke the radio mid-pull / mid-recovery
        any_link = got_any = False
        for d in cfg.get("devices", []):
            name, addr = d.get("name"), d.get("address")
            if not name or not addr:
                continue
            if not STATUS["devices"].get(name, {}).get("connected"):
                _set(name, rssi=None)         # stale reading must not linger on a dropped device
                continue
            any_link = True
            rssi = await link_rssi.read_rssi(adapter_mac, addr)
            if rssi is not None:
                got_any = True
                _set(name, rssi=rssi)
        if any_link and not got_any:
            misses += 1
            if misses >= 3 and not idle:
                idle = True          # slow re-probe, NOT a permanent stop
                log.info("link RSSI unavailable (no privileged helper / sudoers grant) — weak-signal "
                         "warning uses stream rate only; re-probing every %.0fs", retry_idle)
        elif got_any:
            if idle:
                log.info("link RSSI now available — resuming %.0fs polling", interval)
            misses, idle = 0, False   # a grant installed at runtime is picked up without a restart


async def main():
    global ADAPTER
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.yaml")
    args = ap.parse_args()
    import yaml   # runtime-only dep; imported here so `import capture` (for unit tests) needs no external deps
    cfg = yaml.safe_load(open(args.config))
    root = cfg["root"]
    ADAPTER = cfg.get("adapter")   # BLE adapter MAC — pins bonding AND every bleak connect (adapter_kw)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _STOP.set)

    tasks = [asyncio.create_task(status_loop(root)),
             asyncio.create_task(adapter_watchdog(ADAPTER, cfg)),
             asyncio.create_task(rssi_poller(ADAPTER, cfg))]

    def _spawn(dev: dict):
        # Refuse to capture a device missing identity fields — otherwise capture_filename() emits
        # `__<id>_..._STREAM.txt` (empty vendor/model), which happened via a hot-Remember with an
        # unrecognized sensor (guessDevice left vendor/model blank). FOLLOWUPS-II §F1.
        missing = [k for k in ("name", "vendor", "model", "device_id") if not str(dev.get(k) or "").strip()]
        if missing:
            log.warning("skipping device — missing %s: %r", ",".join(missing), dev.get("address") or dev)
            if dev.get("name"):
                _set(dev["name"], last_error="not captured — missing " + ",".join(missing))
            return
        v = dev.get("vendor")
        if v == "Muse":
            runner = run_muse
        elif v in ("Wellue", "Viatom"):
            # OxyII (O2Ring-S / T8520) is the verified default; opt into the legacy protocol per-device.
            runner = run_viatom if dev.get("protocol") == "legacy" else run_oxyii
        else:
            runner = run_polar
        tasks.append(asyncio.create_task(runner(dev, root)))

    for dev in cfg.get("devices", []):
        _spawn(dev)

    async def _pull(which: str = "latest", ftype: int = 0) -> dict:
        # Monitor "Pull stored session" → download the O2Ring's onboard .dat (pauses live capture).
        dev = next((d for d in cfg.get("devices", []) if d.get("vendor") in ("Wellue", "Viatom")), None)
        if not dev:
            raise RuntimeError("no O2Ring / Wellue device configured")
        return await pull_oxyii_session(dev, root, which, ftype)

    # Monitor + control web surface (HEALTH-BOX-VISION §4 hero live-view). On by default; bind LAN only.
    web_runner = None
    wcfg = cfg.get("web", {}) or {}
    if wcfg.get("enabled", True):
        import webmon
        host, port = wcfg.get("host", "0.0.0.0"), int(wcfg.get("port", 8760))
        web_runner = await webmon.start(
            webmon.make_app(BUS, cfg, args.config, ADAPTER, STATUS, _spawn,
                            pull_stored=_pull, polar_pause=polar_offline_op), host, port)
        log.info("monitor: http://%s:%d/", host, port)

    # Surface the resolved adapter at boot: a silent mis-pin (hci re-enumeration) is exactly the failure
    # that cost 2026-07-18 — connects hung against the wrong radio with nothing in the log naming it.
    if ADAPTER:
        _hci = await link_rssi.resolve_hci(ADAPTER, refresh=True)
        log.info("BLE adapter pinned: %s → %s", ADAPTER, _hci or "NOT FOUND (using BlueZ default)")
    else:
        log.info("BLE adapter: BlueZ default (no `adapter:` in config — pin it to survive re-enumeration)")
    log.info("tepna-capture up: %d device(s), root=%s", len(cfg.get("devices", [])), root)
    await _STOP.wait()
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    if web_runner:
        await web_runner.cleanup()
    log.info("tepna-capture stopped")


if __name__ == "__main__":
    asyncio.run(main())
