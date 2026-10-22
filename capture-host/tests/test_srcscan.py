# tepna-capture — tests/test_srcscan.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE TWO OPPOSITE FAILURE DIRECTIONS OF ONE SOURCE-SCAN IDIOM.
#
# A source scan bounds its window on code tokens, and code tokens move. The idioms that cut the window
# fail in two directions when they do, and both failures are invisible in the place it matters:
#
#   `text.split(ANCHOR)[1]`      the anchor moved ⇒ `IndexError: list index out of range`. A real
#                                defect, reported as a crash that names neither the anchor, nor the
#                                file, nor the segment asked for — so the reader cannot tell a stale
#                                scan from a broken helper without re-deriving the chain by hand.
#   `text.split(ANCHOR, 1)[0]`   the anchor moved ⇒ the whole text, silently. The window widens to the
#                                end of the module and the assertion inside it passes on anything,
#                                anywhere. That is a test that cannot fail, which is the worse half.
#
# `_srcscan.split_segment`, `until_anchor` and `anchored_segment` replace both, and this file asserts
# the REPORTING rather than the cutting: that a moved anchor names itself, that a vanished closing
# bound refuses instead of widening, and that a chain says WHICH link went stale. The equivalence leg
# keeps the raw idiom beside the helper on synthetic text — the one place it is harmless — so the
# substitution is proven rather than asserted.
import ast

import pytest

from tests._srcscan import HERE, after_last, anchored_segment, split_segment, until_anchor

# Synthetic source: no module is read, so nothing here depends on `capture.py`'s current text.
SRC = "head A one A two B tail\n"


def test_a_moved_opening_anchor_names_itself_instead_of_raising_indexerror():
    """The replaced idiom's own failure is the control: it must crash, and its message must name none
    of the three things a reader needs."""
    with pytest.raises(IndexError) as raw:
        SRC.split("ZZZ")[1]
    assert "ZZZ" not in str(raw.value) and "segment" not in str(raw.value)

    with pytest.raises(AssertionError) as named:
        split_segment(SRC, "ZZZ", 1, where="a synthetic scan")
    msg = str(named.value)
    assert "'ZZZ'" in msg, msg  # the anchor
    assert "a synthetic scan" in msg, msg  # where it was looked for
    assert "segment 1" in msg, msg  # what the scan asked for
    assert "1 segment(s)" in msg, msg  # what it actually got
    assert "stale scan, not a pass" in msg, msg  # and the verdict it is NOT


def test_a_present_anchor_still_cuts_exactly_what_the_raw_idiom_cut():
    """A guard that changes the answer is not a guard. Equivalence on text that still matches, for the
    bare form and the `maxsplit` form alike."""
    assert split_segment(SRC, "A", 1, where="w") == SRC.split("A")[1]
    assert split_segment(SRC, "A", 1, where="w", maxsplit=1) == SRC.split("A", 1)[1]
    # …and the two differ, so the parameter is load-bearing rather than decorative: without `maxsplit`
    # a REPEATED anchor cuts the window at the first repeat and loses the rest.
    assert split_segment(SRC, "A", 1, where="w") != split_segment(SRC, "A", 1, where="w", maxsplit=1)


def test_a_vanished_closing_bound_refuses_instead_of_widening_to_the_end():
    """The silent half. `split(bound, 1)[0]` on an absent bound returns the WHOLE text, so the scan
    reads to the end of the module and its assertion stops being able to fail."""
    assert SRC.split("ZZZ", 1)[0] == SRC  # the false pass, measured rather than described

    with pytest.raises(AssertionError) as e:
        until_anchor(SRC, "ZZZ", where="a synthetic scan")
    msg = str(e.value)
    assert "'ZZZ'" in msg, msg
    assert "a synthetic scan" in msg, msg
    assert "widen to the end" in msg, msg
    assert until_anchor(SRC, "B", where="w") == SRC.split("B", 1)[0]


