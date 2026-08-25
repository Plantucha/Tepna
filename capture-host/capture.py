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
import argparse, asyncio, contextlib, json, logging, math, os, signal, time as _time, datetime as _dt
from writers import (StreamWriter, Spo2CsvWriter, LinkLogWriter, OxyFrameLogWriter, OxyLifeLogWriter, RingClockLogWriter, resumable_stamp,
                     HostClockLogWriter, PmdArrivalLogWriter, capture_filename, missing_identity,
                     night_dir, open_sample_writers)
import proc_util
import polar_pmd as pmd
import viatom
import oxyii
import bonding
import helper_path
import link_rssi
import host_clock
import offline_lock
import diskguard
import sdnotify
import alerts
import nightqc
import nightarchive
import storage_targets
from telemetry import (TelemetryBus, calibrated_for, note_flat_battery, on_body,
                       ppi_contact, sd_calibrated_for, worn_verdict)

# ── JOURNAL SEVERITY (VIGIL-COEXISTENCE-AND-RANGE §1) ────────────────────────────────────────────────
# systemd assigns ONE priority to a service's whole stdout stream, so with a plain basicConfig every line
# — INFO, WARNING, ERROR alike — lands in the journal at priority 6. Measured 2026-07-26: 33 application
# warnings in one daemon lifetime while `journalctl -u tepna-capture -p warning` returned NOTHING. The
# severity was printed in the text but never *expressed*, so every standard operator tool (`-p warning`,
# `-p err`, journald alert rules, log-shipping severity filters, systemctl's red-line extraction) came
# back clean on a box that had 33 warnings. The overnight watch made exactly that mistake five times.
#
# The fix is a syslog priority prefix: systemd parses a leading `<N>` when `SyslogLevelPrefix=yes`, which
# is the DEFAULT, so this needs no unit change and no new dependency. `python3-systemd`'s JournalHandler
# is the other option and is deliberately NOT taken — it adds a dependency to an appliance whose SOUP list
# is intentionally empty, and it reframes every line.
_SYSLOG_PRIORITY = {logging.CRITICAL: 2, logging.ERROR: 3, logging.WARNING: 4, logging.INFO: 6, logging.DEBUG: 7}


class _PriorityFormatter(logging.Formatter):
    """Prefix each record with its syslog priority so journald can filter on severity."""

    def format(self, record: logging.LogRecord) -> str:
        return f"<{_SYSLOG_PRIORITY.get(record.levelno, 6)}>" + super().format(record)


def _install_logging(stream=None) -> logging.Formatter:
    """Configure root logging; add the `<N>` prefix ONLY when journald is consuming the stream.

    The discriminator is systemd's own `JOURNAL_STREAM`, not `isatty()`: a run whose output is
    redirected to a file is equally not-a-TTY, and prefixing there would just corrupt the file with
    `<6>` markers nothing parses. Absent that variable we are interactive or file-logged, so the plain
    format is used and the prefix never reaches a human's console.

    ⚠️ NO `force=True`. This mirrors the plain `basicConfig` it replaced: a no-op when the root logger
    already has handlers. `force=True` looks harmless here and is not — it *removes* every existing root
    handler, which under pytest is `caplog`'s, so any test that drives `main()` and then asserts on
    `caplog.records` silently sees an empty list. Measured: it broke four such tests
    (`test_shutdown_names_a_task_that_ignores_cancellation` and three siblings) while the logging itself
    worked perfectly. Callers wanting a specific sink pass `stream` and clear the root handlers first.
    """
    fmt: logging.Formatter = (
        _PriorityFormatter("%(asctime)s %(levelname)s %(message)s")
        if os.environ.get("JOURNAL_STREAM")
        else logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    )
    handler = logging.StreamHandler(stream)
    handler.setFormatter(fmt)
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    return fmt


HR_UUID = "00002a37-0000-1000-8000-00805f9b34fb"   # standard Heart Rate Measurement (RR intervals)
BATTERY_UUID = "00002a19-0000-1000-8000-00805f9b34fb"   # standard Battery Level (0x2A19) — uint8 percent
log = logging.getLogger("tepna-capture")
_POLAR_EPOCH = _dt.datetime(2000, 1, 1)   # Polar device-time epoch (TimeSystemExplained.md)
STATUS: dict = {"updated": None, "devices": {}}
_CFG: dict = {}          # set in main(); lets sync_device_time resolve a device family by model
_STOP = asyncio.Event()
_EXIT_CODE = [0]          # non-zero → systemd re-execs (watchdog give-up, §2C)
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
    """Bus key for a device's stream. Device-qualified UNLESS the stream can only come from one sensor.

    `ppg` was in the unique set and is NOT unique any more (issue #410): the O2Ring streams a finger
    pleth too, so both it and the Verity declare `ppg`. The Verity therefore kept the bare key, and
    monitor.html's deviceForStream() — which falls back to "first device whose stream list contains
    this name" — resolved it to whichever sensor sorts first. On the real box that was the ring, so the
    Verity's PPG card showed the RING's battery and RSSI. Order-dependent, so it would silently flip if
    config.yaml were reordered.

    ECG remains genuinely device-unique (only the H10 produces it). The O2Ring's own pleth keeps its
    distinct `o2ppg` prefix key and is unaffected."""
    return stream if stream == "ecg" else f"{stream}_{tag}"


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
#
# ⚠️ THE ABSORBED SHIFT HAS A LIFETIME, AND IT IS THE OPEN FILE (CAPTURE-HOST-DEEP-AUDIT §A1).
# The paragraph above justifies the absorption entirely in terms of a RECORDING that must not rewind —
# but the state implementing it is a module global, and the unit is `Restart=always` with no
# `RuntimeMaxSec` and no `.timer`, i.e. it is meant to run for months. So the absorbed hour used to
# outlive the file it protected and every LATER night was stamped an hour off civil time — in the
# per-sample Phone column, in the FILENAME, and in `night_dir()` — indefinitely, with no gate able to
# see it. Two rules bound it, and both key on the same fact (`open_sample_writers()`):
#   1. ABSORB only while a sample file is open. With nothing being recorded there is no artefact to
#      protect, so the honest response to a civil relabelling is to follow it.
#   2. EXPIRE an absorbed shift as soon as the last sample file closes. A discontinuity BETWEEN
#      sessions is free — the next sample opens a new file anyway.
# A deliberate `timedatectl set-timezone` is indistinguishable from a DST relabelling by offset alone
# (that is the whole trick above), so it cannot be told apart here and gets an explicit door instead:
# `reset_clock_anchor()`, called by the /api/clock/tz handler that performed it.
_STEP_THRESH_S = 2.0
_anchor_wall: _dt.datetime | None = None
_anchor_mono: float = 0.0
_anchor_utcoff: _dt.timedelta = _dt.timedelta(0)   # UTC offset in force when we anchored
_civil_shift: float = 0.0   # seconds ABSORBED since the anchor rather than applied: a DST relabelling,
                            # or (since FOLLOWUPS §3) a BACKWARD wall-clock step that would have rewound an
                            # open recording. Non-zero means this session's stamps are deliberately in an
                            # older frame — monotonic, but absolute time is off by this much.


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


def reset_clock_anchor(reason: str = "") -> None:
    """Drop any absorbed civil shift and re-pin the capture clock to civil time.

    The explicit door for a civil-time change the box was TOLD to make — `timedatectl set-timezone` via
    /api/clock/tz. By offset alone that is indistinguishable from a DST relabelling (both move the zone's
    UTC offset by exactly the apparent drift), so `_now()` cannot tell them apart and used to absorb it:
    `clockcfg.status()` then reported the new zone with `tz_set: true` while every stamp stayed in the
    old one, forever. Intent is the only thing that separates the two cases, and only the caller has it.

    If a recording is open it takes a one-time step at this instant. That is the operator's explicit
    instruction, it is logged, and it is strictly better than the alternative the audit measured — every
    subsequent night silently an hour off."""
    if _anchor_wall is not None and _civil_shift:
        log.warning("capture clock re-anchored to civil time (%s) — discarding the %+.0fs civil shift "
                    "absorbed since the last anchor", reason or "requested", _civil_shift)
    else:
        log.info("capture clock re-anchored to civil time (%s)", reason or "requested")
    _reanchor(0.0)


def absorbed_shift_sec() -> float:
    """Seconds this session is deliberately behind civil time, and therefore how wrong its ABSOLUTE
    stamps are. Zero in the steady state.

    Surfaced because the alternative is a silent trade. `_now()` absorbs a DST relabelling, and now a
    backward wall-clock step, to keep an open recording monotonic — the right call, since a rewind
    breaks the strictly-increasing guarantee every parser depends on. But the cost is real: every stamp
    written afterwards is off by this much until the session ends, and until this existed nothing said
    so. A night whose absolute time is knowingly wrong is exactly the fact an operator needs BEFORE
    they try to align it against another device."""
    return _civil_shift


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
        # §A1 rule 2 — the absorbed shift expires with the artefact it protects. `_civil_shift` is 0.0
        # in the steady state, so this costs one float truth-test per sample and never reaches the
        # (cheap, but not free) writer count on the hot path.
        if _civil_shift and open_sample_writers() == 0:
            log.warning("absorbed civil shift %+.0fs expired — no capture file is open, so re-anchoring "
                        "to civil time; the next recording starts in the CURRENT offset frame", _civil_shift)
            _reanchor(0.0)
            return _dt.datetime.now()
        return predicted
    off_delta = (_utcoffset(actual) - _anchor_utcoff).total_seconds()
    if off_delta != _civil_shift and abs(drift - off_delta) <= _STEP_THRESH_S:
        # §A1 rule 1 — absorb ONLY to protect an open recording. With nothing being written there is
        # no file to rewind, so following civil time is both free and correct.
        if open_sample_writers() == 0:
            log.info("civil clock relabelled %+.0fs with no capture file open — following it rather "
                     "than absorbing it", off_delta - _civil_shift)
            _reanchor(0.0)
            return _dt.datetime.now()
        log.warning("DST transition %+.0fs — civil clock relabelled, NOT stepped; capture stamps keep "
                    "counting monotonically in the session's original UTC offset", off_delta - _civil_shift)
        _civil_shift = off_delta
        return predicted
    step = drift - _civil_shift
    # §A1 rule 1 AGAIN, for the case it was never applied to. The DST branch above absorbs a relabelling
    # "ONLY to protect an open recording … there is no file to rewind" — and a BACKWARD wall-clock step
    # has exactly that consequence, by a different mechanism. Measured before this existed: a -30 s NTP
    # step with a writer open sent `_now()` from 22:00:10 to 21:59:50, i.e. the Phone column of a file
    # being written REWOUND 20 s. That breaks the strictly-increasing guarantee every parser depends on
    # (the same guarantee O2PpgGrid refuses to violate when it declines to rewrite emitted samples), and
    # it corrupts a recording rather than merely mislabelling it.
    #
    # A FORWARD step is followed as before: it cannot rewind anything, so applying the correction is
    # free and gives the file the better absolute time. The cost of absorbing a backward one is that the
    # session keeps the pre-step offset until it ends — deliberately the same trade the DST branch makes,
    # for the same reason: within a recording, monotonicity outranks absolute accuracy.
    if step < 0 and open_sample_writers() > 0:
        log.warning("backward wall-clock step %+.3fs with a capture file OPEN — ABSORBED, not applied; "
                    "stamps keep counting monotonically in the session's pre-step frame (applying it "
                    "would rewind the file). Absolute time is off by this much until the session ends.",
                    step)
        _civil_shift = drift
        return predicted
    log.warning("wall-clock step %.3fs — re-anchoring capture stamps here (NTP correction?)", step)
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

    (This function's WRITE cadence predates the RTC becoming READABLE — GET_INFO [24:31], measured
    2026-08-19, oxyii.parse_get_info — and deliberately keeps its shape: a read-then-maybe-write per
    reconnect would double the control traffic to save a write that costs one frame. The readback's job
    is VERIFICATION, not gating: the live loop now reads the RTC periodically and publishes the ring-vs-
    host offset to STATUS, so a 0xC0 push that failed to land is visible on the monitor instead of
    silently trusted.)

    Instead of asking "is the time wrong?" this asks "could it have gone wrong in a way that MATTERS?" —
    answerable, because the RTC's only consumer is the stored .dat, and that stamps a session at its
    START. Hence: first contact, a new recording session, and a slow drift backstop. A BLE reconnect is
    none of those and must not trigger a write."""
    if last_sync is None:
        return "first contact"
    if session_restarted:
        return "new recording session"
    age = (now - last_sync).total_seconds()
    if age >= resync_sec:
        return f"drift backstop, {age / 3600:.1f} h since last"
    return None


# ── Ring RTC readback + gated settings writes over the LIVE link (monitor-facing, 2026-08-19) ────────
# The RTC is readable (GET_INFO [24:31]) and SET_CONFIG is a gated writer (oxyii.set_config_frame).
# Both ride the live session's existing ~1/s poll cadence: a 0xE1 read every _OXYII_INFO_EVERY_S
# publishes the ring-vs-host clock offset to STATUS, and a monitor-queued settings write is applied
# in-session with a 0x00 read-back so the monitor shows the value the RING reports, never the value
# that was merely asked for.
_OXYII_INFO_EVERY_S = 600.0                        # RTC read cadence; one 60 B frame per 10 min
_OXYII_RTC_JUMP_S = 5.0                            # |Δoffset| between reads above this = battery-event
#                                                    reset suspect (quantum is ±1 s; 10-min drift ≪ 1 s)
_OXYII_LAST_RTC_OFF: dict[str, float] = {}         # addr -> previous read offset (survives reconnects,
#                                                    which is where battery swaps actually happen)
_OXYII_CFG_PENDING: dict[str, tuple[str, int]] = {}   # addr -> (field, value) queued by webmon


_OXYII_BUZZ_PENDING: set[str] = set()              # addr -> fire ONE 0x83 on the next poll cycle


def queue_ring_buzz(addr: str) -> None:
    """Queue ONE commanded vibration (0x83, empty payload — measured ~1.1 s) for the ring's next poll.
    The buzz-fiducial marker (O2RING-BUZZ-FIDUCIAL §2b): fired while EVERY device keeps recording on
    the daemon, the buzz lands in the ring's own motion channel AND in whatever the ring is touching
    (H10/Verity ACC) — one mechanical event, N records, one box clock. Operator-commanded only (the
    monitor's button); never scheduled, never mid-night (brief §4)."""
    _OXYII_BUZZ_PENDING.add(addr)


def queue_ring_config(addr: str, field: str, value: int) -> None:
    """Queue ONE whitelisted settings write for the ring's next poll cycle (~1 s when connected).
    Validation happens HERE, at enqueue: oxyii.set_config_frame raises on an off-whitelist field or an
    out-of-range value, so nothing invalid can sit in the queue waiting for a link. One slot per ring —
    a second queued write replaces the first (last click wins, matching what the operator sees)."""
    oxyii.set_config_frame(field, int(value))      # raises ValueError — the caller surfaces it
    _OXYII_CFG_PENDING[addr] = (field, int(value))


def ring_clock_offset_s(rtc: dict, host: _dt.datetime) -> float:
    """Seconds the ring's RTC reads AHEAD of the host's local civil clock. Both sides are naive local
    wall time (the ring stores set_time_frame's fields verbatim), so this is component arithmetic —
    no zones anywhere (Clock Contract). PURE."""
    ring = _dt.datetime(rtc["year"], rtc["month"], rtc["day"], rtc["hour"], rtc["minute"], rtc["second"])
    return (ring - host).total_seconds()

# Phase-0/1 diagnostic (O2RING-LIVE-PPG-WAVEFORM brief): with OXYII_PPG_PROBE=1, DUMP the first N live 0x04
# replies (full hex + host timestamp) to a JSONL file so the ~100 Hz PPG body can be reconstructed +
# decoded offline and its pulse rate cross-checked vs the ECG. Inert without the env var.
_PPG_PROBE = os.environ.get("OXYII_PPG_PROBE") == "1"
_PPG_PROBE_N = int(os.environ.get("OXYII_PPG_PROBE_N", "90"))
_PPG_PROBE_FILE = os.environ.get("OXYII_PPG_PROBE_FILE", "/home/michal/tepna-smoketest/o2ppg-probe.jsonl")
_ppg_probe_n = [0]

# O2Ring live PPG waveform (O2RING-LIVE-PPG-WAVEFORM Phase 2). The 0x04 body carries a ~125 Hz single-
# channel pleth (decoded in oxyii.parse_ppg). We write it as a SINGLE "ppg1" column — the 1-column PSL
# layout — NOT replicated across ppg0/1/2 with an ambient 0: the O2Ring is a single reflectance path, and
# fanning it into the Verity's 3-LED shape is exactly what let PpgDex's consensus vote report a fabricated
# 100 % LED agreement at `measured` tier (see the write path at StreamWriter(..., "ppg1") + write_ppg((v,))
# below, and writers.write_ppg's 1-column branch — PPGDEX-O2RING-FINGER-SITE §3/§7). Samples
# are back-timed from the frame's host arrival across the ~125 Hz grid (the ring clock is unsynced, so
# never stamp with it); the synthesized sensor_ns gives the PSL relative-ms column an 8 ms step.
# The DECLARED ADC SAMPLE RATE — the crystal number the manufacturer states and the AFE4403 produces:
# 32 MHz crystal ÷8 ÷32000 = 125.000 Hz exactly, with no internal RC (the same figure the O2PpgGrid
# docstring below already calls "crystal-accurate 125.000000 Hz exactly", and DEVICE-RATE-TRUTH §2).
#
# ⚠️ ROW RATE ≠ ADC RATE — do not "calibrate" this back up. The constant was 125.738 from 2026-07-18 to
# this change, which was the observed ROW rate, NOT the sample clock: the O2Ring's finger pleth inserts one
# `156` beat MARKER per detected beat, so the file carries 125.000 samples + ~HR/60 marker rows per second
# ≈ 125.7 rows/s at ~44 bpm (the 12-session weighted mean landed at 125.738). Labelling the SAMPLE rate with
# the ROW rate contradicted the manufacturer's 125 and the crystal note below, and was the maintenance
# landmine a future coder could not reconcile — code (125.738) against documentation (125). It is fixed to
# the honest ADC number here. The observed row rate still lives, correctly, in the row-count validators
# (nightqc `_NOMINAL_HZ`, webmon `_BPS_BY_MODEL`) where a rows/second figure is what is actually meant.
#
# This is a LABEL/STARTING-GUESS change, not a computation change (see the STARTING GUESS note below):
# O2PpgGrid._re_estimate slews the working step toward the observed rows, and PpgDex derives its working fs
# from the ns column — neither reads this constant as the answer — so moving it changes no captured output.
# `o2ring.ppg_fs` in config overrides it if a unit's ADC ever measures differently.
O2PPG_FS_DEFAULT = 125.000
O2PPG_FS = O2PPG_FS_DEFAULT           # re-read from config in main(); see cfg['o2ring']['ppg_fs']
O2PPG_NS_STEP = int(1e9 / O2PPG_FS)   # 8_000_000 ns → relative-ms steps of 8.000 ms (reads as 125.00 Hz)

# Honest-gap threshold (O2RING-PPG-GAP §1): the smallest hole between two consecutive frames that we
# treat as REAL LOST TIME rather than BLE delivery jitter. Chosen from measurement, not taste — on a
# 119 min overnight capture the frame-anchor jitter has sd 16.4 ms and p95 |step| 29 ms, while genuine
# losses start around 49 ms (median) and run to 287 ms. 40 ms ≈ 5 samples sits cleanly between the two:
# comfortably above the jitter so it mints no phantom gaps, comfortably below the real losses so it
# still catches them. Overridable per unit via `o2ring.ppg_gap_min_ms`.
O2PPG_GAP_MIN_S = 0.040

# How much real time one raw dual-wavelength buffer covers. NOT a rate and not derived from one: the
# reply is polled once per vitals cycle, so its records span the interval since the previous poll. The
# ring caps the buffer (102 records every time, whatever the spacing), so when the poll is slower than
# the true rate the buffer is FULL and this span over-states what it covers — samples were dropped
# before we asked. Recorded that way on purpose: an honest 1 s span across a full buffer is a visible
# rate error a reader can find, where a fabricated per-sample rate would hide it.
_RT_PPG_SPAN_S = 1.0


# The configured rate is a STARTING GUESS, not the sample clock (CAPTURE-HOST-DEEP-AUDIT §A3), and the
# reason the label change above is inert: `rows/wall` (a ROW rate — samples plus the inserted `156` beat
# markers) is measured to exceed even the old 125.738 on EVERY day of the corpus (07-18 125.826 … 07-26
# 126.045), so it clears the honest 125.000 ADC guess by a wider margin still. That direction is the one the
# old grid could not survive: the session-anchored correction only ever ADVANCED (`if target - idx > …`),
# which is safe while the observed rows run SLOWER than configured but means a FASTER stream banks error
# without bound — +0.2519 % inflation, ~+9.1 s/h of elapsed time that never happened, on the finger-PPG leg
# PpgDex derives HRV from.
#
# So the step is MEASURED instead of assumed, and the constant is only the seed the slew starts from.
# "Re-calibrating" it to the observed row rate would repeat the 2026-07-18 mistake (labelling the sample
# clock with the row rate), leave the asymmetry in place, and re-open the manufacturer/documentation gap.
_O2PPG_EST_MIN_S = 30.0     # don't trust the estimate before this much has elapsed: the estimator is a
                            # CUMULATIVE mean, so its noise falls as 1/elapsed — at the documented ±16.4 ms
                            # arrival jitter that is ±0.055 % here, an order below the defect it replaces.
_O2PPG_EST_BAND = 0.05      # hard clamp: the estimate may not claim a rate more than ±5 % off nominal.
                            # A ring really running outside that band is a different unit, not drift, and
                            # belongs in `o2ring.ppg_fs` where a human can see it.
_O2PPG_EST_SLEW = 0.002     # and it may not move more than 0.2 % per frame, so no single pathological
                            # arrival can step the grid's rate.


def predict_step_split(deltas_ms, ring_ms):
    """Predict how many of the ring's duration steps will be 0 and 2, from the poll intervals alone.

    O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS §2. §7.2 explained the 159/180 split as a beat between the ring's
    second and the poll interval, but only qualitatively. The quantitative form: the ring's counter reads
    `floor(t / ring_ms + phase)`, so between two polls it advances by 1 plus whichever way the fractional
    phase wrapped. With the phase equidistributed (it sweeps ~22 full cycles across a night) and a
    per-poll relative error `eps = (delta - ring_ms) / ring_ms`:

        n(step=2) / N = E[eps+]        n(step=0) / N = E[eps-]

    ⚠️ IT OVER-PREDICTS BY ~1.85x AND THAT IS THE POINT OF SHIPPING IT. Measured over 66 clean sessions:
    median **1.85x** (IQR 1.46-2.21). The identity it CANNOT get wrong — `n0 - n2 = N * (1 - mean step)`
    — is arithmetic, not evidence; the level is the testable part and it is off by about a factor of two.

    The leading explanation is that `E[eps+]` is CONVEX, so noise in `eps` inflates it: the sidecar
    records HOST ARRIVAL times, while the ring samples its counter when it builds the reply, so the
    measured interval is the true poll interval plus BLE delivery jitter. Simulation puts a 1.85x
    inflation at plausible ratios (~5 ms true poll jitter with ~8 ms delivery jitter). That explanation
    is NOT refuted by the near-zero correlation between over-prediction and total arrival jitter
    (r = +0.06, 66 sessions), because the inflation depends on the delivery/poll RATIO — roughly constant
    across one daemon — and not on the total.

    CONFIRMED 2026-08-04 by its FREQUENCY SIGNATURE, on 62 sessions / 324,073 intervals (the whole
    2026-07-25 → 08-04 box corpus, an order of magnitude more than the 66 above). An earlier draft of
    this paragraph said the explanation "cannot be confirmed with what is recorded" and named the
    poll-ISSUE column as the only route. That was wrong — the poll-issue column is the DIRECT test, not
    the only one, and the indirect one needed no new recording at all:

      • replacing the per-interval expectation with a PHASE ACCUMULATOR (carrying fractional phase
        across polls) makes it WORSE — 1.35x/1.63x against 1.24x/1.45x. So the equidistributed-phase
        assumption is not what fails, which kills the obvious rival explanation;
      • running-median smoothing of the host stamps removes the excess MONOTONICALLY and crosses 1.00
        between raw and width 3 (raw 1.24/1.45 → med-3 0.87/0.76 → med-21 0.64/0.32). An excess that
        lives at the ADJACENT-SAMPLE scale is delivery jitter; real clock divergence is by construction
        the low-frequency part and would survive smoothing;
      • that jitter measures 20.8 ms robust sigma (IQR 13.3-29.7, max 315.8) = 2.1 % of a ring second,
        and integrated over a session its pressure (5192) is the same order as the ENTIRE observed step
        count (5617).

    ⚠️ DO NOT PICK A SMOOTHING WIDTH TO MAKE THE RATIO 1.00. Signal and noise share a band here, so
    every width that flattens the bias also destroys the divergence being measured — med-21 under-reads
    doubles by 3x. Choosing a width by the ratio it produces is selecting on the outcome, which is the
    method error this repo has already paid for twice (PAT-VERDICT-CONSOLIDATED §5).

    So: still a BOUND, not a predictor — treat the output as an upper bound on the non-unit step counts,
    good to about a factor of two — but now a bound whose slack has a measured cause rather than a
    plausible one. On the larger corpus the level is 1.24x (flat) / 1.45x (double), pooled 1.31x, median
    per session 1.64x (IQR 1.01-2.18); the 1.85x above sits inside that spread.

    Returns {n0, n2, n} — expected counts, not rounded, so a caller can see the fractional part.
    """
    d = [float(x) for x in deltas_ms if x is not None and math.isfinite(float(x))]
    if not d or not (ring_ms and math.isfinite(ring_ms) and ring_ms > 0):
        return {"n0": float("nan"), "n2": float("nan"), "n": len(d)}
    pos = neg = 0.0
    for x in d:
        e = (x - ring_ms) / ring_ms
        if e > 0:
            pos += e
        else:
            neg -= e
    return {"n0": neg, "n2": pos, "n": len(d)}


class O2PpgFrameLedger:
    """COUNTED PPG sample accounting — the ring's own declared numbers, running ALONGSIDE `O2PpgGrid`'s
    inferred gaps (O2RING-FRAME-SAMPLE-LOCK). Neither replaces the other.

    Every 0x04 reply declares two numbers the host was throwing away: the session second in `[0:4]`
    (`live["duration"]`) and the PPG sample count in `[24:26]` (`oxyii.ppg_sample_count`). What comes out
    of them, in descending order of how far you may trust it:

      * `truncated` = SUM(declared - delivered) — the ring said N and the frame carried fewer. EXACT,
        constant-free, and the only one here whose being non-zero means something is genuinely broken.
      * `device_seconds` = SUM(step) — the ring's own elapsed count over the span. Sound in the LONG RUN
        because its per-step noise cancels (see below), which is why it anchors the arithmetic.
    ⚠️ THERE IS NO THIRD COUNTER, AND THAT IS A CONCLUSION. A `PPG_FRAME_SAMPLES * seconds - declared`
    arithmetic was shipped here and RETIRED 2026-08-04, because it cannot be made informative either way:
      * with a **fitted** nominal (the rate estimated from the session itself) `expected` converges on
        `declared` and the residual is identically ~0 — a statistic whose reference comes from the data
        it is testing, which is the exact defect this brief family keeps finding;
      * with a **fixed** nominal the constant's error is the same order as any loss it could detect —
        126 against a measured 126.04 per device-second with a 125.6-126.5 per-session spread, which
        read **-5 120 samples** (a *surplus*) on the reference night.
    Those are the only two options, so the counter was removed rather than documented. `truncated` and
    the step counters need no constant and stay.

    ⚠️ `Δduration` IS NOT A FRAME-LOSS SIGNAL. A step of 2 looks exactly like "one status frame never
    arrived", and it is not one. Measured on 2026-08-01 — 33 513 frames, steps: 33 172 x +1, 180 x 0,
    159 x +2, and not a single one of +3 or more:

        HOST arrival interval, by the step:   +0 -> 1.000 s   +1 -> 1.005 s   +2 -> 1.005 s
        PPG samples in the frame AFTER it:    +0 ->   125     +1 ->   126     +2 ->   127

    A genuinely missing frame would show a ~2.0 s host interval; a recovered backlog would show ~252
    samples. Both read one second's worth, so **no frame is missing**. The ring's second is 1.00346 host-
    seconds (the -3446 ppm above) against a 1.0028 s poll interval — two nearly-equal periods, so which
    side of a ring-tick a poll lands on wanders and the counter occasionally ticks twice or not at all.

    ⚠️ -3446 ppm IS ONE NIGHT, AND IT IS NOT TYPICAL (DEVICE-RATE-TRUTH §3, 2026-08-06). The quantity is
    scoped correctly here — this paragraph is about the DURATION COUNTER, which is the thing -3446 ppm
    actually describes — but across 44 sessions that counter's error is median **+540 ppm**, range
    **-314 ... +4282**: the reference night is an outlier, and the sign is usually the other way. The
    beat above is therefore real but its PERIOD varies session to session, which is a further reason no
    single step is a measurement. Do not calibrate against -3446, and do not carry it to the SAMPLE
    clock: that one is crystal-accurate (125.000000 Hz exactly, AFE4403 with no internal RC), and the
    two are separate timebases inside one device.
    The 159 and the 180 nearly cancel, and that cancellation is exactly why `device_seconds` survives as
    a span while no single step is a measurement.

    So the honest reading is the IMBALANCE `steps_ahead - steps_flat`, and even that is weak.
    `steps_anomalous` (>= 3, too large for this quantization) is the one that would warrant a look; it
    has not occurred in 60.9 h.

    **This is the THIRD misreading of this field.** `frame_gap()` read it as a sequence counter and
    emitted phantom loss for weeks; `session_restarted()` replaced it. It is not a frame index either.

    ⚠️ What DOES measure lost samples is `O2PpgGrid`'s arrival-timing inference, and the same corpus
    confirms it. Weighted regression of delivered samples per device-second, 60 clean sessions / 60.9 h:

        samples/device-second ~ 126.04  -  6.9 * steps_ahead_frac  -  128.9 * inferred_gap_frac
                                             ^ nothing, as predicted    ^ 102 % — real loss, 1:1

    A signal that costs its samples must read -126.04. The gap logic is RIGHT and stays.

    """

    def __init__(self):
        self.frames = 0            # 0x04 replies received that carried a waveform body
        self.device_seconds = 0    # seconds the RING counted across the span we observed
        # ⚠️ COUNTER QUANTIZATION, NOT LOSS — see the class warning. Named for what they ARE (a step in
        # the ring's own counter) rather than what they resemble (a missing frame), because that
        # resemblance is the precise error this class exists to stop being made a third time.
        self.steps_ahead = 0       # SUM(step - 1) over steps > 1 — the counter ticked more than once
        self.steps_flat = 0        # steps of 0 — it did not tick between two replies
        self.steps_anomalous = 0   # steps >= 3 — too large for quantization; never yet observed
        self.restarts = 0          # the ring began a new recording session — a span discontinuity
        self.declared = 0          # SUM of the count the device declared, every frame
        self.delivered = 0         # SUM of the samples that actually arrived, every frame
        self.truncated = 0         # SUM of declared-minus-delivered where the frame came up short
        self._prev = None          # previous frame's session second

    @property
    def step_imbalance(self) -> int:
        """`steps_ahead - steps_flat` — the only link-ish reading the duration steps support, and a weak
        one. Near zero on a healthy link (159 vs 180 on the reference night). A large positive value
        would mean the counter is running ahead of the frames by more than quantization explains."""
        return self.steps_ahead - self.steps_flat

    def frame(self, duration: int, declared: int, delivered: int) -> dict:
        """Absorb one live frame; return the per-row facts for the sidecar.

        The first frame closes no step, so it contributes to `declared` but not to `device_seconds` —
        it carries the connect-time backlog (250 samples observed, ~2 s accumulated before we were
        listening) that no elapsed device-second accounts for."""
        self.frames += 1
        self.declared += declared
        self.delivered += delivered
        if delivered < declared:
            self.truncated += declared - delivered
        step = None if self._prev is None else duration - self._prev
        self._prev = duration
        if step is None or step < 0:
            # First frame, or the ring restarted its session (its counter went back to 0). Neither is a
            # measurable span: on a restart the wall time between the two sessions is not in either
            # counter, so attributing seconds — or missing frames — across it would fabricate both.
            if step is not None:
                self.restarts += 1
            return {"n": declared, "step": None}
        self.device_seconds += step
        if step == 0:
            self.steps_flat += 1
        elif step > 1:
            self.steps_ahead += step - 1
            if step > 2:
                self.steps_anomalous += 1
        # The RAW step is what goes in the row — not a derived "frames missing". The interpretation is
        # the part that was wrong (see the class warning), and a file that records the primitive can be
        # re-asked a question it did not anticipate. A derived column cannot.
        return {"n": declared, "step": step}




class O2PpgGrid:
    """The O2Ring's synthesized PPG sample clock.

    The ring has NO device clock, so the host lays its samples on a grid and writes that grid as the
    `sensor timestamp [ns]` column. Two things can go wrong and they are DIFFERENT:

      * REAL LOSS — the link dropped frames, so time passed that carries no samples. Handled by advancing
        the grid (an honest gap), because writing the survivors back-to-back would compress the record and
        fabricate beat-to-beat variability at every hole.
      * RATE ERROR — every sample arrived, but the grid's step does not match the rate the ring actually
        runs at. Handled here, by measuring the step instead of assuming it.

    Conflating them is what made `ppg_grid_check` call a file with ZERO inserted gaps "TIMELINE INFLATED …
    cannot be repaired": a uniform rate error and discrete gap insertion produce the same ratio, and the
    file distinguishes them for free (a gap is a non-modal `sensor_ns` delta; a pure rate error leaves the
    delta set a SINGLETON).

    The emitted ns is ACCUMULATED, never `idx * step`, so shortening the step cannot retroactively move a
    sample already written — the column is strictly increasing by construction, which parsing depends on.
    """

    def __init__(self, fs: float | None = None, gap_min_s: float | None = None):
        self.nominal_fs = float(fs or O2PPG_FS)
        self.gap_min_s = float(O2PPG_GAP_MIN_S if gap_min_s is None else gap_min_s)
        self.step_s = 1.0 / self.nominal_fs
        self.idx = 0        # grid position of the NEXT sample — counts inserted gaps, not just arrivals
        self.ns = 0         # sensor_ns of the NEXT sample
        self.t0 = None      # host arrival mapped to grid index 0 (the session anchor)
        self.gaps = 0
        self.lost = 0
        # A SEPARATE anchor for the rate estimate, reset by every inserted gap. The two mechanisms must
        # not share one: an inserted gap raises `idx` while elapsed is unchanged, so estimating across it
        # lowers the apparent period, which raises the rate, which makes `target` outrun `idx` and inserts
        # MORE gaps — a runaway that measured +1.04 % inflation and 118 phantom gaps on a ZERO-LOSS
        # jitter stream. Measuring only loss-free stretches removes the feedback path entirely: within
        # one, `idx` advances solely by arrivals, so the estimate is the ring's true rate and nothing the
        # gap branch does can bias it. A link too lossy to hold a clean stretch simply keeps the
        # configured step — the status quo, which is the right thing to degrade to.
        self.est_t0 = None
        self.est_idx0 = 0

    @property
    def fs(self) -> float:
        """The rate currently being written — measured once the session is long enough to measure."""
        return 1.0 / self.step_s

    def frame(self, arr: _dt.datetime, nps: int) -> list[int]:
        """Absorb one frame of `nps` samples that arrived at `arr`; return their sensor_ns, in order.

        The frame's samples are back-timed to END at `arr`, so it covers [arr - (nps-1)*step, arr]."""
        if self.t0 is None:
            self.t0 = arr - _dt.timedelta(seconds=(nps - 1) * self.step_s)
            self.est_t0, self.est_idx0 = self.t0, 0
        elapsed = (arr - self.t0).total_seconds()
        # Where this frame's FIRST sample should sit, per the host clock. Measured against the SESSION
        # anchor, not the previous frame: the advance is one-sided, so comparing consecutive arrivals
        # RECTIFIED symmetric BLE jitter into monotonic inflation (+210 s over 11.18 h of real corpus,
        # with rows/wall at nominal — i.e. nothing was actually lost). Anchored, jitter cancels.
        target = int(round(elapsed / self.step_s - (nps - 1)))
        step_ns = int(round(self.step_s * 1e9))
        if target - self.idx > self.gap_min_s / self.step_s:
            n = target - self.idx
            self.idx += n
            self.ns += n * step_ns
            self.gaps += 1
            self.lost += n
            # Time was lost, so the stretch we were measuring the rate over is no longer loss-free.
            # Start a new one HERE: this frame's first sample now sits at `arr - (nps-1)*step`.
            self.est_t0 = arr - _dt.timedelta(seconds=(nps - 1) * self.step_s)
            self.est_idx0 = self.idx
        out = []
        for _ in range(nps):
            out.append(self.ns)
            self.ns += step_ns
            self.idx += 1
        self._re_estimate(arr)
        return out

    def _re_estimate(self, arr: _dt.datetime) -> None:
        """Pull the step toward the rate the ring is ACTUALLY running at, over the current loss-free
        stretch. `est_idx0` sits at `est_t0` and the sample just written sits at `arr`, and no gap has
        been inserted in between — so `idx` advanced by arrivals alone and the ratio is the true period."""
        n = self.idx - 1 - self.est_idx0
        if n < 1 or self.est_t0 is None:
            return
        span = (arr - self.est_t0).total_seconds()
        if span < _O2PPG_EST_MIN_S:
            return
        obs = span / n
        lo = 1.0 / (self.nominal_fs * (1 + _O2PPG_EST_BAND))
        hi = 1.0 / (self.nominal_fs * (1 - _O2PPG_EST_BAND))
        obs = min(max(obs, lo), hi)
        slew = self.step_s * _O2PPG_EST_SLEW
        self.step_s = min(max(obs, self.step_s - slew), self.step_s + slew)


# Same one-link constraint for Polar (H10 / Verity) offline-recording pulls over PS-FTP: a device address
# in this set tells its run_polar task to drop the link and idle, so polar_offline_op can own it for the
# download, then resume live capture. Per-address (not a single event) so pulling the Verity doesn't pause
# the H10. Without this a pull collides with run_polar's reconnect loop → org.bluez.Error.InProgress.
_POLAR_PAUSED: set = set()

# Set by the adapter watchdog while it resets a WEDGED BLE controller — every device task idles so the
# power-cycle doesn't fight an in-flight connect. Cleared when recovery finishes.
_RECOVER = asyncio.Event()

# The USB driver directory whose `unbind`/`bind` files are the last recovery rung. A module constant, and
# overridable, ONLY so the tests can drive a fake tree — the real path is not configurable and must not
# become so. Both files are `--w-------` root:root, which is why `_usb_rebind` needs a helper at all.
_USB_DRIVER_DIR = os.environ.get("TEPNA_USB_DRIVER", "/sys/bus/usb/drivers/usb")

# Addresses whose clock was just written successfully. `clock_watchdog` DRAINS this and forgives its
# give-up bookkeeping for those devices. The two live in different tasks and the watchdog's state is
# task-local, so a fresh sync had no way to reach it — leaving a device that was written off while on
# its charger permanently `clock_uncorrectable`, even after coming off the dock and syncing cleanly.
_CLOCK_FRESHLY_SYNCED: set = set()

# name -> monotonic time SAMPLES last arrived. The alert loop keys on this instead of `connected`,
# because a link is not a recording: an unbonded H10 connects for 1-2 s, streams nothing and is torn
# down, which read as "reconnected" FOUR TIMES on 2026-07-29 while 4.5 h of ECG went missing. See
# `alerts.device_is_recording` for the full trace.
_LAST_DATA: dict[str, float] = {}


def note_data(name: str, mono: float) -> None:
    """Record that samples just arrived for `name` — the alert loop's evidence that a link is earning
    its keep. Deliberately a plain module dict rather than a STATUS field: it is monotonic-clock
    bookkeeping between two tasks, not something to publish into `status.json`.

    `mono` is PASSED IN, not read here. Every caller already holds a fresh `_time.monotonic()`, so
    reading it again would be a wasted call on a per-second hot path — and, less obviously, it would
    perturb the stall tests, which drive a STATEFUL fake clock that advances on every read."""
    _LAST_DATA[name] = mono


def radio_looks_deaf(seen: int, connected_any: bool, consecutive_silent: int, min_silent_rounds: int = 2) -> bool:
    """PURE: is the radio DEAF — up, unwedged by every existing test, and hearing nothing?

    `classify_adapter_health` cannot answer this and is not meant to. It separates "adapter wedged" from
    "sensors not worn" using connect errors and the adapter's own up/down state — but on 2026-07-30 hci0
    reported `UP RUNNING`, with 332 MB of lifetime traffic, while a 20 s scan saw ZERO advertisements. In
    a house that always has dozens. Every sensor timed out identically, which is EXACTLY what "nobody is
    wearing them" looks like, so the watchdog correctly declined to power-cycle and ~20 minutes of a
    night was lost until a human restarted bluetoothd by hand.

    So this adds the one signal none of the others carry: can the radio hear ANYTHING? Zero
    advertisements is not a statement about our sensors — it is a statement about the receiver. `UP
    RUNNING` is not the same as hearing, the same way `connected` is not the same as recording.

    `connected_any` short-circuits it: a radio holding a live link is demonstrably working, whatever a
    scan says, so the question is only asked when nothing is connected — which is also the only state
    where a probe cannot contend with the daemon's own connects.

    `min_silent_rounds` because ONE empty scan is not evidence: a probe can lose the race for the
    controller, or land in a genuinely quiet moment. Two consecutive silent rounds minutes apart is a
    receiver that is not receiving. The cost of being wrong here is a bluetooth restart that drops
    nothing (nothing was connected), so the bar is deliberately low — but not one sample low."""
    if connected_any:
        return False
    if seen > 0:
        return False
    return consecutive_silent >= min_silent_rounds


def classify_adapter_health(devices: list[dict], adapter_up: "bool | None" = None) -> dict:
    """PURE (testable): from each configured device's {name, connected, last_error, bluez_connected} plus
    the PINNED ADAPTER's own up/down state, decide whether the BLE ADAPTER looks WEDGED vs merely idle
    because the devices AREN'T WORN — the distinction the whole watchdog turns on. Returns
    {wedged, reasons, phantom:[addresses]}.

      • `adapter_up` (added 2026-07-24, VIGIL-OVERNIGHT-FINDINGS) is the adapter's ACTUAL state: True =
        UP RUNNING, False = DOWN or not-resolvable, None = unknown/not probed. It exists because the
        device-error heuristics below MISS the commonest real wedge: a hung dongle fails connects with a
        plain `TimeoutError('connect timed out')`, which is neither InProgress nor a phantom link — so a
        DOWN radio read as "just not worn" and the watchdog logged "adapter healthy again" 25×+ over a
        dead adapter on 2026-07-23, repeatedly resetting its own escalation counter. None preserves the
        pre-2026-07-24 behaviour for callers that don't probe it.

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
    # A LIVE LINK IS NOT PROOF THE RADIO IS WORKING — A STREAMING ONE IS (CAPTURE-HOST-DEEP-AUDIT §C3).
    # Both suppression guards below turn on "is the radio serving anyone?", and both used to read
    # `connected`. A sensor on its charger reports connected=True while producing nothing — the Verity
    # literally sets `last_error="charging — PMD streams unavailable"` — so ONE DOCKED SENSOR made a
    # genuinely DOWN adapter classify as healthy. Suppression-only: this can never cause a spurious
    # power-cycle, only miss a real wedge.
    #
    # The predicate is `cpap_harvest.blocking_devices` verbatim (connected AND not charging AND worn is
    # not False) — the same confusion, fixed in the CPAP interlock the same day in commit 1f6bcdf, one
    # module over. `adapter_watchdog`'s own docstring already said the reset requires "a single
    # connected+STREAMING device"; the classifier was not even PASSED charging/worn, so it could not
    # make the distinction it documented.
    #
    # The PHANTOM branch below is untouched: it genuinely wants link EXISTENCE (`bluez_connected` while
    # our own `connected` is False), it is per-device, and a stale link is a wedge whether or not
    # anything is streaming.
    any_streaming = any(d.get("connected") and not d.get("charging") and d.get("worn") is not False
                        for d in devices)
    # A DOWN/absent pinned adapter while it is serving NOBODY is the most direct wedge signal there is —
    # and the one the per-device errors below cannot express. Guarded by `not any_streaming` (identical to
    # the InProgress guard): a live STREAM is proof the radio works, so a probe misread can never
    # power-cycle a demonstrably-working adapter. adapter_up=None (unknown) leaves the device heuristics
    # to stand alone.
    if adapter_up is False and not any_streaming:
        reasons.append("pinned adapter DOWN/not-found")
    for d in devices:
        err = d.get("last_error") or ""
        if "InProgress" in err and not any_streaming and adapter_up is not True:
            # No device is connected AND a connect is stuck in-progress → INFER the radio is wedged... but
            # ONLY when the adapter is not CONFIRMED up. If _adapter_is_up() says the pinned adapter is
            # UP RUNNING (adapter_up is True), the radio is demonstrably working and this InProgress is
            # device-side churn — commonly the morning teardown (auto-pull running + every sensor going
            # off-finger/on-charger at once, so momentarily nobody is connected). Power-cycling a healthy
            # radio on that is the 2026-07-20 "needless power-cycle is worse than the problem" failure in a
            # new form (observed as a false sign-2/2 on 2026-07-24 09:46). adapter_up None/False (unknown
            # or DOWN) still counts InProgress — the inference is only SUPPRESSED by positive proof the
            # radio is fine. A real DOWN wedge is caught by the pinned-adapter signal above regardless.
            reasons.append(f"{d.get('name')}: InProgress")
        if d.get("bluez_connected") and not d.get("connected"):
            phantom.append(d["address"])
            reasons.append(f"{d.get('name')}: phantom BlueZ link")
    return {"wedged": bool(reasons), "reasons": reasons, "phantom": phantom}


# "the caller did not ask about this", which is NOT the same as "the caller said it is unset". `None` is a
# legitimate value for usb_path (meaning disarmed), so absence needs its own marker — otherwise a two-arg
# call would start reporting defenses disarmed that it never looked at, which is the same class of lie
# this self-test exists to catch, pointed the other way.
_UNCHECKED = object()


def defense_warnings(autosuspend_value: "str | None", capeff_hex: "str | None", *,
                     usb_path=_UNCHECKED, archive_enabled=_UNCHECKED,
                     archive_dest_ready: "bool | None" = None,
                     helper_warnings=()) -> list[str]:
    """PURE (testable): given the pinned adapter's USB `power/control` value ('auto' | 'on' | None if
    unknown) and the process CapEff hex ('0000…' | None), return the LOUD startup warnings for any wedge
    defense that is DISARMED. Empty when everything is armed.

    VIGIL-OVERNIGHT-FINDINGS §P1.4: a resilience feature you cannot SEE is disarmed is worse than none —
    the 2026-07-23 wedge cost ~110 min precisely because the two defenses (autosuspend-off, a privileged
    recovery ladder) were silently absent and nothing said so at boot. A fresh install that skips the udev
    step, or a reboot onto a box without the rule, must be told at 22:00, not discovered at 01:39."""
    out: list[str] = []
    if autosuspend_value == "auto":
        out.append(
            "USB autosuspend is ENABLED on the BLE adapter (power/control=auto) — an RTL8761B dongle can "
            "firmware-wedge under load (cost ~110 min on 2026-07-23). Install "
            "systemd/50-tepna-btdongle.rules (see README 'Install') to disable it.")
    if capeff_hex is not None:
        try:
            if int(capeff_hex, 16) == 0:
                out.append(
                    "capture has no CAP_NET_ADMIN — the watchdog's adapter-recovery ladder (hciconfig "
                    "reset / USB rebind) cannot run and exits 1. Prevention (autosuspend-off, above) is the "
                    "primary defense; grant the cap for recovery. See VIGIL-OVERNIGHT-FINDINGS §P1.2.")
        except ValueError:
            pass
    # §P1.4 item (b) — usb_path. Added 2026-08-04: the LAST rung of the ladder is off by default, and a box
    # that has already needed it once is a box that should have it set. On 2026-07-24 the bus-port was
    # identified as `11-1.2` and the recovery still could not use it, because the key was never written.
    # Warned rather than defaulted: the id is host-specific, and guessing one would rebind the wrong device.
    if usb_path is not _UNCHECKED and not usb_path:
        out.append(
            "watchdog.usb_path is UNSET — the last recovery rung (USB unbind/bind) is disabled. A soft "
            "power-cycle does NOT clear an RTL8761B firmware hang, so a wedge that survives it has no "
            "remaining fix. Set it to the dongle's bus-port from `ls /sys/bus/usb/devices/` "
            "(VIGIL-OVERNIGHT-FINDINGS §P1.3).")
    # The CONVERSE, and the one that actually bit. Added 2026-08-05: the warning above fires only when the
    # key is ABSENT, so SETTING it silenced the sole check on this path — while the rung remained incapable
    # of running, because the daemon is unprivileged and the sysfs files are root-only. Measured on the live
    # box that day: `usb_path: 1-2` set, `CapEff: 0000000000001000` (CAP_NET_ADMIN alone), unbind/bind
    # `--w------- root root`, no `tepna-btreset.sh` installed, and no code path that had ever called one.
    # A configured-but-inoperable rung is worse than a disabled one: it reads as armed.
    elif usb_path is not _UNCHECKED and usb_path:
        rebind_ok, why = usb_rebind_available()
        if not rebind_ok:
            out.append(
                f"watchdog.usb_path is set to {usb_path} but the last recovery rung CANNOT RUN — {why}. "
                "The unbind/bind write needs root and this process does not have it, so the ladder will "
                "report a wedge it cannot clear (VIGIL-OVERNIGHT-FINDINGS §P1.3).")
    # §P1.4 item (c) — the archive destination. A box that never offloads holds the ONLY copy of every
    # night, and that failure is silent by construction: capture keeps working perfectly.
    if archive_enabled is _UNCHECKED:
        pass
    elif not archive_enabled:
        out.append(
            "archive is NOT configured — finished nights never leave this box, so each night exists in "
            "exactly one copy on one disk. Set a target in the monitor's Storage card "
            "(VIGIL-OFFLOAD-AND-RETENTION).")
    elif archive_dest_ready is False:
        # `ismount`, not `isdir`, upstream: an unmounted mountpoint is a present, empty, writable directory
        # on the BOOT disk, so the mirror "succeeds" onto the wrong filesystem and the operator believes
        # the nights are on the NAS (storage_targets' own reasoning).
        out.append(
            "archive is enabled but its destination is NOT ready (not mounted) — the mirror will write "
            "into an empty mountpoint on the boot disk and report success. Check the target in the "
            "monitor's Storage card.")
    # A PRIVILEGED HELPER RESOLVED FROM A PATH THE GRANTED USER CAN REWRITE. `helper_path.grant_warning`
    # has always been able to detect this and, until 2026-08-14, was called by nothing outside its own
    # tests — a correct answer with no consumer, which is this box's most-repeated defect shape.
    #
    # It is reachable, not hypothetical: `resolve()` falls back to the in-repo copy when no system copy
    # exists, that copy is `-rwxrwxr-x vigil` on the real box, and `daemon_control.build_cmd` prefixes
    # `sudo -n` to whatever it returns. Today it degrades legibly only by accident — sudoers is scoped to
    # /usr/local/lib/tepna/*, so the call is REFUSED rather than escalated. That is the second line of
    # defence doing the first line's job, and it stops being true the moment a grant is widened.
    #
    # ⚠️ A PLAIN () DEFAULT, NOT `_UNCHECKED`, and the difference from `usb_path` above is the point.
    # For a single value, "not looked" and "looked and it was empty" are different verdicts, which is why
    # those parameters carry the sentinel. For a LIST OF WARNINGS they are not: both produce no warning,
    # so a sentinel here would be decoration that reads like rigour. Found by mutation — swapping the
    # sentinel for () changed nothing observable, which is the definition of decorative.
    out.extend(helper_warnings or [])
    return out


def _usb_power_control_path(hci: str) -> "str | None":
    """The USB `power/control` sysfs path for a bluetooth `hciN`, or None if not a USB adapter / not found.
    Generic: walks /sys/class/bluetooth/<hci>/device up to the first ancestor carrying an idVendor (the USB
    device node) and returns its power/control. Works on any host, not just this box's bus-port."""
    try:
        d = os.path.realpath(f"/sys/class/bluetooth/{hci}/device")
        while d and d != "/":
            if os.path.exists(os.path.join(d, "idVendor")):
                ctrl = os.path.join(d, "power", "control")
                return ctrl if os.path.exists(ctrl) else None
            d = os.path.dirname(d)
    except Exception:
        pass
    return None


