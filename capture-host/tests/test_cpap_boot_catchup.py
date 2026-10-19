"""Boot-time catch-up — an edge trigger with RAM state cannot see an edge that spanned its restart.

The 2026-08-29 case, exactly: the owner rebooted at 06:26 and the therapy end landed at 06:28:03, two
seconds after the daemon came up at 06:28:01. `observe` correctly refused to call it an end, so the
trigger never fired and the night's witnessing attempt was lost to a restart rather than a defect."""

import cpap_live as L

HDR = "host_ms;prior;state;transition;action;trigger;confidence;reachable;fg_state;x;y;z"
T0 = 1_787_000_000_000


def _j(rows):
    return "\n".join([HDR] + [f"{ms};i;i;;;i;f;True;{st};0;0;" for ms, st in rows])


def _therapy_then_standby(end_at):
    """Six hours of Therapy ending at `end_at`, then standby rows after it."""
    rows = [(end_at - (720 - i) * 30_000, "Therapy") for i in range(720)]
    rows += [(end_at + k * 30_000, "Standby") for k in range(4)]
    return rows


# ── the parsers ────────────────────────────────────────────────────────────────────────────────


def test_journal_rows_skips_the_header_and_torn_lines():
    rows = L.journal_rows(_j([(T0, "Therapy"), (T0 + 30_000, "Standby")]) + "\ntorn;line\n")
    assert rows == [(float(T0), "Therapy"), (float(T0 + 30_000), "Standby")]
    assert L.journal_rows("") == [] and L.journal_rows(None) == []


def test_the_end_is_the_FIRST_non_therapy_row_not_the_last_therapy_one():
    """The stamp of the row that WITNESSED the end. The two differ by up to one poll, and only the
    observed one is an instant this file actually saw."""
    end, ended = L.last_therapy_end(L.journal_rows(_j(_therapy_then_standby(T0))))
    assert ended is True and end == float(T0)


def test_a_journal_ending_IN_therapy_reports_NO_end():
    """🔴 The killing case. Reading a stale earlier end here would run a harvest — a 2.4 GHz transfer
    beside a sleeping body — in the MIDDLE of a running session."""
    rows = _therapy_then_standby(T0) + [(T0 + 3_600_000, "Therapy"), (T0 + 3_630_000, "Therapy")]
    end, ended = L.last_therapy_end(L.journal_rows(_j(rows)))
    assert ended is False and end is None


def test_a_journal_with_no_therapy_at_all_reports_no_end():
    assert L.last_therapy_end(L.journal_rows(_j([(T0, "Standby")]))) == (None, False)
    assert L.last_therapy_end([]) == (None, False)


# ── the decision ───────────────────────────────────────────────────────────────────────────────


def test_the_2026_08_29_reboot_case_is_caught_up():
    """End at 06:28:03, daemon up at 06:28:01, first cycle a few seconds later."""
    w, why = L.boot_state(float(T0), True, None, T0 + 45_000)
    assert w.seen_therapy is True and w.ended_at_ms == float(T0)
    assert "catching up" in why
    # and the SAME tested decision core then fires it once the debounce is satisfied
    assert L.harvest_due(w, T0 + 700_000)[0] is True
    assert L.harvest_due(w, T0 + 45_000)[0] is False, "the debounce still applies to a caught-up end"


def test_an_end_ALREADY_HARVESTED_is_not_re_harvested_across_a_restart():
    """This is the whole reason the marker is PERSISTED rather than inferred from the output tree: a
    harvest that wrote some files and then died looks identical to a complete one from outside."""
    w, why = L.boot_state(float(T0), True, float(T0), T0 + 700_000)
    assert w.ended_at_ms is None and w.fired_for == float(T0)
    assert "already harvested" in why
    assert L.harvest_due(w, T0 + 700_000)[0] is False


