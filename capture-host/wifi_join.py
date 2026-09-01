# tepna-capture — wifi_join.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# JOIN A WI-FI NETWORK FROM THE MONITOR — scan, pick, enter the passphrase once, connect.
#
# For a box that travels: a phone hotspot or a hotel network, set from the bedside page instead of an
# SSH session. Today `wlp1s0` is DOWN and unmanaged (netplan configures only `eno1`, and no
# supplicant owns the interface), so this feature owns it the same way the CPAP harvest already does.
#
# 🔴 WHAT "SAVED SECURELY" MEANS HERE, STATED EXACTLY, BECAUSE THE WORD "ENCRYPTED" WOULD BE A LIE.
# The passphrase is converted to a PSK — PBKDF2-SHA1, 4096 iterations, salted with the SSID — by
# `wpa_passphrase`. That is a ONE-WAY derivation: the plaintext cannot be recovered from what lands
# on disk, and the plaintext is what people reuse across other accounts. The file is then written
# 0600.
#
# ⚠️ IT IS NOT ENCRYPTION AND IT IS NOT SECRET. The PSK is password-EQUIVALENT for joining that one
# network: anyone who reads the file can connect to it. Encryption at rest would need a key, and a
# key stored on the same unattended box is obfuscation wearing the word "encrypted". What this
# actually buys is real but bounded, and worth having: your reused plaintext never touches the disk.
#
# 🔴 AND THE TRAP THIS MODULE AVOIDS BY CONSTRUCTION: `wpa_passphrase(8)` — the obvious way to derive
# a PSK — takes the passphrase as an ARGV element and writes it BACK into its own output as a
# `#psk="…"` comment. So the textbook implementation leaks it twice: once through
# /proc/<pid>/cmdline while it runs, and once onto disk beside the derivation meant to replace it.
# `derive_psk` does the PBKDF2 in this process instead, so neither leak has a path to exist.
#
# (An earlier revision shelled out to `wpa_passphrase` and scrubbed its comment afterwards with a
# `sanitize_block` helper. Removing the leak beats laundering it, and once the derivation moved
# in-process that helper was cleaning an output nothing produced — the `unwired` gate caught it
# sitting there referenced only by its own tests.)

from __future__ import annotations

import hashlib
import re

__all__ = [
    "derive_psk",
    "MIN_PSK_LEN",
    "MAX_PSK_LEN",
    "parse_scan_results",
    "validate_passphrase",
    "OPEN",
    "SECURED",
]

OPEN = "open"
SECURED = "secured"

# WPA-PSK passphrase bounds (IEEE 802.11i): 8–63 printable ASCII, or a 64-hex PSK.
MIN_PSK_LEN = 8
MAX_PSK_LEN = 63



# A wpa_cli ssid field that is nothing but escape sequences. Anchored to the WHOLE field: a real name
# may legitimately contain an escape (a non-ASCII character in a café's network name arrives escaped
# too), and dropping those would hide joinable networks — the opposite failure, and the worse one.
_ALL_ESCAPES = re.compile(r"^(?:\\x[0-9a-fA-F]{2})+$")


def _is_unprintable_ssid(ssid):
    """True when the ssid is entirely escape sequences — a hidden network, not a name."""
    return bool(_ALL_ESCAPES.match(ssid))


def parse_scan_results(text):
    """`[{ssid, signal, security, bssid}]` from `wpa_cli scan_results`, best signal first. PURE.

    The command's output is TSV with a header: `bssid / frequency / signal level / flags / ssid`.

    ⚠️ HIDDEN AND DUPLICATE SSIDs ARE BOTH REAL. A hidden network is dropped — it cannot be joined
    from a list of names. A repeated ssid is one network on several APs (every hotel has dozens), and
    it is collapsed to its STRONGEST sighting, or the picker becomes a wall of identical rows.

    🔴 A HIDDEN NETWORK IS NOT A BLANK FIELD, WHICH IS WHAT THIS FUNCTION USED TO ASSUME.
    `wpa_cli` renders a non-printable ssid as an ESCAPE STRING, so a hidden AP arrives as the literal
    25 characters `\x00\x00\x00…`, not as "". Dropping only blanks therefore let it straight through,
    and it rendered in the picker as a clickable row of escape sequences that could never join
    anything. Measured against the real radio on vigil 2026-08-30 — the first scan ever run against
    live air, which is exactly when this class of assumption surfaces. The prior test used "" because
    that is what a hidden network was IMAGINED to look like; nothing had asked the hardware."""
    best = {}
    for line in str(text or "").splitlines():
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 5 or parts[0].lower().startswith("bssid"):
            continue
        bssid, _freq, sig, flags, ssid = parts[0], parts[1], parts[2], parts[3], "\t".join(parts[4:])
        ssid = ssid.strip()
        if not ssid or _is_unprintable_ssid(ssid):
            continue  # hidden — not selectable by name
        try:
            signal = int(sig)
        except ValueError:
            continue   # a scan row with no parseable signal cannot be ranked, and showing it
                       # unranked would put an unknown-strength network among measured ones
        sec = SECURED if re.search(r"WPA|WEP|PSK|SAE", flags or "", re.I) else OPEN
        prev = best.get(ssid)
        if prev is None or signal > prev["signal"]:
            best[ssid] = {"ssid": ssid, "signal": signal, "security": sec, "bssid": bssid}
    return sorted(best.values(), key=lambda n: (-n["signal"], n["ssid"]))


