# tepna-capture — mutation_diff.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The DECISION LOGIC behind `tools/mutate_diff.py`, split out so it sits inside the coverage floor.

WHY IT LIVES HERE AND NOT IN tools/. Identical reasoning to `mutation_triage.py`, and the same house
rule: `tools/` is outside the coverage denominator until something imports it, which is fine for
`git`/`subprocess`/`argparse`/IO and NOT fine for logic that can return a WRONG ANSWER instead of
failing loudly. These functions decide what the diff-scoped mutation gate IGNORES, and a wrong bucket
does harm in both directions — it hides a real survivor, or it manufactures a false refutation.

🔴 THIS IS NOT HYPOTHETICAL; IT ALREADY HAPPENED, AND IT IS WHY THIS FILE EXISTS. `is_string_only`
used to ask whether the added line CONTAINED a quote — a different question, which gave the wrong
answer. Measured 2026-08-24: two identical `encoding="utf-8" → encoding=None` mutations were handled
oppositely because one line carried an unrelated `"mutants"` path segment. The skipped one then came
back REFUTED, and REFUTED's documented remedy is to DELETE the entry — so the gate was manufacturing
false refutations and instructing a reader to destroy a correct classification. It sat in `tools/`,
unmeasured, with a `--selftest` that no gate invoked.

⚠️ A SELFTEST IS NOT THE FLOOR. `--selftest` covers what its author thought to test; the floor covers
what they did not, which is where a wrong answer lives by definition. The selftest moved here with the
logic and is now driven by a test, so it runs on every push rather than only when a human types it.

PREDICTIVE SCREEN, measured 4/4 on 2026-08-27 across the four unimported tools: **if a file under
`tools/` imports `ast` or `re`, suspect decision logic and look.** It turns the mislead-criterion from
a judgement into a grep, which is its whole value — but it is a SCREEN, NOT A PROOF, and this very
file is the counter-example that bounds it:

  · `ast` is the strong half. Parsing source STRUCTURE is almost always deciding something.
  · `re` is the weak half. After this split `tools/mutate_diff.py` STILL imports `re` — for the git
    hunk-header pattern and for finding function names in a mutmut-generated file. That is parsing an
    external tool's output format, which is plumbing that legitimately needs a regex.

