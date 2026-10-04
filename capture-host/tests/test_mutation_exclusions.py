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
from _srcscan import module_source

HERE = pathlib.Path(__file__).resolve().parent.parent
EXCLUSIONS = HERE / "tools" / M.EXCLUSIONS_FILE
UNMEASURED = HERE / "tools" / "mutate-unmeasured.json"


def _exclusions_doc():
    return json.loads(EXCLUSIONS.read_text(encoding="utf-8"))


def _entry(**over):
    e = {
        "reason": "measured",
        "declaredAt": "2026-10-03",
        "cost": {"provenance": "run", "source": "run 1 job 2", "scope": "function"},
    }
    e.update(over)
    return e


_MOD_COST = {
    "scope": "module",
    "provenance": "run",
    "source": "run 1 job 2",
    "generatedBytes": 562427047,
    "statsPassSec": 7556,
}


def _MOD(**over):
    e = {"reason": "a module-level fact", "declaredAt": "2026-10-03", "cost": dict(_MOD_COST)}
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
RATCHET_DECLARED = 1
RATCHET_UNMEASURED_ROWS = 4


def test_the_declared_set_is_exactly_the_committed_census():
    got = sorted(M.parse_exclusions(EXCLUSIONS.read_text(encoding="utf-8")))
    assert got == ["capture.py"], (
        f"the declared exclusions changed: {got}. Owner ruling 2026-10-03 is ONE module-level "
        "declaration; adding anything is a deliberate edit — say why in the commit."
    )
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
        if "::" not in key:
            assert (HERE / key).is_file(), f"{key} names no module in the tree"
            continue
        mod, func = key.split("::")
        # via `module_source`, never `read_text`: a raw read of a mutatable module makes mutmut report
        # "failed to collect stats" and takes the WHOLE module to unmeasured. `test_mutation_hygiene`
        # enforces it, and it caught this file — the second time I have made this exact mistake.
        src = module_source(mod)
        names = {n.name for n in ast.walk(ast.parse(src)) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
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
        (_doc({"capture.py::*": _entry()}), "may not contain a glob"),
        (_doc({"capture.py::a::b": _entry()}), "not an exact key"),
        # a BARE key is now legal — but only as a MODULE key, and only with a module-level cost
        (_doc({"capture.py": _entry()}), "module key but declares `cost.scope`"),
        (
            _doc({"capture.py::f": _entry(cost={"provenance": "run", "source": "x", "scope": "module"})}),
            "function key but declares `cost.scope`",
        ),
        (_doc({"capture.py::f": _entry(cost={"provenance": "run", "source": "x"})}), "cost.scope"),
        (_doc({"capture.py::f": _entry(cost={"provenance": "run", "source": "x", "scope": "vibes"})}), "cost.scope"),
        (_doc({"notapy": _MOD()}), "neither a `module.py::function` key nor a `module.py` module"),
        (_doc({"capture.py": _MOD(cost=dict(_MOD_COST, generatedBytes=0))}), "cost.generatedBytes"),
        (
            _doc({"capture.py": _MOD(cost={k: v for k, v in _MOD_COST.items() if k != "statsPassSec"})}),
            "cost.statsPassSec",
        ),
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


@pytest.mark.parametrize("status", ["FAIL", "PASS", "SHORTFALL", "UNDERPOWERED", "NOT_APPLICABLE"])
def test_it_never_rewrites_a_FAIL_or_any_settled_status(status):
    """🔴 THIS TEST USED TO LIST `NOT_RUN` AMONG THESE, AND THAT ASSERTED A DEFECT AS A CONTRACT.

    `budget_exhaustion_verdict` answers NOT_RUN when `decided == 0` and UNKNOWN only when `decided > 0`,
    so a diff whose entire scope is one declared function — the canonical case — produced NOT_RUN and
    the substitution never fired. #3238 was the first PR to exercise it and it stayed red. I had built
    and tested only the MIXED case, and this test then froze the gap: 60 passing tests, a clean mutation
    run and 100 % coverage all agreed with me.

    What belongs here is the statuses that are SETTLED — a verdict already reached about mutants that
    actually ran. FAIL above all: a declaration describes what was not measured, and may never speak
    about what was."""
    assert M.declared_exclusion_status(status, refused=REFUSED, declared=DECL, blocking=0) is None


def test_it_DOES_act_on_NOT_RUN_because_that_is_the_canonical_case():
    """The regression for the defect above. A scope of exactly one declared function decides nothing,
    so the status is NOT_RUN — and that is precisely when the declaration should speak."""
    got = M.declared_exclusion_status("NOT_RUN", refused=REFUSED, declared=DECL, blocking=0)
    assert got is not None and got[0] == "NOT_APPLICABLE"


def test_a_blocking_survivor_outranks_a_declaration_on_NOT_RUN_too():
    """Widening the status set must not widen the escape hatch."""
    assert M.declared_exclusion_status("NOT_RUN", refused=REFUSED, declared=DECL, blocking=1) is None


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
    rows = M.unmeasured_rows(REFUSED + ["timeline.build: budget exhausted", "garbled"], DECL, "2026-10-03T00:00:00Z")
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
    """⚠️ The unkeyed rows sit in the MIDDLE deliberately. Kills `x_merge_unmeasured__mutmut_27`
    (`continue` -> `break`): with them last, the two are indistinguishable and a `break` silently
    drops every row after the first unkeyed one. This is the SAME defect the sibling
    `unmeasured_rows` test had — I fixed the pattern in one loop and left it in the other, which is
    why the gate found it here after the first round of kills."""
    out = M.merge_unmeasured(
        {"rows": [{"key": "b.py::f"}]},
        [{"state": "x"}, {"key": "a.py::f"}, {"key": ""}, {"key": "c.py::f"}],
    )
    assert [r["key"] for r in out["rows"]] == ["a.py::f", "b.py::f", "c.py::f"]


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


# ── GAPS THE MUTATION GATE FOUND (19 survivors on the first real run of #3258) ─────────────────────
# Each test below exists because a mutant survived, and each names the mutant. The gate ran for the
# first time here: on the earlier attempts `stage_root_reads` clobbered the staged ledger so the clean
# pass died and NOTHING was tested — an empty survivor list that meant "not checked", not "all killed".
def test_a_head_carrying_its_own_colon_is_cut_at_it():
    """Kills `x_exclusion_key_of__mutmut_6` — `partition(":")` -> a whitespace split. Every refusal I
    had tested held no colon inside the head, so the line that strips one was never observed."""
    assert M.exclusion_key_of("timeline.build:extra: budget exhausted") == "timeline.py::build"


def test_a_head_that_STARTS_with_a_dot_has_no_module_and_is_refused():
    """Kills `x_exclusion_key_of__mutmut_41` — `not mod or not func` -> `and`. With `and`, a head like
    `.build` yields mod="" and func="build", one empty and one not, and the function returned
    `.py::build` — a key naming no module at all."""
    assert M.exclusion_key_of(".build: budget exhausted") == ""
    assert M.exclusion_key_of("timeline.: budget exhausted") == ""


def test_an_unreadable_refusal_in_the_MIDDLE_does_not_drop_the_ones_after_it():
    """Kills `x_unmeasured_rows__mutmut_5` — `continue` -> `break`. My first test put the unreadable
    line LAST, where continue and break are indistinguishable. With `break`, every refusal after the
    first unreadable one vanishes from the ledger silently — the exact loss this ledger exists to
    prevent, and invisible unless a readable row follows an unreadable one."""
    rows = M.unmeasured_rows(
        ["garbled", "timeline.build: budget exhausted", "nosep", "capture._f: budget exhausted"],
        {},
        "t",
    )
    assert [r["key"] for r in rows] == ["timeline.py::build", "capture.py::_f"]


def test_a_refusal_whose_why_contains_a_SECOND_separator_keeps_the_whole_why():
    """Kills `x_refused_key__mutmut_6` — `split(": ", 1)` -> `rsplit`. A refusal sentence readily
    carries a second `": "`, and rsplit then takes the LAST one, so the head swallows the message."""
    entry = "timeline.build: hit the budget: 7213s of 7200"
    assert M.refused_key(entry) == "timeline.build"
    assert M.unmeasured_rows([entry], {}, "t")[0]["why"] == "hit the budget: 7213s of 7200"


def test_the_why_is_cut_at_the_separator_not_at_the_first_space():
    """Kills `x_unmeasured_rows__mutmut_24` — `partition(": ")` -> a whitespace split. The two agree on
    every single-spaced message, so only an extra space after the colon distinguishes them."""
    assert M.unmeasured_rows(["timeline.build:  two spaces follow"], {}, "t")[0]["why"] == " two spaces follow"


@pytest.mark.parametrize(
    "text, must_name",
    [
        (json.dumps({"schema": "tepna.something-else/9", "exclusions": {}}), "tepna.something-else/9"),
        (json.dumps([1, 2]), "list"),
    ],
)
def test_the_schema_refusal_NAMES_what_it_actually_found(text, must_name):
    """Kills `x_parse_exclusions__mutmut_10 / _12 / _14 / _15` — all four rewrite the `schema=` detail
    inside the refusal message (`doc.get(None)`, `doc.get('SCHEMA')`, `type(None).__name__`, and an
    `and False` that forces the else branch). Asserting only the prefix left the whole diagnostic
    unobserved, and a refusal that cannot say what it found is the thing §4c warns about."""
    with pytest.raises(ValueError) as exc:
        M.parse_exclusions(text)
    assert must_name in str(exc.value)


def test_parse_returns_the_ENTRY_not_merely_the_key():
    """Kills `x_parse_exclusions__mutmut_77` — `out[key] = e` -> `out[key] = None`. Every assertion I
    had read only the KEYS, so a parser that returned the right set of keys mapped to nothing passed.
    The callers read `cost` and `reason` out of these values."""
    got = M.parse_exclusions(_doc({"capture.py::f": _entry(reason="because measured")}))
    assert got["capture.py::f"]["reason"] == "because measured"
    assert got["capture.py::f"]["cost"]["provenance"] == "run"


# ── THE MODULE-LEVEL DECLARATION (owner ruling 2026-10-03) ──────────────────────────────────────────
def test_only_ONE_module_key_may_exist():
    """ "One module-level declaration" is the ruling. Without a count limit it quietly becomes "modules
    are declarable", which is a different policy than the one that was ruled."""
    with pytest.raises(ValueError, match="more than one MODULE key"):
        M.parse_exclusions(_doc({"capture.py": _MOD(), "timeline.py": _MOD()}))


def test_a_module_key_matches_the_module_and_a_function_key_never_does():
    """`declared_module` must not read a function key as a module declaration — that is exactly how a
    statement about ONE function would come to excuse 290 of them."""
    mod_only = M.parse_exclusions(_doc({"capture.py": _MOD()}))
    assert M.declared_module(mod_only, "capture.py") is not None
    assert M.declared_module(mod_only, "timeline.py") is None
    fn_only = M.parse_exclusions(_doc({"capture.py::f": _entry()}))
    assert M.declared_module(fn_only, "capture.py") is None, "a function key was read as a module-level declaration"


def test_the_committed_module_entry_carries_BOTH_measurements_and_says_it_is_module_level():
    entry = M.parse_exclusions(EXCLUSIONS.read_text(encoding="utf-8"))["capture.py"]
    cost = entry["cost"]
    assert cost["scope"] == "module"
    assert cost["statsPassSec"] >= 7556 and cost["statsPassIsLowerBound"] is True
    assert cost["generatedBytes"] == 562427047
    assert cost["workerRssBytes"] > 8 * 1024**3, "the memory measurement is the second, independent one"
    assert "MODULE-LEVEL FACT" in entry["reason"].upper(), (
        "the reason must say the cost is module-level, so no reader mistakes it for a per-function one"
    )
    assert "_cpap_stream_watch_row" in entry["reason"], "the superseded function keys' evidence is cited"


def test_the_covered_function_count_is_MEASURED_from_the_ast_not_quoted():
    """A module-level exclusion retires every function in the module, so the size of the blind spot is
    the number that matters — and it drifts. MUTATION-SCOPED-GENERATION cites 226 (2026-09-28); the
    module has grown. `count_functions` recomputes it, which is why the gate prints it per run."""
    n = M.count_functions(module_source("capture.py"))
    assert n > 226, f"count_functions says {n}; the brief's 226 is stale, which is the point"
    # 290 → 292 on 2026-10-04: E16 added `retry_rate_per_hour` and `retry_budget_alert` to capture.py
    # (#3252). ⚠️ The declaration's own `cost.moduleFunctionsAtDeclaration` is NOT moved with it — that
    # field is named for what it is, the count MEASURED when the cost was measured on 2026-10-03, and
    # rewriting it would falsify the record of what the 7556 s and 562 MB were paid on. The live count
    # is what `count_functions` recomputes and the gate prints per run; this pin is the deliberate-update
    # tripwire on it, which is exactly what caught these two.
    assert n == 293, f"capture.py now defines {n} functions — update the declaration's note deliberately"


def test_count_functions_counts_nested_and_methods_and_refuses_nothing():
    assert M.count_functions("def a():\n    def b():\n        pass\n") == 2
    assert M.count_functions("class C:\n    def m(self):\n        pass\n") == 1
    assert M.count_functions("async def a():\n    pass\n") == 1
    # a reporting count must never fail the gate: unparsable source is 0, not an exception
    assert M.count_functions("def (:\n") == 0
    assert M.count_functions("") == 0


def test_the_note_states_both_counts_so_the_blind_spot_is_recounted_per_run():
    note = M.module_exclusion_note("capture.py", ["_a", "_b"], 290)
    assert "2 function(s) in this diff" in note
    assert "290 in the module" in note
    assert "_a, _b" in note


def test_the_ledger_rows_for_a_declared_module_are_keyed_per_FUNCTION_and_marked_declared():
    """Moving the check to SELECTION removed the budget refusal, and `unmeasured_rows` reads that list —
    so without `declared_module_rows` the ledger would record NOTHING for the one module whose blind
    spot it exists to enumerate. Making the gate faster must not delete the record of what it stopped
    measuring (§∅: an absent row is not an absent gap)."""
    rows = M.declared_module_rows("capture.py", ["_b", "_a"], "2026-10-03T00:00:00Z")
    assert [r["key"] for r in rows] == ["capture.py::_a", "capture.py::_b"], "sorted, for a reviewable diff"
    assert {r["state"] for r in rows} == {"declared"}
    assert all("not attempted, not a verdict" in r["why"] for r in rows)
    assert all(r["observedAt"] == "2026-10-03T00:00:00Z" for r in rows)
