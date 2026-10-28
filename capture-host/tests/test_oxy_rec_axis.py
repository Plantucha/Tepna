# tepna-capture — tests/test_oxy_rec_axis.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The RECORDING axis (OxyRecEngine) — OXYII-PRESENCE-MODEL §1-MEASURED / DAT-AUTO-HARVEST §3–§5.
# Independent of the LINK axis by construction; every rule here carries the measurement that ratified it
# (1.33 M corpus frames; 40 doff→close events; the 18311 ≡ 18311 trailer cross-check).
import datetime as _d

import pytest
from oxy_lifecycle import (
    LEGAL_TRANSITIONS,
    REC_CATCH_UP_MAX_AGE_S,
    REC_LEGAL_TRANSITIONS,
    InvalidTransition,
    OxyRecEngine,
    OxyRecState,
    OxyState,
    RecSeed,
    boot_rec_state,
    rec_journal_rows,
)


def _eng(**kw):
    kw.setdefault("device_id", "O2R-01")
    kw.setdefault("session_id", "20260824T220000Z-abcdef")
    kw.setdefault("mono", lambda: 42.0)
    kw.setdefault("wall", lambda: "2026-08-24T22:00:00+00:00")
    return OxyRecEngine(**kw)


# ── the two axes are DISJOINT — the invariant everything else leans on ────────────────────────────────


def test_the_two_state_vocabularies_share_no_value():
    """An axis-blind OXYLIFE reader must not be able to confuse a rec row with a link row: the enum
    VALUES are disjoint, so even before the axis column is consulted the states cannot collide."""
    link = {s.value for s in OxyState}
    rec = {s.value for s in OxyRecState}
    assert not (link & rec)


def test_no_cross_axis_edge_exists_in_either_table():
    """Owner spec §3: the dimensions stay independent. Neither table may reference the other's states."""
    for frm, to in LEGAL_TRANSITIONS:
        assert isinstance(frm, OxyState) and isinstance(to, OxyState)
    for frm, to in REC_LEGAL_TRANSITIONS:
        assert isinstance(frm, OxyRecState) and isinstance(to, OxyRecState)


# ── start-up honesty: UNKNOWN converts to a conclusion only on EVIDENCE ───────────────────────────────


def test_a_single_zero_reading_is_not_recording():
    eng = _eng()
    ts = eng.observe_duration(0)
    assert [t.new for t in ts] == [OxyRecState.NOT_RECORDING]
    assert ts[0].axis == "rec"


def test_a_single_positive_reading_stays_unknown_two_increasing_readings_are_recording():
    """A lone dur>0 cannot distinguish an advancing counter from a stale one — §5 forbids turning a
    non-observation into a conclusion, so RECORDING needs two strictly increasing readings."""
    eng = _eng()
    assert eng.observe_duration(10434) == []
    assert eng.state is OxyRecState.UNKNOWN
    ts = eng.observe_duration(10435)
    assert [t.new for t in ts] == [OxyRecState.RECORDING]
    assert "10434→10435" in ts[0].reason


def test_a_flat_positive_counter_never_becomes_recording():
    """The stale-counter control: the same dur>0 forever must hold UNKNOWN, not drift to RECORDING."""
    eng = _eng()
    for _ in range(5):
        assert eng.observe_duration(500) == []
    assert eng.state is OxyRecState.UNKNOWN


# ── the session lifecycle as the corpus measured it ───────────────────────────────────────────────────


def test_not_recording_to_recording_when_the_counter_leaves_zero():
    eng = _eng()
    eng.observe_duration(0)
    ts = eng.observe_duration(1)
    assert [t.new for t in ts] == [OxyRecState.RECORDING]


def test_not_recording_holds_through_repeated_zeros():
    """The docked-idle steady state (16k+ zero frames measured 2026-08-24): repeated 0 is NO event."""
    eng = _eng()
    eng.observe_duration(0)
    for _ in range(4):
        assert eng.observe_duration(0) == []
    assert eng.state is OxyRecState.NOT_RECORDING


def test_unknown_with_a_decreasing_counter_stays_unknown():
    """A reconnect seeing a LOWER value than an earlier UNKNOWN-held reading is still not evidence of
    anything — no close was observed (prev was captured under the same ignorance)."""
    eng = _eng()
    eng.observe_duration(500)
    assert eng.observe_duration(400) == []
    assert eng.state is OxyRecState.UNKNOWN


def test_backward_step_is_end_candidate_and_records_the_close_value():
    """The 2026-08-23 night: counter at 18311 at close, trailer later stored 18311. closed_at_duration
    is what duration_check.observed_s reads — it must be the LAST pre-reset value, not the reset one."""
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(18310)
    eng.observe_duration(18311)
    ts = eng.observe_duration(0)
    assert [t.new for t in ts] == [OxyRecState.END_CANDIDATE]
    assert eng.closed_at_duration == 18311
    assert "18311" in ts[0].reason


def test_backward_step_into_an_already_advancing_session_emits_two_transitions():
    """A reconnect gap can hide the 0: 18302 → 3 is one observation carrying two real events —
    the old session closed AND a new one is running. Both must journal, in order."""
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(18301)
    eng.observe_duration(18302)
    ts = eng.observe_duration(3)
    assert [t.new for t in ts] == [OxyRecState.END_CANDIDATE, OxyRecState.RECORDING]
    assert eng.closed_at_duration == 18302
    assert eng.state is OxyRecState.RECORDING


