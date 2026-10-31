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
import fnmatch
import hashlib
import json
import os
import pathlib
import re
import stat as _stat
import shutil
import signal
import subprocess
import threading
import time
from typing import Final, TypedDict

__all__ = [
    "GATE_BUDGET_SEC",
    "PREWORK_FILE",
    "PREWORK_SCHEMA",
    "PREWORK_CLEAN_DRIFT",
    "selection_hash",
    "prework_record",
    "merge_prework",
    "prework_stale_reason",
    "cached_stats_sec",
    "stats_pass_seconds",
    "prework_estimate",
    "prework_unmeasured_note",
    "budget_refusal",
    "budget_exhaustion_verdict",
    "stream_bounded",
    "cap_remaining",
    "CAP_FLOOR_SEC",
    "prune_scratches",
    "memory_exhaustion_verdict",
    "proc_start_ticks",
    "MEM_CAP_FRACTION",
    "WORKER_RSS_PER_MUTANTS_BYTE",
    "SCRATCH_OWNER_FILE",
    "JOIN_SEC",
    "GENERATION_DONE_RE",
    "GENERATION_COMPLETE_MARKER",
    "mark_generation_complete",
    "scratch_generation_reusable",
    "GROUP_GRACE_SEC",
    "kill_process_group",
    "REAP_SIGNALS",
    "reap_group_on_signal",
    "results_timeout_reason",
    "GENERATION_CAP_FRACTION",
    "UNKNOWN_SIZE_WORKERS",
    "mutants_size_record",
    "merge_mutants_size",
    "generation_cap_sec",
    "available_bytes_from_meminfo",
    "generation_timeout_reason",
    "workers_that_fit",
    "memory_refusal",
    "scratch_prune_decision",
    "owner_is_live",
    "parse_owner_record",
    "owner_record",
    "verdict_object",
    "VERDICT_STATUSES",
    "EXCUSING",
    "functions_covering",
    "changed_span",
    "is_string_only",
    "diff_key",
    "mutant_changed_lines",
    "mutant_file_line",
    "survivor_location",
    "float_boundary_unprobed",
    "annotation_only",
    "functions_with_changed_ast",
    "classify",
    "refusal_reason",
    "selftest",
    "string_only_verdict",
    "scan_is_reliable",
    "resolve_interpreter",
    "zero_population_verdict",
    "parse_exclusions",
    "declared_exclusion_status",
    "declared_module",
    "count_functions",
    "module_exclusion_note",
    "COST_SCOPES",
    "unmeasured_rows",
    "declared_module_rows",
    "merge_unmeasured",
    "UNMEASURED_SCHEMA",
    "exclusion_key_of",
    "refused_key",
    "EXCLUSIONS_FILE",
    "EXCLUSIONS_SCHEMA",
    "EXCLUSION_BOUND",
    "COST_PROVENANCE",
    "result_inconsistency",
    "clean_run_failures",
    "STRING_ONLY",
    "REQUIRED",
    "EMPTY_DIFF",
    "UNDECIDABLE",
]

# The four outcomes of the string-literal question. `is_string_only` collapses them to a bool for
# back-compat; the GATE reads the verdict, because two of these must never be reported as the same
# thing — "the mutant only touched log prose" and "the mutant changes nothing at all" are different
# facts, and only one of them is evidence about the code.
STRING_ONLY = "string-only"  # the change landed inside a literal — excluded, correctly
REQUIRED = "required"  # a real code change — the gate demands it be killed
EMPTY_DIFF = "empty-diff"  # the diff changes NOTHING — excluded, but it is NOT "string-only"
UNDECIDABLE = "undecidable"  # the literal scan is outside its competence — REFUSE, never guess


# The classes that genuinely cannot be killed, and so stop failing the gate. `real-gap` is deliberately
# NOT here: it is debt somebody wrote down, not an excuse, and it keeps failing until a test exists.
EXCUSING = frozenset({"no-distinguishing-input", "untestable-by-design"})


def source_function_of_glob(glob: str) -> str:
    """The SOURCE function name a mutmut glob targets — `""` when it cannot be read.

    A glob is `<module>.<mangled>__mutmut_*`, and the mangled part carries mutmut's own encoding:
        cpap_ingest.x_helper__mutmut_*            → `helper`          (module-level)
        cpap_ingest.xǁGapCountersǁtotal_lost__mutmut_*  → `total_lost` (method / property)

    Distinct from `function_of_mutant`, which answers a different question and returns the QUALIFIED
    name (`GapCounters.total_lost`) for reporting. This one returns the bare `def` name, because that
    is what an AST lookup matches on. Two callers, two needs — one helper serving both would return
    the wrong string to one of them, which is the kind of quiet mismatch this file exists to avoid.
    """
    stem = (glob or "").rstrip("*").rstrip("_")
    if "__mutmut" not in stem:
        return ""
    mangled = stem.split(".", 1)[1] if "." in stem else stem
    mangled = mangled.split("__mutmut", 1)[0]
    if "ǁ" in mangled:
        parts = [p for p in mangled.split("ǁ") if p and p != "x"]
        return parts[-1] if parts else ""
    return mangled[2:] if mangled.startswith("x_") and len(mangled) > 2 else ""


def unmutatable_decorator(source: str, func: str) -> str:
    """The decorator that makes mutmut SKIP `func` entirely — `""` if it would be mutated.

    ⚠️ THIS MIRRORS MUTMUT'S OWN RULE, read from its source rather than inferred from behaviour
    (`mutmut/mutation/file_mutation.py`, `_skip_node_and_children`). Its comment states the reason:

        # ignore decorated functions, because
        # 1) copying them for the trampoline setup can cause side effects
        # 2) decorators are executed when the function is defined …
        # 3) @property decorators break the trampoline signature assignment
        # Exception: @staticmethod and @classmethod are allowed

    So the exclusion is ARCHITECTURAL, not an oversight: mutmut mutates by replacing a function with a
    trampoline that dispatches to `f__mutmut_N`, and a descriptor like `@property` cannot be rebound
    that way. The rule it applies is EXACTLY ONE decorator that is `staticmethod` or `classmethod`;
    everything else is skipped, generating zero mutants whatever the body contains.

    ⚠️ AND THE BLIND SPOT IS WIDER THAN PROPERTIES, which is why this replaced an `is_property` check.
    Measured over `capture-host/` 2026-09-18: **50** functions are skipped by this rule — 45
    `@property`, 4 `@asynccontextmanager`, 1 `@middleware`. Reporting only the properties left the
    other five telling a reader "cause not established" when the cause is known and is the same one.

    Returns the decorator NAME so the message can say which one, and "" on unparseable source — a
    false positive here invents a blind-spot warning nobody can act on.
    """
    try:
        tree = ast.parse(source or "")
    except SyntaxError:
        return ""
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or node.name != func:
            continue
        names = [_decorator_name(d) for d in node.decorator_list]
        if not names:
            return ""
        if len(names) == 1 and names[0] in ("staticmethod", "classmethod"):
            return ""  # mutmut's own exemption: trampolines are easy for these
        return names[0]
    return ""


def _decorator_name(node: ast.expr) -> str:
    """`@foo` / `@a.foo` / `@foo(...)` → `foo`. The call form matters: `@lru_cache()` is decorated."""
    if isinstance(node, ast.Call):
        node = node.func
    if isinstance(node, ast.Name):
        return node.id
    return getattr(node, "attr", "")


