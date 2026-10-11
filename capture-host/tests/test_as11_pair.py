# tepna-capture — tests/test_as11_pair.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""as11_pair — the AS11 first-time pairing orchestration, run against a SIMULATED device built from the
protocol brief's own table (the same device side test_as11_link uses). What must hold: the client
proves the passkey and VERIFIES the device's M2 before anything is stored; a wrong passkey, a wrong
M2, a refused RPC or a malformed reply stores nothing and drops the link; the two-step daemon
session holds the link between the start and the passkey, expires it, refuses to fight the live
stream, retries a transient connect, and writes the credentials file atomically, owner-only, in the
exact shape `capture._load_as11_creds` requires."""

import asyncio
import json
import os
import stat
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import as11_link as L  # noqa: E402
import as11_pair as P  # noqa: E402
import capture  # noqa: E402
import pytest  # noqa: E402
from as11_pull import As11Error  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class SimDevice:
    """An AirSense 11's half of SRP-6a pairing, per RESMED-AS11-PROTOCOL-REFERENCE §2. `passkey` is
    the code it 'shows on the LCD'; `tamper` lets a test make it lie about M2 or omit members."""

    def __init__(
        self,
        passkey="4867",
        salt=bytes(range(16)),
        b_priv=0x2BADC0DE,
        client_id="cli-77",
        tamper=None,
        error=None,
        heartbeats=0,
        session_reject=False,
    ):
        self.passkey, self.salt, self.b, self.client_id = passkey, salt, b_priv, client_id
        self.session_reject = session_reject  # refuse CheckSessionIntegrity (a key the device dropped)
        self.connects = []  # (addr, adapter) per connect — adapter None when the session passed none
        self.tamper, self.error, self.heartbeats = tamper or {}, error, heartbeats
        self.sent = []  # every decoded request the client wrote
        self.queue = []  # frames waiting for recv_frame
        self.disconnected = 0
        x = int.from_bytes(L._h(salt, L._h(passkey.encode())), "big")
        self.v = pow(L.SRP_G, x, L.SRP_N)
        self.A = None

    def _reply(self, obj):
        self.queue.append((L.VCID_PLAIN_RX, json.dumps(obj).encode()))

    async def write(self, frame):
        vcid, payload, rest = L.fig_unframe(frame)
        assert vcid == L.VCID_PLAIN_TX and rest == b""
        msg = json.loads(payload)
        self.sent.append(msg)
        for _ in range(self.heartbeats):
            self._reply({"jsonrpc": "2.0", "method": "HeartBeat", "params": {}})
        if self.error and msg["method"] == self.error[0]:
            self._reply({"jsonrpc": "2.0", "id": msg["id"], "error": self.error[1]})
            return
        if msg["method"] == "StartKeyExchange":
            self.A = int(msg["params"]["clientPk"], 16)
            k = int.from_bytes(L._h(L._pad(L.SRP_N), L._pad(L.SRP_G)), "big")
            self.B = (k * self.v + pow(L.SRP_G, self.b, L.SRP_N)) % L.SRP_N
            res = {"serverPk": L._pad(self.B).hex(), "salt": self.salt.hex()}
            res.update(self.tamper.get("start", {}))
            self._reply({"jsonrpc": "2.0", "id": msg["id"], "result": res})
        elif msg["method"] == "ConfirmKeyExchange":
            u = int.from_bytes(L._h(L._pad(self.A), L._pad(self.B)), "big")
            S = pow(self.A * pow(self.v, u, L.SRP_N), self.b, L.SRP_N)
            self.K = L._h(L._pad(S))
            hn, hg = L._h(L._pad(L.SRP_N)), L._h(L._pad(L.SRP_G))
            m1 = L._h(bytes(p ^ q for p, q in zip(hn, hg)), self.salt, L._pad(self.A), L._pad(self.B), self.K)
            if msg["params"]["clientConfirmation"] != m1.hex():
                self._reply(
                    {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -11005, "message": "VerificationFailure"}}
                )
                return
            m2 = L._h(L._pad(self.A), m1, self.K)
            res = {"clientId": self.client_id, "serverConfirmation": m2.hex(), "nonce": "00" * 16}
            res.update(self.tamper.get("confirm", {}))
            self._reply({"jsonrpc": "2.0", "id": msg["id"], "result": res})
        elif msg["method"] == "RequestSession":  # the post-pair session check, on a FRESH link
            assert msg["params"]["clientId"] == self.client_id
            self.challenge = bytes(range(32, 64))
            self._reply(
                {"jsonrpc": "2.0", "id": msg["id"], "result": {"challenge": self.challenge.hex(), "nonce": "11" * 16}}
            )
        elif msg["method"] == "CheckSessionIntegrity":
            good = msg["params"]["response"] == L.session_proof(self.K, self.challenge).hex()
            if self.session_reject or not good:
                self._reply(
                    {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -11005, "message": "VerificationFailure"}}
                )
            else:
                self._reply({"jsonrpc": "2.0", "id": msg["id"], "result": {"confirmation": True}})
        else:  # pragma: no cover — the orchestration sends exactly these methods; anything else is a test bug
            raise AssertionError(msg["method"])

    async def recv_frame(self):
        return self.queue.pop(0)

    async def disconnect(self):
        self.disconnected += 1

    async def connect(self, addr, adapter=None):
        self.connects.append((addr, adapter))
        return self.write, self.recv_frame, self.disconnect


# ── the pure exchange ─────────────────────────────────────────────────────────────────────────────
def test_pair_agrees_with_the_device_on_k_and_stores_its_client_id():
    dev = SimDevice(heartbeats=1)  # a HeartBeat notification before each reply must be skipped

    async def passkey():
        return dev.passkey

    creds = _run(P.pair(dev.write, dev.recv_frame, passkey, srp=L.SrpClient(private_value=0x1234)))
    assert creds == {"clientId": "cli-77", "masterPairKey": dev.K.hex()}
    assert [m["method"] for m in dev.sent] == ["StartKeyExchange", "ConfirmKeyExchange"]
    assert [m["id"] for m in dev.sent] == [1, 2] and all(m["jsonrpc"] == "2.0" for m in dev.sent)


def test_pair_uses_the_rpc_ids_it_is_given_and_a_fresh_srp_client_by_default():
    dev = SimDevice()

    async def passkey():
        return dev.passkey

    creds = _run(P.pair(dev.write, dev.recv_frame, passkey, start_id=5, confirm_id=6))
    assert creds["masterPairKey"] == dev.K.hex() and [m["id"] for m in dev.sent] == [5, 6]


def test_a_wrong_passkey_is_the_devices_verification_failure_and_nothing_is_returned():
    dev = SimDevice(passkey="4867")

    async def passkey():
        return "0000"

    with pytest.raises(As11Error, match="VerificationFailure"):
        _run(P.pair(dev.write, dev.recv_frame, passkey))


def test_a_device_that_fakes_m2_is_refused_even_though_it_accepted_m1():
    """The whole reason M2 is checked: a device (or a man in the middle) that returns a clientId without
    proving it knows K must not get its key stored."""
    dev = SimDevice(tamper={"confirm": {"serverConfirmation": "ab" * 32}})

    async def passkey():
        return dev.passkey

    with pytest.raises(As11Error, match="M2"):
        _run(P.pair(dev.write, dev.recv_frame, passkey))


def test_m2_comparison_is_case_insensitive():
    dev = SimDevice()
    srp = L.SrpClient(private_value=0x1234)

    async def upper_recv():
        vcid, payload = await dev.recv_frame()
        msg = json.loads(payload)
        if "result" in msg and "serverConfirmation" in msg["result"]:
            msg["result"]["serverConfirmation"] = msg["result"]["serverConfirmation"].upper()
        return vcid, json.dumps(msg).encode()

    async def passkey():
        return dev.passkey

    creds = _run(P.pair(dev.write, upper_recv, passkey, srp=srp))
    assert creds["clientId"] == "cli-77"


@pytest.mark.parametrize("step,missing", [("start", {"salt": ""}), ("confirm", {"clientId": None})])
def test_a_reply_missing_a_required_member_is_a_protocol_error(step, missing):
    dev = SimDevice(tamper={step: missing})

    async def passkey():
        return dev.passkey

    with pytest.raises(As11Error, match="missing"):
        _run(P.pair(dev.write, dev.recv_frame, passkey))


def test_a_refused_start_key_exchange_raises_before_any_passkey_is_asked_for():
    dev = SimDevice(error=("StartKeyExchange", {"code": -1, "message": "NotInPairingMode"}))
    asked = []

    async def passkey():
        asked.append(1)
        return dev.passkey

    with pytest.raises(As11Error, match="NotInPairingMode"):
        _run(P.pair(dev.write, dev.recv_frame, passkey))
    assert asked == [] and [m["method"] for m in dev.sent] == ["StartKeyExchange"]


@pytest.mark.parametrize("bad", ["12a4", "123", "12345678901", 4867, None, ""])
def test_confirm_rejects_a_malformed_passkey_before_touching_the_link(bad):
    dev = SimDevice()
    with pytest.raises(ValueError):
        _run(P.confirm_exchange(dev.write, dev.recv_frame, L.SrpClient(), "00", "00", bad))
    assert dev.sent == []


def test_valid_passkey_bounds():
    assert P.valid_passkey("1234") and P.valid_passkey("1234567890")
    assert not P.valid_passkey("123") and not P.valid_passkey("12345678901") and not P.valid_passkey("１２３４")


# ── the credentials file ──────────────────────────────────────────────────────────────────────────
def test_write_creds_is_owner_only_atomic_and_loadable_by_the_daemon(tmp_path):
    path = str(tmp_path / "as11_creds.json")
    creds = {"masterPairKey": "ab" * 32, "clientId": "cli", "ble_addr": "AA:BB:CC:DD:EE:FF", "paired_at": "x"}
    P.write_creds(path, creds)
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert not os.path.exists(path + ".tmp")
    assert capture._load_as11_creds(path) == creds
    assert json.load(open(path)) == creds


@pytest.mark.parametrize("drop", ["masterPairKey", "clientId", "ble_addr"])
def test_write_creds_refuses_a_partial_record(tmp_path, drop):
    creds = {"masterPairKey": "ab" * 32, "clientId": "cli", "ble_addr": "AA"}
    creds.pop(drop)
    with pytest.raises(ValueError, match=drop):
        P.write_creds(str(tmp_path / "c.json"), creds)
    assert list(tmp_path.iterdir()) == []


def test_write_creds_removes_its_temp_file_when_the_replace_fails(tmp_path, monkeypatch):
    path = str(tmp_path / "c.json")

    def boom(_a, _b):
        raise OSError("disk full")

    monkeypatch.setattr(P.os, "replace", boom)
    with pytest.raises(OSError, match="disk full"):
        P.write_creds(path, {"masterPairKey": "ab", "clientId": "c", "ble_addr": "a"})
    assert list(tmp_path.iterdir()) == []


# ── PairingSession: the daemon's two-request state machine ────────────────────────────────────────
class Clock:
    """Injected monotonic clock. `sleep` RECORDS naps and, only when `advance` is set, moves the clock —
    so the watchdog's 120 s nap does not expire an exchange the test wants to keep open."""

    def __init__(self, advance=False):
        self.t = 1000.0
        self.slept = []
        self.advance = advance

    def __call__(self):
        return self.t

    async def sleep(self, s):
        self.slept.append(s)
        if self.advance:
            self.t += s


