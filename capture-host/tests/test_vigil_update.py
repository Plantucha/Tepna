# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""`tepna-update.sh` — the unattended deploy-completer (VIGIL-AUTO-UPDATE).

The thing under test is mostly a set of REFUSALS, so that is what these assert. A updater that restarts
when it should not is worse than no updater at all: the box was already surviving stale code, and the
failure this could newly introduce is a destroyed night."""
import json
import os
import subprocess
import time

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPD = os.path.join(HERE, "tepna-update.sh")
DEPLOY_ROOT = "/opt/tepna/capture-host"  # the path the installed units name; maps back onto HERE


def _git(d, *a):
    return subprocess.run(["git", "-C", str(d), *a], capture_output=True, text=True,
                          env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})


@pytest.fixture
def box(tmp_path):
    """An upstream repo, a checkout of it, a status.json, and a fake restart helper that records calls."""
    up = tmp_path / "upstream"; up.mkdir()
    _git(up, "init", "-q", "-b", "main")
    (up / "README").write_text("v1\n")
    _git(up, "add", "README"); _git(up, "commit", "-qm", "v1")

    repo = tmp_path / "opt-tepna"
    subprocess.run(["git", "clone", "-q", str(up), str(repo)], check=True, capture_output=True)

    status = tmp_path / "status.json"
    _write_status(status, {"Ring": False})

    called = tmp_path / "restart-calls"
    helper = tmp_path / "tepna-restart.sh"
    helper.write_text(f'#!/usr/bin/env bash\necho "$@" >> {called}\nexit 0\n')
    helper.chmod(0o755)

    # The deployed-SHA marker, isolated per test. On the box it lives in /run — cleared on boot, which
    # is correct, because after a boot the daemon started on whatever was checked out.
    return {"up": up, "repo": repo, "status": status, "helper": helper, "called": called,
            "mark": tmp_path / "deployed-sha", "fails": tmp_path / "update-fails",
            "defers": tmp_path / "update-defers", "lock": tmp_path / "update.lock"}


def _write_status(path, devices, top=None, publish=True, age=0.0):
    d = {"updated": "now", "devices": {n: ({"connected": True, "recording": r} if publish
                                           else {"connected": True}) for n, r in devices.items()}}
    if publish:
        d["recording"] = any(devices.values()) if top is None else top
    path.write_text(json.dumps(d))
    if age:
        t = time.time() - age
        os.utime(path, (t, t))


def _run(box, *mode, **env):
    """Drive the updater as the timer does (no argument), or as the button does (`"--no-restart"`)."""
    e = {**os.environ,
         "TEPNA_REPO_DIR": str(box["repo"]), "TEPNA_STATUS_JSON": str(box["status"]),
         "TEPNA_RESTART_SH": str(box["helper"]), "TEPNA_SUDO": "env",
         "TEPNA_DEPLOYED_MARK": str(box["mark"]),
         # Isolated per test. Without this the suite would write the streak marker to the REAL
         # /srv/tepna path, which on the box itself is a live operational file.
         "TEPNA_FAIL_MARK": str(box["fails"]),
         # Same isolation for the DEFERRAL streak marker, and for the same reason: the default path is
         # a live operational file on the box.
         "TEPNA_DEFER_MARK": str(box["defers"]),
         # The single-run lock, isolated per test for the same reason as the two markers above — the
         # default path is a live operational file on the box, and a test must not take the box's lock.
         "TEPNA_LOCK_FILE": str(box["lock"]), **env}
    return subprocess.run(["bash", UPD, *mode], capture_output=True, text=True, env=e)


def _advance(box, path="capture-host/capture.py"):
    """Land a new commit upstream, so the checkout has something to fast-forward to.

    The default touches the DAEMON'S code. Since the content gate (§5b) a commit that moves only files
    outside `capture-host/` — the repo's dominant case: docs, briefs, bundles — is deployed WITHOUT a
    restart, so a test that wants a restart must change something the daemon actually runs. Pass
    `path="README"` for the docs-only shape."""
    p = box["up"] / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(f"v{time.time_ns()}\n")
    _git(box["up"], "add", path); _git(box["up"], "commit", "-qm", f"touch {path}")


def _upstream_checker(box, body):
    """Put a stub check-system-files.sh UPSTREAM, so the checkout acquires it by fast-forward.

    Committing it in the clone and pushing does not work and the reason is this repo's own §2b: `up` has
    `main` checked out, so git REFUSES the push — after which the clone is ahead, `_advance` moves `up`
    independently, and the two have diverged. Which the updater then correctly refuses, and the test
    reads as "it didn't restart"."""
    d = box["up"] / "capture-host" / "deploy"
    d.mkdir(parents=True, exist_ok=True)
    chk = d / "check-system-files.sh"
    chk.write_text(body)
    chk.chmod(0o755)
    _git(box["up"], "add", "-A"); _git(box["up"], "commit", "-qm", "checker")


# ---------------------------------------------------------------- the refusals


def test_a_dirty_checkout_is_never_touched(box):
    """Someone edited a file ON THE BOX. That edit may be the only copy in existence and it may be the
    reason the box is currently working. Fast-forwarding over it is not an option, and neither is
    stashing it — CLAUDE.md §2's rule about trees you did not dirty applies with more force here,
    because nothing is watching."""
    (box["repo"] / "README").write_text("someone was debugging\n")
    _advance(box)
    r = _run(box)
    assert r.returncode == 1
    assert "uncommitted changes" in r.stderr
    assert _git(box["repo"], "rev-parse", "HEAD").stdout != _git(box["up"], "rev-parse", "HEAD").stdout


def test_the_dirty_check_measures_the_TREE_not_the_ref(box):
    """CLAUDE.md §2b, applied. An untracked file is invisible to any ref comparison and to `git diff`,
    but it is still someone's work. `status --porcelain` is the check that sees it."""
    (box["repo"] / "NOTES.txt").write_text("in-flight\n")
    r = _run(box)
    assert r.returncode == 1 and "uncommitted" in r.stderr


def test_a_checkout_on_another_branch_is_refused(box):
    _git(box["repo"], "checkout", "-q", "-b", "experiment")
    r = _run(box)
    assert r.returncode == 1 and "not 'main'" in r.stderr


def test_a_diverged_checkout_is_refused_rather_than_merged(box):
    """--ff-only. This must be incapable of inventing a tree that exists nowhere else — an unattended
    merge commit on a capture box is a state no one can reproduce or review."""
    (box["repo"] / "LOCAL").write_text("local commit\n")
    _git(box["repo"], "add", "LOCAL"); _git(box["repo"], "commit", "-qm", "local")
    _advance(box)
    r = _run(box)
    assert r.returncode == 1 and "fast-forward" in r.stderr