def functions_covering(source: str, lines: set[int]) -> set[str] | None:
    """mutmut mutant-name stems for the functions containing `lines`.

    Module-level functions are `x_<name>`; methods are `xǁ<Class>ǁ<name>` (mutmut's own separator).
    A changed line outside any function (an import, a module constant) yields nothing — mutmut does not
    generate mutants there under a function name, so there is nothing to require.

    Takes SOURCE TEXT, not a path: the read is plumbing and belongs to the caller, the AST walk is the
    decision. Splitting them is what lets this sit inside the coverage floor at all.

    ∅ None on source that does not parse (ABSENCE-SURVEY 45ccc1146b37). The empty set is a MEASUREMENT —
    "the changed lines are all module-level" — and returning it for an unparseable module told the caller
    nothing needed mutating, so the module left the population with a pass-shaped line. None says the
    scope was never determined; the caller refuses it as unmeasured (cf. `annotation_only`, which already
    answers a parse failure with "never a guess")."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
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


# An escaped pair is ONE token, so an f-string interior needs no "skip the next character" state.
_BRACE_TOKENS = re.compile(r"\{\{|\}\}|[{}]|[^{}]+")


def _fstring_expr_spans(line: str) -> list[tuple[int, int]]:
    """Half-open [start, end) ranges of an f-string's `{...}` fields on `line`, BRACES INCLUDED.

    An f-string is a literal only BETWEEN its fields: `{a(y)}` is a call, and mutmut mutates it as one
    (measured 2026-09-26, mutmut 3.8: `f"{a(y)}-{y + 1}"` yields `a(None)`, `y - 1` and `y + 2`, and
    NO text mutant at all — the `XX`/case-flip forms are generated for plain literals only). Under
    `_string_spans` alone such a mutant read as string-only and the gate EXCLUDED it — fail-OPEN, on
    every interpreter, because that scanner is hand-rolled and never tokenizes. `{{` / `}}` at field
    depth 0 are escaped braces, i.e. text; a nested `{}` inside a field (a dict, a set, a format spec)
    stays in the field; a field that never closes before the literal ends runs to the literal's end,
    so the caller demands the mutant rather than trusting a span it could not finish. The braces are
    IN the span on purpose: turning `{a}` into `(a}` is a change to the field, not to the text beside
    it, while a change to the character before `{` or after `}` is text and stays outside.

    ⚠️ NO INDEX-DRIVEN `while` LOOP AND NO SKIP FLAG, deliberately. The first draft advanced `i` by
    hand, and mutmut's `i += 1` -> `i = 1` made it spin forever: the diff-scoped gate reports such a
    mutant UNDECIDED (timeout) and REFUSES, correctly — nothing measured it. The second draft kept a
    boolean "skip the next char" for an escaped pair, and `False -> None` on a flag that is only ever
    truth-tested is unobservable by construction. So the interior is TOKENIZED instead — an escaped
    pair is one token, passed over at depth 0 and read as two braces inside a field — and a field's
    span is appended PROVISIONALLY (to the literal's end) the moment it opens and patched when it
    closes: no loop index, no flag, no initial value nobody reads."""
    spans: list[tuple[int, int]] = []
    for a, b in _string_spans(line):
        prefix = re.search(r"[A-Za-z]*$", line[:a])
        if prefix is None or "f" not in prefix.group(0).lower():
            continue
        depth = 0
        for m in _BRACE_TOKENS.finditer(line, a + 1, b - 1):
            tok = m.group(0)
            if depth == 0 and tok in ("{{", "}}"):
                continue  # an escaped brace: text, no state to keep
            for k, ch in enumerate(tok, m.start()):  # a doubled brace INSIDE a field is two braces
                if ch == "{":
                    depth += 1
                    if depth == 1:
                        spans.append((k, b))  # provisional: runs to the literal's end
                elif ch == "}" and depth:
                    depth -= 1
                    if depth == 0:
                        spans[-1] = (spans[-1][0], k + 1)  # closed: braces included
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
        # Inside a literal is not yet inside TEXT: an f-string's `{...}` fields are code (see
        # `_fstring_expr_spans`), and a mutant there is exactly the kind the gate exists to demand.
        if any(a < old_end and start < b for a, b in _fstring_expr_spans(old)) or any(
            a < new_end and start < b for a, b in _fstring_expr_spans(new)
        ):
            return REQUIRED, "the changed token is inside an f-string field - code, not text"
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
    keep = [ln for ln in diff_text.splitlines() if ln.startswith(("-", "+")) and not ln.startswith(("---", "+++"))]
    return " | ".join(" ".join(ln.split()) for ln in keep)


def entry_before_in_source(key: "str | None", source: str) -> bool:
    """Is an equivalence entry's BEFORE text still in `source`, read the way `diff_key` wrote it?

    `tools/mutate_diff.py` tells an ORPHANED entry (its line moved, so it excuses nothing) from an
    out-of-scope one (its line is unchanged and its function is simply not in this diff) by looking
    for the entry's before text in the module. The key is WHITESPACE-NORMALISED above, so a raw
    substring test against the source finds nothing whenever the source spaces that line differently
    — and ruff requires TWO spaces before an inline comment, which the key collapses to one. So every
    entry whose key carries an inline comment read as orphaned, forever, through no fault of its own.

    Measured 2026-10-19 over the ledger's 299 keyed entries: 8 were misreported that way, 7 for an
    inline comment and the eighth for a before spanning two lines of a wrapped call, whose key reads
    `- a | - b | + c`. Comparing normalised to normalised corrects all 8 and moves nothing the other
    way. The test stays a SUBSTRING, because a mutant of a wrapped expression carries a fragment of
    its source line, and a multi-line before holds only when EVERY removed line is still there.

    ⚠️ THE SPACE AFTER THE MARKER IS NOT PART OF THE FORMAT, and reading it as part of the format was
    the second instance of this same misreport. A unified-diff line is the marker plus the source line
    verbatim, so a line at ZERO indentation carries no space at all: `diff_key` writes
    `-def _drain_fsync(timeout: float = 5.0) -> None:`. The old guard `key.startswith("- ")` rejected
    every such key, and the `[2:]` slice would have eaten the first character of the code. Measured
    2026-10-20 over the ledger's 306 keyed entries: 1 was misreported that way, `writers.py`'s
    `_drain_fsync` signature, and the 2026-10-19 measurement above missed the class because every
    entry it read carried indentation. The excuse itself never lapsed — `classify` compares the key
    against `diff_key` output verbatim — so what this function got wrong was the DIAGNOSIS, which told
    a reader to re-verify an entry whose line sits unchanged in its module.

    ⚠️ A REMOVED LINE MAY CONTAIN THE ` | ` THAT KEYS ARE JOINED WITH, which is residue
    `2026-09-29-survivor-printer-splits-a-key-on-its-own-separator` met on this side of the file. So
    the parse walks the segments and re-joins any segment that does not open with a marker onto the
    one before it, rather than splitting on ` | + ` and hoping no source line holds that text."""
    if not key:
        return False
    segments: list[str] = []
    for part in key.split(" | "):
        if part[:1] in ("-", "+"):
            segments.append(part)
        elif segments:
            segments[-1] += " | " + part
        else:
            return False
    if not segments[0].startswith("-"):
        return False
    removed = []
    for seg in segments:
        if seg.startswith("+"):
            break
        removed.append(" ".join(seg[1:].split()))
    removed = [seg for seg in removed if seg]
    normalised = "\n".join(" ".join(ln.split()) for ln in source.splitlines())
    return bool(removed) and all(seg in normalised for seg in removed)


def functions_with_changed_ast(old_src: str, new_src: str) -> tuple[set[str], str | None]:
    """The functions whose AST DIFFERS between two revisions of one module, named the way
    `functions_covering` names them, and a reason when the question cannot be answered.

    MUTATION SCOPE SHOULD FOLLOW SEMANTIC CHANGE, NOT LINE MOVEMENT. Scope comes from
    `git diff --unified=0`, which marks a line changed when a formatter merely moves it. The
    module-level `annotation_only` rule already drops a file whose whole AST is unchanged — on the
    2026-09-28 whole-tree reformat that removed 405 of 423 files by itself. What it cannot do is the
    MIXED file: one real edit beside a page of reflow. Those 18 remaining files scoped **724**
    functions when only **20** had actually changed, and 724 cannot finish inside the gate budget, so
    the gate refuses and a required refusal blocks a PR whose mutants were never in question.
    ⚠️ `git diff -w` does not help: it ignores whitespace WITHIN a line while a reflow moves tokens
    BETWEEN lines (measured 8,859 → 7,278 hunks, still 410 files). The AST is what knows.

    🔴 NAMES MUST BE MANGLED THE SAME WAY, or the intersection is silently empty and every function
    drops out of scope — a gate that reports green on everything. `functions_covering` returns
    `x_<name>` for a module-level function and `xǁ<Class>ǁ<name>` for a method; this must match, and
    the first version of it did not. Caught by measuring the narrowing on a real diff and reading 0
    where 20 was expected.

    FULL `ast.dump` equality, with NO string-constant blanking: a blanked comparison would scope a
    changed log line, format string or SQL fragment to nothing, and a string value IS behaviour. The
    cost is that a re-indented DOCSTRING also scopes, deliberately not special-cased — the moment the
    rule decides which string changes matter it is guessing. Of the 20, 14 were docstring re-indents.

    Returns `(names, None)`, or `(set(), reason)` when either revision does not parse — and an
    unparseable revision must narrow NOTHING (§∅: a question we cannot answer is not a "no").
    """
    try:
        old_tree = ast.parse(old_src)
        new_tree = ast.parse(new_src)
    except SyntaxError as exc:
        return set(), f"a revision does not parse ({exc.__class__.__name__}: {exc}) — scope is not narrowed"

    def by_stem(tree: ast.AST) -> dict[str, str]:
        # ONE map, of dumps with the docstring statement removed. A full-dump map was computed
        # beside it and then re-checked by the same comparison, so it decided nothing: if the full
        # dumps differ the stripped ones differ too, UNLESS the difference is exactly the docstring —
        # which is the case being exempted. A mutation of the redundant line survived every test,
        # which is how the redundancy was found rather than reasoned about.
        bare: dict[str, str] = {}

        def visit(node, cls: str | None) -> None:
            # 🔴 `ast.iter_child_nodes`, THE SAME WALK `functions_covering` USES — not `node.body`.
            # A `def` inside an `except:` handler, an `else:` branch or a `finally:` lives in
            # `handlers` / `orelse` / `finalbody`, which `body` does not reach. The line scan finds
            # it and this map did not, so the intersection dropped a genuinely edited function
            # SILENTLY and with no reason given. The `except ImportError: def shim(...)` shape is
            # real in this tree (optional-dependency shims). The two walkers must be able to
            # disagree about AST CONTENT and never about MEMBERSHIP.
            for child in ast.iter_child_nodes(node):
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    stem = f"x\u01c1{cls}\u01c1{child.name}" if cls else f"x_{child.name}"
                    # One stem can cover several definitions (a redefinition, or the same method name
                    # reached twice). Concatenate so "changed" means "any body under this stem
                    # changed" — the conservative reading, and the one a mutant glob matches.
                    # Accumulated per stem, so a stem covering SEVERAL defs is judged over all of
                    # them — keeping only the first let a change in the SECOND read as
                    # docstring-only and be dropped.
                    bare[stem] = bare.get(stem, "") + _dump_without_docstring(child)
                    visit(child, cls)
                elif isinstance(child, ast.ClassDef):
                    visit(child, child.name)
                else:
                    visit(child, cls)

        visit(tree, None)
        return bare

    old_bare, new_bare = by_stem(old_tree), by_stem(new_tree)
    # ── A CHANGE CONFINED TO A DOCSTRING HAS NOTHING TO MUTATE ──────────────────────────────────
    # MEASURED, not assumed (mutmut 3.8): a function of [docstring + `return 1`] generates exactly
    # ONE mutant, `return 2`, and ZERO mutants touch the docstring node. So a function whose only
    # difference from base is its docstring contributes no mutant the diff could be responsible for,
    # and scoping it re-mutates a body that did not change. That is not free: on the 2026-09-28
    # reformat, 14 docstring re-indents pulled in capture.py (163 functions, 20,021 mutants, ~22 min
    # to GENERATE on 24 cores) and the job was cancelled at the 180-minute runner timeout.
    #
    # This is a SYNTACTIC distinction — "the one node with no mutants behind it" — not a judgement
    # about which strings matter. A changed log line, format string or SQL fragment still scopes,
    # because it is not the docstring statement.
    return {n for n, d in new_bare.items() if old_bare.get(n) != d}, None


def _dump_without_docstring(node) -> str:
    """`ast.dump` of a function with its docstring STATEMENT left out.

    NO COPY. The first version `deepcopy`d the node to blank it, which is both wasteful — this runs
    for every function of every changed module, and capture.py has 163 — and needless: the dump can
    simply skip the statement. Two mutants survived on that copy (`deepcopy` → `copy`, and a
    `getattr` default that could not be missing), which is what prompted looking at it; neither line
    exists now.

    🔴 NEVER `ast.get_docstring()` HERE. It defaults to `clean=True`, which normalises leading
    whitespace, so a RE-INDENTED docstring compares EQUAL through it — it reported "no difference"
    for all four real cases before that was caught. Believing it would scope NOTHING anywhere,
    silently. The docstring is identified structurally instead, and its RAW text is what is dropped.
    """
    body = node.body
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        body = body[1:]
    return "|".join(
        [node.name, ast.dump(node.args)] + [ast.dump(d) for d in node.decorator_list] + [ast.dump(st) for st in body]
    )


def annotation_only(old_src: str, new_src: str) -> tuple[bool, str]:
    """True iff the two sources are IDENTICAL once FUNCTION-SIGNATURE annotations are stripped.

    The mutation gate exists to catch untested BEHAVIOUR change; a signature annotation does not
    execute, so a diff that only edits arg/return annotations must not pull whole function bodies
    into mutation scope (measured on #1946: four one-line widenings surfaced 30 pre-existing
    survivors and blocked a behaviour-neutral PR).

    DELIBERATELY NARROW — only `arg.annotation` and `FunctionDef/AsyncFunctionDef.returns` are
    stripped. Every other annotation stays load-bearing: class-body `AnnAssign` drives dataclass
    fields, ClassVar/InitVar and TypedDict shapes, all of which ARE runtime behaviour, so a change
    there keeps full scope. Defaults, arg names/order, decorators, bodies and docstrings all differ
    in the stripped AST and keep full scope too.

    FAIL-CLOSED: any parse failure returns (False, reason) — full scope, never a guess. The reason
    string always names which branch decided, so a caller's log can show the check actually ran.

    GUIDANCE FOR ANNOTATORS (Papers', measured on the same PR): a NEW IMPORT survives stripping —
    `from collections.abc import Sequence` is a real AST node — so a type-only change that needs an
    import is no longer type-only under this rule. Quote a builtin form (`"str | list[str]"`), or
    accept full scope. The burden is deliberately on the annotator, not the gate: an imports-used-
    only-in-annotations analysis fails in the wrong direction (a dual-use import would silently
    exempt behaviour)."""
    import ast

    try:
        old_tree, new_tree = ast.parse(old_src), ast.parse(new_src)
    except SyntaxError as e:
        return False, f"parse failed ({e.msg or e.__class__.__name__}) - full scope"

    class _Strip(ast.NodeTransformer):
        def visit_arg(self, node: ast.arg) -> ast.arg:
            node.annotation = None
            return node

        def _fn(self, node):
            self.generic_visit(node)
            node.returns = None
            return node

        visit_FunctionDef = _fn
        visit_AsyncFunctionDef = _fn

    a = ast.dump(_Strip().visit(old_tree))
    b = ast.dump(_Strip().visit(new_tree))
    if a == b:
        return True, "signature-annotation-only diff - stripped ASTs identical"
    return False, "behavioural difference survives annotation stripping - full scope"


# ── A FLOAT-THRESHOLD MUTANT IS DISTINGUISHABLE ON A MEASURE-ZERO SET ──────────────────────────────
# Measured 2026-09-25 on `x_qc_digest__mutmut_37` (`(hi - lo) < 0.05` → `<=`). A comparison-operator
# mutation on a FLOAT threshold differs ONLY where the compared expression lands exactly on the
# representable constant, and almost no realistic pair does:
#
#     lo=0.00 hi=0.05 → 0.05                    <0.05 False  <=0.05 True   ← the only one that kills
#     lo=0.90 hi=0.95 → 0.04999999999999993     True        True          identical rendering
#     lo=0.50 hi=0.55 → 0.050000000000000044    False       False         identical rendering
#
# So a probe battery sampled from realistic values returns "no distinguishing input" and the mutant
# is ledgered EQUIVALENT — a false equivalence that nothing re-derives, because equivalence is
# recorded rather than recomputed. The trap is that the INSTINCTIVE fixture (a clean 0.90/0.95 gap)
# reads as proof. Heron's golden was character-exact over every render branch and still missed it.
#
# ⚠️ This refuses the EXCUSE, it does not reclassify the mutant: the entry may well be correct, but
# it has not been shown, and "unproven" is not "equivalent" (§∅ at the ledger level). The bar is
# deliberately weak and checkable — the probe must NAME the threshold literal it had to construct —
# because a bar the tool can verify beats one it can only exhort.
_CMP_FLIP = (("<", "<="), ("<=", "<"), (">", ">="), (">=", ">"))
# Digits on BOTH sides, deliberately: a `\d*\.\d+` form also matches the `.0` inside an f-string
# format spec (`{lo * 100:.0f}`), which is not a threshold and made the message name a literal
# nobody wrote. A bare `.5` is legal Python and is excluded by this; thresholds are spelled `0.5`.
_FLOAT_LIT = re.compile(r"(?<![\w.])\d+\.\d+")


def float_boundary_unprobed(key: str, probe: str | None) -> str | None:
    """Return a reason when an EXCUSING entry needs a constructed float boundary and has not shown one.

    PURE. `key` is `diff_key`'s ` | `-joined -/+ pair; `probe` is the entry's own account of what ran.
    None means the entry is fine — either it is not a float-threshold comparison flip, or its probe
    names the literal."""
    if not key:
        return None
    parts = [p.strip() for p in key.split("|")]
    minus = next((p for p in parts if p.startswith("-")), "")
    plus = next((p for p in parts if p.startswith("+")), "")
    # NO `if not minus or not plus` GUARD, and its absence is load-bearing. It was dead code: the
    # intersection below is already empty whenever either side is missing, so the guard could never
    # change an answer — the diff-scoped mutation gate proved it by surviving three mutants on those
    # two lines (the `or`→`and` flip among them). Removing it also makes the `next(...)` defaults
    # observable: with no guard, a None default reaches `findall(None)` and raises, so a key with only
    # one side now KILLS those mutants instead of being indistinguishable from "".
    lits = set(_FLOAT_LIT.findall(minus)) & set(_FLOAT_LIT.findall(plus))
    if not lits:
        return None  # no float literal on BOTH sides — not this shape
    # a comparison operator that FLIPPED between the two sides
    flipped = any(f" {a} " in minus and f" {b} " in plus for a, b in _CMP_FLIP)
    if not flipped:
        return None
    shown = sorted(lits)
    if probe and any(lit in probe for lit in shown):
        return None
    return (
        "a `<`/`<=` flip on the float threshold "
        + ", ".join("`%s`" % x for x in shown)
        + " is distinguishable only where the compared value lands EXACTLY on it; the probe does not "
        "name that boundary, so this is UNPROVEN rather than equivalent"
    )


# ── PRINT THE MUTANT IN FULL, FROM THE FIELD THAT HAS IT ──────────────────────────────────────────
# The survivor record carries BOTH `diff` (mutmut's stdout, capped at 400 bytes) and `changed`
# (diff_key over the UNCAPPED stdout — the -/+ pair, complete). The cap was noticed and `changed` was
# added beside it; the PRINTER was left reading `diff`. So the JSON gained the remedy and the console
# — the thing a human actually reads, and the only thing in a CI log — kept truncating mid-literal.
#
# ⚠️ WHY THAT IS WORSE THAN A MISSING FIELD (Heron, 2026-09-25, from the consumer end): the truncation
# does not merely hide the mutant, it makes an equivalence entry look JUSTIFIED. The reader has a real
# probe, it genuinely does not kill the mutant, and this tool's own closing message points at
# `mutate-equivalence.json` "with a `probe` saying what you actually ran". Every step reads correct and
# the output is a false equivalence that nothing re-derives. A truncated report plus a sanctioned
# escape hatch is worse than either alone. Reading one survivor cost four dead ends — the CI log, a
# local rerun, the post-restore /tmp scratch (torn down, no mutants left) and mutmut 3.8's own API
# (no exposed generator) — before the mutant had to be regenerated to be read at all.
#
# NOT "raise the cap": that leaves the same shape one size up. Print the complete field.
# ⚠️ NAMED `mutant_changed_lines`, not `changed_lines`: tools/mutate_diff.py ALREADY has a
# `changed_lines(base)` returning git's changed line numbers per file. Importing this one under that
# name shadowed it — and the syntax check still passed.
def mutant_changed_lines(sv: dict) -> list[str]:
    """The mutant's -/+ pair, complete. Falls back to the capped `diff` only if `changed` is absent."""
    changed = (sv.get("changed") or "").strip()
    if changed:
        # Split only where ` | ` is followed by the next line's own `- `/`+ ` marker (`diff_key` joins
        # normalised -/+ lines, so every real boundary looks like that). A bare `split(" | ")` also cut
        # a `scope: dict | None` annotation or a `a | b` expression and rendered a real survivor as an
        # unkillable identical-source mutant (residue 2026-10-11-mutation-survivor-render-truncates-at-the-annotation).
        return [seg.strip() for seg in re.split(r" \| (?=[-+] )", changed) if seg.strip()]
    return [
        ln
        for ln in (sv.get("diff") or "").splitlines()
        if ln.startswith(("-", "+")) and not ln.startswith(("---", "+++"))
    ]


# ── WHICH OCCURRENCE SURVIVED (residue 2026-09-28-mutate-diff-does-not-say-which-occurrence-…) ────
# A survivor was printed as a line REWRITE (`- continue` / `+ break`), so when that line occurs several
# times in one function the report could not say which occurrence survived — and the occurrence the
# suite already covers is the one a reader checks. Measured twice on #3188: the covered sibling was
# killed, the uncovered one survived, and reading the report at face value would have closed both.
# The record now carries `file_line`, the FILE line of the first changed line, or None.
def _first_removal_hunk(show_output: str) -> tuple[int, list[str], int] | None:
    """`(old_start, old_side, first_removed)` of the first hunk that REMOVES a line, else None.

    `old_start` is the hunk's first line, FUNCTION-RELATIVE (mutmut diffs `cst.Module([function]).code`,
    so numbering starts at the function's first line); `old_side` is the hunk's context + removed lines
    as the original had them; `first_removed` is the function-relative number of the first `-` line."""
    start: int | None = None
    old_side: list[str] = []
    first_removed: int | None = None
    for ln in show_output.splitlines():
        if ln.startswith("@@"):
            if first_removed is not None:
                break
            m = re.match(r"@@ -(\d+)", ln)
            start, old_side = (int(m.group(1)) if m else None), []
            continue
        if start is None or ln.startswith(("---", "+++", "\\", "+")):
            continue
        if ln.startswith("-") and first_removed is None:
            first_removed = start + len(old_side)
        old_side.append(ln[1:])
    if start is None or first_removed is None:
        return None
    return start, old_side, first_removed


def mutant_file_line(show_output: str, source: str, mutant_name: str) -> int | None:
    """The 1-indexed FILE line of the first line a mutant changes, or None. PURE.

    Names WHICH occurrence of an ambiguous line survived: `continue` -> `break` on one of three
    `continue`s is three identical-looking rewrites, and only the position tells them apart.

    ∅ NULL, NEVER A GUESS. The number is derived (function start in `source` by AST, comment/blank
    lines above it that mutmut keeps, plus the hunk's function-relative offset) and then CHECKED: the
    whole old side of the hunk must equal the source lines at that position, whitespace aside. Any
    shortfall — an unparseable file, a function that is absent or defined twice, a diff with no removed
    line, an unreadable name, a position whose text disagrees — is None, never 0 and never a nearby line."""
    qual = function_of_mutant(mutant_name)
    hunk = _first_removal_hunk(show_output)
    if not qual or hunk is None:
        return None
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None
    scope, _, fname = qual.rpartition(".")
    body = tree.body
    if scope:
        classes = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == scope]
        if len(classes) != 1:
            return None
        body = classes[0].body
    defs = [n for n in body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == fname]
    if len(defs) != 1:
        return None
    node = defs[0]
    lines = source.splitlines()
    first = min([node.lineno] + [d.lineno for d in node.decorator_list])
    # mutmut keeps the comment lines directly above the function and drops only LEADING blank lines.
    top = first
    while top > 1 and (not lines[top - 2].strip() or lines[top - 2].lstrip().startswith("#")):
        top -= 1
    while top < first and not lines[top - 1].strip():
        top += 1
    old_start, old_side, first_removed = hunk
    at = top + old_start - 1
    want = [ln.strip() for ln in old_side]
    if at < 1 or [ln.strip() for ln in lines[at - 1 : at - 1 + len(want)]] != want:
        return None
    return top + first_removed - 1


def survivor_location(sv: dict) -> str:
    """` (line N)` for a survivor record that knows its file line, else `""` — absence prints as nothing,
    never as `line 0`."""
    line = sv.get("file_line")
    return f" (line {line})" if isinstance(line, int) and not isinstance(line, bool) and line > 0 else ""


# ── A KILL IS A DETECTION, OR IT IS NOTHING (2026-10-05) ──────────────────────────────────────────
# `classify` used to read REFUTED off ABSENCE: a key that mutmut generated and that did not come back
# a survivor was called killed, and the gate then printed "the recorded claim is wrong" — an
# instruction to DELETE a correct equivalence entry. Heron measured the same tree three times: a
# contended run reported 15 entries REFUTED with ZERO timeouts, the next reported 17 UNDECIDED, and a
# quiet run reported the same 15 as SURVIVED. Two of them survive the covering suite by hand. 15
# correct claims were deleted and very nearly landed (reverted 452e557f).
#
# ⚠️ THE SENTENCE THAT EXPLAINS THE WHOLE DAY is in mutmut's own status map (`mutmut/stats.py`):
#
#       3: "killed",  # internal error in pytest means a kill
#
# Under contention pytest exits 3 — a reaped worker, an xdist crash, OOM — and mutmut RECORDS A KILL.
# So the mutant is not a survivor, is not undecided, and is positively "killed": the contended run had
# nothing to report as a timeout, which is exactly the shape Heron saw. "Only refute on a positively
# recorded kill" would therefore accept the very status that lied.
#
# A kill means THE COVERING SUITE FAILED. Under load a suite fails for reasons that have nothing to do
# with the mutant, and that lands on exit 1 as readily as on 3. So one kill is never enough:
#   · absence NEVER refutes — it is `not_decided`, and the run is UNKNOWN rather than FAIL (§🧾);
#   · a kill is read from the RAW EXIT CODE, not from mutmut's status word, and 3 is not a detection;
#   · and a refutation must be CORROBORATED by an isolated re-run that is itself judged for load.
TRUSTED_KILL_EXIT = 1  # pytest: "tests were collected and run but some failed" — a test SAW it
MUTMUT_KILL_EXITS = (1, 3)  # what mutmut itself calls "killed"; 3 is pytest's own internal error


def kill_is_a_detection(exit_code) -> tuple[bool, str]:
    """`(trusted, why_not)` for one mutant's raw pytest exit code.

    ONLY exit 1 is evidence that a test observed the mutant. Exit 3 is pytest's INTERNAL ERROR, which
    mutmut maps to "killed" in as many words, and which contention produces on a tree where every
    test passes. Everything else — 0 (survived), 5/33 (no tests), 34 (skipped), 36 (timeout), None
    (not checked), or an exit code nobody has met — is not a detection either, so this fails CLOSED on
    a status invented next year rather than enumerating the ones known today."""
    if exit_code == TRUSTED_KILL_EXIT:
        return True, ""
    if exit_code == 3:
        return False, (
            "pytest exit 3 is an INTERNAL ERROR, not a test failure — mutmut records it as a kill "
            '(`3: "killed"  # internal error in pytest means a kill`), and contention produces it '
            "on a tree whose tests all pass"
        )
    if exit_code is None:
        return False, "no exit code was recorded — the mutant was never decided in this run"
    return False, f"exit code {exit_code!r} is not pytest's test-failure exit, so no test observed the mutant"


def refutation_corroborated(first_exit, second_exit) -> tuple[bool, str]:
    """`(corroborated, why_not)` — a refutation needs TWO trusted kills, and the second is judged too.

    The isolated re-run is run under the same load the first one met, so it can fail for the same
    unrelated reasons. Taking it as a second vote whenever it is not a survivor would rebuild the
    defect one level up: a re-run that returns exit 3, a timeout or nothing is UNDECIDED, never
    agreement."""
    ok1, why1 = kill_is_a_detection(first_exit)
    if not ok1:
        return False, f"the first kill is not a detection: {why1}"
    ok2, why2 = kill_is_a_detection(second_exit)
    if not ok2:
        return False, f"the isolated re-run did not corroborate it: {why2}"
    return True, ""


def entry_matches_function(entry: dict, fn: str) -> bool:
    """Whether an equivalence entry may speak about a mutant in function `fn`.

    An entry is matched on its KEY, and `diff_key` builds that key from the mutant's changed diff lines
    alone. For an expression mutation the text is distinctive; for a BARE STATEMENT mutation it is not —
    a `continue` turned into a `break` keys as `- continue | + break`, and one module holds fourteen bare
    `continue` statements across six functions. One recorded argument then excused every other
    function's occurrence of the same line, which is residue
    `2026-10-05-a-mutant-key-is-not-unique-within-a-module-for-a-bare-statement-mutation`, and the day a
    PR brought a second occurrence into scope the gate reported the collision as a REFUTED claim —
    residue `2026-10-04-an-equivalence-key-cannot-name-its-function`, measured on #3263.

    `function` is OPTIONAL and the absent case is today's behaviour exactly: an entry without it speaks
    for the whole module, so no existing entry has to be re-verified. An entry that carries it speaks
    for that function and no other.

    ⚠️ AN UNREADABLE FUNCTION DOES NOT MATCH A QUALIFIED ENTRY. `function_of_mutant` returns "" rather
    than guessing, and a qualified entry over an unnamed mutant is a claim nobody can check — so the
    survivor stays unexcused and the gate fails. That is the fail-closed arm: the cost is a survivor
    the reader must look at, and the alternative cost is an excuse granted to a mutant in an unknown
    place."""
    want = entry.get("function")
    if not want:
        return True
    return want == fn


def kill_attributed_to(entry: dict, key: str, kills) -> bool:
    """Whether a CORROBORATED kill in `kills` refutes this entry.

    `kills` holds bare keys (a kill nobody attributed to a function) or `(key, function)` pairs. REFUTED
    is the one verdict in this module that destroys work — it instructs a reader to delete a recorded
    claim — so attribution fails closed in BOTH directions:

      · an entry with no `function` is refuted by any kill of its key, which is what it has always been;
      · an entry WITH one is refuted only by a kill attributed to that same function, because the kill
        that refuted #3245's entry was a kill in `timebase` over an argument made about `unrecorded_shift`;
      · an UNATTRIBUTED kill never refutes a qualified entry. The claim is about one function and the
        kill is about an unknown one, so the two do not meet.
    """
    want = entry.get("function")
    for k in kills or ():
        if isinstance(k, tuple):
            if k[0] == key and (not want or want == k[1]):
                return True
        elif k == key and not want:
            return True
    return False


# ── THE INHERITED SET — residue `2026-10-30-the-mutation-gate-selects-a-whole-entry-point-for-one-line` ──
# The gate selects whole FUNCTIONS, and these four functions do NOT change that. #1761 measured the
# alternative and the lead ruling that endorsed function-wide scoping stands: a bound keyed on the
# changed LINES walks past the holes a one-line edit opens. What moves here is BLAME.
#
# Measured 2026-10-30 on #4126: one logging statement added to `radioclock.main` put 27 pre-existing
# survivors of code that PR never wrote into a red gate, and the second push — the same statement,
# moved out of `main` — passed the same gate with 0 survivors. The signal was the SELECTION, not the
# diff. So a survivor that main's record already owns is reported and does not fail the run, and
# every other survivor fails it exactly as before.
#
# The record is `mutation-survivors.json`: entries keyed on lane + module + function + the mutant's
# diff pair, whose open count is already held down by the two-sided ratchet in
# `tools/mutation-survivors.mjs`. Nothing here forgives debt. It moves the debt to the ledger that
# counts it, which is the shape the mypy baseline in `check.sh` already runs.
BASELINE_SEP = "::"
INHERITED_REPORT_LIMIT = 12


def baseline_id(module, function) -> str:
    """The per-function identity a baseline is keyed on — `""` when either half is missing.

    The module is reduced to its BASENAME because the ledger holds both spellings: an ingest writes
    `nightqc.py` and the 2026-09-28 backfill wrote `capture-host/loss_audit.py`, while this gate only
    ever knows the basename (`changed_lines` keeps `Path(p).name`). `""` is the fail-closed value — a
    survivor whose module or function cannot be named inherits nothing.
    """
    # THE BASENAME THROUGH A PATH OBJECT, AND NOT `rsplit("/", 1)[-1]`. Measured 2026-10-31 on this
    # gate's own run against itself: every maxsplit a mutation can write leaves `[-1]` the LAST
    # field, so `rsplit("/")` and `rsplit("/", 2)` are both indistinguishable from the original and
    # survive by construction. Two unkillable mutants, for a basename a path object already knows.
    mod = pathlib.PurePosixPath(str(module or "").strip()).name
    fn = str(function or "").strip()
    if not mod or not fn:
        return ""
    return f"{mod}{BASELINE_SEP}{fn}"


def baseline_from_ledger(raw, lane="py") -> dict:
    """`{module::function: {key: [owning PR, …]}}` — the survivors main's record already owns.

    PURE. Four refusals, every one fail-closed, because an entry that cannot be checked must excuse
    nothing:

      · a lane that is not this gate's;
      · a state that is not `open` — `equivalent` is the equivalence ledger's business and
        `killed #N` is answered, so neither is inherited debt;
      · an entry naming no FUNCTION, which would otherwise inherit module-wide. That is the exact
        over-reach `entry_matches_function` is written against, and here it would be worse: a
        bare-statement key names fourteen occurrences across six functions;
      · an entry naming no PR. Nobody can attribute it, so nobody can close it, and
        `mutation-survivors.mjs ratchetVerdict` refuses the same row.

    A LIST PER KEY AND NOT A SET, for `classify`'s own reason: two bare-statement mutants in one
    function share a key by construction. Three recorded occurrences inherit three survivors and a
    fourth is new. The list holds the PRs that recorded them, so the report can name an owner.
    """
    out: dict = {}
    entries = raw.get("entries") if isinstance(raw, dict) else None
    for e in entries or []:
        if not isinstance(e, dict) or e.get("lane") != lane or e.get("state") != "open":
            continue
        pr = e.get("pr")
        if not isinstance(pr, int) or isinstance(pr, bool) or pr <= 0:
            continue
        ident = baseline_id(e.get("module"), e.get("function"))
        key = str(e.get("key") or "").strip()
        if not ident or not key:
            continue
        out.setdefault(ident, {}).setdefault(key, []).append(pr)
    return out


def split_inherited(survivors, baseline):
    """`(new, inherited)` over the survivors nobody spoke for. PURE.

    An inherited survivor carries `inheritedFrom` — the PR whose run recorded it — so a reader can
    reach the measurement that owns it. Multiplicity is CONSUMED: the second survivor sharing a key
    inherits only while the record holds that key twice.

    ⚠️ EVERY FALL-THROUGH IS NEW, which is this gate's behaviour before a baseline existed. A
    function the record never saw, a survivor whose function cannot be read, a key the record does
    not hold, one occurrence too many — each one still fails the run.
    """
    pool = {i: {k: list(v) for k, v in m.items()} for i, m in (baseline or {}).items()}
    new: list = []
    inherited: list = []
    for sv in survivors or []:
        # `sv.get("mutant")` CARRIES NO DEFAULT ON PURPOSE. `function_of_mutant` reads `None` and
        # `""` identically (`if not name: return ""`), so a spelled-out `""` default is a mutant
        # nothing can kill — two of them on this one line, measured 2026-10-31.
        fn = sv.get("function") or function_of_mutant(sv.get("mutant"))
        owners = pool.get(baseline_id(sv.get("module"), fn), {}).get(str(sv.get("key") or "").strip())
        if owners:
            inherited.append(dict(sv, function=fn, inheritedFrom=owners.pop(0)))
        else:
            new.append(sv)
    return new, inherited


def inherited_report(inherited, limit=INHERITED_REPORT_LIMIT, locate=None) -> list:
    """The lines a reader is owed about an inherited set — `[]` when there is nothing to say.

    A function rather than prose inside `main`, because `main` is 1600 lines in a file outside the
    coverage source roots and nothing measures its branches. `locate` is injected so this module
    need not import the gate's own `survivor_location`.
    """
    rows = list(inherited or [])
    if not rows:
        return []
    loc = locate or (lambda _s: "")
    out = [
        f"\n  {len(rows)} survivor(s) are INHERITED — main's record already owns them, so they do not fail this run:"
    ]
    for s in rows[:limit]:
        out.append(f"  ── {s.get('mutant')}{loc(s)}  (recorded by #{s.get('inheritedFrom')})")
    if len(rows) > limit:
        out.append(f"     … and {len(rows) - limit} more (all of them in the --json record)")
    out.append(
        "     Every one is still `open` in mutation-survivors.json and still counted by\n"
        "     `tools/mutation-survivors.mjs ratchet`, which lets that number fall and never rise.\n"
        "     An unrecorded function inherits NOTHING: there, every survivor still fails."
    )
    return out


def classify(entries, survivors, killed, generated=(), not_required=(), unchecked=(), baseline=None):
    """Split survivors against the recorded classification.

    PURE, so `--selftest` can pin it without running a sweep. `survivors` are dicts carrying `key`;
    `killed` is the set of keys with a CORROBORATED, TRUSTED kill (see `kill_is_a_detection` and
    `refutation_corroborated`); `generated` is every key this run produced, used only to tell a line
    that MOVED from a mutant that was never decided.

    ⚠️ THE DEFAULT IS INVERTED FROM THE ONE THIS FUNCTION SHIPPED WITH. Membership in `surv` and in
    `killed` are both POSITIVE observations and are tested as such; everything else falls through to
    `not_decided` or `orphaned`. Absence can no longer reach `refuted` by any path, because absence is
    what a reaped worker, a partial run and an unreported shard all look like."""
    # ⚠️ A LIST PER KEY, NEVER ONE SURVIVOR PER KEY. This was `{sv["key"]: sv for sv in survivors}`,
    # so two survivors sharing one key DEDUPLICATED here — the gate reported one survivor where two
    # existed, before any entry was read, and the loss was invisible because the count simply looked
    # lower. Two bare-statement mutants in different functions share a key by construction (see
    # `entry_matches_function`), so this is reachable on any module with a repeated bare statement.
    _rows = [(i, sv, sv.get("function") or function_of_mutant(sv.get("mutant", ""))) for i, sv in enumerate(survivors)]
    surv: dict = {}
    for _r in _rows:
        surv.setdefault(_r[1].get("key", ""), []).append(_r)
    kills = set(killed or ())
    # JUST `generated`, and the two unions it used to carry are gone for two reasons. They were
    # PROVABLY DEAD: a key in `surv` or in `kills` is routed by the branches below before the `k in
    # gen` test is ever reached, so neither term can contribute a key that reaches it. And the key
    # `diff_key` builds for this line contained the ` | ` separator that keys are JOINED with, so the
    # survivor printer split it and rendered a mutant on this line as an unreadable no-op diff —
    # residue `2026-09-29-survivor-printer-splits-a-key-on-its-own-separator`, met here by writing a
    # line that walks into it. A line whose survivors cannot be read is a line nobody can drain.
    gen = set(generated)
    # 🔴 THE KEYS THIS RUN DECIDED NOT TO REQUIRE, which is a THIRD state and was being read as a
    # missing measurement. A survivor whose diff is string-only (or empty) is dropped from `survivors`
    # on purpose — it is excluded, not unmeasured — but a registered claim naming it then matched
    # neither `surv` nor `kills`, fell through to `not_decided`, and REFUSED the whole run: exit 2 over
    # a mutant the gate itself had chosen not to require. Measured 2026-10-11 on #3395: of four claims
    # on `loss_audit._has_worn_evidence`, the two the scan calls `string-only` (`"utf-8"` -> `"UTF-8"`,
    # `rstrip("\n")` -> `rstrip("XX\nXX")`) were exactly the two refused, while the other two came back
    # `required`, reached `surv` and were excused normally. mutmut had settled all 67 of that function's
    # mutants and `mutmut results` reported all four as `survived`, so nothing was unmeasured at all.
    not_req = set(not_required)
    # Keys still without a result AFTER one isolated run. Deterministically unchecked, which is a
    # measurement about the GATE and not about the entry — so it is counted and named, never a refusal
    # (nothing is wrong) and never a PASS (nothing was shown).
    unchk = set(unchecked)
    out = {
        "excused": [],
        "real_gap": [],
        # ALWAYS PRESENT, EMPTY WHEN THERE IS NOTHING (§∅): an empty list is "looked and found none",
        # and a missing key would read to a consumer as "this run does not do that".
        "inherited": [],
        "refuted": [],
        "orphaned": [],
        "unclassified": [],
        "unproven": [],
        "not_decided": [],
        "claimed_not_required": [],
        "claimed_unchecked": [],
    }
    # The survivors an entry SPOKE FOR, by position in `survivors` — not by key, because one key may
    # now name several survivors and an entry may speak for only some of them.
    _claimed_rows: set = set()
    for e in entries or []:
        k = e.get("key", "")
        _hits = [r for r in surv.get(k, ()) if entry_matches_function(e, r[2])]
        if _hits:
            _claimed_rows.update(r[0] for r in _hits)
            if e.get("class") in EXCUSING:
                _why = float_boundary_unprobed(k, e.get("probe"))
                if _why:
                    out["unproven"].append(dict(e, why=_why))
                else:
                    out["excused"].append(e)
            else:
                out["real_gap"].append(e)  # recorded debt, still fails
        elif kill_attributed_to(e, k, kills):
            out["refuted"].append(e)  # a CORROBORATED kill: a distinguishing input does exist
        elif k in unchk:
            out["claimed_unchecked"].append(
                dict(
                    e,
                    why="generated, and still no result after one isolated run — the gate could not check it, which says nothing about the claim",
                )
            )
        elif k in not_req:
            # COUNTED AND NAMED, never a refusal and never a silent pass. The claim is not evidence of
            # anything here and needs none: the mutant was excluded from the required set before any
            # equivalence question arose, so there is nothing for the entry to excuse.
            out["claimed_not_required"].append(
                dict(
                    e,
                    why="the mutant is excluded from the required set (string-only or empty diff), so this claim excused nothing in this run",
                )
            )
        elif k in gen:
            out["not_decided"].append(
                dict(e, why="mutant not decided in this run — generated, never settled, so it is unmeasured")
            )
        else:
            out["orphaned"].append(e)  # the line moved — excuses nothing until re-verified
    for _i, _sv, _fn in _rows:
        if _i not in _claimed_rows:
            out["unclassified"].append(_sv)
    # THE BLAME SPLIT RUNS LAST, after every entry has spoken. An equivalence entry outranks the
    # baseline by construction: a claimed survivor never reaches `unclassified`, so a recorded
    # argument still excuses it and the record is never consulted for it. `baseline=None` — the
    # default, and every caller that predates the record — splits nothing.
    out["unclassified"], out["inherited"] = split_inherited(out["unclassified"], baseline)
    return out


# ── THE RUN BUDGET — residue 2026-09-17-mutation-scope-selects-whole-functions ─────────────────────
# A gate that dies with no verdict is not a gate (CLAUDE.md §4c). Measured 2026-09-21 in the course of
# closing that row: the cost that made #2590's job run 98 min "Generating mutants" and then die is NOT
# the size of the functions selected (2422 lines) — it is the SELECTION. `capture.py`'s test selection
# is 76 of 78 files and one clean run of it took 936.7 s here; `run_one` re-timed that clean run for
# EVERY glob (5 globs → 78 min of pure re-timing before a mutant existed) and mutmut's stats pass runs
# the same selection again under tracing. So the un-mutatable surface is "a change to a module whose
# selection is the whole suite", not "three functions over 800 lines" — the size row measured the
# wrong quantity. Two bounds, both stated as numbers before any run, both REFUSALS (a refusal is a
# verdict with a reason; a SIGTERM is not):
#   · PRE-WORK: the clean run is timed ONCE per module and the predicted pre-work (that clean run plus
#     this module's MEASURED stats pass, read from tools/mutation-prework.json) must fit in what is
#     left of the gate budget, or the module is refused BEFORE any mutant is generated, naming the
#     module, its clean time, the recorded stats time and where that number was measured. A module
#     with no recorded stats pass is not predicted at all: the bound reports the absence and the WALL
#     bound below is what still holds (owner ruling, board #71 item 3, 2026-10-17).
#   · WALL: every mutmut invocation gets the REMAINING budget as its cap; a cap that is hit returns
#     partial counts behind `timed_out`, and the gate refuses on it naming the glob and how far it got.
GATE_BUDGET_SEC = 7200  # 2 h of gate wall time. Pre-stated: no mutation job in the visible history
# produced a verdict past 98 min; the workflow cap sits above this so the
# tool refuses before the runner kills it.
# ── THE PRE-WORK BOUND READS A MEASUREMENT, NOT A FACTOR (owner ruling, board #71 item 3, 2026-10-17)
# This was `PREWORK_TRACE_FACTOR = 2.0`, an assumption that said so of itself and asked to be replaced
# by a measured figure. The measurement arrived as a failure: #3238 reached NO mutant on `capture.py`
# with 1337 s of selection plus clean run, generation under 1 s, then a traced stats pass of at least
# 7556 s — so the factor under-predicted by at least 5.6x, and it under-predicted on the one module the
# bound exists for. 2.0 held for the cheap modules and failed on the expensive one, which is the shape
# of an assumption that cannot be fixed by a better constant: the stats pass is a coverage pass over the
# module's TEST SELECTION, and `--estimate` measured a 30x spread in selection cost across modules.
# A per-module number is therefore the only honest one, and it has to come from a run.
#
# So the factor is gone and the prediction is `clean run + this module's recorded stats pass`, keyed to
# the selection it was measured over, written by `tools/mutate.py --record-prework` from a run that
# observed both phase boundaries. A module with NO record is not predicted: `prework_estimate` returns
# `None` and the gate prints `prework_unmeasured_note`, because a bound that invents a number for the
# module it has never measured is the defect this replaces (§∅ — absence is null, never a default).
PREWORK_FILE = "mutation-prework.json"
PREWORK_SCHEMA = "tepna.mutation-prework/1"

# THE RECORDED CLEAN RUN IS A VALIDITY BOUND ON THE CACHED NUMBER, AND IT IS NOT A SUBSTITUTE FOR IT.
# The two live in the same record and were measured in the same run, so a clean run that now reads far
# from the recorded one says the selection or the machine changed — a hosted runner measured 1432 s
# where the rig measured 937 s on the same module (#3202). Outside the factor the cached stats time is
# treated as ABSENT, never rescaled: a ratio correction would be a new assumption wearing the old one's
# clothes, and absence is a status the gate already reports honestly.
PREWORK_CLEAN_DRIFT = 2.0


def selection_hash(tests: "list[str]") -> str:
    """sha256[:12] over the test SELECTION — the key a cached stats time is filed under.

    Keyed on the selection and not on the module's source, because the stats pass is a coverage pass
    over the tests mutmut will run: the module's own bytes do not set its cost. A selection that gains
    or loses a file therefore reads as ABSENT rather than inheriting the old module's number.
    ⚠️ WHAT THIS KEY CANNOT SEE: a test's CONTENTS changing inside an unchanged file list. That is what
    the recorded clean run is for (`prework_stale_reason`) — a slower selection shows up in the clean
    run this gate times anyway, which is a measurement rather than a second hash."""
    return hashlib.sha256("\n".join(sorted(tests)).encode("utf-8")).hexdigest()[:12]


def prework_record(text):
    """Parse the committed `tools/mutation-prework.json` into `{(module, selection_hash): entry}`.

    WHY COMMITTED, on the same argument as `tools/mutation-sizes.json`: every CI run is a fresh scratch,
    so a stats time remembered only beside the scratch is one CI never has. Tool-written by
    `tools/mutate.py --record-prework`; a hand-typed number here would be indistinguishable from a
    measured one, which is the whole value of the file. A key miss is ABSENT — never a factor, never
    the nearest module, and a non-positive or non-numeric `statsSec` is absence too."""
    try:
        doc = json.loads(text or "{}")
    except ValueError:
        return {}
    out = {}
    for key, entry in (doc.get("prework") or {}).items():
        module, _, sel = key.partition("@")
        if not module or not sel or not isinstance(entry, dict):
            continue
        stats = entry.get("statsSec")
        if isinstance(stats, bool) or not isinstance(stats, (int, float)) or stats <= 0:
            continue
        clean = entry.get("cleanSec")
        ok_clean = not isinstance(clean, bool) and isinstance(clean, (int, float)) and clean > 0
        out[(module, sel)] = {
            "statsSec": float(stats),
            "cleanSec": float(clean) if ok_clean else None,
            "measuredAt": entry.get("measuredAt"),
            "host": entry.get("host"),
        }
    return out


def merge_prework(text, module, sel_hash, stats_sec, clean_sec, measured_at, host):
    """The record with this measurement added, as JSON text. Idempotent on an unchanged measurement.

    An existing entry is REPLACED rather than averaged, for the reason `merge_mutants_size` gives: the
    same selection costing a different stats pass means the machine or the tests changed, and the newer
    measurement is the one that describes this tree. The previous value stays in `supersedes` so the
    change is visible to a reader who did not run either."""
    try:
        doc = json.loads(text or "{}")
    except ValueError:
        doc = {}
    doc.setdefault("schema", PREWORK_SCHEMA)
    doc.setdefault(
        "note",
        "Measured stats-pass seconds per (module, test-selection sha256[:12]), written by "
        "tools/mutate.py --record-prework from a run that observed both phase boundaries: "
        "generation's end and the first mutant verdict. It REPLACED a 2.0 trace factor that "
        "under-predicted capture.py by at least 5.6x. NEVER hand-edited: a typed number here is "
        "indistinguishable from a measured one. A key miss is absent, not a default, and the gate "
        "reports the absence instead of predicting.",
    )
    prework = doc.setdefault("prework", {})
    key = f"{module}@{sel_hash}"
    prior = prework.get(key)
    entry = {
        "statsSec": round(float(stats_sec), 1),
        "cleanSec": round(float(clean_sec), 1),
        "measuredAt": measured_at,
        "host": host,
    }
    if isinstance(prior, dict) and prior.get("statsSec") not in (None, entry["statsSec"]):
        entry["supersedes"] = prior.get("statsSec")
    prework[key] = entry
    doc["prework"] = dict(sorted(prework.items()))
    return json.dumps(doc, indent=2) + "\n"


def prework_stale_reason(clean_now, clean_recorded, drift=PREWORK_CLEAN_DRIFT):
    """Why a cached stats time does not describe THIS run, or None when it does."""
    if not clean_recorded:
        return "the record carries no clean run of its own, so nothing says it describes this machine"
    if not (clean_recorded / drift) <= clean_now <= clean_recorded * drift:
        return (
            f"the clean run measured {clean_now:.1f}s here against {clean_recorded:.1f}s when the stats "
            f"pass was recorded — over a factor of {drift:g}, so this is a different machine or a "
            f"different selection and the recorded number does not describe it"
        )
    return None


def cached_stats_sec(record, module, tests, clean_now, drift=PREWORK_CLEAN_DRIFT):
    """`(stats_sec, basis)` for this module's selection — `(None, reason)` when nothing describes it.

    The basis travels WITH the number because a measurement from another host is still a measurement
    and the reader has to be able to see which one: the refusal prints it, exactly as the old one
    printed the factor it multiplied."""
    sel = selection_hash(tests)
    entry = record.get((module, sel))
    if entry is None:
        return None, f"no recorded stats pass for {module}'s current selection ({sel})"
    why = prework_stale_reason(clean_now, entry.get("cleanSec"), drift)
    if why:
        return None, why
    return entry["statsSec"], (
        f"measured {entry['statsSec']:.0f}s on {entry.get('host') or 'an unnamed host'} "
        f"{entry.get('measuredAt') or 'on an unrecorded date'}, selection {sel}"
    )


def stats_pass_seconds(gen_done_sec, first_mutant_sec):
    """The stats pass, measured: generation's end to the FIRST mutant verdict.

    `None` when either boundary was never observed. A run killed in generation and a run that generated
    and then tested nothing both measured no stats pass, and the elapsed time of either is a
    well-formed float that would read as one — the #3238 shape, where 618 spinner lines carried zero
    mutant ticks. Both boundaries come from the emitter: mutmut's own generation line, and a distinct
    mutant id appearing."""
    if gen_done_sec is None or first_mutant_sec is None:
        return None
    if first_mutant_sec < gen_done_sec:
        return None  # observed out of order: not a measurement, and never a negative stats pass
    return first_mutant_sec - gen_done_sec


def prework_estimate(clean_sec: float, stats_sec: "float | None") -> "float | None":
    """Seconds a module costs BEFORE its first mutant is tested: one clean run (already spent when this
    is called — it is what measured `clean_sec`) plus its MEASURED stats pass.

    `None` when the stats pass is unmeasured, and that is the point of the change above: the caller
    reports the absence (`prework_unmeasured_note`) instead of multiplying a constant nobody measured."""
    if stats_sec is None:
        return None
    return clean_sec + stats_sec


def prework_unmeasured_note(module: str, clean_sec: float, n_globs: int, why: str) -> str:
    """The line a gate prints when the pre-work bound could not be EVALUATED.

    NOT a pass and not a refusal: nothing here says the module fits, only that this bound examined
    nothing (§🧾's `NOT_RUN`, one bound down). It names the measurement that is missing and the command
    that produces it, so the absence is closable rather than permanent."""
    return (
        f"{module}: the pre-work bound was NOT evaluated — {why}. The clean run measured "
        f"{clean_sec:.1f}s here and {n_globs} function(s) are selected; the wall bound on each mutmut "
        f"invocation is what still holds. This is not a verdict that the module fits. Record the "
        f"measurement with `tools/mutate.py {module[:-3]} --record-prework` and the bound binds on the "
        f"next run."
    )


def budget_refusal(
    module: str,
    clean_sec: float,
    n_globs: int,
    left_sec: float,
    stats_sec: "float | None" = None,
    basis: "str | None" = None,
) -> str | None:
    """A refusal reason when the module's predicted pre-work does not fit in what is left, else None.
    Names every number it used, so the reader can re-derive the verdict — never just "too big".

    ⚠️ `None` means THIS BOUND RAISED NO REFUSAL, which is not the same as "it fits": an unmeasured
    stats pass yields no prediction, and the caller owes `prework_unmeasured_note` there. `tools/
    mutate_diff.py` is the one caller and does both; `tools/find_unwired.py` is what keeps it so."""
    est = prework_estimate(clean_sec, stats_sec)
    if est is None or est <= left_sec:
        return None
    return (
        f"{module}: predicted pre-work {est:.0f}s (clean run {clean_sec:.1f}s + stats pass "
        f"{stats_sec:.0f}s, {basis or 'provenance unrecorded'}) exceeds the {left_sec:.0f}s left of "
        f"the {GATE_BUDGET_SEC}s gate budget — {n_globs} function(s) selected, none mutated. This is a "
        f"REFUSAL with a reason, not a verdict on the diff: the module's test selection is too costly "
        f"to mutate in one gate run. Scope the change, or run `tools/mutate.py --only` locally on the "
        f"function(s)."
    )


CAP_FLOOR_SEC = 1.0  # never wait less than this, however far the budget is already overspent:
# a zero or negative wait would kill a child that is about to finish.
JOIN_SEC = 10.0
# The bounded join on the reader thread, and it is LOAD-BEARING: with mutmut's worker shape the surviving
# grandchildren hold the pipe open, so the reader never sees EOF and this is what makes the refusal return
# in cap + reap + join instead of hanging (measured 13.00 s against a 43 s bound).
# 🔴 IT IS A CONSTANT RATHER THAN A SIGNATURE DEFAULT BECAUSE A DEFAULT CANNOT BE MUTATION-TESTED HERE.
# mutmut wraps the function as `@_mutmut_mutated(mutants_x_stream_bounded__mutmut)` over a `def` that
# keeps the ORIGINAL defaults and dispatches to the mutant dict at CALL time — so
# `inspect.signature(stream_bounded).parameters["join_sec"].default` reads 10.0 under every mutant, and
# the `join_sec=10.0 → 11.0` mutant SURVIVED an assertion that would have failed on the real signature.
# Same family as #3181's "survives mutmut's trampoline". A module constant is not decorated, so mutating
# it is visible.
GROUP_GRACE_SEC = 5.0
# SIGTERM first, then SIGKILL after this grace. mutmut writes its results incrementally, so a terminating
# worker that gets to flush leaves a readable partial record where a SIGKILLed one leaves a torn file —
# the same reasoning #3234 gives for the JS sweep ("a restore that is interrupted is the failure being
# fixed"). The grace is small because nothing here is transactional; it only has to beat a write.
REAP_SEC = 30.0  # bound on the post-kill reap. `None` here would hand an unkillable child
# the same unbounded wait this whole function exists to remove.


def cap_remaining(cap_sec, t0, now):
    """Seconds still owed to a child that started at `t0` under a `cap_sec` budget, floored.

    Extracted from `stream_bounded` so the deadline arithmetic can be asserted as NUMBERS. Pinned by
    a wall-clock test it is only pinned to within the test's own tolerance, and the mutation gate
    said so: `max(1.0, …)` → `max(2.0, …)`, `cap_sec - elapsed` → `cap_sec + elapsed`, and
    `now - t0` → `now + t0` all survived a timing assertion that could not afford a tight bound.
    `t0` is the CALLER's start, not this call's: `tools/mutate.py` measures it before the clean run,
    so a cap must count from there or the pre-work is free.
    """
    return max(CAP_FLOOR_SEC, cap_sec - (now - t0))


# ── SCRATCH OWNERSHIP — a prune must not delete a directory another session is still using ─────────
# `tools/mutate.py` deletes every `/tmp/mut-<module>-*` that is not the run's own hash, to stop a cache
# with no eviction from filling a tmpfs. With several sessions sweeping the same module at different
# source hashes, that is each of them deleting the others' live scratch — a 536 MB tree and hours of
# stats, gone mid-run, reported as nothing (residue 2026-09-25-mutate-prune-closure-unverified; the
# holder #3027 would have added was CLOSED UNMERGED, so this has been live the whole time).
#
# This is NOT the pytest-basetemp question `tests/test_tmp_basetemp_race.py` answers. That file pins
# that sessions get their own basetemp and cannot reap each other's; this is the mutation SCRATCH,
# one level up, where the deletion is explicit and unconditional rather than incidental.
SCRATCH_OWNER_FILE = ".owner"
SCRATCH_MIN_AGE_SEC = 120.0
# An owner we can PROVE is gone still gets a grace, but a short one, and the length is a trade the
# reader should see: the scratch is claimed before the copy and re-claimed by whoever reuses it, so a
# proven-dead owner means nobody is in that tree — the only thing this floor buys is the seconds a
# process spends exiting. Set long (600 s was tried), it changes single-session behaviour, because the
# previous run's own scratch is exactly a proven-dead owner and iteration then leaves several 536 MB
# trees on a tmpfs. Two minutes covers an exiting process and keeps eviction prompt.
SCRATCH_UNKNOWN_MIN_AGE_SEC = 86400.0
# ⚠️ THE TWO FLOORS DIFFER BECAUSE "NO OWNER FILE" IS NOT "NO OWNER" (§∅). A directory from before this
# change, or one whose marker never got written, tells us NOTHING about whether a process holds it —
# and treating unknown as dead is exactly the deletion this exists to prevent. So an unmarked scratch
# is not judged; it is simply outlived. A day is far longer than any mutation run observed here (the
# worst measured is a 2 h 41 m stats pass), so a marker-less tree that old is abandoned by duration,
# not by inference.


def proc_start_ticks(pid, proc_root="/proc"):
    """A running process's start time in clock ticks, or None when there is no such process.

    Parsed from the text AFTER the last `)`, because field 2 of /proc/<pid>/stat is the executable
    name and may itself contain spaces and parentheses — splitting the whole line on whitespace is
    the classic way to read the wrong field for a process someone named creatively."""
    try:
        with open(f"{proc_root}/{int(pid)}/stat", encoding="utf-8") as fh:
            text = fh.read()
        after = text[text.rindex(")") + 1 :].split()
        return int(after[19])  # field 22 overall; fields 1-2 are consumed by pid and comm
    except (OSError, ValueError, IndexError):
        return None


def owner_record(pid, start_ticks):
    """The line written into a scratch's owner file: PID plus the process's own start time.

    The start time is what makes this safe against PID REUSE. A bare PID recorded hours ago may now
    belong to an unrelated process, and `kill -0` would then report a live owner forever and the
    scratch would never be evicted — a leak dressed as caution. Comparing the start time as well
    means the answer is about THIS process, not whoever inherited its number."""
    return f"{int(pid)} {int(start_ticks)}"


def parse_owner_record(text):
    """`(pid, start_ticks)` or None — None meaning UNKNOWN, never "nobody"."""
    if not text:
        return None
    parts = text.strip().split()
    if len(parts) != 2:
        return None
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return None


def owner_is_live(record, start_ticks_of):
    """True / False / None(unknown). `start_ticks_of(pid)` returns the running process's start ticks,
    or None when there is no such process.

    Three-valued on purpose: the caller must be able to tell "this owner is gone" from "there is no
    marker to read", because they earn different floors above."""
    if record is None:
        return None
    pid, ticks = record
    live = start_ticks_of(pid)
    if live is None:
        return False
    return live == ticks


def scratch_prune_decision(
    *, is_current, owner_live, age_sec, min_age_sec=SCRATCH_MIN_AGE_SEC, unknown_min_age_sec=SCRATCH_UNKNOWN_MIN_AGE_SEC
):
    """`(prune, reason)` for ONE candidate scratch. Pure, and it always says WHY.

    The reason is not decoration: a prune that removed a peer's tree used to print only the directory
    name, so the one line that could have named the mistake said nothing about ownership at all."""
    if is_current:
        return False, "this run's own scratch"
    if owner_live is True:
        return False, "a live process still holds it"
    if owner_live is None:
        if age_sec < unknown_min_age_sec:
            return False, (
                f"no owner marker to read, and {age_sec:.0f}s old — under the "
                f"{unknown_min_age_sec:.0f}s floor for an unmarked tree, so it is outlived, "
                f"not judged"
            )
        return True, f"no owner marker and {age_sec:.0f}s old — outlived the unmarked floor"
    if age_sec < min_age_sec:
        return False, (
            f"its owner is gone but it is only {age_sec:.0f}s old — under the "
            f"{min_age_sec:.0f}s floor, in case that owner is still exiting"
        )
    return True, f"its owner is gone and it is {age_sec:.0f}s old"


def prune_scratches(tmp_root, stem, current, now=None, start_ticks_of=proc_start_ticks, remove=None):
    """Delete this module's stale scratches and return `(pruned, held)` — `held` carrying the REASON
    each survivor was kept.

    HERE rather than in `tools/mutate.py` for the reason that file's own header gives: a function
    that can give a WRONG ANSWER rather than failing loudly belongs inside the coverage floor. This
    one deletes 536 MB trees, and its wrong answer is another session's run.
    """
    remove = shutil.rmtree if remove is None else remove
    now = time.time() if now is None else now
    pruned, held = [], []
    for old_dir in sorted(pathlib.Path(tmp_root).glob(f"mut-{stem}-*")):
        try:
            st = old_dir.stat()
        except OSError:
            # ONE stat, and it comes first: it vanished between the glob and here (a concurrent sweep
            # got there first), or the name is a dangling symlink. Either way there is nothing to
            # judge and nothing to delete.
            continue  # deliberate: an unstattable name is not a scratch this run can speak about
        if not _stat.S_ISDIR(st.st_mode):
            continue
        try:
            marker = (old_dir / SCRATCH_OWNER_FILE).read_text(encoding="utf-8")
        except (OSError, ValueError):
            # ValueError covers UnicodeDecodeError: a marker holding non-UTF-8 bytes would otherwise
            # raise straight out of the sweep and take the whole run with it, over a file whose only
            # job is to be advisory. Unreadable for ANY reason is UNKNOWN, which earns the long floor.
            marker = ""
        age = max(0.0, now - st.st_mtime)
        do_prune, why = scratch_prune_decision(
            is_current=(old_dir == pathlib.Path(current)),
            owner_live=owner_is_live(parse_owner_record(marker), start_ticks_of),
            age_sec=age,
        )
        if do_prune:
            remove(old_dir, ignore_errors=True)
            pruned.append(old_dir.name)
        elif old_dir != pathlib.Path(current):
            held.append(f"{old_dir.name}: {why}")
    return pruned, held


# ── MEMORY — a run that cannot fit is refused BEFORE it starts, not reaped in the middle ────────────
# The gate's budget is expressed only in SECONDS, so a module whose mutants do not fit in RAM passes
# every prediction and then thrashes. capture.py is the live case: mutmut's generated module is 536 MB
# and ONE worker measured 8.2 GB RSS, above the fleet's 8 GB-per-process standing limit, while mutmut
# spawns a worker per core. The harness watchdog reaps on BOX pressure rather than per-cgroup, so an
# over-committed run does not just fail itself — it takes other sessions' gates with it.
WORKER_RSS_PER_MUTANTS_BYTE = 15.0
# ASSUMPTION, STATED: one worker's peak RSS ~= 15x the generated mutants file. This is ONE
# measurement, not a fit — 2026-09-27, capture.py: a 536 MB mutants file against 8.2 GB RSS = 15.3x.
# Replace it when a second module has been measured; until then the refusal prints the file size and
# the factor it multiplied so a reader can redo the arithmetic and see how much of the answer is this
# number. ⚠️ THE PRE-WORK FACTOR THAT USED TO SIT BESIDE THIS ONE IS GONE (see PREWORK_FILE above):
# 2.0 under-predicted the module it existed for by at least 5.6x, and a per-module measurement
# replaced it. That is the standing argument for retiring this one too — a factor measured on one
# module is not a constant for the others.
MEM_CAP_FRACTION = 0.5
# Pre-stated, and deliberately not "whatever is free": never PLAN to hold more than half of what the
# box reports available when the run starts. The other half is the rest of the fleet, and the reason
# the bound is a fraction of AVAILABLE rather than of total is that available is the number the
# watchdog's pressure actually tracks.


def memory_refusal(
    mutants_bytes, workers, available_bytes, rss_factor=WORKER_RSS_PER_MUTANTS_BYTE, cap_fraction=MEM_CAP_FRACTION
):
    """A refusal reason when the projected peak does not fit under the cap, else None.

    Names every number it used so the reader can re-derive the verdict — never just "not enough
    memory". Mirrors `budget_refusal` one resource over."""
    if mutants_bytes <= 0 or workers <= 0 or available_bytes <= 0:
        return None
    per_worker = mutants_bytes * rss_factor
    projected = per_worker * workers
    cap = available_bytes * cap_fraction
    if projected <= cap:
        return None
    gb = 1024.0**3
    return (
        f"projected peak {projected / gb:.1f} GB ({mutants_bytes / gb:.2f} GB of generated "
        f"mutants x {rss_factor:g} assumed RSS factor = {per_worker / gb:.1f} GB per worker, "
        f"x {workers} worker(s)) exceeds the {cap / gb:.1f} GB cap "
        f"({cap_fraction:g} of {available_bytes / gb:.1f} GB available at start). "
        f"NOT attempted: the fleet's limit is 8 GB per process and the harness watchdog reaps on "
        f"BOX memory pressure, so an over-committed run takes other sessions' gates down with it. "
        f"This is a REFUSAL with a reason, not a verdict on the diff."
    )


# ── GENERATION IS A PHASE, AND IT IS THE ONE THAT FAILS ─────────────────────────────────────────────
# Measured on #3202 (run 36465603809): the required `mutation (diff-scoped)` job spent 9,356 s inside one
# `mutmut run` and was cancelled by the runner's 180-minute cap having decided ZERO mutants. The proof
# that it never left generation is an absence with a known emitter — `mutmut/__main__.py:_run` prints
#
#     done in {ms}ms ({n} files mutated, {i} ignored, {u} unmodified)
#
# the moment `create_mutants` returns, OUTSIDE the suppressed spinner block, and the job's log carries
# that line 0 times against 618 "Generating mutants" spinner lines. So:
#
#   · `memory_refusal` above `stat()`s the file that GENERATION produces, which puts it behind the phase
#     that fails — unreachable in exactly the case it exists for. On a fresh scratch the size reads 0
#     (`except OSError: 0`) and the guard returns None for every worker count: absence coerced to a
#     neutral number makes a threshold unreachable rather than making it fail (§∅).
#   · one opaque wall bound cannot tell "generation ate everything" from "mutants ran slowly", and those
#     want different verdicts: the first examined nothing and is NOT_RUN.
#
# `create_mutants` walks every source file and takes NO name filter, so a diff scoped to one function
# still generates the module's whole population (capture.py: 20,021 mutants across 226 functions to run
# 242). Scoping generation is a separate unit; bounding and ATTRIBUTING it is this one.
GENERATION_DONE_RE = re.compile(r"done in \d+ms \(\d+ files? mutated")
# mutmut's own completion line, matched rather than inferred from a mutant verdict appearing: a run whose
# first mutant verdict is slow to arrive has still finished generating, and the two must not be conflated.


def generation_timeout_reason(phase_cap_sec, elapsed_sec, mutants_bytes=0):
    """Why a generation phase that outlived its own bound is NOT_RUN, with the numbers in it.

    Separate from `budget_refusal` because the STATUS differs: a budget consumed with some functions
    mutated is UNKNOWN (part of the diff was measured), but a run killed in generation decided nothing
    at all, and §🧾 spells that NOT_RUN. The partially written mutants file is reported when it exists —
    "how far it got" is the one thing the killed run can still say."""
    grew = (
        f", {mutants_bytes / (1024.0**2):.0f} MB of mutants written" if mutants_bytes > 0 else ", nothing written yet"
    )
    return (
        f"mutant GENERATION did not finish inside its {phase_cap_sec:.0f}s phase bound "
        f"(killed at {elapsed_sec:.0f}s{grew}). NOT a verdict on the diff: no mutant ran, so nothing "
        f"was killed and nothing survived. mutmut generates the WHOLE module's population before the "
        f"first mutant runs and takes no name filter, so a one-function diff pays for every function."
    )


GENERATION_CAP_FRACTION = 0.5
# PRE-STATED, and it is a share of the wall cap rather than an absolute: generation cost tracks the
# module, so a fixed number would be wrong for both ends of the fleet. Half is the honest split for a
# gate whose job is to RUN mutants — a phase that wants more than half the budget before the first
# mutant has not earned the second half. Measured for scale: capture.py generates in ~22 min on 24 cores
# (the reuse path makes it 18 s), and #3202 did not finish it in 156 min on 4.


def generation_cap_sec(cap_sec, fraction=GENERATION_CAP_FRACTION):
    """The share of a run's wall cap that mutant GENERATION may take before it is killed and named."""
    return max(CAP_FLOOR_SEC, float(cap_sec) * fraction)


UNKNOWN_SIZE_WORKERS = 4
# 🔴 AN UNKNOWN SIZE MUST NOT MEAN "INHERIT THE CORE COUNT". The first cut of this fix fell back to
# `os.cpu_count()` when no size was known — which is the exact over-commit it exists to prevent, kept
# alive in the one branch that matters, because the FIRST run on any source hash is the unknown case.
# mutmut takes ONE `--max-children` for both phases and the size only becomes knowable after generation,
# so the unknown case gets a small pre-stated number instead: generation parses one source file at a
# time and is cheap per worker, while a RUN worker imports the whole generated module (the 8.2 GB
# measurement), and 4 is under any cap we have once a size is recorded. The recorded size then protects
# every later run on that hash. Measured for scale: 24 workers on the rig and 4 on a hosted runner BOTH
# over-committed on capture.py — but 4 x 8 GB is over a 7 GB cap, so the record is what makes it safe,
# not this number.


def mutants_size_record(text):
    """Parse the committed `tools/mutation-sizes.json` into `{(module, src_hash): bytes}`.

    WHY COMMITTED, and why keyed on the module's SOURCE HASH. Every CI run is a fresh scratch, so a
    size remembered only beside the scratch is a size CI never has: without a record on main, each
    capture.py PR spends its whole generation budget rediscovering that capture.py generates 562 MB and
    fits nowhere. With it, a hosted runner refuses at 0 workers in minute one, NAMED. A hash miss is
    simply ABSENT — never a default, never the nearest entry, because a size from a different version of
    the source is a guess wearing a measurement's clothes (§∅). Tool-written; a hand-edited number here
    would be indistinguishable from a measured one, which is the whole value of the file."""
    try:
        doc = json.loads(text or "{}")
    except ValueError:
        return {}
    out = {}
    for key, entry in (doc.get("sizes") or {}).items():
        module, _, src_hash = key.partition("@")
        if not module or not src_hash:
            continue
        size = entry.get("generatedBytes") if isinstance(entry, dict) else entry
        if isinstance(size, int) and size > 0:
            out[(module, src_hash)] = size
    return out


def merge_mutants_size(text, module, src_hash, generated_bytes, measured_at, host):
    """The record with this measurement added, as JSON text. Idempotent on an unchanged measurement.

    An existing entry is REPLACED rather than kept or averaged: the same source hash generating a
    different size means the generator changed, and the newer measurement is the one that describes the
    mutmut this tree pins. The previous value is kept in `supersedes` so the change is visible."""
    try:
        doc = json.loads(text or "{}")
    except ValueError:
        doc = {}
    doc.setdefault("schema", "tepna.mutation-sizes/1")
    doc.setdefault(
        "note",
        "Generated-mutants size per (module, source sha256[:12]), written by "
        "tools/mutate.py --record-sizes. NEVER hand-edited: a typed number here is "
        "indistinguishable from a measured one. A hash miss is absent, not a default.",
    )
    sizes = doc.setdefault("sizes", {})
    key = f"{module}@{src_hash}"
    prior = sizes.get(key)
    entry = {"generatedBytes": int(generated_bytes), "measuredAt": measured_at, "host": host}
    if isinstance(prior, dict) and prior.get("generatedBytes") not in (None, int(generated_bytes)):
        entry["supersedes"] = prior.get("generatedBytes")
    sizes[key] = entry
    doc["sizes"] = dict(sorted(sizes.items()))
    return json.dumps(doc, indent=2) + "\n"


def workers_that_fit(
    mutants_bytes, available_bytes, rss_factor=WORKER_RSS_PER_MUTANTS_BYTE, cap_fraction=MEM_CAP_FRACTION
):
    """How many workers the cap affords for a mutants file of this size. 0 means not even one.

    The companion to `memory_refusal`: that function says "this does not fit", this one says "here is
    what does", which is the number to hand mutmut's `--max-children`. Inheriting `os.cpu_count()` is
    how a 24-core rig and a 4-core hosted runner BOTH over-committed on the same module — 24 x 8 GB and
    4 x 8 GB are both over any cap we have.

    ⚠️ AN EARLY GUARD USED TO STAND HERE — `if mutants_bytes <= 0 or available_bytes <= 0: return 0` — AND
    IT DECIDED NOTHING. Three of its mutations survived the gate, and no input distinguished any of them or
    the line's outright deletion, so it went rather than being excused: a line whose mutation cannot change
    an answer is redundancy, not a missing test (Osprey's shape on their own rule code, #3211).

    What remains is NOT redundant, and covers the same ground: `per_worker <= 0` catches an unmeasured
    module (`mutants_bytes` 0 makes the product 0), a negative size (a negative product), and a zero
    `rss_factor` — the last being the only thing standing between a caller and a ZeroDivisionError below.
    Non-positive `available_bytes` needs no guard of its own: the cap is then 0 or negative, so the floor
    division is 0 or negative and `max(0, …)` returns 0."""
    per_worker = mutants_bytes * rss_factor
    if per_worker <= 0:
        return 0
    return max(0, int((available_bytes * cap_fraction) // per_worker))


def available_bytes_from_meminfo(text):
    """`MemAvailable` in bytes from /proc/meminfo's text, or None if it is not there.

    `MemAvailable` rather than MemFree: free excludes reclaimable page cache and would refuse runs
    that fit comfortably."""
    for line in (text or "").splitlines():
        if line.startswith("MemAvailable:"):
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                return int(parts[1]) * 1024
    return None


def memory_exhaustion_verdict(n_refused, decided):
    """The status a MEMORY refusal deserves, and the reason. Same shape as
    `budget_exhaustion_verdict` one resource over, and same rule: a run that never decided a mutant
    examined nothing, which §🧾 spells NOT_RUN. The projections themselves are printed above and
    carried in the JSON; this is the one-line verdict, so it says what was refused and not the
    arithmetic."""
    what = f"{n_refused} function(s) not mutated — projected memory exceeds the run's cap"
    if decided > 0:
        return "UNKNOWN", (
            f"{what}; {decided} mutant(s) were decided before that, so the refused ones are unmeasured, not failed"
        )
    return "NOT_RUN", (
        f"{what}, and NOT ONE mutant was decided — this run examined nothing. Refused "
        f"BEFORE starting rather than reaped by the watchdog mid-run, which reports "
        f"nothing and takes other sessions' gates with it. Not a verdict on the diff."
    )


def clean_run_refusal(module: str, clean_sec: float, n_globs: int) -> str:
    """The refusal reason for a module whose own clean baseline is RED, with every number in it.

    🔴 A RED BASELINE KILLS EVERY MUTANT BY ARITHMETIC. mutmut calls a mutant killed when the
    covering tests fail with it applied; if those tests already fail WITHOUT it, every mutant is
    "killed" and the run reports total coverage over a population it never discriminated. Measured
    2026-10-19 on #3704: `tools/mutate_diff.py` printed `clean run FAILED (exit 1)` for all three
    modules in scope and still emitted `status: PASS`, exit 0, "every mutant on the changed functions
    was killed". The print site was `clean_run_seconds`; nothing downstream read the flag beside it.

    ⚠️ THE FLAG EXISTED AND THE DIFF PATH COULD NOT REACH IT. `mutate.run_one` consults
    `budget_verdict(clean_sec, clean_ok)` only when its `timeout` argument is None, and `mutate_diff`
    always passes `timeout=max(1, _left)` — so the one consumer of `clean_ok` was switched off on
    exactly the path the gate runs. A guard behind a parameter the caller always sets is not a
    guard."""
    return (
        f"{module}: its own clean baseline FAILED, so nothing here was measured — {n_globs} "
        f"function(s) selected, none mutated. A red baseline makes mutmut call every mutant killed, "
        f"because the covering tests already fail without one: the arithmetic reports total coverage "
        f"over a population it never discriminated. The clean run took {clean_sec:.1f}s and its "
        f"FAILED/ERROR lines are printed above. Fix or quarantine THAT test — the failure is the "
        f"covering set's, not this diff's — then re-run. Raising nothing clears this."
    )


def clean_run_exhaustion_verdict(n_refused: int, decided: int) -> tuple[str, str]:
    """The status a RED-BASELINE refusal deserves, and the reason. Same shape as
    `memory_exhaustion_verdict` one cause over, and the same rule: a run that decided no mutant
    examined nothing, which §🧾 spells NOT_RUN. Never PASS and never FAIL — the refused modules were
    not measured, so this run can neither vouch for them nor convict the diff."""
    what = f"{n_refused} module(s) not mutated — their own clean baseline failed first"
    if decided > 0:
        return "UNKNOWN", (
            f"{what}; {decided} mutant(s) were decided elsewhere, so the refused modules are unmeasured, not failed"
        )
    return "NOT_RUN", (
        f"{what}, and NOT ONE mutant was decided — this run examined nothing. A PASS here would be "
        f"arithmetic: a red baseline fails with every mutant applied, so every mutant reads killed. "
        f"Not a verdict on the diff."
    )


def kill_process_group(proc, grace_sec=GROUP_GRACE_SEC, reap_sec=REAP_SEC):
    """SIGTERM the child's process GROUP, SIGKILL what survives the grace, then reap. Returns the
    returncode. Never raises: teardown must not become a new failure mode.

    🔴 WHY THE GROUP AND NOT THE CHILD. `proc.kill()` signals the direct child only, and `mutmut run`
    RE-SPAWNS ITSELF — measured 2026-09-29 reproducing #3202: the Popen'd pid had a child of the same
    command line, the deadline killed the parent, and the child was re-parented to systemd and kept
    generating for **2 h 32 m at 19.4 GB RSS**, holding the inherited stdout so every later read in
    `run_one` blocked. No traceback, no verdict, and the CI job died at its 180-minute cap with two
    orphan pythons logged. `TOOL-BUILD-STANDARD` §2.3 already required the opposite — *"SIGKILL to the
    parent must terminate the entire job — every worker, thread and child … no orphan writing to it
    after death"* — so this restores a standard rather than inventing a rule. #3234 fixed the same class
    on the JS side (`detached: true` + `kill(-pid)`); this is the Python half.

    ⚠️ IT REFUSES TO SIGNAL A GROUP THE CHILD DOES NOT LEAD. `os.killpg` on a child that was started
    WITHOUT `start_new_session=True` reaches our own group — the gate would kill itself and every
    sibling the caller owns. So the group is signalled only when the child IS the group leader
    (`getpgid(pid) == pid`); otherwise this falls back to killing the child alone, which is strictly no
    worse than the behaviour it replaces."""
    pid = getattr(proc, "pid", None)
    # 🔴 A PID OF 0 IS NOT "NO PID" — IT IS "EVERYONE HERE". `os.killpg(0, sig)` and `os.kill(0, sig)`
    # both address the CALLER's own process group, so a 0 arriving from a double, a half-built proc
    # object or a mutated flag does not fail safe: it reaps the gate and every sibling the caller owns.
    # Measured 2026-09-29 on this function's own mutants: four of them leave the leader flag set past
    # the `if`, and with a `pid=0` test double each one SIGTERMed the mutmut worker's process group —
    # pytest died mid-run with no summary line, mutmut's counter stalled at 7 of 33, and the remaining
    # 23 came back `not_checked`. That is how a mutant kills the runner that is judging it.
    # So the pid is checked for being a REAL, POSITIVE pid, and checked again at the call site below,
    # where the cost of being wrong is paid.
    positive_pid = isinstance(pid, int) and not isinstance(pid, bool) and pid > 0
    leader = False
    if positive_pid:
        try:
            pgid = os.getpgid(pid)
            # TWO INDEPENDENT CONDITIONS, and the second one is load-bearing twice over. The child must
            # LEAD the group (`pgid == pid`) — otherwise `killpg` reaches whatever group it was born
            # into, which for a child started without `start_new_session=True` is OURS. And the group
            # must not be ours even so.
            #
            # 🔴 THE SECOND CLAUSE IS WHY THIS FUNCTION IS MUTATION-TESTABLE AT ALL. Measured on
            # #3237's own CI run: with `pgid == pid` alone, a mutant that inverted it made the gate
            # `killpg` its OWN process group — the mutmut runner died at mutant 7 of 30 (the job log
            # shows the counter stop at `6/2202`) and the remaining 23 came back `not_checked`, i.e.
            # UNMEASURED, which `mutate_diff` correctly refuses. A mutant that kills the runner cannot
            # be killed BY the runner. With both clauses no SINGLE mutation can signal our group
            # (inverting either one leaves the other blocking), so the mutants became decidable — and
            # the belt-and-braces is worth having on its own account.
            leader = pgid == pid and pgid != os.getpgrp()
        except (ProcessLookupError, OSError):
            leader = False
    for sig, wait_s in ((signal.SIGTERM, grace_sec), (signal.SIGKILL, reap_sec)):
        try:
            if leader and positive_pid:
                # The second half is not redundant: `leader` is derived state and a single edit can
                # leave it true, while this reads the pid itself. Belt and braces on the one operation
                # in this file whose worst case is killing the caller.
                os.killpg(pid, sig)
            else:
                proc.send_signal(sig)
        except (ProcessLookupError, PermissionError, OSError, ValueError):
            pass  # already gone, or never started — both are "nothing left to signal"
        try:
            return proc.wait(timeout=wait_s)
        except subprocess.TimeoutExpired:
            continue  # the grace expired; escalate to SIGKILL on the next pass
        except (ValueError, OSError):
            # deliberate: the proc object cannot be waited on at all (never started, or a closed
            # handle), so escalating a second signal against nothing would be a loop over a broken
            # object. Stop and report whatever returncode it knows — which may be None (§∅).
            break  # deliberate: an unwaitable proc, reported as its own returncode rather than retried
    return getattr(proc, "returncode", None)


REAP_SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
# The three ways this tool is asked to stop by something above it: a CI runner's job timeout (SIGTERM),
# an operator's Ctrl-C (SIGINT), and a closed session (SIGHUP). SIGKILL is deliberately absent — it
# cannot be handled, which is exactly why the handler below is not a substitute for the caller's own
# discipline; it is the part that CAN be done.


class reap_group_on_signal:
    """Context manager: while it is open, a terminating signal to THIS process first reaps `proc`'s
    group, then lets the signal do what it would have done.

    🔴 WITHOUT THIS, `start_new_session=True` MAKES THE CI CASE WORSE, and that is not a trade this
    change is allowed to make silently. Putting mutmut in its own session is what lets a deadline reap
    the whole job — and it also takes mutmut OUT of the job's process group, so the runner's own group
    kill at its 180-minute cap no longer reaches it. #3202's job log already ended with two orphan
    pythons; a session-led child that nothing hands the signal on to would be orphaned by construction
    rather than by accident. So the tool passes the signal down before dying: the child's group is
    reaped, the previous handler is restored, and the signal is re-raised so the exit status is the one
    the sender asked for (a handler that swallows SIGTERM turns a stop into a hang).

    `signal.signal` only works on the main thread; a call from anywhere else raises ValueError, which
    this treats as "no handler installed" and leaves the deadline as the only bound — degraded, honest,
    and not a crash in teardown.

    **SIG_IGN is honoured, never overridden** — see `__enter__`. A signal the launcher disabled keeps
    its disposition and the deadline stays its only bound.

    **A second signal during the grace re-enters `_on_signal` before the restore, and that is FINE** —
    the second `killpg` lands on a group that is already dying (`ProcessLookupError`, suppressed) and
    the second re-raise is what the second sender asked for. Do NOT "fix" it by guarding with a flag
    that swallows the second signal: that would make the process ignore a stop it was told twice.
    """

    def __init__(self, proc, signals=REAP_SIGNALS):
        self.proc, self.signals, self._prev = proc, signals, {}

    def __enter__(self):
        for sig in self.signals:
            try:
                # 🔴 AN IGNORED SIGNAL STAYS IGNORED. Installing over SIG_IGN converts a signal the
                # launcher deliberately disabled into a handler that reaps the child and then re-raises
                # into a no-op — so the run CONTINUES with its job dead and reports `phase: results`
                # NOT_RUN for an event it was supposed to ignore. Measured 2026-09-29 on this box, and
                # both live shapes are ones this repo actually uses:
                #   `setsid nohup <gate> &`  (CLAUDE.md §4c's recipe for anything over ~100 s, and how
                #                             the crawl and the drains run) → SIGHUP  = SIG_IGN
                #   `bash -c '<gate> &'`     (a plain background job, no job control)
                #                                                          → SIGINT, SIGQUIT = SIG_IGN
                # So this is not a SIGHUP special case: any arm may arrive already ignored, and the
                # deadline remains the bound for it. Read the disposition first and leave it alone.
                if signal.getsignal(sig) is signal.SIG_IGN:
                    continue  # deliberate: honouring SIG_IGN is the point — nothing is being hidden
                self._prev[sig] = signal.signal(sig, self._on_signal)
            except (ValueError, OSError):
                pass  # not the main thread, or a signal this platform does not have
        return self

    def _on_signal(self, sig, _frame):
        kill_process_group(self.proc)
        # ONE default, not two. This was `.get(sig, signal.SIG_DFL)` AND the `is not None` ternary
        # below — the same decision written twice, so neither spelling could be observed failing:
        # mutation found both defaults surviving (`.get(sig, None)` and a one-argument `.get`) because
        # the ternary silently repaired them. The ternary is the one that must stay, because `_prev`
        # can legitimately HOLD None (a handler slot Python reports as unset), and `signal.signal`
        # rejects None. So the lookup returns whatever is there and exactly one line converts it.
        prev = self._prev.get(sig)
        try:
            signal.signal(sig, prev if prev is not None else signal.SIG_DFL)
        except (ValueError, OSError):
            # deliberate: nothing was hidden that matters — the restore is a courtesy to whoever
            # installed the previous handler, and this process is about to take the signal anyway.
            pass  # deliberate: the signal is re-raised on the next line either way
        os.kill(os.getpid(), sig)  # re-raise: the sender decides this process's fate, not this handler

    def __exit__(self, *_exc):
        for sig, prev in self._prev.items():
            try:
                signal.signal(sig, prev)
            except (ValueError, OSError):
                # deliberate: teardown must not raise. A restore that fails leaves OUR handler in
                # place, which reaps an already-dead proc on the next signal — a no-op that still
                # re-raises — so nothing is hidden except the failure of the courtesy itself.
                pass  # deliberate: teardown must not replace the caller's outcome with its own
        return False  # never swallow: teardown does not get to decide the caller's exception


def results_timeout_reason(timeout_sec, mutants_bytes=0):
    """Why a run whose GENERATION and mutants completed but whose results pass hung is NOT_RUN.

    The third phase, and it earns its own reason for the same purpose as `generation_timeout_reason`:
    a reader must be able to tell WHICH phase ate the budget. Measured on #3202: with a surviving
    mutmut child holding the pipe, `subprocess.run(..., capture_output=True, timeout=300)` does not
    return at its timeout at all — the post-kill drain waits on an EOF a live writer never sends — so
    this reason exists for the case where the pass is bounded and still cannot speak."""
    grew = f", {mutants_bytes / (1024.0**2):.0f} MB of mutants on disk" if mutants_bytes > 0 else ""
    return (
        f"the mutants ran but `mutmut results` did not return inside {timeout_sec:.0f}s{grew}. NOT a "
        f"verdict on the diff: the per-mutant outcomes are on disk and were never read, so nothing "
        f"was killed and nothing survived as far as this run can say."
    )


def stream_bounded(proc, cap_sec, on_line, t0=None, join_sec=JOIN_SEC, phase_cap_sec=None, phase_done=None):
    """Drain `proc`'s stdout line by line into `on_line`, and KILL the child at `cap_sec`.
    Returns `(returncode, timed_out, phase_timed_out)` — ALWAYS three, never a shape that depends on
    whether a phase was declared, because a caller that unpacks by argument value is a caller waiting to
    break. With no phase declared the third member is always False.

    🔴 THE WALL CAP USED TO BE UNREACHABLE, WHICH IS WORSE THAN ABSENT. The caller drained the pipe
    with a bare `for line in proc.stdout:` and only afterwards called
    `proc.wait(timeout=cap - elapsed)`. That iterator ends when the CHILD CLOSES ITS STDOUT — which a
    child that is still working never does — so `wait` was reached only once the process had already
    exited, always returned immediately, and `subprocess.TimeoutExpired` could not be raised at all.
    The code read like an enforced wall bound and enforced nothing; a child that printed nothing and
    never finished was waited on forever.

    Measured 2026-09-27 while reproducing this row: `tools/mutate.py --timeout 900` on capture.py ran
    21 minutes (one worker at 8.2 GB RSS) with the cap never firing, and had to be killed by hand. The
    same unreachable path carries `tools/mutate_diff.py`'s `GATE_BUDGET_SEC`, so the gate budget
    bounded nothing either — which is how a traced stats pass reached 2 h 41 m and read as a silent
    hang rather than a refusal.

    Reading in a daemon thread and waiting in the caller puts the deadline on a path that CAN fire,
    and the streamed output (the caller's progress heartbeat) is unchanged.

    WHY A PHASE NEEDS ITS OWN BOUND. One opaque wall cap reports the same thing for two outcomes that
    deserve different verdicts: a run that generated its mutants and then ran them slowly (UNKNOWN — part
    of the diff was measured), and a run that never finished GENERATING (NOT_RUN — nothing was examined).
    #3202 was the second and looked like the first: 9,356 s, zero mutants decided, and the proof is that
    mutmut's own `done in …ms (N files mutated)` line — printed the instant `create_mutants` returns and
    outside the suppressed spinner block — occurs ZERO times in the job's log.

    `phase_done()` is polled at the phase deadline rather than subscribed to, because the marker arrives
    on the stream the reader thread is already draining; the caller decides what "done" means.

    Both bounds hold, and the phase bound can never EXTEND the wall cap — `min` of the two remainings.
    """
    t0 = time.monotonic() if t0 is None else t0

    def _drain() -> None:
        try:
            for line in proc.stdout:
                on_line(line)
        except (ValueError, OSError):
            # The pipe was closed under us by the kill below. Expected on the timeout path, and not a
            # failure of the run: whatever was read before the kill is already in the caller's buffer,
            # and the refusal the caller is about to emit is the report. Re-raising here would only
            # kill a daemon thread nobody joins for its result.
            pass  # deliberate: a closed pipe after the kill is the expected end of the read

    reader = threading.Thread(target=_drain, daemon=True)
    reader.start()
    timed_out = False
    phase_timed_out = False
    try:
        if phase_cap_sec is not None and phase_done is not None:
            deadline = min(
                cap_remaining(cap_sec, t0, time.monotonic()), cap_remaining(phase_cap_sec, t0, time.monotonic())
            )
            try:
                rc = proc.wait(timeout=deadline)
            except subprocess.TimeoutExpired:
                if not phase_done():
                    # Still in the first phase with its bound spent: this is the NOT_RUN case.
                    phase_timed_out = timed_out = True
                    rc = kill_process_group(proc)
                else:
                    # The phase finished; the rest of the wall cap is the run's.
                    rc = proc.wait(timeout=cap_remaining(cap_sec, t0, time.monotonic()))
        else:
            rc = proc.wait(timeout=cap_remaining(cap_sec, t0, time.monotonic()))
    except subprocess.TimeoutExpired:
        timed_out = True
        rc = kill_process_group(proc)
    # Bounded join: a reader blocked on a pipe the kill did not close must not turn a refusal that
    # fired into a hang one frame later. Measured 2026-09-28 with a planted grandchild that inherits
    # stdout and outlives the kill — mutmut's worker shape: the call returns in cap + join, never hangs.
    reader.join(timeout=join_sec)
    return rc, timed_out, phase_timed_out


def crash_refusal_verdict(n_crashed: int, decided: int) -> tuple[str, str]:
    """The status a §3 crash refusal deserves — the fourth statement of ONE split, not a new rule.

    PURE. A glob that returned no error and tested zero mutants dropped out silently: mutmut crashed
    AFTER generation (a collection failure, a bad conftest), so its empty survivor list means "not
    checked", never "all killed". That refusal was the one terminal in `main()` that returned an exit
    code without emitting a verdict at all, so a consumer reading the artifact saw the PREVIOUS run's
    object or none.

    The status follows the same split its three siblings already use — `memory_exhaustion_verdict`,
    `budget_exhaustion_verdict`, and the generation refusal's inline
    `"NOT_RUN" if _counts["decided"] == 0 else "UNKNOWN"`:

        decided > 0   UNKNOWN   part of the diff WAS measured; the crashed globs are unmeasured,
                                not failed — exactly what an undecided mutant is
        decided == 0  NOT_RUN   not one mutant was decided anywhere, so the run examined nothing

    ⚠️ AND THE MIXED CASE IS THE COMMON ONE, WHICH IS WHY THIS IS NOT A FLAT `NOT_RUN`. The driver
    refuses if ANY glob crashed "even when others ran cleanly" — its own words — so a run that fully
    mutated six functions and lost a seventh is the shape this fires on most. Calling that NOT_RUN
    would report "examined nothing" about a run that examined six, which is the same class of
    misreport as the silent zero: a status that describes the reader's ignorance rather than the run.

    `decided` is mutants and `population` is FUNCTIONS — `verdict_object` derives
    `excluded = eligible - checked` itself, so the mutant counts belong in the reason, where a reader
    with only the object can still see that generation ran and testing did not.
    """
    what = f"{n_crashed} glob(s) recorded 0 tested mutants — mutmut crashed AFTER generation"
    if decided > 0:
        return "UNKNOWN", (
            f"{what}; {decided} mutant(s) were decided elsewhere in this run, so part of the diff "
            "was measured and the crashed glob(s) are unmeasured, not killed"
        )
    return "NOT_RUN", (
        f"{what}, and NOT ONE mutant was decided anywhere in this run — it examined nothing. "
        "An empty survivor list here means 'not checked', not 'all killed'."
    )


def budget_exhaustion_verdict(n_refused: int, decided: int, elapsed_sec: float) -> tuple[str, str]:
    """The status a budget refusal deserves, and the reason with the numbers already in it.

    TWO DIFFERENT OUTCOMES WORE ONE WORD. When some functions were mutated and others were refused,
    the run measured part of the diff and cannot speak for the rest: UNKNOWN, exactly as an undecided
    mutant is. When the budget was consumed before a single mutant was DECIDED, the run examined
    nothing — and §🧾 spells that case NOT_RUN ("NOT_RUN examined nothing"), which UNKNOWN is not a
    synonym for. The difference is not cosmetic: UNKNOWN reads as "we mutated and could not tell",
    so a gate whose PRE-WORK never finished looked like a measurement with an inconclusive result.

    This is capture.py's standing case, not a hypothetical. Its traced stats pass alone outruns the
    whole budget (measured 2026-09-27: 2 h 41 m against a 7200 s budget), so the gate reached zero
    mutants and still answered in the vocabulary of a run that had.

    `elapsed_sec` is in the reason, not only in the log, because it is the one number that separates
    the two cases for a reader who has just the verdict object — and because "the budget was
    exhausted" without saying by what is the silent timeout this replaces.
    """
    what = f"{n_refused} module(s)/function(s) not mutated inside the {GATE_BUDGET_SEC}s gate budget"
    if decided > 0:
        return "UNKNOWN", (
            f"{what} after {elapsed_sec:.0f}s — {decided} mutant(s) decided before the "
            f"budget ran out; the refused ones are unmeasured, not failed"
        )
    return "NOT_RUN", (
        f"{what} after {elapsed_sec:.0f}s — NOT ONE mutant was decided, so this run "
        f"examined nothing: the pre-work (clean run + mutmut's traced stats pass) "
        f"consumed the budget before the first mutant ran. Not a verdict on the diff."
    )


# ── tepna.verdict/1 — the ONE object the gate emits (VERDICT-CONTRACT §1/§3b step 5) ─────────────────
# The gate's outcomes map onto the closed enum and NOTHING is collapsed into a word a reader must parse:
#   PASS            every mutant on the changed functions was killed (population.checked > 0)
#   FAIL            survivors on changed lines, or a REFUTED equivalence entry (a wrong claim is a failure)
#   UNKNOWN         mutants UNDECIDED (timeout · suspicious · no tests · not checked) — never a kill; or
#                   functions refused inside the run budget — not measured, said so
#   NOT_RUN         the gate could not execute: mutmut absent, every invocation errored
#   NOT_APPLICABLE  nothing behavioural to mutate: no capture-host/*.py changed, annotation-only, or no
#                   mutable operator in the changed functions
# `result` carries the counts at full precision (they are integers); `population` is functions:
# checked = mutated, excluded = refused/crashed/nothing-to-mutate, eligible = selected.
VERDICT_SCHEMA = "tepna.verdict/1"
VERDICT_STATUSES = ("PASS", "FAIL", "SHORTFALL", "UNDERPOWERED", "NOT_RUN", "NOT_APPLICABLE", "UNKNOWN")


def verdict_object(
    status: str,
    *,
    checked: int,
    eligible: int,
    result: dict | None,
    reason: str | None,
    evidence: list[str],
    commit: str | None,
    at: str,
    base: str,
) -> dict:
    """Build the verdict. Pure; the shape is `verdict.js`'s and is asserted against it by the JS gate
    (`tools/verdict-adoption.mjs` reads `--verdict-sample`), not restated here as a second validator."""
    if status not in VERDICT_STATUSES:
        raise ValueError(f"status {status!r} is not in the closed enum {VERDICT_STATUSES}")
    if status == "PASS" and reason is not None:
        raise ValueError("PASS carries reason: null")
    if status != "PASS" and not reason:
        raise ValueError(f"{status} requires a reason")
    excluded = eligible - checked
    if excluded < 0:
        raise ValueError(f"checked {checked} > eligible {eligible}")
    produced: dict = {"tool": "capture-host/tools/mutate_diff.py", "commit": commit}
    if commit is None:
        produced["commitReason"] = "not run inside a git checkout"
    return {
        "schema": VERDICT_SCHEMA,
        "gate": "mutate-diff",
        "status": status,
        "scope": "internal",
        "population": {"checked": checked, "eligible": eligible, "excluded": excluded},
        "criterion": {"name": "survivors_on_changed_lines", "threshold": 0, "unit": "mutants", "direction": "lte"},
        "result": None if status in ("NOT_RUN", "NOT_APPLICABLE") else result,
        "evidence": evidence,
        "reason": reason,
        "producedBy": produced,
        "at": at,
        "base": base,
    }


def resolve_interpreter(override: str | None, candidates: list[str], exists) -> tuple[str | None, str]:
    """Which interpreter this gate should run mutmut under, and — when there is none — WHICH PATHS IT TRIED.

    PURE: `exists` is the predicate, so the decision is pinnable without a filesystem, exactly as
    `refusal_reason` and `classify` are. Returns `(path, note)`; `path is None` means refuse, and `note`
    is never empty — a refusal that does not name what it looked for cannot be acted on.

    THE ORDER IS THE POINT. `VENV_PY` used to be a hardcoded `HERE/.venv/bin/python`, which made the
    gate unrunnable from a git worktree: the worktree has no venv, so the preflight refused with "the
    capture-host venv is missing" and the only ways to verify a mutation fix locally were to build a
    second several-hundred-MB venv in the worktree or to push and wait for CI. On 2026-09-27 the root
    volume hit 95 % with exactly those duplicate venvs on it. `check.sh` had the same shape and gained a
    `PYTHON=` override in #3132; this is the same override for the same reason.

    An EXPLICIT override wins unconditionally — including over an existing local venv — because a caller
    who names an interpreter has a reason the tool cannot see, and silently preferring a different one
    would make the run's identity unreadable. But it is still CHECKED: an override naming a path that is
    not there refuses naming that path, rather than falling through to a venv the caller did not ask
    for. Falling through would answer a question nobody asked.
    """
    if override:
        return (
            (override, f"interpreter from the override: {override}")
            if exists(override)
            else (None, f"the interpreter named by the override does not exist: {override}")
        )
    for cand in candidates:
        if exists(cand):
            return cand, f"interpreter found at {cand}"
    tried = ", ".join(candidates) if candidates else "(no candidates)"
    return None, (f"no usable interpreter — set MUTATE_DIFF_PYTHON to one that has mutmut installed. Tried: {tried}")


def zero_population_verdict(status: str, checked: int, reason: str | None) -> tuple[str, str | None]:
    """Downgrade a PASS that examined nothing to NOT_APPLICABLE, naming why.

    PURE. CLAUDE.md §🧾 is explicit — *"`PASS` over `checked: 0` or with empty `evidence` is invalid"* —
    and this gate emitted exactly that whenever Python changed but every changed line fell outside
    mutation scope: each file was correctly announced as skipped, and then the run reported PASS as
    though something had been examined. A green context where the gate measured nothing is
    indistinguishable from one where it measured everything, which is CLAUDE.md §4b's shape inside the
    tool whose job is to prevent it.

    NOT_APPLICABLE is the honest status and the same tool already emits it one case over, when no
    `capture-host/*.py` changed at all ("the criterion does not bind"). This closes the in-between.

    ⚠️ ONLY `PASS` is downgraded. A refusal (`NOT_RUN`), a failure (`FAIL`) or an existing
    `NOT_APPLICABLE` over zero is already honest about itself and must pass through untouched —
    rewriting a FAIL here would be the fail-open this exists to remove.
    """
    if status == "PASS" and checked == 0:
        return "NOT_APPLICABLE", (
            "every changed line is outside mutation scope, so nothing was examined — this is not a pass"
        )
    return status, reason


def unmeasured_zero(scan: dict) -> str | None:
    """Is this counting helper's ZERO a measurement, or the absence of one? Returns a reason, or None.

    PURE. Third statement of one rule, after `zero_population_verdict` (a PASS over `checked: 0` is not
    a pass) and `result_inconsistency` (a verdict whose own counters disagree cannot vouch for itself).
    Both of those guard a verdict. This guards the COUNTS the verdict is assembled from, which is where
    the same failure has actually shipped: `mmeta.generated_under_glob` returned `0` for every coroutine
    for five weeks, and for every indented method for weeks before that, and in both cases `0` is also
    the correct answer for a function with no mutable operator. Nothing downstream could tell them
    apart, so the crash guard took the benign arm across 16 % of the tree.

    A count is a measurement only if the scan that produced it examined something and can be checked
    against an independent observation of the same fact:

      · `sourceBytes == 0` / `examined == 0` — the scan read nothing. Its zero describes the reader,
        not the code. This is the absent-mutants-file case that let a crash BEFORE generation report
        "nothing to mutate", and the absent-or-malformed meta that `read_exit_codes` flattens to `{}`.
      · `matched != corroborated` — two independent observations of the same count disagree, so at
        least one of them cannot see its subject. This is the shape of both historical bugs, and it
        fires on them retrospectively against real scratch trees (see `mmeta.registered_under_glob`).
        It is checked in BOTH directions: a definition scan that finds MORE than mutmut registered is
        equally a miscount, and "ours is higher so we are fine" is the reasoning that keeps blind spots.

    What is deliberately NOT a refusal: `matched == 0` over a population that WAS examined and agrees
    with its corroboration. A function with no mutable operator genuinely generates nothing, and
    refusing there would red a rename, a docstring edit or a reformat — the safest diffs there are.
    That case is the reason a bare zero was ever trusted, and the fix is to make the benign zero PROVE
    it read the file, not to stop believing zeros.
    """
    helper = scan.get("helper", "a counting helper")
    glob = scan.get("glob")
    where = f" for {glob}" if glob else ""
    if scan.get("sourceBytes") == 0 and "sourceBytes" in scan:
        return (
            f"{helper}{where} read an absent or empty mutants file — its 0 is not a count of mutants, "
            "it is the absence of anything to count"
        )
    if scan.get("examined") == 0:
        return f"{helper}{where} examined an empty population — nothing was scanned, so 0 says nothing about the code"
    if "corroborated" in scan and scan.get("matched") != scan.get("corroborated"):
        return (
            f"{helper}{where} counted {scan.get('matched')} by definition scan while mutmut registered "
            f"{scan.get('corroborated')} — two independent counts of the same mutants disagree, so at "
            "least one of them cannot see its subject"
        )
    return None


# ── THE DECLARED EXCLUSION (owner ruling 2026-10-03) ─────────────────────────────────────────────────
# A function the gate cannot mutate inside its budget is UNMEASURED, and `budget_exhaustion_verdict`
# says so with UNKNOWN. That is correct and it is unactionable: every PR touching `capture.py` gets the
# same UNKNOWN forever, because the cost is not the diff's, it is mutmut's — `mutmut run <glob>` applies
# the glob when it RUNS mutants, never when it GENERATES them, so a one-function diff still generates
# the module's whole population (capture.py: 562,427,047 bytes of mutants, and a traced stats pass that
# alone outran the 7200 s budget at >= 7556 s).
#
# The exclusion makes that cost DECLARED instead of rediscovered. It is deliberately NOT an escape
# hatch, and three properties keep it from becoming one:
#
#   1. The list is BOUNDED and explicit. Keys are exact `module::function` strings — no globs, no
#      prefixes, no regexes — and `EXCLUSION_BOUND` caps how many may exist at once. A pattern would
#      silently widen as code moves; an exact key cannot.
#   2. It can only ever turn UNKNOWN into NOT_APPLICABLE. It can NEVER clear a survivor, and it can
#      never produce PASS. See `declared_exclusion_status`, which refuses to act while anything is
#      blocking — that is the whole safety argument and it is asserted in both directions.
#   3. Every entry carries a REASON, a DATE and a COST WITH ITS PROVENANCE. A number typed by hand is
#      indistinguishable from a measured one (the same rule `tools/mutation-sizes.json` states about
#      itself), so `parse_exclusions` refuses an entry whose cost does not say where it came from.
#
# WHAT RETIRES THIS: `briefs/MUTATION-SCOPED-GENERATION-2026-09-28-BRIEF.md`. Scoping GENERATION to the
# diff removes the cost that the exclusion exists to declare, and then every key here becomes
# measurable and the file goes to empty. The exclusion is a ledger of debt, dated, not a design.
EXCLUSIONS_FILE = "mutate-exclusions.json"
EXCLUSIONS_SCHEMA = "tepna.mutation-exclusions/1"

# The bound is a number somebody has to raise ON PURPOSE, in a commit, with the reason in it. It is not
# a target and not headroom to spend: it EQUALS the number of declared entries, so the next declaration
# costs a bound raise in the same commit as its measurement. `tests/test_mutation_exclusions.py`
# asserts both halves — the bound, and that the file's census matches it exactly.
#
# 🔴 OWNER RULING 2026-10-03, after the first three PRs to need this showed the per-function shape was
# wrong: "One module-level declaration." The cost is a property of the MODULE, not of any function in
# it — `mutmut run <glob>` applies the glob when it RUNS mutants and never when it GENERATES them, so
# EVERY capture.py diff pays for the whole module's population whatever it touched. N function keys each
# citing one module-level measurement dressed one fact as N, and the bound they each raised became
# decoration. One key, one measurement, one date.
#
# What that costs, stated plainly because a one-line declaration should not hide it: capture.py is
# 13,673 lines with 229 module-level defs and 290 functions counting nested ones and methods, and the
# declaration covers ALL of them. The gate prints that count and how many of the diff's own functions
# fell under it on every run, so the blind spot is re-counted on every PR rather than agreed once. (The
# "226 functions" in MUTATION-SCOPED-GENERATION-2026-09-28 was measured on 2026-09-28; the module has
# grown since, which is itself an argument for counting it per run instead of quoting it.)
#
# ⚠️ E7's two function keys (`_cpap_stream_watch_row`, `_maybe_start_cpap_spool_pull`) are GONE, not
# kept as examples: the module key matches first, so they could never fire again, and a declaration
# that can never fire is the stale-key hazard `test_every_declared_key_names_a_function_that_EXISTS`
# was written to catch. Their measurements are not lost — they are the module entry's evidence, both
# cited in its `cost.source`, which is the honest place for them.
EXCLUSION_BOUND = 2

# ── A MODULE KEY IS AN OWNER-NAMED ALLOWLIST, NEVER A COUNT ────────────────────────────────────────
# The owner ruled ONE module-level declaration on 2026-10-03 (`capture.py`) and authorized a SECOND on
# 2026-10-11 (`webmon.py`, whose `make_app` factory is one 1,791-line function carrying 57 nested
# handlers, so every handler edit scopes the whole module and generation does not finish in CI).
#
# 🔴 THE LIMIT IS THE NAMES, NOT THE NUMBER, and the difference is the whole policy. A bound of two
# says "two modules are declarable" and lets ANY module take the second slot — which is the general
# permission the one-module rule was written to withhold, arriving by arithmetic instead of by ruling.
# Naming them keeps the fence exactly as narrow as the two rulings: a third module key refuses, and so
# does a module key for any module not named here, including as the FIRST entry in an empty file.
# Each value is the date the owner authorized that module, so the entry and the ruling cannot drift
# apart silently.
MODULE_KEYS_AUTHORIZED = {
    "capture.py": "2026-10-03",
    "webmon.py": "2026-10-11",
}

# A cost is only a cost if you can get back to how it was obtained. `run` is a CI run/job, `local` a
# named local measurement with its host, `sizes` a row of tools/mutation-sizes.json.
COST_PROVENANCE = frozenset({"run", "local", "sizes"})

# A cost is MODULE-level or FUNCTION-level, and the key's shape must match it. This is the field that
# stops a bare module key from being written with a per-function measurement, or vice versa.
COST_SCOPES = frozenset({"module", "function"})


def parse_exclusions(text: str) -> dict[str, dict]:
    """The declared exclusion list, or RAISE. Pure — takes the file's text, touches no filesystem.

    Refuses rather than tolerating, because every tolerated shape here is a silent widening of what the
    gate may call NOT_APPLICABLE:
      * a wrong or absent `schema` — this is not the file we think it is;
      * a key that is not exactly `module::function` — a glob or a bare module name would exclude a
        population nobody declared;
      * more entries than `EXCLUSION_BOUND` — the bound is the "bounded" in "declared bounded list";
      * a missing `reason` / `declaredAt`, or a `cost` whose `provenance` is not in `COST_PROVENANCE` —
        an undated, unexplained or unsourced exclusion is indistinguishable from an excuse.
    """
    doc = json.loads(text)
    if not isinstance(doc, dict) or doc.get("schema") != EXCLUSIONS_SCHEMA:
        raise ValueError(
            f"not a {EXCLUSIONS_SCHEMA} document: schema={doc.get('schema') if isinstance(doc, dict) else type(doc).__name__!r}"
        )
    raw = doc.get("exclusions")
    if not isinstance(raw, dict):
        raise ValueError("`exclusions` must be an object of key -> entry")
    out: dict[str, dict] = {}
    for key, e in raw.items():
        if not isinstance(e, dict):
            raise ValueError(f"{key}: entry must be an object")
        if any(ch in key for ch in "*?["):
            raise ValueError(f"{key!r} may not contain a glob character — a pattern widens as code moves")
        if key.count("::") > 1:
            raise ValueError(f"{key!r} is not an exact key (at most one `::`)")
        cost = e.get("cost")
        if not isinstance(cost, dict) or cost.get("provenance") not in COST_PROVENANCE:
            raise ValueError(
                f"{key}: `cost.provenance` must be one of {sorted(COST_PROVENANCE)} — a hand-typed "
                "number is indistinguishable from a measured one"
            )
        if not cost.get("source"):
            raise ValueError(f"{key}: `cost.source` must name the run, host or sizes row the number came from")
        scope = cost.get("scope")
        if scope not in COST_SCOPES:
            raise ValueError(f"{key}: `cost.scope` must be one of {sorted(COST_SCOPES)}")
        if "::" in key:
            mod, func = key.split("::")
            if not mod.endswith(".py") or not func:
                raise ValueError(f"{key!r} must name a `.py` module and a function")
            if scope != "function":
                raise ValueError(f"{key!r} is a function key but declares `cost.scope` {scope!r}")
        else:
            # A MODULE key. The owner ruled one module-level declaration (2026-10-03) because the cost
            # is the module's, but a bare key is also the widest thing this file can say, so it is
            # fenced hardest: it must be a `.py` module, it must carry a module-level cost with BOTH
            # module measurements in it, and there may be only ONE in the file. Without the count
            # limit, "one module-level declaration" becomes "modules are declarable", which is a
            # different policy than the one that was ruled.
            if not key.endswith(".py"):
                raise ValueError(f"{key!r} is neither a `module.py::function` key nor a `module.py` module")
            if scope != "module":
                raise ValueError(f"{key!r} is a module key but declares `cost.scope` {scope!r}")
            if not cost.get("generatedBytes"):
                raise ValueError(
                    f"{key}: a module key needs `cost.generatedBytes` — the module-level claim is only "
                    "as good as the numbers behind it"
                )
            # ── THE TIME NUMBER NAMES *WHICH* PHASE RAN OUT, and the two are not interchangeable ────
            # `statsPassSec` was the only accepted form because `capture.py` is bound by the traced
            # stats pass: generation finishes in under a second there and the cost is all downstream.
            # `webmon.py` fails EARLIER — mutant GENERATION does not finish, killed at its own cap — so
            # it has no stats pass at all, and never will until generation completes once.
            #
            # 🔴 WRITING 3496 INTO `statsPassSec` WOULD BE A MEASUREMENT OF ONE PHASE FILED AS ANOTHER:
            # the number is real, and the field would make it a lie (§∅ — a value that was not measured
            # is absent, and "absent" includes "measured, but about something else"). So a module key
            # satisfies the time requirement with EITHER phase's number, and must carry one: a cost
            # with no time at all is an assertion.
            if not (cost.get("statsPassSec") or cost.get("generationCapSec")):
                raise ValueError(
                    f"{key}: a module key needs `cost.statsPassSec` (bound by the traced stats pass) "
                    "or `cost.generationCapSec` (bound by mutant generation) — one of the two phases "
                    "has to be the measured one, and which it is belongs in the entry"
                )
            if key not in MODULE_KEYS_AUTHORIZED:
                _named = ", ".join(f"{k} ({d})" for k, d in sorted(MODULE_KEYS_AUTHORIZED.items()))
                raise ValueError(
                    f"{key!r} is a MODULE key that no owner ruling names — the authorized set is "
                    f"{_named}. A further module-level exclusion is a policy change, not an entry"
                )
        for field in ("reason", "declaredAt"):
            if not e.get(field):
                raise ValueError(f"{key}: missing `{field}` — an exclusion with no {field} is an excuse")
        out[key] = e
    # The bound is checked LAST, on purpose. With the bound at 1 it fired FIRST and masked the
    # module-key rule: `test_only_ONE_module_key_may_exist` got a bound error, so the rule it meant
    # to pin went unexercised. A rule verified only while another rule happens not to shadow it is not
    # verified. (The bound is now 2 and the module rule is an allowlist by NAME, so the two no longer
    # overlap at all — but the ordering stays, because the masking was a property of the ordering.) Per-entry errors are also the more actionable diagnostic — "you added a second module
    # key" says what to do, where "you exceeded the bound" invites raising the bound.
    if len(out) > EXCLUSION_BOUND:
        raise ValueError(
            f"{len(out)} declared exclusion(s) exceeds EXCLUSION_BOUND={EXCLUSION_BOUND} — raise the "
            "bound in a commit that says why, or remove an entry"
        )
    return out


def count_functions(source: str) -> int:
    """How many functions a module defines, counting nested ones and methods. Pure; 0 if unparsable.

    MEASURED, never quoted. A module-level exclusion retires every one of these from mutation testing,
    and the number is the size of the blind spot, so the gate recomputes it from the module's own AST on
    every run. MUTATION-SCOPED-GENERATION-2026-09-28 cites "226 functions across capture.py" measured on
    2026-09-28; the module now defines 290 (229 at module level). A number that drifts is exactly the
    kind that must not be hard-coded into the thing reporting it.

    Unparsable source returns 0 rather than raising: this is a reporting count, and failing the gate
    because a count could not be taken would convert a cosmetic problem into a verdict.
    """
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return 0
    return sum(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) for n in ast.walk(tree))


def declared_module(declared: dict[str, dict], module: str) -> dict | None:
    """The MODULE-level declaration covering `module`, or None. Pure.

    Only a bare `module.py` key matches. A function key (`module.py::f`) is deliberately invisible here:
    the two answer different questions, and reading one as the other is how a declaration about ONE
    function would come to excuse a whole module.
    """
    entry = declared.get(module)
    if entry and (entry.get("cost") or {}).get("scope") == "module":
        return entry
    return None


def module_exclusion_note(module: str, scoped: list[str], covers: int) -> str:
    """What the gate prints and puts in the verdict when a module-level declaration applies.

    The COUNTS are the point. A one-line declaration can retire a 13,673-line module from mutation
    testing, so the gate re-states on every run how many functions it covers and how many of this
    diff's own functions fell under it — the blind spot is counted per PR, not agreed once and
    forgotten. `covers` is measured from the module's AST by the caller, never quoted from a brief.
    """
    return (
        f"{module} carries a MODULE-level exclusion: {len(scoped)} function(s) in this diff "
        f"({', '.join(sorted(scoped))}) and {covers} in the module are declared unmeasurable inside "
        f"the gate budget"
    )


def refused_key(entry: str) -> str:
    """The `module.function` identity inside one `_refused_*` line, or "" when the line has no prefix.

    PURE. The refusal lines are human sentences — `"timeline.build: the 7200s gate budget was exhausted
    before this function could be mutated"` — and the identity is the part before the first `": "`.
    Returns "" rather than guessing when there is no separator: an unparsed refusal must never be
    matched against a declared exclusion, because a false match is exactly the escape hatch this design
    refuses to build.
    """
    head, sep, _rest = entry.partition(": ")
    if not sep or not head.strip():
        return ""
    return head.strip()


def exclusion_key_of(refused_entry: str) -> str:
    """`module.function` or a mutmut glob (refusal prose) -> `module.py::function`, or `""`.

    The two vocabularies differ and that is not cosmetic: a refusal line names either a SOURCE function
    (`timeline._stamp_ms: the 7200s gate budget was exhausted…`) or a GLOB
    (`timeline.x__placed__mutmut_*: hit the gate budget after 2504s`), while the declaration names a
    source identity (`timeline.py::_placed`). Both shapes appear in one `_refused_budget` list.

    The glob case DELEGATES to `source_function_of_glob` rather than re-deriving the mangling — mutmut
    encodes `_placed` as `x_` + `_placed` = `x__placed`, so a naive `removeprefix("x__")` yields
    `placed` and silently names a DIFFERENT function. One decoder, already tested, reused here.

    FAILS CLOSED, returning `""`, on anything it cannot read exactly: no `": "` separator, no module
    part, or a METHOD glob (`xǁClassǁname`), whose decoded bare name could match a module-level
    function of the same name. A false match is precisely the escape hatch this design refuses to
    build, so an unreadable refusal is never matched against a declaration.
    """
    head = refused_key(refused_entry)
    if not head:
        return ""
    head = head.partition(":")[0].strip()
    mod, dot, rest = head.partition(".")
    if not dot:
        return ""
    if "ǁ" in rest:
        return ""
    func = source_function_of_glob(head) if "__mutmut" in rest else rest
    if not mod or not func or "." in func:
        return ""
    return f"{mod}.py::{func}"


def declared_exclusion_status(
    status: str,
    *,
    refused: list[str],
    declared: dict[str, dict],
    blocking: int,
) -> tuple[str, str] | None:
    """Whether a DECLARED exclusion may restate this run's UNKNOWN as NOT_APPLICABLE. Pure.

    Returns `(status, reason)` to substitute, or None to leave the verdict exactly as it was.

    🔴 THE SAFETY ARGUMENT, and it is the only reason this function is allowed to exist:

      * It acts ONLY on `UNKNOWN`. A `FAIL` is returned untouched, so a declared exclusion can never
        clear a survivor — and it never yields `PASS`, so no green is ever produced by declaring
        something. The strongest thing an exclusion can say is "the rule does not bind here", which is
        what `NOT_APPLICABLE` means in the contract (§🧾: examined, and the rule does not bind).
      * It acts only when EVERY refused function is declared. One undeclared refusal and the run stays
        UNKNOWN, because the undeclared one is genuinely unknown and a partial declaration must not
        speak for it.
      * `blocking > 0` short-circuits before anything else. Survivors outrank a declaration, always.

    A caller that wants "did the exclusion apply?" reads the returned reason; there is no second status
    printer and no new verdict object (§🧾 PARTIAL-ADOPTION-DETECTION reds a tool that prints its own).
    """
    # UNKNOWN *or* NOT_RUN. 🔴 THIS GUARD READ `status != "UNKNOWN"` AND THAT WAS A DEFECT — found by
    # #3238, the first PR to exercise the exclusion for real. `budget_exhaustion_verdict` answers
    # NOT_RUN when `decided == 0` and UNKNOWN only when `decided > 0`, so a diff whose ENTIRE scope is
    # one declared function — the canonical case — produced NOT_RUN and the substitution never fired.
    # I had built and tested only the MIXED case (some functions measured, some refused), and my own
    # test parametrised NOT_RUN among the statuses this must not touch, so the suite asserted the bug
    # as intended behaviour and could never have caught it.
    #
    # NOT_APPLICABLE is right for both: §🧾 reserves NOT_RUN for "examined nothing", and with a DECLARED
    # exclusion the measurability question WAS examined — in advance, with the measurements in the file.
    # The safety property is untouched and does not rest on this status check: a FAIL is still returned
    # unchanged, PASS is still never produced, a blocking survivor still short-circuits, every refused
    # function must still be declared, and the caller wires this ONLY into the budget-refusal path, so a
    # crash, a memory refusal or a generation timeout cannot reach it whatever their status.
    if blocking > 0 or status not in ("UNKNOWN", "NOT_RUN") or not refused:
        return None
    keys = [exclusion_key_of(r) for r in refused]
    if not all(keys):
        return None
    undeclared = sorted({k for k in keys if k not in declared})
    if undeclared:
        return None
    named = sorted(set(keys))
    return "NOT_APPLICABLE", (
        f"{len(named)} refused function(s) are DECLARED unmeasurable inside the gate budget "
        f"({', '.join(named)}); the criterion does not bind on a population mutmut cannot generate "
        f"scoped — see tools/{EXCLUSIONS_FILE} for each reason, date and measured cost, and "
        "briefs/MUTATION-SCOPED-GENERATION-2026-09-28-BRIEF.md for what retires the exclusion. "
        "No survivor was excused: this run had none blocking."
    )


def unmeasured_rows(refused: list[str], declared: dict[str, dict], at: str) -> list[dict]:
    """The `unmeasured` ledger rows one refusal list ingests. Pure, and it is the point of the row
    `2026-09-28-five-timeline-functions-were-never-mutated-and-the-ledger-cannot-hold-that`:

    the survivor ledger records SURVIVORS, so a function that was never mutated leaves NO entry at all
    and the next reader sees the measured functions with no trace of the unmeasured ones. These rows are
    that trace. `state` is `declared` when the key is in the exclusion list and `undeclared` when it is
    not — the second is the one worth looking at, and collapsing them would hide it.
    """
    rows = []
    for r in refused:
        key = exclusion_key_of(r)
        if not key:
            continue
        rows.append(
            {
                "key": key,
                "state": "declared" if key in declared else "undeclared",
                # `r.partition(": ")[2]` and not a conditional: a non-empty `key` already PROVES
                # `": "` is in `r`, because `exclusion_key_of` goes through `refused_key`, which
                # returns "" without that separator. The `if ": " in r else r` that stood here was
                # dead code — found by a surviving mutant that flipped the condition to `or True`
                # and changed nothing, which is what an unreachable branch looks like from the gate.
                "why": r.partition(": ")[2],
                "observedAt": at,
            }
        )
    return rows


UNMEASURED_SCHEMA = "tepna.mutation-unmeasured/1"


def declared_module_rows(module: str, scoped: list[str], at: str) -> list[dict]:
    """Unmeasured-ledger rows for the functions a MODULE-level declaration skipped. Pure.

    ⚠️ WHY THIS EXISTS AT ALL. Moving the declaration check to SELECTION removed the budget refusal for
    a declared module, and `unmeasured_rows` reads `_refused_budget` — so the ledger would have recorded
    NOTHING for exactly the module whose blind spot it is meant to enumerate. Making the gate faster
    silently removed the record of what the gate stopped measuring, which is the shape §∅ warns about:
    the absence of a row is not the absence of a gap.

    `state` is `declared`, and the rows are still only written by a real run through
    `--record-unmeasured`. Hand-writing them would fabricate an observation, and the growth gate counts
    rows without being able to tell a measured one from a typed one.
    """
    return [
        {
            "key": f"{module}::{fn}",
            "state": "declared",
            "why": f"{module} carries a MODULE-level exclusion — not attempted, not a verdict",
            "observedAt": at,
        }
        for fn in sorted(scoped)
    ]


def merge_unmeasured(doc: dict, rows: list[dict]) -> dict:
    """Ingest refusal rows into the unmeasured ledger. Pure — returns a new document.

    APPEND-OR-UPDATE, never drop. A key already present keeps its FIRST `observedAt` (the question was
    first unasked then, and back-dating it would erase how long this has stood) and takes the newest
    `state` and `why`, because a row that moves from `undeclared` to `declared` is the thing a reader
    most wants to see change. Rows are sorted by key so the file's diff is reviewable.

    A row whose key is empty is dropped: `exclusion_key_of` returns `""` for a refusal it could not
    read exactly, and a ledger entry keyed on nothing is worse than no entry.
    """
    out = dict(doc)
    out.setdefault("schema", UNMEASURED_SCHEMA)
    existing = {r["key"]: dict(r) for r in doc.get("rows", []) if r.get("key")}
    for r in rows:
        key = r.get("key")
        if not key:
            continue
        if key in existing:
            first = existing[key].get("observedAt")
            existing[key].update({k: v for k, v in r.items() if v})
            if first:
                existing[key]["observedAt"] = first
        else:
            existing[key] = dict(r)
    out["rows"] = [existing[k] for k in sorted(existing)]
    return out


def result_inconsistency(result: dict, survivors_len: int, undecided_len: int) -> str | None:
    """Why this verdict's own numbers cannot all be true — or None when they can.

    PURE, and it exists because the artifact shipped an impossible block: `generated: 0, decided: 0,
    killed: 0, survived: 26`. Survivors of a population the same object says does not exist. A consumer
    computing a rate divides by zero; one reading `generated` as the denominator concludes the run
    examined nothing while `survived` is non-empty. The contradiction was visible without leaving the
    file and nothing looked.

    The invariants are the ones a reader would assume and therefore the ones worth asserting:

      · `survived` == the length of the survivors LIST, and `undecided` likewise. Two fields of one
        verdict disagreeing about how many there are is what made a 26-entry list read as 12 in the
        `reason` string and 26 in `result.survived`, with nothing saying which was the count.
      · `killed + survived <= decided <= generated`. Not equality: `excused` and `empty_diff`
        mutants are decided and counted separately.
      · `decided + undecided <= generated`. `undecided` is the OTHER side of `decided`, not a part
        of it — `mmeta.decisions_under_glob` counts a mutant only when mutmut's own table calls its
        exit code a kill or a survival, and every other outcome lands in `undecided`. So an undecided
        mutant is bounded by `generated` and never by `decided`.
      · `killed + survived + notRequired + emptyDiff >= decided`. EVERY DECIDED MUTANT IS IN A BUCKET.
        This is the one that was missing, and the hole it left is measured: on #3654 the gate printed
        `every mutant on the changed functions was killed` with `generated 190, decided 190, killed
        182, survived 2` — six decided mutants in no bucket at all, dropped by the string-literal
        exclusion, which had no counter. Every inequality above was satisfied, because a silently
        dropped mutant makes the arithmetic look smaller rather than wrong. The excluded sets are
        counted now, so the residual has to be named.

    🔴 THE SECOND BULLET WAS ONCE INSIDE THE FIRST, and that made this function red every run that
    had an undecided mutant. Measured on #3237's first CI run (36613550322): 109 decided, 23 undecided,
    killed + survived 108 — all three honest — and the check fired with "killed + survived + undecided
    (131) exceeds result.decided (109)". The verdict object then carried that string instead of
    "23 mutant(s) UNDECIDED in kill_process_group", so a reader of the object alone was told the
    counters were broken when what was broken was the diff's coverage. Both refusals were correct and
    the second is downstream of the first, so nothing read as green; the cost was the less actionable
    reason. `2026-09-29-verdict-self-check-counts-undecided-inside-a-sum-bounded-by-decided`.

    Returns the FIRST failing invariant with its numbers, because a caller that prints one reason is
    better served by a specific one than by a list it has to parse.
    """
    # THE KEYS ARE REQUIRED, NOT DEFAULTED. `.get(k, 0)` here would read a MISSING counter as zero —
    # absence as a number, in the one function whose job is catching a verdict that misreports its own
    # numbers (§∅). A block with no `killed` would then satisfy every inequality below by arithmetic.
    # The mutation gate found this the honest way: every `.get` default was a SURVIVING mutant, because
    # no input could reach it. Requiring the keys removes the defaults and the hole together.
    missing = [
        k
        for k in ("generated", "decided", "killed", "survived", "undecided", "notRequired", "emptyDiff")
        if k not in result
    ]
    if missing:
        return (
            f"result is missing {', '.join(missing)} — a counter that is absent is not a counter "
            "that is zero, and a verdict cannot be checked against numbers it does not carry"
        )
    for field, n in (("survived", survivors_len), ("undecided", undecided_len)):
        if int(result[field]) != n:
            return (
                f"result.{field} is {result[field]} but the {field} list holds {n} — "
                "two fields of one verdict disagreeing about the count"
            )
    gen, dec, und = int(result["generated"]), int(result["decided"]), int(result["undecided"])
    settled = int(result["killed"]) + int(result["survived"])
    if dec > gen:
        return f"result.decided ({dec}) exceeds result.generated ({gen}) — more mutants decided than exist"
    if settled > dec:
        return (
            f"result.killed + survived ({settled}) exceeds result.decided ({dec}) — "
            "outcomes recorded for mutants the run says it never settled"
        )
    # `undecided` is counted against `generated`, NOT against `decided` — see the docstring. This is the
    # bound that still catches a double count: a run claiming to have accounted for more mutants than
    # it generated has lost track of one of the two sets.
    if dec + und > gen:
        return (
            f"result.decided + undecided ({dec + und}) exceeds result.generated ({gen}) — "
            "more mutants accounted for than the run generated"
        )
    # EVERY DECIDED MUTANT IS IN A BUCKET, or this verdict is about a population it quietly shrank.
    # One-directional on purpose: a bucket total ABOVE `decided` is a different defect and the
    # `settled > dec` bound above already carries it, while a total BELOW it is the silent exclusion
    # that made a PASS over six live mutants arithmetically consistent.
    bucketed = int(result["killed"]) + int(result["survived"]) + int(result["notRequired"]) + int(result["emptyDiff"])
    if bucketed < dec:
        return (
            f"result.decided ({dec}) exceeds killed + survived + notRequired + emptyDiff ({bucketed}) — "
            f"{dec - bucketed} decided mutant(s) are in no bucket: not killed, not surviving, not excluded"
        )
    return None


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
        return (
            "the capture-host venv is missing — expected an interpreter at .venv/bin/python. "
            "Create it (python -m venv .venv && .venv/bin/pip install -e '.[dev]') and re-run."
        )
    if probe_rc is None:
        return (
            "the venv interpreter could not be launched. The path exists but is not executable or is a broken symlink."
        )
    if probe_rc != 0:
        return (
            "mutmut is not importable under the venv interpreter "
            "(`.venv/bin/python -c 'import mutmut'` exited non-zero). Install it into the venv; "
            "without it this gate generates no mutants and would report success."
        )
    return None


def selftest() -> int:
    """The classifier's own known answers. A mechanism that decides what the gate ignores has to be
    the best-tested thing in the file, so each of the five outcomes is pinned here."""
    # ONE FAILURE PATH, not twenty-two. Each check used to carry its own `print(...)` and
    # `ok = False`, and BOTH lines are unreachable while the module is correct — which is why this
    # 160-line function held 64 surviving mutants, every one of them on scaffolding rather than on
    # a claim anyone makes. Collapsed into a closure so the failure path is SINGLE and REACHABLE:
    # the fault-injection tests below drive it, and that is what kills its mutants. The conditions
    # stay where they are — they ARE the assertions, and flipping one makes the selftest fail,
    # which `M.selftest() == 0` already catches.
    fails: list[str] = []

    def fail(msg: str) -> None:
        # PRINT FROM THE LIST, not from the argument. The two must not be able to disagree: with
        # `print(msg)` a mutated `fails.append(None)` left the printed sentence intact and the exit
        # code unchanged, so nothing could see it. Reading back what was stored makes the stored value
        # the thing the message assertions check.
        fails.append(msg)
        print(fails[-1])

    # ⚠️ THIS FIXTURE USED TO ASSERT THE DEFECT. Entry "d" was commented "generated but KILLED ->
    # refuted" and was passed only in `generated`, so the selftest pinned absence-means-killed as the
    # contract and would have gone red on the fix. A kill is now a POSITIVE observation and is passed
    # as one; "g" is the case that used to be impossible to express — generated, never settled.
    E = [
        {"key": "a", "class": "no-distinguishing-input"},
        {"key": "b", "class": "untestable-by-design"},
        {"key": "c", "class": "real-gap"},
        {"key": "d", "class": "no-distinguishing-input"},  # a CORROBORATED kill -> refuted
        {"key": "e", "class": "no-distinguishing-input"},  # not in the run at all -> orphaned
        {"key": "g", "class": "no-distinguishing-input"},  # generated, never settled -> not_decided
    ]
    S = [{"key": k} for k in ("a", "b", "c", "f")]
    got = classify(E, S, {"d"}, generated={"a", "b", "c", "d", "f", "g"})
    want = {
        "excused": ["a", "b"],
        "real_gap": ["c"],
        "refuted": ["d"],
        "orphaned": ["e"],
        "unclassified": ["f"],
        "not_decided": ["g"],
    }
    for bucket, keys in want.items():
        have = sorted(x["key"] for x in got[bucket])
        if have != sorted(keys):
            fail(f"  selftest FAIL {bucket}: {have} != {sorted(keys)}")
    # a killed mutant that nobody claimed is simply absent from every bucket
    if any(x.get("key") == "d" for x in got["unclassified"]):
        fail("  selftest FAIL: a killed mutant leaked into unclassified")
    # THE PLANT: a run whose output is MISSING an excused mutant must not refute it. "a" is excused
    # above; drop it from both the survivors and the kills, leaving it only in `generated`.
    _missing = classify([{"key": "a", "class": "no-distinguishing-input"}], [], set(), generated={"a"})
    if _missing["refuted"]:
        fail("  selftest FAIL: an absent mutant was REFUTED — absence is not a kill")
    if [x["key"] for x in _missing["not_decided"]] != ["a"]:
        fail(f"  selftest FAIL: an absent mutant must read not_decided, got {_missing}")
    # And a kill mutmut calls a kill but pytest called an internal error is NOT a detection. TWO
    # separate checks, not one `or`: with a single condition, `or` → `and` never fires and no fault
    # that breaks ONE half can show it. Each also pins the REASON, because the boolean alone is true
    # of every non-detection — exit 4 and None are not detections either, so asserting only `not ok`
    # let a mutant swap the exit code for another and change nothing observable.
    _d3 = kill_is_a_detection(3)
    if _d3[0] or "internal error in pytest means a kill" not in _d3[1]:
        fail(f"  selftest FAIL: pytest exit 3 was accepted as a detection, or stopped naming why: {_d3}")
    _c3 = refutation_corroborated(1, 3)
    if _c3[0] or "internal error in pytest means a kill" not in _c3[1]:
        fail(f"  selftest FAIL: an exit-3 re-run corroborated a refutation, or stopped naming why: {_c3}")

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
        fail("  selftest FAIL: a keyword change is treated as string-only because the LINE holds a quote")
    # Its twin, which the old rule already handled correctly — the fix must not regress it.
    if is_string_only(
        _d('    data = json.loads(p.read_text(encoding="utf-8"))', "    data = json.loads(p.read_text(encoding=None))")
    ):
        fail("  selftest FAIL: the quote-free twin regressed")
    # ⚠️ And the opposite over-correction: keying on mutmut's XX sentinel ALONE is too narrow —
    # a case change is a real string mutation carrying no sentinel, and must still be skipped.
    if not is_string_only(_d('    x = f(encoding="utf-8")', '    x = f(encoding="UTF-8")')):
        fail("  selftest FAIL: a genuine string-literal change is now required")
    if not is_string_only(_d('    s = "hello"', '    s = "XXhelloXX"')):
        fail("  selftest FAIL: mutmut's XX sentinel is no longer conclusive")
    # Log wording on a line that also holds other literals — the case the rule exists for.
    if not is_string_only(_d('    log("a", "the quick brown fox")', '    log("a", "XXthe quick brown foxXX")')):
        fail("  selftest FAIL: log wording is no longer skipped")
    # A comparison flip on a line containing a string is a REAL survivor and must be reported.
    if is_string_only(_d('    if d["k"] > 3: pass', '    if d["k"] >= 3: pass')):
        fail("  selftest FAIL: a comparison flip is hidden by an unrelated dict key")
    # An f-string's `{...}` fields are CODE (mutmut mutates them as code and generates no text mutant
    # for an f-string at all — measured 2026-09-26); a mutant inside one is REQUIRED, never excluded.
    if is_string_only(_d('    x = f"{a(y)}-{y + 1}"', '    x = f"{a(None)}-{y + 1}"')):
        fail("  selftest FAIL: a mutant inside an f-string field is hidden as string-only")
    if not is_string_only(_d('    x = f"started {n}"', '    x = f"begun {n}"')):
        fail("  selftest FAIL: an f-string's TEXT is no longer string-only")
    if _fstring_expr_spans('f"{a(y)}-{y + 1}"') != [(2, 8), (9, 16)]:
        fail("  selftest FAIL: _fstring_expr_spans mislocates the fields")
    # the span helpers, pinned directly
    if changed_span("a=1", "a=1") is not None:
        fail("  selftest FAIL: changed_span invents a difference")
    if changed_span('f("x")', 'f("y")') != (3, 4, 4):
        fail("  selftest FAIL: changed_span mislocates the differing region")
    if _string_spans("a = \"b\" + 'c'") != [(4, 7), (10, 13)]:
        fail("  selftest FAIL: _string_spans miscounts literals")

    # diff_key ignores whitespace but not content, and drops the +++/--- headers
    if diff_key("--- a\n+++ b\n-  x = 1\n+  x  =  2\n") != "- x = 1 | + x = 2":
        fail("  selftest FAIL: diff_key")
    if diff_key("-a\n+b\n") == diff_key("-a\n+c\n"):
        fail("  selftest FAIL: diff_key collides on different mutations")
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
            fail(f"  selftest FAIL: refusal_reason({label}) -> {got!r}")
    # the three refusal texts must be DISTINCT — they prescribe different remedies
    if len({refusal_reason(True, 1), refusal_reason(True, None), refusal_reason(False, None)}) != 3:
        fail("  selftest FAIL: refusal reasons are not distinguishable")
    # ── the two exclusions must stay APART (2026-08-27) ─────────────────────────────────────────
    # A no-op mutant used to fall through to "string-only" and be excluded as though it were log
    # prose. It may still be excluded, but not under that name.
    if string_only_verdict(_d("    x = 1", "    x = 1"))[0] != EMPTY_DIFF:
        fail("  selftest FAIL: a no-op diff is not labelled EMPTY_DIFF")
    if string_only_verdict(_d('    log.info("a")', '    log.info("b")'))[0] != STRING_ONLY:
        fail("  selftest FAIL: a log-prose mutation is no longer STRING_ONLY")
    _tq = chr(34) * 3
    if string_only_verdict(_d("    x = f(1)  # " + _tq, "    x = f(2)  # " + _tq))[0] != UNDECIDABLE:
        fail("  selftest FAIL: a line outside the scan's competence was decided anyway")
    print("  selftest: classify + diff_key + refusal_reason + verdict OK" if not fails else "  selftest: FAILED")

    # ── annotation_only: signatures may be re-annotated; behaviour may not ─────────────────────
    # Expected-PASS plants included deliberately (a rail probed only with expected-rejects ships
    # over-rejecting forever); each case asserts the REASON branch too, so a vacuous equality can
    # never wear the right verdict (saw-the-plant, both fields).
    _AO = [
        # (old, new, want_excluded, want_reason_substr, label)
        (
            "def f(x: float): return x",
            "def f(x: float | None): return x",
            True,
            "stripped ASTs identical",
            "widen an arg annotation",
        ),
        ("def f(x): return x", "def f(x) -> int: return x", True, "stripped ASTs identical", "add a return annotation"),
        (
            "async def g(a: int, *, b: str = 'q'): pass",
            "async def g(a: object, *, b: str = 'q'): pass",
            True,
            "stripped ASTs identical",
            "async + kwonly annotations",
        ),
        (
            "def f(x: int = 1): return x",
            "def f(x: int = 2): return x",
            False,
            "behavioural difference",
            "a default is behaviour",
        ),
        (
            "def f(x: int): return x",
            "def f(y: int): return y",
            False,
            "behavioural difference",
            "a rename is behaviour",
        ),
        (
            "def f(x: int): return x",
            "def f(x: int): return x + 1",
            False,
            "behavioural difference",
            "a body edit is behaviour",
        ),
        (
            "class C:\n    x: int = 1",
            "class C:\n    x: float = 1",
            False,
            "behavioural difference",
            "class-body AnnAssign is load-bearing (dataclass/ClassVar)",
        ),
        (
            "def f(x: int): return x",
            "def f(x: int) return x",
            False,
            "parse failed",
            "unparseable fails closed to full scope",
        ),
    ]
    for old_src, new_src, want_x, want_r, label in _AO:
        got_x, got_r = annotation_only(old_src, new_src)
        if got_x != want_x or want_r not in got_r:
            fail(f"  selftest FAIL annotation_only [{label}]: ({got_x}, {got_r!r})")

    return 0 if not fails else 1


GENERATION_COMPLETE_MARKER = ".generation-complete"
# Written into a scratch the moment mutmut reports its generation FINISHED, and required before that scratch
# is reused. Residue 2026-10-11-a-killed-generation-is-reused-as-a-complete-one: mutmut 3.8 decides a
# generated `mutants/<module>` is up to date from its mtime alone, and opens it for writing (truncating)
# BEFORE it validates it, so a generation killed mid-write leaves a truncated file that every later call
# accepts as complete — `unmodified=True`, no validation — and the stats pass then runs over a module that
# does not parse. Reuse used to be keyed on that file merely EXISTING. Completeness is now a positive
# observation (mutmut's own completion line), never inferred from a file being there.


def mark_generation_complete(scratch) -> bool:
    """Record that generation finished in `scratch`. False when the marker could not be written, in which
    case the scratch is simply not reused — the safe direction."""
    try:
        (scratch / GENERATION_COMPLETE_MARKER).write_text("complete\n", encoding="utf-8")
    except OSError:
        return False
    return True


def scratch_generation_reusable(scratch, module) -> bool:
    """True only when `scratch` holds the generated `module` AND a run saw its generation finish. A
    scratch with the file but no marker is a killed (or pre-marker) generation: not reusable."""
    return (scratch / "work" / "mutants" / module).exists() and (scratch / GENERATION_COMPLETE_MARKER).exists()


def refresh_scratch(tree, work, extras) -> int:
    """Copy every sibling in `extras` from `tree` into a reused mutation scratch, in BOTH `work/` and
    `work/mutants/`. Returns how many entries were refreshed.

    HERE rather than in `tools/mutate.py` for the reason that file's own header gives: a function that
    can give a WRONG ANSWER rather than failing loudly belongs inside the coverage floor. This one can
    — it decides WHICH files a reused scratch carries, and getting that wrong produces a verdict that
    is wrong in either direction while every run looks healthy.

    The scratch is reused on the mutated module's hash alone, which is right for the mutants (a pure
    function of that module) and blind to everything else. Before this existed only `tests/` was
    refreshed, so a changed sibling module, shell script or fixture did not move the key and did not
    get copied: the run executed the NEW tests against the OLD sibling. Measured 2026-09-07 on
    `night_report.py` — three consecutive runs reported a baseline failure already fixed, byte-identical
    each time, because the scratch's `tepna-report.sh` predated the fix.

    `extras` is the SAME list the initial copy builds, so reuse and creation cannot drift about what a
    scratch contains — that drift IS the defect. The mutated module is absent from it by construction,
    which is what protects mutmut's generated `mutants/<module>` from being overwritten by the
    unmutated source.

    ⚠️ Copy-only: a sibling DELETED from the tree still lingers in a reused scratch. Same class, not
    handled here, because pruning unknown entries risks removing mutmut's own bookkeeping; `--no-reuse`
    is the escape hatch until it is measured to matter.
    """
    import shutil

    n = 0
    for sub in ("", "mutants"):
        dest_root = work / sub if sub else work
        for name in extras:
            src = tree / name.rstrip("/")
            dst = dest_root / name.rstrip("/")
            if src.is_dir():
                shutil.rmtree(dst, ignore_errors=True)
                shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            else:
                shutil.copy2(src, dst)
            n += 1
    return n


def _subdir_index(root, tree_name):
    """`({basename: relpath}, {ambiguous basenames})` for files in SUBDIRECTORIES of the repo root.

    Tracked files only where git can be read — an untracked scratch file is nobody's fixture, and in
    the real checkout `uploads/` also holds gitignored corpus recordings that no test names. Falls
    back to a pruned walk (no dot-dirs, no `node_modules`, not the tree itself) when git is absent,
    which is the case in the synthetic trees the tests build.

    A basename mapping to MORE THAN ONE path is ambiguous and is dropped from the index: staging the
    wrong `README.md` is worse than staging none, and the caller publishes the dropped names."""
    import subprocess
    from collections import defaultdict
    from pathlib import Path

    root = Path(root)
    rels: list[str] = []
    try:
        out = subprocess.run(
            ["git", "ls-files", "-z"], cwd=str(root), capture_output=True, text=True, timeout=60, check=True
        ).stdout
        rels = [r for r in out.split("\0") if r]
    except (OSError, subprocess.SubprocessError):
        for p in root.rglob("*"):
            # `relative_to` cannot raise here: rglob yields only paths under `root`. The defensive
            # try/except that stood here was unreachable, so it was dead code AND an unexplained
            # swallow AND two uncovered lines — three costs for a branch that cannot be taken.
            rel = p.relative_to(root).as_posix()
            if not p.is_file():
                continue
            parts = rel.split("/")
            if any(seg.startswith(".") or seg == "node_modules" for seg in parts):
                continue
            rels.append(rel)
    by_base: dict[str, list[str]] = defaultdict(list)
    for rel in rels:
        parts = rel.split("/")
        if len(parts) < 2 or parts[0] == tree_name:
            continue  # root-level files are `names`; the tree is the scratch copy itself
        # DOT SEGMENTS STAY OUT OF THE BASENAME INDEX, matching the root-level rule above — a basename
        # is too weak a key for a dot directory, where `.github/workflows/ci.yml` and a cache copy of it
        # collide. The dotted read the suite really has, `.github/workflows/capture-host-ci.yml`, is
        # staged through `manifest_reads` instead, which keys on a DECLARED path rather than a basename.
        # ⚠️ THE PREMISE THIS EXCLUSION RESTED ON LAPSED ON 2026-10-21 and nothing re-checked it: the
        # comment here said the reader skips on `.exists()`, which `test_dev_requirements.py:65` still
        # does, while #3822 added `tests/test_relevance_filter.py` reading the same path unguarded. So
        # every scratch baseline died with FileNotFoundError and the gate refused a required context
        # (residue 2026-10-25-the-mutation-stager-drops-the-one-dotted-read-the-manifest-declares).
        if any(seg.startswith(".") for seg in parts):
            continue
        by_base[rel.rsplit("/", 1)[-1]].append(rel)
    index = {b: v[0] for b, v in by_base.items() if len(v) == 1}
    dups = {b for b, v in by_base.items() if len(v) > 1}
    return index, dups


# THE TRACED MANIFEST THE STAGER READS, and why two of its literals are duplicated here.
# `tools/root_reads.py` produces `tools/root-reads.json` from an audit-hook trace of the real suite, so
# it records a path the interpreter OPENED however the test spelled it. `root_reads` below records a
# path a test SPELLS. The two miss in opposite directions, so the stager takes their UNION. The producer
# owns these two strings and `test_the_manifest_literals_agree_with_their_producer` pins the pair —
# importing `tools.root_reads` here would pull a pytest plugin into the gate's own import graph.
ROOT_READS_MANIFEST = "tools/root-reads.json"
ROOT_READS_SCHEMA = "tepna.root-reads/1"


def manifest_reads(tree) -> list[str]:
    """The repo-root reads the TRACED manifest DECLARES, as repo-root-relative paths.

    🔴 A STATIC SCAN CANNOT SEE A CONSTRUCTED PATH, AND THAT COST A REQUIRED CHECK. `root_reads` keys on
    the literals a test spells, so on 2026-10-25 it named 34 of the 54 root paths the suite really opens.
    The 20 it missed are assembled from parts — every `*.src.html`, the four root apps, the seven CPAP
    EDF fixtures — plus `.github/workflows/capture-host-ci.yml`, which the basename index drops by its
    dot rule. #3822 added `tests/test_relevance_filter.py` on 2026-10-21 reading that workflow with no
    `.exists()` guard, so the baseline suite inside every scratch died with FileNotFoundError, mutmut
    recorded 0 tested mutants, and `mutate_diff` REFUSED. `mutation (diff-scoped)` is a required context
    in ruleset `protect-main`, so that refusal blocks the merge and no re-run clears it.

    Bounded exactly as the static half is: never an absolute path, never a `..`, never a self-reference
    under the tree's own directory, and the target must be a regular file inside the root.

    ⚠️ AN UNREADABLE MANIFEST CONTRIBUTES NOTHING, which is this same defect again, so the detector is a
    TEST rather than a guess here: `root_reads` must never raise (a raise takes the whole mutation gate
    down with it), and the real-suite population pin reds the moment the manifest stops contributing."""
    import json
    from pathlib import Path

    tree = Path(tree)
    root = tree.resolve().parent
    try:
        data = json.loads((tree / ROOT_READS_MANIFEST).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []  # absent or unparsable: the static half still runs, and the pin says so
    if not isinstance(data, dict) or data.get("schema") != ROOT_READS_SCHEMA:
        return []
    entries = data.get("paths")
    if not isinstance(entries, list):
        return []
    found: set[str] = set()
    for entry in entries:
        # Only a `paths` entry carries `path`; an EXCLUDED observation carries `token` instead, which is
        # the producer's own guard against a reader mistaking an argv token for a file (`hci0`).
        rel = entry.get("path") if isinstance(entry, dict) else None
        if not isinstance(rel, str) or not rel or rel.startswith("/") or ".." in rel:
            continue
        if rel.split("/", 1)[0] == tree.name:
            continue  # the tree IS the scratch copy, so its own files are not root reads
        try:
            target = (root / rel).resolve()
        except (OSError, ValueError):
            continue  # a DECLARED name that will not even resolve is not a file, and must not raise
        if target.is_file() and target.is_relative_to(root.resolve()):
            found.add(rel)
    return sorted(found)


def root_reads(tree) -> list[str]:
    """The REPO-ROOT files the test suite names — the reads the scratch copy cannot satisfy on its own.

    `tools/mutate.py` copies `capture-host/` ("copy EVERYTHING a test reads from disk") and nothing above
    it. A test that reads a sibling of `capture-host/` — `tests/test_seam_sidecar.py` opens
    `../ecgdex-dsp.js` for the seam-bound parity check — therefore fails inside the scratch with
    FileNotFoundError, the baseline reports "1 failed", and every mutant of that module comes back
    "0 tested". Measured 2026-09-19 on #2675: the four `writers.py` globs refused, and the SAME failure
    sits in #2581's log (the PR that added the test) — it passed only because the 0-tested refusal did
    not exist yet. Every writers.py PR since 09-16 has carried it.

    Keyed on WHAT is read, not on how the path is spelled (`test_mutation_hygiene.py` records why a
    path-idiom anchor is a losing game): a `.py` file under the tree that contains, as a string
    literal, either the NAME of a regular file in the repo root or a repo-relative PATH to one, is
    taken to read it. Over-flags by design — a literal that merely mentions the name costs one
    spurious copy of a small file; a miss costs a module's whole measurement. Derived from the tree
    every run, so a new root read needs no list edited.

    ⚠️ WIDENED 2026-09-22 (#2864), because the docstring above was BROADER THAN THE CODE in two
    independent ways, either of them fatal on its own:

      1. the candidate set was `root.iterdir()` filtered by `p.is_file()` — repo-root REGULAR FILES
         only. `uploads/synthetic_ecgdex_h10.txt` lives in a DIRECTORY, so no spelling of that literal
         in any test could ever have matched it;
      2. the scan was `(tree / "tests").glob("*.py")` — test files, non-recursive. That read is named
         in a HELPER module (`test_seal.py` calls `V.stage_night(...)`), so even a directory-aware
         version keyed on test files would still have missed it.

    Three conjunctive conditions — a literal, in a test file, naming a root-level regular file — were
    presented as one general rule. The result: the fixture was absent from the scratch, the test
    ERRORED at setup, `-x` aborted collection, and five globs recorded 0 tested mutants. The gate's
    0-tested refusal caught it ("a gate that cannot see must not report green"); without that refusal
    it is a silent green, as it was on #2581.

    ⚠️ The widening is bounded explicitly, because a PATH literal can reach further than a NAME:
    an absolute path, and any literal containing `..`, is never a candidate — the target must resolve
    to a regular file INSIDE the root. Over-flagging is kept; escaping the root is not.
    """
    from pathlib import Path

    tree = Path(tree)
    root = tree.resolve().parent
    # Dotfiles are never reads: in a git WORKTREE `.git` is a regular FILE (a gitdir pointer), and a
    # test that mentions ".git" would otherwise stage it into the scratch.
    names = {p.name for p in root.iterdir() if p.is_file() and not p.name.startswith(".")}
    # BASENAME → its one path, for files in SUBDIRECTORIES of the root. The read that broke #2864 is
    # assembled from parts — `UPLOADS = join(dirname(HERE), "uploads")` then `join(UPLOADS, n)` with
    # `n = "synthetic_ecgdex_h10.txt"` — so the full path is a literal NOWHERE and no path-matching
    # rule can see it. The basename IS a literal, and it is enough when it is UNIQUE.
    # AMBIGUOUS basenames are skipped, because staging the wrong `README.md` is worse than staging
    # none; `ambiguous_basenames` publishes them so the miss is a named set, not a silence.
    sub, dup = _subdir_index(root, tree.name)
    found: set[str] = set()
    # A VIRTUALENV INSIDE THE TREE IS NOT PART OF THE SUITE (residue 2026-09-25-root-reads-pin-scans-
    # an-in-tree-venv). `check.sh` resolves `.venv/bin/python` and this module's own refusal text tells
    # a contributor to create `capture-host/.venv` — and every string literal in that venv's
    # site-packages then landed here: `LICENSE`, `NOTICE`, `dex-badges.css`, a brief, seven spurious
    # "reads" that red the equality pin. ⚠️ #3097 explained the primary checkout's escape as "its
    # `.venv` is a SYMLINK, which rglob does not follow" — WRONG, measured 2026-09-26: that `.venv` is
    # a real directory of ~2.5k `.py` files, the pre-#3097 scan DID walk it, and the pin stayed green
    # only because none of those packages' literals happens to name a root file. A venv built from
    # today's requirements does (`NOTICE`, `package-lock.json` in a fresh worktree), so the exposure
    # is a property of what pip installed, never of the checkout's layout. Two rules, both already
    # precedents in this repo: a dot-directory is never scanned (`_subdir_index`'s fallback walk and
    # `find_unwired`'s `.venv` skip), and a directory carrying `pyvenv.cfg` is a venv whatever it is
    # called (`venv/`, `env/`), which the dot rule alone would miss.
    venv_dirs = {p.parent for p in tree.rglob("pyvenv.cfg")}
    # rglob, not glob("tests/*.py"): the read that broke #2864 is named in a HELPER module, and a
    # non-recursive scan of tests/ sees neither a helper beside the tests nor one a directory down.
    for t in sorted(tree.rglob("*.py")):
        rel_dirs = t.relative_to(tree).parts[:-1]
        if any(seg.startswith(".") for seg in rel_dirs) or any(v in t.parents for v in venv_dirs):
            continue
        # A PATH CAN VANISH BETWEEN THE LISTING AND THE READ, and this walk is long enough to lose the
        # race. `rglob` materialises names; the read happens later, and under xdist a SIBLING test's
        # transient directory can be gone by then — measured 2026-09-27 at worker gw1 on
        # `tests/_tripwire_clean_<pid>/test_clean.py`, which `test_capture_event_tripwire.py` creates and
        # removes in its own `finally`. That probe cannot move: it exists to spawn a pytest run which
        # must INHERIT `conftest.py`, the fixture it is testing.
        #
        # ∅ A FILE THAT DISAPPEARED IS NOT A FILE WHOSE CONTENTS ARE UNKNOWN — it is not a file, so it
        # names no read and is skipped rather than defaulted. Narrow on purpose: ONLY
        # FileNotFoundError. A file that exists and cannot be read is a real problem and must still
        # raise, because this census is a pinned EQUALITY and a swallowed read would silently shrink the
        # population it measures. Never widened to the allowlist either — staging a phantom read would
        # blunt the check it is meant to keep honest.
        try:
            text = t.read_text(encoding="utf-8", errors="replace")
        except FileNotFoundError:
            continue  # it is not a file any more, so it names no read — the paragraph above is why
        for lit in re.findall(r"""["']([^"'\n]+)["']""", text):
            if lit in names:
                found.add(lit)
                continue
            if lit in sub:
                found.add(sub[lit])
                continue
            # a repo-relative PATH into a subdirectory — the miss that cost #2864 its measurement
            if "/" not in lit or lit.startswith("/") or ".." in lit or lit.startswith("."):
                continue
            # A literal under the TREE's own directory is not a ROOT read: this function is defined as
            # "the reads the scratch copy cannot satisfy on its own", and the tree IS that copy, so
            # `capture-host/seal.py` already exists inside the scratch under its own name. Measured
            # 2026-09-22: without this the widened scan added 23 such self-references — noise that
            # would shadow the real reads in the plan's list rather than reveal them. This is the
            # function's own definition applied, NOT a carve-out for any particular directory.
            if lit.split("/", 1)[0] == tree.name:
                continue
            try:
                target = (root / lit).resolve()
                if target.is_file() and target.is_relative_to(root.resolve()):
                    found.add(lit)
            except (OSError, ValueError):
                continue  # an unresolvable literal is not a read, and never an exception
    return sorted(found)


def staged_root_reads(tree) -> list[str]:
    """THE SET THE STAGER COPIES: the static derivation above UNIONED with the traced manifest.

    🔴 THE UNION LIVES HERE AND NOT INSIDE `root_reads`, because the manifest is folded FROM
    `root_reads`. `tools/root_reads.py` classes every manifest entry as `traced`, `named` or both, and
    its `named_root_reads` reads that class straight out of `root_reads`. A `root_reads` that consumed
    the manifest would make `named` mean "present in the manifest", collapse the two classes into one,
    and leave `test_the_static_derivation_and_the_manifest_agree` — the tripwire that reds when a test
    newly NAMES a root file the manifest omits — true by construction and measuring nothing. The first
    cut of this fix put the union inside `root_reads`, and that test caught it (2026-10-25).

    So the producer keeps reading ONE instrument, and the consumer takes both.
    """
    return sorted(set(root_reads(tree)) | set(manifest_reads(tree)))


def tree_shadowed(tree, names) -> list[str]:
    """The staged names the TREE ITSELF already provides at the same relative path.

    🔴 FOR THESE, STAGING INTO THE COPY IS A SUBSTITUTION, NOT A SPARE COPY — and that is the one case
    `root_reads`' deliberate over-flagging is not cheap. Its docstring prices a stray mention at "one
    spurious copy of a small file", which holds while the staged name exists only in the repo root. It
    does not hold for a name that ALSO exists inside the tree: `copytree` has already put the tree's
    own file at `work/<name>`, and staging writes the ROOT file over it.

    Measured 2026-10-03 (#3245): there are two `tools/mutate-equivalence.json` — the JS ledger in the
    repo root (9 modules, 463 entries) and capture-host's own (33 modules, 642) — and six capture-host
    test files name the bare path in a literal or a DOCSTRING, so every scratch ran with the wrong
    ledger at `work/tools/mutate-equivalence.json`. It was invisible for as long as nothing inside the
    scratch read that file's CONTENTS; `test_equivalence_ledger.py`'s per-module count ratchet does, so
    it saw a ledger with no `solid_night_inputs.py` key at all, failed in the CLEAN-TEST pass, and
    `mutate_diff` refused the whole run with NOT_RUN — correctly, but about the staging and not about
    the diff. The pin in `test_mutation_scratch_reuse.py` records the belief this corrects: those
    entries were called "mentions, not reads: that test opens `tools/mutate-equivalence.json` (already
    staged)". It opens the CAPTURE-HOST one. Two files, one name.

    THE TREE'S OWN FILE WINS INSIDE THE TREE, because that is what the suite does OUTSIDE the gate: a
    test reads the ledger beside itself, and a scratch that answers differently is not a copy of the
    checkout. The `work/..` copy still happens — a genuine `tests/../..` read of a same-named ROOT file
    resolves there, so refusing both would trade this defect for #2864's.

    Same shape as `_subdir_index`'s ambiguous-basename rule one level earlier ("staging the wrong
    README.md is worse than staging none") and as the stats cache in #3251: two different things
    sharing one name, which is the error this suite keeps paying for."""
    from pathlib import Path

    tree = Path(tree)
    return sorted({name for name in names if (tree / name).is_file()})


def stage_root_reads(tree, work, names) -> int:
    """Copy each root file in `names` to BOTH places a `tests/../..`-shaped read resolves from: `work/`
    (the mutants run executes `work/mutants/tests/`, whose grandparent's parent is `work/`) and
    `work/..` (the clean baseline executes `work/tests/`). Returns copies made. A name that is not a
    regular file in the root is skipped, never fabricated — the read will then fail exactly as it
    would in the tree, which is the honest outcome.

    A name `tree_shadowed` names is staged to `work/..` ONLY: see that function for why the tree's own
    file must survive inside the tree."""
    import shutil
    from pathlib import Path

    tree = Path(tree)
    work = Path(work)
    root = tree.resolve().parent
    shadowed = set(tree_shadowed(tree, names))
    n = 0
    for name in names:
        src = root / name
        if not src.is_file():
            continue
        dests = (work.parent,) if name in shadowed else (work, work.parent)
        for dest in dests:
            # `name` may now be a repo-relative PATH (`uploads/x.txt`), so the SUBDIRECTORY has to
            # exist at the destination or the copy fails — a read staged into a missing parent is as
            # absent as no copy at all, and it would fail the same way (#2864).
            out = dest / name
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, out)
            n += 1
    return n


def stage_capture_host_view(work) -> list[str]:
    """Make the scratch answer to a `capture-host/`-prefixed path. Returns the links it created.

    🔴 THE SCRATCH IS A FLATTENED REPO, AND A STAGED ROOT TOOL RESOLVES BACK DOWN INTO `capture-host/`.
    `stage_root_reads` puts a repo-root read at BOTH levels a `tests/../..`-shaped read can resolve
    from, which fixes the read UP. The read back DOWN had no answer: `tools/verify-seals.mjs`, staged
    as a root read, resolves its vectors as `join(HERE, '..', 'capture-host', 'tests', 'vectors',
    'tepna-seal-1')`, and in the scratch `HERE/..` holds no `capture-host` at all.

    Measured 2026-10-12 on drain batch 9 (`verdict.py`): the stats run reached
    `test_the_vector_selftest_emits_a_PASS_verdict_on_stdout_and_prose_on_stderr`, node refused with
    ENOENT on `work/capture-host/tests/vectors/tepna-seal-1/expected.json`, mutmut's run stopped at the
    first failure, BOTH `verdict.py` globs recorded 0 tested mutants, and `mutate_diff` refused the
    whole diff. It bites only when the mutated module's covering set names `tests/test_seal.py`, which
    is why narrower modules never met it.

    A symlink rather than a copy, so the two views can never drift: `work/capture-host -> .` serves the
    MUTANTS run (its tests sit at `work/mutants/tests`, so the verifier they name is `work/tools/…`),
    and `<scratch>/capture-host -> work` serves the CLEAN BASELINE (tests at `work/tests`, verifier
    `<scratch>/tools/…`). The pair mirrors `stage_root_reads`'s two destinations exactly.

    An existing entry that is NOT a symlink is left alone — a real directory there is somebody else's
    file, and clobbering it is worse than the read failing. A symlink pointing elsewhere is re-pointed,
    because a reused scratch must not keep a stale view.
    """
    work = pathlib.Path(work)
    made: list[str] = []
    for parent, target in ((work, "."), (work.parent, work.name)):
        link = parent / "capture-host"
        if link.is_symlink():
            if link.readlink().as_posix() == target:
                continue
            link.unlink()
        elif link.exists():
            continue
        link.symlink_to(target, target_is_directory=True)
        made.append(str(link))
    return made


# Every line `mutmut results` prints is a mutant that was NOT killed — that is mutmut's own contract,
# not an enumeration of ours: `results()` walks `exit_code_by_key` and does
# `if status == "killed" and not all: continue`. So the listing is exactly the non-killed set.
#
# The gate used to keep only `": survived"` lines and drop the rest, on a comment claiming the listing
# held "survivors and not-checked ONLY". It does not. `status_by_exit_code` maps at least
# `survived · timeout · suspicious · skipped · no tests · not checked · caught by type check ·
# check was interrupted by user`, and its DEFAULT is `suspicious`, so any exit code nobody has seen
# lands there too. Two false verdicts followed: a mutant that timed out under load vanished from the
# listing entirely, and the gate then reported "every mutant on the changed functions was killed"
# about a mutant no test ever saw; and `classify`'s REFUTED, derived as generated-but-not-survived,
# turned a correct equivalence entry whose mutant timed out into "a distinguishing input exists" —
# an instruction to delete a right answer.
#
# INVERTED rather than enumerated, deliberately. Listing the statuses we know would silently ignore
# the next one mutmut adds; asking "is this line a survivor, and if not it is UNDECIDED" fails closed
# on a status nobody has met. UNDECIDED is never `killed` and never refutes an equivalence entry.
UNDECIDED: Final = "undecided"
SURVIVED: Final = "survived"
KILLED: Final = "killed"


class _SplitResults(TypedDict):
    """The shape `split_results` returns, per its docstring: survivors and killed are bare
    names; undecided keeps `(name, status)` pairs so a report can say WHICH kind of undecided."""

    survived: list[str]
    undecided: list[tuple[str, str]]
    killed: list[str]


def clean_run_failures(text: str) -> list[str]:
    """The tests mutmut's OWN clean baseline failed on, read off its streamed output — `[]` when the
    text carries no clean-run failure at all.

    mutmut runs the covering set once before any mutant ("clean test"); if that run fails it prints
    pytest's report and then `Failed to run clean test`, generates the mutants and tests NONE of them,
    so the glob records 0 tested and the gate refuses. The refusal then reads "REFUSED" about a change
    the gate never examined, on a test that is not about the change — CLAUDE.md §4b's shape, residue
    `2026-09-09-alert-poller-test-order-dependent`. The failing test's name is in the output the whole
    time (`FAILED tests/x.py::test_y - AssertionError…`, or `ERROR tests/x.py::test_y` when a fixture
    errored at setup); this reads it out so the refusal can NAME the test and say whose failure it is.

    Pure over text. Returns the `<path>::<test>` ids in order of appearance, de-duplicated (pytest
    prints a FAILED line in the summary and again in `-x`'s stop banner); only lines that begin with
    the pytest summary tokens count, so a docstring quoting "FAILED" is not a failure."""
    if "Failed to run clean test" not in text:
        return []
    out: list[str] = []
    for line in text.splitlines():
        m = re.match(r"^(?:FAILED|ERROR) (tests/\S+?::\S+?)(?: - .*)?$", line.strip())
        if m and m.group(1) not in out:
            out.append(m.group(1))
    return out


def classify_results_line(line: str):
    """`(name, SURVIVED|UNDECIDED, status_word)` for one `mutmut results` line, or None if it is not
    a result line at all (mutmut interleaves headers and blank lines).

    The status word is kept so a report can say WHICH kind of undecided it was — "timeout" and
    "no tests" want different responses from a reader, and collapsing them to one bucket for the
    VERDICT does not mean collapsing them in the OUTPUT."""
    if ":" not in line:
        return None
    name, _, rest = line.partition(":")
    name = name.strip()
    status = rest.strip()
    if not name or not status or " " in name:
        return None
    # `killed` only appears under `mutmut results --all`; the gate does not pass it, but classifying a
    # killed mutant as UNDECIDED would turn a clean run into a refusal, so it is handled rather than
    # assumed away.
    if status == "killed":
        return (name, KILLED, status)
    return (name, SURVIVED if status == "survived" else UNDECIDED, status)


def function_of_mutant(name: str) -> str:
    """The FUNCTION a mutant belongs to, from its mutmut name — `""` when it cannot be read.

    ⚠️ WHY THIS EXISTS: the UNDECIDED refusal reports a TOTAL and samples six names. With 116
    undecided you learn six mutants and "and 110 more", which cannot distinguish the two cases that
    need opposite responses — ALL of them in one pathological function (look at that function), versus
    spread across several (look at the runner). That is the measurement that decides whether the
    remedy is scheduling or something in the mutants themselves, and the data was already present in
    every name; only the summary was missing.

    Two shapes, and both are real — the method form is the one a column-0 assumption keeps missing:
        x__floor_by_t__mutmut_12        → `_floor_by_t`     (module-level function)
        xǁCounterǁscaled__mutmut_2      → `Counter.scaled`  (method, U+0281 separators)

    Returns "" rather than guessing on anything else. A wrong attribution here would send a reader to
    the wrong function, which is worse than declining to name one.
    """
    if not name:
        return ""
    stem = re.sub(r"__mutmut_\d+$", "", name.strip())
    if stem == name.strip():
        return ""  # no mutmut suffix ⇒ not a mutant name
    # 🔴 STRIP THE MODULE QUALIFIER, and this line is why the whole function was inert in production.
    # `mutmut results` prints names MODULE-QUALIFIED — `gattmap.x__norm__mutmut_1` — and the caller
    # (`mutate_diff.py`) passes them through verbatim from `split_results`. Both documented shapes
    # below are BARE, the tests were written from those examples, and nothing ever fed this the form
    # it actually receives. So `x_`/`ǁ` never matched, every mutant grouped under `?`, and the
    # `by function` summary has reported nothing since it shipped — while its own test stayed green.
    # Measured 2026-09-19 on a real refusal: 166 undecided, `by function: 166 ?`, zero attributed.
    #
    # `rsplit` on the LAST dot is the conservative read: a dotted prefix can only be a module path
    # (`pkg.mod.x_f`), because the METHOD form separates with `ǁ` and not with `.` — the dots in
    # `Counter.scaled` are produced by the join BELOW, never present in the input.
    stem = stem.rsplit(".", 1)[-1]
    if "ǁ" in stem:
        parts = [p for p in stem.split("ǁ") if p and p != "x"]
        return ".".join(parts) if parts else ""
    return stem[2:] if stem.startswith("x_") and len(stem) > 2 else ""


def undecided_by_function(items: list[dict]) -> list[tuple[str, int]]:
    """`[(function, count)]` for an UNDECIDED list, commonest first, then alphabetical.

    Unattributable mutants are grouped under `?` rather than dropped: a summary that silently omits
    what it could not parse under-reports the total it is summarising, which is the shape this file
    keeps finding elsewhere.
    """
    counts: dict[str, int] = {}
    for it in items or []:
        fn = function_of_mutant(str(it.get("mutant", ""))) or "?"
        counts[fn] = counts.get(fn, 0) + 1
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))


