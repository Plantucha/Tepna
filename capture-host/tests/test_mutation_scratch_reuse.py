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
    # NEITHER destination has an `uploads/` yet — the copy must create it, at both places. Without
    # that, `shutil.copy2` raises FileNotFoundError and a read staged into a missing parent is as
    # absent as no copy at all.
    assert not (work / "uploads").exists() and not (scratch / "uploads").exists()
    n = mutation_diff.stage_root_reads(tree, work, mutation_diff.root_reads(tree))
    assert n == 2, n
    assert (work / "uploads" / "synthetic_ecgdex_h10.txt").read_text() == "t,v\n0,1\n"
    assert (scratch / "uploads" / "synthetic_ecgdex_h10.txt").read_text() == "t,v\n0,1\n"
    # `parents=True` needs a TWO-level destination, and `exist_ok=True` needs a SECOND name landing in
    # a directory the first call already made — neither is observable with one name one level down.
    (root / "docs").mkdir(exist_ok=True); (root / "docs" / "deep").mkdir(exist_ok=True)
    (root / "docs" / "deep" / "two_levels.txt").write_text("2\n")
    (root / "uploads" / "second_in_dir.txt").write_text("s\n")
    deep = tmp_path / "scratch2"; w2 = deep / "work"; w2.mkdir(parents=True)
    n2 = mutation_diff.stage_root_reads(tree, w2, ["docs/deep/two_levels.txt", "uploads/synthetic_ecgdex_h10.txt", "uploads/second_in_dir.txt"])
    assert n2 == 6, n2
    assert (w2 / "docs" / "deep" / "two_levels.txt").read_text() == "2\n"
    assert (w2 / "uploads" / "second_in_dir.txt").read_text() == "s\n"
    # A name that is NOT a file is SKIPPED, not a stopping point: the skip is a `continue`, and it
    # comes FIRST here so a `break` would lose every real read after it.
    w3 = tmp_path / "scratch3" / "work"; w3.mkdir(parents=True)
    n3 = mutation_diff.stage_root_reads(tree, w3, ["absent_from_the_root.txt", "uploads/synthetic_ecgdex_h10.txt"])
    assert n3 == 2, n3
    assert (w3 / "uploads" / "synthetic_ecgdex_h10.txt").is_file()


def test_root_reads_refuses_to_escape_the_root(tmp_path):
    """Widening from NAMES to PATHS widens what a literal can reach, so the bound is explicit: an
    absolute path and a `..` traversal are never candidates, however they are spelled."""
    root, tree = _tree_with_subdir_read_via_helper(tmp_path)
    (tree / "tests" / "test_escape.py").write_text(
        'A = "/etc/passwd"\nB = "../../outside.txt"\nC = "uploads/../uploads/synthetic_ecgdex_h10.txt"\n'
    )
    # ⚠️ An ABSOLUTE literal that points INSIDE the root is the input that separates
    # `A or B or C or D` from `(A and B) or C or D`: under the mutant the "no slash" and "absolute"
    # guards are dropped, the path resolves to a real file under the root, and it is ADDED.
    (tree / "tests" / "test_abs_inside.py").write_text(f'E = "{root / "uploads" / "synthetic_ecgdex_h10.txt"}"\n')
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
    # the unresolvable literal is FIRST and a real read follows it: a `continue` mutated to `break`
    # would stop scanning this file and lose the second, so the order is the assertion
    (root / "only_here.js").write_text("x\n")
    # ⚠️ The second literal must be one NO OTHER FILE names. An earlier version used the helper's own
    # fixture path, so a `continue`→`break` lost nothing: the expected value was still supplied by
    # `tests/vectors.py`. A test whose answer is available from a second source cannot fail.
    (tree / "tests" / "test_junk.py").write_text('BAD = "up\x00loads/x.txt"\nGOOD = "only_here.js"\n')
    got = mutation_diff.root_reads(tree)                      # must not raise
    assert "uploads/synthetic_ecgdex_h10.txt" in got, got     # and the real read still lands
    assert "only_here.js" in got, got                         # ...including the literal AFTER the junk one
    assert not any("\x00" in g for g in got), got