async def _nosleep(_s):
    """No real naps in this file: a mutant that adds a retry must FAIL fast, not time out — mutmut reads a
    timeout as UNDECIDED and the diff gate refuses on it."""


def _session(dev, tmp_path, clk=None, **kw):
    clk = clk or Clock()
    kw.setdefault("clock", clk)
    kw.setdefault("sleep", clk.sleep)
    kw.setdefault("srp_factory", lambda: L.SrpClient(private_value=0x1234))
    return P.PairingSession(dev.connect, str(tmp_path / "as11_creds.json"), **kw), clk


def test_session_start_then_passkey_stores_verified_creds_and_drops_the_link(tmp_path):
    dev = SimDevice()
    adopted = []
    ses, _clk = _session(dev, tmp_path, on_paired=lambda c: adopted.append(c) or True)

    async def go():
        # Subset, not exact equality: `status()` also reports the radio it pairs on and whether a
        # key is stored (2026-09-06). Those are ADDITIVE fields — pinning the whole dict here would
        # make every future disclosure a test failure, which is how a shape assertion turns into a
        # brake on saying more.
        assert ses.busy() is False and ses.status()["pending"] is False
        r1 = await ses.op("start", ble_addr=" AA:BB:CC:DD:EE:FF ")
        assert r1["ok"] and r1["awaiting"] == "passkey" and r1["pending"] is True
        assert r1["ble_addr"] == "AA:BB:CC:DD:EE:FF" and r1["seconds_left"] == 120.0
        assert ses.busy() is True and dev.disconnected == 0  # the link is HELD for the passkey
        r2 = await ses.op("passkey", passkey=dev.passkey)
        return r2

    r2 = _run(go())
    assert r2 == {
        "ok": True,
        "verified": True,
        "stored": True,
        "clientId": "cli-77",
        "ble_addr": "AA:BB:CC:DD:EE:FF",
        "live": True,
        "restart_required": False,
        "session_ok": True,
    }
    # The documented order: the pairing link is dropped, 0.5 s pass, and a FRESH link proves the key.
    assert [m["method"] for m in dev.sent] == [
        "StartKeyExchange",
        "ConfirmKeyExchange",
        "RequestSession",
        "CheckSessionIntegrity",
    ]
    assert len(dev.connects) == 2 and dev.disconnected == 2 and ses.busy() is False
    assert P.POST_PAIR_SETTLE_S in _clk.slept
    stored = capture._load_as11_creds(str(tmp_path / "as11_creds.json"))
    assert stored["masterPairKey"] == dev.K.hex() and stored["clientId"] == "cli-77"
    assert stored["ble_addr"] == "AA:BB:CC:DD:EE:FF" and stored["paired_at"].endswith("Z")
    assert adopted == [stored]


