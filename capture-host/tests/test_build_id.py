# tepna-capture — tests/test_build_id.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""What code is the daemon actually running?

The owner's ask: the vigil monitor shows no version, unlike the Dex apps. The capture host has no
build step to stamp one in, so this reads the daemon's OWN identity at startup.
"""

from __future__ import annotations

import subprocess
import types

import build_id


def _runner(table):
    """A fake `subprocess.run` keyed on the git subcommand."""
    def _run(argv, **_kw):
        key = argv[3] if len(argv) > 3 else ""
        rc, out = table.get(key, (1, ""))
        if isinstance(out, Exception):
            raise out
        return types.SimpleNamespace(returncode=rc, stdout=out, stderr="")
    return _run


def test_A_HEALTHY_REPO_REPORTS_ITS_SHA_AND_CLEANLINESS():
    info = build_id.probe("/repo", run=_runner({"rev-parse": (0, "a1b2c3d\n"),
                                                "status": (0, "")}), now=99.0)
    assert info == {"git": "a1b2c3d", "dirty": False, "started": 99.0}


def test_A_DIRTY_TREE_SAYS_SO():
    info = build_id.probe("/repo", run=_runner({"rev-parse": (0, "a1b2c3d"),
                                                "status": (0, " M capture.py\n")}))
    assert info["dirty"] is True


# ── the honest-absence rule ───────────────────────────────────────────────────────────────────────
def test_A_GIT_THAT_CANNOT_ANSWER_IS_UNKNOWN_NOT_CLEAN():
    """🔴 The assertion this module exists for.

    A tarball deploy has no `.git`. `git status` failing is not evidence of a clean tree, and
    reporting `dirty: false` there would be a fabricated negative — a deploy tree of unknown
    provenance rendering as pristine. `None` is the third state and it must survive to the caller."""
    info = build_id.probe("/repo", run=_runner({}))       # every git call fails
    assert info["git"] is None
    assert info["dirty"] is None, "a git failure was rendered as a clean tree"
    assert info["dirty"] is not False


def test_A_READABLE_SHA_WITH_AN_UNREADABLE_STATUS_IS_STILL_UNKNOWN():
    # Half an answer is not an answer: we know WHICH commit, and nothing about whether the tree
    # matches it. Defaulting that to clean is the same fabrication as above.
    info = build_id.probe("/repo", run=_runner({"rev-parse": (0, "a1b2c3d")}))
    assert info["git"] == "a1b2c3d" and info["dirty"] is None


def test_A_MISSING_GIT_BINARY_IS_NOT_A_CRASH():
    info = build_id.probe("/repo", run=_runner({"rev-parse": (0, FileNotFoundError("no git"))}))
    assert info["git"] is None and info["dirty"] is None


def test_A_TIMEOUT_IS_NOT_A_CRASH():
    boom = subprocess.TimeoutExpired(cmd="git", timeout=5)
    info = build_id.probe("/repo", run=_runner({"rev-parse": (0, boom)}))
    assert info["git"] is None


def test_A_NONZERO_EXIT_IS_NOT_AN_ANSWER():
    info = build_id.probe("/repo", run=_runner({"rev-parse": (128, "fatal: not a git repository")}))
    assert info["git"] is None


def test_STARTED_IS_RECORDED_SO_THE_SHA_IS_CHECKABLE():
    """`started` is what makes the SHA mean 'running' rather than 'on disk'.

    A SHA that changed without `started` moving means something re-read the tree, not that new code
    is serving — which is exactly the confusion this indicator exists to end."""
    info = build_id.probe("/repo", run=_runner({"rev-parse": (0, "a1b2c3d"), "status": (0, "")}),
                          now=1234.5)
    assert info["started"] == 1234.5


def test_IT_READS_THE_REPO_IT_IS_POINTED_AT():
    seen = []

    def _run(argv, **_kw):
        seen.append(argv)
        return types.SimpleNamespace(returncode=0, stdout="a1b2c3d", stderr="")

    build_id.probe("/opt/tepna", run=_run)
    assert seen[0][:3] == ["git", "-C", "/opt/tepna"]