def _gather_helper_warnings() -> list[str]:
    """One warning per privileged helper that would be sudo-run from a path the granted user can rewrite.

    ⚠️ PER-HELPER try, NOT one around the loop. A single unreadable path would otherwise abort the sweep
    and silence every helper after it — and the LOOP ORDER would then decide which defences got reported.
    A self-test that goes quiet because one input failed is exactly the fail-open shape it exists to
    refuse. Bounded and never raising, like the other gatherers: a self-test must not stop capture.

    Asks about every helper invoked under sudo ANYWHERE (`helper_path.SUDO_HELPERS`), not only the three
    this module resolves — clockcfg and link_rssi resolve others, and a per-call-site check is precisely
    what left `grant_warning` with no caller at all until 2026-08-14."""
    # ⚠️ ONLY ON A DEPLOYED HOST, and this gate is not cosmetic. In ANY development checkout the helpers
    # are repo-local and never root-owned, so an ungated check warns five times at every startup about a
    # path that holds no sudoers grant and never will. A self-test that always fires teaches the operator
    # to stop reading it — the same way the retired `smeared` canary arm fired on every stream.
    #
    # The presence of the system dir IS the discriminator: it exists exactly where a NOPASSWD grant on
    # `/usr/local/lib/tepna/*` plausibly exists. That makes the surviving signal the one that actually
    # bit on 2026-08-14 — a deployed box where a helper is MISSING from the system dir, so `resolve()`
    # silently falls back to the vigil-writable checkout beneath a `sudo -n`.
    if not os.path.isdir(helper_path.SYSTEM_DIRS[0]):
        return []
    out: list[str] = []
    for name in helper_path.SUDO_HELPERS:
        try:
            w = helper_path.grant_warning(helper_path.resolve(name))
        except Exception:                # pragma: no cover — grant_warning already swallows OSError
            continue
        if w:
            out.append(w)
    return out


async def startup_defense_check(hci: "str | None", cfg: "dict | None" = None) -> None:
    """Log a LOUD warning at boot for each DISARMED wedge defense (VIGIL-OVERNIGHT-FINDINGS §P1.4). Reads
    the pinned adapter's autosuspend state + this process's CapEff + the config's recovery/archive keys,
    and defers the decision to the pure `defense_warnings`. Bounded, never raises — a self-test must never
    keep capture from starting.

    `cfg` is trailing + optional so existing callers keep working (CLAUDE.md's back-compat rule); absent,
    the config-derived checks are simply not made rather than fabricated as armed."""
    autosuspend = None
    try:
        ctrl = _usb_power_control_path(hci) if hci else None
        if ctrl:
            with open(ctrl) as f:
                autosuspend = f.read().strip()
    except Exception:
        pass
    capeff = None
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("CapEff:"):
                    capeff = line.split()[1]
                    break
    except Exception:
        pass
    # Config-derived defenses. Only judged when a cfg was passed — a check that cannot see its input must
    # not report "armed", which is the exact failure this whole self-test exists to prevent.
    # Ask about every helper that is invoked under sudo anywhere, not only the ones THIS module resolves —
    # capture.py resolves three, clockcfg and link_rssi resolve others, and a per-call-site check is what
    # left this unwired in the first place.
    kw: dict = {"helper_warnings": _gather_helper_warnings()}
    if cfg is not None:
        wcfg = (cfg.get("watchdog") or {})
        acfg = (cfg.get("archive") or {})
        kw["usb_path"] = wcfg.get("usb_path")
        kw["archive_enabled"] = bool(acfg.get("enabled")) and bool(acfg.get("dest") or acfg.get("target"))
        dest = acfg.get("dest")
        if kw["archive_enabled"] and dest:
            try:
                # ismount, NOT isdir — an unmounted mountpoint is a writable empty dir on the boot disk.
                kw["archive_dest_ready"] = os.path.ismount(str(dest))
            except Exception:
                kw["archive_dest_ready"] = None
    for w in defense_warnings(autosuspend, capeff, **kw):
        log.warning("STARTUP: %s", w)


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


# ── DUAL-RADIO FAILOVER (VIGIL-OVERNIGHT-FINDINGS P1.5) ──────────────────────────────────────────────
# The night the dongle wedged, hci1 sat healthy and idle for ~110 min while the pinned dongle was down.
# The recovery ladder (adapter_watchdog) resets the SAME radio; when that budget is spent, fail capture
# over to a healthy spare instead of giving up. The pin is a process global (ADAPTER) resolved MAC->hciN
# FRESH on every reconnect (adapter_kw/adapter_hci), so repointing it alone moves every device task —
# the whole failover is: pick a spare, repoint, re-bond the sensors there.
def parse_hciconfig(text: str) -> list[dict]:
    """`hciconfig -a` → [{'hci','mac','up'}], one per controller. PURE. A controller block starts at a
    left-margin `hciN:`; `BD Address: XX:..` gives the MAC; `UP RUNNING` anywhere in the block means up.
    A block with no MAC is dropped — an adapter we cannot address is not a failover target."""
    out: list[dict] = []
    cur: dict | None = None
    for line in text.splitlines():
        if line[:3] == "hci" and not line[:1].isspace() and ":" in line.split()[0]:
            if cur and cur["mac"]:
                out.append(cur)
            cur = {"hci": line.split(":", 1)[0].strip(), "mac": None, "up": False}
            continue
        if cur is None:
            continue
        if "BD Address:" in line:
            frag = line.split("BD Address:", 1)[1].split()
            if frag and len(frag[0]) == 17 and frag[0].count(":") == 5:
                cur["mac"] = frag[0].upper()
        if "UP RUNNING" in line:
            cur["up"] = True
    if cur and cur["mac"]:
        out.append(cur)
    return out


def failover_target(pinned_mac: str | None, adapters: list[dict]) -> str | None:
    """A healthy adapter to fail over to — UP, addressable, and NOT the pinned (wedged) one — or None.
    PURE. A down spare is no spare; without a MAC the reconnect cannot be pinned to it (adapter_kw needs
    the MAC); and never the pinned adapter itself, which is the one that just wedged."""
    pin = (pinned_mac or "").upper()
    for a in adapters:
        mac = (a.get("mac") or "").upper()
        if mac and mac != pin and a.get("up"):
            return mac
    return None


