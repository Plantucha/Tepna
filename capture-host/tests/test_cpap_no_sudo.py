# tepna-capture — tests/test_cpap_no_sudo.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE CPAP HARVEST MUST NOT NEED ROOT WHEN THE CARD IS ALREADY REACHABLE.
#
# Every privileged step in the harvest exists to join the card's own Wi-Fi AP: ip link,
# wpa_supplicant, wpa_cli, ip addr add, and the teardown — all `sudo -n`. The DOWNLOAD is a plain
# unauthenticated HTTP GET and never needed a privilege. Observed 2026-07-28: the 13:00 run died at
# `sudo -n mkdir -p` with "interactive authentication is required" and skipped the day, with the
# night's therapy data one HTTP request away.
#
# An ez Share card can run in station mode on the house network, at which point the box reaches it
# over the existing uplink. These tests pin the probe that lets the same build serve both deployments.

import cpap_harvest


def test_reachable_is_false_when_nothing_answers():
    """A closed port is 'no', not an exception. The probe is a routing question, and a harvest must
    never die because the card is simply not there today."""
    assert cpap_harvest.reachable("http://127.0.0.1:9", timeout=0.5) is False


def test_reachable_is_false_on_a_bad_host_rather_than_raising():
    assert cpap_harvest.reachable("http://cpap.invalid.", timeout=0.5) is False


def test_reachable_answers_true_against_a_live_listener(tmp_path):
    """A card in station mode is an ordinary HTTP host. Served locally so the test needs no network."""
    import http.server
    import threading

    class Quiet(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Quiet)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        base = "http://127.0.0.1:%d" % srv.server_address[1]
        assert cpap_harvest.reachable(base, timeout=3.0) is True
    finally:
        srv.shutdown()
        srv.server_close()


def test_the_probe_is_unprivileged_by_construction():
    """The whole point: no privilege escalation, no interface manipulation, no subprocess. If the probe
    ever grows one, the sudo-free deployment silently stops being sudo-free.

    Scanned on the parsed CODE with the docstring stripped, not on the raw source: the function's own
    prose explains what it avoids, so a naive text scan matches the explanation and fails for the wrong
    reason. (It did, first run — the same trap as the ansBalance source pin.)"""
    import ast
    import inspect
    import textwrap

    fn = ast.parse(textwrap.dedent(inspect.getsource(cpap_harvest.reachable))).body[0]
    if fn.body and isinstance(fn.body[0], ast.Expr) and isinstance(fn.body[0].value, ast.Constant):
        fn.body = fn.body[1:]                    # drop the docstring; keep the code
    code = ast.unparse(fn)
    for banned in ("sudo", "_sh", "subprocess", "wpa_", "ip link", "ip addr"):
        assert banned not in code, f"the reachability probe must stay unprivileged — found {banned!r}"


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE LOOP MUST NOT ASSOCIATE WHEN IT DOES NOT HAVE TO
# ══════════════════════════════════════════════════════════════════════════════════════════════════
import asyncio
import datetime as dt

import capture


CFG = {"cpap": {"enabled": True, "at_hour": 13, "wifi_profile": "ezshare",
                "base_url": "http://192.168.4.1", "dest_subdir": "captures/cpap",
                "max_run_sec": 60, "timeout_sec": 5, "retries": 2}}


def _at(hour=13):
    class _DT(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 7, 28, hour, 5, 0)
    return _DT


def _drive(monkeypatch, tmp_path, *, reachable, ticks=2):
    """Run one due cycle of the real poller with the card either already reachable or not."""
    seen = {"up": 0, "down": 0, "harvest": 0}

    def _up(profile, timeout=45.0, guard_dev=None, ssid="ez Share", psk="88888888", iface=None, addr=None, root=None):
        seen["up"] += 1
        return True

    def _down(profile, timeout=30.0, iface=None, root=None):
        seen["down"] += 1
        return True

    def _harvest(*a, **k):
        seen["harvest"] += 1
        return {"files": 5, "bytes": 10, "skipped": 0, "nights": 1, "short": [], "errors": [],
                "partial": False, "nights_on_card": 197}

    monkeypatch.setattr(cpap_harvest, "reachable", lambda base, timeout=5.0: reachable)
    monkeypatch.setattr(cpap_harvest, "default_route_dev", lambda: "eno1")
    monkeypatch.setattr(cpap_harvest, "wifi_up", _up)
    monkeypatch.setattr(cpap_harvest, "wifi_down", _down)
    monkeypatch.setattr(cpap_harvest, "harvest", _harvest)
    monkeypatch.setattr(capture._dt, "datetime", _at())

    calls = {"n": 0}

    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= ticks:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    # HERMETIC. `_cpap_loop` skips the day when `blocking_devices(STATUS["devices"])` reports anything
    # streaming — connected AND worn AND not charging. STATUS is module-global and other tests leave
    # devices in it, so without this the harvest is skipped as "busy" and the assertions below measure
    # nothing. These tests passed in isolation and failed in the full suite for exactly that reason:
    # a test that only holds when it runs alone is a test that passed for the wrong reason.
    saved = dict(capture.STATUS.get("devices") or {})
    capture.STATUS["devices"] = {}
    capture._STOP.clear()
    try:
        asyncio.run(capture.cpap_poller(CFG, str(tmp_path)))
    finally:
        capture._STOP.clear()
        capture.STATUS["devices"] = saved
    return seen


