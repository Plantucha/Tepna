# tepna-capture — tests/test_system_file_drift.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`nightqc.system_file_drift` — the nightly deploy-drift check.

It exists because `check-system-files.sh` was the ONLY instrument that could see an installed helper
diverging from the repo and nothing ran it on a schedule: on 2026-08-15 `tepna-restart.sh` was found
missing the `deploy` verb, a fix that had been MERGED FOR A DAY with CI green while the field stayed
broken. Every test here pins the same principle — an unhappy path must yield `None`, never a zeroed
record, because zeros read as "nothing has drifted" and that is the one wrong answer available.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nightqc  # noqa: E402


class _Done:
    def __init__(self, stdout="", returncode=0):
        self.stdout, self.returncode = stdout, returncode


_GOOD = {"managed": 11, "drifted": 2, "managedDrifted": 1, "superseded": 1,
         "ambiguous": 0, "missing": 0}


def _script(tmp_path):
    p = tmp_path / "check-system-files.sh"
    p.write_text("#!/bin/sh\nexit 0\n")
    return str(p)


def test_it_returns_the_counts_and_the_exit_code(tmp_path):
    got = nightqc.system_file_drift(
        _script(tmp_path), marker=str(tmp_path),
        runner=lambda *a, **k: _Done(json.dumps(_GOOD), 1))
    assert got["managed"] == 11 and got["superseded"] == 1
    assert got["exit"] == 1, "the exit code is recorded even though the counts are the product"


def test_managedDrifted_and_superseded_are_reported_SEPARATELY(tmp_path):
    """They need OPPOSITE responses — `--install` versus a hand `rm` the script never performs — so a
    consumer must not have to infer one from the other. `drifted` already INCLUDES `superseded`."""
    got = nightqc.system_file_drift(
        _script(tmp_path), marker=str(tmp_path),
        runner=lambda *a, **k: _Done(json.dumps(_GOOD), 1))
    assert got["managedDrifted"] + got["superseded"] == got["drifted"]


def test_a_dev_checkout_makes_no_claim(tmp_path):
    """Nothing is installed, so nothing can have drifted — and shelling out every night would be noise."""
    assert nightqc.system_file_drift(_script(tmp_path), marker=str(tmp_path / "absent")) is None


def test_a_missing_script_makes_no_claim(tmp_path):
    assert nightqc.system_file_drift(str(tmp_path / "gone.sh"), marker=str(tmp_path)) is None


def test_a_timeout_makes_no_claim_rather_than_breaking_QC(tmp_path):
    def _boom(*a, **k):
        raise TimeoutError("took too long")
    assert nightqc.system_file_drift(_script(tmp_path), marker=str(tmp_path), runner=_boom) is None


def test_unparseable_output_makes_no_claim(tmp_path):
    got = nightqc.system_file_drift(_script(tmp_path), marker=str(tmp_path),
                                    runner=lambda *a, **k: _Done("not json at all", 1))
    assert got is None


def test_empty_output_makes_no_claim(tmp_path):
    assert nightqc.system_file_drift(_script(tmp_path), marker=str(tmp_path),
                                     runner=lambda *a, **k: _Done("", 0)) is None


def test_a_json_scalar_is_rejected_not_indexed(tmp_path):
    """`json.loads("7")` succeeds and returns an int; assigning `out["exit"]` to it would raise."""
    assert nightqc.system_file_drift(_script(tmp_path), marker=str(tmp_path),
                                     runner=lambda *a, **k: _Done("7", 0)) is None


def test_only_the_LAST_line_is_parsed(tmp_path):
    """The script routes its human report to /dev/null under --json, but a stray line must not defeat it."""
    got = nightqc.system_file_drift(
        _script(tmp_path), marker=str(tmp_path),
        runner=lambda *a, **k: _Done("some warning\n" + json.dumps(_GOOD), 0))
    assert got["managed"] == 11


def test_it_does_NOT_feed_the_ok_verdict():
    """A drifted deploy file is an operator action, not a bad night's capture. QC already returns
    ok=false on ~10 of 11 nights for a benign doffing gap; another axis in an alarm nobody reads is
    worth nothing. Pinned by source so the coupling cannot be added quietly."""
    src = open(nightqc.__file__, encoding="utf-8").read()
    ok_line = [l for l in src.splitlines() if l.strip().startswith('"ok":')]
    assert ok_line, "the ok verdict moved; re-point this test"
    assert "system_files" not in " ".join(ok_line)


