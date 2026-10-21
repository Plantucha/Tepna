# tepna-capture — tests/_srcscan.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# READING A MODULE'S SOURCE FROM A TEST — the one way to do it that does not break mutation testing.
#
# Several tests in this suite deliberately scan source text: it is the only way to assert a property of
# the CALLERS rather than of a function ("every clock write goes through the policy", "no fabricated
# `or 0` on a pulse reading", "the monitor's advertised default equals the daemon's fallback"). That is
# a legitimate and load-bearing pattern here — `build.mjs` has the same shape on the JS side.
#
# ⚠️ IT IS ALSO A LANDMINE FOR `tools/mutate.py`, AND THE FAILURE IS SILENT.
#
# mutmut 3 generates ONE module holding every mutant inline, so a source scan sees hundreds of copies of
# every line at once. Three of the four scan shapes break against it:
#
#   `assert X in src`          TOLERANT   — more copies, still present
#   `assert X not in src`      BREAKS     — mutmut GENERATES the forbidden string as a mutation
#   `assert len(matches) == 1` BREAKS     — 664 copies of one call site (measured, capture.py)
#   `src.split(MARKER)[1]`     BREAKS     — splits at the first MUTANT's copy, not the real one
#
# And it does not look like a test failure. mutmut reports it as **"failed to collect stats"**, which
# reads as an environment problem, and the WHOLE MODULE comes back unmeasurable. That is the direct
# reason `capture.py` sat at 1 % measured in the audit for so long: its test selection contains four
# such scans, and any one of them poisons the run.
#
# `tools/mutate.py` carries a blunt per-FILE exclusion (`SOURCE_SCANNING_TESTS`) for this, but excluding
# a whole file also removes whatever REAL unit tests live beside the scan — for `test_oxyii_rtc.py` that
# would have deleted `oxyii_rtc_due`'s only coverage and reported its 10 mutants as fake survivors.
#
# So: read source through THIS helper. On real source it is an ordinary read; on a generated mutant file
# it skips just that test. The `mutation-source-scan` group in `tests/test_mutation_hygiene.py` fails if
# a new test scans a mutatable module any other way.

from __future__ import annotations

import os
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def module_source(name: str) -> str:
    """The text of `<repo>/<name>`, or skip if we have been handed a mutmut-generated file.

    `name` is a bare module filename, e.g. "capture.py".
    """
    src = (HERE / name).read_text(encoding="utf-8")
    if "__mutmut_orig" in src:
        import pytest

        # `allow_module_level=True` is LOAD-BEARING. `test_ring_acc_recording.py` calls this at module
        # scope (`CAP = module_source("capture.py")`), and a bare `pytest.skip` raised during import is
        # not a skip — pytest turns it into a COLLECTION ERROR ("Using pytest.skip outside of a test will
        # skip the entire module. If that's your intention, pass allow_module_level=True"). Under
        # `mutate_diff.py`'s `-x` that error killed every capture.py mutant run since #2174: "failed to
        # collect stats" → 0 mutants tested → the gate refused (correctly) on #2209 and #2214, so the
        # mutation gate was blind to every capture.py change for two days while reading as an
        # environment fault. Inside a test function the flag is inert, so one form serves both call sites.
        pytest.skip(
            f"{name} here is a mutmut-generated file holding every mutant inline; "
            "a source scan sees all of them at once (see tests/_srcscan.py)",
            allow_module_level=True,
        )
    return src


def module_path(name: str) -> str:
    """The path form, for the few callers that want to open it themselves."""
    return os.path.join(str(HERE), name)


