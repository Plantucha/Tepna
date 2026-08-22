# tepna-capture — as11_link.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# ResMed AirSense 11 BLE link layer — FIG framing, SRP-6a pairing, and the encrypted
# session — implemented FROM THE PUBLISHED PROTOCOL SPECIFICATION.
#
# PROVENANCE / LICENSING. Written against the protocol DOCUMENTATION in
# m-kozlowski/airbreak-plus docs/as11 (bluetooth_protocol.md, rpc_protocol.md), which
# descends from osresearch/airbreak. Those are prose/table specifications, not code. This
# module is NOT derived from any GPL implementation — Tepna is Apache-2.0, and a
# GPL-derived module could not be incorporated here. Everything below is either a standard
# primitive (SHA-256, HMAC-SHA256, AES-256-CBC, SRP-6a per RFC 5054) or a wire format
# transcribed from the published spec. See RESMED-AS11-PROTOCOL-REFERENCE-2026-08-21-BRIEF.
#
# READ-ONLY BY CONSTRUCTION. No therapy- or state-changing RPC is built here. Every request
# builder below is a read (RequestSession/CheckSessionIntegrity are session auth; Get,
# GetDateTime, StartSpool, PullSpoolFragments read data). Adding a write must be deliberate.
from __future__ import annotations

import hashlib
import hmac
import json
import os
import struct
import zlib

# NO third-party crypto dependency here. The encrypted-payload cipher (AES-256-CBC) is the ONLY
# part of the link needing a non-stdlib primitive, so it is NOT in this gated module — it is
# dependency-INJECTED into the pull orchestration (as11_pull) and implemented in the operator
# probe on the box (where `cryptography` is already present, alongside the bleak I/O). Everything
# here uses only the standard library (hashlib/hmac/struct/zlib), so capture-host gains no dep.

# ── Transport constants (bluetooth_protocol.md) ──────────────────────────────────────
GATT_SERVICE = "0000fd56-0000-1000-8000-00805f9b34fb"
GATT_TX = "a6220002-35f1-4b20-afae-cb089d2044aa"  # write  — host -> device
GATT_RX = "a6220003-35f1-4b20-afae-cb089d2044aa"  # notify — device -> host

FIG_SYNC = 0xCAFEBABE
VCID_PLAIN_TX = 0x0393  # BLE plaintext JSON  (pairing / session establishment)
VCID_PLAIN_RX = 0x0392
VCID_ENC_TX = 0x0397  # BLE encrypted JSON  (application RPC)
VCID_ENC_RX = 0x0396
FIG_HEADER_LEN = 16

# ── SRP-6a group: RFC 5054 2048-bit, g = 2, SHA-256 (bluetooth_protocol.md §Pairing) ──
SRP_N = int(
    "AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050"
    "A37329CBB4A099ED8193E0757767A13DD52312AB4B03310DCD7F48A9DA04FD50"
    "E8083969EDB767B0CF6095179A163AB3661A05FBD5FAAAE82918A9962F0B93B8"
    "55F97993EC975EEAA80D740ADBF4FF747359D041D5C33EA71D281E446B14773B"
    "CA97B43A23FB801676BD207A436C6481F1D2B9078717461A5B9D32E688F87748"
    "544523B524B0D57D5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6"
    "AF874E7303CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DBFBB6"
    "94B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F9E4AFF73",
    16,
)
SRP_G = 2
SRP_WIDTH = 256  # byte width of pad() — the modulus size


def _h(*chunks: bytes) -> bytes:
    """SHA-256 over concatenated byte strings (the spec's H())."""
    d = hashlib.sha256()
    for c in chunks:
        d.update(c)
    return d.digest()


def _pad(value: int) -> bytes:
    """Big-endian serialisation to the modulus width (the spec's pad())."""
    return value.to_bytes(SRP_WIDTH, "big")


# ── FIG framing (bluetooth_protocol.md §Framing) ──────────────────────────────────────
#   [sync:4 LE][vcid:2 LE][len:2 LE][payload_crc32:4 LE][header_crc32:4 LE][payload]
def fig_frame(vcid: int, payload: bytes) -> bytes:
    """Wrap payload in one FIG packet."""
    header = struct.pack("<HHI", vcid, len(payload), zlib.crc32(payload) & 0xFFFFFFFF)
    return struct.pack("<I", FIG_SYNC) + header + struct.pack("<I", zlib.crc32(header) & 0xFFFFFFFF) + payload


def fig_unframe(buffer: bytes):
    """Pull the first complete FIG packet out of buffer.

    Returns (vcid, payload, remainder) or None when no complete packet is present yet.
    Bytes before the sync word are discarded — a notification stream can resume mid-packet.
    """
    start = buffer.find(struct.pack("<I", FIG_SYNC))
    if start < 0 or len(buffer) - start < FIG_HEADER_LEN:
        return None
    vcid, length, _pcrc = struct.unpack_from("<HHI", buffer, start + 4)
    end = start + FIG_HEADER_LEN + length
    if len(buffer) < end:
        return None
    return vcid, buffer[start + FIG_HEADER_LEN : end], buffer[end:]


# ── Encrypted payload format (bluetooth_protocol.md §Encrypted payload format) ────────
# The cipher itself lives in the operator probe (dependency-injected, see module header):
#   [iv:16][ AES-256-CBC( [payload_len:2 LE][json][zero-pad to 16-byte boundary] ) ]
#   Length-prefixed zero-pad — NOT PKCS#7. A `seal(payload)->wire` / `unseal(wire)->payload`
#   pair (with the session key bound) is passed into as11_pull's encrypted RPC helpers.

