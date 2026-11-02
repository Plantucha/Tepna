#!/usr/bin/env python3
# tepna-capture — devfloors.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Compare the floors this tree DECLARES with what the gate's interpreter HAS, runtime and dev alike.

NO GATE IN THIS TREE COMPARED A VERSION TO A FLOOR. `tests/test_dev_requirements.py` is the only other
comparison and it compares NAMES — `inline_ci_packages` strips every specifier — so a floor could move
with nothing reading it. Measured 2026-10-12 on rig-x870: the venv `check.sh` prefers ran ruff 0.16.0
against the declared `>=0.16.9` and hypothesis 6.165.10 against `>=6.168.3`, with every gate green.
Three install paths are in play (this file, the lint job's unpinned `ruff`, and whatever a session's
venv holds), and no line anywhere said which one ran.

BOTH DECLARING FILES, because the first draft read the dev file alone. `requirements.txt` declares the
four RUNTIME floors, and nothing compared them against any interpreter: CI runs `pip install -r
requirements.txt` in three jobs and so satisfies every floor it declares, while the daemon keeps
whatever its venv holds. That gap is measured — `requirements.txt` declares `cryptography>=50.0.1` and
both venvs carried 50.0.0 on 2026-10-18, with every gate green. Row
`2026-10-26-four-runtime-floors-have-no-reader-against-the-interpreter` logged the absent reader, and
`2026-10-18-the-cryptography-floor-is-met-by-neither-venv` logged that one drift.

A RUNTIME ROW READING `ABSENT` IS A FINDING ABOUT THE INTERPRETER, not noise. It says the environment
running this gate is not the one running the daemon, which is the fact a shortfall comparison needs
stated out loud.

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
(§∅: a comparison that could not run is not a comparison that agreed). An unread declaring file and an
empty population are `NOT_COMPARABLE` for the same reason: the run compared nothing there.
"""

from __future__ import annotations

import importlib.metadata
import os
import re
import sys

RUNTIME_REQ = "requirements.txt"
DEV_REQ = "requirements-dev.txt"
# Runtime first, because the daemon's own libraries are the half a reader is least likely to have
# compared. Every row names its own file, so the order carries no meaning beyond the print order.
REQS = (RUNTIME_REQ, DEV_REQ)
TOKEN = "devfloors"

# `name<op><version>`, with the inline comment already stripped. Only `>=` and `==` occur in the files
# and only those two are understood here: a specifier this pattern does not match is NAMED in the
# report rather than skipped, because a dropped line is a floor nobody compares.
FLOOR_RE = re.compile(r"^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(>=|==)\s*([0-9][0-9A-Za-z.*+!-]*)$")

# THE NON-NUMERIC SEGMENTS THIS MODULE READS, and PEP 440 orders every one of them with no ambiguity:
# `1.0.dev1 < 1.0a1 < 1.0b1 < 1.0rc1 < 1.0 < 1.0.post1`. Reading them is a measurement rather than a
# guess, which is the whole test for what belongs in this pattern.
#
# ONLY THE NORMALISED SPELLINGS. `alpha`, `beta`, `c`, `pre`, `preview`, `.revN`, `.rN`, an implicit
# `-N` post-release, an epoch (`1!2.0`) and a local version (`1.0+abc`) all still return None below.
# Each of those is either a second spelling for one question or a segment whose comparison this gate
# has never needed, and a parser that guesses at one is the defect this module exists to refuse.
#
# MEASURED BEFORE WIDENING, 2026-11-02, because reading a pre-release turns a refusal into a BELOW and
# so reds a venv this gate passes today: the rig's dev venv carries 49 distributions and the capture
# box's runtime venv 21, and NONE of the 70 is a pre-release or a dev release. So this widening reds
# nothing in either venv the fleet runs. Row
# `2026-11-02-the-floor-check-refuses-a-pre-release-it-could-order`; §7 decision #3027 deferred it to
# exactly this measurement.
VERSION_RE = re.compile(
    r"\A(?P<release>[0-9]+(?:\.[0-9]+)*)"
    r"(?:(?P<pre_letter>a|b|rc)(?P<pre_number>[0-9]+))?"
    r"(?:\.post(?P<post>[0-9]+))?"
    r"(?:\.dev(?P<dev>[0-9]+))?\Z"
)

# The pre-release rank, and the two SENTINELS around it are the whole of PEP 440's ordering rule here.
# A version with no pre-release segment sorts ABOVE every pre-release of the same release, so absence
# is the highest rank. The one exception is a bare dev release: `1.0.dev1` carries no pre-release and
# still sorts BELOW `1.0a1`, so that case takes the lowest rank instead of the highest.
PRE_RANK = {"a": 0, "b": 1, "rc": 2}
PRE_ABSENT = 3
PRE_DEV_ONLY = -1
# A post number is never negative, so an absent post-release sorts below every real one.
POST_ABSENT = -1
# A dev release sorts BELOW the same version without one, so PRESENT is the lower rank.
DEV_PRESENT = 0
DEV_ABSENT = 1

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


def version_key(version: str) -> tuple[tuple[int, ...], tuple[int, ...]] | None:
    """`(release, suffix)` for a version this module reads, or `None` for one it refuses.

    The suffix is `(pre_rank, pre_number, post, dev_rank, dev_number)`, which is PEP 440's own
    ordering for everything after the release segments. Compare two keys and the spec's order falls
    out: `1.0.dev1 < 1.0a1 < 1.0b1 < 1.0rc1 < 1.0 < 1.0.post1`.

    `None` is the absence, and the caller reports it as such. A best-effort parse here would compare
    `0.11.0.1` against `0.11.0.rev1` on a guess and call the guess a measurement.

    THE SUFFIX IS NEVER A RELEASE SEGMENT. `shellcheck-py>=0.11.0.1` is a real four-segment release in
    this tree, and `0.11.0.post1` sits BELOW it, so folding the post number into the release tuple
    would order the two wrongly. Measured 2026-11-02: `pytest-asyncio 1.4.1.post1` against the
    declared `>=1.4.1` read NOT_COMPARABLE, and the advisory returned rc 4 over 13 met floors.
    """
    found = VERSION_RE.match(version)
    if not found:
        return None
    release = tuple(int(part) for part in found.group("release").split("."))
    pre_letter, pre_number = found.group("pre_letter"), found.group("pre_number")
    post, dev = found.group("post"), found.group("dev")
    if pre_letter is not None:
        pre = (PRE_RANK[pre_letter], int(pre_number))
    elif post is None and dev is not None:
        pre = (PRE_DEV_ONLY, 0)
    else:
        pre = (PRE_ABSENT, 0)
    suffix = (
        *pre,
        POST_ABSENT if post is None else int(post),
        *((DEV_PRESENT, int(dev)) if dev is not None else (DEV_ABSENT, 0)),
    )
    return release, suffix


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
    # The release halves are padded to one width so `1.4` and `1.4.1` compare; the suffix is compared
    # after them, which is the order PEP 440 states. Only the RELEASE is padded — the suffix is a
    # fixed-width tuple by construction, so padding it would be padding nothing.
    have_rel, have_suffix = have
    want_rel, want_suffix = want
    width = max(len(have_rel), len(want_rel))
    have_rel += (0,) * (width - len(have_rel))
    want_rel += (0,) * (width - len(want_rel))
    have, want = (have_rel, have_suffix), (want_rel, want_suffix)
    if op == "==":
        # A PIN IS AN IDENTITY, so a newer version is a finding too. `mutmut==3.8.1` is the dev file's
        # only `==` and the reason is written there: the mutant GENERATOR is the gate, and two versions
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


def note(rows, unreadable, state: str, unread) -> str:
    """One line naming what was MEASURED, for `check.sh`'s summary row."""
    counts = {t: sum(1 for r in rows if r[4] == t) for t in (MET, BELOW, OFF_PIN, NOT_COMPARABLE, ABSENT)}
    head = (
        f"{len(rows)} floor(s) read, {counts[MET]} met, {counts[BELOW]} below, "
        f"{counts[OFF_PIN]} off its pin, {counts[ABSENT]} not installed, "
        f"{counts[NOT_COMPARABLE]} not comparable, {len(unreadable)} line(s) not understood"
    )
    # An unread file is part of the population this line reports on, so the count of floors above is
    # over the files that WERE read and the summary says which ones were not.
    if unread:
        head = f"{head}, {len(unread)} file(s) unread ({', '.join(unread)})"
    named = [f"{r[0]} {r[3]} < {r[2]}" for r in rows if r[4] == BELOW]
    if not named:
        return f"{head} ({state})"
    shown = ", ".join(named[:3]) + (f", +{len(named) - 3} more" if len(named) > 3 else "")
    return f"{head} — {shown}"