def test_a_reachable_card_is_harvested_with_no_association_at_all(tmp_path, monkeypatch):
    """The sudo-free deployment. Every privileged call in the harvest lives in wifi_up; if it never
    runs, the day's data came down without root."""
    seen = _drive(monkeypatch, tmp_path, reachable=True)
    assert seen["harvest"] == 1, "the card was reachable — it must still be harvested"
    assert seen["up"] == 0, "no association may be attempted when the card already answers"


def test_an_unreachable_card_still_associates(tmp_path, monkeypatch):
    """The AP deployment is untouched — this is a new path, not a replacement."""
    seen = _drive(monkeypatch, tmp_path, reachable=False)
    assert seen["harvest"] == 1
    assert seen["up"] == 1, "an unreachable card must still be associated to"


def test_the_teardown_never_closes_a_link_it_did_not_open(tmp_path, monkeypatch):
    """cpap_poller ALWAYS brackets the loop with a wifi_down — once at startup to clear a stale
    association left by a crashed run, once on exit. Those are correct and unconditional, so the
    thing to measure is the IN-LOOP teardown: it must fire on the associated path and not on the
    direct one, because tearing down on the direct path would attack the SYSTEM supplicant sharing
    that interface — the collateral the private ctrl_interface exists to prevent."""
    # A ROOT EACH. Both drives share a frozen clock, so with one root the first run completes a
    # harvest job stamped for that window and the second is correctly skipped by reconciliation
    # (§6, 2026-09-06) — which zeroes the in-loop teardown this test is counting. Two runs, two boxes.
    (tmp_path / "a").mkdir(); (tmp_path / "b").mkdir()
    direct = _drive(monkeypatch, tmp_path / "a", reachable=True)["down"]
    associated = _drive(monkeypatch, tmp_path / "b", reachable=False)["down"]
    assert associated - direct == 1, (
        f"exactly one extra teardown belongs to the associated path (direct={direct}, "
        f"associated={associated})")


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE WPA CONTROL DIRECTORY MUST BE CREATABLE WITHOUT ROOT
# ══════════════════════════════════════════════════════════════════════════════════════════════════
# 16a97fb gave the harvest its own wpa_supplicant control directory — correct, and it stopped the
# teardown from being able to kill the SYSTEM supplicant. But it put that directory in /run and created
# it with `sudo -n mkdir -p`, a privilege no sudoers rule granted. Deployed, that broke the harvest
# outright: mkdir failed, the directory did not exist, `wpa_supplicant -B` could not create its control
# socket and exited 255, and the failure was reported as the Wi-Fi PROFILE not coming up.
#
# The privilege was never necessary. wpa_supplicant runs as root and can write into any directory that
# EXISTS; the directory itself does not have to be root-owned. Verified on the box.

def test_the_wpa_control_dir_is_creatable_by_this_user(tmp_path, monkeypatch):
    """The regression, pinned: if this ever needs root again the harvest silently stops associating."""
    import os

    d = cpap_harvest._wpa_dir()
    os.makedirs(d, mode=0o700, exist_ok=True)
    assert os.path.isdir(d), f"{d} must be creatable without privilege"
    assert os.access(d, os.W_OK), f"{d} must be writable by the daemon user"


