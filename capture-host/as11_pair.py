# tepna-capture — as11_pair.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# ResMed AirSense 11 — first-time BLE PAIRING orchestration (SRP-6a), and the credentials file it
# produces. This is the consumer `as11_link.start_key_exchange` / `confirm_key_exchange` waited for
# since 2026-08-21 (tools/find_unwired.py carried them as "orchestration UNBUILT").
#
# PURE + FULLY INJECTED, like as11_pull: `write(frame)` / `recv_frame() -> (vcid, bytes)` are the BLE
# transport, the SRP client is `as11_link.SrpClient` (stdlib SHA-256 + modular exponentiation — no
# cipher is involved, pairing runs on the PLAINTEXT VCID), and the daemon supplies the connect and
# the clock. So the whole exchange is testable against a simulated device with the standard library.
#
# WHY TWO STEPS. The passkey does not exist until the exchange has begun: the device shows its 4-digit
# code on the LCD only in RESPONSE to StartKeyExchange (protocol brief §2), and A/B are bound to the
# connection that sent it. So a single "here is the passkey" request cannot work — the link must be
# opened, StartKeyExchange sent, and only THEN can a person read the screen and type the code, on the
# same link. `PairingSession` holds that link across the two HTTP calls, with a deadline: a passkey that
# never arrives drops the link rather than leaving the AS11's one BLE slot occupied by a stalled pairing.
#
# WHAT IS STORED, AND WHEN. `{masterPairKey (hex K), clientId, ble_addr}` — the exact shape
# `capture._load_as11_creds` requires — written ONLY after the device's M2 verified. A device that did
# not prove knowledge of K (wrong passkey, wrong device, a replay) stores nothing: an unverified key on
# disk is worse than none, because every later poll would fail `VerificationFailure` — the 11-hour
# outage of 2026-09-04 was exactly a stored key the device no longer accepted.
#
# READ-ONLY on the AS11 in the sense the link layer defines it: StartKeyExchange/ConfirmKeyExchange are
# session AUTH (they create a client identity; they change no therapy setting). No other RPC is sent.
from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import os
import time

import as11_link as L
from as11_pull import As11Error, _await_result

# The device shows the passkey for a bounded time and a held BLE link blocks every other AS11 consumer
# (shadow poll, live stream, the phone app); two minutes is a generous reading-and-typing window.
DEFAULT_PASSKEY_TIMEOUT_S = 120.0


def _need(res: dict, *keys: str) -> None:
    """A pairing response missing a required member is a protocol failure, not a KeyError mid-flow."""
    missing = [k for k in keys if not res.get(k)]
    if missing:
        raise As11Error(f"pairing response missing {missing}")


def valid_passkey(passkey) -> bool:
    """The code the LCD shows: 4–10 ASCII digits (the same bound the monitor endpoint enforces).
    `isascii()` matters: str.isdigit() accepts full-width and other Unicode digits, which the device
    would then be asked to verify against a code it never showed."""
    return isinstance(passkey, str) and passkey.isascii() and passkey.isdigit() and 4 <= len(passkey) <= 10


async def start_exchange(write, recv_frame, srp, *, rpc_id: int = 1):
    """Step 1: StartKeyExchange{clientPk} → (serverPk_hex, salt_hex). The device now shows the passkey."""
    await write(L.fig_frame(L.VCID_PLAIN_TX, L.start_key_exchange(srp.public_hex(), rpc_id)))
    res = await _await_result(recv_frame, rpc_id)
    _need(res, "serverPk", "salt")
    return res["serverPk"], res["salt"]


async def confirm_exchange(write, recv_frame, srp, server_pk_hex, salt_hex, passkey, *, rpc_id: int = 2):
    """Step 2: prove the passkey (M1), ConfirmKeyExchange, VERIFY the device's M2, return the credentials.

    Returns `{"clientId", "masterPairKey"}` (K as hex) — never before M2 checks out. A mismatched M2
    raises As11Error naming it, so the caller can tell "wrong passkey" from "device refused"."""
    if not valid_passkey(passkey):
        raise ValueError("passkey must be 4–10 digits")
    m1_hex, m2_expected_hex, K = srp.prove(server_pk_hex, salt_hex, passkey)
    await write(L.fig_frame(L.VCID_PLAIN_TX, L.confirm_key_exchange(m1_hex, rpc_id)))
    res = await _await_result(recv_frame, rpc_id)
    _need(res, "clientId", "serverConfirmation")
    got = str(res["serverConfirmation"]).lower()
    if not hmac.compare_digest(got, m2_expected_hex.lower()):
        raise As11Error("server confirmation (M2) mismatch — wrong passkey or wrong device; nothing stored")
    return {"clientId": str(res["clientId"]), "masterPairKey": K.hex()}


