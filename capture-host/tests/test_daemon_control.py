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
        self.kw = None            # the kwargs too — see the HOW-IT-IS-CALLED test below

    def __call__(self, argv, **kw):
        self.argv, self.kw = argv, kw
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
        dc.build_cmd("obliterate")
    with pytest.raises(dc.VerbError):
        dc.build_cmd("restart; rm -rf /")
    # `reboot` USED to be the example here, and became a real verb in the recovery-rungs change. Kept as
    # a note rather than quietly swapped: the example must be something that will never be implemented,
    # or this test decays into asserting the allowlist contains whatever it happens to contain.
    with pytest.raises(dc.VerbError):
        dc.build_cmd("shutdown")


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
    assert dc.KILLS_SELF == {"restart", "stop", "reboot"}
    assert "status" not in dc.KILLS_SELF
    # `radio` and `rebind` take every BLE LINK down but leave this process alive, so they are answered
    # inline. Conflating "drops the links" with "ends this server" would defer them and throw away the
    # helper's real output — the exact mistake DROPS_LINKS exists to keep separate.
    assert dc.DROPS_LINKS == {"radio", "rebind"}
    assert not (dc.DROPS_LINKS & dc.KILLS_SELF), "a verb cannot be both — they need opposite handling"


def test_run_PASSES_MINUTES_THROUGH_to_the_command_it_builds():
    """Found by the mutation gate: `build_cmd(verb, minutes)` mutated to `build_cmd(verb, None)`
    survived, because nothing asserted that `run` forwards the argument. A stop that silently used the
    default instead of the requested duration is exactly the class of bug that looks like it worked."""
    r = _Ran(0, "stopped")
    dc.run("stop", 12, runner=r)
    assert r.argv[-2:] == ["stop", "12"], f"the requested minutes must reach the helper: {r.argv}"
    r2 = _Ran(0, "stopped")
    dc.run("stop", runner=r2)
    assert r2.argv[-1] == str(dc.DEFAULT_STOP_MINUTES), "and the default when none was asked for"


def test_HOW_the_helper_is_invoked_is_asserted_not_just_THAT_it_is():
    """Also from the mutation gate: every kwarg of the subprocess call survived mutation, because the
    fake accepted `**kw` and threw it away. Each one carries weight — without `capture_output` and
    `text` there is no output to put in `detail` or to detect the missing-sudoers hint from, and
    without `timeout` a wedged helper hangs the endpoint on a box that has had 18 h D-state processes."""
    r = _Ran(0, "ok")
    dc.run("restart", runner=r, timeout=17.0)
    assert r.kw.get("capture_output") is True, "output is needed for `detail` and the sudoers hint"
    assert r.kw.get("text") is True, "bytes would break the substring checks in `run`"
    assert r.kw.get("timeout") == 17.0, "the caller's timeout must reach subprocess, or it cannot bound"


# ── reload — re-read unit files after a pull changed them ────────────────────────────────────────────

def test_reload_is_a_ZERO_ARITY_verb_and_carries_no_minutes():
    """Arity is per verb. `reload` takes none, so a stray `minutes` must not reach the command line —
    the helper would reject it, but the argv should never have carried it in the first place."""
    assert dc.build_cmd("reload") == dc.build_cmd("reload", None)
    assert dc.build_cmd("reload")[-1] == "reload"
    assert "480" not in dc.build_cmd("reload", 480), "a zero-arity verb must ignore minutes entirely"


def test_reload_does_NOT_kill_this_process_so_it_must_run_INLINE():
    """⚠️ THE PROPERTY THAT DECIDES WHETHER THE BUTTON IS USEFUL AT ALL.

    `daemon-reload` re-reads unit FILES. It does not signal, stop or replace any running service, so
    this web server survives it — and therefore it must be answered inline, with the helper's real
    output. Deferring it would return a cheerful 200 carrying nothing, for a verb whose entire value is
    the answer (was a reload owed? did it clear?). That is the silent-success shape this suite exists
    to catch, and putting `reload` in KILLS_SELF is the one edit that would reintroduce it."""
    assert "reload" not in dc.KILLS_SELF
    assert dc.KILLS_SELF == {"restart", "stop", "reboot"}, "exactly those that end this process, no more"


def test_reload_reports_the_helpers_real_answer_including_whether_one_was_OWED():
    """The helper distinguishes 'a reload was owed' from 'nothing had changed', because those mean
    different things to an operator. `run` must pass that through rather than flattening it to 'ok'."""
    r = _Ran(0, "tepna-capture.service: unit files re-read — none was owed, nothing on disk had changed")
    got = dc.run("reload", runner=r)
    assert got["ok"] is True and got["verb"] == "reload"
    assert "none was owed" in got["detail"], got
    assert r.argv[-1] == "reload"


# ── the recovery rungs: radio · rebind · reboot ──────────────────────────────────────────────────────