def test_systemd_runtime_directory_is_preferred_when_it_is_usable(tmp_path, monkeypatch):
    """RuntimeDirectory= is the tidy source — systemd creates and cleans it, owned by the service user —
    but preference is expressed by TRYING it, not by trusting the env var. A path that cannot be created
    must fall through rather than be returned and fail later inside wpa_supplicant."""
    rt = tmp_path / "rt"
    rt.mkdir()
    monkeypatch.setenv("RUNTIME_DIRECTORY", str(rt))
    assert cpap_harvest._wpa_dir() == str(rt / "wpa")
    # systemd may hand a colon-separated list; the first entry is ours.
    monkeypatch.setenv("RUNTIME_DIRECTORY", f"{rt}:/run/somewhere-else")
    assert cpap_harvest._wpa_dir() == str(rt / "wpa")


def test_an_unusable_runtime_directory_falls_through_to_the_capture_root(tmp_path, monkeypatch):
    """The exact shape that broke on the box: the first choice is unwritable under ProtectSystem=strict,
    so the probe must keep going instead of returning a path nothing can use."""
    monkeypatch.setenv("RUNTIME_DIRECTORY", "/proc/definitely-not-writable")
    root = tmp_path / "srv"
    root.mkdir()
    assert cpap_harvest._wpa_dir(str(root)) == str(root / ".run" / "wpa")


def test_the_fallback_is_uid_scoped_and_not_shared(monkeypatch):
    """A shared path would let another local user pre-create or read the socket directory."""
    import os

    monkeypatch.delenv("RUNTIME_DIRECTORY", raising=False)
    d = cpap_harvest._wpa_dir()
    assert str(os.getuid()) in d, "the fallback must be scoped to this uid"
    assert d != "/run/tepna-wpa", "the root-owned path is what broke the harvest"


def test_bringing_the_link_up_never_shells_out_to_mkdir():
    """The specific call that failed on the box. Scanned on parsed CODE, docstrings stripped — a text
    scan matches the comment explaining the fix and passes for the wrong reason."""
    import ast
    import inspect
    import textwrap

    up = ast.unparse(ast.parse(textwrap.dedent(inspect.getsource(cpap_harvest._wpa_up))).body[0])
    assert "'mkdir'" not in up and '"mkdir"' not in up, "the control dir must never be made by a shell"
    assert "_wpa_dir(" in up, "…it must come from the probe, so the path is one that works"
    mk = ast.unparse(ast.parse(textwrap.dedent(inspect.getsource(cpap_harvest._wpa_dir))).body[0])
    assert "makedirs" in mk, "…and the probe must actually create it"
    assert "sudo" not in mk, "…without privilege"


def test_an_uncreatable_control_dir_warns_and_does_not_raise(monkeypatch, caplog):
    """QC-style honesty: the harvest reports and carries on to the association attempt rather than
    raising into the poller task. wpa_supplicant will then fail loudly on its own, which is the
    diagnosis a reader needs — not a traceback from a mkdir."""

    def boom(*a, **k):
        raise OSError(13, "Permission denied")

    monkeypatch.setattr(cpap_harvest.os, "makedirs", boom)
    # …and nothing may already BE there. The uid-scoped /tmp fallback survives between runs, so without
    # this the isdir() check passes on a leftover directory and the warning never fires — the test
    # would depend on whether a previous run happened to create it.
    monkeypatch.setattr(cpap_harvest.os.path, "isdir", lambda _p: False)
    monkeypatch.setattr(cpap_harvest, "_sh", lambda argv, t, sudo=False: (1, "stubbed"))
    with caplog.at_level("WARNING"):
        ok = cpap_harvest._wpa_up("wlp1s0", "ez Share", "88888888", "192.168.4.2/24", 5.0)
    assert ok is False
    assert any("no writable wpa control dir" in r.getMessage() for r in caplog.records), [
        r.getMessage() for r in caplog.records
    ]


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# ASSOCIATION IS CONFIRMED FROM /sys, NOT FROM wpa_cli
# ══════════════════════════════════════════════════════════════════════════════════════════════════
# wpa_cli creates its own CLIENT socket under /tmp, and the unit runs ProtectSystem=strict — so every
# status poll failed with "Read-only file system" even when wpa_supplicant was up and associated. The
# harvest reported "did not associate within 45s" for a radio that had associated in four seconds.
#
# Measured against the real radio and the real card, side by side with wpa_cli:
#     link down          carrier unreadable (EINVAL)   -> NOT associated
#     up, not associated carrier=0    wpa_state=SCANNING
#     associated         carrier=1    wpa_state=COMPLETED