# ---------------------------------------------------------------- the recording interlock


def test_it_DEFERS_while_a_device_is_recording(box):
    """The whole reason the interlock exists. New code is on disk and must stay unused until morning."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    r = _run(box)
    assert r.returncode == 0, r.stderr           # deferring is this script WORKING, not failing
    assert "deferred" in r.stdout
    assert not box["called"].exists(), "restarted mid-recording"


def test_it_restarts_when_the_box_is_idle(box):
    _advance(box)
    r = _run(box)
    assert r.returncode == 0, r.stderr
    assert box["called"].read_text().strip().endswith("restart")


def test_a_MISSING_status_json_defers_and_does_not_assume_idle(box):
    """Absence of evidence. The cost of guessing wrong is a destroyed night; the cost of waiting is one
    hour."""
    _advance(box)
    box["status"].unlink()
    r = _run(box)
    assert not box["called"].exists()
    assert "refusing to restart blind" in r.stderr and r.returncode == 1


def test_a_STALE_status_json_defers(box):
    """capture.py rewrites it every 10 s unconditionally, so stale means the daemon is not running —
    and a daemon whose state we cannot see is one we must not interrupt."""
    _advance(box)
    _write_status(box["status"], {"Ring": False}, age=3600)
    r = _run(box)
    assert not box["called"].exists()
    assert "old" in r.stderr and r.returncode == 1


def test_a_MALFORMED_status_json_defers(box):
    _advance(box)
    box["status"].write_text("{not json")
    r = _run(box)
    assert not box["called"].exists() and r.returncode == 1


def test_a_daemon_that_does_not_publish_recording_defers_rather_than_reading_connected(box):
    """THE POINT OF §3. An older daemon publishes `connected` and not `recording`. Falling back to
    `connected` is precisely the 2026-07-29 failure — an unbonded H10 reads connected=True inside each
    doomed 1-2 s connect, so a fallback would restart mid-night on a flapping bond. A missing key must
    therefore read as UNKNOWN, never as idle and never as a reason to consult a weaker field."""
    _advance(box)
    _write_status(box["status"], {"Ring": False}, publish=False)
    r = _run(box)
    assert not box["called"].exists()
    assert "does not publish" in r.stderr and r.returncode == 1


def test_a_per_device_recording_wins_over_a_false_top_level_flag(box):
    """The top-level flag is a convenience; the per-device map is the evidence. If they disagree the
    safe reading is the one that blocks."""
    _advance(box)
    _write_status(box["status"], {"Ring": True}, top=False)
    r = _run(box)
    assert not box["called"].exists() and "deferred" in r.stdout


# ---------------------------------------------------------------- the no-op and the reporting path


def test_an_up_to_date_box_does_nothing_and_says_so_quietly(box):
    r = _run(box)
    assert r.returncode == 0 and "nothing to do" in r.stdout
    assert not box["called"].exists(), "restarted a daemon that had no new code to run"


def test_a_failed_restart_is_reported_as_a_failure(box):
    """New code on disk plus the old process still serving it is the EXACT state this script exists to
    prevent, so it must never exit 0 there."""
    _advance(box)
    box["helper"].write_text("#!/usr/bin/env bash\nexit 1\n")
    box["helper"].chmod(0o755)
    r = _run(box)
    assert r.returncode == 1 and "restart FAILED" in r.stderr


def test_a_missing_restart_helper_is_fatal_once_new_code_is_on_disk(box):
    _advance(box)
    box["helper"].unlink()
    r = _run(box)
    assert r.returncode == 1 and "cannot complete the deploy" in r.stderr


def test_it_REPORTS_etc_drift_and_never_installs_it(box):
    """§2's boundary, asserted. The checker is invoked without --install; a drifted /etc must make the
    run visible (nonzero → `systemctl --failed`) without this unprivileged timer writing to /etc."""
    _upstream_checker(box, '#!/usr/bin/env bash\necho "ARGS:[$*]"\necho "tepna-clock.sh STALE"\nexit 1\n')
    r = _run(box)
    assert r.returncode == 1
    assert "a HUMAN must run" in r.stderr
    assert "ARGS:[]" in r.stderr, "the updater passed --install; it must never write /etc"


def test_drift_does_not_prevent_the_restart(box):
    """Config drift and stale code are independent axes. A box with drifted /etc still benefits from
    running the current daemon, so the report must not become a blocker."""
    _upstream_checker(box, "#!/usr/bin/env bash\nexit 1\n")
    _advance(box)
    r = _run(box)
    assert box["called"].read_text().strip().endswith("restart")
    assert r.returncode == 1, "drift must still be visible"


def test_a_missing_git_checkout_is_fatal(box, tmp_path):
    r = _run(box, TEPNA_REPO_DIR=str(tmp_path / "nope"))
    assert r.returncode == 1 and "no git checkout" in r.stderr


# ---------------------------------------------------------------- the consecutive-failure counter
#
# VIGIL-AUTO-UPDATE-FOLLOWUPS §5. `systemctl status` shows `failed` identically for "failed once and
# recovered" and "failing every tick since Tuesday" — measured, the latter ran 30 events over 9.3 h and
# nobody noticed. These pin the distinction, not merely the existence of a counter.


def _fail(box, tmp_path):
    """A repeatable failure that goes through `die`: no checkout at the configured path."""
    return _run(box, TEPNA_REPO_DIR=str(tmp_path / "nope"))


def test_a_FIRST_failure_records_the_streak_but_reports_no_count(box, tmp_path):
    """One failure is already visible in `systemctl status`. Announcing "1 in a row" on every isolated
    blip is how a new signal becomes noise that gets ignored — which is the failure being fixed, not a
    fix for it. The marker is still written, because the NEXT tick needs it."""
    r = _fail(box, tmp_path)
    assert r.returncode == 1
    assert "IN A ROW" not in r.stderr
    assert box["fails"].read_text().split()[0] == "1"


def test_a_SECOND_consecutive_failure_names_the_streak(box, tmp_path):
    _fail(box, tmp_path)
    r = _fail(box, tmp_path)
    assert r.returncode == 1
    assert "failure 2 IN A ROW" in r.stderr
    assert box["fails"].read_text().split()[0] == "2"


def test_the_streak_counts_a_NON_die_failure_too(box):
    """🔴 THE LOAD-BEARING CASE. The script ends `exit "$drifted"`, so it can leave the unit `failed`
    without calling `die` — and that path ("cannot establish whether the box is recording") is the one
    that can persist for a whole night. A counter hung off `die` would miss exactly the longest
    outages, which is the opposite of the point."""
    _advance(box)
    box["status"].write_text("{not json")
    first = _run(box)
    assert first.returncode == 1 and "ERROR" not in first.stderr, "this path must not reach die()"
    second = _run(box)
    assert "failure 2 IN A ROW" in second.stderr


def test_the_FIRST_failure_time_is_carried_across_the_streak(box, tmp_path):
    """"Since when" is the whole question. If each tick restamped the marker the answer would always be
    "since a moment ago" — true of the tick and false of the outage.

    ⚠️ The marker is SEEDED old rather than built by looping `_fail`. Four real runs complete inside one
    wall-clock second, so a restamping bug writes a byte-identical value and the looping version of this
    test passed against it — verified by mutation, it caught nothing. Seeding is what gives the
    assertion any resolution, and it reproduces the shape actually measured on the box: a streak that
    had been running for most of a night."""
    long_ago = int(time.time()) - (9 * 3600)
    box["fails"].write_text(f"29 {long_ago}\n")
    r = _fail(box, tmp_path)
    n, still = box["fails"].read_text().split()
    assert (n, int(still)) == ("30", long_ago)
    assert "failure 30 IN A ROW, spanning 9h0m" in r.stderr


def test_the_recovery_line_reports_the_span_of_a_long_outage(box):
    """The 2026-08-04 event: 30 consecutive failures across 9.3 h. Seeded for the same reason as above —
    this is the line that would have made it visible, so it is the one worth pinning against real
    numbers rather than against a streak two seconds long."""
    box["fails"].write_text(f"30 {int(time.time()) - (9 * 3600 + 1200)}\n")
    r = _run(box)
    assert r.returncode == 0
    assert "recovered after 30 consecutive failed run(s) spanning 9h20m" in r.stdout
    assert not box["fails"].exists()


def test_a_success_after_failures_reports_the_recovery_and_clears_the_marker(box, tmp_path):
    """The other half of the ask: whoever reads the journal AFTER an outage needs its length, and by
    then every failing tick is behind them."""
    _fail(box, tmp_path)
    _fail(box, tmp_path)
    r = _run(box)
    assert r.returncode == 0
    assert "recovered after 2 consecutive failed run(s)" in r.stdout
    assert not box["fails"].exists()


def test_a_healthy_run_emits_NO_stderr_NOISE(box):
    """🔴 REGRESSION, observed in production. The marker is ABSENT on every healthy run, because a
    success clears it — so the absent-file path is the common path, not the edge case.

    `read ... < "$FAIL_MARK" 2>/dev/null` does not cover it: the shell performs the `<` redirection
    BEFORE running `read`, so a missing file is the SHELL's failure on the SHELL's stderr, which a
    redirect attached to the command cannot suppress. Measured on vigil 2026-09-03 20:25:05 — every
    successful update tick logged `No such file or directory` into the journal of the unit this
    counter exists to make legible, i.e. the fix for silent failure was manufacturing false errors.

    The earlier happy-path test asserted only that the RIGHT strings appear on stdout; nothing
    asserted that nothing EXTRA appears on stderr, which is why a clean suite shipped this."""
    r = _run(box)
    assert r.returncode == 0
    assert "No such file or directory" not in r.stderr
    assert r.stderr == "", f"a healthy run must be silent on stderr; got {r.stderr!r}"


def test_a_quiet_success_says_nothing_extra(box):
    """Guards the regression that would make this unreadable: a line on every one of the ~300 healthy
    ticks per month would bury the 38 that matter."""
    r = _run(box)
    assert r.returncode == 0 and "recovered" not in r.stdout


def test_a_MALFORMED_marker_reads_as_no_streak_and_never_blocks_the_update(box):
    """This is an observability aid. It must never become the reason the box stops updating."""
    box["fails"].write_text("garbage not a count\n")
    r = _run(box)
    assert r.returncode == 0 and not box["fails"].exists()


def test_an_UNWRITABLE_marker_warns_and_does_not_change_the_verdict(box, tmp_path):
    """Same degradation the deployed-SHA marker learned the hard way — that one was silently inert for
    weeks because /run was root-owned. A marker that cannot be written warns; the run's own verdict is
    untouched, and it is still 1 for the reason it was already 1."""
    r = _run(box, TEPNA_REPO_DIR=str(tmp_path / "nope"),
             TEPNA_FAIL_MARK=str(tmp_path / "no-such-dir" / "fails"))
    assert r.returncode == 1
    assert "no git checkout" in r.stderr
    assert "could not record the failure streak" in r.stderr


# ---------------------------------------------------------------- the privilege surface


def test_the_updater_has_no_privileged_command_outside_the_seam():
    """The escalation surface must stay exactly one line wide.

    This script is the only unattended thing on the box that can reach root, and it does so through a
    single named seam so a test can substitute it. If a direct `systemctl`, `install`, `udevadm` or a
    bare `sudo` ever appears, the sandbox every test in this file relies on is silently gone — and so is
    the §2 boundary, which is the argument for the design in the first place."""
    body = open(UPD, encoding="utf-8").read()
    code = "\n".join(l for l in body.splitlines() if not l.lstrip().startswith("#"))
    for bad in ("systemctl", "udevadm", "install -", "mount ", "chown", "chmod"):
        assert bad not in code, f"{bad!r} appears outside the seam — privilege must go through $RESTART_SH"
    assert 'read -r -a SUDO <<<"${TEPNA_SUDO:-sudo -n}"' in body, "the substitutable seam is gone"
    assert code.count("sudo") == 1, "sudo must appear exactly once, as the seam default"


def test_the_updater_never_moves_a_ref_or_discards_a_tree():
    """CLAUDE.md §2 and §2b, enforced on the one script that runs git with nobody watching. A reset,
    clean, stash or update-ref here would destroy work whose only copy is on the box, at 3 a.m."""
    import re
    code = "\n".join(l for l in open(UPD, encoding="utf-8").read().splitlines()
                     if not l.lstrip().startswith("#"))
    # The VERBS actually invoked, not any appearance of the word — "no git checkout at $REPO_DIR" is an
    # error message, and a substring scan that fails on it is a test that will be edited to shut it up.
    verbs = set(re.findall(r'\bgit\s+-C\s+\S+\s+([a-z-]+)', code))
    assert verbs, "the scan found no git invocations — it has stopped working"
    # `diff` is read-only: it is how the content gate asks whether the daemon's code moved (§5b).
    assert verbs <= {"status", "rev-parse", "fetch", "merge", "diff"}, (
        f"unattended git verbs are {sorted(verbs)} — reset/clean/stash/checkout/push/update-ref would "
        f"destroy work whose only copy is on the box, at 3 a.m. (CLAUDE.md §2, §2b)")
    assert "--ff-only" in code


# ---------------------------------------------------------------- the published predicate (§3)


def _cap():
    import capture
    return capture


def test_publish_recording_stamps_every_device_and_returns_whether_any_is():
    c = _cap()
    c.STATUS["devices"] = {"A": {"connected": True}, "B": {"connected": True}}
    c._LAST_DATA.clear()
    c._LAST_DATA["A"] = 1000.0                     # streamed 1 s ago
    assert c.publish_recording(1001.0, 120.0) is True
    assert c.STATUS["devices"]["A"]["recording"] is True
    assert c.STATUS["devices"]["B"]["recording"] is False, "B has never streamed — that is not recording"


def test_a_LINKED_but_SILENT_device_is_not_recording():
    """The 2026-07-29 H10: connected=True inside each doomed connect, not one byte written. This is the
    distinction the whole interlock rests on, asserted at the level that publishes it."""
    c = _cap()
    c.STATUS["devices"] = {"H10": {"connected": True}}
    c._LAST_DATA.clear()
    assert c.publish_recording(500.0, 120.0) is False
    assert c.STATUS["devices"]["H10"]["recording"] is False


def test_data_older_than_the_grace_stops_counting_as_recording():
    c = _cap()
    c.STATUS["devices"] = {"A": {"connected": True}}
    c._LAST_DATA.clear()
    c._LAST_DATA["A"] = 0.0
    assert c.publish_recording(119.0, 120.0) is True
    assert c.publish_recording(121.0, 120.0) is False


def test_a_disconnected_device_is_never_recording_however_recent_its_data():
    c = _cap()
    c.STATUS["devices"] = {"A": {"connected": False}}
    c._LAST_DATA.clear()
    c._LAST_DATA["A"] = 1000.0
    assert c.publish_recording(1000.5, 120.0) is False


def test_publish_recording_on_an_empty_device_map_is_idle_not_an_error():
    c = _cap()
    c.STATUS["devices"] = {}
    assert c.publish_recording(1.0, 120.0) is False


def _exec_start_targets():
    """(unit, repo-relative script) for every ExecStart= that exec's a repo file DIRECTLY.

    A leading interpreter (`ExecStart=/bin/bash <script>`) is NOT a direct exec — the kernel exec's the
    interpreter and the script is just an argument, so it needs no exec bit. Only the first token counts.
    """
    out = []
    for sub in ("systemd", "deploy"):
        d = os.path.join(HERE, sub)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith(".service"):
                continue
            for line in open(os.path.join(d, name), encoding="utf-8"):
                line = line.strip()
                if not line.startswith("ExecStart="):  # a commented-out alternative is not a unit's exec
                    continue
                tok = line[len("ExecStart="):].split()
                if not tok:
                    continue
                target = tok[0].lstrip("-@+!")  # systemd's exec-prefix chars
                if not target.startswith(DEPLOY_ROOT):
                    continue  # /usr/bin/caddy — outside the deploy tree, not ours to chmod
                rel = os.path.relpath(target, DEPLOY_ROOT)
                # The VENV INTERPRETER is named by ExecStart= but is not a repo script: it is gitignored,
                # has no committed mode, and is not ours to chmod. It lives UNDER DEPLOY_ROOT
                # (`/opt/tepna/capture-host/.venv/bin/python`), so the prefix test above never excluded it
                # — the comment there used to say it did. What actually excluded it was `.venv/` being
                # ABSENT, which is true in CI and false on any box using the documented
                # `.venv/bin/python -m pytest` runner. So this gate passed in CI and failed for every
                # developer, on `main`, with the assertion pointing at the interpreter instead of a script.
                if rel.split(os.sep)[0] == ".venv":
                    continue
                if os.path.isfile(os.path.join(HERE, rel)):
                    out.append((f"{sub}/{name}", rel))
    return out


def test_a_unit_that_directly_execs_a_repo_script_requires_the_exec_bit():
    """systemd's ExecStart= is an execve, and execve on a 0644 file is 203/EXEC.

    THIS IS THE GAP THAT SHIPPED THE TIMER DEAD. Every other test in this file drives the updater as
    `subprocess.run(["bash", UPD])`, which runs happily at mode 0644 — so 327 lines of green tests said
    the updater worked while `tepna-update.timer` had never once executed on the real box. Measured
    2026-08-04 on vigil: `Failed at step EXEC spawning /opt/tepna/capture-host/tepna-update.sh:
    Permission denied`, hourly, silently, with the suite passing.

    The mode is asserted through GIT, not the filesystem: the box is a clone, so the committed mode is
    what actually lands there. A local `chmod +x` that git never records would leave the box broken and
    this test green — the same shape of lie all over again.
    """
    targets = _exec_start_targets()
    assert targets, "no direct-exec ExecStart= found — the scan broke, not the units"
    for unit, rel in targets:
        mode = subprocess.run(["git", "-C", HERE, "ls-files", "-s", rel],
                              capture_output=True, text=True).stdout.split()
        assert mode, f"{rel} (from {unit}) is not tracked by git"
        assert mode[0] == "100755", (
            f"{unit} directly exec's {rel}, which is committed {mode[0]}. systemd will fail 203/EXEC. "
            f"Fix with: git update-index --chmod=+x capture-host/{rel}")


def test_the_exec_scan_ignores_the_venv_interpreter_even_when_it_exists(tmp_path, monkeypatch):
    """The venv python IS under DEPLOY_ROOT, so the prefix filter never excluded it — only its ABSENCE
    did, and it is absent exactly in CI and present exactly on a developer box running the documented
    `.venv/bin/python -m pytest`. That made this file's exec-bit gate green in CI and RED on `main` for
    every developer, blaming an interpreter that is gitignored by design.

    This test builds the developer's situation on purpose: a unit naming the venv interpreter, WITH that
    interpreter present on disk. The scan must return the script it exec's directly and nothing else."""
    (tmp_path / "systemd").mkdir()
    (tmp_path / ".venv" / "bin").mkdir(parents=True)
    (tmp_path / ".venv" / "bin" / "python").write_text("#!/bin/sh\n")      # the interpreter EXISTS
    (tmp_path / "tepna-update.sh").write_text("#!/bin/bash\n")
    (tmp_path / "systemd" / "a.service").write_text(
        f"[Service]\nExecStart={DEPLOY_ROOT}/.venv/bin/python capture.py --config x.yaml\n")
    (tmp_path / "systemd" / "b.service").write_text(
        f"[Service]\nExecStart={DEPLOY_ROOT}/tepna-update.sh\n")

    monkeypatch.setitem(globals(), "HERE", str(tmp_path))
    got = _exec_start_targets()

    assert ("systemd/b.service", "tepna-update.sh") in got, "a direct-exec repo script must still be found"
    assert not [r for _u, r in got if r.split(os.sep)[0] == ".venv"], \
        "the venv interpreter is not a repo script — it is gitignored and has no committed mode"


