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
import re

__all__ = ["GATE_BUDGET_SEC", "PREWORK_TRACE_FACTOR", "prework_estimate", "budget_refusal", "verdict_object", "VERDICT_STATUSES", "EXCUSING", "functions_covering", "changed_span", "is_string_only", "diff_key", "mutant_changed_lines", "float_boundary_unprobed",
           "annotation_only", "classify", "refusal_reason", "selftest", "string_only_verdict", "scan_is_reliable",
           "clean_run_failures",
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
            return ""          # mutmut's own exemption: trampolines are easy for these
        return names[0]
    return ""


def _decorator_name(node: ast.expr) -> str:
    """`@foo` / `@a.foo` / `@foo(...)` → `foo`. The call form matters: `@lru_cache()` is decorated."""
    if isinstance(node, ast.Call):
        node = node.func
    if isinstance(node, ast.Name):
        return node.id
    return getattr(node, "attr", "")


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
                continue                                     # an escaped brace: text, no state to keep
            for k, ch in enumerate(tok, m.start()):          # a doubled brace INSIDE a field is two braces
                if ch == "{":
                    depth += 1
                    if depth == 1:
                        spans.append((k, b))                 # provisional: runs to the literal's end
                elif ch == "}" and depth:
                    depth -= 1
                    if depth == 0:
                        spans[-1] = (spans[-1][0], k + 1)    # closed: braces included
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
                a < new_end and start < b for a, b in _fstring_expr_spans(new)):
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
    keep = [ln for ln in diff_text.splitlines()
            if ln.startswith(("-", "+")) and not ln.startswith(("---", "+++"))]
    return " | ".join(" ".join(ln.split()) for ln in keep)


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
    return ("a `<`/`<=` flip on the float threshold " + ", ".join("`%s`" % x for x in shown) +
            " is distinguishable only where the compared value lands EXACTLY on it; the probe does not "
            "name that boundary, so this is UNPROVEN rather than equivalent")


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
        return [seg.strip() for seg in changed.split(" | ") if seg.strip()]
    return [ln for ln in (sv.get("diff") or "").splitlines()
            if ln.startswith(("-", "+")) and not ln.startswith(("---", "+++"))]


def classify(entries, survivors, generated):
    """Split survivors against the recorded classification.

    PURE, so `--selftest` can pin it without running a sweep. `survivors` are dicts carrying `key`;
    `generated` is the set of keys mutmut produced this run (survivors are generated by definition,
    so callers may pass only the killed ones)."""
    surv = {sv["key"]: sv for sv in survivors}
    gen = set(generated) | set(surv)
    out = {"excused": [], "real_gap": [], "refuted": [], "orphaned": [], "unclassified": [], "unproven": []}
    claimed = set()
    for e in entries or []:
        k = e.get("key", "")
        claimed.add(k)
        if k not in gen:
            out["orphaned"].append(e)      # the line moved — excuses nothing until re-verified
        elif k not in surv:
            out["refuted"].append(e)       # generated, then KILLED, yet claimed unkillable
        elif e.get("class") in EXCUSING:
            _why = float_boundary_unprobed(k, e.get("probe"))
            if _why:
                out["unproven"].append(dict(e, why=_why))
            else:
                out["excused"].append(e)
        else:
            out["real_gap"].append(e)      # recorded debt, still fails
    for k, sv in surv.items():
        if k not in claimed:
            out["unclassified"].append(sv)
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
#   · PRE-WORK: the clean run is timed ONCE per module and the predicted pre-work
#     (clean × (1 + TRACE_FACTOR)) must fit in what is left of the gate budget, or the module is
#     refused BEFORE any mutant is generated, naming the module, its clean time and the prediction.
#   · WALL: every mutmut invocation gets the REMAINING budget as its cap; a cap that is hit returns
#     partial counts behind `timed_out`, and the gate refuses on it naming the glob and how far it got.
GATE_BUDGET_SEC = 7200          # 2 h of gate wall time. Pre-stated: no mutation job in the visible history
                                # produced a verdict past 98 min; the workflow cap sits above this so the
                                # tool refuses before the runner kills it.
PREWORK_TRACE_FACTOR = 2.0      # ASSUMPTION, stated: mutmut's stats pass ≈ 2× one clean run of the
                                # selection (a traced run). Replace with a measured factor when one exists;
                                # the refusal prints the clean time it multiplied so the reader can check.


def prework_estimate(clean_sec: float, trace_factor: float = PREWORK_TRACE_FACTOR) -> float:
    """Seconds a module costs BEFORE its first mutant is tested: one clean run (already spent when this
    is called — it is what measured `clean_sec`) plus the traced stats pass."""
    return clean_sec * (1.0 + trace_factor)


def budget_refusal(module: str, clean_sec: float, n_globs: int, left_sec: float,
                   trace_factor: float = PREWORK_TRACE_FACTOR) -> str | None:
    """A refusal reason when the module's predicted pre-work does not fit in what is left, else None.
    Names every number it used, so the reader can re-derive the verdict — never just "too big"."""
    est = prework_estimate(clean_sec, trace_factor)
    if est <= left_sec:
        return None
    return (f"{module}: predicted pre-work {est:.0f}s (clean run {clean_sec:.1f}s × (1 + {trace_factor:g}) "
            f"stats pass) exceeds the {left_sec:.0f}s left of the {GATE_BUDGET_SEC}s gate budget — "
            f"{n_globs} function(s) selected, none mutated. This is a REFUSAL with a reason, not a "
            f"verdict on the diff: the module's test selection is too costly to mutate in one gate run. "
            f"Scope the change, or run `tools/mutate.py --only` locally on the function(s).")


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


