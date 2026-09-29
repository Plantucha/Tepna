# tepna-capture — tests/test_mmeta.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# mmeta reads mutmut's meta to close the mutation gate's two proven blind spots
# (OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS §2, §3). Each control below reproduces the ACTUAL failure
# signal — a crash's all-null meta, a test-tree change — and asserts the detector sees it, per the
# brief's rule: run it against the real failure before believing it.
import json

import pytest

import mmeta


def _meta(tmp_path, module, codes):
    """Write a mutmut-shaped `<work>/mutants/<module>.meta` and return the work dir."""
    d = tmp_path / "mutants"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{module}.meta").write_text(json.dumps({"exit_code_by_key": codes}), encoding="utf-8")
    return tmp_path


# ── §3: decided_under_glob — the tested-vs-generated signal ───────────────────────────────────────────
def test_a_decided_mutant_under_the_glob_counts():
    codes = {"oxy_transfer.x_select__mutmut_1": 33, "oxy_transfer.x_select__mutmut_2": 37}
    assert mmeta.decided_under_glob(codes, "oxy_transfer.x_select__mutmut_*") == 2


def test_a_NULL_mutant_does_not_count_this_is_the_crash_signal():
    """⚠️ THE §3 CONTROL. A generated-but-never-tested mutant is null in the meta — exactly what a mutmut
    that crashed after generation leaves. Counting it would re-admit the false green being fixed."""
    codes = {"oxy_transfer.x_select__mutmut_1": None, "oxy_transfer.x_select__mutmut_2": None}
    assert mmeta.decided_under_glob(codes, "oxy_transfer.x_select__mutmut_*") == 0


def test_a_decided_mutant_outside_the_glob_does_not_count():
    codes = {"oxy_transfer.x_other__mutmut_1": 33}
    assert mmeta.decided_under_glob(codes, "oxy_transfer.x_select__mutmut_*") == 0


def test_an_empty_or_missing_map_counts_zero():
    assert mmeta.decided_under_glob({}, "m.x_f__mutmut_*") == 0
    assert mmeta.decided_under_glob(None, "m.x_f__mutmut_*") == 0


# ── read_exit_codes — absence and malformation are both "measured nothing" ────────────────────────────
def test_read_exit_codes_returns_the_map(tmp_path):
    work = _meta(tmp_path, "m.py", {"m.x_f__mutmut_1": 33})
    assert mmeta.read_exit_codes(work / "mutants" / "m.py.meta") == {"m.x_f__mutmut_1": 33}


def test_a_missing_meta_reads_as_empty(tmp_path):
    assert mmeta.read_exit_codes(tmp_path / "nope.meta") == {}


def test_a_malformed_meta_reads_as_empty(tmp_path):
    bad = tmp_path / "bad.meta"
    bad.write_text("{not json", encoding="utf-8")
    assert mmeta.read_exit_codes(bad) == {}


def test_a_meta_without_the_key_or_wrong_shape_reads_as_empty(tmp_path):
    a = tmp_path / "a.meta"
    a.write_text(json.dumps({"other": 1}), encoding="utf-8")  # dict, no exit_code_by_key
    assert mmeta.read_exit_codes(a) == {}
    b = tmp_path / "b.meta"
    b.write_text(json.dumps([1, 2, 3]), encoding="utf-8")  # not a dict at all
    assert mmeta.read_exit_codes(b) == {}
    c = tmp_path / "c.meta"
    c.write_text(json.dumps({"exit_code_by_key": [1]}), encoding="utf-8")  # key present, wrong type
    assert mmeta.read_exit_codes(c) == {}


