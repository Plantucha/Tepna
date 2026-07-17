# tepna-capture — clockcfg.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Host CLOCK status + config for the monitor page. The Clock Contract (CLAUDE.md §🔒) makes the box's
# wall clock the source of EVERY capture stamp — so the bedside operator needs to (a) see at a glance
# that the box is NTP-synced and on the right timezone, and (b) point NTP at a chosen server / set the
# cadence / set the zone. The READ path uses `timedatectl` (unprivileged); the WRITE path shells out to
# a single narrow NOPASSWD-sudo helper (tepna-clock.sh) so the daemon itself stays non-root.

from __future__ import annotations
import asyncio, os, re, time as _time

_HERE = os.path.dirname(os.path.abspath(__file__))
_HELPER = os.path.join(_HERE, "tepna-clock.sh")

_DUR = re.compile(r"(\d+)\s*(us|ms|s|min|h|d|w)")
_UNIT = {"us": 1e-6, "ms": 1e-3, "s": 1, "min": 60, "h": 3600, "d": 86400, "w": 604800}
# hostname / IPv4 / IPv6 — no shell metacharacters (mirrors the helper's own validation)
_SERVER_RE = re.compile(r"^[A-Za-z0-9.\-:]+$")
_TZ_RE = re.compile(r"^[A-Za-z0-9/_.+\-]+$")


def _dur_to_sec(v):
    """timedatectl prints *USec keys either as raw microseconds or pretty durations ('34min 8s')."""
    if not v:
        return None
    v = v.strip()
    if v.isdigit():
        return int(v) // 1_000_000
    total, found = 0.0, False
    for n, u in _DUR.findall(v):
        total += int(n) * _UNIT[u]; found = True
    return int(total) if found else None


def _kv(text):
    out = {}
    for line in text.splitlines():
        if "=" in line:
            k, v = line.split("=", 1); out[k.strip()] = v.strip()
    return out


async def _run(*args, timeout=12):
    try:
        p = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        out, _ = await asyncio.wait_for(p.communicate(), timeout)
        return p.returncode, out.decode(errors="replace")
    except FileNotFoundError:
        return 127, f"{args[0]} not found"
    except asyncio.TimeoutError:
        return 124, "timed out"


async def status() -> dict:
    """Read-only clock / NTP / timezone status + Clock-Contract health (no privilege needed)."""
    rc1, t = await _run("timedatectl", "show")
    rc2, s = await _run("timedatectl", "show-timesync", "--all")
    a = _kv(t) if rc1 == 0 else {}
    b = _kv(s) if rc2 == 0 else {}
    off_sec = _time.localtime().tm_gmtoff          # seconds east of UTC, current (DST-aware)
    off_min = off_sec // 60 if off_sec is not None else None
    servers = (b.get("SystemNTPServers") or b.get("ServerName") or "").split()
    synced = a.get("NTPSynchronized") == "yes"
    tz = a.get("Timezone")
    return {
        "available": rc1 == 0,
        "ntp_enabled": a.get("NTP") == "yes",       # systemd time sync turned on
        "synchronized": synced,
        "timezone": tz,
        "offset_min": off_min,
        "host_time": a.get("TimeUSec"),             # human string from timedatectl
        "server_active": b.get("ServerName") or None,
        "servers": servers,
        "fallback": (b.get("FallbackNTPServers") or "").split(),
        "poll_min_sec": _dur_to_sec(b.get("PollIntervalMinUSec")),
        "poll_max_sec": _dur_to_sec(b.get("PollIntervalMaxUSec")),
        "poll_now_sec": _dur_to_sec(b.get("PollIntervalUSec")),
        "can_write": os.access(_HELPER, os.X_OK),   # helper present; sudoers still required on the box
        # Clock-Contract health (the box side of CLAUDE.md §🔒):
        "contract": {
            "synced": synced,                       # stamps trace to real time
            "tz_set": bool(tz),                     # a local zone is set (contract needs the REAL local zone)
            "stamp_format": "local-civil, zone-free",  # how writers.py emits — always compliant by construction
        },
    }


def _valid_servers(servers):
    return [s for s in servers if s and _SERVER_RE.match(s)]


async def _helper(*args, sudo=True, timeout=20):
    if not os.access(_HELPER, os.X_OK):
        return {"ok": False, "detail": "helper tepna-clock.sh missing / not executable"}
    cmd = (["sudo", "-n"] if sudo else []) + [_HELPER, *args]
    rc, out = await _run(*cmd, timeout=timeout)
    return {"ok": rc == 0, "detail": out.strip()[:400]}


async def set_ntp(servers, poll_max_sec, sudo=True) -> dict:
    servers = _valid_servers(servers)
    if not servers:
        return {"ok": False, "detail": "no valid NTP server"}
    try:
        poll_max = max(64, min(86400, int(poll_max_sec)))
    except (ValueError, TypeError):
        return {"ok": False, "detail": "bad interval"}
    r = await _helper("ntp", str(poll_max), *servers, sudo=sudo)
    r.update(servers=servers, poll_max_sec=poll_max)
    return r


async def sync_now(sudo=True) -> dict:
    return await _helper("sync", sudo=sudo)


async def set_tz(zone, sudo=True) -> dict:
    zone = (zone or "").strip()
    if not _TZ_RE.match(zone):
        return {"ok": False, "detail": "bad timezone"}
    r = await _helper("tz", zone, sudo=sudo)
    r.update(timezone=zone)
    return r
