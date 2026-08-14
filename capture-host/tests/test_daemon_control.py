# tepna-capture — tests/test_daemon_control.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Stop / restart the capture daemon from the monitor.

WHY IT EXISTS. Every recovery this box has needed went through ssh. On 2026-08-13 the daemon was
restarted SIX times to apply config changes that only take effect at a device's next connect, and a
runaway sensor was silenced by POSTing config through the settings API because nothing else could
reach it. `tepna-restart.sh` was already deployed, root-owned and NOPASSWD-granted; the only missing
piece was a caller.

TWO PROPERTIES CARRY THE WHOLE DESIGN, and both are asserted here rather than described:

1. THE VERB IS AN ALLOWLIST. This is reachable from an HTTP body, so no caller string may ever reach a
   command line. `build_cmd` looks a verb up and raises on anything else; `minutes` is a bounded int.
2. RESTART KILLS THE SERVER THAT ANSWERS. The monitor is served BY the unit being restarted, so the
   HTTP layer must answer FIRST and fire afterwards — and it must VALIDATE before answering, or a bad
   request gets a cheerful 200 followed by nothing happening.
"""
import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import daemon_control as dc  # noqa: E402


class _Ran:
    """A fake `subprocess.run` that records its argv. Injected rather than patched globally so the
    decision logic is testable on a machine with no sudoers grant at all — the alternative is a test
    that only runs where the deploy already worked, which tests the deploy, not the code."""

    def __init__(self, rc=0, out="", err=""):
        self.rc, self.out, self.err, self.argv = rc, out, err, None

    def __call__(self, argv, **kw):
        self.argv = argv
        return subprocess.CompletedProcess(argv, self.rc, self.out, self.err)


# ── coerce_minutes ──────────────────────────────────────────────────────────────────────────────────

def test_absent_minutes_means_the_default_not_an_error():
    """The button sends no value; `None` is the normal path, not a malformed request."""
    assert dc.coerce_minutes(None) == dc.DEFAULT_STOP_MINUTES


@pytest.mark.parametrize("given,want", [(5, 5), ("45", 45), (30.0, 30)])
def test_a_whole_number_in_any_JSON_shape_is_accepted(given, want):
    """A JSON body may carry an int, a float or a string for the same field."""
    assert dc.coerce_minutes(given) == want


@pytest.mark.parametrize("bad", ["", "soon", 4.5, [30], {"m": 30}])
def test_anything_that_is_not_a_whole_number_is_REFUSED(bad):
    """Including 4.5 — a fractional value is a misunderstanding of the field, not something to round."""
    with pytest.raises(dc.VerbError):
        dc.coerce_minutes(bad)


def test_the_range_is_inclusive_at_both_ends_and_REFUSES_beyond_them():
    """Refused, never clamped. A typo of 4800 must not become a silent 480-minute outage — the whole
    point of the bound is that the operator learns they typed something impossible."""
    assert dc.coerce_minutes(dc.MIN_STOP_MINUTES) == dc.MIN_STOP_MINUTES
    assert dc.coerce_minutes(dc.MAX_STOP_MINUTES) == dc.MAX_STOP_MINUTES
    with pytest.raises(dc.VerbError):
        dc.coerce_minutes(dc.MIN_STOP_MINUTES - 1)
    with pytest.raises(dc.VerbError):
        dc.coerce_minutes(dc.MAX_STOP_MINUTES + 1)


# ── build_cmd — the security boundary ───────────────────────────────────────────────────────────────

def test_an_unknown_verb_is_REFUSED_and_never_reaches_an_argv():
    with pytest.raises(dc.VerbError):
        dc.build_cmd("reboot")
    with pytest.raises(dc.VerbError):
        dc.build_cmd("restart; rm -rf /")


def test_the_argv_is_a_LIST_so_there_is_no_shell_to_quote_for():
    """The injection defence is structural, not textual: a list argv is exec'd directly, so a verb
    containing shell metacharacters could not do anything even if the allowlist were bypassed."""
    argv = dc.build_cmd("restart")
    assert isinstance(argv, list)
    assert argv[:2] == ["sudo", "-n"]
    assert argv[-1] == "restart"
    assert dc.HELPER in argv[2]


def test_only_stop_carries_minutes():
    """Arity is per verb. `restart extra` would be accepted by a blanket "1 or 2 args" rule, and the
    helper's own header makes the same point about verbs that ignore trailing junk."""
    assert dc.build_cmd("stop", 12)[-2:] == ["stop", "12"]
    assert dc.build_cmd("restart")[-1] == "restart"
    assert dc.build_cmd("status")[-1] == "status"


def test_a_bad_minutes_makes_the_whole_command_refused():
    with pytest.raises(dc.VerbError):
        dc.build_cmd("stop", 9999)


# ── run — operational failures are reported, never raised ───────────────────────────────────────────

def test_a_successful_run_reports_ok_and_the_helper_output():
    r = _Ran(0, "tepna-capture.service: active")
    got = dc.run("restart", runner=r)
    assert got["ok"] is True and got["verb"] == "restart"
    assert "active" in got["detail"]
    assert r.argv[-1] == "restart"


def test_a_bad_verb_is_reported_not_raised():
    """`run` is called from an HTTP handler; raising would be a 500 for a user error."""
    got = dc.run("nope", runner=_Ran())
    assert got["ok"] is False and "unknown verb" in got["error"]


def test_a_MISSING_SUDOERS_GRANT_is_named_as_a_deploy_gap():
    """⚠️ THE DISTINCTION AN OPERATOR ACTUALLY NEEDS. `sudo -n` exits 1 with 'a password is required'
    on a host without the grant, which reads identically to a failing daemon. Naming it is the same
    fix as check.sh's shellcheck-127 note — a missing TOOL is not a failing GATE."""
    got = dc.run("restart", runner=_Ran(1, "", "sudo: a password is required"))
    assert got["ok"] is False
    assert "DEPLOY" in got["error"], got
    assert got["exit"] == 1


def test_an_ordinary_failure_is_NOT_dressed_up_as_a_deploy_gap():
    """The mirror image, so the hint cannot fire on everything and become noise."""
    got = dc.run("restart", runner=_Ran(1, "", "Job for tepna-capture.service failed"))
    assert got["ok"] is False
    assert "DEPLOY" not in got["error"]
    assert "Job for" in got["error"]


def test_a_failure_with_NO_output_still_says_something():
    got = dc.run("restart", runner=_Ran(3, "", ""))
    assert got["ok"] is False and got["error"] == "helper failed"


def test_no_sudo_on_this_machine_is_reported_as_not_a_capture_host():
    def _boom(*a, **k):
        raise FileNotFoundError("sudo")
    got = dc.run("restart", runner=_boom)
    assert got["ok"] is False and "not a capture host" in got["error"]


def test_a_HUNG_helper_is_bounded_and_says_so():
    """The box has had processes wedged for 18 h in uninterruptible sleep. A control endpoint that can
    hang forever is a control endpoint that stops being usable exactly when it is needed."""
    def _hang(*a, **k):
        raise subprocess.TimeoutExpired(cmd="x", timeout=30)
    got = dc.run("restart", runner=_hang, timeout=30)
    assert got["ok"] is False and "did not return within 30s" in got["error"]


def test_the_verbs_that_kill_this_process_are_declared():
    """`KILLS_SELF` is what the HTTP layer branches on to decide answer-then-fire. `status` must not be
    in it, or a harmless read would be deferred and never reported."""
    assert dc.KILLS_SELF == {"restart", "stop"}
    assert "status" not in dc.KILLS_SELF
