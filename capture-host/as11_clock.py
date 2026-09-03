# tepna-capture — as11_clock.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# AS11 clock discipline — the device RTC watched against the box's disciplined clock.
#
# The AS11 RTC cannot be set over BLE (SetDateTime is service-access, no BLE VCID) and reads ~21 min
# fast. This module does NOT set it — it MEASURES it, the host-axis way: pair each GetDateTime read
# (device clock) with the host wall clock, and from a session of anchors answer the two questions the
# owner asked:
#
#   1. the TOTAL offset — how far the device clock is from the host (the ~21 min), and
#   2. the RATE — is a ResMed "minute" actually a minute, or does the RTC crystal tick fast/slow? That
#      is the SLOPE of offset(t): flat ⇒ a pure fixed offset (a real minute); sloped ⇒ an off-rate
#      crystal, quantified in ppm.
#
# This is the same discipline `clock_offset` / `hostAxis` apply to the wearables, pointed at the AS11.
# The Clock Contract is UNTOUCHED: the device stamp is parsed by explicit regex (never new Date), the
# comparison is device-vs-host at the ingest boundary, and nothing here rewrites a capture's tMs.
#
# HONESTY: the device datetime is second-resolution, so a rate below the quantum-over-span floor is
# indistinguishable from zero — `analyze` reports that floor and only calls the minute "real" when the
# measured ppm sits under it. It refuses (ok:false, reason) rather than quoting a rate it cannot support.

from __future__ import annotations

from typing import TypedDict

import calendar
import datetime as _dt
import math
import os
import re
import statistics

import logging

_log = logging.getLogger("tepna-capture")

__all__ = ["parse_device_epoch_s", "analyze", "ClockSidecar", "DEVICE_QUANTUM_S", "MIN_RATE_ANCHORS",
           "offset_for_envelope", "ENVELOPE_REFERENCE", "ENVELOPE_METHOD"]

# The AS11 GetDateTime reads to the whole second (measured — the RTC probe's ±1 s read quantum).
DEVICE_QUANTUM_S = 1.0

# A rate needs at least three anchors, echoing the hostAxis contract: two points fit any line and cannot
# be checked; three is the least that can show the RTC is not simply drifting under one bad read.
MIN_RATE_ANCHORS = 3

# Explicit ISO-8601 head. Trailing fractional seconds / zone are tolerated in the match and ignored: the
# machine carries no real zone, so the components are taken verbatim as floating wall-clock (Clock §1).
_ISO_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})")


def parse_device_epoch_s(raw) -> float | None:
    """A device GetDateTime string → floating epoch SECONDS, or None. Component ranges are validated so
    calendar.timegm cannot silently roll an out-of-range field onto a wrong instant."""
    if not isinstance(raw, str):
        return None
    m = _ISO_RE.match(raw)
    if m is None:
        return None
    year, month, day, hour, minute, second = (int(x) for x in m.groups())
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
        return None
    return float(calendar.timegm((year, month, day, hour, minute, second, 0, 0, 0)))



class As11ClockResult(TypedDict, total=False):
    """What `analyze` returns.

    A TypedDict rather than a plain dict because this is a heterogeneous RECORD, not a mapping:
    mypy infers a plain dict-literal's value type from its initial entries (here
    `float | int | None`), after which every later `out["reason"] = "..."` is a type error — six of
    them from this one function. The keys are known and fixed, so declaring them is both the
    accurate description and the fix.

    `total=False` is deliberate and load-bearing: the early `too-few` return on line ~81 yields only
    {ok, reason, n}, so requiring every key would reject a real return path.
    """

    ok: bool
    n: int
    span_s: float
    offset_s: float
    offset_min: float
    slope_ppm: float | None
    ppm_floor: float | None
    minute_is_real: bool | None
    reason: str | None
    verdict: str | None