async def pair(write, recv_frame, get_passkey, *, srp=None, start_id: int = 1, confirm_id: int = 2):
    """One-shot pairing over an OPEN link: start → `await get_passkey()` (the person reads the LCD) →
    confirm → creds. The interactive shape for a terminal; the daemon uses PairingSession instead
    because its two halves arrive as separate HTTP requests."""
    srp = srp or L.SrpClient()
    server_pk, salt = await start_exchange(write, recv_frame, srp, rpc_id=start_id)
    passkey = await get_passkey()
    return await confirm_exchange(write, recv_frame, srp, server_pk, salt, passkey, rpc_id=confirm_id)


def write_creds(path: str, creds: dict) -> None:
    """Write as11_creds.json ATOMICALLY (tmp + os.replace) with owner-only permissions. The file is a
    long-lived secret: K authenticates every later session, so it must never be world-readable and must
    never exist half-written (a truncated JSON reads as 'not paired' — silently, per _load_as11_creds)."""
    for k in ("masterPairKey", "clientId", "ble_addr"):
        if not creds.get(k):
            raise ValueError(f"refusing to write creds without {k}")
    tmp = f"{path}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(creds, f, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


class PairingSession:
    """The daemon's two-request pairing state machine. One per daemon; `op()` is what the endpoint calls.

        op("start", ble_addr=…)  → connect, StartKeyExchange, hold the link: {"ok", "awaiting":"passkey"}
        op("passkey", passkey=…) → prove + confirm on that link, verify M2, WRITE creds, disconnect
        op("cancel")             → drop a pending exchange without storing anything
        op("status")             → {"pending": bool, "seconds_left": …}

    Injected: `connect(ble_addr) -> (write, recv_frame, disconnect)` (the daemon's bleak edge),
    `creds_path`, `other_busy()` (the live-stream controller — pairing must not fight it for the AS11's
    one link), `on_paired(creds) -> bool` (adopt the new key live; True means no restart is needed),
    `clock`/`sleep`/`srp_factory` for tests. `busy()` is what the shadow detector defers on, and it is
    True from start-INTENT, for the same reason LiveStreamController._busy is."""

    def __init__(self, connect, creds_path: str, *, other_busy=None, on_paired=None,
                 default_addr=None, passkey_timeout_s: float = DEFAULT_PASSKEY_TIMEOUT_S,
                 clock=time.monotonic, sleep=asyncio.sleep, srp_factory=L.SrpClient,
                 connect_attempts: int = 3, retry_delay_s: float = 4.0):
        self._connect = connect
        self._creds_path = creds_path
        self._other_busy = other_busy or (lambda: False)
        self._on_paired = on_paired
        self._default_addr = default_addr            # () -> the stored ble_addr, for a RE-pair
        self._timeout = float(passkey_timeout_s)
        self._clock = clock
        self._sleep = sleep
        self._srp_factory = srp_factory
        self._attempts = max(1, int(connect_attempts))
        self._retry_delay = float(retry_delay_s)
        self._lock = asyncio.Lock()
        self._starting = False
        self._pending: dict | None = None   # {srp, server_pk, salt, write, recv_frame, disconnect, addr, deadline}
        self._watchdog: asyncio.Future | None = None

    # ── state the rest of the daemon reads ──────────────────────────────────────────────────────
    def busy(self) -> bool:
        return self._starting or self._pending is not None

    def status(self) -> dict:
        if self._pending is None:
            return {"pending": False}
        left = max(0.0, self._pending["deadline"] - self._clock())
        return {"pending": True, "ble_addr": self._pending["addr"], "seconds_left": round(left, 1)}

    # ── the endpoint's entry ────────────────────────────────────────────────────────────────────
    async def op(self, action: str, *, passkey=None, ble_addr=None) -> dict:
        if action == "status":
            return {"ok": True, **self.status()}
        if action == "start":
            if self._lock.locked():
                return {"ok": True, "starting": True, "already": True,
                        "detail": "a pairing start is already in progress"}
            async with self._lock:
                self._starting = True
                try:
                    return await self._start(ble_addr)
                finally:
                    self._starting = False
        async with self._lock:
            if action == "passkey":
                return await self._confirm(passkey)
            if action == "cancel":
                return await self._cancel()
        return {"ok": False, "error": f"unknown pairing action {action!r}"}

    # ── step 1 ──────────────────────────────────────────────────────────────────────────────────
    async def _start(self, ble_addr) -> dict:
        if self._pending is not None:
            return {"ok": True, "awaiting": "passkey", "already": True, **self.status(),
                    "detail": "an exchange is already open — type the code the CPAP shows"}
        if self._other_busy():
            return {"ok": False, "error": "the live CPAP stream holds the link — stop it before pairing"}
        addr = (ble_addr or "").strip() or (self._default_addr() if self._default_addr else None)
        if not addr:
            return {"ok": False, "error": "no CPAP BLE address: none stored and none given"}
        conn, last = None, None
        for attempt in range(self._attempts):
            if attempt:
                await self._sleep(self._retry_delay)
            try:
                conn = await self._connect(addr)
                break
            except Exception as e:  # noqa: BLE001 — bleak raises subclasses that are not OSError
                last = e
                name = type(e).__name__
                if "NotFound" in name or "not found" in str(e).lower():
                    return {"ok": False, "unreachable": True,
                            "error": "CPAP not found — is it on, in Bluetooth pairing mode (its menu → "
                                     "Bluetooth), and not connected to the myAir phone app?"}
        if conn is None:
            return {"ok": False, "error": f"{type(last).__name__}: {last}"}
        write, recv_frame, disconnect = conn
        srp = self._srp_factory()
        try:
            server_pk, salt = await start_exchange(write, recv_frame, srp)
        except Exception as e:  # noqa: BLE001 — a refused/malformed start ends the attempt; drop the link
            await self._close(disconnect)
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}
        self._pending = {"srp": srp, "server_pk": server_pk, "salt": salt, "write": write,
                         "recv_frame": recv_frame, "disconnect": disconnect, "addr": addr,
                         "deadline": self._clock() + self._timeout}
        self._watchdog = asyncio.ensure_future(self._expire())
        return {"ok": True, "awaiting": "passkey", **self.status(),
                "detail": "read the 4-digit code on the CPAP screen and enter it"}

    async def _expire(self):
        """Drop a pending exchange whose passkey never came — the AS11 has ONE BLE slot."""
        await self._sleep(self._timeout)
        async with self._lock:
            if self._pending is not None and self._clock() >= self._pending["deadline"]:
                await self._close(self._pending["disconnect"])
                self._pending = None

    # ── step 2 ──────────────────────────────────────────────────────────────────────────────────
    async def _confirm(self, passkey) -> dict:
        p = self._pending
        if p is None:
            return {"ok": False, "error": "no pairing exchange is open — press Start pairing first"}
        if not valid_passkey(passkey):
            return {"ok": False, "error": "passkey must be the 4–10 digit code shown on the CPAP screen",
                    **self.status()}
        try:
            creds = await confirm_exchange(p["write"], p["recv_frame"], p["srp"], p["server_pk"],
                                           p["salt"], passkey)
        except Exception as e:  # noqa: BLE001 — every failure ends the exchange; the link is dropped
            await self._drop()
            return {"ok": False, "verified": False, "error": f"{type(e).__name__}: {e}"}
        await self._drop()
        creds["ble_addr"] = p["addr"]
        creds["paired_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        write_creds(self._creds_path, creds)
        live = bool(self._on_paired(dict(creds))) if self._on_paired else False
        return {"ok": True, "verified": True, "stored": True, "clientId": creds["clientId"],
                "ble_addr": p["addr"], "live": live, "restart_required": not live}

    async def _cancel(self) -> dict:
        if self._pending is None:
            return {"ok": True, "cancelled": False, "detail": "nothing pending"}
        await self._drop()
        return {"ok": True, "cancelled": True}

    async def _drop(self):
        p, self._pending = self._pending, None
        self._watchdog.cancel()     # set together with _pending in _start; cancelling a finished task is a no-op
        await self._close(p["disconnect"])

    @staticmethod
    async def _close(disconnect):
        try:
            await disconnect()
        except Exception:  # noqa: BLE001 — a link that is already gone is the outcome we wanted
            pass
