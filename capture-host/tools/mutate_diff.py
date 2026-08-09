#!/usr/bin/env python3
# tepna-capture — tools/mutate_diff.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# DIFF-SCOPED MUTATION GATE — the one form of mutation testing that belongs in CI.
#
# `tools/mutate.py` is the audit: it sweeps a whole module and hands back leads for a human to triage.
# It must never be a gate, because a large fraction of any module's survivors are legitimately
# untestable (a log string, an unreachable defensive branch, a float boundary), and a gate that reds on
# those gets switched off — which is worse than not having one.
#
# THIS is the gate, and the difference is scope, not severity: mutate only the functions a PR actually
# TOUCHED, and require those mutants killed. It never judges pre-existing code, so it cannot inherit a
# backlog; it enforces exactly one rule, and it is the rule the 2026-08-02 audit showed was missing —
#
#     IF YOU CHANGED THIS LINE, SOME TEST CAN SEE IT.
#
# Precedent for why that rule pays: diskguard.py sat at 100% statement+branch coverage while
# `min_free_gb > 0 and free_gb < min_free_gb` could be flipped to `or` — turning the low-disk alert into
# one that fires on every poll forever — with the whole suite green. Coverage asked "did this line
# run?"; nothing asked "would anyone notice if it were wrong?"
#
# ── Deliberate design choices ────────────────────────────────────────────────────────────────────────
#
# * FUNCTION granularity, not line. mutmut names mutants per function (`module.x_func__mutmut_N`), and
#   a changed line's mutants are addressed by the enclosing function. Slightly wider than the diff,
#   which is the safe direction: it catches a changed line whose behaviour is only observable through
#   a sibling line.
# * STRING-LITERAL mutants are excluded. 29 of the 33 survivors on capture.py's `_now` were mutations
#   of log-message wording. Requiring those killed would mean asserting on log prose, which is exactly
#   the kind of test that makes a suite brittle without making it truthful.
# * NO-OP ON A PR THAT TOUCHES NO PYTHON. Prints, exits 0. A gate that runs when it has nothing to say
#   trains people to ignore it.
# * It reports the mutmut command to reproduce each survivor, because a CI failure that cannot be
#   re-run locally is a wall, not a signal.
# * EQUIVALENT MUTANTS ARE RECORDED WITH EVIDENCE, NOT ARGUED IN A PR COMMENT. Some survivors cannot
#   be killed by ANY input. `if not (len(tail) == 6 and tail.isdigit())` mutated to `or` is one: every
#   string the weakened guard lets through then fails `strptime(tail, "%H%M%S")` and returns False by
#   the same path, so no input distinguishes them (probed over 133,495 generated names, zero
#   difference). Leaving those red forever is precisely how this file's own header says a gate dies —
#   "trains people to ignore it" — and waving them through in prose is how it starts lying.
#   So the classification lives in `tools/mutate-equivalence.json`, mirroring the JS sibling at the
#   repo root, and it CANNOT flatter the verdict: an entry excuses a mutant only while that mutant is
#   BOTH still generated AND still surviving. Three states are reported loudly, never absorbed:
#     REFUTED  — the entry claims equivalence and the mutant was KILLED. A distinguishing input exists
#                after all, so the entry is wrong. Fix the entry, never the test that killed it. This
#                is the only way a stale file could hide a real gap, so it FAILS the gate.
#     ORPHANED — the entry matches no generated mutant (the line moved). Excluded from every count, so
#                a stale entry shrinks nothing.
#     unclassified survivors fail the gate exactly as before. Silence is never equivalence.
#   Keyed on the mutant's own DIFF (its -/+ line pair), never on mutmut's `__mutmut_N` index — that
#   index renumbers whenever anything earlier in the function changes, so an entry keyed on it would
#   silently begin excusing a DIFFERENT mutation.
#
#   python tools/mutate_diff.py --base origin/main
#   python tools/mutate_diff.py --base origin/main --report-only     # never exit non-zero

