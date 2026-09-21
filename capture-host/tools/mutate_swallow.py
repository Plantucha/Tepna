#!/usr/bin/env python3
# tepna-capture — tools/mutate_swallow.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# WHICH SURVIVING MUTANTS ARE A FAKE'S FAULT — the plumbing for `mutation_swallow.py`.
#
# Residue `2026-09-20-fake-accepts-and-drops-is-suite-wide` recorded two greps that disagreed (58/35 vs
# 24/29 files) and said: derive the population from mutation SURVIVORS, not from syntax. This tool does
# that. It reads the gate's own survivor records (`mutation-diff.json` artifacts, one per CI run, or any
# JSON with a `survivors` list), selects each module's tests exactly as the gate does
# (`mutation_sweep.select_tests`), and reports THREE numbers side by side so neither can be quoted as
# the other: swallowing FAKES (the grep-shaped population), call-argument SURVIVORS, and the
# intersection — survivors ATTRIBUTABLE to a swallowed argument, each with the fake's file and line.
#
# ⚠️ A survivor in an artifact is a survivor AS SEEN BY THAT RUN. Artifacts come from failing and
# intermediate runs too, so a row here may have been killed since; the row is where to LOOK, not a
# verdict that the mutant is still alive. Re-run the gate on the module to settle it.
#
#   python3 tools/mutate_swallow.py <artifact.json|dir> [...]   # report
#   python3 tools/mutate_swallow.py … --json                     # machine-readable
#   python3 tools/mutate_swallow.py --selftest                   # the plants
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import mutation_swallow as M  # noqa: E402
from mutation_sweep import select_tests  # noqa: E402


def load_survivors(paths: list[str]) -> list[dict]:
    """Every `survivors[]` record under the given files/directories (recursing into dirs for *.json)."""
    out: list[dict] = []
    for p in paths:
        pp = Path(p)
        files = sorted(pp.rglob("*.json")) if pp.is_dir() else [pp]
        for f in files:
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue   # an unreadable artifact contributes nothing and is not an error of the corpus
            if isinstance(d, dict) and isinstance(d.get("survivors"), list):
                out.extend(r for r in d["survivors"] if isinstance(r, dict))
    return out


def selections(modules: set[str], tests_dir: Path) -> dict[str, dict[str, str]]:
    """The gate's own test selection per module — `{module: {test path: text}}`."""
    cands = [(f"tests/{t.name}", t.read_text(encoding="utf-8")) for t in sorted(tests_dir.glob("test_*.py"))]
    by_path = dict(cands)
    return {m: {k: by_path[k] for k, _ in [(k, None) for k in select_tests(cands, m[:-3])[0]] if k in by_path} for m in modules}


def report(r: M.Attribution) -> str:
    lines = [
        f"mutate-swallow: {r['survivors']} unique survivor(s) read · {r['call_argument']} sit inside a call argument · "
        f"{r['attributable']} ATTRIBUTABLE to a swallowing fake in the module's own selection",
        f"  candidate fakes (grep-shaped population, NOT a defect count): {sum(r['candidates'].values())} across "
        f"{len(r['candidates'])} test file(s)",
    ]
    by: dict[tuple[str, str], list[dict]] = {}
    for row in r["rows"]:
        by.setdefault((row["module"], row["callee"]), []).append(row)
    for (mod, callee), rows in sorted(by.items(), key=lambda kv: -len(kv[1])):
        fakes = sorted({(f["test"], f["line"], f["shape"], ",".join(f["unused"])) for row in rows for f in row["fakes"]})
        lines.append(f"  ▸ {mod} → {callee}(): {len(rows)} survivor(s) on {sorted({row['arg'] for row in rows})}")
        for t, ln, shape, unused in fakes:
            lines.append(f"      fake at {t}:{ln} ({shape}) swallows {unused}")
    if not r["rows"]:
        lines.append("  (no survivor attributable to a swallowed argument in this corpus)")
    return "\n".join(lines)


