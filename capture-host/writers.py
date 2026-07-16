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

from __future__ import annotations
import os, datetime as _dt
from typing import Iterable

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
        "ecg": "Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]",
        "acc": "Phone timestamp;sensor timestamp [ns];timestamp [ms];X [mg];Y [mg];Z [mg]",
        "ppg": "Phone timestamp;sensor timestamp [ns];timestamp [ms];ppg0;ppg1;ppg2;ambient",
        "hr":  "Phone timestamp;sensor timestamp [ns];HR [bpm];RR-interval [ms]",
    }

    def __init__(self, path: str, stream: str):
        self.path = path
        self.stream = stream
        self._fh = open(path, "w", buffering=1 << 20, newline="\n")
        self._fh.write(self.HEADERS[stream] + "\n")
        self._n = 0
        self._first_ns: int | None = None   # per-file anchor for the relative `timestamp [ms]` column

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
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{self._rel_ms(sensor_ns)};{x};{y};{z}\n")
        self._bump()

    def write_ppg(self, phone: _dt.datetime, sensor_ns: int, t_ms: float, ch: Iterable[int], ambient: int) -> None:
        c0, c1, c2 = list(ch)[:3]
        self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{self._rel_ms(sensor_ns)};{c0};{c1};{c2};{ambient}\n")
        self._bump()

    def write_hr(self, phone: _dt.datetime, sensor_ns: int, bpm: int, rr_ms: Iterable[int]) -> None:
        # One row per RR interval (PSL behavior); HR repeated. If no RR this beat, write a single blank RR.
        rrs = list(rr_ms) or [""]
        for rr in rrs:
            self._fh.write(f"{_phone_ts(phone)};{sensor_ns};{bpm};{rr}\n")
            self._bump()

    def _bump(self) -> None:
        self._n += 1

    @property
    def rows(self) -> int:
        return self._n

    def close(self) -> None:
        try:
            self._fh.flush()
            self._fh.close()
        except Exception:
            pass


class Spo2CsvWriter:
    """ViHealth-layout SpO2 CSV — `Time,Oxygen Level,Pulse Rate,Motion` with `HH:MM:SS DD/MM/YYYY`
    stamps, the exact shape OxyDex's oxydex-spo2 adapter reads (Clock Contract §2.4 vendor regex parses
    the stamp → floating tMs). One row per valid reading (~1/s). Used by the O2Ring/Viatom capture path."""

    def __init__(self, path: str):
        self.path = path
        self._fh = open(path, "w", buffering=1 << 16, newline="\n")
        self._fh.write("Time,Oxygen Level,Pulse Rate,Motion\n")
        self._n = 0

    def write(self, when: _dt.datetime, spo2: int, pr: int, motion: int) -> None:
        stamp = when.strftime("%H:%M:%S %d/%m/%Y")   # LOCAL civil (Clock Contract) — O2Ring/ViHealth format
        self._fh.write(f"{stamp},{spo2},{pr},{motion}\n")
        self._n += 1

    @property
    def rows(self) -> int:
        return self._n

    def close(self) -> None:
        try:
            self._fh.flush(); self._fh.close()
        except Exception:
            pass


# Polar's sensor clock is nanoseconds since 2000-01-01T00:00:00Z. Helpers to (a) keep it as the
# secondary column and (b) derive the "timestamp [ms]" PSL column (ms since the same epoch).
POLAR_EPOCH = _dt.datetime(2000, 1, 1, tzinfo=_dt.timezone.utc)

def polar_ns_to_t_ms(sensor_ns: int) -> float:
    return sensor_ns / 1e6  # ns -> ms, same Polar epoch (PSL's "timestamp [ms]" column)
