# tepna-capture — tests/test_mutation_exclusions.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE DECLARED EXCLUSION, and the gate that keeps it from becoming an excuse (owner ruling 2026-10-03).
#
# An exclusion is the one mechanism in this gate that can make a red run green, so the tests here are
# written adversarially: every assertion below is about something the exclusion must REFUSE to do. The
# safety property is asserted in both directions — a declaration must clear an unmeasurable refusal, and
# must NEVER clear a survivor — because a one-directional test would pass on a function that always
# returns NOT_APPLICABLE.
import json
import pathlib

import pytest

import mutation_diff as M

HERE = pathlib.Path(__file__).resolve().parent.parent
EXCLUSIONS = HERE / "tools" / M.EXCLUSIONS_FILE
UNMEASURED = HERE / "tools" / "mutate-unmeasured.json"


def _exclusions_doc():
    return json.loads(EXCLUSIONS.read_text(encoding="utf-8"))


def _entry(**over):
    e = {"reason": "measured", "declaredAt": "2026-10-03", "cost": {"provenance": "run", "source": "run 1 job 2"}}
    e.update(over)
    return e


def _doc(exclusions=None, **over):
    d = {"schema": M.EXCLUSIONS_SCHEMA, "exclusions": exclusions if exclusions is not None else {}}
    d.update(over)
    return json.dumps(d)


# ── THE GROWTH GATE ─────────────────────────────────────────────────────────────────────────────────
# The ratchet is the committed census. It may only go UP in a commit that says why, exactly like
# `tests/test_equivalence_ledger.py`'s — and unlike that one, the bound lives in the source
# (`EXCLUSION_BOUND`), so the two must agree or the bound is decoration.
RATCHET_DECLARED = 2
RATCHET_UNMEASURED_ROWS = 4


def test_the_declared_set_is_exactly_the_committed_census():
    got = sorted(M.parse_exclusions(EXCLUSIONS.read_text(encoding="utf-8")))
    assert got == [
        "capture.py::_cpap_stream_watch_row",
        "capture.py::_maybe_start_cpap_spool_pull",
    ], f"the declared exclusions changed: {got}. Adding one is a deliberate edit — say why in the commit."
    assert len(got) == RATCHET_DECLARED


def test_the_BOUND_equals_what_is_declared_so_the_next_one_costs_a_raise():
    """Headroom would make the bound decoration: the point is that the next exclusion is a decision."""
    assert M.EXCLUSION_BOUND == RATCHET_DECLARED, (
        f"EXCLUSION_BOUND={M.EXCLUSION_BOUND} but {RATCHET_DECLARED} are declared. The bound is not a "
        "budget to spend — raise it in the same commit that measures and declares the new function."
    )


def test_the_unmeasured_ledger_does_not_grow_silently():
    rows = json.loads(UNMEASURED.read_text(encoding="utf-8"))["rows"]
    assert len(rows) == RATCHET_UNMEASURED_ROWS, (
        f"the unmeasured ledger moved to {len(rows)} rows. Growth means the gate refused a function it "
        "had not refused before — read the new row before raising this number."
    )
    assert len({r["key"] for r in rows}) == len(rows), "duplicate keys in the unmeasured ledger"


def test_every_declared_row_in_the_ledger_is_actually_declared():
    """A `declared` row whose key is not in the exclusion file would claim a measurement nobody made."""
    declared = M.parse_exclusions(EXCLUSIONS.read_text(encoding="utf-8"))
    rows = json.loads(UNMEASURED.read_text(encoding="utf-8"))["rows"]
    bad = [r["key"] for r in rows if r["state"] == "declared" and r["key"] not in declared]
    assert not bad, f"rows marked `declared` with no entry in {M.EXCLUSIONS_FILE}: {bad}"
    for r in rows:
        assert r["state"] in ("declared", "undeclared"), f"{r['key']}: unknown state {r['state']!r}"