def test_session_without_an_adopter_reports_restart_required(tmp_path):
    dev = SimDevice()
    ses, _ = _session(dev, tmp_path)

    async def go():
        await ses.op("start", ble_addr="AA")
        return await ses.op("passkey", passkey=dev.passkey)

    r = _run(go())
    assert r["ok"] and r["live"] is False and r["restart_required"] is True


def test_session_wrong_passkey_stores_nothing_drops_the_link_and_needs_a_new_start(tmp_path):
    dev = SimDevice(passkey="4867")
    ses, _ = _session(dev, tmp_path)

    async def go():
        await ses.op("start", ble_addr="AA")
        r = await ses.op("passkey", passkey="0000")
        again = await ses.op("passkey", passkey="4867")
        return r, again

    r, again = _run(go())
    assert r["ok"] is False and r["verified"] is False and "VerificationFailure" in r["error"]
    assert dev.disconnected == 1 and not os.path.exists(tmp_path / "as11_creds.json")
    assert again["ok"] is False and "Start pairing first" in again["error"]


def test_session_malformed_passkey_keeps_the_exchange_open(tmp_path):
    """A typo must not cost the person the whole exchange (re-entering pairing mode on the machine)."""
    dev = SimDevice()
    ses, _ = _session(dev, tmp_path)

    async def go():
        await ses.op("start", ble_addr="AA")
        bad = await ses.op("passkey", passkey="12")
        assert bad["ok"] is False and bad["pending"] is True and "digit" in bad["error"]
        assert dev.disconnected == 0 and [m["method"] for m in dev.sent] == ["StartKeyExchange"]
        return await ses.op("passkey", passkey=dev.passkey)

    assert _run(go())["ok"] is True


def test_session_passkey_without_a_start_is_an_error_not_a_crash(tmp_path):
    ses, _ = _session(SimDevice(), tmp_path)
    r = _run(ses.op("passkey", passkey="1234"))
    assert r["ok"] is False and "Start pairing first" in r["error"]


def test_session_refuses_to_start_while_the_live_stream_holds_the_link(tmp_path):
    dev = SimDevice()
    ses, _ = _session(dev, tmp_path, other_busy=lambda: True)
    r = _run(ses.op("start", ble_addr="AA"))
    assert r["ok"] is False and "live CPAP stream" in r["error"] and dev.sent == []


def test_session_needs_an_address_and_falls_back_to_the_stored_one(tmp_path):
    dev = SimDevice()
    ses, _ = _session(dev, tmp_path)
    assert _run(ses.op("start"))["error"].startswith("no CPAP BLE address")
    ses2, _ = _session(dev, tmp_path, default_addr=lambda: "11:22:33:44:55:66")
    r = _run(ses2.op("start", ble_addr=""))
    assert r["ok"] and r["ble_addr"] == "11:22:33:44:55:66"


def test_session_second_start_while_pending_reports_already_and_keeps_the_exchange(tmp_path):
    dev = SimDevice()
    ses, _ = _session(dev, tmp_path)

    async def go():
        await ses.op("start", ble_addr="AA")
        return await ses.op("start", ble_addr="AA")

    r = _run(go())
    assert r["ok"] and r["already"] is True and r["awaiting"] == "passkey"
    assert len(dev.sent) == 1 and dev.disconnected == 0


def test_session_concurrent_start_answers_already_in_progress_without_a_second_connect(tmp_path):
    gate = asyncio.Event()
    calls = []

    async def slow_connect(addr):
        calls.append(addr)
        await gate.wait()
        dev = SimDevice()
        return dev.write, dev.recv_frame, dev.disconnect

    ses = P.PairingSession(slow_connect, str(tmp_path / "c.json"), sleep=_nosleep)

    async def go():
        t1 = asyncio.ensure_future(ses.op("start", ble_addr="AA"))
        await asyncio.sleep(0)
        assert ses.busy() is True  # busy from start-INTENT, before any frame moved
        r2 = await ses.op("start", ble_addr="AA")
        gate.set()
        return r2, await t1

    r2, r1 = _run(go())
    assert r2 == {"ok": True, "starting": True, "already": True, "detail": "a pairing start is already in progress"}
    assert r1["ok"] and r1["awaiting"] == "passkey" and calls == ["AA"]


def test_session_start_exchange_failure_drops_the_link_and_reports(tmp_path):
    dev = SimDevice(error=("StartKeyExchange", {"code": -1, "message": "NotInPairingMode"}))
    ses, _ = _session(dev, tmp_path)
    r = _run(ses.op("start", ble_addr="AA"))
    assert r["ok"] is False and "NotInPairingMode" in r["error"]
    assert dev.disconnected == 1 and ses.busy() is False


