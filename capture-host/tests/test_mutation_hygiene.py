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

# ENUMERATING PATH IDIOMS IS A LOSING GAME — the first two versions of this gate proved it twice. It
# was anchored on `open(` (which `[^)]*` could not get past `os.path.dirname(__file__)`), then on
# `"..", "capture.py"` joins — and `test_charging_state.py` reaches the module a third way entirely:
#
#     open(__file__.replace("tests/test_charging_state.py", "capture.py"))
#
# Both narrow versions passed while SIX more offenders sat in the tree, and the module stayed
# unmeasurable. So the rule keys on WHAT IS BEING READ, not on how the path is spelled: a read call on
# a line that names a mutatable module. The test file's own `"tests/test_x.py"` self-reference is
# stripped first, or every `__file__.replace(...)` line matches itself.
#
# This over-flags by design — a line reading `monitor.html` that merely mentions a module name would be
# caught. That is the right direction: the remedy is to route through the helper, which is harmless on
# real source, whereas a miss leaves a module silently unmeasurable.
READ_CALL = re.compile(r"\bopen\s*\(|\.read_text\s*\(|inspect\.getsource")
SELF_REF = re.compile(r"""["']tests/test_[a-z_0-9]+\.py["']""")


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
        if SANCTIONED in src:
            continue
        for n, line in enumerate(src.split("\n"), 1):
            if not READ_CALL.search(line):
                continue
            probe = SELF_REF.sub('""', line)
            named = [m for m in mods if f'"{m}"' in probe or f"'{m}'" in probe]
            if named:
                offenders.append(f"{t.name}:{n} reads {named[0]} directly")
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