def test_subdir_index_reads_GIT_when_the_root_is_a_checkout(tmp_path):
    """⚠️ THE PRODUCTION PATH, and every other test in this file exercises the FALLBACK.

    `_subdir_index` prefers `git ls-files` and walks the tree only when git cannot be read. The
    synthetic trees the other tests build are not repositories, so until this test existed the branch
    that actually runs in the real checkout was never executed — 21 mutants survived on that one
    `subprocess.run` call (`cwd=None`, `check=False`, `text=None`, each argument dropped in turn),
    which is mutmut saying precisely that: no test can see this call.

    The discriminator is TRACKED vs PRESENT: an untracked file in a subdirectory is in the walk and
    is NOT in `git ls-files`, so this asserts the semantic difference rather than the mechanism."""
    import subprocess

    root = tmp_path / "repo"; tree = root / "capture-host"; tree.mkdir(parents=True)
    _fake_tree(tree)
    (root / "uploads").mkdir()
    (root / "uploads" / "tracked_fixture.txt").write_text("t\n")
    (root / "uploads" / "untracked_fixture.txt").write_text("u\n")
    run = lambda *a: subprocess.run(["git", *a], cwd=str(root), capture_output=True, text=True, check=True)
    run("init", "-q")
    run("config", "user.email", "t@e.st"); run("config", "user.name", "t")
    # AAA_root.txt sorts FIRST and is skipped (root-level files are `names`), so a `continue`
    # mutated to `break` loses everything after it — including the two fixtures below.
    (root / "AAA_root.txt").write_text("r\n")
    # a THREE-segment path: `rsplit("/", 1)[-1]` is the basename, `split("/", 1)[-1]` is `deep/x.txt`
    (root / "docs").mkdir(); (root / "docs" / "deep").mkdir()
    (root / "docs" / "deep" / "deep_fixture.txt").write_text("d\n")
    # parts[0] is the tree name, parts[1] is not — a `parts[0]`→`parts[1]` mutant skips the wrong row
    (root / "docs" / "capture-host").mkdir()
    (root / "docs" / "capture-host" / "nested_fixture.txt").write_text("n\n")
    (root / ".hidden").mkdir(exist_ok=True); (root / ".hidden" / "ignored.txt").write_text("h\n")
    run("add", "uploads/tracked_fixture.txt", "AAA_root.txt", "docs", ".hidden")
    run("commit", "-qm", "fixture")
    index, dups = mutation_diff._subdir_index(root, tree.name)
    assert index.get("tracked_fixture.txt") == "uploads/tracked_fixture.txt", index
    # the whole point of preferring git: an untracked file is not somebody's fixture
    assert "untracked_fixture.txt" not in index, index
    assert index.get("deep_fixture.txt") == "docs/deep/deep_fixture.txt", index      # basename, not a tail
    assert index.get("nested_fixture.txt") == "docs/capture-host/nested_fixture.txt", index
    assert "AAA_root.txt" not in index, index                                        # root files are `names`
    assert "tracked_fixture.txt" not in dups, dups                                   # unique ⇒ NOT ambiguous


def test_root_reads_keeps_SCANNING_after_a_match_and_after_a_skip(tmp_path):
    """Both `continue`s in the literal loop are loop CONTINUATIONS, not exits.

    Mutated to `break` they survived, because no test had a file whose SECOND literal was the one
    that mattered. One file, four literals: a root name, a skipped junk literal, a subdirectory path
    and a bare basename — all four reads must be found from the same file."""
    root, tree = _tree_with_subdir_read_via_helper(tmp_path)
    (root / "sibling.js").write_text("x\n")
    (tree / "tests" / "test_many.py").write_text(
        'A = "sibling.js"\nB = "/etc/passwd"\nC = "uploads/synthetic_ecgdex_h10.txt"\n'
    )
    # a BARE BASENAME resolved through the index is a fourth branch with its own `continue`, and it
    # must be followed by a literal that still has to be found
    (root / "uploads" / "only_by_basename.txt").write_text("b\n")
    (tree / "tests" / "test_basename_first.py").write_text('P = "only_by_basename.txt"\nQ = "sibling.js"\n')
    got = mutation_diff.root_reads(tree)
    assert "sibling.js" in got and "uploads/synthetic_ecgdex_h10.txt" in got, got
    assert "/etc/passwd" not in got, got
    assert "uploads/only_by_basename.txt" in got, got
    # ⚠️ and the tree's OWN files are never reachable by bare basename either — `_subdir_index` is
    # given `tree.name` so it can exclude them; passing None would admit every module in the scratch
    (tree / "tools").mkdir(exist_ok=True)
    (tree / "tools" / "inside_only.py").write_text("# inside the tree\n")
    (tree / "tests" / "test_bare_selfref.py").write_text('R = "inside_only.py"\n')
    got2 = mutation_diff.root_reads(tree)
    assert not any("inside_only.py" in g for g in got2), got2


