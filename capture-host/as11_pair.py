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
# session AUTH (they create a client identity; they change no therapy setting). The only other RPCs are
# the post-pair RequestSession/CheckSessionIntegrity check, which is the ordinary reconnect handshake.
#
# THE EVENT ORDER IS THE DEVICE'S DOCUMENTED SEQUENCE (owner ruling 2026-10-10), as a GPLv3 reference
# implementation that pairs this device reliably performs it — behaviour only, no code taken. The
# behaviours adopted here, each a difference from what this file did before:
#   · the CPAP is put in pairing mode via More → MyAir App → OK, downloaded → Connect (not "Bluetooth");
#   · the device is FOUND by a scan on ONE chosen radio (name "ResMed…" or service FD56) before connecting,
#     and the connect waits 30 s — no silent failover onto another radio mid-pairing;
#   · StartKeyExchange's reply gets 30 s (the CPAP does a 2048-bit modexp), ConfirmKeyExchange's 15 s;
#   · after a verified M2 the pairing link is DROPPED, 0.5 s pass, and a FRESH link runs the session
#     handshake — the key is reported working only when that succeeds.
from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import os
import time

import as11_link as L
from as11_pull import As11Error, _await_result, establish

# The device shows the passkey for a bounded time and a held BLE link blocks every other AS11 consumer
# (shadow poll, live stream, the phone app); two minutes is a generous reading-and-typing window.
DEFAULT_PASSKEY_TIMEOUT_S = 120.0

#: The reference implementation's reply bounds. A StartKeyExchange reply costs the device a 2048-bit modular exponentiation;
#: the transport's per-frame wait (20 s) was SHORTER than the reference's 30 s, so a slow device could show
#: its code on the LCD while this side had already dropped the link.
START_REPLY_TIMEOUT_S = 30.0
CONFIRM_REPLY_TIMEOUT_S = 15.0
#: The gap between dropping the pairing link and opening the session-check link (the reference implementation's bound: 500 ms).
POST_PAIR_SETTLE_S = 0.5
#: RequestSession + CheckSessionIntegrity on the fresh link (the reference implementation's bound: 10 s each).
SESSION_CHECK_TIMEOUT_S = 20.0

#: What the person at the machine must do — ONE string, so the endpoint, the panel and the errors cannot
#: drift apart. "its menu → Bluetooth" (the old text) is not the screen that accepts a new client.
PAIRING_MODE_STEPS = "on the CPAP: More → MyAir App → OK, downloaded → Connect"
NOT_FOUND_HINT = (
    f"CPAP not found — {PAIRING_MODE_STEPS}, and close the myAir phone app or turn the phone's Bluetooth "
    "off (the CPAP holds ONE connection)"
)


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


async def _reply(recv_frame, rpc_id, timeout_s, what):
    """`_await_result` under ONE overall deadline. It skips HeartBeats (one every ~5 s), so without this
    bound a device that heartbeats but never answers would hold the link forever."""
    try:
        return await asyncio.wait_for(_await_result(recv_frame, rpc_id), timeout_s)
    except asyncio.TimeoutError:
        raise As11Error(f"no {what} reply within {timeout_s:g} s") from None


async def start_exchange(write, recv_frame, srp, *, rpc_id: int = 1, reply_timeout_s: float = START_REPLY_TIMEOUT_S):
    """Step 1: StartKeyExchange{clientPk} → (serverPk_hex, salt_hex). The device now shows the passkey."""
    await write(L.fig_frame(L.VCID_PLAIN_TX, L.start_key_exchange(srp.public_hex(), rpc_id)))
    res = await _reply(recv_frame, rpc_id, reply_timeout_s, "StartKeyExchange")
    _need(res, "serverPk", "salt")
    return res["serverPk"], res["salt"]


