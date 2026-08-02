# tepna-capture — tests/test_cpap_wifi_commands.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE EXACT COMMANDS THE HARVEST RUNS, and whether they run as root.
#
# The tests next door record `argv[0]` — "was wpa_cli consulted?", "was an ip command issued?" — which
# is the right question for the branch they gate and leaves everything else about the command free to
# move. The mutation audit measured the consequence: `sudo=True` could become `sudo=False` on all three
# teardown commands, `_wpa_dir(root)` could become `_wpa_dir(None)`, and `_wpa_cli(wdir, iface, "…")`
# could drop the interface, all with the suite green.
#
# Those are not cosmetic. This module's own comments record what each one costs on real hardware:
# without sudo the teardown silently leaks a root wpa_supplicant and leaves the card associated; the
# wrong control directory makes `terminate` kill the BOX's supplicant instead of ours; and a `wifi_down`
# that is not told the interface tears down whichever one discovery happens to return.

import cpap_harvest as ch
import pytest


class Recorder:
    """Stands in for `_sh`, keeping the WHOLE call — argv, timeout and the privilege flag."""

    def __init__(self, reply=(0, "")):
        self.calls = []
        self.reply = reply

    def __call__(self, argv, timeout, sudo=False):
        self.calls.append({"argv": list(argv), "timeout": timeout, "sudo": sudo})
        return self.reply(argv) if callable(self.reply) else self.reply

    def argv(self, program):
        return [c["argv"] for c in self.calls if c["argv"][0] == program]


# ── default_route_dev: the box's lifeline probe ─────────────────────────────────────────────────────
def test_the_default_route_is_read_with_exactly_this_command(monkeypatch):
    """`ip route show default` is the whole probe. Asking a different question — or asking it without
    capturing the answer — makes the guard compare None to None and conclude the lifeline is fine."""
    seen = {}

    class P:
        stdout = "default via 192.168.0.1 dev eno1 proto dhcp metric 100\n"

    def fake_run(argv, **kw):
        seen["argv"], seen["kw"] = list(argv), kw
        return P()
    monkeypatch.setattr(ch.subprocess, "run", fake_run)

    assert ch.default_route_dev() == "eno1"
    assert seen["argv"] == ["ip", "route", "show", "default"]
    assert seen["kw"]["capture_output"] is True, "an uncaptured answer is no answer"
    assert seen["kw"]["text"] is True, "the output is parsed as text, not bytes"
    assert seen["kw"]["timeout"] == 10


def test_no_default_route_reads_as_none_not_as_a_crash(monkeypatch):
    class P:
        stdout = ""
    monkeypatch.setattr(ch.subprocess, "run", lambda argv, **kw: P())
    assert ch.default_route_dev() is None


# ── _wpa_down: the teardown, in order and as root ───────────────────────────────────────────────────
def test_the_teardown_runs_three_privileged_commands_in_order(monkeypatch, tmp_path):
    """Order is stated in the source and it matters: drop the address first so nothing can route over a
    half-torn link, then reap the supplicant, then down the interface.

    Every one is `sudo -n`. Dropped privilege here does not fail loudly — `_sh` swallows the non-zero,
    the harvest reports ok, and a root wpa_supplicant is left holding the radio."""
    rec = Recorder()
    monkeypatch.setattr(ch, "_sh", rec)
    wdir = ch._wpa_dir(str(tmp_path))

    assert ch._wpa_down("wlan9", str(tmp_path)) is True
    assert [c["argv"] for c in rec.calls] == [
        ["ip", "addr", "flush", "dev", "wlan9"],
        ["wpa_cli", "-p", wdir, "-s", wdir, "-i", "wlan9", "terminate"],
        ["ip", "link", "set", "wlan9", "down"],
    ]
    assert all(c["sudo"] is True for c in rec.calls), \
        f"every teardown step is sudo -n: {[(c['argv'][0], c['sudo']) for c in rec.calls]}"


def test_the_teardown_talks_to_our_control_directory_not_the_system_one(monkeypatch, tmp_path):
    """`-p`/`-s` are pinned to the probed directory derived from the capture ROOT. Resolving through
    the packaged supplicant's `/run/wpa_supplicant` instead means `terminate` reaps the box's own
    supplicant — on a Wi-Fi-uplinked box, the CPAP teardown takes the network down with it."""
    rec = Recorder()
    monkeypatch.setattr(ch, "_sh", rec)
    ch._wpa_down("wlan9", str(tmp_path))
    cli = rec.argv("wpa_cli")[0]
    assert cli[1:5] == ["-p", ch._wpa_dir(str(tmp_path)), "-s", ch._wpa_dir(str(tmp_path))]
    assert str(tmp_path) in cli[2], "the control dir must come from the capture root that was passed in"
    assert "/run/wpa_supplicant" not in cli[2]


def test_a_failed_terminate_is_reported_not_swallowed(monkeypatch, tmp_path):
    """A green verdict over a failed teardown is the shape this codebase keeps finding bugs behind."""
    monkeypatch.setattr(ch, "_sh", Recorder(
        reply=lambda argv: (255, "Failed to connect") if argv[0] == "wpa_cli" else (0, "")))
    assert ch._wpa_down("wlan9", str(tmp_path)) is False