def in_glob_scope(mutant: str, glob: str) -> bool:
    """True when `mutant` is one of the mutants `glob` selects.

    WHY THIS EXISTS. The gate scopes what it RUNS to the functions the diff touched — one
    `--only '<module>.x_<func>__mutmut_*'` per changed function (`mutate_diff.py`, `functions_covering`
    over the changed lines). It then harvested UNDECIDED from `mutmut results`, which takes **no glob**
    (`tools/mutate.py`) and enumerates the WHOLE workspace. So every mutant generated for a function
    the diff never touched came back `not checked` and BLOCKED the run.

    Measured 2026-09-19 across four refusals: 553, 338, 166 and 116 undecided, **100 % `not checked`
    and 0 % `timeout`** — they were never run, so nothing could time out. On #2651 the changed hunks
    were in `dbus_hci`/`resolve_hci` and the undecided set contained `parse_rssi`, which appears in
    zero changed hunks. The counts track MODULE size, not diff size, which is why a one-import PR
    produced 166 and why "re-run under less load" could never help: load was never the variable.

    Deliberately `fnmatchcase`: mutant names are generated identifiers, and a case-insensitive match
    would let `x_Parse__mutmut_1` answer for `x_parse__mutmut_*` on a case-preserving filesystem.
    """
    return fnmatch.fnmatchcase(str(mutant), str(glob))


