# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""requirements-dev.txt lists EVERY tool a CI job installs inline (owner rule, 2026-09-06).

CI installs its tooling in three places by hand (`pip install pytest pytest-cov ruff shellcheck-py
hypothesis`, `pip install pytest mutmut hypothesis shellcheck-py`, `pip install --quiet detect-secrets`)
and reads `requirements-dev.txt` in a fourth. Nothing compared them, so the file drifted: `mutmut`
was missing (the local mutation gate refused, loudly) and `shellcheck-py` was missing (check.sh's
shellcheck gate exited 127, which read as "not installed on this box" and was explained away four
times in one day). This test is the comparison — it reads the workflow, not a copy of it, so the
next inline install that forgets this file reds here.
"""

import pathlib
import re

import pytest

HERE = pathlib.Path(__file__).resolve().parent.parent
WORKFLOW = HERE.parent / ".github" / "workflows" / "capture-host-ci.yml"
REQ_DEV = HERE / "requirements-dev.txt"

_PKG = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)")


def _norm(name: str) -> str:
    """PEP 503 normalisation, so `shellcheck-py` / `shellcheck_py` / `Shellcheck.py` compare equal."""
    return re.sub(r"[-_.]+", "-", name).lower()


def inline_ci_packages(text: str) -> set[str]:
    """Every package named on a `pip install …` line that is NOT a `-r file` install.

    Flags (`--quiet`, `--upgrade`) are skipped; `pip` itself (`--upgrade pip`) is not a dev dependency."""
    out: set[str] = set()
    for line in text.splitlines():
        m = re.search(r"\bpip install\b(.*)$", line)
        if not m:
            continue
        toks = m.group(1).split()
        if "-r" in toks:
            continue
        for tok in toks:
            if tok.startswith("-") or tok == "pip":
                continue
            pkg = _PKG.match(tok)  # a `"$VAR"` / `$(...)` token is not a name
            if pkg:
                out.add(_norm(pkg.group(1)))
    return out


def declared_packages(text: str) -> set[str]:
    out: set[str] = set()
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = _PKG.match(line)
        if m:
            out.add(_norm(m.group(1)))
    return out


def test_every_tool_ci_installs_inline_is_declared_in_requirements_dev():
    if not WORKFLOW.exists():  # pragma: no cover - capture-host shipped alone
        pytest.skip("workflow not present in this checkout (scratch copy or lane shipped alone)")
    ci = inline_ci_packages(WORKFLOW.read_text(encoding="utf-8"))
    # A parser that matched nothing would pass vacuously — pin the population it must have seen.
    assert {"pytest", "mutmut", "shellcheck-py", "detect-secrets"} <= ci, ci
    missing = ci - declared_packages(REQ_DEV.read_text(encoding="utf-8"))
    assert not missing, f"CI installs these inline but requirements-dev.txt does not declare them: {sorted(missing)}"


# ── the parser must be able to fail, and must ignore what is not a package ──────────────────────


def test_parser_skips_r_installs_flags_and_pip_itself():
    text = (
        "          python -m pip install --upgrade pip\n"
        "          pip install -r requirements-dev.txt\n"
        "          pip install --quiet detect-secrets\n"
        '          pip install pytest shellcheck_py>=0.11 Hypothesis "$EXTRA"\n'
    )
    assert inline_ci_packages(text) == {"detect-secrets", "pytest", "shellcheck-py", "hypothesis"}


def test_declared_reads_past_comments_and_version_specifiers():
    text = "# header\n\nmypy>=2.3.1   # advisory\nshellcheck-py>=0.11.0.1 # x\n  pytest_cov\n"
    assert declared_packages(text) == {"mypy", "shellcheck-py", "pytest-cov"}


def test_a_missing_declaration_is_reported_by_name():
    """The plant: the exact drift this file was written for, reproduced from strings."""
    ci = inline_ci_packages("pip install pytest mutmut shellcheck-py\n")
    assert ci - declared_packages("pytest\nmutmut\n") == {"shellcheck-py"}


def test_the_mutation_job_pins_the_pytest_it_installs():
    """mutmut's stats harness reads pytest's PRIVATE `Item._nodeid` (3.8.0, runners/harness.py:157).

    pytest 9.2.0 no longer carries that attribute, so an UNPINNED `pip install pytest` in the mutation
    job took it within four hours of release: all 21 globs of run 40614222266 generated 642 mutants,
    tested 0, and the gate returned NOT_RUN over them. The RUNNER decides what executes just as the
    GENERATOR decides what exists, so this pin must be as explicit as mutmut's and must name the same
    version this file's floor does.
    """
    if not WORKFLOW.exists():  # pragma: no cover - capture-host shipped alone
        pytest.skip("workflow not present in this checkout (scratch copy or lane shipped alone)")
    lines = [
        ln for ln in WORKFLOW.read_text(encoding="utf-8").splitlines() if "pip install pytest" in ln and "mutmut" in ln
    ]
    assert len(lines) == 1, lines
    pinned = re.search(r"\bpytest==([^\s]+)", lines[0])
    assert pinned, f"the mutation job installs pytest unpinned: {lines[0].strip()}"
    floor = re.search(r"^pytest>=([^\s#]+)", REQ_DEV.read_text(encoding="utf-8"), re.MULTILINE)
    assert floor, "requirements-dev.txt declares no pytest floor"
    assert pinned.group(1) == floor.group(1), (pinned.group(1), floor.group(1))


# ── the equality above names no DIRECTION, so this is the direction ─────────────────────────────
#
# `test_the_mutation_job_pins_the_pytest_it_installs` is satisfied by moving the pin UP into the
# broken pair exactly as well as by holding the floor down, and that is what a Dependabot bump asked
# for on #4239. The incompatibility itself lives here as data, and it FAILS CLOSED: a mutmut version
# earns its way out of the rule by a recorded verification, never by being newer than the last one.

PYTEST_DROPPED_PRIVATE_NODEID = "9.2.0"
# Verified reads, newest first. mutmut 3.8.0: `item._nodeid` at `mutmut/runners/harness.py:157`.
MUTMUT_VERIFIED_CLEAR_OF_PRIVATE_NODEID: tuple[str, ...] = ()


def _release(spec: str) -> tuple[int, ...]:
    """The numeric release prefix of a version, so `9.2.0rc1` and `9.2.0` compare equal."""
    m = re.match(r"(\d+(?:\.\d+)*)", spec)
    if not m:
        raise ValueError(f"not a version: {spec!r}")
    return tuple(int(p) for p in m.group(1).split("."))


def floor_is_legal(
    mutmut_pin: str,
    pytest_floor: str,
    clear: tuple[str, ...] = MUTMUT_VERIFIED_CLEAR_OF_PRIVATE_NODEID,
) -> tuple[bool, str | None]:
    """Does this pytest FLOOR admit a release the pinned mutmut cannot run?

    The rule stops binding only for a mutmut pin listed in `clear`, so a bump that nobody has read
    keeps the floor held. Below the dropping release the rule never binds at all."""
    if mutmut_pin in clear:
        return True, None
    if _release(pytest_floor) >= _release(PYTEST_DROPPED_PRIVATE_NODEID):
        return False, (
            f"mutmut {mutmut_pin} is not verified clear of pytest's private `Item._nodeid`, which "
            f"pytest {PYTEST_DROPPED_PRIVATE_NODEID} dropped, so a floor of {pytest_floor} admits a "
            "release the mutation gate cannot run — move mutmut first and record the read that clears it"
        )
    return True, None


def test_the_pytest_floor_stays_below_the_release_mutmut_cannot_run():
    """The real pair, read from `requirements-dev.txt`: the floor may not pass what mutmut cannot run."""
    text = REQ_DEV.read_text(encoding="utf-8")
    pin = re.search(r"^mutmut==([^\s#]+)", text, re.MULTILINE)
    assert pin, "requirements-dev.txt pins no mutmut, so the mutation gate's runner is unknown"
    floor = re.search(r"^pytest>=([^\s#]+)", text, re.MULTILINE)
    assert floor, "requirements-dev.txt declares no pytest floor"
    legal, reason = floor_is_legal(pin.group(1), floor.group(1))
    assert legal, reason


@pytest.mark.parametrize(
    ("mutmut_pin", "pytest_floor", "clear", "legal"),
    [
        ("3.8.0", "9.1.1", (), True),  # the held floor of #4239
        ("3.8.0", "9.2.0", (), False),  # the bump that re-creates the #4032 outage
        ("3.8.0", "9.3.1", (), False),  # and anything past it
        ("3.8.0", "9.2.0rc1", (), False),  # a pre-release of the dropping release still drops it
        ("3.8.1", "9.2.0", (), False),  # FAIL CLOSED: a bump nobody read does not clear the rule
        ("3.9.0", "9.2.0", ("3.9.0",), True),  # CONTROL: a verified pin makes the floor move legal
        ("3.9.0", "9.1.1", (), True),  # below the dropping release the rule never binds
    ],
)
def test_the_direction_permits_a_floor_move_once_mutmut_moves_first(mutmut_pin, pytest_floor, clear, legal):
    got, reason = floor_is_legal(mutmut_pin, pytest_floor, clear)
    assert got is legal, (mutmut_pin, pytest_floor, clear, reason)
    assert (reason is None) is legal, reason


def test_a_version_that_is_not_a_version_is_refused_rather_than_ordered():
    with pytest.raises(ValueError, match="not a version"):
        _release("not-a-version")