def test_root_reads_excludes_the_TREE_ITSELF_by_its_first_segment(tmp_path):
    """The self-reference rule is `lit.split("/", 1)[0] == tree.name`, and three mutants of it lived.

    `_subdir_index(root, None)` never matches the tree name at all; `split(None, 1)` splits on
    whitespace so a path never matches; `rsplit("/", 1)[0]` compares the DIRECTORY part, which is
    `capture-host` for a two-segment path — identical — and `capture-host/tools` for a three-segment
    one, which is not. So the killing input is a THREE-segment path under the tree that a test names:
    the original skips it (it is the scratch copy itself), every mutant admits it."""
    root, tree = _tree_with_subdir_read_via_helper(tmp_path)
    (tree / "tools").mkdir(exist_ok=True)
    (tree / "tools" / "deep_selfref.py").write_text("# a file inside the tree\n")
    (tree / "tests" / "test_names_self.py").write_text('S = "capture-host/tools/deep_selfref.py"\n')
    got = mutation_diff.root_reads(tree)
    assert not any(g.startswith("capture-host/") for g in got), got
    index, _d = mutation_diff._subdir_index(root, tree.name)
    assert "deep_selfref.py" not in index, index      # the tree IS the scratch copy


def test_every_SKIP_in_the_literal_loop_is_a_continue_not_a_break(tmp_path):
    """Four branches of the literal loop end in `continue`, and each needs its OWN following literal.

    ⚠️ I wrote this test three times before it could fail. Each earlier version put the "must still be
    found" literal AFTER the skip — correctly — but chose one that ANOTHER file in the fixture also
    named, so a `break` lost it from this file and the fixture supplied it anyway. Three branches,
    three silent passes, one cause: **the expected value was obtainable from a source other than the
    one under test.** Here every follower is a file named in exactly one place, so losing it is
    observable. **The `only_*` names are LOAD-BEARING, not decoration**: the invariant lives in the
    filename, so the next person cannot pick a follower without meeting the requirement. A rule in
    this docstring would have been the fourth thing I had in view while making the error."""
    root, tree = _tree_with_subdir_read_via_helper(tmp_path)
    for n in ("only_after_name.js", "only_after_index.js", "only_after_self.js"):
        (root / n).write_text("x\n")
    (root / "uploads" / "only_indexed.txt").write_text("i\n")
    (tree / "tools").mkdir(exist_ok=True)
    (tree / "tools" / "selfref_only.py").write_text("# inside the tree\n")
    # 1 · a names hit, then a literal nothing else names
    (tree / "tests" / "t_after_name.py").write_text('A = "sibling_one.js"\nB = "only_after_name.js"\n')
    (root / "sibling_one.js").write_text("s\n")
    # 2 · an INDEX hit (bare basename of a subdirectory file), then another
    (tree / "tests" / "t_after_index.py").write_text('C = "only_indexed.txt"\nD = "only_after_index.js"\n')
    # 3 · a tree self-reference skip, then another
    (tree / "tests" / "t_after_self.py").write_text('E = "capture-host/tools/selfref_only.py"\nF = "only_after_self.js"\n')
    got = mutation_diff.root_reads(tree)
    assert "only_after_name.js" in got, got
    assert "only_after_index.js" in got, got
    assert "only_after_self.js" in got, got
    assert "uploads/only_indexed.txt" in got, got
    assert not any(g.startswith("capture-host/") for g in got), got


