"""IO-path tests for cpap_harvest — the HTTP client, the nmcli shell-outs, and the harvest walk.

Everything here is mocked: no card, no NetworkManager, no network. These paths carry the failures that
actually hurt — a truncated download accepted as valid, a `.part` stub left behind, an association that
outlives its transfer, and the default route wandering onto a card that routes nowhere.
"""
import io
import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cpap_harvest as ch  # noqa: E402


# ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
class _Resp(io.BytesIO):
    """A fake HTTP response. It carries `headers` because the real client now reads Content-Length —
    the ez Share listing is ceil-rounded, so the declared length is the only exact size available and
    the completeness test prefers it. A double that omits what the caller reads tests the double."""

    def __init__(self, data, declared=None):
        super().__init__(data)
        # `declared=None` means "the server told us the truth" — the common case. Pass an explicit
        # value to model a server that declares something other than what it sends.
        self.headers = {"Content-Length": str(len(data) if declared is None else declared)}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _urlopen(mapping, calls=None, declared=None):
    """Fake urlopen driven by a {substring: bytes|Exception} map.

    `declared` overrides the Content-Length the fake server announces. TRUNCATION IS declared > sent —
    a server that promises 2229 KB and delivers 1 KB. Without this the fake can only ever tell the
    truth about its own body, which is not a truncation at all."""
    def open_(url, timeout=None):
        if calls is not None:
            calls.append(url)
        for frag, val in mapping.items():
            if frag in url:
                if isinstance(val, Exception):
                    raise val
                # A tuple value is (body, declared_length) — a server that PROMISES one size and sends
                # another, i.e. a real truncation. Per-URL, so one file can lie while the rest do not.
                if isinstance(val, tuple):
                    return _Resp(val[0], val[1])
                return _Resp(val, declared)
        raise AssertionError(f"unexpected URL {url}")
    return open_


class _Proc:
    def __init__(self, rc=0, out="", err=""):
        self.returncode, self.stdout, self.stderr = rc, out, err


# ── EzShare._get ────────────────────────────────────────────────────────────────────────────────────
def test_get_retries_then_succeeds(monkeypatch):
    """The card drops requests under sustained load — a single failure must not end a 197-night run."""
    state = {"n": 0}

    def flaky(url, timeout=None):
        state["n"] += 1
        if state["n"] < 3:
            raise OSError("connection reset")
        return _Resp(b"ok")

    monkeypatch.setattr(ch.urllib.request, "urlopen", flaky)
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    assert ch.EzShare(retries=5)._get("http://x") == b"ok"
    assert state["n"] == 3


def test_get_gives_up_after_capped_retries(monkeypatch):
    """Bounded, always. An unbounded retry loop is a task that silently never returns."""
    monkeypatch.setattr(ch.urllib.request, "urlopen", _urlopen({"x": OSError("down")}))
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    with pytest.raises(RuntimeError, match="down"):
        ch.EzShare(retries=2)._get("http://x")


def test_retries_floor_is_one(monkeypatch):
    calls = []
    monkeypatch.setattr(ch.urllib.request, "urlopen", _urlopen({"x": OSError("no")}, calls))
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    with pytest.raises(RuntimeError):
        ch.EzShare(retries=0)._get("http://x")
    assert len(calls) == 1                              # 0 -> 1, never zero attempts


def test_listing_decodes_and_filters(monkeypatch):
    html = ('   2026- 7-26    6:42:26         105KB  <a href="download?file=STR.EDF"> STR.EDF</a>\n'
            '   2026- 7-26    6:42:26           1KB  <a href="download?file=EZSHARE.CFG"> ezshare.cfg</a>')
    monkeypatch.setattr(ch.urllib.request, "urlopen", _urlopen({"dir": html.encode()}))
    rows = ch.EzShare().listing()
    assert [r["name"] for r in rows] == ["STR.EDF"]     # ignore list applied


# ── EzShare.fetch ───────────────────────────────────────────────────────────────────────────────────
def test_fetch_writes_via_part_and_renames(tmp_path, monkeypatch):
    """A crash mid-write must not leave a truncated file that skip-if-present would later accept."""
    monkeypatch.setattr(ch.urllib.request, "urlopen", _urlopen({"download": b"A" * 2048}))
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    e = {"name": "STR.EDF", "size": "2KB", "href": "download?file=STR.EDF"}
    path, n = ch.EzShare().fetch(e, str(tmp_path))
    assert os.path.basename(path) == "STR.edf"          # lowercased on the way to disk
    assert n == 2048
    assert not list(tmp_path.glob("*.part"))            # temp cleaned up by the rename