# ── §3: tested_count — the whole crashed-vs-clean discrimination, end to end ───────────────────────────
def test_tested_count_is_zero_for_a_crashed_glob_and_positive_for_a_clean_one(tmp_path):
    """The §3 verdict as the driver consumes it: a crash's all-null meta scores 0 (refuse), a real run's
    decided meta scores its mutants (proceed). Same module, opposite verdict — the discrimination."""
    crashed = _meta(tmp_path / "crashed", "oxy_transfer.py", {"oxy_transfer.x_select__mutmut_1": None})
    assert mmeta.tested_count(crashed, "oxy_transfer.py", "oxy_transfer.x_select__mutmut_*") == 0
    clean = _meta(
        tmp_path / "clean",
        "oxy_transfer.py",
        {"oxy_transfer.x_select__mutmut_1": 33, "oxy_transfer.x_select__mutmut_2": 37},
    )
    assert mmeta.tested_count(clean, "oxy_transfer.py", "oxy_transfer.x_select__mutmut_*") == 2


# ── §2: test_tree_hash — moves iff the tests move ─────────────────────────────────────────────────────
def _tests(tmp_path, files):
    d = tmp_path / "tests"
    d.mkdir(parents=True, exist_ok=True)
    for name, body in files.items():
        (d / name).write_text(body, encoding="utf-8")
    return d


# ── §3b · generated vs decided: the benign zero must not read as a crash ──────────────────────────
# A function with no mutable operator generates NOTHING, and mutmut signals that by crashing. Refusing
# on it reds the safest diffs there are. Measured 2026-08-24 on oxy_inventory.identity: 138 mutants in
# the file, 0 under that glob, whole run refused at exit 2.
_MUTSRC = "def x_a__mutmut_1():\n    pass\ndef x_a__mutmut_2():\n    pass\ndef x_b__mutmut_1():\n    pass\n"


def test_generated_counts_a_functions_own_mutants():
    assert mmeta.generated_under_glob(_MUTSRC, "m.x_a__mutmut_*") == 2


def test_generated_does_not_bleed_across_functions():
    assert mmeta.generated_under_glob(_MUTSRC, "m.x_b__mutmut_*") == 1


def test_a_function_with_no_mutable_operator_generates_zero():
    """THE false-red case — benign, and must be distinguishable from a crash."""
    assert mmeta.generated_under_glob(_MUTSRC, "m.x_identity__mutmut_*") == 0


# ⚠️ EVERY FIXTURE ABOVE IS AT COLUMN 0, AND THAT IS WHY THE BUG BELOW SURVIVED FOR WEEKS.
# `generated_under_glob` was anchored `^def`, which only matches a module-level function. mutmut emits
# a METHOD's mutants INDENTED inside the class body, so the count came back 0 for every class method
# whose mutants really existed. Measured 2026-09-18 against real `mutate_file_contents` output:
#
#     Counter.scaled  (method)    2 mutants, indent 4   →  `^def` counted 0
#     module_level    (function)  3 mutants, indent 0   →  `^def` counted 3
#
# The consequence was worse than a miscount. The caller only consults this when `tested_count == 0`,
# to split "nothing to mutate" (benign, give `_ran` back, pass) from "generated but not tested" (a
# crash, refuse). At a constant 0 for methods, a genuine crash took the BENIGN arm — the guard built
# to prevent "a claim of coverage that does not exist" manufactured exactly that, for every method.
#
# The 2026-08-24 validating case, `oxy_inventory.identity`, is module-level: the one shape that passes.
# These fixtures are INDENTED on purpose. Do not "tidy" them to column 0 — that is the bug's blind spot.
_MUTSRC_METHOD = (
    "class C:\n"
    "    def xǁCǁscaled__mutmut_1(self):\n        pass\n"
    "    def xǁCǁscaled__mutmut_2(self):\n        pass\n"
    "    def xǁCǁother__mutmut_1(self):\n        pass\n"
)


def test_generated_counts_an_INDENTED_methods_mutants():
    """THE REGRESSION. Returned 0 under `^def` while two mutants sat in the file."""
    assert mmeta.generated_under_glob(_MUTSRC_METHOD, "m.xǁCǁscaled__mutmut_*") == 2


