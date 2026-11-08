# tepna-capture — tests/_plant.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# PLANTING A DEFECT BACK INTO A MODULE, SO A CONTROL ARM IS A MECHANISM AND NOT A SENTENCE.
#
# Several test files here carry the line `tests/test_cpap_spool_caller.py:5` uses: the author reverted
# the rule in the module, watched the test fail, and put the rule back. That is the right discipline,
# and the sentence is a true report of a run that happened once, on one tree, by one author. Nothing
# in the repo re-runs it. So a later edit that makes the test pass for the wrong reason leaves the
# sentence standing, and the sentence then reads as evidence.
#
# `planted()` runs that revert inside the suite.
#
# 🔴 IT NEVER WRITES A TRACKED FILE, AND THE REASON IS THE SUITE'S OWN INVARIANT. CI runs
# `pytest -q -n 4` and `check.sh` runs `-n auto`, and the CI step states the suite is worker-safe. A
# helper that wrote a module in place would break that: a second worker imports whatever is on disk,
# so one worker's plant decides another worker's result. A crash between the write and the restore
# would also leave the planted text in the tree. And a line executed from planted text is recorded
# against the real file's numbering, which moves the `--cov-fail-under=100` denominator.
#
# So the plant is loaded from a temporary file under a private module name, and `as_module=True`
# additionally swaps it into `sys.modules` for the body, which is how a DEPENDENT sees it. Both are
# process-local, so a parallel worker is unaffected by construction rather than by a skip.
#
# ⚠️ WHAT THE COPY CHANGES: the module's `__name__` and `__file__`. For a module whose behaviour reads
# either of those, plant with `as_module=True` and assert through the dependent, or do not use this
# helper.
#
# 🔴 THE GUARD THAT MAKES THE ARM MEAN ANYTHING: it compares the planted module's surface against the
# real one and REFUSES when nothing moved. A plant that edits a comment, or that re-states the rule it
# meant to revert, produces a module identical to the original — and the arm would then run the real
# code and print a verdict about nothing (`queries-that-examined-nothing`). A plant that does not
# compile is refused by name for the same reason: a syntax error reds every arm beneath it and reads
# as evidence that the rule is load-bearing.

from __future__ import annotations

import contextlib
import dis
import importlib
import importlib.util
import sys
import tempfile
from pathlib import Path
from types import CodeType

HERE = Path(__file__).resolve().parent.parent

# The module-level values a plant can legitimately move. A control arm that reverts a DEFAULT changes
# no function, so a surface built from functions alone would read that plant as "never arrived".
_SCALARS = (bool, int, float, str, bytes, type(None), tuple, frozenset)


def current_source(name: str) -> str:
    """`<repo>/<name>`'s text, or skip when we have been handed a mutmut-generated file.

    Every read here goes through this function. `tests/_srcscan.module_source` carries the same skip
    for the same reason: that file holds every mutant inline, so an anchor that is unique in the
    source appears hundreds of times in it, and `plant_source` would refuse under a mutation run
    rather than stand down.
    """
    src = (HERE / name).read_text(encoding="utf-8")
    if "__mutmut_orig" in src:
        import pytest

        pytest.skip(
            f"{name} here is a mutmut-generated file holding every mutant inline; a plant against "
            "it would revert a mutant and not the rule (see tests/_srcscan.py)",
            allow_module_level=True,
        )
    return src


def _code_digest(code: CodeType) -> tuple:
    """A reload-stable fingerprint of one code object.

    ⚠️ `dis.get_instructions(...).argrepr` is NOT stable across imports, and the control arm in
    `tests/test_plant.py` is what caught it. For a nested code object it renders
    `<code object <genexpr> at 0x7b09b511d4d0, ...>`, and that ADDRESS moves every time. A
    comment-only plant therefore read as two changed functions in `cpap_spool_caller.py`, so the
    guard would have passed the very plant it exists to refuse. The opcode stream is stable, so it
    stays; every nested code object becomes its own digest instead of its repr.

    `co_code` is deliberately absent. CPython specialises bytecode in place as it runs, so the raw
    bytes of a hot function differ from a cold one compiled from identical source.
    """
    stream = tuple(i.opname for i in dis.get_instructions(code))
    consts = tuple(_code_digest(c) if isinstance(c, CodeType) else repr(c) for c in code.co_consts)
    return (stream, consts, code.co_names, code.co_varnames)


