# tepna-capture — tests/_srcscan.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# READING A MODULE'S SOURCE FROM A TEST — the one way to do it that does not break mutation testing.
#
# Several tests in this suite deliberately scan source text: it is the only way to assert a property of
# the CALLERS rather than of a function ("every clock write goes through the policy", "no fabricated
# `or 0` on a pulse reading", "the monitor's advertised default equals the daemon's fallback"). That is
# a legitimate and load-bearing pattern here — `build.mjs` has the same shape on the JS side.
#
# ⚠️ IT IS ALSO A LANDMINE FOR `tools/mutate.py`, AND THE FAILURE IS SILENT.
#
# mutmut 3 generates ONE module holding every mutant inline, so a source scan sees hundreds of copies of
# every line at once. Three of the four scan shapes break against it:
#
#   `assert X in src`          TOLERANT   — more copies, still present
#   `assert X not in src`      BREAKS     — mutmut GENERATES the forbidden string as a mutation
#   `assert len(matches) == 1` BREAKS     — 664 copies of one call site (measured, capture.py)
#   `src.split(MARKER)[1]`     BREAKS     — splits at the first MUTANT's copy, not the real one
#
# And it does not look like a test failure. mutmut reports it as **"failed to collect stats"**, which
# reads as an environment problem, and the WHOLE MODULE comes back unmeasurable. That is the direct
# reason `capture.py` sat at 1 % measured in the audit for so long: its test selection contains four
# such scans, and any one of them poisons the run.
#
# `tools/mutate.py` carries a blunt per-FILE exclusion (`SOURCE_SCANNING_TESTS`) for this, but excluding
# a whole file also removes whatever REAL unit tests live beside the scan — for `test_oxyii_rtc.py` that
# would have deleted `oxyii_rtc_due`'s only coverage and reported its 10 mutants as fake survivors.
#
# So: read source through THIS helper. On real source it is an ordinary read; on a generated mutant file
# it skips just that test. The `mutation-source-scan` group in `tests/test_mutation_hygiene.py` fails if
# a new test scans a mutatable module any other way.

from __future__ import annotations

import os
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def module_source(name: str) -> str:
    """The text of `<repo>/<name>`, or skip if we have been handed a mutmut-generated file.

    `name` is a bare module filename, e.g. "capture.py".
    """
    src = (HERE / name).read_text(encoding="utf-8")
    if "__mutmut_orig" in src:
        import pytest
        pytest.skip(f"{name} here is a mutmut-generated file holding every mutant inline; "
                    "a source scan sees all of them at once (see tests/_srcscan.py)")
    return src


def module_path(name: str) -> str:
    """The path form, for the few callers that want to open it themselves."""
    return os.path.join(str(HERE), name)
