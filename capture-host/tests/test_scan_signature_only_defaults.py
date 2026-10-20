# tepna-capture — tests/test_scan_signature_only_defaults.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The scan that enumerates defaults no signature-reading test can observe.

🔴 THE NEGATIVE CONTROL IS THE POINT OF THIS FILE. The scan's headline over the real tree is ZERO
signature-only defaults, and a zero from an instrument nobody proved sensitive is the examined-nothing
pass this suite exists to refuse. `test_the_planted_tree_names_one_of_each_outcome` plants one default
per outcome and requires the scan to name each, and `test_cutting_the_signature_read_moves_the_row`
cuts a single guard so the planted defect reads as something else.
"""

import ast
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.scan_signature_only_defaults import (  # noqa: E402
    OBSERVABLE,
    SIGNATURE_ONLY,
    UNCOVERED,
    UNDECIDABLE,
    _call_name,
    _commit,
    _is_bound,
    _params_with_defaults,
    _sig_read_name,
    _supplies,
    classify,
    defaults_in_source,
    format_report,
    literal_kind,
    main,
    production_files,
    references_in_source,
    sample_verdict,
    scan,
    suite_files,
    verdict_object,
)
import verdict as _verdict  # noqa: E402


def _fn(src):
    return ast.parse(src).body[0]


def _expr(src):
    return ast.parse(src).body[0].value


# ── the literal vocabulary ───────────────────────────────────────────────────────────────────────


def test_literal_kind_covers_the_three_kinds_the_row_names():
    assert literal_kind(_expr("10")) == "numeric"
    assert literal_kind(_expr("10.5")) == "numeric"
    assert literal_kind(_expr("'utf-8'")) == "string"
    assert literal_kind(_expr("(1, 'a')")) == "tuple"


def test_a_bool_a_none_and_a_name_are_not_claimed():
    # `True → False` is a real mutant and a different question; the row scoped this scan.
    assert literal_kind(_expr("True")) is None
    assert literal_kind(_expr("None")) is None
    assert literal_kind(_expr("JOIN_SEC")) is None
    assert literal_kind(_expr("(1, JOIN_SEC)")) is None


# ── binding: the off-by-one a method would otherwise carry ───────────────────────────────────────


def test_a_module_function_is_not_bound():
    assert _is_bound(_fn("def f(a=1): pass"), False) is False


def test_self_and_cls_bind_and_staticmethod_does_not():
    assert _is_bound(_fn("def m(self, a=1): pass"), True) is True
    assert _is_bound(_fn("def m(cls, a=1): pass"), True) is True
    assert _is_bound(_fn("@staticmethod\ndef m(a=1): pass"), True) is False
    assert _is_bound(_fn("@builtins.staticmethod\ndef m(a=1): pass"), True) is False
    assert _is_bound(_fn("def m(): pass"), True) is False
    assert _is_bound(_fn("def m(other, a=1): pass"), True) is False


def test_a_bound_method_drops_one_positional_index():
    free = _params_with_defaults(_fn("def f(a, b=2): pass"), False)
    bound = _params_with_defaults(_fn("def m(self, a, b=2): pass"), True)
    assert free[0]["index"] == 1
    assert bound[0]["index"] == 1


def test_kwonly_posonly_and_non_literal_defaults():
    rows = _params_with_defaults(_fn("def f(a, /, b=1, *, c=2, d=None, e=X): pass"), False)
    by_param = {r["param"]: r for r in rows}
    assert by_param["b"]["index"] == 1 and by_param["b"]["kwonly"] is False
    assert by_param["c"]["index"] is None and by_param["c"]["kwonly"] is True
    assert "d" not in by_param  # a None default is not one of the three kinds
    assert "e" not in by_param  # and neither is a name
    assert _params_with_defaults(_fn("def f(*, a, b=1): pass"), False)[0]["param"] == "b"


# ── what a definition is matched BY ──────────────────────────────────────────────────────────────


def test_a_constructor_is_matched_against_its_class():
    rows = defaults_in_source("class Foo:\n    def __init__(self, cap=3): pass\n", "m.py")
    assert rows[0]["call_name"] == "Foo"
    assert rows[0]["function"] == "Foo.__init__"


def test_a_method_keeps_its_own_name_and_a_module_function_has_no_owner():
    rows = defaults_in_source("class Foo:\n    def m(self, cap=3): pass\n\n\ndef g(cap=4): pass\n", "m.py")
    by_call = {r["call_name"]: r for r in rows}
    assert by_call["m"]["function"] == "Foo.m"
    assert by_call["g"]["function"] == "g"


def test_a_nested_def_is_outside_this_scan():
    # A closure's default is not reachable by name from a test, so the scan does not claim it.
    assert defaults_in_source("def outer():\n    def inner(cap=3): pass\n", "m.py") == []


def test_an_async_def_is_scanned():
    assert defaults_in_source("async def f(cap=3): pass\n", "m.py")[0]["param"] == "cap"


# ── reading the test corpus ──────────────────────────────────────────────────────────────────────


def test_call_name_reads_a_name_an_attribute_and_nothing_else():
    assert _call_name(_expr("f(1)")) == "f"
    assert _call_name(_expr("M.f(1)")) == "f"
    assert _call_name(_expr("(lambda: 1)()")) is None


def test_every_signature_reading_shape_names_its_function():
    assert _sig_read_name(_expr("inspect.signature(f)")) == "f"
    assert _sig_read_name(_expr("signature(M.f)")) == "f"
    assert _sig_read_name(_expr("f.__defaults__")) == "f"
    assert _sig_read_name(_expr("M.f.__kwdefaults__")) == "f"
    assert _sig_read_name(_expr("M.f.__doc__")) == "f"


def test_a_shape_outside_the_scan_names_nothing():
    assert _sig_read_name(_expr("f.other")) is None
    assert _sig_read_name(_expr("g()")) is None
    assert _sig_read_name(_expr("inspect.signature()")) is None
    assert _sig_read_name(_expr("inspect.signature('f')")) is None
    assert _sig_read_name(_expr("make().__defaults__")) is None
    assert _sig_read_name(_expr("1 + 1")) is None


def test_a_signature_read_is_not_also_a_bare_reference():
    refs = references_in_source("def t():\n    assert inspect.signature(M.f).parameters\n")
    assert refs["sig_reads"] == {"f"}
    assert "f" not in refs["bare"]


def test_a_callback_handoff_is_a_bare_reference():
    refs = references_in_source("def t():\n    run(f)\n")
    assert "f" in refs["bare"]
    assert "f" not in refs["calls"]


# ── one parameter at one call site ───────────────────────────────────────────────────────────────


def test_supplies_reads_keyword_positional_and_omission():
    assert _supplies(_expr("f(cap=1)"), "cap", 1) == "passed"
    assert _supplies(_expr("f(1, 2)"), "cap", 1) == "passed"
    assert _supplies(_expr("f(1)"), "cap", 1) == "omitted"
    assert _supplies(_expr("f(1)"), "cap", None) == "omitted"


def test_either_splat_refuses_rather_than_guessing():
    assert _supplies(_expr("f(**kw)"), "cap", 1) == UNDECIDABLE
    assert _supplies(_expr("f(*args)"), "cap", 1) == UNDECIDABLE


# ── the classification ──────────────────────────────────────────────────────────────────────────


def _entry(**kw):
    base = {"param": "cap", "index": 1, "call_name": "f", "function": "f", "kind": "numeric"}
    return {**base, **kw}


def _refs(sig=(), calls=(), bare=()):
    return {
        "sig_reads": set(sig),
        "calls": {"f": [_expr(c) for c in calls]} if calls else {},
        "bare": set(bare),
    }


def test_an_ambiguous_name_that_a_test_mentions_is_undecidable():
    out = classify(_entry(), _refs(calls=("f(1)",)), True)
    assert out == {"outcome": UNDECIDABLE, "reason": "ambiguous-name"}


def test_an_unmentioned_name_is_uncovered_ambiguous_or_not():
    assert classify(_entry(), _refs(), True)["outcome"] == UNCOVERED
    assert classify(_entry(), _refs(), False)["reason"] == "never referenced"


def test_one_omitting_call_outweighs_every_doubt():
    # POSITIVE EVIDENCE FIRST: a splat or a callback elsewhere cannot retract a call that ran it.
    out = classify(_entry(), _refs(calls=("f(1)", "f(**kw)"), bare=("f",)), False)
    assert out == {"outcome": OBSERVABLE, "reason": None}


def test_doubt_decides_only_a_default_no_call_exercised():
    assert classify(_entry(), _refs(calls=("f(**kw)",)), False)["reason"] == "splat-at-call"
    assert classify(_entry(), _refs(bare=("f",)), False)["reason"] == "bare-name-reference"


def test_a_signature_read_with_no_omitting_call_is_the_defect():
    out = classify(_entry(), _refs(sig=("f",)), False)
    assert out["outcome"] == SIGNATURE_ONLY


def test_a_call_that_passes_the_parameter_covers_nothing_about_the_default():
    out = classify(_entry(), _refs(calls=("f(1, 9)",)), False)
    assert out == {"outcome": UNCOVERED, "reason": "no call omits it"}


# ── the file walk ───────────────────────────────────────────────────────────────────────────────


def _tree(tmp_path, prod: dict, tests: dict):
    for name, text in prod.items():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    if tests:
        (tmp_path / "tests").mkdir(exist_ok=True)
        for name, text in tests.items():
            (tmp_path / "tests" / name).write_text(text, encoding="utf-8")
    return str(tmp_path)


def test_the_walk_skips_the_trees_that_are_not_production(tmp_path):
    root = _tree(
        tmp_path,
        {
            "a.py": "def f(cap=1): pass\n",
            "sub/b.py": "def g(cap=1): pass\n",
            "deploy/c.py": "def h(cap=1): pass\n",
            "__pycache__/d.py": "def i(cap=1): pass\n",
            ".venv/lib/e.py": "def j(cap=1): pass\n",
            "notes.txt": "nothing",
        },
        {"test_a.py": "def t(): f()\n"},
    )
    found = [os.path.relpath(p, root) for p in production_files(root)]
    assert found == ["a.py", os.path.join("sub", "b.py")]
    assert [os.path.basename(p) for p in suite_files(root)] == ["test_a.py"]


def test_a_tree_with_no_tests_directory_reads_as_no_references(tmp_path):
    root = _tree(tmp_path, {"a.py": "def f(cap=1): pass\n"}, {})
    assert suite_files(root) == []
    assert scan(root)["counts"][UNCOVERED] == 1


def test_a_pycache_inside_tests_is_skipped(tmp_path):
    root = _tree(tmp_path, {"a.py": "def f(cap=1): pass\n"}, {"test_a.py": "def t(): f()\n"})
    cache = tmp_path / "tests" / "__pycache__"
    cache.mkdir()
    (cache / "stale.py").write_text("def t(): f(cap=9)\n", encoding="utf-8")
    assert [os.path.basename(p) for p in suite_files(root)] == ["test_a.py"]


# ── 🔴 THE NEGATIVE CONTROL ─────────────────────────────────────────────────────────────────────

_PLANT_PROD = {
    "sigonly.py": "def only_read(cap=10.0):\n    return cap\n",
    "runs.py": "def exercised(cap=10.0):\n    return cap\n",
    "never.py": "def untouched(cap=10.0):\n    return cap\n",
    "splat.py": "def splatted(cap=10.0):\n    return cap\n",
}
_PLANT_TESTS = {
    "test_plant.py": (
        "def test_a():\n"
        "    assert inspect.signature(only_read).parameters['cap'].default == 10.0\n"
        "\n\ndef test_b():\n"
        "    assert exercised() == 10.0\n"
        "\n\ndef test_c():\n"
        "    assert splatted(**kw) == 10.0\n"
    ),
}


def test_the_planted_tree_names_one_of_each_outcome(tmp_path):
    result = scan(_tree(tmp_path, _PLANT_PROD, _PLANT_TESTS))
    by_function = {row["function"]: row for row in result["rows"]}
    assert by_function["only_read"]["outcome"] == SIGNATURE_ONLY
    assert by_function["exercised"]["outcome"] == OBSERVABLE
    assert by_function["untouched"]["outcome"] == UNCOVERED
    assert by_function["splatted"]["outcome"] == UNDECIDABLE
    assert result["counts"] == {
        SIGNATURE_ONLY: 1,
        OBSERVABLE: 1,
        UNCOVERED: 1,
        UNDECIDABLE: 1,
    }


def test_cutting_the_signature_read_moves_the_row(tmp_path):
    # Cut the one guard that makes the planted defect a defect: with the signature assertion gone,
    # nothing mentions the function, so the row must read UNCOVERED rather than stay SIGNATURE_ONLY.
    cut = dict(_PLANT_TESTS)
    cut["test_plant.py"] = cut["test_plant.py"].replace(
        "    assert inspect.signature(only_read).parameters['cap'].default == 10.0", "    pass"
    )
    result = scan(_tree(tmp_path, _PLANT_PROD, cut))
    by_function = {row["function"]: row for row in result["rows"]}
    assert by_function["only_read"]["outcome"] == UNCOVERED
    assert result["counts"][SIGNATURE_ONLY] == 0


def test_adding_an_omitting_call_clears_the_planted_defect(tmp_path):
    fixed = dict(_PLANT_TESTS)
    fixed["test_plant.py"] += "\n\ndef test_d():\n    assert only_read() == 10.0\n"
    result = scan(_tree(tmp_path, _PLANT_PROD, fixed))
    by_function = {row["function"]: row for row in result["rows"]}
    assert by_function["only_read"]["outcome"] == OBSERVABLE


def test_one_name_in_two_production_modules_is_undecidable(tmp_path):
    root = _tree(
        tmp_path,
        {"a.py": "def f(cap=1): pass\n", "b.py": "def f(cap=2): pass\n"},
        {"test_a.py": "def t(): f()\n"},
    )
    result = scan(root)
    assert [row["reason"] for row in result["rows"]] == ["ambiguous-name"] * 2


# ── the verdict object ──────────────────────────────────────────────────────────────────────────


def _result(**counts):
    full = {SIGNATURE_ONLY: 0, OBSERVABLE: 0, UNCOVERED: 0, UNDECIDABLE: 0, **counts}
    rows = [{"outcome": k} for k, n in full.items() for _ in range(n)]
    return {"root": ".", "rows": rows, "counts": full, "modules": 1}


def test_the_object_fails_over_a_non_empty_population():
    obj = verdict_object(_result(**{SIGNATURE_ONLY: 2, OBSERVABLE: 1}), "abc1234")
    _verdict.validate(obj)
    assert obj["status"] == "FAIL"
    assert obj["reason"] == "2 default(s) covered only by a signature read"
    assert obj["population"] == {"checked": 3, "eligible": 3, "excluded": 0}
    assert obj["producedBy"]["commit"] == "abc1234"


def test_the_object_passes_over_an_empty_one_and_excludes_the_undecidable():
    obj = verdict_object(_result(**{OBSERVABLE: 2, UNDECIDABLE: 1}), None)
    _verdict.validate(obj)
    assert obj["status"] == "PASS"
    assert obj["reason"] is None
    assert obj["population"] == {"checked": 2, "eligible": 3, "excluded": 1}
    assert obj["criterion"]["threshold"] == 0


def test_a_tree_in_which_nothing_was_classifiable_is_not_run():
    obj = verdict_object(_result(**{UNDECIDABLE: 1}), None)
    _verdict.validate(obj)
    assert obj["status"] == "NOT_RUN"
    assert obj["reason"] == "no literal default was classifiable in this tree"
    assert obj["result"] is None


def test_the_sample_object_is_valid_and_needs_no_tree():
    obj = sample_verdict()
    _verdict.validate(obj)
    assert obj["gate"] == "scan-signature-only-defaults"


# ── the report and the CLI ──────────────────────────────────────────────────────────────────────


def test_the_report_lists_offenders(tmp_path):
    text = format_report(scan(_tree(tmp_path, _PLANT_PROD, _PLANT_TESTS)))
    assert "sigonly.py:1 only_read(cap=) [numeric]" in text
    assert "ADVISORY" in text
    assert "runs.py" not in text  # an observable default is counted, never listed


def test_main_prints_the_report_and_exits_zero(tmp_path, capsys):
    root = _tree(tmp_path, _PLANT_PROD, _PLANT_TESTS)
    assert main(["--root", root]) == 0
    assert "signature-only" in capsys.readouterr().out


def test_main_json_carries_the_rows(tmp_path, capsys):
    root = _tree(tmp_path, _PLANT_PROD, _PLANT_TESTS)
    assert main(["--root", root, "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["counts"][SIGNATURE_ONLY] == 1
    assert len(payload["rows"]) == 4


def test_main_writes_one_verdict_object_beside_the_report(tmp_path, capsys):
    root = _tree(tmp_path, _PLANT_PROD, _PLANT_TESTS)
    out = tmp_path / "v.json"
    assert main(["--root", root, "--verdict-out", str(out)]) == 0
    capsys.readouterr()
    obj = json.loads(out.read_text(encoding="utf-8"))
    _verdict.validate(obj)
    assert obj["status"] == "FAIL"


def test_main_verdict_sample_prints_the_object_alone(capsys):
    assert main(["--verdict-sample"]) == 0
    _verdict.validate(json.loads(capsys.readouterr().out))


def test_the_commit_is_read_from_git_and_refused_when_git_refuses(monkeypatch):
    class _Out:
        def __init__(self, rc, text):
            self.returncode = rc
            self.stdout = text

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: _Out(0, "abcdef123456\n"))
    assert _commit() == "abcdef123456"
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: _Out(128, ""))
    assert _commit() is None


# ── the branches a first green run did not reach ────────────────────────────────────────────────


def test_an_unrelated_decorator_leaves_a_method_bound():
    assert _is_bound(_fn("@property\ndef m(self, a=1): pass"), True) is True


def test_a_non_literal_positional_default_is_skipped():
    rows = _params_with_defaults(_fn("def f(a=X, b=1): pass"), False)
    assert [r["param"] for r in rows] == ["b"]


def test_a_class_body_that_is_not_only_functions():
    rows = defaults_in_source('class Foo:\n    """doc"""\n\n    CAP = 1\n\n    def m(self, cap=3): pass\n', "m.py")
    assert [r["call_name"] for r in rows] == ["m"]


def test_two_positional_arguments_short_of_the_index_still_omit_it():
    assert _supplies(_expr("f(1, 2)"), "cap", 5) == "omitted"


def test_a_call_this_scan_cannot_name_does_not_stop_the_walk():
    refs = references_in_source("def t():\n    (lambda: 1)()\n    g(1)\n")
    assert "g" in refs["calls"]


def test_a_non_python_file_in_the_suite_directory_is_skipped(tmp_path):
    root = _tree(tmp_path, {"a.py": "def f(cap=1): pass\n"}, {"test_a.py": "def t(): f()\n"})
    (tmp_path / "tests" / "data.txt").write_text("x", encoding="utf-8")
    assert [os.path.basename(p) for p in suite_files(root)] == ["test_a.py"]


def test_the_keyword_search_walks_past_an_unrelated_keyword():
    assert _supplies(_expr("f(other=1, cap=2)"), "cap", None) == "passed"