def test_fetch_flags_a_short_read(tmp_path, monkeypatch):
    # The server PROMISES a 2229 KB file and delivers 1 KB — that is what a truncation is.
    monkeypatch.setattr(ch.urllib.request, "urlopen",
                        _urlopen({"download": b"A" * 1024}, declared=2229 * 1024))
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    e = {"name": "BRP.edf", "size": "2229KB", "href": "download?file=B"}
    # `fetch` used to os.replace the truncated body to its FINAL name and merely return short=True —
    # at which point skip-if-present saw a plausible file and never came back for it. It now raises
    # without renaming, so the destination stays absent and the next run re-fetches
    # (CAPTURE-HOST-DEEP-AUDIT §C5).
    with pytest.raises(ch.ShortRead):
        ch.EzShare().fetch(e, str(tmp_path))
    assert not os.path.exists(str(tmp_path / "BRP.edf")), "a truncated body must not take the real name"
    assert os.path.exists(str(tmp_path / "BRP.edf.part")), "and the partial stays for evidence"
    assert ch.should_fetch(e, str(tmp_path / "BRP.edf")), "so the next run fetches it again"


# ── nmcli shell-outs ────────────────────────────────────────────────────────────────────────────────
def test_nmcli_success_and_failure(monkeypatch):
    monkeypatch.setattr(ch.subprocess, "run", lambda *a, **k: _Proc(0))
    assert ch._nmcli(["connection", "up", "p"], 5) is True
    monkeypatch.setattr(ch.subprocess, "run", lambda *a, **k: _Proc(4, err="not an active connection"))
    assert ch._nmcli(["connection", "down", "p"], 5) is False


@pytest.mark.parametrize("exc", [
    FileNotFoundError("nmcli"),
    subprocess.TimeoutExpired(cmd="nmcli", timeout=5),
    RuntimeError("dbus went away"),
])
def test_nmcli_never_raises(monkeypatch, exc):
    """Association is best-effort. It must never be the thing that kills the harvest task."""
    def boom(*a, **k):
        raise exc
    monkeypatch.setattr(ch.subprocess, "run", boom)
    assert ch._nmcli(["connection", "up", "p"], 5) is False


def test_wifi_down_delegates(monkeypatch):
    seen = []
    monkeypatch.setattr(ch, "backend", lambda: "nmcli")
    monkeypatch.setattr(ch, "_nmcli", lambda a, t: seen.append(a) or True)
    assert ch.wifi_down("ezshare") is True
    assert seen[0][:2] == ["connection", "down"]


def test_harden_profile_sets_every_safety_key(monkeypatch):
    monkeypatch.setattr(ch, "backend", lambda: "nmcli")
    """These four keys ARE the ethernet guarantee. Losing ipv4.never-default blackholes the box's
    routing; losing ignore-auto-dns breaks name resolution with routing untouched."""
    seen = []
    monkeypatch.setattr(ch, "_nmcli", lambda a, t: seen.append(a) or True)
    assert ch.harden_profile("ezshare") is True
    flat = " ".join(seen[0])
    for k, v in (("ipv4.never-default", "yes"), ("ipv4.ignore-auto-dns", "yes"),
                 ("ipv6.method", "disabled"), ("connection.autoconnect", "no")):
        assert f"{k} {v}" in flat


# ── default route guard ─────────────────────────────────────────────────────────────────────────────
def test_default_route_dev_parses(monkeypatch):
    monkeypatch.setattr(ch.subprocess, "run", lambda *a, **k: _Proc(
        0, "default via 192.168.0.1 dev enp9s0 proto dhcp src 192.168.0.57 metric 100\n"))
    assert ch.default_route_dev() == "enp9s0"


def test_default_route_dev_none_when_absent_or_broken(monkeypatch):
    monkeypatch.setattr(ch.subprocess, "run", lambda *a, **k: _Proc(0, ""))
    assert ch.default_route_dev() is None

    def boom(*a, **k):
        raise OSError("no ip(8)")
    monkeypatch.setattr(ch.subprocess, "run", boom)
    assert ch.default_route_dev() is None               # a probe failure is never fatal


def test_wifi_up_succeeds_when_route_unchanged(monkeypatch):
    monkeypatch.setattr(ch, "backend", lambda: "nmcli")
    monkeypatch.setattr(ch, "harden_profile", lambda p: True)
    monkeypatch.setattr(ch, "_nmcli", lambda a, t: True)
    monkeypatch.setattr(ch, "default_route_dev", lambda: "enp9s0")
    assert ch.wifi_up("ezshare", guard_dev="enp9s0") is True