def _surface(mod: object) -> dict[str, tuple]:
    """What a plant can move, keyed by name: every function's digest, and every module-level value."""
    out: dict[str, tuple] = {}
    for name, obj in vars(mod).items():
        if name.startswith("__"):
            continue
        code = getattr(obj, "__code__", None)
        if code is not None:
            out[name] = ("code", _code_digest(code))
        elif isinstance(obj, type):
            for attr, member in sorted(vars(obj).items()):
                member_code = getattr(member, "__code__", None)
                if member_code is not None:
                    out[f"{name}.{attr}"] = ("code", _code_digest(member_code))
        elif isinstance(obj, _SCALARS):
            out[name] = ("value", repr(obj))
    return out


def plant_source(name: str, old: str, new: str) -> str:
    """`<repo>/<name>`'s text with ONE occurrence of `old` replaced by `new`.

    Refuses on anything but exactly one occurrence, because a plant that lands in two places is a
    different edit from the one its arm names.
    """
    original = current_source(name)
    hits = original.count(old)
    if hits != 1:
        raise AssertionError(f"REFUSE: {old!r} appears {hits} time(s) in {name}; a plant names exactly one site")
    return original.replace(old, new)


class Planted:
    """What `planted()` yields: the planted module, and the names whose surface moved."""

    def __init__(self, module: object, changed: list[str]):
        self.module = module
        self.changed = changed


@contextlib.contextmanager
def planted(name: str, new_source: str, *, as_module: bool = False):
    """Load `new_source` as a module for the body. Nothing in the repo is written.

    `name` is a bare module filename, e.g. "cpap_spool_caller.py". The body receives a `Planted`;
    read the planted code through `Planted.module`.

    With `as_module=True` the planted module also occupies `sys.modules[<stem>]` for the body, so a
    dependent's own `import <stem>` resolves to it. The entry comes back afterwards, including the
    case where the real module was never imported.
    """
    stem = Path(name).stem
    real = importlib.import_module(stem)
    before = _surface(real)

    with tempfile.TemporaryDirectory(prefix=f"plant-{stem}-") as tmp:
        target = Path(tmp) / f"{stem}.py"
        target.write_text(new_source, encoding="utf-8")
        spec = importlib.util.spec_from_file_location(f"{stem}__planted", target)
        # `spec_from_file_location` answers None only when no loader claims the suffix. A `.py` path
        # always has one, so this states the construction rather than handling a reachable case.
        assert spec is not None and spec.loader is not None, f"no loader claimed {target}"
        module = importlib.util.module_from_spec(spec)
        prior_dont_write = sys.dont_write_bytecode
        sys.dont_write_bytecode = True
        try:
            spec.loader.exec_module(module)
        except SyntaxError as exc:
            raise AssertionError(
                f"REFUSE: the plant on {name} does not compile ({exc.msg} at line {exc.lineno}). "
                "A plant that cannot be imported reds every arm beneath it, and that red says "
                "nothing about the rule."
            ) from exc
        finally:
            sys.dont_write_bytecode = prior_dont_write

        after = _surface(module)
        changed = sorted(key for key in set(before) | set(after) if before.get(key) != after.get(key))
        if not changed:
            raise AssertionError(
                f"REFUSE: the plant on {name} changed no function and no module-level value, so it "
                "is the original module under another name. The arm would run the real code."
            )

        if not as_module:
            yield Planted(module, changed)
            return

        # The entry exists by construction: this function imported the real module above to build
        # the before-surface, and that import is what registers it. An `if it was absent, pop it`
        # arm here would be unreachable, and an unreachable arm is a claim no test can hold.
        prior = sys.modules[stem]
        sys.modules[stem] = module
        try:
            yield Planted(module, changed)
        finally:
            sys.modules[stem] = prior
