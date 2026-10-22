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
from tests._srcscan import split_segment


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
    branch = split_segment(src, "if undecided:", 1, where="tools/mutate_diff.py")
    assert "REFUSING" in branch[:600], "undecided must REFUSE, not pass"


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


# ── THE BOUND IS PART OF THE MEASUREMENT ────────────────────────────────────────────────────────────
# `timeout` is the one UNDECIDED status that says the mutant RAN. Every other one — not checked, no
# tests, skipped, caught by type check — says it never did, so a wider clock would measure nothing
# new about it. That split is why the retry reads the status rather than the bucket.

GLOB = "widget.x_drain__mutmut_*"


def test_only_a_TIMEOUT_is_retryable_because_the_other_statuses_never_ran():
    """A wider bound buys nothing for a mutant no test executed. Retrying `not checked` would spend
    the module's budget twice over and come back with the same word."""
    blob = (
        "widget.x_drain__mutmut_1: timeout\n"
        "widget.x_drain__mutmut_2: not checked\n"
        "widget.x_drain__mutmut_3: suspicious\n"
        "widget.x_drain__mutmut_4: no tests\n"
    )
    assert md.timed_out_in_scope(blob, GLOB) == ["widget.x_drain__mutmut_1"]


def test_a_timeout_on_a_function_the_diff_never_touched_is_not_retried():
    """`mutmut results` enumerates the WHOLE workspace while the run is scoped to one glob, so the
    listing carries mutants this invocation never selected — the finding behind `in_glob_scope`."""
    blob = "widget.x_drain__mutmut_1: timeout\nwidget.x_other__mutmut_1: timeout\n"
    assert md.timed_out_in_scope(blob, GLOB) == ["widget.x_drain__mutmut_1"]


def test_the_retry_set_keeps_LISTING_ORDER_and_names_each_mutant_once():
    """The names are printed to a reader and compared against the second run's set, so a duplicate
    would inflate `retried` and make `settled` unreadable. mutmut lists a mutant twice when a results
    pass is appended to an earlier one in the same blob."""
    blob = "widget.x_drain__mutmut_7: timeout\nwidget.x_drain__mutmut_2: timeout\nwidget.x_drain__mutmut_7: timeout\n"
    assert md.timed_out_in_scope(blob, GLOB) == ["widget.x_drain__mutmut_7", "widget.x_drain__mutmut_2"]


def test_no_results_text_asks_for_no_retry():
    """The caller passes `r.get("results") or ""`, and an empty set is what makes the retry cost zero
    on the ordinary run where nothing timed out."""
    assert md.timed_out_in_scope("", GLOB) == []
    assert md.timed_out_in_scope("widget.x_drain__mutmut_1: killed\n", GLOB) == []


def test_SETTLED_means_the_clock_stopped_deciding_it_NOT_that_it_was_killed():
    """A mutant the wider bound settles may be KILLED or SURVIVING, and a survivor must block. So the
    second run is harvested through the ordinary survivor path and this counter never says `killed`
    — the lesson of #3729, where a counter that named a kill was read as evidence of one."""
    got = md.retry_outcome(["a", "b"], ["b"])
    assert got["retried"] == 2
    assert got["settled"] == ["a"]
    assert got["stillTimingOut"] == ["b"]
    assert got["newlyTimingOut"] == []


def test_a_mutant_that_times_out_ONLY_under_the_WIDER_bound_is_REPORTED():
    """Dropping it would be the examined-nothing pass in its purest form: the gate widened the clock,
    a mutant became unmeasurable, and the record would say the retry settled everything it had."""
    got = md.retry_outcome(["a"], ["a", "c"])
    assert got["settled"] == []
    assert got["stillTimingOut"] == ["a"]
    assert got["newlyTimingOut"] == ["c"]


def test_a_retry_that_settles_everything_leaves_both_timing_out_lists_empty():
    """The measured case: three lab mutants timed out at 3x and all three came back killed at 15x."""
    got = md.retry_outcome(["a", "b", "c"], [])
    assert got["retried"] == 3
    assert got["settled"] == ["a", "b", "c"]
    assert got["stillTimingOut"] == [] and got["newlyTimingOut"] == []
