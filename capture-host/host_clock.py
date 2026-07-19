# tepna-capture — host_clock.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# HOST CLOCK PROVENANCE — what disciplined this box's clock, and may we believe it?
#
# WHY THIS EXISTS. The capture host pushes its own time into all three sensors (H10, Verity, O2Ring), so
# a wrong host clock does not produce an obviously broken night — it produces a night that is
# SELF-CONSISTENTLY wrong. Cross-device work (PAT) still succeeds, because that only needs a common
# base; but the absolute wall time is wrong and nothing looks amiss. Every pill stays green. That is the
# same failure class as claiming export-inertness without computing it: confidence with no evidence.
# Until now nothing in the capture path consulted the host's sync state at all.
#
# THE RULE THIS ENCODES: an untrusted host clock must NOT stop us syncing the devices — keeping the
# three on one base is what PAT depends on, and a device left at its 2019 firmware default is strictly
# worse. What it must do is STAMP THE SESSION as absolute-time-unverified, so the wrongness is recorded
# rather than silently inherited.
#
# Read-only and unprivileged: `timedatectl show` + `show-timesync --all`. No writes, no sudo.

from __future__ import annotations
import asyncio, re

# Stratum 1 is a reference clock (GPS/PPS/atomic); each hop adds a stratum. Beyond this the chain is
# too long to call a session's absolute time well-sourced — 15 is "unsynchronised" by RFC 5905.
MAX_TRUSTED_STRATUM = 4
# systemd reports `Ignored=yes` when it received a reply but REFUSED it (root distance too large, etc).
# A refused packet is not a sync, no matter how healthy the rest of the line looks.


def parse_ntp_message(blob: str) -> dict:
    """`NTPMessage={ Leap=0, ..., Stratum=1, ..., Reference=PPS, ..., Jitter=170us }` → dict.

    Kept as a PURE function so the trust rules can be tested without a machine that happens to have the
    right clock state. Values stay strings except the few we genuinely need numerically."""
    out: dict = {}
    if not blob:
        return out
    inner = blob.strip()
    if inner.startswith("{"):
        inner = inner[1:]
    if inner.endswith("}"):
        inner = inner[:-1]
    # Split on commas that separate key=value pairs. Timestamps contain commas? They do not in
    # systemd's format ("Sat 2026-07-18 18:04:29 EDT"), but they DO contain spaces — so split on
    # comma and keep the first '=' only.
    for part in inner.split(","):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def _num(text: str | None):
    """'1.113ms' → 1.113 (ms), '170us' → 170 (us), '0' → 0.0. Unit-naive: the CALLER names the unit,
    because systemd already fixes it per field. None when absent/unparseable — never a fabricated 0."""
    if not text:
        return None
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?)", text)
    return float(m.group(1)) if m else None


def classify(state: dict) -> dict:
    """Trust verdict for a host-clock state. PURE — this is the part worth gating.

    Three outcomes, and the distinction that matters is between *disciplined* and *holdover*:
      disciplined — an accepted NTP sync from a plausible stratum. Absolute time is sourced.
      holdover    — the box is running on its own oscillator/RTC. It may be seconds or years out and it
                    CANNOT know which. Data is still worth capturing; the session is marked.
      unknown     — we could not read the state (no timedatectl, container, permission). Absence of
                    evidence is not evidence of health, so this is NOT treated as trusted.
    """
    if not state.get("available"):
        return {"trust": "unknown", "absolute_ok": False,
                "reason": "host clock state unreadable — treating absolute time as unverified"}
    if not state.get("ntp_enabled"):
        return {"trust": "holdover", "absolute_ok": False,
                "reason": "network time is disabled — the clock is free-running on the RTC"}
    if not state.get("synchronized"):
        return {"trust": "holdover", "absolute_ok": False,
                "reason": "NTP enabled but never synchronised — running on the RTC, drift unknown"}
    if state.get("ignored"):
        return {"trust": "holdover", "absolute_ok": False,
                "reason": "the NTP reply was received but REFUSED (root distance too large)"}
    st = state.get("stratum")
    if st is None:
        # Synchronised per systemd but no NTPMessage yet (it clears on restart). Believe the flag, say so.
        return {"trust": "disciplined", "absolute_ok": True,
                "reason": "synchronised; stratum not yet reported"}
    if st <= 0 or st > MAX_TRUSTED_STRATUM:
        return {"trust": "holdover", "absolute_ok": False,
                "reason": f"stratum {st} is outside the trusted chain (1-{MAX_TRUSTED_STRATUM})"}
    ref = state.get("reference") or "?"
    return {"trust": "disciplined", "absolute_ok": True,
            "reason": f"synchronised to stratum {st} via {state.get('server') or 'NTP'} (ref {ref})"}


async def _run(*args: str, timeout: float = 4.0) -> tuple[int, str]:
    try:
        p = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        out, _ = await asyncio.wait_for(p.communicate(), timeout=timeout)
        return p.returncode or 0, (out or b"").decode("utf-8", "replace")
    except (FileNotFoundError, OSError, asyncio.TimeoutError):
        return 127, ""


def _kv(text: str) -> dict:
    d = {}
    for line in text.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            d[k.strip()] = v.strip()
    return d


async def read_state() -> dict:
    """Current host-clock provenance + its trust verdict. Never raises."""
    rc1, t = await _run("timedatectl", "show")
    rc2, s = await _run("timedatectl", "show-timesync", "--all")
    a = _kv(t) if rc1 == 0 else {}
    b = _kv(s) if rc2 == 0 else {}
    msg = parse_ntp_message(b.get("NTPMessage", ""))
    stratum = msg.get("Stratum")
    state = {
        "available": rc1 == 0,
        "ntp_enabled": a.get("NTP") == "yes",
        "synchronized": a.get("NTPSynchronized") == "yes",
        "server": b.get("ServerName") or b.get("ServerAddress") or None,
        "stratum": int(stratum) if (stratum or "").isdigit() else None,
        # `Reference=PPS` means the upstream is a pulse-per-second reference clock — i.e. that server is
        # itself GPS/atomic-disciplined. Worth recording: it is the difference between "some NTP box"
        # and a real stratum-1.
        "reference": msg.get("Reference") or None,
        "root_dispersion_ms": _num(msg.get("RootDispersion")),
        "jitter_us": _num(msg.get("Jitter")),
        "ignored": msg.get("Ignored") == "yes",
        "packet_count": int(msg["PacketCount"]) if (msg.get("PacketCount") or "").isdigit() else None,
    }
    state.update(classify(state))
    return state
