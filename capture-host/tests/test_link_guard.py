# tepna-capture — tests/test_link_guard.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The one-line precondition. Small, but it earns its tests: it is the difference between a probe that
# says "stop the daemon" and one that spends a BLE window producing a diagnostic about BlueZ. What is
# pinned is that it FAILS SAFE in both directions — it must not refuse when no daemon is running (that
# would block every probe on a dev machine), and it must not proceed when one is.

import subprocess

import pytest

import link_guard


class _R:
    def __init__(self, out):
        self.stdout = out


def test_an_active_daemon_holds_the_link(monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: _R("active\n"))
    assert link_guard.daemon_holds_link() is True


def test_an_inactive_daemon_does_not(monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: _R("inactive\n"))
    assert link_guard.daemon_holds_link() is False


def test_no_systemd_is_not_a_held_link(monkeypatch):
    """A dev machine has no capture daemon, so nothing holds the radio. Failing CLOSED here would refuse
    every probe everywhere except the box."""
    def boom(*a, **k):
        raise FileNotFoundError("systemctl")
    monkeypatch.setattr(subprocess, "run", boom)
    assert link_guard.daemon_holds_link() is False


def test_require_free_link_exits_and_names_the_fix(monkeypatch, capsys):
    monkeypatch.setattr(link_guard, "daemon_holds_link", lambda unit=link_guard.UNIT: True)
    with pytest.raises(SystemExit) as e:
        link_guard.require_free_link()
    assert e.value.code == 3
    err = capsys.readouterr().err
    assert "tepna-restart.sh stop" in err, "the message must carry the command that fixes it"
    assert "deadman" in err, "and warn that the daemon comes back by itself mid-run"


def test_require_free_link_is_silent_when_the_radio_is_free(monkeypatch, capsys):
    monkeypatch.setattr(link_guard, "daemon_holds_link", lambda unit=link_guard.UNIT: False)
    link_guard.require_free_link()
    assert capsys.readouterr().err == ""


def test_the_unit_name_is_overridable(monkeypatch):
    seen = {}

    def run(cmd, **k):
        seen["cmd"] = cmd
        return _R("inactive")
    monkeypatch.setattr(subprocess, "run", run)
    link_guard.daemon_holds_link("other.service")
    assert seen["cmd"] == ["systemctl", "is-active", "other.service"]