# ── a deferred restart is a DEBT, and it must survive the tick that could not pay it ──────────────
# Measured on vigil 2026-08-30: merged-and-deferred at 00:27 and 01:31, then ten consecutive ticks
# reporting "up to date — nothing to do" while the daemon served the pre-merge build. The deferral
# branch's comment promised "the next tick will take it once the night ends"; the next tick had no way
# to know anything was owed, because the only record of it was a shell variable from the previous run.
def _head(box):
    return _git(box["repo"], "rev-parse", "HEAD").stdout.strip()


def test_THE_DEFERRED_RESTART_IS_TAKEN_ON_THE_NEXT_IDLE_TICK(box):
    _advance(box)
    _write_status(box["status"], {"Ring": True})            # recording — the merge lands, restart defers
    r1 = _run(box)
    assert "deferred" in r1.stdout, r1.stdout
    assert not box["called"].exists(), "restarted while a device was recording"

    _write_status(box["status"], {"Ring": False})           # the night ends; nothing new upstream
    r2 = _run(box)
    assert "OWED" in r2.stdout, f"the outstanding restart evaporated: {r2.stdout}"
    assert box["called"].read_text().strip() == "restart", "the deferred restart was never taken"


def test_A_SECOND_DEFERRAL_DOES_NOT_MARK_THE_DEBT_PAID(box):
    # The trap inside the fix: on a repeat deferral nothing merged, so `before` equals `after`, and
    # recording `before` would write the DISK sha and silently clear the debt — the same bug one level
    # down. What must be recorded is what the DAEMON is on.
    _advance(box)
    old = _head(box)
    _write_status(box["status"], {"Ring": True})
    _run(box)                                                # merge + defer
    r2 = _run(box)                                           # still recording — defer again
    assert "deferred" in r2.stdout
    assert box["mark"].read_text().strip() == old, "the marker moved to the disk sha while deferring"

    _write_status(box["status"], {"Ring": False})
    _run(box)
    assert box["called"].read_text().strip() == "restart", "the debt was lost on the second deferral"