# ── the checkout must be CLEAN, not merely current ──────────────────────────────────────────────────
def _git(tmp_path):
    (tmp_path / ".git").mkdir(exist_ok=True)
    return str(tmp_path)


def test_a_clean_checkout_reports_clean(tmp_path):
    assert nightqc._checkout_clean(_git(tmp_path),
                                   runner=lambda *a, **k: _Done("", 0)) is True


def test_a_DIRTY_checkout_reports_dirty(tmp_path):
    """One stray untracked file halts every future deploy; the only outward sign is a failed unit on a
    box nobody logs into. `?? capture-host/vigil.sh` is the shape that actually did it."""
    assert nightqc._checkout_clean(_git(tmp_path),
                                   runner=lambda *a, **k: _Done("?? capture-host/vigil.sh\n", 0)) is False


def test_a_mode_change_counts_as_dirty(tmp_path):
    """`core.fileMode=true` here, so `chmod +x` on a tracked file IS a modification — fixing an exec bit
    by hand creates the very dirt that blocks the updater."""
    assert nightqc._checkout_clean(_git(tmp_path),
                                   runner=lambda *a, **k: _Done(" M capture-host/tepna-update.sh\n", 0)) is False


def test_no_git_dir_makes_no_claim(tmp_path):
    assert nightqc._checkout_clean(str(tmp_path)) is None


def test_a_failing_git_makes_no_claim(tmp_path):
    assert nightqc._checkout_clean(_git(tmp_path),
                                   runner=lambda *a, **k: _Done("", 128)) is None


def test_a_raising_git_makes_no_claim_rather_than_breaking_QC(tmp_path):
    def _boom(*a, **k):
        raise OSError("git not found")
    assert nightqc._checkout_clean(_git(tmp_path), runner=_boom) is None


def test_the_drift_record_carries_the_clean_flag(tmp_path):
    got = nightqc.system_file_drift(
        _script(tmp_path), marker=str(tmp_path),
        runner=lambda *a, **k: _Done(json.dumps(_GOOD), 1))
    assert "checkout_clean" in got, "a HEAD-only view lags the breakage by up to one merge"


# ── the REAL subprocess path ────────────────────────────────────────────────────────────────────────
# ⚠️ EVERY TEST ABOVE INJECTS A RUNNER, so `run = runner or subprocess.run` only ever takes its truthy
# side under test. The falsy side is reached solely by `summarize()`'s real call — which happens on a
# machine where `/usr/local/lib/tepna` exists (a former capture host) and returns early on one where it
# does not (CI). So the branch was complete locally and PARTIAL on CI, and the coverage floor failed
# there while reading 100 % here. That is `CLAUDE.md`'s "a green local gate is evidence about this
# machine", in its branch-coverage form. These two tests take the real path deliberately.


def test_the_real_subprocess_path_runs(tmp_path):
    """No runner injected: `subprocess.run` executes the script for real. It prints nothing, so the
    result is `None` — the point is which BRANCH was taken, not the verdict."""
    p = tmp_path / "check-system-files.sh"
    p.write_text("#!/bin/sh\nexit 0\n")
    assert nightqc.system_file_drift(str(p), marker=str(tmp_path)) is None


def test_the_real_subprocess_path_parses_real_output(tmp_path):
    """And with a script that actually emits the JSON line, the real path returns counts."""
    p = tmp_path / "check-system-files.sh"
    p.write_text("#!/bin/sh\necho '%s'\nexit 1\n" % json.dumps(_GOOD))
    got = nightqc.system_file_drift(str(p), marker=str(tmp_path))
    assert got is not None and got["managed"] == 11 and got["exit"] == 1


def test_checkout_clean_takes_the_real_git_path(tmp_path):
    """Same branch, same reason, in `_checkout_clean`. A `.git` directory that is not a repository makes
    real `git status` exit non-zero, so this returns None — again, the branch is the point."""
    (tmp_path / ".git").mkdir()
    assert nightqc._checkout_clean(str(tmp_path)) is None