def test_session_connect_not_found_is_unreachable_and_never_retried(tmp_path):
    attempts = []

    async def connect(_addr):
        attempts.append(1)
        raise type("BleakDeviceNotFoundError", (Exception,), {})("no such device")

    clk = Clock()
    ses = P.PairingSession(connect, str(tmp_path / "c.json"), sleep=clk.sleep, clock=clk)
    r = _run(ses.op("start", ble_addr="AA"))
    # The hint names the documented menu path, not the old "its menu → Bluetooth".
    assert r["ok"] is False and r["unreachable"] is True and r["error"] == P.NOT_FOUND_HINT
    assert "More → MyAir App → OK, downloaded → Connect" in r["error"] and "Bluetooth)" not in r["error"]
    assert attempts == [1] and clk.slept == []


def test_session_connect_in_progress_is_retried_then_succeeds(tmp_path):
    """The shadow poll may hold the link for a few seconds at the exact moment the button is pressed
    (bluez `InProgress`); pairing waits it out rather than making the person retry."""
    dev = SimDevice()
    attempts = []

    async def connect(addr):
        attempts.append(1)
        if len(attempts) < 3:
            raise RuntimeError("org.bluez.Error.InProgress")
        return await dev.connect(addr)

    clk = Clock()
    ses = P.PairingSession(connect, str(tmp_path / "c.json"), sleep=clk.sleep, clock=clk, retry_delay_s=2.5)
    r = _run(ses.op("start", ble_addr="AA"))
    assert r["ok"] and len(attempts) == 3 and clk.slept[:2] == [2.5, 2.5]  # then the watchdog's nap


def test_session_connect_that_keeps_failing_reports_the_last_error(tmp_path):
    async def connect(_addr):
        raise RuntimeError("org.bluez.Error.InProgress")

    clk = Clock()
    ses = P.PairingSession(
        connect, str(tmp_path / "c.json"), sleep=clk.sleep, clock=clk, connect_attempts=2, retry_delay_s=1.0
    )
    r = _run(ses.op("start", ble_addr="AA"))
    assert r == {"ok": False, "error": "RuntimeError: org.bluez.Error.InProgress"} and clk.slept == [1.0]


def test_session_cancel_drops_a_pending_exchange_and_is_a_noop_otherwise(tmp_path):
    dev = SimDevice()
    ses, _ = _session(dev, tmp_path)

    async def go():
        assert await ses.op("cancel") == {"ok": True, "cancelled": False, "detail": "nothing pending"}
        await ses.op("start", ble_addr="AA")
        r = await ses.op("cancel")
        return r, await ses.op("status")

    r, st = _run(go())
    assert r == {"ok": True, "cancelled": True} and dev.disconnected == 1
    assert st["ok"] is True and st["pending"] is False  # subset — see note above


def test_session_expires_an_unanswered_exchange_and_frees_the_link(tmp_path):
    dev = SimDevice()
    ses, clk = _session(dev, tmp_path, Clock(advance=True), passkey_timeout_s=30.0)

    async def go():
        r = await ses.op("start", ble_addr="AA")
        assert r["seconds_left"] == 30.0
        await asyncio.sleep(0)  # let the watchdog run (the injected sleep advances the clock)
        await asyncio.sleep(0)
        return await ses.op("status"), await ses.op("passkey", passkey=dev.passkey)

    st, late = _run(go())
    assert st["ok"] is True and st["pending"] is False and dev.disconnected == 1
    assert late["ok"] is False and "Start pairing first" in late["error"]
    assert ses.busy() is False


def test_session_watchdog_does_not_kill_an_exchange_that_was_restarted_after_it_slept(tmp_path):
    """The watchdog wakes to find a NEWER exchange whose deadline has not passed: it must leave it."""
    dev = SimDevice()
    clk = Clock()
    naps = []

    async def sleep(s):
        naps.append(s)
        if len(naps) == 1:  # the FIRST watchdog nap: cancel + restart underneath it
            await ses.op("cancel")
            clk.t += 5.0
            await ses.op("start", ble_addr="BB")

    ses = P.PairingSession(
        dev.connect,
        str(tmp_path / "c.json"),
        clock=clk,
        sleep=sleep,
        passkey_timeout_s=60.0,
        srp_factory=lambda: L.SrpClient(private_value=0x1234),
    )

    async def go():
        await ses.op("start", ble_addr="AA")
        for _ in range(4):
            await asyncio.sleep(0)
        return await ses.op("status")

    st = _run(go())
    assert st["pending"] is True and st["ble_addr"] == "BB"


def test_session_unknown_action_is_an_error(tmp_path):
    ses, _ = _session(SimDevice(), tmp_path)
    r = _run(ses.op("reboot"))
    assert r["ok"] is False and "unknown pairing action" in r["error"]


def test_session_swallows_a_disconnect_that_fails(tmp_path):
    dev = SimDevice()

    async def bad_disconnect():
        raise RuntimeError("already gone")

    async def connect(_addr):
        return dev.write, dev.recv_frame, bad_disconnect

    ses = P.PairingSession(connect, str(tmp_path / "c.json"), sleep=_nosleep)

    async def go():
        await ses.op("start", ble_addr="AA")
        return await ses.op("cancel")

    assert _run(go()) == {"ok": True, "cancelled": True}


# ── op("forget") and the status disclosure (owner-reported 2026-09-06) ───────────────────────────────
# The endpoint offered start/passkey/cancel/status and NOTHING deleted as11_creds.json, so a stale key
# could only be displaced by a successful re-pair — the one operation a stale key breaks. And status()
# named neither the radio it pairs on nor whether a key existed, so "which adapter am I pairing to?"
# had no answer in the UI.


def test_forget_deletes_a_stored_key_and_reports_which_device_it_was_for(tmp_path):
    p = tmp_path / "as11_creds.json"
    p.write_text(json.dumps({"masterPairKey": "ab" * 16, "clientId": "cid", "ble_addr": "AA:BB:CC:DD:EE:FF"}))
    ses, _ = _session(SimDevice(), tmp_path)
    assert ses.status()["paired"] is True
    r = asyncio.run(ses.op("forget"))
    assert r["ok"] is True and r["forgotten"] is True and r["was_addr"] == "AA:BB:CC:DD:EE:FF"
    assert not p.exists(), "the key file must be gone, not merely reported gone"
    assert r["paired"] is False, "the response carries the state AFTER the delete, not before"