def test_generated_does_not_bleed_across_methods_of_one_class():
    assert mmeta.generated_under_glob(_MUTSRC_METHOD, "m.xǁCǁother__mutmut_*") == 1


def test_a_method_with_no_mutants_still_reads_zero():
    """The benign arm must survive the fix — widening the anchor must not invent mutants."""
    assert mmeta.generated_under_glob(_MUTSRC_METHOD, "m.xǁCǁabsent__mutmut_*") == 0


def test_module_level_counting_is_unchanged_by_the_wider_anchor():
    """Guards the fix itself: `^\\s*def` must not alter the shape that already worked."""
    assert mmeta.generated_under_glob(_MUTSRC, "m.x_a__mutmut_*") == 2
    assert mmeta.generated_under_glob(_MUTSRC, "m.x_b__mutmut_*") == 1


def test_a_missing_or_empty_mutants_file_generates_zero():
    assert mmeta.generated_under_glob("", "m.x_a__mutmut_*") == 0
    assert mmeta.generated_under_glob(None, "m.x_a__mutmut_*") == 0


def test_generated_count_reads_the_scratch(tmp_path):
    (tmp_path / "mutants").mkdir()
    (tmp_path / "mutants" / "m.py").write_text(_MUTSRC, encoding="utf-8")
    assert mmeta.generated_count(tmp_path, "m.py", "m.x_a__mutmut_*") == 2
    assert mmeta.generated_count(tmp_path, "m.py", "m.x_identity__mutmut_*") == 0


def test_generated_count_is_zero_when_the_mutants_file_is_absent(tmp_path):
    assert mmeta.generated_count(tmp_path, "absent.py", "m.x_a__mutmut_*") == 0


def test_the_three_way_split_is_exhaustive(tmp_path):
    """generated/decided together name exactly three states, and the pair is the whole decision."""
    (tmp_path / "mutants").mkdir()
    (tmp_path / "mutants" / "m.py").write_text(_MUTSRC, encoding="utf-8")
    (tmp_path / "mutants" / "m.py.meta").write_text(
        json.dumps({"exit_code_by_key": {"m.x_a__mutmut_1": 1, "m.x_a__mutmut_2": None, "m.x_b__mutmut_1": None}}),
        encoding="utf-8",
    )
    # covered — generated and at least one decided
    assert mmeta.generated_count(tmp_path, "m.py", "m.x_a__mutmut_*") > 0
    assert mmeta.tested_count(tmp_path, "m.py", "m.x_a__mutmut_*") > 0
    # the §3 crash — generated, none decided
    assert mmeta.generated_count(tmp_path, "m.py", "m.x_b__mutmut_*") > 0
    assert mmeta.tested_count(tmp_path, "m.py", "m.x_b__mutmut_*") == 0
    # benign — nothing generated, nothing decided
    assert mmeta.generated_count(tmp_path, "m.py", "m.x_identity__mutmut_*") == 0
    assert mmeta.tested_count(tmp_path, "m.py", "m.x_identity__mutmut_*") == 0


def test_test_tree_hash_is_stable_for_identical_content(tmp_path):
    a = _tests(tmp_path / "a", {"test_x.py": "def test_x(): assert True\n"})
    b = _tests(tmp_path / "b", {"test_x.py": "def test_x(): assert True\n"})
    assert mmeta.test_tree_hash(a) == mmeta.test_tree_hash(b)


def test_the_hash_width_is_pinned_at_16(tmp_path):
    """The hash is a stable content KEY; its WIDTH is part of that stability. Pins the [:16] truncation so
    a silent width change (which the diff-scoped gate flags as an unkilled mutant) cannot slip through —
    it would not break correctness today, but a widened key stamped into a scratch reads as a test change
    forever after, silently defeating §2's reuse. One line to prevent."""
    d = _tests(tmp_path, {"test_x.py": "def test_x(): pass\n"})
    assert len(mmeta.test_tree_hash(d)) == 16


