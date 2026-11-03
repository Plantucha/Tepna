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


def test_the_mutation_job_pins_the_mutmut_it_installs():
    """The mutant GENERATOR is the gate, so the job's inline pin must name the pin this file declares.

    Both this pin's own comment in requirements-dev.txt and the workflow's said "a test asserts they
    agree" from 2026-09-21 — and the only such test was the pytest one above. So the claim was prose,
    and the two `mutmut==` literals could have drifted in silence, which is the exact failure the
    exact pin exists to prevent: on #2776 the two generators examined populations four mutants apart,
    one of them reaching a branch no local run had ever driven. A gate that can disagree with its own
    local run by version is not a gate, and neither is a pin nothing compares.
    """
    if not WORKFLOW.exists():  # pragma: no cover - capture-host shipped alone
        pytest.skip("workflow not present in this checkout (scratch copy or lane shipped alone)")
    lines = [
        ln for ln in WORKFLOW.read_text(encoding="utf-8").splitlines() if "pip install pytest" in ln and "mutmut" in ln
    ]
    assert len(lines) == 1, lines
    pinned = re.search(r"\bmutmut==([^\s]+)", lines[0])
    assert pinned, f"the mutation job installs mutmut unpinned: {lines[0].strip()}"
    declared = re.search(r"^mutmut==([^\s#]+)", REQ_DEV.read_text(encoding="utf-8"), re.MULTILINE)
    assert declared, "requirements-dev.txt declares no exact mutmut pin"
    assert pinned.group(1) == declared.group(1), (pinned.group(1), declared.group(1))


# ── the two pin tests above compare for EQUALITY, so this is the DIRECTION ──────────────────────────
#
# `test_the_mutation_job_pins_the_pytest_it_installs` and its mutmut twin each compare two literals.
# A bump that moves a pair UP into a combination the gate cannot run satisfies both exactly as well
# as holding a working pair does. That move was asked for: #4239 raised the pytest floor to 9.2.0
# while mutmut 3.8.0 read pytest's private `Item._nodeid`, and the only thing that refused it was a
# session reading the pin's comment by hand. #4246 then moved BOTH pins after reading mutmut 3.8.1's
# harness, so today's pair is verified. The rule below is what makes the NEXT mover state its read
# instead of relying on someone noticing.

MUTMUT_PYTEST_VERIFIED: dict[str, str] = {
    # mutmut pin → the highest pytest release someone READ that pin against, newest first.
    # 3.8.1: `runners/harness.py` reads the public `item.nodeid`, where 3.8.0 read the private
    # `item._nodeid` that pytest 9.2.0 dropped; #4246 ran the suite and a decided mutation glob
    # under 3.8.1 + 9.2.0 on python 3.13 before moving either pin.
    "3.8.1": "9.2.0",
}


def _release(spec: str) -> tuple[int, ...]:
    """The numeric release prefix of a version, so `9.2.0rc1` and `9.2.0` compare equal."""
    m = re.match(r"(\d+(?:\.\d+)*)", spec)
    if not m:
        raise ValueError(f"not a version: {spec!r}")
    return tuple(int(p) for p in m.group(1).split("."))


def floor_is_legal(
    mutmut_pin: str,
    pytest_floor: str,
    verified: dict[str, str] | None = None,
) -> tuple[bool, str | None]:
    """Has the PINNED mutmut been read against the pytest release the floor names?

    Absence is never legal here, and the two absences differ. A mutmut bump nobody has read reaches
    this with no entry at all. A floor raised past the read release reaches it with an entry that
    does not cover it. Each refuses with the read its mover owes, so neither can pass by being newer
    than what the table records.
    """
    table = MUTMUT_PYTEST_VERIFIED if verified is None else verified
    read = table.get(mutmut_pin)
    if read is None:
        return False, (
            f"mutmut {mutmut_pin} has no recorded read against any pytest release, so a floor of "
            f"{pytest_floor} runs the mutation gate under a pair nobody has executed — move mutmut "
            "with the read that clears it, the way #4246 did"
        )
    if _release(pytest_floor) > _release(read):
        return False, (
            f"the pytest floor reads {pytest_floor} and mutmut {mutmut_pin} is recorded only against "
            f"{read}, so the gate's own pin follows the floor into a pair nobody has run — record the "
            "read for the newer pytest, or hold the floor"
        )
    return True, None


def test_the_pinned_pair_on_disk_is_one_somebody_read():
    """The live leg: the real `mutmut==` and `pytest>=` literals, against the recorded reads."""
    text = REQ_DEV.read_text(encoding="utf-8")
    pin = re.search(r"^mutmut==([^\s#]+)", text, re.MULTILINE)
    assert pin, "requirements-dev.txt pins no mutmut, so the mutation gate's runner is unknown"
    floor = re.search(r"^pytest>=([^\s#]+)", text, re.MULTILINE)
    assert floor, "requirements-dev.txt declares no pytest floor"
    legal, reason = floor_is_legal(pin.group(1), floor.group(1))
    assert legal, reason


def test_a_floor_raised_past_the_read_release_is_refused():
    """CONTROL — the Dependabot shape: the floor moves alone, the runner stands still."""
    legal, reason = floor_is_legal("3.8.1", "9.3.0", {"3.8.1": "9.2.0"})
    assert not legal
    assert "recorded only against 9.2.0" in reason


def test_a_mutmut_bump_nobody_read_is_refused():
    """CONTROL — the other absence: a newer runner with no recorded read holds nothing."""
    legal, reason = floor_is_legal("3.9.0", "9.2.0", {"3.8.1": "9.2.0"})
    assert not legal
    assert "no recorded read" in reason


def test_a_pair_moved_together_with_its_read_recorded_is_legal():
    """CONTROL — a rule that refuses every move is not a direction, it is a freeze."""
    legal, reason = floor_is_legal("3.9.0", "9.3.0", {"3.9.0": "9.3.0"})
    assert legal
    assert reason is None


def test_the_pair_that_broke_the_gate_in_october_is_refused_by_this_rule():
    """The measured case: #4032 read 642 mutants generated and 0 tested under this exact pair."""
    legal, reason = floor_is_legal("3.8.0", "9.2.0", {"3.8.1": "9.2.0"})
    assert not legal
    assert "nobody has executed" in reason


def test_a_prerelease_compares_equal_to_its_own_release():
    """`9.2.0rc1` names the release the read covers, so it may not read as newer than it."""
    assert _release("9.2.0rc1") == _release("9.2.0")
    legal, _ = floor_is_legal("3.8.1", "9.2.0rc1", {"3.8.1": "9.2.0"})
    assert legal


def test_a_version_with_no_numeric_release_refuses_rather_than_compares():
    """A spec this cannot read is not silently equal to anything."""
    with pytest.raises(ValueError, match="not a version"):
        _release("main")