def test_an_end_BEFORE_the_one_already_harvested_is_covered_by_it():
    """THE MEASURED CASE. The live detector's end and the journal's observed end disagree, and the live
    one runs ahead, so a boot that reads `SESSIONDETECT.csv` can get an end EARLIER than the one the
    completed harvest stamped. Equality read that as unharvested and the catch-up re-ran.

    vigil, 2026-10-19, whole journal retention: 3 days of 43, one restart between the two harvests
    each time, every second harvest `files=0 bytes=0`. The card keeps its whole history, so a harvest
    covering `fired_for` covered every earlier end too."""
    earlier = float(T0 - 5_992_080)  # the 2026-09-15 pair, to the millisecond
    w, why = L.boot_state(earlier, True, float(T0), T0 + 700_000)
    assert w.seen_therapy is False and w.ended_at_ms is None
    assert w.fired_for == float(T0), "the marker still travels, on this path as on every other"
    assert L.harvest_due(w, T0 + 700_000)[0] is False
    # A NAMED reason: the equality case and this one are different facts, and the journal line is the
    # only evidence a later session has about which guard stopped the catch-up.
    assert "precedes the one already harvested" in why
    assert "covered by it" in why


def test_an_end_ONE_MS_AFTER_the_harvested_one_is_still_caught_up():
    """The guard is `<=`, and the bound is where it has to be exact. An end after the harvest is new
    data the harvest could not have pulled, so it must still seed. One millisecond is the whole
    difference between a duplicate card read and a lost session."""
    w, why = L.boot_state(float(T0 + 1), True, float(T0), T0 + 700_000)
    assert w.seen_therapy is True and w.ended_at_ms == float(T0 + 1)
    assert "catching up" in why


def test_a_marker_that_is_not_a_NUMBER_cannot_be_ordered_so_the_catch_up_RUNS_and_says_so():
    """`_cpap_read_fired` returns None or a float, but `_cpap_boot_watch` reads `therapy_end_ms` out of
    the job store, which is JSON and can hold anything. An unorderable marker must not raise, and it
    must fail towards a needless catch-up rather than a declined one: `cpap_job.py` records the 2026-08
    night that the boot path declined behind "already harvested", leaving the card unread for 5.5 h.
    The reason names the marker, because a catch-up nobody can explain is the state that costs the
    next session the whole trace."""
    for junk in (object(), [1], {"ms": 1}, (2,)):
        w, why = L.boot_state(float(T0), True, junk, T0 + 700_000)
        assert w.seen_therapy is True, junk
        assert "catching up" in why, junk
        assert "is not a number, so nothing could order it" in why, junk
        assert repr(junk) in why, "the reason names the marker it could not read"
        assert w.fired_for is junk, "even an unusable marker is carried, never silently dropped"
    # And an orderable marker leaves no such note on the ordinary catch-up.
    assert "not a number" not in L.boot_state(float(T0), True, None, T0 + 700_000)[1]


def test_a_marker_held_as_a_NUMERIC_STRING_still_matches_its_own_end():
    """The job store is JSON, so `therapy_end_ms` can arrive as `"1787000000000"`. A raw `==` compares
    a string against a float and reports the two UNEQUAL, so the end that was already harvested read
    as merely earlier — the right refusal with the wrong reason, and a reason is all a later session
    gets. Both sides convert before they are compared."""
    w, why = L.boot_state(float(T0), True, str(T0), T0 + 700_000)
    assert w.seen_therapy is False
    assert why == "the last therapy end was already harvested"
    # The same marker against an EARLIER end still reports the ordering, not identity.
    w, why = L.boot_state(float(T0 - 1_000), True, str(T0), T0 + 700_000)
    assert w.seen_therapy is False and "precedes the one already harvested" in why


def test_a_WEEK_OLD_end_belongs_to_the_daily_window_not_to_boot():
    """A box off for a week must not harvest at boot — that is the wrong radio behaviour for a box
    that has just come back, and the 13:00 window is the unchanged backstop for it."""
    w, why = L.boot_state(float(T0), True, None, T0 + 7 * 86_400_000)
    assert w.ended_at_ms is None and "older than the 24h catch-up bound" in why


