# tepna-capture — tests/test_find_unwired.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The unwired-machinery detector.

It exists because five instances of one class were found by hand on 2026-08-14 and three more shipped
the same day — a check that examines correctly and reports to NOBODY. No CI job can see that class,
because every instance has passing tests: the tests call the function directly, and that direct call is
exactly the wiring production lacks.

The assertions below are mostly about the detector's KNOWN WRONG ANSWERS. Two earlier drafts produced
confident nonsense, and a scanner that is wrong is worse than none — it teaches people to ignore it.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))

import find_unwired  # noqa: E402


def test_status_keys_come_from_the_AST_not_a_regex_over_source():
    """⚠️ THE FIRST WRONG DRAFT. Regexing `_set(name, key=…)` out of source text also collects the
    kwargs of NESTED calls: `_set(name, clock_synced=_now().isoformat(timespec="seconds"))` reported
    `timespec` — an argument to `isoformat` — as a published status key. Walking the AST and taking only
    the `_set` call's own keywords makes that impossible rather than merely unlikely."""
    src = 'def f():\n    _set(name, real=1, other=_now().isoformat(timespec="seconds"))\n'
    keys = find_unwired.status_keys(src)
    assert "real" in keys and "other" in keys
    assert "timespec" not in keys, "a nested call's kwarg is not a status key"


def test_status_keys_include_literal_keys_inside_a_splat():
    """`_set(name, **{"rate_unmet": …})` is the form capture.py actually uses for computed keys, and a
    scan that only reads `kw.arg` misses every one of them — reporting the key as never published rather
    than as published-and-unread, which is the opposite finding."""
    src = 'def f():\n    _set(name, **{"rate_unmet": {}, "pmd_options": {}})\n'
    keys = find_unwired.status_keys(src)
    assert {"rate_unmet", "pmd_options"} <= keys


def test_a_CALLBACK_REFERENCE_counts_as_wired():
    """⚠️ THE SECOND WRONG DRAFT, and the more dangerous one. Matching `name(` misses a function passed
    WITHOUT parentheses — `to_thread(diskguard.prune_old_nights, …)` — which made retention and
    night-archiving both read as dead code when both are wired into the daemon. Reporting live safety
    machinery as unused is how a scanner gets switched off."""
    res = find_unwired.scan()
    dead = {r["func"] for r in res["orphan_functions"]}
    assert "prune_old_nights" not in dead, "passed to asyncio.to_thread — wired, no parentheses"
    assert "unarchived_nights" not in dead, "same, in the disk-guard loop"


def test_the_report_is_ADVISORY_and_always_exits_zero():
    """A hard gate here fails on every declarative constant and CLI entry point, and a gate people
    silence is worse than no gate — the same failure one level up from the one this finds."""
    assert find_unwired.main([]) == 0
    assert find_unwired.main(["--json"]) == 0


def test_allowlisted_entries_are_REPORTED_as_allowed_not_dropped():
    """A suppression you cannot see is how the next real finding hides behind a stale entry. Every
    allowlist row carries its reason and still appears in the output."""
    assert all(find_unwired.ALLOW_FUNCS.values()), "every allowlist entry must state WHY"
    assert all(find_unwired.ALLOW_KEYS.values())


def test_it_finds_the_class_it_was_written_for():
    """Non-vacuity. A scanner that reports nothing on a codebase known to contain instances is broken,
    and would pass every assertion above."""
    res = find_unwired.scan()
    assert res["orphan_functions"], "the scan found nothing at all — it is not looking"


# ── against a SYNTHETIC tree, so the assertions are deterministic ────────────────────────────────────
#
# The scans above run on the live checkout, which is the honest smoke test but a moving target: what the
# detector "should find" changes every time a PR lands. A controlled root pins the behaviour instead —
# and reaches the alternate paths the real tree never takes, because in the real tree every consumer
# module exists and capture.py is always present.

def _tree(tmp_path, files: dict):
    for name, body in files.items():
        (tmp_path / name).write_text(body, encoding="utf-8")
    return str(tmp_path)


def test_a_key_read_by_a_consumer_is_NOT_reported(tmp_path):
    root = _tree(tmp_path, {
        "capture.py": 'def f():\n    _set(name, seen=1, unseen=2)\n',
        "webmon.py": 'x = st.get("seen")\n',
    })
    keys = {r["key"] for r in find_unwired.scan(root)["orphan_status_keys"]}
    assert keys == {"unseen"}, keys


def test_a_root_with_NO_consumer_modules_reports_every_key(tmp_path):
    """Covers the branch the live tree cannot: `webmon.py` and friends always exist there, so the
    "consumer file absent" path never runs and a missing-file crash would ship unnoticed."""
    root = _tree(tmp_path, {"capture.py": 'def f():\n    _set(name, alone=1)\n'})
    keys = {r["key"] for r in find_unwired.scan(root)["orphan_status_keys"]}
    assert keys == {"alone"}


def test_a_root_with_NO_capture_py_reports_no_keys_rather_than_crashing(tmp_path):
    """The other branch the live tree cannot reach. A scanner that raises on an unexpected tree is a
    scanner people stop running."""
    root = _tree(tmp_path, {"webmon.py": "x = 1\n"})
    assert find_unwired.scan(root)["orphan_status_keys"] == []


def test_an_ALLOWLISTED_function_is_reported_as_allowed_not_hidden(tmp_path, monkeypatch, capsys):
    """A suppression you cannot see is how the next real finding hides behind a stale entry — so an
    allowlisted row still prints, with its reason, and is counted separately."""
    root = _tree(tmp_path, {"m.py": "def only_tests_call_me():\n    return 1\n"})
    monkeypatch.setattr(find_unwired, "HERE", root)
    monkeypatch.setitem(find_unwired.ALLOW_FUNCS, "only_tests_call_me", "synthetic reason")
    assert find_unwired.main([]) == 0
    out = capsys.readouterr().out
    assert "(allowed)" in out and "synthetic reason" in out
    assert "0 unexplained, 1 allowed" in out


def test_the_scanner_does_NOT_count_its_own_allowlist_as_usage():
    """⚠️ THE DETECTOR COMMITTING ITS OWN DEFECT CLASS, found 2026-08-14 by using it.

    The allowlist NAMES the functions it excuses. `os.walk` reads `tools/` into the corpus, so each
    entry counted as a usage — and the row then vanished from the report ENTIRELY instead of printing as
    "(allowed)". That is the precise inversion of the design: *a suppression you cannot see is how the
    next real finding hides behind a stale entry.* Adding three entries silently removed three rows.

    A scanner must not read its own suppression file as evidence the code is wired."""
    res = find_unwired.scan()
    allowed = {r["func"] for r in res["orphan_functions"] if r["allowed"]}
    assert "predict_step_split" in allowed, (
        "an allowlisted function must still be REPORTED, with its reason — not silently absent")
    # `busy_with` was the third example here until 2026-09-05, when `capture.gate_state()` started
    # reading it — the entry became SPENT and the stale-allowlist check below rightly demanded its
    # deletion. An example function must stay orphaned to remain an example.
    assert "is_offline_cmd" in allowed and "oxy_is_finalized" in allowed


