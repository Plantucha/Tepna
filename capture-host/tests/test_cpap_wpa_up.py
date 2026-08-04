# tepna-capture — tests/test_cpap_wpa_up.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `_wpa_up` is the association: write a wpa_supplicant config holding the card's PSK, bring the
# interface up, start the supplicant, wait bounded for COMPLETED, then add an address and NO route.
# CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04 §4 step 3, built on the `recorded_run` double.
#
# Everything it does is `sudo -n`, and it is the only privileged code in the harvest. Nothing asserted
# on the commands it issues, their deadlines, the config it writes, or the mode it writes it with — so
# the PSK's file permissions, the interface name reaching wpa_cli, and every timeout were unobservable.

import os

import pytest

import cpap_harvest as ch


@pytest.fixture
def wpa(monkeypatch, recorded_run, completed, tmp_path):
    """Drives _wpa_up with a writable control dir and no real sleeping."""
    wdir = tmp_path / "run" / "wpa_supplicant"
    wdir.mkdir(parents=True)
    # RECORDS the root rather than swallowing it — a double that accepts an argument and discards it
    # makes the code computing that argument unobservable, which is the defect this whole campaign
    # keeps finding. `_wpa_dir(root)` resolving to the wrong place puts the control socket somewhere
    # wpa_cli will not look, and every association poll then fails on a card that DID associate.
    seen_roots = []

    def _dir(root=None):
        seen_roots.append(root)
        return str(wdir)

    monkeypatch.setattr(ch, "_wpa_dir", _dir)
    monkeypatch.setattr(ch.time, "sleep", lambda s: None)
    monkeypatch.setattr(ch, "associated", lambda iface, **kw: None)   # force the wpa_cli fallback
    # associate by default: wpa_cli reports COMPLETED, so the happy path exits the wait at once
    recorded_run.reply = lambda argv: completed(0, "bssid=00:11\nwpa_state=COMPLETED\n", "")
    recorded_run.completed = completed
    recorded_run.wdir = str(wdir)
    recorded_run.seen_roots = seen_roots
    return recorded_run


def _conf_written(rec):
    """The config path is the `-c` argument of the wpa_supplicant invocation."""
    for c in rec.calls:
        if c.argv and "wpa_supplicant" in c.argv:
            return c.argv[c.argv.index("-c") + 1]
    return None


# ── the PSK on disk ─────────────────────────────────────────────────────────────────────────────────
def test_the_config_holding_the_psk_is_owner_only(wpa, monkeypatch):
    """`os.chmod(conf, 0o600)`, and the comment beside it states why: the PSK is in that file. 0o601 —
    which is what the literal becomes if the octal is read as decimal 385 — leaves it WORLD-EXECUTABLE,
    and any mode that grants a group or other bit puts the card's key in reach of every account on the
    box. The file is short-lived, not secret-free."""
    seen = {}
    real_chmod = os.chmod
    monkeypatch.setattr(ch.os, "chmod", lambda p, m: (seen.__setitem__("mode", m), real_chmod(p, m))[1])

    ch._wpa_up("wlan0", "ez Share", "88888888", "192.168.4.2/24", 1.0)
    assert seen["mode"] == 0o600, "owner read/write only"
    assert seen["mode"] & 0o077 == 0, "no group or other bit may be set on a file holding the PSK"


def test_the_config_carries_the_control_dir_ssid_and_psk(wpa):
    """A config written with a None in any of the three slots associates to nothing — and the failure
    surfaces minutes later as 'did not associate', pointing at the radio rather than at the file."""
    written = {}
    real_write = os.write

    def spy(fd, data):
        written.setdefault("blob", b"")
        written["blob"] += data
        return real_write(fd, data)

    import unittest.mock as _m
    with _m.patch.object(ch.os, "write", spy):
        ch._wpa_up("wlan0", "ez Share", "88888888", "192.168.4.2/24", 1.0)

    blob = written["blob"].decode()
    assert f"ctrl_interface={wpa.wdir}" in blob, "the supplicant must be told where its socket goes"
    assert 'ssid="ez Share"' in blob
    assert 'psk="88888888"' in blob


def test_the_config_file_is_named_so_a_leftover_is_identifiable(wpa):
    """prefix/suffix are how an operator finds one of these if the unlink in `finally` ever loses a
    race — an anonymous /tmp file holding a PSK is worse than a named one."""
    ch._wpa_up("wlan0", "ez Share", "88888888", "192.168.4.2/24", 1.0)
    conf = _conf_written(wpa)
    assert conf is not None
    base = os.path.basename(conf)
    assert base.startswith("tepna-ezshare-") and base.endswith(".conf")


