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
    """⚠️ THE HAZARD IS `none`, NOT `failed` — and this docstring claimed the opposite twice before
    anyone ran a controlled A/B. The key is refused so that neither can be reached by editing a value.

    `none` FAKES KILLS. A/B over one glob, 116 mutants, same tree, only this setting varied (Wren,
    2026-09-24): `none` scored 116/116 "killed", including a mutant that merely drops `open()`'s "r"
    mode and passes all 234 tests by hand. `all` scored 87 killed / 29 survived. A gate that reports
    every mutant dead is the one failure a mutation gate must not have, and nothing else sees it.

    `failed` is EXONERATED. Same A/B: 87 / 29, byte-identical to `all` at per-mutant granularity across
    all 350 decided mutants. 146 of those sessions ended green, so 146 basetemp deletions happened
    under `failed` with no effect on a later mutant — `tools/mutate.py` passes no `--basetemp`, so each
    session owns its numbered directory. What IS true of `failed` is narrower than it sounds: on a green
    run pytest removes that session's whole basetemp (`_pytest/tmpdir.py`, `pytest_sessionfinish`,
    guarded by `exitstatus == 0 and policy == "failed"`), so `failed` IS `none` for one session — just
    not across them.

    The key is refused on HYGIENE, not on a defect. The setting saves 189 MB, 0.63 % of a 30 GB tmpfs,
    because the fixture shrink already took a nightqc run from 2,097,737,728 to 63,004,672 bytes. A
    setting worth 0.63 %, one word from one that blinds a gate, is better absent than tuned.

    ⚠️ The `none` mechanism is REAL AND UNEXPLAINED. Three accounts were proposed and refuted in one
    evening — a shared-basetemp cascade, pytest's keep-3 reaper, its stale `.lock` — and it does not
    reproduce under plain concurrent pytest, only through mutmut's runner. Do not add a fourth without
    the controlled A/B that tests it."""
    assert not re.search(r"^\s*tmp_path_retention_policy\s*=", _pyproject(), re.M), (
        "tmp_path_retention_policy must not be set — see this test's docstring; on a green run it "
        "its `none` value makes a mutation sweep report 116/116 mutants killed, and the key "
        "is worth only 0.63% of tmpfs"
    )


def test_this_scan_can_actually_see_the_setting():
    """The anti-vacuity control: the assertion above passes trivially if the regex never matches
    anything, so match it against a line that IS there."""
    assert re.search(r"^\s*tmp_path_retention_policy\s*=", 'tmp_path_retention_policy = "failed"\n', re.M)
    assert "[tool.pytest.ini_options]" in _pyproject(), "and the section it would live in exists"