from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
VENV_PY = HERE / ".venv" / "bin" / "python"
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def changed_lines(base: str) -> dict[str, set[int]]:
    """{module.py: {changed line numbers}} for capture-host's own top-level modules.

    `--unified=0` so the hunk headers bound only genuinely changed lines rather than context — context
    lines would pull in neighbouring functions nobody touched, and a gate that blames you for your
    neighbour's code is one you learn to ignore."""
    out: dict[str, set[int]] = {}
    diff = subprocess.run(
        ["git", "diff", "--unified=0", f"{base}...HEAD", "--", "capture-host/*.py"],
        cwd=HERE.parent, capture_output=True, text=True)
    if diff.returncode != 0:
        raise SystemExit(f"git diff failed: {diff.stderr.strip()}")
    current: str | None = None
    for line in diff.stdout.splitlines():
        if line.startswith("+++ b/"):
            p = line[6:]
            name = Path(p).name
            # Only this package's own top-level modules; tests and subdirs are not mutated.
            current = name if p == f"capture-host/{name}" and name.endswith(".py") else None
            continue
        if current and (m := _HUNK.match(line)):
            start, count = int(m.group(1)), int(m.group(2) or 1)
            if count:                       # count 0 means a pure deletion — nothing new to mutate
                out.setdefault(current, set()).update(range(start, start + count))
    return {k: v for k, v in out.items() if v}


def functions_covering(path: Path, lines: set[int]) -> set[str]:
    """mutmut mutant-name stems for the functions containing `lines`.

    Module-level functions are `x_<name>`; methods are `xǁ<Class>ǁ<name>` (mutmut's own separator).
    A changed line outside any function (an import, a module constant) yields nothing — mutmut does not
    generate mutants there under a function name, so there is nothing to require."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError):
        return set()
    found: set[str] = set()

    def visit(node, cls: str | None):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                lo = child.lineno
                hi = max((getattr(n, "end_lineno", lo) or lo) for n in ast.walk(child))
                if any(lo <= ln <= hi for ln in lines):
                    found.add(f"xǁ{cls}ǁ{child.name}" if cls else f"x_{child.name}")
                visit(child, cls)
            elif isinstance(child, ast.ClassDef):
                visit(child, child.name)
            else:
                visit(child, cls)

    visit(tree, None)
    return found


def is_string_only(diff_text: str) -> bool:
    """True when a mutant changes nothing but a string literal — log wording and error prose.

    Requiring these killed means asserting on message text, which makes a suite brittle without making
    it more truthful. 29 of 33 survivors on capture.py's `_now` were exactly this."""
    added = [ln for ln in diff_text.splitlines() if ln.startswith("+") and not ln.startswith("+++")]
    if not added:
        return False
    return all(("XX" in ln) or ('"' in ln) or ("'" in ln) for ln in added)


EQUIV_FILE = HERE / "tools" / "mutate-equivalence.json"
# The classes that genuinely cannot be killed, and so stop failing the gate. `real-gap` is deliberately
# NOT here: it is debt somebody wrote down, not an excuse, and it keeps failing until a test exists.
EXCUSING = frozenset({"no-distinguishing-input", "untestable-by-design"})


