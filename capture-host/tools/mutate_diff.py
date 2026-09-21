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
# DECISION LOGIC LIVES IN `mutation_diff.py`, one directory up, because that is inside the coverage
# floor and this is not. What remains here is git/subprocess/argparse/IO only. If a function you are
# adding can give a WRONG ANSWER rather than failing loudly, it belongs up there — `is_string_only`
# did exactly that for weeks while sitting here unmeasured (see that module's header).
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
import json
import re
import sys
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
VENV_PY = HERE / ".venv" / "bin" / "python"
sys.path.insert(0, str(HERE))
from mutation_diff import (  # noqa: E402
    EMPTY_DIFF, STRING_ONLY, SURVIVED, UNDECIDABLE, UNDECIDED, annotation_only, classify, diff_key,
    in_glob_scope, source_function_of_glob, undecided_by_function, unmutatable_decorator,
    functions_covering, refusal_reason, selftest, split_results, string_only_verdict,
    GATE_BUDGET_SEC, budget_refusal,
)
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")

# §3 (OXYII-G1-FOLLOWUPS) — run_one's `error` key covers ONE failure (no test names the module); a mutmut
# that crashed AFTER generation returns a real rc and no error, and the loop below counted it as a clean,
# empty run — the module dropped out of the gate while listed as covered. mmeta reads the scratch's meta
# to count mutants actually TESTED, the direct signal that heuristic misses. Loaded by path (script cwd).
import importlib.util as _ilu

_mmspec = _ilu.spec_from_file_location("mmeta", HERE / "mmeta.py")
# See the same guard in tools/mutate.py: a missing spec or loader otherwise surfaces as an
# AttributeError on None, pointing at the wrong line.
if _mmspec is None or _mmspec.loader is None:
    raise ImportError(f"cannot load mmeta from {HERE / 'mmeta.py'}")
mmeta = _ilu.module_from_spec(_mmspec)
_mmspec.loader.exec_module(mmeta)


def _read_source(path: Path) -> str:
    """The module's text, or '' when unreadable. THE READ IS PLUMBING and stays on this side of the
    split; `functions_covering` takes text. '' parses to an empty tree, so an unreadable file yields
    no function stems — byte-identical to the OSError branch this replaced."""
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


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










EQUIV_FILE = HERE / "tools" / "mutate-equivalence.json"


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










