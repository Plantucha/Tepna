#!/usr/bin/env python3
# tepna-capture — devfloors.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Compare the dev-tool floors `requirements-dev.txt` DECLARES with what the gate's interpreter HAS.

NO GATE IN THIS TREE COMPARED A VERSION TO A FLOOR. `tests/test_dev_requirements.py` is the only
comparison and it compares NAMES — `inline_ci_packages` strips every specifier — so a floor could move
with nothing reading it. Measured 2026-10-12 on rig-x870: the venv `check.sh` prefers ran ruff 0.16.0
against the declared `>=0.16.9` and hypothesis 6.165.10 against `>=6.168.3`, with every gate green.
Three install paths are in play (this file, the lint job's unpinned `ruff`, and whatever a session's
venv holds), and no line anywhere said which one ran.

ADVISORY, which is a decision and not a default. A blocking floor would red every local run on a box
nobody has upgraded yet, and that is an environment fact rather than a finding about the diff — §🐍's
rule in the same shape as an absent tool's 127. This leg NAMES the shortfall; the owner decides when it
blocks.

READ THE INSTALLED VERSION FROM THE INTERPRETER THAT RUNS THE GATE, never from a path. `check.sh`
invokes this under `$PY`, so `importlib.metadata` reports the environment whose tools the gate will
actually use. A path-derived answer would describe a venv the run may never touch.

THE TOKENS ARE DELIBERATELY NOT THE SEVEN `tepna.verdict/1` STATUSES. This leg reports a comparison,
`checkverdict.py` owns the gate's one object, and a second status vocabulary beside it would read as a
second verdict. `check.sh` carries the token into its own `advisory-state:` line.