async def list_adapters() -> list[dict]:
    """Enumerate BLE controllers via `hciconfig -a` → parse_hciconfig. [] on ANY failure — a failover
    onto an adapter we could not confirm UP is worse than staying put on the wedged one, so an
    unconfirmable spare is no spare."""
    try:
        p = await asyncio.create_subprocess_exec(
            "hciconfig", "-a", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        out, _ = await proc_util.communicate(p, 8)   # bounds AND kills+reaps the child on timeout
        return parse_hciconfig(out.decode("utf-8", "replace"))
    except Exception as e:
        log.debug("list_adapters: %r", e)
        return []


def _set_active_adapter(mac: str) -> None:
    """Repoint the process-wide adapter pin. Every device task resolves ADAPTER->hciN FRESH on each
    reconnect, so this one assignment moves capture onto `mac` — the failover mechanism itself."""
    global ADAPTER
    ADAPTER = mac


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

# Passive scanning (listen only, never transmit scan requests) frees air-time on the shared controller for
# the live H10/Verity ACL links — but bleak's BlueZ backend only offers it via the AdvertisementMonitor
# API, which needs `bluez={"or_patterns": [...]}` AND a bluetoothd started with --experimental. Where
# either is missing it raises BleakError('passive scanning mode requires bluez or_patterns') at scanner
# construction — INSTANTLY, before any scanning happens. That is not a missed advert, it is a scan that
# never ran: shipped on 2026-07-22 without an or_patterns filter it took the O2Ring's reconnect to 0%
# (every cycle logged a link error, the ring never came back all night) while the unit tests stayed green
# because they stub find_device_by_filter and so never see BlueZ refuse. So passive is now an OPPORTUNISTIC
# optimisation, never a dependency: try it once, and the moment the stack declines fall back — for the rest
# of the process — to the plain active scan pull_session.py has always used. A capture that runs is worth
# more than an air-time saving.
_O2_PASSIVE_SCAN = True          # flipped off for good by the first refusal from this BlueZ stack


@contextlib.asynccontextmanager
async def _connect_scan(addr: str, name_hints=_O2_NAME_HINTS, timeout: float = 15.0):
    global _O2_PASSIVE_SCAN
    from bleak import BleakClient as _BC, BleakScanner as _BS
    from bleak.exc import BleakDeviceNotFoundError as _NotFound, BleakError as _BErr
    akw = await adapter_kw()                      # pin scan AND connect to the configured radio

    def _match(d, adv):
        return (d.address.upper() == addr.upper()
                or any(h in ((adv.local_name or d.name or "").lower()) for h in name_hints))

    device = None
    if _O2_PASSIVE_SCAN:
        try:
            device = await _BS.find_device_by_filter(
                _match, timeout=timeout, scanning_mode="passive", **akw)
        except _BErr as exc:
            # Only a "this stack can't do passive" refusal downgrades. A real scan failure (adapter wedged,
            # D-Bus gone) must stay an error the caller retries + the watchdogs can see, not be masked by a
            # second scan on the same broken radio.
            if "passive" not in repr(exc).lower():
                raise
            _O2_PASSIVE_SCAN = False
            log.info("passive BLE scan unsupported here (%s) — using active scan for the O2Ring", exc)
    if device is None and not _O2_PASSIVE_SCAN:
        device = await _BS.find_device_by_filter(_match, timeout=timeout, **akw)
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


# ABSENT is not BUSY, and the difference decides who should do the retrying.
#
# `_TRANSIENT_BLE` above answers "is this worth retrying AT ALL", and for the reconnect loop the answer
# for a not-found device is YES — that loop exists precisely to keep looking for a sensor that is out of
# range. But it is the WRONG answer for `auto_sync_clock`, whose 12-attempt ladder holds the GLOBAL
# `_CONNECT_LOCK` on every attempt (see polar_offline_op). Those two signals need telling apart:
#
#   contention  — InProgress / not-ready / busy: the device IS there, something else holds its one link.
#                 Waiting is exactly right; this is the case the ladder was built for (2026-07-18, both
#                 Polars lost their clock for an evening because a restart's InProgress was read as fatal).
#   absence     — DeviceNotFound / not advertising: the scan did not see it. No amount of waiting helps,
#                 and the wait is not free — it is up to _CLOCK_SYNC_TIMEOUT_S of a lock that blocks
#                 EVERY other device's reconnect.
#
# Retrying absence is also REDUNDANT, which is what makes dropping it safe: `clock_sync_due` re-syncs on
# every reconnect, and a reconnect only happens when the device is reachable. The reconnect loop is
# already the retry mechanism for absence; the ladder was duplicating it and paying a global lock to do it.
#
# MEASURED, and this is the third time this exact shape has been fixed here. 2026-07-19: an out-of-range
# device wedged capture for 58 min → `_OFFLINE_OP_TIMEOUT_S`. Then the same day, 12 retries × 300 s = a
# 97 % duty-cycle wedge → `_CLOCK_SYNC_TIMEOUT_S = 45`. Both attacked the TIMEOUT. On 2026-08-09, with an
# H10 sitting on a desk, the loop was still running at a **59 % duty cycle** — 51 ops in 59.1 min, mean
# hold 41.1 s, 2097 s of 3544 s. Lowering the constant twice never removed the loop, because the loop is
# not a timeout problem: it is a retry-decision problem.
# ⚠️ EVERY TOKEN HERE MUST ALSO APPEAR IN `_TRANSIENT_BLE`, and a test asserts it structurally rather
# than by example. Absence must be a strict SUBSET of transient: this change moves WHO retries, never
# WHETHER anyone does. A token that were absent-but-not-transient would make the reconnect loop
# surrender a sensor that had merely walked out of range — strictly worse than the loop being fixed.
# (Caught in review: the first draft added spaced variants like "device not found" that `_TRANSIENT_BLE`
# does not carry, which would have done exactly that.)
_ABSENT_BLE = ("devicenotfound", "not advertising")


def device_absent_error(exc: BaseException) -> bool:
    """True when the failure says the device WAS NOT FOUND, as distinct from found-but-busy.

    Deliberately narrower than `transient_ble_error` and NOT a replacement for it: a bare `TimeoutError`
    stays 'busy', because a connect can time out against a device that is present but contended, and
    guessing 'absent' there would surrender a sync the ladder should have waited out."""
    return any(m in repr(exc).lower() for m in _ABSENT_BLE)


# An adapter that has run out of link-layer connection slots reports a distinct error that reads like
# "sensor off" unless named (VIGIL-DEEP-ANALYSIS §2D): an over-provisioned dongle looks like flapping
# sensors. Classify it so the log says "adapter connection ceiling", not a generic link error.
_CEILING_SIGNS = ("connection-profile-unavailable", "too many", "no resources", "connection limit",
                  "max connections", "host is down")


def link_error_text(exc: BaseException) -> str:
    """The operator-facing description of a failed connect — ONE formatter for every link-error site.

    `connection_ceiling_error` has been able to tell these apart since it was written, and until
    2026-08-14 nothing called it. The comment above it says *"classify it so the log says 'adapter
    connection ceiling', not a generic link error"*, and all THREE sites logged the generic form anyway.
    The two failures want opposite responses — a ceiling is over-provisioning you fix at the adapter, an
    absent sensor is a battery or a strap — and `TimeoutError()` reads identically either way, which is
    VIGIL-DEEP-ANALYSIS §2D's complaint that an over-provisioned dongle "looks like flapping sensors".

    Single-sourced deliberately, and the count is why: a grep that stopped at the first two sites would
    have left the third drifting. The charging rule was written twice and only one copy checked
    `charging` — the same failure, one file over."""
    if connection_ceiling_error(exc):
        return ("ADAPTER CONNECTION CEILING — the adapter is out of link slots, so this is "
                "over-provisioning and NOT an absent sensor: %r" % (exc,))
    return "link error: %r" % (exc,)


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


def charging_retry_in_place(connected, stopped, paused, recovering) -> bool:
    """PURE: may the next charging START retry run on the link we already hold?

    False means release the link and let the outer reconnect loop own the retry — because the link is
    gone, we are shutting down, an offline pull needs exclusive access to this device, or the adapter
    watchdog is resetting the controller. `paused` matters most: a pull that cannot get the link
    fails with org.bluez.Error.InProgress, so holding one through a pause request would trade this
    bug for a worse one.
    """
    return bool(connected and not stopped and not paused and not recovering)

# POWER: drop a not-worn Polar so it stops draining. A chest strap off the body does not go quiet — it
# streams electrode noise at the full rate (130 Hz ECG), which records nothing real AND flattens the
# strap's battery over a day. So after a generous grace of CONTINUOUS not-worn contact we drop the link,
# then reconnect on a slow cadence to check whether it has been put back on. The grace is deliberately
# long: a real wear is never not-worn for minutes (a roll-over or strap tug is seconds), and dropping
# during genuine use would cost real data. Only devices that actually REPORT contact are affected;
# worn=None (no contact bit) is never dropped. Set drop_not_worn_sec=0 to disable.
_RESUME_WINDOW_S = 300.0            # CAPTURE-FILESET-RESUME: reconnect gap below this reuses the
#                                     file-set; >= it mints a fresh one. 0 disables. Override via
#                                     write.resume_window_sec. Must stay ABOVE the drop_not_worn recheck
#                                     cadence (90 s) or the duty cycle it exists to collapse escapes it.
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
# Re-bond cadence for a Polar whose BlueZ bond has vanished mid-session. Every 5th reconnect, up to 72
# attempts — at the observed ~70 s reconnect period that is one try every ~6 min for 7 h. Sized to span
# a WHOLE NIGHT on purpose: the 2026-07-29 loss would have needed a retry four hours after the bond went
# stale, so a short burst would have been long exhausted before the operator touched the strap. A bond
# restored by operator action (re-wetting the electrodes, pulling the battery) is therefore picked up
# the same night without a service restart, while a hopeless one stops costing subprocesses by morning.
# `test_the_cap_still_spans_a_whole_night` pins the arithmetic, so shrinking either constant reds.
_REBOND_EVERY = 5
_REBOND_LIMIT = 72
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


def clock_sync_due(is_polar, enabled, charging, first_attempt) -> bool:
    """PURE: should we (re-)write this device's clock before the next connection attempt?

    RE-SYNC ON EVERY RECONNECT, not once per task. The sync used to run exactly once, ahead of the
    reconnect loop — so a device that was on its charger when the daemon started never got a usable
    clock for the rest of the session, however many times it reconnected afterwards. That is the common
    case, not a corner: the sensors sit on the dock all day and the daemon is already running when they
    come off. `clock auto-sync gave up — device stayed unreachable/busy` appeared 21x in one week of
    logs. A reconnect is also the RIGHT moment mechanically — the PS-FTP write needs the device's single
    BLE link, so it can only happen before the PMD session is established.

    NEVER WHILE CHARGING. A docked Polar refuses PMD outright ("charging — PMD streams unavailable",
    status 0x0D) and will not take a clock write either, so the attempt cannot succeed — it only burns
    the watchdog's give-up budget and gets the device permanently marked `clock_uncorrectable` for the
    session (observed 2026-07-29: Verity −5.0 s, three re-syncs at 05:01/05:06/05:12, given up 05:17,
    right after it went on the dock). Skipping is not deferring the fix: coming OFF the dock produces a
    reconnect, which is exactly when this returns True.

    `first_attempt` is True for the pre-loop sync that already runs, so this governs only the RE-syncs."""
    return bool(is_polar and enabled and not charging and not first_attempt)


def rebond_due(needs_pmd, bonded, iteration, attempts, every, limit) -> bool:
    """PURE: should this reconnect attempt try to re-establish a LOST bond?

    Four conditions, each earning its place:

    * `needs_pmd` — the SIG Heart Rate characteristic needs no authentication, and most third-party
      straps cannot pair at all, so bonding one fails and reports a scary "bond failed" for a device
      that was about to work perfectly well.
    * `not bonded` — BlueZ is the authority. A healthy device must cost nothing.
    * `iteration % every == 0` — bonding drives a `bluetoothctl` subprocess and takes seconds; retrying
      on every ~70 s reconnect would spend more time pairing than capturing.
    * `attempts < limit` — a bond that can NEVER take (sensor factory-reset, or held in someone else's
      pairing table) must not be retried until the battery dies.

    The cap counts re-bond ATTEMPTS, not reconnects, so at the defaults it still spans a whole night —
    which is the point. The 2026-07-29 loss needed a retry FOUR HOURS after the bond went stale, long
    after any short-lived burst of attempts would have been exhausted."""
    if not needs_pmd or bonded or every <= 0:
        return False
    return attempts < limit and iteration % every == 0


async def auto_sync_clock(name, addr) -> bool:
    """Write the host clock into one Polar device, waiting out contention. Returns True on success.

    Every device task starts at once and each wants the single offline slot, so the losers get
    OfflineBusy. Fail-fast is right for a user-clicked pull (don't leave the browser spinning) but wrong
    here — an auto-sync should simply WAIT ITS TURN, or the second sensor silently never syncs and the
    two end up on different timebases (observed 2026-07-18: the Verity lost the race and stayed 4 h off
    the H10). Retry on busy only; a real failure still gives up.

    On success this CLEARS `clock_uncorrectable` and records the address in `_CLOCK_FRESHLY_SYNCED`, so
    `clock_watchdog` forgives a device it had previously written off. Without that the give-up is sticky
    across the very event that fixes it — a device that failed while docked stayed marked uncorrectable
    for the whole session even after it came off the dock and re-synced cleanly.

    BOUNDED BY WALL CLOCK, not just by attempt count — see `_CLOCK_SYNC_LADDER_BUDGET_S`."""
    started = _time.monotonic()
    for attempt in range(12):
        try:
            await sync_device_time(addr)
            _set(name, clock_synced=_now().isoformat(timespec="seconds"), clock_uncorrectable=False)
            _CLOCK_FRESHLY_SYNCED.add(addr)
            return True
        except offline_lock.OfflineBusy:
            await asyncio.sleep(5)
        except Exception as e:
            # ABSENT: the scan did not find it. Do NOT spend the ladder — every attempt costs up to
            # _CLOCK_SYNC_TIMEOUT_S of the global _CONNECT_LOCK, blocking every other device's reconnect,
            # and cannot succeed. `clock_sync_due` fires again on the next reconnect, which only happens
            # when the device IS reachable, so this defers the sync by one cycle rather than losing it.
            if device_absent_error(e):
                log.info("%s clock auto-sync deferred — device not found (attempt %d); the reconnect "
                         "loop will re-trigger it when the device is back", name, attempt + 1)
                return False
            # BUSY: a transient BlueZ state is a signal from a different layer, not a failure.
            # Surrendering here left the device stamping samples from an unsynced clock all night.
            if transient_ble_error(e):
                # LOG THE MESSAGE, NOT JUST THE CLASS — this line is where a whole class of failure hid.
                # `BleakError` is the catch-all bleak raises for a dozen unrelated conditions
                # (`device '<path>' not found`, `failed to connect: <cause>`, `br-connection-canceled`,
                # adapter-missing …) which need completely different responses, and `busy (BleakError)`
                # names none of them.
                #
                # Measured 2026-08-09: the box logged `busy (BleakError) — retry 1/12` for an hour while
                # `device_absent_error` scored ZERO hits, and the journal could not say WHICH BleakError
                # it was. The absence fix (#1062) was aimed at bleak's `device '<path>' not found` string
                # on the strength of that gap and does not fire. So this is not a nicety — it is the
                # reason the previous change could not be aimed, and the precondition for aiming it.
                #
                # repr(), not str(): the class name is the part worth keeping and str() on a bare
                # BleakError can be empty. Truncated — a D-Bus error can carry a long payload and this
                # line runs up to 12 times per ladder.
                log.info("%s clock auto-sync busy (%s) — retry %d/12: %s",
                         name, type(e).__name__, attempt + 1, repr(e)[:160])
                # THE BUDGET — the bound that does not depend on classifying the error correctly.
                # Every attempt above runs through `polar_offline_op`, which holds the GLOBAL
                # `_CONNECT_LOCK`, so the ladder's real cost is measured in lock-seconds, not in tries.
                spent = _time.monotonic() - started
                if spent >= _CLOCK_SYNC_LADDER_BUDGET_S:
                    log.info("%s clock auto-sync gave up after %.0fs of a %.0fs budget (attempt %d/12) — "
                             "the reconnect loop will re-trigger it", name, spent,
                             _CLOCK_SYNC_LADDER_BUDGET_S, attempt + 1)
                    return False
                await asyncio.sleep(min(5 * (attempt + 1), 30))
                continue
            log.warning("%s clock auto-sync failed: %r", name, e)
            return False
    log.warning("%s clock auto-sync gave up — device stayed unreachable/busy", name)
    return False


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
        # NOT max(active) — THE LEXICALLY-NEWEST ACTIVE FOLDER CAN HOLD NO DATA. active_nights returns a
        # SET precisely because a cross-midnight session leaves TWO folders active (its own docstring
        # says so), and at 00:00 the LINK/CLOCK sidecars roll into a fresh date dir while every sensor
        # keeps appending to the session's START-date folder. That decoy is active and lexically newer,
        # so `max()` picked it on 2026-07-28 and QC judged two sidecars — reporting nine missing streams
        # against 942 MB of healthy recording, on what was in fact an ordinary night. This misfires on
        # EVERY session that crosses midnight, which is every normal night.
        #
        # So rank by where the DATA is: the active folder whose newest capture file is newest. Sidecars
        # are the box talking about itself and never break the tie. Falls back to the old lexical rule
        # only when no active folder holds any capture file at all — there is then no data anywhere to
        # prefer, and the newest name is as good an answer as exists.
        by_data = [(nightqc.newest_data_mtime(os.path.join(captures, n)), n) for n in active]
        withdata = [(m, n) for m, n in by_data if m is not None]
        if withdata:
            return max(withdata)[1]
        return max(active)
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


async def _enter_sdk_mode(ctrl, name: str) -> bool | None:
    """Ask the device into SDK mode, then ASK IT WHETHER IT IS. Returns what the DEVICE said:
    `True` on, `False` off, **`None` it did not say** — never what we intended.

    ⚠️ THE ACK IS NOT THE STATE, and this is the exact shape that has burned this project twice: the
    Verity accepts `SET_LOCAL_TIME`, echoes it back verbatim, and goes on stamping samples from a
    different clock (`POLAR-PMD-COMMAND-SURFACE` §2.1); `tepna-clock.sh` reported success while
    changing nothing. So the START ack is only logged, and the verdict comes from a separate status
    read. If that read says nothing, the answer is `None` and the caller publishes "unknown" — because
    the whole cost of getting this wrong is a night captured at 55 Hz under a config that says 176,
    with every card green.

    `already_in_state`/`already_streaming` on the START is SUCCESS: the device is in SDK mode, which is
    all that was being asked for. And `invalid_state` (0x0C) is the one refusal worth a WARNING — it
    means a stream was still running, and it is a member of `TRANSIENT_STATUS`, so a caller that only
    consults `is_transient` files it as "retry later" and never notices the rate it did not get."""
    ack = await ctrl(pmd.sdk_mode_cmd(True))
    st = ack[3] if len(ack) >= 4 else pmd.NO_ACK
    if st == pmd.INVALID_STATE:
        log.warning("%s SDK mode refused with invalid_state — a stream was still running, so the "
                    "device stays on its NORMAL rate menu (PPG 55 Hz, not 176)", name)
    elif not (pmd.is_started(st) or st == pmd.ALREADY_STREAMING):
        log.warning("%s SDK mode START → %s", name, pmd.CTRL_STATUS.get(st, hex(st)))
    on = pmd.parse_sdk_mode_status(await ctrl(pmd.sdk_mode_status_cmd()))
    if on is None:
        log.warning("%s SDK mode: the device did not report its mode — treating as UNKNOWN, not off; "
                    "the rates it offers next are the only thing that says what it actually did", name)
    else:
        log.info("%s SDK mode: %s", name, "on" if on else "OFF (the extended rate menu is unavailable)")
    return on


async def _exit_sdk_mode(ctrl, name: str) -> bool | None:
    """Ask the device OUT of SDK mode, then ASK IT WHETHER IT IS. Same contract as `_enter_sdk_mode`:
    returns what the DEVICE said — `True` still on, `False` off, `None` it did not say.

    ⚠️ WITHOUT THIS, THE SWITCH IS ONE-WAY. SDK mode is DEVICE state that persists until a power cycle;
    turning the config flag off only stopped us re-entering it, so the device stayed in SDK mode
    indefinitely. That is not a cosmetic asymmetry, because on a Verity Sense SDK mode DISABLES two
    streams outright — Polar's own product doc: "PPI online stream or offline recording is not
    supported in SDK MODE", likewise HR. Measured 2026-08-10: PPI last started at 11:37, then answered
    `invalid_state` on every attempt for the rest of the day and the whole night, and the night's QC
    recorded `Polar Verity Sense:hr` and 0 PPI rows. Switching SDK mode off changed nothing; only
    power-cycling the armband by hand brought them back.

    So `off` must mean OFF. The exit is issued with streams stopped, for the same reason the entry is
    (the device refuses the transition otherwise), and the verdict comes from a status read rather than
    the ack — an ack is "accepted", which this file already learned the hard way for the clock."""
    ack = await ctrl(pmd.sdk_mode_cmd(False))
    st = ack[3] if len(ack) >= 4 else pmd.NO_ACK
    if not (pmd.is_started(st) or st == pmd.ALREADY_STREAMING):
        log.warning("%s SDK mode STOP → %s", name, pmd.CTRL_STATUS.get(st, hex(st)))
    on = pmd.parse_sdk_mode_status(await ctrl(pmd.sdk_mode_status_cmd()))
    if on is None:
        log.warning("%s SDK mode: the device did not report its mode after the exit — UNKNOWN, not "
                    "off; PPI and HR stay unavailable while it is still in SDK mode", name)
    elif on:
        log.warning("%s SDK mode: STILL ON after an exit request — PPI and HR remain unavailable; a "
                    "power cycle clears it", name)
    else:
        log.info("%s SDK mode: off (PPI and HR are available again)", name)
    return on


# ⚠️ THE 45-MINUTE FLAT-BATTERY CLOCK MUST OUTLIVE THE CONNECTION, and it did not.
#
# `full_battery_implies_charging` needs 2700 s of a battery not moving at 100 %. That timer used to be a
# local inside `run_polar`'s `async with _connect(...)` block — i.e. INSIDE the reconnect loop — so every
# dropped link reset it to None and restarted the count.
#
# The condition it was written for is a device sitting in a dock. A device sitting in a dock is ALSO a
# device that keeps dropping its link: measured 2026-08-15, the Verity reconnected at 10:03, 10:10, 10:15
# and 10:20 — gaps of 6.7, 4.9 and 5.0 min — while streaming noise at 176 Hz with battery pinned at 100
# and `charging` False throughout. The guard is correct, is wired, and could never fire, because 45 min of
# UNINTERRUPTED connection is exactly what the scenario denies it.
#
# `prev` (the battery level it compares against) was already read from module-level STATUS and so already
# survived reconnects. Only the clock did not, which is why the asymmetry was invisible: half the rule
# persisted and half of it reset.
_BATT_FLAT_SINCE: dict[str, float] = {}


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
    # Bond BEFORE any PMD attempt — the H10 drops an un-authenticated link ~1-2 s after connect
    # (bleak #1943). ensure_bonded is a no-op if the bond already exists.
    # This ran ONCE, on the assumption noted here for a year — "reconnects after a transient drop reuse
    # the stored bond, so we don't re-bond in the loop". That assumption fails exactly when it matters.
    # On 2026-07-29 the H10's bond went STALE; `ensure_bonded`'s re-pair removed it and could not
    # re-establish it, leaving BlueZ at `Paired: no`. Nothing ever tried again, so the task spent 4.5 h
    # connecting and being torn down every ~70 s with NO PATH TO RECOVERY, and 4.5 h of ECG was lost.
    # `maybe_rebond` below now re-checks inside the loop, so a lost bond is a recoverable state.
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
    # Sync the device clock BEFORE the PMD link is established. Polar stamps every sample with device
    # time, and an H10 resets to its 2019 firmware default whenever it leaves the strap — so without
    # this `sensor timestamp [ns]` is meaningless and siblings share no origin.
    # It must happen here, not inside the connected session: the PS-FTP client needs the device's single
    # BLE link, and polar_offline_op waits for run_polar to release it (calling it from inside would
    # deadlock — run_polar would be awaiting a pause only run_polar can grant).
    # PS-FTP is POLAR-SPECIFIC. On anything else the sync cannot succeed — it fails on a missing
    # characteristic — and it costs a global capture pause to find that out, every task start.
    # This is the FIRST sync; `clock_sync_due` repeats it on every later reconnect (see the loop below).
    if is_polar and (_CFG.get("time") or {}).get("auto_sync_devices", True):
        await auto_sync_clock(name, addr)
    first_attempt = True
    iteration = 0
    rebond_attempts = 0
    while not _STOP.is_set():
        iteration += 1
        if addr in _POLAR_PAUSED or _RECOVER.is_set():   # a pull owns the link, or the watchdog is resetting the adapter
            _set(name, connected=False,
                 last_error="paused — pulling offline recording" if addr in _POLAR_PAUSED else "adapter recovering")
            while (addr in _POLAR_PAUSED or _RECOVER.is_set()) and not _STOP.is_set():
                await asyncio.sleep(0.3)
            continue
        # RE-SYNC ON RECONNECT. Must be here — before `_connect` — because the PS-FTP write needs the
        # device's single BLE link (see the first-sync comment above). Skipped while the device is on
        # its charger: a docked Polar cannot take the write, so trying only burns the watchdog's
        # give-up budget. Coming off the dock IS a reconnect, so the sync lands then.
        if clock_sync_due(is_polar, (_CFG.get("time") or {}).get("auto_sync_devices", True),
                          STATUS["devices"].get(name, {}).get("charging"), first_attempt):
            await auto_sync_clock(name, addr)
        first_attempt = False
        # RE-BOND A LOST BOND. Also before `_connect`, and for the same reason the clock write is: the
        # pairing needs the device's own link. Without this a bond that goes stale mid-session is
        # terminal — the task reconnects forever and is torn down every time, which is exactly how
        # 2026-07-29 lost 4.5 h of ECG while reporting "reconnected" four times.
        # The CHEAP conditions gate the EXPENSIVE one. `is_bonded` shells out to bluetoothctl, so asking
        # it on every ~70 s reconnect would spend a subprocess per cycle on a device that is almost
        # always fine — the very cost `rebond_due`'s cadence exists to avoid. Arithmetic settles it
        # first; the predicate then re-checks everything so it stays independently meaningful.
        if (is_polar and needs_pmd and _REBOND_EVERY > 0
                and iteration % _REBOND_EVERY == 0 and rebond_attempts < _REBOND_LIMIT):
            try:
                if rebond_due(needs_pmd, await bonding.is_bonded(addr, ADAPTER), iteration,
                              rebond_attempts, _REBOND_EVERY, _REBOND_LIMIT):
                    rebond_attempts += 1
                    log.warning("%s: BlueZ reports no bond — re-pairing (attempt %d/%d)",
                                name, rebond_attempts, _REBOND_LIMIT)
                    if await bonding.ensure_bonded(addr, ADAPTER, force=True):
                        log.info("%s: re-bonded — PMD should hold again", name)
                        rebond_attempts = 0        # it took; a LATER loss gets the full budget again
                    else:
                        _set(name, last_error="bond lost — re-pairing failed; pair from the monitor page")
            except Exception as e:                 # bonding must never take the capture task down
                log.debug("%s: re-bond check failed: %r", name, e)
        writers: dict[int, StreamWriter] = {}
        stream_fs: dict[int, float] = {}   # actual negotiated sample rate per meas (ACC differs per device)
        stream_scale: dict[int, float] = {}   # raw-int → physical-unit factor per meas (GYRO dps / MAG gauss)
        prev_ns: dict[int, int] = {}       # previous frame's device timestamp per meas — lets decode_frame
                                           # back-time off the device's own clock instead of the nominal
                                           # rate. Per-connection scope: a reconnect must NOT carry a stale
                                           # seam across the gap (the guard would reject it anyway).
        hr_writer = None
        # Declared out here, not inside the connect block, so the `finally` can close it even when the
        # session dies before a single packet lands — the same reason hr_writer lives here.
        arr_wr = None
        started = _now()
        ndir = night_dir(root, started)
        # ── CAPTURE-FILESET-RESUME §2 — reuse the set when the gap is small ─────────────────
        # One decision at the single point every filename derives from: if THIS device's newest set
        # in tonight's dir wrote within `write.resume_window_sec` (default 300), adopt its stamp —
        # every capture_filename() below regenerates the identical names and every writer opens in
        # append mode. A true outage (>= window) keeps fragmenting, deliberately: that fragmentation
        # is information (the 37/75-minute wedges must stay visible). The dominant collapsed case is
        # the drop_not_worn duty cycle (drop 180 s, recheck 90 s — measured 2,154 sets across 76
        # device-nights, 28.3x). `link_epoch` still increments per reconnect (E5): resume changes
        # where SAMPLES land, never what the LINK sidecar records.
        _rw = _RESUME_WINDOW_S
        if _rw > 0:
            _prev = resumable_stamp(ndir, dev["vendor"], dev["model"], dev["device_id"], started, _rw)
            if _prev is not None:
                log.info("%s: resuming file-set %s (gap < %.0fs)",
                         dev.get("name") or dev["address"], f"{_prev:%Y%m%d%H%M%S}", _rw)
                started = _prev
        charging_hold = False              # device refused PMD because it is on the charger (status 0x0D).
        drop_for_power = False             # not-worn long enough that we dropped the link to save battery
        stalled = False                    # started streams went silent behind a live link — re-negotiate
        # Declared HERE, outside the try, because both readers live outside the block that sets it: the
        # link-hold loop and the reconnect-delay below. (It was first declared next to `stream_fs` inside
        # the connected session — an UnboundLocalError on every device that never reached the PMD path.)
        try:
            _set(name, connected=False, address=addr, last_error=None)
            async with _connect(addr) as client:
                _set(name, connected=True); _OPT_QUIET.discard(addr)
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
                # PACKET-ARRIVAL SIDECAR (PAT-PACKET-ARRIVAL). The per-sample `phone` stamps this
                # session writes are BACK-TIMED across each packet from one arrival, so the inter-device
                # offset cannot be recovered from them: the minimum of (host - device) has no floor,
                # only a smear the width of the packet. Measured, that minimum sits 27-115 ms below the
                # 1st percentile — an outlier, not an edge. This records the TRUE arrival instant beside
                # the device timestamp of the packet's first sample, which is the one pairing that makes
                # the per-connection offset measurable. Opened per session, alongside the stream files.
                arr_wr = PmdArrivalLogWriter(
                    os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"],
                                                        started, "pmdarrival", "csv")))
                meas_of = {"ecg": pmd.ECG, "acc": pmd.ACC, "ppg": pmd.PPG,
                           "gyro": pmd.GYRO, "mag": pmd.MAG, "ppi": pmd.PPI}

                def _register(meas: int, fs_val: float) -> None:
                    base, unit, ch, labs = _LIVE_META[pmd.MEAS_NAME[meas]]
                    BUS.register(_live_key(pmd.MEAS_NAME[meas], tag), f"{base} ({name})", unit, fs_val, ch, labs)

                for s in streams:
                    if s in meas_of:
                        writers[meas_of[s]] = w(s)
                        # RATE UNKNOWN UNTIL NEGOTIATED — 0, not the vendor default (2026-08-05).
                        # This registered `pmd.SAMPLE_HZ[meas]`, which is the rate the hardware ships at,
                        # NOT the rate this box asks for: PROJECT_HZ picks ACC 50 and MAG 20, and a
                        # config may narrow further (vigil runs ACC 25 / MAG 10). So between START and
                        # the re-register at the `used_fs` line below, every stream carried a nominal it
                        # had never agreed to — and `telemetry.stream_health` judges WEAK as
                        # `eff_fs < 0.7 * nominal_fs`. ACC delivering its negotiated 25 Hz against a
                        # declared 200 scores 0.125 and paints amber; MAG's measured 10.28 Hz against a
                        # declared 50 scores 0.21. Neither is a weak link — it is division by a number
                        # nobody chose, and it re-fires on every reconnect (link_epoch reached 5 and 6 on
                        # the night of 2026-08-04 alone).
                        # 0 means "irregular / rate unknown" and already routes stream_health to the
                        # silence-only branch — the same honesty PPI has always used. A rate we have not
                        # agreed is not a rate to be judged against; see §2.6's rule for stamps.
                        _register(meas_of[s], 0)
                if "hr" in streams:
                    hr_writer = w("hr")
                    BUS.register(_live_key("hr", tag), f"RR ({name})", "ms", 0)
                    # The strap sends HR (bpm) alongside the RR intervals and we already write both to
                    # the file — but only RR was ever pushed to the monitor, so the device's own HR had
                    # no card at all. Both are real: RR is the HRV substrate, HR is the device's reading.
                    BUS.register(_live_key("bpm", tag), f"HR ({name})", "bpm", 0)

                # ── optical-wear state, per connection ──────────────────────────────────────────
                # `_amb` accumulates the PPG ambient channel; `_AMB_WINDOW` is ~4 s at 55 Hz, long
                # enough that a hand passing over the sensor cannot flip the verdict and short enough
                # that taking the armband off is noticed within the 180 s power grace.
                # `_has_contact_bit` starts False and is raised by the HR handler the first time the
                # strap reports real contact — a DIRECT measurement always outranks this inference, so
                # the optical path stands down permanently for straps that have one (the H10 reports
                # None and never raises it; the COOSPO does).
                _amb: list[float] = []
                # A ROLLING window, not a per-verdict batch like `_amb`. The pulse detector needs 4096
                # samples for frequency resolution — ~23 s at 176 Hz, ~74 s at 55 Hz — while the ambient
                # verdict fires every ~220. Clearing this on each verdict would keep it permanently below
                # its minimum and it would abstain forever: an orphan detector that looks wired.
                _ppg_win: list[float] = []
                _PPG_WIN_MAX = 8192
                _AMB_WINDOW = 220
                _has_contact_bit = False
                # When the battery level last CHANGED. A full cell cannot rise, so at 100 % the
                # rising-charge rule in `_read_batt` is blind and flatness is the only substitute
                # signal — see telemetry.full_battery_implies_charging.
                # Say the contact-vs-optics conflict ONCE per session, not once per PPG window.
                # At 176 Hz this branch runs ~every 1.25 s; an unthrottled warning would emit
                # ~2900 identical lines a night and bury the one that matters.
                _worn_conflict_said = False

                def _publish_worn(worn: bool | None, why: str) -> None:
                    """One publish path for every source of `worn`, so the power bookkeeping cannot
                    diverge between them. The `_WORN_SINCE` handling mirrors the HR branch exactly: set
                    ONCE on the first not-worn and left alone, because `should_drop_not_worn` measures
                    CONTINUOUS not-worn time and restarting the clock each window means the grace never
                    elapses and the drop never fires.

                    ⚠️ `None` IS PUBLISHED, NOT SKIPPED, AND THAT IS WHY THIS TAKES `bool | None`.
                    The previous signature was `bool` and the caller simply did not call it when the
                    detector abstained. But `_set` only ever UPDATES, so declining to publish leaves the
                    LAST verdict standing for as long as the process lives. Measured 2026-08-13: the
                    176 Hz domain refusal fired correctly on every negotiation, nothing cleared `worn`,
                    and the card read `worn: True` for ten hours while the armband streamed 496 MB into
                    a desk. An abstention that cannot be seen is worse than a wrong answer, because a
                    wrong answer can at least be contradicted.

                    `None` also CLEARS any running not-worn clock: a grace period started under one
                    detector must not keep counting once that detector has stopped speaking, or a
                    device gets dropped on evidence nothing is still asserting."""
                    _set(name, worn=worn, worn_why=why,
                         last_error=None if worn is not False else why)
                    if worn is not False:
                        _WORN_SINCE.pop(addr, None)
                    elif addr not in _WORN_SINCE:
                        _WORN_SINCE[addr] = _time.monotonic()

                # PMD data handler — one char carries all PMD streams; route by measurement type.
                def on_pmd(_sender, data: bytearray):
                    nonlocal _worn_conflict_said
                    arrival = _now()
                    try:
                        meas, samples = pmd.decode_frame(bytes(data), arrival, fs=stream_fs.get(data[0]),
                                                         prev_last_ns=prev_ns.get(data[0]),
                                                         scale=stream_scale.get(data[0]))
                    except Exception as e:   # a truncated/empty frame raises IndexError/struct.error, not
                        _set(name, last_error=str(e)); return   # only ValueError — a decoder must never disturb the callback
                    if samples:
                        prev_ns[meas] = samples[-1].sensor_ns   # seam anchor for the next frame's step
                        # THE TRUE ARRIVAL, paired with the device stamp of this packet's FIRST sample.
                        # Written before the `writers.get(meas)` gate below on purpose: a stream with no
                        # writer still carries a usable arrival↔device pair, and the offset is a property
                        # of the LINK, not of whichever streams happen to be enabled.
                        # No `is not None` guard: `arr_wr` is assigned before this callback is even
                        # DEFINED, and the callback cannot fire before `start_notify` later still, so the
                        # false arm is unreachable — it showed up as the one partial branch under
                        # `--cov-branch` and a test for it could only have been a lie. The try/except is
                        # the real guard, and it is the one that matters.
                        try:
                            arr_wr.write(arrival, name, pmd.MEAS_NAME.get(meas, meas),
                                         samples[0].sensor_ns, samples[-1].sensor_ns, len(samples))
                        except Exception:   # telemetry must never disturb the data callback
                            pass
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
                        # `arrival_rows` rides along here because the arrival write above is wrapped in a
                        # bare `except: pass` — correct, since telemetry must never disturb the data
                        # callback, but it makes a PERSISTENT writer failure invisible: a dead sidecar
                        # would look exactly like a quiet night. A count that stops advancing while
                        # samples keep arriving is the tell, and it costs one field.
                        _set(name, device_time=dev_dt.isoformat(timespec="seconds"),
                             arrival_rows=(arr_wr.rows if arr_wr is not None else None),
                             clock_skew_sec=round((dev_dt - _utcnow()).total_seconds(), 2))
                    except Exception:  # pragma: no cover — sensor_ns is an unsigned 64-bit int, so
                        pass           # _POLAR_EPOCH + timedelta(µs=ns/1000) is bounded far inside
                                       # datetime's range and cannot raise; the guard is belt-and-braces.
                    # Per-FRAME, not per-connection: the contact bit is whatever this frame carried.
                    # (Declared here rather than in the enclosing scope precisely so it cannot go stale
                    # — a verdict from a frame two minutes ago is not a verdict about now.)
                    _ppi_contact: bool | None = None
                    # The RAW flag byte as well as the decoded verdict: `worn_verdict` re-decodes it so
                    # the combiner owns the "is this bit even supported" rule rather than inheriting an
                    # already-collapsed answer. Keeping both costs nothing and keeps one decoder.
                    _ppi_flags = None
                    for smp in samples:
                        v = smp.values
                        if meas == pmd.ECG:    wr.write_ecg(smp.phone, smp.sensor_ns, smp.t_ms, v[0])
                        elif meas == pmd.ACC:  wr.write_acc(smp.phone, smp.sensor_ns, smp.t_ms, *v)
                        elif meas == pmd.PPG:
                            wr.write_ppg(smp.phone, smp.sensor_ns, smp.t_ms, v[:3], v[3])
                            _amb.append(v[3])
                            _ppg_win.append(v[0])
                            # branchless trim: a negative-slice delete is a NO-OP while the window is
                            # shorter than the cap (`x[:-8192]` is empty for len < 8192), so there is no
                            # rarely-taken arm to leave uncovered — the guard and the trim are one line.
                            del _ppg_win[:-_PPG_WIN_MAX]
                        elif meas == pmd.GYRO: wr.write_gyro(smp.phone, smp.sensor_ns, smp.t_ms, *v)
                        elif meas == pmd.MAG:  wr.write_mag(smp.phone, smp.sensor_ns, smp.t_ms, *v)
                        elif meas == pmd.PPI:   # pragma: no branch — PPI is the last of the six
                            # types decode_frame can return (ECG/ACC/PPG/GYRO/MAG/PPI), and every other
                            # arm above matches first, so the FALSE edge here is unreachable by
                            # construction. Same reasoning, same pragma, as the sibling chain below.
                            wr.write_ppi(smp.phone, smp.sensor_ns, v[0], v[1], v[2], v[3])
                            # The device's OWN contact bit, from the stream that actually carries one.
                            _ppi_contact = ppi_contact(v[3])
                            _ppi_flags = v[3]
                    # ── WORN, FROM THE OPTICAL SIGNAL (telemetry.optical_worn) ──────────────────
                    # A device that declares no skin-contact bit never gets a `worn` verdict from the
                    # HR path — the Verity says `contact_supported: false` and emits 1 Hz of 0000
                    # forever. So `power.drop_not_worn_sec` can never fire for it and
                    # `cpap_harvest.blocking_devices` counts it as streaming, because both read
                    # `worn is not False`. Measured 2026-08-10: the armband streamed 3 h and 42.5 MB
                    # into a desk at a flawless 55.0 Hz with every card green and battery 100 %→74 %.
                    #
                    # Published on the SAME `worn` key the contact bit uses, so the power drop, the
                    # CPAP interlock and the monitor all work unchanged — only the SOURCE is new. The
                    # `_WORN_SINCE` bookkeeping below is a byte-for-byte mirror of the HR branch, for
                    # the same reason it exists there: the grace clock must survive duty-cycle
                    # reconnects or each probe restarts it and the drop never happens.
                    #
                    # ⚠️ ONLY when the device offers no contact bit. A strap that DOES report contact
                    # keeps that verdict — it is a direct measurement, and this is an inference.
                    # ── PPI CONTACT OUTRANKS THE OPTICAL INFERENCE ──────────────────────────────
                    # The Verity answers "is it on skin" twice and differently: its HR characteristic
                    # says `contact_supported: false`, its PPI stream sets skinContactSupported and
                    # reports the real thing (desk 0/31877, worn 1/20957 — telemetry.ppi_contact). A
                    # measurement beats an inference, so when PPI is a configured stream it decides and
                    # the ambient heuristic never runs.
                    # ⚠️ THE OPTICAL BRANCH NOW RUNS EVEN WHEN A CONTACT BIT EXISTS — but it does NOT
                    # take the verdict away from it. The two are different jobs and conflating them
                    # cost ten hours on 2026-08-13: `_has_contact_bit` suppressed this branch entirely,
                    # so a Verity on a desk reported `worn: True` from its HR contact bit, published no
                    # `worn_why`, and NOTHING computed a second opinion that could have contradicted it.
                    # The defect was not that the contact bit won. It was that nobody else spoke.
                    #
                    # The precedence is deliberately UNCHANGED, because the disagreement is not
                    # resolvable from these two signals: "contact says worn, optics say not" describes
                    # BOTH an armband on a desk AND one worn over a sleeve in bright sun. The costs are
                    # not symmetric — a false not-worn drops a live link and loses a night, a false worn
                    # loses a charge — so the contact bit keeps the decision and the optical result is
                    # published beside it as `worn_optical`, with a WARNING when they differ. Making the
                    # conflict visible is the fix; arbitrating it from two sources that cannot settle it
                    # would be a guess wearing a verdict's clothes.
                    if (_ppi_contact is not None or len(_amb) >= _AMB_WINDOW):
                        # ONE COMBINER, EVERY DETECTOR — telemetry.worn_verdict. Previously this branch
                        # ran exactly one heuristic (ambient LEVEL) with exactly one calibration domain
                        # (55 Hz), so at 176 Hz there was no verdict at all and, worse, no way to tell:
                        # the abstention was silent and the previous value stood.
                        #
                        # PASS THE NEGOTIATED RATE, or every domain check is inert. The level detector
                        # is calibrated at 55 Hz and the stability detector at 176 Hz — the two ambient
                        # regimes are opposite (worn is DARK at 55 Hz, worn is PEGGED-AND-QUIET at 176),
                        # which is why they are separate detectors and not one widened threshold.
                        # `stream_fs` is what the device actually AGREED to, not what the config asked
                        # for, and only the agreed number describes these samples.
                        _worn, _why = worn_verdict(
                            ppi_flags=_ppi_flags, ambient=list(_amb), fs=stream_fs.get(pmd.PPG),
                            charging=STATUS["devices"].get(name, {}).get("charging"),
                            ppg=list(_ppg_win))
                        _amb.clear()
                        if _has_contact_bit:
                            # A contact bit owns `worn`. Publish the optical opinion ALONGSIDE it and
                            # say so when they disagree — that log line is the whole point of running
                            # this branch at all, and it is what was missing while an armband streamed
                            # 496 MB into a desk under a confident `worn: True`.
                            _set(name, worn_optical=_worn, worn_optical_why=_why)
                            _stated = STATUS["devices"].get(name, {}).get("worn")
                            if _worn is not None and _stated is not None and _worn != _stated:
                                if not _worn_conflict_said:
                                    log.warning(
                                        "%s: the contact bit says worn=%s but the optical detector says "
                                        "%s (%s). The contact bit KEEPS the decision — it fails toward a "
                                        "false WORN, and a wrong not-worn would drop a live link — but "
                                        "if this device is on a desk, that is why nothing dropped it.",
                                        name, _stated, _worn, _why)
                                    _worn_conflict_said = True
                        else:
                            # Published unconditionally, INCLUDING None. See _publish_worn: skipping the
                            # publish is what let a stale `True` survive ten hours of desk streaming.
                            _publish_worn(_worn, _why)
                    # Live push — RAW, per-stream shape (no on-box DSP):
                    key, hz = _live_key(pmd.MEAS_NAME[meas], tag), stream_fs.get(meas) or pmd.SAMPLE_HZ.get(meas)
                    # The frame's LAST sample on the DEVICE's own counter. `effFs` is measured off this
                    # rather than off arrival times (DEVICE-RATE-TRUTH §6.3): BLE hands several frames
                    # over in one connection event, so their arrival times collapse together and an
                    # arrival-time denominator reports the radio's batching, not the sensor's rate.
                    # Waveform streams only — PPI is per-beat by construction (`SAMPLE_HZ[PPI] = 0`),
                    # so it has no rate to measure and is judged on silence alone.
                    dev_ns = samples[-1].sensor_ns
                    if meas == pmd.ECG:
                        BUS.push(key, [s.values[0] for s in samples], hz, dev_ns=dev_ns)
                    elif meas in (pmd.PPG, pmd.ACC, pmd.GYRO, pmd.MAG):
                        BUS.push(key, [list(s.values) for s in samples], hz, dev_ns=dev_ns)  # multi-channel
                    # No `else`: this chain is EXHAUSTIVE over pmd.MEAS_NAME (ecg · ppg · acc · gyro ·
                    # mag · ppi), and a meas outside it cannot reach here — `writers` is keyed by those
                    # six, so an unknown one already returned at the `not wr` guard above, and the
                    # MEAS_NAME[meas] lookup one line up would have raised before this.
                    elif meas == pmd.PPI:   # pragma: no branch
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
                        nonlocal _has_contact_bit
                        _has_contact_bit = True      # a direct measurement outranks the optical inference
                        # ⚠️ THROUGH THE COMBINER AND THE ONE PUBLISH PATH — not `_set` directly.
                        #
                        # This branch used to write `worn=contact` straight through, bypassing BOTH
                        # abstractions whose own docstrings call themselves the single path:
                        # `worn_verdict` ("ONE COMBINER, EVERY DETECTOR") and `_publish_worn` ("one
                        # publish path for every source of `worn`, so the power bookkeeping cannot
                        # diverge between them"). The cost was not theoretical. The charging veto lives
                        # in the combiner, so on a device that HAS a contact bit it could never fire:
                        # the Verity streamed 3 h 24 m at 176 Hz into its charging dock on 2026-08-14
                        # (~190 MB, battery pinned at 100 %, `charging: True` published correctly right
                        # beside a confident `worn: True`), because the bit reports skin contact in a
                        # dock and nothing downstream was permitted to disagree with it.
                        #
                        # It also duplicated the `_WORN_SINCE` bookkeeping, so the drop timer keyed off
                        # the RAW bit rather than the verdict — meaning the 180 s not-worn drop could
                        # not accumulate no matter what any other detector concluded.
                        _publish_worn(*worn_verdict(
                            contact=contact,
                            charging=STATUS["devices"].get(name, {}).get("charging")))
                    if rr:                        # raw RR intervals to the monitor (no HRV computed on-box)
                        BUS.push(_live_key("hr", tag), [float(x) for x in rr], 0)
                    if bpm:
                        BUS.push(_live_key("bpm", tag), [float(bpm)], 0)

                if hr_writer:
                    # BOUNDED like every other post-connect GATT await — see the block comment on
                    # _read_batt below for the 4h25m freeze a bare one cost.
                    await _bounded_setup(client.start_notify(HR_UUID, on_hr))

                # Battery level via the standard Battery Service (0x2A19). Polar H10 + Verity both expose
                # it; read once now and refresh every ~2 min. Silent no-op if a firmware lacks the char.
                async def _read_batt():
                    try:
                        # THE 2026-07-25 FREEZE. This read sits between the last successful PMD
                        # START and the hold loop that owns the stall watchdog, and it was
                        # unbounded. On a link BlueZ never fails it simply never returned: the
                        # Verity logged four streams `-> ok` at 23:51:23 and then nothing at all
                        # until 04:16:01 — link up the whole time (680 of 682 poll samples
                        # connected), zero bytes, and no stall warning, because the watchdog is
                        # DOWNSTREAM of the thing that was stuck. QC logged `missing stream(s)`
                        # twice and nothing consumed it.
                        # The enclosing try/except makes a timeout here a SKIP, which is right:
                        # battery level is cosmetic and must never cost a session.
                        b = await _bounded_setup(client.read_gatt_char(BATTERY_UUID))
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
                            # AT FULL, FLATNESS REPLACES RISING. The rule above cannot fire at 100 %
                            # — there is nowhere to rise to — so a device docked while full reported
                            # charging=False indefinitely. Measured 2026-08-14: 80 min of 176 Hz
                            # streaming with battery pinned at 100 and nothing able to tell a dock
                            # from a wrist. Streaming drains ~9 %/h, so 45 min of no movement at full
                            # is a charger.
                            # store is module-level, so a reconnect does not restart the clock
                            if note_flat_battery(_BATT_FLAT_SINCE, name, prev, lvl,
                                                 _time.monotonic()):
                                _set(name, charging=True)
                    except Exception:
                        pass
                if writers:
                    # Log which PMD measurement types the device actually supports (feature bitmask).
                    try:
                        feat = pmd.parse_features(
                            bytes(await _bounded_setup(client.read_gatt_char(pmd.PMD_CONTROL))))
                        names = sorted(pmd.MEAS_NAME.get(t, hex(t)) for t in feat)
                        log.info("%s PMD supports: %s", name, " ".join(names))
                        _set(name, pmd_supported=names)
                    except Exception as e:
                        log.info("%s feature read skipped: %r", name, e)

                    # Control-point responses (settings + START acks) arrive as indications; queue them.
                    ctrl_q: asyncio.Queue = asyncio.Queue()

                    def _on_ctrl(_s, d) -> None:
                        """Split the control characteristic's two traffic classes at the door.

                        Everything used to go straight onto `ctrl_q`, so an unsolicited
                        ONLINE_MEASUREMENT_STOPPED (0x01, NOT 0xF0) landing between a write and its
                        indication was returned as that command's response — and the real response was
                        then discarded by the next `_ctrl`'s drain, leaving every later command paired
                        with the previous one's answer until the queue happened to empty.

                        The push is also the only notice the DEVICE gives that a stream ended on its
                        side (charger, battery, mode change, button). Logged at WARNING because it means
                        capture has silently stopped for that type while the link stays up — which is
                        exactly the state the stall watchdog otherwise has to infer from silence."""
                        b = bytes(d)
                        stopped = pmd.stopped_measurements(b)
                        if stopped is not None:
                            log.warning("%s device stopped measurement(s) on its own: %s", name,
                                        ", ".join(pmd.MEAS_NAME.get(m, hex(m)) for m in stopped) or "(none named)")
                            return
                        ctrl_q.put_nowait(b)

                    try:
                        await _bounded_setup(client.start_notify(pmd.PMD_CONTROL, _on_ctrl))
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
                        # MATCH THE ANSWER TO THE QUESTION. Taking whatever arrives next assumes the only
                        # traffic on this characteristic is our own responses, in order. `_on_ctrl` above
                        # removes the device pushes; what can still be in flight is a STALE response — a
                        # previous command that timed out and then answered — and returning that as this
                        # command's verdict is how a rejected START reads as accepted. Both bytes are
                        # checked: 0xF0 marks a response, [1] echoes the opcode we asked for.
                        #
                        # A mismatch yields NO_ACK rather than a retry loop, deliberately, for two
                        # reasons. It is TRUE — we did not get our answer — and `NO_ACK` already means
                        # "ask again", never "rejected", so the stream is kept and re-negotiated rather
                        # than torn down. And a loop would need a deadline, which means reading the
                        # clock: `_ctrl` runs inside the stall machinery's patched-clock world, where a
                        # monotonic() read is not a wall-clock read at all. An earlier draft of this did
                        # exactly that and expired instantly, re-negotiating a healthy stream.
                        try:
                            got = await asyncio.wait_for(ctrl_q.get(), timeout)
                        except asyncio.TimeoutError:
                            return b""
                        if pmd.is_control_response(got) and got[1] == cmd[0]:
                            return got
                        log.debug("%s control frame answers a different command (want op %#04x, got %s)"
                                  " — treating as no ack", name, cmd[0], got[:3].hex())
                        return b""

                    await _bounded_setup(client.start_notify(pmd.PMD_DATA, on_pmd))
                    # ── CHARGING RETRY RUNS ON THE LINK WE ALREADY HOLD ─────────────────────────
                    # A Polar on its dock refuses PMD START with 0x0D in_charger, and we re-attempt on a
                    # cadence so capture resumes within a minute of it coming off. That retry used to end
                    # the session, which made every attempt a full BLE reconnect. Measured on the box
                    # 2026-07-26: the Verity on its charger reconnected every ~67 s — 17 connects in 19
                    # minutes, writing nothing. Every one of them logged as a successful INFO "connected",
                    # so no alert could see it; only link_epoch climbing 35 -> 54 gave it away. This adapter
                    # has a documented firmware wedge under load (~110 min lost on 2026-07-23), so an
                    # indefinite connect/disconnect cycle per charging device is exactly the load not worth
                    # generating.
                    #
                    # The link SURVIVES on the charger — that is why the transient branch below keeps the
                    # writers instead of tearing them down — so re-run the negotiation in place. Same
                    # cadence, same responsiveness, one connect instead of one a minute.
                    while True:
                        charging_hold = False
                        # ── SDK MODE, BEFORE ANY SETTINGS QUERY ─────────────────────────────────
                        # SDK mode changes what `get_settings_cmd` ANSWERS (PPG 55 → 28/44/55/135/176),
                        # so it must be in place before the menu is read: a menu read first and used
                        # after is stale, and the rate silently stays 55 (polar_pmd's SDK-mode note §3).
                        # It also requires every stream stopped, which is why the STOPs are issued here
                        # as a block rather than only interleaved in the per-meas loop below.
                        #
                        # Re-run on EVERY pass, not once per connect: SDK mode does not survive a power
                        # cycle, and this loop doubles as the charging retry — a device docked at
                        # bedtime and worn at 23:00 re-negotiates here with no reconnect in between.
                        if dev.get("sdk_mode"):
                            for meas in list(writers):
                                await _ctrl(pmd.stop_cmd(meas))
                            _set(name, sdk_mode=await _enter_sdk_mode(_ctrl, name))
                        elif hex(pmd.SDK_MODE) in (STATUS["devices"].get(name, {})
                                                   .get("pmd_supported") or []):
                            # OFF MUST MEAN OFF. SDK mode is device state that outlives the config: not
                            # re-entering it leaves a device that is already in it there until someone
                            # power-cycles the hardware. Ask first and act only on a `True`, so a device
                            # that was never in SDK mode costs one status read and no state change.
                            # Gated on the feature bit because a device without it (the H10) answers op
                            # 6 with `invalid_op_code`, and asking every pass would be noise.
                            if pmd.parse_sdk_mode_status(await _ctrl(pmd.sdk_mode_status_cmd())):
                                for meas in list(writers):
                                    await _ctrl(pmd.stop_cmd(meas))
                                _set(name, sdk_mode=await _exit_sdk_mode(_ctrl, name))
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
                            # ── CONFIGURED INTENT vs NEGOTIATED REALITY ─────────────────────────
                            # `chosen_rate` honours a configured rate ONLY if the device offers it and
                            # otherwise falls back — deliberately, because a rate the firmware rejects
                            # would leave a permanently idle stream. The cost of that kindness is that
                            # asking for something impossible is INDISTINGUISHABLE from getting it:
                            # `rates: {ppg: 176}` without SDK mode captured whole nights at 55 Hz with
                            # no error, no warning, and a config that still read 176. It took a
                            # file-by-file rate audit across six nights to notice (2026-08-04 → 08-09).
                            #
                            # So say it. This is the general form of that bug — it fires for any stream
                            # whose configured rate the device did not offer, not just the one that bit
                            # us. Logged once per negotiation, at WARNING, naming what was asked for,
                            # what was used, and what the device actually offered, because "176 was
                            # ignored" without the menu beside it sends the reader to the wrong file.
                            if _prefer is not None and _prefer != used_fs:
                                log.warning(
                                    "%s %s: configured rate %s Hz was NOT offered by the device — "
                                    "capturing at %s Hz instead (device offers: %s). The config still "
                                    "says %s; nothing else will tell you it did not happen.",
                                    name, pmd.MEAS_NAME.get(meas, meas), _prefer, used_fs,
                                    settings.get(0x00) or "no menu reported", _prefer)
                                _set(name, **{"rate_unmet": {
                                    **(STATUS["devices"].get(name, {}).get("rate_unmet") or {}),
                                    pmd.MEAS_NAME.get(meas, str(meas)): {"want": _prefer, "got": used_fs}}})
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
                                if (meas == pmd.PPG and not calibrated_for(used_fs)
                                        and not sd_calibrated_for(used_fs)):
                                    # SAY IT WHERE THE RATE IS DECIDED. The optical worn calibration
                                    # was measured at 55 Hz; at another rate the ambient channel does
                                    # not carry the same meaning, so no verdict is published at all.
                                    # Silence would read as "the detector is fine and the strap is on".
                                    # ⚠️ ASK BOTH DETECTORS BEFORE ANNOUNCING THERE WILL BE NO VERDICT.
                                    # This asked only the LEVEL calibration until 2026-08-13, so it
                                    # fired on every 176 Hz session — telling the operator no verdict
                                    # was coming while the STABILITY detector was publishing one. A
                                    # warning that cries wolf on the configuration the box actually
                                    # runs is worse than none: it trains the reader to skip the line
                                    # that will one day be true.
                                    log.warning("%s: PPG negotiated %s Hz, which is outside BOTH "
                                                "optical worn calibrations (level 55 Hz, stability "
                                                "176 Hz) — NO optical verdict will be published this "
                                                "session. The power drop and the CPAP interlock both "
                                                "read `worn is False`, so both stay inactive rather "
                                                "than acting on a wrong reading.", name, used_fs)
                                stream_scale[meas] = pmd.axis_scale(meas, settings)   # device-reported range/resolution
                                _register(meas, used_fs)
                                _set(name, charging=False)
                                _CHARGING.discard(name)
                            elif transient:
                                # Do NOT tear the stream down: the settings are fine, the device simply
                                # cannot serve this measurement right now. Destroying the writer here
                                # deleted the file AND unregistered the card, and since the link SURVIVES
                                # on the charger the START loop would not re-run — so the stream stayed
                                # dead even after the device came off charge, until something forced a
                                # reconnect. Keep it and let the session end so the reconnect loop retries.
                                #
                                # ⚠️ ONLY 0x0D MEANS CHARGING. `is_transient` covers 0x0C invalid_state too,
                                # and conflating them made a PER-MEASUREMENT refusal set a DEVICE-LEVEL
                                # charging flag. Measured 2026-08-02: the Verity answers `invalid_state` to
                                # PPI permanently (its PPI is unusable), PPI is negotiated LAST, and its
                                # refusal therefore overwrote the four successful `charging=False` writes
                                # from acc/gyro/mag/ppg. The box then reported "charging — PMD streams
                                # unavailable" while streaming 151k rows with a battery FALLING 96 -> 91,
                                # and — because `charging_hold` ends the session — re-negotiated the whole
                                # device every ~60 s all night, fragmenting one night into 26 files and
                                # firing the on-charger auto-pull each time. A wrong flag was not
                                # cosmetic: it cost the recording.
                                if st == pmd.IN_CHARGER:
                                    _set(name, charging=True,
                                         last_error="charging — PMD streams unavailable until off the charger")
                                    _CHARGING.add(name)
                                    charging_hold = True
                                else:
                                    # A measurement this device will not serve. Say so against the STREAM,
                                    # leave the device's charging state alone, and do NOT hold the session:
                                    # ending it would re-negotiate every other stream on a device that is
                                    # otherwise perfectly healthy.
                                    log.info("%s %s unavailable (%s) — leaving the other streams up",
                                             name, pmd.MEAS_NAME.get(meas, meas),
                                             pmd.CTRL_STATUS.get(st, hex(st)))
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
                                # discard(), not `os.remove(wr.path)` — the writer knows every file it
                                # owns and `path` names only the primary (CAPTURE-HOST-DEEP-AUDIT §C8).
                                writers[meas].discard()
                                del writers[meas]
                                BUS.unregister(_live_key(pmd.MEAS_NAME.get(meas, str(meas)), tag))
                            await asyncio.sleep(0.2)
                        if not charging_hold:
                            break
                        # Give the link up the moment anything else wants it — above all an offline pull,
                        # which fails with org.bluez.Error.InProgress if we are still holding it. Ticking
                        # instead of one long sleep is what makes that release prompt; the outer loop's
                        # charging branch then owns the retry exactly as it did before.
                        _waited = 0.0
                        while _waited < CHARGE_RETRY_S:
                            if not charging_retry_in_place(client.is_connected, _STOP.is_set(),
                                                           addr in _POLAR_PAUSED, _RECOVER.is_set()):
                                break
                            await asyncio.sleep(1)
                            _waited += 1
                        if not charging_retry_in_place(client.is_connected, _STOP.is_set(),
                                                       addr in _POLAR_PAUSED, _RECOVER.is_set()):
                            break
                        # Keep the battery fresh while docked: the card shows charge progress, and the
                        # rising-battery rule in _read_batt is the only mid-session charging signal there is.
                        await _read_batt()

                # First battery read comes AFTER the PMD negotiation, deliberately. A successful
                # START sets charging=False, so reading earlier would let it clobber the
                # rising-battery inference above — the only signal a device put on charge
                # MID-SESSION ever gives us.
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
                        note_data(name, _mono)  # evidence for the alert loop that this link is EARNING its
                                              # keep. `connected` alone said yes all night while the H10
                                              # streamed nothing (alerts.device_is_recording).
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
            # An OPTIONAL backup device (config `optional: true`) is KNOWN but not expected to join — a
            # plain connect-timeout means "simply not here", so note it ONCE and stay quiet instead of a
            # warning every backoff cycle (the COOSPO spam). VIGIL: known-but-not-expected.
            if bool(dev.get("optional")):
                _set(name, connected=False, last_error="optional backup — not present")
                if addr not in _OPT_QUIET:
                    log.info("%s: optional backup device not present — keeping a quiet eye out", name)
                    _OPT_QUIET.add(addr)
                await asyncio.sleep(min(max(backoff, 120), 300)); backoff = min(backoff * 2, 300)
                continue
            _OPT_QUIET.discard(addr)
            _set(name, connected=False, last_error=repr(e))
            log.warning("%s %s", name, link_error_text(e))
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
            # discard(), never os.remove(wr.path): the writer knows every file it owns and `path` names
            # only the primary — see StreamWriter.paths (CAPTURE-HOST-DEEP-AUDIT §C8).
            if arr_wr is not None:
                arr_wr.close()
            for wr in list(writers.values()) + ([hr_writer] if hr_writer else []):
                if not wr.rows:
                    names = ", ".join(os.path.basename(p) for p in wr.paths)
                    wr.discard()
                    log.debug("%s: discarded header-only %s", name, names)
                else:
                    wr.close()
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
                        # `pkt["pr"]` passed through AS-IS, including None (CAPTURE-HOST-DEEP-AUDIT §B2).
                        # VIGIL-PPG-GRID-AUDIT §5.2 removed `or 0` from the OXYII call site and left a
                        # comment there plus a past-tense docstring on Spo2CsvWriter.write — and never
                        # touched this one, the SECOND producer of the identical CSV one screen up.
                        # Reachable by configuration (`protocol: legacy`, config.example.yaml:83), not
                        # dead. Impact is bounded and worth stating plainly: the shipped oxydex-dsp.js
                        # rejects `0` and blank IDENTICALLY (`parseInt('')` → NaN and `0 < 20` hit the
                        # same `continue`), 0 occurrences across 110k real rows on the sibling path — so
                        # NO downstream number moves. What changes is that the file stops asserting a
                        # pulse the ring never measured.
                        wr.write(now, pkt["spo2"], pkt["pr"], pkt["motion"])
                        BUS.push("spo2", [pkt["spo2"]])
                        if pkt["pr"]:
                            BUS.push("pr", [pkt["pr"]])
                        note_data(name, _time.monotonic())
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
            log.warning("%s %s", name, link_error_text(e))
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



