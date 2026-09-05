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

# ⚠️ THE MODULE-OBJECT FORM NAMES NO FILE, so the filename match below cannot see it. `READ_CALL` fires
# on `inspect.getsource(capture)`, but the line contains no `"capture.py"` literal, so `named` comes
# back empty and the most natural way to write the offence walks straight through the gate. Measured
# 2026-08-30: two such scans (`test_capture_runners.py`, `test_webmon_settings_contract.py`) sat in
# `capture.py`'s selection with this test GREEN, which is exactly the silent unmeasurability the gate
# exists to prevent — and the reason `capture.py`'s audit could not collect a baseline.
#
# The bare identifier is the whole signal: `inspect.getsource(capture)` hands mutmut the generated
# module and breaks, while `inspect.getsource(capture.foo)` bounds on ONE function and is fine. So the
# dot is the discriminator, and it is a property of the call rather than a list anyone has to maintain.
MODULE_OBJ = re.compile(r"inspect\.getsource\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)")
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
        for n, line in enumerate(src.split("\n"), 1):
            # ⚠️ PER-LINE, NOT PER-FILE. This was `if SANCTIONED in src: continue` — one routed read
            # anywhere in a file exempted every OTHER read in it. `test_capture_runners.py` imports the
            # helper on line 17 and raw-read `capture.py` on line 4657, and the gate never saw it: the
            # largest file in the suite held a blanket exemption earned by its own import line.
            # A file adopting the helper is precisely the file most likely to have missed a site.
            if SANCTIONED in line:
                continue
            # A commented-out read cannot execute, so prose is not an offence. This matters once the
            # check is per-line: THIS file explains the failure in comments that name `capture.py`, and
            # the per-file exemption used to hide them. Pure comment lines only — a trailing `#` after
            # real code leaves the code on the line, and that code still reads.
            if line.lstrip().startswith("#"):
                continue
            if not READ_CALL.search(line):
                continue
            probe = SELF_REF.sub('""', line)
            named = [m for m in mods if f'"{m}"' in probe or f"'{m}'" in probe]
            if named:
                offenders.append(f"{t.name}:{n} reads {named[0]} directly")
                continue
            obj = MODULE_OBJ.search(probe)
            if obj and f"{obj.group(1)}.py" in mods:
                offenders.append(f"{t.name}:{n} reads {obj.group(1)}.py via the module object "
                                 f"`inspect.getsource({obj.group(1)})` — names no file, so the "
                                 f"filename match above cannot see it")
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
    # The skip must be allowed at MODULE level: `test_ring_acc_recording.py` calls the helper at import.
    # Without the flag pytest turns the skip into a collection ERROR, and under mutate_diff's `-x` that
    # is "failed to collect stats" for the whole capture.py run (#2209/#2214 mutation jobs, 2026-09-05).
    # `Skipped` carries the flag as an attribute; the previous assertion accepted either form.
    assert getattr(e.value, "allow_module_level", False) is True


def test_a_module_level_scan_of_a_generated_file_is_a_skip_not_a_collection_error(tmp_path):
    """The failure as it actually happened, reproduced end to end: a test file that scans a mutatable
    module at import time, collected by a REAL pytest against a file carrying mutmut's marker. This must
    collect as SKIPPED. The pre-fix helper made it a collection error — pytest's message is literally
    'Using pytest.skip outside of a test will skip the entire module' — which mutate_diff (running -x)
    reports as 'failed to collect stats' and refuses on. Run in a subprocess because the property under
    test is pytest's collection behaviour, not the helper's return value."""
    import shutil
    import subprocess
    import sys

    root = tmp_path / "repo"
    (root / "tests").mkdir(parents=True)
    shutil.copy(HERE / "tests" / "_srcscan.py", root / "tests" / "_srcscan.py")
    (root / "gen.py").write_text("def x_f__mutmut_orig(): pass\n", encoding="utf-8")
    (root / "tests" / "test_scan.py").write_text(
        "from _srcscan import module_source\n"
        "SRC = module_source('gen.py')\n"          # module scope — the shape test_ring_acc_recording uses
        "def test_x():\n    assert 'mutmut' in SRC\n", encoding="utf-8")
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider",
                        "--rootdir", str(root), str(root / "tests" / "test_scan.py")],
                       cwd=str(root / "tests"), capture_output=True, text=True, timeout=120)
    out = r.stdout + r.stderr
    assert "error" not in out.lower() and "allow_module_level" not in out, out
    # exit 5 = "no tests collected" — the one file in this run skipped whole, which is the intent; a
    # collection error exits 2 (and mutmut's `-x` run dies with it). Alongside real tests, exit is 0.
    assert r.returncode == 5 and "1 skipped" in out, out
