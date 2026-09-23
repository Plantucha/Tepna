# tepna-capture — tests/test_cpap_job.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The post-therapy harvest job. What these tests exist to pin is ONE distinction, because losing it
# cost 5.5 hours of therapy data on 2026-09-06: **a trigger firing is not a harvest happening.** The
# predecessor stored one number at fire time and the boot path read it as "already harvested"; a deploy
# restart landed 108 s later and the card was not read until the 13:00 window.
#
# So every test below is really asking the same question from a different angle: can any path other
# than a VERIFIED completion stop the next harvest? The answer must be no.

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import capture  # noqa: E402
import cpap_job as J  # noqa: E402


def _root():
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "captures"), exist_ok=True)
    return d


# ── the state machine ───────────────────────────────────────────────────────────────────────────────
def test_a_new_job_is_therapy_ended_and_claims_nothing_about_harvesting():
    j = J.new_job(1000.0, "device_verdict", 5.0)
    assert j["state"] == J.THERAPY_ENDED
    assert j["completed_ms"] is None and j["retry_count"] == 0
    assert J.is_complete(j) is False


def test_an_unrecognised_end_source_is_recorded_as_unknown_not_rejected():
    """Losing the job would be worse than losing the label — but a wrong label that passes silently is
    worse than both, so it is normalised to the one value that means "we cannot say"."""
    assert J.new_job(1.0, "vibes", 5.0)["therapy_end_source"] == "unknown"
    assert J.new_job(1.0, "spool_recovered", 5.0)["therapy_end_source"] == "spool_recovered"


def test_the_job_id_is_stable_so_a_repeated_end_addresses_ONE_job():
    """Idempotency by construction: a duplicate stop, a crash-replay and a daily reconciliation must
    not create three jobs for one night."""
    assert J.job_id_for(1725600000000) == J.job_id_for(1725600000000.0)
    assert J.new_job(1725600000000, "device_verdict", 1.0)["job_id"] == "end-1725600000000"


def test_an_end_with_no_known_time_still_gets_an_id():
    """"A session certainly ended and we cannot say when" is a fact worth carrying — the fleet's null
    rule says write no stamp, not that the fact disappears."""
    j = J.new_job(None, "next_start_inferred", 1.0)
    assert j["job_id"] == "end-unknown" and j["therapy_end_ms"] is None


def test_retry_count_counts_ATTEMPTS_not_transitions():
    j = J.new_job(1.0, "device_verdict", 1.0)
    j = J.transition(j, J.HARVEST_REQUESTED, 2.0)
    j = J.transition(j, J.HARVEST_DEFERRED, 3.0, error="busy")
    assert j["retry_count"] == 0, "requesting and deferring are not attempts"
    j = J.transition(j, J.HARVEST_ATTEMPTED, 4.0)
    assert j["retry_count"] == 1 and j["last_attempt_ms"] == 4.0
    j = J.transition(j, J.HARVEST_DEFERRED, 5.0, error="again")
    j = J.transition(j, J.HARVEST_ATTEMPTED, 6.0)
    assert j["retry_count"] == 2


def test_a_new_attempt_clears_the_previous_error():
    j = J.transition(J.new_job(1.0, "device_verdict", 1.0), J.HARVEST_DEFERRED, 2.0, error="wifi down")
    assert j["last_error"] == "wifi down"
    assert J.transition(j, J.HARVEST_ATTEMPTED, 3.0)["last_error"] is None


def test_completion_records_what_was_actually_moved():
    j = J.transition(J.new_job(1.0, "device_verdict", 1.0), J.HARVEST_COMPLETED, 9.0, files=5, nbytes=4096)
    assert J.is_complete(j) and j["completed_ms"] == 9.0 and j["files"] == 5 and j["bytes"] == 4096


def test_an_unknown_state_raises_rather_than_being_stored():
    try:
        J.transition(J.new_job(1.0, "device_verdict", 1.0), "harvested_probably", 2.0)
    except ValueError as e:
        assert "harvested_probably" in str(e)
    else:
        raise AssertionError("an unknown state must not be storable")


def test_transition_does_not_mutate_the_job_it_was_given():
    """The caller persists the RETURNED job. If transition mutated in place, a failed write would leave
    RAM ahead of disk — the two disagreeing about what happened, which is this module's whole subject."""
    a = J.new_job(1.0, "device_verdict", 1.0)
    J.transition(a, J.HARVEST_ATTEMPTED, 2.0)
    assert a["state"] == J.THERAPY_ENDED and a["retry_count"] == 0