def _oxy_emit(lc, writer, name, new, reason, *, failure=None):
    """Emit ONE OxyII lifecycle transition (charter G4): record it, append the OXYLIFE.csv row, surface
    the state in STATUS. GUARDED — an illegal edge is SKIPPED, never raised, so a lifecycle-modelling gap
    can never crash run_oxyii (the module's strict raise is for its tests; the daemon must not die on it).
    A repeated same-state emit (LIVE on every poll) is a self-edge that can() rejects, so only the first
    of a run fires — the guard doubles as idempotence."""
    if not lc.can(new):
        return
    t = lc.to(new, reason, failure=failure)
    if writer is not None:
        writer.write(t)
    _set(name, oxy_lifecycle=new.value)


async def run_oxyii(dev: dict, root: str):
    """Wellue O2Ring-S / T8520 ("S8-AW…") — live SpO2 + pulse over the OxyII protocol (NOT legacy Viatom).
    No bonding. Flow: connect → auth(0xFF) → setup(0x10) → poll cmd=0x04 ~1/s. Emits the ViHealth CSV
    OxyDex parses + pushes spo2/pr to the monitor."""
    name, addr = dev["name"], dev["address"]
    backoff = 5
    import cpap_record
    import oxy_lifecycle
    _oxylc = oxy_lifecycle.OxyLifecycle(device_id=dev.get("device_id"),
                                        session_id=cpap_record.new_session_id())
    # The RECORDING axis (OxyRecEngine) — same journal, axis="rec", INDEPENDENT of the link axis above.
    # duration_s drives it (the measured signal); link loss moves it to UNKNOWN, never to NOT_RECORDING.
    _oxyrec = oxy_lifecycle.OxyRecEngine(device_id=dev.get("device_id"), session_id=_oxylc.session_id)
    _oxywr = {"w": None}                        # G4 OXYLIFE.csv, opened once per run (first night dir)

    def _rec_emit(transitions):
        """Journal + surface RECORDING-axis transitions. Same discipline as the arrival telemetry in the
        data callback: journaling must never disturb capture, so a writer error is logged and swallowed."""
        for t in transitions:
            try:
                # The None guard is DEFENSIVE-ONLY (pragma'd): the OXYLIFE writer opens in the first
                # loop iteration BEFORE any connect, and rec transitions need frames, which need a
                # connect — so a rec transition with no writer requires a teardown race this function
                # must survive but no test can deterministically produce.
                if _oxywr["w"] is not None:   # pragma: no branch
                    _oxywr["w"].write(t)
                _set(name, oxy_recording=t.new.value)
            except Exception:   # pragma: no cover - defensive: telemetry must not kill the data path
                log.exception("%s: recording-axis journal write failed", name)
    while not _STOP.is_set():
        if _OXYII_PAUSE.is_set() or _RECOVER.is_set():   # a stored-session pull owns the link, or the adapter is recovering
            _set(name, connected=False,
                 last_error="paused — pulling stored session" if _OXYII_PAUSE.is_set() else "adapter recovering")
            _oxy_emit(_oxylc, _oxywr["w"], name,
                      oxy_lifecycle.OxyState.PAUSED_FOR_PULL if _OXYII_PAUSE.is_set()
                      else oxy_lifecycle.OxyState.RECOVERING,
                      "stored-session pull owns the link" if _OXYII_PAUSE.is_set() else "adapter recovering")
            while (_OXYII_PAUSE.is_set() or _RECOVER.is_set()) and not _STOP.is_set():
                await asyncio.sleep(0.3)
            continue
        started = _now()
        ndir = night_dir(root, started)
        if _oxywr["w"] is None:                  # G4: open the lifecycle sidecar once, in the first night dir
            _oxywr["w"] = OxyLifeLogWriter(os.path.join(ndir, "OXYLIFE.csv"), device=name)
        path = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, "spo2", "csv"))
        ppg_path = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, "ppg", "txt"))
        ppg2w_path = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, "ppg2w", "txt"))
        rtclog_path = os.path.join(ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"], started, "rtclog", "csv"))
        wr = ppgwr = oxyflagwr = ppg2wr = rtcwr = None
        # The synthesized PPG sample clock (O2RING-PPG-GAP §1 + CAPTURE-HOST-DEEP-AUDIT §A3), per
        # SESSION — a reconnect opens a new file and a new grid, so it is rebuilt with the writers
        # rather than persisting across links. Boxed so the BLE callback can reach it.
        ppg_grid = [O2PpgGrid()]
        # The COUNTED half of the same question (O2RING-FRAME-SAMPLE-LOCK). Per SESSION for the same
        # reason the grid is: its arithmetic is a span between two of the ring's own session-seconds,
        # and a reconnect is precisely where that span stops being continuous.
        ppg_led = [O2PpgFrameLedger()]
        stalled = False                               # link held but no frames decoded — reconnect
        try:
            _set(name, connected=False, address=addr, last_error=None)
            _oxy_emit(_oxylc, _oxywr["w"], name, oxy_lifecycle.OxyState.CONNECTING, "scan + connect")
            async with _connect_scan(addr) as client:
                # NB: backoff is NOT reset here. A bare connect is not a viable session — the O2Ring's
                # signature failure (E3) is a connect that SUCCEEDS then drops during service discovery
                # ("failed to discover services, device disconnected", 38× in one night). Resetting on
                # connect meant every doomed attempt reset the backoff, so a flapping ring hammered a
                # reconnect every ~21 s (15 s scan + connect + 5 s sleep) — 178 reconnects, 115 session
                # files — instead of ever backing off. Reset only once DATA flows (the poll loop below):
                # then a genuinely viable ring recovers fast, while a flapping one is left to back off.
                _set(name, connected=True); log.info("%s connected", name)
                _oxy_emit(_oxylc, _oxywr["w"], name, oxy_lifecycle.OxyState.CONNECTED, "auth + setup")
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
                # O2RING-ADAPTIVE-TIMEBASE Stage 3b: stamp the host-clock's per-capture RATE decision into
                # the finger file so PpgDex analyses it on the right axis (device-crystal by default,
                # host-disciplined when the host earned it). Read from the poller's latest verdict; absent
                # (poller hasn't run yet, or no clock) ⇒ no comment ⇒ PpgDex defaults to the crystal floor.
                _tb = STATUS.get("host_clock", {}).get("timebase")
                ppgwr = (StreamWriter(ppg_path, "ppg1", timebase=_tb)
                         if "ppg" in (dev.get("streams") or ["spo2", "ppg"]) else None)
                # RAW DUAL-WAVELENGTH (cmd 0x05). OPT-IN — absent from the default stream list, so a box
                # that has not asked for it is untouched. It is a SECOND poll on the ring's single BLE
                # link and ~920 B per reply, so it costs airtime that the 1 Hz vitals poll currently owns.
                # Same ring, same host clock, same `_tb` — the timebase decision is per DEVICE, so it
                # rides this stream too (O2RING-ADAPTIVE-TIMEBASE-FOLLOWUPS §1a).
                rtcwr = RingClockLogWriter(rtclog_path)
                ppg2wr = (StreamWriter(ppg2w_path, "ppg2w", timebase=_tb)
                          if "ppg2w" in (dev.get("streams") or []) else None)
                # Byte-11 identification experiment (see writers.OxyFrameLogWriter). ~1 Hz, ~1 MB/night,
                # and a SIDECAR so the vendor SpO2 CSV layout OxyDex parses stays byte-identical.
                oxyflagwr = OxyFrameLogWriter(os.path.join(
                    ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"],
                                           started, "oxyframe", "txt")))
                # PACKET-ARRIVAL SIDECAR FOR THE RING (PAT-PACKET-ARRIVAL §6). The Polar path records
                # arrival↔device from `sensor_ns`; the ring exposes no such clock on any streaming
                # opcode. What it DOES expose is `duration` — seconds into its own session — and that
                # counter measures 1-55 ppm against the host once segmented on its resets, i.e. a real
                # device clock, just a coarse one. Pairing it with the true frame arrival gives the ring
                # the same estimator the Polars get.
                # ⚠️ 1 s QUANTISATION means the RING'S offset must be fitted, not min-filtered: a
                # minimum over a quantised counter returns the quantum, not the floor. The intercept of
                # a regression over thousands of frames recovers it to ~4 ms. The file records the
                # pairing; choosing the estimator is the reader's job, and `meas` names which is which.
                oxy_arr_wr = PmdArrivalLogWriter(os.path.join(
                    ndir, capture_filename(dev["vendor"], dev["model"], dev["device_id"],
                                           started, "pmdarrival", "csv")))
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
                # The expectation a queued settings write leaves for its 0x00 read-back: the parse_config
                # key that should now read `value`. Cleared by on_data when the read-back arrives, so the
                # monitor shows a verdict about what the RING reports, not about what was asked.
                _cfg_expect: list[tuple[str, int] | None] = [None]
                # Per-connection RTC-read clock: None forces a read on the FIRST poll of every session,
                # so each reconnect republishes a fresh ring-vs-host offset (and after a 0xC0 push the
                # next session shows whether it landed).
                _info_last: list[float | None] = [None]

                def on_data(_s, d):
                    for frame in reasm.feed(bytes(d)):
                        r = oxyii.decode(frame)
                        # RING RTC READBACK (GET_INFO [24:31], readable since 2026-08-19). Publishes the
                        # ring-vs-host offset so a 0xC0 push that failed to land is VISIBLE on the monitor
                        # rather than silently trusted. An unset/out-of-range RTC publishes None — absence,
                        # never year-0 arithmetic (Clock Contract §2.7).
                        if r and r[0] == oxyii.OP_GET_INFO:
                            _info = oxyii.parse_get_info(r[1])
                            _rtc = _info.get("rtc") if _info else None
                            _off = round(ring_clock_offset_s(_rtc, _now()), 1) if _rtc else None
                            _set(name, ring_rtc_offset_s=_off,
                                 ring_rtc_read=_now().isoformat(timespec="seconds"))
                            if _off is not None:
                                # RTC RESET DETECTION. Between two reads the offset moves by drift (≪1 s
                                # per 10 min) or by a 0xC0 push we made ourselves — a jump beyond
                                # _OXYII_RTC_JUMP_S with no push means the RTC restarted (battery event,
                                # the documented failure that silently ruins a stored .dat's timebase).
                                # Flag it the moment it is SEEN, and clear _OXYII_RTC_AT so the very next
                                # loop re-pushes (oxyii_rtc_due reads it as first contact).
                                _prev_off = _OXYII_LAST_RTC_OFF.get(addr)
                                _OXYII_LAST_RTC_OFF[addr] = _off
                                if _prev_off is not None and abs(_off - _prev_off) > _OXYII_RTC_JUMP_S:
                                    _set(name, ring_rtc_reset_suspect=_now().isoformat(timespec="seconds"))
                                    _OXYII_RTC_AT.pop(addr, None)
                                    log.warning("%s: RTC JUMPED %+.1f s -> %+.1f s between reads — battery-event "
                                                "reset suspected; re-push queued, stored .dat timebase suspect",
                                                name, _prev_off, _off)
                                    rtcwr.write(_now(), "reset-suspect", rtc_offset_s=_off)
                                else:
                                    rtcwr.write(_now(), "read", rtc_offset_s=_off)
                            else:
                                rtcwr.write(_now(), "read")
                            continue
                        # BATTERY POLL REPLY (0xE4). level/state mirror the live header; raw2 is the
                        # ANALOG voltage-like byte (mapped 2026-08-19, semantics unverified) — logged raw
                        # because the log IS its characterisation. raw3: constant 0x10 so far; logged so
                        # a firmware where it moves is caught by data, not by assumption.
                        if r and r[0] == oxyii.OP_GET_BATTERY:
                            _b = oxyii.parse_battery(r[1])
                            if _b:
                                rtcwr.write(_now(), "battery", battery_state=_b["state"],
                                            battery_level=_b["level"],
                                            battery_raw2=(r[1][2] if len(r[1]) > 2 else None),
                                            battery_raw3=(r[1][3] if len(r[1]) > 3 else None))
                            continue
                        # SETTINGS READ-BACK (GET_CONFIG). Always publishes the parsed struct; when a
                        # queued write is awaiting its verdict, compares the RING's value to the request.
                        if r and r[0] == oxyii.OP_GET_CONFIG:
                            _cfgd = oxyii.parse_config(r[1])
                            if _cfgd:
                                _set(name, ring_config={k: _cfgd[k] for k in
                                                        ("brightness", "motor", "spo2_low", "hr_low",
                                                         "hr_high", "storage_interval")})
                                exp = _cfg_expect[0]
                                if exp is not None:
                                    _fld, _val = exp
                                    _rb = oxyii.SET_CONFIG_FIELDS[_fld]["readback"]
                                    _ok = _rb is None or _cfgd.get(_rb) == _val
                                    _set(name, ring_config_verdict=(
                                        f"{_fld}={_val} applied" if _ok
                                        else f"{_fld}={_val} NOT applied — ring reports {_cfgd.get(_rb)}"))
                                    if not _ok:
                                        log.warning("%s: settings write %s=%s did not land (ring reports %s)",
                                                    name, _fld, _val, _cfgd.get(_rb))
                                    _cfg_expect[0] = None
                            continue
                        # RAW DUAL-WAVELENGTH reply. Handled before the OP_LIVE gate below, which would
                        # otherwise drop it — it is a different opcode carrying a different payload.
                        if r and r[0] == oxyii.OP_RT_PPG and ppg2wr:
                            recs = oxyii.parse_rt_ppg(r[1])
                            if recs:
                                arr2 = _now()
                                # Back-timed from ARRIVAL across the buffer, exactly as the 125 Hz pleth
                                # is — the ring stamps nothing, so a device time does not exist to use.
                                # The step is the BUFFER SPAN divided by its records, not a nominal rate:
                                # no rate is known here (see oxyii.parse_rt_ppg), and inventing one is
                                # what the O2PPG grid already had to be rescued from.
                                step = _RT_PPG_SPAN_S / max(len(recs) - 1, 1)
                                for i, (a, b, mo) in enumerate(recs):
                                    ph = arr2 - _dt.timedelta(seconds=(len(recs) - 1 - i) * step)
                                    # sensor_ns = 0: the ring exposes NO device clock on this opcode, and
                                    # the 125 Hz pleth's O2PpgGrid cannot be borrowed — it is built on a
                                    # MEASURED 125 Hz step, so reusing it here would stamp this stream
                                    # with another stream's rate. A zero column reads as "no device
                                    # timebase"; a plausible one would read as a measurement.
                                    ppg2wr.write_ppg2w(ph, 0, a, b, mo)
                                BUS.push("o2ppg2w", [[a, b] for a, b, _m in recs])
                            continue
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
                        # The count the DEVICE declares, read whether or not any samples survived the
                        # slice — `declared - delivered` is only a measurement if both come off the same
                        # frame. Cheap (one u16) and gated on the same writer as the decode.
                        n_decl = oxyii.ppg_sample_count(r[1]) if ppgwr else None
                        # The ring's OWN stream position for this frame ([20:24], u32 LE). Read here for
                        # the same reason and under the same gate as n_decl: it is a property of THIS
                        # frame's bytes, and it is only a measurement paired with the count off the same
                        # frame. Recorded, never acted on — `SUM(declared)` vs `DELTA(offset)` is the
                        # host-clock-free test of whether the ring counts its PPG_INVALID bytes in its own
                        # sequence (DEVICE-RATE-TRUTH-2026-08-05 §6.1).
                        n_off = oxyii.ppg_stream_offset(r[1]) if ppgwr else None
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
                            # [arr - nps/fs, arr]. Real time the ring measured but the link lost must
                            # ADVANCE the grid instead of being pretended away.
                            #
                            # The whole grid — the session anchor, the honest-gap advance and the MEASURED
                            # step that CAPTURE-HOST-DEEP-AUDIT §A3 added — lives in O2PpgGrid, where it
                            # can be driven directly by a test. It used to live here, inline in a BLE
                            # callback, and the test file re-implemented it: two copies of the rule, with
                            # the assertions pointed at the copy that ships to nobody.
                            ns_of = ppg_grid[0].frame(arr, nps)
                            for i, v in enumerate(ppg):
                                ph = arr - _dt.timedelta(seconds=(nps - 1 - i) * ppg_grid[0].step_s)
                                ppgwr.write_ppg(ph, ns_of[i], 0.0, (v,), 0)
                            BUS.push("o2ppg", ppg)
                        live = oxyii.parse_live(r[1])
                        if not live:
                            continue
                        frames[0] += 1
                        # COUNT the frame against the ring's own session-second clock, before the row is
                        # written — the ledger returns that row's PPG arithmetic. Fed here rather than in
                        # the `if ppg:` block above because a frame that declared samples and delivered
                        # NONE is exactly the event worth counting, and that block never runs for it.
                        _ppgrow = (ppg_led[0].frame(live["duration"], n_decl, len(ppg))
                                   if n_decl is not None else None)
                        # Attached to the row rather than passed through the ledger: the ledger ACCUMULATES
                        # (it owns truncated/device_seconds across the session) and this is a per-frame
                        # primitive with nothing to accumulate. Keeping it out of the ledger's state is
                        # what stops it becoming a fourth counter — the third was retired 2026-08-04
                        # precisely because no nominal made it informative.
                        if _ppgrow is not None:
                            _ppgrow["offset"] = n_off
                        # Unreachable-false: oxyflagwr is opened UNCONDITIONALLY on every connect
                        # (unlike ppgwr, which is gated on the `ppg` stream), so it cannot be None by
                        # the time the poll loop runs. Kept as a guard because the three writers are
                        # torn down together and a future gate on this one would land here.
                        if oxyflagwr:   # pragma: no branch
                            oxyflagwr.write(_now(), live, _ppgrow)   # PI + what the vendor CSV cannot carry
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
                        # RECORDING axis: every live frame's duration_s feeds the engine; the backward
                        # step lands here as END_CANDIDATE ~7–12 s after a doff, while the link is still
                        # held — the moment the close-triggered pull (DAT-AUTO-HARVEST §8) keys on.
                        _rec_emit(_oxyrec.observe_duration(live.get("duration")))
                        # LINK axis worn-flips: contact is a worn-VOTE (never a recording signal), but it
                        # IS the link axis's LIVE↔IDLE_UNWORN discriminator — the state measured running
                        # unjournaled for 6 h on 2026-08-24 (docked-charging: connected, contact=0).
                        if live.get("worn"):
                            _oxy_emit(_oxylc, _oxywr["w"], name, oxy_lifecycle.OxyState.LIVE,
                                      "worn — frames flowing")
                        else:
                            _oxy_emit(_oxylc, _oxywr["w"], name, oxy_lifecycle.OxyState.IDLE_UNWORN,
                                      "ring reports not-worn")
                        now = _now()
                        # Arrival↔device pairing, one row per live frame. `duration` is SECONDS, carried
                        # in the ns column so the file has one shape for every device; the `meas` value
                        # says which estimator applies (see the writer note above).
                        try:
                            _dur_ns = int(live["duration"]) * 1_000_000_000
                            oxy_arr_wr.write(now, name, "OXYLIVE_DURATION_S", _dur_ns, _dur_ns, 1)
                        except Exception:   # telemetry must never disturb the data callback
                            pass
                        if live["spo2"] is not None:
                            # `live["pr"]` passed through AS-IS, including None — `or 0` used to turn an
                            # unreadable pulse rate into a written 0 (VIGIL-PPG-GRID-AUDIT §5.2). The
                            # writer emits a blank for None; see Spo2CsvWriter.write.
                            wr.write(now, live["spo2"], live["pr"], live["motion"])   # [11], corrected
                            BUS.push("spo2", [live["spo2"]])
                            if live["pr"]:
                                BUS.push("pr", [live["pr"]])
                            BUS.push("motion_o2", [live["motion"]])   # raw movement level (~1/s)
                            note_data(name, _time.monotonic())
                            _set(name, rows=wr.rows, spo2=live["spo2"], pr=live["pr"], battery=live["batt"],
                                 motion=live["motion"], worn=True, last_sample=now.isoformat(),
                                 arrival_rows=oxy_arr_wr.rows,
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
                if ppg2wr:
                    # fs=0 DELIBERATELY. Every reply carries exactly 102 records whatever the poll
                    # spacing, which is a fixed buffer cap and not a rate (cmd 0x03 caps the same way at
                    # 250). Declaring a rate we have not measured would put a fabricated number on the
                    # card and into stream_health's weak/stall arithmetic; 0 means "irregular", which is
                    # what it is until somebody measures it.
                    # Labels are the DEVICE ORDER, not the wavelengths. The SDK calls these IR and RED;
                    # that is a vendor-header claim we have not measured, and a monitor card is a bad
                    # place to publish a guess (see oxyii "WHICH-IS-WHICH" for the test that settles it).
                    BUS.register("o2ppg2w", "Raw 2-wavelength (O2Ring)", "raw", 0, chans=2,
                                 labels=("ch0", "ch1"))
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
                    rtcwr.write(_now(), "push")
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
                    # ASK FOR THE RAW BUFFER on the same cadence, and only when it is being captured.
                    # Failure here must NOT drop the link the way a failed vitals poll does: this stream
                    # is optional and the vitals are not, so a refusal costs its own samples and nothing
                    # else.
                    if ppg2wr:
                        try:
                            await asyncio.wait_for(
                                client.write_gatt_char(wch, oxyii.rt_ppg_frame(), response=False),
                                _PMD_CTRL_TIMEOUT_S)
                        except Exception as e:
                            log.debug("%s: raw IR/RED poll failed (%r) — vitals unaffected", name, e)
                    # RING RTC READBACK — one 60 B GET_INFO per _OXYII_INFO_EVERY_S; on_data publishes
                    # the ring-vs-host offset. Optional traffic, so a failure costs only this reading.
                    if _info_last[0] is None or _time.monotonic() - _info_last[0] >= _OXYII_INFO_EVERY_S:
                        _first_info = _info_last[0] is None
                        _info_last[0] = _time.monotonic()
                        try:
                            await asyncio.wait_for(
                                client.write_gatt_char(wch, oxyii.info_frame(), response=False),
                                _PMD_CTRL_TIMEOUT_S)
                            await asyncio.wait_for(
                                client.write_gatt_char(wch, oxyii.battery_frame(), response=False),
                                _PMD_CTRL_TIMEOUT_S)
                            # Once per session, also read the settings struct — so the monitor's
                            # brightness/vibration controls show the ring's ACTUAL values instead of
                            # "not read yet" until the first write happens to trigger a read-back.
                            if _first_info:
                                await asyncio.wait_for(
                                    client.write_gatt_char(wch, oxyii.config_frame(), response=False),
                                    _PMD_CTRL_TIMEOUT_S)
                        except Exception as e:
                            log.debug("%s: RTC readback poll failed (%r) — vitals unaffected", name, e)
                    # MONITOR-QUEUED SETTINGS WRITE (queue_ring_config → oxyii.set_config_frame, already
                    # whitelist-validated at enqueue). Applied once, then read back with GET_CONFIG so
                    # on_data can publish the verdict from what the ring reports. Failure requeues nothing:
                    # a write whose fate is unknown must surface as an unanswered verdict, not silently
                    # retry forever against a ring that is refusing it.
                    # OPERATOR-COMMANDED BUZZ (queue_ring_buzz). One 0x83, empty payload; the command
                    # instant is logged + published so the analysis knows when the marker was ASKED for
                    # (the artifact's own position in each stream is what carries the timing).
                    if addr in _OXYII_BUZZ_PENDING:
                        _OXYII_BUZZ_PENDING.discard(addr)
                        _buzz_at = _now()
                        try:
                            await asyncio.wait_for(
                                client.write_gatt_char(wch, oxyii.encode(0x83, b"", 0), response=False),
                                _PMD_CTRL_TIMEOUT_S)
                            _set(name, ring_buzz_at=_buzz_at.isoformat(timespec="milliseconds"))
                            log.info("%s: BUZZ fired at %s (fiducial marker)", name,
                                     _buzz_at.isoformat(timespec="milliseconds"))
                        except Exception as e:
                            _set(name, ring_buzz_at=None)
                            log.warning("%s: buzz command failed (%r)", name, e)
                    _pending = _OXYII_CFG_PENDING.pop(addr, None)
                    if _pending is not None:
                        _fld, _val = _pending
                        try:
                            await asyncio.wait_for(
                                client.write_gatt_char(wch, oxyii.set_config_frame(_fld, _val), response=False),
                                _PMD_CTRL_TIMEOUT_S)
                            _cfg_expect[0] = (_fld, _val)
                            await asyncio.wait_for(
                                client.write_gatt_char(wch, oxyii.config_frame(), response=False),
                                _PMD_CTRL_TIMEOUT_S)
                            log.info("%s: settings write %s=%s sent, read-back requested", name, _fld, _val)
                        except Exception as e:
                            _set(name, ring_config_verdict=f"{_fld}={_val} write failed: {e!r}")
                            log.warning("%s: settings write %s=%s failed (%r)", name, _fld, _val, e)
                    # ── 0x05 SATURATION FIX (RAW-DUAL-WAVELENGTH §2.1, measured 2026-08-20) ──────────
                    # At a 1 Hz drain the raw buffer pins at its 102-record reply cap on essentially
                    # every poll (282,402 of 284,420 buffers across 39 real files), so the device fills
                    # FASTER than we drain and the excess is silently lost — the delivered ~100 Hz is
                    # CAP × poll rate, not the device rate (fill > 102 Hz; the 125.000 ADC remains the
                    # prediction). Ask for the raw buffer a second time mid-cycle: ~0.5 s drains sit
                    # well under the cap, so capture is COMPLETE and every night's unsaturated counts
                    # measure the true fill rate for free. Vitals cadence unchanged (0x04 rides the
                    # full cycle); without the raw stream the loop sleeps exactly as before.
                    if ppg2wr:
                        await asyncio.sleep(0.5)
                        try:
                            await asyncio.wait_for(
                                client.write_gatt_char(wch, oxyii.rt_ppg_frame(), response=False),
                                _PMD_CTRL_TIMEOUT_S)
                        except Exception as e:
                            log.debug("%s: mid-cycle raw IR/RED poll failed (%r) — vitals unaffected", name, e)
                        await asyncio.sleep(0.5)
                    else:
                        await asyncio.sleep(1.0)
                    # Same stall guard as the Polar path: a ring that holds its link but stops answering
                    # (auth/setup never accepted, every frame failing CRC, a handler raising inside
                    # bleak's dispatch) is indistinguishable from a healthy one from out here.
                    if frames[0] != last_frames:
                        last_frames, last_change = frames[0], _time.monotonic()
                        _oxy_emit(_oxylc, _oxywr["w"], name, oxy_lifecycle.OxyState.LIVE, "frames flowing")
                        backoff = 5           # E3: data is flowing — THIS is a viable session, so reset the
                                              # reconnect backoff. A later drop then recovers fast; a ring
                                              # that only ever connects-and-drops never reaches here and so
                                              # keeps backing off (5→10→…→60) instead of hammering.
                    elif stream_is_stalled(last_change, _time.monotonic(), _STREAM_STALL_S):
                        stalled = True
                        _oxy_emit(_oxylc, _oxywr["w"], name, oxy_lifecycle.OxyState.INTERRUPTED, "no frames — stalled")
                        _set(name, last_error=f"no frames for {_STREAM_STALL_S:.0f}s — reconnecting")
                        log.warning("%s: no decoded frames for %.0fs behind a live link — dropping it",
                                    name, _STREAM_STALL_S)
                        break
        except Exception as e:
            _set(name, connected=False, last_error=repr(e))
            log.warning("%s %s", name, link_error_text(e))
        finally:
            _oxy_emit(_oxylc, _oxywr["w"], name, oxy_lifecycle.OxyState.DISCONNECTED, "session ended")
            # RECORDING axis on link loss: the ring is UNOBSERVABLE, which is not the same fact as
            # not-recording (§5: BLE loss must never read as "recording ended").
            _rec_emit(_oxyrec.observe_link_lost())
            try:
                oxy_arr_wr.close()
            except Exception:
                pass
            # Report the honest gaps this session inserted. Silence here would re-create the very problem
            # the gap insertion fixes — a lossy link that LOOKS clean. Logged even at zero, so "no gaps"
            # is an observation rather than an absence of evidence.
            if ppgwr and ppg_grid[0].idx:
                # Phrased as what was MEASURED (a grid advance), not as a conclusion about the link. The
                # old wording asserted "%% of the session's real time was lost by the link" — which the
                # frame-anchored inflation made false: most of what it reported as loss was rectified
                # arrival jitter, not lost time. A log line is evidence only if it says what it saw.
                # The MEASURED rate is reported alongside (§A3): the configured `ppg_fs` is a starting
                # guess, and the difference between it and this number is what used to be written into
                # the file as fabricated elapsed time.
                _g = ppg_grid[0]
                log.info("%s: PPG grid — %d sample(s) written, %d gap(s) inserted totalling %.1f s "
                         "(%.2f%% of the grid, host-clock deficit vs the session anchor); measured "
                         "%.3f Hz vs configured %.3f Hz",
                         name, _g.idx - _g.lost, _g.gaps, _g.lost * _g.step_s,
                         100.0 * _g.lost / max(_g.idx, 1), _g.fs, _g.nominal_fs)
                # The COUNTED half, reported BESIDE the inferred one rather than instead of it — the two
                # are only comparable if a night prints both. Worded as what was COUNTED and nothing
                # more: the duration steps are the ring's counter quantizing (NOT missing frames — see
                # O2PpgFrameLedger), and `truncated` is the only one whose being non-zero means
                # something actually broke. The nominal-constant arithmetic that used to sit here was
                # retired 2026-08-04 — it could not be made informative under any nominal.
                _l = ppg_led[0]
                if _l.device_seconds:
                    log.info("%s: PPG frames — %d received over %d device-second(s); duration steps "
                             "%d ahead / %d flat (imbalance %+d, quantization — not lost frames), "
                             "%d anomalous, %d restart; declared %d sample(s), delivered %d "
                             "(%d truncated)",
                             name, _l.frames, _l.device_seconds, _l.steps_ahead, _l.steps_flat,
                             _l.step_imbalance, _l.steps_anomalous, _l.restarts, _l.declared,
                             _l.delivered, _l.truncated)
            # DISCARD HEADER-ONLY FILES, exactly as run_polar does. Writers are opened before the ring is
            # known to be streaming, so every session that ends without data leaves a file containing
            # nothing but its header — indistinguishable from a real capture until something opens it,
            # and the Dex ingest walks this directory. On the documented 359-reconnect night that was
            # ~1000 junk files in one night dir. The Polar path already solved this; the ring never got it.
            for _w in (wr, ppgwr, oxyflagwr, ppg2wr, rtcwr):
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
    _oxy_emit(_oxylc, _oxywr["w"], name, oxy_lifecycle.OxyState.SHUTTING_DOWN, "daemon stop")
    if _oxywr["w"] is not None:
        _oxywr["w"].close()


def session_meta(f: str, name: str = "") -> dict:
    """A pulled session's sidecar, or an explicit `unreadable` marker — never a bare {}.

    `{}` is indistinguishable from "a session with no metadata", and monitor.html renders exactly that:
    a clean `✓ <filename>` with the size simply absent. It matters because the sidecar is where the
    SHORTFALL lives — `bytes` vs `declared_size` is how a truncated pull is told from a whole one — so a
    sidecar we cannot read is precisely the case where saying nothing is worst. `pull_session` writes it
    immediately after the data, so a failure here is genuinely odd and worth a log line.

    MODULE-LEVEL ON PURPOSE. This was a closure inside `pull_oxyii_session`, which is why the first test
    written for it re-implemented its body instead of calling it — the anti-pattern this repo's own
    audit records as "a test that re-implements its subject tests nothing". Hoisting it is the fix.
    """
    try:
        with open(f + ".meta.json") as fh:
            return json.load(fh)
    except Exception as e:                             # noqa: BLE001 — the reason is reported, not acted on
        log.warning("%s: sidecar unreadable for %s (%s) — reported as unreadable rather than as a "
                    "session with no metadata", name or "pull", os.path.basename(f), type(e).__name__)
        return {"unreadable": True, "reason": type(e).__name__}


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

    return {"ok": True, "new_files": [os.path.basename(f) for f in saved],
            "sessions": [session_meta(f, name) for f in saved], "out_dir": out_dir}


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

# How long the AUTO-SYNC may spend asking "is it even there?" — outside every lock.
#
# 6 s is a scan budget, not a connect budget, and that is the whole point: absence costs a scan nobody
# is excluded by, instead of 45 s of `_CONNECT_LOCK` that every other sensor queues behind. Sized above
# the ~1 s advertising interval of these straps with margin for a missed window; the failure mode of
# being too SHORT is a false "absent", which merely defers one sync to the next reconnect — cheap, and
# self-correcting, because a device that is really there will be found on the following cycle.
_CLOCK_SYNC_PRESENCE_S = 6.0

# THE LADDER'S TOTAL SPEND, which is the bound the previous two fixes did not draw.
#
# Both earlier attempts bounded ONE op and left the LOOP. 2026-07-19: an out-of-range device wedged
# capture for 58 minutes → `_OFFLINE_OP_TIMEOUT_S`. Same day: 12 retries × 300 s = a 97 % duty-cycle
# wedge → `_CLOCK_SYNC_TIMEOUT_S = 45`, with the note "the bound has to be proportionate". It was made
# proportionate, and the shape came back a third time — measured 2026-08-09 with an H10 on a desk:
# **51 ops in 59.1 min, mean hold 41.1 s, 2097 s of 3544 s = a 59 % duty cycle.**
#
# Proportionality lowers the constant; it cannot remove the loop, because 12 × 45 s is still ~9 minutes
# of GLOBAL `_CONNECT_LOCK` per reconnect cycle and the ladder re-arms on the next reconnect. A budget
# on the ladder's TOTAL elapsed time is the bound that holds no matter which error is being retried —
# it does not require `device_absent_error` to classify anything correctly, and it would have capped all
# three incidents. Classification reduces the common case; this bounds the worst one.
#
# 120 s ≈ two attempts at the 45 s ceiling. Sized for what the ladder is FOR: `org.bluez.Error.InProgress`
# after a restart clears in seconds, not minutes (2026-07-18 — the failure that motivated retrying at
# all), so two attempts spend the contention case without funding the hopeless one. Monotonic, not `_now()`:
# this measures elapsed time, and `_now()` is civil-time-anchored and re-anchors on an NTP step.
_CLOCK_SYNC_LADDER_BUDGET_S = 120.0


class DeviceNotAdvertising(Exception):
    """The presence pre-check found nothing on the air for this address.

    The message deliberately contains "not advertising" so it flows through `device_absent_error` and
    `transient_ble_error` exactly like bleak's own absence signal — the ladder defers, the reconnect loop
    keeps looking. A bespoke class that no predicate recognised would be a third way to be wrong about a
    string, which is the mistake this whole line of work has been correcting."""


async def _device_on_air(address: str, budget_s: float) -> bool | None:
    """Is this address advertising? True / False / None when the question could not be asked.

    None is NOT False, and the distinction is the safety property: a scan that errors, or a bleak that
    cannot be imported, must leave the caller doing exactly what it did before. Only a definitive
    "nothing on the air" is allowed to skip work."""
    try:
        import bleak
        dev = await asyncio.wait_for(
            bleak.BleakScanner.find_device_by_address(address, timeout=budget_s,
                                                      adapter=await adapter_hci()),
            timeout=budget_s + 3.0)
        return dev is not None
    except Exception as e:                     # scan failed, adapter busy, bleak absent — cannot tell
        log.debug("presence check for %s could not be answered (%r)", address, e)
        return None


async def polar_offline_op(address: str, op, timeout: float | None = None,
                           presence_check_s: float | None = None):
    """Run a PS-FTP offline op (list/pull) while the daemon's run_polar for `address` is paused, so the
    pull owns the device's single BLE link instead of colliding with the live-capture reconnect loop
    (org.bluez.Error.InProgress). `op` is a zero-arg coroutine factory; its result is returned. Resumes
    live capture no matter how `op` ends — including when it does not end at all (see the timeout)."""
    # Resolved at CALL time, not bound as a default argument: a default is evaluated once at import,
    # which silently freezes the module constant and makes it impossible to tune at runtime or in a test.
    timeout = _OFFLINE_OP_TIMEOUT_S if timeout is None else timeout
    name = next((n for n, s in STATUS.get("devices", {}).items() if s.get("address") == address), None)
    # ── ASK WHETHER THE DEVICE IS THERE *BEFORE* TAKING ANYTHING ──────────────────────────────────────
    # Everything below this point is exclusive: the offline slot, `_POLAR_PAUSED`, and the GLOBAL
    # `_CONNECT_LOCK` — held for the whole op, which for an absent device means holding it through a
    # doomed 45 s connect while no other sensor can reconnect.
    #
    # Measured 2026-08-09, and this is the residue the previous two fixes could not reach. #1062 stopped
    # the ladder spending 12 attempts on an absent device, and it works — the journal shows
    # `deferred — device not found (attempt 1)`. But the deferral happens AFTER the expensive part:
    #
    #     07:09:45  live capture paused     <- lock taken
    #     07:10:27  offline op finished     <- 42 s of doomed connect
    #     07:10:27  auto-sync deferred      <- absence detected, too late to matter
    #
    # One such connect per reconnect cycle (~70-110 s) is a 53 % duty cycle on its own, which is what the
    # box still measured after #1062 and #1081. Absence is CHEAP to detect — it is a scan — and was being
    # paid for at connect-timeout prices under a lock that excludes every other device.
    #
    # OPT-IN, and that is deliberate. Only the automatic clock sync passes `presence_check_s`; a
    # user-clicked pull keeps the old behaviour exactly, because a person who pressed a button has
    # information the scanner does not and must not be second-guessed by a 6 s sample.
    #
    # FAILS SAFE TWICE OVER: `_device_on_air` returns None (not False) when the question cannot be
    # answered, and a device STATUS already reports as connected is never scanned for — a connected
    # device does not advertise, so scanning for one would "prove" absence about the one case that is
    # certainly present.
    if presence_check_s and not (name and STATUS["devices"].get(name, {}).get("connected")):
        if await _device_on_air(address, presence_check_s) is False:
            raise DeviceNotAdvertising(
                f"{address} is not advertising — skipped the offline op without taking the connect lock")
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


def publish_recording(now_mono: float, grace_sec: float) -> bool:
    """Stamp `recording` onto every device in STATUS and return whether ANY is. Returns the top-level
    value so the caller does not re-derive it from the dict it just wrote.

    WHY THIS IS PUBLISHED AT ALL. `alert_loop` has always computed exactly this and then thrown it away;
    what `status.json` carried was `connected`, and `alerts.device_is_recording`'s own docstring is four
    paragraphs on why those are not the same thing — an unbonded H10 reads connected=True inside each
    doomed 1-2 s connect, which is how 2026-07-29 produced four "recovered" notices with NOT ONE BYTE
    written after 23:48.

    So any consumer asking "is it safe to interrupt the daemon?" off `connected` would decide YES in the
    middle of exactly the failure it needs to respect. The unattended updater (VIGIL-AUTO-UPDATE §3) is
    the first such consumer, and the honest fix is to publish the answer rather than have it re-derived
    in shell — one definition, `alerts.device_is_recording`, called from both places.

    It lives in `status_loop`, NOT `alert_loop`, because alerting is OPTIONAL and its interval is
    configurable: on a box with alerts off, `alert_loop`'s copy never runs at all. A safety interlock
    that is only published when an unrelated feature happens to be enabled is not an interlock. This
    runs every 10 s unconditionally, so a stale `updated` means the daemon is gone — which a consumer
    must read as "do not touch", never as "idle"."""
    any_rec = False
    for name, d in STATUS["devices"].items():
        rec = alerts.device_is_recording(bool(d.get("connected")), _LAST_DATA.get(name), now_mono, grace_sec)
        d["recording"] = rec
        any_rec = any_rec or rec
    return any_rec


_NOTIFIER = None        # set in main(); read by status_loop to publish alert-transport health


async def status_loop(root: str, data_stale_sec: float = 120.0):
    path = os.path.join(root, "captures", "status.json")
    while not _STOP.is_set():
        STATUS["updated"] = _now().isoformat()
        STATUS["recording"] = publish_recording(_time.monotonic(), data_stale_sec)
        if _NOTIFIER is not None:
            STATUS["alerts"] = _NOTIFIER.stats()
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
    # `presence_check_s` ONLY here — the automatic sync is the caller that runs unattended on a loop and
    # therefore the one that must not spend the global lock proving a device is absent. The monitor's
    # user-clicked pull deliberately does not pass it (see polar_offline_op).
    before, after, host_at_read = await polar_offline_op(address, _op,
                                                                 timeout=_CLOCK_SYNC_TIMEOUT_S,
                                                                 presence_check_s=_CLOCK_SYNC_PRESENCE_S)
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


async def _adapter_cmd(cmd: list) -> bool:
    """Run a recovery command (hciconfig reset / btmgmt), bounded, never raising. True on success."""
    try:
        p = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL,
                                                 stderr=asyncio.subprocess.DEVNULL)
        rc = await asyncio.wait_for(p.wait(), timeout=8)
        if rc == 0:
            log.warning("watchdog: recovery: ran %s", " ".join(cmd)); return True
        log.info("watchdog: recovery: %s exited %s", " ".join(cmd), rc)
    except Exception as e:
        log.info("watchdog: recovery: %s skipped (%r)", " ".join(cmd), e)
    return False