def test_wifi_up_tears_down_if_the_card_steals_the_default_route(monkeypatch):
    """THE ethernet guarantee. If the card takes the default route it is torn down immediately and the
    day is skipped — a routeless default blackholes SSH, the served monitor and the NAS pull."""
    downs = []
    monkeypatch.setattr(ch, "backend", lambda: "nmcli")
    monkeypatch.setattr(ch, "harden_profile", lambda p: True)
    monkeypatch.setattr(ch, "_nmcli", lambda a, t: True)
    monkeypatch.setattr(ch, "default_route_dev", lambda: "wlp10s0")     # moved onto the card
    monkeypatch.setattr(ch, "wifi_down", lambda p, timeout=30.0, iface=None: downs.append(p) or True)
    assert ch.wifi_up("ezshare", guard_dev="enp9s0") is False
    assert downs == ["ezshare"]                          # and it did not leave it associated


def test_wifi_up_also_fails_if_the_route_vanishes(monkeypatch):
    downs = []
    monkeypatch.setattr(ch, "backend", lambda: "nmcli")
    monkeypatch.setattr(ch, "harden_profile", lambda p: True)
    monkeypatch.setattr(ch, "_nmcli", lambda a, t: True)
    monkeypatch.setattr(ch, "default_route_dev", lambda: None)
    monkeypatch.setattr(ch, "wifi_down", lambda p, timeout=30.0, iface=None: downs.append(p) or True)
    assert ch.wifi_up("ezshare", guard_dev="enp9s0") is False
    assert downs == ["ezshare"]


def test_wifi_up_without_a_guard_skips_the_check(monkeypatch):
    monkeypatch.setattr(ch, "backend", lambda: "nmcli")
    monkeypatch.setattr(ch, "harden_profile", lambda p: True)
    monkeypatch.setattr(ch, "_nmcli", lambda a, t: True)
    monkeypatch.setattr(ch, "default_route_dev", lambda: (_ for _ in ()).throw(AssertionError("probed")))
    assert ch.wifi_up("ezshare", guard_dev=None) is True


def test_wifi_up_false_when_the_profile_will_not_come_up(monkeypatch):
    monkeypatch.setattr(ch, "backend", lambda: "nmcli")
    monkeypatch.setattr(ch, "harden_profile", lambda p: True)
    monkeypatch.setattr(ch, "_nmcli", lambda a, t: False)
    assert ch.wifi_up("ezshare", guard_dev="enp9s0") is False


# ── harvest walk ────────────────────────────────────────────────────────────────────────────────────
ROOT = ('   2026- 7-26    6:42:26         105KB  <a href="download?file=STR.EDF"> STR.EDF</a>\n'
        '   2026- 7-26   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CSETTINGS"> SETTINGS</a>\n'
        '   2026- 7-26   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CDATALOG"> DATALOG</a>\n')
SETTINGS = '   2026- 7-26    6:42:26           1KB  <a href="download?file=CS.JSON"> CurrentSettings.json</a>\n'
DATALOG = ('   2026- 7-26   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CD%5C20260725"> 20260725</a>\n'
           '   2026- 7-26   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CD%5C20260724"> 20260724</a>\n'
           '   2026- 7-26   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CD%5CSYS"> NOTANIGHT</a>\n')
NIGHT = '   2026- 7-26   10:10:58        2229KB  <a href="download?file=BRP.EDF"> 20260725_BRP.edf</a>\n'


def _card(monkeypatch, night_body=NIGHT, brp=b"B" * (2229 * 1024), brp_declared=None):
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    monkeypatch.setattr(ch.urllib.request, "urlopen", _urlopen({
        "dir?dir=A:%5CSETTINGS": SETTINGS.encode(),
        "dir?dir=A:%5CDATALOG": DATALOG.encode(),
        "20260725": night_body.encode(),
        "20260724": night_body.encode(),
        "dir?dir=A:": ROOT.encode(),
        "download?file=STR.EDF": b"S" * (105 * 1024),
        "download?file=CS.JSON": b"C" * 1024,
        "download?file=BRP.EDF": brp if brp_declared is None else (brp, brp_declared),
    }))


def test_harvest_mirrors_the_native_layout(tmp_path, monkeypatch):
    _card(monkeypatch)
    st = ch.harvest(str(tmp_path), nights={"20260725"})
    assert (tmp_path / "STR.edf").exists()                          # lowercased
    assert (tmp_path / "SETTINGS" / "CurrentSettings.json").exists()
    assert (tmp_path / "DATALOG" / "20260725" / "20260725_BRP.edf").exists()
    assert not (tmp_path / "DATALOG" / "20260724").exists()          # night filter honoured
    assert not (tmp_path / "DATALOG" / "NOTANIGHT").exists()         # non-YYYYMMDD dir ignored
    assert st["nights"] == 1 and st["nights_on_card"] == 2
    assert st["files"] == 3 and not st["short"] and not st["errors"]


def test_harvest_skips_what_is_already_on_disk(tmp_path, monkeypatch):
    _card(monkeypatch)
    ch.harvest(str(tmp_path), nights={"20260725"})
    st = ch.harvest(str(tmp_path), nights={"20260725"})               # steady state
    assert st["files"] == 0 and st["skipped"] == 3


