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


def test_a_naive_stamp_reads_as_utc_because_only_a_zone_dropping_writer_emits_one():
    """Reading it in the host's local zone would move it by the offset — exactly the error an age
    bound cannot survive, and the bound is what keeps a stale row from becoming a guess."""
    naive = rec_journal_rows(_file(_row("2026-10-28T03:00:00", "not_recording", "recording")))
    aware = rec_journal_rows(_file(_row("2026-10-28T03:00:00+00:00", "not_recording", "recording")))
    assert naive[0][0] == aware[0][0]


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