def _usb_rebind_direct(dev_id: str) -> "tuple[bool, str]":
    """The unbind+bind writes themselves. Separated from the ladder so the preflight can ask 'could this
    work?' without performing a recovery — see `usb_rebind_available()`."""
    for action in ("unbind", "bind"):
        try:
            with open(os.path.join(_USB_DRIVER_DIR, action), "w") as f:
                f.write(dev_id)
        except Exception as e:
            return False, f"{action}: {e!r}"
        if action == "unbind":
            _time.sleep(1.5)
    return True, ""


def usb_rebind_available() -> "tuple[bool, str]":
    """Can the LAST recovery rung actually run here? Returns (ok, why-not).

    This exists because for its whole life it could not, and said nothing. `/sys/bus/usb/drivers/usb/
    {unbind,bind}` is `--w-------` root:root; the daemon runs unprivileged. Measured on the live box
    2026-08-05: `CapEff: 0000000000001000` — CAP_NET_ADMIN alone, no CAP_DAC_OVERRIDE — so every write
    raised PermissionError, was caught, and was logged at INFO as "skipped". Meanwhile the config had
    `watchdog.usb_path: 1-2` set, which suppressed the only warning on this path (the UNSET one below),
    so the box reported an armed ladder it did not have. A capability check is cheap; believing you have
    a recovery you do not is what cost ~110 minutes of a real night."""
    if os.access(os.path.join(_USB_DRIVER_DIR, "unbind"), os.W_OK):
        return True, ""
    try:
        helper = helper_path.resolve("tepna-btreset.sh")
    except Exception:
        helper = None
    if helper and os.access(helper, os.X_OK):
        return True, ""
    return False, ("no write access to %s and tepna-btreset.sh is not installed — run "
                   "deploy/enable-clock-control.sh once" % _USB_DRIVER_DIR)