def load_equivalence() -> dict:
    """The recorded classification, or {} if absent — a missing file must not crash the gate."""
    try:
        raw = json.loads(EQUIV_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if isinstance(raw, dict):
        raw.pop("_README", None)
        return raw
    return {}


def diff_key(diff_text: str) -> str:
    """A mutant's stable identity: its changed lines, whitespace-normalised.

    NOT `__mutmut_N`. That index shifts whenever anything earlier in the function changes, so an entry
    keyed on it would keep matching while silently pointing at a different mutation — the failure this
    whole mechanism exists to make impossible."""
    keep = [ln for ln in diff_text.splitlines()
            if ln.startswith(("-", "+")) and not ln.startswith(("---", "+++"))]
    return " | ".join(" ".join(ln.split()) for ln in keep)


def classify(entries, survivors, generated):
    """Split survivors against the recorded classification.

    PURE, so `--selftest` can pin it without running a sweep. `survivors` are dicts carrying `key`;
    `generated` is the set of keys mutmut produced this run (survivors are generated by definition,
    so callers may pass only the killed ones)."""
    surv = {sv["key"]: sv for sv in survivors}
    gen = set(generated) | set(surv)
    out = {"excused": [], "real_gap": [], "refuted": [], "orphaned": [], "unclassified": []}
    claimed = set()
    for e in entries or []:
        k = e.get("key", "")
        claimed.add(k)
        if k not in gen:
            out["orphaned"].append(e)      # the line moved — excuses nothing until re-verified
        elif k not in surv:
            out["refuted"].append(e)       # generated, then KILLED, yet claimed unkillable
        elif e.get("class") in EXCUSING:
            out["excused"].append(e)
        else:
            out["real_gap"].append(e)      # recorded debt, still fails
    for k, sv in surv.items():
        if k not in claimed:
            out["unclassified"].append(sv)
    return out


def _selftest() -> int:
    """The classifier's own known answers. A mechanism that decides what the gate ignores has to be
    the best-tested thing in the file, so each of the five outcomes is pinned here."""
    E = [
        {"key": "a", "class": "no-distinguishing-input"},
        {"key": "b", "class": "untestable-by-design"},
        {"key": "c", "class": "real-gap"},
        {"key": "d", "class": "no-distinguishing-input"},   # generated but KILLED -> refuted
        {"key": "e", "class": "no-distinguishing-input"},   # not generated at all -> orphaned
    ]
    S = [{"key": k} for k in ("a", "b", "c", "f")]
    got = classify(E, S, {"a", "b", "c", "d", "f"})
    want = {"excused": ["a", "b"], "real_gap": ["c"], "refuted": ["d"],
            "orphaned": ["e"], "unclassified": ["f"]}
    ok = True
    for bucket, keys in want.items():
        have = sorted(x["key"] for x in got[bucket])
        if have != sorted(keys):
            print(f"  selftest FAIL {bucket}: {have} != {sorted(keys)}")
            ok = False
    # a killed mutant that nobody claimed is simply absent from every bucket
    if any(x.get("key") == "d" for x in got["unclassified"]):
        print("  selftest FAIL: a killed mutant leaked into unclassified")
        ok = False
    # diff_key ignores whitespace but not content, and drops the +++/--- headers
    if diff_key("--- a\n+++ b\n-  x = 1\n+  x  =  2\n") != "- x = 1 | + x = 2":
        print("  selftest FAIL: diff_key")
        ok = False
    if diff_key("-a\n+b\n") == diff_key("-a\n+c\n"):
        print("  selftest FAIL: diff_key collides on different mutations")
        ok = False
    print("  selftest: classify + diff_key OK" if ok else "  selftest: FAILED")
    return 0 if ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Diff-scoped mutation gate for capture-host")
    ap.add_argument("--base", default="origin/main", help="merge base to diff against")
    ap.add_argument("--report-only", action="store_true", help="never exit non-zero")
    ap.add_argument("--json", default=None, help="write the verdict here")
    ap.add_argument("--selftest", action="store_true", help="pin the classifier, run no mutants")
    a = ap.parse_args(argv)

    if a.selftest:
        return _selftest()

    changed = changed_lines(a.base)
    if not changed:
        print(f"mutate-diff: no capture-host/*.py changed against {a.base} — nothing to check.")
        return 0

    import importlib.util
    spec = importlib.util.spec_from_file_location("mut", HERE / "tools" / "mutate.py")
    mut = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mut)

    # A REFUTED entry can only be detected by knowing the full GENERATED set: a claimed key that was
    # generated but is not surviving was killed, so the claim is false. Enumerating that costs one
    # `mutmut show` per mutant, paid ONLY for modules the equivalence file actually claims.
    _equiv_pre = load_equivalence()
    generated_keys: set = set()
    verdict: dict = {"base": a.base, "modules": {}, "survivors": []}
    for module, lines in sorted(changed.items()):
        stems = functions_covering(HERE / module, lines)
        if not stems:
            print(f"  {module}: {len(lines)} changed line(s), none inside a function — skipped")
            continue
        stem_mod = module[:-3]
        globs = [f"{stem_mod}.{s}__mutmut_*" for s in sorted(stems)]
        print(f"  {module}: {len(lines)} changed line(s) in {len(stems)} function(s) → "
              f"{', '.join(sorted(stems))}", flush=True)
        # One mutmut invocation per function keeps a single slow function from hiding the others.
        for g in globs:
            r = mut.run_one(module, only=g)
            if r.get("error"):
                print(f"    ! {g}: {r['error']}")
                continue
            work = Path(r["work"])
            # ── the GENERATED set, for REFUTED detection ────────────────────────────────────────
            # `mutmut results` lists survivors and not-checked ONLY — a KILLED mutant is absent from
            # it entirely, so an earlier draft's `": killed" in line` matched nothing and REFUTED could
            # never fire. Verified by reading the actual output rather than the token I assumed.
            # The generated set comes from mutmut's own mutants file instead, where every mutant is a
            # `def x_<func>__mutmut_N(`; `mutmut show` renders killed ones fine.
            # Paid ONLY for modules the equivalence file claims, so the common path is unchanged.
            if module in _equiv_pre:
                mfile = work / "mutants" / Path(module).name
                stem_re = re.compile(r"^def (" + re.escape(g.split(".", 1)[1].rstrip("*"))
                                     + r"\d+)\(", re.M)
                try:
                    for gname in stem_re.findall(mfile.read_text(encoding="utf-8")):
                        full = f"{stem_mod}.{gname}"
                        gshow = subprocess.run([str(VENV_PY), "-m", "mutmut", "show", full],
                                               cwd=work, capture_output=True, text=True)
                        k = diff_key(gshow.stdout)
                        if k:
                            generated_keys.add(k)
                except OSError:
                    pass                      # no mutants file ⇒ nothing to enumerate, stay silent
            for line in (r.get("results") or "").splitlines():
                if ": survived" not in line:
                    continue
                name = line.split(":")[0].strip()
                show = subprocess.run([str(VENV_PY), "-m", "mutmut", "show", name],
                                      cwd=work, capture_output=True, text=True)
                if is_string_only(show.stdout):
                    continue                       # log/prose mutation — deliberately not required
                # The 400-byte cap truncated the -/+ pair mid-line in the CI artifact, so the only
                # machine-readable record of WHAT changed had to be regenerated locally to be read.
                # The changed lines alone are small and complete — carry those in full.
                verdict["survivors"].append({"mutant": name, "module": module,
                                             "key": diff_key(show.stdout),
                                             "changed": diff_key(show.stdout),
                                             "diff": show.stdout[:400], "work": str(work)})
        verdict["modules"][module] = sorted(stems)

    # ── the recorded classification ───────────────────────────────────────────────────────────
    # Applied to survivors ONLY, and only per-module, so an entry filed against a different file can
    # never reach this branch's verdict.
    equiv = load_equivalence()
    entries = [dict(e, module=m) for m, lst in equiv.items() for e in (lst or [])
               if m in verdict["modules"]]
    cls = classify(entries, verdict["survivors"], generated_keys)
    verdict["classification"] = {k: [{kk: vv for kk, vv in x.items() if kk != "work"} for x in v]
                                 for k, v in cls.items()}

    if a.json:
        Path(a.json).write_text(json.dumps(verdict, indent=2), encoding="utf-8")

    for e in cls["orphaned"]:
        print(f"  ORPHANED equivalence entry ({e['module']}): no generated mutant matches "
              f"{e['key'][:90]!r} — the line moved. It excuses nothing until re-verified.")
    for e in cls["excused"]:
        print(f"  excused ({e['class']}): {e['key'][:80]} — {e.get('why', '')[:120]}")

    # REFUTED is an ERROR, not a note: it is the one way a stale file could hide a real gap.
    if cls["refuted"]:
        print(f"\nmutate-diff: {len(cls['refuted'])} equivalence entr(y/ies) REFUTED — the mutant was "
              f"KILLED, so a distinguishing input exists and the claim is wrong:\n")
        for e in cls["refuted"]:
            print(f"  ── {e['module']}  {e['key'][:110]}")
            print(f"     claimed: {e.get('class')} — {e.get('why', '')[:140]}")
        print("\n  Fix the ENTRY, never the test that killed it. Delete it, or reclassify it as real-gap\n"
              "  with the evidence that changed.")
        return 0 if a.report_only else 1

    blocking = cls["unclassified"] + cls["real_gap"]
    if not blocking:
        n_ex = len(cls["excused"])
        print("\nmutate-diff: every mutant on the changed functions was killed"
              + (f" ({n_ex} recorded as equivalent)." if n_ex else "."))
        return 0

    print(f"\nmutate-diff: {len(blocking)} mutant(s) survived on lines this branch "
          f"changed — no test can see these edits:\n")
    for s in cls["unclassified"]:
        print(f"  ── {s['mutant']}")
        for ln in s["diff"].splitlines():
            if ln.startswith(("-", "+")) and not ln.startswith(("---", "+++")):
                print(f"     {ln}")
    for e in cls["real_gap"]:
        print(f"  ── {e['module']}  {e['key'][:110]}")
        print(f"     recorded as real-gap — debt, not equivalence: {e.get('why', '')[:140]}")
    print("\n  Each one means: change that line and the suite stays green. Either add an assertion that\n"
          "  observes it, or — if it is genuinely unkillable — record it in tools/mutate-equivalence.json\n"
          "  with a `probe` saying what you actually ran. Reproduce locally with:\n"
          "      cd capture-host && .venv/bin/python tools/mutate_diff.py --base origin/main")
    return 0 if a.report_only else 1


if __name__ == "__main__":
    raise SystemExit(main())
