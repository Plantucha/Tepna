# tepna-capture — mutation_triage.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The DECISION LOGIC behind `tools/mutate_triage.py`, split out so it sits inside the coverage floor.

WHY IT LIVES HERE AND NOT IN tools/. `tools/` is outside the coverage denominator
(`pyproject.toml [tool.coverage.run] source`), so nothing under it is gated — which is fine for
`glob`/`subprocess`/`argparse` plumbing and NOT fine for this. The logic here decides whether a
surviving mutant is worth a human's time or is impossible to kill, and a wrong bucket does real harm
in both directions: it sends someone chasing a target that cannot be reached, or it dismisses a real
defect as noise. That is exactly the kind of logic a 100 % floor exists to hold, so it is here where
the floor applies, and the plumbing stays in `tools/` where it does not.

The split is deliberate and partial. `tools/mutate_triage.py` remains UNCOVERED by design; this is not
an oversight to be "finished" later. What lives there is now exactly `glob`/`subprocess`/`argparse`/IO
— it imports neither `ast` nor `re`, which is a checkable statement of the boundary rather than a
claimed one.

⚠️ THE CRITERION IS "CAN IT SILENTLY MISLEAD", NOT "IS IT SHORT". On 2026-08-27 the mutant-name and
diff-position helpers were written into `tools/` because they felt like plumbing. They are not: one
read the python BINARY instead of the module, the other mangled two of the three real mutant-name
shapes, and together they produced a MEASURED DELTA OF ZERO that looked like a clean negative result.
Nothing was covering them, so nothing said so. They were moved up here and are now 100 % gated.
"""
from __future__ import annotations

import ast
import os.path
import re

__all__ = ["classify", "ceiling", "concentration", "message_call_lines", "REACHABLE", "PROSE",
           "UNOBSERVABLE", "EQUIVALENT", "in_message_call", "hunk_lineno", "function_start_line",
           "file_lineno_of", "func_of_mutant", "module_source_path"]

REACHABLE = "REACHABLE"
PROSE = "PROSE"
UNOBSERVABLE = "UNOBSERVABLE"
EQUIVALENT = "EQUIVALENT?"

_STR = re.compile(r"""(['"]).*?\1""", re.S)
_MSG = re.compile(r"(print|log|logger|_log|sys\.stderr\.write)\b")
_FLUSH = re.compile(r"flush\s*=\s*\w+")
_XX = re.compile(r'"XX|XX"|\'XX|XX\'')
_LOST_ARG = re.compile(r"\(\s*None|=\s*None|,\s*\)")


def _strip_strings(s: str) -> str:
    return _STR.sub("STR", s)


# `log.warning("%s %s → %s", name,` spans several lines, and `classify` is handed ONE of them. A
# continuation line — `pmd.CTRL_STATUS.get(st, hex(st)))` — carries no `log.` to match, so `_MSG` says
# no and the mutant reads as a code change. Measured on run_polar 2026-08-08: of 560 REACHABLE
# survivors, ~150 were message arguments and most of them sat on continuation lines, inflating the
# work-list by a quarter. A line cannot answer this about itself; the enclosing CALL can.
_MSG_FUNCS = frozenset({"print", "log", "logger", "_log", "warn", "warning", "info", "debug",
                        "error", "exception", "critical", "write"})


def _callee_names(fn: ast.expr) -> list[str]:
    out = []
    while isinstance(fn, ast.Attribute):
        out.append(fn.attr)
        fn = fn.value
    if isinstance(fn, ast.Name):
        out.append(fn.id)
    return out


def message_call_lines(source: str) -> frozenset[int]:
    """1-indexed line numbers that lie inside a log/print CALL, continuation lines included.

    Parsed, never grepped. A regex over lines cannot tell `log.info("...", x,` from a dict literal that
    merely mentions `info`, and it cannot see that line 1832 belongs to a call opened on 1830.

    Fails CLOSED: unparseable source yields the empty set, so every line is judged on its own merits
    and nothing is silently downgraded to PROSE. The opposite default would let a syntax error mark a
    whole module unkillable — which is the shape of failure this tool exists to prevent."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return frozenset()

    # A LOGGER METHOD BOUND TO A LOCAL is still a logger. capture.py picks the level first and calls it
    # second, so the call site reads `_lvl(...)` and matches nothing:
    #     _lvl = (log.warning if not (pmd.is_started(st) or transient)
    #             else log.debug if transient and name in _CHARGING else log.info)
    #     _lvl("%s START %s (%s) → %s", name, pmd.MEAS_NAME.get(meas, meas), how, ...)
    # Nineteen run_polar mutants sat on those two statements. The alias is taken ONLY from an assignment
    # whose value really is an attribute of a logger — inferred from the code, never from the name, so
    # a local that merely happens to be called `_lvl` is not swept in.
    aliases: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(sub, ast.Attribute) and _callee_names(sub)[-1:] in (["log"], ["logger"], ["_log"])
                   for sub in ast.walk(node.value)):
            continue
        aliases.update(t.id for t in node.targets if isinstance(t, ast.Name))

    lines: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        names = _callee_names(node.func)
        # `log.warning(...)` -> ['warning', 'log']; `print(...)` -> ['print']. Require the LOGGER, not
        # just the level name, so `d.get("info")` and `self.write(buf)` are not swept in.
        if not names:
            continue
        base = names[-1]
        if (base in ("log", "logger", "_log", "print") or base in aliases
                or (base == "sys" and "write" in names)):
            lines.update(range(node.lineno, (node.end_lineno or node.lineno) + 1))
    return frozenset(lines)


def classify(minus: str, plus: str, *, in_message_call: bool = False) -> tuple[str, str]:
    """One mutant's `-` and `+` lines -> (bucket, why).

    ORDER MATTERS: the unobservable forms are tested before the general ones, because each is a
    SPECIAL CASE of a change that would otherwise look reachable.

    `in_message_call` is trailing, optional and keyword-only (CLAUDE.md's back-compat rule): callers
    that have the source pass `lineno in message_call_lines(src)` so a CONTINUATION line of a
    multi-line `log.info(...)` is judged as what it is. Callers that don't keep the old behaviour.

    ⚠️ A MESSAGE CALL'S ARGUMENTS ARE PROSE (decided 2026-08-08, owner). This used to return REACHABLE
    with the rationale "assert the message names its value (`ts in out`), which survives any rewording
    and dies on the drop". That reasoning is sound in the small and wrong at scale. It was measured on
    `run_polar`: ~150 of 560 REACHABLE survivors were message arguments — a quarter of a work-list that
    is supposed to say what is worth a human's time. Killing them means asserting that specific values
    appear in specific log lines, which pins operator-facing wording across the daemon and reds the
    build on every message edit — the same cost §5 of CAPTURE-HOST-MUTATION-FLEET already refuses to
    pay for `flush=`/`XX`-wrapping, and the same failure mode as a gate nobody dares change.

    This is a deliberate LOWERING of the stated ceiling, not a hidden one. PROSE is reported in its own
    column and `ceiling()` still subtracts only UNOBSERVABLE, so a reader sees exactly how much was set
    aside and can disagree. The rule it encodes: a mutation that can only be caught by asserting on
    words a human reads is not a defect the suite should own.

    NOT covered by this, and still REACHABLE on purpose: a message call whose mutation escapes the
    message — a lost `%` operand that raises, an argument that changes control flow, anything the
    `same_code` and message tests below do not both accept.
    """
    a, b = minus.strip(), plus.strip()
    if a == b:
        return EQUIVALENT, "identical after normalisation"

    # The largest unobservable family, and the one that broke a hand estimate on 2026-08-04: 30 of
    # pull_session's survivors differ only in `flush=`. capsys/capfd read the buffer regardless, so
    # True / False / None produce identical captured output and no assertion on it can tell them apart.
    if _FLUSH.sub("F", a) == _FLUSH.sub("F", b):
        return UNOBSERVABLE, "differs only in flush= — captured output is identical"

    # mutmut wraps a string literal as "XXtextXX" and flips its case. Both are killable ONLY by
    # asserting the exact text, which pins wording and reds the build on every message edit.
    if _XX.search(b):
        return UNOBSERVABLE, "XX-wrapped literal — needs exact-text assertion"
    if a.lower() == b.lower():
        return UNOBSERVABLE, "case flip only — needs exact-text assertion"

    same_code = _strip_strings(a) == _strip_strings(b)
    is_msg = in_message_call or _MSG.match(a) is not None

    if same_code:
        return PROSE, ("log/print wording only, interpolated values intact" if is_msg
                       else "string literal only, surrounding code unchanged")

    if is_msg and _LOST_ARG.search(b):
        return PROSE, "message call lost an argument — killable only by asserting the wording"
    if is_msg:
        return PROSE, "message call changed structurally — killable only by asserting the wording"
    return REACHABLE, "code change"


def ceiling(total: int, survived: int, timeouts: int, unobservable: int, reachable: int) -> dict:
    """The three numbers a triage report must give together.

    A kill rate alone invites a target that may be arithmetically impossible: `pull_session` was aimed
    at 90 % when its ceiling is 89.1 %. `total` must be mutmut's own count, not `killed + survived` —
    timeouts are neither, and folding them in silently inflates the denominator's complement.
    """
    if total <= 0:
        raise ValueError("total must be positive — a rate over an empty denominator is not a rate")
    if survived + timeouts > total:
        raise ValueError("survived + timeouts exceeds total — mismatched runs?")
    killed = total - survived - timeouts
    return {
        "killed": killed,
        "now_pct": 100.0 * killed / total,
        # the best any suite can do without asserting exact wording
        "ceiling": total - unobservable,
        "ceiling_pct": 100.0 * (total - unobservable) / total,
        # what THIS work-list can deliver
        "if_all_reachable": killed + reachable,
        "if_all_reachable_pct": 100.0 * (killed + reachable) / total,
    }


def concentration(fns: list[str]) -> dict:
    """Where a module's REACHABLE mutants sit, and therefore what a pass will cost.

    MEASURED 2026-08-04 across eight passes: the count of reachable mutants does NOT predict the cost
    of a pass; their CONCENTRATION does. `clockcfg` returned 40 mutants from six tests because 27 of
    them sat in one function that no test had driven. `storage_targets` has a comparable count spread
    across four functions, so the same total costs several separate fixtures.

    That also corrected a wrong reading: after 34 -> 13 -> 14 on already-worked modules it looked like
    returns had flattened, and then never-measured modules gave 9 -> 11 -> 10 -> 15 -> 40. The
    flattening was WITHIN a module. Across the fleet, what predicts a cheap pass is one dense cluster —
    module history does not.

    `top_share` is the largest cluster as a fraction of the module's reachable set. Above ~0.5 a single
    fixture takes most of them; below ~0.25 the work is scattered and each mutant costs more.
    """
    if not fns:
        return {"total": 0, "clusters": [], "top": None, "top_n": 0, "top_share": 0.0}
    counts: dict[str, int] = {}
    for f in fns:
        counts[f] = counts.get(f, 0) + 1
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    top, top_n = ordered[0]
    return {"total": len(fns), "clusters": ordered, "top": top, "top_n": top_n,
            "top_share": top_n / len(fns)}


# ── mutant-name / diff-position mapping (moved up from tools/ 2026-08-27) ────────────
# These are DECISION logic by this module's own criterion — each one silently misled in measurement
# before it was tested: `module_source_path` read the python BINARY, and `func_of_mutant` mangled two
# of the three real name shapes. Per the header, that is exactly what belongs inside the floor.
def module_source_path(base_dir: str, module: str) -> str:
    """`("/srv/ch", "cpap_stream")` -> `/srv/ch/cpap_stream.py`. PURE — the caller supplies the root.

    🔴 EXISTS BECAUSE OF A MISTAKE WORTH NAMING. The first wiring passed `py` — which at both call
    sites is `os.path.abspath(a.python)`, THE INTERPRETER — into `_read_source`. It read the python
    binary, `message_call_lines` parsed nothing, the flag was therefore always False, and the whole
    wiring was inert while looking correct. It also measured as a clean ZERO delta, which is the part
    that nearly shipped: the aggregate agreed with the null hypothesis for the wrong reason."""
    return os.path.join(base_dir, module + ".py")


def in_message_call(show_output: str, source: str, mid: str) -> bool:
    """Is this mutant's line inside a log/print CALL? FAILS CLOSED.

    MEASURED on `cpap_stream`'s 66 survivors: 26 sit inside a message call and the work-list moves
    REACHABLE **20 -> 14** (-6, -30 %); nothing moves out of UNOBSERVABLE, which is the expected
    shape since this only ever reclassifies a mutant that already looked live.

    ⚠️ The FIRST run of that same measurement returned a delta of ZERO, and it was wrong for two
    independent bugs of this tool's own (`module_source_path`, `func_of_mutant` — both now
    control-tested). A zero delta is exactly what an inert wiring produces, so it is the one result
    that must be disbelieved until the path is shown to carry a signal at all. Verify by asserting
    the flag is True for SOME mutant before believing any aggregate computed from it.

    Every unavailable input — unreadable module, unparseable source, a diff with no `-` line, a
    function AST cannot find — returns False, which is `classify`'s existing default and therefore the
    OLD behaviour. That direction is deliberate: a False can only leave a mutant in the work-list
    where it already was, while a wrong True would silently REMOVE work from a list whose whole job is
    to say what deserves a human's attention."""
    if not source:
        return False
    line = file_lineno_of(show_output, source, func_of_mutant(mid))
    return line is not None and line in message_call_lines(source)


def hunk_lineno(show_output: str) -> "int | None":
    """The 1-indexed line of the FIRST changed line, RELATIVE TO THE FUNCTION. PURE.

    ⚠️ FUNCTION-RELATIVE, NOT FILE-RELATIVE, and that is a property of mutmut rather than a choice
    here: `mutmut show` builds its diff from `cst.Module([function]).code`, so the `@@ -a,b +c,d @@`
    header numbers from 1 at the FUNCTION's first line (verified against mutmut 3.7's
    `__main__.py:1710`). Feeding this straight to `message_call_lines(file_source)` would compare a
    function offset against file line numbers — a plausible-looking number about the wrong thing.
    `file_lineno_of` does the mapping.

    Counts context and removed lines, skipping additions: a `+` line does not exist in the ORIGINAL,
    which is the text whose message-calls we are asking about."""
    rel, seen = None, None
    for line in show_output.splitlines():
        if line.startswith("@@"):
            m = re.match(r"@@ -(\d+)", line)
            if m:
                seen = int(m.group(1))
            continue
        if seen is None or line.startswith(("---", "+++")):
            continue
        if line.startswith("-"):
            rel = seen
            break
        if not line.startswith("+"):
            seen += 1
    return rel


def function_start_line(source: str, func: str) -> "int | None":
    """1-indexed line where `func` is defined in `source`, via AST. PURE.

    AST, not a regex: `def x_foo__mutmut_1` appears in mutmut's own generated module and a text search
    would find the wrong one, and a nested or decorated definition shifts a naive match. `lineno` on
    the FunctionDef is the `def` line itself, which is what the diff's line 1 corresponds to."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == func:
            return node.lineno
    return None


def file_lineno_of(show_output: str, source: str, func: str) -> "int | None":
    """Map a mutant's function-relative diff position onto a FILE line number. PURE.

    Returns None when either half is unavailable — an unparseable file, an absent function, a diff
    with no `-` line. A None must NOT be treated as line 0 or as "not in a message call": the caller
    keeps the old behaviour, which is the honest degradation."""
    rel = hunk_lineno(show_output)
    start = function_start_line(source, func)
    if rel is None or start is None:
        return None
    return start + rel - 1


def func_of_mutant(mid: str) -> str:
    """`…x_foo__mutmut_3` -> `foo`; `…xǁClsǁmeth__mutmut_3` -> `meth`.

    ⚠️ THE INHERITED REGEX IS WRONG FOR TWO REAL SHAPES and was measured mangling them:
      · `x__coexistence_refusal__mutmut_3` -> `istence_refusal` — the leading `x_?` ate `_co`, because
        `(.+?)` is lazy and the pattern let `x_` swallow one more character than it should.
      · `xǁLiveStreamControllerǁ_start__mutmut_73` -> `ǁLiveStreamControllerǁ_start` — mutmut qualifies
        METHODS with `ǁ` separators, and an AST lookup for that name finds nothing.
    Together these are why only 27 of 66 survivors mapped to a line number. Anchoring on the `x`
    segment and taking the LAST `ǁ` part fixes both; `rank_all`'s copy keeps the old shape only because
    it feeds a display cluster, not a lookup."""
    core = re.sub(r"__mutmut_\d+.*$", "", mid)          # drop the mutant suffix
    core = core.rsplit(".", 1)[-1]                      # drop the module prefix
    if "\u01c1" in core:                                # METHOD: `xǁClassǁmethod`
        return core.split("\u01c1")[-1]                  # keep any leading underscore — it is the name
    return core[2:] if core.startswith("x_") else core  # FUNCTION: mutmut prefixes exactly `x_`
