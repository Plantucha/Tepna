# tepna-capture — tools/mutate_set.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""THE MUTANT SET UNDER ONE VENV, AND THE DIFF ACROSS TWO — the instrument a mutmut pin move needs.

    python3 tools/mutate_set.py --write before.json        # enumerate under the venv on PATH now
    python3 tools/mutate_set.py --compare before.json after.json
    python3 tools/mutate_set.py --compare a.json b.json --verdict-out v.json
    python3 tools/mutate_set.py --write s.json --all        # include the owner-declared exclusions
    python3 tools/mutate_set.py --selftest

`requirements-dev.txt` tells the next session to re-baseline survivors when the mutmut pin moves. This
is the comparison that decides whether it is owed, and it replaces the throwaway probe each mover
wrote. `--compare` exits 0 on PASS, 1 on FAIL, 2 when it could not look (§4c).

WHERE THE DECISIONS LIVE. In `mutation_set.py`, one directory up, inside the 100 % coverage floor. This
file is argparse, the mutmut call, the scratch config and the IO — the same split as
`mutation_diff.py` beside `tools/mutate_diff.py`.

WHY A SCRATCH DIRECTORY. mutmut's `create_mutations` reads `config().do_not_mutate_patterns`, and
`config()` loads `pyproject.toml` from the CURRENT directory, raising `FileNotFoundError` when it
finds none. So this file chdirs into a scratch directory holding a minimal config that mirrors what
`tools/mutate.py` writes, and passes absolute source paths. It never rewrites the live
`pyproject.toml` — the live file is what the gate itself runs under.

THE MEMORY BOUND. `mutate_file_contents` returns the combined mutants source, and for `capture.py`
that string is 554 MiB (measured 2026-11-02). One module is held at a time and the source is dropped
the moment its names are read, which keeps the peak at one module rather than the sum (standing rule:
never hold more than 8 GB).
"""

from __future__ import annotations

import argparse
import contextlib
import importlib.metadata
import json
import platform
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "tools"))

import mutation_set as MS  # noqa: E402
import verdict as VD  # noqa: E402

REFUSED = 2

# The config `create_mutations` needs in order to load at all. `source_paths` is never read for a
# single-file call, and `do_not_mutate` is matched against the paths this file passes, which are
# absolute module paths and never a test.
SCRATCH_CONFIG = '[tool.mutmut]\nsource_paths = ["."]\ndo_not_mutate = ["tests/*"]\n'


def declared_modules(*, include_excluded: bool) -> tuple[list[str], list[str]]:
    """The gate's own module population, and the owner-declared module exclusions held out of it.

    An excluded module is one the mutation gate may report NOT_APPLICABLE for, so no survivor of it is
    baselined and no pin move can cost it a re-baselining. `--all` puts it back for a reader who wants
    the whole tree measured."""
    import mutate  # the gate's own enumeration, so this population cannot drift from it

    every = mutate.modules()
    excluded = sorted(key for key in _module_exclusion_keys() if key in every)
    if include_excluded:
        return every, []
    return [m for m in every if m not in set(excluded)], excluded


def _module_exclusion_keys() -> list[str]:
    """The bare-module keys of `tools/mutate-exclusions.json`. A `module.py::function` key excludes one
    function and leaves the module's other mutants baselined, so it is NOT held out here."""
    path = HERE / "tools" / "mutate-exclusions.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return [key for key in data.get("exclusions", {}) if "::" not in key]


def named_mutants(module_path: Path) -> list[str]:
    """mutmut's own names for every mutant of one module, in its own order.

    The combined source is dropped before returning — see THE MEMORY BOUND above."""
    from mutmut.mutation.file_mutation import mutate_file_contents

    mutated = mutate_file_contents(str(module_path), module_path.read_text(encoding="utf-8"), None, None)
    names = list(mutated.mutant_names)
    del mutated
    return names


def enumerate_modules(names: list[str], *, progress: bool = True) -> dict[str, list[str]]:
    """Every module's named mutant set, read inside a scratch config directory."""
    out: dict[str, list[str]] = {}
    with tempfile.TemporaryDirectory(prefix="mutant-set-") as scratch:
        (Path(scratch) / "pyproject.toml").write_text(SCRATCH_CONFIG, encoding="utf-8")
        with contextlib.chdir(scratch):
            for i, name in enumerate(names, 1):
                if progress:
                    print(f"  [{i}/{len(names)}] {name}", flush=True)
                out[name] = named_mutants(HERE / name)
    return out


def _verdict_sample() -> dict:
    """A canned object for the adoption gate: the shape, with no mutmut run behind it."""
    sha = "0" * 12
    before = MS.artifact(mutmut="3.8.0", python="3.13.1", commit=sha, modules={"devfloors.py": ["x_f__mutmut_1"]})
    after = MS.artifact(
        mutmut="3.8.1",
        python="3.13.1",
        commit=sha,
        modules={"devfloors.py": ["x_f__mutmut_1", "x_f__mutmut_2"]},
    )
    return MS.verdict_object(MS.compare(before, after), commit=sha, at="2026-11-02T00:00:00Z")


