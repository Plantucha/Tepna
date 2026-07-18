# tepna-capture — writers.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Vendor-layout file writers. This is the SUITE-CRITICAL layer: it makes the box emit byte-shapes
# the existing Tepna parsers/adapters already read, so NOTHING downstream changes (no new parser
# branch). It also owns the Clock Contract obligations and the device-id filename convention.
#
# Clock Contract (CLAUDE.md §🔒) as honored here:
#   - "Phone timestamp" is written as ZONE-FREE LOCAL-CIVIL ISO  (e.g. 2026-06-25T21:53:00.123).
#     -> parser branch 3 -> Date.UTC(components) -> floating wall-clock tMs. NEVER raw epoch as the
#     primary stamp (drags in viewer-tz ambiguity); NEVER fabricate a stamp for a dropped packet.
#   - The Polar "sensor timestamp [ns]" (ns since 2000-01-01) is carried as a SECONDARY column only.
#   - A gap in capture is a GAP in the file (we simply stop writing rows), never invented "now()" rows.
#
# WHICH COLUMN IS A SAMPLE CLOCK (measured 2026-07-18, 2.4 M rows of real corpus):
#   - "sensor timestamp [ns]" / "timestamp [ms]" = the DEVICE clock. ZERO backward steps. This is the
#     sample clock; anything computing rates, diffs, bins or merges must use it.
#   - "Phone timestamp" = the host ARRIVAL stamp. It steps BACKWARDS at ~0.5-0.8 % of rows on the
#     back-timed continuous streams (ECG/PPG/ACC/GYRO/MAG), always at an exact frame boundary — median
#     ~1.8 samples, worst 42. Cause: decode_frame back-times each frame from ITS OWN notification
#     arrival (`arrival - back/fs`), and BLE arrival jitters (bursty delivery) while the device clock
#     does not. This is inherent to arrival stamping — Polar Sensor Logger's own column behaves the
#     same way — and it is deliberately NOT smoothed: filtering it would fabricate precision the
#     arrival stamp does not have and destroy the only record of real link timing.
#   - PPI/HR are per-beat EVENTS and are NOT back-timed (back=0), so their Phone column IS monotonic.
#     PulseDex reads that column and uses a one-way two-pointer matcher, so it depends on this.
#   Invariants pinned by tests/test_polar_pmd.py (frame-seam group). Impact audit: no Dex currently
#   mis-computes from the seam — the only phone-column consumer on a back-timed stream is ECGDex's
#   parseDeviceACC, whose worst 175 ms slip never crosses its 30 s epoch boundary.

from __future__ import annotations
import os, datetime as _dt, time as _time
from typing import Iterable

# The writers use big OS buffers for throughput (StreamWriter 1 MB, Spo2CsvWriter 64 KB) and would
# otherwise only hit disk on close(). Overnight that means a hard kill or power loss loses the entire
# unflushed tail (up to a full buffer — minutes of ECG, or ~an hour of the slow 1/s SpO2 stream). So
# every writer force-flushes on a wall-clock cadence: flush() moves Python's buffer to the OS page
# cache (survives a process crash) and fsync() forces the OS cache to the physical medium (survives a
# power loss). At this cadence at most FLUSH_INTERVAL_S of the tail is ever at risk. `_time.monotonic()`
# drives the cadence — it's internal timing, not a written stamp, so the Clock Contract doesn't apply.
FLUSH_INTERVAL_S = 5.0

# Filename: <Vendor>_<Model>_<DeviceId>_<YYYYMMDDHHMMSS>_<STREAM>.<ext>  (matches Polar Sensor Logger
# so dex-ingest.js / signal-orchestrate.pairCompanions pair sidecars by device-id + nearest stamp,
# and dateAnchorMs reads from the name — Clock Contract §4).
def capture_filename(vendor: str, model: str, device_id: str, started: _dt.datetime,
                     stream: str, ext: str = "txt") -> str:
    stamp = started.strftime("%Y%m%d%H%M%S")
    return f"{vendor}_{model}_{device_id}_{stamp}_{stream.upper()}.{ext}"