def test_a_REPEATED_counter_while_recording_is_NOT_a_close():
    """The ring reports the same `duration_s` on every frame inside one counter second, so equality
    is the ordinary case, not an edge. A close is the counter going BACKWARD; reading equal as a
    close mints an END_CANDIDATE, and a `closed_at_duration`, out of a frame that measured nothing
    new — and the pull path would then confirm a session that never ended."""
    eng = _eng()
    eng.observe_duration(10)
    eng.observe_duration(11)
    assert eng.state is OxyRecState.RECORDING
    assert eng.observe_duration(11) == []
    assert eng.state is OxyRecState.RECORDING and eng.closed_at_duration is None


def test_a_close_into_a_counter_of_EXACTLY_ONE_still_opens_the_new_session():
    """1 s is the smallest positive reading the ring can report, so it is the boundary the second
    transition rests on. Without it the new session sits in END_CANDIDATE at a positive counter —
    a candidate the pull path can still confirm against a close that already happened."""
    eng = _eng()
    eng.observe_duration(49)
    eng.observe_duration(50)
    ts = eng.observe_duration(1)
    assert [t.new for t in ts] == [OxyRecState.END_CANDIDATE, OxyRecState.RECORDING]
    assert ts[0].closed_at_duration == 50
    assert ts[1].reason == "new session already advancing (→1)"


def test_end_candidate_holds_through_zeros_then_a_new_session_returns_to_recording():
    """The 2026-08-23 14:20/14:25 corpus pair: two real sessions five minutes apart. The candidate holds
    while the counter sits at 0, and re-donning starts a fresh RECORDING."""
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(100)
    eng.observe_duration(532)
    eng.observe_duration(0)  # close (END_CANDIDATE)
    assert eng.state is OxyRecState.END_CANDIDATE
    for _ in range(3):
        assert eng.observe_duration(0) == []  # candidate held, not decayed by time
    ts = eng.observe_duration(5)
    assert [t.new for t in ts] == [OxyRecState.RECORDING]


# ── confirmation is the PULL's evidence, never the engine's own ───────────────────────────────────────


def test_confirm_end_agrees_within_the_measured_quantization():
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(200)
    eng.observe_duration(251)
    eng.observe_duration(0)
    ts = eng.confirm_end(251)
    assert [t.new for t in ts] == [OxyRecState.END_CONFIRMED]
    assert "251" in ts[0].reason


def test_confirm_end_tolerates_exactly_the_counter_quantization_and_no_more():
    """agrees = |stored − observed| ≤ 1 s, CITED to the ±1 s counter quantization
    (o2ring-duration-is-quantized) — not a chosen constant. ±1 confirms; ±2 must NOT."""
    eng1 = _eng()
    eng1.observe_duration(0)
    eng1.observe_duration(100)
    eng1.observe_duration(300)
    eng1.observe_duration(0)
    assert [t.new for t in eng1.confirm_end(301)] == [OxyRecState.END_CONFIRMED]
    eng2 = _eng()
    eng2.observe_duration(0)
    eng2.observe_duration(100)
    eng2.observe_duration(300)
    eng2.observe_duration(0)
    assert eng2.confirm_end(302) == []  # discrepancy: the CALLER records it; no fabricated agreement
    assert eng2.state is OxyRecState.END_CANDIDATE


def test_confirm_end_outside_end_candidate_is_a_noop():
    eng = _eng()
    assert eng.confirm_end(100) == []
    eng.observe_duration(0)
    assert eng.confirm_end(100) == []
    assert eng.state is OxyRecState.NOT_RECORDING


def test_after_confirmation_zero_is_not_recording_and_advance_is_recording():
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(10)
    eng.observe_duration(20)
    eng.observe_duration(0)
    eng.confirm_end(20)
    assert eng.state is OxyRecState.END_CONFIRMED
    ts = eng.observe_duration(0)
    assert [t.new for t in ts] == [OxyRecState.NOT_RECORDING]


def test_after_confirmation_an_advancing_counter_is_a_new_recording():
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(10)
    eng.observe_duration(20)
    eng.observe_duration(0)
    eng.confirm_end(20)
    ts = eng.observe_duration(4)
    assert [t.new for t in ts] == [OxyRecState.RECORDING]


def test_each_transition_NAMES_the_counter_READING_that_caused_it():
    """`boot_rec_state` restores a state from the journal and this string is the only account of why
    that state exists. Each reading below names ITS OWN number, because a borrowed one reads as a
    different frame and a reason-less row cannot be audited at all."""
    eng = _eng()
    assert [t.reason for t in eng.observe_duration(0)] == ["duration_s reads 0"]
    assert [t.reason for t in eng.observe_duration(7)] == ["duration_s left 0 (→7)"]
    assert [t.new for t in eng.observe_duration(0)] == [OxyRecState.END_CANDIDATE]
    assert [t.reason for t in eng.observe_duration(9)] == ["duration_s advancing (0→9)"]


def test_after_a_CONFIRMED_close_the_reason_says_WHICH_of_the_two_readings_it_saw():
    """END_CONFIRMED is the one state whose next reading is read without reference to `prev`: any
    positive counter is a new session opening and 0 is the ring still idle. The reason has to say
    which, because the state alone no longer distinguishes them."""

    def _confirmed():
        eng = _eng()
        for d in (0, 10, 20, 0):
            eng.observe_duration(d)
        eng.confirm_end(20)
        assert eng.state is OxyRecState.END_CONFIRMED
        return eng

    assert [t.reason for t in _confirmed().observe_duration(0)] == ["duration_s reads 0"]
    assert [t.reason for t in _confirmed().observe_duration(5)] == ["duration_s reads 5 — a new session is open"]


# ── THE fleet trap, as a planted control: link loss is UNKNOWN, never NOT_RECORDING ───────────────────


