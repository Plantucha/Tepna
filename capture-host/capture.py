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
from writers import (StreamWriter, Spo2CsvWriter, LinkLogWriter, OxyFrameLogWriter,
                     HostClockLogWriter, capture_filename, night_dir)
import polar_pmd as pmd
import viatom
import oxyii
import bonding
import link_rssi
import host_clock
import offline_lock
from telemetry import TelemetryBus

HR_UUID = "00002a37-0000-1000-8000-00805f9b34fb"   # standard Heart Rate Measurement (RR intervals)
BATTERY_UUID = "00002a19-0000-1000-8000-00805f9b34fb"   # standard Battery Level (0x2A19) — uint8 percent
log = logging.getLogger("tepna-capture")
_POLAR_EPOCH = _dt.datetime(2000, 1, 1)   # Polar device-time epoch (TimeSystemExplained.md)
STATUS: dict = {"updated": None, "devices": {}}
_CFG: dict = {}          # set in main(); lets sync_device_time resolve a device family by model
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
# MEASURED rate. The old 125.0 was a round guess and it was 0.59% LOW, which matters: the phone-timestamp
# column re-anchors to each frame's arrival (so wall-clock never drifts), but the synthesized relative-ms
# column is a pure fs grid — so a consumer that infers fs from it (ECGDex does exactly that) got 125.00 for
# a stream really running at 125.74, i.e. a 0.59% wrong sample rate and ~212 s of divergence between the two
# time columns over a 10 h night.
# Calibrated 2026-07-18 over 12 capture sessions: 5.8 h, 2 616 483 samples, weighted mean 125.738 Hz with a
# per-session spread of only 125.59-125.88 Hz (±0.12%) — the short-window swings (~84-147 Hz) are BLE delivery
# jitter, not the ADC clock, which is stable. Validated on ONE unit (S8-AW 2100); `o2ring.ppg_fs` in config
# overrides it if another ring measures differently.
O2PPG_FS_DEFAULT = 125.738
O2PPG_FS = O2PPG_FS_DEFAULT           # re-read from config in main(); see cfg['o2ring']['ppg_fs']
O2PPG_NS_STEP = int(1e9 / O2PPG_FS)   # 7_953_041 ns → relative-ms steps of ~7.953 ms (reads as 125.74 Hz)

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


def _utcnow():
    """Device clocks are set in UTC (see polar_psftp.set_local_time), so skew is measured against UTC."""
    return _dt.datetime.utcnow()


# BlueZ/bleak errors that mean "busy, try again", NOT "this will never work". A daemon restart leaves
# the previous connection tearing down, so the first sync attempt routinely hits InProgress — and the
# auto-sync used to treat that as fatal and give up for the whole session (observed 2026-07-18: both
# Polars spent the evening with clock_synced unset after a restart). Deliberately does NOT match a real
# protocol refusal such as NOT_IMPLEMENTED / error 201, which must still give up immediately.
_TRANSIENT_BLE = ("inprogress", "in progress", "not ready", "notready", "temporarily unavailable",
                  "devicenotfound", "not advertising", "timeout", "timeouterror", "busy",
                  "abort-by-local", "disconnected", "no reply", "not connected")


def transient_ble_error(exc: BaseException) -> bool:
    """True when a BLE failure is worth retrying rather than surrendering the whole session."""
    text = repr(exc).lower()
    if "not_implemented" in text or "error 201" in text:
        return False              # a genuine protocol refusal — retrying cannot help
    return any(m in text for m in _TRANSIENT_BLE)