def selftest() -> int:
    fails: list[str] = []

    def check(name: str, cond: bool) -> None:
        if not cond:
            fails.append(name)

    # the residue's own example: a kwarg-swallowing BleakClient lambda and a no-op sleep
    test_text = (
        "import asyncio\n"
        "def test_x(monkeypatch):\n"
        "    monkeypatch.setattr(mod, 'BleakClient', lambda addr, **kw: FakeClient())\n"
        "    monkeypatch.setattr(asyncio, 'sleep', _nosleep)\n"
        "async def _nosleep(secs):\n"
        "    return None\n"
        "class FakeFh:\n"
        "    def seek(self, *a, **k):\n"
        "        return 0\n"
        "    def write(self, data):\n"
        "        self.buf.append(data)\n"
    )
    fakes = M.swallowing_fakes(test_text)
    names = {(f["name"], f["shape"]) for f in fakes}
    check("setattr lambda swallowing **kw is found", ("BleakClient", "setattr-lambda") in names)
    check("setattr def whose param is never read is found", ("sleep", "setattr-def") in names)
    check("fake method with *a/**k unread is found", ("seek", "def") in names)
    check("a method that READS its parameter is NOT a swallower", not any(f["name"] == "write" for f in fakes))
    check("the test function itself is never listed", not any(f["name"] == "test_x" for f in fakes))
    # call-argument detection on the gate's key shape
    ca = M.call_argument_of("client = BleakClient(addr, timeout=20.0)", "client = BleakClient(addr, timeout=21.0)")
    check("keyword argument mutation is located", ca == {"callee": "BleakClient", "kind": "kw", "which": "timeout"})
    ca2 = M.call_argument_of("    _t.seek(-1, 2)", "    _t.seek(+1, 2)")
    check("positional argument mutation on an indented line is located", ca2 == {"callee": "seek", "kind": "pos", "which": 0})
    check("a callee change is NOT an argument mutation", M.call_argument_of("x = f(1)", "x = g(1)") is None)
    check("a non-call mutation is None", M.call_argument_of("if a > b:", "if a >= b:") is None)
    check("a `return` fragment parses", M.call_argument_of("return int(x, 10)", "return int(x, 11)") == {"callee": "int", "kind": "pos", "which": 1})
    # attribution: the intersection, and each negative control
    surv = [
        {"module": "mod.py", "key": "-client = BleakClient(addr, timeout=20.0) | +client = BleakClient(addr, timeout=21.0)"},
        {"module": "mod.py", "key": "-await asyncio.sleep(0.5) | +await asyncio.sleep(1.5)"},
        {"module": "mod.py", "key": "-fh.write(data) | +fh.write(None)"},
        {"module": "mod.py", "key": "-if a > b: | +if a >= b:"},
        {"module": "other.py", "key": "-client = BleakClient(addr, timeout=20.0) | +client = BleakClient(addr, timeout=21.0)"},
        {"module": "mod.py", "key": "-client = BleakClient(addr, timeout=20.0) | +client = BleakClient(addr, timeout=21.0)"},  # duplicate
    ]
    r = M.attribute(surv, {"mod.py": {"tests/test_mod.py": test_text}, "other.py": {}})
    check("survivors are deduplicated by (module, key)", r["survivors"] == 5)
    check("four survivors sit in a call argument (BleakClient ×2 modules, sleep, write)", r["call_argument"] == 4)
    check("two are attributable (BleakClient timeout, sleep secs); write reads its arg; other.py has no fakes", r["attributable"] == 2)
    check("the row names the fake's file and line", bool(r["rows"]) and r["rows"][0]["fakes"][0]["test"] == "tests/test_mod.py" and r["rows"][0]["fakes"][0]["line"] == 3)
    check("candidates are counted per file beside the attribution", r["candidates"] == {"tests/test_mod.py": 3})
    # a survivor whose callee is faked ONLY in a test outside the module's selection is NOT attributed
    r2 = M.attribute(surv[:1], {"mod.py": {}, "zzz.py": {"tests/test_zzz.py": test_text}})
    check("a fake outside the module's selection cannot have let the mutant survive", r2["attributable"] == 0 and r2["call_argument"] == 1)
    check("parse_key rejects a malformed key", M.parse_key("no separator") is None and M.parse_key("+a | -b") is None)
    check("swallowing_fakes tolerates unparseable text", M.swallowing_fakes("def (:") == [])
    n = 19
    if fails:
        print("\n".join("  ✗ " + f for f in fails))
        print(f"{len(fails)} failed of {n}")
        return 1
    print(f"all {n} selftests passed")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="*", help="mutation-diff.json artifacts or directories of them")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if not a.paths:
        ap.error("give at least one artifact or directory (or --selftest)")
    surv = load_survivors(a.paths)
    modules = {s.get("module", "") for s in surv if s.get("module")}
    r = M.attribute(surv, selections(modules, HERE / "tests"))
    print(json.dumps(r, indent=2) if a.json else report(r))
    return 0


if __name__ == "__main__":  # pragma: no cover — the entry point; main() is tested directly
    sys.exit(main())