def test_link_loss_moves_to_unknown_never_not_recording():
    """BLE loss must never read as 'recording ended' (owner spec §3/§11; the morning-of-2026-08-24
    misread class). The engine's answer to an unobservable ring is ignorance, stated as such."""
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(50)
    assert eng.state is OxyRecState.RECORDING
    ts = eng.observe_link_lost()
    assert [t.new for t in ts] == [OxyRecState.UNKNOWN]
    assert eng.state is not OxyRecState.NOT_RECORDING


def test_link_loss_forgets_the_counter_so_reconnect_starts_from_ignorance():
    """A stale prev across a reconnect would let ONE post-reconnect frame (lower than the pre-drop
    counter) fabricate an END_CANDIDATE for a close nobody observed. prev must not survive the drop."""
    eng = _eng()
    eng.observe_duration(0)
    eng.observe_duration(9000)
    eng.observe_link_lost()
    assert eng.prev_duration is None
    ts = eng.observe_duration(20)  # reconnect: a lone positive reading
    assert ts == [] and eng.state is OxyRecState.UNKNOWN


def test_link_loss_while_already_unknown_is_silent():
    eng = _eng()
    assert eng.observe_link_lost() == []


# ── hygiene ───────────────────────────────────────────────────────────────────────────────────────────


def test_invalid_duration_inputs_are_ignored_not_conclusions():
    """None / negative / non-int must cause NO transition — a parse failure is a non-observation."""
    eng = _eng()
    for bad in (None, -1, "12", 3.5):
        assert eng.observe_duration(bad) == []
    assert eng.state is OxyRecState.UNKNOWN and eng.prev_duration is None


def test_rec_rows_carry_the_rec_axis_and_the_shared_row_shape():
    eng = _eng()
    (t,) = eng.observe_duration(0)
    parts = t.as_row().split(";")
    assert len(parts) == 10
    assert parts[2] == "rec_unknown" and parts[3] == "not_recording" and parts[8] == "rec"
    assert parts[9] == "", "NOT_RECORDING names no closing counter"


def test_every_transition_CARRIES_the_device_and_session_and_HISTORY_keeps_the_object():
    """Whose ring and which session: the journal row is written from these two fields and the engine
    is the only holder of either, so a transition that drops one is a row that names no device.
    `history` is read back by the STATUS surface — a placeholder there is a state change with no
    account of itself."""
    eng = _eng()
    ts = eng.observe_duration(0) + eng.observe_duration(9)
    assert [t.device_id for t in ts] == ["O2R-01", "O2R-01"]
    assert [t.session_id for t in ts] == ["20260824T220000Z-abcdef"] * 2
    assert eng.history == ts, "the transitions themselves, not placeholders beside them"


def test_illegal_rec_transition_raises():
    eng = _eng()
    with pytest.raises(InvalidTransition):
        eng._to(OxyRecState.END_CONFIRMED, "forced")  # UNKNOWN → END_CONFIRMED is not a legal edge


def test_every_rec_state_is_reachable_and_unknown_is_reachable_at_runtime():
    """§5's 'UNKNOWN must be reachable at runtime, not only at boot': it is the TARGET of edges from
    every other state, and every non-start state is the target of at least one edge."""
    targets = {to for _, to in REC_LEGAL_TRANSITIONS}
    assert targets == set(OxyRecState) - {OxyRecState.UNKNOWN} | {OxyRecState.UNKNOWN}
    froms_to_unknown = {frm for frm, to in REC_LEGAL_TRANSITIONS if to is OxyRecState.UNKNOWN}
    assert froms_to_unknown == set(OxyRecState) - {OxyRecState.UNKNOWN}


# ── BOOT RECOVERY across a host restart ───────────────────────────────────────────────────────────
# O2RING-BOOT-RECOVERY-DECISION-2026-10-28 §5, option B. The axis was write-only across a restart:
# a new process built the engine UNKNOWN and the `closed_at_duration` a close had already measured
# was gone, with nothing else holding that number. These tests pin the reader, the decision and the
# seeded engine. The three functions own no clock and touch no file; the caller passes `now_ms`.

HDR = "host_wall;host_monotonic;prev;new;reason;device;session;failure;axis;closed_at_duration"
NOW = "2026-10-28T04:00:00+00:00"


def _ms(wall):
    return _d.datetime.fromisoformat(wall).timestamp() * 1000.0


def _row(wall, prev, new, axis="rec", closed="", mono="1.0"):
    return f"{wall};{mono};{prev};{new};reason text;O2R-01;s1;;{axis};{closed}"


def _file(*rows, device=True):
    head = (["# device=O2R-01"] if device else []) + [HDR]
    return "\n".join(head + list(rows)) + "\n"


# ── rec_journal_rows — the ONE reader of the file's rec-axis layout ───────────────────────────────


def test_the_reader_takes_rec_rows_only_and_skips_the_preamble_and_the_header():
    """A LINK row and a POWER row share the file and the first eight columns, so the axis cell is the
    only thing that separates them. The preamble and the header have no axis cell at all."""
    text = _file(
        _row("2026-10-28T01:00:00+00:00", "not_seen", "connecting", axis=""),
        _row("2026-10-28T01:10:00+00:00", "rec_unknown", "not_recording"),
        _row("2026-10-28T01:20:00+00:00", "power_unknown", "charging", axis="power"),
        _row("2026-10-28T01:30:00+00:00", "not_recording", "recording"),
    )
    rows = rec_journal_rows(text)
    assert [r[2] for r in rows] == ["not_recording", "recording"]
    assert [r[1] for r in rows] == ["rec_unknown", "not_recording"]


