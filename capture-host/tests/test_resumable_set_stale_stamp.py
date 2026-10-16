# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The STALE-STAMP guard in `resumable_set`.

2026-10-14: a 06:31 O2Ring file-set was resumed at 18:01 for a 21:53 session because a
stored-session pull had freshened the files' MTIME. MTIME is not data-recency. The evening
data was written to morning-stamped files, which banded to the wrong night (10/13 instead
of 10/14), and the 10/14 night showed no O2Ring.

The guard: if the set's stamp is older than the resume window by an order of magnitude
(> window * 12), do not resume — even if MTIME is fresh. Mint a fresh set instead.
"""

import datetime as dt
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from writers import resumable_set


def _make_set(tmpdir, stamp_str, mtime_age_s):
    """Create a fake device file-set with the given stamp and MTIME age."""
    d = os.path.join(tmpdir, "2026-10-14")
    os.makedirs(d, exist_ok=True)
    fname = f"Wellue_O2Ring-S_S8AW2100_{stamp_str}_PPG.txt"
    path = os.path.join(d, fname)
    with open(path, "w") as f:
        f.write("# test\n")
    # Set MTIME to now - age
    ts = dt.datetime.now().timestamp() - mtime_age_s
    os.utime(path, (ts, ts))
    return d


def test_stale_stamp_is_not_resumed_even_with_fresh_mtime():
    """The 2026-10-14 bug: 06:31 stamp, fresh MTIME (touched by pull), resumed at 18:01."""
    with tempfile.TemporaryDirectory() as tmp:
        ndir = _make_set(tmp, "20261014063118", mtime_age_s=60)  # MTIME 1 min ago
        now = dt.datetime(2026, 10, 14, 18, 1, 38)
        # Stamp is 11.5h old, MTIME is 1 min old — must NOT resume
        result = resumable_set(ndir, "Wellue", "O2Ring-S", "S8AW2100", now, window_s=300)
        assert result is None, f"resumed a stale stamp: {result}"


def test_fresh_stamp_with_fresh_mtime_is_resumed():
    """Normal case: daemon restart 2 min into a session resumes it."""
    with tempfile.TemporaryDirectory() as tmp:
        ndir = _make_set(tmp, "20261014180100", mtime_age_s=60)
        now = dt.datetime(2026, 10, 14, 18, 3, 0)
        result = resumable_set(ndir, "Wellue", "O2Ring-S", "S8AW2100", now, window_s=300)
        assert result is not None, "should resume a fresh set"
        assert result[0] == dt.datetime(2026, 10, 14, 18, 1, 0)


def test_old_mtime_is_not_resumed():
    """Unchanged behavior: a set that hasn't been touched in hours is not resumed."""
    with tempfile.TemporaryDirectory() as tmp:
        ndir = _make_set(tmp, "20261014063118", mtime_age_s=7200)  # MTIME 2h ago
        now = dt.datetime(2026, 10, 14, 18, 1, 38)
        result = resumable_set(ndir, "Wellue", "O2Ring-S", "S8AW2100", now, window_s=300)
        assert result is None