def test_the_bound_is_24h_and_NOT_the_debounce_horizon():
    """🔴 A 600 s bound would miss an end at 06:20 on a box rebooted at 07:30 — precisely the case
    catch-up exists for. Pinned so the two numbers are never conflated."""
    ninety_min = 90 * 60_000
    w, _ = L.boot_state(float(T0), True, None, T0 + ninety_min)
    assert w.ended_at_ms == float(T0), "a 90-minute-old end was refused; that is the debounce horizon"
    just_under = L.boot_state(float(T0), True, None, T0 + 86_400_000 - 1_000)[0]
    just_over = L.boot_state(float(T0), True, None, T0 + 86_400_000 + 1_000)[0]
    assert just_under.ended_at_ms == float(T0) and just_over.ended_at_ms is None


def test_a_journal_ending_in_therapy_seeds_NOTHING():
    w, why = L.boot_state(None, False, None, T0)
    assert w.seen_therapy is False and w.ended_at_ms is None
    assert "no observed therapy end" in why


def test_EITHER_arm_alone_means_no_observed_end():
    """The guard is `not ended or end_ms is None`, and each arm stands alone. `last_therapy_end`
    returns `(None, False)` for an empty journal and `(stamp, False)` for one ending IN therapy, so a
    stamp WITH `ended=False` is a real pair this function receives — it names the end of the previous
    session, which an earlier run already handled."""
    for end_ms, ended in ((float(T0), False), (None, True), (None, False)):
        w, why = L.boot_state(end_ms, ended, None, T0 + 700_000)
        assert w.seen_therapy is False, (end_ms, ended)
        assert w.ended_at_ms is None, (end_ms, ended)
        assert why == "no observed therapy end in the journal", (end_ms, ended)


def test_THE_REASON_IS_THE_VERDICT_so_every_boundary_pins_its_exact_text():
    """🔴 The journal line is the whole of what a later session learns about a boot decision, so
    an `in why` assertion over an arithmetic reason is a weak criterion: `age / 3600` and `age * 3600`
    both land inside "older than the 24h catch-up bound". Each figure is pinned exactly, at the
    boundary where it has to be right.

    The two comparisons are pinned at their exact edges too. `age < 0` must admit an end at exactly
    `now` — a boot one millisecond after the journal line is the ordinary case, not a clock
    disagreement — and `age > max_age_s` must admit an end at exactly the bound, since the bound is
    the oldest end catch-up owns rather than the youngest it refuses."""
    # age exactly 0: the end is NOT in the future, and the figure is 0, not 60 × 0 or 0 / 61.
    w, why = L.boot_state(float(T0), True, None, float(T0))
    assert w.seen_therapy is True and w.ended_at_ms == float(T0)
    assert why == "catching up a therapy end from 0 min ago"
    # A 10-minute-old end: `age / 60.0`, so 10 — `age * 60.0` reads 36000 and `age / 61.0` reads 10
    # as well, which is why the SECOND figure below carries the division.
    assert L.boot_state(float(T0), True, None, T0 + 600_000)[1] == "catching up a therapy end from 10 min ago"
    # 61 minutes: 61 / 60 → "61", while 61 min / 61.0 → "60". One minute separates the two divisors.
    assert L.boot_state(float(T0), True, None, T0 + 3_660_000)[1] == "catching up a therapy end from 61 min ago"
    # age exactly the bound: the oldest end boot still owns.
    at_bound = L.boot_state(float(T0), True, None, T0 + 86_400_000)
    assert at_bound[0].ended_at_ms == float(T0), "the bound is inclusive"
    assert at_bound[1] == "catching up a therapy end from 1440 min ago"
    # Over the bound, both figures exact: 25 h against a 24 h bound.
    w, why = L.boot_state(float(T0), True, None, T0 + 90_000_000)
    assert w.ended_at_ms is None
    assert why == ("the last therapy end is 25.0h old, older than the 24h catch-up bound; the daily window owns it")
    # And the bound in the text is the bound that was applied, not the default.
    w, why = L.boot_state(float(T0), True, None, T0 + 90_000_000, max_age_s=36_000.0)
    assert w.ended_at_ms is None
    assert why == ("the last therapy end is 25.0h old, older than the 10h catch-up bound; the daily window owns it")
    # 🔴 THE DIVISOR ITSELF, and it needs its own figures. 3600 and 3601 seconds-per-hour agree at
    # this precision across every ordinary age, so both numbers here are chosen as the ones where the
    # two part: 1_296_360 s is 360.1 h under 3600 and exactly 360.0 h under 3601, and a bound of
    # 361_836 s is 101 h under 3600 and 100 h under 3601. An operator reads these figures to decide
    # whether a night was lost, so a seconds-per-hour off by one is a wrong number, not a rounding
    # taste — and the previous assertions could not see it, because 25.0h survives either divisor.
    w, why = L.boot_state(float(T0), True, None, T0 + 1_296_360_000, max_age_s=361_836.0)
    assert w.ended_at_ms is None
    assert why == ("the last therapy end is 360.1h old, older than the 101h catch-up bound; the daily window owns it")