def test_a_torn_first_line_is_skipped_because_the_caller_hands_us_a_tail():
    """The boot reader reads the TAIL of the file, so line one is usually half a row. A torn line
    either loses its axis cell or loses its stamp; both must drop out in silence."""
    torn = "1.0;rec_unknown;not_recording;reason text;O2R-01;s1;;rec;\n"
    good = _row("2026-10-28T03:00:00+00:00", "not_recording", "recording")
    rows = rec_journal_rows(torn + good + "\n")
    assert [r[2] for r in rows] == ["recording"]


def test_a_nine_column_row_yields_NO_number_rather_than_a_zero():
    """Every row written before 2026-10-28 has nine columns. The number was never written there, and
    0 is a legal duration, so the reading is absence — ∅ ABSENCE IS NULL at the parser."""
    old = "2026-10-28T03:00:00+00:00;1.0;recording;end_candidate;r;O2R-01;s1;;rec"
    ((_ms_, prev, new, closed),) = rec_journal_rows(old + "\n")
    assert (prev, new) == ("recording", "end_candidate") and closed is None


def test_an_unparseable_number_cell_is_absent_not_zero():
    text = _file(_row("2026-10-28T03:00:00+00:00", "recording", "end_candidate", closed="4e2"))
    assert rec_journal_rows(text)[0][3] is None


def test_a_row_whose_stamp_will_not_parse_is_dropped():
    """It cannot be placed in time, and placing it by guess would hand the age bound a fabricated
    number. A dropped row is also why the reader never counts rows to decide anything."""
    text = _file(
        _row("not a date", "recording", "end_candidate", closed="300"),
        _row("2026-10-28T03:00:00+00:00", "not_recording", "recording"),
    )
    assert [r[2] for r in rec_journal_rows(text)] == ["recording"]


def test_the_rows_come_back_ordered_by_stamp_even_when_two_share_one():
    """`boot_rec_state` reads the LAST row, so order is load-bearing. The sort is keyed on the stamp
    ALONE: a tuple sort would reach the number cell when two stamps tie, and None against an int
    raises TypeError inside a boot path."""
    tie = "2026-10-28T03:00:00+00:00"
    text = _file(
        _row("2026-10-28T03:30:00+00:00", "recording", "end_candidate", closed="900"),
        _row(tie, "not_recording", "recording"),
        _row(tie, "recording", "end_candidate", closed="412"),
    )
    rows = rec_journal_rows(text)
    assert [r[0] for r in rows] == sorted(r[0] for r in rows)
    assert rows[-1][3] == 900
    # The case the docstring names, and the one a tuple sort cannot survive: two tied rows whose only
    # difference is the number cell. A tuple comparison reaches the fourth element and meets None
    # against an int, inside the boot path, where a raise is a daemon that does not start.
    tied = _file(
        _row(tie, "recording", "end_candidate", closed="412"),
        _row(tie, "recording", "end_candidate"),
    )
    assert [r[3] for r in rec_journal_rows(tied)] == [412, None]


def test_a_naive_stamp_reads_as_utc_because_only_a_zone_dropping_writer_emits_one():
    """Reading it in the host's local zone would move it by the offset — exactly the error an age
    bound cannot survive, and the bound is what keeps a stale row from becoming a guess."""
    naive = rec_journal_rows(_file(_row("2026-10-28T03:00:00", "not_recording", "recording")))
    aware = rec_journal_rows(_file(_row("2026-10-28T03:00:00+00:00", "not_recording", "recording")))
    assert naive[0][0] == aware[0][0]


def test_the_ZONE_decides_the_instant_even_on_a_host_four_hours_WEST(monkeypatch):
    """Two different failures hide here and a UTC host shows neither. A naive stamp left naive reads
    in the host's zone; a zoned stamp re-stamped as UTC loses its own offset. Either moves the row by
    hours, and hours is the unit the age bound refuses on, so either can discard a live candidate."""
    import time

    monkeypatch.setenv("TZ", "America/New_York")  # the autouse conftest fixture puts the zone back
    time.tzset()
    naive = rec_journal_rows(_file(_row("2026-10-28T03:00:00", "not_recording", "recording")))
    zulu = rec_journal_rows(_file(_row("2026-10-28T03:00:00+00:00", "not_recording", "recording")))
    east = rec_journal_rows(_file(_row("2026-10-28T05:00:00+02:00", "not_recording", "recording")))
    assert naive[0][0] == zulu[0][0] == east[0][0] == _ms("2026-10-28T03:00:00+00:00")


def test_the_reader_answers_nothing_for_empty_and_absent_text():
    assert rec_journal_rows("") == [] and rec_journal_rows(None) == []


# ── boot_rec_state — the decision, pure ──────────────────────────────────────────────────────────


def test_no_rec_rows_seeds_unknown_and_says_why():
    seed, why = boot_rec_state([], _ms(NOW))
    assert seed == RecSeed(OxyRecState.UNKNOWN, None) and "no rec rows" in why


def test_a_row_naming_no_known_state_seeds_unknown():
    """A state name the enum does not hold is a file from a newer or corrupted writer. The seed stays
    at the value a cold start already uses, and the reason names what it read."""
    seed, why = boot_rec_state([(_ms(NOW), "recording", "rec_teleported", None)], _ms(NOW))
    assert seed.state is OxyRecState.UNKNOWN and "rec_teleported" in why


def test_unusable_timestamps_seed_unknown_instead_of_raising():
    seed, why = boot_rec_state([(_ms(NOW), "not_recording", "recording", None)], "half past four")
    assert seed == RecSeed(OxyRecState.UNKNOWN, None) and why == "unusable timestamps"