def test_A_SUCCESSFUL_RESTART_RECORDS_WHAT_THE_DAEMON_IS_NOW_ON(box):
    _advance(box)
    _run(box)
    assert box["mark"].read_text().strip() == _head(box)
    # ...and a later tick with nothing new must NOT restart again.
    box["called"].unlink()
    r = _run(box)
    assert "nothing to do" in r.stdout
    assert not box["called"].exists(), "restarted a daemon that was already on the checkout"


def test_NO_MARKER_AFTER_A_BOOT_MEANS_THE_DAEMON_IS_ON_HEAD(box):
    # /run is cleared on boot, and after a boot the daemon started on whatever was checked out. An
    # absent marker must therefore mean "current", not "unknown, restart to be safe" — otherwise every
    # box reboots into one gratuitous restart.
    assert not box["mark"].exists()
    r = _run(box)
    assert "nothing to do" in r.stdout
    assert not box["called"].exists()


def test_A_STALE_MARKER_FROM_AN_OUTSIDE_RESTART_COSTS_ONE_RESTART_NOT_A_LOOP(box):
    # The watchdog restarts the daemon for its own reasons and does not write this marker, so the marker
    # can claim an older sha than the daemon truly runs. The consequence must be bounded: one redundant
    # restart into identical code, then quiet — never a restart every tick.
    _advance(box)
    box["mark"].write_text("0" * 40 + "\n")
    _run(box)
    assert box["called"].read_text().strip() == "restart"
    box["called"].unlink()
    r2 = _run(box)
    assert "nothing to do" in r2.stdout, r2.stdout
    assert not box["called"].exists(), "a stale marker caused a restart loop"


