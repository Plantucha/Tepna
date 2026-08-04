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

    return {"up": up, "repo": repo, "status": status, "helper": helper, "called": called}


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
         "TEPNA_RESTART_SH": str(box["helper"]), "TEPNA_SUDO": "env", **env}
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
