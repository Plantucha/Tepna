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

# Root-owned deploy targets, most-preferred first. /opt/tepna is the path the CAPTURE-HOST brief uses on
# the real box; /usr/local/lib/tepna suits a workstation where the repo sits on a non-root filesystem.
SYSTEM_DIRS = ("/usr/local/lib/tepna", "/opt/tepna/capture-host")
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