# ── the CONTENT gate: a sha that moved is not code that moved ─────────────────────────────────────
# Measured on vigil 2026-09-05 13:40:45: a restart to deploy `93a17e27`, a docs-only commit, dropped
# every live BLE link and re-ran bonding for a daemon whose code had not changed by one byte
# (VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT-2026-09-05 C4, §6.3). The rule under test: a restart is owed iff
# the daemon's sha ≠ HEAD AND `git diff --name-only <running>..HEAD -- capture-host/` is non-empty.
def test_A_DOCS_ONLY_DEPLOY_ADVANCES_THE_MARKER_AND_DOES_NOT_RESTART(box):
    _advance(box, path="README")
    r = _run(box)
    assert r.returncode == 0, r.stderr
    assert "updated" in r.stdout, "the fast-forward itself must still happen"
    assert "no capture-host/ change" in r.stdout, r.stdout
    assert not box["called"].exists(), "restarted a daemon whose code did not change"
    assert box["mark"].read_text().strip() == _head(box), "the marker must advance, or every later tick re-asks"
    # ...and the next tick has nothing to do: the debt was never real.
    r2 = _run(box)
    assert "nothing to do" in r2.stdout and not box["called"].exists()


def test_A_CAPTURE_HOST_CHANGE_STILL_RESTARTS(box):
    """The gate removes ONE case. Every test above that restarts now goes through it, and this one
    names the contract directly so a widened path filter cannot pass unnoticed."""
    _advance(box, path="capture-host/oxyii.py")
    r = _run(box)
    assert r.returncode == 0, r.stderr
    assert box["called"].read_text().strip() == "restart"
    assert "no capture-host/ change" not in r.stdout


def test_THE_GATE_IS_COARSE_ON_PURPOSE_a_tests_only_change_restarts(box):
    """`capture-host/` is the rule, verbatim from the brief. A tests-only change restarts a daemon that
    does not import its tests — that is over-restarting, which is the SAFE direction, and it is chosen
    rather than accidental: the gate exists to remove the gratuitous case, not to be clever about the
    marginal one, and a clever filter is a filter that one day excludes a module the daemon runs."""
    _advance(box, path="capture-host/tests/test_x.py")
    _run(box)
    assert box["called"].read_text().strip() == "restart"


def test_A_DOCS_ONLY_DEPLOY_DURING_A_RECORDING_IS_NOT_A_DEFERRAL(box):
    """Nothing is owed, so nothing is deferred: the marker advances even while a device records, and
    the morning tick finds no debt. Without this the docs-only delta would sit as a phantom debt all
    night and pay itself with a gratuitous restart at dawn."""
    _advance(box, path="README")
    _write_status(box["status"], {"Ring": True})
    r = _run(box)
    assert "deferred" not in r.stdout, r.stdout
    assert box["mark"].read_text().strip() == _head(box)
    _write_status(box["status"], {"Ring": False})
    r2 = _run(box)
    assert "nothing to do" in r2.stdout and not box["called"].exists()