async def _usb_rebind(dev_id: str) -> bool:
    """Re-enumerate the USB dongle by unbind+bind (VIGIL-DEEP-ANALYSIS §2D) — the ONLY thing that clears an
    RTL8761B FIRMWARE hang a soft `power off/on` leaves "powered but deaf". `dev_id` is the USB bus-port id
    (e.g. `3-1`, from `ls /sys/bus/usb/devices/`). Bounded, never raises. Off by default — only runs when
    `watchdog.usb_path` names the dongle.

    Privileged two ways, direct first: a box that granted the unit the capability writes /sys itself; every
    other box goes through the root-owned `tepna-btreset.sh` under `sudo -n`, exactly as the clock, RSSI and
    radio-restart rungs already do. A failure here is logged at WARNING, never INFO — this is the last rung,
    and "the recovery ran" and "the recovery was skipped" must not look the same in a journal."""
    ok, err = await asyncio.to_thread(_usb_rebind_direct, dev_id)
    if ok:
        log.warning("watchdog: recovery: USB re-bound %s — dongle re-enumerated", dev_id)
        return True
    try:
        helper = helper_path.resolve("tepna-btreset.sh")
    except Exception:
        helper = None
    if not helper or not os.access(helper, os.X_OK):
        log.warning("watchdog: recovery: USB rebind of %s CANNOT RUN (%s) and tepna-btreset.sh is not "
                    "installed — the last recovery rung is unavailable; run "
                    "deploy/enable-clock-control.sh once", dev_id, err)
        return False
    rc, out = await _run_helper("sudo", "-n", helper, dev_id, timeout=30)
    if rc == 0:
        log.warning("watchdog: recovery: USB re-bound %s — %s", dev_id, out.strip()[:120])
        return True
    log.warning("watchdog: recovery: USB rebind of %s FAILED rc=%s %s (direct write: %s)",
                dev_id, rc, out.strip()[:160], err)
    return False


