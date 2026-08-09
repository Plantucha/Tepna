# tepna-capture — mutation_triage.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The DECISION LOGIC behind `tools/mutate_triage.py`, split out so it sits inside the coverage floor.

WHY IT LIVES HERE AND NOT IN tools/. `tools/` is outside the coverage denominator
(`pyproject.toml [tool.coverage.run] source`), so nothing under it is gated — which is fine for
`glob`/`subprocess`/`argparse` plumbing and NOT fine for this. These ~40 lines decide whether a
surviving mutant is worth a human's time or is impossible to kill, and a wrong bucket does real harm
in both directions: it sends someone chasing a target that cannot be reached, or it dismisses a real
defect as noise. That is exactly the kind of logic a 100 % floor exists to hold, so it is here where
the floor applies, and the plumbing stays in `tools/` where it does not.

The split is deliberate and partial. `tools/mutate_triage.py` remains UNCOVERED by design; this is not
an oversight to be "finished" later.
"""
from __future__ import annotations

import ast
import re

__all__ = ["classify", "ceiling", "concentration", "message_call_lines", "REACHABLE", "PROSE",
           "UNOBSERVABLE", "EQUIVALENT"]

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