# ── the ONLY predicate that may stop a harvest ──────────────────────────────────────────────────────
def test_completed_WITHOUT_a_completion_stamp_is_malformed_and_does_not_count():
    """A record that claims completion but cannot say when did not complete. Allowing it to stop a
    harvest is the exact shape of the 2026-09-06 defect, one field over."""
    j = dict(J.new_job(1.0, "device_verdict", 1.0), state=J.HARVEST_COMPLETED, completed_ms=None)
    assert J.is_complete(j) is False
    assert J.resume_action(j, 9.0)[0] == "requeue"
    assert "malformed" in J.resume_action(j, 9.0)[1]


def test_is_complete_rejects_non_dicts_rather_than_raising():
    for bad in (None, "harvest_completed", 7, []):
        assert J.is_complete(bad) is False


# ── resume: every ambiguity re-queues ───────────────────────────────────────────────────────────────
def test_an_interrupted_attempt_is_REQUEUED_and_says_so():
    """THE case. 2026-09-06: fired 07:31:02, deploy restart 07:32:50, boot said "already harvested"."""
    j = J.transition(J.new_job(1000.0, "standby_hysteresis", 1.0), J.HARVEST_ATTEMPTED, 2.0)
    do, why = J.resume_action(j, 9.0)
    assert do == "requeue" and "INTERRUPTED, not harvested" in why


def test_a_verified_completion_is_the_one_thing_that_stops_a_harvest():
    j = J.transition(J.new_job(1.0, "device_verdict", 1.0), J.HARVEST_COMPLETED, 9.0, files=3)
    do, why = J.resume_action(j, 9.0)
    assert do == "none" and "nothing owed" in why


def test_no_job_and_an_unreadable_job_are_DIFFERENT_facts_with_the_same_safe_answer():
    assert J.resume_action(None, 9.0) == ("none", "no post-therapy job on disk")
    do, why = J.resume_action({"state": "unreadable"}, 9.0)
    assert do == "requeue" and "unreadable" in why


def test_every_incomplete_state_requeues():
    for st in (J.THERAPY_ENDED, J.HARVEST_REQUESTED, J.HARVEST_ATTEMPTED, J.HARVEST_DEFERRED):
        j = J.transition(J.new_job(1.0, "device_verdict", 1.0), st, 2.0)
        assert J.resume_action(j, 9.0)[0] == "requeue", f"{st} must be owed work"


# ── the daily window as reconciliation, not trigger ─────────────────────────────────────────────────
def test_the_window_SKIPS_its_card_read_when_the_job_completed():
    """§6: demoting the window means it must not re-walk a night already on disk."""
    j = J.transition(J.new_job(1.0, "device_verdict", 1.0), J.HARVEST_COMPLETED, 9.0, files=5)
    needed, why = J.should_reconcile(j, 9.0)
    assert needed is False and "nothing owed" in why


def test_the_window_RUNS_when_there_is_no_job_because_then_it_is_the_only_trigger_that_saw_the_night():
    needed, why = J.should_reconcile(None, 9.0)
    assert needed is True and "only trigger" in why


def test_the_window_RUNS_on_an_interrupted_job():
    j = J.transition(J.new_job(1.0, "device_verdict", 1.0), J.HARVEST_ATTEMPTED, 2.0)
    assert J.should_reconcile(j, 9.0)[0] is True


# ── the append-only ledger on disk ──────────────────────────────────────────────────────────────────
def test_the_ledger_APPENDS_so_the_transition_history_survives():
    r = _root()
    j = J.new_job(1000.0, "standby_hysteresis", 1.0)
    capture._cpap_write_job(r, j)
    capture._cpap_write_job(r, J.transition(j, J.HARVEST_ATTEMPTED, 2.0))
    rows = [json.loads(x) for x in open(capture._cpap_job_path(r)) if x.strip()]
    assert [x["state"] for x in rows] == [J.THERAPY_ENDED, J.HARVEST_ATTEMPTED]
    assert capture._cpap_read_job(r)["state"] == J.HARVEST_ATTEMPTED, "the LAST row is current"


def test_a_torn_trailing_line_is_skipped_and_earlier_rows_keep_their_authority():
    """A crash mid-append. The whole reason this is append-only rather than a rewrite: a torn REWRITE
    can still parse and assert something false, where a torn append carries no authority."""
    r = _root()
    j = J.transition(J.new_job(1000.0, "device_verdict", 1.0), J.HARVEST_ATTEMPTED, 2.0)
    capture._cpap_write_job(r, j)
    with open(capture._cpap_job_path(r), "a") as fh:
        fh.write('{"state":"harvest_comp')
    got = capture._cpap_read_job(r)
    assert got["state"] == J.HARVEST_ATTEMPTED
    assert J.resume_action(got, 9.0)[0] == "requeue"


