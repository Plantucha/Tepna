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

# §3 (OXYII-G1-FOLLOWUPS) — run_one's `error` key covers ONE failure (no test names the module); a mutmut
# that crashed AFTER generation returns a real rc and no error, and the loop below counted it as a clean,
# empty run — the module dropped out of the gate while listed as covered. mmeta reads the scratch's meta
# to count mutants actually TESTED, the direct signal that heuristic misses. Loaded by path (script cwd).
import importlib.util as _ilu

_mmspec = _ilu.spec_from_file_location("mmeta", HERE / "mmeta.py")
mmeta = _ilu.module_from_spec(_mmspec)
_mmspec.loader.exec_module(mmeta)


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


def refusal_reason(venv_exists: bool, probe_rc: int | None) -> str | None:
    """Why this run cannot be trusted to have checked anything — or None if it can.

    THE GATE USED TO FAIL OPEN, and this is the guard for it. With mutmut absent every
    `run_one` returns `{"error": ...}`, the caller prints and continues, `blocking` ends up
    empty, and the run prints "every mutant on the changed functions was killed" with
    `survivors: []`. That is a GREEN VERDICT ABOUT ZERO MUTANTS — the check reporting success
    about something it never examined, the same shape as a `-k` filter that matches nothing or
    a `pytest` line without `--cov`. Recorded in PAT-OFFSET-ESTIMATOR-FOLLOWUPS.

    Pure on purpose: the caller gathers the two facts, this decides. That keeps the decision
    pinnable by `--selftest` without spawning anything, exactly as `classify` is.

    `probe_rc is None` means the interpreter itself could not be launched (OSError), which is a
    different cause from mutmut being absent under a working interpreter — worth distinct text,
    because the remedies differ (create the venv vs install the tool).

    ⚠️ `probe_rc` MUST come from `python -c "import mutmut"`, never from `--help`. Measured
    2026-08-15 on this repo's own venv: mutmut 3.7.0 is installed and imports fine, yet
    `-m mutmut --help` exits 1 on a broken `safe_setproctitle` import and `mutmut --help` exits 1
    on a missing `source_paths`. A `--help` probe would therefore REFUSE on a machine where the
    gate works — trading a false green for a false red, which is not an improvement. Import
    presence is the property this guard is actually about.
    """
    if not venv_exists:
        return ("the capture-host venv is missing — expected an interpreter at .venv/bin/python. "
                "Create it (python -m venv .venv && .venv/bin/pip install -e '.[dev]') and re-run.")
    if probe_rc is None:
        return ("the venv interpreter could not be launched. The path exists but is not executable "
                "or is a broken symlink.")
    if probe_rc != 0:
        return ("mutmut is not importable under the venv interpreter "
                "(`.venv/bin/python -c 'import mutmut'` exited non-zero). Install it into the venv; "
                "without it this gate generates no mutants and would report success.")
    return None


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
    # The fail-open guard. Pinned here rather than in tests/ on purpose: nothing under tools/ is
    # imported by the pytest suite, so a test importing this module would be the first — and would
    # drag a 366-line uncovered file into the --cov-fail-under=100 floor and red CI for a reason
    # unrelated to the change. The tool tests itself, as `classify` already does.
    for label, args, want_none in (
        ("healthy", (True, 0), True),
        ("mutmut absent", (True, 1), False),
        ("interpreter unlaunchable", (True, None), False),
        ("venv missing", (False, None), False),
        ("venv missing outranks a 0 rc", (False, 0), False),
    ):
        got = refusal_reason(*args)
        if (got is None) != want_none:
            print(f"  selftest FAIL: refusal_reason({label}) -> {got!r}")
            ok = False
    # the three refusal texts must be DISTINCT — they prescribe different remedies
    if len({refusal_reason(True, 1), refusal_reason(True, None), refusal_reason(False, None)}) != 3:
        print("  selftest FAIL: refusal reasons are not distinguishable")
        ok = False
    print("  selftest: classify + diff_key + refusal_reason OK" if ok else "  selftest: FAILED")
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

    # ── PREFLIGHT — refuse rather than green when the gate cannot actually run ──────────────
    # Checked BEFORE any work, because the failure is total: no mutmut means no mutants for any
    # module, and the loop below would report every one of them as clean.
    #
    # Exit 2, and NOT suppressed by --report-only. That flag's contract is "never exit non-zero"
    # about FINDINGS; this is not a finding, it is the tool being unable to look, and hiding it
    # behind report-only would re-create the exact false green this guard exists to remove. The
    # distinct code also lets a caller tell "could not check" from "found survivors" (exit 1).
    try:
        _rc: int | None = subprocess.run(
            [str(VENV_PY), "-c", "import mutmut"], capture_output=True, text=True).returncode
    except OSError:
        _rc = None
    _why = refusal_reason(VENV_PY.exists(), _rc)
    if _why:
        print(f"mutate-diff: REFUSING — {_why}")
        print("  Nothing was mutated, so nothing can be concluded. This is deliberately not a pass:\n"
              "  a gate that cannot see must not report green.")
        return 2

    import importlib.util
    spec = importlib.util.spec_from_file_location("mut", HERE / "tools" / "mutate.py")
    mut = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mut)

    # A REFUTED entry can only be detected by knowing the full GENERATED set: a claimed key that was
    # generated but is not surviving was killed, so the claim is false. Enumerating that costs one
    # `mutmut show` per mutant, paid ONLY for modules the equivalence file actually claims.
    _equiv_pre = load_equivalence()
    generated_keys: set = set()
    # The preflight proves mutmut IMPORTS; these prove it actually ran. Measured on this repo's own
    # venv, importable-but-unusable is a real state, not a hypothetical — so an import check alone
    # would still fail open. If every invocation errored, no mutant was ever tested.
    _attempted = _ran = 0
    _crashed: list = []          # §3 — globs that returned no error yet tested zero mutants (silent drop-out)
    _nothing_to_mutate: list = []  # §3b — globs with NO generated mutants: benign, not a failure
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
            _attempted += 1
            r = mut.run_one(module, only=g)
            if r.get("error"):
                print(f"    ! {g}: {r['error']}")
                continue
            _ran += 1
            work = Path(r["work"])
            # §3 — run_one returned no error, but did mutmut actually TEST anything? A crash after
            # generation (a collection failure, a bad conftest) leaves the mutants recorded as null in the
            # meta and hands back a clean-looking run with no survivors. Count the DECIDED mutants for this
            # glob; zero means it dropped out while listed as covered — record it and refuse below, exactly
            # as the preflight does, rather than banking an empty survivor list as a pass.
            if mmeta.tested_count(work, module, g) == 0:
                # ⚠️ 0-tested has TWO causes and only one is a failure. A function with no mutable
                # operator generates nothing, and mutmut signals that by crashing rather than saying
                # so — refusing on it reds a rename or a docstring edit. Ask the mutants file which
                # case this is before deciding. (Measured: oxy_inventory.identity, 138 mutants in the
                # file, 0 under its glob, whole run refused.)
                if mmeta.generated_count(work, module, g) == 0:
                    print(f"    · {g}: no mutable operator in this function — nothing to test")
                    _nothing_to_mutate.append(g)
                    continue
                print(f"    ! {g}: mutants were generated but 0 tested — a crash after generation, not "
                      f"a clean run (the meta's exit codes are all null under this glob)")
                _ran -= 1
                _crashed.append(g)
                continue
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

    # §3 — a glob that returned no error but tested zero mutants dropped out silently: the module was
    # listed as covered and its survivors read empty, which is the exact false green this measures
    # against. Refuse if ANY glob did this, even when others ran cleanly — the mixed case the all-failed
    # check below cannot see (it fires only when NOTHING ran).
    if _crashed:
        print(f"\nmutate-diff: REFUSING — {len(_crashed)} glob(s) recorded 0 tested mutants "
              f"({', '.join(_crashed)}). Each was listed as covered but its mutmut invocation crashed "
              "after generation, so an empty survivor list there means 'not checked', not 'all killed'.")
        print("  Deliberately not a pass: a gate that cannot see must not report green.")
        return 2

    # Every invocation failed. The loop above prints each error and continues — right per glob (one
    # broken function must not hide the others), catastrophic in aggregate, because `blocking` is
    # then empty and the run prints success. Refuse for the same reason as the preflight: nothing
    # was tested, so nothing was shown. This is the layer the import check cannot cover.
    # A glob with nothing to mutate is counted in `_attempted` but is not a failure, so it must not
    # feed the all-or-nothing refusal either: otherwise a diff touching only unmutable functions reds.
    if _nothing_to_mutate and not _ran and not _crashed and len(_nothing_to_mutate) == _attempted:
        print(f"\nmutate-diff: {len(_nothing_to_mutate)} changed function(s) had no mutable operator — "
              "nothing to test, and nothing to conclude. Not a failure.")
        if a.json:
            Path(a.json).write_text(json.dumps(verdict, indent=2), encoding="utf-8")
        return 0
    if _attempted and not _ran:
        print(f"\nmutate-diff: REFUSING — all {_attempted} mutmut invocation(s) failed, so no mutant "
              "was generated or tested. The per-glob errors are above.")
        print("  Deliberately not a pass: a gate that cannot see must not report green.")
        return 2

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
        # ⚠️ `.get`, NOT `e['key']`. `classify` above reads the key with `.get("key", "")`, so an entry
        # WITHOUT one is tolerated there — classified orphaned, since "" matches no generated mutant —
        # and then crashed HERE on the direct subscript. The two halves disagreed about whether a
        # malformed entry is survivable.
        #
        # It is reachable and it fired: this file's entries are matched on the whitespace-normalised
        # DIFF (`diff_key`), but the JS sibling's entries are shaped `{line, op, before}`, and 422 of
        # the 424 entries carry that shape. They never crash only because entries are filtered to the
        # modules THIS diff touched — so the landmine waits for the first PR that both adds a
        # Python-side entry and changes that module. That was #1681, and it took the gate down with a
        # KeyError instead of reporting the malformed entry.
        #
        # A gate that CRASHES reports nothing at all: no survivor list, no verdict, and a red check
        # whose log is a traceback. That is strictly worse than the orphan it was trying to describe.
        k = e.get("key")
        shown = repr(k[:90]) if k else (
            f"<entry has no `key` — it carries {sorted(x for x in e if x != 'module')}. "
            f"This file matches on the whitespace-normalised diff; see _README>")
        # ⚠️ THERE IS A THIRD CAUSE, and it is the COMMON one in a diff-scoped run. Entries are
        # filtered to the modules this diff touched, but mutants are generated only for the FUNCTIONS
        # it changed — so every entry filed against another function in the same module matches
        # nothing, forever, through no fault of its own. Measured: two `load_rows` entries fired on a
        # PR that changed only `make_row`, and they would fire on every future PR touching that file.
        # A warning that cannot be acted on is the "trains people to ignore it" failure this file's
        # own header names, so the three causes are now distinguished instead of merged.
        #
        # The discriminator is cheap and needs no scope plumbing: if the entry's `before` text is
        # STILL PRESENT VERBATIM in the module, the line did not move and the entry is not stale —
        # it is simply out of scope for this diff.
        before = k.split(" | + ")[0][2:].strip() if k and k.startswith("- ") else None
        in_source = False
        if before:
            try:
                in_source = before in (HERE / e["module"]).read_text(encoding="utf-8")
            except OSError:
                in_source = False
        if in_source:
            print(f"  out-of-scope equivalence entry ({e['module']}): {shown} — its line is unchanged "
                  "in the module but its function is not in this diff, so no mutant was generated for "
                  "it. Not stale, and nothing to do.")
        else:
            print(f"  ORPHANED equivalence entry ({e['module']}): no generated mutant matches "
                  f"{shown} — the line moved, or the entry is malformed. It excuses nothing until "
                  "re-verified.")
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
