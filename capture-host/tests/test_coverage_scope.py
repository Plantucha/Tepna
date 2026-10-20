# tepna-capture — tests/test_coverage_scope.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The pin ledger and its gate: `coverage_scope.py` plus the exit contract of `tools/covscope.py`.

THE DEFECT UNDER TEST. A `tools/*.py` that no test imports is absent from the coverage report, and its
absence reads exactly like 100 % under `--cov-fail-under=100`. These tests hold the four ways the
ledger and the report can disagree, and the negative control is the whole point: plant a declared tool
that is neither measured nor pinned and the gate must red. A check that cannot red on that is a check
that reports success about something it never examined.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

import coverage_scope as CS
import verdict as VD

AT = "2026-10-20T13:00:00Z"
SHA = "63f6ac951"
HERE = Path(__file__).resolve().parent.parent
CLI = HERE / "tools" / "covscope.py"


def _obj(report, **kw):
    return CS.verdict_object(report, commit=SHA, at=AT, **kw)


# ── THE LEDGER ITSELF, AGAINST THE REAL DIRECTORY ───────────────────────────────────────────────────


def test_every_pinned_path_still_exists_on_disk():
    """A pin for a file that is gone is a claim about nothing. The gate reports it, and so does this."""
    missing = [p for p in CS.UNMEASURED_BY_DESIGN if not (HERE / p).exists()]
    assert missing == []


def test_every_pin_carries_a_reason():
    """The reason is the whole value of an allowlist — `find_unwired`'s ALLOW_FUNCS is the precedent."""
    assert [p for p, why in CS.UNMEASURED_BY_DESIGN.items() if not why.strip()] == []


def test_the_pinned_set_is_inside_the_scope_directory():
    assert all(p.startswith(f"{CS.SCOPE_DIR}/") and p.endswith(".py") for p in CS.UNMEASURED_BY_DESIGN)


# ── THE FOUR DISAGREEMENTS ──────────────────────────────────────────────────────────────────────────


def test_a_declared_tool_that_is_neither_measured_nor_pinned_fails_and_the_reason_names_it():
    """THE NEGATIVE CONTROL. This is the defect itself: a new tool joins `tools/`, nothing imports it,
    the coverage report never mentions it, and the floor stays at 100 %."""
    report = CS.classify(
        ["tools/measured.py", "tools/newcomer.py"],
        ["tools/measured.py"],
        {},
    )
    assert report["unpinned"] == ["tools/newcomer.py"]
    obj = _obj(report)
    assert obj["status"] == "FAIL"
    assert "tools/newcomer.py" in obj["reason"]
    assert obj["result"]["findings"] == 1
    VD.validate(obj)


def test_a_pin_whose_file_became_measured_is_spent_and_fails():
    """A pin is a statement that the file sits OUTSIDE the floor. Once a test imports it the statement
    is false, and a stale pin is how the ledger stops describing the tree."""
    report = CS.classify(["tools/cli.py"], ["tools/cli.py"], {"tools/cli.py": "plumbing only"})
    assert report["pinnedButMeasured"] == ["tools/cli.py"]
    obj = _obj(report)
    assert obj["status"] == "FAIL"
    assert "spent" in obj["reason"]


def test_a_pin_for_a_file_that_is_gone_fails():
    report = CS.classify(["tools/cli.py"], [], {"tools/cli.py": "plumbing", "tools/deleted.py": "gone"})
    assert report["pinnedButAbsent"] == ["tools/deleted.py"]
    assert _obj(report)["status"] == "FAIL"


def test_a_pin_without_a_reason_fails_even_when_the_membership_is_right():
    report = CS.classify(["tools/cli.py"], [], {"tools/cli.py": "   "})
    assert report["pinnedWithoutReason"] == ["tools/cli.py"]
    obj = _obj(report)
    assert obj["status"] == "FAIL"
    assert obj["result"]["findings"] == 1


def test_all_four_disagreements_are_reported_together_never_the_first_one():
    """§4b's shape: a verdict read off the first finding hides the rest."""
    report = CS.classify(
        ["tools/newcomer.py", "tools/measured.py", "tools/blank.py"],
        ["tools/measured.py"],
        {"tools/measured.py": "pinned but measured", "tools/gone.py": "absent", "tools/blank.py": ""},
    )
    assert CS.finding_count(report) == 4
    reason = CS.reason_line(report)
    for name in ("tools/newcomer.py", "tools/measured.py", "tools/gone.py", "tools/blank.py"):
        assert name in reason


# ── THE CLEAN AND EMPTY CASES ───────────────────────────────────────────────────────────────────────


def test_a_scope_whose_every_file_is_measured_or_pinned_passes():
    report = CS.classify(
        ["tools/measured.py", "tools/cli.py"],
        ["tools/measured.py"],
        {"tools/cli.py": "plumbing only; the decisions live one directory up"},
    )
    assert CS.finding_count(report) == 0
    assert CS.reason_line(report) is None
    # MEMBERSHIP, not cardinality. Both lists hold one path here, so a `measured` that reported the
    # UNmeasured file instead carried the same count and no assertion moved — exactly the mutant
    # that survived on 2026-10-20. The two lists partition what was declared, and the verdict
    # publishes their sizes, so the figures are only as good as which file sits in which.
    assert report["measured"] == ["tools/measured.py"]
    assert report["unmeasured"] == ["tools/cli.py"]
    assert sorted(report["measured"] + report["unmeasured"]) == report["declared"]
    obj = _obj(report)
    assert (obj["status"], obj["reason"]) == ("PASS", None)
    assert obj["result"]["measured"] == 1 and obj["result"]["pinned"] == 1
    VD.validate(obj)