def function_source(name: str, func: str) -> str:
    """The text of ONE function from `<repo>/<name>`, bounded by the function itself.

    ⚠️ THE IDIOM THIS REPLACES IS A LATENT FALSE RESULT, IN BOTH DIRECTIONS. Several tests used to
    slice a fixed byte window after an anchor — `src[i:i + 4000]` — and assert a property inside it.
    The window is a guess about how long the function is, so the test's verdict depends on how much
    unrelated text happens to sit between the anchor and the marker:

      * a POSITIVE assert (`X in seg`) reds when the marker drifts past the edge — a FALSE FAILURE
        triggered by adding a comment near the wrong function, with nothing behavioural changed;
      * a NEGATIVE assert (`X not in seg`) passes when the forbidden text drifts past the edge — a
        FALSE PASS, and the guard silently stops guarding.

    Measured 2026-08-29 on `capture.py`: `async def autopull_poller(` carried its marker at **+3278**
    inside a **4000**-char window — 18 % headroom, roughly one comment block from flipping — and the
    same slice carries a `not in` assertion, so the same drift would have disarmed a guard rather
    than reddened a test.

    Bounding on the FUNCTION removes the guess. `ast` gives the real extent, so the slice is a
    property of the code rather than of a constant nobody re-derives.
    """
    import ast

    src = module_source(name)
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == func:
            seg = ast.get_source_segment(src, node)
            if seg:
                return seg
            break
    raise AssertionError(
        f"{func!r} not found in {name} — the scan is anchored on a name that "
        f"no longer exists, which is a stale test, not a passing one"
    )


def strip_comments(src: str) -> str:
    """`src` with comment tokens removed, for scans that must not assert documentation.

    A source scan that reads comments pins the prose beside the code rather than the code, so a
    reworded comment reds a behavioural test. Kept beside `function_source` because the two are
    almost always wanted together.
    """
    import io
    import tokenize

    return tokenize.untokenize(
        t for t in tokenize.generate_tokens(io.StringIO(src).readline) if t.type != tokenize.COMMENT
    )


def block_source(name: str, anchor: str) -> str:
    """The Python block that OPENS at `anchor` — its line plus every following more-indented line.

    ⚠️ USE THIS, NOT `function_source`, WHEN THE ASSERTION IS ABOUT LOCALITY. "The per-second flow
    check must stamp data arrival" is a claim about a handful of lines, and the enclosing function is
    `run_polar` at **73 771 characters**. Bounding such an assertion on the function would widen a
    400-char window by 184x and let it pass on a `note_data(` call anywhere in a 1 000-line function —
    it would stop being a false failure and start being a test that cannot fail, which is worse.

    The magic-window idiom this replaces has the same defect in the other direction: `src[i:i + 400]`
    is a GUESS at where the block ends, so the verdict depends on how much unrelated text happens to
    sit inside it. A block is a property of the code, so the slice moves when the code does.

    Raises rather than returning empty if the anchor is absent — a scan anchored on text that no
    longer exists is a stale test, not a passing one.
    """
    src = module_source(name)
    i = src.find(anchor)
    if i < 0:
        raise AssertionError(f"anchor {anchor!r} not found in {name} — stale scan, not a pass")
    start = src.rfind("\n", 0, i) + 1
    lines = src[start:].splitlines()
    head = lines[0]
    indent = len(head) - len(head.lstrip())
    out = [head]
    for line in lines[1:]:
        if line.strip() and (len(line) - len(line.lstrip())) <= indent:
            break
        out.append(line)
    return "\n".join(out)


def split_segment(text: str, anchor: str, index: int, *, where: str, maxsplit: int | None = None) -> str:
    """Segment `index` of `text.split(anchor)`, or an AssertionError that NAMES what was absent.

    ⚠️ THE IDIOM THIS REPLACES REPORTS NOTHING. `src.split(ANCHOR)[1]` raises
    `IndexError: list index out of range` the moment the anchored line changes, and that message names
    no invariant, no anchor and no file — a reader cannot tell a stale test from a real regression, and
    three scans in `test_stale_bond_and_empty_writers.py` all raised it at once when a loop header was
    widened to carry a dict key. The residue row is
    `2026-10-21-a-source-scan-split-on-a-code-token-raises-instead-of-reporting`.

    The split itself is unchanged, so the text a caller reads is byte-identical. Only the failure moves:
    an absent anchor becomes a finding that names the anchor, the file, how many segments the split did
    yield and which one the scan asked for. The comments in those three scans record that a fixed
    character window was widened three times before an anchor replaced it, so this is the second
    generation of one fragility — and `block_source` and `suite_tail` above already report their own
    absent anchors this way.
    """
    parts = text.split(anchor) if maxsplit is None else text.split(anchor, maxsplit)
    if len(parts) <= index:
        raise AssertionError(
            f"anchor {anchor!r} yields {len(parts)} segment(s) in {where} and the scan asks for "
            f"segment {index} — the anchored text no longer exists, which is a stale scan, not a pass"
        )
    return parts[index]


