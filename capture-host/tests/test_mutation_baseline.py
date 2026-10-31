# tepna-capture — tests/test_mutation_baseline.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The per-function survivor baseline: who a pre-existing survivor belongs to.

WHY THIS FILE EXISTS. The diff-scoped gate selects whole FUNCTIONS, which is right and is not what
the baseline changes. Measured 2026-10-30 on #4126: one logging statement added to `radioclock.main`
put 27 survivors of code that PR never wrote into a red gate, and the second push — the same
statement, moved out of `main` — passed the same gate with 0 survivors. Residue
`2026-10-30-the-mutation-gate-selects-a-whole-entry-point-for-one-line`.

So `mutation-survivors.json` now decides BLAME: a survivor recorded `open` against that module and
function at `--base` is inherited, and every other survivor fails the run exactly as before. These
legs pin the fail-closed arms, because each one is a path where an unreadable record would otherwise
excuse a real hole.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import mutation_diff as M  # noqa: E402

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent / "tools" / "mutate_diff.py"
LEDGER = HERE.parent.parent / "mutation-survivors.json"


def _entry(**kw):
    """One ledger row, defaulting to the shape that IS inherited — so each leg names its own flaw."""
    row = {
        "lane": "py",
        "module": "nightqc.py",
        "function": "summarize",
        "key": "- a = None | + a = ''",
        "pr": 3188,
        "state": "open",
    }
    row.update(kw)
    return row


def _survivor(**kw):
    row = {"mutant": "nightqc.x_summarize__mutmut_1", "module": "nightqc.py", "key": "- a = None | + a = ''"}
    row.update(kw)
    return row


# ── baseline_id ───────────────────────────────────────────────────────────────────────────────────


def test_baseline_id_folds_both_module_spellings():
    """The ledger holds BOTH, and the gate only ever knows the basename."""
    assert M.baseline_id("nightqc.py", "summarize") == "nightqc.py::summarize"
    assert M.baseline_id("capture-host/nightqc.py", "summarize") == "nightqc.py::summarize"
    assert M.baseline_id("capture-host/tools/mutate_diff.py", "main") == "mutate_diff.py::main"


@pytest.mark.parametrize("module,function", [("", "summarize"), ("nightqc.py", ""), (None, None), ("  ", "f")])
def test_baseline_id_refuses_a_half_it_cannot_name(module, function):
    """`""` is the fail-closed value: nothing can inherit against an identity nobody can write."""
    assert M.baseline_id(module, function) == ""


# ── baseline_from_ledger ──────────────────────────────────────────────────────────────────────────


def test_baseline_from_ledger_keys_module_function_and_lists_the_owning_pr():
    b = M.baseline_from_ledger({"entries": [_entry(), _entry(pr=4126)]})
    assert b == {"nightqc.py::summarize": {"- a = None | + a = ''": [3188, 4126]}}


def test_baseline_from_ledger_counts_occurrences_rather_than_deduplicating():
    """Two bare-statement mutants in one function share a key by construction (`classify`'s note)."""
    b = M.baseline_from_ledger({"entries": [_entry(key="- continue | + break")] * 3})
    assert b["nightqc.py::summarize"]["- continue | + break"] == [3188, 3188, 3188]


@pytest.mark.parametrize(
    "bad,why",
    [
        ({"lane": "js"}, "another lane's record says nothing about this gate"),
        ({"state": "equivalent"}, "the equivalence ledger's business, not inherited debt"),
        ({"state": "killed #3188"}, "answered"),
        ({"function": ""}, "would inherit module-wide"),
        ({"function": None}, "would inherit module-wide"),
        ({"module": ""}, "no identity to key on"),
        ({"pr": None}, "unattributable"),
        ({"pr": 0}, "unattributable"),
        ({"pr": -1}, "unattributable"),
        ({"pr": "3188"}, "a string is not an attribution"),
        ({"pr": True}, "a bool is not a PR number"),
        ({"key": ""}, "no mutant to match"),
        ({"key": "   "}, "no mutant to match"),
    ],
)
def test_baseline_from_ledger_refuses_an_entry_it_cannot_check(bad, why):
    assert M.baseline_from_ledger({"entries": [_entry(**bad)]}) == {}, why