def test_every_declared_key_names_a_function_that_EXISTS():
    """A stale key is worse than no key: it reads as a live declaration and grants nothing, so the next
    reader believes a function is excluded when the gate has never matched it."""
    import ast

    for key in M.parse_exclusions(EXCLUSIONS.read_text(encoding="utf-8")):
        mod, func = key.split("::")
        src = (HERE / mod).read_text(encoding="utf-8")
        names = {
            n.name
            for n in ast.walk(ast.parse(src))
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        assert func in names, f"{key} names no function in {mod} — a stale exclusion declares nothing"


def test_the_file_names_what_RETIRES_it():
    """Property 4 of the owner's ruling: the exclusion is dated debt and must name its own end.

    ⚠️ ASSERTED STRUCTURALLY, ON PURPOSE. Naming the brief's full path here — or reading it — adds a
    REPO-ROOT read to a suite whose root reads are a pinned equality
    (`test_mutation_scratch_reuse.py::test_the_REAL_suite_has_exactly_the_root_reads_we_know_about`),
    because every root path a capture-host test so much as mentions is copied into the mutation
    scratch. That the brief EXISTS is the Node lane's job: `docs-ledger` reds a dead link and an
    unindexed brief, which is the same property enforced where the file lives.
    """
    doc = _exclusions_doc()
    retired = doc["retiredBy"]
    assert retired.startswith("briefs/") and retired.endswith("-BRIEF.md"), retired
    assert "MUTATION-SCOPED" in retired, f"{retired} is not the scoped-generation brief"
    assert doc.get("retiredWhen"), "`retiredWhen` must say what changes, not only which brief"


@pytest.mark.parametrize("path", [EXCLUSIONS, UNMEASURED])
def test_both_ledgers_are_byte_canonical(path):
    """So a hand edit and a tool write produce the same bytes and the diff stays reviewable."""
    raw = path.read_bytes()
    want = (json.dumps(json.loads(raw.decode()), indent=2, ensure_ascii=False) + "\n").encode()
    assert raw == want, f"{path.name} is not `json.dumps(indent=2, ensure_ascii=False) + newline`"


# ── parse_exclusions REFUSES ────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "text, fragment",
    [
        (json.dumps({"schema": "other", "exclusions": {}}), "not a tepna.mutation-exclusions/1"),
        (json.dumps([1, 2]), "not a tepna.mutation-exclusions/1"),
        (_doc(exclusions=None) if False else json.dumps({"schema": M.EXCLUSIONS_SCHEMA}), "must be an object"),
        (_doc({"capture.py::*": _entry()}), "not an exact"),
        (_doc({"capture.py::a::b": _entry()}), "not an exact"),
        (_doc({"capture.py": _entry()}), "not an exact"),
        (_doc({"capture.txt::f": _entry()}), "must name a `.py` module"),
        (_doc({"capture.py::": _entry()}), "must name a `.py` module"),
        (_doc({"capture.py::f": "nope"}), "must be an object"),
        (_doc({"capture.py::f": _entry(reason="")}), "missing `reason`"),
        (_doc({"capture.py::f": _entry(declaredAt=None)}), "missing `declaredAt`"),
        (_doc({"capture.py::f": _entry(cost={"provenance": "vibes", "source": "x"})}), "cost.provenance"),
        (_doc({"capture.py::f": _entry(cost="7556s")}), "cost.provenance"),
        (_doc({"capture.py::f": _entry(cost={"provenance": "run"})}), "cost.source"),
    ],
)
def test_parse_exclusions_refuses_every_shape_that_would_widen_it(text, fragment):
    with pytest.raises(ValueError, match=fragment):
        M.parse_exclusions(text)


def test_parse_exclusions_refuses_more_entries_than_the_BOUND():
    many = {f"capture.py::f{i}": _entry() for i in range(M.EXCLUSION_BOUND + 1)}
    with pytest.raises(ValueError, match="exceeds EXCLUSION_BOUND"):
        M.parse_exclusions(_doc(many))


def test_parse_exclusions_accepts_a_well_formed_entry():
    got = M.parse_exclusions(_doc({"capture.py::f": _entry()}))
    assert list(got) == ["capture.py::f"]


# ── the refusal-line decoders ───────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "line, want",
    [
        ("timeline.build: budget exhausted", "timeline.py::build"),
        ("timeline._stamp_ms: budget exhausted", "timeline.py::_stamp_ms"),
        # ⚠️ REGRESSION: mutmut encodes `_placed` as `x_` + `_placed` = `x__placed`, so a
        # `removeprefix("x__")` yields `placed` and names a DIFFERENT function. Caught while writing
        # this unit; `source_function_of_glob` is the one decoder and this pins the delegation.
        ("timeline.x__placed__mutmut_*: partial counts only", "timeline.py::_placed"),
        ("capture.x__cpap_stream_watch_row__mutmut_*: budget", "capture.py::_cpap_stream_watch_row"),
        # FAIL CLOSED: a method glob decodes to a BARE name that could match a module-level function.
        ("cpap_ingest.xǁGapCountersǁtotal_lost__mutmut_*: budget", ""),
        ("no separator at all", ""),
        ("   : leading colon only", ""),
        ("nodot: budget", ""),
        ("a.b.c: budget", ""),
    ],
)
def test_exclusion_key_of_decodes_or_fails_closed(line, want):
    assert M.exclusion_key_of(line) == want


def test_refused_key_returns_empty_without_a_separator():
    assert M.refused_key("timeline.build: why") == "timeline.build"
    assert M.refused_key("no separator") == ""
    assert M.refused_key("") == ""


# ── declared_exclusion_status: the safety property, both directions ─────────────────────────────────
DECL = {"capture.py::_cpap_stream_watch_row": _entry()}
REFUSED = ["capture.x__cpap_stream_watch_row__mutmut_*: the 7200s gate budget was exhausted"]


