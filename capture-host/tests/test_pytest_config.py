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
    """⚠️ DO NOT SET THIS. It is removed on cost, and the mechanism first cited for removing it was
    WRONG — both are recorded here so neither is re-derived.

    ESTABLISHED (pytest source): under `failed`, a GREEN run removes that session's ENTIRE basetemp,
    not merely the passing tests' directories (`_pytest/tmpdir.py`, `pytest_sessionfinish`, guarded by
    `exitstatus == 0 and policy == "failed"`). On a green run `failed` IS `none`, which is not how it
    reads — measured here as 0 bytes retained after 183 passing tests.

    REFUTED, and this docstring asserted it twice before anyone measured: that the policy lets one
    mutant's session delete another's directory and so makes a SURVIVING mutant read as killed. Osprey's
    2x2 — 50 pytest sessions in mutmut's own shape, jobs 1/8/16 x both policies, survivor first, with a
    positive control that deletes a live basetemp externally and IS detected — found every session with
    its own numbered basetemp (8/8, 16/16), 0 reaped, 0 setup errors, and no live directory removed by
    keep-3 (each `.lock` 6 s old against a 3 h timeout). The policy does not mask survivors.

    WHY IT IS REFUSED ANYWAY: shrinking the fixtures took a nightqc run from 2,097,737,728 to
    63,004,672 bytes, so three retained basetemps fall from 6.29 GB to 189 MB and the 37 directories
    that exhausted /tmp would now be 2.33 GB of a 30 GB tmpfs. The SHRINK is the mitigation, by 33x.
    The policy adds 189 MB — 0.63 % of tmpfs — on top of that, and carries an unexplained perturbation
    of the mutation gate (identical verdict at `all`, decided count off by one). That is not a trade
    worth making on the one gate whose job is to say whether a test can see a change.

    Bound a single run with `TMPDIR` on disk instead; not `--basetemp`, which pytest clears at start."""
    assert not re.search(r"^\s*tmp_path_retention_policy\s*=", _pyproject(), re.M), (
        "tmp_path_retention_policy must not be set — see this test's docstring; on a green run it "
        "deletes the whole basetemp and perturbs a mutation sweep for 0.63% of tmpfs"
    )


def test_this_scan_can_actually_see_the_setting():
    """The anti-vacuity control: the assertion above passes trivially if the regex never matches
    anything, so match it against a line that IS there."""
    assert re.search(r"^\s*tmp_path_retention_policy\s*=", 'tmp_path_retention_policy = "failed"\n', re.M)
    assert "[tool.pytest.ini_options]" in _pyproject(), "and the section it would live in exists"