def test_harvest_records_short_reads_without_aborting(tmp_path, monkeypatch):
    # The card PROMISES 2229 KB and delivers 1 KB — the shape of a real truncation. (Declaring the
    # short length instead would be a server telling the truth about a small file, which is not one.)
    _card(monkeypatch, brp=b"B" * 1024, brp_declared=2229 * 1024)
    st = ch.harvest(str(tmp_path), nights={"20260725"})
    assert len(st["short"]) == 1 and "BRP" in st["short"][0]
    # 2, not 3: a truncated body is no longer COUNTED as a fetched file, because it is no longer
    # written under its real name (CAPTURE-HOST-DEEP-AUDIT §C5). The others still landed.
    assert st["files"] == 2
    assert st["errors"] == [], "a short read is its own diagnostic, not a transport error"


def test_harvest_one_bad_file_does_not_end_the_run(tmp_path, monkeypatch):
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    monkeypatch.setattr(ch.urllib.request, "urlopen", _urlopen({
        "dir?dir=A:%5CSETTINGS": SETTINGS.encode(),
        "dir?dir=A:%5CDATALOG": DATALOG.encode(),
        "20260725": NIGHT.encode(),
        "dir?dir=A:": ROOT.encode(),
        "download?file=STR.EDF": OSError("card hiccup"),
        "download?file=CS.JSON": b"C" * 1024,
        "download?file=BRP.EDF": b"B" * (2229 * 1024),
    }))
    st = ch.harvest(str(tmp_path), nights={"20260725"}, retries=1)
    assert len(st["errors"]) == 1 and "STR.EDF" in st["errors"][0]
    assert (tmp_path / "DATALOG" / "20260725" / "20260725_BRP.edf").exists()


def test_harvest_stops_cleanly_at_the_deadline(tmp_path, monkeypatch):
    """A truncated run is fine — tomorrow's skip-if-present resumes it. A run that never returns is not."""
    _card(monkeypatch)
    monkeypatch.setattr(ch.time, "monotonic", lambda: 1e9)           # already past any deadline
    st = ch.harvest(str(tmp_path), deadline=0.0)
    assert st["partial"] is True and st["files"] == 0


def test_harvest_pulls_every_night_when_none_specified(tmp_path, monkeypatch):
    _card(monkeypatch)
    st = ch.harvest(str(tmp_path))
    assert st["nights"] == 2


def test_should_fetch_keeps_a_present_file_of_unknown_size(tmp_path):
    """The listing occasionally reports no size. Re-downloading a file we already hold on that basis
    would make every run a full 492 MB backfill, so an unknown size means keep what is on disk."""
    p = tmp_path / "x.edf"
    p.write_bytes(b"abc")
    assert ch.should_fetch({"name": "x.edf", "size": ""}, str(p)) is False


def test_harvest_stops_between_nights_when_the_deadline_lands_mid_walk(tmp_path, monkeypatch):
    """The deadline is checked per night as well as per file, so a long backfill gives up cleanly at a
    night boundary instead of running past its cap."""
    _card(monkeypatch)
    calls = {"n": 0}

    def clock():                                        # trip only after the walk reaches the nights
        calls["n"] += 1
        return 0.0 if calls["n"] <= 8 else 1e9

    monkeypatch.setattr(ch.time, "monotonic", clock)
    st = ch.harvest(str(tmp_path), deadline=1.0)
    assert st["partial"] is True
    assert st["nights"] < 2                             # gave up at a night boundary, not mid-file


# ── wpa_supplicant backend (server boxes have no NetworkManager) ────────────────────────────────────
def _sh_spy(monkeypatch, results=None):
    """Record every shelled command; `results` maps a substring -> (rc, out)."""
    calls = []

    def fake(argv, timeout, sudo=False):
        calls.append((" ".join(argv), sudo))
        for frag, rv in (results or {}).items():
            if frag in " ".join(argv):
                return rv
        return (0, "")
    monkeypatch.setattr(ch, "_sh", fake)
    return calls


def test_backend_is_probed_not_assumed(monkeypatch):
    """The first cut assumed nmcli and would have failed nightly on the appliance, which runs
    netplan/systemd-networkd with no NetworkManager at all."""
    monkeypatch.setattr(ch.shutil if hasattr(ch, "shutil") else ch, "__name__", ch.__name__)
    import shutil
    monkeypatch.setattr(shutil, "which", lambda c: "/usr/bin/nmcli" if c == "nmcli" else None)
    assert ch.backend() == "nmcli"
    monkeypatch.setattr(shutil, "which", lambda c: None)
    assert ch.backend() == "wpa"