def test_THE_GATE_DIFFS_FROM_WHAT_THE_DAEMON_RUNS_NOT_FROM_THE_LAST_TICK(box):
    """A code change deferred overnight, then a docs-only merge on top. Diffing the LAST tick's move
    (docs-only) would read the debt as paid; the debt is the whole range from the sha the daemon is on
    to HEAD, and that range contains the code change."""
    _advance(box)                                            # code
    _write_status(box["status"], {"Ring": True})
    _run(box)                                                # merged, deferred
    _advance(box, path="README")                             # docs, on top
    r2 = _run(box)                                           # still recording
    assert "deferred" in r2.stdout, r2.stdout
    assert "no capture-host/ change" not in r2.stdout, "the code change was diffed away"
    _write_status(box["status"], {"Ring": False})
    _run(box)
    assert box["called"].read_text().strip() == "restart", "the deferred code change was never deployed"


def test_A_MARKER_SHA_GIT_CANNOT_RESOLVE_FAILS_TOWARD_RESTART(box):
    """🔴 THE LOAD-BEARING CASE. The gate may only ever remove a restart it has PROVEN redundant. A marker
    sha git does not know (a stale marker, a rewritten history, a hand-edited file) gives NO answer, and
    no answer must fall back to the old behaviour — restart — not to "nothing changed". Planted as a
    docs-only delta on purpose: the diff alone would say skip; the unresolvable sha must override it."""
    _advance(box, path="README")
    box["mark"].write_text("0" * 40 + "\n")
    r = _run(box)
    assert box["called"].read_text().strip() == "restart", "an unknowable delta was read as 'nothing changed'"
    assert "cannot establish what changed" in r.stdout, r.stdout
    assert box["mark"].read_text().strip() == _head(box)


def test_FORCE_RESTART_BYPASSES_THE_GATE(box):
    """The operator asked for a restart, not for an opinion on whether one is needed."""
    _advance(box, path="README")
    r = _run(box, "--force-restart")
    assert r.returncode == 0, r.stderr
    assert box["called"].read_text().strip() == "restart"
    assert "no capture-host/ change" not in r.stdout


def test_NO_RESTART_MODE_DOES_NOT_REPORT_A_DOCS_ONLY_DELTA_AS_OWED(box):
    """The Deploy button branches on the RESTART-OWED token. After a docs-only fast-forward there is
    nothing to press Restart for, so the token must not appear — and the marker still advances, because
    the button's run IS the deploy."""
    _advance(box, path="README")
    r = _run(box, "--no-restart")
    assert r.returncode == 0, r.stderr
    assert "RESTART-OWED" not in r.stdout, r.stdout
    assert not box["called"].exists()
    assert box["mark"].read_text().strip() == _head(box)


def test_NO_RESTART_MODE_STILL_REPORTS_A_CODE_DELTA_AS_OWED(box):
    _advance(box)
    r = _run(box, "--no-restart")
    assert "RESTART-OWED" in r.stdout and not box["called"].exists()


# ── the default marker path must be writable by the service that writes it ────────────────────────
# 🔴 WHY THIS TEST EXISTS. Every test above passes TEPNA_DEPLOYED_MARK pointing into tmp_path, so not
# one of them ever exercised the DEFAULT — which is precisely the thing that was broken. The marker
# shipped pointing at /run/tepna-deployed-sha; `tepna-update.service` runs as `vigil` and /run is
# root-owned 0755, so the write failed on the first real deploy and the whole deferred-restart fix was
# inert. It degraded safely, which is what made it invisible: nothing broke, a fix just did not work.
#
# An injected path is the right way to test BEHAVIOUR and is structurally incapable of testing the
# default. So the default is asserted here, statically, against the directory the service demonstrably
# owns — the same one it already reads status.json out of.
def _script_default(var):
    for line in open(UPD, encoding="utf-8").read().splitlines():
        if line.startswith(var + "="):
            return line.split(":-", 1)[1].rstrip('}"')
    return None


def test_THE_MARKER_DEFAULTS_SOMEWHERE_THE_SERVICE_USER_CAN_WRITE():
    mark = _script_default("DEPLOYED_MARK")
    status = _script_default("STATUS_JSON")
    assert mark and status, "could not read the script's defaults"
    # status.json's directory is written by the daemon as `vigil` on every status tick, so its root is
    # a demonstrated-writable location rather than an assumed one.
    root = "/" + status.strip("/").split("/")[0] + "/" + status.strip("/").split("/")[1]
    assert mark.startswith(root + "/"), (
        f"the marker defaults to {mark}, which is outside {root} — the only directory this service is "
        f"known to be able to write. /run is root-owned and the service runs as vigil."
    )


def test_THE_MARKER_IS_NOT_INSIDE_THE_REPO_CHECKOUT():
    # The other half of the constraint, and it still holds: §1 refuses to update a dirty checkout, so a
    # marker inside $REPO_DIR would make the script decline to deploy anything at all.
    mark = _script_default("DEPLOYED_MARK")
    repo = _script_default("REPO_DIR")
    assert mark and repo
    assert not mark.startswith(repo.rstrip("/") + "/"), (
        f"the marker is inside {repo}; the cleanliness check would see it and refuse every update"
    )


def test_A_MARKER_THAT_CANNOT_BE_WRITTEN_WARNS_AND_DOES_NOT_ABORT_THE_DEPLOY(box, tmp_path):
    # It degraded safely on the box, and that must stay true: an unwritable marker is a lost debt
    # record, not a reason to leave new code undeployed.
    unwritable = tmp_path / "nodir" / "mark"
    _advance(box)
    r = _run(box, TEPNA_DEPLOYED_MARK=str(unwritable))
    assert box["called"].read_text().strip() == "restart", "a marker failure blocked the restart"
    assert "could not record" in (r.stdout + r.stderr), "the marker failure was silent"


# ── the DEFERRAL streak (VIGIL-AUTO-UPDATE-FOLLOWUPS §4, second box) ─────────────────────────────
# `deferred` is this script working, so it stays INFO-level prose. What it could not say is "…and it
# has been saying this since Tuesday". Measured over 13 days: 17 streaks, median 8.27 h, max 70.09 h,
# 68.6 % of the window running on-disk-but-not-loaded code. These tests are about the DISTINCTION
# between a normal night's deferral and a debt that outlived a day — flattening those is what made the
# 70 h case invisible.

def _defer_state(box):
    """`(count, first_epoch)` from the marker, or None when there is no streak."""
    if not box["defers"].exists():
        return None
    n, first = box["defers"].read_text().split()
    return int(n), int(first)


