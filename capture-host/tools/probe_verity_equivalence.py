# tepna-capture — tools/probe_verity_equivalence.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Probe the `verity_sdk_config` survivors the equivalence ledger claims are unkillable.

An equivalence entry is a claim that NO input separates a mutant from the shipped code. A claim
nobody can re-run goes stale silently, and a stale excuse lets a real survivor through — measured
across this tree on 2026-10-26, where 33 of 272 excuses were false the moment a probe re-tested
them. So the claim ships with the instrument that made it.

Each case rebuilds the mutant from the module source BY LINE NUMBER, runs both functions over a
generated corpus, and counts every input where they disagree. A raised exception counts as a
disagreement, because a traceback is an observable difference. Zero differing inputs over a corpus
is evidence for the claim; one differing input refutes it, and then the mutant wants a test.

    .venv/bin/python tools/probe_verity_equivalence.py
"""

from __future__ import annotations

import itertools
import random
import sys
import types
from typing import Any

sys.path.insert(0, ".")
SRC = open("verity_sdk_config.py", encoding="utf-8").read().splitlines(keepends=True)


def variant(lineno: int, before: str, after: str) -> types.ModuleType:
    ls = list(SRC)
    assert before in ls[lineno - 1], (lineno, ls[lineno - 1])
    ls[lineno - 1] = ls[lineno - 1].replace(before, after, 1)
    m = types.ModuleType("mut")
    m.__dict__["__file__"] = "mut.py"
    exec(compile("".join(ls), "mut.py", "exec"), m.__dict__)
    return m


import verity_sdk_config as VT


def run(fn: Any, arg: Any) -> Any:
    try:
        return ("ok", fn(arg))
    except Exception as e:  # a raise is an observable difference too
        return ("raise", type(e).__name__)


# ── corpus 1 · device_blocks ──────────────────────────────────────────────────────────────────
FRAG = [
    "devices:\n",
    "pull:\n",
    "root: /data\n",
    "  - name: VERITY-01\n",
    "  - name: H10-01\n",
    "    address: x\n",
    "\n",
    "  enabled: true\n",
    "        ppg: 1\n",
    "devices: \n",
]
corpus_db: list[Any] = []
for n in (0, 1, 2, 3):
    corpus_db += [list(c) for c in itertools.product(FRAG, repeat=n)]
rnd = random.Random(20261026)
corpus_db += [[rnd.choice(FRAG) for _ in range(rnd.randint(4, 9))] for _ in range(40000)]

# ── corpus 2 · value_of / comment_of lines ────────────────────────────────────────────────────
VALS = [
    "176",
    " 176",
    "176 ",
    "",
    " ",
    "\t",
    "a b",
    "/a:b",
    "true",
    "176  # m",
    "176\t# m",
    "176 #m",
    "# m",
    "  # m  ",
    "176   \t ",
    "x\r",
]
corpus_v = [
    f"{k}:{v}{nl}"
    for k in ("  ppg", "root", "  sdk_mode", "")
    for v in VALS
    for nl in ("", "\n", "\n\n", " \n", "\r\n")
]

# ── corpus 3 · _verity_devices docs ───────────────────────────────────────────────────────────
# Deliberately ill-typed documents: a probe that only feeds well-formed input proves nothing about
# a default that appears when a key is missing or holds the wrong kind of value. Hence `Any`.
NAMES: list[Any] = [None, "", "VERITY-01", "verity sense", "Verity", "H10-01", 0, 176, True, "none", "NONE"]
corpus_d: list[Any] = []
for a in NAMES:
    corpus_d.append({"devices": [{"name": a}]})
    corpus_d.append({"devices": [{}]})
    corpus_d.append({"devices": [{"name": a}, {}]})
corpus_d += [None, {}, {"devices": None}, {"devices": []}]

CASES = [
    ("device_blocks", 53, "in_devices = False", "in_devices = None", "device_blocks", corpus_db),
    ("device_blocks", 55, 'name = ""', "name = None", "device_blocks", corpus_db),
    ("device_blocks", 64, "in_devices = False", "in_devices = None", "device_blocks", corpus_db),
    ("value_of", 111, 'rstrip("\\n")', "rstrip(None)", "value_of", corpus_v),
    ("_verity_devices", 194, 'd.get("name", "")', 'd.get("name", None)', "_verity_devices", corpus_d),
    ("_verity_devices", 194, 'd.get("name", "")', 'd.get("name", )', "_verity_devices", corpus_d),
]
for label, ln, before, after, fname, corpus in CASES:
    mut = variant(ln, before, after)
    ref, mfn = getattr(VT, fname), getattr(mut, fname)
    diffs = 0
    first = None
    for arg in corpus:
        a, b = run(ref, arg), run(mfn, arg)
        if a != b:
            diffs += 1
            if first is None:
                first = (arg, a, b)
    print(
        f"{label}:{ln}  {before!r} -> {after!r}  inputs={len(corpus)}  DIFFERING={diffs}"
        + (f"  first={first}" if first else "")
    )