def _assoc(monkeypatch, answer):
    """Pin the /sys association verdict for a `_wpa_up` test.

    `_wpa_up` consults `associated()` FIRST and falls back to `wpa_cli` ONLY when that answers None —
    deliberately, so a definite verdict is never overridden. A test that leaves this to the host is
    therefore asking the machine it runs on which branch it covers, and the two machines disagree:

        CI / dev box   no wlp1s0 at all      -> associated() None  -> the wpa_cli FALLBACK runs
        the vigil box  wlp1s0 exists, down   -> associated() False -> no fallback, _wpa_up returns False

    So `..._installs_an_address_but_NEVER_a_route` and `..._psk_conf_cannot_be_unlinked` asserted True
    and passed for years on CI while covering the fallback, then failed the first time they ran on the
    box this code ships to (2026-07-29, 2 failed / 1644 passed). The /sys primary was never covered
    there at all. Pin it, and each test asserts its own subject on the branch it names."""
    monkeypatch.setattr(ch, "associated", lambda *_a, **_k: answer)


def test_wpa_up_installs_an_address_but_NEVER_a_route(monkeypatch):
    """THE guarantee, structurally: the card routes nowhere, so the wpa path assigns a static on-link
    address and runs no DHCP client. There is no route to suppress and nothing to talk us into one."""
    calls = _sh_spy(monkeypatch, {"wpa_cli": (0, "wpa_state=COMPLETED\n")})
    _assoc(monkeypatch, True)
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    assert ch._wpa_up("wlp1s0", "ez Share", "88888888", "192.168.4.2/24", 10) is True
    flat = [c for c, _ in calls]
    assert any("ip addr add 192.168.4.2/24 dev wlp1s0" in c for c in flat)
    assert not any("ip route" in c for c in flat), flat
    assert not any("dhclient" in c or "dhcpcd" in c for c in flat), flat
    assert all(sudo for c, sudo in calls if c.startswith(("ip ", "wpa_")))


def test_wpa_up_gives_up_and_tears_down_if_it_never_associates(monkeypatch):
    """Bounded: a card that is powered off must cost one timeout, not a hung task."""
    _sh_spy(monkeypatch, {"wpa_cli": (0, "wpa_state=SCANNING\n")})
    _assoc(monkeypatch, None)          # /sys cannot tell; the fallback says SCANNING
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    t = iter([0.0, 0.0, 99.0, 99.0, 99.0, 99.0])
    monkeypatch.setattr(ch.time, "monotonic", lambda: next(t, 99.0))
    downs = []
    monkeypatch.setattr(ch, "_wpa_down", lambda i, root=None: downs.append(i) or True)
    assert ch._wpa_up("wlp1s0", "s", "p", "192.168.4.2/24", 5) is False
    assert downs == ["wlp1s0"]


def test_wpa_up_false_when_the_supplicant_will_not_start(monkeypatch):
    _sh_spy(monkeypatch, {"wpa_supplicant": (127, "not installed")})
    assert ch._wpa_up("wlp1s0", "s", "p", "192.168.4.2/24", 5) is False


def test_our_supplicant_never_shares_the_system_daemons_control_directory():
    """/run/wpa_supplicant belongs to the packaged wpa_supplicant.service, which is ACTIVE on the vigil
    box (systemd-networkd, no NetworkManager — the branch backend() selects). Sharing it made our
    `wpa_supplicant -B` exit 255 the instant it tried to own a socket there: "Successfully initialized
    wpa_supplicant", then gone. Observed on real hardware 2026-07-27; the harvest could never bring the
    card up on a stock box and blamed the PROFILE for it."""
    # The INTENT is unchanged — never share the packaged supplicant's socket directory — but the
    # ctrl_interface is now a PARAMETER rather than a baked-in constant: the directory is probed per
    # call, because a path chosen at import time turned out to be one the daemon could not write under
    # ProtectSystem=strict. So assert on the template's shape and on a RENDERED config.
    assert ch._wpa_dir() != "/run/wpa_supplicant"
    assert "ctrl_interface={ctrl}" in ch._WPA_CONF, "the control dir must be injectable, not fixed"
    rendered = ch._WPA_CONF.format(ctrl=ch._wpa_dir(), ssid="s", psk="p")
    assert f"ctrl_interface={ch._wpa_dir()}" in rendered
    assert "/run/wpa_supplicant" not in rendered


