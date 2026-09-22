# tepna-capture — tests/test_mutation_scratch_reuse.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The mutation scratch is REUSED on the mutated module's hash alone. That is correct for the mutants
# (a pure function of that module) and blind to everything else the scratch holds — so before this was
# fixed, changing a sibling module, a shell script, a fixture or a data file did not move the key and
# did not get copied, and the run executed the NEW tests against the OLD sibling.
#
# The verdict could then be wrong in EITHER direction: a bug already fixed still reported, or a fresh
# one not seen. Measured 2026-09-07 on `night_report.py` — three consecutive runs reported a baseline
# failure that had already been fixed, byte-identical each time.
#
# These tests drive the refresh logic directly against a fake scratch rather than running mutmut: the
# defect is entirely in WHICH FILES get copied on the reuse path, and a real sweep is minutes per
# iteration. Each one is plant-verified — reverting the fix reds it.


import mutation_diff

_refresh = mutation_diff.refresh_scratch


def _fake_tree(root, *, module="target.py"):
    """A capture-host-shaped source tree: the mutated module, a sibling .py, a shell script and a
    fixture dir — the four shapes the scratch has to carry."""
    (root / module).write_text("def f():\n    return 1\n")
    (root / "sibling.py").write_text("VALUE = 'new'\n")
    (root / "tepna-report.sh").write_text("#!/bin/sh\necho new\n")
    (root / "tests").mkdir()
    (root / "tests" / "test_x.py").write_text("def test_x():\n    assert True\n")
    (root / "data").mkdir()
    (root / "data" / "fixture.json").write_text('{"v": "new"}\n')
    return root


def _stale_scratch(work, *, module="target.py"):
    """A scratch built from an OLDER tree: every sibling carries `old`, and `mutants/<module>` is the
    big generated mutant file that must survive the refresh untouched."""
    for sub in ("", "mutants"):
        d = work / sub if sub else work
        (d / "tests").mkdir(parents=True, exist_ok=True)
        (d / "data").mkdir(parents=True, exist_ok=True)
        (d / "sibling.py").write_text("VALUE = 'old'\n")
        (d / "tepna-report.sh").write_text("#!/bin/sh\necho old\n")
        (d / "tests" / "test_x.py").write_text("def test_x():\n    assert False\n")
        (d / "data" / "fixture.json").write_text('{"v": "old"}\n')
    (work / "mutants" / module).write_text("# GENERATED MUTANT — 835 KB in the real thing\n" * 50)
    return work


# `_refresh` is bound above to `mutation_diff.refresh_scratch` — THE function the tool calls, not a copy
# of it. The first version of these tests reimplemented the refresh loop here, and three of the four
# then passed with the defect planted back, because they were testing the reimplementation. A test that
# restates the code under test cannot fail with it.


def _extras(tree, module="target.py"):
    ignore = {".venv", "mutants", "__pycache__", ".coverage", "htmlcov", module}
    return sorted(p.name + ("/" if p.is_dir() else "")
                  for p in tree.iterdir()
                  if p.name not in ignore and not p.name.startswith(".coverage"))


def test_a_reused_scratch_refreshes_EVERY_sibling_not_only_tests(tmp_path):
    """The defect verbatim: a shell script and a data fixture changed in the tree, the mutated module
    untouched, so the cache key does not move. Before the fix only `tests/` was refreshed and the run
    read the OLD script."""
    src = tmp_path / "tree"; src.mkdir(); _fake_tree(src)
    work = tmp_path / "scratch" / "work"; (work / "mutants").mkdir(parents=True); _stale_scratch(work)

    n = _refresh(src, work, _extras(src))
    # The RETURN VALUE is published as `plan["refreshed_siblings"]`, so a wrong count is a wrong
    # report about what the run actually refreshed. Asserted here because the diff-scoped mutation
    # gate found it unkilled: every copy happened and nothing checked the tally.
    assert n == 2 * len(_extras(src)), "refreshed count must cover both work/ and work/mutants/"

    for sub in ("", "mutants"):
        d = work / sub if sub else work
        assert (d / "tepna-report.sh").read_text() == "#!/bin/sh\necho new\n", f"{sub or 'work'}: shell script stale"
        assert (d / "sibling.py").read_text() == "VALUE = 'new'\n", f"{sub or 'work'}: sibling module stale"
        assert (d / "data" / "fixture.json").read_text() == '{"v": "new"}\n', f"{sub or 'work'}: fixture stale"
        assert "assert True" in (d / "tests" / "test_x.py").read_text(), f"{sub or 'work'}: tests stale"


