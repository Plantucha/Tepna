# tepna-capture — tests/test_mmeta.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# mmeta reads mutmut's meta to close the mutation gate's two proven blind spots
# (OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS §2, §3). Each control below reproduces the ACTUAL failure
# signal — a crash's all-null meta, a test-tree change — and asserts the detector sees it, per the
# brief's rule: run it against the real failure before believing it.
import json

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
    a.write_text(json.dumps({"other": 1}), encoding="utf-8")            # dict, no exit_code_by_key
    assert mmeta.read_exit_codes(a) == {}
    b = tmp_path / "b.meta"
    b.write_text(json.dumps([1, 2, 3]), encoding="utf-8")              # not a dict at all
    assert mmeta.read_exit_codes(b) == {}
    c = tmp_path / "c.meta"
    c.write_text(json.dumps({"exit_code_by_key": [1]}), encoding="utf-8")  # key present, wrong type
    assert mmeta.read_exit_codes(c) == {}


# ── §3: tested_count — the whole crashed-vs-clean discrimination, end to end ───────────────────────────
def test_tested_count_is_zero_for_a_crashed_glob_and_positive_for_a_clean_one(tmp_path):
    """The §3 verdict as the driver consumes it: a crash's all-null meta scores 0 (refuse), a real run's
    decided meta scores its mutants (proceed). Same module, opposite verdict — the discrimination."""
    crashed = _meta(tmp_path / "crashed", "oxy_transfer.py",
                    {"oxy_transfer.x_select__mutmut_1": None})
    assert mmeta.tested_count(crashed, "oxy_transfer.py", "oxy_transfer.x_select__mutmut_*") == 0
    clean = _meta(tmp_path / "clean", "oxy_transfer.py",
                  {"oxy_transfer.x_select__mutmut_1": 33, "oxy_transfer.x_select__mutmut_2": 37})
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
_MUTSRC = (
    "def x_a__mutmut_1():\n    pass\n"
    "def x_a__mutmut_2():\n    pass\n"
    "def x_b__mutmut_1():\n    pass\n"
)


def test_generated_counts_a_functions_own_mutants():
    assert mmeta.generated_under_glob(_MUTSRC, "m.x_a__mutmut_*") == 2


def test_generated_does_not_bleed_across_functions():
    assert mmeta.generated_under_glob(_MUTSRC, "m.x_b__mutmut_*") == 1


def test_a_function_with_no_mutable_operator_generates_zero():
    """THE false-red case — benign, and must be distinguishable from a crash."""
    assert mmeta.generated_under_glob(_MUTSRC, "m.x_identity__mutmut_*") == 0


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
        json.dumps({"exit_code_by_key": {"m.x_a__mutmut_1": 1, "m.x_a__mutmut_2": None,
                                         "m.x_b__mutmut_1": None}}), encoding="utf-8")
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


# ── §2: refresh_results_if_tests_changed — invalidate only what tests can invalidate ──────────────────
def test_first_run_with_no_stamp_invalidates_and_stamps(tmp_path):
    """⚠️ THE §2 CONTROL, first half. A reused scratch with no prior test-stamp cannot know its cached
    exit codes match the current tests — so it invalidates and records the hash for next time."""
    work = _meta(tmp_path, "oxy_transfer.py", {"oxy_transfer.x_select__mutmut_1": 33})
    stamp = tmp_path / ".tests-hash"
    tests = _tests(tmp_path, {"test_a.py": "def test_a(): pass\n"})
    assert mmeta.refresh_results_if_tests_changed(work, "oxy_transfer.py", tests, stamp) is True
    assert not (work / "mutants" / "oxy_transfer.py.meta").exists()   # results cleared → mutmut re-tests
    assert stamp.read_text().strip() == mmeta.test_tree_hash(tests)


def test_unchanged_tests_preserve_the_results_cache(tmp_path):
    """The reuse the cache exists for: same tests → the meta survives, so mutmut skips re-testing."""
    work = _meta(tmp_path, "oxy_transfer.py", {"oxy_transfer.x_select__mutmut_1": 33})
    stamp = tmp_path / ".tests-hash"
    tests = _tests(tmp_path, {"test_a.py": "def test_a(): pass\n"})
    stamp.write_text(mmeta.test_tree_hash(tests), encoding="utf-8")
    assert mmeta.refresh_results_if_tests_changed(work, "oxy_transfer.py", tests, stamp) is False
    assert (work / "mutants" / "oxy_transfer.py.meta").exists()       # kept — full reuse


def test_adding_a_KILLER_invalidates_so_the_FIRST_next_run_is_correct(tmp_path):
    """⚠️ THE §2 CONTROL, the proven defect itself. Source unchanged, a killer test ADDED → the cached
    verdict is stale, so it MUST be invalidated. Without this the added killer is uncredited on the first
    run — the exact self-destructing bug the brief measured."""
    work = _meta(tmp_path, "oxy_transfer.py", {"oxy_transfer.x_select__mutmut_1": 33})
    stamp = tmp_path / ".tests-hash"
    tests = _tests(tmp_path, {"test_a.py": "def test_a(): pass\n"})
    stamp.write_text(mmeta.test_tree_hash(tests), encoding="utf-8")   # state B: last run's tests
    (tests / "test_killer.py").write_text("def test_kills_it(): assert True\n", encoding="utf-8")
    assert mmeta.refresh_results_if_tests_changed(work, "oxy_transfer.py", tests, stamp) is True
    assert not (work / "mutants" / "oxy_transfer.py.meta").exists()


def test_invalidation_is_safe_when_the_meta_is_already_absent(tmp_path):
    work = tmp_path
    (work / "mutants").mkdir()
    stamp = tmp_path / ".tests-hash"
    tests = _tests(tmp_path, {"test_a.py": "def test_a(): pass\n"})
    # no meta written — unlink(missing_ok=True) must not raise
    assert mmeta.refresh_results_if_tests_changed(work, "oxy_transfer.py", tests, stamp) is True