# How far a device clock may sit from the host before it counts as a fault worth re-syncing. Generous
# vs the 0.03 s a healthy synced Polar shows, tight vs the YEARS an unsynced H10 is out by.
CLOCK_TOLERANCE_S = 2.0
CHARGE_RETRY_S = 60          # how often to re-attempt PMD START while a device sits on the charger
_CHARGING: set[str] = set()  # devices currently refusing PMD with in_charger (log-once bookkeeping)


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
    # Sync the device clock ONCE at task start, BEFORE the PMD link is established. Polar stamps every
    # sample with device time, and an H10 resets to its 2019 firmware default whenever it leaves the
    # strap — so without this `sensor timestamp [ns]` is meaningless and siblings share no origin.
    # It must happen here, not inside the connected session: the PS-FTP client needs the device's single
    # BLE link, and polar_offline_op waits for run_polar to release it (calling it from inside would
    # deadlock — run_polar would be awaiting a pause only run_polar can grant).
    if (_CFG.get("time") or {}).get("auto_sync_devices", True):
        # Every device task starts at once and each wants the single offline slot, so the losers get
        # OfflineBusy. Fail-fast is right for a user-clicked pull (don't leave the browser spinning) but
        # wrong here — an auto-sync should simply WAIT ITS TURN, or the second sensor silently never
        # syncs and the two end up on different timebases (observed 2026-07-18: the Verity lost the race
        # and stayed 4 h off the H10). Retry on busy only; a real failure still gives up.
        for attempt in range(12):
            try:
                await sync_device_time(addr)
                _set(name, clock_synced=_now().isoformat(timespec="seconds"))
                break
            except offline_lock.OfflineBusy:
                await asyncio.sleep(5)
            except Exception as e:
                # A transient BlueZ state is a BUSY signal from a different layer, not a failure.
                # Surrendering here left the device stamping samples from an unsynced clock all night.
                if transient_ble_error(e):
                    log.info("%s clock auto-sync busy (%s) — retry %d/12",
                             name, type(e).__name__, attempt + 1)
                    await asyncio.sleep(min(5 * (attempt + 1), 30))
                    continue
                log.warning("%s clock auto-sync failed: %r", name, e)
                break
        else:
            log.warning("%s clock auto-sync gave up — device stayed unreachable/busy", name)
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
        charging_hold = False              # device refused PMD because it is on the charger (status 0x0D).
        # Declared HERE, outside the try, because both readers live outside the block that sets it: the
        # link-hold loop and the reconnect-delay below. (It was first declared next to `stream_fs` inside
        # the connected session — an UnboundLocalError on every device that never reached the PMD path.)
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
                    # The strap sends HR (bpm) alongside the RR intervals and we already write both to
                    # the file — but only RR was ever pushed to the monitor, so the device's own HR had
                    # no card at all. Both are real: RR is the HRV substrate, HR is the device's reading.
                    BUS.register(_live_key("bpm", tag), f"HR ({name})", "bpm", 0)

                # PMD data handler — one char carries all PMD streams; route by measurement type.
                def on_pmd(_sender, data: bytearray):
                    arrival = _now()
                    try:
                        meas, samples = pmd.decode_frame(bytes(data), arrival, fs=stream_fs.get(data[0]))
                    except ValueError as e:
                        _set(name, last_error=str(e)); return
                    # Diagnostic (inert unless PMD_FRAME_PROBE names a file): records what each frame
                    # ACTUALLY carried vs how many samples we got out of it. Written to answer the Verity
                    # IMU starvation — ACC/GYRO/MAG deliver ~35-44% of nominal with no decode error, so we
                    # need frame_type + payload size + decoded count to see whether we under-extract.
                    if _PMD_PROBE:
                        _pmd_probe(meas, bytes(data), len(samples), arrival)
                    wr = writers.get(meas)
                    if not wr or not samples:
                        return
                    # Device-clock skew, measured live off the frame's own timestamp. This is the honest
                    # confirmation that a sync took effect (and the H10 resets to its 2019 default
                    # whenever it leaves the strap, so it must be watched, not assumed).
                    try:
                        dev_dt = _POLAR_EPOCH + _dt.timedelta(microseconds=samples[-1].sensor_ns / 1000)
                        _set(name, device_time=dev_dt.isoformat(timespec="seconds"),
                             clock_skew_sec=round((dev_dt - _utcnow()).total_seconds(), 2))
                    except Exception:
                        pass
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
                    if bpm:
                        BUS.push(_live_key("bpm", tag), [float(bpm)], 0)

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
                        # Log the device's OWN menu of options — the same list Polar Sensor Logger shows
                        # in its per-stream dialog. This is authoritative (read off the hardware) and it
                        # is what makes a rate CHOICE possible: H10 ACC defaults to 200 Hz = 369 MB/night,
                        # 30 % of everything the box writes.
                        if settings:
                            log.info("%s %s options: %s", name, pmd.MEAS_NAME.get(meas, meas),
                                     " ".join(f"{pmd.SETTING_NAME.get(k, hex(k))}={v}"
                                              for k, v in sorted(settings.items())))
                        _rates_cfg = (dev.get("rates") or {})
                        _prefer = _rates_cfg.get(pmd.MEAS_NAME.get(meas, ""))
                        used_fs = pmd.chosen_rate(meas, settings, _prefer)
                        # publish the device's own menu so Settings can offer exactly the legal values
                        _set(name, **{"pmd_options": {**(STATUS["devices"].get(name, {}).get("pmd_options") or {}),
                                                      pmd.MEAS_NAME.get(meas, str(meas)): settings.get(0x00) or []}})
                        started = False
                        transient = False
                        for cmd, how in ((pmd.build_start(meas, settings, _prefer), "negotiated"),
                                         (pmd.START.get(meas), "fixed")):
                            if not cmd:
                                continue
                            ack = await _ctrl(cmd)
                            st = ack[3] if len(ack) >= 4 else 0xFF
                            # 0x0D in_charger / 0x0C invalid_state are TRANSIENT DEVICE STATES, not bad
                            # settings. A Polar refuses PMD while charging; that is expected, not a fault.
                            transient = pmd.is_transient(st)
                            # Charging is rechecked on a cadence; log the state ONCE per transition so a
                            # device left on the dock overnight doesn't emit 3 lines a minute until dawn.
                            _lvl = (log.warning if not (pmd.is_started(st) or transient)
                                    else log.debug if transient and name in _CHARGING else log.info)
                            _lvl(
                                "%s START %s (%s) → %s", name, pmd.MEAS_NAME.get(meas, meas), how,
                                pmd.CTRL_STATUS.get(st, hex(st)))
                            if pmd.is_started(st):    # ok, or already-streaming
                                started = True
                                break
                            if transient:
                                break                 # retrying the fixed cmd cannot help while charging
                        if started:                  # record + re-register at the ACTUAL negotiated rate
                            stream_fs[meas] = used_fs
                            _register(meas, used_fs)
                            _set(name, charging=False)
                            _CHARGING.discard(name)
                        elif transient:
                            # Do NOT tear the stream down: the settings are fine, the device is simply
                            # charging. Destroying the writer here deleted the file AND unregistered the
                            # card, and since the link SURVIVES on the charger the START loop would not
                            # re-run — so the stream stayed dead even after the device came off charge,
                            # until something forced a reconnect. Keep it and let the session end so the
                            # reconnect loop retries the whole negotiation.
                            _set(name, charging=True,
                                 last_error="charging — PMD streams unavailable until off the charger")
                            _CHARGING.add(name)
                            charging_hold = True
                            break
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
                while (client.is_connected and not _STOP.is_set() and addr not in _POLAR_PAUSED
                       and not _RECOVER.is_set() and not charging_hold):
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
            if charging_hold:
                # Not a fault, so it must not ride the error backoff: recheck on a steady cadence so the
                # streams come back on their own within a minute of the device leaving the charger.
                await asyncio.sleep(CHARGE_RETRY_S)
            else:
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
        wr = ppgwr = oxyflagwr = None
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
                # The 125 Hz pleth is togglable (Settings). It is ~191 MB/night — the second largest
                # stream on the box — so it must be possible to turn off. Absent streams list => both on,
                # matching the behaviour before the toggle existed.
                ppgwr = (StreamWriter(ppg_path, "ppg")
                         if "ppg" in (dev.get("streams") or ["spo2", "ppg"]) else None)
                # Byte-11 identification experiment (see writers.OxyFrameLogWriter). ~1 Hz, ~1 MB/night,
                # and a SIDECAR so the vendor SpO2 CSV layout OxyDex parses stays byte-identical.
                oxyflagwr = OxyFrameLogWriter(os.path.join(
                    ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"],
                                           started, "oxyframe", "txt")))
                reasm = oxyii.Reassembler()
                # Previous session duration. NOT a drop/dup tally any more: the counters those fields
                # fed were derived from a misread byte, so they reported phantom loss. The ring exposes
                # no frame-sequence field, so we report NOTHING rather than a fabricated zero.
                _seq = [None]

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
                        ppg = oxyii.parse_ppg(r[1]) if ppgwr else []   # skip the decode entirely when off
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
                        if oxyflagwr:
                            oxyflagwr.write(_now(), live)   # PI + the fields the vendor CSV cannot carry
                        # [0:4] is the ring's SESSION DURATION, not a frame counter — the old
                        # frame_gap() accounting on it reported phantom loss (9 warnings in one
                        # evening, one claiming 111 frames, which was a session starting). What the
                        # field genuinely tells us is when a NEW session began.
                        if oxyii.session_restarted(_seq[0], live["duration"]):
                            log.info("%s: ring started a new recording session", name)
                        _seq[0] = live["duration"]
                        now = _now()
                        if live["spo2"] is not None:
                            wr.write(now, live["spo2"], live["pr"] or 0, live["motion"])   # [11], corrected
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
                if ppgwr:                                   # no card for a stream we are not capturing
                    BUS.register("o2ppg", "PPG (O2Ring)", "raw", O2PPG_FS)   # finger pleth, Phase 2
                await client.start_notify(nch, on_data)
                await client.write_gatt_char(wch, oxyii.auth_frame(), response=False)   # 0xFF: no reply
                await asyncio.sleep(0.6)
                await client.write_gatt_char(wch, oxyii.setup_frame(), response=False)  # 0x10: ack
                await asyncio.sleep(0.6)
                # Sync the ring's free-running RTC to the NTP-synced host once per connect, so its stored
                # .dat timestamps match the live capture (they drifted ~+151 s — see oxyii.set_time_frame).
                # LOCAL CIVIL time, deliberately different from the Polars' UTC. The ring has a SCREEN:
                # a wearer reading UTC off their finger would just be confused. Nothing is given up —
                # its live samples are host-arrival stamped (no device timestamp at all), so its RTC never
                # fed cross-device timing; it only stamps the stored .dat, which is read by humans.
                _clk = _now()
                await client.write_gatt_char(wch, oxyii.set_time_frame(_clk), response=False)   # 0xC0
                _set(name, clock_synced=_now().isoformat(timespec="seconds"))
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
            if oxyflagwr:
                oxyflagwr.close()
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
            def _prog(off, size):
                _set(name, pull_progress={"device": name, "bytes": off, "total": size,
                                          "pct": (100 * off // size) if size else 0})
            saved = await pull_session.pull(dev["address"], out_dir, which=which, ftype=ftype,
                                            adapter=(await adapter_kw()).get("adapter"),
                                            serial="0000", wait=45, on_progress=_prog) or []
        finally:
            _OXYII_PAUSE.clear()                      # resume live capture no matter how the pull ended
            _set(name, pull_progress=None)            # clear the UI bar even on failure/abort
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


async def sync_device_time(address: str) -> dict:
    """Set a Polar device's internal clock from this (NTP-disciplined) host, then READ IT BACK.

    Why it matters: Polar stamps every sample with device time (ns since 2000-01-01). An unset device
    runs from a firmware default — measured 2026-07-18, the H10 sat at 2019-01-01 (it resets whenever it
    leaves the strap) while the Verity held UTC, 4 h off our local civil convention. Setting both from
    one host clock makes `sensor timestamp [ns]` a real wall clock AND gives sibling devices a COMMON
    origin, which is the precondition cross-device timing (PAT) has been blocked on.

    Runs through polar_offline_op so it owns the device's single BLE link (capture pauses, then resumes).
    Returns before/after device time so the caller can show that it actually took effect."""
    dev = next((d for d in _CFG.get("devices", []) if d.get("address") == address), {}) if _CFG else {}
    is_h10 = "h10" in str(dev.get("model", "") or dev.get("name", "")).lower()

    import polar_psftp        # runtime-only (pulls bleak) — keeps `import capture` stdlib-clean for CI

    async def _op():
        async with polar_psftp.PolarPsFtp(address, adapter=(await adapter_kw()).get("adapter")) as fs:
            before = after = None
            if not is_h10:                             # H10 implements neither GET_LOCAL_TIME nor
                try:                                   # SET_SYSTEM_TIME (error 201 NOT_IMPLEMENTED)
                    before = await fs.get_local_time()
                except Exception:
                    pass
            await fs.set_local_time(with_system_time=not is_h10)
            host_at_read = None
            if not is_h10:
                try:
                    after = await fs.get_local_time()
                    host_at_read = _utcnow()   # UTC: device clocks are set in UTC. Sampled AT the read so
                except Exception:              # is clock error and not BLE round-trip latency
                    pass
            return before, after, host_at_read
    before, after, host_at_read = await polar_offline_op(address, _op)
    host = host_at_read or _utcnow()
    skew = (after - host).total_seconds() if after else None
    log.info("%s: device clock %s -> %s (host %s, skew %s)", address,
             before.isoformat() if before else "unreadable",
             after.isoformat() if after else "unreadable",
             host.isoformat(timespec="seconds"), f"{skew:+.1f}s" if skew is not None else "?")
    return {"ok": True, "address": address, "readback": after is not None,
            "note": None if after else "device does not implement GET_LOCAL_TIME — verify via sensor_ns",
            "before": before.isoformat() if before else None,
            "after": after.isoformat() if after else None,
            "host": host.isoformat(), "skew_sec": round(skew, 1) if skew is not None else None}


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


# ── PMD frame diagnostic ────────────────────────────────────────────────────────────────────────────
# INERT unless PMD_FRAME_PROBE is set to an output path. Records one JSONL row per decoded PMD frame:
# measurement, frame_type (high bit = delta/compressed), payload bytes, and how many samples we actually
# extracted. That is exactly what distinguishes "the device sends fewer samples" from "we under-extract
# from each frame" — the open question behind the Verity ACC/GYRO/MAG starvation.
_PMD_PROBE = os.environ.get("PMD_FRAME_PROBE")
_PMD_PROBE_N = int(os.environ.get("PMD_FRAME_PROBE_N", "400"))
_pmd_probe_seen: dict[int, int] = {}


def _pmd_probe(meas: int, data: bytes, n_samples: int, arrival) -> None:
    seen = _pmd_probe_seen.get(meas, 0)
    if seen >= _PMD_PROBE_N:
        return
    _pmd_probe_seen[meas] = seen + 1
    try:
        with open(_PMD_PROBE, "a") as fh:
            fh.write(json.dumps({
                "meas": meas, "name": pmd.MEAS_NAME.get(meas, str(meas)),
                "frame_type": data[9], "delta": bool(data[9] & 0x80),
                "payload_len": len(data) - 10, "n_samples": n_samples,
                "t": arrival.isoformat(), "hex": data.hex(),   # raw frame: lets decoder variants be tested offline
            }) + "\n")
    except Exception:
        pass                      # a diagnostic must never disturb capture


async def clock_watchdog(cfg: dict):
    """Re-sync a device clock when it JUMPS, not merely when it is offset.

    The distinction matters. An H10 silently resets to its 2019 firmware default whenever it leaves the
    strap, which is a real fault worth correcting mid-session. But a device can also sit at a CONSTANT
    offset we do not control — the Verity stamps its PMD samples 4 h ahead of the clock we set, and no
    amount of re-syncing changes that (measured 2026-07-18). Triggering on "skew != 0" would re-sync it
    forever, pausing capture every cycle for nothing. So we trigger on a CHANGE in skew: a constant
    offset is recorded once and left alone; a jump means the device clock actually moved."""
    tcfg = cfg.get("time") or {}
    if not tcfg.get("auto_sync_devices", True):
        return
    interval = float(tcfg.get("drift_check_sec", 300))
    jump = float(tcfg.get("resync_jump_sec", 30))
    seen: dict[str, float] = {}
    while not _STOP.is_set():
        await asyncio.sleep(interval)
        if _RECOVER.is_set() or _OXYII_PAUSE.is_set() or _POLAR_PAUSED:
            continue
        for d in cfg.get("devices", []):
            name, addr = d.get("name"), d.get("address")
            if d.get("vendor") != "Polar" or not name or not addr:
                continue
            st = STATUS["devices"].get(name, {})
            skew = st.get("clock_skew_sec")
            if not st.get("connected") or skew is None:
                continue
            prev = seen.get(addr)
            seen[addr] = skew
            # TWO triggers, because a jump alone is not enough. A clock that is CONSTANTLY wrong never
            # jumps, so the jump-only watchdog would watch an H10 sit at its 2019 firmware default
            # forever — and the startup sync is then the only defence, which is exactly the thing that
            # can fail transiently. An absolute skew beyond tolerance is itself a fault worth correcting.
            jumped = prev is not None and abs(skew - prev) >= jump
            adrift = abs(skew) > CLOCK_TOLERANCE_S
            if not (jumped or adrift):
                continue                       # in tolerance and steady — nothing to do
            if adrift and not jumped:
                log.warning("%s device clock is %+.1fs off host (tolerance %.1fs) — re-syncing",
                            name, skew, CLOCK_TOLERANCE_S)
                _set(name, clock_synced=None)  # do not claim a sync we no longer believe
            elif jumped:
                log.warning("%s device clock JUMPED %+.1fs (%.1f -> %.1f) — re-syncing",
                            name, skew - prev, prev, skew)
            try:
                await sync_device_time(addr)
                _set(name, clock_synced=_now().isoformat(timespec="seconds"))
                seen.pop(addr, None)           # re-baseline after correcting
            except offline_lock.OfflineBusy:
                seen[addr] = prev              # retry next cycle
            except Exception as e:
                if transient_ble_error(e):
                    seen[addr] = prev          # busy, not broken — try again next cycle
                    log.info("%s clock re-sync busy (%s) — will retry", name, type(e).__name__)
                else:
                    log.warning("%s clock re-sync failed: %r", name, e)


async def host_clock_poller(cfg: dict, root: str | None = None):
    """Record HOST CLOCK PROVENANCE for the session, and surface it.

    The box pushes its own time into all three sensors, so an undisciplined host clock produces a night
    that is self-consistently wrong — PAT still works (common base), absolute time does not, and nothing
    looks broken. We deliberately do NOT stop syncing on an untrusted clock: leaving a device at its
    2019 firmware default is strictly worse than a common-but-wrong base. We record instead."""
    period = float((cfg.get("time") or {}).get("provenance_poll_sec", 120))
    writer = None
    prev_trust = None
    try:
        while not _STOP.is_set():
            try:
                st = await host_clock.read_state()
                STATUS["host_clock"] = st
                if prev_trust is not None and st.get("trust") != prev_trust:
                    # A transition is the newsworthy event: losing discipline mid-night means every
                    # timestamp after it is only as good as the RTC.
                    (log.warning if not st.get("absolute_ok") else log.info)(
                        "host clock %s → %s (%s)", prev_trust, st.get("trust"), st.get("reason"))
                prev_trust = st.get("trust")
                if root:
                    if writer is None:
                        night = night_dir(root, _now())
                        writer = HostClockLogWriter(
                            os.path.join(night, f"Tepna_{_now():%Y%m%d%H%M%S}_CLOCK.csv"))
                    writer.write(_now(), st)
            except Exception as e:                      # provenance must never take capture down
                log.debug("host clock poll failed: %r", e)
            await asyncio.sleep(period)
    finally:
        if writer:
            writer.close()


async def rssi_poller(adapter_mac, cfg: dict, root: str | None = None):
    """Poll link quality and write the LINK PROVENANCE sidecar.

    Two jobs, deliberately decoupled. The RSSI *read* needs a privilege the box may not have (see
    link_rssi) and backs off when unavailable; the LOG must keep ticking regardless, because connection
    state, battery and frame-drop counters are worth recording even with no RSSI at all. Conflating them
    meant a box without the sudoers grant logged nothing.
    """
    lcfg = cfg.get("link") or {}
    interval = float(lcfg.get("rssi_interval_sec", 25))
    retry_idle = float(lcfg.get("rssi_retry_sec", 600))
    want_rssi = lcfg.get("rssi_enabled", True)
    log_link = lcfg.get("log_enabled", True)

    writer = None
    if log_link and root:
        try:
            night = night_dir(root, _now())
            os.makedirs(night, exist_ok=True)
            writer = LinkLogWriter(os.path.join(night, f"Tepna_{_now():%Y%m%d%H%M%S}_LINK.csv"))
            log.info("link provenance → %s", writer.path)
        except Exception as e:
            log.warning("link log unavailable: %r", e)

    misses = 0
    idle = False          # RSSI reads idle; the LOG never idles
    next_rssi = 0.0
    try:
        while not _STOP.is_set():
            await asyncio.sleep(interval)
            if _RECOVER.is_set() or _OXYII_PAUSE.is_set() or _POLAR_PAUSED:
                continue                      # don't poke the radio mid-pull / mid-recovery
            now_mono = _time.monotonic()
            do_rssi = want_rssi and (not idle or now_mono >= next_rssi)
            any_link = got_any = False
            for d in cfg.get("devices", []):
                name, addr = d.get("name"), d.get("address")
                if not name or not addr:
                    continue
                st = STATUS["devices"].get(name, {})
                connected = bool(st.get("connected"))
                if not connected:
                    _set(name, rssi=None)     # a stale reading must not linger on a dropped device
                elif do_rssi:
                    any_link = True
                    rssi = await link_rssi.read_rssi(adapter_mac, addr)
                    if rssi is not None:
                        got_any = True
                        _set(name, rssi=rssi)
                if writer:
                    st = STATUS["devices"].get(name, {})
                    writer.write(_now(), name, connected, st.get("rssi"), st.get("battery"),
                                 st.get("frames_dropped"), st.get("frames_duplicated"))
            if do_rssi and any_link and not got_any:
                misses += 1
                if misses >= 3 and not idle:
                    idle = True
                    log.info("link RSSI unavailable (no privileged helper / sudoers grant) — logging "
                             "connection state only; re-probing every %.0fs", retry_idle)
                next_rssi = now_mono + retry_idle
            elif got_any:
                if idle:
                    log.info("link RSSI now available — resuming %.0fs polling", interval)
                misses, idle = 0, False
    finally:
        if writer:
            writer.close()


async def main():
    global ADAPTER
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.yaml")
    args = ap.parse_args()
    import yaml   # runtime-only dep; imported here so `import capture` (for unit tests) needs no external deps
    cfg = yaml.safe_load(open(args.config))
    root = cfg["root"]
    global _CFG
    _CFG = cfg
    # One-time migration: the O2Ring's 125 Hz pleth used to be captured unconditionally, so existing
    # configs list only ['spo2'] while actually recording ~191 MB/night of PPG. Make that explicit so the
    # Settings toggle reflects reality — and so enabling the toggle is not a silent behaviour change.
    for _d in cfg.get("devices", []):
        if _d.get("vendor") in ("Wellue", "Viatom"):
            _st = _d.setdefault("streams", ["spo2"])
            if "ppg" not in _st:
                _st.append("ppg")
                log.info("%s: recording the 125 Hz pleth — added 'ppg' to its stream list (was implicit)",
                         _d.get("name"))
    ADAPTER = cfg.get("adapter")   # BLE adapter MAC — pins bonding AND every bleak connect (adapter_kw)
    global O2PPG_FS, O2PPG_NS_STEP
    _fs = float(((cfg.get("o2ring") or {}).get("ppg_fs")) or O2PPG_FS_DEFAULT)
    if _fs > 0:                    # per-unit override; the default is the 2026-07-18 5.8 h calibration
        O2PPG_FS, O2PPG_NS_STEP = _fs, int(1e9 / _fs)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _STOP.set)

    tasks = [asyncio.create_task(status_loop(root)),
             asyncio.create_task(adapter_watchdog(ADAPTER, cfg)),
             asyncio.create_task(rssi_poller(ADAPTER, cfg, root)),
             asyncio.create_task(clock_watchdog(cfg)),
             asyncio.create_task(host_clock_poller(cfg, root))]

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
                            pull_stored=_pull, polar_pause=polar_offline_op,
                            sync_time=sync_device_time), host, port)
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
