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
import proc_util

# Stratum 1 is a reference clock (GPS/PPS/atomic); each hop adds a stratum. Beyond this the chain is
# too long to call a session's absolute time well-sourced — 15 is "unsynchronised" by RFC 5905.
MAX_TRUSTED_STRATUM = 4
# THE TIMEBASE-DECISION BAR (O2RING-ADAPTIVE-TIMEBASE Stage 3) — STRICTER than absolute-time trust.
# `classify()` grants absolute_ok up to stratum 4; but trusting the host's RATE (to discipline the O2Ring
# PPG axis rather than ride its ±40 ppm crystal) is a higher bar: a stratum-2+ NTP client is absolute_ok
# yet its frequency stability may be worse than the crystal. So host-discipline is EARNED — the source
# must be a genuine reference clock (stratum ≤ 1, PPS/GPS-backed) AND, where chrony reports it, a
# frequency skew within the bar. Everything else defaults to the device crystal (the safe floor).
TIMEBASE_MAX_STRATUM = 1
# chrony's `Skew` is the estimated frequency-error bound (ppm). 1 ppm is ~40× tighter than the crystal's
# ±40 ppm, so below it the host rate is unambiguously the better reference; above it, fall back. Absent
# (timesyncd, or chrony not yet settled) ⇒ decided on stratum alone — a stratum-1 source is rate-accurate
# by construction, so its absence is not held against it.
TIMEBASE_MAX_SKEW_PPM = 1.0
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


_CHRONY_REFID_RE = re.compile(r"^\s*([0-9A-Fa-f]+)\s*(?:\(([^)]*)\))?\s*$")


def parse_chrony_tracking(blob: str) -> dict:
    """`chronyc tracking` → the same shape `parse_ntp_message` produces, so `classify()` grades a
    chrony-disciplined host by exactly the same rules as a timesyncd one.

    WHY THIS EXISTS. Ubuntu Server (and RHEL) default to **chrony**, not systemd-timesyncd, and
    `timedatectl show-timesync` is a timesyncd interface — it tells you nothing on a chrony box. Without
    this reader the daemon still sees `NTPSynchronized=yes` and grades the host `disciplined`, but via
    the weakest branch ("synchronised; stratum not yet reported"): it believes the flag with none of the
    evidence behind it. On a box whose upstream is a stratum-1 PPS source that is a real loss, and
    chrony is the better clock — the fix belongs here, not in a downgrade of the time daemon.

    ⚠️ STRATUM MEANS TWO DIFFERENT THINGS AND THEY MUST NOT BE MIXED. `timedatectl`'s
    `NTPMessage.Stratum` is the stratum of the SERVER we synced to. `chronyc tracking`'s `Stratum` is
    THIS HOST's stratum, which is the server's + 1. Feeding chrony's number straight into
    `MAX_TRUSTED_STRATUM` would silently tighten the trust threshold by one hop and make the two
    readers disagree about an identical clock. So this normalises to the SERVER's stratum — the
    definition already recorded in every CLOCK sidecar written so far, which must stay comparable.

    The one clamp: a host at tracking-stratum 1 holds its OWN reference clock (PPS/GPS), so there is no
    network server above it. It is reported as source-stratum 1 rather than 0 — a locally attached
    reference is not less trustworthy than a stratum-1 server, and `classify()` treats `<= 0` as
    invalid. Stated here rather than hidden in the arithmetic.
    """
    out: dict = {}
    if not blob:
        return out
    for line in blob.splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        out[k.strip()] = v.strip()
    res: dict = {}
    raw_stratum = _num(out.get("Stratum"))
    if raw_stratum is not None:
        n = int(raw_stratum)
        # chrony reports Stratum 0 with a null Reference ID when it has no usable source at all.
        res["stratum"] = None if n <= 0 else max(1, n - 1)
        res["host_stratum"] = n          # kept verbatim: the normalisation above must stay auditable
    m = _CHRONY_REFID_RE.match(out.get("Reference ID", ""))
    if m:
        refid, name = m.group(1), (m.group(2) or "").strip()
        # A refclock's ID is ASCII packed into 4 bytes (PPS, GPS, NMEA); a network server's is its IP in
        # hex. chrony prints the decoded form in parentheses, so prefer that and fall back to the hex.
        res["reference"] = name or refid or None
        if name and any(c.isdigit() for c in name) and "." in name:
            res["server"] = name
        elif name:
            res["server"] = None         # a reference-clock name is not a server address
    rd = _num(out.get("Root dispersion"))
    if rd is not None:
        res["root_dispersion_ms"] = round(rd * 1000.0, 4)      # chrony prints seconds
    rms = _num(out.get("RMS offset"))
    if rms is not None:
        res["jitter_us"] = round(rms * 1e6, 1)                 # closest analogue to timesyncd's Jitter
    # chrony's `Skew` is the estimated ERROR BOUND on the clock's frequency, in ppm — the single best
    # measure of how precisely the box's rate is disciplined, and the field the adaptive-timebase decision
    # (O2RING-ADAPTIVE-TIMEBASE Stage 3) will gate host-discipline on. Already in ppm, so no unit convert.
    # timesyncd exposes no equivalent, so this is chrony-only and stays absent (None) on the timesyncd path.
    skew = _num(out.get("Skew"))
    if skew is not None:
        res["skew_ppm"] = skew
    leap = (out.get("Leap status") or "").lower()
    if leap:
        # "Not synchronised" is chrony's own verdict and outranks timedatectl's cached NTPSynchronized.
        res["leap_ok"] = leap != "not synchronised"
    return res


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
    # A stratum that was REPORTED but could not be read is not the same as one that was never reported.
    # `read_state` used to parse it with `.isdigit()`, so anything non-integer ("16.0", "n/a") became
    # None and fell into the "not yet reported" branch below — which TRUSTS. That is a fail-OPEN on the
    # single field gating absolute-time trust: an unreadable stratum would have been graded `disciplined`.
    # Absence of evidence is not evidence of health (this module's governing rule), so an unparseable
    # value is holdover, while a genuinely absent one keeps the documented benefit of the doubt.
    if state.get("stratum_unparsed"):
        return {"trust": "holdover", "absolute_ok": False,
                "reason": "NTP reported a stratum we could not parse — absolute time unverified"}
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