def test_rebind_uses_the_OTHER_helper_and_passes_the_port_as_its_only_argument():
    """tepna-btreset.sh takes a bus-port and no verb word. The two helpers' allowlists are disjoint on
    purpose — btreset may touch ONLY Bluetooth radios, usbreset ONLY a docked Polar — so `rebind` must
    resolve to btreset and never to the restart helper."""
    argv = dc.build_cmd("rebind", "1-2")
    assert dc.BTRESET in argv[2] and dc.HELPER not in argv[2]
    assert argv[3:] == ["1-2"], f"the port is the whole argument list, with no verb word: {argv}"


@pytest.mark.parametrize("bad", ["1-2; rm -rf /", "../../etc/shadow", "", "1-2 3", "1-2\n4",
                                 None, 12, "-2", "1-"])
def test_a_usb_port_that_is_not_a_BUS_PORT_never_reaches_the_command_line(bad):
    """The helper re-validates and additionally checks the device CLASS off the hardware — that is the
    real allowlist. This is the near side of the sudo boundary, refusing before the call is made."""
    with pytest.raises(dc.VerbError):
        dc.build_cmd("rebind", bad)


def test_radio_and_reboot_are_zero_arity_on_the_restart_helper():
    assert dc.build_cmd("radio") == dc.build_cmd("radio", None)
    assert dc.build_cmd("radio")[-1] == "radio"
    assert dc.build_cmd("reboot")[-1] == "reboot"
    assert dc.HELPER in dc.build_cmd("reboot")[2]


def test_reboot_ENDS_this_process_and_radio_rebind_do_NOT():
    """⚠️ THE DISTINCTION THAT DECIDES HTTP HANDLING, and it is not "is this dangerous".

    A reboot ends the process writing the reply, so it must be answered before it fires. Restarting
    bluetoothd or re-binding the adapter takes every BLE link down — arguably a bigger deal mid-night —
    but leaves this server running, so they are answered INLINE with the helper's real output. Sorting
    them by danger instead of by "does it kill the responder" is how a recovery verb ends up returning
    a cheerful 200 that carries nothing."""
    assert "reboot" in dc.KILLS_SELF
    assert "radio" not in dc.KILLS_SELF and "rebind" not in dc.KILLS_SELF
    assert {"radio", "rebind"} == dc.DROPS_LINKS


# ── deploy — the one UNPRIVILEGED verb ──────────────────────────────────────────────────────────────

def test_deploy_runs_WITHOUT_sudo_because_the_updater_is_unprivileged():
    """⚠️ THE PROPERTY THAT KEEPS THIS SAFE TO AUTOMATE. tepna-update.sh runs as the capture user and
    refuses to install /etc or the granted helpers — root executing freshly-pulled repo code on a
    schedule would turn a compromise of that user into root by waiting for a tick. Prefixing it with
    sudo would hand it exactly the privilege it was written to decline."""
    argv = dc.build_cmd("deploy")
    assert argv[0] != "sudo" and "sudo" not in argv, f"the updater must not be elevated: {argv}"
    assert dc.UPDATER in argv[0]
    assert argv[1:] == ["--no-restart"], "the button's mode is stored, not caller-supplied"


def test_every_OTHER_verb_still_goes_through_sudo():
    """The mirror image, so `_NO_SUDO` cannot quietly grow and de-elevate a privileged helper."""
    for verb in sorted(set(dc._VERBS) - {"deploy"}):
        arg = "1-2" if verb == "rebind" else (5 if verb == "stop" else None)
        assert dc.build_cmd(verb, arg)[:2] == ["sudo", "-n"], verb


def test_deploy_does_NOT_kill_this_server_so_its_report_can_be_read():
    """`--no-restart` is what makes the answer survive. A deploy that restarted would end the process
    writing the reply, so the operator would see a dropped connection for a deploy that worked."""
    assert "deploy" not in dc.KILLS_SELF
    assert "deploy" not in dc.DROPS_LINKS


def test_deploy_gets_a_LONGER_bound_and_the_others_keep_the_short_one():
    """A deploy fetches over the network — a real run on this box died after 300 s of connection
    timeout. Giving every verb that bound instead would let a wedged helper pin the control endpoint
    for four minutes, which is the opposite of what a timeout is for."""
    assert dc.timeout_for("deploy") == dc.DEPLOY_TIMEOUT_S > 30.0
    assert dc.timeout_for("status") == 30.0 and dc.timeout_for("restart") == 30.0


def test_restart_owed_is_reported_as_a_FLAG_not_left_in_the_prose():
    """The UI must branch on this, and `"RESTART-OWED" in detail` at the call site would break the next
    time the helper's wording improves. So the token is matched HERE, once, and published as a bool."""
    owed = dc.run("deploy", runner=_Ran(0, "updated abc → def\nRESTART-OWED — new code is on disk"))
    assert owed["ok"] is True and owed["restart_owed"] is True
    clean = dc.run("deploy", runner=_Ran(0, "up to date at abc123456789 — nothing to do"))
    assert clean["restart_owed"] is False
    # and it is a DEPLOY-only key: a restart result carrying it would make the UI offer a second restart
    assert "restart_owed" not in dc.run("restart", runner=_Ran(0, "ok"))
