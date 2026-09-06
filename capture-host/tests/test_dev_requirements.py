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
            pkg = _PKG.match(tok)                          # a `"$VAR"` / `$(...)` token is not a name
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
    if not WORKFLOW.exists():                              # pragma: no cover - capture-host shipped alone
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
        "          pip install pytest shellcheck_py>=0.11 Hypothesis \"$EXTRA\"\n"
    )
    assert inline_ci_packages(text) == {"detect-secrets", "pytest", "shellcheck-py", "hypothesis"}


def test_declared_reads_past_comments_and_version_specifiers():
    text = "# header\n\nmypy>=2.3.1   # advisory\nshellcheck-py>=0.11.0.1 # x\n  pytest_cov\n"
    assert declared_packages(text) == {"mypy", "shellcheck-py", "pytest-cov"}


def test_a_missing_declaration_is_reported_by_name():
    """The plant: the exact drift this file was written for, reproduced from strings."""
    ci = inline_ci_packages("pip install pytest mutmut shellcheck-py\n")
    assert ci - declared_packages("pytest\nmutmut\n") == {"shellcheck-py"}
