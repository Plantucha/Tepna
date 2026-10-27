# tepna-capture — tests/test_mutation_diff.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`mutation_diff` — the decision logic of the diff-scoped mutation gate.

These exist because the logic they cover spent weeks in `tools/`, OUTSIDE the coverage denominator,
where `is_string_only` gave a well-formed WRONG ANSWER and nothing said so. The file shipped a
`--selftest` that no gate invoked, which is a mitigation that runs for nobody."""

import os
import signal
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mutation_diff as M  # noqa: E402


def _d(before, after):
    """One-line unified diff, the shape `is_string_only`/`diff_key` actually receive."""
    return "--- x\n+++ y\n-" + before + "\n+" + after + "\n"


# ── is_string_only — the measured regression ────────────────────────────────────────────────────


def test_is_string_only_asks_about_THE_CHANGED_TOKEN_not_the_lines_contents():
    """🔴 THE 2026-08-24 DEFECT, pinned. The old rule asked whether the added line CONTAINED a quote.

    These two mutations are IDENTICAL (`encoding="utf-8"` -> `encoding=None`). Under the old rule they
    were handled OPPOSITELY, decided by the unrelated literal `"mutants"` sitting elsewhere on the
    second line. Neither changes a string literal, so BOTH must be required."""
    plain = _d(
        '        data = json.loads(Path(p).read_text(encoding="utf-8"))',
        "        data = json.loads(Path(p).read_text(encoding=None))",
    )
    with_unrelated_literal = _d(
        '        src = (Path(work) / "mutants" / m).read_text(encoding="utf-8")',
        '        src = (Path(work) / "mutants" / m).read_text(encoding=None)',
    )
    assert M.is_string_only(plain) is False
    assert M.is_string_only(with_unrelated_literal) is False, (
        "regression: an unrelated literal elsewhere on the line decided the verdict again"
    )


def test_is_string_only_TRUE_only_when_the_change_lands_inside_a_literal():
    assert M.is_string_only(_d('    log.info("hello")', '    log.info("goodbye")')) is True
    # A genuine literal mutation carrying NO mutmut sentinel — keying on `XX` alone would miss it.
    assert M.is_string_only(_d('    x = "utf-8"', '    x = "UTF-8"')) is True


def test_is_string_only_honours_the_mutmut_XX_sentinel():
    assert M.is_string_only('--- a\n+++ b\n+    s = "XXhelloXX"\n') is True


def test_is_string_only_refuses_when_it_cannot_compare():
    assert M.is_string_only("--- a\n+++ b\n-    x = 1\n") is False  # no added line
    assert M.is_string_only("--- a\n+++ b\n-    a = 1\n-    b = 2\n+    a = 2\n") is False  # unbalanced
    # ⚠️ NOT a refusal: identical lines yield no span, the loop `continue`s, and the function falls
    # through to True — i.e. a no-op diff is EXCLUDED from the gate. Defensible ("nothing to require")
    # but it is the fail-OPEN direction. Pinned as observed behaviour; this unit MOVES the logic and
    # does not change it. Flagged for review rather than silently altered.
    assert M.is_string_only(_d("    x = 1", "    x = 1")) is True


# ── changed_span / _string_spans ────────────────────────────────────────────────────────────────


def test_changed_span_trims_the_common_prefix_and_suffix():
    assert M.changed_span("abc", "abc") is None
    assert M.changed_span("x = 1", "x = 2") == (4, 5, 5)


def test_string_spans_tracks_the_delimiter_and_honours_escapes():
    assert M._string_spans('a = "hi"') == [(4, 8)]
    assert M._string_spans("a = 'x' + \"y\"") == [(4, 7), (10, 13)]
    assert M._string_spans(r'a = "he\"llo"') == [(4, 13)]
    assert M._string_spans("a = 1") == []
    assert M._string_spans('a = "unterminated') == [(4, 17)]


# ── functions_covering — now PURE (takes text, not a path) ──────────────────────────────────────

_SRC = "import os\n\n\ndef alpha():\n    return 1\n\n\nclass C:\n    def beta(self):\n        return 2\n"


def test_functions_covering_names_module_functions_and_methods_the_mutmut_way():
    assert M.functions_covering(_SRC, {5}) == {"x_alpha"}
    assert M.functions_covering(_SRC, {10}) == {"xǁCǁbeta"}
    assert M.functions_covering(_SRC, {5, 10}) == {"x_alpha", "xǁCǁbeta"}


def test_functions_covering_yields_nothing_outside_a_function_or_on_bad_source():
    assert M.functions_covering(_SRC, {1}) == set()  # an import line
    # ABSENCE-SURVEY 45ccc1146b37: unparseable source names NO scope (None), never the empty one.
    assert M.functions_covering("def broken(:\n", {1}) is None
    assert M.functions_covering("", {1}) == set()  # the caller's unreadable-file case


# ── diff_key ────────────────────────────────────────────────────────────────────────────────────


def test_diff_key_is_whitespace_normalised_and_index_independent():
    assert M.diff_key(_d("    x = 1", "    x = 2")) == M.diff_key(_d("  x  =  1", "  x   =   2"))
    assert "__mutmut_" not in M.diff_key(_d("    x = 1", "    x = 2"))
    assert M.diff_key("--- a\n+++ b\n context only\n") == ""


def test_an_entry_whose_LINE_NEVER_MOVED_is_found_even_when_the_source_spaces_it_differently():
    """The key is whitespace-normalised, so the search over the source must be too.

    `tools/mutate_diff.py` calls an entry ORPHANED when its before text is not in the module, which
    means "the line moved, so this entry excuses nothing". Ruff puts TWO spaces before an inline
    comment and `diff_key` collapses them to one, so the raw substring test never matched a key
    carrying a comment — eight ledger entries read as orphaned on 2026-10-19 with every one of their
    lines still in place."""
    src = "def f():\n    read_one = False  # did ANY file get read?\n    return read_one\n"
    key = "- read_one = False # did ANY file get read? | + read_one = None # did ANY file get read?"
    assert key.split(" | + ")[0][2:] not in src, "the raw form is the bug this test pins"
    assert M.entry_before_in_source(key, src) is True


def test_a_MULTI_LINE_before_holds_only_while_EVERY_removed_line_is_still_there():
    """A mutant of a wrapped call carries one key per removed line, joined as `- a | - b | + c`."""
    src = "x = Found(\n    address=addr,\n    rssi=cur.rssi if cur else None,\n)\n"
    both = "- address=addr, | - rssi=cur.rssi if cur else None, | + address=addr, | + rssi=None,"
    assert M.entry_before_in_source(both, src) is True
    gone = "- address=addr, | - rssi=cur.rssi if cur else 0, | + address=addr,"
    assert M.entry_before_in_source(gone, src) is False


def test_a_before_LINE_OF_ONE_CHARACTER_is_read_from_the_right_offset():
    """A key's head is `"- "` plus the line, so the line starts at offset 2 and not at 3.

    One character further in reads an EMPTY line for a one-character one, and an entry with nothing
    to look for reports as orphaned. The ledger holds such a key today: mutmut's diff for a wrapped
    call carries the lone `)` line, as `- address=addr, | - ) | + address=addr,` in `bonding.py`.
    Every longer line hides the offset, because a substring test still matches text whose first
    character is gone."""
    src = "x = Found(\n    addr,\n)\n"
    assert M.entry_before_in_source("- ) | + ),", src) is True


def test_a_ONE_CHARACTER_line_at_ZERO_INDENT_is_the_corner_the_other_two_tests_miss():
    """\U0001f534 TWO TESTS EACH PIN ONE AXIS AND THE DEFECT LIVES WHERE THEY CROSS.

    The slice `seg[1:]` drops the diff marker. Off by one it drops the marker and the first
    character of the code, and `all(seg in normalised ...)` is a SUBSTRING test, so a line missing
    its first character is still a substring of itself: every multi-character line reads the same
    either way. The one exception is a line of ONE character, where the wrong slice leaves the empty
    string, the emptiness filter drops it, and `bool(removed)` reports ORPHANED over a line sitting
    unchanged in its module.

    The two neighbouring tests cover one axis each and neither reaches this corner: the
    one-character test writes `- )` with the space an indented diff line carries, which absorbs the
    wrong slice, and the zero-indent test writes a whole signature, which survives losing a
    character. Measured 2026-10-20 against `mutation_diff.x_entry_before_in_source__mutmut_30`
    (`seg[1:]` to `seg[2:]`, line 518): this key reads True against the committed code and False
    against the mutant, while `- ) | + ),`, `-def f(a): | +def f(b):` and `-x = 1 | +x = 2` all read
    True against both."""
    src = "VALUES = (\n    1,\n)\n"
    key = "-) | +),"
    assert key.startswith("- ") is False, "zero indent, so no space follows the marker"
    assert M.entry_before_in_source(key, src) is True
    assert M.entry_before_in_source("-] | +],", src) is False


def test_a_before_line_at_ZERO_INDENTATION_carries_NO_SPACE_after_the_marker():
    """🔴 The marker is structural; the space after it belongs to the INDENTED case alone.

    A unified-diff line is the marker plus the source line verbatim, so a module-level line gives
    `-def f(...)` with nothing between — and `diff_key` writes exactly that. The old guard
    `key.startswith("- ")` refused every such key, and the `[2:]` slice would have eaten the first
    character of the code. `mutate_diff.py` then told a reader the entry was ORPHANED, which reads
    "the line moved, or the entry is malformed", about a line sitting unchanged in its module.

    Measured 2026-10-20 over the ledger's 306 keyed entries: 1 misreported that way, `writers.py`'s
    `_drain_fsync` signature, and 0 moved the other way. The excuse itself never lapsed, because
    `classify` compares the key against `diff_key` output verbatim — the DIAGNOSIS lied."""
    src = "import os\n\n\ndef _drain_fsync(timeout: float = 5.0) -> None:\n    return os.sync()\n"
    key = "-def _drain_fsync(timeout: float = 5.0) -> None: | +def _drain_fsync(timeout: float = 6.0) -> None:"
    assert key.startswith("- ") is False, "the old guard's assumption is the bug this test pins"
    assert M.entry_before_in_source(key, src) is True
    moved = "-def _drain_fsync(timeout: float = 4.0) -> None: | +def _drain_fsync(timeout: float = 6.0) -> None:"
    assert M.entry_before_in_source(moved, src) is False


def test_a_removed_line_may_CONTAIN_the_separator_that_keys_are_joined_with():
    """Residue `2026-09-29-survivor-printer-splits-a-key-on-its-own-separator`, met on this side of it.

    `diff_key` joins its lines with ` | `, so a source line holding a bitwise or puts that same text
    INSIDE one line. A split on the separator alone then reads one line as two and finds neither. The
    parse walks the segments instead and re-joins any segment that opens with no marker onto the one
    before it."""
    src = "def f(a, b):\n    mask = a | b\n    return mask\n"
    assert M.entry_before_in_source("- mask = a | b | + mask = a & b", src) is True
    assert M.entry_before_in_source("- mask = a | c | + mask = a & c", src) is False


def test_a_key_whose_FIRST_SEGMENT_IS_NOT_A_DIFF_LINE_states_nothing_to_look_for():
    """A key opening with neither marker is not diff output, so it claims nothing checkable and reads
    as orphaned rather than as present (§∅). The entry is then the thing to re-verify."""
    assert M.entry_before_in_source("mask = a | b", "mask = a | b\n") is False


def test_a_key_that_states_no_REMOVED_line_can_never_claim_its_line_is_present():
    """Absence of evidence is reported as orphaned, never as present (§∅): the entry is then the
    thing to re-verify. A key with no `- ` head, or none at all, states nothing to look for."""
    assert M.entry_before_in_source(None, "x = 1\n") is False
    assert M.entry_before_in_source("+ x = 2", "x = 1\n") is False
    assert M.entry_before_in_source("- ", "x = 1\n") is False
    assert M.entry_before_in_source("- x = 1 | + x = 2", "") is False


# ── refusal_reason — the guard against failing OPEN ─────────────────────────────────────────────


def test_refusal_reason_is_None_only_when_the_run_could_actually_check_something():
    assert M.refusal_reason(True, 0) is None
    assert M.refusal_reason(False, 0) is not None
    assert M.refusal_reason(True, 1) is not None
    assert M.refusal_reason(True, None) is not None


# ── classify + the moved selftest ───────────────────────────────────────────────────────────────


def test_classify_splits_all_five_outcomes():
    E = [
        {"key": "a", "class": "no-distinguishing-input"},
        {"key": "b", "class": "untestable-by-design"},
        {"key": "c", "class": "real-gap"},
        {"key": "d", "class": "no-distinguishing-input"},
        {"key": "e", "class": "no-distinguishing-input"},
    ]
    got = M.classify(E, [{"key": k} for k in ("a", "b", "c", "f")], {"a", "b", "c", "d", "f"})
    assert sorted(x["key"] for x in got["excused"]) == ["a", "b"]
    assert [x["key"] for x in got["real_gap"]] == ["c"]
    assert [x["key"] for x in got["refuted"]] == ["d"]
    assert [x["key"] for x in got["orphaned"]] == ["e"]
    assert [x["key"] for x in got["unclassified"]] == ["f"]


def test_classify_tolerates_no_entries():
    assert M.classify(None, [], set())["unclassified"] == []


def test_the_selftest_RUNS_IN_THE_GATE_now_not_only_when_a_human_types_it():
    """⚠️ THE POINT OF THIS TEST. `--selftest` existed in `tools/mutate_diff.py` and NO gate invoked
    it — `grep` across check.sh, capture-host-ci.yml and tests/ found selftest wiring for
    `probe_equivalence` alone. A self-test that runs for nobody is CLAUDE.md §2b-bis one layer down.

    It is kept ALONGSIDE the unit tests above rather than instead of them: a selftest covers what its
    author thought to test; the floor covers what they did not, which is where a wrong answer lives."""
    assert M.selftest() == 0


# ── the selftest must be able to FAIL ───────────────────────────────────────────────────────────
# Covering these branches is the point, not a coverage chore: a selftest that cannot fail is the
# vacuous-green shape — it reports success about something it never really examined.


def test_selftest_FAILS_when_classify_buckets_wrongly(monkeypatch):
    monkeypatch.setattr(
        M,
        "classify",
        lambda e, s, k, generated=(), not_required=(), unchecked=(): {
            b: []
            for b in (
                "excused",
                "real_gap",
                "refuted",
                "orphaned",
                "unclassified",
                "not_decided",
                "claimed_not_required",
            )
        },
    )
    assert M.selftest() != 0


def test_selftest_FAILS_when_a_killed_mutant_leaks_into_unclassified(monkeypatch):
    real = M.classify

    def leaky(e, s, k, generated=()):
        out = real(e, s, k, generated=generated)
        out["unclassified"] = out["unclassified"] + [{"key": "d"}]
        return out

    monkeypatch.setattr(M, "classify", leaky)
    assert M.selftest() != 0


def test_selftest_FAILS_if_is_string_only_regresses_in_EITHER_direction(monkeypatch):
    """Both directions, because the file records both mistakes: the original bug (a keyword change
    read as string-only because the LINE held a quote) and the tempting over-correction (keying on
    mutmut's XX sentinel alone, which starts REQUIRING genuine literal mutations)."""
    monkeypatch.setattr(M, "is_string_only", lambda d: True)  # over-broad, the original bug
    assert M.selftest() != 0
    monkeypatch.setattr(M, "is_string_only", lambda d: False)  # over-narrow, the over-correction
    assert M.selftest() != 0


def test_selftest_FAILS_when_any_span_or_key_helper_regresses(monkeypatch):
    """The remaining selftest guards, each forced. Without these the FAIL branches never execute, so
    the selftest would be trusted for checks that had never once been shown to bite."""
    for name, broken in (
        ("changed_span", lambda a, b: (0, 0, 0)),
        ("_string_spans", lambda ln: []),
        ("diff_key", lambda d: "constant"),
        ("refusal_reason", lambda v, rc: None),
    ):
        with monkeypatch.context() as mp:
            mp.setattr(M, name, broken)
            assert M.selftest() != 0, f"selftest passed with a broken {name}"


# ── 1b: the two exclusions must not be one bucket ───────────────────────────────────────────────


def test_a_no_op_diff_is_EMPTY_DIFF_and_never_reported_as_string_only():
    """🔴 THE FAIL-OPEN THIS UNIT CLOSES. Every removed/added pair identical means every
    `changed_span` is None, the loop `continue`s, and the old code fell through to True — so a mutant
    that changes NOTHING was reported as "string-only" and excluded. It may still be excluded (it is
    equivalent by construction) but it is a different FACT, and only one of the two is evidence about
    the code. A gate that cannot tell them apart cannot be audited."""
    v, why = M.string_only_verdict(_d("    x = 1", "    x = 1"))
    assert v == M.EMPTY_DIFF, f"a no-op diff came back as {v}"
    assert v != M.STRING_ONLY
    assert "identical" in why
    assert M.is_string_only(_d("    x = 1", "    x = 1")) is True  # still excluded, deliberately


def test_a_real_log_mutation_is_STRING_ONLY_not_EMPTY_DIFF():
    """The other direction of the same control: the two buckets must not collapse into each other."""
    v, _ = M.string_only_verdict(_d('    log.info("hello")', '    log.info("goodbye")'))
    assert v == M.STRING_ONLY


def test_a_scan_outside_its_competence_REFUSES_instead_of_guessing(monkeypatch):
    """⚠️ `_string_spans` disclaims triple quotes and f-string nesting IN ITS OWN DOCSTRING, and
    outside them it returns a confident WRONG answer rather than failing — the 2026-08-24 defect one
    level down. Refusing is the only honest verdict, and it must not be silently excludable."""
    tq = chr(34) * 3
    v, why = M.string_only_verdict(_d("    x = f(1)  # " + tq, "    x = f(2)  # " + tq))
    assert v == M.UNDECIDABLE, f"a triple-quoted line was decided anyway: {v}"
    assert "competence" in why
    # An unterminated literal is the second detectable case.
    assert M.scan_is_reliable('a = "open') is False
    assert M.scan_is_reliable('a = "closed"') is True
    # An ESCAPED quote must not be mistaken for the terminator — otherwise the scan would call a
    # perfectly readable line unreliable and the gate would start demanding literal mutations.
    assert M.scan_is_reliable('a = "he\\"llo"') is True
    assert M.scan_is_reliable("a = " + tq + "x" + tq) is False


def test_UNDECIDABLE_fails_CLOSED_through_the_back_compat_bool():
    """A caller still on the bool API must get the SAFE direction: required, never excluded. This is
    the property that makes the refusal harmless to add — the old API cannot start skipping mutants."""
    tq = chr(34) * 3
    undecidable = _d("    x = f(1)  # " + tq, "    x = f(2)  # " + tq)
    assert M.string_only_verdict(undecidable)[0] == M.UNDECIDABLE
    assert M.is_string_only(undecidable) is False


def test_the_bool_and_the_verdict_can_never_disagree():
    """`is_string_only` is DERIVED from the verdict rather than reimplementing it. Pinned because a
    bool and a verdict drifting apart is precisely the defect class this file keeps producing."""
    tq = chr(34) * 3
    for diff in (
        _d("    x = 1", "    x = 2"),
        _d('    s = "a"', '    s = "b"'),
        _d("    x = 1", "    x = 1"),
        _d("  y = f(1) # " + tq, "  y = f(2) # " + tq),
        '--- a\n+++ b\n+    s = "XXhiXX"\n',
        "--- a\n+++ b\n-    x = 1\n",
    ):
        expected = M.string_only_verdict(diff)[0] in (M.STRING_ONLY, M.EMPTY_DIFF)
        assert M.is_string_only(diff) is expected


def test_selftest_FAILS_if_the_two_exclusions_collapse_again(monkeypatch):
    """The 1b guard, forced in every direction it can regress. Without this the new selftest checks
    would be trusted having never once been shown to bite."""
    for broken in (lambda d: (M.STRING_ONLY, "x"), lambda d: (M.EMPTY_DIFF, "x"), lambda d: (M.REQUIRED, "x")):
        with monkeypatch.context() as mp:
            mp.setattr(M, "string_only_verdict", broken)
            assert M.selftest() != 0


# ── boundary inputs for the scanning loops (PR #1891 follow-up) ─────────────────────────────────
# #1891 merged with 59 surviving mutants, because `mutation (diff-scoped)` is advisory rather than
# required. 30 of them are in real decision logic; the `selftest` bucket is held pending a ruling on
# the gate's jurisdiction over self-checking code.
#
# EVERY ONE is an off-by-one or a comparison flip in a scanning loop, and every existing fixture was
# too SHORT or too SIMPLE to observe it: a one-character difference, a literal at the end of the
# line, a single changed pair. Same family as the single-dot names and the pre-sorted candidate list
# — a fixture that reaches the right answer without the code having to do its job.


def test_changed_span_when_the_difference_is_at_index_ZERO():
    """Kills `i, lo = 0, ...` -> `1`. Every prior case differed later in the string, so starting the
    scan at 1 skipped only characters that matched anyway."""
    assert M.changed_span("xbc", "ybc") == (0, 1, 1)


def test_changed_span_when_one_line_is_a_PREFIX_of_the_other():
    """Kills `while i < lo` -> `i <= lo`. The scan walks all the way to `lo` here, so `<=` indexes
    one past the end of the shorter string. Prior cases were equal length AND differed early, so the
    bound was never reached in either direction."""
    assert M.changed_span("ab", "abc") == (2, 2, 3)
    assert M.changed_span("abc", "ab") == (2, 3, 2)


def test_changed_span_with_a_MULTI_CHARACTER_common_suffix():
    """Kills `j += 1` -> `j += 2` and the `(lo - i)` bound flips. A one-character common suffix
    cannot tell a step of 1 from a step of 2."""
    assert M.changed_span("aXbcd", "aYbcd") == (1, 2, 2)
    assert M.changed_span("p_TAIL", "qq_TAIL") == (0, 1, 2)


def test_string_spans_with_an_EMPTY_literal_followed_by_more_line():
    """Kills `start, quote, i = i, ch, i + 1` -> `i + 2`. In `""` the character after the opening
    quote IS the terminator, so stepping two skips it and the scan runs to end of line. Every prior
    fixture had a NON-empty literal, where that skip lands harmlessly inside the string."""
    assert M._string_spans('a="" + b') == [(2, 4)]


def test_scan_is_reliable_resumes_correctly_AFTER_a_closed_literal():
    """Kills the index-advance mutations in `scan_is_reliable` (`i += 1` -> `2`, `i += 2` -> `3`,
    `i = 2`, `i + 1` -> `i + 2`). A single literal at the END of the line cannot observe how the
    scanner resumes; these put a second literal after a closed one."""
    assert M.scan_is_reliable('f("a") + "open') is False
    assert M.scan_is_reliable('f("a") + "shut"') is True
    assert M.scan_is_reliable("x = 'a' + 'b' + 'c'") is True
    assert M.scan_is_reliable('a="" + "later"') is True


def test_classify_tolerates_an_entry_with_NO_key_field():
    """Kills `e.get("key", "")` -> `e.get("key", None)` and the dropped default. An entry with no
    key is claimed by nobody and must not match a real mutant or crash."""
    got = M.classify([{"class": "real-gap"}], [{"key": "a"}], {"a"})
    assert [x["key"] for x in got["unclassified"]] == ["a"]


def test_string_only_verdict_examines_EVERY_pair_not_only_up_to_the_first_identical_one():
    """Kills `continue` -> `break`. The FIRST removed/added pair here is identical and the SECOND
    carries a real code change. Under `break` the loop stops at the first pair, never sees the
    change, and reports EMPTY_DIFF — excluding a live mutant from the gate."""
    two_pairs = "--- x\n+++ y\n-    a = 1\n-    b = 2\n+    a = 1\n+    b = 3\n"
    assert M.string_only_verdict(two_pairs)[0] == M.REQUIRED


def test_string_only_verdict_requires_BOTH_sides_readable_not_either():
    """Kills `scan_is_reliable(old) and ...` -> `or`. The span is compared against BOTH sides, so
    either one being fiction makes the verdict a guess. One-bad-one-good must still REFUSE."""
    tq = chr(34) * 3
    assert M.string_only_verdict("--- x\n+++ y\n-    x = f(1)\n+    x = f(2)  # " + tq + "\n")[0] == M.UNDECIDABLE
    assert M.string_only_verdict("--- x\n+++ y\n-    x = f(1)  # " + tq + "\n+    x = f(2)\n")[0] == M.UNDECIDABLE


# ── inputs found by DIFFERENTIAL SEARCH, not by guessing (PR #1891 follow-up) ───────────────────
# My first pass at these was eight hand-picked "adversarial" fixtures. It killed 7 of 30 — I reasoned
# about what SHOULD discriminate rather than measuring what does, which is the same error as the
# fixtures it was meant to fix. So the inputs below were found mechanically: apply each mutant's exact
# line replacement to the real source, exec it, and brute-force a corpus for an input where the
# original and the mutant disagree. Every one is smaller and stranger than anything I would have
# written, which is the point.


def test_scan_is_reliable_on_a_LONE_quote_and_other_minimal_lines():
    """Found by search. Kills four index-arithmetic mutants at once — each needs a line so short that
    a single skipped position changes the verdict:
      `i, n = 0` -> `1`      : '"' — skipping index 0 misses the only quote there is.
      `i += 1`   -> `i += 2` : 'a"' — the scanner steps over the quote entirely.
      `i += 2`   -> `i += 3` : '"\\""' — the escape skip overshoots the terminator."""
    assert M.scan_is_reliable('"') is False
    assert M.scan_is_reliable('a"') is False
    assert M.scan_is_reliable('"' + chr(92) + '""') is True


def test_scan_is_reliable_TERMINATES_on_a_trailing_backslash_escape():
    """🔴 Kills `i += 2` -> `i = 2`, which does not merely give a wrong answer — it NEVER RETURNS.
    Assigning instead of incrementing pins the cursor at 2, so the scan loops forever on any line
    whose escape lands there. Found by search only because the harness treated a hang as a
    distinguishable outcome; a corpus that simply waits would have looked like agreement."""
    assert M.scan_is_reliable('"' + chr(39) + chr(92)) is False


def test_changed_span_with_an_EMPTY_side_and_a_single_character():
    """Found by search. Kills the two suffix-loop bound flips, which need the shortest possible
    inputs: `j < (lo - i)` -> `<=` indexes past the end on ("", "a"), and -> `(lo + i)` walks too far
    on ("a", "aa"). Every prior fixture was at least three characters, where neither bound is tight."""
    assert M.changed_span("", "a") == (0, 0, 1)
    assert M.changed_span("a", "aa") == (1, 1, 2)


def test_scan_is_reliable_distinguishes_its_TRIPLE_QUOTE_sentinels():
    """Found by search. Kills `chr(39) * 3` -> `chr(40) * 3` (which would test for `(((`) and
    -> `chr(39) * 4`. Neither is observable unless a line carries exactly the sentinel being asked
    about, and no prior fixture contained parentheses or a bare triple-apostrophe inside a literal."""
    assert M.scan_is_reliable("(((") is True  # parens are not a quote sentinel
    assert M.scan_is_reliable(chr(39) * 3) is False  # a real triple-apostrophe
    assert M.scan_is_reliable(chr(34) + chr(39) * 3 + chr(34)) is False


def test_string_only_verdict_when_the_change_STRADDLES_a_literal_boundary():
    """Found by search. Kills the `if a <= start and old_end <= b` guard flipping `and` -> `or`:
    the removed line's change starts inside a literal but ends outside it, so accepting either half
    of the guard alone reports STRING_ONLY for a change that is not confined to the literal."""
    straddle = "--- x\n+++ y\n-a" + chr(34) * 2 + "\n+" + chr(34) + "a" + chr(34) + "\n"
    assert M.string_only_verdict(straddle)[0] == M.REQUIRED


# ── the last five survivors (#1891 follow-up) ───────────────────────────────────────────────────


def test_functions_covering_includes_the_DEF_LINE_itself():
    """Kills `if any(lo <= ln <= hi)` -> `lo < ln <= hi`. A changed `def` line is the commonest case
    of all — you changed the signature — and every prior fixture pointed at a line in the BODY, where
    the lower bound is never tight."""
    src = "import os\n\n\ndef alpha():\n    return 1\n"
    assert M.functions_covering(src, {4}) == {"x_alpha"}  # the `def` line
    assert M.functions_covering(src, {5}) == {"x_alpha"}  # and the body


def test_functions_covering_keeps_the_CLASS_context_through_a_nested_function():
    """Kills `visit(child, cls)` -> `visit(child, None)` in the FunctionDef branch. A function nested
    inside a METHOD must stay qualified by its class — mutmut names it `xǁCǁinner`, and losing the
    context yields `x_inner`, a stem that matches no mutant mutmut ever generates. Prior fixtures had
    methods but never a function nested inside one, so the recursion's `cls` was never observed."""
    nested = "class C:\n    def m(self):\n        def inner():\n            return 1\n"
    assert M.functions_covering(nested, {3}) == {"xǁCǁm", "xǁCǁinner"}


def test_classify_treats_a_keyless_entry_as_claiming_the_EMPTY_key():
    """Kills `e.get("key", "")` -> `e.get("key", None)` and the dropped default. The default is only
    observable when the generated set actually CONTAINS the empty string, which is the one input that
    makes `""` and `None` behave differently. Pins current behaviour: a keyless entry claims `""`."""
    entries = [{"class": "no-distinguishing-input"}]
    got = M.classify(entries, [{"key": ""}], {""})
    assert [x["class"] for x in got["excused"]] == ["no-distinguishing-input"]
    assert got["orphaned"] == [] and got["unclassified"] == []


# ── annotation_only: signature re-annotation leaves scope; behaviour never does ─────────────────
def test_annotation_only_excludes_pure_signature_widenings():
    """The measured case (#1946): a one-line widening must strip to an identical AST."""
    ok, why = M.annotation_only("def f(x: float): return x", "def f(x: float | None): return x")
    assert ok is True and "identical" in why


def test_annotation_only_keeps_scope_for_behaviour_and_fails_closed():
    """Each row is a distinct behavioural (or undecidable) difference; every one keeps full scope,
    and the reason names the branch that decided (saw-the-plant on both fields)."""
    rows = [
        ("def f(x: int = 1): return x", "def f(x: int = 2): return x", "behavioural"),
        ("def f(x: int): return x", "def f(y: int): return y", "behavioural"),
        ("def f(x: int): return x", "def f(x: int): return x + 1", "behavioural"),
        ("class C:\n    x: int = 1", "class C:\n    x: float = 1", "behavioural"),
        ("def f(x): return x", "from typing import Any\ndef f(x): return x", "behavioural"),
        ("def f(x: int): return x", "def f(x: int) return x", "parse failed"),
    ]
    for old_src, new_src, want in rows:
        ok, why = M.annotation_only(old_src, new_src)
        assert ok is False and want in why, (old_src, new_src, ok, why)


def test_selftest_reds_on_a_lying_annotation_classifier(monkeypatch):
    """The selftest's OWN failure branch must be reachable — a harness whose FAIL print can never
    execute is a harness nobody has seen fail. A classifier that answers 'excluded' for everything
    must turn the selftest red (this is the permanent form of the build-time negative control)."""
    monkeypatch.setattr(M, "annotation_only", lambda a, b: (True, "stripped ASTs identical"))
    assert M.selftest() == 1


# ── UNDECIDED attribution: which FUNCTION, not just how many ────────────────────────────────────────
# The refusal reported a total and six sample names. That cannot separate "all 116 in one pathological
# function" from "spread across five" — two findings needing opposite responses, and the data was in
# every mutant name already. These pin both real name shapes; the METHOD form is the one a column-0
# assumption keeps missing (see mmeta.generated_under_glob).


def test_function_of_mutant_reads_a_module_level_function():
    assert M.function_of_mutant("x__floor_by_t__mutmut_12") == "_floor_by_t"


def test_function_of_mutant_reads_the_MODULE_QUALIFIED_form_production_actually_sends():
    """🔴 THE FORM THIS FUNCTION IS ACTUALLY CALLED WITH, and it could not read it until 2026-09-19.

    `mutmut results` prints names module-qualified and `mutate_diff.py` passes them through verbatim
    from `split_results`. Every example in the docstring is BARE, these tests were written from those
    examples, and nothing ever fed it the production form — so `by function` grouped 100 % of mutants
    under `?` from the day it shipped, with this file green throughout.

    Measured on a real refusal: 166 undecided, `by function: 166 ?`, zero attributed. The feature
    exists to separate "all in one pathological function" from "spread across several" — the
    measurement that decides whether the remedy is scheduling or the mutants — and it has never once
    produced that answer."""
    assert M.function_of_mutant("gattmap.x__norm__mutmut_1") == "_norm"
    assert M.function_of_mutant("gattmap.x_configure__mutmut_3") == "configure"
    assert M.function_of_mutant("gattmap.xǁCounterǁscaled__mutmut_2") == "Counter.scaled"
    assert M.function_of_mutant("pkg.mod.x_f__mutmut_9") == "f", "a dotted package path is still a prefix"


def test_function_of_mutant_reads_a_METHOD_including_its_class():
    assert M.function_of_mutant("xǁCounterǁscaled__mutmut_2") == "Counter.scaled"
    assert M.function_of_mutant("xǁGapCountersǁtotal_lost__mutmut_3") == "GapCounters.total_lost"


def test_function_of_mutant_declines_rather_than_guesses():
    """A wrong attribution sends a reader to the wrong function — worse than naming none."""
    assert M.function_of_mutant("not_a_mutant") == ""  # no __mutmut_N suffix
    assert M.function_of_mutant("") == ""
    assert M.function_of_mutant("x__mutmut_1") == ""  # suffix, but no name left after `x_`
    assert M.function_of_mutant("ǁǁ__mutmut_1") == ""  # separators, no parts
    # ...and stripping the module qualifier must not turn a decline into a GUESS: a qualified name
    # whose remainder is still unreadable stays unattributed rather than naming the module.
    assert M.function_of_mutant("gattmap.not_a_mutant") == ""
    assert M.function_of_mutant("gattmap.junk__mutmut_1") == ""
    assert M.function_of_mutant("gattmap.x__mutmut_1") == ""


def test_undecided_by_function_counts_and_orders_commonest_first():
    items = [{"mutant": f"x__floor_by_t__mutmut_{i}"} for i in range(5)]
    items += [{"mutant": "xǁCǁs__mutmut_1"}, {"mutant": "xǁCǁs__mutmut_2"}]
    assert M.undecided_by_function(items) == [("_floor_by_t", 5), ("C.s", 2)]


def test_undecided_by_function_attributes_the_QUALIFIED_names_the_refusal_carries():
    """The end-to-end shape of the 2026-09-19 refusal, in the form `mutate_diff.py` builds: every item
    is `{"mutant": <qualified>, "module": …}`. Before the fix this returned `[("?", 7)]` — a summary
    reporting nothing about the set it was summarising."""
    items = [{"mutant": f"gattmap.x__norm__mutmut_{i}", "module": "gattmap.py"} for i in range(5)]
    items += [
        {"mutant": "gattmap.x_configure__mutmut_1", "module": "gattmap.py"},
        {"mutant": "gattmap.x_configure__mutmut_2", "module": "gattmap.py"},
    ]
    assert M.undecided_by_function(items) == [("_norm", 5), ("configure", 2)]


def test_undecided_by_function_groups_the_unattributable_rather_than_dropping_it():
    """A summary that silently omits what it could not parse under-reports its own total."""
    out = M.undecided_by_function([{"mutant": "junk"}, {"mutant": "x__a__mutmut_1"}, {}])
    assert dict(out)["?"] == 2
    assert sum(n for _, n in out) == 3


def test_undecided_by_function_is_empty_safe():
    assert M.undecided_by_function([]) == []
    assert M.undecided_by_function(None) == []


# ── @property: a function this tool CANNOT examine is not a function with nothing to examine ────────
# mutmut generates no mutants for a property whatever its body holds — measured 2026-09-18 on
# `return self.a + self.b`. Reporting that as "no mutable operator" states a property of the CODE for
# what is a limitation of the TOOL. Measured the same day: 45 properties in capture-host, all
# unmutatable, 15 with genuinely mutatable bodies, and all 15 changed this quarter.

_PROP_SRC = (
    "import functools\n"
    "class C:\n"
    "    @property\n"
    "    def total(self):\n        return self.a + self.b\n"
    "    @functools.cached_property\n"
    "    def cached(self):\n        return 1\n"
    "    def plain(self):\n        return 2\n"
    # DECORATED BUT NOT A PROPERTY — the case `plain` cannot cover, because it has no decorators at
    # all. Without this the inner decorator loop never completes un-matched, and the "has decorators,
    # none of them property" path goes untaken. Caught by the branch-coverage floor, not by reading.
    "    @staticmethod\n    def helper():\n        return 3\n"
)


def test_unmutatable_names_the_decorator_for_both_property_forms():
    assert M.unmutatable_decorator(_PROP_SRC, "total") == "property"
    assert M.unmutatable_decorator(_PROP_SRC, "cached") == "cached_property"


def test_an_undecorated_method_and_an_absent_name_are_mutatable():
    assert M.unmutatable_decorator(_PROP_SRC, "plain") == ""
    assert M.unmutatable_decorator(_PROP_SRC, "nope") == ""


def test_a_lone_staticmethod_is_mutmuts_OWN_exemption_and_stays_mutatable():
    """mutmut allows exactly one @staticmethod/@classmethod because trampolines are easy for those.
    Mirroring its rule rather than inventing one is why this returns "" and not "staticmethod"."""
    assert M.unmutatable_decorator(_PROP_SRC, "helper") == ""


def test_the_blind_spot_is_WIDER_than_properties():
    """45 properties, but also 4 @asynccontextmanager and 1 @middleware in capture-host — 50 total.
    Reporting only properties left the other five saying "cause not established" for a known cause."""
    src = (
        "import contextlib, functools\n"
        "@contextlib.asynccontextmanager\n"
        "async def scope():\n    yield 1\n"
        "@functools.lru_cache()\n"
        "def cached_fn():\n    return 2\n"
    )
    assert M.unmutatable_decorator(src, "scope") == "asynccontextmanager"
    assert M.unmutatable_decorator(src, "cached_fn") == "lru_cache"  # the @foo() CALL form counts


def test_unparseable_source_yields_no_claim_rather_than_raising():
    """Empty is the safe direction: a false positive invents a warning nobody can act on."""
    assert M.unmutatable_decorator("def (", "a") == ""
    assert M.unmutatable_decorator("", "a") == ""


def test_source_function_of_glob_reads_the_bare_def_name():
    assert M.source_function_of_glob("cpap_ingest.xǁGapCountersǁtotal_lost__mutmut_*") == "total_lost"
    assert M.source_function_of_glob("m.x_helper__mutmut_*") == "helper"


def test_source_function_of_glob_declines_rather_than_guessing():
    assert M.source_function_of_glob("m.x__mutmut_*") == ""
    assert M.source_function_of_glob("nonsense") == ""
    assert M.source_function_of_glob("") == ""


def test_the_two_name_helpers_answer_DIFFERENT_questions():
    """`function_of_mutant` reports a QUALIFIED name; `source_function_of_glob` returns the bare `def`
    name an AST lookup matches on. One helper serving both would hand the wrong string to one caller."""
    assert M.function_of_mutant("xǁGapCountersǁtotal_lost__mutmut_3") == "GapCounters.total_lost"
    assert M.source_function_of_glob("m.xǁGapCountersǁtotal_lost__mutmut_*") == "total_lost"


# ── in_glob_scope — the harvest must be scoped to the glob that was RUN ──────────────────────────
# The gate runs one `--only '<mod>.x_<func>__mutmut_*'` per CHANGED function but harvested UNDECIDED
# from `mutmut results`, which takes no glob. Every mutant of an untouched function came back
# `not checked` and blocked the run: 553/338/166/116 across four refusals, 100% `not checked`,
# 0% `timeout`. These pin the predicate that scopes it.
def test_in_glob_scope_accepts_a_mutant_the_glob_selects():
    assert M.in_glob_scope("link_rssi.x_resolve_hci__mutmut_7", "link_rssi.x_resolve_hci__mutmut_*")


def test_in_glob_scope_rejects_a_sibling_function_in_the_same_module():
    """The real #2651 case: the diff touched `resolve_hci`, `parse_rssi` was never run."""
    assert not M.in_glob_scope("link_rssi.x_parse_rssi__mutmut_1", "link_rssi.x_resolve_hci__mutmut_*")


def test_in_glob_scope_rejects_the_same_function_in_a_different_module():
    assert not M.in_glob_scope("other.x_resolve_hci__mutmut_1", "link_rssi.x_resolve_hci__mutmut_*")


def test_in_glob_scope_is_case_sensitive():
    """`fnmatchcase`, deliberately: a case-folding match would let a differently-cased generated
    identifier answer for one the gate never ran."""
    assert not M.in_glob_scope("link_rssi.x_Resolve_hci__mutmut_1", "link_rssi.x_resolve_hci__mutmut_*")


def test_in_glob_scope_does_not_match_a_longer_function_name_by_prefix():
    """`x_resolve_hci_extra` must not be selected by `x_resolve_hci__mutmut_*`."""
    assert not M.in_glob_scope("link_rssi.x_resolve_hci_extra__mutmut_1", "link_rssi.x_resolve_hci__mutmut_*")


def test_in_glob_scope_coerces_non_string_inputs_rather_than_raising():
    assert not M.in_glob_scope(None, "link_rssi.x_a__mutmut_*")


def test_in_glob_scope_cannot_see_status_by_construction():
    """🔴 THE DISTINGUISHING CASE: an IN-SCOPE mutant that is `not checked` must still BLOCK.

    Filtering the undecided set by STATUS instead of by SCOPE converts a refusal into a pass for
    mutants nobody measured — the same fabrication `Do NOT raise timeout_multiplier` exists to
    prevent, through a different door, and indistinguishable from the correct fix in the output.
    This pins it structurally rather than by example: the predicate takes (mutant, glob) and has no
    status parameter, so keying on status is impossible without changing the signature — which this
    test would then fail. After the scoping fix the in-scope-and-unchecked case becomes rare, so it
    is exactly the case that would otherwise rot untested.
    """
    import inspect

    assert list(inspect.signature(M.in_glob_scope).parameters) == ["mutant", "glob"]
    # and an in-scope mutant is selected regardless of any status it might carry
    assert M.in_glob_scope("link_rssi.x_resolve_hci__mutmut_1", "link_rssi.x_resolve_hci__mutmut_*")


# ── the RUN BUDGET — residue 2026-09-17-mutation-scope-selects-whole-functions ─────────────────────
def test_budget_refusal_names_every_number_it_used():
    """A refusal must be re-derivable by the reader: module, clean time, the stats pass, what was left.

    The numbers changed with the measurement (owner ruling, board #71 item 3, 2026-10-17): the
    prediction was `clean x (1 + 2.0)` and is now `clean + this module's RECORDED stats pass`."""
    from mutation_diff import GATE_BUDGET_SEC, budget_refusal, prework_estimate

    assert prework_estimate(100.0, 240.0) == 340.0
    # the measured capture.py case: 936.7 s clean, five globs, a fresh budget, and the >= 7556 s stats
    # pass #3238 measured -> REFUSED, where the 2.0 factor predicted 2810 s and let the run start
    why = budget_refusal("capture.py", 936.7, 5, GATE_BUDGET_SEC, 7556.0, "measured on the runner 2026-10-03")
    assert why is not None
    for needle in ("capture.py", "936.7s", "7556s", "8493s", str(GATE_BUDGET_SEC), "5 function(s)", "REFUSAL"):
        assert needle in why, (needle, why)
    assert "measured on the runner 2026-10-03" in why, "the refusal must say where its number came from"
    assert "verdict on the diff" in why
    # a cheap module with the same budget left still fits
    assert budget_refusal("localstamp.py", 0.6, 1, GATE_BUDGET_SEC, 2.0, "measured here") is None
    # the boundary: an estimate exactly equal to what is left still fits
    assert budget_refusal("m.py", 10.0, 1, prework_estimate(10.0, 6.0), 6.0) is None
    assert budget_refusal("m.py", 10.0, 1, prework_estimate(10.0, 6.0) - 0.01, 6.0) is not None
    # with no recorded stats pass there is NO prediction, so this bound raises no refusal...
    assert prework_estimate(10.0, None) is None
    assert budget_refusal("m.py", 10.0, 1, 0.5) is None
    # ...and the provenance clause degrades to a named absence rather than an empty parenthesis
    assert "provenance unrecorded" in (budget_refusal("m.py", 10.0, 1, 1.0, 6.0) or "")


def test_an_unmeasured_prework_bound_says_it_examined_nothing_and_is_not_a_pass():
    """🔴 THE DEFECT THE FACTOR HID. `budget_refusal` returning None used to mean one thing: the
    module fits. With the factor gone it means two — the prediction fitted, or there was no
    prediction — and those are a verdict and the absence of one (§∅, §🧾's NOT_RUN one bound down).
    The note is what keeps them distinguishable in the log and in the JSON."""
    from mutation_diff import prework_unmeasured_note

    note = prework_unmeasured_note("writers.py", 12.3, 4, "no recorded stats pass for writers.py (abc123)")
    assert "writers.py" in note and "12.3s" in note and "4 function(s)" in note
    assert "NOT evaluated" in note
    assert "not a verdict that the module fits" in note, "silence here is exactly what must not be a pass"
    assert "--record-prework" in note, "an absence a reader cannot close is a permanent one"
    assert "abc123" in note


def test_the_stats_pass_is_measured_between_two_observed_boundaries_or_not_at_all():
    """A run killed in generation and a run that tested nothing both have a well-formed elapsed time
    and measured no stats pass — the #3238 shape, 618 spinner lines and zero mutant ticks."""
    from mutation_diff import stats_pass_seconds

    assert stats_pass_seconds(10.0, 310.0) == 300.0
    assert stats_pass_seconds(None, 310.0) is None, "generation never finished: nothing was measured"
    assert stats_pass_seconds(10.0, None) is None, "no mutant ever reported: nothing was measured"
    assert stats_pass_seconds(None, None) is None
    assert stats_pass_seconds(310.0, 10.0) is None, "out of order is not a negative stats pass"
    assert stats_pass_seconds(10.0, 10.0) == 0.0, "a zero-length pass is still an observation"


def test_the_prework_record_is_keyed_on_the_selection_and_a_miss_is_absence():
    """The cost is the SELECTION's, so the key is the selection's. A miss must be absent and never
    the nearest module, for the reason `mutants_size_record` states about a size from another hash."""
    from mutation_diff import merge_prework, prework_record, selection_hash

    a = selection_hash(["tests/test_b.py", "tests/test_a.py"])
    assert a == selection_hash(["tests/test_a.py", "tests/test_b.py"]), "order is not part of the selection"
    assert a != selection_hash(["tests/test_a.py"]), "a selection that lost a file is a different key"
    assert len(a) == 12

    text = merge_prework("", "localstamp.py", a, 2.0, 0.6, "2026-10-17", "rig-x870")
    rec = prework_record(text)
    assert rec[("localstamp.py", a)]["statsSec"] == 2.0
    assert rec[("localstamp.py", a)]["cleanSec"] == 0.6
    assert rec[("localstamp.py", a)]["host"] == "rig-x870"
    assert rec[("localstamp.py", a)]["measuredAt"] == "2026-10-17"
    assert text.endswith("\n") and '"schema": "tepna.mutation-prework/1"' in text

    # a malformed or absent record is EMPTY, never a partial one a reader would trust
    assert prework_record("") == {}
    assert prework_record("{not json") == {}
    assert prework_record("{}") == {}
    assert prework_record('{"prework": null}') == {}
    assert prework_record('{"prework": {"bad-key": {"statsSec": 2}}}') == {}, "a key with no @hash is not a row"
    assert prework_record('{"prework": {"@abc": {"statsSec": 2}}}') == {}
    assert prework_record('{"prework": {"m.py@": {"statsSec": 2}}}') == {}
    assert prework_record('{"prework": {"m.py@abc": 2}}') == {}, "a bare number carries no provenance"
    assert prework_record('{"prework": {"m.py@abc": {"statsSec": 0}}}') == {}, "zero is absence, not a pass"
    assert prework_record('{"prework": {"m.py@abc": {"statsSec": -5}}}') == {}
    assert prework_record('{"prework": {"m.py@abc": {"statsSec": "slow"}}}') == {}
    assert prework_record('{"prework": {"m.py@abc": {"statsSec": true}}}') == {}, "a bool is not a measurement"
    # the stats time can stand without a clean run; the clean run is then absent, never zero
    for bad_clean in ("0", "-1", "true", '"quick"', "null"):
        one = prework_record('{"prework": {"m.py@abc": {"statsSec": 2, "cleanSec": %s}}}' % bad_clean)
        assert one[("m.py", "abc")]["cleanSec"] is None, bad_clean


def test_a_replaced_measurement_keeps_the_number_it_replaced():
    """The newer run describes this tree, so it wins — but a number that moved silently is the thing
    `tools/mutation-sizes.json` keeps `supersedes` for, and the argument is identical here."""
    from mutation_diff import merge_prework, prework_record

    first = merge_prework("", "alerts.py", "abc", 4.0, 1.0, "2026-10-17", "rig-x870")
    again = merge_prework(first, "alerts.py", "abc", 4.0, 1.0, "2026-10-17", "rig-x870")
    assert "supersedes" not in again, "an unchanged measurement is not a supersession"
    moved = merge_prework(first, "alerts.py", "abc", 9.0, 1.1, "2026-10-18", "vigil")
    assert prework_record(moved)[("alerts.py", "abc")]["statsSec"] == 9.0
    assert '"supersedes": 4.0' in moved
    # a corrupt file is rebuilt rather than appended to, and the new row survives it
    assert prework_record(merge_prework("{not json", "alerts.py", "abc", 4.0, 1.0, "2026-10-17", "h"))
    # keys stay sorted, so two sessions recording different modules do not reorder each other's rows
    two = merge_prework(first, "aaa.py", "abc", 1.0, 1.0, "2026-10-17", "rig-x870")
    assert two.index('"aaa.py@abc"') < two.index('"alerts.py@abc"')


def test_a_cached_stats_time_from_a_different_machine_is_absent_not_rescaled():
    """🔴 THE SECOND ASSUMPTION THE UNIT REFUSED TO MAKE. A hosted runner measured 1432 s where the rig
    measured 937 s on one module (#3202), so a cached stats time does not travel freely. The record
    carries the clean run it was measured beside, and outside a pre-stated factor the number is
    treated as ABSENT — never multiplied by a ratio, which would be the old factor in new clothes."""
    from mutation_diff import PREWORK_CLEAN_DRIFT, cached_stats_sec, prework_stale_reason, selection_hash

    assert PREWORK_CLEAN_DRIFT == 2.0
    assert prework_stale_reason(10.0, 10.0) is None
    assert prework_stale_reason(20.0, 10.0) is None, "exactly the factor still describes the run"
    assert prework_stale_reason(5.0, 10.0) is None
    assert "different machine" in (prework_stale_reason(20.1, 10.0) or "")
    assert "different machine" in (prework_stale_reason(4.9, 10.0) or "")
    assert "no clean run of its own" in (prework_stale_reason(10.0, None) or "")
    assert "no clean run of its own" in (prework_stale_reason(10.0, 0) or "")

    tests = ["tests/test_alerts.py"]
    sel = selection_hash(tests)
    rec = {("alerts.py", sel): {"statsSec": 4.0, "cleanSec": 1.0, "measuredAt": "2026-10-17", "host": "rig-x870"}}
    secs, basis = cached_stats_sec(rec, "alerts.py", tests, 1.2)
    assert secs == 4.0 and "rig-x870" in basis and "2026-10-17" in basis and sel in basis
    # the same record, a machine three times slower: no number, and the reason says which check failed
    secs, why = cached_stats_sec(rec, "alerts.py", tests, 3.1)
    assert secs is None and "different machine" in why
    # a module with no row at all names the selection it looked for, so the absence is closable
    secs, why = cached_stats_sec(rec, "writers.py", tests, 1.0)
    assert secs is None and "writers.py" in why and sel in why
    # provenance that was never recorded is named as missing rather than printed as empty
    thin = {("alerts.py", sel): {"statsSec": 4.0, "cleanSec": 1.0, "measuredAt": None, "host": None}}
    _, basis = cached_stats_sec(thin, "alerts.py", tests, 1.0)
    assert "an unnamed host" in basis and "on an unrecorded date" in basis


def test_the_prework_record_survives_every_shape_the_diff_gate_mutated():
    """The 16 survivors #3622's diff-scoped gate named, each pinned by the input that separates it."""
    import json

    from mutation_diff import cached_stats_sec, merge_prework, prework_record, prework_unmeasured_note, selection_hash

    # the drift argument reaches the staleness check: a tight factor refuses what the default accepts
    tests = ["tests/test_alerts.py"]
    rec = {("alerts.py", selection_hash(tests)): {"statsSec": 4.0, "cleanSec": 1.0}}
    assert cached_stats_sec(rec, "alerts.py", tests, 1.5)[0] == 4.0
    secs, why = cached_stats_sec(rec, "alerts.py", tests, 1.5, drift=1.1)
    assert secs is None and "factor of 1.1" in why

    # the note is written under its own key and says what the file is
    doc = json.loads(merge_prework("", "alerts.py", "abc", 1.234, 0.567, "2026-10-17", "h"))
    assert sorted(doc) == ["note", "prework", "schema"]
    assert doc["note"].startswith("Measured stats-pass seconds") and "NEVER hand-edited" in doc["note"]
    # one decimal, both numbers
    assert doc["prework"]["alerts.py@abc"]["statsSec"] == 1.2
    assert doc["prework"]["alerts.py@abc"]["cleanSec"] == 0.6
    # the committed file is two-space indented, so a re-record diffs line by line
    text = merge_prework("", "alerts.py", "abc", 1.0, 1.0, "2026-10-17", "h")
    assert text == json.dumps(json.loads(text), indent=2) + "\n"

    # the module name is everything before the FIRST @: a selection hash never carries one, a key may
    assert set(prework_record('{"prework": {"m.py@a@b": {"statsSec": 2}}}')) == {("m.py", "a@b")}
    # a bad row is skipped, never the end of the record
    skip_key = '{"prework": {"bad": {"statsSec": 2}, "m.py@abc": {"statsSec": 2}}}'
    assert set(prework_record(skip_key)) == {("m.py", "abc")}
    skip_stats = '{"prework": {"a.py@abc": {"statsSec": 0}, "m.py@abc": {"statsSec": 2}}}'
    assert set(prework_record(skip_stats)) == {("m.py", "abc")}
    # a sub-second stats pass is a measurement: only a non-positive one is absence
    assert prework_record('{"prework": {"m.py@abc": {"statsSec": 0.5}}}')[("m.py", "abc")]["statsSec"] == 0.5

    # the command names the module without its .py
    note = prework_unmeasured_note("capture.py", 1.0, 1, "why")
    assert "`tools/mutate.py capture --record-prework`" in note


def test_the_gate_both_reads_the_record_and_reports_the_absence():
    """The two halves are one contract: `tools/mutate_diff.py` must pass the cached number to the
    bound AND print the note when there is none. A caller that did only the first would turn an
    unmeasured module into a silent pass, which is the state this unit left behind."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "tools", "mutate_diff.py"), encoding="utf-8") as fh:
        src = fh.read()
    assert "prework_record(" in src, "the committed record is what CI's fresh scratch has"
    assert "cached_stats_sec(" in src
    assert "prework_unmeasured_note(" in src
    assert 'verdict["preworkUnmeasured"]' in src, "a reader of the JSON must see the bound that examined nothing"
    assert "PREWORK_TRACE_FACTOR" not in src


# ── tepna.verdict/1 — VERDICT-CONTRACT §3b step 5: the gate's ONE object ────────────────────────────
def test_verdict_object_maps_every_gate_outcome_onto_the_closed_enum():
    from mutation_diff import VERDICT_STATUSES, verdict_object

    common = dict(
        result={"generated": 1, "decided": 1, "killed": 1, "survived": 0, "undecided": 0, "excused": 0},
        evidence=["capture-host/tools/mutate_diff.py"],
        commit="abcdef1",
        at="2026-09-22T00:00:00Z",
        base="origin/main",
    )
    o = verdict_object("PASS", checked=3, eligible=4, reason=None, **common)
    assert o["schema"] == "tepna.verdict/1" and o["gate"] == "mutate-diff" and o["scope"] == "internal"
    assert o["population"] == {"checked": 3, "eligible": 4, "excluded": 1}, (
        "population is an equality — excluded is derived, never guessed"
    )
    assert o["criterion"] == {
        "name": "survivors_on_changed_lines",
        "threshold": 0,
        "unit": "mutants",
        "direction": "lte",
    }
    assert (
        o["result"]["killed"] == 1
        and o["reason"] is None
        and o["producedBy"] == {"tool": "capture-host/tools/mutate_diff.py", "commit": "abcdef1"}
    )
    # the states that read as green to a regex carry result: null and a reason
    for st in ("NOT_RUN", "NOT_APPLICABLE"):
        n = verdict_object(st, checked=0, eligible=0, reason="why", **common)
        assert n["result"] is None and n["reason"] == "why"
    u = verdict_object("UNKNOWN", checked=1, eligible=2, reason="1 undecided", **common)
    assert u["result"] is not None and u["population"]["excluded"] == 1
    # outside a checkout: commit None WITH a reason (∅)
    nc = verdict_object("FAIL", checked=1, eligible=1, reason="2 survived", **{**common, "commit": None})
    assert nc["producedBy"]["commit"] is None and nc["producedBy"]["commitReason"]
    # the enum is closed and the reason rules bind at construction — a wrong object cannot be built
    import pytest

    with pytest.raises(ValueError, match="closed enum"):
        verdict_object("PASSED", checked=1, eligible=1, reason=None, **common)
    with pytest.raises(ValueError, match="PASS carries reason: null"):
        verdict_object("PASS", checked=1, eligible=1, reason="but", **common)
    with pytest.raises(ValueError, match="requires a reason"):
        verdict_object("FAIL", checked=1, eligible=1, reason=None, **common)
    with pytest.raises(ValueError, match="checked 2 > eligible 1"):
        verdict_object("PASS", checked=2, eligible=1, reason=None, **common)
    assert len(VERDICT_STATUSES) == 7 and "PASS" in VERDICT_STATUSES and "NOT_APPLICABLE" in VERDICT_STATUSES


# ── clean_run_failures: the gate NAMES the test that broke mutmut's baseline ──────────────────────
# Residue 2026-09-09-alert-poller-test-order-dependent: the refusal read "REFUSED" about a change the
# gate never examined, on a test that is not about the change, and the test's name was in the streamed
# output the whole time. These pin the reader to the REAL shapes from CI (run 34374737213, 2026-09-09;
# run 35521002535, 2026-09-20), not to a shape guessed from the docs.

_CI_TAIL_2026_09_09 = """\
  Full diff:
  + []
  - [
  -     'Tepna: sensor offline',
  -     'Tepna: sensor recovered',
  - ]
=========================== short test summary info ============================
FAILED tests/test_capture_runners.py::test_alert_poller_fires_on_a_sustained_offline_then_recovers - AssertionError: assert [] == ['Tepna: sens...or recovered']
  Right contains 2 more items, first extra item: 'Tepna: sensor offline'
!!!!!!!!!!!!!!!!!!!!!!!!!! stopping after 1 failures !!!!!!!!!!!!!!!!!!!!!!!!!!!
1 failed, 374 passed, 1 deselected in 4.81s
Failed to run clean test
"""


def test_clean_run_failures_names_the_test_from_the_real_2026_09_09_ci_tail():
    assert M.clean_run_failures(_CI_TAIL_2026_09_09) == [
        "tests/test_capture_runners.py::test_alert_poller_fires_on_a_sustained_offline_then_recovers"
    ]


def test_clean_run_failures_is_empty_without_mutmuts_clean_run_marker_even_if_a_FAILED_line_appears():
    """A FAILED line alone is a mutant being killed inside a normal run, not a broken baseline — the
    marker is mutmut's own `Failed to run clean test`, and without it the helper must say nothing."""
    text = "FAILED tests/test_x.py::test_y - AssertionError\n1 failed, 3 passed in 0.1s\n"
    assert M.clean_run_failures(text) == []


def test_clean_run_failures_reads_an_ERROR_at_setup_and_dedups_the_repeated_summary_line():
    """The 2026-09-19 shape: a fixture missing from the scratch ERRORS at setup (no FAILED line at all),
    and pytest repeats the id in `-x`'s banner — one id, once."""
    text = (
        "ERROR tests/test_seam_sidecar.py::test_seam_bound_parity - FileNotFoundError: ../ecgdex-dsp.js\n"
        "ERROR tests/test_seam_sidecar.py::test_seam_bound_parity\n"
        "FAILED tests/test_writers_sidecars.py::test_z - KeyError\n"
        "1 failed, 1 error in 0.3s\n"
        "Failed to run clean test\n"
    )
    assert M.clean_run_failures(text) == [
        "tests/test_seam_sidecar.py::test_seam_bound_parity",
        "tests/test_writers_sidecars.py::test_z",
    ]


def test_clean_run_failures_ignores_prose_that_merely_quotes_the_tokens():
    text = "    # a docstring saying FAILED tests/x.py::y is not a failure\nFailed to run clean test\n"
    assert M.clean_run_failures(text) == []


# ── A FLOAT-THRESHOLD MUTANT IS DISTINGUISHABLE ON A MEASURE-ZERO SET ─────────────────────────────
# Measured 2026-09-25 on `x_qc_digest__mutmut_37`: `(hi - lo) < 0.05` → `<=` survived a
# character-exact golden over every render branch, because the two differ ONLY where the subtraction
# lands exactly on the representable 0.05. The fixture anyone reaches for — a clean 0.90/0.95 gap —
# renders identically under both operators, so a probe built from it reports "no distinguishing
# input" and the mutant gets ledgered EQUIVALENT. These pin the guard that refuses that entry.
_K37 = '- pct = f"{lo * 100:.0f}%" if (hi - lo) < 0.05 else y | + pct = f"{lo * 100:.0f}%" if (hi - lo) <= 0.05 else y'


def test_float_boundary_refuses_an_entry_whose_probe_only_sampled():
    why = M.float_boundary_unprobed(_K37, "ran 0.90/0.95 and 0.10/0.15; output identical")
    assert why and "0.05" in why and "UNPROVEN" in why


def test_float_boundary_accepts_a_probe_that_names_the_constructed_boundary():
    assert M.float_boundary_unprobed(_K37, "constructed lo=0.0 hi=0.05 — exactly 0.05; renders 0–5%") is None


def test_float_boundary_refuses_when_there_is_no_probe_at_all():
    assert M.float_boundary_unprobed(_K37, None) is not None


def test_float_boundary_names_only_the_threshold_not_the_format_spec():
    # `{lo * 100:.0f}` contains `.0`. Naming it would point the reader at a literal nobody wrote.
    why = M.float_boundary_unprobed(_K37, None)
    assert "`0.05`" in why and "`.0`" not in why


def test_float_boundary_stays_out_of_an_integer_threshold():
    # An int comparison has no measure-zero problem: sampling 4/5/6 genuinely settles it.
    assert M.float_boundary_unprobed("- if n < 5 | + if n <= 5", "sampled 4, 5, 6") is None


def test_float_boundary_stays_out_of_arithmetic_on_a_float():
    assert M.float_boundary_unprobed("- x = a * 0.05 | + x = a / 0.05", "anything") is None


def test_float_boundary_ignores_a_key_that_is_not_a_pair():
    assert M.float_boundary_unprobed("- only a minus side 0.05 <", "p") is None
    assert M.float_boundary_unprobed("", "p") is None


def test_float_boundary_needs_the_literal_on_BOTH_sides():
    # a literal that appears only in the mutant is a changed CONSTANT, not a threshold flip
    assert M.float_boundary_unprobed("- if d < 0.05 | + if d < 0.07", "p") is None


def test_classify_routes_an_unproven_entry_out_of_excused():
    entries = [{"key": _K37, "class": "no-distinguishing-input", "probe": "ran 0.90/0.95"}]
    out = M.classify(entries, [{"key": _K37}], set(), generated=[_K37])
    assert out["excused"] == [] and len(out["unproven"]) == 1
    assert "0.05" in out["unproven"][0]["why"]


def test_classify_still_excuses_when_the_boundary_is_named():
    entries = [{"key": _K37, "class": "no-distinguishing-input", "probe": "constructed 0.05 exactly"}]
    out = M.classify(entries, [{"key": _K37}], set(), generated=[_K37])
    assert len(out["excused"]) == 1 and out["unproven"] == []


def test_classify_leaves_a_non_float_excuse_alone():
    k = "- if n < 5 | + if n <= 5"
    out = M.classify([{"key": k, "class": "untestable-by-design"}], [{"key": k}], set(), generated=[k])
    assert len(out["excused"]) == 1 and out["unproven"] == []


# ── THE PRINTED MUTANT MUST BE COMPLETE ───────────────────────────────────────────────────────────
# The survivor record carries `diff` (mutmut stdout, capped at 400 bytes) AND `changed` (the -/+ pair
# over the UNCAPPED stdout). The cap was noticed and `changed` was added; the PRINTER kept reading
# `diff`, so the console — the only artifact in a CI log — truncated mid-literal. Reading one mutant
# cost four dead ends and a local regeneration (Heron, 2026-09-25).
_LONG_MINUS = '-    pct = f"{lo * 100:.0f}%" if (hi - lo) < 0.05 else f"{lo * 100:.0f}-{hi * 100:.0f}%"'
_LONG_PLUS = _LONG_MINUS.replace("-    pct", "+    pct", 1).replace("< 0.05", "<= 0.05")


def test_mutant_changed_lines_prints_the_pair_complete():
    sv = {"changed": _LONG_MINUS + " | " + _LONG_PLUS, "diff": _LONG_MINUS[:40]}
    out = M.mutant_changed_lines(sv)
    assert len(out) == 2
    # the whole point: the literal is not cut — both ends of each line survive
    assert out[0].endswith('%"') and out[1].endswith('%"')
    assert "<= 0.05" in out[1]


def test_mutant_changed_lines_does_not_read_the_capped_field_when_changed_is_present():
    # `diff` here is deliberately a LIE (empty). If the printer read it, the mutant would vanish.
    sv = {"changed": _LONG_MINUS + " | " + _LONG_PLUS, "diff": ""}
    assert len(M.mutant_changed_lines(sv)) == 2


def test_mutant_changed_lines_falls_back_to_diff_when_changed_is_absent():
    # older records, and any path that never set `changed`, still print something rather than nothing
    out = M.mutant_changed_lines({"diff": _LONG_MINUS + "\n" + _LONG_PLUS})
    assert out == [_LONG_MINUS, _LONG_PLUS]


def test_mutant_changed_lines_drops_the_file_header_rows_in_the_fallback():
    out = M.mutant_changed_lines({"diff": "--- a/x.py\n+++ b/x.py\n" + _LONG_MINUS})
    assert out == [_LONG_MINUS]


def test_mutant_changed_lines_does_not_cut_a_line_at_a_pipe_inside_it():
    """Residue 2026-10-11-mutation-survivor-render-truncates-at-the-annotation. `diff_key` joins the -/+ lines
    with ` | `, and a `dict | None` annotation (or a `a | b` expression) carries the same three characters,
    so the printer cut the line there and `x_night_entry__mutmut_18` rendered as `- scope: dict` /
    `+ scope: dict` — an apparently empty diff, i.e. a mutmut artefact nobody can kill."""
    d = _d("    scope: dict | None = _sc if x else y", "    scope: dict | None = None if x else y")
    out = M.mutant_changed_lines({"changed": M.diff_key(d)})
    assert out == ["- scope: dict | None = _sc if x else y", "+ scope: dict | None = None if x else y"]
    # a bitwise-or expression, on both sides, round-trips too
    e = M.mutant_changed_lines({"changed": M.diff_key(_d("    f = a | b", "    f = a & b"))})
    assert e == ["- f = a | b", "+ f = a & b"]


def test_mutant_changed_lines_on_an_empty_record_is_empty_not_a_crash():
    assert M.mutant_changed_lines({}) == []
    assert M.mutant_changed_lines({"changed": "   ", "diff": ""}) == []


# ── THE GATE FOUND THESE, OVER THE FIX THAT ADDED IT ──────────────────────────────────────────────
# #3080's diff-scoped mutation run surfaced six survivors in the new guard. Three pointed at one dead
# `if not minus or not plus` (the intersection already covered every case it guarded); removing it
# killed all three AND made the `next(...)` defaults observable. These three kill the rest.
def test_an_unproven_entry_keeps_the_ORIGINAL_entry_not_just_the_reason():
    """`dict(e, why=...)` → `dict(why=...)` survived: asserting only `why` never noticed the entry's
    own key and class being dropped, which is what a reader needs to FIND the row."""
    entries = [{"key": _K37, "class": "no-distinguishing-input", "probe": "ran 0.90/0.95"}]
    out = M.classify(entries, [{"key": _K37}], set(), generated=[_K37])
    e = out["unproven"][0]
    assert e["key"] == _K37 and e["class"] == "no-distinguishing-input"


def test_a_literal_on_ONE_side_only_does_not_satisfy_the_threshold_test():
    """`set(minus) & set(plus)` → `set(minus)` survived because the BOTH-sides fixture also failed the
    flip test, so two guards masked each other. This one flips AND differs, so only the intersection
    separates them."""
    k = "- if d < 0.05 | + if d <= 0.07"
    assert M.float_boundary_unprobed(k, "sampled some values") is None


def test_a_comparison_on_ONE_side_only_is_not_a_FLIP():
    """`in minus and in plus` → `or` survived: every fixture had the operator on both sides. A key
    whose minus carries `<` and whose plus carries no comparison at all separates them."""
    k = "- if d < 0.05 and q | + if d < 0.05 or q"
    assert M.float_boundary_unprobed(k, "sampled some values") is None


def test_a_key_with_only_one_side_is_still_refused_without_the_guard():
    """The removed guard's job, done by the intersection — pinned so nobody reinstates it."""
    assert M.float_boundary_unprobed("- only a minus side 0.05 <", "p") is None
    assert M.float_boundary_unprobed("+ only a plus side 0.05 <=", "p") is None


def test_a_change_inside_an_F_STRING_FIELD_is_REQUIRED_not_string_only():
    """mutmut 3.8 mutates the code inside `{...}` — `a(None)`, `y - 1`, `y + 2` measured on
    `f"{a(y)}-{y + 1}"` on 2026-09-26 — and generates NO text mutant for an f-string at all. Every one
    of those read `string-only` and the gate EXCLUDED it: fail-OPEN, on 3.11 and 3.13 alike, because
    `_string_spans` is a hand scanner and an f-string's fields were text to it. #3098 asked whether
    this tool shared `find_unwired`'s pre-3.12 tokenizer blind spot; it did not — it had this one."""
    want = (M.REQUIRED, "the changed token is inside an f-string field - code, not text")
    for old, new in (
        ('    x = f"{a(y)}-{y + 1}"', '    x = f"{b(y)}-{y + 1}"'),
        ('    x = f"{a(y)}-{y + 1}"', '    x = f"{a(None)}-{y + 1}"'),
        ('    x = f"{a(y)}-{y + 1}"', '    x = f"{a(y)}-{y - 1}"'),
        ("    x = F'{a(y)}'", "    x = F'{b(y)}'"),  # upper-case prefix
        ('    x = rf"{a(y)}\\n"', '    x = rf"{b(y)}\\n"'),  # combined prefix
        ("    x = f\"{d['k']}\"", "    x = f\"{d['j']}\""),  # the OTHER quote nested
        ('    x = f"{b}a"', '    x = f"ba"'),  # a field only on the OLD side
        ('    x = f"ba"', '    x = f"{b}a"'),  # ...and only on the NEW side
        ('    x = f"t{a}"', '    x = f"t(a}"'),  # the `{` itself changed
        ('    x = f"{a}t"', '    x = f"{a)t"'),
    ):  # the `}` itself changed
        assert M.string_only_verdict(_d(old, new)) == want, (old, new)
        assert M.is_string_only(_d(old, new)) is False, (old, new)
    # The TEXT of an f-string is still text: a wording change between fields stays string-only, and so
    # does one inside an escaped `{{...}}`, which is not a field. A plain literal's braces are text too.
    for old, new in (
        ('    x = f"started {n}"', '    x = f"begun {n}"'),
        ('    x = f"{{lit}} {n}"', '    x = f"{{LIT}} {n}"'),
        ('    x = f"t{a}"', '    x = f"u{a}"'),  # the character right BEFORE `{`
        ('    x = f"{a}t"', '    x = f"{a}u"'),  # ...and right AFTER `}`
        ('    x = "{a(y)}"', '    x = "{b(y)}"'),
    ):
        assert M.string_only_verdict(_d(old, new))[0] == M.STRING_ONLY, (old, new)


def test_fstring_expr_spans_are_EXACT_and_run_to_the_literals_end_on_an_unterminated_field():
    f = M._fstring_expr_spans
    assert f('f"{a(y)}-{y + 1}"') == [(2, 8), (9, 16)]  # `{`…`}` inclusive, exactly
    assert f('x = "{a}" + f"{b}"') == [(14, 17)]  # only the f-prefixed literal has fields
    assert f('rf"{a}" F\'{b}\' fr"{c}" bf"x"') == [(3, 6), (10, 13), (18, 21)]  # any prefix carrying an f
    assert f('f"{{not}} {yes} {{}}"') == [(10, 15)]  # `{{` / `}}` are text
    assert f('f"{d[{1: 2}[1]]:{w}}"') == [(2, 20)]  # nested braces stay inside their field
    assert f('f"{a"') == [(2, 5)]  # unterminated: to the literal\'s end, fail-CLOSED
    assert f('f"{a}" + x') == [(2, 5)]  # column 0: the prefix walk stops at 0
    assert f('if t: s = "{a}"') == []  # an `f` earlier on the line is not a prefix
    assert f('f"{{{x}}}"') == [(4, 7)]  # `{{`, then a field, then `}}`
    assert f('f"{}{a}"') == [(2, 4), (4, 7)]  # not valid Python — pins that the scan starts AT the first field char
    assert f('f"{a}}}"') == [(2, 5)]  # a field, then an escaped `}}` — the FIRST `}` closes the field
    assert f('f"a}{c}"') == [(4, 7)]  # a lone `}` at depth 0 is text, not a close
    assert f('f"{a}"{') == [(2, 5)]  # a brace AFTER the literal is not inside it
    assert f('"{a}"') == [] and f("plain") == []


def test_selftest_NAMES_the_f_string_check_that_failed(monkeypatch, capsys):
    """The three f-string pins in `selftest` each print a line naming what broke; a pin whose
    message is `None` would still return 1 but tell the next reader nothing. Force each to fail."""
    monkeypatch.setattr(M, "_fstring_expr_spans", lambda line: [])
    assert M.selftest() == 1
    out = capsys.readouterr().out
    assert "a mutant inside an f-string field is hidden as string-only" in out
    assert "_fstring_expr_spans mislocates the fields" in out
    monkeypatch.undo()
    monkeypatch.setattr(M, "is_string_only", lambda diff: False)
    assert M.selftest() == 1
    assert "an f-string's TEXT is no longer string-only" in capsys.readouterr().out


def test_report_only_refusal_note_is_blocking_in_the_gating_modes_words():
    """--report-only means 'never exit non-zero', not 'advisory' — the note must say BLOCKING and say
    the survivor report that follows is informational, in the words the gating mode uses (exit 2)."""
    note = M.report_only_refusal_note(True)
    assert "BLOCKING" in note and "exits 2" in note and "INFORMATIONAL" in note and "UNKNOWN" in note


def test_report_only_refusal_note_is_silent_when_the_gate_actually_gates():
    """Without the flag the gate exits at the refusal and prints nothing after it, so no note is owed
    — a note there would claim a report follows when none does."""
    assert M.report_only_refusal_note(False) == ""


# ── the interpreter the gate runs mutmut under (`2026-09-27-mutate-diff-cannot-run-in-a-worktree`) ──
#
# Every one of these is a decision that used to be a hardcoded path, and each direction of getting it
# wrong is silent: pick nothing and the gate refuses on a machine where it works; pick the WRONG venv
# and the run's identity is unreadable — it measured a tree the caller did not name.


def test_an_explicit_override_wins_even_when_a_local_venv_exists():
    """A caller who names an interpreter has a reason the tool cannot see. Preferring a local venv over
    an explicit override would answer a question nobody asked, and the run's identity — which
    interpreter, which mutmut — would not be recoverable from the verdict."""
    got, note = M.resolve_interpreter("/opt/py", ["/wt/.venv/bin/python"], lambda p: True)
    assert got == "/opt/py", note
    assert "/opt/py" in note


def test_an_override_that_does_not_EXIST_refuses_and_names_it_rather_than_falling_through():
    """Falling through to a venv the caller did not ask for is the fail-open: the gate would run, report
    green, and the green would be about a different interpreter than the one requested."""
    got, note = M.resolve_interpreter("/opt/missing", ["/wt/.venv/bin/python"], lambda p: p != "/opt/missing")
    assert got is None
    assert "/opt/missing" in note, note


def test_the_candidates_are_tried_IN_ORDER_so_the_primary_checkout_beats_a_worktree():
    """The order is the whole fix. A worktree has no venv of its own; the primary checkout's is the one
    that exists, and preferring it is what makes the gate runnable from a worktree at all — instead of
    each worktree carrying a several-hundred-MB duplicate (the root volume hit 95 % that way)."""
    seen = []

    def exists(p):
        seen.append(p)
        return p == "/primary/.venv/bin/python"

    got, _ = M.resolve_interpreter(None, ["/primary/.venv/bin/python", "/wt/.venv/bin/python"], exists)
    assert got == "/primary/.venv/bin/python"
    assert seen == ["/primary/.venv/bin/python"], "it must stop at the first hit, not probe them all"


def test_no_interpreter_anywhere_REFUSES_and_lists_every_path_it_tried():
    """A refusal that does not say what it looked for cannot be acted on. This is the message a
    developer in a fresh worktree sees, so it carries the remedy and the evidence."""
    got, note = M.resolve_interpreter(None, ["/a/python", "/b/python"], lambda p: False)
    assert got is None
    assert "/a/python" in note and "/b/python" in note, note
    assert "MUTATE_DIFF_PYTHON" in note, "the refusal must name the override that fixes it"


def test_an_EMPTY_candidate_list_still_refuses_with_a_readable_note():
    """Not a crash and not an empty string: `join` of nothing is "", and a refusal reading `Tried: ` is
    the shape of a message that was never finished."""
    got, note = M.resolve_interpreter(None, [], lambda p: False)
    assert got is None
    assert note.strip() and "Tried:" in note and "no candidates" in note, note


# ── a PASS over nothing is not a pass (`2026-09-27-mutate-diff-passes-over-a-zero-population`) ──────


def test_a_PASS_that_examined_nothing_becomes_NOT_APPLICABLE_with_the_reason():
    """CLAUDE.md §🧾: a PASS over `checked: 0` is INVALID. The gate emitted one whenever Python changed
    and every changed line fell outside mutation scope — each file correctly announced as skipped, then
    a green as though something had been examined."""
    st, why = M.zero_population_verdict("PASS", 0, None)
    assert st == "NOT_APPLICABLE"
    assert why and "outside mutation scope" in why and "not a pass" in why, why


def test_a_PASS_over_a_REAL_population_is_left_alone():
    st, why = M.zero_population_verdict("PASS", 3, None)
    assert (st, why) == ("PASS", None)


def test_a_REFUSAL_or_a_FAILURE_over_zero_passes_through_UNTOUCHED():
    """Only PASS is downgraded. A NOT_RUN over zero is already honest about itself, and rewriting a FAIL
    here would be the fail-open this function exists to remove."""
    for st in ("NOT_RUN", "FAIL", "UNKNOWN", "NOT_APPLICABLE"):
        assert M.zero_population_verdict(st, 0, "because") == (st, "because"), st


# ── the verdict's own numbers (`2026-09-24-mutate-diff-result-block-inconsistent` + `…double-counted`) ──


def _res(**kw):
    # The default BALANCES: killed 6 + survived 2 = decided 8, with nothing set aside. A default that
    # left a decided mutant in no bucket would make the residual check below fire on every test that
    # overrides something else, which is the shape that hid #3654's six.
    base = {
        "generated": 10,
        "decided": 8,
        "killed": 6,
        "survived": 2,
        "undecided": 1,
        "excused": 0,
        "refuted": 0,
        "notRequired": 0,
        "emptyDiff": 0,
    }
    base.update(kw)
    return base


def test_a_self_consistent_result_block_reports_nothing():
    assert M.result_inconsistency(_res(), survivors_len=2, undecided_len=1) is None


def test_the_ARTIFACT_THAT_SHIPPED_is_caught():
    """The exact block from the residue row: `generated 0, decided 0, killed 0, survived 26` — survivors
    of a population the same object says does not exist."""
    why = M.result_inconsistency(
        _res(generated=0, decided=0, killed=0, survived=26, undecided=0), survivors_len=26, undecided_len=0
    )
    assert why and "exceeds result.decided" in why, why


def test_a_COUNT_that_disagrees_with_its_own_LIST_is_caught():
    """26 entries reading as 12 in one field and 26 in another, with nothing saying which is the count."""
    why = M.result_inconsistency(_res(survived=12), survivors_len=26, undecided_len=1)
    assert why and "result.survived is 12" in why and "26" in why, why


def test_the_UNDECIDED_count_is_checked_against_its_list_too():
    why = M.result_inconsistency(_res(undecided=1), survivors_len=2, undecided_len=9)
    assert why and "result.undecided" in why, why


def test_more_DECIDED_than_GENERATED_is_caught():
    why = M.result_inconsistency(_res(generated=3, decided=8), survivors_len=2, undecided_len=1)
    assert why and "exceeds result.generated" in why, why


def test_decided_may_EXCEED_killed_plus_survived_when_mutants_were_SET_ASIDE():
    """NOT an equality against `killed + survived` ALONE. A mutant whose only changed token sits inside
    a string literal is decided and lands in `notRequired`; a mutant whose diff is empty lands in
    `emptyDiff`. Both are decided and neither is killed or surviving, so asserting
    `killed + survived == decided` would red every healthy run that set one aside. The bound is against
    the FULL bucketing — and a generated mutant never decided is what `undecided` means, outside all
    four."""
    assert (
        M.result_inconsistency(
            _res(generated=100, decided=50, killed=5, survived=2, undecided=1, notRequired=40, emptyDiff=3),
            survivors_len=2,
            undecided_len=1,
        )
        is None
    )


def test_a_DECIDED_mutant_IN_NO_BUCKET_is_caught_with_the_SHIPPED_NUMBERS():
    """🔴 THE ROW. #3654's verdict, as it shipped: `generated 190, decided 190, killed 182, survived 2`
    — and the run printed `{"status": "PASS"}` over it. Six mutants had been dropped out of the
    classification with no counter anywhere in `result`, which is why EVERY pre-existing inequality
    held: a silently dropped mutant makes the arithmetic look SMALLER than the truth, never wrong.
    182 + 2 + 0 + 0 = 184 against 190 decided is the residual that names them, and it is the only one
    of these checks that could have seen them."""
    why = M.result_inconsistency(
        _res(generated=190, decided=190, killed=182, survived=2, undecided=0),
        survivors_len=2,
        undecided_len=0,
    )
    assert why and "6 decided mutant(s) are in no bucket" in why, why
    assert why and "result.decided (190)" in why, why


def test_the_REPAIRED_run_BALANCES_once_the_exclusions_are_COUNTED():
    """The same run with the counter in place, re-measured 2026-10-19 against #3654's own commit over
    the same scope: `notRequired` 6, and 182 + 2 + 6 + 0 = 190 closes. A check that reds the healthy
    shape it was written to produce is a check nobody keeps."""
    assert (
        M.result_inconsistency(
            _res(generated=190, decided=190, killed=182, survived=2, undecided=0, notRequired=6),
            survivors_len=2,
            undecided_len=0,
        )
        is None
    )


def test_an_EMPTY_DIFF_mutant_closes_the_residual_TOO():
    """`emptyDiff` is the other exclusion that leaves no survivor and no kill. Both terms are exercised
    separately, because a residual closed by one of them says nothing about the other."""
    assert (
        M.result_inconsistency(
            _res(generated=10, decided=8, killed=5, survived=2, undecided=1, emptyDiff=1),
            survivors_len=2,
            undecided_len=1,
        )
        is None
    )
    why = M.result_inconsistency(
        _res(generated=10, decided=8, killed=5, survived=2, undecided=1), survivors_len=2, undecided_len=1
    )
    assert why and "1 decided mutant(s) are in no bucket" in why, why


def test_a_MISSING_counter_is_reported_rather_than_read_as_zero():
    """§∅ inside the consistency check itself. `.get(k, 0)` would make a block with no `killed` satisfy
    every inequality by arithmetic — absence as a number, in the function whose whole job is catching a
    verdict that misreports its own numbers. Every `.get` default here was a surviving mutant precisely
    because no input could reach it; the keys are required instead."""
    for drop in ("generated", "decided", "killed", "survived", "undecided", "notRequired", "emptyDiff"):
        res = _res()
        del res[drop]
        why = M.result_inconsistency(res, survivors_len=2, undecided_len=1)
        assert why and drop in why and "absent" in why, (drop, why)


def test_an_empty_result_block_names_EVERY_counter_it_lacks():
    why = M.result_inconsistency({}, survivors_len=0, undecided_len=0)
    assert why and all(
        k in why for k in ("generated", "decided", "killed", "survived", "undecided", "notRequired", "emptyDiff")
    ), why


def test_the_settled_total_ADDS_its_two_terms():
    """`killed + survived` — a `-` on the second term would let a run with many survivors under-report
    what it settled and slip past the bound. Survived is non-zero here ON PURPOSE: with `survived: 0`
    the sign is unobservable, which is why the shipped-artifact test could not see it."""
    over = _res(generated=100, decided=5, killed=4, survived=2, undecided=3)
    why = M.result_inconsistency(over, survivors_len=2, undecided_len=3)
    assert why and "(6) exceeds result.decided (5)" in why, why


def test_SETTLED_EXACTLY_EQUAL_TO_DECIDED_is_LEGAL():
    """The bound is `<=`, and the equality is the HEALTHY shape: a run with no excused mutant settles
    exactly what it decided. `>=` here would red every such run, and the neighbouring test only proves
    that decided MAY exceed the settled outcomes, never that it may equal them."""
    res = _res(generated=10, decided=8, killed=6, survived=2, undecided=1)
    assert M.result_inconsistency(res, survivors_len=2, undecided_len=1) is None


def test_an_UNDECIDED_mutant_is_NOT_counted_against_DECIDED():
    """🔴 THE ROW. `undecided` once sat inside the `<= decided` sum, so every run with an undecided
    mutant reported "this verdict's own numbers disagree" — and that derived complaint REPLACED the
    real refusal in the verdict's `reason`.

    These are #3237's measured numbers (run 36613550322): 109 decided, 23 undecided, 85 killed,
    23 survived, 132 generated. `mmeta.decisions_under_glob` counts a mutant only when its exit code is
    a decision and an undecided mutant is exactly one whose code is null, so the two sets are disjoint
    and their sum is bounded by `generated`, never by `decided`.

    ⚠️ One number in that block does NOT balance: 85 + 23 = 108 against 109 decided, so that run had
    one decided mutant in no bucket of its own — either an exclusion it never counted (the #3654
    defect, a month earlier) or the timeout that `decided` used to credit. The cause was not
    re-measured, and it is not what this test is about, so `notRequired` carries that one mutant here
    to isolate the disjointness lesson from the residual one.
    """
    res = _res(generated=132, decided=109, killed=85, survived=23, undecided=23, notRequired=1)
    assert M.result_inconsistency(res, survivors_len=23, undecided_len=23) is None


def test_more_ACCOUNTED_FOR_than_GENERATED_is_still_caught():
    """The bound `undecided` moved TO. Dropping it entirely would leave a run free to claim more
    mutants than it ever generated, which is the double count the old sum did catch. `decided` alone is
    within `generated` here, so only the pair exceeds it — the first two checks cannot see this."""
    why = M.result_inconsistency(
        _res(generated=10, decided=8, killed=5, survived=2, undecided=5), survivors_len=2, undecided_len=5
    )
    assert why and "result.decided + undecided (13) exceeds result.generated (10)" in why, why


def test_the_accounted_for_total_ADDS_its_two_terms():
    """`decided + undecided` with a `-` on the second term reads 3, under every bound, on a block that
    accounts for 13 of 10 mutants. Both terms are non-zero so the sign is observable."""
    why = M.result_inconsistency(
        _res(generated=10, decided=8, killed=5, survived=2, undecided=5), survivors_len=2, undecided_len=5
    )
    assert why and "(13)" in why, why


# ── every selftest check must be able to FAIL *and SAY WHICH* ──────────────────────────────────────
#
# The section above drives four checks and asserts only `selftest() != 0`. That is not enough to pin
# the failure MESSAGE: with `fail(msg)` mutated to `fail(None)` the list is still non-empty, the exit
# code is still 1, and the assertion still passes — 22 surviving mutants, one per check, each of them
# the sentence a reader is given when the gate's own classifier has regressed. `test_mutation_swallow`
# already asserts its selftest's text for this reason; this does the same, per helper.

_SELFTEST_FAULTS = [
    ("is_string_only", lambda d: True, "treated as string-only because the LINE holds a quote"),
    ("is_string_only", lambda d: True, "the quote-free twin regressed"),
    ("is_string_only", lambda d: True, "a comparison flip is hidden by an unrelated dict key"),
    ("is_string_only", lambda d: True, "a mutant inside an f-string field is hidden as string-only"),
    ("is_string_only", lambda d: False, "a genuine string-literal change is now required"),
    ("is_string_only", lambda d: False, "XX sentinel is no longer conclusive"),
    ("is_string_only", lambda d: False, "log wording is no longer skipped"),
    ("is_string_only", lambda d: False, "an f-string's TEXT is no longer string-only"),
    ("_fstring_expr_spans", lambda s: [], "_fstring_expr_spans mislocates the fields"),
    ("changed_span", lambda a, b: (0, 0, 0), "changed_span invents a difference"),
    ("_string_spans", lambda s: [], "_string_spans miscounts literals"),
    ("diff_key", lambda d: "wrong", "selftest FAIL: diff_key"),
    ("refusal_reason", lambda v, r: "always", "refusal reasons are not distinguishable"),
    # None for every input: the table's rows all expect a REASON, so each one fires and the
    # per-row message is printed. With "always" they never fire and `fail(None)` there survived.
    ("refusal_reason", lambda v, r: None, "selftest FAIL: refusal_reason("),
    ("annotation_only", lambda a, b: (True, "nope"), "selftest FAIL annotation_only ["),
    (
        "classify",
        lambda e, s, k, generated=(), not_required=(), unchecked=(): {
            b: []
            for b in (
                "excused",
                "real_gap",
                "refuted",
                "orphaned",
                "unclassified",
                "not_decided",
                "claimed_not_required",
            )
        },
        "selftest FAIL excused:",
    ),
    ("string_only_verdict", lambda d: ("required", ""), "a no-op diff is not labelled EMPTY_DIFF"),
    ("string_only_verdict", lambda d: ("required", ""), "a log-prose mutation is no longer STRING_ONLY"),
    ("string_only_verdict", lambda d: ("required", ""), "a line outside the scan's competence was decided anyway"),
    # ── the 2026-10-05 plants: absence must not refute, and exit 3 is not a detection ────────────
    # These three `fail(...)` bodies are unreachable while the code is right, which is what makes
    # them worth breaking on purpose — an unexercised plant is a plant nobody has seen fire.
    (
        "classify",
        lambda e, s, k, generated=(), not_required=(), unchecked=(): {
            b: ([{"key": "a", "class": "no-distinguishing-input"}] if b == "refuted" else [])
            for b in (
                "excused",
                "real_gap",
                "refuted",
                "orphaned",
                "unclassified",
                "not_decided",
                "claimed_not_required",
                "unproven",
            )
        },
        "an absent mutant was REFUTED",
    ),
    (
        "classify",
        lambda e, s, k, generated=(), not_required=(), unchecked=(): {
            b: []
            for b in (
                "excused",
                "real_gap",
                "refuted",
                "orphaned",
                "unclassified",
                "not_decided",
                "claimed_not_required",
                "unproven",
            )
        },
        "an absent mutant must read not_decided",
    ),
    ("kill_is_a_detection", lambda ec: (True, ""), "pytest exit 3 was accepted as a detection"),
    # ⚠️ The SECOND half of each plant: the REASON going silent. These two stubs leave the boolean
    # correct and empty the reason, so exactly ONE side of each `or` is true — which is what makes the
    # `or` → `and` mutants observable. With both sides true (the stub above) `and` fires too and the
    # check cannot tell the operators apart.
    ("kill_is_a_detection", lambda ec: (False, ""), "pytest exit 3 was accepted as a detection"),
    (
        "refutation_corroborated",
        lambda first, second: (False, ""),
        "an exit-3 re-run corroborated a refutation, or stopped naming why",
    ),
]


@pytest.mark.parametrize("attr,stub,expected", _SELFTEST_FAULTS, ids=[f"{a}:{e[:34]}" for a, _, e in _SELFTEST_FAULTS])
def test_each_selftest_check_NAMES_what_regressed(monkeypatch, capsys, attr, stub, expected):
    """Break one helper and the selftest must both fail AND print the sentence for the check that
    caught it. Asserting the exit code alone leaves the message mutable to None."""
    monkeypatch.setattr(M, attr, stub)
    assert M.selftest() != 0
    out = capsys.readouterr().out
    assert expected in out, f"{attr} regressed and the selftest did not say so — printed:\n{out}"


def test_the_PASSING_selftest_says_so_in_words(capsys):
    """The success line is the only output of a healthy run, and nothing pinned it: mutated to
    `print(None)` or to a different sentence, every `selftest() == 0` assertion still passed."""
    assert M.selftest() == 0
    assert "selftest: classify + diff_key + refusal_reason + verdict OK" in capsys.readouterr().out


def test_a_LEAKED_killed_mutant_is_named_and_is_found_by_its_KEY(monkeypatch, capsys):
    """Drives the `x.get("key")` lookup as well as its message: with `x.get(None)` the leak check stops
    firing, and the run only stays red because an unrelated bucket comparison also fails."""
    real = M.classify

    def leaky(e, s, k, generated=()):
        out = real(e, s, k, generated=generated)
        out["unclassified"] = out["unclassified"] + [{"key": "d"}]
        return out

    monkeypatch.setattr(M, "classify", leaky)
    assert M.selftest() != 0
    assert "a killed mutant leaked into unclassified" in capsys.readouterr().out


def test_diff_key_has_its_OWN_line_not_only_the_collision_one(monkeypatch, capsys):
    """ "selftest FAIL: diff_key" is a PREFIX of "…: diff_key collides on different mutations", so a
    substring assertion is satisfied by the wrong line. Pinned as a whole line."""
    monkeypatch.setattr(M, "diff_key", lambda d: "wrong")
    assert M.selftest() != 0
    out = capsys.readouterr().out
    assert "  selftest FAIL: diff_key\n" in out
    # …and the collision check has its own sentence. Both fire under this stub, so asserting only the
    # prefix left the second one's message mutable to None.
    assert "selftest FAIL: diff_key collides on different mutations" in out


def test_changed_span_MISLOCATING_is_reported_separately_from_inventing(monkeypatch, capsys):
    monkeypatch.setattr(M, "changed_span", lambda a, b: None if a != b else None)
    assert M.selftest() != 0
    assert "changed_span mislocates the differing region" in capsys.readouterr().out


@pytest.mark.parametrize(
    "venv_exists,probe_rc,want",
    [
        (True, 1, "not importable"),  # mutmut absent under a WORKING interpreter
        (True, 2, "not importable"),  # a different non-zero rc is still "cannot import"
        (True, None, "could not be launched"),  # the interpreter itself would not start
        (False, None, "venv is missing"),  # no venv at all
        (False, 0, "venv is missing"),  # a venv-missing verdict OUTRANKS a 0 rc
        (True, 0, None),  # the only healthy combination
    ],
)
def test_every_refusal_reason_ROW_says_WHICH_failure_it_is(venv_exists, probe_rc, want):
    """The five table constants inside `selftest` are mutable one at a time — `(True, 1)` to
    `(False, 1)`, to `(True, 2)`, and both `interpreter unlaunchable` rows — and the selftest cannot
    see it, because every one of those inputs yields SOME reason and the selftest only asks whether a
    reason exists.

    ⚠️ So does asking `(got is None) is want_none` here, which is what this test did first. That is the
    same weak property one layer over, and it would have left the real distinction unpinned anywhere.
    The reasons are not interchangeable — the file's own docstring says the REMEDIES differ ("create
    the venv" vs "install the tool") — so each row is pinned on its TEXT."""
    got = M.refusal_reason(venv_exists, probe_rc)
    if want is None:
        assert got is None, (venv_exists, probe_rc, got)
    else:
        assert got is not None and want in got, (venv_exists, probe_rc, got)


def test_the_triple_quote_probe_really_is_THREE_quotes():
    """`_tq = chr(34) * 3` was mutable to `* 4`: four quotes still look like a docstring opener to the
    scan, so the UNDECIDABLE case it probes still came out UNDECIDABLE and nothing noticed. Pinned on
    the value rather than through the probe."""
    assert chr(34) * 3 == '"""'
    assert len(chr(34) * 3) == 3


def test_annotation_only_reports_a_WRONG_REASON_even_when_the_flag_is_right(monkeypatch, capsys):
    """The selftest's own check is `got_x != want_x or want_r not in got_r`; mutated to `and`, a case
    with the RIGHT flag and the WRONG reason passes silently.

    The stub keeps the REAL flag on purpose. An earlier version returned `a == b`, which gets the flag
    wrong on most rows — so `and` still fired somewhere and the mutant survived while the test passed.
    Only a stub that is right about every flag and wrong about the reason separates `or` from `and`."""
    real = M.annotation_only
    monkeypatch.setattr(M, "annotation_only", lambda a, b: (real(a, b)[0], "a reason nobody expects"))
    assert M.selftest() != 0
    assert "selftest FAIL annotation_only [" in capsys.readouterr().out


def test_a_FAILING_selftest_does_not_print_the_OK_line(monkeypatch, capsys):
    """`if not fails` was mutable to `(not fails) or True` — the summary then announced success on a
    run that had just listed its failures, and every `!= 0` assertion still passed because the exit
    code is computed separately."""
    monkeypatch.setattr(M, "diff_key", lambda d: "wrong")
    assert M.selftest() != 0
    out = capsys.readouterr().out
    assert "selftest: FAILED" in out
    assert "verdict OK" not in out, "a failing run must not also claim to be OK"


# ── the quote-ADJACENT cases (`2026-09-26-…-literal-boundaries-unobserved`) ────────────────────────
#
# `string_only_verdict` decides containment with two comparisons per side:
#     inside_old = any(a < old_end and start < b for a, b in old_spans if a <= start and old_end <= b)
#     inside_new = any(a <= start and new_end <= b for a, b in new_spans)
# Seven mutants of those four operators survived, because every existing case has the changed token
# comfortably INSIDE one literal, where `<` and `<=` agree. They only disagree when the changed span
# touches a literal's boundary exactly — and getting that wrong turns a REQUIRED mutant into a
# skipped one, which is the fail-open this whole scan exists to prevent.
#
# The cases below were SEARCHED, not invented: 200,000 well-formed line pairs, comparing the real
# `string_only_verdict`'s output (not an intermediate — an earlier pass compared `inside_old` and
# found "differences" that were all inputs returning UNDECIDABLE before reaching it).


@pytest.mark.parametrize(
    "old,new,want",
    [
        # the whole literal is the changed span: start == a and new_end == b on BOTH sides
        ('    x = "a"', "    x = 'a'", M.STRING_ONLY),
        ('    f("a")', "    f('a')", M.STRING_ONLY),
        # the changed span abuts a literal boundary without being inside one
        ('    x = "+"', "    x = 'zbz+'\"+\"", M.REQUIRED),
        ('    x = ""', "    x = ' z'\"\"", M.REQUIRED),
        ("    x = ''", "    x = ''\"\"", M.REQUIRED),
    ],
)
def test_a_change_that_touches_a_literal_BOUNDARY_is_judged_correctly(old, new, want):
    got, detail = M.string_only_verdict(f"--- a\n+++ b\n-{old}\n+{new}\n")
    assert got == want, f"{old!r} → {new!r} gave {got} ({detail})"


def test_the_string_only_DETAIL_says_why_not_just_that():
    """The returned sentence is the only explanation a reader gets for a mutant the gate skipped, and
    nothing pinned it — mutated to a different case it stayed `STRING_ONLY` and every test passed."""
    got, detail = M.string_only_verdict('--- a\n+++ b\n-    x = "a"\n+    x = "b"\n')
    assert got == M.STRING_ONLY
    assert detail == "every changed token lies inside a string literal", detail


# ── the budget refusal's STATUS (§🧾: NOT_RUN examined nothing) ──────────────────────────────────────
def test_a_budget_eaten_entirely_by_prework_is_NOT_RUN_not_UNKNOWN():
    """The whole point of the split. `decided == 0` means the gate never reached a mutant — the clean
    run and mutmut's traced stats pass consumed the budget — and the contract's word for that is
    NOT_RUN. It answered UNKNOWN before, which is what a run says when it DID mutate and could not
    decide; capture.py hits this branch on every diff, so the two were indistinguishable in the field."""
    status, reason = M.budget_exhaustion_verdict(3, 0, 7201.4)
    assert status == "NOT_RUN", status
    assert "examined nothing" in reason
    assert "7201s" in reason, f"the elapsed time must be IN the verdict, not only the log: {reason}"


def test_a_partly_measured_run_stays_UNKNOWN_and_says_how_much_it_measured():
    """The other side: mutants were decided, so the run is not "examined nothing" — the refused
    functions are unmeasured and the measured ones still stand. Pinning this stops the fix above from
    being applied to every refusal."""
    status, reason = M.budget_exhaustion_verdict(2, 41, 7000.0)
    assert status == "UNKNOWN", status
    assert "41 mutant(s) decided" in reason and "7000s" in reason, reason


def test_the_budget_verdict_always_names_the_elapsed_time():
    """ "Never a silent timeout" is the property, and the elapsed seconds are the only number that
    distinguishes a budget that ran out from a budget that was mis-set. Both arms, one assertion."""
    for decided in (0, 1, 500):
        _, reason = M.budget_exhaustion_verdict(1, decided, 1234.0)
        assert "1234s" in reason, (decided, reason)


def test_the_budget_verdict_uses_only_statuses_the_contract_allows():
    for decided in (0, 1, 99):
        status, _ = M.budget_exhaustion_verdict(1, decided, 10.0)
        assert status in M.VERDICT_STATUSES, status


# ── the wall cap must be REACHABLE (the 2 h 41 m stats pass) ─────────────────────────────────────────
# 🔴 EVERY BLOCKING THING BELOW SELF-TERMINATES, AND THAT IS A MUTATION-GATE REQUIREMENT, NOT TIDINESS.
# The three defects these tests pin all make `stream_bounded` wait LONGER (`t0` recomputed,
# `wait(timeout=None)`, `join(timeout=None)`). Written against a child that never exits, each mutant
# is caught — by hanging — and mutmut reports UNDECIDED (timeout), which is not a kill: the gate
# refused this very change with "3 mutant(s) UNDECIDED (timeout)". A child that ends on its own turns
# every one of those hangs into a fast, ordinary assertion failure. Where the deadline is the whole
# point, it is asserted as the NUMBER REQUESTED rather than the time spent — a clock cannot afford a
# bound tight enough to see one second, and the arithmetic mutants proved it by surviving one.
def _child(code: str):
    import subprocess as _sp
    import sys as _sys

    return _sp.Popen([_sys.executable, "-c", code], stdout=_sp.PIPE, stderr=_sp.STDOUT, text=True, bufsize=1)


_CHATTY_3S = "import sys, time\nend = time.time() + 3\nwhile time.time() < end:\n    print('working'); sys.stdout.flush(); time.sleep(0.02)\n"
_SILENT_3S = "import time\ntime.sleep(3)\n"


def test_a_child_still_working_at_the_cap_is_KILLED():
    """THE DEFECT, pinned. `for line in proc.stdout:` ends only when the child closes stdout, so the
    `proc.wait(timeout=…)` after it was reached only once the child had already exited — the cap could
    not fire. The child here outlives the cap but not the test: under an unbounded wait it is reaped
    normally at 3 s and `timed_out` comes back False, so the mutant fails instead of hanging."""
    import time as _t

    proc = _child(_CHATTY_3S)
    seen: list[str] = []
    t0 = _t.monotonic()
    rc, timed_out, _ = M.stream_bounded(proc, 1.0, seen.append, t0=t0)
    took = _t.monotonic() - t0
    assert timed_out is True, f"the cap did not fire — the child was allowed to finish: rc={rc}"
    assert took < 2.5, f"the cap fired {took:.1f}s late — it must bound the READ, not follow it"
    assert seen, "the output must still stream while the deadline runs"
    assert proc.poll() is not None, "the child was left alive after the refusal"


def test_a_SILENT_child_still_working_at_the_cap_is_also_KILLED():
    """The worse half: a child producing NO output. The old read blocked on an empty pipe with nothing
    to count and no heartbeat — the shape a reader calls "wedged" and cannot tell from slow work."""
    import time as _t

    proc = _child(_SILENT_3S)
    t0 = _t.monotonic()
    rc, timed_out, _ = M.stream_bounded(proc, 1.0, lambda _l: None, t0=t0)
    assert timed_out is True, rc
    assert _t.monotonic() - t0 < 2.5
    assert proc.poll() is not None


def test_a_child_that_finishes_inside_the_cap_reports_its_real_exit_code():
    """The control: the bound must not turn a normal run into a refusal, and every line must arrive."""
    proc = _child("for i in range(50):\n    print(i)\n")
    seen: list[str] = []
    rc, timed_out, _ = M.stream_bounded(proc, 60.0, seen.append)
    assert timed_out is False and rc == 0, (rc, timed_out)
    assert len(seen) == 50, f"lines were dropped by the threaded reader: {len(seen)}"


def test_a_failing_child_inside_the_cap_is_not_reported_as_a_timeout():
    proc = _child("import sys\nprint('boom')\nsys.exit(3)\n")
    seen: list[str] = []
    rc, timed_out, _ = M.stream_bounded(proc, 60.0, seen.append)
    assert (rc, timed_out) == (3, False), (rc, timed_out)
    assert seen == ["boom\n"], seen


def test_a_pipe_closed_under_the_reader_does_not_take_the_verdict_with_it():
    """The kill can close the pipe while the reader is mid-iteration. A stub rather than a race, so
    the branch is exercised the same way every run: the read dies, the caller still gets its code."""

    class _Pipe:
        def __iter__(self):
            raise ValueError("I/O operation on closed file")

    class _Proc:
        stdout = _Pipe()
        returncode = 0

        def wait(self, timeout=None):
            return 0

        def kill(self):  # pragma: no cover — this child exits inside the cap
            raise AssertionError

    rc, timed_out, _ = M.stream_bounded(_Proc(), 60.0, lambda _l: None)
    assert (rc, timed_out) == (0, False), (rc, timed_out)


# ── #3202: the three plants ─────────────────────────────────────────────────────────────────────────
# A required context burned a 180-minute job and decided ZERO mutants. The three things that had to be
# true for that to happen silently are each pinned below.

_GRANDCHILD_HOLDS_THE_PIPE = (
    "import subprocess, sys, time\n"
    "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"  # inherits stdout
    "[print('spinner', flush=True) for _ in range(50)]\n"
    "time.sleep(60)\n"
)


def test_the_refusal_STILL_ARRIVES_when_a_grandchild_holds_the_pipe_open():
    """PLANT 1 — mutmut's worker shape, which the two tests above do not have.

    `proc.kill()` kills the pool PARENT; the workers inherited stdout, so the read end never sees EOF
    and the reader thread stays blocked in `for line in proc.stdout`. This was my first candidate for
    #3202's silence and it is REFUTED — measured 13.00 s against a 43 s bound — but the property is now
    load-bearing for the phase bound below, and nothing was asserting it."""
    import time as _t

    proc = _child(_GRANDCHILD_HOLDS_THE_PIPE)
    seen: list[str] = []
    t0 = _t.monotonic()
    rc, timed_out, _ = M.stream_bounded(proc, 1.0, seen.append, t0=t0, join_sec=2.0)
    took = _t.monotonic() - t0
    assert timed_out is True, f"the cap did not fire with a grandchild on the pipe: rc={rc}"
    assert took < 1.0 + M.REAP_SEC + 2.0 + 1.0, f"returned {took:.1f}s — a held pipe must not extend the bound"
    assert seen, "output before the kill must still reach the caller"
    assert proc.poll() is not None, "the child was left alive after the refusal"


def test_a_GENERATION_phase_that_outlives_its_bound_is_killed_and_named():
    """PLANT 2 — the #3202 case itself. The child never reports the phase marker, so a wait bounded only
    by the wall cap would let it run to the cap; the phase bound must fire FIRST and say which phase."""
    import time as _t

    proc = _child(_SILENT_3S)
    t0 = _t.monotonic()
    rc, timed_out, phase_timed_out = M.stream_bounded(
        proc, 60.0, lambda _l: None, t0=t0, phase_cap_sec=1.0, phase_done=lambda: False
    )
    took = _t.monotonic() - t0
    assert phase_timed_out is True, "the phase bound did not fire — this is #3202"
    assert timed_out is True, "a phase kill is also a timeout for the caller's reporting"
    assert took < 2.5 + M.REAP_SEC, f"the phase bound fired {took:.1f}s in, not at its own deadline"
    assert proc.poll() is not None


def test_a_phase_that_FINISHES_hands_the_rest_of_the_wall_cap_to_the_run():
    """The control, and the one that matters for not breaking a healthy run: generation completing must
    not consume the whole budget. The child outlives the PHASE bound but not the wall cap, and reports
    the marker — so it must be allowed to finish and come back green."""
    import time as _t

    proc = _child(_CHATTY_3S)
    t0 = _t.monotonic()
    rc, timed_out, phase_timed_out = M.stream_bounded(
        proc, 60.0, lambda _l: None, t0=t0, phase_cap_sec=1.0, phase_done=lambda: True
    )
    assert (phase_timed_out, timed_out, rc) == (False, False, 0), (rc, timed_out, phase_timed_out)
    assert _t.monotonic() - t0 < 10.0, "the phase bound must not become the wall cap"


def test_the_phase_bound_can_never_EXTEND_the_wall_cap():
    """A phase bound looser than what is left of the wall cap must not buy time. Asserted as the NUMBER
    requested, not as elapsed seconds — the arithmetic mutants that survived a timing assertion are why
    the tests below this point stub `wait` and read the `timeout=` they were handed."""
    import time as _t

    rec = _RecordingProc()
    M.stream_bounded(
        rec, 10.0, lambda _l: None, t0=_t.monotonic() - 9.0, phase_cap_sec=3600.0, phase_done=lambda: False
    )
    assert rec.timeouts, "wait was never called with a deadline"
    assert rec.timeouts[0] <= 1.0 + 0.5, f"the phase bound extended the wall cap: {rec.timeouts[0]}"


def test_the_generation_marker_is_mutmuts_own_line_and_not_a_mutant_verdict():
    """PLANT 3 — what "the phase finished" is READ from. An absence is only evidence when the emitter is
    known: `done in …ms (N files mutated…)` is printed by mutmut the instant `create_mutants` returns,
    and it occurred ZERO times in #3202's log against 618 spinner lines. A mutant verdict must NOT be
    mistaken for it — a slow first verdict still means generation finished, and conflating the two would
    put the phase bound on the wrong side of the failure."""
    assert M.GENERATION_DONE_RE.search("    done in 1342111ms (226 files mutated, 3 ignored, 0 unmodified)")
    assert M.GENERATION_DONE_RE.search("done in 18ms (1 file mutated, 0 ignored, 0 unmodified)")
    assert not M.GENERATION_DONE_RE.search("capture.x_alert_poller__mutmut_7: survived")
    assert not M.GENERATION_DONE_RE.search("Generating mutants")
    assert not M.GENERATION_DONE_RE.search("done in 12ms")  # no file count = not the marker


def test_workers_that_fit_refuses_where_capture_py_cannot_run_and_sizes_where_it_can():
    """The number handed to mutmut's `--max-children`, which used to be `os.cpu_count()` — and that is
    how a 24-core rig and a 4-core hosted runner BOTH over-committed on the same module.

    Measured 2026-09-28: the generated capture.py is 562,427,047 bytes. A hosted runner reports ~14 GB
    available, so the 50 % cap affords ZERO workers; the rig at 33 GB affords 2. Both numbers are the
    refusal this gate owes, and neither is reachable from `os.cpu_count()`."""
    GB = 1024**3
    CAPTURE_GENERATED = 562427047
    assert M.workers_that_fit(CAPTURE_GENERATED, 14 * GB) == 0, "a hosted runner cannot afford one worker"
    assert M.workers_that_fit(CAPTURE_GENERATED, 33 * GB) == 2, "the rig affords two, not twenty-four"
    assert M.workers_that_fit(8892661, 14 * GB) > 8, "a small module must not be throttled to nothing"
    # §∅ at the arithmetic: an ABSENT measurement is not a permissive one. `memory_refusal` returns None
    # for a zero size — which is how the guard stayed silent on every fresh scratch — so the sizing
    # function must answer 0 there rather than inheriting the same hole.
    assert M.workers_that_fit(0, 14 * GB) == 0, "an unmeasured module must not read as affordable"
    assert M.workers_that_fit(CAPTURE_GENERATED, 0) == 0


def test_the_generation_phase_bound_is_a_SHARE_of_the_wall_cap_with_a_floor():
    """A share, not an absolute: generation cost tracks the module, so a fixed number is wrong at both
    ends of the fleet. And it never returns a bound below the floor — a budget already overspent still
    owes the child a positive deadline, or `wait(timeout=0)` turns the phase check into an instant kill."""
    assert M.generation_cap_sec(7200.0) == 7200.0 * M.GENERATION_CAP_FRACTION
    assert M.generation_cap_sec(7200.0, fraction=0.25) == 1800.0
    assert M.generation_cap_sec(0.0) == M.CAP_FLOOR_SEC, "a zero cap must still hand back the floor"
    assert M.generation_cap_sec(-5.0) == M.CAP_FLOOR_SEC


def test_a_zero_RSS_FACTOR_is_not_permission_to_run_unbounded_workers():
    """The factor is the one number in the projection that is an assumption, so a caller CAN pass it. If
    it arrives as 0 the projection says "a worker costs nothing", and the affordable count would be
    unbounded — the same absence-as-permission hole that made `memory_refusal(0, …)` silent."""
    assert M.workers_that_fit(562427047, 14 * 1024**3, rss_factor=0) == 0


def test_a_generation_timeout_reason_says_no_mutant_ran():
    r = M.generation_timeout_reason(3600.0, 3612.4, 123456789)
    assert "GENERATION" in r and "3600s" in r and "3612s" in r
    assert "118 MB of mutants written" in r, r
    assert "no mutant ran" in r, "the reason must say the run examined nothing, not that the diff failed"
    assert "nothing written yet" in M.generation_timeout_reason(60.0, 61.0, 0)


# ── the deadline as a NUMBER, not as elapsed time ───────────────────────────────────────────────────
class _RecordingProc:
    """Records every `timeout=` it is waited on with, and never actually waits.

    The deadline is the behaviour here, and it is fully described by the argument. Asserting the
    argument kills `wait(timeout=None)` and the `t0`-recomputed mutant INSTANTLY, where asserting
    elapsed time caught them only by taking 30 s — which the gate scores UNDECIDED, not killed."""

    def __init__(self, pid=None):
        import subprocess as _sp

        self._sp, self.killed, self.timeouts, self.signals = _sp, False, [], []
        self.stdout = iter(())  # the reader finishes at once; nothing here is about the read
        # `pid=None` means "no pid", and it is deliberately NOT 0: `killpg(0, …)` addresses the
        # CALLER's own group, so a 0 here is a live grenade in a test double — measured, it SIGTERMed
        # the mutmut worker's group under four of this function's own mutants. This double takes the
        # no-group path and records plain signals; the group path has its own doubles below.
        self.pid = pid
        self.returncode = None

    def kill(self):
        self.killed = True

    def send_signal(self, sig):
        """A child that IGNORES SIGTERM and dies on SIGKILL — the shape the escalation exists for. A
        double that died on SIGTERM would let `(SIGKILL, REAP_SEC)` go unvisited and the reap bound
        below would be asserted by nothing."""
        import signal as _sig

        self.signals.append(sig)
        if sig == _sig.SIGKILL:
            self.killed = True

    def wait(self, timeout=None):
        self.timeouts.append(timeout)
        if not self.killed:
            raise self._sp.TimeoutExpired("child", timeout)
        # `returncode` appears when the process is REAPED, not when it is signalled — so a double whose
        # wait never returns leaves it None, and the reaper cannot borrow an exit status it never saw.
        self.returncode = -9
        return -9


def test_the_wait_is_given_the_caller_s_remaining_budget_as_a_REAL_number():
    """Kills two at once: an unbounded `timeout=None`, and a `t0` recomputed here instead of taken
    from the caller — `tools/mutate.py` measures `t0` before the clean run, so recomputing silently
    hands every module its full budget back after the pre-work is already spent."""
    import time as _t

    proc = _RecordingProc()
    M.stream_bounded(proc, 30.0, lambda _l: None, t0=_t.monotonic() - 1000.0)
    assert proc.timeouts[0] is not None, "the wall wait must be bounded, not `timeout=None`"
    assert proc.timeouts[0] == M.CAP_FLOOR_SEC, (
        f"the budget was spent 1000s ago, so only the floor is owed; got {proc.timeouts[0]} — "
        "a cap that restarts from this call is no cap"
    )


def test_the_post_kill_reap_is_BOUNDED_too():
    """`proc.wait(timeout=REAP_SEC)` → `timeout=None` reintroduces this function's own bug class one
    line below the fix: an unkillable child would hang the refusal forever. Asserted on the argument
    because the input that separates the two — a child that never reaps after SIGKILL — cannot be
    told apart in less than REAP_SEC (30 s) of real waiting, every run, forever."""
    proc = _RecordingProc()
    M.stream_bounded(proc, 1.0, lambda _l: None)
    assert proc.killed, "the cap fired but the child was never killed"
    assert proc.timeouts[-1] is not None, "the post-kill reap must be bounded, not `timeout=None`"
    assert proc.timeouts[-1] == M.REAP_SEC == 30.0, proc.timeouts


def test_the_abandoned_reader_is_a_DAEMON_and_its_join_is_BOUNDED(monkeypatch):
    """Two properties, both asserted as arguments so neither depends on how long anything took.

    The reader must not outlive the interpreter — `daemon=False`/`None`/omitted all inherit
    non-daemon from the main thread and would wedge shutdown behind a thread blocked on a pipe — and
    the join must be BOUNDED: `join(timeout=None)` turns a refusal that just fired into a hang one
    frame later. The shim is scoped to this module's own `threading` reference."""
    import threading as _th

    made = {}

    class _RecThread(_th.Thread):
        def __init__(self, *a, **kw):
            made["daemon_kw"] = kw.get("daemon", "<omitted>")
            super().__init__(*a, **kw)

        def join(self, timeout=None):
            made["join_timeout"] = timeout
            # Cap the REAL wait so an unbounded join cannot hang this test; the argument above is
            # what is being asserted, and it has already been recorded.
            return super().join(0.2 if timeout is None else timeout)

    class _Shim:
        Thread = _RecThread

    monkeypatch.setattr(M, "threading", _Shim)
    proc = _RecordingProc()
    M.stream_bounded(proc, 1.0, lambda _l: None, join_sec=0.3)

    assert made["daemon_kw"] is True, (
        f"the reader must be a daemon; got daemon={made['daemon_kw']!r} — a non-daemon reader stuck "
        "on a pipe blocks interpreter shutdown"
    )
    assert made["join_timeout"] is not None, "the join must be bounded, not `join(timeout=None)`"
    assert made["join_timeout"] == 0.3, made


# ── the deadline ARITHMETIC, asserted as numbers ────────────────────────────────────────────────────
# Extracted from `stream_bounded` for exactly this reason: `max(1.0, …)` → `max(2.0, …)`,
# `cap_sec - elapsed` → `+`, and `now - t0` → `now + t0` all survived a wall-clock assertion, because
# a timing test cannot afford a bound tight enough to see one second without going flaky.
def test_cap_remaining_counts_from_the_CALLERS_start_not_this_call():
    """`tools/mutate.py` measures `t0` before the clean baseline run, so a cap that restarted here
    would hand every module its full budget again after the pre-work was already spent."""
    assert M.cap_remaining(100.0, 0.0, 40.0) == 60.0
    assert M.cap_remaining(100.0, 10.0, 40.0) == 70.0, "t0 must be subtracted, not added"


def test_cap_remaining_never_returns_less_than_the_floor():
    """An overspent budget must still give the child a moment to finish, not a zero or negative wait
    that kills a run one line from its verdict."""
    assert M.cap_remaining(5.0, 0.0, 1000.0) == M.CAP_FLOOR_SEC
    assert M.CAP_FLOOR_SEC == 1.0, "the floor is the pre-stated number, not whatever the code says"


def test_cap_remaining_shrinks_as_the_budget_is_spent():
    a = M.cap_remaining(60.0, 0.0, 10.0)
    b = M.cap_remaining(60.0, 0.0, 30.0)
    assert a > b, f"remaining must FALL with elapsed time, not rise: {a} then {b}"


def test_the_budget_reason_names_the_refused_count_and_the_budget():
    """`what` carried the only two numbers a reader needs to size the refusal, and dropping it
    entirely still satisfied an assertion that only looked for the elapsed seconds."""
    _, reason = M.budget_exhaustion_verdict(3, 0, 10.0)
    assert f"3 module(s)/function(s) not mutated inside the {M.GATE_BUDGET_SEC}s gate budget" in reason


def test_ONE_decided_mutant_is_already_a_partly_measured_run():
    """The boundary: `decided > 0`, not `> 1`. One decided mutant means the gate examined something,
    so NOT_RUN ("examined nothing") would be false."""
    assert M.budget_exhaustion_verdict(1, 1, 10.0)[0] == "UNKNOWN"
    assert M.budget_exhaustion_verdict(1, 0, 10.0)[0] == "NOT_RUN"


# ── SCRATCH OWNERSHIP: a prune must not delete a tree another session is using ──────────────────────
# Residue 2026-09-25-mutate-prune-closure-unverified. NOT the question test_tmp_basetemp_race.py
# answers (pytest's basetemp, one level down); this is the mutation scratch, where the deletion is
# explicit and unconditional.
def test_a_scratch_held_by_a_LIVE_owner_is_never_pruned():
    """THE PLANT. Two sessions sweeping one module at different source hashes were each deleting the
    other's 536 MB tree mid-run."""
    prune, why = M.scratch_prune_decision(is_current=False, owner_live=True, age_sec=10**9)
    assert prune is False, why
    assert "live" in why


def test_a_scratch_whose_owner_is_GONE_and_past_the_floor_is_pruned():
    """The other half of the plant: the cache must still evict, or a tmpfs fills. 153 orphaned
    scratches and 2.6 GB were measured before any pruning existed."""
    prune, why = M.scratch_prune_decision(is_current=False, owner_live=False, age_sec=M.SCRATCH_MIN_AGE_SEC + 1)
    assert prune is True, why
    assert "owner is gone" in why


def test_a_dead_owner_inside_the_age_floor_is_left_alone():
    prune, why = M.scratch_prune_decision(is_current=False, owner_live=False, age_sec=M.SCRATCH_MIN_AGE_SEC - 1)
    assert prune is False and "still exiting" in why, why


def test_an_UNMARKED_scratch_is_outlived_not_judged():
    """§∅: "no owner file" is not "no owner". An unmarked tree earns the longer floor precisely
    because nothing is known about it — treating unknown as dead is the deletion this prevents."""
    assert M.scratch_prune_decision(is_current=False, owner_live=None, age_sec=3600)[0] is False
    assert (
        M.scratch_prune_decision(is_current=False, owner_live=None, age_sec=M.SCRATCH_UNKNOWN_MIN_AGE_SEC + 1)[0]
        is True
    )
    assert M.SCRATCH_UNKNOWN_MIN_AGE_SEC > M.SCRATCH_MIN_AGE_SEC, (
        "an unknown owner must earn a LONGER grace than one proven gone, not a shorter one"
    )


def test_the_runs_own_scratch_is_never_pruned():
    assert M.scratch_prune_decision(is_current=True, owner_live=False, age_sec=10**9)[0] is False


def test_the_owner_record_round_trips_and_survives_PID_REUSE():
    """A bare PID recorded hours ago may now belong to something else. Recording the start time makes
    the answer about THIS process — without it a recycled PID pins a dead scratch forever (a leak
    dressed as caution) or, worse, a live one reads as dead."""
    import os as _os

    me = _os.getpid()
    ticks = M.proc_start_ticks(me)
    assert ticks is not None and ticks > 0
    rec = M.parse_owner_record(M.owner_record(me, ticks))
    assert rec == (me, ticks)
    assert M.owner_is_live(rec, M.proc_start_ticks) is True
    assert M.owner_is_live((me, ticks + 9999), M.proc_start_ticks) is False, (
        "a PID whose start time does not match is a DIFFERENT process wearing the same number"
    )


def test_an_unreadable_or_absent_owner_record_is_UNKNOWN_and_not_False():
    for text in ("", None, "garbage", "12", "not a pid  nor ticks", "1 2 3", "abc def", "1 x"):
        assert M.parse_owner_record(text) is None, text
    assert M.owner_is_live(None, M.proc_start_ticks) is None, (
        "unknown must be its own answer — collapsing it to False is how a live tree gets deleted"
    )


def test_proc_start_ticks_reads_the_field_after_the_last_paren(tmp_path):
    """Field 2 of /proc/<pid>/stat is the executable name and may contain spaces and parentheses.
    Splitting the whole line is the classic way to read the wrong field."""
    d = tmp_path / "4242"
    d.mkdir()
    fields = " ".join(str(i) for i in range(3, 53))  # fields 3..52; field 22 -> value "22"
    (d / "stat").write_text(f"4242 (py (thon) :) x) {fields}\n", encoding="utf-8")
    assert M.proc_start_ticks(4242, proc_root=str(tmp_path)) == 22
    assert M.proc_start_ticks(999999, proc_root=str(tmp_path)) is None


# ── MEMORY: refuse before starting, never get reaped mid-run ────────────────────────────────────────
_GB = 1024**3


def test_a_projected_budget_over_the_cap_REFUSES_and_names_every_number():
    """THE PLANT, at capture.py's measured shape: a 536 MB mutants file, one worker per core, against
    the box's available memory. One worker measured 8.2 GB RSS, and mutmut spawns a worker per core."""
    why = M.memory_refusal(536 * 1024**2, 16, 40 * _GB)
    assert why, "capture.py on 16 cores must not be attempted against 40 GB available"
    # 🔴 THE WHOLE SENTENCE, NOT SUBSTRINGS. `"40.0 GB available"` passed against a mutant that
    # multiplied by a GiB instead of dividing: the mutated number ended ...879040.0, so the fragment
    # matched inside a figure eleven orders of magnitude wrong. Every number here is a rendering of an
    # input, so pin the rendering.
    assert why.startswith(
        "projected peak 125.6 GB (0.52 GB of generated mutants x 15 assumed RSS factor = 7.9 GB "
        "per worker, x 16 worker(s)) exceeds the 20.0 GB cap (0.5 of 40.0 GB available at start). "
    ), why
    assert "REFUSAL with a reason, not a verdict on the diff" in why


def test_a_projected_budget_UNDER_the_cap_runs():
    """The control: the bound must not refuse work that fits. A 10 MB module on 4 workers is 0.6 GB."""
    assert M.memory_refusal(10 * 1024**2, 4, 40 * _GB) is None


def test_the_cap_is_a_fraction_of_AVAILABLE_and_is_pre_stated():
    """Exactly at the cap fits; a byte over refuses. Pinning the boundary stops the fraction drifting
    into "whatever is free", which is the other half of the fleet."""
    per_worker = 1.0 * _GB
    mutants = int(per_worker / M.WORKER_RSS_PER_MUTANTS_BYTE)
    avail = int(4 * per_worker / M.MEM_CAP_FRACTION)  # cap == 4 workers' worth
    assert M.memory_refusal(mutants, 4, avail) is None
    assert M.memory_refusal(mutants, 5, avail), "one worker past the cap must refuse"
    assert M.MEM_CAP_FRACTION == 0.5 and M.WORKER_RSS_PER_MUTANTS_BYTE == 15.0, (
        "both are PRE-STATED; a threshold derived from the data it judges is UNKNOWN (§🧾)"
    )


def test_memory_refusal_says_nothing_when_it_cannot_measure():
    """§∅: an unmeasured input is not a small one. With no mutants file, no worker count or no
    /proc/meminfo, the projection has no basis — refusing on a zero would block every run."""
    assert M.memory_refusal(0, 16, 40 * _GB) is None
    assert M.memory_refusal(536 * 1024**2, 0, 40 * _GB) is None
    assert M.memory_refusal(536 * 1024**2, 16, 0) is None


def test_available_is_read_from_MemAvailable_not_MemFree():
    """MemFree excludes reclaimable page cache and would refuse runs that fit comfortably."""
    text = "MemTotal:       61000000 kB\nMemFree:          500000 kB\nMemAvailable:   40000000 kB\n"
    assert M.available_bytes_from_meminfo(text) == 40000000 * 1024
    assert M.available_bytes_from_meminfo("MemTotal: 1 kB\n") is None
    assert M.available_bytes_from_meminfo("") is None
    assert M.available_bytes_from_meminfo("MemAvailable:   notanumber kB\n") is None


def test_a_memory_refusal_that_decided_nothing_is_NOT_RUN():
    status, reason = M.memory_exhaustion_verdict(2, 0)
    assert status == "NOT_RUN" and "examined nothing" in reason
    assert M.memory_exhaustion_verdict(2, 7)[0] == "UNKNOWN"
    assert "7 mutant(s) were decided" in M.memory_exhaustion_verdict(2, 7)[1]


# ── the prune ON REAL DIRECTORIES (the plant), not just the decision ────────────────────────────────
def _scratch(root, name, *, owner=None, age_sec=0.0):
    import os as _os
    import time as _t

    d = root / name
    (d / "work").mkdir(parents=True)
    if owner is not None:
        (d / M.SCRATCH_OWNER_FILE).write_text(owner + "\n", encoding="utf-8")
    if age_sec:
        old = _t.time() - age_sec
        _os.utime(d, (old, old))
    return d


def test_the_prune_spares_a_LIVE_owners_scratch_and_removes_an_abandoned_one(tmp_path):
    """THE PLANT, end to end on real directories with the real /proc: a peer's live tree survives and
    an abandoned one is reclaimed IN THE SAME SWEEP — so "it kept everything" cannot pass for a fix."""
    import os as _os

    me = _os.getpid()
    live = M.owner_record(me, M.proc_start_ticks(me))
    dead = M.owner_record(999999, 1)  # no such process

    peer = _scratch(tmp_path, "mut-capture-aaaaaaaaaaaa", owner=live, age_sec=10**6)
    gone = _scratch(tmp_path, "mut-capture-bbbbbbbbbbbb", owner=dead, age_sec=10**6)
    mine = _scratch(tmp_path, "mut-capture-cccccccccccc", owner=live)
    other_module = _scratch(tmp_path, "mut-webmon-dddddddddddd", owner=dead, age_sec=10**6)

    pruned, held = M.prune_scratches(tmp_path, "capture", mine)

    assert peer.exists(), "a live peer's scratch was deleted — the whole defect"
    assert mine.exists(), "this run's own scratch was deleted"
    assert not gone.exists(), "an abandoned scratch was not reclaimed; the cache never evicts"
    assert other_module.exists(), "the prune reached outside its own module"
    assert pruned == ["mut-capture-bbbbbbbbbbbb"], pruned
    assert any("mut-capture-aaaaaaaaaaaa" in h and "live" in h for h in held), held


def test_the_prune_reports_WHY_each_survivor_was_kept(tmp_path):
    """A prune that removed a peer's tree used to print only the name. The reason is the one line
    that could have named the mistake."""
    import os as _os

    me = _os.getpid()
    _scratch(tmp_path, "mut-oxy-111111111111", owner=M.owner_record(me, M.proc_start_ticks(me)))
    _scratch(tmp_path, "mut-oxy-222222222222")  # unmarked, young
    _scratch(tmp_path, "mut-oxy-333333333333", owner=M.owner_record(999999, 1))  # dead, young
    pruned, held = M.prune_scratches(tmp_path, "oxy", tmp_path / "mut-oxy-current")
    assert pruned == [], pruned
    assert len(held) == 3
    assert any("live process" in h for h in held)
    assert any("no owner marker" in h for h in held)
    assert any("still exiting" in h for h in held)


def test_an_unmarked_scratch_past_the_long_floor_is_finally_reclaimed(tmp_path):
    """The leak guard: unmarked trees must not accumulate forever. 153 orphaned scratches and 2.6 GB
    were measured before pruning existed at all."""
    old = _scratch(tmp_path, "mut-ecg-999999999999", age_sec=M.SCRATCH_UNKNOWN_MIN_AGE_SEC + 60)
    pruned, held = M.prune_scratches(tmp_path, "ecg", tmp_path / "mut-ecg-current")
    assert pruned == [old.name] and not old.exists(), (pruned, held)


def test_a_file_that_merely_looks_like_a_scratch_is_not_touched(tmp_path):
    (tmp_path / "mut-ppg-abcabcabcabc").write_text("not a directory", encoding="utf-8")
    pruned, held = M.prune_scratches(tmp_path, "ppg", tmp_path / "mut-ppg-current")
    assert (pruned, held) == ([], []) and (tmp_path / "mut-ppg-abcabcabcabc").exists()


def test_a_name_that_cannot_be_stat_ed_is_skipped_not_crashed_on(tmp_path):
    """A dangling symlink, or a directory a concurrent sweep removed between the glob and the stat.
    Deterministic here via the symlink: `glob` lists it and `stat` follows it to nothing."""
    (tmp_path / "mut-hrv-aaaaaaaaaaaa").symlink_to(tmp_path / "does-not-exist")
    real = _scratch(tmp_path, "mut-hrv-bbbbbbbbbbbb", owner=M.owner_record(999999, 1), age_sec=10**6)
    pruned, held = M.prune_scratches(tmp_path, "hrv", tmp_path / "mut-hrv-current")
    assert pruned == [real.name], pruned
    assert (tmp_path / "mut-hrv-aaaaaaaaaaaa").is_symlink(), "the dangling name was touched"


# ── draining the gate's report on THIS change (survivors on my own new lines) ────────────────────────
def test_a_non_directory_does_not_STOP_the_sweep(tmp_path):
    """`continue` → `break` on the non-directory branch. The earlier file test had nothing after the
    file, so ending the loop there looked identical to skipping it — the prunable tree must sort
    AFTER the file for the difference to exist at all."""
    (tmp_path / "mut-ppg-aaaaaaaaaaaa").write_text("not a directory", encoding="utf-8")
    later = _scratch(tmp_path, "mut-ppg-zzzzzzzzzzzz", owner=M.owner_record(999999, 1), age_sec=10**6)
    pruned, _ = M.prune_scratches(tmp_path, "ppg", tmp_path / "mut-ppg-current")
    assert pruned == [later.name], f"the sweep stopped at the file instead of skipping it: {pruned}"


def test_the_prune_honours_the_CALLERS_clock_and_reports_the_true_age(tmp_path):
    """Two survivors: `now` recomputed instead of taken from the caller, and the age floored at 1.0
    instead of 0.0. Both are invisible unless the age reaches the reason text."""
    import os as _os

    d = _scratch(tmp_path, "mut-cpap-aaaaaaaaaaaa", owner=M.owner_record(999999, 1))
    mtime = _os.stat(d).st_mtime
    # +60, not the mtime itself: with `now` recomputed from the wall clock the age is ~0.00s, which
    # renders as "0s" exactly like the injected value would — the mutant hid inside the format.
    _pruned, held = M.prune_scratches(tmp_path, "cpap", tmp_path / "mut-cpap-current", now=mtime + 60.0)
    assert len(held) == 1
    assert "only 60s old" in held[0], f"the caller's clock was ignored: {held[0]}"
    # And the floor is 0.0, not 1.0: a clock that runs backwards must report no age, not one second.
    _p2, h2 = M.prune_scratches(tmp_path, "cpap", tmp_path / "mut-cpap-current", now=mtime - 5.0)
    assert "only 0s old" in h2[0], h2


def test_the_current_scratch_is_spared_even_with_NO_live_owner(tmp_path):
    """`is_current=(old_dir == current)` → `is_current=None`. The earlier test's own scratch had a
    LIVE owner, so it was kept for the other reason and the mutation made no difference."""
    mine = _scratch(tmp_path, "mut-ecg-aaaaaaaaaaaa", owner=M.owner_record(999999, 1), age_sec=10**6)
    pruned, held = M.prune_scratches(tmp_path, "ecg", mine)
    assert pruned == [] and mine.exists(), "this run deleted its OWN scratch mid-run"
    assert held == [], "the current scratch is not a 'held' survivor; it is simply this run's"


def test_the_prune_can_be_observed_without_deleting_and_ignores_errors(tmp_path):
    """The `remove` seam, and the `ignore_errors=True` it is called with. A concurrent sweep removing
    the same tree between this run's stat and its rmtree must not crash the sweep — that is the whole
    reason the flag is set, and nothing observed it."""
    seen = []

    def _remove(path, **kw):
        seen.append((path.name, kw))

    doomed = _scratch(tmp_path, "mut-motion-aaaaaaaaaaaa", owner=M.owner_record(999999, 1), age_sec=10**6)
    pruned, _ = M.prune_scratches(tmp_path, "motion", tmp_path / "mut-motion-current", remove=_remove)
    assert pruned == [doomed.name] and doomed.exists(), "the injected remove was bypassed"
    assert seen == [(doomed.name, {"ignore_errors": True})], seen


def test_an_owner_marker_that_is_not_UTF_8_does_not_take_the_sweep_down(tmp_path):
    """A marker is advisory; a corrupt one must read as UNKNOWN, not raise out of the sweep."""
    d = _scratch(tmp_path, "mut-glu-aaaaaaaaaaaa")
    (d / M.SCRATCH_OWNER_FILE).write_bytes(b"\xff\xfe not utf-8 \x00")
    import os as _os

    _old = __import__("time").time() - 10**6  # age the DIR after writing into it: a write to a
    _os.utime(d, (_old, _old))  # child updates the parent's mtime and undoes it
    pruned, _ = M.prune_scratches(tmp_path, "glu", tmp_path / "mut-glu-current")
    assert pruned == [d.name], "an undecodable marker must fall back to the unmarked path"


def test_the_age_floors_are_exclusive_at_the_boundary():
    """`age < floor` → `age <= floor`. Exactly AT the floor the grace is over."""
    assert M.scratch_prune_decision(is_current=False, owner_live=False, age_sec=M.SCRATCH_MIN_AGE_SEC)[0] is True
    assert M.scratch_prune_decision(is_current=False, owner_live=None, age_sec=M.SCRATCH_UNKNOWN_MIN_AGE_SEC)[0] is True


def test_proc_start_ticks_NAMES_its_encoding(tmp_path):
    """`encoding="utf-8"` → `None`/omitted. /proc/<pid>/stat's comm field is arbitrary BYTES, so on a
    C-locale box an accented process name decodes to UnicodeDecodeError — a ValueError, which this
    function swallows into None, and a live owner then reads as DEAD and its scratch is deleted.
    Heron hit the same class on the PMD-arrival sidecar.

    CPython resolves the default encoding in C, so no in-process patch reaches it; `-X
    warn_default_encoding -W error::EncodingWarning` is the supported lever, and it holds on a UTF-8
    machine and a C-locale one alike. Same shape as
    test_solid_night_inputs.py::…_under_warn_default_encoding, including its two rules:

      · IN-PROCESS FIRST, not redundant — mutmut selects a mutant's tests from COVERAGE and a
        subprocess is invisible to the tracer, so without this call the test never runs against the
        mutants it kills and both `encoding=` survivors read as unkillable.
      · NO `env=` — the child must INHERIT `MUTANT_UNDER_TEST`, or it runs the original function
        however the parent was mutated. A handwritten env dict here is what made this test pass
        under plain pytest and survive under the gate.
    """
    import subprocess
    import sys

    d = tmp_path / "4242"
    d.mkdir()
    fields = " ".join(str(i) for i in range(3, 53))
    (d / "stat").write_bytes(f"4242 (caf\u00e9) {fields}\n".encode())

    assert M.proc_start_ticks(4242, proc_root=str(tmp_path)) == 22

    src = (
        "import mutation_diff as M\n"
        f"got = M.proc_start_ticks(4242, proc_root={str(tmp_path)!r})\n"
        "assert got == 22, got\n"
    )
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    assert r.returncode == 0, r.stderr[-600:]


def test_a_ONE_BYTE_module_against_a_ONE_BYTE_box_still_refuses():
    """`mutants_bytes <= 0` → `<= 1`. The absence guard must not swallow the smallest REAL
    measurement: one byte of generated mutants is a measurement, and against one byte of available
    memory it does not fit."""
    assert M.memory_refusal(1, 1, 1), "a 1-byte measurement is not an absent one (§∅)"


def test_a_projection_EXACTLY_at_the_cap_fits():
    """`projected <= cap` → `projected < cap`. Only an exact equality separates them, and a boundary
    built by integer division never lands on it."""
    mutants = 1_000_000  # 15 MB per worker, exactly
    per_worker = mutants * M.WORKER_RSS_PER_MUTANTS_BYTE
    avail = int(4 * per_worker / M.MEM_CAP_FRACTION)  # cap == exactly 4 workers' worth
    assert per_worker * 4 == avail * M.MEM_CAP_FRACTION, "the test must land ON the boundary"
    assert M.memory_refusal(mutants, 4, avail) is None, "exactly at the cap must FIT"


def test_ONE_worker_over_the_cap_still_refuses():
    """`workers <= 0` → `workers <= 1` made a single-worker run unmeasurable by the guard, and one
    worker is exactly the 8.2 GB case the fleet's per-process limit is about."""
    assert M.memory_refusal(536 * 1024**2, 1, 1 * _GB), "one worker over the cap must refuse"


def test_a_single_BYTE_of_available_memory_is_still_a_measurement():
    """`available_bytes <= 0` → `<= 1`. A box reporting one byte available is absurd but REPORTED,
    and a reported one is not an absence (§∅)."""
    assert M.memory_refusal(536 * 1024**2, 16, 1), "1 byte available is a measurement, not a gap"


def test_MemAvailable_is_read_even_without_a_unit_suffix():
    """`len(parts) >= 2` → `> 2`/`>= 3` assumed a trailing `kB` the format does not promise."""
    assert M.available_bytes_from_meminfo("MemAvailable:   40000000\n") == 40000000 * 1024


def test_the_memory_verdict_names_how_many_functions_it_refused():
    """`what = None` survived an assertion that only looked for 'examined nothing'."""
    _, reason = M.memory_exhaustion_verdict(3, 0)
    assert reason.startswith("3 function(s) not mutated — projected memory exceeds the run's cap"), reason


def test_ONE_decided_mutant_makes_a_memory_refusal_UNKNOWN_not_NOT_RUN():
    """`decided > 0` → `> 1`, the same boundary the budget verdict has and this one lacked."""
    assert M.memory_exhaustion_verdict(1, 1)[0] == "UNKNOWN"
    assert M.memory_exhaustion_verdict(1, 0)[0] == "NOT_RUN"


# ── MUTATION SCOPE FOLLOWS SEMANTIC CHANGE, NOT LINE MOVEMENT ───────────────────────────────────────
# Sized by the 2026-09-28 whole-tree reformat: 8,859 hunks across 423 files for a change that altered
# no behaviour, which cannot finish inside the gate budget and so refuses — a required refusal on a
# PR whose mutants were never in question. Under this rule the same diff scopes to 20 functions.
_REFORMATTED = '''
def f(a, b):
    """Doc."""
    return (
        a
        + b
    )
'''
_ORIGINAL = '''
def f(a, b):
    """Doc."""
    return a + b
'''


def test_a_function_only_REFLOWED_is_not_in_scope():
    """THE PLANT. Same AST, different text — the formatter moved lines it did not change."""
    names, why = M.functions_with_changed_ast(_ORIGINAL, _REFORMATTED)
    assert why is None
    assert names == set(), f"a reflow put {names} in mutation scope"


def test_a_ONE_TOKEN_semantic_edit_IS_in_scope():
    """THE CONTROL, and the half that makes the plant worth anything: the rule must still catch a
    real change in the same shape of file. `a + b` → `a - b` is one token."""
    names, _ = M.functions_with_changed_ast(_ORIGINAL, _REFORMATTED.replace("+ b", "- b"))
    assert names == {"x_f"}, names


def test_a_changed_STRING_is_a_semantic_change():
    """No blanking. A blanked comparison would scope a changed log line, format string or SQL
    fragment to NOTHING, which is the hole this rule must not open — a string value is behaviour."""
    a = 'def g():\n    log("started")\n'
    b = 'def g():\n    log("stopped")\n'
    assert M.functions_with_changed_ast(a, b)[0] == {"x_g"}


def test_a_re_indented_DOCSTRING_no_longer_scopes_and_here_is_why_that_CHANGED():
    """⚠️ THIS TEST ASSERTED THE OPPOSITE IN #3199, deliberately, and is inverted here deliberately.

    #3199 scoped a docstring change on the reasoning that the rule must never decide "which strings
    matter". That reasoning still holds for every other string. What changed is a MEASUREMENT: mutmut
    3.8 generates ZERO mutants for a docstring node (a function of [docstring + `return 1`] yields
    exactly one mutant, `return 2`). So the docstring statement is not a string the rule is judging —
    it is the one node with no mutants behind it, which is a syntactic fact rather than a preference.

    The cost of the old answer was measured too: 14 docstring re-indents pulled capture.py into a
    reformat's mutation scope and CI cancelled the job at its 180-minute timeout."""
    a = 'def h():\n    """Line.\n      indented."""\n    return 1\n'
    b = 'def h():\n    """Line.\n    indented."""\n    return 1\n'
    assert M.functions_with_changed_ast(a, b)[0] == set()


def test_an_UNPARSEABLE_revision_narrows_nothing_and_says_why():
    """§∅ — a question we cannot answer is not an answer of "no change". An unparseable side must
    leave scope exactly as the line scan found it, with the reason printed."""
    names, why = M.functions_with_changed_ast("def f():\n    return 1\n", "def f(:\n")
    assert names == set() and why and "does not parse" in why, (names, why)


def test_a_NEW_function_is_in_scope_and_a_DELETED_one_is_not():
    """A function only in the head revision changed (it appeared). One only in the base generates no
    mutants at all, so it is not scope — there is nothing to mutate."""
    a = "def keep():\n    return 1\n\n\ndef gone():\n    return 2\n"
    b = "def keep():\n    return 1\n\n\ndef fresh():\n    return 3\n"
    assert M.functions_with_changed_ast(a, b)[0] == {"x_fresh"}


def test_a_method_is_mangled_BY_ITS_CLASS_like_the_line_scan_does():
    """🔴 THE NAMES MUST MATCH `functions_covering`'s MANGLING or the intersection is silently empty
    and EVERY function drops out of scope — a gate that reports green on everything. Measured exactly
    that on the first version: 0 functions scoped where 19 was the right answer."""
    a = "class A:\n    def m(self):\n        return 1\n\n\nclass B:\n    def m(self):\n        return 2\n"
    b = "class A:\n    def m(self):\n        return 1\n\n\nclass B:\n    def m(self):\n        return 99\n"
    assert M.functions_with_changed_ast(a, b)[0] == {"xǁBǁm"}


def test_an_ASYNC_function_is_judged_the_same_way():
    a = "async def go():\n    return 1\n"
    assert M.functions_with_changed_ast(a, a.replace("1", "2"))[0] == {"x_go"}
    assert M.functions_with_changed_ast(a, "async def go():\n    return (\n        1\n    )\n")[0] == set()


def test_a_def_in_an_EXCEPT_ELSE_or_FINALLY_is_seen_by_BOTH_walkers():
    """🔴 THE TWIN OF THE MANGLING BUG: the two walkers must agree on MEMBERSHIP, only ever on
    content. `functions_covering` walks `ast.iter_child_nodes` — every field, including `handlers`,
    `orelse` and `finalbody` — so a `def` inside `except:`, `else:` or `finally:` is in scope by the
    line scan. Walking `node.body` alone missed all three, so the intersection dropped genuinely
    edited functions SILENTLY and with no reason printed. The `except ImportError: def shim(...)`
    shape is real in this tree (optional-dependency shims)."""
    old = (
        "try:\n    import foo\nexcept ImportError:\n    def shim(a): return a + 1\n"
        "if True: pass\nelse:\n    def alt(b): return b * 2\n"
        "class K:\n    if True: pass\n    else:\n        def m(self): return 1\n"
    )
    new = old.replace("a + 1", "a + 2").replace("b * 2", "b * 3").replace("return 1", "return 9")
    changed, why = M.functions_with_changed_ast(old, new)
    assert why is None
    assert changed == {"x_shim", "x_alt", "x\u01c1K\u01c1m"}, changed
    # …and the two walkers see the SAME SET, which is the property that makes the intersection safe.
    assert M.functions_covering(new, set(range(1, new.count("\n") + 2))) == changed


def test_a_def_in_a_FINALLY_is_reached_too():
    old = "def outer():\n    try:\n        pass\n    finally:\n        def inner():\n            return 1\n"
    assert M.functions_with_changed_ast(old, old.replace("return 1", "return 2"))[0] == {"x_outer", "x_inner"}


def test_a_nested_def_inside_a_METHOD_keeps_its_class(sub=None):
    """`visit(child, cls)` → `visit(child, None)` survived: a function nested inside a method would
    be named `x_inner` instead of `xǁKǁinner`, so it would never match the stem the line scan hands
    over and would drop out of scope silently. Asserted against `functions_covering` rather than a
    literal, because the two agreeing IS the property."""
    src = "class K:\n    def m(self):\n        def inner():\n            return 1\n        return inner\n"
    changed, _ = M.functions_with_changed_ast(src, src.replace("return 1", "return 2"))
    assert changed == {"x\u01c1K\u01c1m", "x\u01c1K\u01c1inner"}, changed
    assert changed == M.functions_covering(src, set(range(1, 9)))


def test_two_defs_under_ONE_stem_are_compared_TOGETHER():
    """`out.get(stem, "")` → `out.get(None, "")` survived: the accumulation is what makes a stem mean
    "every body under this name". Without it only the LAST body is compared, so a change to the
    FIRST of two same-named defs is invisible — and both collapse to one mutant glob, so the gate
    would mutate a function whose edit this rule said was not there."""
    dup = "def f():\n    return 1\n\n\ndef f():\n    return 2\n"
    assert M.functions_covering(dup, set(range(1, 9))) == {"x_f"}
    assert M.functions_with_changed_ast(dup, dup.replace("return 1", "return 9"))[0] == {"x_f"}, (
        "a change to the FIRST body under a shared stem was not seen"
    )
    assert M.functions_with_changed_ast(dup, dup.replace("return 2", "return 9"))[0] == {"x_f"}


# ── A CHANGE CONFINED TO A DOCSTRING HAS NOTHING TO MUTATE ──────────────────────────────────────────
# MEASURED on mutmut 3.8 before this rule was written: a function of [docstring + `return 1`] generates
# exactly ONE mutant (`return 2`) and ZERO touch the docstring. So the docstring statement is the one
# node with no mutants behind it, and scoping a function for it re-mutates a body that did not change.
# Cost of not having this: 14 docstring re-indents pulled capture.py (20,021 mutants, ~22 min to
# GENERATE on 24 cores) into a reformat's scope, and CI cancelled the job at 180 minutes.
_DOC_A = 'def g(x):\n    """Summary.\n      indented line."""\n    return x + 1\n'
_DOC_B = 'def g(x):\n    """Summary.\n    indented line."""\n    return x + 1\n'


def test_a_RE_INDENTED_docstring_scopes_nothing():
    """THE PLANT. This is the shape a formatter produces, and the only difference is the docstring."""
    assert M.functions_with_changed_ast(_DOC_A, _DOC_B)[0] == set()


def test_a_docstring_change_PLUS_a_token_change_still_scopes():
    """THE CONTROL, and the half that keeps the rule honest: the exemption is for a change CONFINED
    to the docstring, never for a function that also changed."""
    assert M.functions_with_changed_ast(_DOC_A, _DOC_B.replace("x + 1", "x + 2"))[0] == {"x_g"}


def test_a_REWRITTEN_docstring_also_scopes_nothing():
    """Not just re-indentation — any docstring-only edit. There is still nothing to mutate."""
    both = _DOC_A.replace("Summary.", "A completely different summary sentence.")
    assert M.functions_with_changed_ast(_DOC_A, both)[0] == set()


def test_a_changed_NON_docstring_string_still_scopes():
    """The line between this rule and a hole: only the DOCSTRING statement is exempt. A log line, a
    format string or an SQL fragment is an ordinary string constant and mutmut does mutate it."""
    a = 'def h():\n    """Doc."""\n    log("started")\n'
    b = 'def h():\n    """Doc."""\n    log("stopped")\n'
    assert M.functions_with_changed_ast(a, b)[0] == {"x_h"}


def test_ADDING_or_REMOVING_a_docstring_scopes_nothing_either():
    """Both directions, because `_strip_docstring` must treat an absent docstring the same as a
    present one — otherwise adding one reads as a body change."""
    without = "def k():\n    return 7\n"
    with_doc = 'def k():\n    """Now documented."""\n    return 7\n'
    assert M.functions_with_changed_ast(without, with_doc)[0] == set()
    assert M.functions_with_changed_ast(with_doc, without)[0] == set()


def test_a_function_whose_BODY_IS_ONLY_a_docstring_is_handled():
    """`clone.body = body[1:]` would leave an EMPTY body, which is not valid AST. Stripping must
    substitute a `Pass` or this raises instead of answering."""
    a = 'def only():\n    """One."""\n'
    b = 'def only():\n    """Two."""\n'
    assert M.functions_with_changed_ast(a, b)[0] == set()


def test_the_rule_does_NOT_use_ast_get_docstring_with_its_default_cleaning():
    """🔴 THE TRAP, pinned because it gave a confidently wrong answer on every real case.
    `ast.get_docstring(node)` defaults to `clean=True` and normalises leading whitespace, so a
    RE-INDENTED docstring compares EQUAL through it — which would report "no difference at all",
    scope NOTHING anywhere, and do it silently. This asserts the two docstrings genuinely differ in
    their RAW text while `clean=True` cannot see it, so a future reader cannot conclude the cleaned
    comparison would have been equivalent."""
    import ast as _ast

    a, b = _ast.parse(_DOC_A).body[0], _ast.parse(_DOC_B).body[0]
    assert _ast.get_docstring(a) == _ast.get_docstring(b), "clean=True hides it — that is the trap"
    assert _ast.get_docstring(a, clean=False) != _ast.get_docstring(b, clean=False), (
        "the raw docstrings DO differ, which is why the rule compares structurally instead"
    )


def test_a_changed_DECORATOR_scopes_the_function():
    """`ast.dump(d)` → `ast.dump(None)` survived: every decorator would dump identically, so two
    functions differing ONLY in their decorators compare equal and the function is dropped from
    scope. A decorator change is a behaviour change — it is what wraps the call — and the signature
    and decorator list are dumped precisely because the body alone does not carry them."""
    a = "@retry\ndef f():\n    return 1\n"
    b = "@cache\ndef f():\n    return 1\n"
    assert M.functions_with_changed_ast(a, b)[0] == {"x_f"}
    # …and adding one where there was none.
    assert M.functions_with_changed_ast("def f():\n    return 1\n", a)[0] == {"x_f"}


def test_a_changed_SIGNATURE_scopes_the_function():
    """The sibling property, for the same reason: `ast.dump(node.args)` is in the comparison because
    a parameter list change is not visible in the body statements."""
    assert M.functions_with_changed_ast("def f(a):\n    return 1\n", "def f(a, b=2):\n    return 1\n")[0] == {"x_f"}


# ── the COMMITTED generated-size record ─────────────────────────────────────────────────────────────
# Every CI run is a fresh scratch, so a size remembered only beside the scratch is a size CI never has.
# The record is what lets a hosted runner refuse capture.py at 0 workers in minute one, NAMED, instead of
# burning the generation budget to rediscover it.


def test_the_size_record_round_trips_and_a_hash_MISS_IS_ABSENT():
    """The keying is the whole safety property: a size measured from a DIFFERENT version of the source is
    a guess wearing a measurement's clothes. So a miss must be absent, never the nearest entry."""
    text = M.merge_mutants_size("", "capture.py", "7cf809a4bbf4", 562427047, "2026-09-28", "rig-x870")
    rec = M.mutants_size_record(text)
    assert rec[("capture.py", "7cf809a4bbf4")] == 562427047
    assert rec.get(("capture.py", "8c405e68387e")) is None, "a different source hash must not inherit a size"
    assert rec.get(("other.py", "7cf809a4bbf4")) is None, "a different module must not inherit it either"


def test_the_record_survives_being_unreadable_or_absent():
    """A record that cannot be parsed must read as NO KNOWLEDGE, not as a crash and not as a zero that
    some caller treats as permissive. The tool runs on hosts where this file may not exist at all."""
    assert M.mutants_size_record("") == {}
    assert M.mutants_size_record("{not json") == {}
    assert M.mutants_size_record('{"sizes": {"bad-key": 12}}') == {}, "a key with no @hash is not a row"
    assert M.mutants_size_record('{"sizes": {"m.py@abc": 0}}') == {}, "a zero size is absence, not a measurement"
    assert M.mutants_size_record('{"sizes": {"m.py@abc": -5}}') == {}
    assert M.mutants_size_record('{"sizes": {"m.py@abc": "big"}}') == {}
    assert M.mutants_size_record('{"sizes": {"@abc": 5}}') == {}
    assert M.mutants_size_record('{"sizes": {"m.py@": 5}}') == {}
    assert M.mutants_size_record('{"sizes": {"m.py@abc": 7}}') == {("m.py", "abc"): 7}, "a bare int is a size"


def test_a_re_measurement_REPLACES_and_says_what_it_superseded():
    """The same source hash generating a different size means the GENERATOR changed (a mutmut bump), and
    the newer number describes the mutmut this tree pins. Keeping both, or averaging, would describe
    neither — but the old value stays visible so the change is not silent."""
    t1 = M.merge_mutants_size("", "m.py", "aaa", 100, "2026-09-01", "rig")
    t2 = M.merge_mutants_size(t1, "m.py", "aaa", 250, "2026-09-28", "rig")
    import json as _j

    entry = _j.loads(t2)["sizes"]["m.py@aaa"]
    assert entry["generatedBytes"] == 250
    assert entry["supersedes"] == 100, "a replaced measurement must stay visible"
    # Idempotent on an unchanged measurement: re-recording the same size adds no `supersedes` noise.
    t3 = M.merge_mutants_size(t2, "m.py", "aaa", 250, "2026-09-29", "rig")
    assert "supersedes" not in _j.loads(t3)["sizes"]["m.py@aaa"]
    # …and a corrupt file is rebuilt rather than inherited, so one bad write cannot poison every later one.
    assert (
        _j.loads(M.merge_mutants_size("{not json", "m.py", "aaa", 7, "d", "h"))["sizes"]["m.py@aaa"]["generatedBytes"]
        == 7
    )


def test_the_committed_record_in_this_tree_parses_and_is_keyed_to_real_modules():
    """The file itself, not a fixture: a record nobody can parse is a record that silently stops helping,
    and the keys must name modules this tree actually has."""
    import pathlib as _p

    path = _p.Path(__file__).resolve().parent.parent / "tools" / "mutation-sizes.json"
    assert path.exists(), "the committed size record is missing"
    rec = M.mutants_size_record(path.read_text(encoding="utf-8"))
    assert rec, "the committed record parses to nothing — every CI run is a fresh scratch and would learn nothing"
    root = path.parent.parent
    for module, src_hash in rec:
        assert (root / module).exists(), f"{module} is recorded but not in the tree"
        assert len(src_hash) == 12 and all(c in "0123456789abcdef" for c in src_hash), src_hash


def test_an_unknown_size_is_capped_and_NEVER_the_core_count():
    """🔴 The first cut of this fix fell back to `os.cpu_count()` when no size was known — the exact
    over-commit it exists to prevent, alive in the one branch that matters, because the FIRST run on any
    source hash is the unknown case and that is the case #3202 was."""
    assert M.UNKNOWN_SIZE_WORKERS < 8, "the unknown-size fallback must be small, not a core count"
    assert M.workers_that_fit(0, 14 * 1024**3) == 0, "an unknown size affords nothing to derive from"


# ── the 29 survivors #3208's own gate found in the code above ───────────────────────────────────────
# The gate decided all 204 mutants over these six functions and 29 lived. They were real gaps, not
# equivalent mutants, and two are findings rather than coverage debt: nothing asserted the committed
# record's SERIALISATION (an unstable one churns the diff on every write), and nothing asserted that one
# malformed row does not silently drop every row after it.


def test_the_record_SERIALISATION_is_stable_because_the_file_is_committed():
    """`json.dumps(doc, indent=2) + "\\n"` → `indent=None`, `indent=3`, or no indent at all all survived.
    For a COMMITTED file that is not cosmetic: an unstable serialisation rewrites the whole file on every
    `--record-sizes`, so a one-entry measurement lands as a whole-file diff and the next session cannot
    see what changed."""
    text = M.merge_mutants_size("", "m.py", "aaa", 100, "2026-09-28", "rig")
    assert text.endswith("}\n"), "the record must end with exactly one newline — a committed file needs it"
    assert text.startswith('{\n  "'), f"two-space indent, not compact and not three: {text[:20]!r}"
    assert '\n  "sizes": {\n    "m.py@aaa": {\n      "generatedBytes": 100' in text, text[:400]
    # …and the schema and note are part of the record, not decoration: a reader who finds this file needs
    # to know what wrote it and that hand-editing it destroys its only value.
    import json as _j

    doc = _j.loads(text)
    assert doc["schema"] == "tepna.mutation-sizes/1"
    assert "NEVER hand-edited" in doc["note"]
    assert "--record-sizes" in doc["note"], "the note must name the tool that writes it"
    assert "absent, not a default" in doc["note"], "the note must state that a miss is absence"


def test_ONE_malformed_row_does_not_drop_every_row_after_it():
    """`continue` → `break` survived. For a file whose whole job is remembering sizes, that turns a single
    bad row into silent amnesia for everything below it — and amnesia reads as "nothing to worry about",
    which is the §∅ failure this PR exists to fix, one layer along."""
    rec = M.mutants_size_record('{"sizes": {"aaa-no-at": 5, "good.py@abc123abc123": 7, "zzz.py@def456def456": 9}}')
    assert rec == {("good.py", "abc123abc123"): 7, ("zzz.py", "def456def456"): 9}, rec


def test_the_module_is_everything_before_the_FIRST_at_sign():
    """`partition` → `rpartition` survived, and the two disagree only on a key with more than one `@`. The
    documented key is `<module>@<hash>`, so the hash is the LAST field and the module is the first — but a
    key with two `@` is malformed either way, and what matters is that it does not resolve to a module this
    tree has. Pinned so the choice is deliberate rather than whichever function was typed."""
    rec = M.mutants_size_record('{"sizes": {"a@b@c": 5}}')
    assert rec == {("a", "b@c"): 5}, f"partition semantics: module is before the FIRST @, got {rec}"


def test_a_ONE_BYTE_size_is_a_measurement():
    """`size > 0` → `size > 1` survived. One byte is absurd for a generated module and that is exactly why
    it must be KEPT: the rule is "absence is absent", not "small values are absent". A guard that silently
    discards implausible measurements is a guard that decides what the data may say."""
    assert M.mutants_size_record('{"sizes": {"m.py@abc": 1}}') == {("m.py", "abc"): 1}


def test_the_generation_reason_defaults_to_NOTHING_WRITTEN_and_distinguishes_one_byte():
    """Two survivors here: the `mutants_bytes=0` default (never exercised, because every call passed it)
    and the `> 0` ternary. A caller that cannot measure the partial file must get "nothing written yet",
    and one byte must NOT read as nothing."""
    assert "nothing written yet" in M.generation_timeout_reason(60.0, 61.0), "the default must be the absent case"
    assert "nothing written yet" not in M.generation_timeout_reason(60.0, 61.0, 1)
    assert "0 MB of mutants written" in M.generation_timeout_reason(60.0, 61.0, 1)


def test_workers_that_fit_boundaries_are_pinned_at_the_EXACT_edge():
    """Seven survivors were boundary arithmetic: `<= 0` → `< 0` / `<= 1`, `or` → `and`, `//` → `/`. Each
    needs the value ON the edge, which no test had."""
    GB = 1024**3
    # `or` → `and`: one bad input is enough, both are not required.
    assert M.workers_that_fit(0, 14 * GB) == 0, "no size is enough to refuse on its own"
    assert M.workers_that_fit(562427047, 0) == 0, "no memory reading is enough to refuse on its own"
    # `<= 0` → `< 0` and `<= 1`: exactly 0 and exactly 1.
    assert M.workers_that_fit(1, 14 * GB) > 0, "a 1-byte module is measured, so it must be sized, not refused"
    assert M.workers_that_fit(-1, 14 * GB) == 0
    assert M.workers_that_fit(562427047, 1) == 0, "one byte available affords nothing"
    # `//` → `/`: the count is a WHOLE number of workers. With `/` this returns the same int after the
    # outer int(), so the discriminating case is one where the quotient's fraction matters to the caller:
    # assert the type and that a fractional affordance floors rather than rounds up.
    n = M.workers_that_fit(3 * GB, 14 * GB, rss_factor=1.0)
    assert isinstance(n, int) and n == 2, f"7 GB cap / 3 GB per worker must FLOOR to 2, got {n!r}"


def test_the_PHASE_branch_bounds_its_reap_and_its_remaining_wall_wait():
    """Three survivors lived in the phase branch's waits: the post-kill `proc.wait(timeout=REAP_SEC)`
    becoming `rc = None` or `timeout=None`, and the "phase finished, wait out the rest" call becoming
    `timeout=None`. The UNPHASED path already asserts its `timeout=` arguments (`_RecordingProc` below);
    adding the branch duplicated the code without duplicating the assertion, which is exactly how a fix
    reintroduces the bug class it was written for one indent over."""
    rec = _RecordingProc()
    M.stream_bounded(rec, 1.0, lambda _l: None, phase_cap_sec=1.0, phase_done=lambda: False)
    assert rec.killed, "the phase deadline fired but the child was never killed"
    assert len(rec.timeouts) >= 2, f"expected a bounded wait then a bounded reap, got {rec.timeouts}"
    assert rec.timeouts[-1] == M.REAP_SEC, (
        f"the post-kill reap must be bounded by REAP_SEC, got {rec.timeouts[-1]!r} — `timeout=None` here "
        "hands an unkillable child the power to hang the refusal forever"
    )
    # …and when the phase DID finish, the remaining wall wait is bounded too, not `timeout=None`.
    rec2 = _RecordingProc()
    M.stream_bounded(rec2, 30.0, lambda _l: None, phase_cap_sec=1.0, phase_done=lambda: True)
    assert all(t is not None for t in rec2.timeouts), (
        f"every wait must carry a deadline; got {rec2.timeouts} — an unbounded second wait is the original "
        "unreachable-cap defect, restored in the phase path"
    )


def test_a_HALF_DECLARED_phase_falls_through_instead_of_calling_None():
    """`phase_cap_sec is not None AND phase_done is not None` → `OR` survived. With `or`, declaring only
    one of the pair enters the phase branch and calls `phase_done()` on `None`, so the guard I added would
    raise inside the wait instead of behaving like an unphased call. Both half-declared shapes must fall
    through, and the third member must still come back False."""
    proc = _child("import sys\nprint('done')\nsys.exit(0)\n")
    rc, timed_out, phase_timed_out = M.stream_bounded(proc, 60.0, lambda _l: None, phase_cap_sec=1.0)
    assert (rc, timed_out, phase_timed_out) == (0, False, False), (rc, timed_out, phase_timed_out)
    proc2 = _child("import sys\nprint('done')\nsys.exit(0)\n")
    rc2, timed_out2, phase2 = M.stream_bounded(proc2, 60.0, lambda _l: None, phase_done=lambda: False)
    assert (rc2, timed_out2, phase2) == (0, False, False), (rc2, timed_out2, phase2)


def test_the_JOIN_bound_is_a_CONSTANT_because_a_default_cannot_be_mutation_tested():
    """🔴 `join_sec=10.0` → `11.0` survived an `inspect.signature(...).default == 10.0` assertion, and the
    reason is mutmut's dispatch, not the assertion: the generated module wraps the function as

        @_mutmut_mutated(mutants_x_stream_bounded__mutmut)
        def stream_bounded(proc, cap_sec, on_line, t0=None, join_sec=10.0, …)

    — a `def` that keeps the ORIGINAL defaults, dispatching to the mutant dict at CALL time. So signature
    introspection reads 10.0 under every mutant and CANNOT kill a default-value mutation. Same family as
    #3181's "survives mutmut's trampoline". The load-bearing number therefore lives as a module constant,
    which is not decorated and so is visible to mutation; the signature merely references it.

    No behavioural test can separate a 10 s join from an 11 s one without spending the difference in real
    seconds on every run, which is the trade `cap_remaining`'s tests already record for the deadline."""
    assert M.JOIN_SEC == 10.0, "the pre-stated join bound moved without a reason"
    import inspect

    assert inspect.signature(M.stream_bounded).parameters["join_sec"].default == M.JOIN_SEC, (
        "the signature must reference the constant, not re-declare the number — a second copy is a second "
        "thing to mutate, and the signature copy is the one mutation testing cannot see"
    )


def test_the_distinguishable_workers_that_fit_boundaries_the_probe_FOUND():
    """I assumed all six surviving boundary mutants were masked by the later guards. An exhaustive probe
    over 1,980 input combinations refuted three of them, and assuming would have put three KILLABLE
    mutants into the equivalence ledger — which the ledger reports as REFUTED, but only once someone runs
    it. Each needs a non-default `rss_factor`/`cap_fraction`, and both are public parameters."""
    # `available_bytes <= 0` → `<= 1`: distinguished only when ONE byte available still affords a worker,
    # which needs a per-worker cost at or below it.
    assert M.workers_that_fit(1, 1, rss_factor=1.0, cap_fraction=1.0) == 1, "1 byte available, 1 byte per worker"
    # `per_worker <= 0` → `<= 1`: distinguished by a sub-byte per-worker cost.
    # …and the SAME input kills `//` → `/`: floor, not true division. In binary 1.0/0.001 is 1000.0 while
    # `1.0 // 0.001` is 999.0, so `/` reports one worker MORE than the cap affords. Over-committing by one
    # worker is the whole failure this function exists to prevent, so the floor is the behaviour and not a
    # style choice — and the expected value is READ FROM THE FUNCTION's own arithmetic, which is why this
    # assertion first failed with my hand-computed 1000 against the real 999.
    assert M.workers_that_fit(1, 1, rss_factor=0.001, cap_fraction=1.0) == 999
    assert M.workers_that_fit(1, 1, rss_factor=0.001, cap_fraction=0.5) == 499


def test_the_MB_scale_in_the_generation_reason_is_MEBIbytes():
    """`1024.0 ** 2` → `1025.0 ** 2` survived: the two agree after `:.0f` for almost every size, so the
    distinguishing input has to be found rather than guessed — 210,501,632 bytes reads 201 MB against
    1024² and 200 MB against 1025². A reason line that misreports how far a killed run got is a small
    thing, but it is the only number that survives the kill."""
    r = M.generation_timeout_reason(60.0, 61.0, 210501632)
    assert "201 MB of mutants written" in r, r


# ── A ZERO THAT WAS NEVER A MEASUREMENT ───────────────────────────────────────────────────────────
# `unmeasured_zero` is the third statement of one rule, after `zero_population_verdict` (a PASS over
# checked 0 is not a pass) and `result_inconsistency` (a verdict whose counters disagree cannot vouch
# for itself). Those two guard the VERDICT; this guards the counts it is assembled from, which is
# where the failure has actually shipped — twice, in the same three-line function.
#
# The control is the point of the whole design and is asserted first: a function with no mutable
# operator genuinely counts 0, and refusing there would red a rename, a docstring edit or a reformat.
def test_a_clean_zero_over_a_population_that_WAS_examined_is_not_refused():
    """THE CONTROL. This is why a bare zero was ever trusted, and it must keep working."""
    scan = {
        "helper": "generated_under_glob",
        "glob": "m.x_identity__mutmut_*",
        "matched": 0,
        "corroborated": 0,
        "examined": 138,  # the file HAS mutants — 138 of them, for other functions
        "registered": 138,
        "sourceBytes": 40000,
    }
    assert M.unmeasured_zero(scan) is None, (
        "a function with no mutable operator counts 0 over a file that was read — benign, and the "
        "measured 2026-08-24 case (oxy_inventory.identity) that refusing here would have redded"
    )


def test_a_healthy_nonzero_count_is_not_refused():
    scan = {
        "helper": "generated_under_glob",
        "glob": "m.x_f__mutmut_*",
        "matched": 44,
        "corroborated": 44,
        "examined": 399,
        "registered": 399,
        "sourceBytes": 407771,
    }
    assert M.unmeasured_zero(scan) is None


def test_PLANT_the_construct_is_present_and_the_scan_cannot_see_it():
    """The historical bug, in the shape it actually had: 44 mutants registered, 0 counted.

    Pre-#3214 this returned 0 for every coroutine and the caller read it as "nothing to mutate". The
    integer was indistinguishable from the control above; only the corroboration separates them."""
    scan = {
        "helper": "generated_under_glob",
        "glob": "wifi_uplink.x__run__mutmut_*",
        "matched": 0,
        "corroborated": 44,
        "examined": 355,
        "registered": 399,
        "sourceBytes": 407771,
    }
    why = M.unmeasured_zero(scan)
    assert why is not None
    assert "0" in why and "44" in why and "disagree" in why
    assert "generated_under_glob" in why, "the refusal names the helper, not just the symptom"


def test_the_disagreement_is_checked_in_BOTH_directions():
    """A definition scan finding MORE than mutmut registered is equally a miscount. "Ours is higher so
    we are fine" is the reasoning that keeps a blind spot — there is no safe direction to be wrong in."""
    scan = {
        "helper": "generated_under_glob",
        "glob": "m.x_f__mutmut_*",
        "matched": 9,
        "corroborated": 4,
        "examined": 20,
        "registered": 15,
        "sourceBytes": 900,
    }
    assert M.unmeasured_zero(scan) is not None


def test_PLANT_the_scan_read_nothing_at_all():
    """An absent mutants file. A crash BEFORE generation writes neither mutants nor meta, so every
    count is 0 and the benign arm reports "nothing to mutate" — a coverage claim over a file that
    does not exist."""
    scan = {
        "helper": "generated_under_glob",
        "glob": "m.x_f__mutmut_*",
        "matched": 0,
        "corroborated": 0,
        "examined": 0,
        "registered": 0,
        "sourceBytes": 0,
    }
    why = M.unmeasured_zero(scan)
    assert why is not None and "absent or empty" in why
    assert "generated_under_glob" in why


def test_an_EMPTY_POPULATION_refuses_even_when_the_file_had_bytes():
    """The file was read and contained no mutant definitions at all. Not the same as an absent file —
    a truncated or half-written mutants file has bytes and no population — and equally not a count."""
    scan = {
        "helper": "generated_under_glob",
        "glob": "m.x_f__mutmut_*",
        "matched": 0,
        "corroborated": 0,
        "examined": 0,
        "registered": 0,
        "sourceBytes": 120,
    }
    assert "examined an empty population" in (M.unmeasured_zero(scan) or "")


def test_a_scan_without_corroboration_still_gets_the_population_checks():
    """`decided_scan` has no independent second count — the meta is the only record — so it carries
    `examined` and no `corroborated`, and the disagreement rule must not fire on its absence."""
    assert (
        M.unmeasured_zero(
            {"helper": "decided_under_glob", "glob": "m.x_f__mutmut_*", "matched": 0, "underGlob": 2, "examined": 3}
        )
        is None
    )
    why = M.unmeasured_zero(
        {"helper": "decided_under_glob", "glob": "m.x_f__mutmut_*", "matched": 0, "underGlob": 0, "examined": 0}
    )
    assert why is not None and "decided_under_glob" in why


def test_the_refusal_reason_is_a_sentence_a_reader_can_act_on():
    """Every non-PASS carries a reason (§🧾), and a reason naming only the symptom sends the reader to
    the wrong file. These name the HELPER, so the next person starts where the defect is."""
    for scan in (
        {
            "helper": "generated_under_glob",
            "glob": "g",
            "matched": 0,
            "corroborated": 3,
            "examined": 10,
            "registered": 13,
            "sourceBytes": 50,
        },
        {
            "helper": "generated_under_glob",
            "glob": "g",
            "matched": 0,
            "corroborated": 0,
            "examined": 0,
            "registered": 0,
            "sourceBytes": 0,
        },
    ):
        why = M.unmeasured_zero(scan)
        assert why and why[0].islower() and scan["helper"] in why and len(why) > 40


def test_the_refusal_NAMES_THE_GLOB_when_the_scan_carries_one():
    """Seven mutants survived on the two label lines because every test above asserted the HELPER and
    none asserted the glob. A refusal that says "generated_under_glob examined an empty population"
    without saying *for which function* sends the reader to a 2000-line module with no starting point,
    and on a run with several globs it is not even attributable."""
    why = M.unmeasured_zero(
        {
            "helper": "generated_under_glob",
            "glob": "wifi_uplink.x__run__mutmut_*",
            "matched": 0,
            "corroborated": 0,
            "examined": 0,
            "registered": 0,
            "sourceBytes": 0,
        }
    )
    assert "wifi_uplink.x__run__mutmut_*" in why
    assert "for wifi_uplink.x__run__mutmut_*" in why, "and reads as a sentence, not a bare token"


def test_a_scan_WITHOUT_a_glob_does_not_say_for_None():
    """The other half of the same line. `where` is conditional precisely so a scan with no glob reads
    cleanly; dropping the condition prints `for None`, which looks like a function actually called
    None and is worse than saying nothing."""
    why = M.unmeasured_zero(
        {
            "helper": "generated_under_glob",
            "matched": 0,
            "corroborated": 0,
            "examined": 0,
            "registered": 0,
            "sourceBytes": 0,
        }
    )
    assert why is not None
    assert "None" not in why, "no stray None leaks into a message a human reads"
    assert why.startswith("generated_under_glob read an absent")


def test_a_scan_with_NO_HELPER_still_produces_a_readable_refusal():
    """The `scan.get` default. A scan from a future caller that omits the key must not produce
    "None examined an empty population" — the fallback is what keeps the sentence a sentence."""
    why = M.unmeasured_zero({"matched": 0, "examined": 0})
    assert why is not None and "None" not in why
    assert why.startswith("a counting helper"), "the fallback label, not the absence of one"


# ── EVERY TERMINAL EMITS A VERDICT ────────────────────────────────────────────────────────────────
def test_the_crash_refusal_is_UNKNOWN_when_part_of_the_diff_WAS_measured():
    """The mixed case, and it is the COMMON one: the driver refuses if ANY glob crashed "even when
    others ran cleanly". A run that fully mutated six functions and lost a seventh did not examine
    nothing, and saying NOT_RUN about it describes the reader's ignorance rather than the run."""
    status, reason = M.crash_refusal_verdict(1, 44)
    assert status == "UNKNOWN"
    assert "44 mutant(s) were decided" in reason
    assert "unmeasured, not killed" in reason
    # …and it says WHAT happened, not only how much. `what` survived as `None` because every
    # assertion here was on the second half of the sentence: a reason reading "None; 44 mutant(s)
    # were decided" is well-formed, passes a substring check, and tells the reader nothing about the
    # crash that caused the refusal.
    assert "1 glob(s) recorded 0 tested mutants" in reason
    assert "crashed AFTER generation" in reason


def test_the_crash_refusal_is_NOT_RUN_when_nothing_was_decided_anywhere():
    status, reason = M.crash_refusal_verdict(3, 0)
    assert status == "NOT_RUN"
    assert "NOT ONE mutant was decided" in reason
    assert "examined nothing" in reason
    assert "3 glob(s) recorded 0 tested mutants" in reason and "crashed AFTER generation" in reason


def test_the_crash_split_is_the_SAME_RULE_as_its_three_siblings():
    """Four refusals, one split — a fifth spelling of it would be a fifth thing to get wrong.
    Asserted as a property over all of them rather than restated per function."""
    cases = [
        M.crash_refusal_verdict(1, 0),
        M.memory_exhaustion_verdict(1, 0),
        M.budget_exhaustion_verdict(1, 0, 10.0),
        M.clean_run_exhaustion_verdict(1, 0),
    ]
    assert [s for s, _ in cases] == ["NOT_RUN"] * 4, "nothing decided ⇒ the run examined nothing"
    cases = [
        M.crash_refusal_verdict(1, 7),
        M.memory_exhaustion_verdict(1, 7),
        M.budget_exhaustion_verdict(1, 7, 10.0),
        M.clean_run_exhaustion_verdict(1, 7),
    ]
    assert [s for s, _ in cases] == ["UNKNOWN"] * 4, "something decided ⇒ measured in part, cannot speak for the rest"
    # THE BOUNDARY, which is where the split actually lives. `decided > 0` → `decided > 1` survived:
    # under it a run that decided exactly ONE mutant reports "examined nothing". One is not nothing —
    # that mutant was run, and its result is the only thing standing between this run and a false
    # NOT_RUN. Asserted for all three so the boundary cannot drift apart between them.
    cases = [
        M.crash_refusal_verdict(1, 1),
        M.memory_exhaustion_verdict(1, 1),
        M.budget_exhaustion_verdict(1, 1, 10.0),
        M.clean_run_exhaustion_verdict(1, 1),
    ]
    assert [s for s, _ in cases] == ["UNKNOWN"] * 4, "ONE decided mutant is something, not nothing"


def test_EVERY_TERMINAL_IN_main_EMITS_A_VERDICT_OBJECT():
    """THE CLASS, not the instance. `return 2` sat in the §3 crash refusal for months: the one exit
    from `main()` that produced no `tepna.verdict/1` object and, with `--json`, wrote no artifact — so
    a consumer polling that file saw the PREVIOUS run's verdict, or nothing, for a run that refused.
    §🧾 requires one object from every gate that decides something, and nothing asserted it.

    Checked on the AST, not on the text: a reformat moves `return` lines and this must survive that
    (measured the hard way on #3196, where a whole-tree reformat broke four source-text scans).

    Two exits are allowed BY NAME and for a stated reason, never by a count — an allowlist that says
    "and two others" is how the third one gets in."""
    import ast as _ast
    import pathlib as _pl

    src = (_pl.Path(__file__).resolve().parent.parent / "tools" / "mutate_diff.py").read_text()
    main = next(n for n in _ast.walk(_ast.parse(src)) if isinstance(n, _ast.FunctionDef) and n.name == "main")
    # Names bound to the result of an `emit(...)` call: `_b = emit(...)` then `return _b` emits.
    emitted_names = {
        t.id
        for node in _ast.walk(main)
        if isinstance(node, _ast.Assign)
        and isinstance(node.value, _ast.Call)
        and isinstance(node.value.func, _ast.Name)
        and node.value.func.id == "emit"
        for t in node.targets
        if isinstance(t, _ast.Name)
    }
    assert emitted_names, "no `x = emit(...)` found — the scan is looking at the wrong function"
    # `_refusal` holds a previously emitted verdict under --report-only; it is re-returned, not a new exit.
    emitted_names.add("_refusal")

    nested = {d for d in _ast.walk(main) if isinstance(d, _ast.FunctionDef) and d is not main}
    nested_returns = {r for d in nested for r in _ast.walk(d) if isinstance(r, _ast.Return)}

    ALLOWED = {
        "selftest()": "--selftest runs the pure selftest and is not a gate verdict about a diff",
        "0": "--verdict-sample prints a synthetic object itself and exits; the adoption gate reads stdout",
    }
    offenders = []
    for node in _ast.walk(main):
        if not isinstance(node, _ast.Return) or node in nested_returns:
            continue
        v = node.value
        if isinstance(v, _ast.Call) and isinstance(v.func, _ast.Name) and v.func.id == "emit":
            continue
        if isinstance(v, _ast.Name) and v.id in emitted_names:
            continue
        if v is not None and _ast.unparse(v) in ALLOWED:
            continue
        offenders.append((node.lineno, _ast.unparse(v) if v else "None"))
    assert not offenders, (
        "every exit from main() must go through emit(), which is what builds the verdict object and "
        f"writes --json. Not via emit: {offenders}"
    )


# ── #3202's ORPHAN: a deadline must reap the GROUP, not the pid ──────────────────────────────────────
# The measurement behind every test below (2026-09-29, reproducing #3202 under a small GATE_BUDGET_SEC):
# `mutmut run` re-spawns itself, `proc.kill()` reaped only the pid this tool started, and the child was
# re-parented to systemd and kept generating for **2 h 32 m at 19.4 GB RSS** while holding the stdout it
# inherited. `TOOL-BUILD-STANDARD` §2.3 requires the opposite — "SIGKILL to the parent must terminate the
# entire job … no orphan writing to it after death" — and verification by the same section is "kill the
# parent, assert the workers are gone", which is what the plant does. #3234 is the JS half of this fix.
#
# EVERY ASSERTION HERE IDENTIFIES A PROCESS BY `/proc/<pid>/cmdline`, NEVER BY A `pgrep -f` PATTERN
# (§2.3, and §👥.4 for why the pattern also matches the asker). The recorded cmdline is compared
# BYTE-FOR-BYTE, so pid reuse between the kill and the check cannot read as a survivor — and a zombie,
# whose cmdline is empty, reads as dead rather than alive.

_GRANDCHILD_INHERITS_THE_PIPE = (
    "import os, subprocess, sys, time\n"
    "g = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(300)'])\n"
    "open(sys.argv[1], 'w').write(f'{os.getpid()}\\n{g.pid}\\n')\n"
    "sys.stdout.write('parent up\\n'); sys.stdout.flush()\n"
    "time.sleep(300)\n"
)


def _cmdline(pid):
    """The pid's argv as bytes, or None if there is no such live process. A zombie reads as `b''`."""
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as fh:
            return fh.read() or None
    except OSError:
        return None


def _gone(pid, was):
    """True once `pid` is no longer the process whose cmdline we recorded. Polled, because a group kill
    and the kernel's reaping of a re-parented child are not the same instant."""
    import time as _t

    end = _t.monotonic() + 10.0
    while _t.monotonic() < end:
        if _cmdline(pid) != was:
            return True
        _t.sleep(0.05)
    return False


def _reap_by_pid(*pids):
    """🔴 A PLANT NEVER CLEANS UP WITH THE CODE UNDER TEST. Reap by numeric pid with `os.killpg` /
    `os.kill` directly — never through `kill_process_group`, which is the thing being mutated.

    Measured on #3237's own CI run 2026-09-29: the SIGHUP plant reaped its child by calling
    `kill_process_group`, so under a mutant that breaks the reap the plant correctly FAILED *and* left
    the child alive holding the mutmut worker's inherited stdout — mutmut's parent never saw EOF, the
    run stalled at mutant 7 of 33, and the remaining 23 came back `not_checked` (UNMEASURED, which the
    gate refuses). A test that tidies up with the function under repair leaves behind exactly the
    failure it was written to detect, and it takes the runner with it."""
    for pid in pids:
        if not pid:
            continue
        for fn, arg in ((os.killpg, pid), (os.kill, pid)):
            try:
                fn(arg, signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                pass  # deliberate: already gone, or not a group leader — the next form covers it


def test_PLANT_the_deadline_leaves_NO_DESCENDANT_alive(tmp_path):
    """🔴 THE #3202 ORPHAN, pinned. A child in its own session with a grandchild that inherits the pipe:
    the deadline must end BOTH. Under `proc.kill()` the grandchild survives this assertion — which is
    exactly what it did on CI for 2 h 32 m — and under the group kill both are gone.

    Both processes are identified by their recorded `/proc/<pid>/cmdline`, so nothing here can pass
    because a pid was reused, and nothing here consults a command-name pattern."""
    import subprocess as _sp
    import sys as _sys
    import time as _t

    pids = tmp_path / "pids.txt"
    proc = _sp.Popen(
        [_sys.executable, "-c", _GRANDCHILD_INHERITS_THE_PIPE, str(pids)],
        stdout=_sp.PIPE,  # OUR pipe, not the runner's: the grandchild must hold something we own
        stderr=_sp.STDOUT,
        text=True,
        bufsize=1,
        start_new_session=True,  # the property under test: the child LEADS the group the kill signals
    )
    end = _t.monotonic() + 15.0
    while _t.monotonic() < end and len(pids.read_text().splitlines() if pids.exists() else []) < 2:
        _t.sleep(0.05)
    lines = pids.read_text().splitlines() if pids.exists() else []
    assert len(lines) == 2, f"the plant never reported its pids; got {lines!r} — the test proves nothing"
    parent, grandchild = int(lines[0]), int(lines[1])
    was_p, was_g = _cmdline(parent), _cmdline(grandchild)
    assert was_p and was_g, f"the plant is not running: parent={was_p!r} grandchild={was_g!r}"
    assert parent == proc.pid, (parent, proc.pid)

    try:
        rc, timed_out, _ = M.stream_bounded(proc, 1.0, lambda _l: None, join_sec=2.0)
    finally:
        # Belt, by pid, not through the function under test — see `_reap_by_pid`. Runs BEFORE the
        # assertions so a mutant that breaks the reap cannot leave a process behind for the next one.
        _reap_by_pid(grandchild, parent)

    assert timed_out is True, f"the cap did not fire, so the kill was never exercised: rc={rc}"
    assert _gone(parent, was_p), f"the parent {parent} outlived its own deadline"
    assert _gone(grandchild, was_g), (
        f"THE ORPHAN. Grandchild {grandchild} survived the deadline holding the inherited pipe — "
        f"§2.3: SIGKILL to the parent must terminate the entire job, leaving no orphan writing to it "
        f"after death. This is #3202's 2 h 32 m / 19.4 GB process, reproduced."
    )


def test_a_child_that_does_NOT_lead_its_group_is_killed_ALONE(monkeypatch):
    """🔴 THE FIX'S OWN WORST FAILURE MODE, pinned. `os.killpg` on a child started WITHOUT
    `start_new_session=True` reaches OUR group — the gate would kill itself, and every sibling the
    caller owns, in the name of reaping a child. So the group is signalled only when the child IS the
    group leader; otherwise the child alone is signalled, which is no worse than the `proc.kill()` this
    replaces. A mutant that drops the `getpgid(pid) == pid` test fails here instead of by suicide."""

    class _Os:
        def getpgrp(self):
            return 999  # OUR group, distinct from anything the doubles report

        def getpgid(self, pid):
            return pid + 1  # a member, not the leader

        def killpg(self, pid, sig):  # pragma: no cover — reaching this IS the failure
            raise AssertionError(f"killpg({pid}, {sig}) on a group this child does not lead")

    monkeypatch.setattr(M, "os", _Os())
    proc = _RecordingProc(pid=4242)
    rc = M.kill_process_group(proc)
    assert proc.signals and proc.signals[-1].name == "SIGKILL", proc.signals
    assert rc == -9, rc


def test_an_UNREADABLE_pgid_falls_back_to_the_child_instead_of_guessing(monkeypatch):
    """`getpgid` raises for a pid that exited between the wait and the kill. Fail CLOSED to the narrow
    action: signal the child, never a group we could not confirm."""

    class _Os:
        def getpgrp(self):
            return 999

        def getpgid(self, pid):
            raise ProcessLookupError(pid)

        def killpg(self, pid, sig):  # pragma: no cover — reaching this IS the failure
            raise AssertionError("killpg after an unreadable pgid")

    monkeypatch.setattr(M, "os", _Os())
    proc = _RecordingProc(pid=4242)
    assert M.kill_process_group(proc) == -9
    assert [s.name for s in proc.signals] == ["SIGTERM", "SIGKILL"], proc.signals


def test_a_group_that_is_ALREADY_GONE_is_not_an_error(monkeypatch):
    """Teardown must not become a new failure mode: the race where the whole group exits between the
    deadline and the signal is the NORMAL end of a run, not a fault to raise out of a refusal path."""
    calls = []

    class _Os:
        def getpgrp(self):
            return 999  # not the child's group, so the group path is legitimate

        def getpgid(self, pid):
            return pid  # the leader: the group path

        def killpg(self, pid, sig):
            calls.append(sig.name)
            raise ProcessLookupError(pid)

    monkeypatch.setattr(M, "os", _Os())

    class _Dead(_RecordingProc):
        def wait(self, timeout=None):
            self.timeouts.append(timeout)
            return 0  # already reaped

    proc = _Dead(pid=4242)
    assert M.kill_process_group(proc) == 0
    assert calls == ["SIGTERM"], f"a group that is already gone must not be escalated to SIGKILL: {calls}"


def test_SIGTERM_is_given_a_GRACE_and_SIGKILL_is_the_escalation():
    """The order and both bounds, asserted as the arguments — SIGTERM first so a worker mid-write can
    flush, SIGKILL after `GROUP_GRACE_SEC`, and each wait bounded (`timeout=None` on either hands an
    unkillable child the power to hang the refusal, this function's own bug class)."""
    proc = _RecordingProc()
    rc = M.kill_process_group(proc)
    assert [s.name for s in proc.signals] == ["SIGTERM", "SIGKILL"], proc.signals
    assert proc.timeouts == [M.GROUP_GRACE_SEC, M.REAP_SEC], (
        f"the two waits must be bounded by the grace then the reap; got {proc.timeouts} — "
        f"expected [{M.GROUP_GRACE_SEC}, {M.REAP_SEC}]"
    )
    assert rc == -9, rc


def test_a_child_that_dies_on_SIGTERM_is_never_SIGKILLED():
    """The grace exists to be usable. A double that exits on SIGTERM must return on the first wait, or
    the escalation is unconditional and the grace is decoration."""

    class _Polite(_RecordingProc):
        def wait(self, timeout=None):
            self.timeouts.append(timeout)
            return 0

    proc = _Polite(pid=0)
    assert M.kill_process_group(proc) == 0
    assert [s.name for s in proc.signals] == ["SIGTERM"], proc.signals


def test_an_UNKILLABLE_child_still_RETURNS_and_reports_what_it_knows():
    """A child in uninterruptible sleep survives SIGKILL. The reaper must not loop, not raise, and not
    claim a returncode it does not have: it returns whatever the object knows (here None), and the
    caller's refusal is still emitted. ∅ — an unknown exit status is None, never 0 and never -9."""

    class _Unkillable(_RecordingProc):
        def wait(self, timeout=None):
            self.timeouts.append(timeout)
            raise self._sp.TimeoutExpired("child", timeout)

    proc = _Unkillable(pid=0)
    assert M.kill_process_group(proc) is None
    assert [s.name for s in proc.signals] == ["SIGTERM", "SIGKILL"], proc.signals
    assert proc.timeouts == [M.GROUP_GRACE_SEC, M.REAP_SEC], proc.timeouts


def test_a_wait_that_raises_on_a_NEVER_STARTED_child_stops_instead_of_escalating():
    """`Popen.wait` raises ValueError on a process object that was never started. Escalating to SIGKILL
    against nothing, twice, would be a loop over a broken object; stop and report."""

    class _NeverStarted(_RecordingProc):
        def wait(self, timeout=None):
            self.timeouts.append(timeout)
            raise ValueError("process not started")

    proc = _NeverStarted(pid=0)
    proc.returncode = None
    assert M.kill_process_group(proc) is None
    assert [s.name for s in proc.signals] == ["SIGTERM"], f"a broken wait must not be retried: {proc.signals}"


# ── the RESULTS phase, which was bounded and NOT CAUGHT ─────────────────────────────────────────────


def test_the_results_reason_says_NOTHING_WAS_READ_and_names_its_bound():
    """A reader must be able to tell this from a slow mutation pass without reading the code: the
    mutants ran, their outcomes are on disk, and the read never returned — so the run cannot claim a
    kill OR a survivor. The bound is named because the first question is always "how long did it wait"."""
    r = M.results_timeout_reason(300.0)
    assert "300s" in r, r
    assert "MB" not in r, f"no size was measured, so none is quoted (∅): {r}"
    for phrase in ("nothing was killed", "never read"):
        assert phrase in r, f"missing {phrase!r}: {r}"
    grew = M.results_timeout_reason(300.0, 2 * 1024**3)
    assert "2048 MB" in grew, grew
    # ONE BYTE IS A MEASUREMENT. `mutants_bytes > 0` → `> 1` survived until this case existed: the
    # boundary is "was anything measured", not "was it worth mentioning", and a size that rounds to
    # 0 MB still says the generation phase produced something (§∅ — the distinction is measured vs
    # not measured, never small vs zero).
    one = M.results_timeout_reason(300.0, 1)
    assert "0 MB of mutants on disk" in one, one


# ── the signal PASS-THROUGH, which the session change makes mandatory ───────────────────────────────


class _SigShim:
    """A `signal` module double. Records installs, hands back a distinguishable previous handler, and
    keeps the real module out of a test that must not actually catch SIGTERM."""

    SIG_DFL = "DFL"
    SIG_IGN = "IGN"

    def __init__(self, raise_on_install=False, raise_after=None):
        import signal as _s

        self.SIGTERM, self.SIGINT, self.SIGHUP = _s.SIGTERM, _s.SIGINT, _s.SIGHUP
        self.SIGKILL = _s.SIGKILL  # `kill_process_group` runs under this shim too; it escalates for real
        self.installs, self.raise_on_install = [], raise_on_install
        self.raise_after, self.handlers = raise_after, {}
        self.dispositions: dict = {}

    def getsignal(self, sig):
        return self.dispositions.get(sig, self.SIG_DFL)

    def signal(self, sig, handler):
        if self.raise_on_install or (self.raise_after is not None and len(self.installs) >= self.raise_after):
            raise ValueError("signal only works in main thread")
        self.installs.append((sig, handler))
        prev = self.handlers.get(sig, "PREVIOUS")
        self.handlers[sig] = handler
        return prev


class _OsShim:
    """`os` for the handler path: records the re-raise instead of signalling this process."""

    def __init__(self):
        self.killed = []

    def getpid(self):
        return 777

    def kill(self, pid, sig):
        self.killed.append((pid, sig))

    def getpgrp(self):
        return 999  # our group, deliberately not the child's

    def getpgid(self, pid):
        return pid  # the leader, so the group path is the one exercised

    def killpg(self, pid, sig):
        self.killed.append(("group", pid, sig))


def test_a_TERMINATING_SIGNAL_reaps_the_group_then_lets_the_signal_through(monkeypatch):
    """🔴 THE TRADE `start_new_session=True` MAKES, pinned. A session-led child is out of this process's
    group, so a runner's job-timeout kill no longer reaches it — #3202's job ended with exactly that,
    two orphan pythons. The handler must (1) reap the child's group, (2) restore the previous handler,
    and (3) RE-RAISE, because a handler that swallows SIGTERM turns a stop into a hang."""
    import signal as _sig

    shim, osh = _SigShim(), _OsShim()
    monkeypatch.setattr(M, "signal", shim)
    monkeypatch.setattr(M, "os", osh)
    proc = _RecordingProc(pid=4242)

    with M.reap_group_on_signal(proc) as guard:
        assert [s for s, _h in shim.installs] == list(M.REAP_SIGNALS), shim.installs
        guard._on_signal(_sig.SIGTERM, None)

    assert ("group", 4242, _sig.SIGKILL) in osh.killed, f"the group was not reaped: {osh.killed}"
    assert osh.killed[-1] == (777, _sig.SIGTERM), (
        f"the signal must be re-raised after the reap; got {osh.killed} — swallowing SIGTERM turns a "
        "stop into a hang and the sender's exit status is lost"
    )
    # install[0:3] are the three arms; install[3] is the handler restoring SIGTERM's previous handler,
    # and it must come BEFORE the re-raise or the re-raise re-enters this handler.
    assert shim.installs[len(M.REAP_SIGNALS)] == (_sig.SIGTERM, "PREVIOUS"), (
        f"the previous handler must be restored BEFORE the re-raise; got {shim.installs}"
    )


def test_the_previous_handlers_are_restored_on_the_way_OUT(monkeypatch):
    """The guard covers one child, not the rest of the process's life: a handler left installed would
    reap a dead `proc` on the next signal, and `mutate.py` runs `run_one` once per module."""
    import signal as _sig

    shim = _SigShim()
    monkeypatch.setattr(M, "signal", shim)
    with M.reap_group_on_signal(_RecordingProc()):
        pass
    restored = {sig: h for sig, h in shim.installs[len(M.REAP_SIGNALS) :]}
    assert set(restored) == set(M.REAP_SIGNALS), shim.installs
    assert all(h == "PREVIOUS" for h in restored.values()), restored
    assert _sig.SIGTERM in restored


def test_NO_HANDLER_is_not_a_crash_when_this_is_not_the_main_thread(monkeypatch):
    """`signal.signal` raises ValueError off the main thread. That degrades the guarantee to "the
    deadline is the only bound", which is honest; raising inside a context manager's `__enter__` would
    take the whole mutation run down for a mitigation that is not the point of the call."""
    shim = _SigShim(raise_on_install=True)
    monkeypatch.setattr(M, "signal", shim)
    with M.reap_group_on_signal(_RecordingProc()) as guard:
        assert guard._prev == {}, guard._prev
    assert shim.installs == [], shim.installs


def test_the_guard_NEVER_SWALLOWS_the_caller_s_exception(monkeypatch):
    """`__exit__` returning True would make a deadline-reaping context manager silently eat a real
    failure from the body it wraps — the body here is the whole mutation run."""
    shim = _SigShim()
    monkeypatch.setattr(M, "signal", shim)
    with pytest.raises(RuntimeError, match="from the body"):
        with M.reap_group_on_signal(_RecordingProc()):
            raise RuntimeError("from the body")


def test_a_handler_for_a_signal_that_was_NEVER_INSTALLED_falls_back_to_the_default(monkeypatch):
    """The `_prev.get(sig, SIG_DFL)` branch: on the path where installation was refused, a handler that
    still somehow runs must not restore `None` (which `signal.signal` rejects) — it restores the
    default. Reached by driving the handler on a guard whose installs all failed."""
    import signal as _sig

    shim, osh = _SigShim(raise_on_install=True), _OsShim()
    monkeypatch.setattr(M, "signal", shim)
    monkeypatch.setattr(M, "os", osh)
    proc = _RecordingProc()
    guard = M.reap_group_on_signal(proc)
    guard.__enter__()
    guard._on_signal(_sig.SIGINT, None)
    assert osh.killed[-1] == (777, _sig.SIGINT), osh.killed
    assert [s.name for s in proc.signals] == ["SIGTERM", "SIGKILL"], proc.signals


def test_a_RESTORE_that_fails_does_not_raise_out_of_teardown(monkeypatch):
    """`__exit__`'s swallow, driven. The restore is a courtesy to whoever installed the previous
    handler; if the interpreter refuses it (the guard was entered on the main thread and exited from
    somewhere else), raising here would replace the caller's own outcome with a teardown failure."""
    shim = _SigShim(raise_after=len(M.REAP_SIGNALS))  # installs succeed, every restore refuses
    monkeypatch.setattr(M, "signal", shim)
    with M.reap_group_on_signal(_RecordingProc()):
        pass
    assert len(shim.installs) == len(M.REAP_SIGNALS), (
        f"the three arms must still have been installed; got {shim.installs}"
    )


def test_PLANT_a_signal_that_was_already_IGNORED_stays_ignored_and_the_child_LIVES(tmp_path):
    """🔴 A REAL SIGHUP UNDER `nohup`'s DISPOSITION, with a real child. Measured on this box
    2026-09-29: `setsid nohup <gate> &` — CLAUDE.md §4c's own recipe for anything over ~100 s, and how
    the crawl and the drains run — leaves SIGHUP as SIG_IGN, and `bash -c '<gate> &'` leaves SIGINT and
    SIGQUIT as SIG_IGN. Installing over that turns a signal the launcher disabled into "reap the job,
    restore SIG_IGN, re-raise into nothing, carry on" — the run continues with its child dead and
    reports NOT_RUN for an event it was supposed to ignore.

    This sends the REAL signal to this process, which is safe precisely because it is ignored: if the
    guard installs anyway the child dies and the assertion below fails, rather than the test dying."""
    import signal as _sig
    import subprocess as _sp
    import sys as _sys
    import time as _t

    prev = _sig.getsignal(_sig.SIGHUP)
    proc = _sp.Popen(
        [_sys.executable, "-c", "import time; time.sleep(30)"],
        # DEVNULL, not inherited: a child of this test must never hold the test RUNNER's stdout. Under
        # mutmut that stdout is the worker's result pipe, and a child that outlives a failing reap keeps
        # the whole run from finishing (see `_reap_by_pid`).
        stdout=_sp.DEVNULL,
        stderr=_sp.DEVNULL,
        start_new_session=True,
    )
    try:
        _sig.signal(_sig.SIGHUP, _sig.SIG_IGN)  # the disposition `nohup` leaves behind
        # Polled, because between fork and exec the child's `/proc/<pid>/cmdline` is EMPTY — a freshly
        # spawned process reads as "not running" for a few ms, which is the same shape this file uses to
        # mean dead. Waiting for the argv to appear is what makes "alive" and "dead" distinguishable.
        _end = _t.monotonic() + 5.0
        was = _cmdline(proc.pid)
        while was is None and _t.monotonic() < _end:
            _t.sleep(0.02)
            was = _cmdline(proc.pid)
        assert was, "the plant's child never reached exec; the test proves nothing"
        with M.reap_group_on_signal(proc) as guard:
            assert _sig.SIGHUP not in guard._prev, (
                "SIGHUP was SIG_IGN and a handler was installed over it — a stray HUP now reaps the job "
                "and re-raises into a no-op, so the run continues with its child dead"
            )
            os.kill(os.getpid(), _sig.SIGHUP)  # ignored: execution must simply continue past this line
            _t.sleep(0.3)
            assert _cmdline(proc.pid) == was, (
                f"the child was reaped by a signal this process was told to ignore (pid {proc.pid})"
            )
        assert _sig.getsignal(_sig.SIGHUP) is _sig.SIG_IGN, "the ignored disposition must be left as it was"
    finally:
        _sig.signal(_sig.SIGHUP, prev)
        _reap_by_pid(proc.pid)  # by pid, never through the function under test
        proc.wait(timeout=10)  # reap the zombie so the pid is free, not merely dead
    assert _gone(proc.pid, was), "the plant's own child outlived the test"


def test_CONTROL_a_signal_at_SIG_DFL_still_gets_the_handler(monkeypatch):
    """The control for the plant above: skipping SIG_IGN must not become skipping everything. With the
    default disposition all three arms are installed, which is what the order test then exercises."""
    shim = _SigShim()
    monkeypatch.setattr(M, "signal", shim)
    with M.reap_group_on_signal(_RecordingProc()) as guard:
        assert set(guard._prev) == set(M.REAP_SIGNALS), guard._prev
    assert [s for s, _h in shim.installs[: len(M.REAP_SIGNALS)]] == list(M.REAP_SIGNALS), shim.installs


def test_only_the_IGNORED_arm_is_skipped_not_its_neighbours(monkeypatch):
    """A mixed disposition is the real shape (`bash -c '… &'` ignores SIGINT and SIGQUIT but not
    SIGTERM): the ignored arm is left alone and every other arm is still guarded."""
    import signal as _sig

    shim = _SigShim()
    shim.dispositions[_sig.SIGINT] = shim.SIG_IGN
    monkeypatch.setattr(M, "signal", shim)
    with M.reap_group_on_signal(_RecordingProc()) as guard:
        assert _sig.SIGINT not in guard._prev, guard._prev
        assert {_sig.SIGTERM, _sig.SIGHUP} <= set(guard._prev), guard._prev


def test_a_child_whose_group_IS_OURS_is_never_killpg_ed_even_if_it_LEADS_it(monkeypatch):
    """🔴 THE SECOND CLAUSE, pinned — and the reason the 23 UNDECIDED mutants on #3237's first CI run
    became decidable. `pgid == pid` alone permits exactly one catastrophic case: a group whose leader
    pid we happen to be signalling IS our own group, and `killpg` on it takes the gate and every
    sibling the caller owns. Measured: a mutant inverting that comparison killed the mutmut runner at
    mutant 7 of 30, and a mutant that kills the runner cannot be killed BY the runner.

    Requiring `pgid != os.getpgrp()` as well means no SINGLE mutation can reach our group — invert
    either clause and the other still blocks — which is both a real safety property and what makes
    this function measurable."""

    class _Os:
        def __init__(self):
            self.calls = []

        def getpgrp(self):
            return 4242  # the child's group IS ours

        def getpgid(self, pid):
            return pid  # …and the child leads it

        def killpg(self, pid, sig):  # pragma: no cover — reaching this IS the failure
            raise AssertionError(f"killpg({pid}, {sig}) on OUR OWN process group")

    monkeypatch.setattr(M, "os", _Os())
    proc = _RecordingProc(pid=4242)
    assert M.kill_process_group(proc) == -9
    assert [s.name for s in proc.signals] == ["SIGTERM", "SIGKILL"], (
        f"the child alone must be signalled, never the group we share with it: {proc.signals}"
    )


def test_a_child_that_LEADS_A_FOREIGN_group_IS_killpg_ed(monkeypatch):
    """The positive control for the clause above: skipping our own group must not become skipping every
    group, or the whole fix is gone and the plant is the only thing left to notice."""
    import signal as _sig

    seen = []

    class _Os:
        def getpgrp(self):
            return 999

        def getpgid(self, pid):
            return pid

        def killpg(self, pid, sig):
            seen.append((pid, sig))

    monkeypatch.setattr(M, "os", _Os())
    proc = _RecordingProc(pid=4242)
    M.kill_process_group(proc)
    assert seen == [(4242, _sig.SIGTERM), (4242, _sig.SIGKILL)], (
        f"a child leading a group that is not ours must be signalled AS A GROUP; got {seen}"
    )
    assert proc.signals == [], f"the group path must not also signal the child directly: {proc.signals}"


# ── the drain: `kill_process_group`'s return value, which is the only thing a caller reads ──────────


def test_an_UNWAITABLE_proc_still_reports_the_returncode_IT_HAS():
    """Four mutants live on the last line, and they all have the same shape: return None no matter what
    the process actually did (`break` → bare `return`, `getattr(None, …)`, and two spellings of a
    `returncode` attribute that does not exist). They survive any test whose double has no returncode to
    report, which is what `_Unkillable` and `_NeverStarted` above are — so this one HAS one.

    The property is the contract's other half: the reaper never raises, and it does not invent an exit
    status — but where the object knows one, that is what the caller gets."""

    class _BrokenWaitKnownRc(_RecordingProc):
        def wait(self, timeout=None):
            self.timeouts.append(timeout)
            raise ValueError("process not started")  # the `break` path

    proc = _BrokenWaitKnownRc(pid=0)
    proc.returncode = -9  # the child WAS reaped, by someone else, and the object knows it
    assert M.kill_process_group(proc) == -9, (
        "the reaper must report the returncode the object holds — returning None here would tell a "
        "caller 'unknown exit status' about a process whose status is on the object"
    )


def test_a_proc_MISSING_pid_AND_returncode_is_still_teardown_safe():
    """`getattr(proc, "pid", None)` and `getattr(proc, "returncode", None)` → the two-argument form,
    which RAISES AttributeError instead of defaulting. Two mutants, one property: "never raises: teardown
    must not become a new failure mode" is the docstring's first promise, and it is only tested by an
    object that lacks the attributes. ∅ — an absent exit status is None, not an exception and not 0."""

    class _Bare:
        """No `pid`, no `returncode` — a stopped-short double, or a proc object mid-teardown."""

        def __init__(self):
            self.signals = []

        def send_signal(self, sig):
            self.signals.append(sig)

        def wait(self, timeout=None):
            raise OSError("no such process")  # the `break` path, without a returncode to report

    proc = _Bare()
    assert M.kill_process_group(proc) is None, "an absent returncode is None (§∅), never 0 and never a raise"
    assert proc.signals, "the child was never signalled at all"


def test_a_pid_of_ZERO_is_NEVER_signalled_as_a_group_because_killpg_0_MEANS_US(monkeypatch):
    """🔴 THE ONE THAT KILLED THE RUNNER, pinned. `os.killpg(0, sig)` addresses the CALLER's process
    group — a 0 does not fail safe, it fails at maximum blast radius. Measured 2026-09-29: four mutants
    of this function leave the leader flag set past the `if`, and with a `pid=0` double each SIGTERMed
    the mutmut worker's own group (pytest died mid-run with no summary, the counter stalled at 7 of 33,
    23 mutants came back `not_checked`).

    So this drives the worst case DIRECTLY — leader already true, pid 0 — and asserts the group is not
    signalled. `True` is included because `isinstance(True, int)` is True in Python and `True > 0`."""
    import signal as _sig

    class _Os:
        def getpgrp(self):
            return 999

        def getpgid(self, pid):
            return pid  # would make the child a "leader" if it were ever asked

        def killpg(self, pid, sig):  # pragma: no cover — reaching this IS the failure
            raise AssertionError(f"killpg({pid}, {sig}) — 0 is this process's OWN group")

    monkeypatch.setattr(M, "os", _Os())
    for bad in (0, None, True, "1234", -1):
        proc = _RecordingProc(pid=bad)
        assert M.kill_process_group(proc) == -9, bad
        assert [s.name for s in proc.signals] == ["SIGTERM", "SIGKILL"], (bad, proc.signals)
    assert _sig.SIGKILL  # the enum is real, not a string we compared by luck


def test_a_pid_of_ONE_is_an_ORDINARY_pid_and_the_bound_is_ZERO(monkeypatch):
    """`pid > 0` → `pid > 1`, the one mutant of the new guard that a 40-case probe could distinguish
    (exactly one case: pid == 1). Only 0 is special — it addresses the caller's group — so 1 must be
    treated as the ordinary pid it is, or the guard quietly widens from "not the group-wide 0" to "not
    the first two pids", which is a different rule than the comment claims."""
    import signal as _sig

    seen = []

    class _Os:
        def getpgrp(self):
            return 999

        def getpgid(self, pid):
            return pid  # a leader

        def killpg(self, pid, sig):
            seen.append((pid, sig))

    monkeypatch.setattr(M, "os", _Os())
    proc = _RecordingProc(pid=1)
    M.kill_process_group(proc)
    assert seen == [(1, _sig.SIGTERM), (1, _sig.SIGKILL)], (
        f"pid 1 leads a group like any other pid and must be signalled as one; got {seen}"
    )
    assert proc.signals == [], f"the group path must not also signal the child: {proc.signals}"


def test_the_restore_hands_back_SIG_DFL_for_a_signal_that_was_never_recorded(monkeypatch):
    """`prev if prev is not None else signal.SIG_DFL` → a mutant that always takes `prev`. With the
    duplicated `.get` default removed, `prev` is then None for a signal absent from `_prev`, and
    `signal.signal(sig, None)` raises TypeError — which this function must never do (it runs inside a
    signal handler, mid-teardown). So the conversion is asserted on the VALUE handed back, which is the
    only place the difference is visible."""
    import signal as _sig

    shim, osh = _SigShim(), _OsShim()
    monkeypatch.setattr(M, "signal", shim)
    monkeypatch.setattr(M, "os", osh)
    guard = M.reap_group_on_signal(_RecordingProc(), signals=(_sig.SIGTERM,))
    guard.__enter__()
    guard._prev.clear()  # the signal arrives with nothing recorded for it — a half-installed guard
    guard._on_signal(_sig.SIGTERM, None)

    restores = [h for sg, h in shim.installs if sg == _sig.SIGTERM][1:]
    assert restores == [shim.SIG_DFL], (
        f"an unrecorded previous handler must restore to SIG_DFL, never None (which `signal.signal` "
        f"rejects with TypeError); got {restores}"
    )


def test_a_claim_over_a_mutant_WE_DO_NOT_REQUIRE_is_counted_not_refused():
    """🔴 THE DEFECT THIS BUCKET EXISTS FOR, and it refused real PRs. A survivor whose diff is
    string-only is dropped from `survivors` deliberately — it is EXCLUDED, not unmeasured — but a
    registered claim naming it then matched neither `surv` nor `kills`, fell through to `not_decided`,
    and took the whole run to exit 2 with verdict UNKNOWN. The gate refused over its own exclusion.

    Measured 2026-10-11 on #3395 (`loss_audit._has_worn_evidence`): of four claims, the two the scan
    calls `string-only` (`"utf-8"` -> `"UTF-8"` and `rstrip("\\n")` -> `rstrip("XX\\nXX")`) were exactly
    the two refused; the other two came back `required`, reached `surv`, and were excused normally.
    Nothing was unmeasured — mutmut had settled all 67 of that function's mutants and reported all four
    as `survived` — so "re-run on a quiet box" could never clear it, and a quiet run reproduced it."""
    key = '- a = "utf-8" | + a = "UTF-8"'
    entry = [{"key": key, "class": "no-distinguishing-input", "probe": "planted"}]
    # BEFORE: the key is generated, nothing says it was excluded ⇒ refusal
    before = M.classify(entry, [], set(), generated={key})
    assert len(before["not_decided"]) == 1, "this is the shipped behaviour the bucket replaces"
    # AFTER: the harvest reports that it excluded the key ⇒ counted, and nothing refuses
    after = M.classify(entry, [], set(), generated={key}, not_required={key})
    assert after["not_decided"] == [], "an excluded mutant is not an unmeasured one"
    assert len(after["claimed_not_required"]) == 1
    assert "excused nothing" in after["claimed_not_required"][0]["why"]


def test_the_new_bucket_does_not_swallow_a_kill_a_survivor_or_an_orphan():
    """The bucket is a fall-through for ONE state, and the three it sits beside must be unmoved — an
    exclusion that quietly outranked a kill would turn positive evidence into a counted nothing."""
    key = '- a = "utf-8" | + a = "UTF-8"'
    entry = [{"key": key, "class": "no-distinguishing-input", "probe": "p"}]
    # a CORROBORATED KILL still refutes, even though the mutant is in the excluded set: a kill is a
    # positive observation and the claim is wrong regardless of whether we would have required it
    killed = M.classify(entry, [], {key}, generated={key}, not_required={key})
    assert len(killed["refuted"]) == 1, "a kill must outrank an exclusion"
    assert killed["claimed_not_required"] == []
    # a real survivor with an excusing class is still excused
    surv = M.classify(entry, [{"key": key}], set(), generated={key}, not_required={key})
    assert len(surv["excused"]) == 1, "membership in `surv` is checked first and stays first"
    # a key no generated mutant matches is still an orphan, not "not required"
    orph = M.classify(entry, [], set(), generated=set(), not_required=set())
    assert len(orph["orphaned"]) == 1


def test_a_CLAIMED_UNCHECKED_mutant_is_counted_never_refused_and_never_passed():
    """The state the owner named: generated, and still without a result after one isolated run. It is a
    measurement about the GATE — the claim is neither shown nor refuted — so it is counted and named.

    Never a refusal, because nothing is wrong; never a PASS, because nothing was demonstrated. The
    distinction from `claimed_not_required` is the reason both exist: that one was EXCLUDED on purpose
    (string-only or empty diff), this one was ASKED and did not answer."""
    key = "- a | + b"
    entry = [{"key": key, "class": "no-distinguishing-input", "probe": "p"}]
    out = M.classify(entry, [], set(), generated={key}, unchecked={key})
    assert len(out["claimed_unchecked"]) == 1
    assert out["not_decided"] == [], "an asked-and-unanswered claim is not the refusal state"
    assert out["refuted"] == [] and out["excused"] == []
    assert "says nothing about the claim" in out["claimed_unchecked"][0]["why"]
    # 🔴 THE BUCKETED ENTRY MUST STILL BE THE ENTRY. `dict(e, why=...)` losing its `e` leaves only the
    # `why` — the count and the text both still read correct, which is why the gate found this as a
    # survivor — and the report then cannot name WHICH claim it is talking about (it prints `e["key"]`).
    # A bucket whose rows cannot be identified is a count nobody can act on.
    for bucket, kwargs in (
        ("claimed_unchecked", {"unchecked": {key}}),
        ("claimed_not_required", {"not_required": {key}}),
        ("not_decided", {}),
    ):
        row = M.classify(entry, [], set(), generated={key}, **kwargs)[bucket][0]
        assert row["key"] == key, f"{bucket} lost the claim's key: {row}"
        assert row["class"] == "no-distinguishing-input", f"{bucket} lost the claim's class: {row}"
        assert row["probe"] == "p", f"{bucket} lost the claim's probe: {row}"
    # the three states are DISJOINT and each keeps its own routing
    assert len(M.classify(entry, [], set(), generated={key}, not_required={key})["claimed_not_required"]) == 1
    assert len(M.classify(entry, [], set(), generated={key})["not_decided"]) == 1, (
        "a claim neither excluded nor asked is still the refusal state — that path is not removed"
    )
    # and positive evidence still outranks every one of them
    assert len(M.classify(entry, [], {key}, generated={key}, unchecked={key})["refuted"]) == 1
    assert len(M.classify(entry, [{"key": key}], set(), generated={key}, unchecked={key})["excused"]) == 1


# ── A KEY THAT CANNOT NAME ITS FUNCTION ─────────────────────────────────────────────────────────────
# Residue `2026-10-04-an-equivalence-key-cannot-name-its-function` and
# `2026-10-05-a-mutant-key-is-not-unique-within-a-module-for-a-bare-statement-mutation`. A mutant's key
# is its changed diff lines; a bare statement's text is not distinctive, so two mutants in two functions
# share one key. One entry then spoke for both, and two survivors collapsed into one map slot before any
# entry was read. The qualifier is OPTIONAL, so every entry already recorded keeps its meaning.

_BARE = "- continue | + break"


def _surv(key, mutant=None, module="timeline.py"):
    """A survivor record shaped the way the sweep builds one: `mutant` is the mutmut name, and it is
    what carries the function. Omitting it is the shape a LATE survivor had before this change."""
    out = {"key": key, "module": module}
    if mutant is not None:
        out["mutant"] = mutant
    return out


def test_an_entry_with_NO_function_speaks_for_the_whole_module_as_it_always_did():
    """The back-compatibility arm, and the reason no recorded entry has to be re-verified. Every entry
    in the committed ledger is this shape."""
    e = [{"key": _BARE, "class": "no-distinguishing-input"}]
    got = M.classify(e, [_surv(_BARE, "timeline.x_build__mutmut_7")], set())
    assert [x["key"] for x in got["excused"]] == [_BARE], got
    assert got["unclassified"] == [], got


def test_an_entry_qualified_by_FUNCTION_excuses_only_that_function():
    """The fix for #3245's entry: an argument that is correct for `unrecorded_shift` must not excuse the
    same changed line in `timebase`. The second survivor is reported, which is the gate failing."""
    e = [{"key": _BARE, "class": "no-distinguishing-input", "function": "build"}]
    survivors = [_surv(_BARE, "timeline.x_build__mutmut_7"), _surv(_BARE, "timeline.x_prune__mutmut_2")]
    got = M.classify(e, survivors, set())
    assert [x["key"] for x in got["excused"]] == [_BARE], got
    assert [x["mutant"] for x in got["unclassified"]] == ["timeline.x_prune__mutmut_2"], (
        got["unclassified"],
        "the sibling function's survivor must stay unexcused — one entry, one function",
    )


def test_two_survivors_sharing_one_KEY_are_both_reported():
    """The half the row calls worse: `{sv["key"]: sv …}` collapsed them, so the gate reported ONE
    survivor where two existed and the loss was invisible because the count simply looked lower."""
    survivors = [_surv(_BARE, "timeline.x_build__mutmut_7"), _surv(_BARE, "timeline.x_prune__mutmut_2")]
    got = M.classify([], survivors, set())
    assert len(got["unclassified"]) == 2, (got["unclassified"], "two mutants, two rows")
    assert sorted(x["mutant"] for x in got["unclassified"]) == [
        "timeline.x_build__mutmut_7",
        "timeline.x_prune__mutmut_2",
    ], got["unclassified"]


def test_a_qualified_entry_is_NOT_refuted_by_a_kill_in_a_SIBLING_function():
    """The #3263 incident itself. The entry's argument was made about one function; the kill happened in
    another that carries the same line. REFUTED instructs a reader to DELETE the claim, so a kill that
    cannot be attributed to the claim's own function must not reach it."""
    e = [{"key": _BARE, "class": "untestable-by-design", "function": "unrecorded_shift"}]
    kills = {(_BARE, "timebase")}
    got = M.classify(e, [], kills, generated={_BARE})
    assert got["refuted"] == [], (got["refuted"], "a kill in `timebase` says nothing about `unrecorded_shift`")
    assert [x["key"] for x in got["not_decided"]] == [_BARE], got


def test_a_qualified_entry_IS_refuted_by_a_kill_in_its_OWN_function():
    """The other arm, which is the one that must still bite: the claim is wrong and the gate says so."""
    e = [{"key": _BARE, "class": "untestable-by-design", "function": "timebase"}]
    got = M.classify(e, [], {(_BARE, "timebase")}, generated={_BARE})
    assert [x["key"] for x in got["refuted"]] == [_BARE], got


def test_an_UNATTRIBUTED_kill_refutes_an_unqualified_entry_and_not_a_qualified_one():
    """A bare key in `killed` is a kill nobody placed. Against an entry that speaks for the module it is
    the behaviour this gate has always had; against an entry that names one function it is a claim and a
    kill about different things, so they do not meet."""
    plain = [{"key": _BARE, "class": "no-distinguishing-input"}]
    qualified = [{"key": _BARE, "class": "no-distinguishing-input", "function": "build"}]
    assert [x["key"] for x in M.classify(plain, [], {_BARE}, generated={_BARE})["refuted"]] == [_BARE]
    assert M.classify(qualified, [], {_BARE}, generated={_BARE})["refuted"] == [], (
        "an unplaced kill must not delete a claim that names a function"
    )


def test_a_qualified_entry_does_not_match_a_survivor_whose_FUNCTION_cannot_be_read():
    """`function_of_mutant` returns "" rather than guessing. A qualified entry over an unnamed mutant is
    a claim nobody can check, so the survivor stays unexcused and the gate fails — the fail-closed arm,
    and the reason a late survivor now carries its mutant name."""
    e = [{"key": _BARE, "class": "no-distinguishing-input", "function": "build"}]
    got = M.classify(e, [_surv(_BARE)], set())
    assert got["excused"] == [], got
    assert len(got["unclassified"]) == 1, got


def test_a_survivor_may_declare_its_own_function_instead_of_carrying_a_mutant_name():
    """`function` on the SURVIVOR is preferred over decoding the mutmut name, so a caller that already
    knows the function does not have to re-encode it into a glob for this to read it back."""
    e = [{"key": _BARE, "class": "no-distinguishing-input", "function": "build"}]
    sv = {"key": _BARE, "module": "timeline.py", "function": "build"}
    assert [x["key"] for x in M.classify(e, [sv], set())["excused"]] == [_BARE]


def test_entry_matches_function_and_kill_attributed_to_are_pinned_directly():
    """The two helpers on their own, because each arm above exercises them through `classify` and a
    helper whose only coverage is an end-to-end path is a helper nobody can read a verdict off."""
    assert M.entry_matches_function({}, "build") is True
    assert M.entry_matches_function({"function": ""}, "build") is True  # empty is absent, not a filter
    assert M.entry_matches_function({"function": "build"}, "build") is True
    assert M.entry_matches_function({"function": "build"}, "prune") is False
    assert M.entry_matches_function({"function": "build"}, "") is False
    assert M.kill_attributed_to({}, "k", {"k"}) is True
    assert M.kill_attributed_to({}, "k", {("k", "build")}) is True
    assert M.kill_attributed_to({}, "k", {("other", "build")}) is False
    assert M.kill_attributed_to({"function": "build"}, "k", {("k", "build")}) is True
    assert M.kill_attributed_to({"function": "build"}, "k", {("k", "prune")}) is False
    assert M.kill_attributed_to({"function": "build"}, "k", {"k"}) is False
    assert M.kill_attributed_to({}, "k", None) is False


# ── The two `.get` DEFAULTS in `classify` are one coupling, and only one input can see it ───────────
# Four mutants of these two lines survived the diff-scoped gate on #3511. Two are killed below; two
# are recorded in `tools/mutate-equivalence.json` with the proof, because the guard inside
# `function_of_mutant` makes `""` and `None` the same argument.


def test_a_survivor_with_no_key_cell_meets_a_KEYLESS_entry_on_the_empty_key():
    """Both defaults are the SAME empty string, and that is the only place the two malformed shapes meet.

    `classify` groups survivor rows under `sv.get("key", "")` and reads an entry's key as
    `e.get("key", "")`. So a survivor whose key cell is absent is claimable by an entry carrying no
    `key`, and by nothing else — change either default and the pair stops meeting. The ledger's own
    schema test states the entry half of this ("it reads `.get("key", "")` and reports the entry
    orphaned"), which holds for every REAL survivor, since a survivor is built from a diff key.
    """
    entry = {"class": "no-distinguishing-input", "probe": "the covering set, with the mutant planted"}
    out = M.classify([entry], [{"mutant": "mod.x_f__mutmut_1"}], [])
    assert len(out["excused"]) == 1, out
    assert not out["unclassified"], out
    assert not out["orphaned"], out


def test_a_survivor_with_no_key_cell_is_NOT_excused_by_an_entry_that_carries_a_key():
    """The half that matters in production: a keyed entry claims a keyed survivor and nothing else.

    A survivor with no key is reported unclassified, so the gate fails on it rather than letting a
    neighbouring entry absorb it."""
    entry = {"key": "- a | + b", "class": "no-distinguishing-input", "probe": "ran it"}
    out = M.classify([entry], [{"mutant": "mod.x_f__mutmut_1"}], [])
    assert not out["excused"], out
    assert len(out["unclassified"]) == 1, out
    assert len(out["orphaned"]) == 1, out


def test_function_of_mutant_reads_an_ABSENT_name_and_an_empty_one_identically():
    """The canary under two recorded equivalence entries, so the claim cannot rot silently.

    `classify` reads a survivor's mutant name as `sv.get("mutant", "")`. Mutating that default to
    `None` is unobservable ONLY because `function_of_mutant` opens with `if not name: return ""` — both
    arguments are falsy and both return the empty string. If that guard is ever narrowed to `== ""`,
    this test goes red and the two ledger entries stop being true on the same day.
    """
    read = M.function_of_mutant
    assert read("") == ""
    assert read(None) == ""  # type: ignore[arg-type]
    absent: dict = {}
    assert read(absent.get("mutant", "")) == read(absent.get("mutant", None))  # type: ignore[arg-type]


# ── WHICH OCCURRENCE SURVIVED (residue 2026-09-28-mutate-diff-does-not-say-which-occurrence-…) ─────
# `- continue` / `+ break` over a function with three `continue`s is three identical-looking rewrites.
# The survivor record now carries `file_line`, so a drain aims at the mutant reported and not at every
# candidate. Measured on #3188: the covered sibling was killed and the UNCOVERED one survived.
_SKIPS = """import os


def scan_night(rows, root):
    out = []
    for r in rows:
        if not r:
            continue
        path = os.path.join(root, r)
        if not os.path.isfile(path):
            continue
        try:
            out.append(int(r))
        except ValueError:
            continue
    return out
"""
_SKIP_LINES = [i for i, ln in enumerate(_SKIPS.splitlines(), 1) if ln.strip() == "continue"]


def _skip_show(nth, src=_SKIPS):
    """What `mutmut show` prints for `continue` -> `break` on the nth `continue` of `_SKIPS`'s function."""
    import difflib

    lines = src.splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.startswith("def "))
    orig = lines[start:]
    hit = [i for i, ln in enumerate(orig) if ln.strip() == "continue"][nth]
    mut = list(orig)
    mut[hit] = mut[hit].replace("continue", "break")
    return "\n".join(difflib.unified_diff(orig, mut, "m.py", "m.py", lineterm=""))


@pytest.mark.parametrize("nth", [0, 1, 2])
def test_mutant_file_line_names_WHICH_continue_survived(nth):
    assert M.mutant_file_line(_skip_show(nth), _SKIPS, "m.x_scan_night__mutmut_2") == _SKIP_LINES[nth]


def test_the_three_reports_are_indistinguishable_without_the_line():
    keys = {M.diff_key(_skip_show(i)) for i in range(3)}
    assert len(keys) == 1, "the premise: one key, three occurrences — the ledger key cannot tell them apart"
    assert len({M.mutant_file_line(_skip_show(i), _SKIPS, "x_scan_night__mutmut_2") for i in range(3)}) == 3


def test_mutant_file_line_accounts_for_the_comments_and_decorator_mutmut_keeps_above_a_function():
    src = "import os\n\n\n# banner one\n\n# banner two\n@staticmethod\ndef g(rows):\n    for r in rows:\n        continue\n"
    import difflib

    orig = src.splitlines()[3:]
    mut = [ln.replace("continue", "break") for ln in orig]
    show = "\n".join(difflib.unified_diff(orig, mut, "m.py", "m.py", lineterm=""))
    assert M.mutant_file_line(show, src, "x_g__mutmut_1") == 10


def test_mutant_file_line_finds_a_METHOD_by_its_class_and_refuses_a_name_defined_twice():
    src = "class A:\n    def f(self):\n        return 1\n\n\nclass B:\n    def f(self):\n        return 1\n"
    show = "--- m\n+++ m\n@@ -1,2 +1,2 @@\n def f(self):\n-    return 1\n+    return 2"
    assert M.mutant_file_line(show, src, "m.xǁBǁf__mutmut_1") == 8
    assert M.mutant_file_line(show, src, "m.xǁAǁf__mutmut_1") == 3
    assert M.mutant_file_line(show, src, "m.xǁCǁf__mutmut_1") is None  # no such class
    twice = "def f():\n    return 1\n\n\ndef f():\n    return 1\n"
    show1 = "--- m\n+++ m\n@@ -1,2 +1,2 @@\n def f():\n-    return 1\n+    return 2"
    assert M.mutant_file_line(show1, twice, "m.x_f__mutmut_1") is None  # ambiguous: refuse, never pick one
    dup_cls = "class A:\n    pass\n\n\nclass A:\n    def f(self):\n        return 1\n"
    assert M.mutant_file_line(show, dup_cls, "m.xǁAǁf__mutmut_1") is None


def test_mutant_file_line_is_None_never_a_guess():
    ok = _skip_show(2)
    assert M.mutant_file_line(ok, _SKIPS, "x_scan_night__mutmut_2") == _SKIP_LINES[2]
    assert M.mutant_file_line("", _SKIPS, "x_scan_night__mutmut_2") is None  # no diff
    assert M.mutant_file_line("--- m\n+++ m\n@@ -1,1 +1,1 @@\n+only added", _SKIPS, "x_scan_night__mutmut_2") is None
    assert M.mutant_file_line("--- m\n+++ m\n@@ x\n-def scan_night", _SKIPS, "x_scan_night__mutmut_2") is None
    assert M.mutant_file_line(ok, _SKIPS, "not a mutant name") is None
    assert M.mutant_file_line(ok, "def broken(:\n", "x_scan_night__mutmut_2") is None  # unparseable
    assert M.mutant_file_line(ok, "x = 1\x00\n", "x_scan_night__mutmut_2") is None  # NUL byte: ValueError
    assert M.mutant_file_line(ok, _SKIPS, "x_other__mutmut_2") is None  # function absent
    # the module drifted since the mutant was generated: the text at that position disagrees
    assert M.mutant_file_line(ok, _SKIPS.replace("continue", "pass"), "x_scan_night__mutmut_2") is None
    # a hunk that would start above line 1
    assert M.mutant_file_line("--- m\n+++ m\n@@ -0,1 +0,1 @@\n-x", _SKIPS, "x_scan_night__mutmut_2") is None


def test_mutant_file_line_stops_at_the_first_hunk_that_removes_and_skips_no_newline_markers():
    show = (
        "--- m\n+++ m\n@@ -1,1 +1,2 @@\n+added only\n@@ -2,2 +2,2 @@\n     out = []\n"
        "-    for r in rows:\n+    for q in rows:\n\\ No newline at end of file\n@@ -9,1 +9,1 @@\n-zzz\n+yyy"
    )
    assert M.mutant_file_line(show, _SKIPS, "x_scan_night__mutmut_2") == 6


def test_survivor_location_prints_a_line_or_nothing():
    assert M.survivor_location({"file_line": 78}) == " (line 78)"
    for absent in ({}, {"file_line": None}, {"file_line": 0}, {"file_line": True}, {"file_line": "78"}):
        assert M.survivor_location(absent) == "", absent


def test_mutate_diff_records_and_prints_the_line():
    """Wiring, on the AST: the survivor record carries `file_line` from `mutant_file_line`, and the
    printer prints it through `survivor_location` — a pure function nobody calls reports nothing."""
    import ast as _ast
    import pathlib as _pl

    src = (_pl.Path(__file__).resolve().parent.parent / "tools" / "mutate_diff.py").read_text()
    tree = _ast.parse(src)
    keys = {
        k.value for d in _ast.walk(tree) if isinstance(d, _ast.Dict) for k in d.keys if isinstance(k, _ast.Constant)
    }
    assert "file_line" in keys
    called = {n.func.id for n in _ast.walk(tree) if isinstance(n, _ast.Call) and isinstance(n.func, _ast.Name)}
    assert {"mutant_file_line", "survivor_location"} <= called


def test_mutant_file_line_agrees_with_the_real_mutmut_show(tmp_path):
    """The independent check: mutmut's OWN diff generator, not a hand-built one, over a function with
    a comment above it, a decorator and three `continue`s, and a method of the same shape. Run in a
    child process in its own directory because mutmut reads its config from the CWD."""
    pytest.importorskip("mutmut")
    import json
    import subprocess

    src = (
        "import os\n\n\nclass A:\n    # about f\n\n    def f(self, rows):\n        for r in rows:\n"
        "            if not r:\n                continue\n            try:\n                int(r)\n"
        "            except ValueError:\n                continue\n        return 1\n\n\n# banner\n"
        "@staticmethod\ndef g(rows):\n    for r in rows:\n        if not r:\n            continue\n"
        "        try:\n            int(r)\n        except ValueError:\n            continue\n    return 1\n"
    )
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "m.py").write_text(src)
    (tmp_path / "setup.cfg").write_text("[mutmut]\nsource_paths=pkg/\n")
    child = (
        "import json\n"
        "from mutmut.mutation.diff_apply import get_diff_for_mutant\n"
        "from mutmut.mutation.file_mutation import mutate_file_contents\n"
        "src = open('pkg/m.py').read()\n"
        "res = mutate_file_contents('pkg/m.py', src)\n"
        "print(json.dumps({n: get_diff_for_mutant('pkg.m.' + n, source=res.code, path='pkg/m.py')"
        " for n in res.mutant_names}))\n"
    )
    r = subprocess.run([sys.executable, "-c", child], cwd=tmp_path, capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr[-400:]
    shows = json.loads(r.stdout.strip().splitlines()[-1])
    lines = src.splitlines()
    assert len(shows) >= 8
    broke = {}
    for name, show in shows.items():
        removed = [ln[1:].strip() for ln in show.splitlines() if ln.startswith("-") and not ln.startswith("---")]
        got = M.mutant_file_line(show, src, "pkg.m." + name)
        assert got is not None, name
        assert lines[got - 1].strip() == removed[0], (name, got)
        if "+            break" in show or "+                break" in show:
            broke.setdefault(name.split("__")[0], set()).add(got)
    # `continue` -> `break` is reported identically for each occurrence; the line tells them apart
    assert {k: sorted(v) for k, v in broke.items()} == {"xǁAǁf": [10, 14], "x_g": [23, 27]}


# ── the diff-scoped mutation gate on #3567: 25 survivors in checkverdict.py and mutation_diff.py ──────
# Each test below fails on the named mutant of `_first_removal_hunk` / `mutant_file_line` / `survivor_location`.


def _unified(orig_lines, mut_lines):
    import difflib

    return "\n".join(difflib.unified_diff(orig_lines, mut_lines, "m.py", "m.py", lineterm=""))


def test_mutant_file_line_reads_a_diff_that_has_no_hunk_header_as_None_not_a_crash():
    """Removed lines before any `@@` belong to no hunk: absent, never a TypeError on an unset start."""
    src = "def f():\n    return 1\n"
    assert M.mutant_file_line("--- m\n+++ m\n-    return 1\n+    return 2", src, "m.x_f__mutmut_1") is None
    assert M._first_removal_hunk(" def f():\n-    return 1") is None


def test_the_first_removed_line_of_a_multi_line_removal_is_the_first_not_the_last():
    src = "def f():\n    a = 1\n    b = 2\n    return a\n"
    show = "--- m\n+++ m\n@@ -1,4 +1,3 @@\n def f():\n-    a = 1\n-    b = 2\n+    a = 2\n     return a"
    assert M.mutant_file_line(show, src, "m.x_f__mutmut_1") == 2
    assert M._first_removal_hunk(show) == (1, ["def f():", "    a = 1", "    b = 2", "    return a"], 2)


def test_mutant_file_line_names_a_function_that_starts_on_line_one():
    """`at == 1` is a real position (function at the file's top, hunk at its first line), not 'above line 1'."""
    src = "def f():\n    return 1\n"
    show = "--- m\n+++ m\n@@ -1,2 +1,2 @@\n def f():\n-    return 1\n+    return 2"
    assert M.mutant_file_line(show, src, "m.x_f__mutmut_1") == 2


def test_a_function_on_line_one_does_not_climb_into_the_END_of_the_file():
    """Nothing is above line 1: `lines[top - 2]` at top == 1 would wrap to the LAST line, and a trailing
    comment there pulled `top` to 0 and refused a locatable survivor."""
    src = "def f():\n    return 1\n# trailing note\n"
    show = "--- m\n+++ m\n@@ -1,2 +1,2 @@\n def f():\n-    return 1\n+    return 2"
    assert M.mutant_file_line(show, src, "m.x_f__mutmut_1") == 2


def test_a_comment_on_line_one_above_a_function_on_line_two_is_kept_by_the_climb():
    src = "# about f\ndef f(rows):\n    for r in rows:\n        continue\n"
    orig = src.splitlines()
    mut = [ln.replace("continue", "break") for ln in orig]
    assert M.mutant_file_line(_unified(orig, mut), src, "m.x_f__mutmut_1") == 4


def test_a_single_blank_line_above_the_comment_mutmut_keeps_is_dropped_one_line_at_a_time():
    """One LEADING blank is skipped by exactly one line: skipping two lands past the comment mutmut keeps."""
    src = "import os\n\n# about g\ndef g(rows):\n    for r in rows:\n        continue\n"
    orig = src.splitlines()[2:]
    mut = [ln.replace("continue", "break") for ln in orig]
    assert M.mutant_file_line(_unified(orig, mut), src, "m.x_g__mutmut_1") == 6


def test_survivor_location_prints_line_one_because_one_is_a_line():
    assert M.survivor_location({"file_line": 1}) == " (line 1)"


def test_a_source_the_parser_and_splitlines_number_differently_is_refused_not_renumbered():
    """A form feed is a line break to `str.splitlines` and plain whitespace to the parser, so the two count
    this file's lines differently. The function is on line 1 to the parser; `lines[0]` is the empty piece
    before the form feed. The text at that position disagrees with the hunk, so the answer is None —
    skipping that piece (`top <= first`) lines the text up and returns a number from the WRONG counting."""
    src = "\x0cdef f():\n    return 1\n"
    show = "--- m\n+++ m\n@@ -1,2 +1,2 @@\n def f():\n-    return 1\n+    return 2"
    assert M.mutant_file_line(show, src, "m.x_f__mutmut_1") is None
    assert M.mutant_file_line(show, src.replace("\x0c", ""), "m.x_f__mutmut_1") == 2  # the same text, no form feed


# ── the RED BASELINE, which the gate used to answer PASS over (#3704) ────────────────────────────
def test_a_RED_BASELINE_can_never_read_as_a_PASS_or_a_FAIL():
    """THE DEFECT, stated as the property that was missing. `mutate_diff` printed `clean run FAILED
    (exit 1)` for three modules and emitted `status: PASS`, exit 0, "every mutant on the changed
    functions was killed" — because mutmut calls a mutant killed when the covering tests fail with it
    applied, and a red baseline fails without one too. The coverage was arithmetic over a population
    nothing discriminated, and it hid 14 survivors.

    Asserted over a spread of (refused, decided) rather than one pair: PASS is wrong at every count,
    and so is FAIL — the refused modules were not measured, so the run can neither vouch for them nor
    convict the diff."""
    for n in (1, 3, 11):
        for decided in (0, 1, 7, 900):
            status, reason = M.clean_run_exhaustion_verdict(n, decided)
            assert status in ("NOT_RUN", "UNKNOWN"), f"{n},{decided} → {status}: a refusal is not a verdict"
            assert reason, "a non-PASS status with no reason is invalid under §🧾"


def test_the_RED_BASELINE_verdict_says_WHY_a_pass_there_would_be_arithmetic():
    """The reason has to carry the mechanism, or the next reader raises a flag to clear the refusal —
    which is the one remedy that cannot work. Pinned on the words that name the cause, not on the
    sentence they sit in."""
    _, reason = M.clean_run_exhaustion_verdict(2, 0)
    assert "2 module(s) not mutated" in reason
    assert "clean baseline failed" in reason
    assert "arithmetic" in reason and "every mutant reads killed" in reason
    assert "examined nothing" in reason
    _, partial = M.clean_run_exhaustion_verdict(2, 7)
    assert "7 mutant(s) were decided elsewhere" in partial
    assert "unmeasured, not failed" in partial


def test_the_RED_BASELINE_refusal_names_the_module_the_count_and_the_elapsed():
    """A refusal must carry its numbers. The first version of this message said only that the
    baseline failed, which sends the reader to the diff — the failure belongs to the covering set."""
    note = M.clean_run_refusal("cpap_stream.py", 36.4, 5)
    assert note.startswith("cpap_stream.py:")
    assert "5 function(s) selected, none mutated" in note
    assert "36.4s" in note, "the elapsed is the only clue to whether the run got anywhere"
    assert "not this diff's" in note, "whose failure it is decides who fixes it"
    assert "Fix or quarantine THAT test" in note


def test_run_one_CHECKS_THE_BASELINE_AHEAD_OF_THE_CALLER_SUPPLIED_TIMEOUT():
    """THE HOLE ITSELF, and the reason the gate could not see its own red baseline: `clean_ok` had one
    consumer, inside the `else` of `if timeout is not None`, and `tools/mutate_diff.py` always passes
    `timeout=max(1, _left)`. So the check was switched off on exactly the path the gate runs — a guard
    behind a parameter the caller always sets is not a guard.

    Asserted on the AST and on ORDER, which is the invariant: the baseline guard must be a statement
    of `run_one`'s own body, ahead of the timeout branch, so no caller can route around it. A text
    scan would pin the spelling instead; a reformat moves that and this must survive it (#3196).

    ⚠️ NOT driven by importing `tools/mutate.py`. `tools/` has no `__init__.py`, so coverage's
    unexecuted-file scan never descends into it and the file is absent from the denominator — until a
    test imports it, at which point 289 statements arrive at 19 % and the 100 % floor fails. Measured
    here: that import alone took TOTAL from 100 % to 99.21 %."""
    import ast as _ast
    import pathlib as _pl

    _src = (_pl.Path(__file__).resolve().parent.parent / "tools" / "mutate.py").read_text(encoding="utf-8")
    _fn = next(n for n in _ast.walk(_ast.parse(_src)) if isinstance(n, _ast.FunctionDef) and n.name == "run_one")

    def _is_timeout_branch(node):
        return (
            isinstance(node, _ast.If)
            and isinstance(node.test, _ast.Compare)
            and isinstance(node.test.left, _ast.Name)
            and node.test.left.id == "timeout"
            and any(isinstance(o, _ast.IsNot) for o in node.test.ops)
        )

    def _is_baseline_guard(node):
        return (
            isinstance(node, _ast.If)
            and isinstance(node.test, _ast.UnaryOp)
            and isinstance(node.test.op, _ast.Not)
            and isinstance(node.test.operand, _ast.Name)
            and node.test.operand.id == "clean_ok"
            and any(isinstance(b, _ast.Return) for b in node.body)
        )

    _guards = [i for i, st in enumerate(_fn.body) if _is_baseline_guard(st)]
    _branches = [i for i, st in enumerate(_fn.body) if _is_timeout_branch(st)]
    assert _guards, (
        "run_one has no `if not clean_ok: return` in its own body — the guard is reachable only through a branch"
    )
    assert _branches, "the `timeout is not None` branch moved; re-read this test before trusting it"
    assert min(_guards) < min(_branches), (
        f"the baseline guard is at body index {min(_guards)}, the timeout branch at {min(_branches)} — "
        "a caller that supplies a timeout skips the check, which is the #3704 defect verbatim"
    )


def test_the_gate_RETRIES_a_timed_out_mutant_at_the_wider_bound_and_REHARVESTS_it():
    """Wiring, on the AST, for residue `2026-10-19-a-mutant-whose-cost-is-a-wait-spends-its-own-bound`.

    mutmut derives each mutant's bound from the CLEAN baseline, which never pays a wait only the
    mutant can lengthen. So a mutant whose cost is a `sleep`, a grace or a socket timeout reads
    `timeout` — UNDECIDED — and this gate refuses, over mutants the suite does catch. The two pure
    halves live in `mutation_diff` and are tested there; what cannot be tested there is whether the
    runner CALLS them, and a pure function nobody calls reports nothing.

    Three things are pinned, because dropping any one of them restores a different defect:

      * the retry runs at `mut.WIDE_TIMEOUT_MULTIPLIER` — at the narrow bound it measures nothing new;
      * the second record REPLACES the first (`r = r2`), so the ordinary harvest below reads the
        settled outcomes and a mutant that SURVIVES the wider bound still blocks. Reading a kill off
        the retry counter instead is #3729's defect verbatim;
      * `retry_outcome` is called, so the verdict can separate "the bound was too tight" from "nothing
        measured this mutant" — which is the whole point of the row.
    """
    import ast as _ast
    import pathlib as _pl

    src = (_pl.Path(__file__).resolve().parent.parent / "tools" / "mutate_diff.py").read_text()
    tree = _ast.parse(src)
    called = {n.func.id for n in _ast.walk(tree) if isinstance(n, _ast.Call) and isinstance(n.func, _ast.Name)}
    assert {"timed_out_in_scope", "retry_outcome"} <= called, (
        "the runner no longer asks which mutants hit the clock, so a wait mutant stays UNDECIDED"
    )
    wide = [
        n
        for n in _ast.walk(tree)
        if isinstance(n, _ast.Attribute) and n.attr == "WIDE_TIMEOUT_MULTIPLIER" and isinstance(n.value, _ast.Name)
    ]
    assert wide, "the retry no longer passes the wider bound — re-running at 3.0x cannot settle anything"
    kwargs = {
        kw.arg
        for n in _ast.walk(tree)
        if isinstance(n, _ast.Call)
        for kw in n.keywords
        if kw.arg == "timeout_multiplier"
        and isinstance(kw.value, _ast.Attribute)
        and kw.value.attr == "WIDE_TIMEOUT_MULTIPLIER"
    }
    assert kwargs == {"timeout_multiplier"}, "the wider bound is named but never reaches run_one"
    # `r = r2` is what makes the retry's verdicts the ones that get harvested.
    reassigns = [
        n
        for n in _ast.walk(tree)
        if isinstance(n, _ast.Assign)
        and len(n.targets) == 1
        and isinstance(n.targets[0], _ast.Name)
        and n.targets[0].id == "r"
        and isinstance(n.value, _ast.Name)
        and n.value.id == "r2"
    ]
    assert reassigns, (
        "the retry's record is discarded, so the harvest still reads the first run's timeouts — "
        "and a mutant that SURVIVES the wider bound would never block"
    )


def test_the_retry_COUNT_is_published_outside_the_undecided_branch():
    """A filter that publishes its count only when something survives it is not publishing a
    denominator — the finding already recorded against the out-of-scope note, which is printed
    unconditionally for the same reason.

    Here the silent case is the one that matters most. When the wider bound settles EVERY timeout,
    `undecided` is empty and the run PASSES, so a count printed inside `if undecided:` would say
    nothing at all about the run where the bound was the whole story — and a settled mutant is the
    signal that a wait in its covering tests is unsized. Pinned on the AST, so a reformat cannot move
    it and a re-indent cannot hide it."""
    import ast as _ast
    import pathlib as _pl

    src = (_pl.Path(__file__).resolve().parent.parent / "tools" / "mutate_diff.py").read_text()
    main = next(n for n in _ast.walk(_ast.parse(src)) if isinstance(n, _ast.FunctionDef) and n.name == "main")
    MARK = "per-mutant bound and were re-run once at"

    def _says_it(node):
        return any(
            isinstance(c, _ast.Constant) and isinstance(c.value, str) and MARK in c.value for c in _ast.walk(node)
        )

    assert _says_it(main), "the retry count is no longer printed at all"
    undecided_ifs = [
        n
        for n in _ast.walk(main)
        if isinstance(n, _ast.If) and isinstance(n.test, _ast.Name) and n.test.id == "undecided"
    ]
    assert undecided_ifs, "the `if undecided:` branch moved; re-read this test before trusting it"
    for n in undecided_ifs:
        assert not _says_it(n), (
            "the retry count moved inside `if undecided:`, so a run whose timeouts all settled "
            "reports no bound at all — and that run is the one the count is for"
        )