def test_every_allowlisted_function_still_appears_in_the_report(capsys):
    """The count line must separate the two populations, so a growing allowlist is visible rather than
    quietly shrinking the finding list."""
    find_unwired.main([])
    out = capsys.readouterr().out
    assert "unexplained," in out and "allowed" in out
    for name in ("predict_step_split", "is_offline_cmd", "oxy_is_finalized"):
        assert name in out, f"{name} is allowlisted but absent from the report"


def test_check_mode_FAILS_on_anything_unexplained(tmp_path, monkeypatch, capsys):
    """⚠️ A GATE YOU HAVE NOT SEEN FAIL IS NOT A GATE — this suite's most-repeated lesson, applied to
    the gate built from it.

    `--check` only became honest after the allowlist was curated: on 2026-08-14 this reported 13
    unexplained functions, every one needing a human decision. Failing CI on that list would have
    trained people to silence it, which is the same defect one level up. With the count at 0, the floor
    is defensible — a NEW unexplained orphan means something was just added and wired to nothing."""
    root = _tree(tmp_path, {"m.py": "def nobody_calls_me():\n    return 1\n"})
    monkeypatch.setattr(find_unwired, "HERE", root)
    assert find_unwired.main(["--check"]) == 1
    assert "unexplained" in capsys.readouterr().out


def test_check_mode_PASSES_when_everything_is_wired_or_explained(tmp_path, monkeypatch, capsys):
    """The other direction, so the gate cannot be green by never looking — the exact failure this whole
    detector exists to find."""
    root = _tree(tmp_path, {"m.py": "def helper():\n    return 1\n\n\ndef caller():\n    return helper()\n"})
    monkeypatch.setattr(find_unwired, "HERE", root)
    # Scan 6 (module reachability) is not what this fixture is about: a one-file synthetic tree
    # is unimported by construction. Exempt it explicitly rather than let an unrelated scan
    # decide this test's verdict.
    monkeypatch.setitem(find_unwired.ALLOW_MODULES, "m", "synthetic fixture")
    monkeypatch.setitem(find_unwired.ALLOW_FUNCS, "caller", "synthetic entry point")
    assert find_unwired.main(["--check"]) == 0
    assert "0 unexplained" in capsys.readouterr().out


def test_a_BARE_run_still_exits_zero_so_it_can_be_read_without_gating():
    """The report stays usable as a report. Only `--check` enforces."""
    assert find_unwired.main([]) == 0


# ── scan 3 · forwarded but never drawn ──────────────────────────────────────────────────────────────
_WEBMON = ('def p(st):\n    return {"connected": 1, "battery": st.get("battery"),\n'
           '            "drawn": st.get("drawn"), "hidden": st.get("hidden")}\n')


def test_a_field_webmon_forwards_but_the_monitor_never_draws_is_REPORTED(tmp_path):
    root = _tree(tmp_path, {"webmon.py": _WEBMON, "monitor.html": "<b>${dev.drawn}</b>"})
    keys = [r["key"] for r in find_unwired.scan(root)["orphan_rendered"]]
    assert "hidden" in keys and "drawn" not in keys


def test_forwarding_alone_does_not_satisfy_it__that_is_the_orphan_one_layer_along(tmp_path):
    """Scan 1 counts `webmon.py` as a consumer, so forwarding a key satisfies it while the key still
    reaches nobody's eyes. `worn_why` makes the argument itself: the daemon logs the conflict, and a log
    line does not reach the person looking at the monitor — which applies one layer further on too."""
    root = _tree(tmp_path, {"capture.py": 'def f():\n    _set(n, hidden=1)\n',
                            "webmon.py": _WEBMON, "monitor.html": "<b>nothing</b>"})
    res = find_unwired.scan(root)
    assert not [r for r in res["orphan_status_keys"] if r["key"] == "hidden"]   # scan 1 is satisfied
    assert [r for r in res["orphan_rendered"] if r["key"] == "hidden"]          # scan 3 is not


def test_losing_the_AST_ANCHOR_reds_rather_than_reporting_zero(tmp_path):
    """FAIL LOUD, NOT OPEN. An anchor that stops matching returns an empty key set, and an empty set
    reports `0 unexplained` forever — a scan that examines nothing and calls it clean, which is the
    exact class this tool exists to name."""
    root = _tree(tmp_path, {"webmon.py": 'def p(st):\n    return {"nothing": 1}\n',
                            "monitor.html": "<b>x</b>"})
    rows = find_unwired.scan(root)["orphan_rendered"]
    assert len(rows) == 1 and "projection not found" in rows[0]["key"]
    assert rows[0]["allowed"] is None                      # unexplained ⇒ --check exits 1


def test_no_webmon_or_no_monitor_reports_nothing_rather_than_crashing(tmp_path):
    assert find_unwired.scan(_tree(tmp_path, {"webmon.py": _WEBMON}))["orphan_rendered"] == []


# ── scan 4 · a handler with no control ──────────────────────────────────────────────────────────────
def test_a_monitor_handler_nothing_calls_is_REPORTED(tmp_path):
    root = _tree(tmp_path, {"monitor.html":
                            "<button onclick='used()'>x</button>"
                            "<script>function used(){} function orphaned(){}</script>"})
    names = [r["func"] for r in find_unwired.scan(root)["orphan_js"]]
    assert names == ["orphaned"]


def test_a_key_referenced_only_INSIDE_a_dead_handler_is_still_caught(tmp_path):
    """Scan 3 greps the file, and the helper's own body contains the key — so deleting the call site left
    scan 3 green while the field reached nobody. Measured on `lastSampleText` before scan 4 existed; the
    definition is not a use, which is scan 2's rule applied to the page."""
    root = _tree(tmp_path, {"webmon.py": _WEBMON,
                            "monitor.html": "<script>function draw(d){return d.hidden;}</script>"})
    res = find_unwired.scan(root)
    assert not [r for r in res["orphan_rendered"] if r["key"] == "hidden"]   # grep is satisfied…
    assert [r for r in res["orphan_js"] if r["func"] == "draw"]             # …the handler is dead