def test_editing_a_test_changes_the_hash(tmp_path):
    d = _tests(tmp_path, {"test_x.py": "def test_x(): assert True\n"})
    before = mmeta.test_tree_hash(d)
    (d / "test_x.py").write_text("def test_x(): assert 1 == 1\n", encoding="utf-8")
    assert mmeta.test_tree_hash(d) != before


def test_adding_a_test_file_changes_the_hash(tmp_path):
    d = _tests(tmp_path, {"test_x.py": "def test_x(): pass\n"})
    before = mmeta.test_tree_hash(d)
    (d / "test_y.py").write_text("def test_y(): pass\n", encoding="utf-8")
    assert mmeta.test_tree_hash(d) != before


def test_pycache_is_ignored_by_the_hash(tmp_path):
    d = _tests(tmp_path, {"test_x.py": "def test_x(): pass\n"})
    before = mmeta.test_tree_hash(d)
    cache = d / "__pycache__"
    cache.mkdir()
    (cache / "test_x.cpython-313.py").write_text("garbage\n", encoding="utf-8")
    assert mmeta.test_tree_hash(d) == before


# ── §2: refresh_caches_if_tests_changed — invalidate only what tests can invalidate ──────────────────
def _meta_codes(work, module="oxy_transfer.py"):
    return mmeta.read_exit_codes(work / "mutants" / f"{module}.meta")


def test_first_run_with_no_stamp_invalidates_and_stamps(tmp_path):
    """⚠️ THE §2 CONTROL, first half. A reused scratch with no prior test-stamp cannot know its cached
    exit codes match the current tests — so it invalidates and records the hash for next time."""
    work = _meta(tmp_path, "oxy_transfer.py", {"oxy_transfer.x_select__mutmut_1": 33})
    stamp = tmp_path / ".tests-hash"
    tests = _tests(tmp_path, {"test_a.py": "def test_a(): pass\n"})
    assert mmeta.refresh_caches_if_tests_changed(work, "oxy_transfer.py", tests, stamp) is True
    assert _meta_codes(work) == {"oxy_transfer.x_select__mutmut_1": None}  # verdict nulled, key kept
    assert stamp.read_text().strip() == mmeta.test_tree_hash(tests)


def test_unchanged_tests_preserve_the_results_cache(tmp_path):
    """The reuse the cache exists for: same tests → the verdicts survive, so mutmut skips re-testing."""
    work = _meta(tmp_path, "oxy_transfer.py", {"oxy_transfer.x_select__mutmut_1": 33})
    stamp = tmp_path / ".tests-hash"
    tests = _tests(tmp_path, {"test_a.py": "def test_a(): pass\n"})
    stamp.write_text(mmeta.test_tree_hash(tests), encoding="utf-8")
    assert mmeta.refresh_caches_if_tests_changed(work, "oxy_transfer.py", tests, stamp) is False
    assert _meta_codes(work) == {"oxy_transfer.x_select__mutmut_1": 33}  # kept decided — full reuse


def test_adding_a_KILLER_invalidates_so_the_FIRST_next_run_is_correct(tmp_path):
    """⚠️ THE §2 CONTROL, the proven defect itself. Source unchanged, a killer test ADDED → the cached
    verdict is stale, so it MUST be invalidated. Without this the added killer is uncredited on the first
    run — the exact self-destructing bug the brief measured."""
    work = _meta(
        tmp_path, "oxy_transfer.py", {"oxy_transfer.x_select__mutmut_1": 33, "oxy_transfer.x_select__mutmut_2": 37}
    )
    stamp = tmp_path / ".tests-hash"
    tests = _tests(tmp_path, {"test_a.py": "def test_a(): pass\n"})
    stamp.write_text(mmeta.test_tree_hash(tests), encoding="utf-8")  # state B: last run's tests
    (tests / "test_killer.py").write_text("def test_kills_it(): assert True\n", encoding="utf-8")
    assert mmeta.refresh_caches_if_tests_changed(work, "oxy_transfer.py", tests, stamp) is True
    # ⚠️ THE RECOVERY PROPERTY the delete-the-file bug violated: the mutant KEYS survive (so mutmut's
    # --only filter still matches and it re-decides them) and only the VERDICTS are cleared to null. A
    # deleted meta strips the keys, and with the source unchanged mutmut skips regeneration and crashes.
    assert _meta_codes(work) == {"oxy_transfer.x_select__mutmut_1": None, "oxy_transfer.x_select__mutmut_2": None}
    assert mmeta.decided_under_glob(_meta_codes(work), "oxy_transfer.x_select__mutmut_*") == 0