def split_results(results_text: str) -> _SplitResults:
    """`{"survived": [...], "undecided": [(name, status), ...]}` over a whole `mutmut results` blob.

    A caller must treat `undecided` as NOT KILLED: it is the set the run could not settle, so a gate
    that reports green while it is non-empty is reporting about mutants it never saw."""
    out: _SplitResults = {SURVIVED: [], UNDECIDED: [], KILLED: []}
    for line in (results_text or "").splitlines():
        got = classify_results_line(line)
        if got is None:
            continue
        name, bucket, status = got
        if bucket == SURVIVED:
            out[SURVIVED].append(name)
        elif bucket == KILLED:
            out[KILLED].append(name)
        else:
            out[UNDECIDED].append((name, status))
    return out


# ── A TIMEOUT IS THE ONE UNDECIDED STATUS A WIDER BOUND CAN SETTLE ───────────────────────────────
#
# mutmut bounds each mutant at `(the covering tests' BASELINE durations + timeout_constant) *
# timeout_multiplier` (`mutmut/workers/isolation.py:875`). The baseline runs the UNMUTATED code, so a
# wait only a MUTANT can lengthen never enters the bound that judges it. The gate then reports that
# mutant UNDECIDED and refuses — over a mutant its own tests do catch, 0.01 s after the bound expired
# (residue `2026-10-19-a-mutant-whose-cost-is-a-wait-spends-its-own-bound`).
#
# Only `timeout` is retryable, and that is a statement about CAUSE rather than a convenience. The other
# undecided statuses say the mutant was never run (`no tests`, `not checked`), was skipped, or landed
# on an exit code nobody has mapped (`suspicious`) — a wider clock measures nothing new about any of
# them, so they stay undecided and keep blocking.
BOUND_TIMEOUT = "timeout"