def test_every_wpa_cli_call_is_pinned_to_our_own_control_directory(monkeypatch):
    """A bare `wpa_cli -i <iface>` resolves through /run/wpa_supplicant — the SYSTEM daemon's sockets.
    The status poll therefore interrogated the wrong supplicant, and `_wpa_down`'s `terminate` would
    have KILLED the box's own wpa_supplicant. Harmless on this box only because its uplink is wired;
    on a Wi-Fi box the CPAP teardown would have taken the network down with it."""
    calls = _sh_spy(monkeypatch, {"wpa_cli": (0, "wpa_state=COMPLETED\n")})
    _assoc(monkeypatch, None)          # this test is ABOUT the wpa_cli calls, so drive the fallback
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    ch._wpa_up("wlp1s0", "ez Share", "88888888", "192.168.4.2/24", 10)
    ch._wpa_down("wlp1s0")
    cli = [c for c, _ in calls if c.startswith("wpa_cli")]
    assert cli, "expected wpa_cli calls"
    for c in cli:
        assert "-p " in c, f"unpinned wpa_cli would hit the system daemon: {c}"
    # the destructive one specifically
    assert any("terminate" in c and "-p " in c for c in cli)


def test_a_supplicant_that_will_not_start_tears_down_and_says_why(monkeypatch, caplog):
    """The surfaced reason used to name the profile — the one thing that was never wrong. Same
    mis-aimed-reason defect CAPTURE-HOST-DEEP-AUDIT §E5 fixed once, arriving by another route."""
    import logging
    _sh_spy(monkeypatch, {"wpa_supplicant": (255, "Successfully initialized wpa_supplicant")})
    downs = []
    monkeypatch.setattr(ch, "_wpa_down", lambda i, root=None: downs.append(i) or True)
    with caplog.at_level(logging.WARNING):
        assert ch._wpa_up("wlp1s0", "s", "p", "192.168.4.2/24", 5) is False
    assert downs == ["wlp1s0"], "a supplicant that half-started must still be torn down"
    msg = " ".join(r.getMessage() for r in caplog.records)
    assert "rc=255" in msg and "wlp1s0" in msg


def test_wpa_down_flushes_before_killing_the_supplicant(monkeypatch):
    """Address first, so nothing can route over a half-torn link."""
    calls = _sh_spy(monkeypatch)
    assert ch._wpa_down("wlp1s0") is True
    flat = [c for c, _ in calls]
    assert flat[0].startswith("ip addr flush")
    assert any("terminate" in c for c in flat) and any("link set wlp1s0 down" in c for c in flat)


def test_harden_profile_is_a_noop_on_the_wpa_backend(monkeypatch):
    """Nothing to harden: no route is installed and no DHCP client runs."""
    monkeypatch.setattr(ch, "backend", lambda: "wpa")
    monkeypatch.setattr(ch, "_nmcli", lambda a, t: pytest.fail("must not touch nmcli on the wpa backend"))
    assert ch.harden_profile("ezshare") is True


def test_wifi_up_and_down_route_to_the_wpa_backend(monkeypatch, tmp_path):
    monkeypatch.setattr(ch, "backend", lambda: "wpa")
    monkeypatch.setattr(ch, "default_route_dev", lambda: "eno1")
    # A stand-in /sys/class/net. `wifi_up` now refuses an interface the box does not have
    # (CAPTURE-HOST-DEEP-AUDIT §E5), so the fixture has to say the interface exists.
    (tmp_path / "wlp1s0").mkdir()
    monkeypatch.setattr(ch, "SYS_NET", str(tmp_path))
    seen = {}
    monkeypatch.setattr(ch, "_wpa_up", lambda i, s, p, a, t, root=None: (seen.update(up=i), True)[1])
    monkeypatch.setattr(ch, "_wpa_down", lambda i, root=None: (seen.update(down=i), True)[1])
    assert ch.wifi_up("ezshare", guard_dev="eno1", iface="wlp1s0") is True
    assert ch.wifi_down("ezshare", iface="wlp1s0") is True
    assert seen == {"up": "wlp1s0", "down": "wlp1s0"}


def test_wifi_up_refuses_an_interface_the_box_does_not_have(monkeypatch, tmp_path, caplog):
    """§E5. `WPA_IFACE` was a module constant with no config key, and `backend()` returns `wpa`
    whenever nmcli is absent — which this module's own comment says is precisely the vigil box. On that
    branch `profile` is DEAD, yet the failure surfaced as "Wi-Fi profile 'ezshare' would not come up
    safely", naming the one setting that branch never reads:

        nmcli on PATH? None -> backend() = wpa ; WPA_IFACE = wlp1s0 ; host has wlp10s0
        LOG WARNING: cpap: sudo -n ip link -> rc=1 Cannot find device "wlp1s0"
    """
    monkeypatch.setattr(ch, "backend", lambda: "wpa")
    monkeypatch.setattr(ch, "SYS_NET", str(tmp_path))          # no interfaces at all
    called = []
    monkeypatch.setattr(ch, "_wpa_up", lambda *a: called.append(a) or True)
    with caplog.at_level("ERROR"):
        assert ch.wifi_up("ezshare", iface="wlp1s0") is False
    assert not called, "it must not shell out to `ip link` for an interface that does not exist"
    msg = " ".join(r.getMessage() for r in caplog.records)
    assert "wlp1s0" in msg, "the reason must name the interface it could not find"
    assert "wifi_iface" in msg, "and the setting that actually fixes it"
    # It may MENTION wifi_profile — to say it is not consulted, which is the useful thing to tell an
    # operator whose config documents it as the only Wi-Fi knob. What it must not do is blame it.
    assert "would not come up safely" not in msg