def test_invalidation_is_safe_when_the_meta_is_already_absent(tmp_path):
    work = tmp_path
    (work / "mutants").mkdir()
    stamp = tmp_path / ".tests-hash"
    tests = _tests(tmp_path, {"test_a.py": "def test_a(): pass\n"})
    # no meta to null — must not raise, and the stamp still advances
    assert mmeta.refresh_caches_if_tests_changed(work, "oxy_transfer.py", tests, stamp) is True
    assert stamp.read_text().strip() == mmeta.test_tree_hash(tests)


def test_invalidation_of_an_unreadable_meta_does_not_raise(tmp_path):
    """A malformed meta cannot be nulled sensibly; invalidation must swallow it and still advance the
    stamp rather than crash the reuse path."""
    work = tmp_path
    (work / "mutants").mkdir()
    (work / "mutants" / "oxy_transfer.py.meta").write_text("{not json", encoding="utf-8")
    stamp = tmp_path / ".tests-hash"
    tests = _tests(tmp_path, {"test_a.py": "def test_a(): pass\n"})
    assert mmeta.refresh_caches_if_tests_changed(work, "oxy_transfer.py", tests, stamp) is True


def test_invalidation_of_a_meta_without_a_dict_of_codes_is_a_noop_but_stamps(tmp_path):
    """Valid JSON whose exit_code_by_key is absent or the wrong shape: nothing to null, but the stamp
    must still advance so the next run compares correctly."""
    work = tmp_path
    (work / "mutants").mkdir()
    (work / "mutants" / "oxy_transfer.py.meta").write_text(
        json.dumps({"exit_code_by_key": [1, 2]}), encoding="utf-8"
    )  # a list, not a dict
    stamp = tmp_path / ".tests-hash"
    tests = _tests(tmp_path, {"test_a.py": "def test_a(): pass\n"})
    assert mmeta.refresh_caches_if_tests_changed(work, "oxy_transfer.py", tests, stamp) is True
    assert stamp.read_text().strip() == mmeta.test_tree_hash(tests)


# ── `killed_under_glob` — MEASURED, so the verdict's self-consistency check has content ─────────────


def test_exit_1_and_3_are_both_kills_because_mutmut_says_so():
    """mutmut's `status_by_exit_code` maps 1 (failing suite) and 3 (internal pytest error) to "killed":
    either way the mutant changed behaviour enough that the suite could not complete cleanly."""
    codes = {"m.x_f__mutmut_1": 1, "m.x_f__mutmut_2": 3}
    assert mmeta.killed_under_glob(codes, "m.x_f__mutmut_*") == 2


def test_a_SURVIVOR_a_TIMEOUT_and_a_NOT_RUN_are_not_kills():
    """0 survived, 24 timeout, None never run. Counting any of them as killed is the false green this
    whole file exists to make impossible."""
    codes = {
        "m.x_f__mutmut_1": 0,
        "m.x_f__mutmut_2": 24,
        "m.x_f__mutmut_3": None,
        "m.x_f__mutmut_4": 5,
        "m.x_f__mutmut_5": 1,
    }
    assert mmeta.killed_under_glob(codes, "m.x_f__mutmut_*") == 1