def analyze(anchors, *, device_quantum_s: float = DEVICE_QUANTUM_S,
            min_rate_anchors: int = MIN_RATE_ANCHORS) -> As11ClockResult:
    """Reduce a session of `(host_epoch_s, device_epoch_s)` anchors to the offset and the rate.

    Returns, on success:
      { ok:True, n, span_s, offset_s, offset_min,
        slope_ppm, ppm_floor, minute_is_real, verdict, reason }
    `offset_s = median(host − device)` is the total offset (device runs `offset_s` behind the host, so
    ~ −1260 s / −21 min if the device is ahead). `slope_ppm` is the least-squares rate of offset(t);
    `ppm_floor = quantum/span` is the smallest rate the second-resolution reads can resolve, and
    `minute_is_real` is |slope_ppm| ≤ ppm_floor — the device second advances at the host rate within
    resolution. `slope_ppm`/`minute_is_real` are None (with a reason) when there are too few anchors or
    no time span to measure a rate; the offset is still returned whenever ≥2 anchors exist.

    A refusal (fewer than two finite anchors) returns { ok:False, reason:"too-few", n } and NO estimate.
    """
    pts = [(float(h), float(d)) for h, d in anchors if math.isfinite(h) and math.isfinite(d)]
    pts.sort()
    n = len(pts)
    if n < 2:
        return {"ok": False, "reason": "too-few", "n": n}

    offsets = [h - d for h, d in pts]
    offset_s = statistics.median(offsets)
    t0 = pts[0][0]
    span_s = pts[-1][0] - t0
    out: As11ClockResult = {
        "ok": True,
        "n": n,
        "span_s": round(span_s, 3),
        "offset_s": round(offset_s, 3),
        "offset_min": round(offset_s / 60.0, 4),
        "slope_ppm": None,
        "ppm_floor": None,
        "minute_is_real": None,
        "reason": None,
        "verdict": None,
    }
    if span_s <= 0:
        out["reason"] = "no-span"
        out["verdict"] = f"offset {offset_s / 60.0:+.2f} min; rate not measurable (all reads at one host instant)"
        return out
    if n < min_rate_anchors:
        out["reason"] = "too-few-for-rate"
        out["verdict"] = f"offset {offset_s / 60.0:+.2f} min; need ≥{min_rate_anchors} anchors for a rate"
        return out

    ts = [h - t0 for h, _ in pts]
    tbar = sum(ts) / n
    obar = sum(offsets) / n
    sxx = sum((t - tbar) ** 2 for t in ts)
    sxy = sum((ts[i] - tbar) * (offsets[i] - obar) for i in range(n))
    slope = sxy / sxx  # seconds of offset per second of host time
    ppm = slope * 1e6
    ppm_floor = device_quantum_s / span_s * 1e6
    minute_is_real = abs(ppm) <= ppm_floor
    out["slope_ppm"] = round(ppm, 2)
    out["ppm_floor"] = round(ppm_floor, 2)
    out["minute_is_real"] = minute_is_real
    if minute_is_real:
        out["verdict"] = (
            f"offset {offset_s / 60.0:+.2f} min, FIXED — a device minute is a real minute "
            f"(|{ppm:.1f}| ppm ≤ {ppm_floor:.1f} ppm resolution floor over {span_s / 3600.0:.1f} h)"
        )
    else:
        out["verdict"] = (
            f"offset {offset_s / 60.0:+.2f} min, DRIFTING at {ppm:+.1f} ppm — the RTC crystal ticks "
            f"off-rate (floor {ppm_floor:.1f} ppm over {span_s / 3600.0:.1f} h)"
        )
    return out


class ClockSidecar:
    """The AS11 clock sidecar — one row per GetDateTime read, beside the capture (the RingClock idiom).
    A SIDECAR, never a column in the EDF; TELEMETRY, never a ganglior metric; blanks, never fabricated
    zeros. Analysis (offset + rate) is `analyze`; this owns the file + the row schema only."""

    HEADER = "host_wall;host_epoch_s;device_iso;device_epoch_s;offset_s\n"

    def __init__(self, path: str):
        self.path = path
        # APPEND, never "w". Mode "w" TRUNCATES on open, and the daemon restarts often (11 times on
        # 2026-08-25) — which destroyed 7.5 h of collected rows that day: the file went 57,445 bytes
        # -> 0 at the exact second of `Started tepna-capture`. A restart must COST NOTHING.
        # Line-buffered (buffering=1) for the same reason: at 64 KB with ~90-byte rows, an unclean
        # stop discarded everything since the last flush, and a working sidecar then reads as a
        # 0-byte file — indistinguishable from a dead detector, which is how this went unnoticed.
        fresh = not os.path.exists(path) or os.path.getsize(path) == 0
        self._fh = open(path, "a", buffering=1, newline="\n")
        if fresh:
            self._fh.write(self.HEADER)
        self.rows = 0

    def write(self, host_wall, host_epoch_s, device_iso, device_epoch_s, offset_s) -> None:
        def _f(v):
            return "" if v is None else str(v)

        self._fh.write(
            f"{_f(host_wall)};{_f(host_epoch_s)};{_f(device_iso)};{_f(device_epoch_s)};{_f(offset_s)}\n"
        )
        self.rows += 1

    def close(self) -> None:
        try:
            self._fh.flush()
            self._fh.close()
        except (OSError, ValueError):
            # SAME DEFECT #2016 FIXED IN writers.py, in a writer that lives outside it. A swallowed
            # flush means the tail of this file never reached the disk while the caller believes it
            # did. Too small for the full _FlushHealth machinery (one close, no periodic flush), but
            # not too small to say so.
            _log.warning("as11 clock log did not close cleanly — its tail may be unwritten",
                         exc_info=True)


