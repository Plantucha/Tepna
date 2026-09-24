# tepna-capture — tests/test_pytest_config.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The pytest configuration itself, where a setting can break a GATE rather than a test."""
import os
import re

_PYPROJECT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pyproject.toml")


def _pyproject() -> str:
    with open(_PYPROJECT, encoding="utf-8") as fh:
        return fh.read()


def test_tmp_path_retention_policy_is_not_set():
    """⚠️ SETTING THIS VOIDS MUTATION SWEEPS. It is not a style preference, and the reason is kept
    separate from the parts of it that are not yet shown.

    ESTABLISHED. Under `failed` pytest removes that session's ENTIRE basetemp on a green run, not merely
    the passing tests' directories (`_pytest/tmpdir.py`, `pytest_sessionfinish`, guarded by
    `exitstatus == 0 and policy == "failed"`). So on a green run `failed` IS `none` — which is not how
    it reads, and is how this shipped for a few hours on 2026-09-24. Measured: a 183-passing run
    retained 0 bytes.

    ESTABLISHED. The setting perturbs a mutation sweep: at `all` the verdict is identical but the
    decided count differs by one (Osprey). And sweeps run under `--basetemp` or `none` score SURVIVING
    mutants as killed — 235/236 exit 1, one of them a mutant that merely drops `open()`'s "r" mode and
    passes all 234 tests by hand (Wren).

    NOT ESTABLISHED: which mechanism, and so whether `failed` reaches that same failure. Candidates:
    children sharing one basetemp and an exit-0 child deleting it (needs the sharing shown — pytest
    numbers each session's basetemp, and if they did share, the clean baseline run exits 0 too and
    would delete it before the first mutant); pytest's keep-3 numbered-dir cleanup removing a LIVE
    sibling under `--jobs` > 3, which needs no policy at all; or whatever the off-by-one count reflects.

    The setting is refused anyway, because it buys 63 MB — the fixture shrink did the other 2.0 GB — and
    costs an unresolved perturbation of the one gate whose job is to say whether a test can see a
    change. Bound a single run with `TMPDIR` on disk instead; not `--basetemp`, which pytest clears at
    session start."""
    assert not re.search(r"^\s*tmp_path_retention_policy\s*=", _pyproject(), re.M), (
        "tmp_path_retention_policy must not be set — see this test's docstring; on a green run it "
        "deletes the whole basetemp and measurably perturbs a mutation sweep"
    )


def test_this_scan_can_actually_see_the_setting():
    """The anti-vacuity control: the assertion above passes trivially if the regex never matches
    anything, so match it against a line that IS there."""
    assert re.search(r"^\s*tmp_path_retention_policy\s*=", 'tmp_path_retention_policy = "failed"\n', re.M)
    assert "[tool.pytest.ini_options]" in _pyproject(), "and the section it would live in exists"