def test_it_is_scoped_to_the_glob_like_its_siblings():
    codes = {"m.x_f__mutmut_1": 1, "m.x_other__mutmut_1": 1}
    assert mmeta.killed_under_glob(codes, "m.x_f__mutmut_*") == 1


def test_an_absent_or_empty_map_credits_nothing():
    assert mmeta.killed_under_glob({}, "m.x_f__mutmut_*") == 0
    assert mmeta.killed_under_glob(None, "m.x_f__mutmut_*") == 0


def test_killed_count_reads_the_scratchs_meta(tmp_path):
    (tmp_path / "mutants").mkdir()
    (tmp_path / "mutants" / "m.py.meta").write_text(
        '{"exit_code_by_key": {"m.x_f__mutmut_1": 1, "m.x_f__mutmut_2": 0}}', encoding="utf-8"
    )
    assert mmeta.killed_count(tmp_path, "m.py", "m.x_f__mutmut_*") == 1


def test_killed_NEVER_exceeds_decided_over_the_same_map():
    """The invariant `mutation_diff.result_inconsistency` relies on. If this could be violated the
    assertion downstream would fire on healthy runs."""
    codes = {f"m.x_f__mutmut_{i}": c for i, c in enumerate([1, 3, 0, 24, None, 1, 5])}
    g = "m.x_f__mutmut_*"
    assert mmeta.killed_under_glob(codes, g) <= mmeta.decided_under_glob(codes, g)


# ── §2b: the SELECTION is invalidated too (`2026-09-27-mutmut-stats-survive-test-invalidation`) ─────
#
# Nulling the exit codes alone made every mutant re-decide HONESTLY against a STALE selection, which is
# the worse failure: a test edited to kill a mutant is never chosen to run against it, and the mutant
# reads SURVIVED. Two paths put a map on disk without the edited test — a subprocess-only test registers
# no trampoline hit, and `collect_or_load_stats` re-traces only tests with NEW NAMES.


def _scratch_with_caches(tmp_path):
    work = tmp_path / "work"
    (work / "mutants").mkdir(parents=True)
    (work / "mutants" / "m.py.meta").write_text('{"exit_code_by_key": {"m.x_f__mutmut_1": 0}}', encoding="utf-8")
    (work / "mutants" / "mutmut-stats.json").write_text(
        '{"tests_by_mangled_function_name": {"m.x_f": ["tests/test_m.py::test_old"]}, "stats_time": 1.0}',
        encoding="utf-8",
    )
    tests = tmp_path / "tests"
    tests.mkdir()
    (tests / "test_m.py").write_text("def test_old():\n    assert True\n", encoding="utf-8")
    return work, tests, tmp_path / ".tests-hash"


def test_a_changed_test_tree_REMOVES_the_selection_so_mutmut_re_traces(tmp_path):
    """The stats file is UNLINKED, not rewritten: mutmut rebuilds it from a traced pass when it is
    absent, and any partial edit would be a guess about which associations are still true."""
    work, tests, stamp = _scratch_with_caches(tmp_path)
    assert mmeta.refresh_caches_if_tests_changed(work, "m.py", tests, stamp) is True
    assert not (work / "mutants" / "mutmut-stats.json").exists(), "a stale selection must not survive"


def test_EDITING_a_test_under_the_SAME_NAME_still_invalidates_the_selection(tmp_path):
    """The exact hole. mutmut's own incremental path re-traces only `ids - collected_test_names()`, a set
    difference on NAMES, so an edited test keeps its old associations forever. The tree HASH moves on a
    body change, which is why the stamp is the right trigger and the name list is not."""
    work, tests, stamp = _scratch_with_caches(tmp_path)
    mmeta.refresh_caches_if_tests_changed(work, "m.py", tests, stamp)
    (work / "mutants" / "mutmut-stats.json").write_text('{"tests_by_mangled_function_name": {}}', encoding="utf-8")
    # same test NAME, different body — the case mutmut cannot see
    (tests / "test_m.py").write_text("def test_old():\n    assert 1 + 1 == 2\n", encoding="utf-8")
    assert mmeta.refresh_caches_if_tests_changed(work, "m.py", tests, stamp) is True
    assert not (work / "mutants" / "mutmut-stats.json").exists()


