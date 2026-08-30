# tepna-capture — build_id.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# WHAT CODE IS THIS DAEMON ACTUALLY RUNNING?
#
# The Dex bundles show a version because a build stamps one in. The capture host has no build step, so
# the monitor has never shown anything, and "did the deploy land?" has been answered all day by ssh'ing
# in and comparing SHAs by hand.
#
# 🔴 READ ONCE, AT STARTUP, AND HOLD IT. The obvious implementation — `git rev-parse` when the request
# arrives — is wrong in exactly the situation the indicator exists for. A deploy writes new files into
# /opt/tepna and the daemon keeps serving the old code until it restarts; a request-time rev-parse
# reports the NEW sha while the OLD code answers the request. That is the "is X deployed?" question
# answering itself wrongly, one layer in. Measured on this box 2026-08-30: the checkout sat at
# 2618f8f9 while `ActiveEnterTimestamp` showed the process had started 30 minutes earlier, on
# da2c55b6. A request-time probe would have reported 2618f8f9 both times.
#
# `started` is the discriminator that makes the SHA checkable: a SHA that changed without `started`
# moving means something re-read the tree, not that new code is running.
#
# 🔴 AND A GIT THAT CANNOT ANSWER MUST RENDER UNKNOWN, NOT CLEAN. A tarball deploy has no `.git`, and
# `git status` failing is not evidence of a clean tree. Reporting `dirty: false` there would be a
# fabricated negative — the same honest-absence rule the Clock Contract applies to timestamps
# (§2.6: a missing observation is visible, never a fabricated value).

from __future__ import annotations

import subprocess
import time

__all__ = ["probe", "UNKNOWN"]

UNKNOWN = None      # named, so a reader sees the absence is deliberate rather than a forgotten default


def _git(repo_dir, args, run=None, timeout=5.0):
    """One `git` invocation, or None on ANY failure. Never raises."""
    runner = run or subprocess.run
    try:
        p = runner(["git", "-C", str(repo_dir), *args],
                   capture_output=True, text=True, timeout=timeout)
    except Exception:
        # A missing git, a missing repo, a timeout on a slow disk — all the same answer: we do not
        # know. Distinguishing them would invite a caller to treat some of them as "clean".
        return None
    if getattr(p, "returncode", 1) != 0:
        return None
    return (p.stdout or "").strip()


def probe(repo_dir, run=None, now=None):
    """`{"git": sha|None, "dirty": bool|None, "started": epoch}` — call ONCE at startup.

    `dirty` is a TRISTATE and the third state is the point: `None` means git could not tell us, which
    is not the same as a clean tree and must never be rendered as one."""
    sha = _git(repo_dir, ["rev-parse", "--short", "HEAD"], run=run)
    dirty = UNKNOWN
    if sha:
        # Only ask about dirtiness once we know it is a repo at all; otherwise a `None` here would be
        # indistinguishable from "git works, tree is unreadable".
        porcelain = _git(repo_dir, ["status", "--porcelain"], run=run)
        if porcelain is not None:
            dirty = bool(porcelain)
    return {"git": sha or UNKNOWN, "dirty": dirty, "started": float(now if now is not None else time.time())}
