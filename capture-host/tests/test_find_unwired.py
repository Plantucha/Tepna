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
    assert "busy_with" in allowed and "oxy_is_finalized" in allowed


def test_every_allowlisted_function_still_appears_in_the_report(capsys):
    """The count line must separate the two populations, so a growing allowlist is visible rather than
    quietly shrinking the finding list."""
    find_unwired.main([])
    out = capsys.readouterr().out
    assert "unexplained," in out and "allowed" in out
    for name in ("predict_step_split", "busy_with", "oxy_is_finalized"):
        assert name in out, f"{name} is allowlisted but absent from the report"