async def _adapter_is_up(hci: str) -> "bool | None":
    """True/False if the pinned adapter `hci` is UP RUNNING, else None when it can't be determined
    (hciconfig absent, errored, or unparseable). Bounded, never raises — the watchdog treats None as
    'unknown' and falls back to the device-error heuristics, so a probe failure can never itself trigger a
    power-cycle. The direct antidote to the false-'healthy' loop (VIGIL-OVERNIGHT-FINDINGS 2026-07-24)."""
    try:
        p = await asyncio.create_subprocess_exec(
            "hciconfig", hci, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        out, _ = await proc_util.communicate(p, 6)
        if p.returncode != 0:
            return None
        return "UP RUNNING" in out.decode("utf-8", "replace")
    except Exception:
        return None


async def _run_helper(*args, timeout=45):
    """Run a helper and return (rc, combined output). Mirrors clockcfg._run — proc_util.communicate
    already carries the timeout/kill discipline every subprocess on this box is required to use, so an
    unbounded wait cannot wedge the watchdog task."""
    try:
        p = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        out, _ = await proc_util.communicate(p, timeout)
        return p.returncode, out.decode(errors="replace")
    except FileNotFoundError:
        return 127, f"{args[0]} not found"
    except asyncio.TimeoutError:
        return 124, "timed out"


async def _restart_radio() -> bool:
    """Restart bluetoothd through the narrow root-owned helper. Returns True if it came back.

    `systemctl restart bluetooth` is the rung that actually recovered the box on 2026-07-30 (a scan went
    from 0 devices to 91). It is gentler than a USB power-cycle and needs no physical access — but it
    does need root, which `vigil` only has for this one root-owned, non-user-writable script
    (deploy/enable-restart-control.sh). Absent that grant this is a no-op that says so, rather than a
    silent failure: a recovery that cannot run must not look like one that ran."""
    try:
        helper = helper_path.resolve("tepna-restart.sh")
    except Exception:
        helper = None
    if not helper or not os.access(helper, os.X_OK):
        log.error("watchdog: cannot restart the radio — tepna-restart.sh not installed "
                  "(run deploy/enable-restart-control.sh once)")
        return False
    rc, out = await _run_helper("sudo", "-n", helper, "radio", timeout=45)
    if rc == 0:
        log.warning("watchdog: bluetooth restarted — %s", out.strip()[:120])
        _RECOVER.set()
        await asyncio.sleep(5)
        _RECOVER.clear()
        return True
    log.error("watchdog: bluetooth restart FAILED rc=%s %s", rc, out.strip()[:160])
    return False


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
    # RECOVERY NEEDS HYSTERESIS, THE WAY THE WEDGE VERDICT ALREADY DOES (VIGIL-OVERNIGHT-FINDINGS P1.1).
    # `grace_checks` exists because ONE bad poll must not trigger an escalation. The mirror was missing:
    # ONE good poll cleared `consecutive` outright, so a FLAPPING adapter — wedged, blip, wedged, blip —
    # never accumulated `grace` in a row and the ladder was never reached. On 2026-07-24 that shape cost
    # ~65 minutes of deferred escalation, logging "adapter healthy again" 25×+ between wedges.
    #
    # `adapter_up` (added since) stops a DOWN radio reading healthy at all, which kills the original
    # 25× case. It does NOT stop the flap: an adapter genuinely up on one poll and wedged on the next
    # still resets the counter every time it blips. Requiring N CONSECUTIVE clean polls closes that.
    #
    # `cycles` is reset here too, and that matters more than it looks: it is the power-cycle budget
    # (`max_adapter_cycles`). Clearing it on a single good poll let a flapping radio be power-cycled
    # without bound, because the cap could never be reached either.
    # No max(1, …) guard: it would be dead code. `healthy_run >= recover` is already satisfied by the
    # first clean poll for ANY value <= 1, so 0 and negatives mean "recover immediately" — i.e. the
    # pre-hysteresis behaviour — which is a legible opt-out, not a footgun. A guard whose removal no
    # test can detect is a claim nobody is checking.
    recover = int(wcfg.get("recover_checks", 2))
    consecutive = cycles = silent = healthy_run = failovers = 0
    max_failovers = int(wcfg.get("max_failovers", 3))   # P1.5: cap ping-pong between two flaky radios
    sel = f"select {adapter_mac}\n" if adapter_mac else ""
    while not _STOP.is_set():
        await asyncio.sleep(interval)
        if _RECOVER.is_set() or _OXYII_PAUSE.is_set() or _POLAR_PAUSED:
            continue                                  # don't diagnose during a pull / recovery
        devs = []
        for d in cfg.get("devices", []):
            if d.get("optional"):
                continue                              # a known-but-not-expected backup is not wedge evidence
            st = STATUS.get("devices", {}).get(d["name"], {})
            bluez = False
            try:
                info = await bonding._btctl(f"info {d['address']}\nquit\n", timeout=6)
                bluez = "Connected: yes" in info
            except Exception:
                pass
            devs.append({"name": d["name"], "address": d["address"],
                         "connected": bool(st.get("connected")), "last_error": st.get("last_error"),
                         "bluez_connected": bluez,
                         # STREAMING, not merely linked (CAPTURE-HOST-DEEP-AUDIT §C3). Without these two
                         # the classifier could not tell a worn sensor from a docked one, so a single
                         # charging device — connected, producing nothing — suppressed the wedge signal
                         # for a genuinely DOWN adapter. Same pair `cpap_harvest.blocking_devices` reads.
                         "charging": st.get("charging"), "worn": st.get("worn")})
        # Probe the PINNED adapter's REAL state so a DOWN dongle is caught directly, not inferred from
        # device errors a plain connect-timeout never carries. adapter_hci() returns None when the
        # configured adapter isn't resolvable — itself the wedge signature — so that maps to False; a
        # resolvable-but-DOWN adapter is caught by _adapter_is_up; an undecidable probe returns None and
        # the device heuristics stand. This is what stops the watchdog declaring health over a dead radio.
        _hci_now = await adapter_hci()
        adapter_up = (await _adapter_is_up(_hci_now)) if _hci_now else False
        h = classify_adapter_health(devs, adapter_up=adapter_up)
        if not h["wedged"]:
            # ── IS THE RADIO DEAF? ───────────────────────────────────────────────────────────
            # Everything above says "not wedged", and on 2026-07-30 that verdict was CORRECT by its own
            # rules and still wrong about the world: hci0 was `UP RUNNING` with 332 MB of lifetime
            # traffic, every sensor timed out identically — indistinguishable from nobody wearing them —
            # and a 20 s scan saw ZERO advertisements in a house that always has dozens. ~20 minutes of
            # a night was lost until a human restarted bluetoothd by hand.
            #
            # So ask the one question none of the other signals carry: can the receiver hear ANYTHING?
            # Only when nothing is connected — a live link proves the radio works whatever a scan says,
            # and it is also the only state where probing cannot contend with our own connects.
            connected_any = any(d["connected"] for d in devs)
            if connected_any:
                silent = 0
            else:
                try:
                    found = await bonding.scan(adapter_mac, seconds=float(wcfg.get("deaf_scan_sec", 8)))
                    n_seen = len(found or [])
                except Exception as e:
                    n_seen = -1                      # a failed PROBE is not evidence about the radio
                    log.debug("watchdog: deafness probe failed: %r", e)
                if n_seen == 0:
                    silent += 1
                    log.warning("watchdog: radio heard NOTHING (%d consecutive) — a working adapter sees "
                                "neighbours even with our sensors off", silent)
                elif n_seen > 0:
                    silent = 0
                if radio_looks_deaf(max(n_seen, 0), connected_any, silent,
                                    int(wcfg.get("deaf_rounds", 2))):
                    silent = 0
                    log.error("watchdog: adapter reports UP but hears nothing — restarting bluetooth")
                    await _restart_radio()
            # Clean poll — but do not declare recovery until `recover` of them in a row.
            healthy_run += 1
            if consecutive and healthy_run < recover:
                log.info("watchdog: clean poll %d/%d — holding the wedge count at %d until recovery is "
                         "stable (a flap is not a recovery)", healthy_run, recover, consecutive)
            elif healthy_run >= recover:
                if consecutive:
                    log.info("watchdog: adapter healthy again (%d consecutive clean polls)", healthy_run)
                consecutive = cycles = 0
            continue
        healthy_run = 0                               # a wedged poll breaks the recovery run
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
                # L3 (P1.5): resetting THIS radio is spent — fail over to a healthy spare before giving up.
                # hci1 sat idle for 110 min the night this brief was written; use it.
                spare = failover_target(adapter_mac, await list_adapters()) \
                    if wcfg.get("failover", True) and failovers < max_failovers else None
                if spare:
                    failovers += 1
                    log.critical("watchdog: %s STILL wedged after %d power-cycles — FAILING OVER to spare "
                                 "%s (failover %d/%d)", adapter_mac, max_cycles, spare, failovers, max_failovers)
                    _RECOVER.set()
                    try:
                        await asyncio.sleep(1.5)      # let the device tasks drop the wedged links first
                        _set_active_adapter(spare)    # every reconnect now resolves the spare (adapter_kw)
                        adapter_mac = spare
                        sel = f"select {adapter_mac}\n"
                        for d in cfg.get("devices", []):
                            if d.get("optional"):
                                continue              # a backup that never joined is not worth a bond wait
                            try:                      # bond on the spare so the reconnect can authenticate
                                await bonding.ensure_bonded(d["address"], adapter_mac, force=True)
                            except Exception as e:
                                log.warning("watchdog: failover bond of %s on %s failed: %r",
                                            d["name"], adapter_mac, e)
                    finally:
                        _RECOVER.clear()              # device tasks resume + reconnect on the spare
                    cycles = consecutive = 0          # a fresh reset budget on the new radio
                    continue
                if wcfg.get("exit_on_giveup"):
                    log.critical("watchdog: adapter STILL wedged after %d power-cycles — exiting non-zero "
                                 "so systemd re-execs with a fresh bleak/D-Bus stack", max_cycles)
                    _STOP.set(); _EXIT_CODE[0] = 1; return   # VIGIL-DEEP-ANALYSIS §2C
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
                # A soft power off/on does not clear an RTL8761B firmware hang — the radio returns
                # "powered but deaf". Escalate: HCI-reset the controller, and on the LAST cycle before
                # give-up re-enumerate the USB dongle if its bus-port is configured (VIGIL-DEEP-ANALYSIS §2D).
                _hci = await adapter_hci()
                if _hci and wcfg.get("hci_reset", True):
                    await _adapter_cmd(["hciconfig", _hci, "reset"]); await asyncio.sleep(2)
                _usb = wcfg.get("usb_path")
                if _usb and cycles >= max_cycles:
                    await _usb_rebind(str(_usb)); await asyncio.sleep(2)
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
            # A FRESH SYNC FORGIVES THE HISTORY. run_polar re-syncs on every reconnect and records the
            # address here on success; the give-up bookkeeping below is task-local, so without this
            # drain a device written off while docked would stay `clock_uncorrectable` for the whole
            # session even after it came off the dock and synced cleanly. Also re-baselines `seen`, or
            # the corrected skew would read as a JUMP and trigger a redundant re-sync next cycle.
            if addr in _CLOCK_FRESHLY_SYNCED:
                _CLOCK_FRESHLY_SYNCED.discard(addr)
                gave_up.discard(addr)
                failed_adrift[addr] = 0
                tried_adrift.pop(addr, None)
                seen.pop(addr, None)
            # A DOCKED DEVICE CANNOT TAKE A CLOCK WRITE. Re-syncing one only burns the give-up budget
            # and ends with it permanently marked uncorrectable — the exact failure observed on the
            # Verity, 2026-07-29. Leave it entirely alone; run_polar syncs it when it comes off.
            if st.get("charging"):
                continue
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
                # The HOST's discipline and the CAPTURE clock's absorbed offset are different facts and
                # both matter to the same question ("can I trust this night's absolute time?"), so they
                # ride the same surface. Absent-as-zero is honest here: zero IS the steady state.
                st["capture_absorbed_sec"] = round(absorbed_shift_sec(), 3)
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
    # WHICH RADIO IS CAPTURING, resolved in the ASYNC body and read by the sync roll_writer below.
    # Kept refreshed on the poll loop rather than resolved once: hci indices RE-ENUMERATE (a controller
    # power-cycle swapped hci0/hci2 on 2026-07-18), so a value captured at start can name the wrong
    # radio by morning — and this string is the night's only record of which one produced it.
    hci_now: list[str | None] = [None]

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
            writer = LinkLogWriter(os.path.join(night, f"Tepna_{_now():%Y%m%d%H%M%S}_LINK.csv"),
                                   adapter=ADAPTER, hci=hci_now[0])
            writer_night = night
            log.info("link provenance → %s", writer.path)
        except Exception as e:
            log.warning("link log unavailable: %r", e)
            writer, writer_night = None, None

    if log_link and root:
        hci_now[0] = await link_rssi.resolve_hci(ADAPTER, refresh=True) if ADAPTER else None
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
                # Re-resolve before rolling: the new file's stamp must name the radio capturing NOW,
                # not the one that was there at boot. This is the only moment it matters, because the
                # stamp is written once per file.
                hci_now[0] = await link_rssi.resolve_hci(ADAPTER, refresh=True) if ADAPTER else None
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
                # THE READ IS AUTHORITATIVE, INCLUDING ITS FAILURE (CAPTURE-HOST-DEEP-AUDIT §B1).
                # `_set(name, rssi=...)` used to run only when the read SUCCEEDED, while the row below
                # unconditionally wrote `st.get("rssi")` — so every unreadable poll re-recorded the last
                # good dBm at a NEW timestamp, indistinguishable from a real measurement. After three
                # consecutive failures the poller goes idle and suppresses reads for `rssi_retry_sec`
                # (600 s), which at a 25 s cadence is 24 further rows all carrying the same stale value.
                # `timeline.bucket_link` then medians the column and the monitor renders it as the
                # night's signal trace.
                #
                # This got WORSE with the fix that preceded it: VIGIL-PPG-GRID-AUDIT §4 tightened
                # `parse_rssi` to -127..-1 so BlueZ's sentinels return None — "Recording 'unknown' is the
                # honest answer" — which strictly increased how often the stale value was logged instead
                # of a blank. An un-polled row is not a measurement; it is blank.
                rssi = None
                if not connected:
                    _set(name, rssi=None)     # a stale reading must not linger on a dropped device
                elif do_rssi:
                    any_link = True
                    rssi = await link_rssi.read_rssi(adapter_mac, addr)
                    if rssi is not None:
                        got_any = True
                    _set(name, rssi=rssi)     # None included — an unreadable poll is not a reading
                if writer:
                    st = STATUS["devices"].get(name, {})
                    # `rssi` from THIS poll, not STATUS: while idle we do not read at all, and carrying
                    # STATUS's value forward is what fabricated the run of identical readings.
                    writer.write(_now(), name, connected, rssi, st.get("battery"),
                                 st.get("frames_dropped"), st.get("frames_duplicated"),
                                 st.get("link_epoch"),    # E5: the reconnect count the 25 s sampling can't miss
                                 addr)                    # the identity a rename cannot break
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
    # Retention only defers to the mirror when there IS one. With archiving off, age is the whole policy
    # and pruning behaves exactly as before — no silent new way for the disk to fill.
    acfg = cfg.get("archive") or {}
    archive_enabled = bool(acfg.get("enabled")) and bool(acfg.get("dest"))
    archive_dest = acfg.get("dest") or "(no dest configured)"
    # Mirrors archive_poller's own default so the "uncovered" report subtracts what is actually being
    # mirrored — a reporter that keeps naming handled subtrees stops being read (audit F2).
    _sub = acfg.get("include_subtrees", ["stored", "cpap"])
    archive_subtrees = [s for s in _sub if isinstance(s, str)] if isinstance(_sub, list) else []
    low_alerted = False
    _retention_block_warned = False
    while not _STOP.is_set():
        try:
            rep = diskguard.disk_report(root, min_free_gb)
            # Protect every night still being WRITTEN, not just _now()'s date: a session running past
            # midnight keeps appending to its start-date folder, and pruning by wall-clock date could
            # sweep that live directory the moment the clock rolls. _now()'s date is a floor so a
            # brand-new night with no files yet (not yet "active") is still never a prune candidate.
            protect = diskguard.active_nights(captures, settle) | {_now().strftime("%Y-%m-%d")}
            # RETENTION IS GATED ON A SECOND COPY (VIGIL-OVERNIGHT-FINDINGS §P3.2). plan_prune deletes by
            # AGE alone, which treats "old" as "safe to lose". It is not: on 2026-07-25 this box had
            # `dest_present:false` — 4 of 10 nights with no marker at all, and the other 6 marked
            # against a volume that is no longer there — so the 15th night would have deleted a
            # recording whose only other copy was on a disk the box cannot see. When archiving is
            # ENABLED, a night is protected until its mirror is CONFIRMED present.
            #
            # The cost is deliberate and is the correct trade for this suite: a broken backup volume now
            # STALLS pruning instead of quietly consuming the only copies. That can fill the disk, so it
            # must never be silent — it is surfaced in status.json, logged edge-triggered, and folded
            # into the low-disk alert text so the reason arrives with the symptom. (This module's own
            # rule: a disk warning is recoverable, deleted recordings are not.)
            blocked: set[str] = set()
            if archive_enabled and keep_nights > 0:
                # `archive_dest` is passed so the gate CONFIRMS the mirror rather than trusting the
                # `.archived` marker — the marker records that a copy was made, not that it survives.
                blocked = await asyncio.to_thread(nightarchive.unarchived_nights, captures, archive_dest)
                protect |= blocked
            # rmtree of a whole night — ~1500 files, ~2 GB — is filesystem work, not arithmetic.
            # disk_report() stays inline (a single statvfs); only the delete is off-loaded.
            pruned = await asyncio.to_thread(diskguard.prune_old_nights, captures, keep_nights, protect)
            if pruned:
                log.info("storage: pruned %d night(s) past the %d-night retention: %s",
                         len(pruned), keep_nights, ", ".join(pruned))
            # Only count nights retention WOULD have taken but for the missing mirror — a young night is
            # protected by age anyway and is not evidence of a backup problem.
            would_prune = set(diskguard.plan_prune(diskguard.list_nights(captures), keep_nights,
                                                   protect - blocked))
            held = sorted(would_prune & blocked)
            if held and not _retention_block_warned:
                _retention_block_warned = True
                log.warning("storage: retention is HELD on %d night(s) past the %d-night policy because "
                            "they were never mirrored to %s — fix the backup volume or disable archiving; "
                            "the disk will fill otherwise: %s",
                            len(held), keep_nights, archive_dest, ", ".join(held))
            elif not held:
                _retention_block_warned = False
            rep = diskguard.disk_report(root, min_free_gb)  # re-read after any prune so status is current
            rep["pruned"] = pruned
            rep["keep_nights"] = keep_nights
            # The monitor must be able to distinguish "retention has nothing to do" from "retention is
            # being HELD" — they look identical in `pruned: []`, and only one of them fills the disk.
            rep["retention_held"] = held
            # WHAT THE MIRROR DOES NOT COVER (audit F2). The card's only backup signal was a count of
            # mirrored NIGHTS, which reads as "the backup is working" on a box where the onboard
            # device-flash pulls and the CPAP EDFs have exactly one copy. Reported, not fixed — see
            # nightarchive.uncovered_subtrees.
            rep["uncovered"] = await asyncio.to_thread(
                nightarchive.uncovered_subtrees, captures, tuple(archive_subtrees)) \
                if archive_enabled else []
            rep["retention_held_reason"] = (
                f"{len(held)} night(s) past the {keep_nights}-night policy are unmirrored "
                f"({archive_dest} absent or failing) — a night is never deleted while it exists on one disk"
            ) if held else None
            STATUS["storage"] = rep
            if rep["low"] and not low_alerted:             # edge-triggered: one alert per low episode
                low_alerted = True
                # Ship the CAUSE with the symptom. A "disk low" alert on a box whose pruning is held
                # by a dead backup volume is otherwise actively misleading — it reads as "raise
                # keep_nights", which is the one action that would not help.
                extra = (f" Retention is HELD on {len(held)} unmirrored night(s) — fix the backup "
                         f"volume ({archive_dest}); raising keep_nights will NOT free space.") if held else \
                        " Captures may soon fail — free space or raise keep_nights."
                # THE JOURNAL LINE IS OUTSIDE THE NOTIFIER BRANCH (CAPTURE-HOST-DEEP-AUDIT §C2). There
                # was NO log call for the low-free-space condition anywhere in this file, so on a box
                # with no webhook the edge was recorded only in `status.json` and `/api/storage` — both
                # PULL surfaces, visible if you go and look. diskguard's own header states the intent
                # ("a full filesystem turned every subsequent night into a silent loss … so the
                # emergency signal is loud"); it was loud only where a webhook existed. Same shape as
                # the retention-held warning ten lines up, which always did log.
                log.warning("storage: LOW — only %s GB free (%s%%).%s",
                            rep["free_gb"], rep["free_pct"], extra)
                if notifier:
                    await notifier.send("Tepna: disk low",
                                        f"Only {rep['free_gb']} GB free ({rep['free_pct']}%)." + extra)
            elif not rep["low"]:
                if low_alerted:
                    log.info("storage: recovered — %s GB free (%s%%)", rep["free_gb"], rep["free_pct"])
                low_alerted = False
        except Exception as e:                             # storage bookkeeping must never take capture down
            log.warning("storage poll failed: %r", e)
        await asyncio.sleep(interval)


async def alert_poller(cfg: dict, notifier: "alerts.Notifier"):
    """Push a webhook alert when a configured sensor goes OFFLINE and stays offline past `offline_sec`
    (edge-triggered, so a flapping link cannot spam), and a 'recovered' note when it returns. A lost night
    is unrecoverable, so this is the difference between fixing a dead battery at 1am and finding out at
    breakfast.

    THE CONDITION IS LOGGED BEFORE IT IS DELIVERED, AND THE LATCH FOLLOWS THE DELIVERY
    (CAPTURE-HOST-DEEP-AUDIT §C1). This used to `alerted.add(name)` FIRST and discard `send()`'s return
    value, while `Notifier.send` swallowed every exception without a log — so one failed webhook POST
    silenced the alert for the whole offline episode, which for the dead-battery case this exists to
    catch is the whole night. Measured: 40 poll iterations, ONE attempt, zero journal lines at DEBUG or
    above. `qc_poller`'s frozen-device path already had the right shape one function down — "WARNING even
    with no webhook configured. The journal is the only alerting surface a box without one has."

    The latch is per EPISODE, not per process: `alerted.discard(name)` on reconnect."""
    acfg = cfg.get("alerts") or {}
    interval = float(acfg.get("poll_sec", 60))
    threshold = float(acfg.get("offline_sec", 300))
    # How stale the last sample may be before a link stops counting as a recording. Comfortably longer
    # than the poll (60 s) and than any normal inter-frame gap, so a healthy device never flickers; far
    # shorter than `offline_sec`, so a link that streams nothing is caught by the SAME 5-minute alarm a
    # disconnected one is.
    data_grace = float(acfg.get("data_stale_sec", 120))
    down_since: dict[str, float] = {}
    alerted: set[str] = set()
    # Devices seen connected at least once this session. An `optional: true` device that never joined is
    # not something capture is "missing" (alerts.offline_alert_suppressed holds the reasoning); one that
    # joined and then dropped is, so the distinction has to be remembered rather than re-derived.
    ever_connected: set[str] = set()
    while not _STOP.is_set():
        await asyncio.sleep(interval)
        now = _time.monotonic()
        for d in cfg.get("devices", []):
            name = d.get("name")
            if not name:
                continue
            connected = bool(STATUS["devices"].get(name, {}).get("connected"))
            if connected:
                ever_connected.add(name)
            # RECORDING, not merely LINKED. Keying recovery on `connected` turned a 4.5 h outage into
            # four "resolved" blips, because an unbonded H10 is briefly connected inside every doomed
            # connect→drop cycle. Only flowing samples clear the alarm.
            recording = alerts.device_is_recording(connected, _LAST_DATA.get(name), now, data_grace)
            if recording:
                down_since.pop(name, None)
                if name in alerted:                        # it had alerted → tell the operator it is back
                    alerted.discard(name)
                    log.info("alert: %s recording again", name)
                    await notifier.send("Tepna: sensor recovered", f"{name} is recording again.")
            else:
                down_since.setdefault(name, now)
                if alerts.offline_alert_suppressed(d.get("optional"), name in ever_connected):
                    continue                               # never showed up; not a thing we are missing
                if name not in alerted and alerts.offline_alert_due(down_since[name], now, threshold):
                    mins = int((now - down_since[name]) / 60)
                    # NAME THE FAILURE. "offline" and "linked but silent" want different responses from
                    # the operator — the first is a flat battery or an out-of-range strap, the second is
                    # the bond/PMD failure that cost 2026-07-29. Saying "offline" for a device sitting
                    # right there, connecting every 70 s, sends them looking for the wrong thing.
                    how = "offline" if not connected else "linked but recording nothing"
                    # The journal FIRST, unconditionally — a box with no webhook has no other surface,
                    # and a box whose webhook is broken must still leave the event behind.
                    log.warning("alert: %s has been %s for ~%d min — capture is missing it",
                                name, how, mins)
                    delivered = await notifier.send(
                        "Tepna: sensor offline",
                        f"{name} has been {how} for ~{mins} min — capture is missing it.")
                    # Latch on the OUTCOME. A failed POST must be retried next poll, not treated as
                    # "the operator has been told". `not notifier.enabled` still latches: with alerting
                    # off there is nothing to retry, and re-logging every 60 s all night is noise.
                    if delivered or not notifier.enabled:
                        alerted.add(name)


def qc_digest_due(now, digest_hour: int, last_sent_date) -> bool:
    """PURE: send the morning QC digest now? `digest_hour < 0` disables.

    Delegates to `cpap_harvest.due_now` — a BOUNDED window with a wrap-safe once-per-day key — rather
    than a bare `now.hour >= digest_hour` floor. That floor was this function's first draft, and it is
    the exact pattern `due_now`'s docstring records as "wrong and shipped once": every daemon restart
    after the hour re-arms the job, so a 19:25 restart would re-send the morning digest at bedtime.
    The precedent existed 300 lines away, tested, with the bug's measured cost written on it; this is
    the inheritance the first draft skipped (same shape as the DSPs never inheriting §2.6)."""
    if digest_hour < 0:
        return False
    import cpap_harvest  # function-local, matching this file's existing cpap imports — keeps
    #                      `import capture` free of the telemetry chain until the feature is used
    return cpap_harvest.due_now(now, digest_hour, last_sent_date, window_h=3)


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
    # Morning digest (VIGIL-OVERNIGHT-FINDINGS §P2.4): the missing-stream alert fires only when
    # something is WRONG, so a good night sends nothing and the coverage number never reaches the
    # owner. This is the unconditional once-a-day counterpart.
    # ⚠ DEFAULT IS OFF (-1), deliberately — enable per box via `qc.digest_hour`. An on-by-default
    # hour makes every test that reaches this poller with a notifier TIME-OF-DAY DEPENDENT, and that
    # is measured, not theoretical: the same commit ran green locally before 09:00 EDT and red in CI
    # at ≥09:00 UTC. A default whose test outcome depends on the wall clock is a flake generator.
    digest_hour = int(qcfg.get("digest_hour", -1))
    digest_sent_date = None
    # A CONNECTED SENSOR THAT HAS STOPPED SENDING. Much shorter grace than alert_after: this is not
    # "the night has not started yet", it is "the link is up and the bytes are not coming". Every PMD
    # stream we start delivers many rows a second, so ten minutes of nothing behind a live link is
    # never slow — it is dead. Same reasoning as the 90 s in-session stall watchdog, at the coarser
    # cadence QC polls on, and it catches the case the watchdog cannot: a task stuck BEFORE it.
    frozen_after = float(qcfg.get("frozen_after_sec", 600))
    settle = float((cfg.get("storage") or {}).get("settle_sec", _NIGHT_SETTLE_S))
    captures = os.path.join(root, "captures")
    first_seen: dict[str, float] = {}      # night → monotonic ts we first saw it with data
    alerted: set[str] = set()              # nights already alerted (edge-trigger, one per night)
    frozen_alerted: set[str] = set()       # night:device — one warning per frozen sensor per night
    canary_alerted: set[str] = set()       # night:message — one warning per dead sidecar per night
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
            # ── morning digest — once per LOCAL day, unconditional (§P2.4) ──────────────────────
            _dnow = _now()
            if notifier and qc_digest_due(_dnow, digest_hour, digest_sent_date):
                _line = nightqc.qc_digest(summ)
                if _line:  # an empty night sends NOTHING — the digest must never train the reader that
                    # it is noise. The consumed key is the WINDOW's start date (wrap-safe), marked
                    # before the await like every sender here.
                    import cpap_harvest
                    digest_sent_date = cpap_harvest.window_start_date(_dnow, digest_hour, 3)
                    await notifier.send("Tepna night QC", _line, key=f"qc-digest-{digest_sent_date}")
            # A SENSOR THAT IS CONNECTED AND SENDING NOTHING. Distinct from `missing` (which means
            # "produced nothing all night" and therefore cannot see a mid-night freeze) and from the
            # offline alert (which needs the link to actually drop). This is the 2026-07-25 Verity:
            # four streams acknowledged `ok`, link up for 4 h 25 m, zero bytes, nothing said a word.
            for _name in alerts.frozen_devices(summ, STATUS.get("devices") or {}, frozen_after):
                _key = f"{n}:{_name}"
                if _key in frozen_alerted:
                    continue
                frozen_alerted.add(_key)
                _sil = next((d.get("silent_sec") for d in summ["devices"]
                             if d.get("name") == _name), 0) or 0
                # WARNING even with no webhook configured. The journal is the only alerting surface a
                # box without one has, and this failure previously left no trace at all in it.
                log.warning("qc: %s is CONNECTED but has written nothing for %d min — the link is up "
                            "and the data is not arriving", _name, int(_sil / 60))
                if notifier:
                    await notifier.send(
                        "Tepna: sensor connected but silent",
                        f"{_name} has sent no data for ~{int(_sil / 60)} min while the night is still "
                        f"recording. The link is up, so this is not a dropout.")

            # A DEAD PACKET-ARRIVAL SIDECAR, which nothing else can see. The sidecar write is wrapped in
            # a bare `except: pass` — telemetry must never disturb the data callback — so a persistent
            # failure is invisible BY CONSTRUCTION, and the offset floor it exists to recover just stops
            # being recoverable. `arrival_canary` was written for exactly this and, until now, was called
            # by nothing outside its tests: a correct answer with no consumer.
            #
            # ⚠️ WIRED ONLY AFTER CHECKING IT AGAINST THE REAL CORPUS, because its sibling `smeared` arm
            # was retired for firing on EVERY stream on the first real night (2026-08-11) — a premise
            # that was wrong rather than a threshold that was loose. Measured over every session on the
            # box: 355 with a sidecar, ZERO that would fire. The 812 sessions without a sidecar at all
            # are entirely pre-2026-08-11, when the feature did not exist — every session on or after
            # that date has one, so the abstention is historical and not a live blind spot.
            for _msg in alerts.arrival_canary(summ, STATUS.get("devices") or {}):
                _ckey = f"{n}:{_msg}"
                if _ckey in canary_alerted:
                    continue
                canary_alerted.add(_ckey)
                log.warning("qc: %s — the packet-arrival sidecar is not advancing, so the per-connection "
                            "BLE offset cannot be recovered for this stream", _msg)
                if notifier:
                    await notifier.send(
                        "Tepna: packet-arrival sidecar dead",
                        f"{_msg}. Sample data is still being written, so this will not show up as a "
                        f"dropout — but the timing sidecar for this stream is producing nothing.")
            if summ.get("scope_suspect"):
                # A SCOPE RESULT, NOT A DEVICE FAULT (nightqc's scope_suspect holds the reasoning).
                # Nine independent streams across three vendors do not fail in the same second, so
                # naming them one by one — as this line did every ten minutes for six hours on
                # 2026-07-28, while 942 MB was being recorded next door — describes the wrong object
                # and sends the reader hunting hardware. Say what is actually true: we could not find
                # the session. WARNING, not INFO: the box's own report was right there and read as
                # routine. And no "night has a gap" alert — we have not established that there is one.
                log.warning("qc: %s holds no capture file (searched %s) — cannot locate the active "
                            "session, so the %d 'missing' stream(s) below are a SCOPE result, not a "
                            "device fault: %s", summ.get("judged_dir"),
                            " + ".join(summ.get("searched_dirs") or []),
                            len(summ["missing"]), ", ".join(summ["missing"]))
            elif summ["missing"]:
                log.info("qc: %s missing stream(s): %s", n, ", ".join(summ["missing"]))
                waited = _time.monotonic() - first_seen[n]
                if notifier and n not in alerted and waited >= alert_after:
                    alerted.add(n)                         # one alert per night, no matter how many polls
                    await notifier.send("Tepna: night has a gap",
                                        f"{n}: no data on {', '.join(summ['missing'])} "
                                        f"{int(waited / 3600)}h into the night.")
        except Exception as e:                             # QC is observability — never take capture down
            log.warning("qc poll failed: %r", e)


async def _archive_transfer(captures: str, target: dict, settle: float, schedule: dict) -> None:
    """Push every settled, not-yet-confirmed night to a TRANSFER target (rsync over SSH).

    The `.archived` marker is written only on a VERIFIED push — a copy that a follow-up `--dry-run`
    confirms the remote already matches. That is the same line VIGIL-HARDENING-II §1.3 had to draw for
    the local mirror: "we ran a copy" is not "a second copy exists", and only the latter may release a
    night to the retention gate. An unverified push leaves the night unmarked, so it is retried next
    cycle and retention keeps holding it — the safe direction."""
    active = await asyncio.to_thread(diskguard.active_nights, captures, settle)
    for night in nightarchive.pending_nights(captures, active):
        src = os.path.join(captures, night)
        res = await storage_targets.push_night(src, target)
        STATUS.setdefault("archive", {}).update(
            {"last_attempt": night, "target": f"{target['protocol']}://{target.get('host','')}",
             "ok": res["ok"], "verified": res["verified"], "detail": res["detail"]})
        if res["ok"] and res["verified"]:
            open(os.path.join(src, nightarchive._MARKER), "w").close()
            STATUS["archive"]["last"] = night
            log.info("archive: pushed %s → %s (%s)", night, target.get("host"), res["detail"])
        else:
            log.warning("archive: %s NOT confirmed on %s — %s (night stays held)",
                        night, target.get("host"), res["detail"])
            break          # a failing link will fail for every night; stop rather than hammer it


async def archive_poller(cfg: dict, root: str):
    """Mirror each COMPLETED night (not tonight — still being written) to a configured destination: a NAS
    mount, the served dir, a backup disk. Idempotent + resumable (a `.archived` marker per night). MIRROR,
    never move — the source stays for the retention guard to prune on its own schedule. No-op unless
    archive.enabled + archive.dest are set."""
    acfg = cfg.get("archive") or {}
    target = acfg.get("target") or None
    # A TRANSFER target (rsync) has no local dest — the night is pushed straight off the box. A MOUNT
    # target is its mountpoint, which is what `dest` already meant, so the mirror path below is unchanged.
    transfer = bool(target) and target.get("kind") == "transfer"
    if not acfg.get("enabled") or not (acfg.get("dest") or transfer):
        return
    dest = acfg.get("dest")
    # Non-night trees to mirror (audit F2). Defaults ON for the two that exist — the exposure they left
    # is real and they cost 0.4 % of a night — and `nightarchive` refuses `incoming/` and any night dir
    # regardless of what lands here. A non-list config value is ignored rather than crashing the poller.
    subtrees = acfg.get("include_subtrees", ["stored", "cpap"])
    subtrees = [s for s in subtrees if isinstance(s, str)] if isinstance(subtrees, list) else []
    interval = float(acfg.get("poll_sec", 3600))
    settle = float((cfg.get("storage") or {}).get("settle_sec", _NIGHT_SETTLE_S))
    captures = os.path.join(root, "captures")
    try:
        schedule = storage_targets.validate_schedule(acfg.get("schedule"))
    except storage_targets.StorageError as e:
        log.warning("archive: bad schedule (%s) — falling back to after_settle", e)
        schedule = {"mode": "after_settle"}
    last_run: _dt.datetime | None = None
    _archive_dest_warned = False       # edge-trigger the "dest not present" warning, one per absence
    while not _STOP.is_set():
        await asyncio.sleep(interval)
        try:
            # WHEN. `after_settle` offloads as soon as a night goes quiet (the old behaviour). `daily`
            # holds until a wall-clock window — the point of which is that a 350 MB/night push over the
            # LAN should be allowed to happen while nobody is sleeping next to the box, and while the
            # link is not also carrying three live BLE streams.
            if not storage_targets.due(schedule, _now(), last_run):
                continue
            if transfer:
                await _archive_transfer(captures, target, settle, schedule)
                last_run = _now()
                continue
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
            # THE APPEND-FOREVER TREES (audit F2). `stored/` is the onboard device-flash pulls — the
            # backup that exists BECAUSE the live BLE link is lossy — and the O2Ring's flash is a small
            # FIFO, so once it rotates the box copy is the only one anywhere. `cpap/` is 199 nights of
            # harvested EDFs. Together 0.4 % of a single night's bytes, so the disk-budget question
            # this was deferred for does not exist. Same to_thread reasoning as the night loop above.
            # These are NEVER pruned — see mirror_subtree's warning before changing that.
            for name in subtrees:
                n = await asyncio.to_thread(nightarchive.mirror_subtree, captures, name, dest)
                if n:
                    log.info("archive: mirrored %d new file(s) from %s/ → %s", n, name, dest)
                    STATUS.setdefault("archive", {}).setdefault("subtrees", {})[name] = n
        except Exception as e:                             # offload is best-effort — never take capture down
            log.warning("archive failed: %r", e)


async def pull_polar_offline_all(dev: dict, root: str) -> dict:
    """Pull ALL of a Polar device's ONBOARD offline recordings off flash (POLAR-OFFLINE-DOWNLOAD) — the
    Polar sibling of pull_oxyii_session. Runs under polar_offline_op so it owns the device's single BLE
    link (capture pauses, then resumes). Idempotent: pull_recording skips a file already on disk at the
    same size, so a repeat pull only fetches genuinely new bytes — true as of 2026-08-01; this docstring
    asserted it for months while the code re-downloaded the whole flash every time (audit F3b).
    Returns {sessions, pulled, new_files, short, ok}. A truncated file is reported, never counted as
    pulled: these onboard recordings are the backup for a lossy live link, so one that looks complete
    and is not is the worst outcome available here."""
    import polar_psftp        # runtime-only (pulls bleak) — keeps `import capture` stdlib-clean for CI
    address = dev["address"]
    did = dev.get("device_id") or address.replace(":", "")
    out_base = os.path.join(root, "captures", "stored")

    async def _op():
        hci = await adapter_hci()
        sessions = await polar_psftp.list_recordings(address, adapter=hci)
        pulled, new_files, short = 0, [], []
        for sess in sessions:
            path = sess.get("path")
            if not path:
                continue
            stamp = (sess.get("date") or "") + (sess.get("time") or "")
            out_dir = os.path.join(out_base, f"Polar_Offline_{did}_{stamp}")
            m = await polar_psftp.pull_recording(address, path, out_dir, adapter=hci)
            pulled += 1
            new_files.extend((m or {}).get("new_files") or [])
            short.extend((m or {}).get("short") or [])
        if short:
            # LOUD, because the journal is the only alerting surface a box with no webhook has, and a
            # truncated backup is exactly the thing you want to know about before the disk guard prunes
            # the live copy of the same night.
            log.warning("%s: %d offline file(s) came back SHORT and were left as .part — the next pull "
                        "re-fetches them: %s", dev.get("name") or address, len(short), "; ".join(short[:3]))
        return {"sessions": len(sessions), "pulled": pulled, "new_files": new_files,
                "short": short, "ok": not short}

    return await polar_offline_op(address, _op, timeout=_OFFLINE_OP_TIMEOUT_S)


# On-charger auto-pull state. A device goes on the charger the moment a night ends, so "on charger" is the
# natural 'night is over — grab the onboard backup' trigger, and far faster than autopull_poller's hourly
# cadence (VIGIL-DEEP-ANALYSIS §2C: the old poller could delay the pull up to an hour).
_OPT_QUIET: set[str] = set()            # optional backup devices we have already noted as absent (log-once)
_CHARGER_SINCE: dict[str, float] = {}   # addr -> monotonic when charging went True (absent = not charging)
_CHARGER_PULLED: set[str] = set()       # addrs already pulled THIS charge session (cleared when off charger)
_NOTWORN_SINCE: dict[str, float] = {}   # addr -> monotonic when worn went False (absent = worn/unknown)
_NOTWORN_PULLED: set[str] = set()       # addrs already pulled THIS doff session (cleared when worn again)


def autopull_arming(pcfg: dict) -> dict:
    """Which event triggers arm, and — when one does not — WHICH FLAG SAID SO. PURE.

    🔴 THIS EXISTS BECAUSE THE EVENT PATH HAD NEVER ARMED, AND NOTHING SAID SO. Measured on the box
    2026-08-24: `auto-pull: armed` appears **0** times in the whole journal against **312** poller
    lines, and no trigger has ever fired. The loop returned on `not pcfg.get("on_charger", True)` —
    and `on_charger` reads as a CHARGER flag while also gating the NOT-WORN trigger, which
    `notworn_pull_due` calls "the only reachable trigger for a coin-cell device such as the H10". So
    one charger-shaped flag silently disabled the H10's only retrieval path, and the symptom was an
    ABSENT LOG LINE: nothing failed, nothing errored, and no gate can observe a line never printed.

    ⚠️ `on_doff` DEFAULTS TO `on_charger`'s EFFECTIVE VALUE, deliberately, and that is the whole
    back-compat design. Defaulting it True would arm a never-executed path on the next auto-deploy;
    defaulting it False would silently disarm the doff trigger on every host that leaves `on_charger`
    at its default. Inheriting reproduces today's behaviour EXACTLY on every host, so the split is
    semantically neutral until somebody edits config on purpose — enabling a path that has never run
    is an event, not a side effect of deploying.

    ⚠️ `on_close` DOES NOT INHERIT, and the asymmetry with `on_doff` is the point. `on_doff` inherits
    because it was SPLIT OUT of an existing flag and had to reproduce existing behaviour exactly.
    `on_close` names a path that has never run anywhere, so there is no behaviour to preserve — and
    `pull.on_doff` is currently ENABLED on the box for the awake-tail measurement (brief §6a), which
    means an inheriting `on_close` would switch the close-triggered harvest on at the next daemon
    restart. That is precisely the silent deployed-behaviour change §7's Done-when forbids. It defaults
    OFF and is turned on by an edit somebody makes on purpose."""
    auto = bool(pcfg.get("auto"))
    on_charger = bool(pcfg.get("on_charger", True))
    on_doff = bool(pcfg.get("on_doff", on_charger))
    on_close = bool(pcfg.get("on_close", False))
    if not auto:
        return {"charger": False, "doff": False, "close": False, "why": "pull.auto is off"}
    why = []
    if not on_charger:
        why.append("pull.on_charger=False")
    if not on_doff:
        why.append("pull.on_doff=False" if "on_doff" in pcfg
                   else "pull.on_doff absent -> inherits on_charger=False")
    if not on_close:
        why.append("pull.on_close=False" if "on_close" in pcfg
                   else "pull.on_close absent -> defaults OFF (never inherits)")
    return {"charger": on_charger, "doff": on_doff, "close": on_close, "why": "; ".join(why)}


def charger_pull_due(charging: bool, since, now: float, settle: float, already: bool) -> bool:
    """PURE: pull this device's onboard sessions now? True once it has been ON THE CHARGER for at least
    `settle` seconds and has not already been pulled this charge session."""
    return bool(charging and not already and since is not None and (now - since) >= settle)


def notworn_pull_due(worn, since, now: float, settle: float, already: bool) -> bool:
    """PURE: pull this device's onboard sessions now, on the NOT-WORN edge?

    WHY THIS EXISTS. `charger_pull_due` is the natural 'the night is over' trigger, and it cannot fire for
    a device that never charges: the H10 runs on a CR2025 coin cell, so `charging` is permanently False and
    the whole on-charger path is unreachable for it. The pull MECHANISM already works for Polar
    (`pull_polar_offline_all` → `polar_offline_op` → PS-FTP); only the trigger was missing. Recording
    without retrieval fills the single onboard slot once and then silently records nothing — the parent
    brief's fabricated-absence class (`POLAR-ONBOARD-BACKUP-FOLLOWUPS` §4).

    ⚠ `worn is False`, NOT falsy. `worn` is tri-state and `None` means NO VERDICT — a device with no
    contact bit and no optical inference. Treating `None` as not-worn would pull against a device that may
    still be on the body mid-recording, and it is the same `worn is not False` convention the power drop
    and `cpap_harvest.blocking_devices` already use.

    ⚠ THE SETTLE MUST EXCEED THE POWER-DROP GRACE, and the caller enforces it. A pull needs a connection;
    the not-worn power drop (`should_drop_not_worn`, `_DROP_NOT_WORN_SEC` = 180 s) disconnects. Firing the
    pull inside the grace window would hold the link open and BLOCK the drop, which is the one thing §4
    said this must never do. With settle > grace the drop happens first and the pull reconnects fresh, so
    the two cooperate instead of racing."""
    return bool(worn is False and not already and since is not None and (now - since) >= settle)


async def charger_pull_poller(cfg: dict, root: str):
    """Pull a device's ONBOARD recordings `settle` s after it is placed ON THE CHARGER — the fast,
    event-driven sibling of autopull_poller's hourly cadence. Applies to the O2Ring (OxyII .dat) AND
    Polar devices with onboard offline recordings (Verity / H10, PS-FTP). Opt-in under `pull.auto`; the
    charger trigger is `pull.on_charger` (default on) with `pull.charger_settle_sec` (default 15). SAFE:
    a charging device is not capturing, so pausing it costs nothing; each pull is bounded + connect-locked
    (pull_oxyii_session / pull_polar_offline_all → polar_offline_op). A failed pull falls back to the
    hourly autopull_poller rather than retry-spamming."""
    pcfg = cfg.get("pull") or {}
    _arm = autopull_arming(pcfg)
    if not (_arm["charger"] or _arm["doff"] or _arm["close"]):
        # The absence-shaped failure becomes present-shaped: say NOT armed, and name the flag.
        log.info("auto-pull: NOT armed — no event trigger enabled (%s). The hourly poller still runs; "
                 "it is a reconciliation net, not the primary path.", _arm["why"] or "pull.auto is off")
        return
    settle = float(pcfg.get("charger_settle_sec", 15))
    # ⚠ THE DOFF SETTLE IS CLAMPED ABOVE THE POWER-DROP GRACE, not merely defaulted above it. A pull holds
    # a connection; `should_drop_not_worn` wants to close one. Firing inside the grace window would block
    # the drop — the one thing §4 forbids — so a config that sets it lower is raised rather than obeyed.
    _doff_cfg = float(pcfg.get("notworn_settle_sec", 300))
    doff_settle = max(_doff_cfg, _DROP_NOT_WORN_SEC + 30.0)
    if doff_settle > _doff_cfg:
        log.info("auto-pull (not-worn): settle raised %.0fs → %.0fs to clear the %.0fs power-drop grace",
                 _doff_cfg, doff_settle, _DROP_NOT_WORN_SEC)
    ftype = int(pcfg.get("ftype", 0))
    devices = [d for d in cfg.get("devices", [])
               if not missing_identity(d) and d.get("vendor") in ("Wellue", "Viatom", "Polar")]
    if not devices:
        return
    # ⚠ ALL THREE STATES ON ONE LINE, including the ones that are OFF. Unit 1 exists because an absent
    # arming line hid a dead path for months; printing only what is enabled would rebuild that blind
    # spot one flag along. `close` is the §8/§14 close-triggered harvest — it keys on END_CANDIDATE
    # rather than on a settle, so it has no settle to report.
    log.info("auto-pull: armed — %d device(s); charger=%s (%.0fs) not-worn=%s (%.0fs) on-close=%s%s. "
             "The not-worn trigger is the only reachable one for a coin-cell device such as the H10.",
             len(devices), "on" if _arm["charger"] else "OFF", settle,
             "on" if _arm["doff"] else "OFF", doff_settle,
             "on" if _arm["close"] else "OFF",
             f" — {_arm['why']}" if _arm["why"] else "")
    while not _STOP.is_set():
        await asyncio.sleep(2)
        if _RECOVER.is_set() or _OXYII_PAUSE.is_set():
            continue                                   # mid-recovery or another pull already running
        now = _time.monotonic()
        for dev in devices:
            addr = dev.get("address")
            st = STATUS["devices"].get(dev.get("name"), {})
            # ── TRIGGER 1: on the charger ────────────────────────────────────────────────────────
            charging = bool(st.get("charging"))
            if not charging:
                _CHARGER_SINCE.pop(addr, None)
                _CHARGER_PULLED.discard(addr)          # off the charger — re-arm for next time
            else:
                _CHARGER_SINCE.setdefault(addr, now)
            # ── TRIGGER 2: taken off the body (the ONLY reachable trigger for a coin-cell device) ─
            worn = st.get("worn")
            if worn is not False:
                _NOTWORN_SINCE.pop(addr, None)
                _NOTWORN_PULLED.discard(addr)          # back on the body (or no verdict) — re-arm
            else:
                _NOTWORN_SINCE.setdefault(addr, now)
            by_charger = _arm["charger"] and charging and charger_pull_due(
                True, _CHARGER_SINCE.get(addr), now, settle, addr in _CHARGER_PULLED)
            by_doff = _arm["doff"] and notworn_pull_due(worn, _NOTWORN_SINCE.get(addr), now, doff_settle,
                                       addr in _NOTWORN_PULLED)
            if not (by_charger or by_doff):
                continue
            trigger = "charger" if by_charger else "not-worn"
            if by_charger:
                _CHARGER_PULLED.add(addr)               # once per charge session (before the await)
            if by_doff:
                _NOTWORN_PULLED.add(addr)               # once per doff session (before the await)
            try:
                if dev.get("vendor") in ("Wellue", "Viatom"):
                    res = await pull_oxyii_session(dev, root, which="all", ftype=ftype)
                else:
                    res = await pull_polar_offline_all(dev, root)
                new = (res or {}).get("new_files", []) if isinstance(res, dict) else []
                log.info("auto-pull (%s): %s → %d new file(s)", trigger, dev.get("name"), len(new))
                STATUS.setdefault("autopull", {}).update({"last": _now().isoformat(timespec="seconds"),
                                                          "new": len(new), "trigger": trigger})
            except offline_lock.OfflineBusy:
                _CHARGER_PULLED.discard(addr)           # slot held by another pull — retry next tick
                _NOTWORN_PULLED.discard(addr)
            except Exception as e:                      # unreachable/transient — leave pulled; the hourly
                log.info("auto-pull (%s): %s failed (%s) — hourly poller is the backstop", trigger,
                         dev.get("name"), type(e).__name__)   # autopull_poller is the backstop, no spam


async def cpap_poller(cfg: dict, root: str, notifier: "alerts.Notifier | None" = None):
    """Harvest the ResMed card off its ez Share Wi-Fi SD adapter, once a day, while nothing is streaming.
    Executes `CPAP-AUTOHARVEST-2026-07-26-BRIEF.md`. Opt-in (`cpap.enabled`).

    NOT a device runner. CPAP joins Tepna as FILES, not a BLE stream (`CPAPDEX-PHASE9-FOLLOWUPS §2`), so
    this touches no adapter, takes no connect lock, and adds nothing to `STATUS["devices"]`.

    SAFE BY CONSTRUCTION — the ordering here is the whole design:
      • ONE fixed daily window (`cpap.at_hour`, default 13), never a poll loop. The card is 2.4 GHz-only
        and `CAPTURE-HOST §5` names 2.4 GHz contention a first-order risk against the four BLE links this
        box holds all night; the upstream ez Share projects poll every 65 s–15 min, which would put a
        Wi-Fi transmitter beside the bed competing with exactly the links whose margin already cost
        ~110 min on 2026-07-23.
      • 13:00, not the 09:00 first proposed — measured on the real card, 6 of the 14 most recent nights
        were STILL BEING WRITTEN after 09:00 (last-write 08:35→12:02, median 08:56), and the late files
        are the big ones. A 09:00 pull would routinely take the two small files, miss the flow waveform,
        and report success.
      • Refuses while ANY sensor is connected, and while `_RECOVER` is set — same rule as
        `autopull_poller`. A CPAP file is never worth a scratch on a live night.
      • Whole run is deadline-capped, and the association is torn down in `finally` so a failure can
        never strand the box's Wi-Fi on a card with no route.
      • Zero files on a day the machine ran is an ALERT, not a silent no-op: the
        `writers.IDENTITY_FIELDS` lesson — "remembered ✓", then silently never captured.
    """
    ccfg = cfg.get("cpap") or {}
    if not ccfg.get("enabled"):
        return
    import cpap_harvest

    at_hour = int(ccfg.get("at_hour", 13))
    profile = str(ccfg.get("wifi_profile", "ezshare"))
    # The wpa backend (no NetworkManager — precisely the vigil box) does not read `wifi_profile` at
    # all; it needs an INTERFACE, which used to be the module constant `wlp1s0` with no config key
    # (CAPTURE-HOST-DEEP-AUDIT §E5). Default is discovered, not a literal.
    wifi_iface = str(ccfg.get("wifi_iface") or cpap_harvest.default_wifi_iface())
    base = str(ccfg.get("base_url", cpap_harvest.DEFAULT_BASE))
    dest = os.path.join(root, str(ccfg.get("dest_subdir", "captures/cpap")))
    max_run = float(ccfg.get("max_run_sec", 5400))
    timeout = float(ccfg.get("timeout_sec", 20))
    retries = int(ccfg.get("retries", 5))

    STATUS["cpap"] = {"enabled": True, "state": "idle", "at_hour": at_hour, "dest": dest}
    log.info("cpap: harvest enabled — daily at %02d:00 into %s (only while nothing is streaming)",
             at_hour, dest)

    def _st(**kv):
        STATUS.setdefault("cpap", {}).update(kv)

    # Release any association left over from a run that died mid-transfer (SIGKILL, OOM, power cut).
    # `keep_running` restarts this task on any escaping exception, so without this the box could sit
    # associated to a routeless card indefinitely with nothing to explain why Wi-Fi looked occupied.
    await asyncio.to_thread(cpap_harvest.wifi_down, profile, 30.0, wifi_iface, root)
    try:
        await _cpap_loop(at_hour, profile, base, dest, max_run, timeout, retries, _st, wifi_iface, root,
                         notifier)
    finally:
        # Whatever ends this task — shutdown, cancellation, an escaping error — the card is released.
        # shield() because at shutdown this task is already being cancelled and a bare await here would
        # be cancelled with it, leaving exactly the stranded association this block exists to prevent.
        with contextlib.suppress(Exception):
            await asyncio.shield(asyncio.to_thread(cpap_harvest.wifi_down, profile, 30.0, wifi_iface, root))


async def _cpap_loop(at_hour, profile, base, dest, max_run, timeout, retries, _st, wifi_iface=None,
                     root=None, notifier=None):
    """The daily loop, split out so `cpap_poller` can wrap it in a teardown-guaranteeing `finally`."""
    import cpap_harvest
    last_run_date = None
    while not _STOP.is_set():
        await asyncio.sleep(60)
        if _STOP.is_set():
            break
        now = _dt.datetime.now()
        if not cpap_harvest.due_now(now, at_hour, last_run_date):
            continue
        if _RECOVER.is_set():
            continue                                    # adapter mid-recovery — do not add radio traffic
        busy = cpap_harvest.blocking_devices(STATUS["devices"])
        if busy:
            # Do NOT consume today's slot: leave last_run_date unchanged so it retries next minute once
            # the sensor comes off. A daily job that burns its one chance on a late-sleeping user is a
            # job that silently skips days.
            _st(state="waiting", detail="streaming: " + ", ".join(busy[:3]))
            continue

        # The WINDOW's start date, not today's (CAPTURE-HOST-DEEP-AUDIT §E4): for a window that wraps
        # midnight these differ, and stamping today would leave `due_now` still asking about yesterday
        # — due again a minute later, forever.
        last_run_date = cpap_harvest.window_start_date(now, at_hour) or now.date()
        started = _time.monotonic()
        _st(state="running", detail=None, last_run=now.isoformat(timespec="seconds"))
        # Note the box's lifeline BEFORE associating, and hand it to wifi_up as a guard. If the default
        # route moves to the card — a routeless dead end — wifi_up tears the association down and fails,
        # and we skip the day. A day of CPAP files is never worth making the box unreachable.
        # ── ALREADY REACHABLE? THEN ASSOCIATE NOTHING. ────────────────────────────────────────────
        # Every privileged step in this harvest exists to join the card's own Wi-Fi AP: ip link,
        # wpa_supplicant, wpa_cli, ip addr add, and the teardown — all `sudo -n`, all needing sudoers
        # entries a stock box does not have. The DOWNLOAD is a plain unauthenticated HTTP GET and never
        # needed a privilege at all. On 2026-07-28 the 13:00 run died at `sudo -n mkdir -p` with
        # "interactive authentication is required" and skipped the day, with the night's therapy data
        # one HTTP request away.
        # An ez Share card can run in station mode and join the house network, at which point the box
        # reaches it over the existing uplink. Probing first means the same build serves both
        # deployments and the privileged branch is simply never entered on the sudo-free one.
        direct = await asyncio.to_thread(cpap_harvest.reachable, base, 5.0)
        guard = None
        if direct:
            log.info("cpap: %s already reachable — harvesting directly, no Wi-Fi association needed", base)
        else:
            # Note the box's lifeline BEFORE associating, and hand it to wifi_up as a guard. If the
            # default route moves to the card — a routeless dead end — wifi_up tears the association
            # down and fails, and we skip the day. A day of CPAP files is never worth making the box
            # unreachable.
            guard = await asyncio.to_thread(cpap_harvest.default_route_dev)
            ok = await asyncio.to_thread(cpap_harvest.wifi_up, profile, 45.0, guard,
                                         "ez Share", "88888888", wifi_iface, cpap_harvest.WPA_ADDR, root)
            if not ok:
                _st(state="error", detail=f"Wi-Fi profile {profile!r} would not come up safely")
                log.warning("cpap: profile %r would not come up, or it moved the default route off %r "
                            "— skipping today (set cpap.base_url to the card's LAN address if it is in "
                            "station mode; then no association is attempted at all)", profile, guard)
                continue
        try:
            res = await asyncio.to_thread(
                cpap_harvest.harvest, dest, base, None, started + max_run, cpap_harvest.DEFAULT_IGNORE,
                timeout, retries)
        except Exception as e:                          # noqa: BLE001 — a harvest must never kill the task
            _st(state="error", detail=repr(e)[:200])
            log.warning("cpap: harvest failed: %r", e)
            # AND TELL THE OPERATOR. This exit — not `barren` below — is the one an absent card takes:
            # `ez.listing()` raises before the walk can complete, so `barren` (which requires a COMPLETED
            # walk that saw nothing) is never evaluated and its alert never fires. Until 2026-08-01 the
            # single most likely field failure therefore published state=error and said nothing, even on
            # a box with a webhook configured. Found by deliberate fault injection against the running
            # box (CPAP-AUTOHARVEST-FOLLOWUPS §2.2): driving the real `harvest()` at an unroutable
            # address raises a RuntimeError whose text is the timed-out listing URL, and lands
            # here. Same shape as the defect the `barren` comment records — a promise kept in prose,
            # honoured on one branch of two.
            if notifier:
                await notifier.send(
                    "Tepna: CPAP harvest failed",
                    f"The {at_hour:02d}:00 harvest could not read the card: {e!r}. Last night's therapy "
                    f"data is not on the box.")
            continue
        finally:
            # Only tear down what we brought up. On the direct path there is no association to undo,
            # and calling wifi_down would attack the SYSTEM supplicant on the shared interface.
            if not direct:
                await asyncio.to_thread(cpap_harvest.wifi_down, profile, 30.0, wifi_iface, root)

        dur = _time.monotonic() - started
        bad = bool(res["short"] or res["errors"])
        # A RUN THAT SAW NOTHING AT ALL. Zero fetched AND zero skipped means the walk found no files —
        # the card was unreachable, empty, or answering with a catch-all. It is NOT the steady state:
        # a healthy day with no new night still skips every file already on disk (1249 of them here),
        # so `skipped == 0` is what separates "nothing to do" from "nothing there".
        #
        # This used to report `ok`, because `bad` reads only `short`/`errors` and an empty walk raises
        # neither. The monitor then painted a green ✓ 0 files over a harvest that had failed silently —
        # while this function's own docstring promised "zero files is an ALERT, not a silent no-op".
        # The promise was in prose and nothing enforced it, which is the `writers.IDENTITY_FIELDS`
        # shape exactly: remembered ✓, then never captured.
        barren = not bad and res["files"] == 0 and res["skipped"] == 0
        _st(state="error" if bad else ("barren" if barren else ("partial" if res["partial"] else "ok")),
            last_ok=None if (bad or barren) else now.isoformat(timespec="seconds"),
            files=res["files"], bytes=res["bytes"], nights=res["nights"], skipped=res["skipped"],
            nights_on_card=res["nights_on_card"], duration_sec=round(dur, 1),
            partial=res["partial"], short=res["short"][:5], errors=res["errors"][:5],
            detail=("card unreachable or empty — the walk found no files at all" if barren
                    else None if not bad
                    else f"{len(res['short'])} short read(s), {len(res['errors'])} error(s)"))
        log.info("cpap: %d file(s) (%.1f MB) over %d night(s), %d skipped, %.0fs%s",
                 res["files"], res["bytes"] / 1048576, res["nights"], res["skipped"], dur,
                 " [PARTIAL — deadline]" if res["partial"] else "")
        for s in res["short"]:
            log.warning("cpap: SHORT READ %s", s)       # a truncated EDF parses far enough to look real
        if barren:
            # WARNING even with no webhook configured — the journal is the only alerting surface a box
            # without one has, and this is the failure that leaves no other trace.
            log.warning("cpap: pulled NOTHING and skipped nothing — card unreachable or empty")
            if notifier:
                await notifier.send(
                    "Tepna: CPAP harvest found nothing",
                    f"The {at_hour:02d}:00 harvest reached the end of its walk having fetched no files "
                    f"and skipped none. The card is unreachable or empty — last night's therapy data "
                    f"is not on the box.")


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
    # ⚠️ REPORT THE EVENT PATH HERE TOO. "auto-pull: enabled" was read fleet-wide as "auto-pull works",
    # while the event triggers had never armed once — 312 of these lines against 0 armed lines. The two
    # mechanisms now state their armed-ness TOGETHER, so the poller's presence can never again be
    # mistaken for the primary path being alive.
    _parm = autopull_arming(pcfg)
    log.info("auto-pull: poller enabled — checking %s every %.0fs (only while it is off the finger), up "
             "to %d tries. This is the RECONCILIATION NET; event triggers: charger=%s not-worn=%s%s",
             name, interval, retries,
             "on" if _parm["charger"] else "OFF", "on" if _parm["doff"] else "OFF",
             f" ({_parm['why']})" if _parm["why"] else "")
    while not _STOP.is_set():
        await asyncio.sleep(interval)
        if _RECOVER.is_set() or _OXYII_PAUSE.is_set():
            continue                                       # mid-recovery or another pull already running
        st = STATUS["devices"].get(name, {})
        # ⚠️ `charging` IS PART OF THIS, and it was missing. The sibling encoding of the same rule
        # (`cpap_harvest.blocking_devices`) has checked it since 2026-07-26, when every sensor was docked
        # and a manual pull still refused — "the gate was unreachable on any evening the sensors were
        # charging, which is precisely when a pull is safest". The same was true here: a docked ring
        # reporting contact would have blocked its own backup pull, at the one moment it is free to run.
        #
        # `is True`, not `is not False` — the asymmetry is deliberate and documented on `on_body`.
        # Refusing to pull on an UNKNOWN loses the only backup for a lossy night.
        if on_body(st) is True:
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


def _load_as11_creds(path: str):
    """The ResMed AS11 pairing credentials (masterPairKey/clientId/ble_addr), or None when absent or
    unreadable. None — never a partial dict — so the stream controller refuses cleanly rather than
    KeyError'ing mid-connect. A malformed or missing file is 'not paired', not a crash."""
    try:
        with open(path, encoding="utf-8") as f:
            creds = json.load(f)
    except (OSError, ValueError):
        return None
    if not all(creds.get(k) for k in ("masterPairKey", "clientId", "ble_addr")):
        return None
    return creds


def _build_cpap_controller(bus, cfg: dict, config_path: str):
    """Assemble the CPAP live-stream controller from config. PURE wiring (no I/O), so the creds-path
    resolution and the free-radio default are testable; the controller itself does nothing until its
    op('start') is called from the monitor. `creds_path` defaults to beside the config file; the BLE
    adapter defaults to hci1 (the free radio — never hci0, which the wearables capture on)."""
    import cpap_stream
    cbs = (cfg.get("cpap", {}) or {}).get("ble_stream", {}) or {}
    creds_path = cbs.get("creds_path") or os.path.join(os.path.dirname(config_path), "as11_creds.json")
    hci = cbs.get("adapter", "hci1")

    async def connect():  # pragma: no cover — thin closure over the bleak I/O edge in _cpap_ble_connect
        creds = _load_as11_creds(creds_path)
        return await _cpap_ble_connect(creds["ble_addr"], hci)

    # Optional on-disk EDF sink, enabled by setting cpap.ble_stream.edf_dir. Each live session then writes
    # a bit-accurate BRP.edf there — QUARANTINED under a PENDING subtree until the flow scale is pinned
    # (EdfSink default flow_scale_verified False), so a provisional-unit file never reaches the harvest
    # ingest root. `edf_dir` MUST be its OWN root, never the harvest dest_subdir. The serial is provisional
    # (config, else "UNKNOWN"); the canonical serial AND the flow factor are both pinned from the same SD
    # card in the CPAP-EDF-WRITER follow-up. No edf_dir → bus-only, the prior behaviour unchanged.
    edf_sink_factory = None
    edf_dir = cbs.get("edf_dir")
    if edf_dir:
        import cpap_edf_writer

        serial = cbs.get("serial") or "UNKNOWN"
        # flow_scale_verified is now TRUE by default — the 2026-08-23 pin confirmed the StreamData flow is
        # L/s (identity, no 60x conversion), so the writer no longer quarantines under PENDING. Overridable
        # to False to re-quarantine. Files land in the committed root now that the clock is local-civil too.
        verified = bool(cbs.get("flow_scale_verified", True))

        def edf_sink_factory():
            return cpap_edf_writer.EdfSink(edf_dir, serial, flow_scale_verified=verified)

    # Optional durable RAW RECORD sink (INV9 — the authoritative copy the bus is not), enabled by
    # cpap.ble_stream.raw_record_dir. Each live session writes an append-only JSONL journal of the
    # canonical observations there. session_id is a HOST-AUTHORED acquisition-run id — it names OUR
    # capture attempt; the DEVICE timeline is already preserved per-batch in device_start, so this does
    # not conflate the two identities. P2 follow-up: AcqLifecycle becomes the id ISSUER — a generator
    # swap only, the record shape and P4's committed-store consumption are unchanged. No dir → no record.
    raw_record_factory = None
    raw_dir = cbs.get("raw_record_dir")
    if raw_dir:
        import cpap_record

        raw_serial = cbs.get("serial") or "UNKNOWN"

        def raw_record_factory():
            sid = cpap_record.new_session_id()
            path = os.path.join(raw_dir, "cpap-raw-" + sid + ".jsonl")
            return cpap_record.RawRecordSink(path, device_id=raw_serial, session_id=sid,
                                             provenance={"unit": "cpap_stream", "wiring": "P1+P3"})

    # devices provider for the on-body gate: the daemon's live device-status map. The 2.4 GHz coexistence
    # interlock is DISABLED BY OWNER ORDER (2026-08-23) — default False — so a stream no longer refuses
    # beside an on-body wearable, only logs it; set cpap.ble_stream.coexistence_gate: true to restore it.
    # ACQUISITION EVIDENCE CONTRACT, Phase B: the envelope rides beside the durable raw record as a
    # `.meta.json` sidecar — the SAME shape and the same placement the O2Ring `.dat` path already uses
    # (pull_session), so one reader handles both devices. Only wired when there IS a raw record to
    # describe: with no raw_record_dir there is no authoritative artifact, and an envelope about
    # nothing would be a fabricated acquisition fact.
    acq_evidence_out = _cpap_acq_evidence_writer() if raw_record_factory is not None else None

    return cpap_stream.LiveStreamController(
        bus, connect, lambda: _load_as11_creds(creds_path), lambda: STATUS.get("devices", {}),
        edf_sink_factory=edf_sink_factory, raw_record_factory=raw_record_factory,
        acq_evidence_out=acq_evidence_out,
        coexistence_gate=bool(cbs.get("coexistence_gate", False)))


def _cpap_acq_evidence_writer():
    """Return the Phase B sidecar writer: one `<raw-record>.meta.json` per finished CPAP session.

    Separated from the factory above so it is directly testable — the daemon closure around it is not.
    A write failure is logged and swallowed: the acquisition already happened and its raw record is
    already durable, so losing the REPORT must never look like losing the capture."""
    def _write(evidence):
        path = evidence.artifact_path
        if not path:
            return
        try:
            with open(path + ".meta.json", "w") as fh:
                json.dump({"acquisition_evidence": evidence.to_dict()}, fh, indent=2)
        except OSError:
            log.exception("CPAP acquisition-evidence sidecar write failed for %s", path)
    return _write


def _maybe_start_as11_shadow(cfg, config_path, root, cpap_ctl, tasks, *,
                             load_creds=None, connect_factory=None, create_task=None):
    """Start the AS11 session-detector SHADOW runner if `as11_detector.enabled` is set — otherwise a
    no-op returning None. Shadow: it OBSERVES (writes SESSIONDETECT.csv + AS11CLOCK.csv) and drives
    NOTHING. It short-connects the AS11 on the CPAP free radio (hci1) only while the live-stream
    controller is idle (`is_capturing=cpap_ctl._running`), so it never fights the controller for the
    one device — the coexistence lesson of 2026-08-25. Default OFF: zero runtime effect until enabled.
    The seams (`load_creds`/`connect_factory`/`create_task`) are injected so the enable path is tested
    without a radio or a live loop."""
    # Config-only opt-in (like pull.on_doff), read without a literal .get fallback so it stays out of
    # settings_schema's shared-leaf default check. Absent/false → no-op.
    if not (cfg.get("as11_detector", {}) or {}).get("enabled"):
        return None
    import as11_clock
    import cpap_shadow_runner
    import cpap_supervisor

    cbs = (cfg.get("cpap", {}) or {}).get("ble_stream", {}) or {}
    adcfg = cfg.get("as11_detector", {}) or {}
    creds_path = cbs.get("creds_path") or os.path.join(os.path.dirname(config_path), "as11_creds.json")
    hci = cbs.get("adapter", "hci1")
    creds = (load_creds or _load_as11_creds)(creds_path)
    if not creds:
        log.info("AS11 session detector enabled but no as11_creds — skipping (pair the AS11 first)")
        return None
    if connect_factory is None:  # pragma: no cover — the bleak I/O edge, mirrors _build_cpap_controller
        async def connect_factory():
            return await _cpap_ble_connect(creds["ble_addr"], hci)
    interval = float(adcfg.get("poll_interval_sec", 30.0))
    task = (create_task or asyncio.create_task)(cpap_shadow_runner.run_shadow_loop(
        connect=connect_factory, creds=creds, supervisor=cpap_supervisor.CPAPSessionSupervisor(),
        is_capturing=cpap_ctl._running,
        session_writer=cpap_shadow_runner.SessionSidecar(os.path.join(root, "SESSIONDETECT.csv")),
        clock_writer=as11_clock.ClockSidecar(os.path.join(root, "AS11CLOCK.csv")),
        host_epoch=_time.time, sleep=asyncio.sleep, poll_interval_s=interval, should_stop=_STOP.is_set))
    TASK_LABELS[id(task)] = "AS11 shadow detector"
    tasks.append(task)
    log.info("AS11 session detector: SHADOW enabled on %s (poll %ss) → SESSIONDETECT.csv + AS11CLOCK.csv",
             hci, interval)
    return task


async def _cpap_ble_connect(ble_addr: str, hci: str | None):
    """Open the AS11 link on the FREE radio and return (write, recv_frame, disconnect) for as11_pull.

    The only un-unit-tested code in the CPAP stream path: real bleak connect + notify plumbing, which
    CI has no radio to exercise. Everything it feeds (session, stream, bus push, lifecycle) is tested.
    Mirrors the operator probe's transport verbatim so the two cannot drift."""
    import as11_link as _L
    from bleak import BleakClient as _BC
    client = _BC(ble_addr, timeout=20, **({"bluez": {"adapter": hci}} if hci else {}))
    await client.connect()
    rx = bytearray()
    q: asyncio.Queue = asyncio.Queue()

    def _on_notify(_h, data):
        rx.extend(bytes(data))
        while True:
            r = _L.fig_unframe(bytes(rx))
            if not r:
                break
            vcid, payload, rest = r
            rx[:] = rest
            q.put_nowait((vcid, payload))

    await client.start_notify(_L.GATT_RX, _on_notify)
    mtu = getattr(client, "mtu_size", 23) or 23
    step = max(20, mtu - 3)

    async def write(frame):
        for i in range(0, len(frame), step):
            await client.write_gatt_char(_L.GATT_TX, frame[i:i + step], response=True)

    async def recv_frame():
        return await asyncio.wait_for(q.get(), 20)

    async def disconnect():
        await client.disconnect()

    return write, recv_frame, disconnect


async def main():
    global ADAPTER
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.yaml")
    args = ap.parse_args()
    import yaml   # runtime-only dep; imported here so `import capture` (for unit tests) needs no external deps
    # Read explicitly (no leaked handle) and REFUSE an empty/non-mapping config with a message that
    # names the problem. `yaml.safe_load` returns None for an empty file, so the old one-liner turned a
    # truncated config.yaml into an `AttributeError: 'NoneType' object has no attribute 'get'` several
    # frames later — the least useful possible symptom for the most likely corruption. The write side
    # is now atomic (webmon._save), so this should be unreachable; it is the belt to that brace, and it
    # is what an operator meets if they hand-edit the file at 23:00.
    with open(args.config) as _cf:
        cfg = yaml.safe_load(_cf)
    if not isinstance(cfg, dict):
        raise SystemExit(f"{args.config}: config is empty or not a YAML mapping (parsed as "
                         f"{type(cfg).__name__}) — refusing to start with no devices. Restore it from a "
                         f"backup; a truncated file here means the box would record nothing all night.")
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
    global _RESUME_WINDOW_S
    _wr = cfg.get("write") or {}
    if "resume_window_sec" in _wr:
        _RESUME_WINDOW_S = float(_wr["resume_window_sec"])       # 0 disables resume entirely
    global _STREAM_STALL_S
    _sc = cfg.get("stream") or {}
    if "stall_sec" in _sc:
        _STREAM_STALL_S = float(_sc["stall_sec"])                # 0 disables the started-stream watchdog
    _install_logging()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _STOP.set)

    # Push-alert transport (webhook) — disabled unless config sets alerts.enabled + alerts.webhook_url.
    _acfg = cfg.get("alerts") or {}
    notifier = alerts.Notifier(_acfg.get("webhook_url"), enabled=bool(_acfg.get("enabled")))
    # Published every status tick (see status_loop). Module-level rather than threaded through a dozen
    # signatures because the ONE thing this needs is to reach the same surface as everything else it
    # guards — an alert transport whose own health is invisible is the failure it exists to prevent.
    global _NOTIFIER
    _NOTIFIER = notifier

    # EVERY background task is supervised. Several of them are the recovery ladder itself — adapter_watchdog
    # is the one thing that un-wedges a dead radio — so a task dying quietly is strictly worse here than
    # anywhere else: the box keeps running, believes it is healthy, and has lost the ability to fix itself.
    # Same `data_stale_sec` the alert loop uses — one grace, so `recording` cannot mean two things
    # depending on which loop a reader happened to ask.
    _BACKGROUND = [("status_loop", lambda: status_loop(root, float(_acfg.get("data_stale_sec", 120)))),
                   ("adapter_watchdog", lambda: adapter_watchdog(ADAPTER, cfg)),
                   ("rssi_poller", lambda: rssi_poller(ADAPTER, cfg, root)),
                   ("clock_watchdog", lambda: clock_watchdog(cfg)),
                   ("host_clock_poller", lambda: host_clock_poller(cfg, root)),
                   ("storage_poller", lambda: storage_poller(cfg, root, notifier)),
                   ("alert_poller", lambda: alert_poller(cfg, notifier)),
                   ("qc_poller", lambda: qc_poller(cfg, root, notifier)),
                   ("archive_poller", lambda: archive_poller(cfg, root)),
                   ("autopull_poller", lambda: autopull_poller(cfg, root)),
                   ("cpap_poller", lambda: cpap_poller(cfg, root, notifier)),
                   ("charger_pull_poller", lambda: charger_pull_poller(cfg, root)),
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
        # CPAP live waveform over BLE: opt-in from the monitor's button. The controller does nothing
        # until op("start"), which gates against wearable capture and needs stored credentials, then
        # pushes flow+pressure onto the SAME bus the wearables use so the existing Live-streams grid
        # renders it. Built by the testable factory above; the bleak connect is the only I/O edge.
        _cpap_ctl = _build_cpap_controller(BUS, cfg, args.config)
        # AS11 session detector (SHADOW): observes therapy via a short-connect poll while the CPAP
        # stream is idle, writing SESSIONDETECT.csv + AS11CLOCK.csv. Default OFF (as11_detector.enabled).
        _maybe_start_as11_shadow(cfg, args.config, root, _cpap_ctl, tasks)
        web_runner = await webmon.start(
            webmon.make_app(BUS, cfg, args.config, ADAPTER, STATUS, _spawn,
                            pull_stored=_pull, polar_pause=polar_offline_op,
                            sync_time=sync_device_time, forget_device=_forget,
                            on_tz_change=reset_clock_anchor, notifier=notifier,
                            ring_config=queue_ring_config, ring_buzz=queue_ring_buzz,
                            cpap_stream=_cpap_ctl.op), host, port)
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
    await startup_defense_check(_hci, cfg)    # LOUD-warn if a wedge defense is disarmed (§P1.4)
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
    import sys
    asyncio.run(main())
    sys.exit(_EXIT_CODE[0])