def test_root_reads_wants_a_FILE_and_containment_BOTH(tmp_path):
    """`target.is_file() and target.is_relative_to(root)` — mutated to `or` it survived, because no
    test named a path that is inside the root but is NOT a file. A DIRECTORY is that case."""
    root, tree = _tree_with_subdir_read_via_helper(tmp_path)
    (root / "docs").mkdir(exist_ok=True); (root / "docs" / "sub").mkdir()
    (tree / "tests" / "test_dir_literal.py").write_text('D = "docs/sub"\n')
    got = mutation_diff.root_reads(tree)
    assert "docs/sub" not in got, got


def test_root_reads_does_not_scan_an_IN_TREE_VENV(tmp_path):
    """🔴 THE PLANT FOR residue 2026-09-25-root-reads-pin-scans-an-in-tree-venv. A real `.venv/`
    directory inside capture-host — the layout `check.sh` resolves and `mutation_diff`'s own refusal
    text prescribes — holds thousands of string literals in site-packages, and `LICENSE`/`NOTICE`
    among them name real repo-root files. Against the pre-fix scan those became "reads" and the
    equality pin `test_the_REAL_suite_has_exactly_the_root_reads_we_know_about` went red on any
    fresh clone, while the rig (symlinked `.venv`, which rglob does not follow) stayed green.

    Two venv shapes are planted, because the two rules that exclude them are independent: a
    DOT-directory (`.venv`) and a dotless directory carrying `pyvenv.cfg` (`venv`). A third literal,
    in a real test file, is the positive control: the scan still sees genuine reads."""
    # ⚠️ The planted root files carry SYNTHETIC names on purpose. `root_reads` scans THIS file too, and
    # a literal here naming a real root file (`LICENSE`, `NOTICE`, …) would register as a read of the
    # real repo and move the equality pin below — the over-flag the pin's docstring warns about.
    root, tree = _tree_with_subdir_read_via_helper(tmp_path)
    for name in ("named_by_dot_venv_a.txt", "named_by_dot_venv_b.txt", "named_by_plain_venv.css"):
        (root / name).write_text("x\n")
    dot_venv = tree / ".venv" / "lib" / "python3.11" / "site-packages" / "somepkg"
    dot_venv.mkdir(parents=True)
    (dot_venv / "__init__.py").write_text('files = ["named_by_dot_venv_a.txt", "named_by_dot_venv_b.txt"]\n')
    plain_venv = tree / "venv"
    (plain_venv / "lib" / "site-packages").mkdir(parents=True)
    (plain_venv / "pyvenv.cfg").write_text("home = /usr/bin\n")
    (plain_venv / "lib" / "site-packages" / "pkg.py").write_text('CSS = "named_by_plain_venv.css"\n')
    (tree / "tests" / "test_real_read.py").write_text('E = "sibling_one.js"\n')
    (root / "sibling_one.js").write_text("s\n")
    # A dot-directory that is NOT the first segment (`tests/.hidden/`, the shape of `.pytest_cache`
    # or `.mypy_cache` inside a subdirectory). The rule reads EVERY directory segment; a scan that
    # looked only at the first one, or dropped the last directory, would count this as a read.
    (root / "named_by_nested_dot_dir.txt").write_text("x\n")
    (tree / "tests" / ".hidden").mkdir()
    (tree / "tests" / ".hidden" / "t.py").write_text('F = "named_by_nested_dot_dir.txt"\n')
    got = mutation_diff.root_reads(tree)
    assert not any(n.startswith("named_by_dot_venv") for n in got), got   # the dot-directory rule
    assert "named_by_nested_dot_dir.txt" not in got, got                  # …at ANY depth
    assert "named_by_plain_venv.css" not in got, got                      # the pyvenv.cfg rule
    assert "sibling_one.js" in got, got                                   # a real read is still seen
    assert "uploads/synthetic_ecgdex_h10.txt" in got, got                 # the helper-named read survives too