# ── the envelope join ──────────────────────────────────────────────────────────────────────────
# The measurement above has existed since the RTC probe landed, and the acquisition envelope has
# carried a `clock_offset` field the whole time — but the live stream never passed one, so every
# envelope said UNKNOWN while `AS11CLOCK.csv` sat beside the capture holding the answer. A
# reconciliation joining a device-stamped EDF to a host-stamped night therefore read the AS11's ~21
# minutes as a real gap rather than as a known, measured clock difference.
#
# 🔴 THE TWO SIGN CONVENTIONS ARE OPPOSITE, AND THIS IS THE ONLY PLACE THEY MEET.
#   · `analyze` returns `offset_s = median(host − device)`  → NEGATIVE when the device runs ahead.
#   · `acq_evidence.ClockOffset.offset_sec` is documented POSITIVE when the device reads LATER.
# The AS11 reads ~21 min FAST, so `analyze` gives ~ −1260 s and the envelope must carry ~ +1260 s.
# Getting this backwards does not merely mislabel: a consumer applying declare-never-correct would
# shift in the wrong direction and turn a 21-minute discrepancy into a 42-minute one, which still
# looks like a plausible clock story. Negated HERE, once, with a test that pins the real magnitude
# AND its sign — a magnitude-only assertion passes under both conventions.
ENVELOPE_REFERENCE = "host-wall"
ENVELOPE_METHOD = "GetDateTime"


def offset_for_envelope(text, *, analyze_fn=None):
    """`{offset_sec, measured_at_ms, reference, method}` from AS11CLOCK.csv text, or None. PURE.

    None means "not measured" and the caller must render that as `ClockOffset.unknown()` — never as a
    zero, which asserts a measured agreement that never happened (`ClockOffset`'s own docstring makes
    that distinction load-bearing, and `measured` gates on `offset_sec is not None` precisely because
    0.0 is a legitimate measured result).

    `measured_at_ms` is the LAST anchor's host time as Clock-Contract floating tMs, because staleness
    is the consumer's to judge and the newest anchor is what it must judge against."""
    rows = []
    for line in str(text or "").splitlines():
        parts = line.split(";")
        if len(parts) < 4:
            continue
        try:
            host_s, dev_s = float(parts[1]), float(parts[3])
        except ValueError:
            continue                      # the header row, a torn line, or a failed device read (blank)
        if math.isfinite(host_s) and math.isfinite(dev_s):
            rows.append((host_s, dev_s))
    if len(rows) < 2:
        return None                       # `analyze` refuses below two anchors; so do we, for its reason
    res = (analyze_fn or analyze)(rows)
    if not res.get("ok") or res.get("offset_s") is None:
        return None
    last_host_s = max(h for h, _ in rows)
    return {
        # NEGATED — see the sign note above. analyze: host−device; the envelope: device−host.
        "offset_sec": -float(res["offset_s"]),
        "measured_at_ms": _host_epoch_to_floating_ms(last_host_s),
        "reference": ENVELOPE_REFERENCE,
        "method": ENVELOPE_METHOD,
    }


def _host_epoch_to_floating_ms(epoch_s: float) -> float:
    """A real host epoch → Clock-Contract FLOATING wall-clock ms (§1: local civil time encoded as UTC).

    The envelope's other time fields are floating, so a real-UTC value here would be an hour out in
    summer and read as a plausible clock story rather than as a unit error."""
    t = _dt.datetime.fromtimestamp(epoch_s)
    return float(_dt.datetime(t.year, t.month, t.day, t.hour, t.minute, t.second,
                              t.microsecond, tzinfo=_dt.timezone.utc).timestamp() * 1000.0)