def test_an_end_in_the_FUTURE_is_a_clock_disagreement_not_a_missed_edge():
    """The journal's stamps and `now` come from the same host, but a boot before NTP settles can put
    them in the wrong order. Seeding on a negative age would make the age bound meaningless."""
    w, why = L.boot_state(float(T0), True, None, T0 - 60_000)
    assert w.ended_at_ms is None and "in the future" in why


def test_unusable_stamps_refuse_rather_than_seed():
    w, why = L.boot_state("not-a-number", True, None, T0)
    assert w.ended_at_ms is None and why == "unusable timestamps"


def test_fired_for_is_CARRIED_into_every_returned_watch_seeded_or_not():
    """A restart must never be able to re-harvest an end the previous process handled, on any path."""
    for end, ended, now in (
        (None, False, T0),
        (float(T0), True, T0 + 7 * 86_400_000),
        (float(T0 + 1), True, T0 + 700_000),
    ):
        assert L.boot_state(end, ended, 12345.0, now)[0].fired_for == 12345.0


# ── the daemon side: the durable marker, and the seed ──────────────────────────────────────────

import os  # noqa: E402

import pytest  # noqa: E402

import capture  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_stop():
    """`capture._STOP` is a module global and the fixture that clears it lives in another module."""
    capture._STOP.clear()
    yield
    capture._STOP.clear()


def test_the_LEGACY_marker_still_READS_because_migration_needs_it(tmp_path):
    """`_cpap_write_fired` is GONE (2026-09-06) — the marker recorded that a trigger FIRED and the boot
    path read it as "harvested", which is the defect the job ledger replaces. The READER survives for
    exactly one purpose: migrating a marker left by the previous build."""
    import json as _json

    (tmp_path / "captures").mkdir(exist_ok=True)
    with open(capture._cpap_fired_marker(str(tmp_path)), "w") as fh:
        _json.dump({"ended_at_ms": 1234.5}, fh)
    assert capture._cpap_read_fired(str(tmp_path)) == 1234.5
    assert not hasattr(capture, "_cpap_write_fired"), "nothing may write the legacy marker any more"


def test_the_job_ledger_is_APPENDED_and_fsynced_never_rewritten(tmp_path):
    """🔴 What replaced the atomic-marker rule, and it is stronger. A torn REWRITE can leave a file that
    still parses and asserts something false; a torn APPEND is a trailing line with no authority, and the
    earlier transitions survive it. Mirrors `cpap_spool`'s ledger, which this repo already argued is the
    restart authority."""
    import cpap_job as J

    root = str(tmp_path)
    j = J.new_job(1234.5, "device_verdict", 1.0)
    capture._cpap_write_job(root, j)
    capture._cpap_write_job(root, J.transition(j, J.HARVEST_ATTEMPTED, 2.0))
    lines = [x for x in open(capture._cpap_job_path(root)) if x.strip()]
    assert len(lines) == 2, "each transition APPENDS; a rewrite would leave one"
    assert capture._cpap_read_job(root)["state"] == J.HARVEST_ATTEMPTED


