#!/usr/bin/env python3
# tepna-capture — tools/root_reads.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Record every REPO-ROOT file the capture-host Python suite reads or executes.

WHY A TRACER AND NOT A GREP. The suite reaches root files through a `ROOT` constant built from
`os.path.dirname(os.path.dirname(os.path.dirname(__file__)))`, so the path never sits beside the
anchor as a literal. Measured 2026-10-21: a static scan over every test source finds ONE literal
(`tests/dex-tests.js`) and three opaque anchors, where the suite in fact opens 45 root files. A
static-only instrument reports a set of one and reads as clean, which is the examined-nothing shape
CLAUDE.md §4b names. An audit hook sees the path the interpreter opened.

Two halves, so the measurement and the record stay separable:

  * as a pytest plugin it appends one JSON line per root path to `$ROOTREADS_OUT`, from every xdist
    worker. Measured from `capture-host/` with the suite's own interpreter, since only that venv
    carries xdist, pytest-cov and pytest-timeout:

        ROOTREADS_OUT=/tmp/rootreads.jsonl PYTHONPATH=. .venv/bin/python -m pytest \
            -p tools.root_reads -q -n 4 --timeout=180 --cov --cov-branch --cov-fail-under=100

    `PYTHONPATH=.` is load-bearing: `-p` is resolved at startup, before tests/conftest.py puts this
    directory on `sys.path`. Without `ROOTREADS_OUT` the plugin is a no-op, so it can sit on the path
    without changing a suite that did not ask to be measured;
  * `python tools/root_reads.py --fold <jsonl> --out <json>` folds those lines into the manifest
    `tools/root-reads.json`, which `tools/relevance.sh` reads to decide whether a change runs the
    suite. Only a `paths` entry carries the key `path`; an excluded observation carries `token`, so a
    line-oriented reader of the manifest cannot mistake an argv token for a file the suite reads.

A path is classified, never dropped silently. `tracked` is a file git knows, and only those reach the
manifest: `absent` covers the argv tokens a traced `subprocess.Popen` carries (`hci0`, a device path),
and `untracked` covers anything present on this machine and in no commit, which no PR diff can name.

TWO INSTRUMENTS, AND THE MANIFEST IS THEIR UNION. `mutation_diff.root_reads()` already derives root
reads for the mutation scratch, statically, from the literals the test sources name. Measured
2026-10-21 the two disagree in BOTH directions: the static scan names 12 root paths this trace never
opened (a name a test mentions but reads only under a skip), and misses 31 it did open (every
`*.src.html`, the four root apps, the CPAP EDF fixtures — names a test builds rather than spells).
A name-indexed instrument cannot see a constructed path, and a trace cannot see a read that did not
happen on the day. So each entry records how it was `found`, `traced` or `named` or both, and the
filter takes the union: over-inclusion costs CI time, under-inclusion is the blind gate this exists
to close.
"""

import atexit
import json
import os
import pathlib
import subprocess
import sys

MANIFEST = "tools/root-reads.json"
SCHEMA = "tepna.root-reads/1"
# The command the manifest is measured under. CI runs this line; `tools/relevance.sh` decides whether
# that job runs at all, so the two are one loop and the command belongs in the record.
COMMAND = "pytest -q -n 4 --timeout=180 --cov --cov-branch --cov-report=term-missing --cov-fail-under=100"


def repo_root():
    """The repo root above this capture-host tree."""
    return pathlib.Path(__file__).resolve().parents[2]


def relativise(p, root, cwd):
    """`p` as a root-relative path, or None when it is not under the root or not under a root outside
    capture-host. A relative path is resolved against `cwd`, because that is what the interpreter did."""
    if isinstance(p, int):
        return None
    try:
        rp = pathlib.Path(os.fsdecode(p))
    except (TypeError, ValueError):
        return None
    if not rp.is_absolute():
        rp = pathlib.Path(cwd) / rp
    try:
        rp = rp.resolve()
    except OSError:  # pragma: no cover - resolve() is strict=False, so this needs a broken mount
        return None
    root = pathlib.Path(root).resolve()
    try:
        rel = rp.relative_to(root)
    except ValueError:
        return None
    ch = root / "capture-host"
    if rp == ch or ch in rp.parents:
        return None
    return str(rel)


def record(seen, p, how, root, cwd):
    """Add one observation. Returns the recorded path, or None when `p` is not a root path."""
    rel = relativise(p, root, cwd)
    if rel is None:
        return None
    seen.setdefault(rel, set()).add(how)
    return rel


def _mode_is_write(mode):
    return isinstance(mode, str) and any(c in mode for c in "wax+")


def audit(event, args, seen, root, cwd):
    """One audit event into `seen`. `open` carries (path, mode, flags); `subprocess.Popen` carries
    (executable, args, cwd, env), and every argv member is a candidate path because a node runner is
    invoked as `node <root-relative script>`."""
    if event == "open":
        mode = args[1] if len(args) > 1 else None
        return [record(seen, args[0], "write" if _mode_is_write(mode) else "read", root, cwd)]
    if event == "subprocess.Popen":
        out = [record(seen, args[0], "exec", root, cwd)]
        argv = args[1] if len(args) > 1 else None
        if isinstance(argv, (list, tuple)):
            for a in argv:
                out.append(record(seen, a, "exec", root, cwd))
        return out
    return []


def dump(seen, out_path):
    """Append this process's observations. Every xdist worker appends, so the fold deduplicates."""
    path = pathlib.Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        for rel in sorted(seen):
            fh.write(json.dumps({"path": rel, "how": sorted(seen[rel])}) + "\n")