An absent package is `ABSENT` and an unparseable version is `NOT_COMPARABLE` — never a quiet `MET`
(§∅: a comparison that could not run is not a comparison that agreed).
"""

from __future__ import annotations

import importlib.metadata
import os
import re
import sys

REQ = "requirements-dev.txt"
TOKEN = "devfloors"

# `name<op><version>`, with the inline comment already stripped. Only `>=` and `==` occur in the file
# and only those two are understood here: a specifier this pattern does not match is NAMED in the
# report rather than skipped, because a dropped line is a floor nobody compares.
FLOOR_RE = re.compile(r"^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(>=|==)\s*([0-9][0-9A-Za-z.*+!-]*)$")

MET = "MET"
BELOW = "BELOW_FLOOR"
OFF_PIN = "OFF_PIN"
NOT_COMPARABLE = "NOT_COMPARABLE"
ABSENT = "ABSENT"

# Worst first. A shortfall outranks an unreadable version, which outranks an absent tool: the run's one
# token names the most actionable thing found, and every row still prints its own.
RANK = (BELOW, OFF_PIN, NOT_COMPARABLE, ABSENT)
RC = {MET: 0, BELOW: 1, OFF_PIN: 2, NOT_COMPARABLE: 4, ABSENT: 3}


def declared_floors(text: str) -> tuple[list[tuple[str, str, str]], list[str]]:
    """Every floor the file declares, plus every requirement line the pattern did not understand."""
    floors: list[tuple[str, str, str]] = []
    unreadable: list[str] = []
    for raw in text.splitlines():
        # `partition`, not `split("#", 1)`: the maxsplit argument carries no information here — every
        # `split("#", N)[0]` for N >= 1 returns the same prefix — so the diff-scoped mutation gate
        # generated three mutants on it that NO test can distinguish (measured 2026-10-19). `partition`
        # has no such argument, so the one behaviour left to pin is which `#` ends the line.
        line = raw.partition("#")[0].strip()
        if not line:
            continue
        m = FLOOR_RE.match(line)
        if m:
            floors.append((m.group(1), m.group(2), m.group(3)))
        else:
            unreadable.append(line)
    return floors, unreadable


def version_key(version: str) -> tuple[int, ...] | None:
    """`"0.16.0"` → `(0, 16, 0)`; `None` when any segment is not a number.

    `None` is the absence, and the caller reports it as such. A best-effort parse here would compare
    `0.11.0.1` against `0.11.0rc1` on a guess and call the guess a measurement.
    """
    key: list[int] = []
    for part in version.split("."):
        if not part.isdigit():
            return None
        key.append(int(part))
    return tuple(key)


def compare_floor(op: str, floor: str, installed: str | None) -> str:
    """One token for one declared floor.

    ⚠️ NOT `compare`. `tools/find_unwired.py` matches a BARE NAME, so a second function called
    `compare` anywhere in the tree makes `adapter_ab.compare` look referenced and turns that
    allowlist entry into a spent suppression — which the gate reports as a stale allowlist row, not
    as a collision. Measured 2026-10-19: this module's first draft reded the unwired gate that way.
    """
    if installed is None:
        return ABSENT
    have, want = version_key(installed), version_key(floor)
    if have is None or want is None:
        return NOT_COMPARABLE
    width = max(len(have), len(want))
    have += (0,) * (width - len(have))
    want += (0,) * (width - len(want))
    if op == "==":
        # A PIN IS AN IDENTITY, so a newer version is a finding too. `mutmut==3.8.0` is the file's only
        # `==` and the reason is written there: the mutant GENERATOR is the gate, and two versions
        # generate different mutant sets, so "newer" is not "better" for this one line.
        return MET if have == want else OFF_PIN
    return MET if have >= want else BELOW


def dist_version(name: str) -> str | None:
    """The installed version, or `None` when the distribution is not present."""
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def survey(text: str, lookup=None) -> tuple[list[tuple[str, str, str, str | None, str]], list[str]]:
    """One row per declared floor: `(name, op, floor, installed, token)`."""
    get = lookup or dist_version
    floors, unreadable = declared_floors(text)
    rows = []
    for name, op, floor in floors:
        installed = get(name)
        rows.append((name, op, floor, installed, compare_floor(op, floor, installed)))
    return rows, unreadable


def worst(tokens) -> str:
    for token in RANK:
        if token in tokens:
            return token
    return MET


def note(rows, unreadable, state: str) -> str:
    """One line naming what was MEASURED, for `check.sh`'s summary row."""
    counts = {t: sum(1 for r in rows if r[4] == t) for t in (MET, BELOW, OFF_PIN, NOT_COMPARABLE, ABSENT)}
    head = (
        f"{len(rows)} floor(s) read, {counts[MET]} met, {counts[BELOW]} below, "
        f"{counts[OFF_PIN]} off its pin, {counts[ABSENT]} not installed, "
        f"{counts[NOT_COMPARABLE]} not comparable, {len(unreadable)} line(s) not understood"
    )
    named = [f"{r[0]} {r[3]} < {r[2]}" for r in rows if r[4] == BELOW]
    if not named:
        return f"{head} ({state})"
    shown = ", ".join(named[:3]) + (f", +{len(named) - 3} more" if len(named) > 3 else "")
    return f"{head} — {shown}"


def render(rows, unreadable, executable: str) -> list[str]:
    lines = [f"  interpreter : {executable}"]
    for name, op, floor, installed, token in rows:
        shown = installed if installed is not None else "(absent)"
        lines.append(f"  {name:<16} declared {op + floor:<14} found {shown:<14} {token}")
    for line in unreadable:
        lines.append(f"  {REQ}: specifier not understood, so nothing compared it — {line}")
    return lines


def main(argv) -> int:
    if argv:
        print(f"  devfloors.py takes no arguments; ignored: {' '.join(argv)}")
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), REQ)
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except OSError as exc:
        # The declaring file is the population. Without it nothing was compared, and saying so is the
        # whole point of the leg.
        print(f"  {REQ} could not be read: {exc}")
        print(f"{TOKEN}-note=the declaring file could not be read, so no floor was compared")
        print(f"{TOKEN}-state={NOT_COMPARABLE}")
        return RC[NOT_COMPARABLE]
    rows, unreadable = survey(text)
    state = worst([r[4] for r in rows] + ([NOT_COMPARABLE] if unreadable else []))
    for line in render(rows, unreadable, sys.executable):
        print(line)
    if state != MET:
        print(f"  Upgrade this interpreter: {sys.executable} -m pip install -r {REQ}")
    print(f"{TOKEN}-note={note(rows, unreadable, state)}")
    print(f"{TOKEN}-state={state}")
    return RC[state]


if __name__ == "__main__":  # pragma: no cover — CLI entry
    sys.exit(main(sys.argv[1:]))