def test_a_row_in_the_FUTURE_seeds_unknown():
    """Two clocks disagreeing is not a live session, and a negative age would pass any upper bound."""
    rows = [(_ms("2026-10-28T06:00:00+00:00"), "recording", "end_candidate", 412)]
    seed, why = boot_rec_state(rows, _ms(NOW))
    assert seed.state is OxyRecState.UNKNOWN and "future" in why


def test_the_age_bound_is_a_refusal_and_its_edge_is_inclusive():
    """Past the bound the seed is UNKNOWN. AT the bound the row is still accepted — the comparison is
    strictly greater, so one second of arithmetic jitter cannot discard a candidate."""
    now = _ms(NOW)
    at = [(now - REC_CATCH_UP_MAX_AGE_S * 1000.0, "recording", "end_candidate", 412)]
    past = [(now - (REC_CATCH_UP_MAX_AGE_S + 1.0) * 1000.0, "recording", "end_candidate", 412)]
    assert boot_rec_state(at, now)[0] == RecSeed(OxyRecState.END_CANDIDATE, 412)
    seed, why = boot_rec_state(past, now)
    assert seed == RecSeed(OxyRecState.UNKNOWN, None) and "does not describe now" in why


def test_the_REFUSAL_states_the_age_IN_HOURS_because_that_line_is_the_whole_account():
    """The caller logs this string and keeps nothing else: it is the only statement of how stale the
    row was. An hours figure computed in anything but hours describes a different night, and a
    near-miss divisor is the version nobody notices."""
    now = _ms(NOW)
    rows = [(now - 200 * 3600 * 1000.0, "recording", "end_candidate", 412)]
    seed, why = boot_rec_state(rows, now, max_age_s=3600.0)
    assert seed == RecSeed(OxyRecState.UNKNOWN, None)
    assert why == "the journal's last rec row is 200.0h old; it does not describe now"


def test_a_last_row_that_is_itself_unknown_stays_unknown():
    """The previous process ended unobservable — a link loss, not a state. Restoring UNKNOWN is a
    no-op, and the reason says the journal held nothing to restore."""
    seed, why = boot_rec_state([(_ms(NOW), "recording", "rec_unknown", None)], _ms(NOW))
    assert seed == RecSeed(OxyRecState.UNKNOWN, None) and "unobservable" in why


def test_an_end_candidate_comes_back_WITH_the_number_it_closed_at():
    """🔴 The case the unit exists for. An unconfirmed close leaves a `.dat` unpulled, and the closing
    counter is the only thing the trailer can be checked against. Nothing else on the box holds it."""
    rows = [(_ms("2026-10-28T02:00:00+00:00"), "recording", "end_candidate", 412)]
    seed, why = boot_rec_state(rows, _ms(NOW))
    assert seed == RecSeed(OxyRecState.END_CANDIDATE, 412)
    assert "412" in why and "120 min ago" in why


def test_an_end_candidate_from_before_the_column_restores_with_no_number_and_says_so():
    """`confirm_end` then refuses, which is the correct refusal: a confirmation against a borrowed
    figure would be a discrepancy report with a fabricated number in it."""
    rows = [(_ms("2026-10-28T02:00:00+00:00"), "recording", "end_candidate", None)]
    seed, why = boot_rec_state(rows, _ms(NOW))
    assert seed == RecSeed(OxyRecState.END_CANDIDATE, None)
    assert "predates" in why


def test_end_confirmed_restores_like_a_candidate_because_the_number_still_describes_it():
    rows = [(_ms("2026-10-28T03:00:00+00:00"), "end_candidate", "end_confirmed", 412)]
    assert boot_rec_state(rows, _ms(NOW))[0] == RecSeed(OxyRecState.END_CONFIRMED, 412)


def test_recording_and_not_recording_restore_with_no_number_at_all():
    """Neither state names a closed session, so a number here could only be the PREVIOUS session's —
    a stale figure the reader cannot tell from a current one."""
    for name, state in (("recording", OxyRecState.RECORDING), ("not_recording", OxyRecState.NOT_RECORDING)):
        rows = [(_ms("2026-10-28T03:00:00+00:00"), "x", name, 999)]
        seed, why = boot_rec_state(rows, _ms(NOW))
        assert seed == RecSeed(state, None) and "60 min ago" in why


def test_the_seed_carries_no_counter_so_the_first_reading_cannot_look_like_a_close():
    """No journal row holds the live counter. Inventing a `prev_duration` would let the first
    observation after a boot read as an advance or as a backward step, so the field does not exist."""
    assert set(RecSeed.__dataclass_fields__) == {"state", "closed_at_duration"}


# ── the seeded engine — what the restored state actually does ────────────────────────────────────


def _seeded(seed):
    return _eng(state=seed.state, closed_at_duration=seed.closed_at_duration)


def test_a_seeded_recording_meeting_a_zero_counter_reaches_not_recording():
    """The one edge this unit adds. Before it, a seeded RECORDING could never leave: the only exit
    tested `duration < prev`, and `prev` is None after a seed, so the engine sat in RECORDING for the
    rest of the night. The close went unwitnessed, so there is NO candidate — nothing measured what
    the counter read at close."""
    eng = _seeded(RecSeed(OxyRecState.RECORDING, None))
    (t,) = eng.observe_duration(0)
    assert eng.state is OxyRecState.NOT_RECORDING and eng.closed_at_duration is None
    assert "unwitnessed" in t.reason


