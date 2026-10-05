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

import pytest

import mutation_diff as md


def test_survivors_and_undecided_are_separated():
    r = md.split_results("x_f__mutmut_1: survived\nx_f__mutmut_2: timeout\nx_f__mutmut_3: suspicious\n")
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
    statuses = [
        "timeout",
        "suspicious",
        "skipped",
        "no tests",
        "not checked",
        "caught by type check",
        "check was interrupted by user",
    ]
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


# ── A KILL IS A DETECTION, OR IT IS NOTHING (2026-10-05) ──────────────────────────────────────────
# The header above records defect (b) as a TIMEOUT problem. It is wider than that, and the wider form
# is what deleted correct work: `classify` derived REFUTED from ABSENCE, and the status mutmut reports
# is not trustworthy either, because mutmut's own map says
#
#       3: "killed",  # internal error in pytest means a kill
#
# so pytest's INTERNAL ERROR — which contention produces on a tree whose tests all pass — is recorded
# as a kill. Heron measured the same tree three times: a contended run gave 15 entries REFUTED with
# ZERO timeouts, the next gave 17 UNDECIDED, a quiet run gave the same 15 as SURVIVED. The 15 were
# deleted and very nearly landed (reverted 452e557f).
_ENTRY = {"key": "k", "class": "no-distinguishing-input", "module": "m.py"}


def test_an_ABSENT_mutant_is_never_refuted_however_the_run_lost_it():
    """THE PLANT. A run whose output is missing an excused mutant must not print REFUTED.

    This is the whole defect in one assertion: generated, not a survivor, no recorded kill. A reaped
    worker, a partial run and a shard that never reported are indistinguishable from each other and
    from a kill, so the only safe reading is that nothing was measured."""
    got = md.classify([_ENTRY], [], set(), generated={"k"})
    assert got["refuted"] == [], "absence is not a kill"
    assert [e["key"] for e in got["not_decided"]] == ["k"]
    assert "never settled" in got["not_decided"][0]["why"]


def test_a_mutant_absent_from_the_run_ENTIRELY_is_orphaned_not_refuted():
    """Not in the survivors, not killed, not even generated — the line moved. Still not a refutation."""
    got = md.classify([_ENTRY], [], set(), generated=set())
    assert got["refuted"] == [] and [e["key"] for e in got["orphaned"]] == ["k"]


def test_a_CORROBORATED_kill_does_refute_so_the_fix_did_not_just_disable_it():
    """The counter-test, and the reason this is not a weakening. A real distinguishing input must
    still reach REFUTED, or the gate would stop reporting stale claims at all."""
    got = md.classify([_ENTRY], [], {"k"}, generated={"k"})
    assert [e["key"] for e in got["refuted"]] == ["k"]
    assert got["not_decided"] == [] and got["orphaned"] == []


def test_a_SURVIVING_claimed_mutant_is_still_excused():
    """Regression on the path that carries the ordinary case."""
    got = md.classify([_ENTRY], [{"key": "k"}], set(), generated={"k"})
    assert [e["key"] for e in got["excused"]] == ["k"] and got["refuted"] == []


def test_pytest_exit_3_is_an_internal_error_and_NOT_a_detection():
    """mutmut maps 3 to `killed` in as many words. Contention produces it on a tree whose tests all
    pass, so trusting the status WORD is what made a contended run delete 15 correct claims."""
    ok, why = md.kill_is_a_detection(3)
    assert not ok
    assert "INTERNAL ERROR" in why and "internal error in pytest means a kill" in why


@pytest.mark.parametrize(
    "exit_code,trusted",
    [(1, True), (0, False), (3, False), (5, False), (33, False), (34, False), (35, False), (36, False), (None, False)],
    ids=[
        "killed",
        "survived",
        "internal-error",
        "no-tests",
        "no-tests-33",
        "skipped",
        "suspicious",
        "timeout",
        "unchecked",
    ],
)
def test_only_pytests_test_failure_exit_counts_as_a_detection(exit_code, trusted):
    """Every exit code in mutmut's own `status_by_exit_code`, plus `None`. Only 1 means a test ran and
    failed, which is the only evidence that a test OBSERVED the mutant."""
    assert md.kill_is_a_detection(exit_code)[0] is trusted


def test_an_exit_code_NOBODY_HAS_SEEN_is_not_a_detection():
    """Fails CLOSED, like `split_results` above. mutmut's map is a defaultdict returning `suspicious`,
    so an unmapped code is not hypothetical — and an enumeration of today's codes would trust it."""
    assert md.kill_is_a_detection(4242)[0] is False


@pytest.mark.parametrize(
    "first,second,ok",
    [(1, 1, True), (1, 3, False), (1, None, False), (1, 0, False), (3, 1, False), (None, 1, False)],
    ids=[
        "both-killed",
        "rerun-internal-error",
        "rerun-unrecorded",
        "rerun-survived",
        "first-untrusted",
        "first-unrecorded",
    ],
)
def test_a_refutation_needs_TWO_trusted_kills_and_the_RERUN_is_judged_too(first, second, ok):
    """The isolated re-run meets the same contention as the first attempt, so "not a survivor on the
    second try" is not agreement. Taking it as a second vote would rebuild the defect one level up."""
    assert md.refutation_corroborated(first, second)[0] is ok


def test_an_uncorroborated_refutation_says_WHICH_half_failed():
    """The reason is the actionable part — a reader has to know whether to re-run or to look at the
    entry, and those are opposite responses."""
    assert "the first kill is not a detection" in md.refutation_corroborated(3, 1)[1]
    assert "isolated re-run did not corroborate" in md.refutation_corroborated(1, 36)[1]


def test_an_UNRECORDED_exit_code_says_it_was_never_decided_not_merely_that_it_is_not_a_kill():
    """`if exit_code is None` → `is not None` SURVIVED the boolean assertions above, because every
    non-detection returns False and only the REASON differs. The reason is the whole value of the
    `None` arm: "never decided in this run" tells a reader to re-run, while "not pytest's
    test-failure exit" tells them to look at the mutant. Opposite responses, so the words matter."""
    ok, why = md.kill_is_a_detection(None)
    assert not ok
    assert "never decided in this run" in why, why
    # and the inverted guard would hand this sentence to a RECORDED code, which is the other half
    assert "never decided" not in md.kill_is_a_detection(0)[1]