def timebase_decision(state: dict) -> dict:
    """Which RATE reference this capture should be analysed on. PURE — the part worth gating.

    O2RING-ADAPTIVE-TIMEBASE §2. Two outcomes:
      device-crystal   — DEFAULT. The O2Ring's 125.000 Hz crystal (±40 ppm), trustworthy anywhere; the
                         safe floor. Anything short of an EARNED host is analysed on it.
      host-disciplined — the host clock governs the rate. EARNED, not merely absolute_ok: the source must
                         be a reference clock (stratum ≤ TIMEBASE_MAX_STRATUM) AND, where chrony reports
                         it, a frequency skew within TIMEBASE_MAX_SKEW_PPM. A stratum-2+ NTP client is
                         absolute_ok but its rate may be worse than the crystal, so it stays on the crystal.

    Returns { timebase, reason } — the fact stamped per capture so a reader sees which clock governed the
    night and why. This does NOT stop syncing or change absolute-time handling; it only picks the RATE."""
    c = classify(state)
    if not c.get("absolute_ok"):
        return {"timebase": "device-crystal",
                "reason": f"host clock not disciplined ({c.get('reason')}) — device crystal"}
    st = state.get("stratum")
    if st is None or st > TIMEBASE_MAX_STRATUM:
        return {"timebase": "device-crystal",
                "reason": (f"source-stratum {st} above the rate-trust bar "
                           f"(≤{TIMEBASE_MAX_STRATUM}) — device crystal")}
    skew = state.get("chrony_skew_ppm")
    if skew is not None and skew > TIMEBASE_MAX_SKEW_PPM:
        return {"timebase": "device-crystal",
                "reason": (f"chrony skew {skew} ppm exceeds the {TIMEBASE_MAX_SKEW_PPM} ppm bar "
                           f"— device crystal")}
    return {"timebase": "host-disciplined",
            "reason": (f"stratum-{st} reference, skew {'n/a' if skew is None else str(skew) + ' ppm'} "
                       f"— host rate trusted")}


