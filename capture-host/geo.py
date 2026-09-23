#!/usr/bin/env python3
# tepna-capture — geo.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Session ELEVATION from an optional GNSS receiver — the one profile field a travelling box cannot
guess, and the one whose wrong default manufactures findings.

WHY THIS EXISTS. `dex-profile.js` carries an `elevation` the analysis actually consumes: OxyDex lowers
the healthy SpO2 threshold by ~1.8 %/1000 m (Roach 1998 / AMS guidance), and HRVDex/ECGDex apply an
altitude factor to the Uth-Sorensen VO2max. Both read a value a human typed once. On a box that
travels, that value is stale the moment the box moves, and it is stale in the direction that invents
pathology: a night recorded at 2500 m against a profile still saying 0 m reads as ~4.5 % of
desaturation that never happened. A receiver on the box knows the answer every night, for free.

∅ ABSENCE IS NULL, NEVER SEA LEVEL — this module's whole reason for existing (CLAUDE.md §∅).
`elevation_m` is `None` when there is no receiver, no fix, or an unusable fix. It is NEVER 0.0, and
callers must not coerce it: `0` is a LEGAL ELEVATION (the sea) and the consumers cannot tell a
fabricated sea level from a measured one. The JS side today writes `num(p.elevation) || 0` in four
places, which is exactly that coercion; a null here is only honest if it stays null downstream.

🔴 OPTIONAL BY CONSTRUCTION, and that is a hard requirement rather than a courtesy. Tepna is public and
almost nobody running it has a GNSS receiver wired to their capture host. Absent config ⇒ this module
is never called; present config with no device ⇒ `None` and one log line; present device with no fix ⇒
`None`. At no point does a missing receiver degrade a capture, and at no point does it produce a
number. The feature can only ever ADD a measurement that was previously absent.

PRIVACY — ELEVATION IS RECORDED, POSITION IS NOT, unless explicitly asked for. The analysis needs
altitude; it has no use for latitude and longitude, and a medical recording carrying the patient's
coordinates to six decimal places is a liability nobody asked for. `record_position` defaults to
False, so `lat`/`lon` are dropped after the elevation is derived from the same sentence.

SCOPE: NMEA only, read-only. This module never writes to the receiver — no UBX configuration, no baud
changes, no resets. A receiver shared with something else (a GPSDO, a radio) keeps working.
"""
from __future__ import annotations

import logging

log = logging.getLogger("tepna-capture")

# A fix must be at least this good before its altitude is believed. HDOP is the horizontal figure and
# altitude is the WEAKER axis (VDOP typically ~2x HDOP), so this is deliberately loose: it rejects a
# scatter-fix, not a merely ordinary one. Measured on a real M10 indoors: HDOP 0.62-0.88 with 12 sats.
MAX_HDOP = 5.0
# GGA quality: 1 = GPS fix, 2 = DGPS/SBAS, 4/5 = RTK. 0 = NO FIX, and 6 = dead reckoning, which is an
# INFERENCE rather than a measurement and is therefore refused like any other unmeasured value.
_USABLE_QUALITY = frozenset((1, 2, 4, 5))
# Below this many satellites the altitude is not trustworthy even at a good HDOP.
MIN_SATS = 4


def _f(v):
    """float(v) or None — an unparseable field is ABSENT, never 0.0."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _dm_to_deg(raw, hemi, deg_digits):
    """NMEA ddmm.mmmm / dddmm.mmmm -> signed degrees. None if either half is unusable."""
    if not raw or len(raw) < deg_digits + 2 or hemi not in ("N", "S", "E", "W"):
        return None
    d, m = _f(raw[:deg_digits]), _f(raw[deg_digits:])
    if d is None or m is None:
        return None
    val = d + m / 60.0
    return -val if hemi in ("S", "W") else val


def parse_gga(line: str) -> dict | None:
    """One `$xxGGA` sentence -> `{elevation_m, quality, sats, hdop, lat, lon}`, or None.

    PURE. Returns None for anything that is not a usable GGA: wrong sentence, short field list,
    no-fix quality, or an absent altitude. A partially-parsed GGA is NOT returned with holes in it —
    a caller that receives a dict may rely on `elevation_m` being a real measurement.

    ⚠️ The altitude reported by GGA is MSL (field 9), with the geoid separation in field 11. MSL is
    what the SpO2 literature means by elevation, so field 9 is the one taken. The ellipsoidal height
    (`msl + separation`) is ~32 m different here and is NOT what the norms are keyed to.
    """
    if not line or "GGA" not in line[:7] or not line.startswith("$"):
        return None
    f = line.strip().split("*")[0].split(",")
    if len(f) < 12:
        return None
    q = _f(f[6])
    if q is None or int(q) not in _USABLE_QUALITY:
        return None
    alt = _f(f[9])
    if alt is None:
        return None
    sats = _f(f[7])
    hdop = _f(f[8])
    return {
        "elevation_m": alt,
        "quality": int(q),
        "sats": None if sats is None else int(sats),
        "hdop": hdop,
        "lat": _dm_to_deg(f[2], f[3], 2),
        "lon": _dm_to_deg(f[4], f[5], 3),
    }


