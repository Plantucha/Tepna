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
import pytest

from tests._srcscan import anchored_segment, split_segment, until_anchor

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
