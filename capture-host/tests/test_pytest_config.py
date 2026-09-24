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
    """⚠️ SETTING THIS MAKES THE MUTATION GATE REPORT FALSE KILLS. It is not a style preference.

    pytest removes the WHOLE basetemp — not merely the passing tests' directories — when a run is green
    under `failed`, and always under `none` (`_pytest/tmpdir.py`, `pytest_sessionfinish`, guarded by
    `exitstatus == 0 and policy == "failed"`). mutmut runs ONE pytest session with a forked child per
    mutant, all sharing that basetemp, so the first child whose mutant SURVIVES exits 0, deletes the
    basetemp, and every later mutant fails at SETUP and is scored KILLED. A surviving mutant reading as
    dead is the one failure a mutation gate must not have, and nothing else in the suite can see it:
    the run is green either way.

    This shipped for a few hours on 2026-09-24 as `"failed"`, which reads as the cautious value and is
    not — on a green run it is exactly `"none"`. The measurement that introduced it (0 bytes retained
    after 183 passing tests) was the basetemp being deleted, read as the setting working.

    Bound a single mutation run with `TMPDIR` on a disk-backed directory instead. NOT `--basetemp`,
    which a new session wipes at start and which has the same effect."""
    assert not re.search(r"^\s*tmp_path_retention_policy\s*=", _pyproject(), re.M), (
        "tmp_path_retention_policy must not be set — see this test's docstring; it makes mutmut "
        "score surviving mutants as killed"
    )


def test_this_scan_can_actually_see_the_setting():
    """The anti-vacuity control: the assertion above passes trivially if the regex never matches
    anything, so match it against a line that IS there."""
    assert re.search(r"^\s*tmp_path_retention_policy\s*=", 'tmp_path_retention_policy = "failed"\n', re.M)
    assert "[tool.pytest.ini_options]" in _pyproject(), "and the section it would live in exists"
