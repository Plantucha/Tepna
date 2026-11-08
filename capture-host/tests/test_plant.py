# tepna-capture — tests/test_plant.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The helper's own arms. `tests/_plant.py` exists to turn a prose control arm into a mechanism, so a
# helper that cannot fail against the thing it names would be the defect it was built to remove.
#
# TWO ARMS CARRY THAT WEIGHT, and both are adversarial:
#   * `test_a_cosmetic_plant_REFUSES_rather_than_yielding` — the file text moves and no executable
#     code does. A helper that yielded there would hand the arm the original rule.
#   * `test_a_plant_that_does_not_COMPILE_refuses_by_name` — a syntax error reds the arm, and a red
#     for that reason is not evidence that the rule is load-bearing.
#
# A third arm asserts the property the whole design rests on: the helper writes nothing in the repo,
# which is what makes it safe under `pytest -n 4`.

from __future__ import annotations

import hashlib
import importlib

import pytest

import tests._plant as P

MODULE = "cpap_spool_caller.py"
# The scar `cpap_spool_caller.window_hours` names in its own docstring: arithmetic on a value that is
# modulo 24. Dropping the `% 24` re-creates it.
MODULO = "(int(at_hour) + i) % 24"
NO_MODULO = "(int(at_hour) + i)"


def _revert() -> str:
    return P.plant_source(MODULE, MODULO, NO_MODULO)


def _sha_in_repo() -> str:
    # Through the helper, never a raw read: `tests/test_mutation_hygiene.py` holds that rule, and the
    # reason is that a mutmut-generated file would answer this with the mutant module's bytes.
    return hashlib.sha256(P.current_source(MODULE).encode("utf-8")).hexdigest()


# ── plant_source ─────────────────────────────────────────────────────────────
def test_plant_source_replaces_exactly_the_named_site():
    planted = _revert()
    assert MODULO not in planted
    assert planted.count(NO_MODULO) == 1
    assert len(planted.splitlines()) == len(P.current_source(MODULE).splitlines())


def test_an_anchor_that_lands_twice_REFUSES_and_names_the_count():
    with pytest.raises(AssertionError) as e:
        P.plant_source(MODULE, "window_hours", "window_hrs")
    assert "appears" in str(e.value) and "exactly one site" in str(e.value)


def test_an_anchor_that_lands_nowhere_REFUSES():
    with pytest.raises(AssertionError) as e:
        P.plant_source(MODULE, "no such text anywhere in this module", "x")
    assert "appears 0 time(s)" in str(e.value)


# ── planted: the working path ────────────────────────────────────────────────
def test_a_plant_runs_the_REVERTED_rule_and_names_what_moved():
    with P.planted(MODULE, _revert()) as planted:
        # 23:00 + 2 h is 23 and 00. Without the modulo it is 23 and the hour 24, which no clock has.
        assert planted.module.window_hours(23, 2) == {23, 24}
        assert planted.changed == ["window_hours"], "exactly one function moved"


def test_a_plant_on_a_module_level_DEFAULT_also_counts_as_arriving():
    with P.planted(
        MODULE, P.plant_source(MODULE, "SPOOL_AT_HOUR_DEFAULT = 10", "SPOOL_AT_HOUR_DEFAULT = 11")
    ) as planted:
        assert planted.module.SPOOL_AT_HOUR_DEFAULT == 11
        assert "SPOOL_AT_HOUR_DEFAULT" in planted.changed


def test_the_helper_writes_NOTHING_in_the_repo_which_is_what_makes_it_WORKER_SAFE():
    """The design's load-bearing property. CI runs `pytest -n 4` and calls the suite worker-safe.

    An in-place plant would break that: a second worker imports whatever sits on disk, so one
    worker's plant would decide another worker's verdict.
    """
    before_sha = _sha_in_repo()
    before_tree = sorted(p.name for p in P.HERE.glob("*.py"))
    with P.planted(MODULE, _revert()) as planted:
        assert planted.module.window_hours(23, 2) == {23, 24}
        assert _sha_in_repo() == before_sha, "the real module must not move DURING the plant"
    assert _sha_in_repo() == before_sha
    assert sorted(p.name for p in P.HERE.glob("*.py")) == before_tree, "no module appeared beside it"
    import cpap_spool_caller as C

    assert C.window_hours(23, 2) == {23, 0}, "and the real rule still answers"


# ── planted: the two adversarial controls ───────────────────────────────────
def test_a_cosmetic_plant_REFUSES_rather_than_yielding():
    """THE CONTROL. A comment-only plant moves the file text and no executable code."""
    cosmetic = P.plant_source(MODULE, "# The morning window", "# The morning window, as shipped")
    assert cosmetic != P.current_source(MODULE), "the control needs a real text change"
    with pytest.raises(AssertionError) as e:
        with P.planted(MODULE, cosmetic):
            pytest.fail("planted() yielded on a plant that changed no executable code")
    assert "changed no function and no module-level value" in str(e.value)