# ── Key material (bluetooth_protocol.md §Session keys) ────────────────────────────────
def session_key(pair_key: bytes, nonce: bytes) -> bytes:
    """SHA256(K || nonce_raw) — the per-connection AES-256 key."""
    if len(pair_key) != 32:
        raise ValueError("master pair key must be 32 bytes")
    return _h(pair_key, nonce)


def session_proof(pair_key: bytes, challenge: bytes) -> bytes:
    """HMAC-SHA256(K, challenge) — the CheckSessionIntegrity response."""
    if len(pair_key) != 32:
        raise ValueError("master pair key must be 32 bytes")
    return hmac.new(pair_key, challenge, hashlib.sha256).digest()


# ── SRP-6a pairing (bluetooth_protocol.md §Pairing table, verbatim) ───────────────────
class SrpClient:
    """Client half of the AS11 pairing exchange. One instance per pairing attempt."""

    def __init__(self, private_value: int | None = None):
        self._a = private_value if private_value is not None else int.from_bytes(os.urandom(32), "big")
        self.A = pow(SRP_G, self._a, SRP_N)

    def public_hex(self) -> str:
        """clientPk for StartKeyExchange — 256-byte big-endian A, hex."""
        return _pad(self.A).hex()

    def prove(self, server_pk_hex: str, salt_hex: str, passkey: str):
        """Return (M1_hex, expected_M2_hex, K) from serverPk/salt + the LCD passkey."""
        B = int(server_pk_hex, 16)
        salt = bytes.fromhex(salt_hex)
        k = int.from_bytes(_h(_pad(SRP_N), _pad(SRP_G)), "big")
        x = int.from_bytes(_h(salt, _h(passkey.encode())), "big")
        u = int.from_bytes(_h(_pad(self.A), _pad(B)), "big")
        S = pow((B - k * pow(SRP_G, x, SRP_N)) % SRP_N, self._a + u * x, SRP_N)
        K = _h(_pad(S))
        hn, hg = _h(_pad(SRP_N)), _h(_pad(SRP_G))
        m1 = _h(bytes(p ^ q for p, q in zip(hn, hg)), salt, _pad(self.A), _pad(B), K)
        m2 = _h(_pad(self.A), m1, K)
        return m1.hex(), m2.hex(), K


# ── RPC envelopes (rpc_protocol.md §Message format) ───────────────────────────────────
def rpc(method: str, params=None, rpc_id: int = 1, version: str = "1.0") -> bytes:
    """Build one JSON-RPC request. params is OMITTED when None (distinct from {} / null)."""
    msg = {"jsonrpc": version, "method": method, "id": rpc_id}
    if params is not None:
        msg["params"] = params
    return json.dumps(msg, separators=(",", ":")).encode()


def request_session(client_id: str, rpc_id: int = 10) -> bytes:
    return rpc("RequestSession", {"clientId": client_id}, rpc_id, "2.0")


def check_session_integrity(response_hex: str, rpc_id: int = 11) -> bytes:
    return rpc("CheckSessionIntegrity", {"response": response_hex}, rpc_id, "2.0")


def start_key_exchange(client_pk_hex: str, rpc_id: int = 1) -> bytes:
    return rpc("StartKeyExchange", {"clientPk": client_pk_hex}, rpc_id, "2.0")


def confirm_key_exchange(m1_hex: str, rpc_id: int = 2) -> bytes:
    return rpc("ConfirmKeyExchange", {"clientConfirmation": m1_hex}, rpc_id, "2.0")


def get_date_time(rpc_id: int = 13) -> bytes:
    """GetDateTime (cmd 0x04, `all` access). params omitted. Result: {"dateTime":"…Z"} (ISO 8601)."""
    return rpc("GetDateTime", None, rpc_id, "1.0")


def get_items(names, rpc_id: int = 12) -> bytes:
    """Get (cmd 0x43) — params MUST be a non-empty array of non-empty strings."""
    names = list(names)
    if not names or not all(isinstance(n, str) and n for n in names):
        raise ValueError("Get takes a non-empty array of non-empty names")
    return rpc("Get", names, rpc_id, "1.0")


def start_spool(spool_type: str, from_dt: str, max_spool_size: int = 4096, rpc_id: int = 14) -> bytes:
    """StartSpool (cmd 0x5e). One spool type; a REQUIRED ISO-8601 `fromDateTime`.

    `fromDateTime` is mandatory — HARDWARE-CONFIRMED against a real AirSense 11: an empty address
    (`spoolAddress.<type>: {}`) is rejected with `Invalid Params (-32602)`, as is a request that
    omits `maxSpoolSize`. There is no known "from the beginning" sentinel; to pull all retained data,
    pass a far-past date. A falsy `from_dt` therefore raises here rather than building a request the
    device will refuse."""
    if not from_dt:
        raise ValueError("StartSpool requires a fromDateTime (the device rejects an empty address)")
    addr = {"fromDateTime": from_dt}
    return rpc("StartSpool", {"spoolAddress": {spool_type: addr}, "maxSpoolSize": max_spool_size}, rpc_id, "1.0")


def pull_spool_fragments(spool_id: int, max_fragment_size: int = 3000, max_notifications: int = 0, rpc_id: int = 15) -> bytes:
    """PullSpoolFragments (cmd 0x5f). Advances the open spool reader."""
    return rpc(
        "PullSpoolFragments",
        {"spoolId": spool_id, "maxFragmentSize": max_fragment_size, "maxNotifications": max_notifications},
        rpc_id,
        "1.0",
    )