def test_the_default_wifi_interface_is_discovered_not_a_literal(monkeypatch, tmp_path):
    (tmp_path / "lo").mkdir()
    (tmp_path / "eno1").mkdir()
    (tmp_path / "wlp10s0").mkdir()
    monkeypatch.setattr(ch, "SYS_NET", str(tmp_path))
    assert ch.default_wifi_iface() == "wlp10s0"
    monkeypatch.setattr(ch, "SYS_NET", str(tmp_path / "nope"))
    assert ch.default_wifi_iface() == ch.WPA_IFACE, "falls back rather than raising"


def test_sh_never_raises(monkeypatch):
    for exc, rc in ((FileNotFoundError("x"), 127),
                    (subprocess.TimeoutExpired(cmd="x", timeout=1), 124),
                    (RuntimeError("boom"), 1)):
        def boom(*a, **k):
            raise exc
        monkeypatch.setattr(ch.subprocess, "run", boom)
        assert ch._sh(["x"], 5)[0] == rc


def test_wpa_up_still_returns_when_the_psk_conf_cannot_be_unlinked(monkeypatch):
    """Cleanup of the temp conf is best-effort — a read-only /tmp must not mask a successful
    association, and must not raise into the harvest task."""
    _sh_spy(monkeypatch, {"wpa_cli": (0, "wpa_state=COMPLETED\n")})
    _assoc(monkeypatch, True)
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    monkeypatch.setattr(ch.os, "unlink", lambda *_a, **_k: (_ for _ in ()).throw(OSError("EROFS")))
    assert ch._wpa_up("wlp1s0", "s", "p", "192.168.4.2/24", 10) is True


def test_wifi_up_false_when_the_wpa_backend_cannot_associate(tmp_path, monkeypatch):
    """⚠️ SYS_NET is redirected on purpose. The wpa path first checks that the interface EXISTS under
    /sys/class/net, so against the real one this test took whichever branch the host happened to
    provide — reaching `_wpa_up` on a dev box with a wlan device and returning at the
    interface-missing guard in CI. It passed either way while covering different code, which is how an
    environment dependency hides inside a green suite."""
    net = tmp_path / "net" / "wlan0"
    net.mkdir(parents=True)
    monkeypatch.setattr(ch, "SYS_NET", str(tmp_path / "net"))
    monkeypatch.setattr(ch, "backend", lambda: "wpa")
    monkeypatch.setattr(ch, "_wpa_up", lambda *a: False)
    assert ch.wifi_up("ezshare", guard_dev="eno1", iface="wlan0") is False


def test_wifi_up_refuses_an_interface_this_box_does_not_have(tmp_path, monkeypatch):
    """The other arm, now that the one above cannot drift into it: a `wifi_iface` naming a device that
    is not present must fail with the message that names the setting, not attempt to associate."""
    monkeypatch.setattr(ch, "SYS_NET", str(tmp_path / "net"))          # empty — no interfaces at all
    monkeypatch.setattr(ch, "backend", lambda: "wpa")
    monkeypatch.setattr(ch, "_wpa_up", lambda *a: pytest.fail("must not associate on a missing iface"))
    assert ch.wifi_up("ezshare", guard_dev="eno1", iface="wlan0") is False


def test_wpa_up_prefers_sys_and_never_asks_wpa_cli_when_it_answers(monkeypatch):
    """PRECEDENCE, asserted rather than inherited from the host. `associated()` is the primary because
    wpa_cli needs a client socket under /tmp and the unit runs ProtectSystem=strict — the read-only-/tmp
    failure that made the harvest report "did not associate within 45s" for a radio that associated in
    four seconds. If a definite /sys verdict still cost a wpa_cli poll, that failure would come straight
    back, so a definite verdict must SHORT-CIRCUIT it."""
    calls = _sh_spy(monkeypatch, {"wpa_cli": (0, "wpa_state=COMPLETED\n")})
    _assoc(monkeypatch, True)
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    assert ch._wpa_up("wlp1s0", "s", "p", "192.168.4.2/24", 10) is True
    assert not any(c.startswith("wpa_cli") and "status" in c for c, _ in calls), \
        "a definite /sys verdict must not cost a wpa_cli status poll"