async def confirm_exchange(
    write,
    recv_frame,
    srp,
    server_pk_hex,
    salt_hex,
    passkey,
    *,
    rpc_id: int = 2,
    reply_timeout_s: float = CONFIRM_REPLY_TIMEOUT_S,
):
    """Step 2: prove the passkey (M1), ConfirmKeyExchange, VERIFY the device's M2, return the credentials.

    Returns `{"clientId", "masterPairKey"}` (K as hex) — never before M2 checks out. A mismatched M2
    raises As11Error naming it, so the caller can tell "wrong passkey" from "device refused"."""
    if not valid_passkey(passkey):
        raise ValueError("passkey must be 4–10 digits")
    m1_hex, m2_expected_hex, K = srp.prove(server_pk_hex, salt_hex, passkey)
    await write(L.fig_frame(L.VCID_PLAIN_TX, L.confirm_key_exchange(m1_hex, rpc_id)))
    res = await _reply(recv_frame, rpc_id, reply_timeout_s, "ConfirmKeyExchange")
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

        op("radios")             → the box's radios, each marked usable or not
        op("scan", adapter=…)    → ~6 s scan on ONE radio for advertising AirSense 11s
        op("start", ble_addr=…, adapter=…) → connect, StartKeyExchange, hold the link: {"awaiting":"passkey"}
        op("passkey", passkey=…) → prove + confirm on that link, verify M2, WRITE creds, disconnect, then
                                   check the key on a FRESH link (the ordinary session handshake)
        op("cancel")             → drop a pending exchange without storing anything
        op("forget")             → DELETE the stored key, so the next session must re-pair
        op("status")             → {"pending", "paired", "creds_addr", "adapter", "adapter_usable", …}

    ⚠️ `cancel` and `forget` are DIFFERENT, and until 2026-09-06 only the first existed. Cancel drops an
    exchange IN FLIGHT and stores nothing; forget removes a key already stored and verified. There was no
    way to do the second at all — the endpoint offered start/passkey/cancel/status and nothing anywhere
    deleted `as11_creds.json` — so a stale key could only be displaced by a SUCCESSFUL re-pair, which is
    precisely the operation that fails when the stale key is the problem. Owner-reported.

    Injected: `connect(ble_addr[, adapter]) -> (write, recv_frame, disconnect)` (the daemon's bleak edge;
    the adapter is passed only when the operator CHOSE one), `scan(adapter) -> [{addr, name, rssi}]` and
    `radios() -> [{mac, hci, up, …}]` (both optional; absent → the action says this daemon cannot),
    `creds_path`, `other_busy()` (the live-stream controller — pairing must not fight it for the AS11's
    one link), `on_paired(creds) -> bool` (adopt the new key live; True means no restart is needed),
    `adapter` (the radio this session pairs ON — reported so the operator is not guessing which of three
    radios a key belongs to), `clock`/`sleep`/`srp_factory` for tests. `busy()` is what the shadow
    detector defers on, and it is True from start-INTENT, for the same reason
    LiveStreamController._busy is."""

    def __init__(
        self,
        connect,
        creds_path: str,
        *,
        other_busy=None,
        on_paired=None,
        default_addr=None,
        passkey_timeout_s: float = DEFAULT_PASSKEY_TIMEOUT_S,
        clock=time.monotonic,
        sleep=asyncio.sleep,
        srp_factory=L.SrpClient,
        connect_attempts: int = 3,
        retry_delay_s: float = 4.0,
        adapter=None,
        scan=None,
        radios=None,
        settle_s: float = POST_PAIR_SETTLE_S,
    ):
        self._connect = connect
        self._scan = scan
        self._radios = radios
        self._settle_s = float(settle_s)
        # The address a FORGET removed, or the only CPAP a scan found. Unpair used to delete the one place
        # the box kept the address, so the very next Start answered "no CPAP BLE address" — every pairing
        # attempt on 2026-10-10. Memory only: after a restart the scan recovers it.
        self._last_addr: str | None = None
        self._creds_path = creds_path
        self._adapter = adapter
        # None when no stream controller is injected; `_stream_busy` reads it. A `lambda: False` stand-in
        # made "no controller" and "a controller that says idle" one value no test could tell apart.
        self._other_busy = other_busy
        self._on_paired = on_paired
        self._default_addr = default_addr  # () -> the stored ble_addr, for a RE-pair
        self._timeout = float(passkey_timeout_s)
        self._clock = clock
        self._sleep = sleep
        self._srp_factory = srp_factory
        self._attempts = max(1, int(connect_attempts))
        self._retry_delay = float(retry_delay_s)
        self._lock = asyncio.Lock()
        self._starting = False
        self._pending: dict | None = None  # {srp, server_pk, salt, write, recv_frame, disconnect, addr, deadline}
        # Bound by `_start` together with `_pending`, and read only while `_pending` is set — so it has no
        # meaningful value before the first start and is deliberately not given a placeholder one.
        self._watchdog: asyncio.Future

    # ── state the rest of the daemon reads ──────────────────────────────────────────────────────
    def _stream_busy(self) -> bool:
        return self._other_busy is not None and bool(self._other_busy())

    def busy(self) -> bool:
        return self._starting or self._pending is not None

    #: BD addresses no reconnect can be pinned to. An UNPATCHED Zephyr/nRF52840 image reports all-zero
    #: to `hciconfig` because it has no PUBLIC address (it identifies by static-random, and a host-side
    #: public pin is refused `0x0c Not Supported`). `capture._addressable` already guards the failover
    #: ladder against exactly this; the pairing panel showed nothing at all, so an operator could pair
    #: "successfully" against a radio no device can be reached on.
    #:
    #: ⚠️ This is a property of the IMAGE, not the vendor — the line above said "a Zephyr/nRF52840
    #: dongle" and that read as a blanket exclusion. A fixed-address build reports a real address and
    #: serves the AS11 normally: measured 2026-09-11, three such dongles reported real addresses and one
    #: opened the AS11 link unbonded (5 services / 14 characteristics). All-zero means REBUILD the image,
    #: not "this radio cannot do CPAP". The set below is value-based and needs no vendor exception.
    UNPAIRABLE_BD = frozenset({"00:00:00:00:00:00", "FF:FF:FF:FF:FF:FF"})

    def _creds_view(self) -> dict:
        """Is a key stored, and for which device — read at CALL time, not cached.

        A cached flag would go stale the moment `forget` or a successful pair ran, and this value drives
        whether the UI offers an Unpair button; offering it with nothing to delete, or hiding it with a
        stale key on disk, are both worse than one stat() per poll."""
        try:
            with open(self._creds_path, encoding="utf-8") as fh:
                creds = json.load(fh)
        except (OSError, ValueError):
            return {"paired": False, "creds_addr": None}
        if not isinstance(creds, dict) or not creds.get("masterPairKey"):
            return {"paired": False, "creds_addr": None}
        return {"paired": True, "creds_addr": creds.get("ble_addr")}

    def status(self) -> dict:
        adapter = self._adapter
        base = {
            "adapter": adapter,
            # None (not "true") when no adapter is configured: absent is not the same as usable,
            # and a panel that renders a missing pin as "fine" is the fabricated-green this repo
            # keeps paying for.
            "adapter_usable": None if not adapter else (str(adapter).upper() not in self.UNPAIRABLE_BD),
            **self._creds_view(),
        }
        base["pairing_mode"] = PAIRING_MODE_STEPS
        # ∅ null when no address is remembered — reported either way, so the panel can tell "none" from
        # a field this daemon does not send.
        base["last_addr"] = self._last_addr
        # A start in flight (connecting / waiting for StartKeyExchange) — the window before `pending`.
        base["starting"] = self._starting
        if self._pending is None:
            return {"pending": False, **base}
        left = max(0.0, self._pending["deadline"] - self._clock())
        return {"pending": True, "ble_addr": self._pending["addr"], "seconds_left": round(left, 1), **base}

    def _open(self, addr, adapter):
        """The adapter is passed only when the operator CHOSE one, so a connect injected with the old
        one-argument shape keeps working and the configured radio stays the daemon's default."""
        return self._connect(addr, adapter) if adapter else self._connect(addr)

    # ── the endpoint's entry ────────────────────────────────────────────────────────────────────
    async def op(self, action: str, *, passkey=None, ble_addr=None, adapter=None) -> dict:
        if action == "status":
            return {"ok": True, **self.status()}
        if action == "radios":
            return await self._list_radios()
        if action == "scan":
            if self._lock.locked() or self._pending is not None:
                # A scan beside an open exchange would compete for the radio holding the CPAP's ONE slot.
                return {"ok": False, "error": "a pairing exchange is in progress — finish or cancel it first"}
            return await self._do_scan(adapter)
        if action == "start":
            if self._lock.locked():
                return {
                    "ok": True,
                    "starting": True,
                    "already": True,
                    "detail": "a pairing start is already in progress",
                }
            async with self._lock:
                self._starting = True
                try:
                    return await self._start(ble_addr, adapter)
                finally:
                    self._starting = False
        async with self._lock:
            if action == "passkey":
                return await self._confirm(passkey)
            if action == "cancel":
                return await self._cancel()
            if action == "forget":
                return self._forget()
        return {"ok": False, "error": f"unknown pairing action {action!r}"}

    def _forget(self) -> dict:
        """Delete the stored key. Held under the same lock as passkey/cancel so it cannot race a
        confirm that is about to WRITE one — deleting the file a millisecond before `write_creds`
        replaces it would report success and leave the box paired.

        REFUSES while the live stream holds the link: that stream authenticates with this key, and
        pulling it mid-session would fail the next reconnect with a decrypt error rather than an
        honest 'not paired'. Refuses with a pending exchange for the same reason — cancel that first,
        which is the action that exists for it."""
        if self._pending is not None:
            return {"ok": False, "error": "a pairing exchange is open — cancel it before forgetting the key"}
        if self._stream_busy():
            return {"ok": False, "error": "the live CPAP stream holds the link — stop it before forgetting the key"}
        before = self._creds_view()
        if not before["paired"]:
            # Not an error: the end state the caller asked for is the state we are in. Reporting a
            # failure here would make a second click look like a fault.
            return {"ok": True, "forgotten": False, "detail": "no stored key to forget", **self.status()}
        try:
            os.unlink(self._creds_path)
        except OSError as e:
            return {"ok": False, "error": f"could not remove {self._creds_path}: {e}"}
        if before["creds_addr"]:
            self._last_addr = before["creds_addr"]
        return {
            "ok": True,
            "forgotten": True,
            "was_addr": before["creds_addr"],
            "detail": "stored key removed — the CPAP must be re-paired before the next session",
            **self.status(),
        }

    # ── finding the CPAP ────────────────────────────────────────────────────────────────────────
    async def _list_radios(self) -> dict:
        if self._radios is None:
            return {"ok": False, "error": "this daemon cannot list its radios"}
        try:
            radios = await self._radios()
        except Exception as e:  # noqa: BLE001 — a listing failure is an answer, not a 500
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}
        for r in radios:
            r["usable"] = bool(r.get("mac")) and str(r["mac"]).upper() not in self.UNPAIRABLE_BD
        return {"ok": True, "radios": radios}

    async def _do_scan(self, adapter) -> dict:
        """Look for advertising AirSense 11s on ONE radio. Exactly one found → it becomes the default
        address for Start, so the common case needs no typing."""
        if self._scan is None:
            return {"ok": False, "error": "this daemon cannot scan"}
        radio = adapter or self._adapter
        try:
            found = await self._scan(radio)
        except Exception as e:  # noqa: BLE001 — bleak raises non-OSError subclasses
            return {"ok": False, "adapter": radio, "error": f"{type(e).__name__}: {e}"}
        if len(found) == 1:
            self._last_addr = found[0]["addr"]
        res = {"ok": True, "adapter": radio, "found": found}
        if not found:
            res["detail"] = NOT_FOUND_HINT
        return res

    # ── step 1 ──────────────────────────────────────────────────────────────────────────────────
    async def _start(self, ble_addr, adapter=None) -> dict:
        if self._pending is not None:
            return {
                "ok": True,
                "awaiting": "passkey",
                "already": True,
                **self.status(),
                "detail": "an exchange is already open — type the code the CPAP shows",
            }
        if self._stream_busy():
            return {"ok": False, "error": "the live CPAP stream holds the link — stop it before pairing"}
        addr = (ble_addr or "").strip() or (self._default_addr() if self._default_addr else None) or self._last_addr
        if not addr:
            return {
                "ok": False,
                "error": f"no CPAP BLE address: none stored and none given — {PAIRING_MODE_STEPS}, then press Find CPAP",
            }
        conn, last = None, None
        for attempt in range(self._attempts):
            if attempt:
                await self._sleep(self._retry_delay)
            try:
                conn = await self._open(addr, adapter)
                break
            except Exception as e:  # noqa: BLE001 — bleak raises subclasses that are not OSError
                last = e
                name = type(e).__name__
                if "NotFound" in name or "not found" in str(e).lower():
                    return {"ok": False, "unreachable": True, "error": NOT_FOUND_HINT}
        if conn is None:
            return {"ok": False, "error": f"{type(last).__name__}: {last}"}
        write, recv_frame, disconnect = conn
        srp = self._srp_factory()
        try:
            server_pk, salt = await start_exchange(write, recv_frame, srp)
        except Exception as e:  # noqa: BLE001 — a refused/malformed start ends the attempt; drop the link
            await self._close(disconnect)
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}
        self._pending = {
            "srp": srp,
            "server_pk": server_pk,
            "salt": salt,
            "write": write,
            "recv_frame": recv_frame,
            "disconnect": disconnect,
            "addr": addr,
            "adapter": adapter,
            "deadline": self._clock() + self._timeout,
        }
        self._watchdog = asyncio.ensure_future(self._expire())
        return {
            "ok": True,
            "awaiting": "passkey",
            **self.status(),
            "detail": "read the 4-digit code on the CPAP screen and enter it",
        }

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
            return {
                "ok": False,
                "error": "passkey must be the 4–10 digit code shown on the CPAP screen",
                **self.status(),
            }
        try:
            creds = await confirm_exchange(p["write"], p["recv_frame"], p["srp"], p["server_pk"], p["salt"], passkey)
        except Exception as e:  # noqa: BLE001 — every failure ends the exchange; the link is dropped
            await self._drop()
            return {"ok": False, "verified": False, "error": f"{type(e).__name__}: {e}"}
        await self._drop()
        creds["ble_addr"] = p["addr"]
        if p.get("adapter"):
            # The radio the key was made on — recorded so "which radio is this key from?" has an answer.
            # Later sessions still route by the configured pin; nothing reads this to choose a radio.
            creds["adapter"] = p["adapter"]
        creds["paired_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        write_creds(self._creds_path, creds)
        live = bool(self._on_paired(dict(creds))) if self._on_paired else False
        session = await self._check_session(p["addr"], p.get("adapter"), creds)
        return {
            "ok": True,
            "verified": True,
            "stored": True,
            "clientId": creds["clientId"],
            "ble_addr": p["addr"],
            "live": live,
            "restart_required": not live,
            **session,
        }

    async def _check_session(self, addr, adapter, creds) -> dict:
        """The reference post-pair step: drop the pairing link, wait, open a FRESH link and run the ordinary
        reconnect handshake with the new key. The key stays stored either way — M2 already proved the
        device holds K — so a failure here is REPORTED, not undone: "paired" that cannot open a session is
        the state every later poll would otherwise discover the hard way, overnight."""
        await self._sleep(self._settle_s)
        try:
            write, recv_frame, disconnect = await self._open(addr, adapter)
        except Exception as e:  # noqa: BLE001 — bleak raises non-OSError subclasses
            return {"session_ok": False, "session_error": f"reconnect: {type(e).__name__}: {e}"}
        try:
            await asyncio.wait_for(
                establish(bytes.fromhex(creds["masterPairKey"]), creds["clientId"], write, recv_frame),
                SESSION_CHECK_TIMEOUT_S,
            )
        except Exception as e:  # noqa: BLE001 — every failure is reported, none is raised
            return {"session_ok": False, "session_error": f"{type(e).__name__}: {e}"}
        finally:
            await self._close(disconnect)
        return {"session_ok": True}

    async def _cancel(self) -> dict:
        if self._pending is None:
            return {"ok": True, "cancelled": False, "detail": "nothing pending"}
        await self._drop()
        return {"ok": True, "cancelled": True}

    async def _drop(self):
        p, self._pending = self._pending, None
        self._watchdog.cancel()  # set together with _pending in _start; cancelling a finished task is a no-op
        await self._close(p["disconnect"])

    @staticmethod
    async def _close(disconnect):
        try:
            await disconnect()
        except Exception:  # noqa: BLE001 — a link that is already gone is the outcome we wanted
            pass
