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
                     HostClockLogWriter, capture_filename, missing_identity, night_dir)
import polar_pmd as pmd
import viatom
import oxyii
import bonding
import link_rssi
import host_clock
import offline_lock
import diskguard
import sdnotify
import alerts
import nightqc
import nightarchive
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
# first NTP-syncs minutes after boot) re-anchors and is LOGGED — a jump you can see beats one you can't.
# Returns LOCAL civil time, byte-for-byte the same type as datetime.now().
#
# A DST TRANSITION IS NOT A CLOCK STEP, and must not be treated as one. Re-anchoring onto an autumn
# fall-back would rewind the stamps a full hour MID-NIGHT: the file would run backward and collide with
# the hour it already wrote, failing the Clock Contract's "overnight 22:00→06:00 = ~8 h monotonic" check
# on precisely one night a year. The distinction is exact, not heuristic — at a transition the zone's UTC
# OFFSET moves by the same amount as the apparent drift, whereas an NTP correction moves the clock with
# the offset unchanged. So we absorb the civil relabelling and keep counting in the session's ORIGINAL
# offset. The recording then stays in ONE offset frame end-to-end, which is what §1's floating `tMs` +
# per-recording anchor already assume; monotonic beats civil-correct for a signal file.
_STEP_THRESH_S = 2.0
_anchor_wall: _dt.datetime | None = None
_anchor_mono: float = 0.0
_anchor_utcoff: _dt.timedelta = _dt.timedelta(0)   # UTC offset in force when we anchored
_civil_shift: float = 0.0                          # seconds of DST relabelling absorbed since the anchor


def _utcoffset(when: _dt.datetime) -> _dt.timedelta:
    """UTC offset the local zone had at `when` (a naive LOCAL datetime, as datetime.now() returns)."""
    return when.astimezone().utcoffset() or _dt.timedelta(0)


def _reanchor(shift: float = 0.0) -> None:
    """Re-pin the monotonic clock to civil time. `shift` CARRIES FORWARD any DST relabelling already
    absorbed, so a genuine NTP correction landing on a night that has crossed a transition re-anchors
    within the session's original offset frame instead of dropping back to civil time — which would
    rewind the file by the width of the transition, the exact failure this whole path exists to stop."""
    global _anchor_wall, _anchor_mono, _anchor_utcoff, _civil_shift
    now = _dt.datetime.now()
    _anchor_wall = now - _dt.timedelta(seconds=shift)
    _anchor_mono = _time.monotonic()
    _anchor_utcoff = _utcoffset(now)
    _civil_shift = shift


def _now() -> _dt.datetime:
    global _civil_shift
    if _anchor_wall is None:
        _reanchor()
    predicted = _anchor_wall + _dt.timedelta(seconds=_time.monotonic() - _anchor_mono)
    actual = _dt.datetime.now()
    drift = (actual - predicted).total_seconds()   # wall-vs-monotonic divergence == a clock step
    # Fast path, and the steady state after a transition has been absorbed. Deliberately avoids the
    # tz lookup below: _now() runs per sample (ECG is 130 Hz), astimezone() is not free.
    if abs(drift - _civil_shift) <= _STEP_THRESH_S:
        return predicted
    off_delta = (_utcoffset(actual) - _anchor_utcoff).total_seconds()
    if off_delta != _civil_shift and abs(drift - off_delta) <= _STEP_THRESH_S:
        log.warning("DST transition %+.0fs — civil clock relabelled, NOT stepped; capture stamps keep "
                    "counting monotonically in the session's original UTC offset", off_delta - _civil_shift)
        _civil_shift = off_delta
        return predicted
    log.warning("wall-clock step %.3fs — re-anchoring capture stamps here (NTP correction?)", drift - _civil_shift)
    _reanchor(_civil_shift)
    return actual - _dt.timedelta(seconds=_civil_shift)


# BlueZ serialises connection ESTABLISHMENT per adapter — two devices connecting at once yields
# org.bluez.Error.InProgress. Hold this lock only across connect(); the links themselves run concurrently.
_CONNECT_LOCK = asyncio.Lock()

# EVERY BLE await must be bounded. This lock is process-global, so an unbounded operation under it is not
# one stuck device — it is the whole box, silently, until morning. bleak inherits BlueZ's D-Bus semantics:
# a wedged controller simply never replies, and `await` waits forever without raising.
# Per-phase bound on shutdown. Generous: a healthy teardown is well under a second, and a BLE disconnect
# is already bounded by _BLE_DISCONNECT_TIMEOUT_S — this only catches something that ignores cancellation.
_SHUTDOWN_PHASE_S = 15.0
TASK_LABELS: dict[int, str] = {}    # id(task) -> human name, so shutdown can NAME what refused to stop

_BLE_CONNECT_TIMEOUT_S = 30.0       # a real connect to an advertising, bonded sensor takes ~1-3 s
_BLE_DISCONNECT_TIMEOUT_S = 10.0    # teardown must be quick or abandoned — never a second deadlock
_PMD_CTRL_TIMEOUT_S = 3.0           # per PMD control-point round-trip (write, then its indication)
# EVERY post-connect GATT setup await must be bounded too (VIGIL-DEEP-ANALYSIS §1.1). `connect()` is
# already wrapped, but a BlueZ wedge can accept the LE connection then stall StartNotify/discovery/auth —
# and those awaits used to be UNBOUNDED in all three runners, so a wedge landing after connect() parked
# the task at `connected=True` forever, invisible to the stall watchdog (later in the loop), to
# classify_adapter_health (sees connected → not a phantom), and to alert_poller. Generous vs a control
# round-trip: StartNotify + service resolution legitimately take longer than one write+indication.
_BLE_SETUP_TIMEOUT_S = 10.0


def _bounded_setup(coro):
    """Bound a post-connect GATT setup await (start_notify / auth+setup writes). A timeout RAISES out of
    the runner's try so `except/finally` closes the writers and the loop retries on a fresh link — never
    a silent all-night freeze at `connected=True`."""
    return asyncio.wait_for(coro, _BLE_SETUP_TIMEOUT_S)

# The O2Ring exposes exactly ONE BLE link, so live capture and a stored-session (.dat) pull cannot both
# hold it. Setting this event tells run_oxyii to drop its link and idle; pull_oxyii_session then owns the
# ring for the download and clears the event to resume live capture. (Only the O2Ring path honors it.)
_OXYII_PAUSE = asyncio.Event()

# O2Ring RTC state, keyed by address and deliberately MODULE-level so it OUTLIVES a connection. Both
# facts here are properties of the ring, not of the BLE link, and resetting them per connect is what made
# the clock re-sync fire 359× in one night (see the _rtc_sync block in run_oxyii).
_OXYII_RTC_AT: dict[str, _dt.datetime] = {}        # addr -> host time of the last RTC write
_OXYII_LAST_DURATION: dict[str, int] = {}          # addr -> last session duration seen (spots a restart
                                                   # that happened while the link was down)
_OXYII_RTC_RESYNC_SEC = 6 * 3600                   # drift backstop; override via o2ring.rtc_resync_sec


def oxyii_rtc_due(last_sync, now, session_restarted: bool, resync_sec: float) -> str | None:
    """Why the ring's RTC needs writing right now, or None if it does not.

    The ring is WRITE-ONLY on time: its opcode set is AUTH/SETUP/LIVE/SET_TIME + the file transfer ops,
    with no get-time, and the live frame carries no clock field. So "read it back and skip the write if
    it's already right" is not implementable — the only observable copy of its RTC is the file-list
    naming (`YYYYMMDDhhmmss`), which needs the offline path and a pause of live capture, i.e.
    strictly more traffic than the blind write it would save.

    Instead of asking "is the time wrong?" (unanswerable) this asks "could it have gone wrong in a way
    that MATTERS?" — which is answerable, because the RTC's only consumer is the stored .dat, and that
    stamps a session at its START. Hence: first contact, a new recording session, and a slow drift
    backstop. A BLE reconnect is none of those and must not trigger a write."""
    if last_sync is None:
        return "first contact"
    if session_restarted:
        return "new recording session"
    age = (now - last_sync).total_seconds()
    if age >= resync_sec:
        return f"drift backstop, {age / 3600:.1f} h since last"
    return None

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

