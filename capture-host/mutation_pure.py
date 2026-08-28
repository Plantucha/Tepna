# tepna-capture — mutation_pure.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The DECISION LOGIC behind `tools/mutate_pure.py`, split out so it sits inside the coverage floor.

Fourth of the family (after `mutation_triage`, `mutation_diff`, `mutation_sweep`) and the same house
rule: `tools/` is outside the coverage denominator until something imports it, which is fine for
`glob`/`subprocess`/`argparse`/IO and NOT fine for logic that can return a WRONG ANSWER instead of
failing loudly.

WHAT IS AT STAKE HERE. `harvest` decides WHICH mutants get tested at all, by a line scan over a
generated file that is far too large to `ast.parse` (capture.py's is 1.9 M lines). Both directions of
a mistake are silent and both corrupt the measurement:

  · UNDER-harvest — a mutant whose body is cut short, or whose `def` the regex misses, is simply
    absent. It is never tested and never counted, so the run reports a smaller total and a higher
    kill rate. Nothing says a mutant went missing.
  · OVER-harvest — admitting `__mutmut_orig` tests the ORIGINAL function as though it were a mutant.
    It passes every test by construction, so it is reported as SURVIVED: a fabricated test gap that
    sends someone hunting for an assertion that already exists.

`tools/mutate_pure.py`'s own header names the neighbouring hazard in the same terms — a load-time
alias makes the swap invisible so "every mutant would look survived", which it calls "a silent false
negative, the worst outcome a measurement tool can have". That is exactly right, and it is the reason
this scan belongs inside the floor rather than beside the guard that watches for it.

⚠️ THE `__mutmut_orig` EXCLUSION IS RETURNED, NOT DROPPED. It used to happen inside a condition with
nothing said. An exclusion a caller cannot see is one nobody can audit — the same reason
`mutation_sweep.select_tests` reports the test files it drops.
"""
from __future__ import annotations

import re

__all__ = ["DEF", "harvest_text"]

# mutmut names every generated copy `x_<func>__mutmut_<n>`, plus one `__mutmut_orig`. The regex
# captures the indent (so the body's end can be found by dedent) and the name.
DEF = re.compile(r"^(\s*)(?:async\s+)?def\s+(x[\w]*__mutmut_(?:\d+|orig))\s*\(")


def harvest_text(text: str, funcs: list[str]) -> tuple[dict[str, list[tuple[str, str]]], list[str]]:
    """`(harvested, skipped_originals)` from the generated mutants file's TEXT. PURE.

    Takes text rather than a path: the read is plumbing and belongs to the caller, the scan is the
    decision. Returns the `__mutmut_orig` names it skipped so the caller can report them — testing the
    original as a mutant would produce a mutant that survives by construction.

    A body ends at the first non-blank line indented no further than the `def`. Blank lines do NOT end
    it (a blank line has no indentation and would truncate every multi-paragraph function)."""
    want = {f"x_{f}__mutmut_" for f in funcs}
    out: dict[str, list[tuple[str, str]]] = {f: [] for f in funcs}
    skipped: list[str] = []
    lines = text.splitlines(keepends=True)
    cur = start = None
    indent = 0

    def close(end: int) -> None:
        if cur is None:
            return
        for f in funcs:
            if cur.startswith(f"x_{f}__mutmut_"):
                if cur.endswith("__mutmut_orig"):
                    skipped.append(cur)
                else:
                    out[f].append((cur, "".join(lines[start:end])))

    for n, line in enumerate(lines):
        m = DEF.match(line)
        if m:
            close(n)
            name, indent = m.group(2), len(m.group(1))
            cur = name if any(name.startswith(w) for w in want) else None
            start = n
        elif cur is not None and line.strip() and not line.startswith(" " * (indent + 1)):
            close(n)
            cur = None
    close(len(lines))
    return out, skipped