def night_dir(root: str, started: _dt.datetime) -> str:
    # Roll a per-night folder by the recording's LOCAL start date (dateAnchor). Created lazily.
    d = os.path.join(root, "captures", started.strftime("%Y-%m-%d"))
    os.makedirs(d, exist_ok=True)
    return d


def _phone_ts(when: _dt.datetime) -> str:
    # Local civil time, zone-free, millisecond precision. `when` MUST be a local (naive or local-tz)
    # datetime — pass the host arrival time. Do not pass a UTC instant.
    return when.strftime("%Y-%m-%dT%H:%M:%S.") + f"{when.microsecond // 1000:03d}"


class StreamWriter:
    """One open file in a fixed vendor layout. Append rows as samples arrive; flush periodically."""

    # PSL-compatible headers, keyed by stream. `;`-separated, exactly as Polar Sensor Logger exports.
    HEADERS = {
        "ecg":  "Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]",
        "acc":  "Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]",
        "ppg":  "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient",
        "hr":   "Phone timestamp;sensor timestamp [ns];HR [bpm];RR-interval [ms]",
        "gyro": "Phone timestamp;sensor timestamp [ns];X [dps];Y [dps];Z [dps]",
        "mag":  "Phone timestamp;sensor timestamp [ns];X [G];Y [G];Z [G]",
        "ppi":  "Phone timestamp;sensor timestamp [ns];HR [bpm];PP-interval [ms];error estimate [ms];blocker;skin contact;skin contact supported",
    }

    def __init__(self, path: str, stream: str, flush_interval: float = FLUSH_INTERVAL_S,
                 fsync: bool = True):
        self.path = path
        self.stream = stream
        self._fh = open(path, "w", buffering=1 << 20, newline="\n")
        self._fh.write(self.HEADERS[stream] + "\n")
        self._n = 0
        self._first_ns: int | None = None   # per-file anchor for the relative `timestamp [ms]` column
        self._flush_interval = flush_interval
        self._fsync = fsync
        self._last_flush = _time.monotonic()

    # `timestamp [ms]` in a real PSL export is RELATIVE to the recording's first sample and FRACTIONAL:
    #   0.0, 7.692288, 15.384576, …  (= (sensor_ns - first_sensor_ns)/1e6, verified against a real H10
    #   export). ECGDex's headless parseECGText infers fs from this column's STEP, so it must NOT be
    #   rounded to integer ms (7.692→7/8 makes the parser read 143/125 Hz instead of 130) and must NOT be
    #   the absolute device-clock ms. Emit fractional, relative, trailing-zeros stripped → "0.0" first row.
    def _rel_ms(self, sensor_ns: int) -> str:
        if self._first_ns is None:
            self._first_ns = sensor_ns
        v = (sensor_ns - self._first_ns) / 1e6
        s = f"{v:.6f}".rstrip("0").rstrip(".")
        return s + ".0" if "." not in s else s   # "0" -> "0.0", "30.769280" -> "30.76928"

    # --- per-stream row appenders -------------------------------------------------------------
    # `phone` = host arrival datetime (local); `sensor_ns` = Polar device-clock ns of the sample
    # (monotonic, arbitrary epoch — carried verbatim as the secondary column, NOT ns-since-2000).
    # `t_ms` is accepted for call-site compatibility but the emitted ms column is derived from
    # `sensor_ns` via `_rel_ms` so it exactly matches PSL's relative/fractional semantics.

    def write_ecg(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, uv: int) -> None:
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{self._rel_ms(sensor_ns)};{uv}\n")
        self._bump()

    def write_acc(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, x: int, y: int, z: int) -> None:
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{x};{y};{z}\n")
        self._bump()

    def write_ppg(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, ch: Iterable[int], ambient: int) -> None:
        c0, c1, c2 = list(ch)[:3]
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{c0};{c1};{c2};{ambient}\n")
        self._bump()

    def write_gyro(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, x: int, y: int, z: int) -> None:
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{x};{y};{z}\n")
        self._bump()

    def write_mag(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, x: int, y: int, z: int) -> None:
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{x};{y};{z}\n")
        self._bump()

    def write_ppi(self, phone: _dt.datetime, sensor_ns: int, hr: int, pp_ms: int, err_ms: int, flags: int) -> None:
        # One row per beat (PSL PPI layout). flags: bit0 blocker, bit1 skin-contact, bit2 skin-contact-supported.
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{hr};{pp_ms};{err_ms};"
                       f"{flags & 1};{(flags >> 1) & 1};{(flags >> 2) & 1}\n")
        self._bump()

    def write_hr(self, phone: _dt.datetime, sensor_ns: int, bpm: int, rr_ms: Iterable[int]) -> None:
        # One row per RR interval (PSL behavior); HR repeated. If no RR this beat, write a single blank RR.
        rrs = list(rr_ms) or [""]
        for rr in rrs:
            self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{bpm};{rr}\n")
            self._bump()

    def _bump(self) -> None:
        self._n += 1
        self._maybe_flush()

    def _maybe_flush(self) -> None:
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        """Force the buffered tail to the OS (flush) and to disk (fsync) — bounds crash/power-loss loss."""
        try:
            self._fh.flush()
            if self._fsync:
                os.fsync(self._fh.fileno())
        except Exception:
            pass

    @property
    def rows(self) -> int:
        return self._n

    def close(self) -> None:
        try:
            self.flush()
            self._fh.close()
        except Exception:
            pass