def test_scan_4_allowlist_reports_rather_than_hides(tmp_path, monkeypatch, capsys):
    root = _tree(tmp_path, {"monitor.html": "<script>function orphaned(){}</script>"})
    monkeypatch.setattr(find_unwired, "HERE", root)
    monkeypatch.setattr(find_unwired, "ALLOW_JS", {"orphaned": "a documented reason"})
    assert find_unwired.main(["--check"]) == 0
    out = capsys.readouterr().out
    assert "(allowed)" in out and "a documented reason" in out


# ── tokenize-before-match (2026-08-27) ───────────────────────────────────────
def test_a_name_in_a_COMMENT_is_not_a_use(tmp_path):
    """🔴 THE REGRESSION THIS PINS, measured on the real tree: 12 public functions were masked from the
    orphan scan by prose alone. The demonstration that settled it — a tombstone comment written to
    explain a deletion named four `oxy_transfer` functions in passing, and `resume_target`'s only
    mention outside its own module WAS that comment. A comment written to be helpful switched the
    detector off for it.

    A gate whose precision degrades as the repo documents itself better is mis-specified for a repo
    that documents itself constantly."""
    f = tmp_path / "m.py"
    f.write_text("# see widget_helper for the enforcement\ndef widget_helper():\n    return 1\n")
    assert "widget_helper" not in find_unwired._code_only(str(f)).replace("def widget_helper", "")


def test_a_name_in_a_DOCSTRING_is_not_a_use(tmp_path):
    f = tmp_path / "m.py"
    f.write_text('"""Calls widget_helper eventually."""\ndef other():\n    return 2\n')
    assert "widget_helper" not in find_unwired._code_only(str(f))


def test_a_REAL_call_still_counts(tmp_path):
    """The control. Stripping comments must not strip code — a scan that sees nothing reports every
    function as an orphan, which is louder but just as wrong."""
    f = tmp_path / "m.py"
    f.write_text("def a():\n    return widget_helper()\n")
    assert "widget_helper" in find_unwired._code_only(str(f))


def test_an_UNPARSEABLE_file_falls_back_to_RAW_text(tmp_path):
    """Fails toward OVER-counting uses. A syntactically broken file contributing NOTHING would invent
    orphans across the whole repo from one bad parse — the loud-and-wrong direction."""
    f = tmp_path / "broken.py"
    f.write_text("def a(:\n  widget_helper()\n")
    assert "widget_helper" in find_unwired._code_only(str(f))


def test_shell_comments_are_stripped_too(tmp_path):
    f = tmp_path / "s.sh"
    f.write_text("# widget_helper is documented here\necho other\n")
    assert "widget_helper" not in find_unwired._code_only(str(f))


def test_the_SCAN_ITSELF_uses_code_only_not_raw_text(tmp_path):
    """🔴 THIS TEST EXISTS BECAUSE A PLANTED CONTROL SURVIVED. The three tests above call
    `_code_only` directly, so reverting the SCAN to raw-text matching left all of them green — the
    helper was pinned and its USE was not. That is the assertion-encodes-shape trap: a test that
    exercises the unit under test but not the wiring that makes it matter.

    Here the only mention of `lonely_fn` outside its own definition is a COMMENT, so a raw-text scan
    counts it as a call and reports nothing; a `_code_only` scan reports it as an orphan."""
    (tmp_path / "mod_a.py").write_text("def lonely_fn():\n    return 1\n")
    (tmp_path / "mod_b.py").write_text("# lonely_fn is the enforcement point\ndef other():\n    return 2\n")
    res = find_unwired.scan(root=str(tmp_path))
    orphans = {r["func"] for r in res["orphan_functions"]}
    assert "lonely_fn" in orphans, (
        "the scan counted a name in a comment as a call — it is matching raw text, not code")


# ── SCAN 5 · a suppression that excuses nothing (2026-08-27) ────────────────
def test_a_SPENT_suppression_is_reported_and_REDS(tmp_path, monkeypatch, capsys):
    """The gate's whole purpose. A wired function's allowlist entry excuses nothing, and this tool did
    not report that: the function simply dropped off the orphan list and its entry sat inert. Worse,
    the entry NAMES a symbol, so it pre-silences any future finding that reuses the name."""
    root = _tree(tmp_path, {"m.py": "def helper():\n    return 1\n\n\ndef caller():\n    return helper()\n"})
    monkeypatch.setattr(find_unwired, "HERE", root)
    # Scan 6 (module reachability) is not what this fixture is about: a one-file synthetic tree
    # is unimported by construction. Exempt it explicitly rather than let an unrelated scan
    # decide this test's verdict.
    monkeypatch.setitem(find_unwired.ALLOW_MODULES, "m", "synthetic fixture")
    # BOTH entries, deliberately: `caller` is a genuine orphan and must be EXPLAINED, so the only
    # thing left that can red is the spent `helper`. ⚠️ The first version of this test allowlisted
    # `helper` alone — `caller` was then an unexplained orphan, the run exited 1 for THAT reason, and
    # the staleness branch was never executed. Coverage caught it: the red's own lines were unhit
    # while the test asserting the red passed.
    monkeypatch.setattr(find_unwired, "ALLOW_FUNCS",
                        {"helper": "spent — helper IS called by caller",
                         "caller": "genuine — nothing calls caller"})
    assert find_unwired.main(["--check"]) == 1
    out = capsys.readouterr().out
    # Assert the VERDICT, not the section header. "excuse nothing" appears in the heading on every
    # run, so matching it proved only that the section printed.
    assert "DELETE them" in out and "0 unexplained" in out, out[-400:]


def test_an_entry_for_a_GENUINE_orphan_stays_green(tmp_path, monkeypatch, capsys):
    """The other direction, so the gate cannot red by flagging everything."""
    root = _tree(tmp_path, {"m.py": "def helper():\n    return 1\n\n\ndef caller():\n    return helper()\n"})
    monkeypatch.setattr(find_unwired, "HERE", root)
    # Scan 6 (module reachability) is not what this fixture is about: a one-file synthetic tree
    # is unimported by construction. Exempt it explicitly rather than let an unrelated scan
    # decide this test's verdict.
    monkeypatch.setitem(find_unwired.ALLOW_MODULES, "m", "synthetic fixture")
    monkeypatch.setattr(find_unwired, "ALLOW_FUNCS", {"caller": "genuine — nothing calls caller"})
    assert find_unwired.main(["--check"]) == 0