# ── the command sequence, its privileges and its deadlines ──────────────────────────────────────────
def test_the_association_runs_these_commands_as_root_with_these_bounds(wpa):
    """Every bound here is the difference between a harvest that fails and one that hangs. `_sh` never
    raises, so a `None` timeout does not error — it removes the deadline from a command run against a
    Wi-Fi card that may never answer, and the daemon waits forever with the radio held."""
    ch._wpa_up("wlan0", "ez Share", "88888888", "192.168.4.2/24", 1.0)

    by = {}
    for c in wpa.calls:
        key = next((p for p in ("ip", "wpa_supplicant", "wpa_cli") if p in (c.argv or [])), None)
        by.setdefault(key, []).append(c)

    link_up = next(c for c in by["ip"] if "link" in c.argv)
    assert link_up.argv == ["sudo", "-n", "ip", "link", "set", "wlan0", "up"]
    assert link_up.kw["timeout"] == 10

    sup = by["wpa_supplicant"][0]
    assert sup.argv[:6] == ["sudo", "-n", "wpa_supplicant", "-B", "-i", "wlan0"]
    assert sup.kw["timeout"] == 20, "the supplicant gets the longest bound — it does the scanning"

    status = by["wpa_cli"][0]
    assert status.sudo is True, "the control socket is root-owned; an unprivileged poll always fails"
    assert "wlan0" in status.argv, "the interface must reach wpa_cli, or it polls the wrong radio"
    assert status.kw["timeout"] == 8


def test_the_address_is_added_with_no_route_ever(wpa):
    """`ip addr add ... dev <iface>` and nothing else. Adding a route would send the box's traffic at a
    Wi-Fi card with no uplink — the harvest joins an isolated AP and must not become the default path."""
    assert ch._wpa_up("wlan0", "ez Share", "88888888", "192.168.4.2/24", 1.0) is True
    addr = next(c for c in wpa.calls if c.argv and "addr" in c.argv and "add" in c.argv)
    assert addr.argv == ["sudo", "-n", "ip", "addr", "add", "192.168.4.2/24", "dev", "wlan0"]
    assert addr.kw["timeout"] == 10
    assert not any("route" in (c.argv or []) for c in wpa.calls), "no route, ever"


# ── the bounded wait ────────────────────────────────────────────────────────────────────────────────
def test_association_is_detected_through_the_wpa_cli_fallback(wpa):
    """`associated()` reads /sys and needs no privilege, but returns None when the interface is absent
    from sysfs — then the wpa_cli poll is the only signal, and it must require BOTH rc==0 and the
    COMPLETED state. Either alone is a false positive: wpa_cli exits 0 while merely SCANNING."""
    assert ch._wpa_up("wlan0", "s", "p", "10.0.0.2/24", 1.0) is True


def test_a_supplicant_that_never_associates_tears_down_and_reports_false(wpa, monkeypatch):
    """The teardown on the failure path is not tidiness: a root wpa_supplicant left holding the radio
    blocks the next attempt AND the box's own Wi-Fi. `_wpa_down` must be called with the same root, or
    it looks for the control socket in the wrong place and reaps nothing."""
    # a synthetic clock: `time.sleep` is already a no-op, but without advancing `monotonic` the
    # bounded wait burns the whole real 5 s floor. That is 5 s on every suite run, and mutation runs
    # pay it per mutant — three `wifi_up` mutants went from KILLED to TIMEOUT on the budget it cost.
    t = {"now": 0.0}
    monkeypatch.setattr(ch.time, "monotonic", lambda: t["now"])

    def _scanning(argv):
        t["now"] += 1.0
        return wpa.completed(0, "wpa_state=SCANNING\n", "")

    wpa.reply = _scanning
    downs = []
    monkeypatch.setattr(ch, "_wpa_down", lambda iface, root=None: downs.append((iface, root)) or True)

    assert ch._wpa_up("wlan0", "s", "p", "10.0.0.2/24", 0.0, root="/custom") is False
    assert downs == [("wlan0", "/custom")], "the teardown needs the root it was given"
    assert wpa.seen_roots and all(r == "/custom" for r in wpa.seen_roots), \
        "_wpa_dir must be resolved against the caller's root, not against None"


def test_the_wait_is_bounded_below_by_five_seconds(wpa, monkeypatch):
    """`max(5.0, timeout)`. A caller passing 0 must still get a real chance to associate — a scan takes
    seconds — but the floor must not be raised either, because this runs before every harvest."""
    t = {"now": 0.0}
    monkeypatch.setattr(ch.time, "monotonic", lambda: t["now"])
    polls = []

    def reply(argv):
        if argv and any("wpa_cli" in a for a in argv):       # only the association polls advance time
            polls.append(t["now"])
            t["now"] += 1.0
        return wpa.completed(0, "wpa_state=SCANNING\n", "")

    wpa.reply = reply
    monkeypatch.setattr(ch, "_wpa_down", lambda *a, **k: True)
    ch._wpa_up("wlan0", "s", "p", "10.0.0.2/24", 0.0)
    # deadline = 0 + max(5.0, 0.0) = 5.0, polled once per simulated second, loop EXCLUSIVE of the
    # deadline -> exactly 5 polls at t=0..4. Raising the floor to 6.0 gives 6; making the bound
    # inclusive (`<=`) also gives 6. Counting is what separates them from the correct behaviour.
    assert polls == [0.0, 1.0, 2.0, 3.0, 4.0], \
        "a 5.0s floor and an EXCLUSIVE deadline — either change adds a sixth poll"