def test_a_plant_that_does_not_COMPILE_refuses_by_name():
    broken = P.plant_source(MODULE, MODULO, "(int(at_hour) + i) %%%")
    with pytest.raises(AssertionError) as e:
        with P.planted(MODULE, broken):
            pytest.fail("planted() yielded on a plant that cannot be imported")
    assert "does not compile" in str(e.value)
    assert "says" in str(e.value) and "nothing about the rule" in str(e.value)


# ── planted: as_module, for a DEPENDENT's own import ────────────────────────
def test_as_module_puts_the_plant_where_a_DEPENDENT_imports_it():
    with P.planted(MODULE, _revert(), as_module=True) as planted:
        assert importlib.import_module("cpap_spool_caller") is planted.module
    assert importlib.import_module("cpap_spool_caller") is not planted.module
    assert importlib.import_module("cpap_spool_caller").window_hours(23, 2) == {23, 0}


def test_an_UNIMPORTED_module_is_imported_by_the_helper_not_left_absent(monkeypatch):
    """Why `as_module` needs no `was it absent` arm: the helper's own import registers the entry.

    The first draft carried that arm, and this test is what showed it unreachable — deleting the
    entry first does not reach it, because `planted()` imports the real module to build the
    before-surface before it swaps anything.
    """
    monkeypatch.delitem(P.sys.modules, "cpap_spool_caller")
    with P.planted(MODULE, _revert(), as_module=True) as planted:
        assert P.sys.modules["cpap_spool_caller"] is planted.module
    assert P.sys.modules["cpap_spool_caller"].window_hours(23, 2) == {23, 0}


def test_as_module_restores_the_entry_when_the_arm_RAISES():
    real = importlib.import_module("cpap_spool_caller")
    with pytest.raises(RuntimeError, match="deliberate"):
        with P.planted(MODULE, _revert(), as_module=True):
            raise RuntimeError("deliberate")
    assert P.sys.modules["cpap_spool_caller"] is real


# ── the mutmut stand-down ───────────────────────────────────────────────────
def test_a_MUTMUT_generated_module_skips_for_the_srcscan_reason(monkeypatch, tmp_path):
    (tmp_path / "gen.py").write_text("def x__mutmut_orig():\n    pass\n", encoding="utf-8")
    monkeypatch.setattr(P, "HERE", tmp_path)
    with pytest.raises(pytest.skip.Exception, match="mutmut-generated"):
        P.current_source("gen.py")
    # The skip sits on the READ, so the anchor check stands down too — under a mutation run its
    # uniqueness test would otherwise refuse on the mutant copies of the anchor.
    with pytest.raises(pytest.skip.Exception, match="mutmut-generated"):
        P.plant_source("gen.py", "pass", "return")


# ── the surface and its digest ──────────────────────────────────────────────
def test_the_surface_holds_functions_AND_module_level_values():
    import cpap_spool_caller as C

    got = P._surface(C)
    assert got["window_hours"][0] == "code"
    assert got["SPOOL_AT_HOUR_DEFAULT"] == ("value", "10"), "a reverted DEFAULT is a real plant"


def test_the_surface_reads_a_class_METHOD_and_skips_an_imported_module():
    import types

    class Holder:
        def method(self):
            return 1

    fake = types.SimpleNamespace(Holder=Holder, sys=P.sys, n=3, __name__="fake")
    got = P._surface(fake)
    assert got["Holder.method"][0] == "code"
    assert got["n"] == ("value", "3")
    assert "sys" not in got, "an imported module is not part of the planted surface"


def test_the_code_digest_is_STABLE_across_a_reload_where_argrepr_is_NOT():
    """The finding the cosmetic control produced: `argrepr` renders a nested code object's ADDRESS."""
    import cpap_spool_caller as C

    def _raw(mod):
        return {
            name: tuple((i.opname, i.argrepr) for i in P.dis.get_instructions(obj.__code__))
            for name, obj in vars(mod).items()
            if getattr(obj, "__code__", None) is not None
        }

    before, raw_before = P._surface(C), _raw(C)
    reloaded = importlib.reload(C)
    assert P._surface(reloaded) == before, "a reload with no source change must move nothing"
    assert _raw(reloaded) != raw_before, "the argrepr form DOES move — that is why it is not the digest"


def test_statement_level_nesting_does_not_defeat_the_digest():
    outer = "def f():\n    g = lambda: 1\n    return g\n"
    other = "def f():\n    g = lambda: 2\n    return g\n"
    one = compile(outer, "x.py", "exec")
    two = compile(other, "x.py", "exec")
    assert P._code_digest(one) != P._code_digest(two), "a nested constant must reach the digest"