So a hit means LOOK, not MOVE. Reported as 4/4 predictive on first use; recording the bound here so the
next reader does not treat a screen as a verdict.
"""
from __future__ import annotations

import ast

__all__ = ["EXCUSING", "functions_covering", "changed_span", "is_string_only", "diff_key",
           "classify", "refusal_reason", "selftest", "string_only_verdict", "scan_is_reliable",
           "STRING_ONLY", "REQUIRED", "EMPTY_DIFF", "UNDECIDABLE"]

# The four outcomes of the string-literal question. `is_string_only` collapses them to a bool for
# back-compat; the GATE reads the verdict, because two of these must never be reported as the same
# thing — "the mutant only touched log prose" and "the mutant changes nothing at all" are different
# facts, and only one of them is evidence about the code.
STRING_ONLY = "string-only"     # the change landed inside a literal — excluded, correctly
REQUIRED = "required"           # a real code change — the gate demands it be killed
EMPTY_DIFF = "empty-diff"       # the diff changes NOTHING — excluded, but it is NOT "string-only"
UNDECIDABLE = "undecidable"     # the literal scan is outside its competence — REFUSE, never guess


# The classes that genuinely cannot be killed, and so stop failing the gate. `real-gap` is deliberately
# NOT here: it is debt somebody wrote down, not an excuse, and it keeps failing until a test exists.
EXCUSING = frozenset({"no-distinguishing-input", "untestable-by-design"})


def functions_covering(source: str, lines: set[int]) -> set[str]:
    """mutmut mutant-name stems for the functions containing `lines`.

    Module-level functions are `x_<name>`; methods are `xǁ<Class>ǁ<name>` (mutmut's own separator).
    A changed line outside any function (an import, a module constant) yields nothing — mutmut does not
    generate mutants there under a function name, so there is nothing to require.

    Takes SOURCE TEXT, not a path: the read is plumbing and belongs to the caller, the AST walk is the
    decision. Splitting them is what lets this sit inside the coverage floor at all."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
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


def _string_spans(line: str) -> list[tuple[int, int]]:
    """Half-open [start, end) ranges of the string literals in `line`, quotes included.

    A single left-to-right scan, tracking the opening delimiter and honouring backslash escapes. Good
    enough for one source line: it does not need to understand triple quotes or f-string nesting,
    because a mutant's diff is line-scoped and mutmut does not split a literal across the boundary."""
    spans: list[tuple[int, int]] = []
    i, n = 0, len(line)
    while i < n:
        ch = line[i]
        if ch in "\"'":
            start, quote, i = i, ch, i + 1
            while i < n:
                if line[i] == "\\":
                    i += 2
                    continue
                if line[i] == quote:
                    i += 1
                    break
                i += 1
            spans.append((start, i))
            continue
        i += 1
    return spans


def changed_span(before: str, after: str) -> tuple[int, int, int] | None:
    """Where two versions of a line differ: `(start, before_end, after_end)`, or None if identical.

    Trims the common prefix and suffix, so the span is the mutation itself rather than the whole line.
    That is the entire point — see `is_string_only`."""
    if before == after:
        return None
    i, lo = 0, min(len(before), len(after))
    while i < lo and before[i] == after[i]:
        i += 1
    j = 0
    while j < (lo - i) and before[len(before) - 1 - j] == after[len(after) - 1 - j]:
        j += 1
    return (i, len(before) - j, len(after) - j)


def scan_is_reliable(line: str) -> bool:
    """Is `_string_spans` COMPETENT on this line? Pure.

    🔴 `_string_spans` DISCLAIMS TWO CASES IN ITS OWN DOCSTRING — triple quotes and f-string nesting —
    and outside them it does not fail, it returns a CONFIDENT WRONG ANSWER. That is the 2026-08-24
    defect one level down: a span computed from a mis-parse still looks like a span, so `inside_old` /
    `inside_new` are decided against fiction and the verdict is silently wrong.

    Two detectable conditions, both deliberately conservative — a false "unreliable" only costs a
    REQUIRED mutant (fail-CLOSED), while a false "reliable" is the wrong answer this exists to prevent:
      · a triple quote anywhere on the line — explicitly out of scope for a single left-to-right scan;
      · a scan that ends INSIDE a literal (an unterminated quote), which on a real source line means
        the literal crosses the line boundary, so a line-scoped span cannot be trusted.
    """
    if chr(34) * 3 in line or chr(39) * 3 in line:
        return False
    i, n = 0, len(line)
    while i < n:
        if line[i] in "\"'":
            quote, i, closed = line[i], i + 1, False
            while i < n:
                if line[i] == "\\":
                    i += 2
                    continue
                if line[i] == quote:
                    i, closed = i + 1, True
                    break
                i += 1
            if not closed:
                return False
            continue
        i += 1
    return True


def string_only_verdict(diff_text: str) -> tuple[str, str]:
    """The string-literal question with its outcomes KEPT APART. Returns `(verdict, detail)`.

    ⚠️ WHY THIS EXISTS RATHER THAN JUST THE BOOL. `is_string_only` returned True for a diff that
    changes NOTHING — every removed/added pair identical, so every `changed_span` is None, the loop
    `continue`s, and the function falls through to True. A no-op mutant was therefore reported as
    "string-only" and EXCLUDED from the gate: an exclusion indistinguishable from a genuine
    log-wording one, in the fail-OPEN direction, inside the very file whose sibling `refusal_reason`
    exists because this gate once failed open.

    An empty diff MAY stay excluded — a mutant that changes nothing is equivalent by construction —
    but it must be LABELED as that, not laundered through the string-only bucket. A diff the scan
    cannot honestly read is neither, and REFUSES.
    """
    lines = diff_text.splitlines()
    added = [ln for ln in lines if ln.startswith("+") and not ln.startswith("+++")]
    removed = [ln for ln in lines if ln.startswith("-") and not ln.startswith("---")]
    if not added:
        return REQUIRED, "no added line to compare"
    if all("XX" in ln for ln in added):
        return STRING_ONLY, "mutmut XX sentinel"
    if len(added) != len(removed):
        return REQUIRED, "unbalanced diff: %d removed vs %d added" % (len(removed), len(added))
    saw_change = False
    for old_ln, new_ln in zip(removed, added):
        old, new = old_ln[1:], new_ln[1:]
        span = changed_span(old, new)
        if span is None:
            continue
        saw_change = True
        if not (scan_is_reliable(old) and scan_is_reliable(new)):
            return UNDECIDABLE, "literal scan is outside its competence (triple quote or unterminated)"
        start, old_end, new_end = span
        old_spans = _string_spans(old)
        new_spans = _string_spans(new)
        inside_old = any(a < old_end and start < b for a, b in old_spans if a <= start and old_end <= b)
        inside_new = any(a <= start and new_end <= b for a, b in new_spans)
        if not (inside_old and inside_new):
            return REQUIRED, "the changed token is outside any string literal"
    if not saw_change:
        return EMPTY_DIFF, "every removed/added pair is identical - the mutant changes nothing"
    return STRING_ONLY, "every changed token lies inside a string literal"


def is_string_only(diff_text: str) -> bool:
    """Back-compat bool over `string_only_verdict`: True when the gate may SKIP this mutant.

    DERIVED from the verdict rather than reimplementing it, so the two can never disagree — a bool and
    a verdict answering differently is exactly the class of bug this file keeps producing.

    ⚠️ UNDECIDABLE collapses to **False (required)**, i.e. FAIL-CLOSED. A caller still on the bool
    API therefore gets the safe direction for free: a diff the scan cannot honestly read is DEMANDED,
    never excluded. The loud refusal is available to callers that read the verdict, and
    `tools/mutate_diff.py` does. EMPTY_DIFF stays True (excluded) — a mutant changing nothing is
    equivalent by construction — but only `string_only_verdict` can tell the two exclusions apart,
    and the gate now reports them separately."""
    return string_only_verdict(diff_text)[0] in (STRING_ONLY, EMPTY_DIFF)


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


def selftest() -> int:
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
    # ── is_string_only: the CHANGED TOKEN, not the line's contents ───────────────────────────────
    # The old rule asked whether the added line CONTAINED a quote. Measured 2026-08-24: two identical
    # `encoding="utf-8" → encoding=None` mutations were handled oppositely because one line happened
    # to carry an unrelated `"mutants"` path segment. The skipped one then came back REFUTED — and
    # REFUTED's documented remedy is to delete the entry, so the gate was instructing a reader to
    # destroy a correct classification.
    def _d(before, after):
        return "--- x\n+++ y\n-" + before + "\n+" + after + "\n"

    _bug_old = '        src = (Path(work) / "mutants" / module).read_text(encoding="utf-8")'
    _bug_new = '        src = (Path(work) / "mutants" / module).read_text(encoding=None)'
    if is_string_only(_d(_bug_old, _bug_new)):
        print("  selftest FAIL: a keyword change is treated as string-only because the LINE holds a quote")
        ok = False
    # Its twin, which the old rule already handled correctly — the fix must not regress it.
    if is_string_only(_d('    data = json.loads(p.read_text(encoding="utf-8"))',
                         '    data = json.loads(p.read_text(encoding=None))')):
        print("  selftest FAIL: the quote-free twin regressed")
        ok = False
    # ⚠️ And the opposite over-correction: keying on mutmut's XX sentinel ALONE is too narrow —
    # a case change is a real string mutation carrying no sentinel, and must still be skipped.
    if not is_string_only(_d('    x = f(encoding="utf-8")', '    x = f(encoding="UTF-8")')):
        print("  selftest FAIL: a genuine string-literal change is now required")
        ok = False
    if not is_string_only(_d('    s = "hello"', '    s = "XXhelloXX"')):
        print("  selftest FAIL: mutmut's XX sentinel is no longer conclusive")
        ok = False
    # Log wording on a line that also holds other literals — the case the rule exists for.
    if not is_string_only(_d('    log("a", "the quick brown fox")', '    log("a", "XXthe quick brown foxXX")')):
        print("  selftest FAIL: log wording is no longer skipped")
        ok = False
    # A comparison flip on a line containing a string is a REAL survivor and must be reported.
    if is_string_only(_d('    if d["k"] > 3: pass', '    if d["k"] >= 3: pass')):
        print("  selftest FAIL: a comparison flip is hidden by an unrelated dict key")
        ok = False
    # the span helpers, pinned directly
    if changed_span("a=1", "a=1") is not None:
        print("  selftest FAIL: changed_span invents a difference")
        ok = False
    if changed_span('f("x")', 'f("y")') != (3, 4, 4):
        print("  selftest FAIL: changed_span mislocates the differing region")
        ok = False
    if _string_spans('a = "b" + \'c\'') != [(4, 7), (10, 13)]:
        print("  selftest FAIL: _string_spans miscounts literals")
        ok = False

    # diff_key ignores whitespace but not content, and drops the +++/--- headers
    if diff_key("--- a\n+++ b\n-  x = 1\n+  x  =  2\n") != "- x = 1 | + x = 2":
        print("  selftest FAIL: diff_key")
        ok = False
    if diff_key("-a\n+b\n") == diff_key("-a\n+c\n"):
        print("  selftest FAIL: diff_key collides on different mutations")
        ok = False
    # The fail-open guard.
    # ⚠️ THIS COMMENT USED TO EXPLAIN WHY IT COULD NOT BE A TEST, AND THAT REASONING IS NOW SPENT.
    # It read: "nothing under tools/ is imported by the pytest suite, so a test importing this module
    # would be the first — and would drag a 366-line uncovered file into the --cov-fail-under=100
    # floor and red CI for a reason unrelated to the change." That diagnosis was exactly RIGHT (it is
    # the coverage-denominator trap, hit again on 2026-08-27), but the remedy inverted the cost: it
    # kept the logic outside the floor and made the selftest the only guard — and then nothing
    # invoked the selftest. `is_string_only` shipped a wrong answer under precisely that arrangement.
    # Splitting the LOGIC out (this module, imported and gated) instead of the TEST removes the
    # premise: the plumbing stays unimported in tools/, so nothing is dragged in at all.
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
    # ── the two exclusions must stay APART (2026-08-27) ─────────────────────────────────────────
    # A no-op mutant used to fall through to "string-only" and be excluded as though it were log
    # prose. It may still be excluded, but not under that name.
    if string_only_verdict(_d("    x = 1", "    x = 1"))[0] != EMPTY_DIFF:
        print("  selftest FAIL: a no-op diff is not labelled EMPTY_DIFF")
        ok = False
    if string_only_verdict(_d('    log.info("a")', '    log.info("b")'))[0] != STRING_ONLY:
        print("  selftest FAIL: a log-prose mutation is no longer STRING_ONLY")
        ok = False
    _tq = chr(34) * 3
    if string_only_verdict(_d("    x = f(1)  # " + _tq, "    x = f(2)  # " + _tq))[0] != UNDECIDABLE:
        print("  selftest FAIL: a line outside the scan's competence was decided anyway")
        ok = False
    print("  selftest: classify + diff_key + refusal_reason + verdict OK" if ok else "  selftest: FAILED")
    return 0 if ok else 1