# ── _wpa_up: the address is assigned, with no route, as root ────────────────────────────────────────
def test_the_static_address_is_assigned_with_no_route(monkeypatch):
    """`ip addr add <addr> dev <iface>` creates only the on-link /24 — enough to reach 192.168.4.1 and
    incapable of becoming a default route. An `ip route` here would be the failure the guard exists for."""
    monkeypatch.setattr(ch, "associated", lambda iface, sysfs="/sys/class/net": True)
    rec = Recorder()
    monkeypatch.setattr(ch, "_sh", rec)

    assert ch._wpa_up("wlan9", "ez Share", "88888888", "192.168.4.2/24", 5.0) is True
    assert ["ip", "addr", "add", "192.168.4.2/24", "dev", "wlan9"] in [c["argv"] for c in rec.calls]
    assert not any(c["argv"][:2] == ["ip", "route"] for c in rec.calls), "the card must route nowhere"
    for c in rec.calls:
        assert c["sudo"] is True, f"{c['argv'][0]} needs sudo -n"


# ── wifi_up: what reaches the backend, and the guard ────────────────────────────────────────────────
def _wpa_backend(monkeypatch, tmp_path, ifaces=("wlan9", "wlp10s0")):
    """Select the wpa backend against a fake /sys/class/net, rather than stubbing os.path.isdir —
    which is global for the duration and answers True to every caller in the process, pytest included."""
    monkeypatch.setattr(ch, "backend", lambda: "wpa")
    net = tmp_path / "net"
    for i in ifaces:
        (net / i).mkdir(parents=True)
    monkeypatch.setattr(ch, "SYS_NET", str(net))


def test_every_association_parameter_reaches_the_backend_in_order(monkeypatch, tmp_path):
    """Seven positional values, and two of them are the SSID and the PSK — transposed, the box spends
    45 s trying to associate to a network named `88888888`."""
    _wpa_backend(monkeypatch, tmp_path)
    seen = {}

    def fake_up(*a):
        seen["args"] = a
        return True
    monkeypatch.setattr(ch, "_wpa_up", fake_up)

    assert ch.wifi_up("ezshare", timeout=33.0, ssid="ez Share", psk="88888888",
                      iface="wlan9", addr="192.168.4.2/24", root="/srv/tepna") is True
    assert seen["args"] == ("wlan9", "ez Share", "88888888", "192.168.4.2/24", 33.0, "/srv/tepna")


def test_an_explicit_interface_wins_and_none_falls_back_to_discovery(monkeypatch, tmp_path):
    """`iface or default_wifi_iface()`. An `and` there inverts it exactly: the explicit setting is
    discarded, and omitting it yields None — which then fails deep inside `ip link`, reported as a
    `wifi_profile` fault (§E5, the mis-aimed reason this default was introduced to fix)."""
    _wpa_backend(monkeypatch, tmp_path)
    monkeypatch.setattr(ch, "default_wifi_iface", lambda: "wlp10s0")
    seen = []
    monkeypatch.setattr(ch, "_wpa_up", lambda *a: (seen.append(a[0]), True)[1])

    ch.wifi_up("ezshare", iface="wlan9")
    ch.wifi_up("ezshare", iface=None)
    assert seen == ["wlan9", "wlp10s0"]


def test_a_moved_default_route_tears_down_the_interface_it_brought_up(monkeypatch, tmp_path):
    """The headline guard: we would rather skip a day of CPAP files than strand the box. The teardown
    must name the SAME interface — dropping it makes wifi_down tear down whatever discovery returns,
    leaving the card associated and still holding the default route."""
    _wpa_backend(monkeypatch, tmp_path)
    monkeypatch.setattr(ch, "default_wifi_iface", lambda: "wlp10s0")
    monkeypatch.setattr(ch, "_wpa_up", lambda *a: True)
    monkeypatch.setattr(ch, "default_route_dev", lambda: "wlan9")     # the card took the route
    seen = {}
    monkeypatch.setattr(ch, "wifi_down", lambda profile, **kw: seen.update(profile=profile, **kw))

    assert ch.wifi_up("ezshare", guard_dev="eno1", iface="wlan9") is False
    assert seen == {"profile": "ezshare", "iface": "wlan9"}


def test_an_unmoved_default_route_is_left_alone(monkeypatch, tmp_path):
    _wpa_backend(monkeypatch, tmp_path)
    monkeypatch.setattr(ch, "_wpa_up", lambda *a: True)
    monkeypatch.setattr(ch, "default_route_dev", lambda: "eno1")
    monkeypatch.setattr(ch, "wifi_down", lambda *a, **k: pytest.fail("must not tear down a good link"))
    assert ch.wifi_up("ezshare", guard_dev="eno1", iface="wlan9") is True


def test_the_nmcli_branch_hardens_the_named_profile_before_raising_it(monkeypatch):
    """`harden_profile` is what pins ipv4.never-default. Applied to the wrong profile — or to None — the
    card is free to become the default gateway, which is the exact loss the guard then has to catch."""
    monkeypatch.setattr(ch, "backend", lambda: "nmcli")
    seen = []
    monkeypatch.setattr(ch, "harden_profile", lambda p: (seen.append(("harden", p)), True)[1])
    monkeypatch.setattr(ch, "_nmcli", lambda argv, t: (seen.append(("nmcli", list(argv), t)), True)[1])

    assert ch.wifi_up("ezshare", timeout=33.0, iface="wlan9") is True
    assert seen == [("harden", "ezshare"), ("nmcli", ["connection", "up", "ezshare"], 33.0)]
