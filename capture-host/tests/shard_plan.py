# tepna-capture — tests/shard_plan.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The pytest lane's shard planner — PURE, and its own gate's input.

CI runs the Python suite as N shards per interpreter and judges coverage over their UNION. That is only
sound if the shards PARTITION the suite: every test file in exactly one shard. A file in none would let
every shard go green having never run it — a silently shrinking gate, strictly worse than a slow one.
So the partition is proven rather than assumed (`verify_shard_union.py`), and this module is the pure
half it proves.

⚠️ BALANCE IS A GUESS WHERE TIMINGS ARE MISSING, AND THE SPLIT SAYS SO. `pytest --durations` reports only
phases above its threshold, so a fast file has no committed timing and weighs 0 here. Measured
2026-10-10: 184 of 338 files had a timing, and the 154 without are not free — a file costs IMPORT and
COLLECTION before a single test runs, which no duration table records. So the planner balances what it
can measure and the verifier reports how many files it could not, rather than presenting an even split
as a measured one. Coverage is unaffected either way: the union is judged over every shard's data.
"""

from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TIMINGS = os.path.join(HERE, "pytest-timings.json")


def read_timings(path: str = TIMINGS) -> dict[str, float]:
    """The committed per-file durations, or `{}` when the file is absent or unreadable.

    ∅ `{}` is not "everything is fast" — it is "nothing was measured", and `plan_shards` then produces an
    even split that `verify_shard_union` reports as fully unmeasured rather than as balanced."""
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): float(v) for k, v in raw.items() if isinstance(v, (int, float))}


# The cost a file carries BEFORE its first test runs — import, collection, fixture discovery — which no
# duration table records. DERIVED FROM THE MEASURED SHARD WALLS, not chosen: two shards carrying an equal
# 168.9 s of measured work but 93 and 245 files ran 60.27 s and 69.24 s at `-n 4`, so
# (69.24 - 60.27) x 4 / (245 - 93) = 0.236 s per unmeasured file. Adding it moves the split from 93/245
# files to 169/169 and the predicted walls from 74.7/83.7 s to 79.2/79.2 s — the critical path is
# max(walls), so a balanced pair is the whole point of sharding.
#
# ⚠️ IT IS A MEASUREMENT WITH AN EXPIRY, like any other. Re-derive it when the suite's shape changes;
# `verify_shard_union` reports the file count per shard so a drifted floor shows up as an imbalance
# rather than as a number nobody checks.
PER_FILE_FLOOR_S = 0.236


def plan_shards(
    files: list[str], timings: dict[str, float], n: int, floor_s: float = PER_FILE_FLOOR_S
) -> list[list[str]]:
    """`files` split into `n` shards, heaviest first into the lightest shard. PURE and deterministic.

    Longest-processing-time-first: the standard greedy bin packing, and deterministic because ties break
    on the FILE NAME, never on dict order — two runs of the same inputs must produce the same plan or the
    partition proof says nothing about what CI will do.

    `n < 1` is refused rather than defaulted: a caller asking for zero shards has a bug, and silently
    giving them one would hide it."""
    if n < 1:
        raise ValueError(f"a shard count must be at least 1, got {n!r}")
    weight = {f: timings.get(f, 0.0) + floor_s for f in files}
    order = sorted(files, key=lambda f: (-weight[f], f))
    bins: list[list[str]] = [[] for _ in range(n)]
    load = [0.0] * n
    for f in order:
        i = min(range(n), key=lambda k: (load[k], k))
        bins[i].append(f)
        load[i] += weight[f]
    return [sorted(b) for b in bins]


def shard_files(
    files: list[str], timings: dict[str, float], shard: int, of: int, floor_s: float = PER_FILE_FLOOR_S
) -> list[str]:
    """The files for shard `shard` of `of`, 1-indexed — the form the CI step uses."""
    if not 1 <= shard <= of:
        raise ValueError(f"shard {shard} is outside 1..{of}")
    return plan_shards(files, timings, of, floor_s)[shard - 1]
