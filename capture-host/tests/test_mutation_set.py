# tepna-capture — tests/test_mutation_set.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The decision logic behind `tools/mutate_set.py`: what counts as a moved mutant set, and what
counts as a comparison that cannot be made at all.

The distinction these tests exist to hold is the one a throwaway probe loses. A mutant set that
differs is a FINDING, and a comparison whose two sides do not share a tree is a broken PREMISE. The
second must never read as the first, because a source edit between the two runs moves every module."""

from __future__ import annotations

import re

import pytest

import mutation_set as MS
import verdict as VD

SHA = "aceeacc86"


def _art(version: str, modules: dict[str, list[str]], commit: str | None = SHA) -> dict:
    return MS.artifact(mutmut=version, python="3.13.1", commit=commit, modules=modules)


def test_an_artifact_stamps_itself_and_copies_the_names_it_was_given() -> None:
    """The artifact owns its lists: a caller that mutates its own dict afterwards cannot reach inside."""
    mine = ["x_f__mutmut_1"]
    art = _art("3.8.0", {"a.py": mine})
    mine.append("x_f__mutmut_2")
    assert art["modules"]["a.py"] == ["x_f__mutmut_1"]
    assert art["schema"] == MS.SCHEMA
    assert art["at"].endswith("Z")


def test_an_artifact_takes_a_given_instant_over_its_own_clock() -> None:
    art = MS.artifact(mutmut="3.8.0", python="3.13.1", commit=SHA, modules={}, at="2026-11-02T00:00:00Z")
    assert art["at"] == "2026-11-02T00:00:00Z"


@pytest.mark.parametrize("side", ["before", "after"])
def test_a_side_that_is_not_an_artifact_refuses_and_names_which_side(side: str) -> None:
    good = _art("3.8.0", {"a.py": []})
    pair = {"before": good, "after": good} | {side: {"schema": "something.else/1"}}
    reason = MS.refusal(pair["before"], pair["after"])
    assert reason is not None
    assert side in reason


@pytest.mark.parametrize("side", ["before", "after"])
def test_a_side_with_no_tree_commit_refuses_and_names_which_side(side: str) -> None:
    """§∅: `commit: null` says the tree was not a checkout. Two sides cannot be held to one tree when
    one of them cannot say which tree it read."""
    pair = {"before": _art("3.8.0", {}), "after": _art("3.8.1", {})} | {side: _art("3.8.1", {}, commit=None)}
    reason = MS.refusal(pair["before"], pair["after"])
    assert reason is not None
    assert side in reason


def test_two_trees_refuse_rather_than_reporting_a_difference_they_cannot_attribute() -> None:
    reason = MS.refusal(_art("3.8.0", {"a.py": []}), _art("3.8.1", {"a.py": []}, commit="bb30b3fbf"))
    assert reason is not None
    assert "different trees" in reason
    assert SHA in reason and "bb30b3fbf" in reason


def test_a_module_only_one_side_enumerated_refuses_and_names_it() -> None:
    reason = MS.refusal(_art("3.8.0", {"a.py": []}), _art("3.8.1", {"a.py": [], "b.py": []}))
    assert reason is not None
    assert "b.py" in reason


def test_two_comparable_artifacts_refuse_nothing() -> None:
    assert MS.refusal(_art("3.8.0", {"a.py": ["m1"]}), _art("3.8.1", {"a.py": ["m1"]})) is None


def test_a_set_that_gained_and_lost_names_reports_both() -> None:
    report = MS.compare_sets(_art("3.8.0", {"a.py": ["m1", "m2"]}), _art("3.8.1", {"a.py": ["m2", "m3"]}))
    assert report["checked"] == 1
    assert report["moved"] == {"a.py": {"added": ["m3"], "removed": ["m1"]}}
    assert report["reordered"] == []
    assert report["mutmut"] == {"before": "3.8.0", "after": "3.8.1"}


def test_the_same_names_in_a_different_order_are_reordered_and_not_moved() -> None:
    """A survivor is addressed by NAME, so a reordering leaves every baseline resolving. It is
    reported because mutmut's output really did change, and it moves no module into `moved` because
    the pre-stated criterion counts sets."""
    report = MS.compare_sets(_art("3.8.0", {"a.py": ["m1", "m2"]}), _art("3.8.1", {"a.py": ["m2", "m1"]}))
    assert report["moved"] == {}
    assert report["reordered"] == ["a.py"]
    assert MS.verdict_object(report, commit=SHA)["status"] == "PASS"


def test_an_unchanged_module_appears_in_neither_list() -> None:
    report = MS.compare_sets(_art("3.8.0", {"a.py": ["m1"]}), _art("3.8.1", {"a.py": ["m1"]}))
    assert report["moved"] == {} and report["reordered"] == []
    assert report["checked"] == 1


def test_only_the_modules_both_sides_enumerated_are_compared() -> None:
    """`refusal` is what refuses a mismatched population. `compare_sets` is then free to intersect, so a
    caller that skipped the refusal still gets a report over a defined set rather than a KeyError."""
    report = MS.compare_sets(_art("3.8.0", {"a.py": ["m1"], "gone.py": ["m9"]}), _art("3.8.1", {"a.py": ["m1"]}))
    assert report["checked"] == 1
    assert "gone.py" not in report["moved"]


def test_a_moved_set_fails_and_the_reason_names_every_module() -> None:
    before = _art("3.8.0", {"a.py": ["m1"], "b.py": ["m1"]})
    after = _art("3.8.1", {"a.py": ["m2"], "b.py": ["m2"]})
    obj = MS.verdict_object(MS.compare_sets(before, after), commit=SHA)
    assert obj["status"] == "FAIL"
    assert obj["reason"] is not None
    assert "a.py" in obj["reason"] and "b.py" in obj["reason"]
    assert obj["result"]["movedModules"] == 2
    VD.validate(obj)


def test_a_held_set_passes_and_carries_the_two_versions_it_compared() -> None:
    obj = MS.verdict_object(
        MS.compare_sets(_art("3.8.0", {"a.py": ["m1"]}), _art("3.8.1", {"a.py": ["m1"]})), commit=SHA
    )
    assert obj["status"] == "PASS"
    assert obj["reason"] is None
    assert obj["result"]["mutmut"] == {"before": "3.8.0", "after": "3.8.1"}
    assert obj["population"] == {"checked": 1, "eligible": 1, "excluded": 0}
    VD.validate(obj)


def test_one_version_compared_against_itself_binds_nothing() -> None:
    """The vacuous shape this gate must never report as a pass (§4b): both sides ran one version, so
    the comparison answers nothing about a pin move."""
    obj = MS.verdict_object(
        MS.compare_sets(_art("3.8.0", {"a.py": ["m1"]}), _art("3.8.0", {"a.py": ["m1"]})), commit=SHA
    )
    assert obj["status"] == "NOT_APPLICABLE"
    assert obj["result"] is None
    assert "3.8.0" in str(obj["reason"])
    VD.validate(obj)


def test_a_comparison_over_no_module_examined_nothing() -> None:
    obj = MS.verdict_object(MS.compare_sets(_art("3.8.0", {}), _art("3.8.1", {})), commit=SHA)
    assert obj["status"] == "NOT_RUN"
    assert obj["result"] is None
    VD.validate(obj)


def test_a_refusal_is_unknown_over_a_population_of_nothing() -> None:
    obj = MS.refusal_object("the two artifacts name different trees", commit=SHA)
    assert obj["status"] == "UNKNOWN"
    assert obj["population"] == {"checked": 0, "eligible": 0, "excluded": 0}
    assert obj["result"] is None
    assert obj["gate"] == MS.GATE
    VD.validate(obj)


def test_the_criterion_is_pre_stated_and_counts_modules() -> None:
    """A threshold derived from the data it judges is UNKNOWN (§🧾), so this one is a constant."""
    assert MS.CRITERION == {
        "name": "modules_whose_named_mutant_set_moved",
        "threshold": 0,
        "unit": "modules",
        "direction": "lte",
    }
    assert MS.TOOL in MS.EVIDENCE


def test_a_refusal_object_carries_the_tool_that_could_not_look() -> None:
    obj = MS.refusal_object("r", commit=SHA, at="2026-11-02T00:00:00Z")
    assert obj["producedBy"]["tool"] == MS.TOOL
    assert obj["at"] == "2026-11-02T00:00:00Z"
    assert obj["producedBy"]["commit"] == SHA


@pytest.mark.parametrize(
    ("was", "now", "added", "removed"),
    [(["m1"], ["m1", "m2"], ["m2"], []), (["m1", "m2"], ["m1"], [], ["m2"])],
)
def test_a_set_that_only_gained_or_only_lost_a_name_has_still_moved(
    was: list[str], now: list[str], added: list[str], removed: list[str]
) -> None:
    """Either side alone moves the module. A gained name is a mutant no baseline covers, and a lost
    name is a baseline that addresses nothing, so the criterion cannot ask for both at once."""
    report = MS.compare_sets(_art("3.8.0", {"a.py": was}), _art("3.8.1", {"a.py": now}))
    assert report["moved"] == {"a.py": {"added": added, "removed": removed}}
    assert report["reordered"] == []
    assert MS.verdict_object(report, commit=SHA)["status"] == "FAIL"


def test_the_default_stamp_is_a_whole_second_in_Z_form() -> None:
    """`microsecond=0` is the shape, not a rounding taste: an artifact names the instant it enumerated
    a tree, and a sub-second tail makes two artifacts from one second read as different runs."""
    at = MS.artifact(mutmut="3.8.0", python="3.13.1", commit=SHA, modules={})["at"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", at), at


def test_a_verdict_carries_the_commit_and_the_instant_it_was_given() -> None:
    """The verdict is the API (§🧾), so a caller's commit and stamp must reach it. A verdict that
    stamps its own clock instead cannot be tied to the tree the comparison ran over."""
    obj = MS.verdict_object(
        MS.compare_sets(_art("3.8.0", {"a.py": ["m1"]}), _art("3.8.1", {"a.py": ["m1"]})),
        commit=SHA,
        at="2026-11-02T00:00:00Z",
    )
    assert obj["producedBy"]["commit"] == SHA
    assert obj["at"] == "2026-11-02T00:00:00Z"
    VD.validate(obj)