class OxyFrameLogWriter:
    """O2Ring per-frame sidecar — the live-header fields the vendor SpO2 CSV layout cannot carry.

    Originally built to identify byte [11]. That question is now ANSWERED (it is motion; [7] is the
    perfusion index — the two were swapped, see oxyii.parse_live), so this file's job has changed from
    experiment to capture: it records PERFUSION INDEX, which is a real physiological signal the
    `Time,Oxygen Level,Pulse Rate,Motion` vendor layout has no column for, plus session duration and
    the charge/run state.

    PI is genuinely useful — it is the standard oximetry measure of pulse-signal strength, and it is the
    honest denominator for judging whether an SpO2 reading was well-perfused. It is recorded here rather
    than surfaced as a metric: it earns a registry entry and an evidence badge only when a node actually
    consumes it.

    SIDECAR, NOT A COLUMN — the SpO2 CSV is a vendor layout OxyDex's adapter parses positionally.
    """

    def __init__(self, path: str, flush_interval: float = FLUSH_INTERVAL_S, fsync: bool = True):
        self.path = path
        self._fh = open(path, "w", buffering=1 << 16, newline="\n")
        self._fh.write("Phone timestamp;duration_s;pi_pct;motion;spo2;pr;contact;battery_pct;"
                       "batt_state;flag\n")
        self.rows = 0
        self._flush_interval = flush_interval
        self._fsync = fsync
        self._last_flush = _time.monotonic()

    def write(self, when: _dt.datetime, live: dict) -> None:
        """One row per live frame (~1 Hz). Blank, never 0, for an absent value — a fabricated 0 is
        indistinguishable from a real reading of 0 (the bug this suite keeps re-learning)."""
        def _f(v):
            return "" if v is None else str(v)
        stamp = when.strftime("%Y-%m-%dT%H:%M:%S.") + f"{when.microsecond // 1000:03d}"
        self._fh.write(";".join((stamp, _f(live.get("duration")), _f(live.get("pi")),
                                 _f(live.get("motion")), _f(live.get("spo2")), _f(live.get("pr")),
                                 _f(live.get("contact")), _f(live.get("batt")),
                                 _f(live.get("batt_state")), _f(live.get("flag")))) + "\n")
        self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        try:
            self._fh.flush()
            if self._fsync:
                os.fsync(self._fh.fileno())
        except (OSError, ValueError):
            pass

    def close(self) -> None:
        try:
            self.flush()
            self._fh.close()
        except (OSError, ValueError):
            pass