def until_anchor(text: str, anchor: str, *, where: str) -> str:
    """`text` up to `anchor`, refusing when the anchor is absent.

    ⚠️ THE IDIOM THIS REPLACES FAILS IN THE OTHER DIRECTION, AND SILENTLY. `text.split(anchor, 1)[0]`
    is the usual way to bound a region on its closing content, and segment 0 of a split ALWAYS exists:
    when the closing anchor disappears, the expression returns the WHOLE text instead of raising, the
    region silently widens to the end of file, and a positive `in` assertion inside it starts passing
    on any matching line anywhere in the module. That is the defect `block_source` names above — a test
    that stops being a false failure and becomes a test that cannot fail, which is worse.
    """
    i = text.find(anchor)
    if i < 0:
        raise AssertionError(
            f"closing anchor {anchor!r} is absent from {where}, so the region would widen to the end "
            f"of the text rather than end where the scan says it ends — a stale scan, not a pass"
        )
    return text[:i]


def anchored_segment(name: str, *steps, chars: int | None = None, until: str | None = None) -> str:
    """A CHAIN of `split_segment` steps over `<repo>/<name>`, each naming itself when it fails.

    Each step is `(anchor, index)` or `(anchor, index, maxsplit)`, applied in order to the previous
    step's result — the same shape as the `split(...)[1].split(..., 1)[1]` chains this replaces, with
    the ordinal of the failing step in the message. `chars` truncates the result, which keeps a caller's
    existing window byte-identical; a window is still a guess about where a block ends, and
    `block_source` is the better tool when the property is about a block. `until` bounds the result on
    its CLOSING content through `until_anchor`, which refuses an absent bound rather than widening to
    the end of the text.
    """
    text = module_source(name)
    for n, step in enumerate(steps, 1):
        anchor, index = step[0], step[1]
        maxsplit = step[2] if len(step) > 2 else None
        text = split_segment(text, anchor, index, where=f"{name} (chain step {n} of {len(steps)})", maxsplit=maxsplit)
    if until is not None:
        text = until_anchor(text, until, where=f"{name} (closing bound of a {len(steps)}-step chain)")
    return text if chars is None else text[:chars]


def suite_tail(name: str, anchor: str) -> str:
    """From the line holding `anchor` to the END OF THE SUITE IT SITS IN — its siblings, not its body.

    The sibling of `block_source`, and the distinction is load-bearing. `block_source` is for an
    anchor that OPENS a block (`if flowed:` → the lines beneath it). This is for an anchor that sits
    INSIDE one and whose property is on a following sibling: `log.info("…re-bonded…")` followed by
    `rebond_attempts = 0` at the same indentation. Using `block_source` there returns a single line
    and the assertion fails for a reason that has nothing to do with the code — which is how this
    helper came to exist.

    Both replace `src[i:i + N]`. The byte window silently spans whichever of these two things happens
    to fit in N characters, which is why it can neither be right nor be checked.
    """
    src = module_source(name)
    i = src.find(anchor)
    if i < 0:
        raise AssertionError(f"anchor {anchor!r} not found in {name} — stale scan, not a pass")
    start = src.rfind("\n", 0, i) + 1
    lines = src[start:].splitlines()
    head = lines[0]
    indent = len(head) - len(head.lstrip())
    out = [head]
    for line in lines[1:]:
        if line.strip() and (len(line) - len(line.lstrip())) < indent:
            break
        out.append(line)
    return "\n".join(out)