def test_the_refresh_does_NOT_clobber_the_generated_mutant(tmp_path):
    """`mutants/<module>` is mutmut's generated file — 835 KB against the original's 15 KB. It must
    survive, which is why the mutated module is absent from `extras` by construction. If a future edit
    puts it back in that list, this reds instead of silently destroying the reuse the cache exists for."""
    src = tmp_path / "tree"; src.mkdir(); _fake_tree(src)
    work = tmp_path / "scratch" / "work"; (work / "mutants").mkdir(parents=True); _stale_scratch(work)
    before = (work / "mutants" / "target.py").read_text()

    assert "target.py" not in _extras(src), "the mutated module must not be in the refresh list"
    _refresh(src, work, _extras(src))

    assert (work / "mutants" / "target.py").read_text() == before, "the generated mutant was overwritten"


def test_the_refresh_list_is_the_SAME_one_the_initial_copy_uses(tmp_path):
    """Reuse and creation must not drift about what a scratch contains — that drift IS the defect.
    Pinned by deriving both from one expression."""
    src = tmp_path / "tree"; src.mkdir(); _fake_tree(src)
    extras = _extras(src)
    assert set(extras) == {"sibling.py", "tepna-report.sh", "tests/", "data/"}
    assert all(e.endswith("/") == (src / e.rstrip("/")).is_dir() for e in extras)


def test_the_tool_delegates_to_the_in_floor_function_and_it_refreshes_everything():
    """`tools/mutate.py` is a dev script OUTSIDE the coverage floor; the decision about WHICH files a
    reused scratch carries lives in `mutation_diff` because it can give a wrong answer rather than
    failing loudly — the rule `tools/mutate.py`'s own header states. Pinned in both directions: the
    tool must delegate, and the delegate must refresh every sibling in BOTH trees."""
    import inspect
    import pathlib

    tool = pathlib.Path(__file__).resolve().parents[1] / "tools" / "mutate.py"
    src = tool.read_text()
    reuse = src[src.index("if reuse and ("):src.index('plan["reused_scratch"]')]
    assert "refresh_scratch(" in reuse, "the reuse path no longer refreshes the siblings"
    assert 'copytree(HERE / "tests"' not in reuse, "the tests-only refresh is back"

    body = inspect.getsource(mutation_diff.refresh_scratch)
    assert "for name in extras" in body
    assert '"mutants"' in body, "the mutants/ tree must be refreshed too, not only work/"


def test_the_refreshed_count_is_reported_per_tree(tmp_path):
    """`refresh_scratch` returns what it copied and the caller publishes it as
    `plan["refreshed_siblings"]`. Each sibling is copied into BOTH `work/` and `work/mutants/`, so the
    count is twice the sibling list — a tally that counted one tree would under-report a refresh that
    did happen, which is the kind of number a later reader would trust."""
    src = tmp_path / "tree"; src.mkdir(); _fake_tree(src)
    work = tmp_path / "scratch" / "work"; (work / "mutants").mkdir(parents=True); _stale_scratch(work)

    extras = _extras(src)
    assert len(extras) == 4                      # sibling.py, tepna-report.sh, tests/, data/
    assert _refresh(src, work, extras) == 8      # each one, into each of the two trees

    # and an empty list is an honest zero, not a crash or a silent full copy
    assert _refresh(src, work, []) == 0


# ── root reads: the file a test opens ABOVE capture-host/ (2026-09-19, #2675) ──────────────────────

def _tree_with_root_read(tmp_path, literal="ecgdex-dsp.js", *, make_root_file=True):
    """A repo shaped like ours: <root>/ecgdex-dsp.js beside <root>/capture-host/, and a test that names it."""
    root = tmp_path / "repo"; tree = root / "capture-host"; tree.mkdir(parents=True)
    _fake_tree(tree)
    if make_root_file:
        (root / "ecgdex-dsp.js").write_text("const ECG_RESYNC_BOUND_MS = 5000;\n")
    (root / "README.md").write_text("never named by a test\n")
    (root / "docs").mkdir()                       # a DIRECTORY whose name a test might mention
    (tree / "tests" / "test_parity.py").write_text(
        'import os\ndef test_p():\n    open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "%s")).read()\n' % literal)
    return root, tree