# Honest-gap threshold (O2RING-PPG-GAP §1): the smallest hole between two consecutive frames that we
# treat as REAL LOST TIME rather than BLE delivery jitter. Chosen from measurement, not taste — on a
# 119 min overnight capture the frame-anchor jitter has sd 16.4 ms and p95 |step| 29 ms, while genuine
# losses start around 49 ms (median) and run to 287 ms. 40 ms ≈ 5 samples sits cleanly between the two:
# comfortably above the jitter so it mints no phantom gaps, comfortably below the real losses so it
# still catches them. Overridable per unit via `o2ring.ppg_gap_min_ms`.
O2PPG_GAP_MIN_S = 0.040

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

      • `InProgress` in last_error → connection contention — BUT ADAPTER-LEVEL ONLY WHEN THE RADIO IS
        SERVING NOBODY. A single device's InProgress while OTHERS are connected is DEVICE churn, not an
        adapter wedge: the adapter is demonstrably working (it is holding the other links). Measured
        2026-07-20: the churny O2Ring (frequent reconnects) threw InProgress 22× while the H10 was
        streaming ECG cleanly; the watchdog read that lone InProgress as an adapter wedge and power-cycled
        the whole radio 8× in 18 min, each cycle dropping ALL links — a ~25 min self-inflicted outage that
        ended only when the watchdog GAVE UP. So InProgress counts toward a wedge only when `not
        any_connected` — the radio is serving no one, which is what a real wedge looks like.
      • `bluez_connected` (BlueZ reports Connected: yes) while our daemon's `connected` is False → a
        PHANTOM stale link: a 'connected' device does not advertise, so nobody can re-grab it. Unambiguous
        wedge, independent of the above, and it names the address that needs a targeted `disconnect`.
      • Everything else — clean not-found / not connected, no phantom, or InProgress while a device is
        live — is NOT WORN or benign contention. We deliberately do NOT auto-recover on it: power-cycling
        the adapter because one device churns (or the user took a sensor off) is worse than the problem.
    """
    reasons: list[str] = []
    phantom: list[str] = []
    any_connected = any(d.get("connected") for d in devices)   # is the radio serving ANY live link?
    for d in devices:
        err = d.get("last_error") or ""
        if "InProgress" in err and not any_connected:
            # No device is connected AND a connect is stuck in-progress → the radio itself, not one
            # churny device. With a live link present this is benign device contention (see docstring).
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
    hci = await adapter_hci()
    # The `bluez=` form, NOT the bare `adapter=` kwarg. bleak deprecated `adapter` (3.0.2 shims it with a
    # warning and copies it into bluez["adapter"]); when the shim goes, passing it would not raise — it
    # would be swallowed as an unknown kwarg and the pin would SILENTLY vanish. This box cannot afford
    # that: the whole reason adapter_hci() exists is that hci indices re-enumerate, and losing the pin
    # means capturing over the onboard radio that cannot hear the sensors, with no error naming the
    # cause. Both BleakClient and BleakScanner take bluez={"adapter": "hciN"}.
    return {"bluez": {"adapter": hci}} if hci else {}


async def adapter_hci() -> str | None:
    """The configured adapter resolved to its CURRENT `hciN` name, or None when unconfigured/unresolvable
    (callers then fall back to the BlueZ default rather than failing hard). Kept separate from
    adapter_kw() because the PS-FTP path takes a bare name, not bleak kwargs."""
    if not ADAPTER:
        return None
    hci = await link_rssi.resolve_hci(ADAPTER, refresh=True)
    if not hci:
        log.warning("configured adapter %s not found — falling back to the BlueZ default", ADAPTER)
        return None
    return hci


def _connect_timeout(addr: str) -> TimeoutError:
    """The bounded connect's error as the OPERATOR reads it at 07:00. `asyncio.wait_for` raises a BARE
    `TimeoutError()`, which lands in `last_error` and the log saying nothing at all — where the unbounded
    code it replaced surfaced BleakDeviceNotFoundError('... was not found.'), i.e. "your strap is off".
    Observed 2026-07-20 05:07 as `Polar H10 link error: TimeoutError()`. Keep the bound, restore the
    meaning. The class name stays TimeoutError so transient_ble_error() still matches on repr()."""
    return TimeoutError(f"connect to {addr} timed out after {_BLE_CONNECT_TIMEOUT_S:.0f}s — sensor off, "
                        f"out of range, or the adapter is wedged")


async def _safe_disconnect(client) -> None:
    """Disconnect without ever hanging the caller. Teardown runs against the SAME wedged stack that caused
    the failure it is cleaning up after, so an unbounded `disconnect()` in a `finally` turns a bounded
    timeout back into the permanent deadlock it was meant to prevent."""
    try:
        await asyncio.wait_for(client.disconnect(), _BLE_DISCONNECT_TIMEOUT_S)
    except Exception:
        pass


@contextlib.asynccontextmanager
async def _connect(addr: str):
    from bleak import BleakClient as _BC
    client = _BC(addr, **(await adapter_kw()))
    # BOUND THE CONNECT — AND HOLD THE GLOBAL LOCK NO LONGER THAN THAT. A wedged BlueZ leaves the D-Bus
    # call outstanding indefinitely (this box's signature failure), and every connect in the process is
    # serialized behind _CONNECT_LOCK — so ONE hung connect, on ANY device, silently freezes every other
    # device task, every offline op, and (because they all skip while paused) all three watchdogs, for the
    # rest of the night. Nothing crashes, so systemd's Restart never fires. A timeout turns that
    # unrecoverable class into an ordinary retry on the next loop iteration.
    async with _CONNECT_LOCK:
        try:
            await asyncio.wait_for(client.connect(), _BLE_CONNECT_TIMEOUT_S)
        except asyncio.TimeoutError:
            await _safe_disconnect(client)
            raise _connect_timeout(addr) from None
        except BaseException:
            await _safe_disconnect(client)      # never leak a half-open link past a timeout/cancel
            raise
    try:
        yield client
    finally:
        await _safe_disconnect(client)


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
    async with _CONNECT_LOCK:                   # same bound as _connect — see the note there
        try:
            await asyncio.wait_for(client.connect(), _BLE_CONNECT_TIMEOUT_S)
        except asyncio.TimeoutError:
            await _safe_disconnect(client)
            raise _connect_timeout(addr) from None
        except BaseException:
            await _safe_disconnect(client)
            raise
    try:
        yield client
    finally:
        await _safe_disconnect(client)


def _utcnow():
    """Device clocks are set in UTC (see polar_psftp.set_local_time), so skew is measured against UTC.

    Returns a NAIVE datetime, and the `.replace(tzinfo=None)` is load-bearing — not tidying. This used to
    be `datetime.utcnow()`, which 3.12 deprecated and a later release removes; the documented replacement
    `datetime.now(UTC)` returns an AWARE datetime, and swapping it in blind would break every consumer.
    `_now()` is naive, `_POLAR_EPOCH` is naive, and the skew line does `dev_dt - _utcnow()` — mixing an
    aware value into that raises TypeError at runtime, on the clock path, where it would surface as a
    device that never reports skew rather than as an obvious crash. Naive-UTC in, naive-UTC out."""
    return _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)


# BlueZ/bleak errors that mean "busy, try again", NOT "this will never work". A daemon restart leaves
# the previous connection tearing down, so the first sync attempt routinely hits InProgress — and the
# auto-sync used to treat that as fatal and give up for the whole session (observed 2026-07-18: both
# Polars spent the evening with clock_synced unset after a restart). Deliberately does NOT match a real
# protocol refusal such as NOT_IMPLEMENTED / error 201, which must still give up immediately.
_TRANSIENT_BLE = ("inprogress", "in progress", "not ready", "notready", "temporarily unavailable",
                  "devicenotfound", "not advertising", "timeout", "timeouterror", "busy",
                  "abort-by-local", "disconnected", "no reply", "not connected",
                  "connection-canceled", "br-connection-canceled")


def transient_ble_error(exc: BaseException) -> bool:
    """True when a BLE failure is worth retrying rather than surrendering the whole session."""
    text = repr(exc).lower()
    if "not_implemented" in text or "error 201" in text:
        return False              # a genuine protocol refusal — retrying cannot help
    return any(m in text for m in _TRANSIENT_BLE)


# An adapter that has run out of link-layer connection slots reports a distinct error that reads like
# "sensor off" unless named (VIGIL-DEEP-ANALYSIS §2D): an over-provisioned dongle looks like flapping
# sensors. Classify it so the log says "adapter connection ceiling", not a generic link error.
_CEILING_SIGNS = ("connection-profile-unavailable", "too many", "no resources", "connection limit",
                  "max connections", "host is down")


def connection_ceiling_error(exc: BaseException) -> bool:
    """True when a connect failed because the ADAPTER is out of connection slots, not because the sensor
    is absent — a diagnosable over-provisioning, not a flapping device."""
    return any(m in repr(exc).lower() for m in _CEILING_SIGNS)


# How far a device clock may sit from the host before it counts as a fault worth re-syncing. Generous
# vs the 0.03 s a healthy synced Polar shows, tight vs the YEARS an unsynced H10 is out by.
CLOCK_TOLERANCE_S = 2.0
# A CORRECTION THAT NEVER CONVERGES IS A LEAK, NOT A FIX. Some offsets cannot be shifted from here: the
# Verity stamps its PMD samples ~4 h ahead of the clock we set it to, and re-syncing does not move that
# (measured 2026-07-18). The adrift trigger below fires on absolute skew, and the post-sync re-baseline
# clears the memory of having tried — so an uncorrectable device re-synced EVERY drift_check_sec, all
# night. Each attempt pauses live capture and holds the connect lock for up to _CLOCK_SYNC_TIMEOUT_S, so
# at the 300 s default this quietly spent ~15 % of every night achieving nothing, and opened a recovery
# blind spot every five minutes. Prove it cannot be fixed, then stop and say so. A real JUMP still
# re-syncs however many times we have given up on the steady offset.
CLOCK_ADRIFT_GIVEUP = 3
CHARGE_RETRY_S = 60          # how often to re-attempt PMD START while a device sits on the charger
_CHARGING: set[str] = set()  # devices currently refusing PMD with in_charger (log-once bookkeeping)

# POWER: drop a not-worn Polar so it stops draining. A chest strap off the body does not go quiet — it
# streams electrode noise at the full rate (130 Hz ECG), which records nothing real AND flattens the
# strap's battery over a day. So after a generous grace of CONTINUOUS not-worn contact we drop the link,
# then reconnect on a slow cadence to check whether it has been put back on. The grace is deliberately
# long: a real wear is never not-worn for minutes (a roll-over or strap tug is seconds), and dropping
# during genuine use would cost real data. Only devices that actually REPORT contact are affected;
# worn=None (no contact bit) is never dropped. Set drop_not_worn_sec=0 to disable.
_DROP_NOT_WORN_SEC = 180.0          # continuous not-worn before dropping; override via power.drop_not_worn_sec
_NOT_WORN_RECHECK_S = 90.0          # how often to reconnect-and-check once dropped; power.not_worn_recheck_sec
_WORN_SINCE: dict[str, float] = {}  # addr -> monotonic ts contact went False (absent = worn/unknown)


def should_drop_not_worn(worn_since, now, grace) -> bool:
    """PURE: has a strap been continuously not-worn long enough to drop for power? False when the feature
    is off (grace<=0), the strap is worn/unknown (worn_since None), or the grace has not yet elapsed."""
    return bool(grace and grace > 0 and worn_since is not None and (now - worn_since) >= grace)


# STREAM STALL: a PMD START can be ACKNOWLEDGED and still deliver nothing. The H10 serves ONE PMD stream
# at a time and does NOT release it when a client dies without a clean disconnect (polarofficial/
# polar-ble-sdk#287) — so the next session's START is answered `already_streaming` (0x06), which
# is_started() rightly reads as live, while every notification still goes to the dead subscriber.
# Observed 2026-07-19: H10 ECG + ACC sat at ZERO ROWS for ten minutes behind a healthy link while HR/RR
# flowed normally, and nothing noticed — the link was up, so the hold loop had no reason to end. The same
# silence covers a notification handler that keeps raising, a firmware that stops streaming mid-night, and
# a writer failing on a full disk. `already_streaming` is NOT the only door into it, so the guard watches
# BYTES, not the ACK.
# The cure is the one that worked by hand that night: END THE SESSION. Reconnecting re-runs the whole
# STOP → settings → START negotiation against a device that has just dropped its link and therefore freed
# the stream. Deliberately generous: every PMD stream we start (slowest is MAG at 20 Hz, PPI ~1/beat)
# delivers many rows a second, so 90 s of TOTAL silence is never a slow stream — it is a dead one.
_STREAM_STALL_S = 90.0       # started-stream silence before the session is torn down; stream.stall_sec (0 = off)
_STALL_RECONNECT_S = 5.0     # pause before re-negotiating after a stall — a stall is not an error backoff

# The night-boundary anchor. A 24/7 daemon crossing midnight keeps appending to the START-date folder
# (night_dir() rolls by session start, not wall clock), so the wall-clock date is the WRONG key for
# "which night is in progress" — reading, mirroring or pruning by _now()'s date truncates the live night
# the instant the clock ticks past 00:00. The right signal is FILE ACTIVITY: a night with a write inside
# this window is still being captured and is untouchable; one gone quiet this long is settled. The window
# must exceed the longest legitimate gap in a night's writes (flushes are ~5 s; even the churniest device
# reconnects well inside a minute) with generous margin, so a brief sensor dropout never looks "settled".
_NIGHT_SETTLE_S = 1200.0     # 20 min of no writes ⇒ a night is complete; overridable via storage.settle_sec


def clock_resync_reason(skew, prev, jump, tolerance, failed_adrift=0, giveup=CLOCK_ADRIFT_GIVEUP):
    """PURE: why (if at all) a device clock should be re-synced now.
      'jump'   — the clock MOVED. Always worth correcting, no matter how often we have tried before: an
                 H10 resets to its 2019 firmware default whenever it leaves the strap.
      'adrift' — steady, but outside tolerance. Worth correcting until we have PROVEN we cannot shift it.
      None     — in tolerance, or an offset we have repeatedly failed to move (see CLOCK_ADRIFT_GIVEUP).
    """
    if prev is not None and abs(skew - prev) >= jump:
        return "jump"
    if abs(skew) > tolerance and failed_adrift < giveup:
        return "adrift"
    return None


def stream_is_stalled(last_change, now, grace) -> bool:
    """PURE: has a stream been silent long enough to call it dead? False when the feature is off
    (grace<=0) or the stream has not started yet (last_change None). Per-stream — see any_stream_stalled."""
    return bool(grace and grace > 0 and last_change is not None and (now - last_change) >= grace)


def any_stream_stalled(last_changes, now, grace) -> bool:
    """PURE: is ANY started stream INDIVIDUALLY silent past `grace`? The watchdog used to key on a single
    shared timer that a live sibling kept resetting, so a genuinely-dead stream behind a live one (the
    2026-07-19 ECG-flowing-while-ACC-at-zero class) was never caught (VIGIL-DEEP-ANALYSIS §2C). `grace`
    is 90 s, far longer than the slowest real stream's inter-row gap (even 1 Hz HR advances ~90 rows), so
    only a truly dead stream fires. False when off (grace<=0) or nothing has started (empty/all-None)."""
    return bool(grace and grace > 0 and any(stream_is_stalled(lc, now, grace) for lc in (last_changes or [])))


def _current_night(captures: str, settle_sec: float) -> str | None:
    """Which night is 'now' for a reader (QC) — the one still being CAPTURED, keyed on file activity not
    the wall clock (see _NIGHT_SETTLE_S). The newest ACTIVE night if any device is writing; otherwise the
    newest night on disk (an idle box between sessions still wants to report on last night, not on an
    empty _now()-dated folder that no one has created). None only when captures/ holds no night at all."""
    active = diskguard.active_nights(captures, settle_sec)
    if active:
        return max(active)                     # names are YYYY-MM-DD, so lexical max == most recent
    nights = diskguard.list_nights(captures)
    return nights[-1] if nights else None


# E5 · LINK.csv under-reported dropouts. rssi_poller samples `connected` every ~25 s, so a drop+reconnect
# INSIDE a 25 s window is invisible — it reads connected=1 at both ends (measured: the Verity re-subscribed
# twice and the H10 once in a 22:14-22:16 window that LINK.csv logged as connected throughout). The runners,
# however, know every edge exactly: each calls _set(connected=True/False) the instant the link flips. So
# COUNT the connect edges here, at the source. A monotonic per-device reconnect count that the poller then
# samples makes the sidecar authoritative for the NUMBER of dropouts — if the count jumps between two rows,
# drops happened, even when both rows read connected=1.
_LINK_EPOCH: dict[str, int] = {}   # device name -> count of connect edges (survives the poll it sampled over)


def _set(name, **kv):
    d = STATUS["devices"].setdefault(name, {})
    if "connected" in kv and bool(kv["connected"]) and not bool(d.get("connected")):
        _LINK_EPOCH[name] = _LINK_EPOCH.get(name, 0) + 1   # a fresh connection — count it even if a poll missed the drop
        kv = {**kv, "link_epoch": _LINK_EPOCH[name]}       # surfaced for the LINK sidecar (E5)
    d.update(kv)


def _parse_hr(data: bytes):
    """Standard HR Measurement char (0x2A37) → (bpm, [rr_ms,...], contact).

    Vendor-neutral: this is the Bluetooth SIG layout, so it serves any HR strap, not just a Polar.

    `contact` is the SKIN-CONTACT state, or None when the device does not support reporting it:
    flags bit2 = "contact supported", bit1 = "contact detected". Worth surfacing because it is the one
    thing that distinguishes a strap being WORN from a strap lying on a table — and a strap off the body
    does not go quiet, it streams electrode noise at full rate while its own HR algorithm keeps emitting
    a plausible number. Measured 2026-07-19 on an H10 (which does NOT report contact): off-chest ECG ran
    at 24x normal amplitude, p2p 31 mV vs 1.3 mV, while RR came out at 335-833 ms inside three seconds —
    physiologically impossible, individually believable, and nothing downstream could tell. A Coospo
    HRM808S does report contact, so for that strap the not-worn state is knowable rather than inferred."""
    flags = data[0]; i = 1
    if flags & 0x01:
        bpm = int.from_bytes(data[1:3], "little"); i = 3
    else:
        bpm = data[1]; i = 2
    if flags & 0x08:   # energy expended present
        i += 2
    rr = []
    while i + 2 <= len(data):
        raw = int.from_bytes(data[i:i + 2], "little"); i += 2
        rr.append(round(raw / 1024 * 1000))   # 1/1024 s units -> ms
    contact = bool(flags & 0x02) if (flags & 0x04) else None
    return bpm, rr, contact


# Streams that ride Polar's PMD service. Everything else on this path (`hr`) is the vendor-neutral SIG
# Heart Rate characteristic, which any strap serves.
_PMD_STREAMS = frozenset({"ecg", "acc", "ppg", "gyro", "mag", "ppi"})


async def run_polar(dev: dict, root: str):
    """Polar PMD + the standard Heart Rate characteristic. Despite the name this is also the path for any
    third-party HR strap, because `hr` is SIG-standard — so the Polar-SPECIFIC rituals below have to be
    gated rather than assumed. A Coospo HRM808S (probed 2026-07-19) has neither PMD nor PS-FTP: running
    them anyway cost a pointless bond attempt, an 18-SECOND GLOBAL CAPTURE PAUSE while an impossible
    clock sync failed on a missing characteristic, and a phantom link that then tripped the watchdog."""
    name, addr = dev["name"], dev["address"]
    streams = dev.get("streams", ["ecg"])
    backoff = 5
    stale_bond_hits = 0        # consecutive one-sided-bond failures; see the teardown handler
    needs_pmd = bool(set(streams) & _PMD_STREAMS)
    is_polar = (dev.get("vendor") or "").strip().lower() == "polar"
    # One-time bond BEFORE any PMD attempt — the H10 drops an un-authenticated link ~1-2 s after
    # connect (bleak #1943). ensure_bonded is a no-op if the bond already exists. (Reconnects after a
    # transient drop reuse the stored bond, so we don't re-bond in the loop.)
    # ONLY when a PMD stream is wanted. The bond exists because the H10 refuses PMD on an
    # unauthenticated link — the SIG Heart Rate characteristic has no such requirement, and most
    # third-party straps do not support pairing at all, so bonding one fails and reports a scary
    # "bond failed" for a device that was about to work perfectly well.
    if needs_pmd:
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
    # PS-FTP is POLAR-SPECIFIC. On anything else the sync cannot succeed — it fails on a missing
    # characteristic — and it costs a global capture pause to find that out, every task start.
    if is_polar and (_CFG.get("time") or {}).get("auto_sync_devices", True):
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
        stream_scale: dict[int, float] = {}   # raw-int → physical-unit factor per meas (GYRO dps / MAG gauss)
        prev_ns: dict[int, int] = {}       # previous frame's device timestamp per meas — lets decode_frame
                                           # back-time off the device's own clock instead of the nominal
                                           # rate. Per-connection scope: a reconnect must NOT carry a stale
                                           # seam across the gap (the guard would reject it anyway).
        hr_writer = None
        started = _now()
        ndir = night_dir(root, started)
        charging_hold = False              # device refused PMD because it is on the charger (status 0x0D).
        drop_for_power = False             # not-worn long enough that we dropped the link to save battery
        stalled = False                    # started streams went silent behind a live link — re-negotiate
        # Declared HERE, outside the try, because both readers live outside the block that sets it: the
        # link-hold loop and the reconnect-delay below. (It was first declared next to `stream_fs` inside
        # the connected session — an UnboundLocalError on every device that never reached the PMD path.)
        try:
            _set(name, connected=False, address=addr, last_error=None)
            async with _connect(addr) as client:
                _set(name, connected=True)
                log.info("%s connected", name)
                # NB: backoff is NOT reset here — a bare connect is not a viable session (E3 parity with
                # run_viatom/run_oxyii). A strap that connects then drops before any data reset the floor
                # on every doomed attempt, so the exponential backoff could never grow and a flapping
                # device hammered the radio. It is reset only once real samples land (in the hold loop).

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
                        meas, samples = pmd.decode_frame(bytes(data), arrival, fs=stream_fs.get(data[0]),
                                                         prev_last_ns=prev_ns.get(data[0]),
                                                         scale=stream_scale.get(data[0]))
                    except Exception as e:   # a truncated/empty frame raises IndexError/struct.error, not
                        _set(name, last_error=str(e)); return   # only ValueError — a decoder must never disturb the callback
                    if samples:
                        prev_ns[meas] = samples[-1].sensor_ns   # seam anchor for the next frame's step
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
                    except Exception:  # pragma: no cover — sensor_ns is an unsigned 64-bit int, so
                        pass           # _POLAR_EPOCH + timedelta(µs=ns/1000) is bounded far inside
                                       # datetime's range and cannot raise; the guard is belt-and-braces.
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
                    if not hr_writer:      # pragma: no cover — on_hr is only subscribed when hr_writer is
                        return             # truthy (the `if hr_writer:` gate below), so this never returns.
                    bpm, rr, contact = _parse_hr(bytes(data))
                    hr_writer.write_hr(_now(), 0, bpm, rr)
                    # Only straps that ADVERTISE contact support get a worn verdict; on one that does not
                    # (the H10), leaving it None is honest — better an unknown than a fabricated "worn".
                    if contact is not None:
                        _set(name, worn=contact,
                             last_error=None if contact else "not worn — no skin contact")
                        # Timestamp the FIRST not-worn so the live loop can measure how long it has lasted.
                        # Module-level + only-set-if-absent, so it PERSISTS across the duty-cycle reconnects
                        # — otherwise each probe would restart the grace clock and never drop.
                        if contact:
                            _WORN_SINCE.pop(addr, None)
                        elif addr not in _WORN_SINCE:
                            _WORN_SINCE[addr] = _time.monotonic()
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
                        # WARNING, not info: without the control channel every _ctrl below times out, so
                        # every START goes unacknowledged and no PMD stream can be confirmed. The session
                        # is degraded from this line onward — it must not read as a routine note.
                        log.warning("%s control indications unavailable (%r) — START acks cannot be read; "
                                    "PMD streams will be re-negotiated by the stall watchdog", name, e)

                    async def _ctrl(cmd: bytes, timeout: float | None = None) -> bytes:
                        timeout = _PMD_CTRL_TIMEOUT_S if timeout is None else timeout
                        while not ctrl_q.empty():
                            ctrl_q.get_nowait()
                        # The WRITE is bounded too. It is a D-Bus round-trip to the same stack that wedges,
                        # and it sits in the negotiation path every reconnect runs — unbounded, one wedged
                        # write parks the whole device task forever with its link nominally up.
                        try:
                            await asyncio.wait_for(
                                client.write_gatt_char(pmd.PMD_CONTROL, cmd, response=True), timeout)
                        except Exception:
                            return b""
                        try:
                            return await asyncio.wait_for(ctrl_q.get(), timeout)
                        except asyncio.TimeoutError:
                            return b""

                    await _bounded_setup(client.start_notify(pmd.PMD_DATA, on_pmd))
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
                            if not cmd:  # pragma: no cover — every requested stream is a known measurement,
                                continue  # for which build_start() and START[meas] both return a command.
                            ack = await _ctrl(cmd)
                            st = ack[3] if len(ack) >= 4 else pmd.NO_ACK
                            # `already_streaming` is NOT proof that the data will reach US. The H10 serves
                            # ONE PMD stream and does not release it when a client dies without a clean
                            # disconnect (polar-ble-sdk#287), so this is exactly the ACK a stream still
                            # owned by a DEAD subscriber returns — and every notification keeps going to
                            # that corpse. It cost 2026-07-19's ECG + ACC: acknowledged, registered, zero
                            # rows for ten minutes. The unconditional STOP above did not clear it (its ack
                            # was never even read), so force the issue and demand OUR stream.
                            if st == pmd.ALREADY_STREAMING:
                                log.warning("%s %s: device reports already-streaming — the stream may "
                                            "belong to a dead subscriber; forcing STOP + re-START",
                                            name, pmd.MEAS_NAME.get(meas, meas))
                                stop_ack = await _ctrl(pmd.stop_cmd(meas))
                                stop_st = stop_ack[3] if len(stop_ack) >= 4 else pmd.NO_ACK
                                log.info("%s %s STOP → %s", name, pmd.MEAS_NAME.get(meas, meas),
                                         pmd.CTRL_STATUS.get(stop_st, hex(stop_st)))
                                await asyncio.sleep(0.3)
                                ack = await _ctrl(cmd)
                                st = ack[3] if len(ack) >= 4 else pmd.NO_ACK
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
                            stream_scale[meas] = pmd.axis_scale(meas, settings)   # device-reported range/resolution
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
                        elif st == pmd.NO_ACK:
                            # NO REPLY IS NOT A REJECTION. A dropped control indication — or a control
                            # channel we never managed to subscribe to at all (see the start_notify guard
                            # above, which makes EVERY _ctrl time out) — leaves us with no verdict. The
                            # old code filed that under "unsupported settings" and deleted the writer, so
                            # one lost indication cost that stream the entire session, and a failed
                            # control subscribe silently cost ALL of them while HR carried on regardless.
                            # Keep the stream: if it really is dead, no rows arrive and the stall watchdog
                            # re-negotiates on a fresh link within _STREAM_STALL_S.
                            _set(name, last_error=f"{pmd.MEAS_NAME.get(meas, meas)} START unacknowledged "
                                                  f"— will re-negotiate")
                            log.warning("%s %s START got no control response — keeping the stream; the "
                                        "stall watchdog will re-negotiate if no data arrives",
                                        name, pmd.MEAS_NAME.get(meas, meas))
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
                            lvl = int(b[0])
                            # CHARGING, INFERRED. A Polar exposes no charge flag mid-session: the
                            # in_charger status only appears when a PMD START is REFUSED, which cannot
                            # happen to a device that was already streaming when it went on the dock. So
                            # a device put on charge mid-session reported charging=False forever while
                            # its battery visibly climbed — measured 2026-07-19, Verity 35 -> 61 %.
                            # A battery that RISES is unambiguous: these cells do not self-charge.
                            prev = STATUS["devices"].get(name, {}).get("battery")
                            if isinstance(prev, int) and lvl > prev:
                                _set(name, charging=True)
                            elif isinstance(prev, int) and lvl < prev:
                                _set(name, charging=False)   # discharging again -> off the dock
                            _set(name, battery=lvl)
                    except Exception:
                        pass
                await _read_batt()

                # Hold the link until disconnect, shutdown, or an offline-pull pause request.
                secs = 0
                # Stall watchdog state. `watched` is every stream we believe is live — the PMD writers
                # that survived negotiation (a rejected stream was deleted above) plus the HR writer, so
                # an HR-only strap is covered too. Rows are the honest signal: they move only when bytes
                # actually reached a file, which is precisely what an acknowledged-but-dead stream never
                # does. Baseline starts at "now" rather than 0 rows, so the first frame is allowed to
                # take its time without counting as silence.
                watched = list(writers.values()) + ([hr_writer] if hr_writer else [])
                last_rows = [w.rows for w in watched]
                # PER-STREAM silence timers (VIGIL-DEEP-ANALYSIS §2C). One shared timer let a live sibling
                # mask a dead stream; each stream now carries its own so a single dead one is caught.
                _base = _time.monotonic()
                last_change = [_base for _ in watched]
                while (client.is_connected and not _STOP.is_set() and addr not in _POLAR_PAUSED
                       and not _RECOVER.is_set() and not charging_hold):
                    await asyncio.sleep(1)
                    secs += 1
                    if secs % 120 == 0:
                        await _read_batt()
                    rows_now = [w.rows for w in watched]
                    flowed = False
                    _mono = _time.monotonic()
                    for _i in range(len(watched)):
                        if rows_now[_i] != last_rows[_i]:
                            last_change[_i] = _mono; flowed = True
                    last_rows = rows_now
                    if flowed:
                        backoff = 5           # E3: AGGREGATE flow — SOME stream is live, so this is a
                                              # viable session; reset the reconnect backoff. A later drop
                                              # then recovers fast; a connect that never streams leaves
                                              # the floor to grow.
                    if any_stream_stalled(last_change, _time.monotonic(), _STREAM_STALL_S):
                        stalled = True
                        _set(name, last_error=f"a stream silent {_STREAM_STALL_S:.0f}s — re-negotiating the streams")
                        log.warning("%s: a started stream silent for %.0fs behind a live link — "
                                    "dropping it so the device frees the stream and we re-negotiate",
                                    name, _STREAM_STALL_S)
                        break
                    if should_drop_not_worn(_WORN_SINCE.get(addr), _time.monotonic(), _DROP_NOT_WORN_SEC):
                        drop_for_power = True
                        _set(name, last_error="not worn — link dropped to save battery (re-checking)")
                        log.info("%s: not worn for %.0fs — dropping the link to save battery; "
                                 "re-checking every %.0fs", name, _DROP_NOT_WORN_SEC, _NOT_WORN_RECHECK_S)
                        break
        except Exception as e:
            _set(name, connected=False, last_error=repr(e))
            log.warning("%s link error: %r", name, e)
            # A ONE-SIDED BOND. is_bonded() reads the HOST's view, so a device-side factory reset (Polar
            # Flow offers one) leaves BlueZ reporting `Bonded: yes` while the sensor has forgotten us.
            # ensure_bonded() then short-circuits forever and the strap drops service discovery on every
            # reconnect, permanently. Two consecutive hits, because a single one is also what a normal
            # mid-negotiation drop looks like — re-pairing costs ~20 s of scripted bluetoothctl, so it
            # must not fire on ordinary flapping.
            if bonding.looks_like_a_stale_bond(repr(e)):
                stale_bond_hits += 1
                if stale_bond_hits >= 2:
                    stale_bond_hits = 0
                    log.warning("%s: bonded on this host but the sensor keeps refusing service discovery "
                                "— treating the bond as STALE (factory reset?) and re-pairing", name)
                    _set(name, last_error="re-pairing — the sensor appears to have forgotten this host")
                    try:
                        ok = await bonding.ensure_bonded(addr, ADAPTER, force=True)
                        log.info("%s: forced re-pair %s", name, "succeeded" if ok else "FAILED")
                    except Exception as be:
                        log.warning("%s: forced re-pair error: %r", name, be)
            else:
                stale_bond_hits = 0
        finally:
            # DISCARD HEADER-ONLY FILES. A writer is opened per requested stream BEFORE the PMD START is
            # negotiated, so any session that ends without data still leaves a file containing nothing but
            # its header. The charger case makes that a cadence rather than a one-off: a device sitting on
            # its dock refuses START every CHARGE_RETRY_S, so it produced one junk file set PER MINUTE for
            # as long as it charged (observed 2026-07-19 — a 76-byte Verity PPG file, one header line).
            # Those files are indistinguishable from a real capture until something opens them, and they
            # pollute the night directory the Dex ingest walks. The START-rejected path already deleted
            # its file for exactly this reason; this generalises it to every way a session can end.
            for wr in list(writers.values()) + ([hr_writer] if hr_writer else []):
                empty = not wr.rows
                path = wr.path
                wr.close()
                if empty:
                    try:
                        os.remove(path)
                        log.debug("%s: discarded header-only %s", name, os.path.basename(path))
                    except OSError:
                        pass
        if not _STOP.is_set():
            if charging_hold:
                # Not a fault, so it must not ride the error backoff: recheck on a steady cadence so the
                # streams come back on their own within a minute of the device leaving the charger.
                await asyncio.sleep(CHARGE_RETRY_S)
            elif stalled:
                # Not an error backoff: the link was healthy, the streams were not. Come straight back and
                # re-negotiate against a device that has now dropped its link and freed the stream.
                await asyncio.sleep(_STALL_RECONNECT_S)
            elif drop_for_power:
                # Dropped on purpose to save battery. Sleep the recheck interval, then reconnect: if it is
                # worn again the session resumes; if not, on_hr reports not-worn immediately (contact is in
                # every HR frame) and _WORN_SINCE is already old, so the live loop drops it again at once —
                # a short probe, not a full grace period.
                await asyncio.sleep(_NOT_WORN_RECHECK_S)
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
            log.info("%s: %s", name, " ".join(cmd))
            # `connected` is set AFTER the child exists, not before. Setting it first meant a tool that
            # died on the first line — device off, bad address, no LSL stream — still showed a green card
            # all night while the loop respawned it every 5 s, and `alert_poller` keys on `connected`, so
            # nothing ever fired.
            proc = await asyncio.create_subprocess_exec(*cmd)
            _set(name, connected=True, address=addr, tool=tool, last_error=None, file=out)
            try:
                while proc.returncode is None and not _STOP.is_set():
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=1)
                    except asyncio.TimeoutError:
                        pass
            finally:
                # ALWAYS reap the child. CancelledError is a BaseException, so on shutdown neither
                # `except` below ran and `terminate()` was skipped entirely — leaving muselsl alive,
                # holding the Muse's BLE link, so the NEXT daemon start could not connect to it. The
                # finally runs on cancellation too, and we wait for the child so it can flush its CSV
                # tail rather than being orphaned mid-write.
                if proc.returncode is None:
                    proc.terminate()
                    with contextlib.suppress(Exception):
                        await asyncio.wait_for(proc.wait(), timeout=5)
                    if proc.returncode is None:      # ignored SIGTERM — do not leave it holding the radio
                        with contextlib.suppress(Exception):
                            proc.kill()
                            await asyncio.wait_for(proc.wait(), timeout=5)
            # A tool that exits on its own is a FAULT, not a quiet restart: report the code so the
            # respawn loop is visible instead of looking like a healthy capture.
            if proc.returncode not in (0, None):
                _set(name, connected=False,
                     last_error=f"{tool} exited with code {proc.returncode} — retrying")
                log.warning("%s: %s exited with code %s — retrying in 5s", name, tool, proc.returncode)
            else:
                _set(name, connected=False)
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
        # Idle during an adapter power-cycle or a stored-session pull, exactly as run_polar/run_oxyii do.
        # This loop was the only one that ignored both: it kept hammering connects at a radio the
        # watchdog was powering off — the very contention _RECOVER exists to prevent — and could be
        # holding the global connect lock at the moment the power-off landed.
        if _RECOVER.is_set() or _OXYII_PAUSE.is_set():
            _set(name, connected=False,
                 last_error="paused — pulling stored session" if _OXYII_PAUSE.is_set() else "adapter recovering")
            while (_RECOVER.is_set() or _OXYII_PAUSE.is_set()) and not _STOP.is_set():
                await asyncio.sleep(0.3)
            continue
        started = _now()
        ndir = night_dir(root, started)
        path = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, "spo2", "csv"))
        wr = None
        stalled = False
        try:
            _set(name, connected=False, address=addr, last_error=None)
            async with _connect(addr) as client:
                # backoff is deliberately NOT reset here. `connect()` returning is not evidence of a
                # USABLE link — the ring's dominant overnight failure is `failed to discover services,
                # device disconnected`, which lands a moment AFTER this line. Resetting on connect meant
                # every doomed attempt re-armed the floor, so the exponential backoff could never grow:
                # on 2026-07-19 that produced 178 reconnects at a MEDIAN gap of 17 s (163 of 177 gaps
                # under 2 min, never reaching the 60 s cap), fragmenting the night into 115 files and
                # losing 12 % of it. Same lesson as the PMD stall watchdog: trust BYTES, not a handshake.
                # The reset moved to first-rows-arrived, below.
                _set(name, connected=True); log.info("%s connected", name)
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

                await _bounded_setup(client.start_notify(notify_char, on_data))
                if write_char is not None:
                    try:
                        await asyncio.wait_for(
                            client.write_gatt_char(write_char, viatom.START_CMD, response=False),
                            _PMD_CTRL_TIMEOUT_S)
                    except Exception as e:
                        log.info("%s start-cmd write skipped: %r", name, e)   # some models auto-stream
                else:
                    # NOT a silent skip. notify_char has a documented-UUID fallback; write_char has none,
                    # so a model that puts its control point outside VIATOM_SERVICE (or a stale BlueZ
                    # service cache) never gets START_CMD — and then simply never streams, with a live
                    # link and no error anywhere. Say so; the stall guard below ends the session.
                    log.warning("%s: no writable characteristic under the Viatom service — START_CMD not "
                                "sent. If this model needs it, the ring will not stream.", name)
                # Same stall guard as the other two runners.
                last_rows, last_change = wr.rows, _time.monotonic()
                # _OXYII_PAUSE too: a pull can be requested while THIS ring is already streaming, and the
                # outer idle-gate only catches it between sessions — without this, a live session holds the
                # link the offline pull needs, and the pull waits out its whole timeout for nothing.
                while (client.is_connected and not _STOP.is_set() and not _RECOVER.is_set()
                       and not _OXYII_PAUSE.is_set()):
                    await asyncio.sleep(1)
                    if wr.rows != last_rows:
                        # THE link has now carried data — this, not connect(), is what proves the attempt
                        # was worth making, so it is the only place the retry floor may be re-armed.
                        backoff = 5
                        last_rows, last_change = wr.rows, _time.monotonic()
                    elif stream_is_stalled(last_change, _time.monotonic(), _STREAM_STALL_S):
                        stalled = True
                        _set(name, last_error=f"no data for {_STREAM_STALL_S:.0f}s — reconnecting")
                        log.warning("%s: no rows for %.0fs behind a live link — dropping it", name,
                                    _STREAM_STALL_S)
                        break
        except Exception as e:
            _set(name, connected=False, last_error=repr(e))
            log.warning("%s link error: %r", name, e)
        finally:
            if wr:
                _empty, _p = not wr.rows, wr.path      # discard header-only files, as run_polar does
                wr.close()
                if _empty:
                    try:
                        os.remove(_p)
                    except OSError:
                        pass
        if not _STOP.is_set():
            if stalled:
                await asyncio.sleep(_STALL_RECONNECT_S)
            else:
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
        # Honest-gap state (O2RING-PPG-GAP §1), per SESSION — a reconnect opens a new file and a new
        # grid, so these reset with ppg_idx rather than persisting across links.
        ppg_prev_end = [None]                         # host arrival of the previous frame's LAST sample
        ppg_gaps = [0]                                # gaps inserted this session
        ppg_lost = [0]                                # samples' worth of real time skipped
        stalled = False                               # link held but no frames decoded — reconnect
        try:
            _set(name, connected=False, address=addr, last_error=None)
            async with _connect_scan(addr) as client:
                # NB: backoff is NOT reset here. A bare connect is not a viable session — the O2Ring's
                # signature failure (E3) is a connect that SUCCEEDS then drops during service discovery
                # ("failed to discover services, device disconnected", 38× in one night). Resetting on
                # connect meant every doomed attempt reset the backoff, so a flapping ring hammered a
                # reconnect every ~21 s (15 s scan + connect + 5 s sleep) — 178 reconnects, 115 session
                # files — instead of ever backing off. Reset only once DATA flows (the poll loop below):
                # then a genuinely viable ring recovers fast, while a flapping one is left to back off.
                _set(name, connected=True); log.info("%s connected", name)
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
                # "ppg1" — the O2Ring is a SINGLE reflectance path, so it gets the 1-column PSL
                # layout, not the Verity's 3-LED one (PPGDEX-O2RING-FINGER-SITE §3/§7). Writing it
                # as (v,v,v) is what let PpgDex's consensus vote score a fabricated 100 % LED
                # agreement at `measured` tier against one sensor reported three times.
                ppgwr = (StreamWriter(ppg_path, "ppg1")
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
                #
                # SEEDED FROM THE LAST CONNECTION, not reset to None: the ring keeps recording while the
                # BLE link is down, so a session that restarts DURING a dropout is invisible if each
                # connect starts blind. Duration only ever decreases on a genuine restart (it counts up
                # across a disconnect), so carrying it over cannot manufacture one.
                _seq = [_OXYII_LAST_DURATION.get(addr)]
                _rtc_due = [False]      # set when a new recording session begins; served by the poll loop
                # THE RING'S HONEST LIVENESS SIGNAL. Not rows: vitals legitimately stop the moment the
                # ring leaves the finger (spo2 goes None) while the link and the frames carry on, so a
                # row-based guard would tear down a perfectly healthy link every time it was taken off.
                # A decoded live frame means the ring is still talking to us, worn or not.
                frames = [0]

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
                            # ── HONEST GAPS (O2RING-PPG-GAP §1) ────────────────────────────────────
                            # `ppg_idx` is a pure running counter, so sensor_ns used to be a PERFECTLY
                            # CONTIGUOUS grid no matter what the link did. When BLE drops a frame the
                            # survivors were laid down back-to-back ACROSS the missing real time, which
                            # COMPRESSES the record: an interval spanning the loss is short by exactly the
                            # lost duration, and beat-to-beat variability is fabricated at every gap. It
                            # was invisible downstream because the ns column stayed uniform by
                            # construction (one distinct step over 900 k samples) — the DSP had no way to
                            # know time was missing. That is precisely what the Clock Contract forbids:
                            # "Dropped windows are GAPS, never fabricated rows."
                            # MEASURED on a 119 min overnight capture before this fix: 82.3 s of real time
                            # carried no samples (1.15 % of the record, ~10 346 samples) across 1 315
                            # discrete gaps — 11/min, median 49 ms, p90 96 ms, max 287 ms — leaving ~20 %
                            # of beats adjacent to a gap.
                            # This frame's samples are back-timed to END at `arr`, so it covers
                            # [arr - nps/fs, arr]. Any daylight between the previous frame's end and this
                            # frame's start is real time the ring measured and the link lost, so ADVANCE
                            # the grid across it instead of pretending it never happened.
                            if ppg_prev_end[0] is not None:
                                gap_s = (arr - ppg_prev_end[0]).total_seconds() - nps / O2PPG_FS
                                # Only ever advance. A NEGATIVE gap is host-clock jitter delivering a frame
                                # "early"; rewinding would emit non-monotonic sensor_ns and break parsing.
                                # The threshold keeps ordinary BLE arrival jitter (measured sd 16.4 ms,
                                # p95 |step| 29 ms) from minting phantom gaps, while the real losses start
                                # at ~49 ms median. Slow host-vs-device drift (measured 125.726 vs 125.738
                                # nominal, ~0.01 %) stays far below it and is spread across frames, so it
                                # never accumulates into a false gap.
                                if gap_s > O2PPG_GAP_MIN_S:
                                    lost = int(round(gap_s * O2PPG_FS))
                                    ppg_idx[0] += lost
                                    ppg_gaps[0] += 1
                                    ppg_lost[0] += lost
                            ppg_prev_end[0] = arr
                            for i, v in enumerate(ppg):
                                ph = arr - _dt.timedelta(seconds=(nps - 1 - i) / O2PPG_FS)
                                ppgwr.write_ppg(ph, ppg_idx[0] * O2PPG_NS_STEP, 0.0, (v,), 0)
                                ppg_idx[0] += 1
                            BUS.push("o2ppg", ppg)
                        live = oxyii.parse_live(r[1])
                        if not live:
                            continue
                        frames[0] += 1
                        if oxyflagwr:
                            oxyflagwr.write(_now(), live)   # PI + the fields the vendor CSV cannot carry
                        # [0:4] is the ring's SESSION DURATION, not a frame counter — the old
                        # frame_gap() accounting on it reported phantom loss (9 warnings in one
                        # evening, one claiming 111 frames, which was a session starting). What the
                        # field genuinely tells us is when a NEW session began.
                        if oxyii.session_restarted(_seq[0], live["duration"]):
                            log.info("%s: ring started a new recording session", name)
                            # THE moment the RTC matters: the .dat header stamps a session at its start
                            # (samples are implicit at 1 Hz after it), so this is the only event that can
                            # bake a wrong time into stored data. on_data is a sync BLE callback and
                            # cannot await — hand it to the poll loop.
                            _rtc_due[0] = True
                        _seq[0] = live["duration"]
                        _OXYII_LAST_DURATION[addr] = live["duration"]   # survives the next dropout
                        now = _now()
                        if live["spo2"] is not None:
                            wr.write(now, live["spo2"], live["pr"] or 0, live["motion"])   # [11], corrected
                            BUS.push("spo2", [live["spo2"]])
                            if live["pr"]:
                                BUS.push("pr", [live["pr"]])
                            BUS.push("motion_o2", [live["motion"]])   # raw movement level (~1/s)
                            _set(name, rows=wr.rows, spo2=live["spo2"], pr=live["pr"], battery=live["batt"],
                                 motion=live["motion"], worn=True, last_sample=now.isoformat(),
                                 charging=bool(live.get("batt_state")), last_error=None)
                        else:
                            BUS.push("motion_o2", [live["motion"]])
                            # The ring keeps its link and keeps reporting motion/battery/contact on the
                            # charger — only the vitals stop. batt_state is the device's OWN charge flag
                            # (0 = not charging), so unlike the Polars this needs no inference.
                            _set(name, worn=live["worn"], motion=live["motion"], battery=live["batt"],
                                 charging=bool(live.get("batt_state")),
                                 last_error=None if live["worn"] else "no finger contact")

                BUS.register("motion_o2", "Motion (O2Ring)", "lvl", 0)
                if ppgwr:                                   # no card for a stream we are not capturing
                    BUS.register("o2ppg", "PPG (O2Ring)", "raw", O2PPG_FS)   # finger pleth, Phase 2
                await _bounded_setup(client.start_notify(nch, on_data))
                await _bounded_setup(client.write_gatt_char(wch, oxyii.auth_frame(), response=False))   # 0xFF: no reply
                await asyncio.sleep(0.6)
                await _bounded_setup(client.write_gatt_char(wch, oxyii.setup_frame(), response=False))  # 0x10: ack
                await asyncio.sleep(0.6)
                # Sync the ring's free-running RTC to the NTP-synced host so its stored .dat timestamps
                # match the live capture (it drifts ~+151 s — see oxyii.set_time_frame).
                # LOCAL CIVIL time, deliberately different from the Polars' UTC. The ring has a SCREEN:
                # a wearer reading UTC off their finger would just be confused. Nothing is given up —
                # its live samples are host-arrival stamped (no device timestamp at all), so its RTC never
                # fed cross-device timing; it only stamps the stored .dat, which is read by humans.
                #
                # ⚠️ NOT ON EVERY CONNECT ANY MORE. It used to be, and on the night of 2026-07-19 the ring
                # reconnected 359× on a -83 dBm link — 359 clock writes, each an extra GATT write ~1.4 s
                # into a link that was already failing, plus ~0.4 s of setup before the first sample every
                # time. A BLE reconnect is simply not the event the RTC cares about: the .dat stamps a
                # session at its START, so the sync is driven by the two events that can actually bake in a
                # wrong time — first contact, and a new recording session — with a long interval as the
                # drift backstop. Reconnect storms now cost zero clock writes.
                async def _rtc_sync(why: str) -> None:
                    _clk = _now()
                    await _bounded_setup(client.write_gatt_char(wch, oxyii.set_time_frame(_clk), response=False))  # 0xC0
                    _OXYII_RTC_AT[addr] = _clk
                    _set(name, clock_synced=_clk.isoformat(timespec="seconds"))
                    log.info("%s RTC synced to host %s (%s)", name,
                             _clk.strftime("%Y-%m-%d %H:%M:%S"), why)
                    await asyncio.sleep(0.4)

                _why = oxyii_rtc_due(_OXYII_RTC_AT.get(addr), _now(), False, _OXYII_RTC_RESYNC_SEC)
                if _why:
                    await _rtc_sync(_why)
                last_frames, last_change = frames[0], _time.monotonic()
                while client.is_connected and not _STOP.is_set() and not _OXYII_PAUSE.is_set() and not _RECOVER.is_set():   # poll live ~1/s
                    if _rtc_due[0]:
                        _rtc_due[0] = False
                        await _rtc_sync("new recording session")
                    # BOUNDED: this write is the only thing that makes the ring emit a frame, and it is a
                    # D-Bus round-trip. Unbounded, a wedged stack parks run_oxyii here forever with its
                    # writers open and `connected: True` on the monitor — silent, all night.
                    try:
                        await asyncio.wait_for(
                            client.write_gatt_char(wch, oxyii.live_frame(), response=False),
                            _PMD_CTRL_TIMEOUT_S)
                    except Exception as e:
                        log.warning("%s: live-frame poll failed (%r) — dropping the link to re-establish",
                                    name, e)
                        break
                    await asyncio.sleep(1.0)
                    # Same stall guard as the Polar path: a ring that holds its link but stops answering
                    # (auth/setup never accepted, every frame failing CRC, a handler raising inside
                    # bleak's dispatch) is indistinguishable from a healthy one from out here.
                    if frames[0] != last_frames:
                        last_frames, last_change = frames[0], _time.monotonic()
                        backoff = 5           # E3: data is flowing — THIS is a viable session, so reset the
                                              # reconnect backoff. A later drop then recovers fast; a ring
                                              # that only ever connects-and-drops never reaches here and so
                                              # keeps backing off (5→10→…→60) instead of hammering.
                    elif stream_is_stalled(last_change, _time.monotonic(), _STREAM_STALL_S):
                        stalled = True
                        _set(name, last_error=f"no frames for {_STREAM_STALL_S:.0f}s — reconnecting")
                        log.warning("%s: no decoded frames for %.0fs behind a live link — dropping it",
                                    name, _STREAM_STALL_S)
                        break
        except Exception as e:
            _set(name, connected=False, last_error=repr(e))
            log.warning("%s link error: %r", name, e)
        finally:
            # Report the honest gaps this session inserted. Silence here would re-create the very problem
            # the gap insertion fixes — a lossy link that LOOKS clean. Logged even at zero, so "no gaps"
            # is an observation rather than an absence of evidence.
            if ppgwr and ppg_idx[0]:
                log.info("%s: PPG grid — %d sample(s) written, %d gap(s) inserted totalling %.1f s "
                         "(%.2f%% of the session's real time was lost by the link)",
                         name, ppg_idx[0] - ppg_lost[0], ppg_gaps[0], ppg_lost[0] / O2PPG_FS,
                         100.0 * ppg_lost[0] / max(ppg_idx[0], 1))
            # DISCARD HEADER-ONLY FILES, exactly as run_polar does. Writers are opened before the ring is
            # known to be streaming, so every session that ends without data leaves a file containing
            # nothing but its header — indistinguishable from a real capture until something opens it,
            # and the Dex ingest walks this directory. On the documented 359-reconnect night that was
            # ~1000 junk files in one night dir. The Polar path already solved this; the ring never got it.
            for _w in (wr, ppgwr, oxyflagwr):
                if not _w:
                    continue
                _empty, _p = not _w.rows, _w.path
                _w.close()
                if _empty:
                    try:
                        os.remove(_p)
                        log.debug("%s: discarded header-only %s", name, os.path.basename(_p))
                    except OSError:
                        pass
        if not _STOP.is_set():
            if stalled:
                await asyncio.sleep(_STALL_RECONNECT_S)   # not an error backoff — come straight back
            else:
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
            # BOUNDED, and under the same connect lock as the Polar offline op. This is the sibling of
            # polar_offline_op and it inherited neither guard:
            #   • no timeout — `pull()`'s own `wait` only bounds the rescan retry on a not-found device;
            #     the connect, start_notify and every chunk write inside are unbounded. A ring carried out
            #     of range mid-transfer left _OXYII_PAUSE SET for the night, and adapter_watchdog,
            #     clock_watchdog and rssi_poller all skip while it is set — so the wedge disabled the very
            #     ladder that recovers from it. Exactly the incident already fixed on the Polar side.
            #   • no _CONNECT_LOCK — _OXYII_PAUSE stops only the ring's task, so the pull's scan+connect
            #     raced the Polar reconnects it shares the radio with (org.bluez.Error.InProgress, which
            #     then reads to the watchdog as a wedged adapter).
            async def _locked_pull():
                async with _CONNECT_LOCK:
                    return await pull_session.pull(dev["address"], out_dir, which=which, ftype=ftype,
                                                   adapter=await adapter_hci(),
                                                   serial="0000", wait=45, on_progress=_prog) or []
            try:
                saved = await asyncio.wait_for(_locked_pull(), timeout=_OFFLINE_OP_TIMEOUT_S)
            except asyncio.TimeoutError:
                log.error("%s: stored-session pull exceeded %.0fs and was abandoned — resuming live "
                          "capture. The ring was most likely carried out of range or the adapter is "
                          "wedged; the capture loops are now free to reconnect.", name, _OFFLINE_OP_TIMEOUT_S)
                raise
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


# Hard ceiling on a single offline op. Generous — a full stored-session pull over PS-FTP is minutes of
# work (pull_recording itself allows 180 s per file) — but FINITE, and that is the whole point.
#
# WHY: on 2026-07-19 a routine clock re-sync (H10 drifted 11 s) took this path against a device that had
# been carried out of range. The PS-FTP op never returned, and because it holds BOTH _POLAR_PAUSED and
# _CONNECT_LOCK for its whole life, every device task idled and no device could reconnect. Capture wrote
# ZERO bytes for 58 minutes, the monitor sat frozen on stale state, and nothing reported an error — the
# log's last word was "live capture paused". SIGTERM could not even cancel it.
#
# The recovery ladder cannot save this: adapter_watchdog, clock_watchdog and rssi_poller all skip while
# _POLAR_PAUSED is non-empty, so the one mechanism built to unwedge a stuck radio is disabled by exactly
# the condition that wedges it. bleak's own timeouts did not bound it either — a wedged BlueZ can leave a
# D-Bus call outstanding indefinitely. So the bound has to live here, at the point that holds the locks.
_OFFLINE_OP_TIMEOUT_S = 300.0

# A CLOCK SYNC IS NOT A DOWNLOAD. It is a connect plus three short PS-FTP queries — seconds of work, not
# minutes — and it runs UNATTENDED on a retry loop, so its ceiling must be sized for the operation rather
# than for the worst case of a different one.
#
# Measured 2026-07-19: after the 300 s bound landed, an out-of-range Verity turned a permanent wedge into
# a 97 %-duty-cycle wedge — each of the 12 auto-retries burned the full 300 s holding _POLAR_PAUSED and
# _CONNECT_LOCK, so capture was paused for ~300 s out of every ~310 s and still wrote nothing. Bounding
# the op was necessary but not sufficient; the bound has to be proportionate.
_CLOCK_SYNC_TIMEOUT_S = 45.0


async def polar_offline_op(address: str, op, timeout: float | None = None):
    """Run a PS-FTP offline op (list/pull) while the daemon's run_polar for `address` is paused, so the
    pull owns the device's single BLE link instead of colliding with the live-capture reconnect loop
    (org.bluez.Error.InProgress). `op` is a zero-arg coroutine factory; its result is returned. Resumes
    live capture no matter how `op` ends — including when it does not end at all (see the timeout)."""
    # Resolved at CALL time, not bound as a default argument: a default is evaluated once at import,
    # which silently freezes the module constant and makes it impossible to tune at runtime or in a test.
    timeout = _OFFLINE_OP_TIMEOUT_S if timeout is None else timeout
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
            # ACQUIRING the lock is bounded too, and counts against the SAME deadline as the op. Only `op()`
            # used to be inside wait_for, so a lock held by a hung connect elsewhere blocked this acquire
            # forever — with _POLAR_PAUSED already set. The timeout was then structurally unable to fire:
            # capture stayed paused for the night and the error path that resumes it was never reached.
            async def _locked():
                async with _CONNECT_LOCK:
                    return await op()
            return await asyncio.wait_for(_locked(), timeout=timeout)
        except asyncio.TimeoutError:
            # Loud, because the alternative is a silently dead box. Re-raised so the caller (a clock sync
            # or a monitor-driven pull) reports failure rather than believing it succeeded.
            log.error("Polar %s: offline op exceeded %.0fs and was abandoned — resuming live capture. "
                      "The device was most likely out of range or the adapter is wedged; the capture "
                      "loops are now free to reconnect.", address, timeout)
            raise
        finally:
            _POLAR_PAUSED.discard(address)
            log.info("Polar %s: offline op finished — resuming live capture", address)


async def status_loop(root: str):
    path = os.path.join(root, "captures", "status.json")
    while not _STOP.is_set():
        STATUS["updated"] = _now().isoformat()
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            _tmp = path + ".tmp"
            with open(_tmp, "w") as f:
                json.dump(STATUS, f, indent=2)
            os.replace(_tmp, path)   # atomic — the monitor never reads a half-written status.json
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
        async with polar_psftp.PolarPsFtp(address, adapter=await adapter_hci()) as fs:
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
    before, after, host_at_read = await polar_offline_op(address, _op,
                                                                 timeout=_CLOCK_SYNC_TIMEOUT_S)
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
    failed_adrift: dict[str, int] = {}   # addr -> consecutive adrift re-syncs that did not move the skew
    tried_adrift: dict[str, bool] = {}   # addr -> an adrift re-sync is awaiting its verdict next cycle
    gave_up: set[str] = set()            # addr -> already reported as uncorrectable (log/state once)
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
            # Did the PREVIOUS adrift correction actually help? We can only tell a cycle later, once new
            # PMD frames have restamped clock_skew_sec. Still out of tolerance ⇒ that attempt achieved
            # nothing; in tolerance ⇒ it worked, so forgive the history.
            if abs(skew) <= CLOCK_TOLERANCE_S:
                failed_adrift[addr] = 0
            elif tried_adrift.pop(addr, False):
                failed_adrift[addr] = failed_adrift.get(addr, 0) + 1
            # TWO triggers, because a jump alone is not enough. A clock that is CONSTANTLY wrong never
            # jumps, so the jump-only watchdog would watch an H10 sit at its 2019 firmware default
            # forever — and the startup sync is then the only defence, which is exactly the thing that
            # can fail transiently. An absolute skew beyond tolerance is itself a fault worth correcting.
            reason = clock_resync_reason(skew, prev, jump, CLOCK_TOLERANCE_S, failed_adrift.get(addr, 0))
            if reason is None:
                # Say it ONCE when we stop trying. An offset we cannot shift is a real property of the
                # night's data — the operator needs it in `status.json`, not buried in a log that repeats
                # every five minutes. `clock_synced` stays cleared: we are not claiming a sync we do not
                # believe, we are admitting we cannot get one.
                if abs(skew) > CLOCK_TOLERANCE_S and addr not in gave_up:
                    gave_up.add(addr)
                    log.warning("%s device clock is %+.1fs off and did NOT move after %d re-syncs — "
                                "accepting it as uncorrectable and leaving capture alone. Sample stamps "
                                "stay usable for cross-device alignment; absolute time does not.",
                                name, skew, CLOCK_ADRIFT_GIVEUP)
                    _set(name, clock_uncorrectable=True, clock_synced=None)
                continue                       # in tolerance and steady, or proven unfixable
            gave_up.discard(addr)
            if reason == "adrift":
                log.warning("%s device clock is %+.1fs off host (tolerance %.1fs) — re-syncing",
                            name, skew, CLOCK_TOLERANCE_S)
                _set(name, clock_synced=None)  # do not claim a sync we no longer believe
                tried_adrift[addr] = True
            else:
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
    writer_night = None   # night_dir the writer points at — roll a fresh CSV when the date turns
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
                    night = night_dir(root, _now())
                    if writer is None or night != writer_night:
                        # Roll at midnight: a writer opened at boot would otherwise append to the FIRST
                        # night's folder forever. makedirs so the sidecar can lead on an idle night.
                        if writer:
                            writer.close()
                        os.makedirs(night, exist_ok=True)
                        writer = HostClockLogWriter(
                            os.path.join(night, f"Tepna_{_now():%Y%m%d%H%M%S}_CLOCK.csv"))
                        writer_night = night
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
    writer_night = None   # the night_dir the open writer points at — roll a fresh CSV when the date turns

    def roll_writer():
        # (Re)open the LINK sidecar in TONIGHT's folder. Called before the loop and whenever the wall
        # clock crosses midnight: without this the writer opened at boot keeps appending to the FIRST
        # night's folder forever — one unbounded file that also lands every later night's link data in
        # the wrong (start-date) directory. Returns (writer, night) or (None, None) on failure.
        nonlocal writer, writer_night
        try:
            night = night_dir(root, _now())
            os.makedirs(night, exist_ok=True)
            if writer:
                writer.close()
            writer = LinkLogWriter(os.path.join(night, f"Tepna_{_now():%Y%m%d%H%M%S}_LINK.csv"))
            writer_night = night
            log.info("link provenance → %s", writer.path)
        except Exception as e:
            log.warning("link log unavailable: %r", e)
            writer, writer_night = None, None

    if log_link and root:
        roll_writer()

    misses = 0
    idle = False          # RSSI reads idle; the LOG never idles
    next_rssi = 0.0
    try:
        while not _STOP.is_set():
            await asyncio.sleep(interval)
            if _RECOVER.is_set() or _OXYII_PAUSE.is_set() or _POLAR_PAUSED:
                continue                      # don't poke the radio mid-pull / mid-recovery
            if log_link and root and night_dir(root, _now()) != writer_night:
                roll_writer()                 # midnight crossed — start this night's LINK.csv
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
                                 st.get("frames_dropped"), st.get("frames_duplicated"),
                                 st.get("link_epoch"))    # E5: the reconnect count the 25 s sampling can't miss
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


async def storage_poller(cfg: dict, root: str, notifier: "alerts.Notifier | None" = None):
    """Watch free disk and apply age-based retention. The box writes ~1.2 GB/night forever; without this a
    full filesystem silently loses every subsequent night (fsync just starts failing). Retention is OPT-IN
    (keep_nights <= 0 = never delete — see diskguard.plan_prune); low free space is an ALERT, never an
    excuse to eat recent data. Surfaces `storage` in status.json for the monitor."""
    scfg = cfg.get("storage") or {}
    interval = float(scfg.get("poll_sec", 300))
    keep_nights = int(scfg.get("keep_nights", 0))          # 0 = retention disabled
    min_free_gb = float(scfg.get("min_free_gb", 2))
    settle = float(scfg.get("settle_sec", _NIGHT_SETTLE_S))
    captures = os.path.join(root, "captures")
    low_alerted = False
    while not _STOP.is_set():
        try:
            rep = diskguard.disk_report(root, min_free_gb)
            # Protect every night still being WRITTEN, not just _now()'s date: a session running past
            # midnight keeps appending to its start-date folder, and pruning by wall-clock date could
            # sweep that live directory the moment the clock rolls. _now()'s date is a floor so a
            # brand-new night with no files yet (not yet "active") is still never a prune candidate.
            protect = diskguard.active_nights(captures, settle) | {_now().strftime("%Y-%m-%d")}
            # rmtree of a whole night — ~1500 files, ~2 GB — is filesystem work, not arithmetic.
            # disk_report() stays inline (a single statvfs); only the delete is off-loaded.
            pruned = await asyncio.to_thread(diskguard.prune_old_nights, captures, keep_nights, protect)
            if pruned:
                log.info("storage: pruned %d night(s) past the %d-night retention: %s",
                         len(pruned), keep_nights, ", ".join(pruned))
            rep = diskguard.disk_report(root, min_free_gb)  # re-read after any prune so status is current
            rep["pruned"] = pruned
            rep["keep_nights"] = keep_nights
            STATUS["storage"] = rep
            if rep["low"] and not low_alerted:             # edge-triggered: one alert per low episode
                low_alerted = True
                if notifier:
                    await notifier.send("Tepna: disk low",
                                        f"Only {rep['free_gb']} GB free ({rep['free_pct']}%). "
                                        f"Captures may soon fail — free space or raise keep_nights.")
            elif not rep["low"]:
                low_alerted = False
        except Exception as e:                             # storage bookkeeping must never take capture down
            log.warning("storage poll failed: %r", e)
        await asyncio.sleep(interval)


async def alert_poller(cfg: dict, notifier: "alerts.Notifier"):
    """Push a webhook alert when a configured sensor goes OFFLINE and stays offline past `offline_sec`
    (edge-triggered, so a flapping link cannot spam), and a 'recovered' note when it returns. A lost night
    is unrecoverable, so this is the difference between fixing a dead battery at 1am and finding out at
    breakfast. No-op when alerting is disabled."""
    acfg = cfg.get("alerts") or {}
    interval = float(acfg.get("poll_sec", 60))
    threshold = float(acfg.get("offline_sec", 300))
    down_since: dict[str, float] = {}
    alerted: set[str] = set()
    while not _STOP.is_set():
        await asyncio.sleep(interval)
        now = _time.monotonic()
        for d in cfg.get("devices", []):
            name = d.get("name")
            if not name:
                continue
            connected = bool(STATUS["devices"].get(name, {}).get("connected"))
            if connected:
                down_since.pop(name, None)
                if name in alerted:                        # it had alerted → tell the operator it is back
                    alerted.discard(name)
                    await notifier.send("Tepna: sensor recovered", f"{name} reconnected.")
            else:
                down_since.setdefault(name, now)
                if name not in alerted and alerts.offline_alert_due(down_since[name], now, threshold):
                    alerted.add(name)
                    mins = int((now - down_since[name]) / 60)
                    await notifier.send("Tepna: sensor offline",
                                        f"{name} has been offline for ~{mins} min — capture is missing it.")


async def qc_poller(cfg: dict, root: str, notifier: "alerts.Notifier | None" = None):
    """Summarise the CURRENT night's capture completeness — rows per configured stream, which declared
    streams produced nothing (the header-only files a rejected START / never-worn sensor leaves). Turns
    'did tonight capture?' into a glance: written to <night>/QC-SUMMARY.json and surfaced as status.json
    `qc`. Read-only over the tree — it never creates a night dir, so an idle box makes no empty folders.

    When a webhook is configured, alerts ONCE per night if a declared stream is still missing after
    `alert_after_sec` — the grace is essential, since a just-started night is legitimately empty and would
    otherwise false-alarm every time. Only a night we have watched that long can have a *real* hole."""
    qcfg = cfg.get("qc") or {}
    interval = float(qcfg.get("poll_sec", 600))
    alert_after = float(qcfg.get("alert_after_sec", 3600))
    settle = float((cfg.get("storage") or {}).get("settle_sec", _NIGHT_SETTLE_S))
    captures = os.path.join(root, "captures")
    first_seen: dict[str, float] = {}      # night → monotonic ts we first saw it with data
    alerted: set[str] = set()              # nights already alerted (edge-trigger, one per night)
    while not _STOP.is_set():
        await asyncio.sleep(interval)
        try:
            # The night STILL BEING CAPTURED — keyed on file activity, not _now()'s date, so a session
            # that ran past midnight is QC'd in its real (start-date) folder instead of an empty new one.
            current = _current_night(captures, settle)
            if current is None:
                continue                                   # captures/ holds no night yet — nothing to QC
            night = os.path.join(captures, current)
            if not os.path.isdir(night):
                continue                                   # raced away between listing and stat — skip
            # OFF THE LOOP, same reason as archive_night below. summarize() reads EVERY file in
            # the night to count newlines — by dawn that is ~2 GB, and at the default poll_sec=600
            # it re-reads the growing night ~48 times a night (~48 GB total). On this dev box the
            # page cache hides it (0.36 s for a 1.44 GB night); on the target hardware — a Pi/N100
            # with too little RAM to cache a whole night — it is a real multi-second stall of every
            # capture task, recurring every 10 minutes, and on slow storage it approaches the 60 s
            # watchdog heartbeat. QC is a REPORT: it must never cost the recording it reports on.
            summ = await asyncio.to_thread(nightqc.summarize, night, cfg.get("devices", []))
            STATUS["qc"] = summ
            _qc = os.path.join(night, "QC-SUMMARY.json")
            with open(_qc + ".tmp", "w") as fh:
                json.dump(summ, fh, indent=2)
            os.replace(_qc + ".tmp", _qc)   # atomic
            n = summ["night"]
            first_seen.setdefault(n, _time.monotonic())
            if summ["missing"]:
                log.info("qc: %s missing stream(s): %s", n, ", ".join(summ["missing"]))
                waited = _time.monotonic() - first_seen[n]
                if notifier and n not in alerted and waited >= alert_after:
                    alerted.add(n)                         # one alert per night, no matter how many polls
                    await notifier.send("Tepna: night has a gap",
                                        f"{n}: no data on {', '.join(summ['missing'])} "
                                        f"{int(waited / 3600)}h into the night.")
        except Exception as e:                             # QC is observability — never take capture down
            log.warning("qc poll failed: %r", e)


async def archive_poller(cfg: dict, root: str):
    """Mirror each COMPLETED night (not tonight — still being written) to a configured destination: a NAS
    mount, the served dir, a backup disk. Idempotent + resumable (a `.archived` marker per night). MIRROR,
    never move — the source stays for the retention guard to prune on its own schedule. No-op unless
    archive.enabled + archive.dest are set."""
    acfg = cfg.get("archive") or {}
    if not (acfg.get("enabled") and acfg.get("dest")):
        return
    dest = acfg["dest"]
    interval = float(acfg.get("poll_sec", 3600))
    settle = float((cfg.get("storage") or {}).get("settle_sec", _NIGHT_SETTLE_S))
    captures = os.path.join(root, "captures")
    _archive_dest_warned = False       # edge-trigger the "dest not present" warning, one per absence
    while not _STOP.is_set():
        await asyncio.sleep(interval)
        try:
            # Mirror only nights that have gone QUIET (no writes for `settle`), never the one still being
            # captured — keyed on file activity, not _now()'s date, so a session that ran past midnight is
            # not copied-and-marked-done mid-recording the moment the clock rolls over.
            # The dest must ALREADY EXIST — the operator creates it once on the backup volume. Never
            # makedirs the whole chain: a dest whose mount is absent (an unmounted removable disk, a
            # NAS that went away) leaves its mountpoint dir present-but-empty, so blindly creating the
            # tree would silently mirror ~2 GB/night onto the BOOT filesystem and fill it. A missing dest
            # means "backup volume not mounted" — skip this cycle and say so, don't invent a directory.
            if not await asyncio.to_thread(os.path.isdir, dest):
                if not _archive_dest_warned:
                    log.warning("archive: dest %s is not present — backup volume unmounted? skipping "
                                "until it reappears (never creating it on the boot disk)", dest)
                    _archive_dest_warned = True
                STATUS.setdefault("archive", {}).update({"dest": dest, "dest_present": False})
                continue
            _archive_dest_warned = False
            STATUS.setdefault("archive", {})["dest_present"] = True
            active = await asyncio.to_thread(diskguard.active_nights, captures, settle)
            # OFF THE EVENT LOOP. archive_night() is a synchronous shutil.copy2 walk over a whole
            # night — ~2 GB across ~1500 files — and everything else this daemon does shares this one
            # loop: the BLE runners, the stream stall watchdogs, the status poller, and the sd_notify
            # heartbeat. Run inline and a perfectly HEALTHY copy still freezes all of them for as long
            # as it takes; the unit is Type=notify with WatchdogSec=120 (heartbeat at half that), so a
            # copy exceeding ~60 s makes systemd conclude the daemon is wedged and restart it
            # MID-NIGHT. A dest that hangs — a stalled NFS/CIFS mount, a NAS that went away — never
            # returns at all, and the `except` below cannot help: a blocked syscall raises nothing.
            # The enclosing "offload is best-effort — never take capture down" only held for dest
            # errors, not for dest SLOWNESS, which is the likelier failure. to_thread keeps the loop
            # turning (and the watchdog fed) whatever the destination does. `pending_nights` stays
            # inline: it only stats the LOCAL captures dir.
            for night in nightarchive.pending_nights(captures, active):
                n = await asyncio.to_thread(nightarchive.archive_night, captures, night, dest)
                log.info("archive: mirrored %s (%d file(s)) → %s", night, n, dest)
                STATUS.setdefault("archive", {}).update({"last": night, "dest": dest})
        except Exception as e:                             # offload is best-effort — never take capture down
            log.warning("archive failed: %r", e)


async def autopull_poller(cfg: dict, root: str):
    """Auto-pull the O2Ring's ONBOARD-recorded `.dat` sessions off flash so a night's SpO2 lands on disk
    with no manual step — the belt-and-suspenders backup for a lossy live BLE link (weak signal / a dongle
    in another room, where the live capture drops to a fraction of the night). Opt-in (`pull.auto`).

    SAFE BY CONSTRUCTION:
      • Pulls only when the ring is NOT actively worn+streaming, so it never interrupts a live sleep
        capture — it fires in the morning window after the ring comes off the finger.
      • Idempotent: pull_session skips any session already on disk at the same device-reported size, so a
        repeat pull only downloads what is genuinely new (that is what makes `new_files` meaningful).
      • Bounded + connect-locked + best-effort — pull_oxyii_session already caps the op, holds the connect
        lock, and pauses live capture for the duration; an unreachable ring fails gracefully and retries.
    No-op unless `pull.auto` is set and a Wellue/Viatom device is configured."""
    pcfg = cfg.get("pull") or {}
    if not pcfg.get("auto"):
        return
    ring = next((d for d in cfg.get("devices", [])
                 if (d.get("vendor") in ("Wellue", "Viatom")) and not missing_identity(d)), None)
    if not ring:
        return
    name = ring["name"]
    interval = float(pcfg.get("auto_interval_sec", 3600))
    ftype = int(pcfg.get("ftype", 0))
    retries = max(1, int(pcfg.get("auto_retries", 3)))
    log.info("auto-pull: enabled — checking %s every %.0fs (only while it is off the finger), up to %d tries",
             name, interval, retries)
    while not _STOP.is_set():
        await asyncio.sleep(interval)
        if _RECOVER.is_set() or _OXYII_PAUSE.is_set():
            continue                                       # mid-recovery or another pull already running
        st = STATUS["devices"].get(name, {})
        if st.get("connected") and st.get("worn") is True:
            continue                                       # actively worn+streaming — do not interrupt it
        # RETRY until a pass finds nothing new, capped at `retries`. The ring's flash is small and it
        # overwrites oldest-first, so a session missed on a lossy link is lost once new ones pile on top —
        # retrying each cycle DRAINS everything reachable before that happens. Idempotent (skip-existing),
        # so a retry only re-fetches what an earlier attempt missed; a clean pass returns 0 new and stops.
        for attempt in range(retries):
            try:
                res = await pull_oxyii_session(ring, root, which="all", ftype=ftype)
            except offline_lock.OfflineBusy:
                break                                      # another offline op holds the slot — next cycle
            except Exception as e:                         # unreachable / transient — try again this cycle
                log.info("auto-pull: %s attempt %d/%d failed (%s)", name, attempt + 1, retries, type(e).__name__)
                continue
            new = res.get("new_files", []) if isinstance(res, dict) else []
            if not new:
                break                                      # nothing new — the ring is drained; stop
            log.info("auto-pull: %d new onboard session(s) from %s (try %d/%d) → %s",
                     len(new), name, attempt + 1, retries, res.get("out_dir"))
            STATUS.setdefault("autopull", {}).update({"last": _now().isoformat(timespec="seconds"),
                                                      "new": len(new)})


async def sd_watchdog():
    """Heartbeat systemd's WatchdogSec from a live-event-loop task, so a HUNG-but-alive daemon (the wedged
    BLE stack this box keeps hitting) is detected and restarted — `Restart=always` alone never fires
    because nothing crashed. No-op when the unit configured no watchdog."""
    period = sdnotify.watchdog_period_sec()
    if period is None:
        return
    log.info("systemd watchdog: heartbeat every %.0fs", period)
    while not _STOP.is_set():
        sdnotify.sd_notify("WATCHDOG=1")
        await asyncio.sleep(period)


async def keep_running(make_coro, label: str, notifier: "alerts.Notifier | None" = None, on_error=None):
    """Keep ONE long-lived task alive for the whole night. Every task here is a `while not _STOP` loop, so
    a plain return means shutdown — but an ESCAPING EXCEPTION silently retires it: `main()` fires them all
    with create_task and does not gather until _STOP, so the traceback is never even retrieved (asyncio
    reports an un-retrieved exception at GC, and the `tasks` list holds the reference, so it never even
    gets that far). The task simply stops. No log line, no alert, nothing in `status.json`.
    Not hypothetical, and not only the device runners:
      • run_polar does real work OUTSIDE its inner try (`night_dir()` each iteration) — a full disk, a
        read-only mount or a permissions slip raises straight past every handler it has;
      • adapter_watchdog's power-cycle calls `_btctl` under a bare try/finally with no except — a missing
        `bluetoothctl` (FileNotFoundError) or an already-exited child (ProcessLookupError) kills the one
        task whose whole job is recovering a wedged radio;
      • rssi_poller writes its provenance row outside any try — one ENOSPC, the exact condition
        storage_poller exists to warn about, and link provenance is gone for the night.
    Restart with a capped backoff: a task that cannot start is retried, never abandoned."""
    delay = 5
    while not _STOP.is_set():
        try:
            await make_coro()
            return                      # clean return == _STOP observed; nothing to restart
        except Exception as e:          # CancelledError is a BaseException — shutdown still cancels cleanly
            log.exception("%s crashed — restarting in %ds", label, delay)
            if on_error is not None:
                on_error(f"{e!r} — restarting in {delay}s")
            if notifier is not None:
                await notifier.send(f"Tepna: {label} crashed", f"{e!r} — restarting in {delay}s.")
            await asyncio.sleep(delay)
            delay = min(delay * 2, 300)


async def supervise(runner, dev: dict, root: str, notifier: "alerts.Notifier | None" = None):
    """keep_running for a device runner: a crash also has to show up on the device's monitor card."""
    name = dev.get("name") or dev.get("address") or "?"
    await keep_running(lambda: runner(dev, root), f"{name} runner", notifier,
                       on_error=lambda msg: _set(name, connected=False, last_error=f"runner crashed: {msg}"))