def render(rows, unreadable, req: str) -> list[str]:
    """One section per declaring file. EVERY LINE NAMES ITS FILE, because a shortfall attributed to
    the wrong half sends the reader to the wrong install command."""
    lines = [f"  {req} — {len(rows)} floor(s) declared"]
    for name, op, floor, installed, token in rows:
        shown = installed if installed is not None else "(absent)"
        lines.append(f"  {name:<16} declared {op + floor:<14} found {shown:<14} {token}  [{req}]")
    for line in unreadable:
        lines.append(f"  {req}: specifier not understood, so nothing compared it — {line}")
    return lines


def main(argv) -> int:
    if argv:
        print(f"  devfloors.py takes no arguments; ignored: {' '.join(argv)}")
    here = os.path.dirname(os.path.abspath(__file__))
    print(f"  interpreter : {sys.executable}")
    rows: list[tuple[str, str, str, str | None, str]] = []
    unreadable: list[str] = []
    unread: list[str] = []
    for req in REQS:
        try:
            with open(os.path.join(here, req), encoding="utf-8") as fh:
                text = fh.read()
        except OSError as exc:
            # A declaring file is the population for its own half. Unread, it compared nothing, and the
            # run says which file rather than reporting on the other one alone.
            print(f"  {req} could not be read: {exc}")
            unread.append(req)
            continue
        file_rows, file_unreadable = survey(text)
        for line in render(file_rows, file_unreadable, req):
            print(line)
        rows += file_rows
        unreadable += file_unreadable
    tokens = [r[4] for r in rows]
    if unreadable or unread or not rows:
        tokens.append(NOT_COMPARABLE)
    state = worst(tokens)
    if not rows:
        print(f"{TOKEN}-note=no floor was compared, over {len(REQS)} declaring file(s), {len(unread)} unread")
        print(f"{TOKEN}-state={state}")
        return RC[state]
    if state != MET:
        installs = " ".join(f"-r {req}" for req in REQS)
        print(f"  Upgrade this interpreter: {sys.executable} -m pip install {installs}")
    print(f"{TOKEN}-note={note(rows, unreadable, state, unread)}")
    print(f"{TOKEN}-state={state}")
    return RC[state]


if __name__ == "__main__":  # pragma: no cover — CLI entry
    sys.exit(main(sys.argv[1:]))