def _is_hex_psk(passphrase):
    """True when `passphrase` is already a raw 64-hex PSK rather than a human passphrase."""
    p = passphrase if isinstance(passphrase, str) else ""
    return len(p) == 64 and re.fullmatch(r"[0-9a-fA-F]{64}", p) is not None


# WPA-Personal's PSK is PBKDF2-HMAC-SHA1(passphrase, ssid, 4096 iterations, 32 bytes) — IEEE 802.11i
# Annex J.4. Deriving it HERE rather than shelling out to `wpa_passphrase` is a security property, not a
# convenience: that tool takes the passphrase as an ARGV element, and every argument of every process is
# world-readable through /proc/<pid>/cmdline for the lifetime of the call. In-process it never leaves
# this address space. Pinned byte-for-byte against `wpa_passphrase` output in the tests.
#
# 🔴 THIS IS A ONE-WAY DERIVATION, NOT ENCRYPTION — and the difference matters to anyone reading the
# stored file. It destroys the plaintext (so a saved network cannot give up the passphrase the owner
# typed, which may be reused elsewhere), but the 64-hex result it leaves behind IS the credential that
# joins that network: possession of it is possession of access. Store it 0600 and never call it
# "encrypted".
def derive_psk(ssid, passphrase):
    """The 64-hex WPA-PSK for `passphrase` on network `ssid`.

    A passphrase that is ALREADY a 64-hex PSK is returned lowercased and underived — deriving a
    derivation would silently produce a key that joins nothing."""
    if _is_hex_psk(passphrase):
        return passphrase.lower()
    return hashlib.pbkdf2_hmac(
        "sha1", passphrase.encode("utf-8"), ssid.encode("utf-8"), 4096, 32
    ).hex()


def validate_passphrase(ssid, passphrase, security=SECURED):
    """`(ok, error)` before anything is derived or written. PURE.

    Checked HERE rather than letting `wpa_passphrase` fail, so the operator gets a sentence instead of
    a subprocess exit code — and so a too-short passphrase never reaches a command line at all."""
    if not str(ssid or "").strip():
        return False, "choose a network first"
    if len(str(ssid).encode("utf-8")) > 32:
        return False, "that SSID is longer than 802.11 allows (32 bytes)"
    if security == OPEN:
        return (True, None) if not passphrase else (False, "that network is open — leave the password empty")
    p = passphrase if isinstance(passphrase, str) else ""
    if _is_hex_psk(p):
        return True, None  # already a raw PSK; accepted as-is
    if len(p) < MIN_PSK_LEN:
        return False, f"a Wi-Fi password is at least {MIN_PSK_LEN} characters"
    if len(p) > MAX_PSK_LEN:
        return False, f"a Wi-Fi password is at most {MAX_PSK_LEN} characters"
    return True, None


# ── ONE RADIO, TWO USERS — the uplink yields to the harvest ────────────────────────────────────
# Owner's call, 2026-08-30: "disconnect automatically when harvesting the CPAP SD card." There is a
# single `wl*` interface on this box, and the ez-share harvest needs it to associate with the SD
# card's own access point. So the uplink and the harvest cannot both hold it.
#
# 🔴 THE DANGEROUS HALF IS RESUME, NOT SUSPEND. If the box is travelling and Wi-Fi is its only route,
# a harvest that suspends the uplink and then fails to restore it leaves the box unreachable — the
# harvest window is up to `max_run_sec` (5400 s on this box), and a crash mid-run must not extend
# that to "until someone walks over with a keyboard". Resume therefore belongs in the caller's
# `finally`, beside the existing `wifi_down` shield, and `should_resume` deliberately returns True
# for a suspended uplink whatever the harvest's outcome.

SUSPENDED = "suspended-for-harvest"
JOINED = "joined"
IDLE = "idle"


def suspend_plan(state, saved_ssid):
    """`(act, detail)` — must the uplink be dropped before a harvest takes the radio? PURE.

    Nothing to do when no uplink is up. The saved network is REMEMBERED rather than forgotten, so
    resume has something to return to — dropping the credential here is how a suspend becomes
    permanent."""
    if state != JOINED:
        return False, f"uplink is {state} — the harvest already has the radio"
    if not saved_ssid:
        return False, "uplink is joined but no saved network to return to — leaving it alone"
    return True, f"suspending uplink '{saved_ssid}' for the harvest"


def should_resume(state, saved_ssid, harvest_ok=None):
    """`(act, detail)` — restore the uplink after a harvest. PURE.

    ⚠️ `harvest_ok` IS ACCEPTED AND DELIBERATELY IGNORED for the decision. A failed harvest is exactly
    when the box most needs to be reachable, and resuming only on success is how a crash turns a
    90-minute window into an indefinite outage. It is carried only so the log can say what happened."""
    if state != SUSPENDED:
        return False, f"uplink is {state} — nothing was suspended"
    if not saved_ssid:
        return False, "nothing saved to rejoin"
    outcome = "" if harvest_ok is None else f" (harvest {'ok' if harvest_ok else 'FAILED'})"
    return True, f"restoring uplink '{saved_ssid}'{outcome}"