def test_root_reads_are_DERIVED_from_the_tests_never_listed(tmp_path):
    """A test naming a repo-root FILE is a root read; a root file nobody names is not; a directory
    name is not a read even when named. Keyed on what is read, not on the path idiom."""
    root, tree = _tree_with_root_read(tmp_path)
    (tree / "tests" / "test_mentions_dir.py").write_text('X = "docs"\n')
    assert mutation_diff.root_reads(tree) == ["ecgdex-dsp.js"]


def test_stage_root_reads_lands_the_file_where_BOTH_runs_resolve_it(tmp_path):
    """The mutants run executes work/mutants/tests/ → grandparent's parent is work/; the clean baseline
    executes work/tests/ → work/... Both must find the file, so it is copied to work/ AND work/.."""
    root, tree = _tree_with_root_read(tmp_path)
    scratch = tmp_path / "scratch"; work = scratch / "work"; (work / "mutants" / "tests").mkdir(parents=True)
    n = mutation_diff.stage_root_reads(tree, work, mutation_diff.root_reads(tree))
    assert n == 2
    assert (work / "ecgdex-dsp.js").read_text() == "const ECG_RESYNC_BOUND_MS = 5000;\n"
    assert (scratch / "ecgdex-dsp.js").read_text() == "const ECG_RESYNC_BOUND_MS = 5000;\n"
    # and the read as the parity test spells it resolves from BOTH test locations
    import os
    for tests_dir in (work / "mutants" / "tests", work / "tests"):
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(tests_dir / "test_parity.py"))), "..", "ecgdex-dsp.js")
        assert os.path.isfile(p), p


def test_a_named_root_file_that_does_not_exist_is_skipped_not_fabricated(tmp_path):
    root, tree = _tree_with_root_read(tmp_path, make_root_file=False)
    assert mutation_diff.root_reads(tree) == []          # not a file in the root ⇒ not a read
    work = tmp_path / "s" / "work"; work.mkdir(parents=True)
    assert mutation_diff.stage_root_reads(tree, work, ["ecgdex-dsp.js"]) == 0
    assert not (work / "ecgdex-dsp.js").exists()


def _tree_with_subdir_read_via_helper(tmp_path):
    """The shape that broke #2864, in miniature: the fixture lives in a SUBDIRECTORY of the root, and
    the path is named by a HELPER MODULE rather than by a test file."""
    root = tmp_path / "repo"; tree = root / "capture-host"; tree.mkdir(parents=True)
    _fake_tree(tree)
    (root / "uploads").mkdir()
    (root / "uploads" / "synthetic_ecgdex_h10.txt").write_text("t,v\n0,1\n")
    # the path is spelled in a HELPER, never in a test — test_seal.py calls V.stage_night(...)
    (tree / "tests" / "vectors.py").write_text('FIXTURE = "uploads/synthetic_ecgdex_h10.txt"\n')
    (tree / "tests" / "test_seal_like.py").write_text("import vectors\ndef test_s():\n    open(vectors.FIXTURE).read()\n")
    return root, tree


def test_root_reads_sees_a_SUBDIRECTORY_fixture_named_by_a_HELPER(tmp_path):
    """⚠️ THE PLANT FOR #2864, and it fails against the pre-fix implementation on BOTH legs.

    `root_reads` used to build its candidate set from `root.iterdir()` filtered by `p.is_file()` —
    repo-root REGULAR FILES only — and to scan `tests/*.py` alone. The read that broke #2864 is
    `uploads/synthetic_ecgdex_h10.txt`: inside a DIRECTORY, so no spelling could ever match the
    candidate set, and named in `tests/vectors.py`, a HELPER, so a directory-aware version keyed on
    test files would still have missed it. Either miss alone is fatal — the fixture is absent from the
    scratch, the test ERRORS at setup, `-x` aborts collection, and five globs record 0 tested mutants.

    The docstring claimed "copy EVERYTHING a test reads from disk" and "keyed on WHAT is read, not on
    how the path is spelled". Both were broader than the code, which was keyed on a literal, in a test
    file, naming a root-level regular file — three conjunctive conditions presented as one rule."""
    root, tree = _tree_with_subdir_read_via_helper(tmp_path)
    got = mutation_diff.root_reads(tree)
    assert "uploads/synthetic_ecgdex_h10.txt" in got, got