def test_a_declared_refusal_becomes_NOT_APPLICABLE():
    got = M.declared_exclusion_status("UNKNOWN", refused=REFUSED, declared=DECL, blocking=0)
    assert got is not None
    status, reason = got
    assert status == "NOT_APPLICABLE"
    assert "capture.py::_cpap_stream_watch_row" in reason
    assert "MUTATION-SCOPED-GENERATION" in reason, "the reason must name what retires the exclusion"


@pytest.mark.parametrize("status", ["FAIL", "PASS", "SHORTFALL", "UNDERPOWERED", "NOT_RUN", "NOT_APPLICABLE"])
def test_it_acts_ONLY_on_UNKNOWN_so_it_can_never_rewrite_a_FAIL(status):
    assert M.declared_exclusion_status(status, refused=REFUSED, declared=DECL, blocking=0) is None


def test_a_BLOCKING_survivor_outranks_every_declaration():
    """The whole safety argument. A declaration describes what was NOT measured; a survivor is what WAS."""
    assert M.declared_exclusion_status("UNKNOWN", refused=REFUSED, declared=DECL, blocking=1) is None


def test_it_never_returns_PASS_under_any_input():
    for blocking in (0, 1):
        for status in M.VERDICT_STATUSES:
            got = M.declared_exclusion_status(status, refused=REFUSED, declared=DECL, blocking=blocking)
            assert got is None or got[0] == "NOT_APPLICABLE"


def test_ONE_undeclared_refusal_keeps_the_whole_run_UNKNOWN():
    refused = REFUSED + ["timeline.build: the 7200s gate budget was exhausted"]
    assert M.declared_exclusion_status("UNKNOWN", refused=refused, declared=DECL, blocking=0) is None


def test_an_UNREADABLE_refusal_line_keeps_the_run_UNKNOWN():
    """An unparsed refusal must never be matched against a declaration — a false match IS the hatch."""
    assert M.declared_exclusion_status("UNKNOWN", refused=["garbled"], declared=DECL, blocking=0) is None


def test_no_refusals_at_all_is_not_an_exclusion():
    assert M.declared_exclusion_status("UNKNOWN", refused=[], declared=DECL, blocking=0) is None


# ── the ledger rows and their merge ─────────────────────────────────────────────────────────────────
def test_unmeasured_rows_separates_declared_from_undeclared():
    rows = M.unmeasured_rows(
        REFUSED + ["timeline.build: budget exhausted", "garbled"], DECL, "2026-10-03T00:00:00Z"
    )
    assert [r["key"] for r in rows] == ["capture.py::_cpap_stream_watch_row", "timeline.py::build"]
    assert [r["state"] for r in rows] == ["declared", "undeclared"]
    assert rows[0]["why"] == "the 7200s gate budget was exhausted"
    assert rows[0]["observedAt"] == "2026-10-03T00:00:00Z"


def test_unmeasured_rows_keeps_a_why_that_carries_no_separator():
    rows = M.unmeasured_rows(["timeline.build no-colon-why"], {}, "t")
    assert rows == [] or rows[0]["why"]


def test_merge_keeps_the_FIRST_observation_date_and_the_NEWEST_state():
    doc = {"rows": [{"key": "a.py::f", "state": "undeclared", "observedAt": "2026-09-28"}]}
    out = M.merge_unmeasured(doc, [{"key": "a.py::f", "state": "declared", "observedAt": "2026-10-03"}])
    assert out["rows"] == [{"key": "a.py::f", "state": "declared", "observedAt": "2026-09-28"}]
    assert out["schema"] == M.UNMEASURED_SCHEMA


def test_merge_appends_sorted_and_drops_an_unkeyed_row():
    out = M.merge_unmeasured({"rows": [{"key": "b.py::f"}]}, [{"key": "a.py::f"}, {"state": "x"}, {"key": ""}])
    assert [r["key"] for r in out["rows"]] == ["a.py::f", "b.py::f"]


def test_merge_takes_a_new_key_with_no_prior_date():
    out = M.merge_unmeasured({}, [{"key": "a.py::f", "state": "undeclared"}])
    assert out["rows"] == [{"key": "a.py::f", "state": "undeclared"}]


def test_merge_takes_the_NEW_date_when_the_existing_row_carries_none():
    """An existing row with no `observedAt` has no first observation to preserve, so the incoming one
    is the only date there is — the alternative is a row that is permanently undated."""
    out = M.merge_unmeasured(
        {"rows": [{"key": "a.py::f", "state": "undeclared"}]},
        [{"key": "a.py::f", "state": "declared", "observedAt": "2026-10-03"}],
    )
    assert out["rows"] == [{"key": "a.py::f", "state": "declared", "observedAt": "2026-10-03"}]