def test_an_empty_scope_is_NOT_RUN_with_a_null_result_and_never_a_pass():
    """An empty glob examined nothing. `verdict.py` refuses a PASS over `checked: 0`; this says the
    status outright rather than leaning on that refusal."""
    report = CS.classify([], [], {})
    obj = _obj(report)
    assert obj["status"] == "NOT_RUN"
    assert obj["result"] is None
    assert "nothing was examined" in obj["reason"]
    VD.validate(obj)


def test_the_population_counts_every_declared_file_and_excludes_none():
    """A pin is a recorded answer, not an exclusion — reporting it as `excluded` would claim the file
    was set aside unexamined, which is the shape this gate exists to catch."""
    report = CS.classify(["tools/a.py", "tools/b.py"], ["tools/a.py"], {"tools/b.py": "plumbing"})
    pop = _obj(report)["population"]
    assert pop == {"checked": 2, "eligible": 2, "excluded": 0}


def test_a_duplicate_in_the_declared_list_is_counted_once():
    report = CS.classify(["tools/a.py", "tools/a.py"], ["tools/a.py"], {})
    assert report["declared"] == ["tools/a.py"]


def test_the_ledger_is_the_default_when_no_pins_are_handed_in():
    report = CS.classify(sorted(CS.UNMEASURED_BY_DESIGN), [])
    assert report["unpinned"] == []
    assert report["pinned"] == sorted(CS.UNMEASURED_BY_DESIGN)


# ── THE REFUSAL ─────────────────────────────────────────────────────────────────────────────────────


def test_the_refusal_is_UNKNOWN_with_a_reason_and_no_result():
    """An unreadable coverage report is an absent measurement, never a pass and never a FAIL about the
    tree (CLAUDE.md §∅)."""
    obj = CS.refusal_object("no coverage data at .coverage", commit=SHA, at=AT)
    assert obj["status"] == "UNKNOWN"
    assert obj["result"] is None
    assert obj["population"] == {"checked": 0, "eligible": 0, "excluded": 0}
    assert obj["reason"] == "no coverage data at .coverage"
    VD.validate(obj)


@pytest.mark.parametrize(
    "build", [lambda: _obj(CS.classify([], [], {})), lambda: CS.refusal_object("why", commit=None, at=AT)]
)
def test_an_object_built_outside_a_checkout_says_why_the_commit_is_null(build):
    obj = build()
    if obj["producedBy"]["commit"] is None:
        assert obj["producedBy"]["commitReason"]
    VD.validate(obj)


def test_a_null_commit_carries_a_commit_reason_in_both_builders():
    for obj in (
        CS.verdict_object(CS.classify(["tools/a.py"], ["tools/a.py"], {}), commit=None, at=AT),
        CS.refusal_object("why", commit=None, at=AT),
    ):
        assert obj["producedBy"]["commit"] is None
        assert obj["producedBy"]["commitReason"] == "not run inside a git checkout"
        VD.validate(obj)


def test_the_evidence_and_the_extra_result_fields_can_be_handed_in():
    report = CS.classify(["tools/a.py"], ["tools/a.py"], {})
    obj = CS.verdict_object(
        report, commit=SHA, at=AT, tool="x.py", evidence=["one"], result_extra={"dataFile": ".coverage"}
    )
    assert obj["evidence"] == ["one"] and obj["producedBy"]["tool"] == "x.py"
    assert obj["result"]["dataFile"] == ".coverage"
    obj2 = CS.refusal_object("why", commit=SHA, at=AT, tool="x.py", evidence=["one"])
    assert obj2["evidence"] == ["one"] and obj2["producedBy"]["tool"] == "x.py"


def test_the_criterion_is_pre_stated_and_the_builder_cannot_edit_it():
    obj = _obj(CS.classify(["tools/a.py"], ["tools/a.py"], {}))
    assert obj["criterion"] == CS.CRITERION
    obj["criterion"]["threshold"] = 99
    assert CS.CRITERION["threshold"] == 0


# ── THE CLI's EXIT CONTRACT (what `check.sh` and `checkverdict.py` read) ────────────────────────────


def _run(*args):
    return subprocess.run([sys.executable, str(CLI), *args], capture_output=True, text=True, cwd=str(HERE))


def test_the_sample_object_validates_and_names_this_gate():
    """`verdict-adoption.mjs` runs exactly this command, so it is the adoption surface."""
    r = _run("--verdict-sample")
    assert r.returncode == 0, r.stderr
    obj = json.loads(r.stdout)
    VD.validate(obj)
    assert obj["gate"] == CS.GATE


def test_absent_coverage_data_refuses_with_exit_2_and_an_UNKNOWN_object(tmp_path):
    """REFUSED is 2, not 1 and not 0: `check.sh` must be able to tell "could not look" from "looked
    and found nothing"."""
    out = tmp_path / "v.json"
    r = _run("--check", "--data", str(tmp_path / "nope.coverage"), "--verdict-out", str(out))
    assert r.returncode == 2, r.stdout + r.stderr
    assert "REFUSED" in r.stdout
    obj = json.loads(out.read_text(encoding="utf-8"))
    assert obj["status"] == "UNKNOWN" and obj["gate"] == CS.GATE
    VD.validate(obj)


def test_without_check_the_report_decides_nothing_and_exits_zero(tmp_path):
    r = _run("--data", str(tmp_path / "nope.coverage"))
    assert r.returncode == 0