def timed_out_in_scope(results_text: str, glob: str) -> list[str]:
    """The in-scope mutants a run could not settle BECAUSE THE CLOCK RAN OUT, in listing order.

    `mutmut results` takes no glob and enumerates the whole workspace, so the scope filter is the same
    one the survivor and undecided harvests use — without it a function the diff never touched would
    hand this list mutants nobody asked about."""
    seen: list[str] = []
    for name, status in split_results(results_text)[UNDECIDED]:
        if status == BOUND_TIMEOUT and in_glob_scope(name, glob) and name not in seen:
            seen.append(name)
    return seen


def retry_outcome(before: list[str], after: list[str]) -> dict:
    """What a re-run under a wider bound settled: `{retried, settled, stillTimingOut, newlyTimingOut}`.

    🔴 `settled` IS NOT `killed`. A mutant the wider bound settles may be killed OR surviving, and a
    survivor is blocking — so the caller harvests the SECOND run's results through the ordinary
    survivor path rather than reading a kill out of this function. The sibling prober taught the
    general form: never predict which way a re-measurement will read (#3729).

    `newlyTimingOut` exists because `after` is not guaranteed to be a subset of `before`: the retry
    re-runs the reset timeouts, and the listing it parses still covers the whole workspace, so a
    mutant that timed out only on the second pass must be REPORTED rather than dropped. A gate that
    forgets it would turn a fresh timeout into a silent pass."""
    before_set, after_set = set(before), set(after)
    return {
        "retried": len(before),
        "settled": [n for n in before if n not in after_set],
        "stillTimingOut": [n for n in before if n in after_set],
        "newlyTimingOut": [n for n in after if n not in before_set],
    }


def report_only_refusal_note(report_only: bool) -> str:
    """The one line that makes a refusal under --report-only read as what it is.

    `--report-only` means "never exit non-zero"; it does NOT mean "advisory". Without the flag the
    gate exits 2 at a refusal and prints nothing after it, so the refusal is unmistakably the
    verdict. With the flag the run used to continue into the survivor report and emit a SECOND
    VERDICT line — and six ~10-minute local runs were spent on 2026-09-26 by a reader who took the
    last VERDICT line (the survivor one) as the answer. Under --report-only the refusal is printed
    FIRST, marked BLOCKING in the same words the gating mode uses, and the survivor report that
    follows is labelled informational; only ONE VERDICT line is emitted per run."""
    if not report_only:
        return ""
    return (
        "  ⛔ BLOCKING — without --report-only this run exits 2 HERE and prints nothing further. The\n"
        "  survivor report below is INFORMATIONAL; this refusal IS the run's verdict (UNKNOWN)."
    )