def test_a_backward_scan_names_its_absent_anchor_instead_of_raising_indexerror():
    """The same reporting, reached from the other end. A scan that reads BACKWARD from a label —
    `html.split(LABEL)[0].rsplit("<span", 1)[1]`, which is how `test_charging_state.py` finds the chip
    holding a label — raises the unnamed `IndexError` the moment the opening tag moves, because
    `rsplit` on an absent anchor returns a one-element list."""
    with pytest.raises(IndexError) as raw:
        SRC.rsplit("ZZZ", 1)[1]
    assert "ZZZ" not in str(raw.value)

    with pytest.raises(AssertionError) as named:
        after_last(SRC, "ZZZ", where="a synthetic scan")
    msg = str(named.value)
    assert "'ZZZ'" in msg, msg
    assert "a synthetic scan" in msg, msg
    assert "stale scan, not a pass" in msg, msg

    # The LAST occurrence, not the first — `SRC` carries two `A`s, and the forward helper takes the
    # first. The two are opposite ends of one text and must not be interchangeable.
    assert after_last(SRC, "A", where="w") == SRC.rsplit("A", 1)[1]
    assert after_last(SRC, "A", where="w") != split_segment(SRC, "A", 1, where="w")


def test_a_chain_names_which_link_went_stale(tmp_path, monkeypatch):
    """A chain of three splits that reports only "index out of range" costs the reader the whole chain
    to find out which anchor moved. The ordinal and the chain length are the finding."""
    import tests._srcscan as ss

    monkeypatch.setattr(ss, "HERE", tmp_path)
    (tmp_path / "synthetic.py").write_text(SRC, encoding="utf-8")

    assert anchored_segment("synthetic.py", ("A", 1), ("B", 0)) == SRC.split("A")[1].split("B")[0]

    with pytest.raises(AssertionError) as e:
        anchored_segment("synthetic.py", ("A", 1), ("ZZZ", 1), ("B", 0))
    msg = str(e.value)
    assert "chain step 2 of 3" in msg, msg
    assert "synthetic.py" in msg, msg
    # The closing bound reports its own position too — it is not one of the numbered steps.
    with pytest.raises(AssertionError) as e2:
        anchored_segment("synthetic.py", ("A", 1), until="ZZZ")
    assert "closing bound of a 1-step chain" in str(e2.value), str(e2.value)


def test_the_chars_bound_is_applied_after_the_chain(tmp_path, monkeypatch):
    """`chars` truncates the resolved segment, so a window that shrinks reads shorter rather than
    silently resolving somewhere else."""
    import tests._srcscan as ss

    monkeypatch.setattr(ss, "HERE", tmp_path)
    (tmp_path / "synthetic.py").write_text(SRC, encoding="utf-8")
    assert anchored_segment("synthetic.py", ("A", 1), chars=4) == SRC.split("A")[1][:4]


def test_the_helper_reaches_a_real_module_through_module_source():
    """The integration leg: `anchored_segment` must resolve against real source, not only `tmp_path`.
    Anchored on `def `, which is a property of Python rather than of any one line, so this leg cannot
    go stale the way the scans it serves do — those five sites assert their own anchors and now name
    them when they move."""
    assert anchored_segment("capture.py", ("def ", 1), chars=40).strip()


# ── THE RATCHET: no scan in this suite may cut a SOURCE window with a bare split index ────────────
# Converting the sites is half a repair. The idiom is one keystroke shorter than the helper, so the
# next scan written is bare unless something reds. This is that something, and it is a MEASURED set
# rather than a grep: the criterion is where the split's receiver came from.
_SRCSCAN_READERS = frozenset(
    {"module_source", "function_source", "block_source", "suite_tail", "anchored_segment", "strip_comments"}
)
# A read anchored on one of these reaches a file that SHIPS in this repo. A `read_text()` on a
# `tmp_path` is data the test just wrote, where an index is a column number and an IndexError is a
# real regression — that is the 47-line population this gate deliberately does not judge.
_REPO_ANCHORS = frozenset({"HERE", "ROOT", "__file__"})


def _call_name(call: ast.Call) -> str | None:
    f = call.func
    return f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", None)


