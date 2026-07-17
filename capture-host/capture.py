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
import yaml

from writers import StreamWriter, Spo2CsvWriter, capture_filename, night_dir
import polar_pmd as pmd
import viatom
import oxyii
import bonding
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


@contextlib.asynccontextmanager
async def _connect(addr: str):
    from bleak import BleakClient as _BC
    client = _BC(addr)
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

                # Hold the link until disconnect or shutdown.
                secs = 0
                while client.is_connected and not _STOP.is_set():
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
        started = _now()
        ndir = night_dir(root, started)
        path = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, "spo2", "csv"))
        wr = None
        try:
            _set(name, connected=False, address=addr, last_error=None)
            async with _connect(addr) as client:
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
                reasm = oxyii.Reassembler()

                def on_data(_s, d):
                    for frame in reasm.feed(bytes(d)):
                        r = oxyii.decode(frame)
                        if not r or r[0] != oxyii.OP_LIVE:
                            continue
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
                await client.start_notify(nch, on_data)
                await client.write_gatt_char(wch, oxyii.auth_frame(), response=False)   # 0xFF: no reply
                await asyncio.sleep(0.6)
                await client.write_gatt_char(wch, oxyii.setup_frame(), response=False)  # 0x10: ack
                await asyncio.sleep(0.6)
                while client.is_connected and not _STOP.is_set():                       # poll live ~1/s
                    await client.write_gatt_char(wch, oxyii.live_frame(), response=False)
                    await asyncio.sleep(1.0)
        except Exception as e:
            _set(name, connected=False, last_error=repr(e))
            log.warning("%s link error: %r", name, e)
        finally:
            if wr:
                wr.close()
        if not _STOP.is_set():
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


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


async def main():
    global ADAPTER
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.yaml")
    args = ap.parse_args()
    cfg = yaml.safe_load(open(args.config))
    root = cfg["root"]
    ADAPTER = cfg.get("adapter")   # BLE adapter MAC for bonding; None = default controller
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _STOP.set)

    tasks = [asyncio.create_task(status_loop(root))]

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

    # Monitor + control web surface (HEALTH-BOX-VISION §4 hero live-view). On by default; bind LAN only.
    web_runner = None
    wcfg = cfg.get("web", {}) or {}
    if wcfg.get("enabled", True):
        import webmon
        host, port = wcfg.get("host", "0.0.0.0"), int(wcfg.get("port", 8760))
        web_runner = await webmon.start(
            webmon.make_app(BUS, cfg, args.config, ADAPTER, STATUS, _spawn), host, port)
        log.info("monitor: http://%s:%d/", host, port)

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
