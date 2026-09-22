# tepna-capture — tests/test_worn_precedence.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""THE PRECEDENCE IS DATA, AND THE BRIEF IS DIFFED AGAINST IT (CAPTURE-LOSS-PRECEDENCE-AUDIT R3).

Two defects in one night were one shape — an inferred vote outranking a measured one — and each fix
moved a single vote. `telemetry.WORN_VOTES` is what they were moving; these tests hold it to three
things: every vote the combiner can emit has a row, the brief carries the same table byte for byte,
and the rule the table exists to enforce actually binds."""

import os
import re

import pytest

import telemetry

BRIEF = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "briefs",
    "CAPTURE-LOSS-PRECEDENCE-AUDIT-2026-09-22-BRIEF.md",
)


def test_every_vote_the_combiner_can_emit_has_a_row_and_a_source():
    """The population is the combiner's own vote names, not a list typed beside it: `worn_verdict`
    appends `votes.append(("<name>", …))` and reads `charging:<why>` — both are enumerated here."""
    src = open(telemetry.__file__, encoding="utf-8").read()
    body = src[src.index("def worn_verdict(") : src.index("\n# ── CHARGING AT FULL")]
    emitted = set(re.findall(r'votes\.append\(\("([a-z-]+)"', body))
    emitted |= {"charging:" + w for w in ("rising", "pmd-in-charger", "flat-at-full")}
    assert emitted, "the scan found no vote names — worn_verdict changed shape and this test is stale"
    assert emitted == set(telemetry.VOTE_SOURCE), sorted(emitted ^ set(telemetry.VOTE_SOURCE))
    for v in telemetry.WORN_VOTES:
        assert v["source"] in ("measured", "inferred") and v["means"] and isinstance(v["rank"], int)
    assert [v["rank"] for v in telemetry.WORN_VOTES] == sorted(v["rank"] for v in telemetry.WORN_VOTES)


def test_the_brief_carries_the_table_the_code_renders():
    """The doc gate. `precedence_table_md()` is the one renderer; §2a of the brief is its output. A vote
    added in code without a brief line (or a brief line with no vote) reds here, naming the diff."""
    md = telemetry.precedence_table_md()
    brief = open(BRIEF, encoding="utf-8").read()
    if md not in brief:
        want = md.split("\n")
        have = [ln for ln in brief.split("\n") if ln.startswith("| ") and "`" in ln]
        missing = [ln for ln in want if ln not in have]
        pytest.fail(
            "briefs/CAPTURE-LOSS-PRECEDENCE-AUDIT-2026-09-22-BRIEF.md §2a is not the rendered table.\n"
            "Missing rows:\n  " + "\n  ".join(missing) + "\n\nPaste this block into §2a:\n" + md
        )


def test_an_inferred_vote_never_outranks_a_measured_one_of_the_opposite_sign():
    """The rule, exercised where it binds today: charging. An inferred dock yields to a beat; a measured
    charge does not; an UNATTRIBUTED charging flag keeps its authority (unknown is not an inference)."""
    assert telemetry.worn_verdict(contact=False, beats=True, charging=True, charging_why="flat-at-full")[0] is True
    for why in ("rising", "pmd-in-charger", None, "something-new"):
        assert telemetry.worn_verdict(contact=False, beats=True, charging=True, charging_why=why)[0] is False, why


def test_the_source_predicate_speaks_only_where_the_table_does():
    assert telemetry.is_stated_inferred("ambient-level") is True
    assert telemetry.is_stated_inferred("hr-beats") is False
    assert telemetry.is_stated_inferred("charging:something-new") is False  # unknown is unattributed, not inferred