def test_a_deferral_is_COUNTED_and_stays_quiet_below_the_bar(box):
    """A normal night. The deferral line prints as it always did and NOTHING is escalated — at 4 h a
    bar would fire on 16 of 17 real streaks, which is a warning that teaches its reader to skip it."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    r = _run(box)
    assert "deferred — a device is recording" in r.stdout
    assert "NOT LOADED" not in r.stderr, "a single night's deferral must not warn"
    assert _defer_state(box) == (1, _defer_state(box)[1])
    assert _defer_state(box)[0] == 1


def test_the_streak_ACCUMULATES_across_ticks_and_keeps_the_FIRST_timestamp(box):
    """The whole point: the debt is dated from when it was incurred, not from the latest tick. A
    streak that re-stamped `first` every time could never report a duration at all."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    _run(box)
    first_seen = _defer_state(box)[1]
    _run(box)
    _run(box)
    assert _defer_state(box) == (3, first_seen), "count rises, the start does not move"


def test_a_debt_OLDER_THAN_THE_BAR_escalates_to_a_warning_that_names_the_span(box):
    """🔴 The 70.09 h case. Backdate the streak past the bar and the tick must say so at WARN level —
    with the span and the first-deferred stamp, so the reader learns "since when" and not "again"."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    _run(box)
    n, _ = _defer_state(box)
    box["defers"].write_text("%d %d\n" % (n, int(time.time()) - 30 * 3600))
    r = _run(box)
    assert "NOT LOADED for 30h" in r.stderr
    assert "first deferred at" in r.stderr
    assert "an idle window was available and not taken" in r.stderr
    assert "deferred — a device is recording" in r.stdout, "the normal line is still printed"


def test_the_bar_is_CONFIGURABLE_and_the_default_does_not_fire_at_the_median_streak(box):
    """8.27 h is the MEDIAN real streak. The default bar must be silent there, or it is measuring
    "a night happened" rather than "something is wrong"."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    _run(box)
    n, _ = _defer_state(box)
    box["defers"].write_text("%d %d\n" % (n, int(time.time()) - int(8.27 * 3600)))
    assert "NOT LOADED" not in _run(box).stderr, "the median night must not warn"
    box["defers"].write_text("%d %d\n" % (n, int(time.time()) - int(8.27 * 3600)))
    r = _run(box, TEPNA_DEFER_WARN_HOURS="4")
    assert "NOT LOADED for 8h" in r.stderr, "a box that wants a tighter bar can set one"


def test_a_RESTART_clears_the_streak_and_reports_how_long_it_ran(box):
    """The other half of the ask. Whoever reads the journal after the fact needs the duration, and by
    then every deferring tick is behind them."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    _run(box)
    box["defers"].write_text("5 %d\n" % (int(time.time()) - 9 * 3600,))
    _write_status(box["status"], {"Ring": False})
    r = _run(box)
    assert "daemon restarted on" in r.stdout
    assert "the deferral streak is over: 5 deferral(s) spanning 9h" in r.stdout
    assert _defer_state(box) is None, "a paid debt leaves no marker"


def test_the_CONTENT_GATE_proving_a_restart_redundant_also_clears_the_streak(box):
    """§5b advances the marker without restarting when the delta is docs-only. That pays the debt just
    as truly as a restart does — leaving the streak open would keep reporting a debt that is gone.

    The state is CONSTRUCTED rather than driven, because the ordinary path cannot reach it: the content
    gate runs before the recording interlock, so a docs-only change never defers in the first place.
    What reaches it is an outstanding debt whose delta has SINCE become docs-only — a revert of the
    capture-host commit that was deferred on, or an outside restart that moved the daemon forward
    without updating the marker. Rare, and exactly why it is worth pinning: nobody will drive it by
    hand, and a stale streak here would outlive the debt it describes."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    _run(box)
    assert _defer_state(box)[0] == 1, "the debt is real and the streak is open"
    # The daemon is now on HEAD (an outside restart), and the only new commit is docs-only.
    head = _git(box["repo"], "rev-parse", "HEAD").stdout.strip()
    box["mark"].write_text(head + "\n")
    _advance(box, path="README")
    _write_status(box["status"], {"Ring": False})
    r = _run(box)
    assert "no capture-host/ change" in r.stdout
    assert "the deferral streak is over" in r.stdout
    assert _defer_state(box) is None
    assert str(box["called"]) and not box["called"].exists(), "…and nothing was restarted"


def test_a_HEALTHY_box_never_mentions_the_streak_at_all(box):
    """Silence is the correct output when there is nothing to say. A line on every tick would be the
    same noise the bar exists to avoid, one level down."""
    _advance(box)
    r = _run(box)
    assert "deferral streak" not in r.stdout and "NOT LOADED" not in r.stderr
    assert _defer_state(box) is None


def test_an_UNKNOWN_recording_state_counts_as_a_deferral_because_it_is_one(box):
    """The catch-all branch defers too, and it is the one that can persist for a whole night — the same
    reason the failure counter is keyed on the exit status rather than on `die`. Excluding it would omit
    exactly the longest-running kind."""
    _advance(box)
    box["status"].write_text("{ truncated")
    r = _run(box)
    assert "refusing to restart blind" in r.stderr
    assert _defer_state(box)[0] == 1


def test_a_CORRUPT_marker_reads_as_no_streak_and_never_stops_the_update(box):
    """An observability aid must never be the reason the box stops updating. Malformed content starts a
    fresh streak rather than aborting, matching the failure counter's own rule."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    for junk in ("", "garbage\n", "notanumber 123\n", "3 notanepoch\n"):
        box["defers"].write_text(junk)
        r = _run(box)
        assert "deferred — a device is recording" in r.stdout, junk
        assert _defer_state(box) == (1, _defer_state(box)[1]), junk


def test_an_UNWRITABLE_marker_warns_but_the_deploy_still_proceeds(box, tmp_path):
    """Same degradation as the deployed-SHA marker: the aid fails, the deploy does not."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    r = _run(box, TEPNA_DEFER_MARK=str(tmp_path / "no-such-dir" / "defers"))
    assert "could not record the deferral streak" in r.stderr
    assert "deferred — a device is recording" in r.stdout


# ── --pending-only: the PATIENT restart (§4, first box, owner-ordered 2026-09-07) ────────────────
# `--force-restart` covers the impatient operator. Nothing covered the box that merged at 23:50 and
# waited for the next 30-minute tick to re-ask a question whose answer changed the moment the last
# device stopped — median 8.27 h of running on-disk-but-not-loaded code. This mode runs the SAME step
# 5 and skips only the fetch, so it is cheap enough to put on a two-minute timer.