def _sysfs(tmp_path, carrier=None, operstate="up", iface="wlan9"):
    """A fake /sys/class/net. `carrier=None` means the file is absent — the EINVAL a DOWN link really
    produces. Injected as a path rather than by patching builtins.open, which reaches far beyond the
    code under test."""
    net = tmp_path / "net" / iface
    net.mkdir(parents=True, exist_ok=True)
    if carrier is not None:
        (net / "carrier").write_text(f"{carrier}\n")
    if operstate is not None:
        (net / "operstate").write_text(f"{operstate}\n")
    return str(tmp_path / "net")


def test_carrier_1_is_associated(tmp_path):
    assert cpap_harvest.associated("wlan9", _sysfs(tmp_path, carrier=1)) is True


def test_carrier_0_is_not_associated(tmp_path):
    assert cpap_harvest.associated("wlan9", _sysfs(tmp_path, carrier=0)) is False


def test_a_down_link_reads_as_NOT_associated_not_as_unknown(tmp_path):
    """The EINVAL case. A down link is a definite no — answering `None` there would send the caller to
    the wpa_cli fallback that cannot run, which is the whole failure being removed."""
    assert cpap_harvest.associated("wlan9", _sysfs(tmp_path, carrier=None, operstate="down")) is False


def test_an_unreadable_interface_is_UNKNOWN_so_the_fallback_can_run(tmp_path):
    """Only a driver that exposes neither file gets `None` — and only that case may consult wpa_cli."""
    (tmp_path / "net" / "wlan9").mkdir(parents=True)
    assert cpap_harvest.associated("wlan9", str(tmp_path / "net")) is None


def test_the_poll_prefers_sysfs_and_never_shells_out_when_it_answers(monkeypatch):
    """THE regression this replaces: a definite /sys answer must not be second-guessed by wpa_cli, or
    the read-only-/tmp failure comes straight back. `associated` is stubbed rather than faked through
    the filesystem — its own reading is covered above; what is under test here is the PREFERENCE."""
    monkeypatch.setattr(cpap_harvest, "associated", lambda iface, sysfs="/sys/class/net": True)
    calls = []
    monkeypatch.setattr(cpap_harvest, "_sh",
                        lambda argv, t, sudo=False: (calls.append(argv[0]), (0, ""))[1])
    assert cpap_harvest._wpa_up("wlan9", "ez Share", "pw", "192.168.4.2/24", 5.0) is True
    assert "wpa_cli" not in calls, f"wpa_cli must not be consulted when /sys answered: {calls}"
    assert "ip" in calls, "the address must still be assigned"


def test_wpa_cli_is_still_the_fallback_when_sysfs_cannot_tell(monkeypatch):
    """Kept, not deleted: a driver that exposes no carrier still has a way to confirm."""
    monkeypatch.setattr(cpap_harvest, "associated", lambda iface, sysfs="/sys/class/net": None)
    calls = []

    def sh(argv, t, sudo=False):
        calls.append(argv[0])
        return (0, "wpa_state=COMPLETED\n") if argv[0] == "wpa_cli" else (0, "")
    monkeypatch.setattr(cpap_harvest, "_sh", sh)
    assert cpap_harvest._wpa_up("wlan9", "ez Share", "pw", "192.168.4.2/24", 5.0) is True
    assert "wpa_cli" in calls, "the fallback must still be reachable"


def test_an_inherited_supplicant_can_still_associate(monkeypatch):
    """`wpa_supplicant -B` exits non-zero when one is already running on the interface, and one often
    is: the teardown's `wpa_cli terminate` is the only thing that reaps it and that is exactly the call
    that cannot run under the sandbox. A non-zero start must not abort an association that works."""
    monkeypatch.setattr(cpap_harvest, "associated", lambda iface, sysfs="/sys/class/net": True)
    monkeypatch.setattr(cpap_harvest, "_sh",
                        lambda argv, t, sudo=False: (1, "nl80211: deinit ifname=wlan9")
                        if argv[0] == "wpa_supplicant" else (0, ""))
    assert cpap_harvest._wpa_up("wlan9", "ez Share", "pw", "192.168.4.2/24", 5.0) is True


def test_no_carrier_but_a_live_operstate_is_UNKNOWN_not_a_no(tmp_path):
    """`operstate` only settles the question when it says "down". A driver reporting `dormant` or
    `unknown` with no carrier file has told us nothing, so the answer is None and wpa_cli gets its
    turn — reading "not down" as "associated" would fabricate a success."""
    assert cpap_harvest.associated("wlan9", _sysfs(tmp_path, carrier=None, operstate="dormant")) is None