def test_a_ledger_of_nothing_but_garbage_reads_as_unreadable_not_as_absent():
    r = _root()
    with open(capture._cpap_job_path(r), "w") as fh:
        fh.write("not json\n{also not\n")
    assert capture._cpap_read_job(r) == {"state": "unreadable"}


def test_a_missing_ledger_is_None():
    assert capture._cpap_read_job(_root()) is None


def test_blank_lines_are_ignored():
    r = _root()
    capture._cpap_write_job(r, J.new_job(1.0, "device_verdict", 1.0))
    with open(capture._cpap_job_path(r), "a") as fh:
        fh.write("\n   \n")
    assert capture._cpap_read_job(r)["state"] == J.THERAPY_ENDED


def test_an_unwritable_ledger_warns_and_does_not_raise(monkeypatch, caplog):
    import logging
    caplog.set_level(logging.WARNING)
    """A job we could not persist means the next boot may re-harvest. That is the safe direction and
    must never take down the loop that was about to do the work."""
    r = _root()

    def boom(*a, **k):
        raise OSError("read-only file system")
    monkeypatch.setattr(capture.os, "makedirs", boom)
    capture._cpap_write_job(r, J.new_job(1.0, "device_verdict", 1.0))
    assert "could not persist" in caplog.text


# ── deferral and boot ───────────────────────────────────────────────────────────────────────────────
def test_defer_records_the_reason_and_passes_None_through():
    r = _root()
    j = capture._cpap_defer_job(r, J.new_job(1.0, "device_verdict", 1.0), "streaming: H10")
    assert j["state"] == J.HARVEST_DEFERRED and j["last_error"] == "streaming: H10"
    assert capture._cpap_defer_job(r, None, "whatever") is None


def test_boot_requeues_an_interrupted_job_and_returns_it():
    r = _root()
    capture._cpap_write_job(r, J.transition(J.new_job(1000.0, "device_verdict", 1.0),
                                            J.HARVEST_ATTEMPTED, 2.0))
    got = capture._cpap_boot_job(r)
    assert got is not None and got["state"] == J.HARVEST_ATTEMPTED


def test_boot_returns_None_on_a_completed_job():
    r = _root()
    capture._cpap_write_job(r, J.transition(J.new_job(1.0, "device_verdict", 1.0),
                                            J.HARVEST_COMPLETED, 9.0, files=2))
    assert capture._cpap_boot_job(r) is None


def test_boot_returns_None_for_an_unreadable_ledger_but_still_treats_it_as_owed(caplog):
    import logging
    caplog.set_level(logging.INFO)
    """`resume_action` says requeue; the loop cannot resume a record it cannot parse, so it returns
    None — and the LOG must say why, or the night looks like it was never owed."""
    r = _root()
    with open(capture._cpap_job_path(r), "w") as fh:
        fh.write("{tor\n")
    assert capture._cpap_boot_job(r) is None
    assert "RESUME" in caplog.text


# ── migration off the legacy fired-marker ───────────────────────────────────────────────────────────
def test_a_legacy_fired_marker_becomes_a_REQUEUED_job_never_a_completed_one():
    """The marker recorded that a TRIGGER fired. Translating it into a completion would carry the
    original defect across the upgrade — so it re-queues, costing at most one extra card read."""
    r = _root()
    with open(capture._cpap_fired_marker(r), "w") as fh:
        json.dump({"ended_at_ms": 1725600000000.0}, fh)
    j = capture._cpap_migrate_fired(r)
    assert j["state"] == J.HARVEST_REQUESTED and j["therapy_end_source"] == "unknown"
    assert not os.path.exists(capture._cpap_fired_marker(r)), "the legacy file must be removed"
    assert J.is_complete(j) is False


def test_migration_is_a_noop_without_a_marker():
    assert capture._cpap_migrate_fired(_root()) is None


def test_boot_does_not_let_a_migration_overwrite_a_REAL_job():
    r = _root()
    capture._cpap_write_job(r, J.transition(J.new_job(2000.0, "device_verdict", 1.0),
                                            J.HARVEST_ATTEMPTED, 2.0))
    with open(capture._cpap_fired_marker(r), "w") as fh:
        json.dump({"ended_at_ms": 1.0}, fh)
    got = capture._cpap_boot_job(r)
    assert got["therapy_end_ms"] == 2000.0, "the existing job wins; migration is guarded on job is None"