def test_forgetting_when_nothing_is_stored_is_OK_not_an_error(tmp_path):
    """The end state the caller asked for is the state we are in. Returning an error would make a
    second click look like a fault and teach the operator to distrust the button."""
    ses, _ = _session(SimDevice(), tmp_path)
    r = asyncio.run(ses.op("forget"))
    assert r["ok"] is True and r["forgotten"] is False and r["paired"] is False


def test_forget_REFUSES_while_the_live_stream_holds_the_link(tmp_path):
    """That stream authenticates with this key. Pulling it mid-session turns the next reconnect into a
    decrypt failure instead of an honest 'not paired'."""
    p = tmp_path / "as11_creds.json"
    p.write_text(json.dumps({"masterPairKey": "cd" * 16, "clientId": "c", "ble_addr": "A1:B2:C3:D4:E5:F6"}))
    ses, _ = _session(SimDevice(), tmp_path, other_busy=lambda: True)
    r = asyncio.run(ses.op("forget"))
    assert r["ok"] is False and "live CPAP stream" in r["error"]
    assert p.exists(), "a refusal must not delete the key"


def test_forget_REFUSES_while_an_exchange_is_open_and_points_at_cancel(tmp_path):
    dev = SimDevice()
    p = tmp_path / "as11_creds.json"
    p.write_text(json.dumps({"masterPairKey": "ef" * 16, "clientId": "c", "ble_addr": "A1:B2:C3:D4:E5:F6"}))
    ses, _ = _session(dev, tmp_path)
    assert asyncio.run(ses.op("start", ble_addr="AA"))["ok"] is True
    r = asyncio.run(ses.op("forget"))
    assert r["ok"] is False and "cancel" in r["error"]
    assert p.exists()


def test_forget_reports_an_unlink_failure_rather_than_claiming_success(tmp_path, monkeypatch):
    p = tmp_path / "as11_creds.json"
    p.write_text(json.dumps({"masterPairKey": "11" * 16, "clientId": "c", "ble_addr": "A:B"}))
    ses, _ = _session(SimDevice(), tmp_path)

    def boom(_path):
        raise OSError("read-only file system")

    monkeypatch.setattr(P.os, "unlink", boom)
    r = asyncio.run(ses.op("forget"))
    assert r["ok"] is False and "read-only file system" in r["error"]


def test_status_names_the_radio_it_pairs_on(tmp_path):
    """`which adapter am I pairing to?` had no answer in the UI. The box has three radios and only one
    is pinned for the CPAP."""
    ses, _ = _session(SimDevice(), tmp_path, adapter="AA:BB:CC:10:00:01")
    assert ses.status()["adapter"] == "AA:BB:CC:10:00:01"
    assert ses.status()["adapter_usable"] is True


def test_status_flags_a_radio_that_cannot_be_paired_against(tmp_path):
    """A Zephyr/nRF52840 dongle reports an all-zero BD address and refuses a host-side public pin
    (0x0c Not Supported), so a key stored against it would never reconnect. `capture._addressable`
    already guards the failover ladder against exactly this; the pairing panel showed nothing."""
    ses, _ = _session(SimDevice(), tmp_path, adapter="00:00:00:00:00:00")
    assert ses.status()["adapter_usable"] is False
    ses2, _ = _session(SimDevice(), tmp_path, adapter="ff:ff:ff:ff:ff:ff")
    assert ses2.status()["adapter_usable"] is False, "case must not decide addressability"


def test_status_says_UNKNOWN_rather_than_usable_when_no_radio_is_pinned(tmp_path):
    """None, not True. A panel that renders a missing pin as 'fine' is the fabricated-green this repo
    keeps paying for — absent is not the same as usable."""
    ses, _ = _session(SimDevice(), tmp_path)
    assert ses.status()["adapter"] is None
    assert ses.status()["adapter_usable"] is None


def test_status_paired_flag_is_read_at_call_time_not_cached(tmp_path):
    p = tmp_path / "as11_creds.json"
    ses, _ = _session(SimDevice(), tmp_path)
    assert ses.status()["paired"] is False
    p.write_text(json.dumps({"masterPairKey": "22" * 16, "clientId": "c", "ble_addr": "Z"}))
    assert ses.status()["paired"] is True, "a cached flag goes stale the moment a pair or forget lands"
    assert ses.status()["creds_addr"] == "Z"


def test_a_truncated_or_keyless_creds_file_reads_as_NOT_paired(tmp_path):
    """`_load_as11_creds` already treats a half-written file as 'not paired' silently; status must
    agree, or the UI hides Unpair on a file that cannot authenticate anything."""
    p = tmp_path / "as11_creds.json"
    ses, _ = _session(SimDevice(), tmp_path)
    p.write_text("{not json")
    assert ses.status()["paired"] is False
    p.write_text(json.dumps({"clientId": "c", "ble_addr": "Z"}))  # no masterPairKey
    assert ses.status()["paired"] is False


def test_status_disclosure_rides_along_with_a_pending_exchange(tmp_path):
    """The radio and stored-key facts must not vanish the moment an exchange opens — that is exactly
    when an operator is looking at the panel."""
    ses, _ = _session(SimDevice(), tmp_path, adapter="hci1")
    assert asyncio.run(ses.op("start", ble_addr="AA"))["ok"] is True
    s = ses.status()
    assert s["pending"] is True and s["adapter"] == "hci1" and s["paired"] is False


# ── the documented pairing sequence (owner, 2026-10-10) ──────────────────────────────────────────────────────────
def test_a_start_reply_that_never_comes_ends_the_exchange_at_its_deadline_not_never():
    """`_await_result` skips HeartBeats forever; the overall bound is what ends a silent device."""
    sent = []

    async def write(frame):
        sent.append(frame)

    async def recv_frame():
        await asyncio.sleep(0.005)
        return L.VCID_PLAIN_RX, json.dumps({"jsonrpc": "2.0", "method": "HeartBeat", "params": {}}).encode()

    # OUTER bound: a mutant that drops the deadline must FAIL here (TimeoutError), not hang the suite.
    with pytest.raises(As11Error, match="no StartKeyExchange reply within 0.05 s"):
        _run(
            asyncio.wait_for(
                P.start_exchange(write, recv_frame, L.SrpClient(private_value=0x1234), reply_timeout_s=0.05), 2
            )
        )
    assert len(sent) == 1