def _reads_a_repo_file(call: ast.Call) -> bool:
    f = call.func
    if not isinstance(f, ast.Attribute):
        return False
    if f.attr == "getsource":  # inspect.getsource — source text by another route
        return True
    if f.attr not in ("read_text", "read"):
        return False
    return any(isinstance(n, ast.Name) and n.id in _REPO_ANCHORS for n in ast.walk(call))


def _chain_root(node: ast.AST) -> ast.AST:
    """The Name a `.split(…)[1].split(…)[0]` chain ultimately reads from."""
    while True:
        if isinstance(node, ast.Subscript):
            node = node.value
        elif isinstance(node, ast.Call):
            node = node.func
        elif isinstance(node, ast.Attribute):
            node = node.value
        else:
            return node


def raw_source_window_scans(src: str) -> list[tuple[int, str]]:
    """Every `<source text>.split(…)[N]` in `src`, as (line, text). The helpers are not matched."""
    tree = ast.parse(src)
    lines = src.splitlines()
    tainted: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        carries = any(
            (isinstance(n, ast.Call) and (_call_name(n) in _SRCSCAN_READERS or _reads_a_repo_file(n)))
            or (isinstance(n, ast.Name) and n.id in tainted)
            for n in ast.walk(node.value)
        )
        if carries:
            tainted |= {t.id for t in node.targets if isinstance(t, ast.Name)}
    found = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Subscript) or not isinstance(node.value, ast.Call):
            continue
        call = node.value
        if not (isinstance(call.func, ast.Attribute) and call.func.attr in ("split", "rsplit")):
            continue
        if not (isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, int)):
            continue
        root = _chain_root(call.func.value)
        if isinstance(root, ast.Name) and (root.id in tainted or root.id in _SRCSCAN_READERS):
            found.add((node.lineno, lines[node.lineno - 1].strip()))
    return sorted(found)


def test_the_ratchet_fires_on_a_planted_scan_and_leaves_a_data_split_alone():
    """The control, so the gate below cannot pass by examining nothing. Both halves are planted: a
    source window cut bare must be found, and the same shape over a CSV row the test wrote must not."""
    planted = (
        "from tests._srcscan import module_source\n"
        "def test_x():\n"
        "    src = module_source('capture.py')\n"
        "    body = src.split('async def run_polar')[1].split('\\nasync def ')[0]\n"
        "    assert body\n"
    )
    assert [ln for ln, _ in raw_source_window_scans(planted)] == [4], raw_source_window_scans(planted)

    data = (
        "def test_y(tmp_path):\n"
        "    p = tmp_path / 'x.csv'\n"
        "    rows = p.read_text().splitlines()\n"
        "    assert rows[1].split(';')[2] == '0.0'\n"
    )
    assert raw_source_window_scans(data) == [], raw_source_window_scans(data)

    converted = (
        "from tests._srcscan import module_source, split_segment\n"
        "def test_z():\n"
        "    src = module_source('capture.py')\n"
        "    body = split_segment(src, 'async def run_polar', 1, where='capture.py')\n"
    )
    assert raw_source_window_scans(converted) == [], raw_source_window_scans(converted)


def test_no_scan_in_this_suite_cuts_a_source_window_with_a_bare_split_index():
    """28 sites in 13 files cut their window this way (measured 2026-10-22, residue
    `2026-10-21-a-split-chain-over-module-source-survives-in-twelve-test-files`), and one of them had
    already failed silently: a 400-character window whose closing anchor sat 1,134 characters past its
    end returned the whole window, so the region widened and the assertion stopped describing what it
    read. The helpers report instead. This gate holds the set at zero."""
    offenders = []
    for path in sorted((HERE / "tests").glob("test_*.py")):
        for lineno, text in raw_source_window_scans(path.read_text(encoding="utf-8")):
            offenders.append(f"{path.name}:{lineno}  {text}")
    assert not offenders, (
        "a source window is cut with a bare split index — route it through `split_segment` / "
        "`until_anchor` / `after_last`, which name the anchor that moved:\n" + "\n".join(offenders)
    )
