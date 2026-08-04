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


# ── the probe call itself, not just its verdict ─────────────────────────────────────────────────────
# Every surviving mutant in this module was a `subprocess.run` keyword. The existing tests assert what
# `daemon_holds_link` RETURNS by faking a completed process, which passes identically whether the real
# call captures output, decodes it, or bounds itself — so the one subprocess call this module exists
# to make was never observed.
#
# It matters more here than the module's size suggests. `capture_output=False` sends systemctl's answer
# to the probe's own stdout and leaves `r.stdout` as None, so `.strip()` raises, the blanket except
# swallows it, and the guard returns False — reporting the link FREE while the daemon holds it. That is
# the precise failure this file was written to prevent, and it cost five runs in one session.

def test_the_probe_asks_systemd_the_exact_question_and_reads_the_answer(monkeypatch):
    seen = {}

    class P:
        stdout = "active\n"

    def fake_run(argv, **kw):
        seen["argv"], seen["kw"] = list(argv), kw
        return P()

    monkeypatch.setattr(link_guard.subprocess, "run", fake_run)
    assert link_guard.daemon_holds_link() is True

    assert seen["argv"] == ["systemctl", "is-active", "tepna-capture.service"]
    assert seen["kw"]["capture_output"] is True, \
        "uncaptured output leaves r.stdout None -> .strip() raises -> the guard reports the link FREE"
    assert seen["kw"]["text"] is True, "bytes never equal the string 'active', so it would always read free"
    assert seen["kw"]["timeout"] == 10, \
        "an unbounded systemctl on a wedged box hangs the probe before it has done anything"


def test_a_custom_unit_reaches_systemctl_rather_than_the_default(monkeypatch):
    seen = {}

    class P:
        stdout = "inactive\n"

    monkeypatch.setattr(link_guard.subprocess, "run",
                        lambda argv, **kw: (seen.update(argv=list(argv)), P())[1])
    assert link_guard.daemon_holds_link("other.service") is False
    assert seen["argv"][-1] == "other.service", "the caller's unit must be the one asked about"


def test_only_the_exact_word_active_counts_as_holding_the_link(monkeypatch):
    """systemctl answers `activating`, `inactive`, `failed` and more. Anything but `active` means the
    daemon does not hold the link, and a substring test would read `inactive` as active."""

    class P:
        def __init__(self, s):
            self.stdout = s

    for answer, expected in (("active\n", True), ("inactive\n", False), ("activating\n", False),
                             ("failed\n", False), ("", False)):
        monkeypatch.setattr(link_guard.subprocess, "run", lambda a, _s=answer, **k: P(_s))
        assert link_guard.daemon_holds_link() is expected, f"{answer!r} must read as {expected}"