def test_completion_without_counts_still_completes_and_leaves_the_fields_null():
    """A completion that cannot say how many files it moved is still a completion — the walk returned.
    The counts are evidence, not the verdict, and inventing a zero would be the fleet's null rule
    broken in the one record that decides whether a night gets re-read."""
    j = J.transition(J.new_job(1.0, "device_verdict", 1.0), J.HARVEST_COMPLETED, 9.0)
    assert J.is_complete(j) is True
    assert j["files"] is None and j["bytes"] is None


# ── the window BOUND: the defect that would have skipped every night after the first ────────────────
def test_a_completion_from_a_PREVIOUS_window_does_not_excuse_todays(tmp_path):
    """🔴 The regression this pins is the one that nearly shipped. `should_reconcile` first asked only
    "is there a completed job?" — true forever after the first successful harvest — so the daily window
    would have skipped EVERY subsequent night, silently, destroying the exact guarantee it exists to
    provide. A completion excuses the window it was STAMPED for and no other.

    The bound is a DATE STRING, not a timestamp comparison, and that is load-bearing: the caller's
    `now` and the job's `completed_ms` can come from different clocks (a test's fake datetime against
    real `time.time()`), and comparing them is how the first fix silently produced a window that
    skipped forever anyway. A string equality has no clock in it to get wrong."""
    done = J.transition(J.new_job(1.0, "device_verdict", 1.0), J.HARVEST_COMPLETED, 9.0,
                        files=3, window_date="2026-09-05")
    same, why_same = J.should_reconcile(done, 9.0, "2026-09-05")
    assert same is False and "nothing owed" in why_same, "its OWN window is still excused"
    nxt, why_nxt = J.should_reconcile(done, 9.0, "2026-09-06")
    assert nxt is True, "a new night is NOT excused by yesterday's completion"
    assert "2026-09-05" in why_nxt and "2026-09-06" in why_nxt, "the why names both windows"


def test_a_completion_from_BEFORE_the_window_bound_existed_cannot_excuse_a_window():
    """A job written by a build that predates `window_date` carries none. It is a previous night's
    answer by construction, so it must not speak for this one — the same reasoning as a mismatch."""
    old = J.transition(J.new_job(1.0, "device_verdict", 1.0), J.HARVEST_COMPLETED, 9.0, files=1)
    assert "window_date" not in old
    assert J.should_reconcile(old, 9.0, "2026-09-06")[0] is True
    assert J.should_reconcile(old, 9.0)[0] is False, "with no window asked, completion still settles it"


# ── reading the ledger: the two remaining ways a line or a file can be wrong ────────────────────────
def test_a_json_line_that_is_not_an_OBJECT_is_ignored_rather_than_trusted():
    """`[1,2]` and `"harvest_completed"` parse fine and are not jobs. Taking one as the current row
    would hand `resume_action` a non-dict — which it would re-queue, so this is not a data-loss bug,
    but the earlier VALID row is the honest answer and must keep its authority."""
    r = _root()
    capture._cpap_write_job(r, J.new_job(1000.0, "device_verdict", 1.0))
    with open(capture._cpap_job_path(r), "a") as fh:
        fh.write('[1,2]\n"harvest_completed"\n7\n')
    got = capture._cpap_read_job(r)
    assert got["state"] == J.THERAPY_ENDED, "the last OBJECT row wins, not the last line"
    assert J.resume_action(got, 9.0)[0] == "requeue"


def test_a_ledger_that_cannot_be_OPENED_is_UNREADABLE_not_absent():
    """🔴 The distinction that makes this the safe answer, and it was wrong until the coverage floor
    forced this test to exist. `_cpap_read_job` checks `os.path.exists` FIRST, so reaching the
    `except OSError` means the ledger IS on disk and could not be read — and "I could not look" must
    never be reported as "there is nothing owed". That substitution is the predecessor's exact
    failure: a marker true about the trigger and false about the work.

    So absence and ignorance get OPPOSITE answers, and only one of them may stop a harvest — a
    missing ledger is None (honest: no therapy end was ever recorded), an unopenable one is the
    unreadable sentinel, which is not in STATES and therefore re-queues. A raise here would instead
    kill the CPAP loop outright on a permissions accident."""
    r = _root()
    os.mkdir(capture._cpap_job_path(r))          # a directory where the ledger should be -> IsADirectoryError
    got = capture._cpap_read_job(r)
    assert got == {"state": "unreadable"}
    assert J.resume_action(got, 9.0)[0] == "requeue"
    assert J.is_complete(got) is False, "nothing unreadable may ever read as complete"
    assert J.should_reconcile(got, 9.0, "2026-09-06")[0] is True
    assert capture._cpap_read_job(_root()) is None, "a MISSING ledger is still honest absence"