def test_the_reply_bounds_are_the_documented_ones():
    assert P.START_REPLY_TIMEOUT_S == 30.0 and P.CONFIRM_REPLY_TIMEOUT_S == 15.0 and P.POST_PAIR_SETTLE_S == 0.5


def test_a_confirm_reply_that_never_comes_is_named():
    dev = SimDevice()
    srp = L.SrpClient(private_value=0x1234)

    async def go():
        pk, salt = await P.start_exchange(dev.write, dev.recv_frame, srp)

        async def silent():
            await asyncio.sleep(1)

        return await P.confirm_exchange(dev.write, silent, srp, pk, salt, dev.passkey, reply_timeout_s=0.01)

    with pytest.raises(As11Error, match="no ConfirmKeyExchange reply"):
        _run(go())


def _pair_through(ses, dev, **start):
    async def go():
        r1 = await ses.op("start", **start)
        assert r1["ok"], r1
        return await ses.op("passkey", passkey=dev.passkey)

    return _run(go())


def test_a_key_the_device_refuses_on_the_fresh_link_is_stored_but_reported_not_working(tmp_path):
    dev = SimDevice(session_reject=True)
    ses, _ = _session(dev, tmp_path)
    r = _pair_through(ses, dev, ble_addr="AA")
    assert r["verified"] is True and r["stored"] is True  # M2 proved K: the pairing itself stands
    assert r["session_ok"] is False and "VerificationFailure" in r["session_error"]
    assert capture._load_as11_creds(str(tmp_path / "as11_creds.json"))["clientId"] == "cli-77"
    assert dev.disconnected == 2  # the check's link is closed even when it fails


def test_a_session_check_that_cannot_reconnect_says_so(tmp_path):
    dev = SimDevice()
    calls = []

    async def connect(addr):
        calls.append(addr)
        if len(calls) > 1:
            raise OSError("adapter went away")
        return dev.write, dev.recv_frame, dev.disconnect

    clk = Clock()
    ses = P.PairingSession(
        connect,
        str(tmp_path / "c.json"),
        clock=clk,
        sleep=clk.sleep,
        srp_factory=lambda: L.SrpClient(private_value=0x1234),
    )
    r = _pair_through(ses, dev, ble_addr="AA")
    assert r["stored"] is True and r["session_ok"] is False
    assert r["session_error"] == "reconnect: OSError: adapter went away"


def test_a_session_check_that_hangs_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(P, "SESSION_CHECK_TIMEOUT_S", 0.01)
    dev = SimDevice()
    n = []

    async def recv_frame():
        if len(dev.sent) > 2:  # past the pairing exchange: the device goes silent
            await asyncio.sleep(1)
        return await dev.recv_frame()

    async def connect(addr):
        n.append(addr)
        return dev.write, recv_frame, dev.disconnect

    clk = Clock()
    ses = P.PairingSession(
        connect,
        str(tmp_path / "c.json"),
        clock=clk,
        sleep=clk.sleep,
        srp_factory=lambda: L.SrpClient(private_value=0x1234),
    )
    r = _pair_through(ses, dev, ble_addr="AA")
    assert r["session_ok"] is False and r["session_error"].startswith("TimeoutError")
    assert dev.disconnected == 2


def test_a_chosen_radio_reaches_the_connect_and_is_recorded_with_the_key(tmp_path):
    dev = SimDevice()
    ses, _ = _session(dev, tmp_path)
    r = _pair_through(ses, dev, ble_addr="AA", adapter="AA:BB:CC:10:00:01")
    assert r["session_ok"] is True
    assert dev.connects == [("AA", "AA:BB:CC:10:00:01")] * 2  # pairing AND the check, on the SAME radio
    assert json.load(open(tmp_path / "as11_creds.json"))["adapter"] == "AA:BB:CC:10:00:01"


def test_no_radio_chosen_keeps_the_one_argument_connect_and_records_no_adapter(tmp_path):
    dev = SimDevice()
    ses, _ = _session(dev, tmp_path)
    _pair_through(ses, dev, ble_addr="AA")
    assert dev.connects == [("AA", None)] * 2
    assert "adapter" not in json.load(open(tmp_path / "as11_creds.json"))


def test_unpair_remembers_the_address_so_the_next_start_needs_none(tmp_path):
    """2026-10-10: Unpair deleted the only copy of the address and every later Start answered
    'no CPAP BLE address'. The address now outlives the key."""
    dev = SimDevice()
    path = tmp_path / "as11_creds.json"
    path.write_text(json.dumps({"masterPairKey": "aa", "clientId": "c", "ble_addr": "AA:BB:CC:00:00:01"}))
    ses, _ = _session(dev, tmp_path)
    f = _run(ses.op("forget"))
    assert f["forgotten"] is True and f["last_addr"] == "AA:BB:CC:00:00:01" and f["paired"] is False
    r = _pair_through(ses, dev)
    assert r["ble_addr"] == "AA:BB:CC:00:00:01" and r["session_ok"] is True


def test_with_no_address_anywhere_start_says_how_to_get_one(tmp_path):
    ses, _ = _session(SimDevice(), tmp_path)
    r = _run(ses.op("start"))
    assert r["ok"] is False and "Find CPAP" in r["error"] and P.PAIRING_MODE_STEPS in r["error"]


def test_status_names_the_pairing_mode_steps(tmp_path):
    ses, _ = _session(SimDevice(), tmp_path)
    st = ses.status()
    assert st["pairing_mode"] == P.PAIRING_MODE_STEPS and st["last_addr"] is None and st["starting"] is False


def _scanner(result=None, exc=None):
    seen = []

    async def scan(adapter):
        seen.append(adapter)
        if exc:
            raise exc
        return result

    return scan, seen


