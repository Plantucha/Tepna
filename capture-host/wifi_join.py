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
# 🔴 AND THE TRAP THAT MAKES THE STRIPPING LOAD-BEARING: `wpa_passphrase` writes the plaintext BACK
# into its own output as a `#psk="…"` comment. Piping it to a file verbatim — the obvious
# implementation, and what most examples show — puts the cleartext password on disk beside the
# derivation that was supposed to replace it. `sanitize_block` removes it, and a test asserts the
# plaintext is absent from the bytes actually written.

from __future__ import annotations

import re

__all__ = [
    "MIN_PSK_LEN",
    "MAX_PSK_LEN",
    "parse_scan_results",
    "validate_passphrase",
    "sanitize_block",
    "config_text",
    "OPEN",
    "SECURED",
]

OPEN = "open"
SECURED = "secured"

# WPA-PSK passphrase bounds (IEEE 802.11i): 8–63 printable ASCII, or a 64-hex PSK.
MIN_PSK_LEN = 8
MAX_PSK_LEN = 63

_PLAINTEXT_COMMENT = re.compile(r"^\s*#psk=.*$", re.M)


def parse_scan_results(text):
    """`[{ssid, signal, security, bssid}]` from `wpa_cli scan_results`, best signal first. PURE.

    The command's output is TSV with a header: `bssid / frequency / signal level / flags / ssid`.

    ⚠️ HIDDEN AND DUPLICATE SSIDs ARE BOTH REAL. A blank ssid is a hidden network and is dropped —
    it cannot be joined from a list of names. A repeated ssid is one network on several APs (every
    hotel has dozens), and it is collapsed to its STRONGEST sighting, or the picker becomes a wall of
    identical rows."""
    best = {}
    for line in str(text or "").splitlines():
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 5 or parts[0].lower().startswith("bssid"):
            continue
        bssid, _freq, sig, flags, ssid = parts[0], parts[1], parts[2], parts[3], "\t".join(parts[4:])
        ssid = ssid.strip()
        if not ssid:
            continue  # hidden — not selectable by name
        try:
            signal = int(sig)
        except ValueError:
            continue
        sec = SECURED if re.search(r"WPA|WEP|PSK|SAE", flags or "", re.I) else OPEN
        prev = best.get(ssid)
        if prev is None or signal > prev["signal"]:
            best[ssid] = {"ssid": ssid, "signal": signal, "security": sec, "bssid": bssid}
    return sorted(best.values(), key=lambda n: (-n["signal"], n["ssid"]))


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
    if len(p) == 64 and re.fullmatch(r"[0-9a-fA-F]{64}", p):
        return True, None  # already a raw PSK; accepted as-is
    if len(p) < MIN_PSK_LEN:
        return False, f"a Wi-Fi password is at least {MIN_PSK_LEN} characters"
    if len(p) > MAX_PSK_LEN:
        return False, f"a Wi-Fi password is at most {MAX_PSK_LEN} characters"
    return True, None


def sanitize_block(block, passphrase=None):
    """Strip `wpa_passphrase`'s plaintext `#psk="…"` comment. PURE.

    🔴 THIS IS THE SECURITY PROPERTY, not a tidy-up. `wpa_passphrase` echoes the passphrase back as a
    comment, so writing its output verbatim stores the cleartext next to the derivation meant to
    replace it. Every example on the internet pipes it straight to a file.

    `passphrase`, when given, is checked for as a LITERAL anywhere in the result — belt and braces, so
    an output shape we did not anticipate cannot smuggle it through."""
    out = _PLAINTEXT_COMMENT.sub("", str(block or "")).strip()
    if passphrase and str(passphrase) in out:
        raise ValueError("refusing to store a block that still contains the plaintext passphrase")
    return out + "\n" if out else ""


def config_text(blocks, ctrl_dir):
    """A whole `wpa_supplicant.conf` from sanitized network blocks. PURE.

    `ctrl_interface` is NOT optional and the harvest's own header records why: without it the daemon
    starts, associates or not, and creates no control socket — so nothing can ever confirm the
    association. `update_config=1` lets `wpa_cli save_config` persist a network the operator adds."""
    body = "\n".join(b.strip() for b in blocks if str(b or "").strip())
    return (f"ctrl_interface={ctrl_dir}\nupdate_config=1\n\n" + body).rstrip() + "\n"


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