def verdict_object(status: str, *, checked: int, eligible: int, result: dict | None, reason: str | None,
                   evidence: list[str], commit: str | None, at: str, base: str) -> dict:
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
    # An f-string's `{...}` fields are CODE (mutmut mutates them as code and generates no text mutant
    # for an f-string at all — measured 2026-09-26); a mutant inside one is REQUIRED, never excluded.
    if is_string_only(_d('    x = f"{a(y)}-{y + 1}"', '    x = f"{a(None)}-{y + 1}"')):
        print("  selftest FAIL: a mutant inside an f-string field is hidden as string-only")
        ok = False
    if not is_string_only(_d('    x = f"started {n}"', '    x = f"begun {n}"')):
        print("  selftest FAIL: an f-string's TEXT is no longer string-only")
        ok = False
    if _fstring_expr_spans('f"{a(y)}-{y + 1}"') != [(2, 8), (9, 16)]:
        print("  selftest FAIL: _fstring_expr_spans mislocates the fields")
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

    # ── annotation_only: signatures may be re-annotated; behaviour may not ─────────────────────
    # Expected-PASS plants included deliberately (a rail probed only with expected-rejects ships
    # over-rejecting forever); each case asserts the REASON branch too, so a vacuous equality can
    # never wear the right verdict (saw-the-plant, both fields).
    _AO = [
        # (old, new, want_excluded, want_reason_substr, label)
        ("def f(x: float): return x", "def f(x: float | None): return x",
         True, "stripped ASTs identical", "widen an arg annotation"),
        ("def f(x): return x", "def f(x) -> int: return x",
         True, "stripped ASTs identical", "add a return annotation"),
        ("async def g(a: int, *, b: str = 'q'): pass", "async def g(a: object, *, b: str = 'q'): pass",
         True, "stripped ASTs identical", "async + kwonly annotations"),
        ("def f(x: int = 1): return x", "def f(x: int = 2): return x",
         False, "behavioural difference", "a default is behaviour"),
        ("def f(x: int): return x", "def f(y: int): return y",
         False, "behavioural difference", "a rename is behaviour"),
        ("def f(x: int): return x", "def f(x: int): return x + 1",
         False, "behavioural difference", "a body edit is behaviour"),
        ("class C:\n    x: int = 1", "class C:\n    x: float = 1",
         False, "behavioural difference", "class-body AnnAssign is load-bearing (dataclass/ClassVar)"),
        ("def f(x: int): return x", "def f(x: int) return x",
         False, "parse failed", "unparseable fails closed to full scope"),
    ]
    for old_src, new_src, want_x, want_r, label in _AO:
        got_x, got_r = annotation_only(old_src, new_src)
        if got_x != want_x or want_r not in got_r:
            print(f"  selftest FAIL annotation_only [{label}]: ({got_x}, {got_r!r})")
            ok = False

    return 0 if ok else 1


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
        # DOT SEGMENTS STAY OUT, matching the root-level rule above. `.github/workflows/capture-host-ci.yml`
        # IS a genuine read — test_dev_requirements.py reaches it through a root anchor — but staging it
        # would make a test that has never executed inside a scratch start executing there, which is a
        # behaviour change this widening should not smuggle in. Recorded as residue instead; the test
        # skips on `.exists()` today, which is why nobody has noticed it.
        if any(seg.startswith(".") for seg in parts):
            continue
        by_base[rel.rsplit("/", 1)[-1]].append(rel)
    index = {b: v[0] for b, v in by_base.items() if len(v) == 1}
    dups = {b for b, v in by_base.items() if len(v) > 1}
    return index, dups


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
        for lit in re.findall(r"""["']([^"'\n]+)["']""", t.read_text(encoding="utf-8", errors="replace")):
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


def stage_root_reads(tree, work, names) -> int:
    """Copy each root file in `names` to BOTH places a `tests/../..`-shaped read resolves from: `work/`
    (the mutants run executes `work/mutants/tests/`, whose grandparent's parent is `work/`) and
    `work/..` (the clean baseline executes `work/tests/`). Returns copies made. A name that is not a
    regular file in the root is skipped, never fabricated — the read will then fail exactly as it
    would in the tree, which is the honest outcome."""
    import shutil
    from pathlib import Path

    tree = Path(tree); work = Path(work)
    root = tree.resolve().parent
    n = 0
    for name in names:
        src = root / name
        if not src.is_file():
            continue
        for dest in (work, work.parent):
            # `name` may now be a repo-relative PATH (`uploads/x.txt`), so the SUBDIRECTORY has to
            # exist at the destination or the copy fails — a read staged into a missing parent is as
            # absent as no copy at all, and it would fail the same way (#2864).
            out = dest / name
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, out)
            n += 1
    return n


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
UNDECIDED = "undecided"
SURVIVED = "survived"
KILLED = "killed"


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
        return ""                      # no mutmut suffix ⇒ not a mutant name
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


def split_results(results_text: str):
    """`{"survived": [...], "undecided": [(name, status), ...]}` over a whole `mutmut results` blob.

    A caller must treat `undecided` as NOT KILLED: it is the set the run could not settle, so a gate
    that reports green while it is non-empty is reporting about mutants it never saw."""
    out: dict[str, list[str]] = {SURVIVED: [], UNDECIDED: [], KILLED: []}
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
