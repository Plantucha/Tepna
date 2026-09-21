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


def test_the_REAL_suite_has_exactly_the_root_reads_we_know_about():
    """Pinned as an EQUALITY so a change in the population is VISIBLE (a floor would not count it).
    Measured 2026-09-19: one real read — `ecgdex-dsp.js` (the seam-bound parity check) — plus four
    names tests merely MENTION as literals (over-flagged by design; each costs one small copy). If this
    changes, the scratch already carries the new file — the assertion exists so the author sees it.
    2026-09-20: two more real reads — `pat-feasibility.js` + `sensor-trio-power-analysis.js`, the
    Nights-page tripwire that reds the day a fused tool's classifier accepts a box filename."""
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
    assert got == ["Dex-Test-Suite.html", "README.md", "dex-badges.css", "ecgdex-dsp.js", "index.html",
                   "pat-feasibility.js", "sensor-trio-power-analysis.js"], got