def test_baseline_from_ledger_accepts_the_lowest_real_pr_number():
    """#1 is a real PR, so the bound is `pr <= 0`. Only the boundary itself tells it from `pr <= 1`."""
    b = M.baseline_from_ledger({"entries": [_entry(pr=1)]})
    assert b == {"nightqc.py::summarize": {"- a = None | + a = ''": [1]}}


@pytest.mark.parametrize(
    "bad", [{"lane": "js"}, {"state": "equivalent"}, {"pr": 0}, {"module": ""}, {"function": ""}, {"key": ""}]
)
def test_baseline_from_ledger_skips_an_unusable_entry_and_keeps_reading(bad):
    """Every refusal is a `continue` and never a `break`: one unusable row must not hide the rows
    after it. A `break` would silently shrink the baseline to whatever preceded the first bad row,
    which reads as inherited debt the record does not own."""
    b = M.baseline_from_ledger({"entries": [_entry(**bad), _entry(pr=4126)]})
    assert b == {"nightqc.py::summarize": {"- a = None | + a = ''": [4126]}}


@pytest.mark.parametrize("raw", [None, [], "", {"entries": None}, {"entries": []}, {}, {"entries": ["x", 7, None]}])
def test_baseline_from_ledger_reads_an_unusable_document_as_empty(raw):
    """Empty means every survivor blocks — the behaviour before the record existed."""
    assert M.baseline_from_ledger(raw) == {}


def test_baseline_from_ledger_lane_is_a_parameter_not_a_constant():
    # THE MODULE NAME IS DELIBERATELY NOT A REAL BUNDLE. `mutation_diff.root_reads` flags any
    # root-level filename a test source spells, and the mutation scratch then stages a copy of it
    # — 0.3 MB for a string this leg never opens. A name no root file carries says the same thing
    # about `lane` being a parameter and stages nothing (`tests/test_mutation_scratch_reuse.py`
    # pins that population).
    led = {"entries": [_entry(lane="js", module="somedex-dsp.js", function="processNight")]}
    assert M.baseline_from_ledger(led, lane="js") == {"somedex-dsp.js::processNight": {"- a = None | + a = ''": [3188]}}


# ── split_inherited ───────────────────────────────────────────────────────────────────────────────


def test_split_inherited_names_the_pr_that_recorded_it():
    b = M.baseline_from_ledger({"entries": [_entry()]})
    new, inherited = M.split_inherited([_survivor()], b)
    assert new == []
    # EVERY FIELD THE SURVIVOR CARRIED, PLUS THE TWO THIS ADDS. A reader reaches the measurement
    # through `inheritedFrom`, and the triage tools read `mutant` and `key` off the same row — so
    # the row is the survivor's own dict extended, never a fresh dict holding only the two keys.
    assert inherited == [dict(_survivor(), function="summarize", inheritedFrom=3188)]


def test_split_inherited_consumes_multiplicity_so_one_occurrence_too_many_is_new():
    b = M.baseline_from_ledger({"entries": [_entry(), _entry(pr=4126)]})
    new, inherited = M.split_inherited([_survivor(), _survivor(), _survivor()], b)
    assert len(inherited) == 2
    assert len(new) == 1
    # AND IN THE ORDER THE RECORD WAS WRITTEN. Two rows under one key are two separate claims, each
    # naming its own PR, so the first survivor must answer to the first row — `pop(0)`, never `pop()`.
    # Taking the last would credit the newer PR for the older survivor and the reader cannot tell.
    assert [x["inheritedFrom"] for x in inherited] == [3188, 4126]


def test_split_inherited_fails_closed_on_a_function_the_record_never_saw():
    b = M.baseline_from_ledger({"entries": [_entry()]})
    new, inherited = M.split_inherited([_survivor(mutant="nightqc.x_other__mutmut_1")], b)
    assert inherited == []
    assert len(new) == 1


def test_split_inherited_fails_closed_on_a_mutant_whose_function_cannot_be_read():
    """`function_of_mutant` returns "" rather than guessing, and an unnameable place inherits nothing."""
    b = M.baseline_from_ledger({"entries": [_entry()]})
    new, inherited = M.split_inherited([_survivor(mutant="not-a-mutmut-name")], b)
    assert (inherited, len(new)) == ([], 1)