def test_the_REAL_suite_has_exactly_the_root_reads_we_know_about():
    """Pinned as an EQUALITY so a change in the population is VISIBLE (a floor would not count it).
    Measured 2026-09-19: one real read — `ecgdex-dsp.js` (the seam-bound parity check) — plus four
    names tests merely MENTION as literals (over-flagged by design; each costs one small copy). If this
    changes, the scratch already carries the new file — the assertion exists so the author sees it.
    2026-09-20: two more real reads — `pat-feasibility.js` + `sensor-trio-power-analysis.js`, the
    Nights-page tripwire that reds the day a fused tool's classifier accepts a box filename.
    2026-09-21: `verdict.js` — a REAL read, from two suites: test_seal.py validates both sealed-night
    readers' verdict objects through the contract's own validator rather than a hand-written copy of its
    rules, and test_verdict cross-validates the Python half (verdict.py) against the same JS contract.
    2026-09-22: `sensor-trio-night.js` — a MENTION, not a read: test_webmon_nights.py names it as the
    classifier-gate key for the monitor's per-night landing page, the same over-flag the power tool's
    entry already costs (one small copy each)."""
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
                   "provenance/index.json", "sensor-trio-night.js", "sensor-trio-power-analysis.js",
                   "suite.manifest.json",
                   "tests/dex-tests.js", "tools/mutate-equivalence.json", "tools/o2ring-dat-timefit.mjs",
                   "tools/verdict-adoption.json", "tools/verify-seals.mjs",
                   "uploads/synthetic_ecgdex_h10.txt", "uploads/synthetic_motiondex_acc.txt",
                   "uploads/synthetic_oxydex_o2ring.csv", "verdict.js"], got


def test_root_reads_survives_a_NON_UTF8_byte_in_a_test_file(tmp_path):
    """🔴 THE PLANT FOR residue 2026-09-22-mutation-globs-inherit-a-functions-debt. `root_reads` reads
    every `.py` with `errors="replace"` so one stray Latin-1 byte in a comment cannot abort the scan
    of the whole tree — and until 2026-09-25 no test held a file like that, so `errors=None`, a
    dropped `errors=`, and `errors="REPLACE"` (an unknown handler name, looked up only when a byte
    fails to decode) all survived. The literal on the next line must still be found, because a
    scan that aborted here would stage nothing and the scratch would fail on its first root read."""
    root, tree = _tree_with_subdir_read_via_helper(tmp_path)
    (root / "named_by_non_utf8_file.txt").write_text("x\n")
    (tree / "tests" / "t_latin1.py").write_bytes(b'# caf\xe9 \xff\nG = "named_by_non_utf8_file.txt"\n')
    got = mutation_diff.root_reads(tree)
    assert "named_by_non_utf8_file.txt" in got, got
    assert "uploads/synthetic_ecgdex_h10.txt" in got, got


def test_root_reads_never_counts_a_DOTFILE_or_a_DOT_DIRECTORY_PATH(tmp_path):
    """Both dot guards in `root_reads`, each planted against the survivor that measured it undefended
    (2026-09-25, the whole-function run behind residue 2026-09-22-mutation-globs-inherit-a-functions-
    debt): (1) a root DOTFILE is never a candidate name — in a git worktree `.git` is a regular file,
    and a test that mentions it must not stage it; (2) a PATH literal that starts with `.` is never a
    read — `./x` and `.dotdir/x` both resolve to real files under the root, so without the guard the
    resolve-and-check branch would count them. Mutating either `startswith(".")` to any other prefix
    lets the planted literal through; the positive control shows the scan itself still runs."""
    root, tree = _tree_with_subdir_read_via_helper(tmp_path)
    (root / ".named_dotfile_at_root").write_text("x\n")
    (root / ".dotdir_for_root_reads").mkdir()
    (root / ".dotdir_for_root_reads" / "named_by_dot_dir_path.txt").write_text("x\n")
    (root / "named_by_dot_slash_path.txt").write_text("x\n")
    (tree / "tests" / "t_dots.py").write_text(
        'A = ".named_dotfile_at_root"\n'
        'B = ".dotdir_for_root_reads/named_by_dot_dir_path.txt"\n'
        'C = "./named_by_dot_slash_path.txt"\n'
    )
    got = mutation_diff.root_reads(tree)
    assert "uploads/synthetic_ecgdex_h10.txt" in got, got
    assert not [g for g in got if g.startswith(".")], got