def test_a_seeded_recording_still_witnesses_the_NEXT_close():
    """The restored state earns its keep here: the counter advances under observation, then steps
    back, and this process measures the closing value the restart would otherwise have cost."""
    eng = _seeded(RecSeed(OxyRecState.RECORDING, None))
    assert eng.observe_duration(600) == [] and eng.state is OxyRecState.RECORDING
    assert eng.observe_duration(640) == []
    (t,) = eng.observe_duration(0)
    assert t.new is OxyRecState.END_CANDIDATE and eng.closed_at_duration == 640


def test_a_seeded_end_candidate_confirms_through_the_pull_path():
    """🔴 The whole point of carrying the number across the restart: the pull path reads the trailer
    and the close confirms, on a session whose END_CANDIDATE a previous process recorded."""
    eng = _seeded(RecSeed(OxyRecState.END_CANDIDATE, 412))
    (t,) = eng.confirm_end(413)
    assert eng.state is OxyRecState.END_CONFIRMED and "observed 412s" in t.reason


def test_a_seeded_end_candidate_with_no_number_REFUSES_to_confirm():
    """A row from before the column restores the state without the figure. `confirm_end` refuses, so
    the discrepancy stays visible rather than being settled against an invented number."""
    eng = _seeded(RecSeed(OxyRecState.END_CANDIDATE, None))
    assert eng.confirm_end(412) == [] and eng.state is OxyRecState.END_CANDIDATE


def test_the_journal_row_carries_the_number_only_on_the_two_states_that_mean_it():
    """A RECORDING row carrying the previous session's close would read as this session's, and the
    reader cannot tell a stale number from a current one. So the cell is blank everywhere else."""
    eng = _eng(state=OxyRecState.RECORDING, prev_duration=640, closed_at_duration=None)
    cand, rec = eng.observe_duration(5)
    assert cand.as_row().split(";")[9] == "640" and cand.new is OxyRecState.END_CANDIDATE
    assert rec.as_row().split(";")[9] == "" and rec.new is OxyRecState.RECORDING


def test_the_new_recording_to_not_recording_edge_is_legal_and_nothing_else_opened():
    """The edge is reachable only from a boot seed, so the table grew by exactly one pair."""
    assert (OxyRecState.RECORDING, OxyRecState.NOT_RECORDING) in REC_LEGAL_TRANSITIONS
    assert (OxyRecState.NOT_RECORDING, OxyRecState.END_CANDIDATE) not in REC_LEGAL_TRANSITIONS


# ── capture._oxy_rec_boot — reads two file tails, decides nothing ─────────────────────────────────


def _night(root, day, text):
    d = root / "captures" / day
    d.mkdir(parents=True)
    (d / "OXYLIFE.csv").write_text(text)


def test_the_boot_reader_restores_a_candidate_from_tonight_journal(tmp_path):
    import capture

    now = _d.datetime(2026, 10, 28, 4, 0, 0)
    wall = _d.datetime(2026, 10, 28, 3, 0, 0).astimezone().isoformat()
    _night(tmp_path, "2026-10-28", _file(_row(wall, "recording", "end_candidate", closed="412")))
    seed = capture._oxy_rec_boot(str(tmp_path), now.timestamp() * 1000.0)
    assert seed == RecSeed(OxyRecState.END_CANDIDATE, 412)


def test_the_boot_reader_also_reads_YESTERDAY_because_a_night_spans_midnight(tmp_path):
    """A restart at 00:20 is inside a recording window whose rows are all in yesterday's folder. One
    night directory is not enough, and the night name is LOCAL — `night_dir` uses local strftime."""
    import capture

    now = _d.datetime(2026, 10, 28, 0, 20, 0)
    wall = _d.datetime(2026, 10, 27, 23, 50, 0).astimezone().isoformat()
    _night(tmp_path, "2026-10-27", _file(_row(wall, "recording", "end_candidate", closed="300")))
    seed = capture._oxy_rec_boot(str(tmp_path), now.timestamp() * 1000.0)
    assert seed == RecSeed(OxyRecState.END_CANDIDATE, 300)


def test_the_boot_reader_reads_the_TAIL_so_a_long_night_still_answers(tmp_path):
    """The file is appended all night and a restart never truncates it, so the read is bounded. The
    last row must win whatever sits above it."""
    import capture

    now = _d.datetime(2026, 10, 28, 4, 0, 0)
    old = _d.datetime(2026, 10, 28, 1, 0, 0).astimezone().isoformat()
    wall = _d.datetime(2026, 10, 28, 3, 0, 0).astimezone().isoformat()
    filler = "\n".join(_row(old, "not_recording", "recording") for _ in range(900))
    _night(
        tmp_path,
        "2026-10-28",
        _file(filler, _row(wall, "recording", "end_candidate", closed="412")),
    )
    assert (tmp_path / "captures" / "2026-10-28" / "OXYLIFE.csv").stat().st_size > capture._OXY_REC_TAIL_BYTES
    assert capture._oxy_rec_boot(str(tmp_path), now.timestamp() * 1000.0).closed_at_duration == 412


def test_an_absent_journal_seeds_unknown_and_CREATES_NO_night_directory(tmp_path, caplog):
    """`night_dir` is deliberately not called: it makes the directory, and a reader that creates a
    night folder would make an empty night look like a captured one."""
    import capture

    now = _d.datetime(2026, 10, 28, 4, 0, 0)
    with caplog.at_level("INFO"):
        seed = capture._oxy_rec_boot(str(tmp_path), now.timestamp() * 1000.0)
    assert seed == RecSeed(OxyRecState.UNKNOWN, None)
    assert not (tmp_path / "captures").exists()
    assert any("no rec rows" in r.getMessage() for r in caplog.records)