def test_split_inherited_fails_closed_on_a_key_the_record_does_not_hold():
    b = M.baseline_from_ledger({"entries": [_entry()]})
    new, inherited = M.split_inherited([_survivor(key="- x | + y")], b)
    assert (inherited, len(new)) == ([], 1)


def test_split_inherited_prefers_the_survivors_own_function_field():
    b = M.baseline_from_ledger({"entries": [_entry(function="summarize")]})
    new, inherited = M.split_inherited([_survivor(mutant=None, function="summarize")], b)
    assert (new, len(inherited)) == ([], 1)


@pytest.mark.parametrize("baseline", [None, {}])
def test_split_inherited_without_a_baseline_splits_nothing(baseline):
    new, inherited = M.split_inherited([_survivor()], baseline)
    assert (len(new), inherited) == (1, [])


def test_split_inherited_takes_no_survivors_as_no_survivors():
    assert M.split_inherited(None, {"nightqc.py::summarize": {"k": [1]}}) == ([], [])


def test_split_inherited_does_not_spend_the_callers_baseline():
    """The pool is a copy, so a second call over the same baseline inherits the same survivors."""
    b = M.baseline_from_ledger({"entries": [_entry()]})
    assert len(M.split_inherited([_survivor()], b)[1]) == 1
    assert len(M.split_inherited([_survivor()], b)[1]) == 1


# ── classify, where the split actually lands ──────────────────────────────────────────────────────


def test_classify_carries_an_empty_inherited_bucket_when_it_looked_and_found_none():
    """§∅: the key is always present. A missing key would read as "this gate does not do that"."""
    cls = M.classify([], [_survivor()], set())
    assert cls["inherited"] == []
    assert len(cls["unclassified"]) == 1


def test_classify_moves_an_inherited_survivor_out_of_unclassified():
    b = M.baseline_from_ledger({"entries": [_entry()]})
    cls = M.classify([], [_survivor()], set(), baseline=b)
    assert cls["unclassified"] == []
    assert len(cls["inherited"]) == 1


def test_an_equivalence_entry_outranks_the_baseline():
    """A claimed survivor never reaches `unclassified`, so the record is not consulted for it."""
    b = M.baseline_from_ledger({"entries": [_entry()]})
    entry = {
        "module": "nightqc.py",
        "function": "summarize",
        "key": "- a = None | + a = ''",
        "class": "no-distinguishing-input",
        "probe": "ran both over 54 combinations, 0 differed",
    }
    cls = M.classify([entry], [_survivor()], set(), baseline=b)
    assert len(cls["excused"]) == 1
    assert cls["inherited"] == []
    assert cls["unclassified"] == []


# ── the report a reader gets ──────────────────────────────────────────────────────────────────────


def test_inherited_report_says_nothing_when_there_is_nothing_to_say():
    assert M.inherited_report([]) == []
    assert M.inherited_report(None) == []


def test_inherited_report_names_each_mutant_its_owner_and_the_ratchet():
    rows = M.inherited_report([{"mutant": "nightqc.x_summarize__mutmut_133", "inheritedFrom": 3188}])
    assert "1 survivor(s) are INHERITED" in rows[0]
    assert "nightqc.x_summarize__mutmut_133" in rows[1]
    assert "#3188" in rows[1]
    assert "ratchet" in rows[-1]
    assert "An unrecorded function inherits NOTHING" in rows[-1]


def test_inherited_report_takes_a_locator_and_caps_the_list():
    many = [{"mutant": f"nightqc.x_summarize__mutmut_{i}", "inheritedFrom": 3188} for i in range(14)]
    # THE LOCATOR READS ITS OWN SURVIVOR. A locator that ignores its argument cannot tell `loc(s)`
    # from `loc(None)`, and the gate injects `survivor_location`, which answers per mutant.
    rows = M.inherited_report(many, limit=3, locate=lambda s: f"  nightqc.py:{s['mutant'][-1]}")
    assert "nightqc.py:0" in rows[1]
    assert "nightqc.py:1" in rows[2]
    assert "… and 11 more" in rows[-2]
    # AND THE DEFAULT LOCATOR CONTRIBUTES NOTHING — asserted as the WHOLE line, because an
    # `endswith` cannot see a `None` spliced in ahead of it.
    rows_plain = M.inherited_report(many[:2])
    assert rows_plain[1] == "  ── nightqc.x_summarize__mutmut_0  (recorded by #3188)"