def test_staleness_is_judged_ONLY_against_the_population_the_scan_ENUMERATED(tmp_path, monkeypatch):
    """🔴 THE DESIGN CONSTRAINT, and two wrong fixes preceded it.

    `ALLOW_FUNCS` is a module constant describing the WHOLE repo. Point `scan()` at a subtree and every
    entry matches nothing, so a naive `set(allow) - reported` makes the stale count a property of the
    ROOT rather than of the allowlist — and every fixture-based test of this tool would red for a
    reason unrelated to the tool.

    A first fix gated on 'is this the full tree', which is the WRONG AXIS: a fixture that sets HERE to
    itself IS the full tree by that test and still knows nothing about `close_harvest_decision`. A
    second scoped only ALLOW_FUNCS, leaving ALLOW_KEYS to red against a tree with no capture.py. The
    rule that holds: an entry is judged only if its subject was in the population its own scan
    enumerated."""
    root = _tree(tmp_path, {"monitor.html": "<script>function orphaned(){}</script>"})
    res = find_unwired.scan(root)
    # No capture.py, no webmon.py, no .py at all — so no scan enumerated a population, and the real
    # allowlist's many entries must produce ZERO staleness rather than all of it.
    assert res["stale_allowlist"] == [], res["stale_allowlist"][:3]


# ── SCAN 6 · a module NOTHING imports ─────────────────────────────────────────────────────────────
# Found 2026-08-31: `status_union.py` — the whole §3.6 merge layer, tested — was imported by nothing
# but its own test file and appeared NOWHERE in this report. Two masks operated at once, which is why
# neither the function scan nor a reader caught it: `merge()` calls its own helpers (so the leaves
# had uses>defs), and `merge` is a generic word occurring in three unrelated modules (so did the root).
def _tree(tmp_path, files: dict):
    for name, text in files.items():
        p = tmp_path / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    return str(tmp_path)


def test_A_MODULE_NOTHING_IMPORTS_IS_FLAGGED_HOWEVER_COHESIVE_IT_IS():
    """The exact shape that hid: internal calls make every leaf look used.

    `root()` calls `leaf()`, so a `uses - defs` scan sees the leaf referenced and stays quiet. Module
    reachability is a different question and has to be asked separately."""
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as td:
        root = _tree(pathlib.Path(td), {
            "lonely.py": "def leaf():\n    return 1\n\n\ndef root():\n    return leaf()\n",
            "daemon.py": "def go():\n    return 2\n",
        })
        mods = {r["module"] for r in find_unwired.scan(root)["orphan_modules"]}
        assert "lonely" in mods, "a cohesive but unimported module was not flagged"


def test_AN_IMPORTED_MODULE_IS_NOT_FLAGGED():
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as td:
        root = _tree(pathlib.Path(td), {
            "helper.py": "def used():\n    return 1\n",
            "daemon.py": "import helper\n\n\ndef go():\n    return helper.used()\n",
        })
        mods = {r["module"] for r in find_unwired.scan(root)["orphan_modules"]}
        assert "helper" not in mods


def test_A_DYNAMICALLY_LOADED_MODULE_IS_NOT_A_FALSE_POSITIVE():
    """⚠️ THE FIRST VERSION OF THIS SCAN CRIED WOLF HERE.

    `tools/mutate_diff.py` loads `mmeta` with `spec_from_file_location("mmeta", …)` + `exec_module`,
    which no import-line regex can see. A reachability gate that reports a live module as dead gets
    switched off, and then it protects nothing."""
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as td:
        root = _tree(pathlib.Path(td), {
            "dyn.py": "def used():\n    return 1\n",
            "loader.py": 'import importlib.util as ilu\n'
                         's = ilu.spec_from_file_location("dyn", "dyn.py")\n',
        })
        mods = {r["module"] for r in find_unwired.scan(root)["orphan_modules"]}
        assert "dyn" not in mods


def test_A_SKIP_LIST_MENTION_IS_NOT_AN_IMPORT():
    """⚠️ AND THE FALSE NEGATIVE I INTRODUCED WHILE FIXING THE FALSE POSITIVE.

    Matching a bare `"<module>.py"` literal made `SKIP = {"adapter_ab.py"}` in tools/mutate.py count
    as reachability — a file being EXCLUDED read as a file being used. A pattern loose enough to be
    satisfied by exclusion is evidence of nothing, and it silenced a genuine orphan."""
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as td:
        root = _tree(pathlib.Path(td), {
            "skipped.py": "def alone():\n    return 1\n",
            "gate.py": 'SKIP = {"skipped.py"}\n\n\ndef go():\n    return SKIP\n',
        })
        mods = {r["module"] for r in find_unwired.scan(root)["orphan_modules"]}
        assert "skipped" in mods, "a skip-list mention was counted as an import"


def test_A_COMMENT_NAMING_A_MODULE_IS_NOT_AN_IMPORT():
    # `timeline.py` names `adapter_ab.night_profile` in prose. Counting that is the masking the
    # function scan already learned to refuse via `_code_only`.
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as td:
        root = _tree(pathlib.Path(td), {
            "prose.py": "def alone():\n    return 1\n",
            "doc.py": "# see prose.alone() for the derivation\nimport os\n\n\ndef go():\n    return os\n",
        })
        mods = {r["module"] for r in find_unwired.scan(root)["orphan_modules"]}
        assert "prose" in mods


def test_AN_ENTRY_POINT_IS_REACHABLE_BY_BEING_RUN():
    """A script with `__main__` needs no importer. Without this exemption every tool would flag, and a
    gate that flags everything is a gate nobody reads."""
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as td:
        root = _tree(pathlib.Path(td), {
            "script.py": 'def go():\n    return 1\n\n\nif __name__ == "__main__":\n    go()\n',
        })
        mods = {r["module"] for r in find_unwired.scan(root)["orphan_modules"]}
        assert "script" not in mods


def test_THE_KNOWN_SUBJECTS_ARE_EXPLAINED_NOT_SILENT():
    """Every real subject must appear in the report — as allowed, never absent.

    `status_union` was invisible before this scan; the fix is that it is now VISIBLE with a reason
    naming the consumer it waits on. An exemption you cannot see is the mask one level up."""
    rows = {r["module"]: r for r in find_unwired.scan()["orphan_modules"]}
    for mod in ("status_union", "adapter_pool", "adapter_ab"):
        assert mod in rows, f"{mod} vanished from the report"
        assert rows[mod]["allowed"], f"{mod} is unexplained"


