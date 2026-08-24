# tepna-capture — mmeta.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE MUTATION GATE'S OWN HONESTY LAYER — reading mutmut's `mutants/<module>.py.meta`, the file the
# gate's two proven blind spots both hide in (OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS §2, §3).
#
# mutmut 3.x writes one JSON meta per mutated module:
#     {"exit_code_by_key": {"<stem>.x_<func>__mutmut_N": <exit_code> | null, ...}}
# A `null` value is a mutant that was GENERATED but never DECIDED — the run copied it in and then did
# not test it (a crashed invocation, a collection failure, a timeout). A killed OR a surviving mutant
# both carry a non-null exit code. So "how many mutants under this glob were actually tested" is a
# DIRECT, measured signal — not the "the process returned" proxy that `mutate_diff` counted as a clean
# run, and not `mutmut results` (which lists only survivors, so a legitimately all-killed glob reads as
# empty there and cannot be told from a glob that never ran).
#
# Two defects consume this file:
#   §3  a mutmut invocation that CRASHED after generation returns a real rc and no error, so the driver
#       counted it as a clean, empty run — the module dropped out of the gate while listed as covered.
#       `tested_count` == 0 on a glob the driver believes it ran is the tell.
#   §2  the reuse cache is keyed on the module SOURCE only, so a scratch reused after a test was ADDED or
#       MODIFIED serves mutmut's exit codes from the OLD tests — the new killer is not credited on the
#       first run. Keying an invalidation on the TEST tree, and clearing only the results (not the
#       expensive mutant source + warm .pyc), fixes it.
#
# Empirically confirmed the signal discriminates (2026-08-24, real /tmp scratches): clean runs read
# all-decided (cpap_spool 389/389, cpap_edf 880/880), a crashed/untested module reads 0/320.
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


def decided_under_glob(exit_codes: dict, glob: str) -> int:
    """How many mutants under `glob` were actually DECIDED (killed or survived) — a non-null exit code.

    `glob` is a mutmut name pattern like `oxy_transfer.x_select__mutmut_*`; its keys share the prefix
    before the `*`. A null value (generated-not-tested) does not count: that is precisely the state a
    crash leaves, and counting it would re-admit the false green. An empty / missing map counts zero.
    """
    prefix = glob.rstrip("*")
    return sum(1 for key, code in (exit_codes or {}).items()
               if code is not None and key.startswith(prefix))


def read_exit_codes(meta_path: Path) -> dict:
    """The `exit_code_by_key` map from a mutmut `<module>.py.meta`, or `{}` if it is absent/unreadable.

    Absence is itself a signal (a crash before generation writes no meta), and a malformed file is
    treated the same as absent — either way, nothing was measured, so nothing is credited."""
    try:
        data = json.loads(Path(meta_path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    codes = data.get("exit_code_by_key") if isinstance(data, dict) else None
    return codes if isinstance(codes, dict) else {}


def tested_count(work: Path, module: str, glob: str) -> int:
    """§3 — how many mutants under `glob` mutmut actually tested, read from the scratch's meta.

    `module` is the file name (`oxy_transfer.py`); the meta lives at `<work>/mutants/<module>.meta`.
    Zero on a glob the driver believes ran cleanly means the invocation dropped out — refuse, don't green.
    """
    return decided_under_glob(read_exit_codes(Path(work) / "mutants" / f"{module}.meta"), glob)


def generated_under_glob(mutants_src: str, glob: str) -> int:
    """How many mutants mutmut GENERATED for `glob`, counted in the mutants file it wrote.

    ⚠️ THIS SEPARATES TWO CAUSES THAT `tested_count` ALONE CANNOT TELL APART, and one of them is
    benign. A function with no mutable operator — `identity()` is `return f"{a}/{b}"`: no comparison,
    no boolean, no numeric literal — yields ZERO mutants, and mutmut does not say so politely: it
    exits with `AssertionError: Filtered for specific mutants, but nothing matches`. That glob then
    reads 0-tested exactly like a crash, and refusing on it reds the safest diffs there are — a
    rename, a docstring, a format-only edit.

    Measured 2026-08-24 on a one-line change inside `oxy_inventory.identity`: 138 mutants in the file,
    **0** under that glob, whole run refused at exit 2.

    So the pair is a three-way split, not a two-way one:
        generated 0, decided 0  → nothing to mutate. Report it and pass; there is nothing to conclude.
        generated >0, decided 0 → the §3 crash. Refuse — an empty survivor list is "not checked".
        generated >0, decided >0 → covered.
    """
    stem = glob.rstrip("*")
    fn = stem.split(".", 1)[1] if "." in stem else stem
    return len(re.findall(r"^def " + re.escape(fn) + r"\d+\(", mutants_src or "", re.M))


def generated_count(work: Path, module: str, glob: str) -> int:
    """`generated_under_glob` against the scratch's mutants file, `{}`-safe if it is absent."""
    try:
        src = (Path(work) / "mutants" / module).read_text(encoding="utf-8")
    except OSError:
        return 0
    return generated_under_glob(src, glob)


def test_tree_hash(tests_dir: Path) -> str:
    """A content hash of the whole test tree — every `*.py` under `tests_dir`, by relative path + bytes.

    Changes iff a test is added, removed, or edited; blind to mtimes and `__pycache__`. This is the key
    §2 needs: mutmut's mutant source is a pure function of the module, but its exit codes are a function
    of the TESTS, and only this hash moves when the tests do.
    """
    digest = hashlib.sha256()
    for path in sorted(Path(tests_dir).rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        digest.update(path.relative_to(tests_dir).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()[:16]


def refresh_results_if_tests_changed(work: Path, module: str, tests_dir: Path, stamp: Path) -> bool:
    """§2 — invalidate mutmut's RESULTS cache for `module` when the test tree has changed since last run.

    Deletes only `<work>/mutants/<module>.meta` (the exit codes), so mutmut re-tests every mutant against
    the current tests on the NEXT run — while the expensive mutant source and its warm `.pyc` survive, so
    an UNCHANGED test suite still gets the full reuse (the 22 min → 18 s this cache exists for). The test
    hash is stamped into `stamp` so the comparison is against what was actually last measured, not an
    mtime. Returns True iff the results were invalidated (tests changed or no prior stamp).
    """
    current = test_tree_hash(tests_dir)
    stamp = Path(stamp)
    previous = stamp.read_text(encoding="utf-8").strip() if stamp.exists() else None
    if previous == current:
        return False
    (Path(work) / "mutants" / f"{module}.meta").unlink(missing_ok=True)
    stamp.write_text(current, encoding="utf-8")
    return True