def test_inherited_report_caps_at_twelve_by_default():
    """The DEFAULT bound, pinned by crossing it. The leg above passes `limit=3` explicitly, so it holds
    for any constant — 13 rows under the real default is what tells 12 from 13."""
    many = [{"mutant": f"nightqc.x_summarize__mutmut_{i}", "inheritedFrom": 3188} for i in range(13)]
    rows = M.inherited_report(many)
    assert M.INHERITED_REPORT_LIMIT == 12
    assert sum(1 for r in rows if r.lstrip().startswith("──")) == 12
    assert "… and 1 more" in rows[-2]


def test_inherited_report_names_no_remainder_at_exactly_the_cap():
    """`>` and not `>=`: at the cap every row is printed, so there is no remainder to name."""
    many = [{"mutant": f"nightqc.x_summarize__mutmut_{i}", "inheritedFrom": 3188} for i in range(3)]
    rows = M.inherited_report(many, limit=3)
    assert sum(1 for r in rows if r.lstrip().startswith("──")) == 3
    assert "… and" not in "\n".join(rows)


# ── the gate's own loader, driven the way the gate loads it ────────────────────────────────────────

_PROBE = r"""
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("mutate_diff_under_test", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
out = {}
out["head"] = sorted(mod.load_survivor_baseline("HEAD"))
out["bogus_rev"] = mod.load_survivor_baseline("no-such-rev-0000")


class _R:
    def __init__(self, rc, text):
        self.returncode, self.stdout, self.stderr = rc, text, ""


mod.subprocess.run = lambda *a, **k: _R(0, "{not json")
out["malformed"] = mod.load_survivor_baseline("HEAD")


def _boom(*a, **k):
    raise OSError("no git here")


mod.subprocess.run = _boom
out["oserror"] = mod.load_survivor_baseline("HEAD")
print(json.dumps(out))
"""


def _probe():
    r = subprocess.run([sys.executable, "-c", _PROBE, str(TOOL)], capture_output=True, text=True, cwd=HERE.parent)
    assert r.returncode == 0, r.stderr[-3000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_the_loader_reads_the_committed_ledger_and_fails_closed_on_everything_else():
    """🔴 `git show` is the whole guard: the TREE's copy is the one this branch can write."""
    out = _probe()
    assert out["bogus_rev"] == {}, "a rev git cannot resolve must excuse nothing"
    assert out["malformed"] == {}, "a ledger that is not JSON must excuse nothing"
    assert out["oserror"] == {}, "no git must excuse nothing"
    assert all("::" in k for k in out["head"]), out["head"]


# ── the measurement the row asked for, over the real record ───────────────────────────────────────


def test_the_real_ledgers_open_entries_are_inherited_and_one_new_key_still_fails():
    """THE ROW'S OWN QUESTION, asked of the committed record rather than a fixture.

    The ledger's open `py` entries are the backlog a PR touching those functions inherits today. Each
    one must read inherited, and a key the record does not hold must still fail — otherwise the
    baseline is an excuse rather than a blame split.
    """
    doc = json.loads(LEDGER.read_text(encoding="utf-8"))
    open_py = [e for e in doc["entries"] if e.get("lane") == "py" and e.get("state") == "open"]
    if not open_py:
        pytest.skip("the ledger holds no open py entry — nothing is inherited, and nothing to measure")
    survivors = [
        {"mutant": e["mutant"], "module": e["module"], "key": e["key"], "function": e["function"]} for e in open_py
    ]
    new, inherited = M.split_inherited(survivors, M.baseline_from_ledger(doc))
    assert new == []
    assert len(inherited) == len(open_py)
    assert {s["inheritedFrom"] for s in inherited} == {e["pr"] for e in open_py}

    intruder = dict(survivors[0], key="- _cur_end = None | + _cur_end = 1", mutant="nightqc.x_summarize__mutmut_9999")
    new2, inherited2 = M.split_inherited(survivors + [intruder], M.baseline_from_ledger(doc))
    assert new2 == [intruder]
    assert len(inherited2) == len(open_py)