def test_root_reads_stages_a_SUBDIRECTORY_read_into_both_run_locations(tmp_path):
    """A path-shaped read must land under its own subdirectory in BOTH places, or the copy is as
    absent as no copy at all."""
    root, tree = _tree_with_subdir_read_via_helper(tmp_path)
    scratch = tmp_path / "scratch"; work = scratch / "work"; (work / "mutants" / "tests").mkdir(parents=True)
    n = mutation_diff.stage_root_reads(tree, work, mutation_diff.root_reads(tree))
    assert n == 2, n
    assert (work / "uploads" / "synthetic_ecgdex_h10.txt").read_text() == "t,v\n0,1\n"
    assert (scratch / "uploads" / "synthetic_ecgdex_h10.txt").read_text() == "t,v\n0,1\n"


def test_root_reads_refuses_to_escape_the_root(tmp_path):
    """Widening from NAMES to PATHS widens what a literal can reach, so the bound is explicit: an
    absolute path and a `..` traversal are never candidates, however they are spelled."""
    root, tree = _tree_with_subdir_read_via_helper(tmp_path)
    (tree / "tests" / "test_escape.py").write_text(
        'A = "/etc/passwd"\nB = "../../outside.txt"\nC = "uploads/../uploads/synthetic_ecgdex_h10.txt"\n'
    )
    got = mutation_diff.root_reads(tree)
    assert not any(g.startswith("/") or ".." in g for g in got), got


def test_root_reads_sees_a_PARTS_BUILT_path_through_its_unique_BASENAME(tmp_path):
    """⚠️ THE REAL #2864 SHAPE, and the one a path-matching rule still misses.

    `tools/seal_vectors.py` builds the read from PARTS — `UPLOADS = join(dirname(HERE), "uploads")`,
    then `join(UPLOADS, n)` with `n = "synthetic_ecgdex_h10.txt"`. The full path
    `uploads/synthetic_ecgdex_h10.txt` is a literal NOWHERE in the repo, so widening from NAMES to
    PATHS does not find it either: only the BASENAME is ever written down. It is enough when it is
    unique in the tree, which is what this asserts."""
    root = tmp_path / "repo"; tree = root / "capture-host"; tree.mkdir(parents=True)
    _fake_tree(tree)
    (root / "uploads").mkdir()
    (root / "uploads" / "synthetic_ecgdex_h10.txt").write_text("t,v\n0,1\n")
    (tree / "tools").mkdir(exist_ok=True)
    (tree / "tools" / "seal_vectors_like.py").write_text(
        'import os\nUP = os.path.join(os.path.dirname(HERE), "uploads")\nN = ("synthetic_ecgdex_h10.txt",)\n'
    )
    got = mutation_diff.root_reads(tree)
    assert "uploads/synthetic_ecgdex_h10.txt" in got, got


def test_root_reads_refuses_an_AMBIGUOUS_basename(tmp_path):
    """Staging the WRONG file is worse than staging none, so a basename in two places is not a read.

    The index is built from unique basenames only; `_subdir_index` returns the dropped names so the
    miss is a named set rather than a silence — the distinction this whole family turns on."""
    root = tmp_path / "repo"; tree = root / "capture-host"; tree.mkdir(parents=True)
    _fake_tree(tree)
    for d in ("docs", "papers"):
        (root / d).mkdir(); (root / d / "NOTES.md").write_text(d)
    # a DOT directory and node_modules are pruned from the index — `.git` is the reason the
    # root-level rule excludes dotfiles, and the same exclusion has to hold one level down
    (root / ".hidden").mkdir(); (root / ".hidden" / "secret.txt").write_text("x")
    (root / "node_modules").mkdir(); (root / "node_modules" / "vendored.txt").write_text("x")
    (tree / "tests" / "test_names_hidden.py").write_text('A = "secret.txt"\nB = "vendored.txt"\n')
    (tree / "tests" / "test_names_it.py").write_text('X = "NOTES.md"\n')
    got = mutation_diff.root_reads(tree)
    assert not any(g.endswith("NOTES.md") for g in got), got
    _index, dups = mutation_diff._subdir_index(root, tree.name)
    assert "NOTES.md" in dups, dups
    assert "secret.txt" not in _index and "vendored.txt" not in _index, sorted(_index)
    assert not any("hidden" in g or "node_modules" in g for g in got), got


def test_root_reads_never_raises_on_an_UNRESOLVABLE_literal(tmp_path):
    """A literal that cannot become a path at all is not a read — and must not be an exception.

    Widening from NAMES to PATHS means arbitrary string literals now reach the filesystem layer, so a
    literal the OS cannot even parse (an embedded NUL raises ValueError before any syscall) has to be
    skipped rather than crash the staging step. A `root_reads` that raises takes the whole mutation
    run down with it, which would be a worse failure than the miss this widening fixes."""
    root, tree = _tree_with_subdir_read_via_helper(tmp_path)
    (tree / "tests" / "test_junk.py").write_text('BAD = "up\x00loads/x.txt"\n')
    got = mutation_diff.root_reads(tree)                      # must not raise
    assert "uploads/synthetic_ecgdex_h10.txt" in got, got     # and the real read still lands
    assert not any("\x00" in g for g in got), got


