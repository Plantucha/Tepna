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


def ok(v, status):
    r = js_validate(v)
    assert r["ok"], r["errors"]
    assert v["status"] == status and v["gate"] == "capture-host-check" and v["scope"] == "internal"
    return v


@pytest.mark.parametrize(
    "name, rc, status",
    [
        ("ruff", 0, "PASS"), ("ruff", 1, "FAIL"), ("ruff", 2, "UNKNOWN"), ("ruff", 127, "NOT_RUN"),
        ("shellcheck", 1, "FAIL"), ("shellcheck", 2, "UNKNOWN"), ("shellcheck", 3, "UNKNOWN"), ("shellcheck", 4, "UNKNOWN"),
        ("pytest", 1, "FAIL"), ("pytest", 2, "UNKNOWN"), ("pytest", 3, "UNKNOWN"), ("pytest", 4, "UNKNOWN"),
        ("pytest", 5, "UNKNOWN"), ("pytest", 127, "NOT_RUN"),
        ("unwired", 1, "FAIL"), ("unwired", 9, "UNKNOWN"),
        ("newchild", 1, "UNKNOWN"),   # no contract row: a code the contract does not name is never a FAIL
    ],
)
def test_every_child_status_comes_off_the_documented_exit_code_contract(name, rc, status):
    st, detail = C.child_status(name, rc)
    assert st == status and f"exit {rc}" in detail


def test_pytest_5_names_the_vacuous_run_and_127_names_the_missing_tool():
    assert "no tests collected" in C.child_status("pytest", 5)[1]
    assert "not installed" in C.child_status("shellcheck", 127)[1]


def test_all_green_is_PASS_over_four_checked_with_the_advisory_tokens_riding_along():
    v = ok(C.aggregate(GREEN, {"mypy": "AT_BASELINE", "format": "EMPTY_SCOPE"}), "PASS")
    assert v["population"] == {"checked": 4, "eligible": 4, "excluded": 0}
    assert v["result"]["pass"] == 4 and v["result"]["firstFailure"] is None
    assert v["result"]["advisory"] == {"mypy": "AT_BASELINE", "format": "EMPTY_SCOPE"}
    assert v["evidence"] == ["capture-host/check.sh", "ruff exit 0", "shellcheck exit 0", "pytest exit 0", "unwired exit 0"]


def test_any_FAIL_wins_and_names_the_first_failing_child_and_the_count():
    v = ok(C.aggregate({**GREEN, "ruff": 1, "pytest": 1, "unwired": 127}), "FAIL")
    assert v["result"]["firstFailure"] == "ruff" and v["reason"].startswith("2 of 4 children failed")
    assert v["population"] == {"checked": 3, "eligible": 4, "excluded": 1}


def test_an_UNKNOWN_child_is_never_green_one_level_up_it_is_not_a_vote():
    v = ok(C.aggregate({**GREEN, "pytest": 5}), "UNKNOWN")
    assert v["result"]["unknown"] == 1 and "vacuous" in v["reason"]


def test_a_missing_tool_is_NOT_RUN_for_the_child_excluded_and_the_run_is_UNKNOWN_never_PASS():
    v = ok(C.aggregate({**GREEN, "shellcheck": 127}), "UNKNOWN")
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