# ── capture._oxy_rec_confirm / _oxy_rec_confirm_pulled — END_CONFIRMED's only producer ────────────
#
# `confirm_end` had NO caller outside its tests until 2026-10-28 (unit 122): 363 END_CANDIDATE rows on
# the capture box, 0 confirmations. The pull is where the evidence arrives — the ring's own trailer
# declares what the session lasted, and the axis already wrote what the counter read at close.

_TRAILER_SUBMAGIC = b"\x48\x12\x5a\xda"


def _dat(path, total_seconds, n_records=None):
    """A byte-real Format-A `.dat` the REAL `oxyii.parse_oxy_trailer` reads as finalised.

    `n_records` defaults to `total_seconds` — the consistent file the ring writes, measured as
    `(size - 10 - 48) / 3 == total_seconds`. A different count is the shifted grid that a size check
    and a trailer read both pass and layer 3 of `oxy_transfer.verify` exists to catch."""
    import oxy_transfer

    n = total_seconds if n_records is None else n_records
    t = bytearray(48)
    t[4:8] = _TRAILER_SUBMAGIC  # sub-magic at [4:8] → finalised
    t[12] = total_seconds & 0xFF
    t[13] = (total_seconds >> 8) & 0xFF  # total_seconds = t[12] | t[13]<<8
    t[42] = 0xFF  # o2_score_x10 = None (short-session convention)
    path.write_bytes(bytes(oxy_transfer._FMT_A_HEADER) + b"\x60\x40\x00" * n + bytes(t))
    return str(path)


def _rec_rows(root, day):
    """The rec-axis rows of one night's journal, as raw split cells — the file as a reader sees it."""
    text = (root / "captures" / day / "OXYLIFE.csv").read_text()
    return [ln.split(";") for ln in text.splitlines() if len(ln.split(";")) > 8 and ln.split(";")[8] == "rec"]


def _now_night(root, *, minutes_ago=5, closed="412", new="end_candidate", day_offset=0):
    """A journal in the night directory the REAL clock names, with its last rec row minutes old.

    `_oxy_rec_confirm_pulled` reads `time.time()` itself — that is the production wiring — so a test of
    it cannot hand in a fixed instant and must place its rows against the clock the code reads."""
    now = _d.datetime.now()
    day = (now + _d.timedelta(days=day_offset)).strftime("%Y-%m-%d")
    wall = (now - _d.timedelta(minutes=minutes_ago)).astimezone().isoformat()
    _night(root, day, _file(_row(wall, "recording", new, closed=closed)))
    return day


def test_a_pulled_session_confirms_the_close_the_journal_witnessed(tmp_path):
    """The whole unit. The engine is built from the JOURNAL, not held in memory, so this is also the
    restart case: the process that confirms need never have seen the close."""
    import capture

    day = _now_night(tmp_path, closed="412")
    out = capture._oxy_rec_confirm_pulled(
        str(tmp_path), [_dat(tmp_path / "20261028.dat", 412)], device="O2R-01", device_id="O2R-01"
    )
    assert [t.new for t in out] == [OxyRecState.END_CONFIRMED]
    rows = _rec_rows(tmp_path, day)
    assert [r[3] for r in rows] == ["end_candidate", "end_confirmed"]
    # The number travels with the row, so the confirmation is readable without re-deriving it.
    assert rows[-1][9] == "412"
    assert "stored 412s vs observed 412s" in rows[-1][4]


def test_the_confirmation_row_lands_in_the_FILE_THE_CANDIDATE_CAME_OUT_OF(tmp_path):
    """A close at 23:50 and a pull at 00:30 are two night directories apart. The candidate and its
    confirmation describe ONE session, so a reader of that night's journal must not see a close that
    never resolved."""
    import capture

    yday = _now_night(tmp_path, minutes_ago=40, closed="300", day_offset=-1)
    today = (_d.datetime.now()).strftime("%Y-%m-%d")
    # Tonight's file exists and carries LINK rows only — it holds no rec row to be chosen over.
    _night(tmp_path, today, _file(_row(_d.datetime.now().astimezone().isoformat(), "not_seen", "connecting", axis="")))
    out = capture._oxy_rec_confirm_pulled(str(tmp_path), [_dat(tmp_path / "s.dat", 300)], device_id="O2R-01")
    assert [t.new for t in out] == [OxyRecState.END_CONFIRMED]
    assert [r[3] for r in _rec_rows(tmp_path, yday)] == ["end_candidate", "end_confirmed"]
    assert _rec_rows(tmp_path, today) == []


def test_the_newest_rec_row_decides_when_both_nights_hold_one(tmp_path):
    """Both files carry rec rows across a midnight pull. The seed is the newest row in either, and the
    confirmation goes to the file that row sits in."""
    import capture

    yday = _now_night(tmp_path, minutes_ago=90, closed="300", new="not_recording", day_offset=-1)
    today = _now_night(tmp_path, minutes_ago=4, closed="412")
    out = capture._oxy_rec_confirm_pulled(str(tmp_path), [_dat(tmp_path / "s.dat", 412)], device_id="O2R-01")
    assert [t.new for t in out] == [OxyRecState.END_CONFIRMED]
    assert [r[3] for r in _rec_rows(tmp_path, today)] == ["end_candidate", "end_confirmed"]
    assert [r[3] for r in _rec_rows(tmp_path, yday)] == ["not_recording"]


