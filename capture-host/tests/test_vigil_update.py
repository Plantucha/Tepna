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
            "mark": tmp_path / "deployed-sha"}


def _write_status(path, devices, top=None, publish=True, age=0.0):
    d = {"updated": "now", "devices": {n: ({"connected": True, "recording": r} if publish
                                           else {"connected": True}) for n, r in devices.items()}}
    if publish:
        d["recording"] = any(devices.values()) if top is None else top
    path.write_text(json.dumps(d))
    if age:
        t = time.time() - age
        os.utime(path, (t, t))


def _run(box, **env):
    e = {**os.environ,
         "TEPNA_REPO_DIR": str(box["repo"]), "TEPNA_STATUS_JSON": str(box["status"]),
         "TEPNA_RESTART_SH": str(box["helper"]), "TEPNA_SUDO": "env",
         "TEPNA_DEPLOYED_MARK": str(box["mark"]), **env}
    return subprocess.run(["bash", UPD], capture_output=True, text=True, env=e)


def _advance(box):
    """Land a new commit upstream, so the checkout has something to fast-forward to."""
    (box["up"] / "README").write_text("v2\n")
    _git(box["up"], "add", "README"); _git(box["up"], "commit", "-qm", "v2")


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
    assert verbs <= {"status", "rev-parse", "fetch", "merge"}, (
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