def test_a_definite_not_associated_is_never_overridden_by_wpa_cli(monkeypatch):
    """THE INVARIANT THE BOX EXPOSED. /sys says carrier=0 (up, not associated) while a stubbed wpa_cli
    says COMPLETED. The fallback exists for "this driver will not tell me" (None), NOT to argue with a
    definite answer — consulting it here would reinstate exactly the guess `cb63b31` removed.

    This is also the real 2026-07-29 shape: on the vigil box wlp1s0 exists and is down, so `associated`
    returned False and `_wpa_up` correctly returned False — while two tests that never pinned it
    asserted True and failed. The production code was right; the tests were reading the host."""
    _sh_spy(monkeypatch, {"wpa_cli": (0, "wpa_state=COMPLETED\n")})
    _assoc(monkeypatch, False)
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    t = iter([0.0, 0.0, 99.0, 99.0, 99.0, 99.0])
    monkeypatch.setattr(ch.time, "monotonic", lambda: next(t, 99.0))
    monkeypatch.setattr(ch, "_wpa_down", lambda i, root=None: True)
    assert ch._wpa_up("wlp1s0", "s", "p", "192.168.4.2/24", 5) is False


def test_wpa_up_falls_back_to_wpa_cli_only_when_sys_cannot_tell(monkeypatch):
    """The other arm: a driver that exposes no carrier at all yields None, and THEN wpa_cli decides.
    Without this the fallback would be covered only by accident — by CI happening to lack the
    interface — which is how it came to be covered at all before today."""
    calls = _sh_spy(monkeypatch, {"wpa_cli": (0, "wpa_state=COMPLETED\n")})
    _assoc(monkeypatch, None)
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    assert ch._wpa_up("wlp1s0", "s", "p", "192.168.4.2/24", 10) is True
    assert any(c.startswith("wpa_cli") and "status" in c for c, _ in calls), \
        "with no /sys verdict the fallback is the only thing that can answer"


def test_every_wpa_cli_call_relocates_its_client_socket_too(monkeypatch):
    """`-p` is only HALF of reaching the right supplicant. wpa_cli also creates its OWN client socket,
    under a compiled-in /tmp that is READ-ONLY for this unit (ProtectSystem=strict; /tmp is not in
    ReadWritePaths). So every call failed —

        Failed to connect to non-global ctrl_ifname: wlp1s0  error: Read-only file system

    — with the server sockets sitting right there. `associated()` routes the STATUS read around this by
    reading /sys, but teardown has no /sys equivalent: `terminate` stayed broken and leaked a root
    supplicant per harvest (measured on the box 2026-07-29). `-s` puts the client socket in the same
    probed-writable directory as `-p`, so both ends are somewhere this unit can actually write."""
    calls = _sh_spy(monkeypatch, {"wpa_cli": (0, "wpa_state=COMPLETED\n")})
    _assoc(monkeypatch, None)                       # drive the fallback so a status call happens
    monkeypatch.setattr(ch.time, "sleep", lambda *_: None)
    ch._wpa_up("wlp1s0", "s", "p", "192.168.4.2/24", 10)
    ch._wpa_down("wlp1s0")
    cli = [c for c, _ in calls if c.startswith("wpa_cli")]
    assert cli, "expected wpa_cli calls"
    wdir = ch._wpa_dir()
    for c in cli:
        assert f"-p {wdir}" in c, f"server sockets unpinned — would hit the system daemon: {c}"
        assert f"-s {wdir}" in c, f"client socket left in the read-only /tmp: {c}"


def test_wpa_down_reports_a_terminate_that_failed(monkeypatch, caplog):
    """It used to `return True` unconditionally, so a terminate that never worked reported a clean
    teardown and the harvest reported `ok: true` over a LEAKED root process — `wpa_supplicant -B -i
    wlp1s0` still running, holding an already-deleted conf. Downloads were unaffected (the next run's
    `-B` fails and /sys still sees the association), which is exactly why nobody noticed. A green verdict
    over a failed step is the shape this codebase keeps finding bugs behind, so say it."""
    import logging
    _sh_spy(monkeypatch, {"wpa_cli": (255, "Failed to connect to non-global ctrl_ifname: wlp1s0")})
    with caplog.at_level(logging.WARNING):
        assert ch._wpa_down("wlp1s0") is False
    msg = " ".join(r.getMessage() for r in caplog.records)
    assert "terminate failed" in msg and "wlp1s0" in msg
    assert "left running" in msg, "the operator needs to know a supplicant may have survived"


def test_wpa_down_still_flushes_and_downs_even_when_terminate_fails(monkeypatch):
    """Reporting the failure must not turn into skipping the rest. The address flush is what stops
    anything routing over a half-torn link, so it and the link-down run regardless."""
    calls = _sh_spy(monkeypatch, {"wpa_cli": (255, "nope")})
    assert ch._wpa_down("wlp1s0") is False
    flat = [c for c, _ in calls]
    assert flat[0].startswith("ip addr flush"), "the flush must still come first"
    assert any("link set wlp1s0 down" in c for c in flat), "and the link must still go down"