def test_scan_runs_on_the_chosen_radio_and_one_hit_becomes_the_default_address(tmp_path):
    dev = SimDevice()
    scan, seen = _scanner([{"addr": "AA:BB:CC:00:00:01", "name": "ResMed 000001", "rssi": -60}])
    ses, _ = _session(dev, tmp_path, scan=scan, adapter="hci1")
    r = _run(ses.op("scan", adapter="AA:BB:CC:10:00:02"))
    assert r == {
        "ok": True,
        "adapter": "AA:BB:CC:10:00:02",
        "found": [{"addr": "AA:BB:CC:00:00:01", "name": "ResMed 000001", "rssi": -60}],
    }
    assert seen == ["AA:BB:CC:10:00:02"] and ses.status()["last_addr"] == "AA:BB:CC:00:00:01"
    assert _pair_through(ses, dev)["ble_addr"] == "AA:BB:CC:00:00:01"


def test_scan_without_a_choice_uses_the_configured_radio_and_two_hits_choose_nothing(tmp_path):
    scan, seen = _scanner([{"addr": "A1"}, {"addr": "A2"}])
    ses, _ = _session(SimDevice(), tmp_path, scan=scan, adapter="hci1")
    r = _run(ses.op("scan"))
    assert seen == ["hci1"] and len(r["found"]) == 2 and ses.status()["last_addr"] is None


def test_an_empty_scan_tells_the_person_what_to_do_at_the_machine(tmp_path):
    scan, _ = _scanner([])
    ses, _ = _session(SimDevice(), tmp_path, scan=scan)
    r = _run(ses.op("scan"))
    assert r["ok"] is True and r["found"] == [] and r["detail"] == P.NOT_FOUND_HINT


def test_a_scan_that_raises_is_an_answer(tmp_path):
    scan, _ = _scanner(exc=type("BleakError", (Exception,), {})("adapter busy"))
    ses, _ = _session(SimDevice(), tmp_path, scan=scan, adapter="hci1")
    assert _run(ses.op("scan")) == {"ok": False, "adapter": "hci1", "error": "BleakError: adapter busy"}


def test_a_daemon_without_a_scanner_or_radio_list_says_so(tmp_path):
    ses, _ = _session(SimDevice(), tmp_path)
    assert _run(ses.op("scan")) == {"ok": False, "error": "this daemon cannot scan"}
    assert _run(ses.op("radios")) == {"ok": False, "error": "this daemon cannot list its radios"}


def test_scan_is_refused_while_an_exchange_holds_the_link(tmp_path):
    dev = SimDevice()
    scan, seen = _scanner([])
    ses, _ = _session(dev, tmp_path, scan=scan)

    async def go():
        await ses.op("start", ble_addr="AA")
        return await ses.op("scan")

    r = _run(go())
    assert r["ok"] is False and "in progress" in r["error"] and seen == []


def test_radios_are_listed_with_an_unpairable_address_marked(tmp_path):
    async def radios():
        return [
            {"hci": "hci0", "mac": "AA:BB:CC:10:00:01", "up": True},
            {"hci": "hci3", "mac": "00:00:00:00:00:00", "up": True},
            {"hci": "hci4", "mac": None, "up": False},
        ]

    ses, _ = _session(SimDevice(), tmp_path, radios=radios)
    r = _run(ses.op("radios"))
    assert r["ok"] is True and [x["usable"] for x in r["radios"]] == [True, False, False]


def test_a_radio_listing_that_raises_is_an_answer(tmp_path):
    async def radios():
        raise OSError("hciconfig missing")

    ses, _ = _session(SimDevice(), tmp_path, radios=radios)
    assert _run(ses.op("radios")) == {"ok": False, "error": "OSError: hciconfig missing"}


def test_unpairing_a_key_that_carried_no_address_remembers_nothing(tmp_path):
    (tmp_path / "as11_creds.json").write_text(json.dumps({"masterPairKey": "aa", "clientId": "c"}))
    ses, _ = _session(SimDevice(), tmp_path)
    f = _run(ses.op("forget"))
    assert f["forgotten"] is True and f["last_addr"] is None


# ── the contract the panel and the operator read: exact defaults, ids and words ─────────────────────
def test_the_default_rpc_ids_are_one_then_two():
    dev = SimDevice()
    srp = L.SrpClient(private_value=0x1234)

    async def go():
        pk, salt = await P.start_exchange(dev.write, dev.recv_frame, srp)
        return await P.confirm_exchange(dev.write, dev.recv_frame, srp, pk, salt, dev.passkey)

    _run(go())
    assert [m["id"] for m in dev.sent] == [1, 2]


@pytest.mark.parametrize("step,blank", [("start", "serverPk"), ("confirm", "serverConfirmation")])
def test_each_required_member_is_checked_by_name(step, blank):
    dev = SimDevice(tamper={step: {blank: ""}})

    async def passkey():
        return dev.passkey

    with pytest.raises(As11Error, match=rf"pairing response missing \['{blank}'\]"):
        _run(P.pair(dev.write, dev.recv_frame, passkey))


def test_the_exchange_errors_are_worded_exactly():
    with pytest.raises(ValueError) as e:
        _run(P.confirm_exchange(None, None, L.SrpClient(), "00", "00", "12"))
    assert str(e.value) == "passkey must be 4–10 digits"
    dev = SimDevice(tamper={"confirm": {"serverConfirmation": "ab" * 32}})

    async def passkey():
        return dev.passkey

    with pytest.raises(As11Error) as e:
        _run(P.pair(dev.write, dev.recv_frame, passkey))
    assert str(e.value) == "server confirmation (M2) mismatch — wrong passkey or wrong device; nothing stored"


def test_a_failing_connect_is_tried_three_times_four_seconds_apart_by_default(tmp_path):
    n = []

    async def connect(addr):
        n.append(addr)
        raise OSError("busy")

    clk = Clock()
    ses = P.PairingSession(connect, str(tmp_path / "c.json"), clock=clk, sleep=clk.sleep)
    r = _run(ses.op("start", ble_addr="AA"))
    assert r == {"ok": False, "error": "OSError: busy"}
    assert len(n) == 3 and clk.slept == [4.0, 4.0]


def test_connect_attempts_of_one_means_exactly_one(tmp_path):
    n = []

    async def connect(addr):
        n.append(addr)
        raise OSError("busy")

    ses = P.PairingSession(connect, str(tmp_path / "c.json"), connect_attempts=1, sleep=_nosleep)
    _run(ses.op("start", ble_addr="AA"))
    assert n == ["AA"]