def main(argv=None) -> int:
    undecided = []   # mutants mutmut could not settle — never "killed"; see split_results
    ap = argparse.ArgumentParser(description="Diff-scoped mutation gate for capture-host")
    ap.add_argument("--base", default="origin/main", help="merge base to diff against")
    ap.add_argument("--report-only", action="store_true", help="never exit non-zero")
    ap.add_argument("--json", default=None, help="write the verdict here")
    ap.add_argument("--selftest", action="store_true", help="pin the classifier, run no mutants")
    a = ap.parse_args(argv)

    if a.selftest:
        return selftest()

    changed = changed_lines(a.base)
    if not changed:
        print(f"mutate-diff: no capture-host/*.py changed against {a.base} — nothing to check.")
        return 0

    # ── ANNOTATION-ONLY EXCLUSION (measured on #1946) ────────────────────────────────────────
    # Touching a signature line pulls the whole function into mutation scope, so four one-line
    # widenings surfaced 30 PRE-EXISTING survivors and blocked a behaviour-neutral typing PR.
    # A signature annotation does not execute; if the WHOLE file's diff strips to nothing, the
    # file leaves scope — loudly, naming the check. The comparison base is the MERGE-BASE (the
    # same ref `changed_lines`' three-dot diff measures against), never the base branch tip.
    # Fail-closed: an unreadable base version or a parse failure keeps full scope.
    _mb = subprocess.run(["git", "merge-base", a.base, "HEAD"],
                         cwd=HERE.parent, capture_output=True, text=True)
    _base_sha = _mb.stdout.strip() if _mb.returncode == 0 and _mb.stdout.strip() else a.base
    for module in sorted(changed):
        _old = subprocess.run(["git", "show", f"{_base_sha}:capture-host/{module}"],
                              cwd=HERE.parent, capture_output=True, text=True)
        if _old.returncode != 0:
            print(f"  {module}: base version unreadable — full scope kept (fail-closed)")
            continue
        # `_excl_why`, not `_why`: the refusal reason below is a DIFFERENT kind of "why" (str | None
        # vs str) and reusing one name for both makes the second assignment a type error — mypy binds
        # the name at its first assignment. Two meanings, two names.
        _excl, _excl_why = annotation_only(_old.stdout, _read_source(HERE / module))
        if _excl:
            print(f"  {module}: {len(changed[module])} changed line(s) — {_excl_why}; EXCLUDED from mutation scope")
            del changed[module]
    if not changed:
        print("mutate-diff: every changed module is signature-annotation-only — nothing behavioural to mutate.")
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
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load mutate from {HERE / 'tools' / 'mutate.py'}")
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
    # NOT the same thing, and conflating them is the defect: a property generates no mutants because
    # THIS TOOL CANNOT MUTATE ONE, so it was never examined. Counted apart so the summary can say so.
    _unexaminable: list = []
    _out_of_scope: int = 0   # undecided mutants belonging to functions the diff never touched
    verdict: dict = {"base": a.base, "modules": {}, "survivors": []}
    # ── THE RUN BUDGET (mutation_diff.GATE_BUDGET_SEC) — a refusal is a verdict, a SIGTERM is not ──
    _gate_t0 = time.monotonic()
    _refused_budget: list[str] = []
    for module, lines in sorted(changed.items()):
        _msrc = _read_source(HERE / module)   # read ONCE per module; the loop below reuses it
        stems = functions_covering(_msrc, lines)
        if not stems:
            print(f"  {module}: {len(lines)} changed line(s), none inside a function — skipped")
            continue
        stem_mod = module[:-3]
        globs = [f"{stem_mod}.{s}__mutmut_*" for s in sorted(stems)]
        print(f"  {module}: {len(lines)} changed line(s) in {len(stems)} function(s) → "
              f"{', '.join(sorted(stems))}", flush=True)
        # The clean run is timed ONCE per module and handed to every glob's run_one. Re-timing it per
        # glob was the 2026-09-17 "hang" (capture.py: 936.7 s × 5 globs before any mutant, measured).
        _tests = mut.tests_for(module)
        _clean = mut.clean_run_seconds(_tests) if _tests else (0.0, False)
        _left = GATE_BUDGET_SEC - (time.monotonic() - _gate_t0)
        _why_budget = budget_refusal(module, _clean[0], len(globs), _left)
        if _why_budget:
            print(f"  ⊘ {_why_budget}", flush=True)
            _refused_budget.append(_why_budget)
            continue
        # One mutmut invocation per function keeps a single slow function from hiding the others.
        for g in globs:
            _attempted += 1
            # ── PROGRESS, AND WHY IT IS PRINTED BEFORE THE WORK RATHER THAN AFTER ───────────────
            # A clean function used to print NOTHING: only survivors were reported, from inside the
            # results parse. So a function that killed everything in 8 s and a function that hung for
            # two hours produced identical output — none — and the run's own log could not tell them
            # apart. Measured on run 35367452829 (#2624): last output at 16:36:08 "Generating
            # mutants", then 2 h 05 m of silence, then exit 143. Nobody could say where the time went,
            # which is why a granularity change was being considered against an interval no one had
            # observed.
            # The line goes BEFORE `run_one` deliberately. Printed after, a hang is still anonymous —
            # the whole point is that the log NAMES the function currently being mutated, so a kill
            # mid-run is attributable to one glob instead of to the job.
            _t0 = time.monotonic()
            _left = int(GATE_BUDGET_SEC - (time.monotonic() - _gate_t0))
            if _left <= 0:
                _refused_budget.append(f"{g}: the {GATE_BUDGET_SEC}s gate budget was exhausted before this "
                                       f"function could be mutated — not attempted, not a verdict")
                print(f"    ⊘ {_refused_budget[-1]}", flush=True)
                _attempted -= 1
                continue
            print(f"    ▸ {g}: mutating…  [{_left}s of the gate budget left]", flush=True)
            # WALL BOUND: what is left of the gate budget is this invocation's cap. A cap that is hit
            # comes back with partial counts behind `timed_out`, and the gate refuses on it below.
            r = mut.run_one(module, only=g, clean=_clean, timeout=max(1, _left))
            _secs = time.monotonic() - _t0
            if r.get("error"):
                print(f"    ! {g}: {r['error']}  [{_secs:.0f}s]", flush=True)
                continue
            if r.get("timed_out"):
                _refused_budget.append(f"{g}: hit the gate budget after {_secs:.0f}s — partial counts only "
                                       f"({r.get('tail', '')[-120:].strip() or 'no output'}). A mutant that never ran "
                                       f"is not a survivor and not a kill.")
                print(f"    ⊘ {_refused_budget[-1]}", flush=True)
                continue
            _ran += 1
            work = Path(r["work"])
            # §3 — run_one returned no error, but did mutmut actually TEST anything? A crash after
            # generation (a collection failure, a bad conftest) leaves the mutants recorded as null in the
            # meta and hands back a clean-looking run with no survivors. Count the DECIDED mutants for this
            # glob; zero means it dropped out while listed as covered — record it and refuse below, exactly
            # as the preflight does, rather than banking an empty survivor list as a pass.
            _tested = mmeta.tested_count(work, module, g)
            if _tested == 0:
                # ⚠️ 0-tested has TWO causes and only one is a failure. A function with no mutable
                # operator generates nothing, and mutmut signals that by crashing rather than saying
                # so — refusing on it reds a rename or a docstring edit. Ask the mutants file which
                # case this is before deciding. (Measured: oxy_inventory.identity, 138 mutants in the
                # file, 0 under its glob, whole run refused.)
                if mmeta.generated_count(work, module, g) == 0:
                    # ⚠️ THE MESSAGE STATES WHAT IS KNOWN, NOT AN INFERRED CAUSE. mutmut generated
                    # nothing under this glob; WHY is not established here, and the two known causes
                    # are different findings. A function with no mutable operator is genuinely nothing
                    # to test. An `@property` is not — measured 2026-09-18, mutmut emits ZERO mutants
                    # for a property whose body is `return self.a + self.b`, a perfectly mutatable `+`.
                    # So for properties this is a limitation of the TOOL reported as a property of the
                    # CODE, and every `@property` body in the tree is consequently unmutated. Saying
                    # "no mutable operator" would assert a cause nobody checked — the same shape as
                    # the guard above, which asserted a benign outcome it could not distinguish.
                    # ⚠️ An `AssertionError: Filtered for specific mutants, but nothing matches` appears
                    # above this line and is EXPECTED: mutmut asserts on a filter matching nothing,
                    # `run_one` uses Popen so it reaches the log, and this tool reads the count and
                    # continues. Handled, not a crash.
                    # ⚠️ TWO CAUSES, ONE COUNT, AND ONLY ONE OF THEM IS "NOTHING TO TEST".
                    # mutmut emits no mutants for an `@property` at all — measured on a body of
                    # `return self.a + self.b`. So a zero here means either the function genuinely has
                    # no mutable operator (benign, examined, clean) or this tool cannot examine it.
                    # Saying "no mutable operator" for the second is a wrong diagnosis of a right
                    # number: it reports a limitation of the TOOL as a property of the CODE, and a
                    # reader takes it as coverage. Measured 2026-09-18: 45 properties in capture-host,
                    # all generating zero, 15 with genuinely mutatable bodies, and all 15 changed this
                    # quarter — so this is an active blind spot, not a theoretical one.
                    _dec = unmutatable_decorator(_msrc, source_function_of_glob(g))
                    if _dec:
                        print(f"    ⊘ {g}: NOT EXAMINED — mutmut skips @{_dec}"
                              f"  [{_secs:.0f}s]"
                              f"\n      (it mutates by replacing a function with a trampoline, which a"
                              f" decorated function cannot be rebound to. Zero mutants whatever the body"
                              f"\n       contains — a blind spot, not a clean result.)", flush=True)
                        _ran -= 1
                        _unexaminable.append(g)
                        continue
                    print(f"    · {g}: mutmut generated 0 mutants under this glob — nothing to test"
                          f"  [{_secs:.0f}s]"
                          f"\n      (cause NOT established beyond 'not an @property'. The AssertionError"
                          f" above is expected.)", flush=True)
                    # `_ran` was incremented on the way in; nothing actually ran, so give it back.
                    # Without this the run reports "every mutant on the changed functions was killed"
                    # over ZERO mutants — a claim of coverage that does not exist, which is the exact
                    # failure class this guard was added to remove. (Caught by the end-to-end, not by
                    # the unit tests: the counters are only visible in a real run.)
                    _ran -= 1
                    _nothing_to_mutate.append(g)
                    continue
                print(f"    ! {g}: mutants were generated but 0 tested — a crash after generation, not "
                      f"a clean run (the meta's exit codes are all null under this glob)  [{_secs:.0f}s]", flush=True)
                _ran -= 1
                _crashed.append(g)
                continue
            # THE SUCCESS PATH, which printed nothing whatsoever before this. A function whose
            # mutants were all killed is the COMMON case, so the common case was the silent one — and
            # silence is what made a slow run indistinguishable from a healthy one. The count and the
            # elapsed are both here because either alone is ambiguous: 2 mutants in 600 s and 900
            # mutants in 600 s are different findings, and only the pair separates a wide sweep from a
            # slow one. That distinction is exactly what the granularity question needs and could not
            # get from the old log.
            print(f"    ✓ {g}: {_tested} mutant(s) decided  [{_secs:.0f}s]", flush=True)
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
            # EVERY line mutmut prints here is a mutant it did NOT kill (results() skips `killed`).
            # Keeping only `": survived"` silently dropped `timeout`/`suspicious`/`no tests`/`not
            # checked` — so a mutant that timed out under load vanished and the gate then reported
            # "every mutant on the changed functions was killed" about a mutant no test ever saw.
            # `split_results` inverts that: survivors are blocking, everything else is UNDECIDED, and
            # UNDECIDED is never killed and never refutes an equivalence entry.
            _split = split_results(r.get("results") or "")
            # 🔴 SCOPE THE HARVEST TO THE GLOB THAT WAS ACTUALLY RUN. `mutmut results` takes no glob
            # and enumerates the WHOLE workspace, so without this every mutant generated for a
            # function the diff never touched came back `not checked` and BLOCKED the run. Measured
            # over four refusals: 553/338/166/116 undecided, 100% `not checked` and 0% `timeout` —
            # never run, so nothing could time out. Counted, never silently dropped: a filter that
            # does not publish what it removed is the shape this gate exists to refuse.
            for _nm, _status in _split[UNDECIDED]:
                if not in_glob_scope(_nm, g):
                    _out_of_scope += 1
                    continue
                undecided.append({"mutant": _nm, "module": module, "status": _status})
            for name in _split[SURVIVED]:
                show = subprocess.run([str(VENV_PY), "-m", "mutmut", "show", name],
                                      cwd=work, capture_output=True, text=True)
                sverdict, sdetail = string_only_verdict(show.stdout)
                if sverdict == STRING_ONLY:
                    continue                       # log/prose mutation — deliberately not required
                if sverdict == EMPTY_DIFF:
                    # EXCLUDED, BUT NOT AS "string-only". A mutant that changes nothing is equivalent
                    # by construction, and until 2026-08-27 it was silently laundered through the
                    # string-only bucket — an exclusion the reader could not distinguish from a
                    # log-wording one. Recorded so the count is auditable rather than invisible.
                    verdict.setdefault("empty_diff", []).append({"mutant": name, "module": module})
                    continue
                if sverdict == UNDECIDABLE:
                    # REFUSE LOUDLY. The literal scan is outside its documented competence, so any
                    # verdict here would be a guess — and guessing is how this gate shipped a wrong
                    # answer before. It is reported AND still required, never silently skipped.
                    print(f"  ⚠ {name}: {sdetail} — REQUIRED rather than guessed")
                    verdict.setdefault("undecidable", []).append({"mutant": name, "module": module,
                                                                  "reason": sdetail})
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
    # ⚠️ THE BLIND SPOT IS NAMED IN THE SUMMARY, NOT ONLY PER FUNCTION. A run whose only output was a
    # per-glob line scrolls past; the count is what a reader carries away, and "0 survivors" over
    # functions this tool never opened is a coverage claim it has not earned. Measured 2026-09-18:
    # 45 properties in capture-host, all unmutatable by this tool, 15 with genuinely mutatable bodies,
    # and all 15 changed this quarter — so this line will fire on real diffs, not hypothetical ones.
    if _unexaminable:
        print(f"\n  ⊘ {len(_unexaminable)} changed function(s) were NOT EXAMINED — mutmut skips "
              f"decorated functions (except a lone @staticmethod/@classmethod):")
        for _g in _unexaminable[:8]:
            print(f"      {_g}")
        if len(_unexaminable) > 8:
            print(f"      … and {len(_unexaminable) - 8} more")
        print("    Their mutants were never generated, so nothing below speaks to them. This is a\n"
              "    limitation of the TOOL, not a finding about the code.")

    if _nothing_to_mutate and not _ran and not _crashed and len(_nothing_to_mutate) == _attempted and not _refused_budget:
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

    # UNDECIDED BLOCKS, and says so before the survivor report. A mutant mutmut could not settle
    # (timeout, suspicious, no tests, not checked) was never seen by a test, so "every mutant was
    # killed" is not a claim this run is entitled to make. Reported as its own class rather than
    # folded into survivors: a survivor means "a test COULD see this and none does", an undecided
    # means "nobody knows", and they want different responses.
    # REPORTED UNCONDITIONALLY, AND THAT PLACEMENT IS THE POINT. Inside the undecided branch this
    # line
    # would go silent in the one case that matters most — every undecided mutant out of scope, so the
    # run PASSES and nobody is told a filter ran at all. A filter that publishes its count only when
    # something survives it is not publishing a denominator.
    if _out_of_scope:
        print(f"\n  note: {_out_of_scope} undecided mutant(s) excluded as OUT OF SCOPE — `mutmut "
              "results` takes no glob and lists the whole workspace, including functions this diff\n"
              "  never touched. They were never run, so they are not evidence either way.")
    if undecided:
        by_status: dict[str, list[dict]] = {}
        for u in undecided:
            by_status.setdefault(u["status"], []).append(u)
        print(f"\nmutate-diff: REFUSING — {len(undecided)} mutant(s) UNDECIDED, so this run cannot say "
              f"they were killed:\n")
        for st, items in sorted(by_status.items()):
            print(f"  {st}: {len(items)}")
            for u in items[:6]:
                print(f"    ── {u['module']}  {u['mutant']}")
            if len(items) > 6:
                print(f"    … and {len(items) - 6} more")
        # WHICH FUNCTIONS, not just how many. A total plus six samples cannot separate the two cases
        # that need opposite responses: all of them in ONE function points at that function's mutants,
        # spread across SEVERAL points at the runner. Measured 2026-09-18 across three PRs the gate
        # refused (116, 553 and a 145-min kill), nobody could tell which shape any of them was.
        _dist = undecided_by_function(undecided)
        print("\n  by function:")
        for _fn, _n in _dist[:8]:
            print(f"    {_n:>5}  {_fn}")
        if len(_dist) > 8:
            print(f"    … and {len(_dist) - 8} more function(s)")
        # ⚠️ `timeout_multiplier` DELIBERATELY NOT RECOMMENDED HERE, and this line used to recommend it.
        # An UNDECIDED mutant was never observed by a test; raising the bound until it fits converts
        # "not measured" into "passed" without anyone learning which mutants moved — the fabricated-pass
        # shape this whole refusal exists to prevent, arrived at through the tool's own advice.
        # And it does not even fit the evidence: the three refusals above ran 145 min, 2m53s and ~1 min,
        # so a bound is not what separates them.
        # ⚠️ THE REMEDY IS CONDITIONED ON THE STATUSES ACTUALLY PRESENT, and it used to be
        # unconditional. "Re-run under less load" is LOAD advice, and it was printed on refusals that
        # were 100% `not checked` and 0% `timeout` — measured over four runs (553/338/166/116). Load
        # was never the variable there, and this is the first line anyone reads and acts on, so the
        # gate refused honestly and then misdirected the fix. `by_status` is three lines above; not
        # consulting it was the same defect as a diagnostic that names a cause the code did not check.
        _load_shaped = sorted({"timeout", "suspicious"} & set(by_status))
        print("\n  An UNDECIDED mutant was never seen by a test — it is UNMEASURED, not killed, and no\n"
              "  bound can turn one into the other.")
        if _load_shaped:
            print(f"  {', '.join(_load_shaped)} present ⇒ load or the runner is in play. Re-run under less\n"
                  "  load. If the same functions keep appearing above, the cause is in those mutants;\n"
                  "  if it moves around, look at the runner.")
        else:
            print(f"  No load-shaped status here ({', '.join(sorted(by_status))} only) — re-running under\n"
                  "  less load will NOT change this. These mutants were never executed at all, so look at\n"
                  "  what selected them, not at how long they were given.")
        print("  Do NOT raise `timeout_multiplier` to clear this: it would report a pass for mutants\n"
              "  nobody measured, which is precisely what this refusal is here to stop.")
        if not a.report_only:
            return 2

    # ── the budget refusal — after the survivor report has been recorded, before the verdict ─────
    # Whatever DID run is reported above and in the JSON; what did NOT run is named here. A refused
    # module or glob was never examined, so this run cannot say its mutants were killed — the same
    # honesty as UNDECIDED, one level up: not "too slow", but "not measured, and here is why".
    if _refused_budget:
        verdict["refused_budget"] = _refused_budget
        if a.json:
            Path(a.json).write_text(json.dumps(verdict, indent=2), encoding="utf-8")
        print(f"\nmutate-diff: REFUSING — {len(_refused_budget)} module(s)/function(s) were NOT mutated "
              f"inside the {GATE_BUDGET_SEC}s gate budget:")
        for w in _refused_budget:
            print(f"  ⊘ {w}")
        print("  A refusal is a verdict with a reason; the run that used to die here with exit 143 was not.\n"
              "  Nothing above about the functions that DID run is withdrawn — only the refused ones are\n"
              "  unmeasured. Do NOT raise GATE_BUDGET_SEC to clear this: measure the selection's clean run\n"
              "  and the trace factor it multiplies, then change the number that was wrong.")
        if not a.report_only:
            return 2

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
