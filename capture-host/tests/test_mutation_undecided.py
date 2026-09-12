# tepna-capture — tests/test_mutation_undecided.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# A mutant mutmut could not SETTLE is not a mutant that was killed.
#
# The diff-scoped gate used to keep only `": survived"` lines of `mutmut results` and drop the rest,
# on a comment claiming the listing held "survivors and not-checked ONLY". It does not: mutmut's
# `status_by_exit_code` maps at least survived · timeout · suspicious · skipped · no tests ·
# not checked · caught by type check · check-was-interrupted, and its DEFAULT is `suspicious`, so an
# exit code nobody has seen lands there too. Two false verdicts followed:
#
#   (a) a mutant that timed out under load vanished from the listing, and the gate then reported
#       "every mutant on the changed functions was killed" about a mutant no test ever saw;
#   (b) `classify`'s REFUTED is derived as generated-but-not-survived, so a CORRECT equivalence entry
#       whose mutant timed out was reported as "a distinguishing input exists" — an instruction to
#       delete a right answer.
#
# The classifier is INVERTED rather than enumerated: `results()` prints everything except `killed`
# (`if status == "killed" and not all: continue`), so anything that is not `survived` is UNDECIDED.
# That fails closed on a status nobody has met yet, which an enumeration would silently ignore.

import mutation_diff as md


def test_survivors_and_undecided_are_separated():
    r = md.split_results(
        "x_f__mutmut_1: survived\n"
        "x_f__mutmut_2: timeout\n"
        "x_f__mutmut_3: suspicious\n"
    )
    assert r[md.SURVIVED] == ["x_f__mutmut_1"]
    assert r[md.UNDECIDED] == [("x_f__mutmut_2", "timeout"), ("x_f__mutmut_3", "suspicious")]


def test_a_status_NOBODY_HAS_SEEN_is_undecided_not_ignored():
    """The whole reason the rule is inverted. An enumeration of known statuses would drop this line
    silently and the gate would report green about a mutant it never settled. mutmut's own default is
    `suspicious` for unmapped exit codes, so new statuses are not hypothetical."""
    r = md.split_results("x_f__mutmut_9: some status invented next year\n")
    assert r[md.SURVIVED] == []
    assert r[md.UNDECIDED] == [("x_f__mutmut_9", "some status invented next year")]


def test_every_non_killed_status_mutmut_can_print_lands_in_undecided():
    """Taken from mutmut's `status_by_exit_code`, not from our imagination."""
    statuses = ["timeout", "suspicious", "skipped", "no tests", "not checked",
                "caught by type check", "check was interrupted by user"]
    blob = "".join(f"m{i}: {s}\n" for i, s in enumerate(statuses))
    r = md.split_results(blob)
    assert [s for _, s in r[md.UNDECIDED]] == statuses
    assert r[md.SURVIVED] == []


def test_killed_is_handled_rather_than_assumed_away():
    """`killed` only appears under `results --all`, which the gate does not pass — but classifying it
    as UNDECIDED would turn a clean run into a refusal, so it gets its own bucket."""
    r = md.split_results("a: killed\nb: survived\n")
    assert r[md.KILLED] == ["a"] and r[md.SURVIVED] == ["b"] and r[md.UNDECIDED] == []


def test_non_result_lines_are_ignored():
    """mutmut interleaves headers and blanks; a header must not become a phantom mutant."""
    r = md.split_results("\nMutation results\n\n  x: survived\nsome prose without a colon\n")
    assert r[md.SURVIVED] == ["x"]
    assert r[md.UNDECIDED] == []


def test_a_line_whose_name_has_a_space_is_not_a_mutant():
    """`check was interrupted by user` as a STATUS is fine; a name with a space is a prose line that
    happens to contain a colon, and treating it as a mutant would invent one."""
    assert md.classify_results_line("Ran 12 tests: all good") is None
    assert md.classify_results_line("x_f__mutmut_1: timeout")[1] == md.UNDECIDED


def test_the_gate_does_not_keep_only_survived_lines():
    """Reads the tool's own source. This is what reds if the `": survived" not in line: continue`
    filter comes back — the exact line that produced both false verdicts."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "tools" / "mutate_diff.py").read_text()
    assert '": survived" not in line' not in src, "the survivors-only filter is back"
    assert "split_results(" in src, "the gate no longer classifies the full results listing"
    assert "REFUSING" in src.split("if undecided:")[1][:600], "undecided must REFUSE, not pass"