def test_pending_only_with_NOTHING_OWED_is_silent_and_costs_nothing(box):
    """🔴 The design's whole basis. At a two-minute cadence a line per tick is 720 journal lines a day
    in the unit whose legibility §4 is about — and it must not fetch, because 720 fetches a day is the
    other reason a fast timer would be unacceptable."""
    _advance(box)
    _run(box)                                  # normal tick: merges and restarts, marker now at HEAD
    r = _run(box, "--pending-only")
    assert r.returncode == 0
    assert r.stdout == "" and r.stderr == "", "a healthy box says nothing at all"


def test_pending_only_RESTARTS_a_debt_the_moment_the_box_goes_idle(box):
    """The night's shape: merge while recording (deferred), then the subject takes the sensor off. The
    patient tick must take it without waiting for the next half-hourly wake-up."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    _run(box)
    assert "deferred — a device is recording" in _run(box).stdout
    assert not box["called"].exists(), "still recording, so nothing restarted"

    _write_status(box["status"], {"Ring": False})
    r = _run(box, "--pending-only")
    assert "box is idle — restarting the daemon" in r.stdout
    assert box["called"].read_text().strip() == "restart"
    assert box["mark"].read_text().strip() == _git(box["repo"], "rev-parse", "HEAD").stdout.strip()


def test_pending_only_still_DEFERS_while_the_box_is_recording(box):
    """It is the same interlock, not a second one — a fast timer must not become a way around it."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    _run(box)
    r = _run(box, "--pending-only")
    assert "deferred — a device is recording" in r.stdout
    assert not box["called"].exists()


def test_pending_only_NEVER_FETCHES_so_it_cannot_deploy_new_code_by_itself(box):
    """It closes an OUTSTANDING debt; it does not open one. A commit that has not been pulled must stay
    unpulled — otherwise the two-minute timer becomes a two-minute deploy cadence, which is a different
    change than the one the owner ordered."""
    head_before = _git(box["repo"], "rev-parse", "HEAD").stdout.strip()
    _advance(box)                               # new commit exists upstream, NOT yet on the box
    r = _run(box, "--pending-only")
    assert r.stdout == "" and r.stderr == ""
    assert _git(box["repo"], "rev-parse", "HEAD").stdout.strip() == head_before, "no fetch, no merge"
    assert not box["called"].exists()


def test_pending_only_with_an_ABSENT_marker_does_nothing_because_it_is_an_ACCELERATOR(box):
    """An absent marker leaves this mode with nothing to act on, and it exits silently.

    That reads like the fail-toward-restart rule being broken, and it is worth being explicit about why
    it is not. This mode never fetches, so `before` and `after` are the same local HEAD and cannot
    reveal a debt by themselves — the marker is the only witness. Its contract is an ACCELERATOR's: it
    closes debts the ordinary tick already RECORDED, it cannot discover one, and it is not the backstop.
    The half-hourly `auto` run still is, and it writes the marker on every restart and every deferral.
    A lost marker blinds that path identically (`running_sha` falls back to `$before` there too), so
    this adds no blind spot — it declines to invent a debt out of no information."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    _run(box)
    assert box["mark"].exists(), "the deferral recorded the debt"
    box["mark"].unlink()
    r = _run(box, "--pending-only")
    assert r.stdout == "" and r.stderr == ""
    assert not box["called"].exists(), "and above all it did not restart a box it knows nothing about"
    # …while the ordinary tick, which fetches, remains the backstop and is not silent.
    assert "up to date" in _run(box).stdout


def test_pending_only_honours_the_content_gate_and_does_not_restart_for_docs(box):
    """Same gate, same reasoning: a restart drops every live BLE link, and at a two-minute cadence a
    gate that leaked would multiply that cost by the timer's frequency."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    _run(box)
    head = _git(box["repo"], "rev-parse", "HEAD").stdout.strip()
    box["mark"].write_text(head + "\n")
    _advance(box, path="README")
    _git(box["repo"], "fetch", "-q", "origin", "main")
    _git(box["repo"], "merge", "-q", "--ff-only", "origin/main")
    _write_status(box["status"], {"Ring": False})
    r = _run(box, "--pending-only")
    assert "no capture-host/ change" in r.stdout
    assert not box["called"].exists(), "a docs-only delta must not restart, however often we look"


def test_an_unknown_mode_is_still_refused_and_the_usage_names_the_new_one(box):
    r = _run(box, "--nonsense")
    assert r.returncode != 0 and "--pending-only" in r.stderr


# ── one run at a time ─────────────────────────────────────────────────────────────────────────────

def test_a_SECOND_run_does_not_restart_the_daemon_a_second_time(box):
    """🔴 The reason the lock exists, and the reason it is taken BEFORE the marker is read. With the
    two-minute `--pending-only` timer alongside the hourly tick, two runs can overlap for the first
    time — and the restart decision is read-then-act on the marker. Both would read the OLD marker,
    both conclude a restart is owed, and both restart: the daemon's BLE links drop TWICE and bonding
    re-runs twice, for one debt."""
    _advance(box)
    _write_status(box["status"], {"Ring": True})
    _run(box)                                    # merged, deferred: the debt is recorded
    _write_status(box["status"], {"Ring": False})

    import fcntl
    box["lock"].touch()
    with open(box["lock"], "w") as held:         # stand in for the other run, holding the lock
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        blocked = _run(box, "--pending-only")
        assert blocked.returncode == 0, "a lost race is not a failure"
        assert blocked.stdout == "" and blocked.stderr == "", "and the fast timer says nothing"
        assert not box["called"].exists(), "above all, it did not restart"
        hourly = _run(box)
        assert "holds the lock" in hourly.stdout, "an hourly tick DOES say why it did nothing"
        assert not box["called"].exists()

    # …and with the lock free, the same run restarts exactly once.
    r = _run(box, "--pending-only")
    assert "restarting the daemon" in r.stdout
    assert box["called"].read_text().strip() == "restart"


def test_an_UNWRITABLE_lock_path_degrades_OPEN_and_prints_nothing(box, tmp_path):
    """A box that cannot lock must still be able to finish a deploy — the failure this guards against
    costs a reconnect, not a night. And it must degrade SILENTLY: the shell reports a failed redirection
    on its own stderr, which is why the probe is wrapped in a subshell. Without that wrapper this path
    printed 'No such file or directory' on every single run, into the journal of the unit the lock
    exists to keep quiet."""
    _advance(box)
    r = _run(box, TEPNA_LOCK_FILE=str(tmp_path / "no-such-dir" / "update.lock"))
    assert r.returncode == 0
    assert "No such file" not in r.stdout and "No such file" not in r.stderr
    assert "restarting the daemon" in r.stdout, "the deploy still completes without a lock"