def test_the_REAL_suite_has_exactly_the_root_reads_we_know_about():
    """Pinned as an EQUALITY so a change in the population is VISIBLE (a floor would not count it).
    Measured 2026-09-19: one real read — `ecgdex-dsp.js` (the seam-bound parity check) — plus four
    names tests merely MENTION as literals (over-flagged by design; each costs one small copy). If this
    changes, the scratch already carries the new file — the assertion exists so the author sees it.
    2026-09-20: two more real reads — `pat-feasibility.js` + `sensor-trio-power-analysis.js`, the
    Nights-page tripwire that reds the day a fused tool's classifier accepts a box filename.
    2026-09-21: `verdict.js` — a REAL read, from two suites: test_seal.py validates both sealed-night
    readers' verdict objects through the contract's own validator rather than a hand-written copy of its
    rules, and test_verdict cross-validates the Python half (verdict.py) against the same JS contract."""
    from pathlib import Path
    import pytest
    here = Path(__file__).resolve().parent.parent
    # Inside a mutation scratch `here` is work/ or work/mutants/, whose parent is the capture-host COPY —
    # a different "root" with a different population, so the pin would measure the scratch, not the
    # repo. Keyed on the directory NAME rather than a marker file: naming a root file here would stage
    # it (root_reads takes literals), which is exactly the circularity this test must not create.
    if here.name != "capture-host":
        pytest.skip("population pin is about the real checkout's root; this is a scratch copy")
    got = mutation_diff.root_reads(here)
    assert "ecgdex-dsp.js" in got                                 # the read that broke writers.py's lane
    assert not any(n.startswith(".") for n in got), got           # never a dotfile (`.git` is a FILE in a worktree)
    # 2026-09-22 (#2864): the population WIDENED from 8 to 21 when root_reads stopped being keyed on
    # a literal, in a test file, naming a root-level REGULAR FILE. Total staged: 5.3 MB, largest
    # 3.95 MB (tests/dex-tests.js) — measured, because over-flagging is only cheap while it is small.
    # The three `uploads/synthetic_*` entries are #2864's OWN read, reachable only by BASENAME:
    # tools/seal_vectors.py builds the path from parts, so the full string is a literal nowhere.
    # `.github/workflows/capture-host-ci.yml` is DELIBERATELY ABSENT: it IS a genuine read
    # (test_dev_requirements.py, through a root anchor) but staging it would make a test that has
    # never executed inside a scratch start executing there — a behaviour change this widening must
    # not smuggle in. Dot segments stay out, matching the root-level rule. Filed as residue.
    # Earlier reasons, kept:
    #   uploads/synthetic_ecgdex_h10.txt — a SUBDIRECTORY fixture. This is the read that cost #2864
    #     its measurement: invisible to every earlier version however it was spelled, because the
    #     candidate set was built from root.iterdir() filtered by is_file().
    #   suite.manifest.json              — a root file named by a NON-test module, which the old
    #     non-recursive tests/*.py scan could not see.
    # Self-references under capture-host/ are absent BY CONSTRUCTION, not by a carve-out: this
    # function is "the reads the scratch cannot satisfy on its own", and the tree IS that copy.
    # Without that rule the widened scan added 23 of them — measured, not assumed.
    assert got == ["Dex-Test-Suite.html", "README.md",
                   "briefs/CAPTURE-LOSS-PRECEDENCE-AUDIT-2026-09-22-BRIEF.md", "dex-badges.css",
                   "ecgdex-dsp.js", "index.html", "pat-feasibility.js", "provenance/_meta.json",
                   "provenance/index.json", "sensor-trio-power-analysis.js", "suite.manifest.json",
                   "tests/dex-tests.js", "tools/mutate-equivalence.json", "tools/o2ring-dat-timefit.mjs",
                   "tools/verdict-adoption.json", "tools/verify-seals.mjs",
                   "uploads/synthetic_ecgdex_h10.txt", "uploads/synthetic_motiondex_acc.txt",
                   "uploads/synthetic_oxydex_o2ring.csv", "verdict.js"], got