def test_AN_UNEXPLAINED_MODULE_ACTUALLY_REDS_CHECK():
    """⚠️ THE FIRST VERSION OF SCAN 6 REPORTED WITHOUT GATING.

    It printed its findings and `--check` still exited 0, because `main()`'s verdict summed the other
    four scans and not this one. A scan nobody is forced to answer is a scan that gets scrolled past —
    the decorative half of the very failure this tool exists to name. So the gating is asserted
    separately from the detection: finding it and failing on it are two different claims."""
    res = {"orphan_status_keys": [], "orphan_functions": [], "orphan_rendered": [], "orphan_js": [],
           "orphan_modules": [{"module": "ghost", "funcs": ["f"], "allowed": None}],
           "stale_allowlist": [], "full_tree": True}
    n = sum(1 for r in res["orphan_status_keys"] + res["orphan_functions"]
            + res["orphan_rendered"] + res["orphan_js"] + res["orphan_modules"]
            if not r["allowed"])
    assert n == 1, "an unexplained module must count toward the verdict"
    # ...and the real main() must agree, not just this arithmetic.
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = find_unwired.main(["--check"])
    assert rc == 0, "the live tree should be clean; if this fails, something is genuinely unexplained"
    assert "ALLOW_MODULES" in buf.getvalue() or "modules NOTHING imports" in buf.getvalue()


def test_AN_UNREADABLE_FILE_DOES_NOT_STOP_THE_REACHABILITY_SCAN():
    """A tree can contain something `open()` refuses — a directory named `x.py` is the cheap case.

    The scan must skip it and keep walking. A reachability check that dies on one odd path would
    report nothing about the rest of the tree, which is worse than the orphan it was looking for."""
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as td:
        root = pathlib.Path(td)
        (root / "lonely.py").write_text("def alone():\n    return 1\n")
        # In a SUBDIRECTORY: `scan()` reads only root-level files, while `importers()` walks the whole
        # tree — so the subdirectory is the only place this guard can actually be reached.
        #
        # ⚠️ A DANGLING SYMLINK, not a directory named `.py`. My first attempt used the directory, and
        # it never reached the guard at all: `os.walk` yields directories in `dirs`, never in `names`,
        # so nothing ever tried to open it. The test passed while exercising nothing — which is the
        # failure this whole file is about, committed inside a test for it.
        (root / "sub").mkdir()
        (root / "sub" / "trap.py").symlink_to(root / "nonexistent-target")
        mods = {r["module"] for r in find_unwired.scan(str(root))["orphan_modules"]}
        assert "lonely" in mods, "the scan gave up when it met an unreadable path"


# ── the TOP-LEVEL publication shape (closed 2026-09-01) ─────────────────────────────────────────────
# `STATUS["radio_distress"]` was computed nightly and read by nothing while this gate reported
# 0 unexplained — because scan 1 enumerated only `_set(name, key=…)` and a top-level assignment is a
# different shape. These plant exactly that class and pin that the zero now carries its filter.

def test_a_top_level_STATUS_assignment_is_seen_and_an_unread_one_reported(tmp_path):
    root = _tree(tmp_path, {
        "capture.py": 'STATUS["seen_top"] = 1\nSTATUS["unread_top"] = 2\n'
                      'STATUS.setdefault("unread_sd", {})["x"] = 3\n',
        "webmon.py": 'y = status.get("seen_top")\n',
    })
    rows = find_unwired.scan(root)["orphan_status_keys"]
    assert {r["key"] for r in rows} == {"unread_top", "unread_sd"}, rows
    assert all(r["shape"].startswith("STATUS[key]=") for r in rows), \
        "a row must say WHICH publication shape it came through"


def test_a_STATUS_read_is_not_mistaken_for_a_publication(tmp_path):
    """`STATUS.get(...)` and right-hand-side subscripts are consumption; collecting them would let a
    key publish itself by being read, which inverts the whole finding."""
    root = _tree(tmp_path, {
        "capture.py": 'x = STATUS["only_read"]\ny = STATUS.get("also_read")\n',
    })
    assert find_unwired.scan(root)["orphan_status_keys"] == []


def test_the_zero_carries_its_filter(tmp_path):
    """The report's count must name the enumerated shapes WITH their sizes — a '0 unexplained' over
    an unnamed population is the examined-nothing shape one level up, and is how the top-level class
    hid for months."""
    root = _tree(tmp_path, {
        "capture.py": 'def f():\n    _set(name, a=1)\nSTATUS["b"] = 2\n',
        "webmon.py": 'status.get("a"); status.get("b")\n',
    })
    res = find_unwired.scan(root)
    assert res["orphan_status_keys"] == []
    shapes = res["examined_status_shapes"]
    assert shapes["_set(name, key=…)"] == 1
    assert shapes["STATUS[key]= / STATUS.setdefault(key,…)"] == 1


def test_a_key_published_through_BOTH_shapes_is_counted_once_and_under_set(tmp_path):
    """The live tree has keys `_set` writes that also appear top-level; double-reporting one would
    make every real finding read as two."""
    src = 'def f():\n    _set(name, both=1)\nSTATUS["both"] = 2\n'
    both = find_unwired.status_keys(src) & find_unwired.top_status_keys(src)
    assert both == {"both"}
    rows = find_unwired.scan(_tree(tmp_path, {"capture.py": src}))["orphan_status_keys"]
    assert [r["key"] for r in rows] == ["both"], rows
    assert rows[0]["shape"] == "_set(name, key=…)"


def test_a_status_key_named_only_in_a_COMMENT_is_reported_unwired(tmp_path, monkeypatch, capsys):
    """The gate for this defect class was blind to the defect class.

    Measured 2026-09-02: the consumer corpus was raw file text, so `\\bautopull\\b` matched a COMMENT in
    `monitor.html` — and that comment's content was the observation that `STATUS["autopull"]` reaches
    nobody. The gate's own evidence of the defect is what suppressed the finding. Two real fields were
    masked this way (`autopull`, `updated`), one of which had to be found by hand-tracing instead.

    Fails without `_comments_only`: with a raw-text corpus the commented mention counts as a consumer
    and the key is reported wired."""
    root = _tree(tmp_path, {
        "capture.py": 'def f(name):\n    _set(name, only_in_a_comment=1)\n',
        "webmon.py": '# only_in_a_comment is published but nothing reads it — see the 2026-09-02 trace\nX = 1\n',
    })
    monkeypatch.setattr(find_unwired, "HERE", root)
    find_unwired.main([])
    out = capsys.readouterr().out
    assert "only_in_a_comment" in out, "a key named only in prose must still be reported unwired"


def test_a_status_key_read_as_a_STRING_LITERAL_is_still_wired(tmp_path, monkeypatch, capsys):
    """The paired direction, and the reason this uses `_comments_only` rather than `_code_only`.

    A status key reaches its consumer AS A STRING — `status.get("radio_distress")`. `_code_only` strips
    string literals (right for the function scan, where a call is an identifier), so using it here
    would flip every such key to unwired. Verified against the real tree before this was written:
    `_code_only('webmon.py')` removes `"radio_distress"` and `"host_clock"`, both live consumers. This
    leg fails if anyone later 'simplifies' the two strippers into one."""
    root = _tree(tmp_path, {
        "capture.py": 'def f(name):\n    _set(name, read_as_a_literal=1)\n',
        "webmon.py": 'def block(status):\n    return {"read_as_a_literal": status.get("read_as_a_literal")}\n',
    })
    monkeypatch.setattr(find_unwired, "HERE", root)
    find_unwired.main([])
    out = capsys.readouterr().out
    assert "read_as_a_literal" not in out, "a key read as a string literal is wired, not an orphan"