def usable(fix: dict | None) -> bool:
    """Is this fix good enough to let its altitude reach an analysis that grades SpO2 on it?

    A fix that fails here is DISCARDED, not down-weighted: the consumer has no way to express
    'elevation, but only a bit', so a doubtful metre is worth less than an honest null.
    """
    if not fix:
        return False
    if fix.get("sats") is None or fix["sats"] < MIN_SATS:
        return False
    if fix.get("hdop") is None or fix["hdop"] > MAX_HDOP:
        return False
    return True


def best_fix(lines) -> dict | None:
    """Best usable fix from a batch of NMEA lines, by lowest HDOP. None if none qualifies.

    Lowest-HDOP rather than last-seen: the batch spans seconds during which the constellation does not
    meaningfully change, so the sharpest fix in it is the best estimate of a stationary box's
    altitude, and taking the last one would make the answer depend on where the read happened to stop.
    """
    best = None
    for ln in lines:
        fx = parse_gga(ln)
        # `usable()` already rejects None, but a checker cannot see through it, and widening `usable`
        # into a TypeGuard would make a narrowing claim the runtime does not need. Explicit is cheaper.
        if fx is None or not usable(fx):
            continue
        if best is None or fx["hdop"] < best["hdop"]:
            best = fx
    return best


def session_geo(lines, record_position: bool = False) -> dict | None:
    """The record a night carries: elevation + how well it was known. None when nothing qualifies.

    `record_position` is OFF by default — see the module docstring. The coordinates are parsed either
    way (the elevation comes from the same sentence) and then dropped, so enabling it is a disclosure
    decision rather than a capability change.
    """
    fx = best_fix(lines)
    if fx is None:
        return None
    out = {
        "elevation_m": round(fx["elevation_m"], 1),
        "fix_quality": fx["quality"],
        "sats": fx["sats"],
        "hdop": fx["hdop"],
        "source": "gnss",
    }
    if record_position:
        out["lat"] = None if fx["lat"] is None else round(fx["lat"], 5)
        out["lon"] = None if fx["lon"] is None else round(fx["lon"], 5)
    return out


def read_nmea(port: str, baud: int = 38400, seconds: float = 5.0, _serial=None) -> list:
    """Thin I/O: collect NMEA lines for `seconds`. [] on ANY failure — absent hardware is not an error.

    `_serial` is injected for tests. Everything above this line is pure and gate-covered; this is the
    only part that touches a device, and it is deliberately the only part that cannot be.

    🔴 FAILS OPEN TO EMPTY, NEVER RAISES. A capture host must not lose a night because an optional
    receiver was unplugged, so every failure mode — missing port, permissions, wrong baud, a device
    that is not a GNSS at all — converges on [] and one WARNING, which `session_geo` turns into None.
    """
    # INJECTION IS CHECKED FIRST, and that ordering is the point: importing before choosing made the
    # `_serial` stand-in useless on any host without pyserial — which is every host the injection
    # exists to serve, and is how this was caught. A test double must not depend on the real thing.
    mod = _serial
    if mod is None:
        try:
            import serial as _s  # noqa: PLC0415 — optional dep; absent on hosts with no receiver
        except Exception:
            log.warning("geo: pyserial is not installed — elevation absent, capture unaffected")
            return []
        mod = _s
    import time as _t
    lines = []
    try:
        with mod.Serial(port, baud, timeout=1.0) as sp:
            end = _t.monotonic() + seconds
            while _t.monotonic() < end:
                raw = sp.readline()
                if raw:
                    lines.append(raw.decode("ascii", "replace").strip())
    except Exception as exc:  # noqa: BLE001 — see the docstring: every failure is the same answer
        log.warning("geo: no usable GNSS on %s (%s) — elevation absent, capture unaffected",
                    port, type(exc).__name__)
        return []
    return lines


def session_elevation(cfg, _reader=read_nmea) -> dict | None:
    """Config -> the night's geo record, or None. THE ONLY ENTRY POINT capture.py needs.

    Absent/disabled config short-circuits before any import or device access, so a host with no
    receiver pays nothing and logs nothing.
    """
    gcfg = (cfg or {}).get("geo") or {}
    if not gcfg.get("enabled"):
        return None
    port = gcfg.get("port")
    if not port:
        log.warning("geo: enabled but no port configured — elevation absent")
        return None
    lines = _reader(port, int(gcfg.get("baud", 38400)), float(gcfg.get("read_sec", 5.0)))
    geo = session_geo(lines, bool(gcfg.get("record_position")))
    if geo is None:
        log.info("geo: no usable fix on %s — elevation absent for this session (not 0 m)", port)
    else:
        log.info("geo: elevation %.1f m (quality %s, %s sats, HDOP %s)",
                 geo["elevation_m"], geo["fix_quality"], geo["sats"], geo["hdop"])
    return geo