def install(out_path, root, add_hook=None, at_exit=None, cwd=None):
    """Install the hook. An audit hook cannot be removed once added, so the caller supplies both
    registrars and the tests never arm the real interpreter."""
    seen = {}
    cwd = cwd or os.getcwd()
    (add_hook or sys.addaudithook)(lambda event, args: audit(event, args, seen, root, cwd) and None)
    (at_exit or atexit.register)(lambda: dump(seen, out_path))
    return seen


def pytest_configure(config):  # noqa: ARG001 - pytest's plugin entry point
    """Arm the hook only when asked — see the module docstring for the measured invocation."""
    out = os.environ.get("ROOTREADS_OUT")
    if not out:
        return None
    return install(out, os.environ.get("ROOTREADS_ROOT") or repo_root())


def tracked_files(root):
    """The paths git knows at this root. A manifest entry a PR diff can never name is noise."""
    r = subprocess.run(["git", "-C", str(root), "ls-files"], capture_output=True, text=True, check=False)
    if r.returncode != 0:  # pragma: no cover - needs a non-repo root
        raise SystemExit("git ls-files failed, so tracked status is unknown and nothing was written")
    return {line for line in r.stdout.split("\n") if line}


def named_root_reads(root):
    """The root paths the suite's own static derivation names, as `mutation_diff.root_reads` yields
    them. Entries under capture-host/ are dropped: the filter already runs on all of them."""
    sys.path.insert(0, str(pathlib.Path(root) / "capture-host"))
    import mutation_diff

    ch = str(pathlib.Path(root) / "capture-host")
    return {p for p in mutation_diff.root_reads(ch) if not p.startswith("capture-host/")}


def fold(lines, root, tracked, named=frozenset()):
    """Fold trace lines into the manifest. Every observed path lands in exactly one class."""
    seen = {}
    for line in lines:
        line = line.strip()
        if not line:
            continue
        d = json.loads(line)
        seen.setdefault(d["path"], set()).update(d["how"])
    paths, excluded = [], []
    for rel in sorted(set(seen) | set(named)):
        how = sorted(seen.get(rel, ()))
        found = (["traced"] if rel in seen else []) + (["named"] if rel in named else [])
        if rel in tracked:
            entry = {"path": rel, "found": found}
            if how:
                entry["how"] = how
            paths.append(entry)
        elif (pathlib.Path(root) / rel).exists():
            excluded.append({"token": rel, "how": how, "why": "present here and in no commit, so no PR diff names it"})
        else:
            excluded.append({"token": rel, "how": how, "why": "not a file — an argv token a traced subprocess carried"})
    return {
        "schema": SCHEMA,
        "command": COMMAND,
        "paths": paths,
        "excluded": excluded,
    }


def main(argv, root=None):
    root = root or repo_root()
    if "--fold" not in argv:
        print("usage: root_reads.py --fold <trace.jsonl> [--out <manifest.json>]", file=sys.stderr)
        return 2
    src = argv[argv.index("--fold") + 1]
    dest = argv[argv.index("--out") + 1] if "--out" in argv else MANIFEST
    with open(src, encoding="utf-8") as fh:
        rec = fold(fh, root, tracked_files(root), named_root_reads(root))
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(rec, fh, indent=2)
        fh.write("\n")
    print(f"wrote {dest} — {len(rec['paths'])} tracked root path(s), {len(rec['excluded'])} excluded")
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised by tests through main()
    raise SystemExit(main(sys.argv[1:]))