def test_an_ABSENT_or_CORRUPT_marker_reads_as_unknown_not_as_zero(tmp_path):
    """Unknown must not be a number. `boot_state` treats None as "not yet harvested" — the direction
    that can duplicate a harvest rather than skip one. A duplicate costs one card read; a skip costs
    the night, which is not recoverable."""
    assert capture._cpap_read_fired(str(tmp_path)) is None
    p = capture._cpap_fired_marker(str(tmp_path))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    for bad in ("{not json", "{}", '{"ended_at_ms": null}', '{"ended_at_ms": "x"}', "[]"):
        with open(p, "w") as fh:
            fh.write(bad)
        assert capture._cpap_read_fired(str(tmp_path)) is None, bad


def test_an_UNWRITEABLE_marker_does_not_cost_the_harvest(tmp_path, monkeypatch, caplog):
    """A marker we could not write means the next boot may re-harvest. Safe direction — and it must
    not raise into the loop that just completed a good harvest."""
    import cpap_job as J

    monkeypatch.setattr(capture.os, "makedirs", lambda *a, **k: (_ for _ in ()).throw(OSError("ro")))
    capture._cpap_write_job(str(tmp_path), J.new_job(5.0, "device_verdict", 1.0))  # must not raise
    assert capture._cpap_read_job(str(tmp_path)) is None


def test_the_boot_watch_SEEDS_from_the_journal_and_the_marker(tmp_path, monkeypatch):
    """End of a session at T0, box restarted, nothing harvested yet → the watch comes up armed."""
    now = T0 + 45_000
    monkeypatch.setattr(capture._time, "time", lambda: now / 1000.0)
    (tmp_path / "SESSIONDETECT.csv").write_text(_j(_therapy_then_standby(T0)))
    w = capture._cpap_boot_watch(str(tmp_path))
    assert w.seen_therapy is True and w.ended_at_ms == float(T0)


def test_the_boot_watch_does_NOT_re_arm_an_end_a_COMPLETED_job_records(tmp_path, monkeypatch):
    """The "already handled" input is now a COMPLETED job, not a fired marker — the whole point. A job
    in any other state must NOT suppress the arm, which is asserted directly below."""
    import cpap_job as J

    monkeypatch.setattr(capture._time, "time", lambda: (T0 + 45_000) / 1000.0)
    (tmp_path / "SESSIONDETECT.csv").write_text(_j(_therapy_then_standby(T0)))
    done = J.transition(J.new_job(float(T0), "standby_hysteresis", 1.0), J.HARVEST_COMPLETED, 2.0, files=3)
    capture._cpap_write_job(str(tmp_path), done)
    assert capture._cpap_boot_watch(str(tmp_path)).ended_at_ms is None


def test_an_INTERRUPTED_job_still_arms_the_boot_watch(tmp_path, monkeypatch):
    """The 2026-09-06 case. Under the old marker this end read as handled and nothing re-armed; the card
    went unread for 5.5 h. An attempted-but-not-completed job must leave the end ARMED."""
    import cpap_job as J

    monkeypatch.setattr(capture._time, "time", lambda: (T0 + 45_000) / 1000.0)
    (tmp_path / "SESSIONDETECT.csv").write_text(_j(_therapy_then_standby(T0)))
    capture._cpap_write_job(
        str(tmp_path), J.transition(J.new_job(float(T0), "standby_hysteresis", 1.0), J.HARVEST_ATTEMPTED, 2.0)
    )
    assert capture._cpap_boot_watch(str(tmp_path)).ended_at_ms == float(T0)


def test_NO_JOURNAL_seeds_nothing_and_does_not_raise(tmp_path, monkeypatch):
    """A box whose detector has never run still has to start."""
    monkeypatch.setattr(capture._time, "time", lambda: T0 / 1000.0)
    w = capture._cpap_boot_watch(str(tmp_path))
    assert w.seen_therapy is False and w.ended_at_ms is None