def test_an_UNCHANGED_test_tree_leaves_BOTH_caches_alone(tmp_path):
    """The control. Re-collecting stats on every run would cost a traced pass for nothing, and nulling
    results would throw away a whole run's verdicts."""
    work, tests, stamp = _scratch_with_caches(tmp_path)
    mmeta.refresh_caches_if_tests_changed(work, "m.py", tests, stamp)
    (work / "mutants" / "mutmut-stats.json").write_text(
        '{"tests_by_mangled_function_name": {"m.x_f": ["a"]}}', encoding="utf-8"
    )
    (work / "mutants" / "m.py.meta").write_text('{"exit_code_by_key": {"m.x_f__mutmut_1": 1}}', encoding="utf-8")
    assert mmeta.refresh_caches_if_tests_changed(work, "m.py", tests, stamp) is False
    assert (work / "mutants" / "mutmut-stats.json").exists(), "an unchanged tree must keep its selection"
    assert '"m.x_f__mutmut_1": 1' in (work / "mutants" / "m.py.meta").read_text(), "and its results"


def test_an_ABSENT_stats_file_is_not_an_error(tmp_path):
    """First run in a fresh scratch: there is nothing to remove and that is the normal case."""
    work, tests, stamp = _scratch_with_caches(tmp_path)
    (work / "mutants" / "mutmut-stats.json").unlink()
    assert mmeta.refresh_caches_if_tests_changed(work, "m.py", tests, stamp) is True


# ⚠️ AND EVERY FIXTURE ABOVE IS SYNCHRONOUS, WHICH IS WHY THE SAME HOLE WAS STILL OPEN ONE SHAPE OVER.
# `^\s*def` matches whitespace before `def` and nothing else — but Python allows exactly one other
# thing there, the `async` keyword, and mutmut writes a coroutine's mutants as `async def`. Measured
# 2026-09-28 against a real scratch tree: `wifi_uplink._run` had 44 mutants in `mutants/wifi_uplink.py`
# and `generated_under_glob` returned 0.
#
# Same consequence as the method case, over a larger surface: 309 of capture-host's 1959 functions are
# async (47 of 64 in webmon.py, 85 in capture.py, all 10 of as11_pull.py), and for every one of them a
# genuine crash (generated >0, decided 0) took the benign "nothing to mutate, pass" arm. The §3 guard
# was disabled across the async surface of a daemon that is almost entirely async.
#
# Both fixes share one root, and it is the reason these fixtures exist in all four shapes rather than
# the one in front of the author: a pattern that cannot SEE a construct answered 0 for it — absence
# reported as a measurement, which is the §∅ failure in a counter.
_MUTSRC_ASYNC = (
    "async def x_run__mutmut_1():\n    pass\n"
    "async def x_run__mutmut_2():\n    pass\n"
    "async def x_run__mutmut_3():\n    pass\n"
    "def x_sync__mutmut_1():\n    pass\n"
)
_MUTSRC_ASYNC_METHOD = (
    "class C:\n"
    "    async def xǁCǁfetch__mutmut_1(self):\n        pass\n"
    "    async def xǁCǁfetch__mutmut_2(self):\n        pass\n"
    "    def xǁCǁparse__mutmut_1(self):\n        pass\n"
)


def test_generated_counts_an_ASYNC_functions_mutants():
    """THE REGRESSION, measured on wifi_uplink._run: 44 mutants in the file, 0 counted."""
    assert mmeta.generated_under_glob(_MUTSRC_ASYNC, "m.x_run__mutmut_*") == 3


