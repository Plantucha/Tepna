# tepna-capture — tests/test_mutation_hygiene.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE GATE FOR THE CLASS THAT MADE `capture.py` UNMEASURABLE.
#
# A test that reads a mutatable module's SOURCE breaks against mutmut's generated file, which holds
# every mutant inline (see tests/_srcscan.py for the four shapes and which of them break). mutmut then
# reports **"failed to collect stats"** and the WHOLE MODULE comes back unmeasurable — a message that
# reads as an environment problem, not a test failure.
#
# `capture.py` had FOUR such scans in its test selection. It sat at 1 % measured in
# `audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md` partly because of them, and fixing one was enough to
# get a measurement while three more waited. That is exactly the shape that needs a gate rather than a
# fix: the cost is paid by whoever runs the audit NEXT, months later, and it does not look like their
# fault.
#
# This is a hygiene assertion about the SUITE, not about capture-host behaviour.

from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
TESTS = HERE / "tests"

# Reading source through this helper is the sanctioned route: it is an ordinary read on real source and
# skips on a generated file.
SANCTIONED = "module_source("

# `tools/mutate.py` drops these whole files instead, which is the blunter alternative. Kept in sync so
# the gate does not flag a file the driver already excludes.
DRIVER_EXCLUDED = {"test_no_deprecated_apis.py"}

# The two idioms that reach a sibling module: `os.path.join(..., "..", "capture.py")` and a literal
# `"../capture.py"`. Deliberately NOT anchored on `open(` — the first version was, and `[^)]*` cannot
# cross the `)` in `os.path.dirname(__file__)`, so it matched nothing and the gate passed while a raw
# read sat right in front of it. Caught by negative-controlling the gate instead of trusting it, which
# is the house rule this file exists to enforce.
RAW_READ = re.compile(
    r"""['"]\.\.['"]\s*,\s*['"](?P<mod>[a-z_0-9]+\.py)['"]|"""
    r"""['"]\.\./(?P<mod2>[a-z_0-9]+\.py)['"]"""
)


def _mutatable_modules() -> set[str]:
    """Every module `tools/mutate.py` would mutate — the ones whose source gets a generated twin."""
    skip = {"probe_oxyii_ppg.py", "probe_polar_onboard.py", "ppg_grid_check.py", "adapter_ab.py"}
    return {p.name for p in HERE.glob("*.py") if p.name not in skip}


def test_no_test_reads_a_mutatable_module_source_raw():
    """Every source scan of a mutatable module must go through `tests/_srcscan.module_source`.

    The failure this prevents is silent and expensive: mutmut reports the module as "failed to collect
    stats", which looks like a broken environment, and the module is simply never measured. Four such
    scans existed in `capture.py`'s selection when this gate was written."""
    mods = _mutatable_modules()
    offenders = []
    for t in sorted(TESTS.glob("test_*.py")):
        if t.name in DRIVER_EXCLUDED:
            continue
        src = t.read_text(encoding="utf-8")
        for m in RAW_READ.finditer(src):
            mod = m.group("mod") or m.group("mod2")
            if mod in mods and SANCTIONED not in src:
                line = src[: m.start()].count("\n") + 1
                offenders.append(f"{t.name}:{line} reads {mod} directly")
    assert not offenders, (
        "read a mutatable module's source via tests/_srcscan.module_source(), which skips on a "
        "mutmut-generated file — a raw read makes the whole module unmeasurable and reports it as "
        "'failed to collect stats':\n  " + "\n  ".join(offenders))


def test_the_helper_actually_skips_on_a_generated_file(tmp_path, monkeypatch):
    """The guard itself, asserted rather than assumed — an ungated guard is the thing this suite keeps
    finding. A file carrying mutmut's marker must skip; an ordinary one must be returned."""
    import pytest

    import tests._srcscan as ss

    monkeypatch.setattr(ss, "HERE", tmp_path)
    (tmp_path / "real.py").write_text("x = 1\n", encoding="utf-8")
    assert ss.module_source("real.py") == "x = 1\n"

    (tmp_path / "gen.py").write_text("def x_f__mutmut_orig(): pass\n", encoding="utf-8")
    with pytest.raises(BaseException) as e:          # pytest.skip raises Skipped, not Exception
        ss.module_source("gen.py")
    assert "mutmut" in str(e.value) or e.typename == "Skipped"