def test_comments_only_falls_back_to_RAW_TEXT_on_a_broken_file(tmp_path):
    """Same failure direction as `_code_only`'s twin above, for the consumer corpus.

    A syntactically broken consumer must contribute its raw text rather than nothing: contributing
    nothing would make every key that file reads look unwired, inventing orphans across the tree from
    one bad parse. Over-counting uses is the safe direction here — a missed orphan costs a finding, a
    fabricated one costs trust in the whole report."""
    f = tmp_path / "broken_consumer.py"
    f.write_text('status.get("read_by_a_broken_file")\ndef oops(  # unclosed\n', encoding="utf-8")
    out = find_unwired._comments_only(str(f))
    assert "read_by_a_broken_file" in out, "a broken consumer still contributes its references"


# ── scan 7 · DIVERGENT PROVENANCE — one consumer, two callers, two materially different sources ──────
# PARTIAL-ADOPTION-DETECTION §3/§4: a mechanism wired to ONE of N consumers reads as finished, not
# broken. The denominator is anchored on the CONSUMER (who calls `_usb_rebind`? — 2, countable), and
# the defect shows as the same parameter arriving DERIVED at one site and READ FROM CONFIG at another.
#
# ⚠️ THESE ARE PLANTS, WRITTEN BEFORE THE SCAN WAS POINTED AT REAL SOURCE (§4.2). The probe's first
# version missed the very defect it was written for — an `IfExp` its classifier did not understand —
# and reported two builtins instead. Rediscovering the known instance proves only that the tuning
# worked; a synthetic divergence it must flag and a legitimate configuration it must NOT are the only
# evidence that the detector sees the class rather than the example.

def test_PLANT_a_derived_vs_configured_argument_to_one_consumer_IS_flagged(tmp_path):
    """The defect shape, synthetic: caller A derives the value, caller B reads it from config."""
    root = _tree(tmp_path, {
        "core.py": "def consumer(target):\n    return target\n\ndef derive(h):\n    return h\n",
        "a.py": "from core import consumer, derive\n\ndef go(h):\n    return consumer(derive(h))\n",
        "b.py": "from core import consumer\n\ndef go(cfg):\n    return consumer(cfg.get('target'))\n",
    })
    rows = find_unwired.scan(root)["divergent_provenance"]
    hit = [r for r in rows if r["consumer"] == "consumer"]
    assert len(hit) == 1, rows
    kinds = {p["kind"] for p in hit[0]["provenances"]}
    assert "CALL:derive" in kinds and "CONFIG" in kinds, kinds


def test_PLANT_the_IfExp_shape_that_the_first_probe_MISSED_is_flagged(tmp_path):
    """§4.2: `adapter_usb_id(hci) if hci else None` is an IfExp wrapping the Call. A classifier that
    understands only a bare Call returns UNKNOWN here, the pair never forms, and the real defect is
    invisible while two builtins get reported instead. This is the plant that separates a detector
    from its tuning."""
    root = _tree(tmp_path, {
        "core.py": "def consumer(target):\n    return target\n\ndef derive(h):\n    return h\n",
        "a.py": "from core import consumer, derive\n\ndef go(h):\n    return consumer(derive(h) if h else None)\n",
        "b.py": "from core import consumer\n\ndef go(cfg):\n    return consumer(cfg.get('target'))\n",
    })
    rows = find_unwired.scan(root)["divergent_provenance"]
    hit = [r for r in rows if r["consumer"] == "consumer"]
    assert len(hit) == 1, "the IfExp-wrapped derivation must still read as CALL:derive — " + repr(rows)
    assert "CALL:derive" in {p["kind"] for p in hit[0]["provenances"]}


def test_PLANT_two_callers_that_BOTH_read_config_are_NOT_flagged(tmp_path):
    """§4.1: a config read is often CORRECT (the CPAP's `ble_stream.adapter` is legitimately
    configured). The rule survives only by flagging DIVERGENCE between callers; "config reads are
    suspect" convicts working code."""
    root = _tree(tmp_path, {
        "core.py": "def consumer(target):\n    return target\n",
        "a.py": "from core import consumer\n\ndef go(cfg):\n    return consumer(cfg.get('target'))\n",
        "b.py": "from core import consumer\n\ndef go(other):\n    return consumer(other['target'])\n",
    })
    rows = find_unwired.scan(root)["divergent_provenance"]
    assert [r for r in rows if r["consumer"] == "consumer"] == [], rows


def test_PLANT_a_BUILTIN_consumer_is_never_a_finding(tmp_path):
    """The probe's first version reported `sleep` and `str`. A consumer that is not DEFINED in the
    scanned tree has no adoption story to tell — its callers are not a population this scan owns."""
    root = _tree(tmp_path, {
        "a.py": "def derive(h):\n    return h\n\ndef go(h):\n    return str(derive(h))\n",
        "b.py": "def go(cfg):\n    return str(cfg.get('x'))\n",
    })
    rows = find_unwired.scan(root)["divergent_provenance"]
    assert [r for r in rows if r["consumer"] == "str"] == [], rows


def test_scan7_reports_its_own_population_beside_the_count(tmp_path):
    """A '0 flagged' over an unnamed population is the examined-nothing shape one level up — the
    tool's own scan 1 learned this on STATUS["radio_distress"]. Files, consumers with >=2 callers,
    and argument slots examined all travel with the result."""
    root = _tree(tmp_path, {
        "core.py": "def consumer(target):\n    return target\n",
        "a.py": "from core import consumer\n\ndef go(cfg):\n    return consumer(cfg.get('target'))\n",
        "b.py": "from core import consumer\n\ndef go(other):\n    return consumer(other['target'])\n",
    })
    pop = find_unwired.scan(root)["examined_provenance"]
    assert pop["files"] == 3
    assert pop["consumers_with_2plus_callers"] == 1
    assert pop["slots"] >= 1