def test_a_not_found_carried_only_in_the_message_is_still_unreachable(tmp_path):
    async def connect(addr):
        raise RuntimeError("Device with address AA was Not Found")

    ses = P.PairingSession(connect, str(tmp_path / "c.json"), sleep=_nosleep)
    assert _run(ses.op("start", ble_addr="AA")) == {"ok": False, "unreachable": True, "error": P.NOT_FOUND_HINT}


def test_starting_is_reported_during_a_start_and_cleared_after(tmp_path):
    dev = SimDevice()
    ses, _ = _session(dev, tmp_path)
    r = _run(ses.op("start", ble_addr="AA"))
    # The reply is built INSIDE the start, so it says so; once the start returns, the flag is cleared.
    assert r["starting"] is True and ses.status()["starting"] is False


def test_seconds_left_is_rounded_to_a_tenth_and_floored_at_zero(tmp_path):
    dev = SimDevice()
    clk = Clock()
    ses, _ = _session(dev, tmp_path, clk=clk)
    _run(ses.op("start", ble_addr="AA"))
    clk.t += 0.06
    assert ses.status()["seconds_left"] == 119.9
    clk.t += 500  # past the deadline, before the watchdog has run
    assert ses.status()["seconds_left"] == 0.0


def test_a_lower_case_unpairable_address_is_still_unusable(tmp_path):
    async def radios():
        return [{"hci": "hci5", "mac": "ff:ff:ff:ff:ff:ff", "up": True}]

    ses, _ = _session(SimDevice(), tmp_path, radios=radios)
    assert _run(ses.op("radios"))["radios"][0]["usable"] is False


def test_paired_at_is_utc_in_iso_form(tmp_path, monkeypatch):
    import time as _t

    fixed = _t.struct_time((2026, 10, 10, 23, 5, 9, 5, 283, 0))
    monkeypatch.setattr(P.time, "gmtime", lambda *a: fixed)
    dev = SimDevice()
    ses, _ = _session(dev, tmp_path)
    _pair_through(ses, dev, ble_addr="AA")
    assert json.load(open(tmp_path / "as11_creds.json"))["paired_at"] == "2026-10-10T23:05:09Z"


def test_a_device_refusal_names_its_exception_type(tmp_path):
    dev = SimDevice(error=("StartKeyExchange", {"code": -1, "message": "NotInPairingMode"}))
    ses, _ = _session(dev, tmp_path)
    r = _run(ses.op("start", ble_addr="AA"))
    assert r["ok"] is False and r["error"].startswith("As11Error: RPC 1 failed")
    dev = SimDevice()
    ses, _ = _session(dev, tmp_path)

    async def go():
        await ses.op("start", ble_addr="AA")
        return await ses.op("passkey", passkey="0000")

    r = _run(go())
    assert r["verified"] is False and r["error"].startswith("As11Error: RPC 2 failed")


def _busy_session(tmp_path):
    return _session(SimDevice(), tmp_path, other_busy=lambda: True)[0]


def test_every_refusal_and_detail_is_worded_exactly(tmp_path):
    """The panel shows these strings verbatim to the person at the machine; they ARE the interface."""
    # the live stream holds the link
    ses = _busy_session(tmp_path)
    assert (
        _run(ses.op("start", ble_addr="AA"))["error"] == "the live CPAP stream holds the link — stop it before pairing"
    )
    (tmp_path / "as11_creds.json").write_text(json.dumps({"masterPairKey": "aa", "clientId": "c", "ble_addr": "AA"}))
    assert _run(ses.op("forget"))["error"] == "the live CPAP stream holds the link — stop it before forgetting the key"
    # forget: nothing stored, then something stored
    (tmp_path / "as11_creds.json").unlink()
    ses, _ = _session(SimDevice(), tmp_path)
    assert _run(ses.op("forget"))["detail"] == "no stored key to forget"
    (tmp_path / "as11_creds.json").write_text(json.dumps({"masterPairKey": "aa", "clientId": "c", "ble_addr": "AA"}))
    assert _run(ses.op("forget"))["detail"] == "stored key removed — the CPAP must be re-paired before the next session"
    # passkey with nothing open
    assert _run(ses.op("passkey", passkey="1234"))["error"] == "no pairing exchange is open — press Start pairing first"


def test_the_open_exchange_wordings_are_exact(tmp_path):
    dev = SimDevice()
    scan, _ = _scanner([])
    ses, _ = _session(dev, tmp_path, scan=scan)

    async def go():
        r1 = await ses.op("start", ble_addr="AA")
        again = await ses.op("start", ble_addr="AA")
        scan_r = await ses.op("scan")
        forget_r = await ses.op("forget")
        bad = await ses.op("passkey", passkey="12")
        return r1, again, scan_r, forget_r, bad

    r1, again, scan_r, forget_r, bad = _run(go())
    assert r1["detail"] == "read the 4-digit code on the CPAP screen and enter it"
    assert again["detail"] == "an exchange is already open — type the code the CPAP shows"
    assert scan_r == {"ok": False, "error": "a pairing exchange is in progress — finish or cancel it first"}
    assert forget_r == {"ok": False, "error": "a pairing exchange is open — cancel it before forgetting the key"}
    assert bad["error"] == "passkey must be the 4–10 digit code shown on the CPAP screen"


def test_no_stream_controller_means_never_busy_and_an_idle_one_means_idle(tmp_path):
    ses, _ = _session(SimDevice(), tmp_path)
    assert ses._stream_busy() is False
    ses, _ = _session(SimDevice(), tmp_path, other_busy=lambda: 0)
    assert ses._stream_busy() is False


def test_with_no_radio_chosen_the_connect_gets_ONE_argument(tmp_path):
    """The back-compat promise of `_open`: a connect injected with the old one-argument shape is called
    with exactly the address — never an `adapter=None` it cannot accept."""
    dev = SimDevice()

    async def connect(addr):  # strictly one argument
        return dev.write, dev.recv_frame, dev.disconnect

    ses = P.PairingSession(
        connect, str(tmp_path / "c.json"), sleep=_nosleep, srp_factory=lambda: L.SrpClient(private_value=0x1234)
    )
    r = _run(ses.op("start", ble_addr="AA"))
    assert r["ok"] is True and r["awaiting"] == "passkey"