def test_a_trailer_that_DISAGREES_confirms_nothing_and_writes_no_row(tmp_path, caplog):
    """`confirm_end` refuses outside ±1 s and this path does not negotiate. A disagreement is a real
    discrepancy — the stored session is not the one the axis watched close."""
    import capture

    day = _now_night(tmp_path, closed="412")
    with caplog.at_level("INFO"):
        out = capture._oxy_rec_confirm_pulled(str(tmp_path), [_dat(tmp_path / "s.dat", 500)], device_id="O2R-01")
    assert out == []
    assert [r[3] for r in _rec_rows(tmp_path, day)] == ["end_candidate"]
    assert any("declares 500s" in r.getMessage() for r in caplog.records)


def test_the_counters_measured_one_second_quantization_still_confirms(tmp_path):
    """±1 s is the counter's measured quantization (o2ring-duration-is-quantized), not a tolerance
    invented here — so 411 against 412 is agreement and the row must say both numbers."""
    import capture

    day = _now_night(tmp_path, closed="412")
    out = capture._oxy_rec_confirm_pulled(str(tmp_path), [_dat(tmp_path / "s.dat", 411)], device_id="O2R-01")
    assert [t.new for t in out] == [OxyRecState.END_CONFIRMED]
    assert "stored 411s vs observed 412s" in _rec_rows(tmp_path, day)[-1][4]


def test_a_SHIFTED_RECORD_GRID_is_not_evidence_even_when_its_trailer_agrees(tmp_path):
    """The number comes out of a file that passed the record-boundary walk. This file's trailer declares
    exactly what the journal witnessed, and its body holds a different number of records — the case a
    size check and a trailer read both pass. Confirming from it would vouch for bytes nothing verified."""
    import capture

    day = _now_night(tmp_path, closed="412")
    out = capture._oxy_rec_confirm_pulled(
        str(tmp_path), [_dat(tmp_path / "s.dat", 412, n_records=400)], device_id="O2R-01"
    )
    assert out == []
    assert [r[3] for r in _rec_rows(tmp_path, day)] == ["end_candidate"]


def test_a_part_file_declares_nothing_and_is_skipped(tmp_path):
    """A short pull keeps its `.part`, and a partial artifact cannot declare a session's duration."""
    import capture

    day = _now_night(tmp_path, closed="412")
    out = capture._oxy_rec_confirm_pulled(str(tmp_path), [_dat(tmp_path / "s.dat.part", 412)], device_id="O2R-01")
    assert out == []
    assert [r[3] for r in _rec_rows(tmp_path, day)] == ["end_candidate"]


def test_the_first_agreement_wins_and_the_other_sessions_are_left_alone(tmp_path):
    """One pull can land several sessions and only one of them can be the close this journal witnessed."""
    import capture

    day = _now_night(tmp_path, closed="412")
    out = capture._oxy_rec_confirm_pulled(
        str(tmp_path),
        [_dat(tmp_path / "a.dat", 100), _dat(tmp_path / "b.dat", 412), _dat(tmp_path / "c.dat", 412)],
        device_id="O2R-01",
    )
    assert len(out) == 1
    assert [r[3] for r in _rec_rows(tmp_path, day)] == ["end_candidate", "end_confirmed"]


def test_no_rec_row_in_either_journal_confirms_nothing(tmp_path, caplog):
    """An absent journal is not a close to confirm — and this reader creates no night directory."""
    import capture

    with caplog.at_level("INFO"):
        out = capture._oxy_rec_confirm_pulled(str(tmp_path), [_dat(tmp_path / "s.dat", 412)], device_id="O2R-01")
    assert out == []
    assert not (tmp_path / "captures").exists()
    assert any("nothing was witnessed closing" in r.getMessage() for r in caplog.records)


def test_a_candidate_PAST_THE_AGE_BOUND_is_not_confirmed_by_a_matching_trailer(tmp_path):
    """`boot_rec_state`'s bound is what decides whether the journal still describes now. A day-old
    candidate seeds UNKNOWN, and an UNKNOWN engine confirms nothing however well the number agrees."""
    import capture

    day = _now_night(tmp_path, minutes_ago=int(REC_CATCH_UP_MAX_AGE_S / 60) + 60, closed="412", day_offset=-1)
    out = capture._oxy_rec_confirm_pulled(str(tmp_path), [_dat(tmp_path / "s.dat", 412)], device_id="O2R-01")
    assert out == []
    assert [r[3] for r in _rec_rows(tmp_path, day)] == ["end_candidate"]


def test_a_journal_write_failure_costs_THE_ROW_AND_NOT_THE_PULL(tmp_path, monkeypatch, caplog):
    """Journaling must never damage the pull it describes — `_rec_emit`'s discipline, arriving in the
    harvest path. The bytes are already committed when this runs."""
    import capture

    _now_night(tmp_path, closed="412")

    def boom(*_a, **_k):
        raise OSError("read-only filesystem")

    monkeypatch.setattr(capture, "OxyLifeLogWriter", boom)
    with caplog.at_level("WARNING"):
        out = capture._oxy_rec_confirm_pulled(str(tmp_path), [_dat(tmp_path / "s.dat", 412)], device_id="O2R-01")
    assert [t.new for t in out] == [OxyRecState.END_CONFIRMED]  # the transition happened; the row did not
    assert any("the pull is unaffected" in r.getMessage() for r in caplog.records)


def test_the_confirming_engine_names_the_device_and_CLAIMS_NO_SESSION(tmp_path):
    """The process confirming need not be the one that witnessed, so a session id here would name a run
    that may have observed nothing. The device is known from the pull and is written."""
    import capture

    day = _now_night(tmp_path, closed="412")
    capture._oxy_rec_confirm_pulled(str(tmp_path), [_dat(tmp_path / "s.dat", 412)], device_id="O2R-01")
    row = _rec_rows(tmp_path, day)[-1]
    assert row[5] == "O2R-01" and row[6] == ""
