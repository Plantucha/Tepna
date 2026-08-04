# tepna-capture — tests/test_cpap_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `cpap_harvest._sh` is the single point through which every privileged command in the harvest reaches
# the system: `ip link`, `wpa_supplicant`, `wpa_cli`, `ip addr`, and the teardown. Nine call sites, one
# `subprocess.run`. CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04 §3.
#
# It NEVER RAISES — every failure becomes a return code the caller reads. That makes the exception
# mapping load-bearing rather than defensive: a missing binary must arrive as 127, not as a crash and
# not as a success. Nothing asserted on the CALL itself, so the four keyword arguments it passes to
# subprocess.run were unobservable, and with them the sudo prefix and the merge of the two streams.

import subprocess

import pytest

import cpap_harvest as ch


# ── the call, not just the answer ───────────────────────────────────────────────────────────────────
def test_the_command_reaches_subprocess_unchanged_with_all_four_arguments(recorded_run, completed):
    """Every keyword here changes what the daemon actually does, and none of them is visible in the
    return value — which is why they survived. `capture_output=False` discards the output the caller
    parses; `text=False` hands it bytes that compare unequal to every string it tests; a dropped
    `timeout` removes the deadline from a command run against a Wi-Fi card that may never answer."""
    recorded_run.reply = lambda argv: completed(0, "ok\n", "")
    rc, out = ch._sh(["ip", "link", "show", "wlan0"], 10)

    assert (rc, out) == (0, "ok")
    assert recorded_run.last.argv == ["ip", "link", "show", "wlan0"], \
        "the argv must arrive intact — not None, and not dropped to a bare keyword call"
    kw = recorded_run.last.kw
    assert kw["capture_output"] is True, "uncaptured output is no output — the caller parses it"
    assert kw["text"] is True, "bytes would compare unequal to every string the callers test"
    assert kw["timeout"] == 10, "the caller's bound must reach the call, not a default of None"


def test_sudo_is_opt_in_and_prefixed_non_interactively(recorded_run, completed):
    """`sudo -n` is deliberate: this runs from a daemon with nobody to answer a password prompt, so a
    missing sudoers rule must fail fast rather than hang to the deadline.

    The DEFAULT matters as much as the prefix. `nmcli` is the one caller that relies on it, and the
    download path needs no privilege at all — `reachable()` exists precisely so a station-mode card is
    served without ever escalating. Defaulting `sudo` to True would put `sudo -n` in front of the one
    command that must not need it, on boxes whose sudoers has no entry for it."""
    recorded_run.reply = lambda argv: completed(0, "", "")

    ch._sh(["nmcli", "dev", "wifi"], 5)
    assert recorded_run.last.argv == ["nmcli", "dev", "wifi"], "sudo must NOT be implied"
    assert recorded_run.last.sudo is False

    ch._sh(["ip", "link", "set", "wlan0", "up"], 10, sudo=True)
    assert recorded_run.last.argv == ["sudo", "-n", "ip", "link", "set", "wlan0", "up"]
    assert recorded_run.last.sudo is True, "-n, not a bare sudo: a prompt would hang the daemon"


# ── the two streams are merged, both of them ────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "stdout, stderr, expected",
    [
        ("out\n", "", "out"),
        ("", "err\n", "err"),
        ("out\n", "err\n", "out\nerr"),
        (None, None, ""),
        ("  padded  ", "", "padded"),
    ],
)
def test_both_streams_are_merged_and_stripped(recorded_run, completed, stdout, stderr, expected):
    """`out = ((p.stdout or "") + (p.stderr or "")).strip()`. Dropping EITHER side is invisible unless
    a case carries text on that side alone — and it is the stderr side that matters most, because
    `wpa_cli` and `ip` report their failures there. A caller that logs an empty string for a command
    that failed loudly is the whole diagnostic gone."""
    recorded_run.reply = lambda argv: completed(0, stdout, stderr)
    assert ch._sh(["x"], 1)[1] == expected


def test_a_nonzero_return_code_is_passed_through_with_its_output(recorded_run, completed):
    recorded_run.reply = lambda argv: completed(2, "", "boom\n")
    assert ch._sh(["x"], 1) == (2, "boom")


# ── it never raises: three mappings the callers depend on ───────────────────────────────────────────
def test_a_missing_binary_is_127_not_an_exception(recorded_run):
    """vigil runs netplan/systemd-networkd with no `nmcli` at all — the nmcli-only first cut found that
    the hard way. The absence must arrive as a return code the backend chooser can branch on."""
    recorded_run.reply = lambda argv: FileNotFoundError()
    rc, out = ch._sh(["nmcli", "dev"], 5)
    assert rc == 127
    assert "nmcli" in out and "not installed" in out, "the message must name the missing program"


def test_a_missing_binary_names_the_SUDO_prefixed_program_it_actually_tried(recorded_run):
    """`cmd[0]` after the prefix is applied, so under sudo the report names `sudo` — that is correct and
    load-bearing: a box without sudo installed fails here, and saying `ip: not installed` would send
    the reader to the wrong missing package."""
    recorded_run.reply = lambda argv: FileNotFoundError()
    rc, out = ch._sh(["ip", "link"], 5, sudo=True)
    assert rc == 127 and out.startswith("sudo:")


def test_a_timeout_is_124_and_reports_the_bound_it_broke(recorded_run):
    recorded_run.reply = lambda argv: subprocess.TimeoutExpired(cmd=["x"], timeout=8)
    rc, out = ch._sh(["wpa_cli", "status"], 8)
    assert rc == 124
    assert "8s" in out, "the message must state the deadline, so a too-tight bound is diagnosable"


def test_any_other_failure_is_1_and_carries_the_exception(recorded_run):
    """The blanket arm is best-effort by design — association failing must not take the daemon down.
    But it has to carry WHAT failed: returning a constant here leaves an operator with rc=1 and no
    reason, for a branch that catches everything the other two arms do not."""
    recorded_run.reply = lambda argv: PermissionError("nope")
    rc, out = ch._sh(["ip", "addr", "add"], 5, sudo=True)
    assert rc == 1
    assert "PermissionError" in out and "nope" in out, \
        "repr(e), not repr(None) — the arm that catches everything must say what it caught"