def test_PLANT_the_REAL_defect_shape_provenance_is_ONE_ASSIGNMENT_UPSTREAM(tmp_path):
    """The actual `_usb_rebind` sites are `_usb_rebind(str(_cp_usb))` and `_usb_rebind(str(_usb))` —
    both read `CALL:str` at the call. The derivation (`adapter_usb_id(hci) if hci else None`) and the
    config read (`wcfg.get("usb_path")`) are the ASSIGNMENTS one line up. A call-site-only classifier
    is blind to the very instance it was tuned against, and the first four plants could not see that
    because they put the derivation inline. Added after pointing the scan at real source and finding
    the known defect absent from the flags — which is the §4.2 failure happening to THIS detector."""
    root = _tree(tmp_path, {
        "core.py": "def consumer(target):\n    return target\n\ndef derive(h):\n    return h\n",
        "a.py": ("from core import consumer, derive\n\n"
                 "def go(h):\n    x = derive(h) if h else None\n    return consumer(str(x))\n"),
        "b.py": ("from core import consumer\n\n"
                 "def go(cfg):\n    y = cfg.get('target')\n    return consumer(str(y))\n"),
    })
    rows = find_unwired.scan(root)["divergent_provenance"]
    hit = [r for r in rows if r["consumer"] == "consumer"]
    assert len(hit) == 1, "the upstream assignment must be resolved — " + repr(rows)
    assert "CALL:derive" in {p["kind"] for p in hit[0]["provenances"]}


def test_PLANT_a_BUILTIN_wrapper_like_str_or_len_is_TRANSPARENT_not_a_mechanism(tmp_path):
    """`emit(..., len(x))` vs `emit(..., cfg["k"])` flagged on real source: `len` is a builtin, not a
    mechanism anyone could have failed to adopt. Only a call to a function DEFINED in the tree is a
    derivation provenance; a builtin wrapper is unwrapped to its argument."""
    root = _tree(tmp_path, {
        "core.py": "def consumer(n):\n    return n\n",
        "a.py": "from core import consumer\n\ndef go(xs):\n    return consumer(len(xs))\n",
        "b.py": "from core import consumer\n\ndef go(cfg):\n    return consumer(cfg['n'])\n",
    })
    rows = find_unwired.scan(root)["divergent_provenance"]
    assert [r for r in rows if r["consumer"] == "consumer"] == [], rows


def test_PLANT_a_METHOD_that_shares_a_name_with_dict_get_is_not_conflated(tmp_path):
    """`get`, `join`, `write` all flagged on real source: some class defines a method by that name, and
    a name-only match then claims every `wcfg.get(...)` and `"".join(...)` in the tree as a call to it.
    Same-name-two-populations. A call is a consumer site only when the callee is a bare Name or a
    `self.` method — a foreign receiver is a foreign method."""
    root = _tree(tmp_path, {
        "core.py": "class Store:\n    def get(self, k):\n        return k\n",
        "a.py": "def go(cfg, d):\n    return d.get(derive(cfg))\n\ndef derive(c):\n    return c\n",
        "b.py": "def go(cfg, d):\n    return d.get(cfg['k'])\n",
    })
    rows = find_unwired.scan(root)["divergent_provenance"]
    assert [r for r in rows if r["consumer"] == "get"] == [], rows


def test_PLANT_a_name_resolves_to_the_assignment_BEFORE_the_call_never_its_own_reassignment(tmp_path):
    """`share = _abs_path(share, ...)`: last-assignment-wins resolved `share` to the line that CALLS
    the consumer, so the config value arriving at `_abs_path` read as derived BY `_abs_path`. Two
    real consumers flagged on that one line. The assignment must precede the call."""
    root = _tree(tmp_path, {
        "a.py": "def norm(x):\n    return x\n\ndef f(t):\n    s = t.get('share')\n    s = norm(s)\n    return s\n",
        "b.py": "from a import norm\ndef g(t):\n    return norm(t['share'])\n",
    })
    rows = find_unwired.scan(root)["divergent_provenance"]
    assert [r["consumer"] for r in rows] == []


def test_PLANT_a_PARAMETER_does_not_inherit_an_assignment_from_ANOTHER_function(tmp_path):
    """`resolve_cpap_dir(..., root)` where `root` is a parameter: the module scope was built with
    `ast.walk(tree)`, which descends into every function, so `main()`'s `root = cfg["root"]` leaked
    into a function that never assigned `root` at all. Scope is the enclosing function plus the
    module's TOP-LEVEL statements — nothing else."""
    root = _tree(tmp_path, {
        "a.py": ("def derive(c):\n    return c\n\ndef consumer(v):\n    return v\n\n"
                 "def main(cfg):\n    root = cfg['root']\n    return root\n\n"
                 "def f(root):\n    return consumer(root)\n\n"
                 "def g(cfg, p):\n    return consumer(derive(cfg))\n"),
    })
    rows = find_unwired.scan(root)["divergent_provenance"]
    assert [r["consumer"] for r in rows] == []


def test_PLANT_a_SUBSCRIPT_target_is_tracked_like_a_name(tmp_path):
    """`out["mountpoint"] = _abs_path(t.get(...))` then `_under_allowed_root(out["mountpoint"])`: the
    second line is a string-keyed subscript and read as CONFIG, while the sibling caller passes
    `mp = _abs_path(...)` — the SAME normalisation, once through a dict slot. Both derived ⇒ silent."""
    root = _tree(tmp_path, {
        "a.py": ("def norm(x):\n    return x\n\ndef consumer(v):\n    return v\n\n"
                 "def f(t):\n    out = {}\n    out['mp'] = norm(t.get('mp'))\n    return consumer(out['mp'])\n\n"
                 "def g(t):\n    mp = norm(t['mp'])\n    return consumer(mp)\n"),
    })
    rows = find_unwired.scan(root)["divergent_provenance"]
    assert [r["consumer"] for r in rows] == []


def test_PLANT_two_MODULES_defining_the_same_function_name_are_TWO_consumers(tmp_path):
    """`build_id.probe` and `probe_polar_onboard.probe`: a tree-wide name set fused every bare
    `probe(...)` in the tree into one consumer and compared their arguments. A bare-name call reaches
    the function its OWN module defines or imports by name; `probe` in one file and `probe` in
    another are different populations."""
    root = _tree(tmp_path, {
        "a.py": "def derive(h):\n    return h\n\ndef probe(x):\n    return x\n\ndef f(h):\n    return probe(derive(h))\n",
        "b.py": "def probe(y):\n    return y\n\ndef g(cfg):\n    return probe(cfg['hci'])\n\ndef h(cfg):\n    return probe(cfg.get('hci'))\n",
    })
    rows = find_unwired.scan(root)["divergent_provenance"]
    assert [r["consumer"] for r in rows] == []


