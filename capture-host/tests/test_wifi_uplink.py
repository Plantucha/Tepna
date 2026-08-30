# tepna-capture — tests/test_wifi_uplink.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The uplink I/O layer. The decisions are gated in test_wifi_join.py; what is asserted HERE is that
the credential never leaks — into argv, into the API boundary, or onto disk in the clear."""

from __future__ import annotations

import asyncio
import json
import os
import stat

import pytest

import wifi_join as W
import wifi_uplink as U

PW = "correct horse battery"
SSID = "HotelWifi"
PSK = W.derive_psk(SSID, PW)


class Recorder:
    """Stands in for the privileged helper and remembers exactly how it was called."""

    def __init__(self, rc=0, out="", err=""):
        self.rc, self.out, self.err, self.calls = rc, out, err, []

    async def __call__(self, action, args, stdin_text):
        self.calls.append({"action": action, "args": list(args), "stdin": stdin_text})
        return self.rc, self.out, self.err


# ── the security property ─────────────────────────────────────────────────────────────────────────
def test_THE_PSK_TRAVELS_ON_STDIN_AND_NEVER_ON_ARGV():
    # /proc/<pid>/cmdline is world-readable, so a key passed as an argument is readable by every local
    # user for the lifetime of the call. This is the assertion that keeps it off the command line.
    r = Recorder()
    assert asyncio.run(U.join(SSID, PW, runner=r))["ok"]
    call = r.calls[0]
    assert PSK in call["stdin"]
    assert not any(PSK in a for a in call["args"])
    assert not any(PW in a for a in call["args"])
    assert PW not in call["stdin"]                 # the plaintext is derived away before it is sent


def test_THE_PLAINTEXT_IS_NEVER_WHAT_GETS_STORED(tmp_path):
    U.save_network(str(tmp_path), SSID, PW)
    raw = (tmp_path / "wifi-uplink.json").read_text()
    assert PW not in raw
    assert PSK in raw


def test_THE_STORE_IS_CREATED_UNREADABLE_TO_EVERYONE_ELSE(tmp_path):
    U.save_network(str(tmp_path), SSID, PW)
    mode = stat.S_IMODE(os.stat(tmp_path / "wifi-uplink.json").st_mode)
    assert mode == 0o600, f"credential file is {oct(mode)}"


def test_THE_PUBLIC_VIEW_CANNOT_CARRY_THE_CREDENTIAL(tmp_path):
    view = U.save_network(str(tmp_path), SSID, PW)
    assert PSK not in json.dumps(view)
    assert view == {"ssid": SSID, "security": W.SECURED, "has_credential": True}


def test_AN_OPEN_NETWORK_STORES_NO_CREDENTIAL(tmp_path):
    view = U.save_network(str(tmp_path), "FreeWifi", "", security=W.OPEN)
    assert view["has_credential"] is False
    assert U.load_saved(str(tmp_path))["psk"] is None


def test_AN_OPEN_NETWORK_JOINS_WITHOUT_DERIVING_ANYTHING():
    r = Recorder()
    assert asyncio.run(U.join("FreeWifi", "", security=W.OPEN, runner=r))["ok"]
    assert r.calls[0]["stdin"].strip() == "OPEN"


# ── refusals ──────────────────────────────────────────────────────────────────────────────────────
def test_A_REJECTED_PASSPHRASE_NEVER_REACHES_THE_HELPER():
    r = Recorder()
    out = asyncio.run(U.join(SSID, "short", runner=r))
    assert out["ok"] is False and "at least" in out["error"]
    assert r.calls == [], "a passphrase we already know is invalid was still sent to root"


def test_SAVING_AN_INVALID_PASSPHRASE_RAISES_RATHER_THAN_WRITING(tmp_path):
    with pytest.raises(ValueError):
        U.save_network(str(tmp_path), SSID, "short")
    assert not (tmp_path / "wifi-uplink.json").exists()


def test_A_FAILED_SCAN_REPORTS_THE_ERROR_AND_NO_NETWORKS():
    out = asyncio.run(U.scan(runner=Recorder(rc=1, err="no such interface")))
    assert out["ok"] is False and out["networks"] == [] and "no such interface" in out["error"]


def test_A_FAILURE_WITH_NO_STDERR_STILL_SAYS_SOMETHING():
    # An empty stderr must not become an empty error string — a blank message reads as success in a UI.
    for coro, kw in ((U.scan, {}), (U.leave, {}), (U.join, {"ssid": SSID, "passphrase": PW})):
        out = asyncio.run(coro(runner=Recorder(rc=3), **kw))
        assert out["ok"] is False and out["error"].strip()


def test_LEAVE_AND_STATUS_REPORT_CLEANLY():
    assert asyncio.run(U.leave(runner=Recorder(out="down")))["ok"]
    bad = asyncio.run(U.status(runner=Recorder(rc=1, err="boom")))
    assert bad["ok"] is False and bad["state"] == "unknown"


def test_STATUS_PARSES_THE_ASSOCIATED_CASE():
    st = asyncio.run(U.status(runner=Recorder(
        out="bssid=aa:bb\nssid=HotelWifi\nwpa_state=COMPLETED\nip_address=10.0.0.9\n")))
    assert st == {"ok": True, "state": "up", "ssid": "HotelWifi", "ip": "10.0.0.9"}


def test_A_HALF_ASSOCIATED_STATE_IS_NOT_REPORTED_AS_UP():
    # SCANNING/ASSOCIATING are not "up". Rounding them up would tell the owner the hotel Wi-Fi is
    # working while nothing routes.
    st = asyncio.run(U.status(runner=Recorder(out="wpa_state=ASSOCIATING\nssid=\n")))
    assert st["state"] == "associating" and st["ssid"] is None


# ── the store's absent / corrupt cases ────────────────────────────────────────────────────────────
def test_NO_SAVED_NETWORK_IS_NONE_NOT_AN_ERROR(tmp_path):
    assert U.load_saved(str(tmp_path)) is None
    assert U.public_view(None) is None


def test_A_CORRUPT_STORE_READS_AS_ABSENT(tmp_path):
    (tmp_path / "wifi-uplink.json").write_text("{ this is not json")
    assert U.load_saved(str(tmp_path)) is None


def test_A_STORE_WITHOUT_AN_SSID_READS_AS_ABSENT(tmp_path):
    (tmp_path / "wifi-uplink.json").write_text('{"psk": "deadbeef"}')
    assert U.load_saved(str(tmp_path)) is None


def test_FORGETTING_IS_IDEMPOTENT_AND_SAYS_WHICH_HAPPENED(tmp_path):
    U.save_network(str(tmp_path), SSID, PW)
    assert U.forget_network(str(tmp_path)) is True
    assert U.forget_network(str(tmp_path)) is False
    assert U.load_saved(str(tmp_path)) is None


# ── the REAL subprocess path ──────────────────────────────────────────────────────────────────────
# Everything above injects a `runner` and therefore never executes `_run` itself — the function that
# actually invokes root. These drive it for real against a stub helper, with the sudo prefix removed.
@pytest.fixture
def stub_helper(tmp_path, monkeypatch):
    def _make(body):
        script = tmp_path / "tepna-wifi.sh"
        script.write_text("#!/usr/bin/env bash\n" + body)
        script.chmod(0o755)
        monkeypatch.setattr(U.helper_path, "resolve", lambda _n: str(script))
        monkeypatch.setattr(U.helper_path, "grant_warning", lambda _p: None)
        monkeypatch.setattr(U, "SUDO", ())
        return script
    return _make


def test_THE_REAL_INVOCATION_PASSES_ARGS_AND_STDIN_THROUGH(stub_helper):
    # Echoes back what it received, so the assertion is on the helper's actual view of the call.
    stub_helper('echo "action=$1 arg=$2"; read -r line; echo "stdin=$line"\n')
    rc, out, _err = asyncio.run(U._run("join", [SSID], stdin_text=PSK + "\n"))
    assert rc == 0
    assert "action=join" in out and f"arg={SSID}" in out
    assert f"stdin={PSK}" in out


def test_A_NONZERO_HELPER_EXIT_IS_SURFACED_WITH_ITS_STDERR(stub_helper):
    stub_helper('echo "did not associate" >&2; exit 6\n')
    out = asyncio.run(U.join(SSID, PW))
    assert out["ok"] is False and "did not associate" in out["error"]


def test_A_HELPER_THAT_HANGS_IS_KILLED_AND_REPORTED(stub_helper):
    # A wedged supplicant must not wedge the daemon. The timeout is the only thing standing between a
    # hung `wpa_cli` and a monitor that never answers again.
    stub_helper("sleep 30\n")
    rc, _out, err = asyncio.run(U._run("scan", timeout=0.5))
    assert rc == 124 and "timed out" in err


def test_AN_UNSAFELY_OWNED_HELPER_IS_REFUSED_NOT_RUN(tmp_path, monkeypatch):
    # A NOPASSWD sudo grant on a user-writable script is a root escalation. The in-repo copy lives on
    # exactly such a mount, so this refusal is the one that keeps a dev checkout from becoming one.
    script = tmp_path / "tepna-wifi.sh"
    script.write_text("#!/usr/bin/env bash\necho ran\n")
    script.chmod(0o777)
    monkeypatch.setattr(U.helper_path, "resolve", lambda _n: str(script))
    monkeypatch.setattr(U.helper_path, "grant_warning", lambda _p: "not root-owned")
    rc, out, err = asyncio.run(U._run("scan"))
    assert rc == 126 and out == "" and "not root-owned" in err


def test_A_REAL_SCAN_IS_PARSED_END_TO_END(stub_helper):
    stub_helper(
        "printf 'bssid\\tfrequency\\tsignal level\\tflags\\tssid\\n"
        "aa:bb:cc:dd:ee:ff\\t2412\\t-40\\t[WPA2-PSK-CCMP][ESS]\\tHotelWifi\\n"
        "11:22:33:44:55:66\\t2437\\t-72\\t[ESS]\\tFreeWifi\\n'\n")
    out = asyncio.run(U.scan())
    assert out["ok"] is True
    assert [n["ssid"] for n in out["networks"]] == ["HotelWifi", "FreeWifi"]


def test_A_PROCESS_THAT_DIES_DURING_ITS_OWN_TIMEOUT_KILL_IS_NOT_AN_ERROR(monkeypatch):
    # The one branch a real process cannot be made to hit on demand: it times out, and then exits on
    # its own in the instant between the timeout firing and the kill landing. `kill` then raises
    # ProcessLookupError. Letting that escape would turn a routine race into a 500 from the monitor.
    class DeadOnKill:
        returncode = None

        async def communicate(self, _stdin=None):
            await asyncio.sleep(30)

        def kill(self):
            raise ProcessLookupError("already reaped")

    async def _fake_exec(*_a, **_kw):
        return DeadOnKill()

    monkeypatch.setattr(U.helper_path, "resolve", lambda _n: "/nonexistent/tepna-wifi.sh")
    monkeypatch.setattr(U.helper_path, "grant_warning", lambda _p: None)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_exec)
    rc, _out, err = asyncio.run(U._run("scan", timeout=0.2))
    assert rc == 124 and "timed out" in err


# ── the harvest handover ──────────────────────────────────────────────────────────────────────────
class Scripted:
    """A helper whose reply depends on the action, so a suspend/resume round trip can be driven."""

    def __init__(self, status_out="wpa_state=COMPLETED\nssid=HotelWifi\n"):
        self.status_out, self.calls = status_out, []

    async def __call__(self, action, args, stdin_text):
        self.calls.append({"action": action, "args": list(args), "stdin": stdin_text})
        if action == "status":
            return 0, self.status_out, ""
        return 0, "", ""


def test_A_JOINED_UPLINK_IS_DROPPED_BEFORE_THE_HARVEST(tmp_path):
    U.save_network(str(tmp_path), SSID, PW)
    r = Scripted()
    suspended, detail = asyncio.run(U.suspend_for_harvest(str(tmp_path), runner=r))
    assert suspended is True and SSID in detail
    assert [c["action"] for c in r.calls] == ["status", "leave"]


def test_THE_UPLINK_COMES_BACK_WITH_THE_STORED_KEY_NOT_A_REDERIVATION(tmp_path):
    U.save_network(str(tmp_path), SSID, PW)
    r = Scripted()
    resumed, _d = asyncio.run(U.resume_after_harvest(str(tmp_path), True, runner=r))
    assert resumed is True
    join_call = [c for c in r.calls if c["action"] == "join"][0]
    assert join_call["stdin"].strip() == PSK      # the stored PSK, passed through underived
    assert join_call["args"] == [SSID]


def test_RESUME_HAPPENS_EVEN_WHEN_THE_HARVEST_FAILED(tmp_path):
    # The whole reason `harvest_ok` is accepted and ignored: a crashed harvest is when the box most
    # needs to be reachable. Resuming only on success turns a 90-minute window into an outage.
    U.save_network(str(tmp_path), SSID, PW)
    r = Scripted()
    resumed, detail = asyncio.run(
        U.resume_after_harvest(str(tmp_path), True, harvest_ok=False, runner=r))
    assert resumed is True and "FAILED" in detail
    assert any(c["action"] == "join" for c in r.calls)


def test_NOTHING_IS_DROPPED_WHEN_THERE_IS_NO_WAY_BACK(tmp_path):
    # Uplink joined, but no saved credential: dropping it would be one-way. The harvest's own guard
    # then refuses and skips the night, which is the cheaper loss.
    r = Scripted()
    suspended, detail = asyncio.run(U.suspend_for_harvest(str(tmp_path), runner=r))
    assert suspended is False and "no saved network" in detail
    assert [c["action"] for c in r.calls] == ["status"]      # leave was never called


def test_A_DOWN_UPLINK_NEEDS_NO_SUSPENDING(tmp_path):
    U.save_network(str(tmp_path), SSID, PW)
    r = Scripted(status_out="wpa_state=INTERFACE_DISABLED\n")
    suspended, detail = asyncio.run(U.suspend_for_harvest(str(tmp_path), runner=r))
    assert suspended is False and "already has the radio" in detail


def test_RESUME_DOES_NOTHING_WHEN_NOTHING_WAS_SUSPENDED(tmp_path):
    U.save_network(str(tmp_path), SSID, PW)
    r = Scripted()
    resumed, detail = asyncio.run(U.resume_after_harvest(str(tmp_path), False, runner=r))
    assert resumed is False and "nothing was suspended" in detail
    assert r.calls == []


def test_A_FAILED_SUSPEND_SAYS_SO_RATHER_THAN_CLAIMING_THE_RADIO(tmp_path):
    U.save_network(str(tmp_path), SSID, PW)

    class LeaveFails(Scripted):
        async def __call__(self, action, args, stdin_text):
            if action == "leave":
                return 1, "", "device busy"
            return await Scripted.__call__(self, action, args, stdin_text)

    suspended, detail = asyncio.run(U.suspend_for_harvest(str(tmp_path), runner=LeaveFails()))
    assert suspended is False and "device busy" in detail


def test_A_FAILED_RESUME_IS_REPORTED_NOT_SWALLOWED(tmp_path):
    U.save_network(str(tmp_path), SSID, PW)

    class JoinFails(Scripted):
        async def __call__(self, action, args, stdin_text):
            if action == "join":
                return 1, "", "hotel portal gone"
            return await Scripted.__call__(self, action, args, stdin_text)

    resumed, detail = asyncio.run(U.resume_after_harvest(str(tmp_path), True, runner=JoinFails()))
    assert resumed is False and "hotel portal gone" in detail


def test_AN_OPEN_SAVED_NETWORK_RESUMES_WITHOUT_A_KEY(tmp_path):
    U.save_network(str(tmp_path), "FreeWifi", "", security=W.OPEN)
    r = Scripted()
    assert asyncio.run(U.resume_after_harvest(str(tmp_path), True, runner=r))[0] is True
    assert [c for c in r.calls if c["action"] == "join"][0]["stdin"].strip() == "OPEN"


def test_THE_ADDRESS_IS_READ_FROM_IP_WHEN_THE_SUPPLICANT_DOES_NOT_REPORT_IT():
    # `wpa_cli status` carries `ip_address=` only when the supplicant itself ran DHCP. This box uses an
    # external dhcpcd, so without this fallback a perfectly working uplink renders as "connected, no
    # address" — which reads as a broken link.
    st = asyncio.run(U.status(runner=Recorder(
        out="wpa_state=COMPLETED\nssid=HotelWifi\nwlp1s0  UP  192.168.1.42/24 fe80::1/64\n")))
    assert st["state"] == "up" and st["ip"] == "192.168.1.42"


def test_THE_SUPPLICANTS_OWN_ADDRESS_WINS_WHEN_IT_HAS_ONE():
    st = asyncio.run(U.status(runner=Recorder(
        out="wpa_state=COMPLETED\nip_address=10.0.0.9\nwlp1s0  UP  192.168.1.42/24\n")))
    assert st["ip"] == "10.0.0.9"


def test_NO_ADDRESS_ANYWHERE_STAYS_NONE_RATHER_THAN_GUESSING():
    st = asyncio.run(U.status(runner=Recorder(out="wpa_state=SCANNING\nwlp1s0  DOWN\n")))
    assert st["ip"] is None
