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

    def __init__(self, passkey="4867", salt=bytes(range(16)), b_priv=0x2BADC0DE, client_id="cli-77",
                 tamper=None, error=None, heartbeats=0):
        self.passkey, self.salt, self.b, self.client_id = passkey, salt, b_priv, client_id
        self.tamper, self.error, self.heartbeats = tamper or {}, error, heartbeats
        self.sent = []           # every decoded request the client wrote
        self.queue = []          # frames waiting for recv_frame
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
                self._reply({"jsonrpc": "2.0", "id": msg["id"],
                             "error": {"code": -11005, "message": "VerificationFailure"}})
                return
            m2 = L._h(L._pad(self.A), m1, self.K)
            res = {"clientId": self.client_id, "serverConfirmation": m2.hex(), "nonce": "00" * 16}
            res.update(self.tamper.get("confirm", {}))
            self._reply({"jsonrpc": "2.0", "id": msg["id"], "result": res})
        else:  # pragma: no cover — the orchestration sends exactly two methods; anything else is a test bug
            raise AssertionError(msg["method"])

    async def recv_frame(self):
        return self.queue.pop(0)

    async def disconnect(self):
        self.disconnected += 1

    async def connect(self, _addr):
        return self.write, self.recv_frame, self.disconnect


# ── the pure exchange ─────────────────────────────────────────────────────────────────────────────
def test_pair_agrees_with_the_device_on_k_and_stores_its_client_id():
    dev = SimDevice(heartbeats=1)   # a HeartBeat notification before each reply must be skipped

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
        assert ses.busy() is False and ses.status() == {"pending": False}
        r1 = await ses.op("start", ble_addr=" AA:BB:CC:DD:EE:FF ")
        assert r1["ok"] and r1["awaiting"] == "passkey" and r1["pending"] is True
        assert r1["ble_addr"] == "AA:BB:CC:DD:EE:FF" and r1["seconds_left"] == 120.0
        assert ses.busy() is True and dev.disconnected == 0      # the link is HELD for the passkey
        r2 = await ses.op("passkey", passkey=dev.passkey)
        return r2
    r2 = _run(go())
    assert r2 == {"ok": True, "verified": True, "stored": True, "clientId": "cli-77",
                  "ble_addr": "AA:BB:CC:DD:EE:FF", "live": True, "restart_required": False}
    assert dev.disconnected == 1 and ses.busy() is False
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
    ses = P.PairingSession(slow_connect, str(tmp_path / "c.json"))

    async def go():
        t1 = asyncio.ensure_future(ses.op("start", ble_addr="AA"))
        await asyncio.sleep(0)
        assert ses.busy() is True             # busy from start-INTENT, before any frame moved
        r2 = await ses.op("start", ble_addr="AA")
        gate.set()
        return r2, await t1
    r2, r1 = _run(go())
    assert r2 == {"ok": True, "starting": True, "already": True,
                  "detail": "a pairing start is already in progress"}
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
    assert r["ok"] is False and r["unreachable"] is True and "pairing mode" in r["error"]
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
    ses = P.PairingSession(connect, str(tmp_path / "c.json"), sleep=clk.sleep, clock=clk,
                           retry_delay_s=2.5)
    r = _run(ses.op("start", ble_addr="AA"))
    assert r["ok"] and len(attempts) == 3 and clk.slept[:2] == [2.5, 2.5]   # then the watchdog's nap


def test_session_connect_that_keeps_failing_reports_the_last_error(tmp_path):
    async def connect(_addr):
        raise RuntimeError("org.bluez.Error.InProgress")
    clk = Clock()
    ses = P.PairingSession(connect, str(tmp_path / "c.json"), sleep=clk.sleep, clock=clk,
                           connect_attempts=2, retry_delay_s=1.0)
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
    assert st == {"ok": True, "pending": False}


def test_session_expires_an_unanswered_exchange_and_frees_the_link(tmp_path):
    dev = SimDevice()
    ses, clk = _session(dev, tmp_path, Clock(advance=True), passkey_timeout_s=30.0)

    async def go():
        r = await ses.op("start", ble_addr="AA")
        assert r["seconds_left"] == 30.0
        await asyncio.sleep(0)                   # let the watchdog run (the injected sleep advances the clock)
        await asyncio.sleep(0)
        return await ses.op("status"), await ses.op("passkey", passkey=dev.passkey)
    st, late = _run(go())
    assert st == {"ok": True, "pending": False} and dev.disconnected == 1
    assert late["ok"] is False and "Start pairing first" in late["error"]
    assert ses.busy() is False


def test_session_watchdog_does_not_kill_an_exchange_that_was_restarted_after_it_slept(tmp_path):
    """The watchdog wakes to find a NEWER exchange whose deadline has not passed: it must leave it."""
    dev = SimDevice()
    clk = Clock()
    naps = []

    async def sleep(s):
        naps.append(s)
        if len(naps) == 1:                       # the FIRST watchdog nap: cancel + restart underneath it
            await ses.op("cancel")
            clk.t += 5.0
            await ses.op("start", ble_addr="BB")
    ses = P.PairingSession(dev.connect, str(tmp_path / "c.json"), clock=clk, sleep=sleep,
                           passkey_timeout_s=60.0, srp_factory=lambda: L.SrpClient(private_value=0x1234))

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
    ses = P.PairingSession(connect, str(tmp_path / "c.json"))

    async def go():
        await ses.op("start", ble_addr="AA")
        return await ses.op("cancel")
    assert _run(go()) == {"ok": True, "cancelled": True}