async def _run(*args: str, timeout: float = 4.0) -> tuple[int, str]:
    try:
        p = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        out, _ = await proc_util.communicate(p, timeout)
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
    # WHICH DAEMON IS ACTUALLY DISCIPLINING THIS BOX. Ubuntu Server defaults to chrony, on which
    # `show-timesync` returns nothing useful — so try chrony whenever timesyncd gave us no NTPMessage.
    # `-n` keeps it off DNS: this must never block on name resolution, and an IP is the honest record.
    time_source = "timesyncd" if msg.get("Stratum") else None
    ch: dict = {}
    if not time_source:
        rc3, c = await _run("chronyc", "-n", "tracking")
        if rc3 == 0:
            ch = parse_chrony_tracking(c)
            if ch:
                time_source = "chrony"
    # `_num` rather than `.isdigit()` — it already handles the unit-suffixed/whitespace forms systemd
    # uses elsewhere, and it lets us tell "absent" from "present but unreadable" (see classify()).
    _raw_stratum = msg.get("Stratum")
    _stratum_num = _num(_raw_stratum)
    _raw_packets = msg.get("PacketCount")
    _packets_num = _num(_raw_packets)
    state = {
        "available": rc1 == 0,
        "ntp_enabled": a.get("NTP") == "yes",
        # chrony's own `Leap status` outranks timedatectl's cached NTPSynchronized: chrony knows it has
        # lost its sources before systemd's flag catches up, and the safe direction is to believe the
        # daemon that is actually steering the clock.
        "synchronized": (a.get("NTPSynchronized") == "yes"
                         and ch.get("leap_ok", True)),
        "server": ch.get("server") if time_source == "chrony"
                  else (b.get("ServerName") or b.get("ServerAddress") or None),
        "stratum": (ch.get("stratum") if time_source == "chrony"
                    else (int(_stratum_num) if _stratum_num is not None else None)),
        # True == systemd gave us a Stratum we could not read. Distinct from a missing one; classify()
        # treats it as holdover rather than inheriting the trusted "not yet reported" branch.
        "stratum_unparsed": bool((_raw_stratum or "").strip()) and _stratum_num is None,
        # `Reference=PPS` means the upstream is a pulse-per-second reference clock — i.e. that server is
        # itself GPS/atomic-disciplined. Worth recording: it is the difference between "some NTP box"
        # and a real stratum-1. chrony reports the same idea as its decoded Reference ID.
        "reference": (ch.get("reference") if time_source == "chrony"
                      else (msg.get("Reference") or None)),
        "root_dispersion_ms": (ch.get("root_dispersion_ms") if time_source == "chrony"
                               else _num(msg.get("RootDispersion"))),
        # Clock-frequency precision (ppm error bound). chrony-only — timesyncd's NTPMessage has no analogue,
        # so it is None on that path rather than a fabricated 0. Recorded per capture (CLOCK sidecar) as the
        # "what clock precision governed this night" fact; the Stage-3 timebase decision reads it.
        "chrony_skew_ppm": (ch.get("skew_ppm") if time_source == "chrony" else None),
        "jitter_us": (ch.get("jitter_us") if time_source == "chrony"
                      else _num(msg.get("Jitter"))),
        # chrony has no "we received it and refused it" counter; absent means absent, not false-clean.
        "ignored": msg.get("Ignored") == "yes",
        "packet_count": int(_packets_num) if _packets_num is not None else None,
        # WHICH daemon produced the numbers above. Provenance about the provenance: a CLOCK sidecar with
        # a stratum but no named source is unreadable after the fact unless it says who was asked.
        "time_source": time_source,
        # chrony's raw tracking stratum, un-normalised, so the -1 in parse_chrony_tracking stays auditable.
        "host_stratum": ch.get("host_stratum"),
    }
    state.update(classify(state))
    # The RATE reference this capture should be analysed on (O2RING-ADAPTIVE-TIMEBASE Stage 3). Stamped
    # per capture (CLOCK sidecar) so a reader — and PpgDex, once it consumes the stamp — sees which clock
    # governed the night. `timebase_decision` reads chrony_skew_ppm + stratum from the state built above.
    state["timebase"] = timebase_decision(state)["timebase"]
    return state