def selftest() -> int:
    """The decision logic alone, including a PLANT: a comparison whose sets differ must not read PASS.

    There is no pytest route to this file — it is pinned out of the coverage floor, and its own tests
    live in `tests/test_mutation_set.py` against `mutation_set.py`. This covers the three things only
    the CLI knows: the sample's shape, the exclusion read, and the exit-code map."""
    sha = "aceeacc86"
    cases: list[tuple[str, bool]] = []

    sample = _verdict_sample()
    cases.append(("the sample is a FAIL over a set that moved", sample["status"] == "FAIL"))
    VD.validate(sample)
    cases.append(("the sample validates against the contract", True))

    population, excluded = declared_modules(include_excluded=False)
    cases.append(("the population is the gate's own module list", len(population) > 50))
    cases.append(("the owner-declared module exclusions are held out", "capture.py" in excluded))
    everything, none_held = declared_modules(include_excluded=True)
    cases.append(("--all puts them back", "capture.py" in everything and none_held == []))

    same = MS.artifact(mutmut="3.8.0", python="3.13.1", commit=sha, modules={"a.py": ["m1"]})
    moved = MS.artifact(mutmut="3.8.1", python="3.13.1", commit=sha, modules={"a.py": ["m2"]})
    cases.append(("a moved set exits 1", _exit_for(MS.verdict_object(MS.compare(same, moved), commit=sha)) == 1))
    held = MS.artifact(mutmut="3.8.1", python="3.13.1", commit=sha, modules={"a.py": ["m1"]})
    cases.append(("a held set exits 0", _exit_for(MS.verdict_object(MS.compare(same, held), commit=sha)) == 0))
    cases.append(("a refusal exits 2", _exit_for(MS.refusal_object("r", commit=sha)) == REFUSED))
    # THE DISCRIMINATING ARM: every arm above is satisfied by a map that returns 0 for everything, so
    # one arm has to read a FAIL and refuse that answer. It is not a plant — nothing here is broken on
    # purpose — it is the one assertion a vacuous map cannot pass.
    cases.append(("CONTROL · a FAIL never maps to 0", _exit_for({"status": "FAIL"}) != 0))

    bad = [label for label, ok in cases if not ok]
    for label in bad:
        print("SELFTEST ✗ %s" % label)
    print("SELFTEST=%s (%d/%d)" % ("PASS" if not bad else "FAIL", len(cases) - len(bad), len(cases)))
    return 1 if bad else 0


def _exit_for(obj: dict) -> int:
    """PASS is 0, a finding is 1, and anything else could not look (§4c)."""
    if obj["status"] == "PASS":
        return 0
    if obj["status"] == "FAIL":
        return 1
    return REFUSED


def only_flag(name: str) -> bool:
    """True when `name` is the whole argument list."""
    return sys.argv[1:] == [name]


def _print_report(report: dict[str, Any], status: str, reason: str | None) -> None:
    before, after = report["mutmut"]["before"], report["mutmut"]["after"]
    print(f"  mutmut {before} → {after} · {report['checked']} module(s) compared")
    for name, change in sorted(report["moved"].items()):
        print(f"  \033[31m✗\033[0m {name}: +{len(change['added'])} −{len(change['removed'])}")
    for name in report["reordered"]:
        print(f"  \033[33m⚠\033[0m {name}: same set, different order — no re-baselining owed")
    print(f"  {status}" + (f" — {reason}" if reason else ""))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="the named mutant set under one venv, and the diff across two")
    ap.add_argument("--write", metavar="PATH", help="enumerate under the current venv and write the artifact here")
    ap.add_argument("--compare", nargs=2, metavar=("BEFORE", "AFTER"), help="compare two artifacts")
    ap.add_argument("--all", action="store_true", help="include the owner-declared module exclusions")
    ap.add_argument("--verdict-out", metavar="PATH", help="write the tepna.verdict/1 object here")
    ap.add_argument("--quiet", action="store_true", help="no per-module progress line")
    args = ap.parse_args(argv)

    if bool(args.write) == bool(args.compare):
        ap.error("exactly one of --write or --compare")

    commit = VD.commit_sha(str(HERE))

    if args.write:
        population, excluded = declared_modules(include_excluded=args.all)
        if excluded:
            print(f"  holding out {len(excluded)} owner-declared exclusion(s): {', '.join(excluded)}")
        modules = enumerate_modules(population, progress=not args.quiet)
        obj = MS.artifact(
            mutmut=importlib.metadata.version("mutmut"),
            python=platform.python_version(),
            commit=commit,
            modules=modules,
        )
        Path(args.write).write_text(json.dumps(obj, indent=1) + "\n", encoding="utf-8")
        total = sum(len(v) for v in modules.values())
        print(f"  wrote {args.write} — mutmut {obj['mutmut']} · {len(modules)} module(s) · {total} mutant(s)")
        return 0

    before, after = (json.loads(Path(p).read_text(encoding="utf-8")) for p in args.compare)
    reason = MS.refusal(before, after)
    if reason is not None:
        obj = MS.refusal_object(reason, commit=commit)
        print(f"  \033[33m⚠ REFUSED\033[0m {reason}")
    else:
        report = MS.compare(before, after)
        obj = MS.verdict_object(report, commit=commit)
        _print_report(report, obj["status"], obj["reason"])

    if args.verdict_out:
        VD.write(args.verdict_out, obj)
    return _exit_for(obj)


if __name__ == "__main__":
    if only_flag("--verdict-sample"):  # the adoption gate's cmd — canned, no mutmut run
        print(json.dumps(_verdict_sample(), indent=1))
        sys.exit(0)
    if only_flag("--selftest"):  # the decision logic and the exit-code map, with a plant
        sys.exit(selftest())
    sys.exit(main())
