# tepna-capture — as11_cipher.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# ResMed AirSense 11 — the ONE non-stdlib primitive: the AES-256-CBC payload cipher for the encrypted
# BLE channel. Split out from as11_link/as11_pull (which stay stdlib-only) so the dependency line is
# exactly one file: `cryptography`. The pure protocol layer takes `seal`/`unseal` by INJECTION, so it
# is testable with an identity cipher and carries no crypto dep; this module is what the daemon (and the
# operator probe) inject to talk to a real device.
#
# WIRE FORMAT (bluetooth_protocol.md §Encrypted payload format), HARDWARE-CONFIRMED end-to-end:
#   [iv:16][ AES-256-CBC( [payload_len:2 LE][json][zero-pad to a 16-byte boundary] ) ]
#   LENGTH-PREFIXED zero-pad — NOT PKCS#7. The 2-byte little-endian length is what `unseal` trusts to
#   strip the pad, so a decrypted block's trailing zeros are never guessed at.
#
# READ-ONLY by construction like the rest of the AS11 layer: this only enciphers/deciphers payloads the
# protocol builders produce; it originates no RPC and knows nothing about therapy state.
from __future__ import annotations

import os

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

_BLOCK = 16
_KEY_LEN = 32  # AES-256


def make_cipher(session_key: bytes, *, iv_source=os.urandom):
    """Return `(seal, unseal)` bound to a 32-byte session key (as11_pull.session_key output).

    `seal(payload:bytes) -> wire:bytes` prepends a fresh random IV to AES-256-CBC of
    `len(payload) as 2 LE bytes || payload || zero-pad`. `unseal(wire:bytes) -> payload:bytes` reverses
    it, trusting the length prefix to strip the pad (so a payload whose own last bytes are 0x00 round-
    trips exactly). `iv_source` is injectable ONLY so a test can pin a deterministic IV; it defaults to
    os.urandom and production must never override it — a predictable IV defeats CBC."""
    if len(session_key) != _KEY_LEN:
        raise ValueError("AS11 session key must be 32 bytes (AES-256)")

    def seal(payload: bytes) -> bytes:
        body = len(payload).to_bytes(2, "little") + payload
        if len(body) % _BLOCK:
            body += b"\x00" * (_BLOCK - len(body) % _BLOCK)
        iv = iv_source(_BLOCK)
        enc = Cipher(algorithms.AES(session_key), modes.CBC(iv)).encryptor()
        return iv + enc.update(body) + enc.finalize()

    def unseal(wire: bytes) -> bytes:
        iv, ct = wire[:_BLOCK], wire[_BLOCK:]
        dec = Cipher(algorithms.AES(session_key), modes.CBC(iv)).decryptor()
        pt = dec.update(ct) + dec.finalize()
        n = int.from_bytes(pt[:2], "little")
        return pt[2:2 + n]

    return seal, unseal