def test_PLANT_an_IMPORTED_consumer_is_the_same_population_as_its_home_module(tmp_path):
    """The positive twin of the module-split plant: `from a import consumer` in b.py IS a.py's
    consumer, so a derived argument in a.py against a config read in b.py still forms the pair."""
    root = _tree(tmp_path, {
        "a.py": "def derive(h):\n    return h\n\ndef consumer(x):\n    return x\n\ndef f(h):\n    return consumer(derive(h))\n",
        "b.py": "from a import consumer\ndef g(cfg):\n    return consumer(cfg.get('hci'))\n",
    })
    rows = find_unwired.scan(root)["divergent_provenance"]
    assert [r["consumer"] for r in rows] == ["consumer"]
    assert {p["kind"] for p in rows[0]["provenances"]} == {"CALL:derive", "CONFIG"}


def test_scan7_a_FLAGGED_row_prints_every_provenance_and_the_exit_stays_0(tmp_path, monkeypatch, capsys):
    """Advisory means: the row is PRINTED with each caller's provenance and line, it is counted as
    flagged, and `main` still returns 0 — it is deliberately not in the `--check` sum until an FP rate
    exists on more than one true positive."""
    root = _tree(tmp_path, {
        "a.py": "def derive(h):\n    return h\n\ndef consumer(x):\n    return x\n\ndef f(h):\n    return consumer(derive(h))\n",
        "b.py": "from a import consumer\ndef g(cfg):\n    return consumer(cfg.get('hci'))\n",
    })
    monkeypatch.setattr(find_unwired, "HERE", root)
    assert find_unwired.main([]) == 0
    out = capsys.readouterr().out
    assert "   consumer  slot 0" in out
    assert "CALL:derive" in out and "CONFIG" in out and "b.py:3" in out
    assert "1 flagged, 0 allowed" in out
    assert "reason:" not in out


# ── a spent entry NAMES the file that un-orphaned it (residue 2026-09-06-find-unwired-prose-unorphans) ──
def test_a_spent_ALLOW_FUNCS_entry_names_the_file_whose_bare_name_match_un_orphaned_it(tmp_path, monkeypatch, capsys):
    """THE ROW'S OWN SHAPE. `prune` is unwired and allowlisted. A shell helper then gains a log line
    whose STRING happens to contain the word — a `.sh` file keeps its strings in the corpus on purpose
    (a helper that calls a function through `python3 -c "…"` does wire it). The bare-name match
    un-orphans `prune`, the entry reads as spent, and before this the report named nothing the author
    had touched: an hour of bisecting for a word in a log line. Now it names the file."""
    root = _tree(tmp_path, {
        "m.py": "def prune():\n    return 1\n",
        "helper.sh": 'echo "about to prune old nights"\n',
    })
    monkeypatch.setattr(find_unwired, "HERE", root)
    monkeypatch.setitem(find_unwired.ALLOW_FUNCS, "prune", "synthetic: nothing calls it yet")
    res = find_unwired.scan(root)
    stale = [r for r in res["stale_allowlist"] if r["name"] == "prune"]
    assert stale and stale[0]["where"] == ["helper.sh"], res["stale_allowlist"]
    find_unwired.main([])
    out = capsys.readouterr().out
    assert "un-orphaned by a bare-name match in: helper.sh" in out


def test_the_where_list_excludes_the_defining_file_and_is_empty_for_other_lists(tmp_path, monkeypatch):
    """The definition is not a use, so the defining module must not be named as the culprit; and the
    diagnostic is specific to ALLOW_FUNCS — the other lists judge by other populations."""
    root = _tree(tmp_path, {
        "m.py": "def prune():\n    return 1\n",
        "other.py": "def g():\n    return prune\n",
        # a WIRED status key with a spent ALLOW_KEYS entry: the diagnostic must stay empty for it
        "capture.py": 'def f():\n    _set(name, wired_key=1)\n',
        "webmon.py": 'x = st.get("wired_key")\n',
    })
    monkeypatch.setattr(find_unwired, "HERE", root)
    monkeypatch.setitem(find_unwired.ALLOW_FUNCS, "prune", "synthetic")
    monkeypatch.setitem(find_unwired.ALLOW_KEYS, "wired_key", "synthetic")
    res = find_unwired.scan(root)
    stale = {(r["list"], r["name"]): r for r in res["stale_allowlist"]}
    assert stale[("ALLOW_FUNCS", "prune")]["where"] == ["other.py"]
    assert ("ALLOW_KEYS", "wired_key") in stale, "the control entry was not judged spent — the assertion below would be vacuous"
    assert stale[("ALLOW_KEYS", "wired_key")]["where"] == []


# ── the interpreter floor (residue 2026-09-25-find-unwired-verdict-depends-on-the-interpreter-version)
def test_the_floor_is_PEP_701_and_the_helper_is_pure():
    """3.11 tokenizes an f-string as ONE STRING token, so `_code_only` strips a call made inside one and
    the function reads as an orphan; 3.12+ tokenizes the `{…}` parts as code. The helper is pure so
    both sides of the floor are exercised whatever interpreter runs the suite."""
    assert find_unwired.PY_FLOOR == (3, 12)
    assert find_unwired.interpreter_floor_reason((3, 12, 0, "final", 0)) is None
    assert find_unwired.interpreter_floor_reason((3, 13, 11, "final", 0)) is None
    why = find_unwired.interpreter_floor_reason((3, 11, 15, "final", 0))
    assert why and "3.11" in why and "3.12" in why and "f-string" in why, why


def test_main_REFUSES_below_the_floor_with_exit_2_and_never_scans(monkeypatch, capsys):
    """A refusal, not a verdict: exit 2 (the tree-wide 'could not examine' code, distinct from --check's
    1), the reason printed, and `scan()` never reached — in EVERY mode, because a `--json` dump from a
    blind tokenizer is as wrong as a gate verdict from one."""
    monkeypatch.setattr(find_unwired, "interpreter_floor_reason", lambda vi: "too old (planted reason)")

    def must_not_scan(*a, **k):
        raise AssertionError("scan() ran under a refused interpreter")

    monkeypatch.setattr(find_unwired, "scan", must_not_scan)
    for argv in ([], ["--json"], ["--check"]):
        assert find_unwired.main(argv) == 2, argv
        assert "REFUSING" in capsys.readouterr().out, argv


def test_main_passes_the_REAL_version_to_the_floor_check(monkeypatch):
    """The guard reads `sys.version_info`, not a constant: patch the helper to record what it was
    handed and assert it is the running interpreter's tuple (the seam a stub could otherwise hide)."""
    seen = []

    def record(vi):
        seen.append(tuple(vi[:2]))
        return "refuse"

    monkeypatch.setattr(find_unwired, "interpreter_floor_reason", record)
    assert find_unwired.main([]) == 2
    assert seen == [tuple(sys.version_info[:2])]
