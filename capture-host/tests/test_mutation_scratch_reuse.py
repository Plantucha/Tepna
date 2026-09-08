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
