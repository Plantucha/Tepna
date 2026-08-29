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
    for end, ended, now in ((None, False, T0), (float(T0), True, T0 + 7 * 86_400_000),
                            (float(T0 + 1), True, T0 + 700_000)):
        assert L.boot_state(end, ended, 12345.0, now)[0].fired_for == 12345.0


# ── the daemon side: the durable marker, and the seed ──────────────────────────────────────────

import os                                                                            # noqa: E402

import pytest                                                                        # noqa: E402

import capture                                                                       # noqa: E402


@pytest.fixture(autouse=True)
def _reset_stop():
    """`capture._STOP` is a module global and the fixture that clears it lives in another module."""
    capture._STOP.clear()
    yield
    capture._STOP.clear()


def test_the_marker_round_trips(tmp_path):
    capture._cpap_write_fired(str(tmp_path), 1234.5)
    assert capture._cpap_read_fired(str(tmp_path)) == 1234.5


def test_the_marker_write_is_ATOMIC_never_in_place(tmp_path):
    """🔴 A torn in-place write can leave a file that still PARSES with a truncated number — the
    marker then points at a WRONG instant, which looks right. An atomic write can only fail by leaving
    the file absent, which reads as unknown and merely risks a duplicate harvest."""
    capture._cpap_write_fired(str(tmp_path), 1.0)
    target = capture._cpap_fired_marker(str(tmp_path))
    opened = []
    real_open = open

    def spy(path, *a, **k):
        opened.append(str(path))
        return real_open(path, *a, **k)

    import builtins
    orig = builtins.open
    builtins.open = spy
    try:
        capture._cpap_write_fired(str(tmp_path), 2.0)
    finally:
        builtins.open = orig
    assert target not in opened, "the marker file itself was opened for writing — not atomic"
    assert any(p.endswith(".tmp") for p in opened)
    assert capture._cpap_read_fired(str(tmp_path)) == 2.0


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
    monkeypatch.setattr(capture.os, "makedirs", lambda *a, **k: (_ for _ in ()).throw(OSError("ro")))
    capture._cpap_write_fired(str(tmp_path), 5.0)          # must not raise
    assert capture._cpap_read_fired(str(tmp_path)) is None


def test_the_boot_watch_SEEDS_from_the_journal_and_the_marker(tmp_path, monkeypatch):
    """End of a session at T0, box restarted, nothing harvested yet → the watch comes up armed."""
    now = T0 + 45_000
    monkeypatch.setattr(capture._time, "time", lambda: now / 1000.0)
    (tmp_path / "SESSIONDETECT.csv").write_text(_j(_therapy_then_standby(T0)))
    w = capture._cpap_boot_watch(str(tmp_path))
    assert w.seen_therapy is True and w.ended_at_ms == float(T0)


def test_the_boot_watch_does_NOT_re_arm_an_end_the_marker_records(tmp_path, monkeypatch):
    monkeypatch.setattr(capture._time, "time", lambda: (T0 + 45_000) / 1000.0)
    (tmp_path / "SESSIONDETECT.csv").write_text(_j(_therapy_then_standby(T0)))
    capture._cpap_write_fired(str(tmp_path), float(T0))
    assert capture._cpap_boot_watch(str(tmp_path)).ended_at_ms is None


def test_NO_JOURNAL_seeds_nothing_and_does_not_raise(tmp_path, monkeypatch):
    """A box whose detector has never run still has to start."""
    monkeypatch.setattr(capture._time, "time", lambda: T0 / 1000.0)
    w = capture._cpap_boot_watch(str(tmp_path))
    assert w.seen_therapy is False and w.ended_at_ms is None