class LinkLogWriter:
    """Per-session LINK PROVENANCE sidecar — the CONDITIONS a night was captured under.

    Answers a question the signal files cannot: when there is a gap at 03:00, was the link degrading, or
    did the sensor simply stop? Today that is unanswerable after the fact. This records connection state,
    RSSI, battery and frame-drop counters on a slow cadence (~25 s), so link quality becomes recorded
    evidence rather than an assumption — the same move as clock provenance.

    DELIBERATELY A SIDECAR, NOT A COLUMN. The vendor `*_ACC.txt` / `*_PPG.txt` layouts are a POSITIONAL
    contract that MotionDex/PPGDex/ECGDex parse by index; adding a field to them shifted every column and
    silently corrupted consumers once already (2026-07-18). One extra file cannot do that.

    It is TELEMETRY, not physiology: it must never enter a `ganglior.node-export` as a metric or carry an
    evidence badge as a health measurement.
    """

    def __init__(self, path: str, flush_interval: float = FLUSH_INTERVAL_S, fsync: bool = True):
        self.path = path
        self._fh = open(path, "w", buffering=1 << 16, newline="\n")
        self._fh.write("Phone timestamp;device;connected;rssi_dbm;battery_pct;"
                       "frames_dropped;frames_duplicated\n")
        self.rows = 0
        self._flush_interval = flush_interval
        self._fsync = fsync
        self._last_flush = _time.monotonic()

    def write(self, when: _dt.datetime, device: str, connected: bool, rssi, battery,
              dropped=None, duplicated=None) -> None:
        def _f(v):
            return "" if v is None else str(v)          # blank, never a fabricated 0
        self._fh.write(f"{_phone_ts(when)};{device};{1 if connected else 0};"
                       f"{_f(rssi)};{_f(battery)};{_f(dropped)};{_f(duplicated)}\n")
        self.rows += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        self._fh.flush()
        if self._fsync:
            import os as _os
            _os.fsync(self._fh.fileno())

    def close(self) -> None:
        try:
            self.flush()
        finally:
            self._fh.close()


class Spo2CsvWriter:
    """ViHealth-layout SpO2 CSV — `Time,Oxygen Level,Pulse Rate,Motion` with `HH:MM:SS DD/MM/YYYY`
    stamps, the exact shape OxyDex's oxydex-spo2 adapter reads (Clock Contract §2.4 vendor regex parses
    the stamp → floating tMs). One row per valid reading (~1/s). Used by the O2Ring/Viatom capture path."""

    def __init__(self, path: str, flush_interval: float = FLUSH_INTERVAL_S, fsync: bool = True):
        self.path = path
        self._fh = open(path, "w", buffering=1 << 16, newline="\n")
        self._fh.write("Time,Oxygen Level,Pulse Rate,Motion\n")
        self._n = 0
        self._flush_interval = flush_interval
        self._fsync = fsync
        self._last_flush = _time.monotonic()

    def write(self, when: _dt.datetime, spo2: int, pr: int, motion: int) -> None:
        stamp = when.strftime("%H:%M:%S %d/%m/%Y")   # LOCAL civil (Clock Contract) — O2Ring/ViHealth format
        self._fh.write(f"{stamp},{spo2},{pr},{motion}\n")
        self._n += 1
        now = _time.monotonic()
        if now - self._last_flush >= self._flush_interval:
            self.flush()
            self._last_flush = now

    def flush(self) -> None:
        """Force the buffered tail to the OS (flush) and to disk (fsync) — bounds crash/power-loss loss."""
        try:
            self._fh.flush()
            if self._fsync:
                os.fsync(self._fh.fileno())
        except Exception:
            pass

    @property
    def rows(self) -> int:
        return self._n

    def close(self) -> None:
        try:
            self.flush(); self._fh.close()
        except Exception:
            pass


# Polar's sensor clock is nanoseconds since 2000-01-01T00:00:00Z. Helpers to (a) keep it as the
# secondary column and (b) derive the "timestamp [ms]" PSL column (ms since the same epoch).
POLAR_EPOCH = _dt.datetime(2000, 1, 1, tzinfo=_dt.timezone.utc)

def polar_ns_to_t_ms(sensor_ns: int) -> float:
    return sensor_ns / 1e6  # ns -> ms, same Polar epoch (PSL's "timestamp [ms]" column)
