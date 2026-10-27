# tepna-capture — tests/test_checkverdict.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`checkverdict.py` — check.sh's runner-level object (VERDICT-CONTRACT §3d): every child status from its
documented exit-code contract, the aggregation by precedence (never a vote), every object through verdict.js."""

from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import checkverdict as C  # noqa: E402
from test_verdict import js_validate  # noqa: E402

GREEN = {"ruff": 0, "shellcheck": 0, "pytest": 0, "unwired": 0}
CRIT = {"name": "unexplained_findings_plus_spent_suppressions", "threshold": 0, "unit": "findings", "direction": "eq"}


def unwired_obj(status="PASS", gate="find-unwired"):
    """A valid `tepna.verdict/1` as find_unwired.py writes it (built through the contract's own `make`)."""
    return C.VD.make(
        gate=gate,
        status=status,
        population={"checked": 3, "eligible": 3, "excluded": 0},
        criterion=CRIT,
        result={"unexplained": 0 if status == "PASS" else 1},
        evidence=["capture-host/tools/find_unwired.py"],
        reason=None if status == "PASS" else "1 unexplained finding(s)",
        tool="capture-host/tools/find_unwired.py",
    )


GREEN_OBJECTS = {"unwired": unwired_obj()}


def ok(v, status):
    r = js_validate(v)
    assert r["ok"], r["errors"]
    assert v["status"] == status and v["gate"] == "capture-host-check" and v["scope"] == "internal"
    return v


@pytest.mark.parametrize(
    "name, rc, status",
    [
        ("ruff", 0, "PASS"),
        ("ruff", 1, "FAIL"),
        ("ruff", 2, "UNKNOWN"),
        ("ruff", 127, "NOT_RUN"),
        ("shellcheck", 1, "FAIL"),
        ("shellcheck", 2, "UNKNOWN"),
        ("shellcheck", 3, "UNKNOWN"),
        ("shellcheck", 4, "UNKNOWN"),
        ("pytest", 1, "FAIL"),
        ("pytest", 2, "UNKNOWN"),
        ("pytest", 3, "UNKNOWN"),
        ("pytest", 4, "UNKNOWN"),
        ("pytest", 5, "UNKNOWN"),
        ("pytest", 127, "NOT_RUN"),
        ("unwired", 127, "NOT_RUN"),  # a missing TOOL is NOT_RUN whatever it would have said
        ("newchild", 1, "UNKNOWN"),  # no contract row: a code the contract does not name is never a FAIL
    ],
)
def test_every_child_status_comes_off_the_documented_exit_code_contract(name, rc, status):
    st, detail = C.child_status(name, rc)
    assert st == status and f"exit {rc}" in detail


def test_pytest_5_names_the_vacuous_run_and_127_names_the_missing_tool():
    assert "no tests collected" in C.child_status("pytest", 5)[1]
    assert "not installed" in C.child_status("shellcheck", 127)[1]


def test_all_green_is_PASS_now_that_unwired_publishes_its_own_object():
    """THE RESIDUE. `unwired` was the last child of ours with no object, so a fully green run read UNKNOWN
    and the box gate's `status` could never be PASS. Read from its own PASS object, it is PASS, and so is
    the run — and it is the OBJECT that decides, which the next test pins."""
    v = ok(C.aggregate(GREEN, {"mypy": "AT_BASELINE", "format": "EMPTY_SCOPE"}, GREEN_OBJECTS), "PASS")
    assert v["population"] == {"checked": 4, "eligible": 4, "excluded": 0}
    assert v["result"]["pass"] == 4 and v["result"]["unknown"] == 0 and v["result"]["statuses"]["unwired"] == "PASS"
    assert v["reason"] is None
    assert v["result"]["advisory"] == {"mypy": "AT_BASELINE", "format": "EMPTY_SCOPE"}
    assert v["evidence"] == [
        "capture-host/check.sh",
        "ruff exit 0",
        "shellcheck exit 0",
        "pytest exit 0",
        "unwired exit 0",
    ]


@pytest.mark.parametrize(
    "rc, obj, status, why",
    [
        (0, None, "UNKNOWN", "no tepna.verdict/1 object"),  # exit 0 is NOT enough: ours is read by object
        (1, None, "UNKNOWN", "no tepna.verdict/1 object"),  # …and a crash (exit 1, no object) is not a FAIL
        (0, {"schema": "tepna.verdict/1"}, "UNKNOWN", "not a valid tepna.verdict/1"),
        (0, unwired_obj(gate="some-other-gate"), "UNKNOWN", "not 'find-unwired'"),
        (1, unwired_obj("PASS"), "UNKNOWN", "contradicts its own PASS object"),
        (1, unwired_obj("FAIL"), "FAIL", "its own object: FAIL"),
        (0, unwired_obj("PASS"), "PASS", "its own object: PASS"),
        (0, unwired_obj("FAIL"), "FAIL", "its own object: FAIL"),  # the object stands over a green exit
    ],
)
def test_unwired_is_read_from_its_OWN_object_and_a_missing_or_foreign_one_is_UNKNOWN(rc, obj, status, why):
    st, detail = C.child_status("unwired", rc, obj)
    assert st == status and why in detail and f"exit {rc}" in detail


def test_the_three_external_children_green_IS_a_PASS_with_no_adopted_child_in_the_run():
    v = ok(C.aggregate({"ruff": 0, "shellcheck": 0, "pytest": 0}), "PASS")
    assert v["result"]["pass"] == 3 and v["result"]["firstFailure"] is None


def test_the_adopted_and_unadopted_sets_partition_the_children_of_ours():
    assert C.ADOPTED_OURS == {"unwired": "find-unwired", "covscope": "capture-host-coverage-scope"}
    assert C.UNADOPTED_OURS == frozenset(), "both tools of ours adopted; a name returns here only for a NEW one"
    assert not (C.UNADOPTED_OURS & set(C.ADOPTED_OURS)) and not (set(C.ADOPTED_OURS) & set(C.CONTRACTS))


def test_a_tool_of_ours_still_UNADOPTED_is_UNKNOWN_by_provenance_whatever_its_exit(monkeypatch):
    """The floor survives its last occupant: a name placed back in UNADOPTED_OURS reads UNKNOWN."""
    monkeypatch.setattr(C, "UNADOPTED_OURS", frozenset({"newtool"}))
    for rc in (0, 1):
        st, detail = C.child_status("newtool", rc)
        assert st == "UNKNOWN" and "by provenance" in detail
    assert C.child_status("newtool", 127)[0] == "NOT_RUN"


def test_any_FAIL_wins_and_names_the_first_failing_child_and_the_count():
    v = ok(C.aggregate({**GREEN, "ruff": 1, "pytest": 1, "unwired": 127}, objects=GREEN_OBJECTS), "FAIL")
    assert v["result"]["firstFailure"] == "ruff" and v["reason"].startswith("2 of 4 children failed")
    assert v["population"] == {"checked": 3, "eligible": 4, "excluded": 1}


def test_an_UNKNOWN_child_is_never_green_one_level_up_it_is_not_a_vote():
    v = ok(C.aggregate({**GREEN, "pytest": 5}, objects=GREEN_OBJECTS), "UNKNOWN")
    assert v["result"]["unknown"] == 1 and "vacuous" in v["reason"]  # pytest 5 alone: unwired is PASS now
    v = ok(C.aggregate({**GREEN, "pytest": 5}), "UNKNOWN")  # …and with unwired's object missing, two undecided
    assert v["result"]["unknown"] == 2


def test_a_missing_tool_is_NOT_RUN_for_the_child_excluded_and_the_run_is_UNKNOWN_never_PASS():
    v = ok(C.aggregate({**GREEN, "shellcheck": 127}, objects=GREEN_OBJECTS), "UNKNOWN")
    assert v["result"]["statuses"]["shellcheck"] == "NOT_RUN" and v["result"]["notRun"] == 1
    assert v["population"] == {"checked": 3, "eligible": 4, "excluded": 1}


def test_no_child_examined_is_NOT_RUN_with_the_missing_tools_named():
    v = ok(C.aggregate({"ruff": 127, "pytest": 127}), "NOT_RUN")
    assert v["result"] is None and "ruff" in v["reason"] and "pytest" in v["reason"]
    ok(C.aggregate({}), "NOT_RUN")


def test_parse_pairs_reads_name_eq_code_and_refuses_a_malformed_pair():
    assert C.parse_pairs(["ruff=0", "pytest=127"]) == {"ruff": 0, "pytest": 127}
    with pytest.raises(ValueError):
        C.parse_pairs(["ruff"])
    with pytest.raises(ValueError):
        C.parse_pairs(["=1"])


def test_cli_sample_write_and_usage(tmp_path, capsys):
    assert C.main(["--verdict-sample"]) == 0
    ok(json.loads(capsys.readouterr().out), "PASS")
    out = tmp_path / "v.json"
    assert C.main(["--write", str(out), "--advisory", "mypy=RISEN", "ruff=0", "shellcheck=1"]) == 0
    v = ok(json.load(open(out)), "FAIL")
    assert v["result"]["advisory"] == {"mypy": "RISEN"} and v["result"]["exitCodes"] == {"ruff": 0, "shellcheck": 1}
    assert "verdict: FAIL" in capsys.readouterr().out
    assert C.main([]) == 2 and C.main(["--write"]) == 2
    assert "usage" in capsys.readouterr().err


def test_a_trailing_advisory_flag_without_a_value_is_an_empty_token_not_a_crash(tmp_path):
    out = tmp_path / "v.json"
    assert C.main(["--write", str(out), "ruff=0", "--advisory"]) == 0
    assert json.load(open(out))["result"]["advisory"] == {"": ""}


def test_cli_reads_an_adopted_childs_object_off_disk_and_a_bad_file_is_UNKNOWN_never_green(tmp_path, capsys):
    good = tmp_path / "unwired.json"
    good.write_text(json.dumps(unwired_obj()), encoding="utf-8")
    out = tmp_path / "v.json"
    args = ["--write", str(out), "ruff=0", "shellcheck=0", "pytest=0", "unwired=0"]
    assert C.main([*args[:2], "--object", f"unwired={good}", *args[2:]]) == 0
    assert ok(json.load(open(out)), "PASS")["result"]["statuses"]["unwired"] == "PASS"
    assert "verdict: PASS" in capsys.readouterr().out
    # absent · not JSON · JSON that is not an object — each is "no usable object", so UNKNOWN
    bad_json = tmp_path / "bad.json"
    bad_json.write_text("{not json", encoding="utf-8")
    not_obj = tmp_path / "list.json"
    not_obj.write_text("[1]", encoding="utf-8")
    for path in (tmp_path / "absent.json", bad_json, not_obj):
        assert C.load_object(str(path)) is None
        assert C.main([*args[:2], "--object", f"unwired={path}", *args[2:]]) == 0
        v = ok(json.load(open(out)), "UNKNOWN")
        assert v["result"]["statuses"]["unwired"] == "UNKNOWN" and "no tepna.verdict/1 object" in v["reason"]
    # with no --object at all (the pre-adoption invocation) unwired is likewise UNKNOWN
    assert C.main(args) == 0
    ok(json.load(open(out)), "UNKNOWN")


# ── the diff-scoped mutation gate on #3567: 25 survivors in checkverdict.py and mutation_diff.py ──────
# Twenty-five mutants survived on 83d16d551. Fifteen tests over the two modules each fail on a named
# mutant, and the one survivor left is carried in the equivalence file as a measured equivalence.
# The set was drained inside #3567, whose gate read PASS at landing, so no residue row is owed.


def test_no_child_examined_with_nothing_missing_carries_the_bare_reason_with_no_dangling_dash():
    """`{}` has no NOT_RUN child to name, so the reason is the sentence alone — the `if not_run` guard must
    not be taken (`or True` rendered a trailing ' — ' with an empty detail)."""
    assert C.aggregate({})["reason"] == "no child ran to a verdict"
    assert C.aggregate({"ruff": 127})["reason"].startswith("no child ran to a verdict — ruff: exit 127")


def test_load_object_reads_the_file_as_utf8_whatever_the_locale(tmp_path, monkeypatch):
    """The reader names its codec: a child's object must not decode differently under another locale."""
    path = tmp_path / "o.json"
    path.write_text(json.dumps({"reason": "—"}, ensure_ascii=False), encoding="utf-8")
    seen: list[dict] = []
    real_open = open

    def spy(*a, **kw):
        seen.append(kw)
        return real_open(*a, **kw)

    monkeypatch.setattr(C, "open", spy, raising=False)
    assert C.load_object(str(path)) == {"reason": "—"}
    assert seen == [{"encoding": "utf-8"}]


def test_verdict_sample_prints_one_space_indented_json(capsys):
    assert C.main(["--verdict-sample"]) == 0
    out = capsys.readouterr().out
    lines = out.splitlines()
    assert json.loads(out)["status"] == "PASS" and len(lines) > 5
    assert lines[1].startswith(' "') and not lines[1].startswith("  "), "indent=1, exactly"


def test_write_with_a_path_and_no_children_is_a_NOT_RUN_object_not_a_usage_error(tmp_path, capsys):
    """`--write <path>` alone has len(argv) == 2: it is complete, so it writes (an empty run is NOT_RUN, §∅)."""
    out = tmp_path / "v.json"
    assert C.main(["--write", str(out)]) == 0
    v = json.load(open(out))
    assert v["status"] == "NOT_RUN" and v["reason"] == "no child ran to a verdict"
    assert "usage" not in capsys.readouterr().err


def test_advisory_and_object_values_split_at_the_FIRST_equals(tmp_path):
    """`k=a=b` is key `k`, value `a=b`: an advisory token or a file path may itself contain '='."""
    out = tmp_path / "v.json"
    d = tmp_path / "dir=with=equals"
    d.mkdir()
    obj = d / "u.json"
    obj.write_text(json.dumps(unwired_obj()), encoding="utf-8")
    args = ["--write", str(out), "--advisory", "mypy=a=b", "--object", f"unwired={obj}"]
    assert C.main([*args, "ruff=0", "shellcheck=0", "pytest=0", "unwired=0"]) == 0
    v = ok(json.load(open(out)), "PASS")
    assert v["result"]["advisory"] == {"mypy": "a=b"}, "the advisory split at the first '='"
    assert v["result"]["statuses"]["unwired"] == "PASS", "the object path kept its own '='"


def test_a_trailing_object_flag_without_a_value_is_an_empty_unreadable_object_not_a_crash(tmp_path):
    out = tmp_path / "v.json"
    assert C.main(["--write", str(out), "ruff=0", "--object"]) == 0
    assert json.load(open(out))["status"] == "PASS"


def test_the_sample_hands_aggregate_a_green_object_per_adopted_child_and_the_two_advisory_tokens(monkeypatch):
    """`verdict_sample` is the adoption gate's green shape: the synthetic child object must itself state a
    clean run (threshold 0, nothing unexplained) and the advisory tokens must reach the verdict."""
    seen: list[tuple] = []
    real = C.aggregate

    def spy(children, advisory=None, objects=None):
        seen.append((children, advisory, objects))
        return real(children, advisory, objects)

    monkeypatch.setattr(C, "aggregate", spy)
    v = C.verdict_sample()
    ((children, advisory, objects),) = seen
    # EVERY ADOPTED CHILD RIDES THE SAMPLE. A sample that names fewer children than check.sh runs is a
    # green shape nobody executes, and the adoption gate would validate it anyway.
    assert children == GREEN | {"covscope": 0}
    assert set(objects) == set(C.ADOPTED_OURS)
    assert advisory == {"mypy": "AT_BASELINE", "format": "EMPTY_SCOPE"}
    assert v["result"]["advisory"] == advisory
    u = objects["unwired"]
    assert u["criterion"]["threshold"] == 0 and u["result"] == {"unexplained": 0} and u["status"] == "PASS"
    c = objects["covscope"]
    assert c["gate"] == "capture-host-coverage-scope" and c["result"] == {"findings": 0} and c["status"] == "PASS"


# ── `--refused`: the preflight stopped before any child ran ──────────────────────────────────────────


def test_a_refusal_is_NOT_RUN_over_the_eligible_children_with_the_reason_kept():
    """`checked + excluded == eligible` and `checked == 0` (§🧾): five children were eligible, none was
    examined. The reason is the refusal's own, because a generic "no child ran" cannot be acted on."""
    v = C.refusal(["ruff", "shellcheck", "pytest", "unwired", "format"], "no ruff — nothing was examined")
    assert v["schema"] == "tepna.verdict/1" and v["gate"] == C.GATE
    assert v["status"] == "NOT_RUN"
    assert v["population"] == {"checked": 0, "eligible": 5, "excluded": 5}
    assert v["population"]["checked"] + v["population"]["excluded"] == v["population"]["eligible"]
    assert v["result"] is None, "nothing ran, so there is no result to report"
    assert v["reason"] == "no ruff — nothing was examined"
    assert v["evidence"][0] == C.TOOL and "ruff not invoked" in v["evidence"]


def test_refused_takes_BARE_names_because_no_child_has_an_exit_code(tmp_path):
    """Through the CLI, which is how check.sh calls it. `parse_pairs` rightly refuses a name without a
    code, and fabricating one here would be the same lie in the other direction."""
    out = tmp_path / "v.json"
    rc = C.main(["--write", str(out), "--refused", "the interpreter carries none of: ruff", "ruff", "pytest"])
    assert rc == 0
    v = json.loads(out.read_text())
    assert v["status"] == "NOT_RUN" and v["population"]["eligible"] == 2
    assert v["reason"] == "the interpreter carries none of: ruff"


def test_refused_as_the_LAST_argument_still_writes_a_refusal_with_a_NAMED_reason(tmp_path):
    """The default behind `next(it, …)`, which the mutation gate found unobserved. Two wrong defaults are
    reachable from here and both are worse than a named one: `None` falls through to `aggregate`, which
    reports "no child ran to a verdict" — a refusal described as an empty run — and a bare `next(it)`
    raises `StopIteration` through the writer, so the stale object the preflight is guarding against
    survives on disk. An empty string is the third: a non-PASS with no reason (§🧾)."""
    out = tmp_path / "v.json"
    rc = C.main(["--write", str(out), "--refused"])
    assert rc == 0, "a malformed refusal still owes an object — writing nothing leaves the stale one"
    v = json.loads(out.read_text())
    assert v["status"] == "NOT_RUN"
    assert v["reason"] == C.REFUSAL_REASON_ABSENT
    assert v["reason"], "§🧾: every non-PASS carries a reason, so the absence is named, not empty"
    assert v["reason"] != "no child ran to a verdict", "a refusal is not an empty run"