def test_generated_counts_an_INDENTED_ASYNC_METHODS_mutants():
    """Both hole-shapes at once — the indent fix and the keyword fix have to hold together."""
    assert mmeta.generated_under_glob(_MUTSRC_ASYNC_METHOD, "m.xǁCǁfetch__mutmut_*") == 2


def test_sync_and_async_in_ONE_file_do_not_bleed_into_each_other():
    assert mmeta.generated_under_glob(_MUTSRC_ASYNC, "m.x_sync__mutmut_*") == 1
    assert mmeta.generated_under_glob(_MUTSRC_ASYNC_METHOD, "m.xǁCǁparse__mutmut_*") == 1


def test_an_ASYNC_function_with_no_mutants_still_reads_zero():
    """The benign arm again: widening for `async` must not invent a mutant that is not there."""
    assert mmeta.generated_under_glob(_MUTSRC_ASYNC, "m.x_absent__mutmut_*") == 0


def test_the_KEYWORD_is_what_widened_not_the_anchor():
    """`async` is the only token Python permits between the line start and `def`, so nothing else
    may slip through. A commented-out or textually-mentioned mutant is not a generated one."""
    assert mmeta.generated_under_glob("# async def x_run__mutmut_1():\n", "m.x_run__mutmut_*") == 0
    assert mmeta.generated_under_glob("asyncdef x_run__mutmut_1():\n", "m.x_run__mutmut_*") == 0
    assert mmeta.generated_under_glob("xasync def x_run__mutmut_1():\n", "m.x_run__mutmut_*") == 0


def test_the_three_sync_shapes_are_unchanged_by_the_async_widening():
    """Guards this fix the way `test_module_level_counting_is_unchanged_by_the_wider_anchor` guarded
    the last one: the shapes that already worked must count exactly as before."""
    assert mmeta.generated_under_glob(_MUTSRC, "m.x_a__mutmut_*") == 2
    assert mmeta.generated_under_glob(_MUTSRC, "m.x_b__mutmut_*") == 1
    assert mmeta.generated_under_glob(_MUTSRC_METHOD, "m.xǁCǁscaled__mutmut_*") == 2


# ── the glob's own shape ──────────────────────────────────────────────────────────────────────────
# `fn = stem.split(".", 1)[1] if "." in stem else stem` was UNOBSERVABLE: every glob carries exactly
# one dot, and on a one-dot string `split`, `rsplit`, maxsplit 2 and maxsplit-absent all agree, so
# three mutants of that line survived with no possible test to kill them. Recording them as equivalent
# would have preserved the real problem — on an unexpected shape the line picked a middle segment and
# the count silently came back 0, which is the identical failure this module was just fixed for.
def test_a_BARE_mangled_stem_with_no_module_qualifier_still_counts():
    """The dotless branch, which nothing exercised — `("." in stem) or True` survived on it."""
    assert mmeta.generated_under_glob(_MUTSRC, "x_a__mutmut_*") == 2
    assert mmeta.generated_under_glob(_MUTSRC_ASYNC, "x_run__mutmut_*") == 3


def test_a_glob_with_TWO_dots_is_REFUSED_not_guessed():
    """The shape the old line answered wrongly and silently. There is no correct segment to pick, and
    a wrong pick returns 0 — indistinguishable from "this function has no mutants"."""
    with pytest.raises(ValueError, match="exactly one dot"):
        mmeta.generated_under_glob(_MUTSRC, "pkg.m.x_a__mutmut_*")


def test_the_ONE_DOT_shape_that_is_actually_built_is_unchanged():
    """tools/mutate_diff.py builds `f"{stem_mod}.{s}__mutmut_*"` and nothing else does."""
    assert mmeta.generated_under_glob(_MUTSRC, "m.x_a__mutmut_*") == 2
    assert mmeta.generated_under_glob(_MUTSRC_METHOD, "m.xǁCǁscaled__mutmut_*") == 2
    assert mmeta.generated_under_glob(_MUTSRC_ASYNC_METHOD, "m.xǁCǁfetch__mutmut_*") == 2
