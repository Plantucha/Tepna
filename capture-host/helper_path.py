# tepna-capture — helper_path.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Locate a PRIVILEGED helper script (the NOPASSWD-sudo ones: tepna-clock.sh, tepna-rssi.sh).
#
# WHY THIS EXISTS — a sudoers NOPASSWD grant must point at a file the invoking user CANNOT rewrite.
# Otherwise it is a privilege-escalation hole: anything running as that user (a compromised browser tab,
# a malicious pip/npm package, or one of the several agent sessions that concurrently write this repo)
# can overwrite the script and get instant passwordless root. This checkout lives on an NTFS volume
# mounted `uid=1000,gid=1000`, where ownership/permissions are synthesized and every file is
# user-writable — so granting sudo on the in-repo copy is exactly that hole.
#
# Resolution order: a ROOT-OWNED system copy first, the in-repo copy last. Deploy with
#   sudo install -D -o root -g root -m 0755 <repo>/capture-host/tepna-rssi.sh /usr/local/lib/tepna/tepna-rssi.sh
# and grant sudoers on the /usr/local/lib/tepna path only. The in-repo fallback keeps a dev box working:
# `sudo -n` simply fails there and every caller already degrades gracefully.

from __future__ import annotations
import os

# Where `resolve` looks, most-preferred first.
#
# ⚠️ ONLY THE FIRST IS A ROOT-OWNED DEPLOY TARGET. This comment used to call BOTH "root-owned deploy
# targets", which is false and load-bearing: `/opt/tepna/capture-host` is the CHECKOUT, and it is
# vigil-owned BY DESIGN — `tepna-update.sh` has to be able to write it to complete a deploy. So the
# second entry is a DEVELOPMENT FALLBACK, and a path resolved from it must never hold a sudoers grant.
# Measured on the box: `-rwxrwxr-x vigil`. `grant_warning` below exists to say so out loud, and until
# 2026-08-14 nothing called it.
SYSTEM_DIRS = ("/usr/local/lib/tepna", "/opt/tepna/capture-host")

# Every helper this codebase invokes under sudo. Listed HERE so the boot self-test can check them in one
# place, rather than each call site remembering to — which is how the check came to exist with no caller.
SUDO_HELPERS = ("tepna-restart.sh", "tepna-btreset.sh", "tepna-usbreset.sh",
                "tepna-clock.sh", "tepna-rssi.sh", "tepna-wifi.sh")
_HERE = os.path.dirname(os.path.abspath(__file__))


def resolve(name: str) -> str:
    """Absolute path to helper `name` — a root-owned system copy if one exists, else the in-repo copy
    (which is returned even when absent, so callers keep their existing 'missing helper' handling)."""
    for d in SYSTEM_DIRS:
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    return os.path.join(_HERE, name)


def is_safely_owned(path: str) -> bool:
    """True when `path` is root-owned and NOT group/world writable — i.e. safe to hold a sudoers grant.
    False for the in-repo copy on a user-writable mount, which is the case we must never grant."""
    try:
        st = os.stat(path)
    except OSError:
        return False
    return st.st_uid == 0 and not (st.st_mode & 0o022)


def grant_warning(path: str) -> str | None:
    """A one-line warning when a helper would be run under sudo from an unsafe location, or None."""
    if is_safely_owned(path):
        return None
    return (f"privileged helper {path} is not root-owned/read-only — a NOPASSWD sudo grant on it is a "
            f"privilege-escalation risk; deploy it to {SYSTEM_DIRS[0]} (root:root 0755) and grant that path")