def register_runner(device_tasks: dict, tasks: list, addr, new_task) -> None:
    """Record a device's runner by address, cancelling+dropping any incumbent on the SAME address first.
    A device has one BLE link, so it must have one runner: a re-Remember of a running address replaces its
    runner rather than spawning a second that races it. A device with no address is tracked only in `tasks`
    (it cannot dedupe by key, but such a device is refused upstream anyway)."""
    old = device_tasks.get(addr) if addr else None
    if old is not None and old is not new_task and not old.done():
        old.cancel()                              # its finally closes writers + discards header-only files
        if old in tasks:
            tasks.remove(old)
    tasks.append(new_task)
    if addr:
        device_tasks[addr] = new_task


def unregister_runner(device_tasks: dict, tasks: list, status_devices: dict, addr) -> None:
    """Stop and drop a device's runner (Forget): cancel the task, remove it from the task list, and clear
    the device's status card — otherwise the orphaned runner keeps reconnecting a device the operator just
    dropped, re-creating its card every backoff."""
    t = device_tasks.pop(addr, None)
    if t is not None:
        t.cancel()
        if t in tasks:
            tasks.remove(t)
    for n in [n for n, s in status_devices.items() if s.get("address") == addr]:
        status_devices.pop(n, None)


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
    global O2PPG_FS, O2PPG_NS_STEP, _OXYII_RTC_RESYNC_SEC
    _fs = float(((cfg.get("o2ring") or {}).get("ppg_fs")) or O2PPG_FS_DEFAULT)
    if _fs > 0:                    # per-unit override; the default is the 2026-07-18 5.8 h calibration
        O2PPG_FS, O2PPG_NS_STEP = _fs, int(1e9 / _fs)
    _rs = float(((cfg.get("o2ring") or {}).get("rtc_resync_sec")) or 0)
    if _rs > 0:
        _OXYII_RTC_RESYNC_SEC = _rs
    global O2PPG_GAP_MIN_S
    _gm = float(((cfg.get("o2ring") or {}).get("ppg_gap_min_ms")) or 0)
    if _gm > 0:                    # honest-gap threshold override (see O2PPG_GAP_MIN_S)
        O2PPG_GAP_MIN_S = _gm / 1000.0
    global _DROP_NOT_WORN_SEC, _NOT_WORN_RECHECK_S
    _pw = cfg.get("power") or {}
    if "drop_not_worn_sec" in _pw:
        _DROP_NOT_WORN_SEC = float(_pw["drop_not_worn_sec"])     # 0 disables
    if float(_pw.get("not_worn_recheck_sec") or 0) > 0:
        _NOT_WORN_RECHECK_S = float(_pw["not_worn_recheck_sec"])
    global _STREAM_STALL_S
    _sc = cfg.get("stream") or {}
    if "stall_sec" in _sc:
        _STREAM_STALL_S = float(_sc["stall_sec"])                # 0 disables the started-stream watchdog
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _STOP.set)

    # Push-alert transport (webhook) — disabled unless config sets alerts.enabled + alerts.webhook_url.
    _acfg = cfg.get("alerts") or {}
    notifier = alerts.Notifier(_acfg.get("webhook_url"), enabled=bool(_acfg.get("enabled")))

    # EVERY background task is supervised. Several of them are the recovery ladder itself — adapter_watchdog
    # is the one thing that un-wedges a dead radio — so a task dying quietly is strictly worse here than
    # anywhere else: the box keeps running, believes it is healthy, and has lost the ability to fix itself.
    _BACKGROUND = [("status_loop", lambda: status_loop(root)),
                   ("adapter_watchdog", lambda: adapter_watchdog(ADAPTER, cfg)),
                   ("rssi_poller", lambda: rssi_poller(ADAPTER, cfg, root)),
                   ("clock_watchdog", lambda: clock_watchdog(cfg)),
                   ("host_clock_poller", lambda: host_clock_poller(cfg, root)),
                   ("storage_poller", lambda: storage_poller(cfg, root, notifier)),
                   ("alert_poller", lambda: alert_poller(cfg, notifier)),
                   ("qc_poller", lambda: qc_poller(cfg, root, notifier)),
                   ("archive_poller", lambda: archive_poller(cfg, root)),
                   ("autopull_poller", lambda: autopull_poller(cfg, root)),
                   ("sd_watchdog", sd_watchdog)]
    tasks = []
    for label, mk in _BACKGROUND:
        _t = asyncio.create_task(keep_running(mk, label, notifier))
        TASK_LABELS[id(_t)] = label
        tasks.append(_t)

    device_tasks: dict[str, asyncio.Task] = {}   # address -> its live runner task. A device has ONE BLE
                                                  # link, so it must have ONE runner: this lets a hot
                                                  # re-Remember (e.g. changing a stream list) REPLACE the
                                                  # runner instead of spawning a second that fights it for
                                                  # the link, and lets Forget actually stop the runner.

    def _spawn(dev: dict):
        # Refuse to capture a device missing identity fields — otherwise capture_filename() emits
        # `__<id>_..._STREAM.txt` (empty vendor/model), which happened via a hot-Remember with an
        # unrecognized sensor (guessDevice left vendor/model blank). FOLLOWUPS-II §F1. The Remember API
        # now rejects the same device up front (webmon.remember), so this is the second of two gates.
        missing = missing_identity(dev)
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
        # Supervised: a runner that raises must not take the device down for the night (see supervise()).
        _t = asyncio.create_task(supervise(runner, dev, root, notifier))
        TASK_LABELS[id(_t)] = f"{dev.get('name')} runner"
        register_runner(device_tasks, tasks, dev.get("address"), _t)   # dedupe a re-Remember by address

    def _forget(address: str):
        unregister_runner(device_tasks, tasks, STATUS.get("devices", {}), address)

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
                            sync_time=sync_device_time, forget_device=_forget), host, port)
        log.info("monitor: http://%s:%d/", host, port)

    # Surface the resolved adapter at boot: a silent mis-pin (hci re-enumeration) is exactly the failure
    # that cost 2026-07-18 — connects hung against the wrong radio with nothing in the log naming it.
    _hci = None
    if ADAPTER:
        _hci = await link_rssi.resolve_hci(ADAPTER, refresh=True)
        log.info("BLE adapter pinned: %s → %s", ADAPTER, _hci or "NOT FOUND (using BlueZ default)")
    else:
        log.info("BLE adapter: BlueZ default (no `adapter:` in config — pin it to survive re-enumeration)")
    # Host/boot facts on the monitor, not just in the boot log: `started_at` makes a spurious mid-night
    # restart visible at a glance (a boot time that moved after dark), and `adapter_resolved`/`adapter_ok`
    # surface a mis-pin the moment it happens instead of only when every connect quietly hangs.
    STATUS["host"] = {
        "started_at": _now().isoformat(timespec="seconds"),
        "adapter_mac": ADAPTER,
        "adapter_resolved": _hci,
        "adapter_ok": ADAPTER is None or bool(_hci),   # a pinned-but-unresolved adapter is the failure
    }
    log.info("tepna-capture up: %d device(s), root=%s", len(cfg.get("devices", [])), root)
    sdnotify.sd_notify("READY=1")             # Type=notify: `systemctl start` unblocks once capture is up
    # A (re)start is otherwise invisible overnight — a spurious restart mid-night is exactly what you want
    # to know about, so announce it. Disabled unless a webhook is configured.
    await notifier.send("Tepna: capture started",
                        f"tepna-capture is up with {len(cfg.get('devices', []))} device(s).")
    await _STOP.wait()
    sdnotify.sd_notify("STOPPING=1")
    # SHUTDOWN MUST TERMINATE, AND MUST SAY WHAT WENT WRONG. Measured 2026-07-20: SIGTERM left the daemon
    # alive past 101 s with nothing in the log — `gather()` waits forever on a task that will not unwind,
    # and `AppRunner.cleanup()` waits on in-flight requests (the monitor's SSE stream never ends on its
    # own). Under systemd that is a `systemctl restart` that hangs until TimeoutStopSec and is then
    # SIGKILLed mid-write; by hand it is an operator with no idea which task is stuck. So: bound every
    # phase, NAME whatever failed to stop, and carry on regardless — the writers are already closed by
    # each runner's finally, so abandoning a wedged BLE teardown costs nothing and buys a clean restart.
    log.info("shutdown: stopping %d task(s)", len(tasks))
    for t in tasks:
        t.cancel()
    # asyncio.wait, NOT wait_for(gather): on timeout `wait` REPORTS what is still pending, where
    # wait_for CANCELS the gather — which cancels the children a second time, so by the time the handler
    # looked, the stuck tasks had finished and it named nothing. The naming is the entire point.
    done, pending = await asyncio.wait(tasks, timeout=_SHUTDOWN_PHASE_S)
    for t in done:
        with contextlib.suppress(BaseException):
            t.exception()        # retrieve it, so asyncio does not warn about it at GC
    if pending:
        stuck = sorted(TASK_LABELS.get(id(t), "?") for t in pending)
        log.error("shutdown: %d task(s) ignored cancellation after %.0fs and were abandoned: %s",
                  len(pending), _SHUTDOWN_PHASE_S, ", ".join(stuck))
    if web_runner:
        try:
            # The monitor's live-view SSE stream is an in-flight request that never completes on its own,
            # so an unbounded cleanup() waits for a browser tab to be closed. It must not gate a restart.
            await asyncio.wait_for(web_runner.cleanup(), _SHUTDOWN_PHASE_S)
        except asyncio.TimeoutError:
            log.error("shutdown: web server did not close in %.0fs (an open monitor/SSE client?) "
                      "— abandoning it", _SHUTDOWN_PHASE_S)
    log.info("tepna-capture stopped")


if __name__ == "__main__":
    asyncio.run(main())
