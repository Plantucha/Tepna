"""Auto-start — the live stream starts itself when therapy starts.

🔴 THE ASYMMETRY WITH THE END TRIGGER IS THE DESIGN. Firing late on an END costs ten minutes. Firing
wrongly on a START opens a BLE stream beside a sleeping body and can record something that is not a
session. So this side is tested for what it REFUSES at least as hard as for what it fires."""

import cpap_live as L

T0 = 1_787_000_000_000
HDR = "host_ms;prior;state;transition;action;trigger;confidence;reachable;fg_state;x;y;z"


def _j(rows):
    return "\n".join([HDR] + [f"{ms};i;i;;;i;f;True;{st};0;0;" for ms, st in rows])


def _armed(began=T0):
    """A watch that has seen therapy begin and is past the debounce."""
    return L.StartWatch(float(began))


# ── the edge ───────────────────────────────────────────────────────────────────────────────────


def test_a_standby_to_therapy_edge_arms_the_watch():
    w = L.observe_start(L.StartWatch(), False, T0)
    assert w.began_at_ms is None
    w = L.observe_start(w, True, T0 + 1000)
    assert w.began_at_ms == T0 + 1000


def test_the_session_START_is_held_not_refreshed_by_later_readings():
    """The debounce measures from when therapy BEGAN. Refreshing on every reading would restart the
    clock each poll and the trigger would never fire."""
    w = L.observe_start(L.StartWatch(), True, T0)
    for k in range(1, 10):
        w = L.observe_start(w, True, T0 + k * 30_000)
    assert w.began_at_ms == T0


def test_a_NONE_reading_does_NOT_clear_the_session():
    """🔴 The killing case. Once a stream is running the detector defers ENTIRELY, so every reading is
    None. Treating None as "not in therapy" would end the session in state, and the next real reading
    would look like a fresh edge and start a SECOND stream."""
    w = L.observe_start(L.StartWatch(), True, T0)
    for k in range(1, 200):
        w = L.observe_start(w, None, T0 + k * 30_000)
    assert w.began_at_ms == T0, "a deferred detector ended the session in state"


def test_leaving_therapy_ends_the_session_and_clears_the_attempt_state():
    w = L.note_start_failed(_armed(), T0)
    w = L.observe_start(w, False, T0 + 60_000)
    assert w.began_at_ms is None and w.attempts == 0 and w.next_try_ms is None


# ── eager start + retention (the 120 s rule's new home) ────────────────────────────────────────


def test_the_FIRST_sighting_fires_and_a_blip_is_handled_by_RETENTION_not_a_gate():
    """🔴 THE INVERSION (owner-queued 2026-09-01). The old debounce held every genuine night's stream
    back 120 s; a mask-fit blip is now allowed to START — its harm is bounded BLE churn, the benign
    failure direction — and the 120 s question is answered afterward by `false_start_verdict`, which
    discards the fragment and spends an attempt."""
    w = L.observe_start(L.StartWatch(), True, T0)
    due, why = L.autostart_due(w, T0)
    assert due is True and "eagerly" in why
    # the blip's stream ends at ~the auto-stop hold; the verdict names it a false start
    discard, vwhy = L.false_start_verdict(T0, T0 + 125_000, manual=False)
    assert discard is True and "false start" in vwhy
    # ...and a real night's stream is retained
    keep, kwhy = L.false_start_verdict(T0, T0 + 6 * 3600_000, manual=False)
    assert keep is False and "real session" in kwhy


def test_the_discard_window_is_retain_PLUS_hold_not_retain_alone():
    """A false start's stream lives ~hold_s before the flat-flow auto-stop can end it, so a bare
    `< retain_s` window would MISS almost every false start (they die at ~125 s against a 120 s
    window). Both boundaries pinned."""
    just_under = L.false_start_verdict(T0, T0 + 239_000, manual=False, retain_s=120, hold_s=120)
    at_window = L.false_start_verdict(T0, T0 + 240_000, manual=False, retain_s=120, hold_s=120)
    assert just_under[0] is True and at_window[0] is False


def test_a_MANUAL_stop_is_never_a_false_start_whatever_the_age():
    """Discarding on intent would delete the one fragment somebody explicitly chose to make."""
    assert L.false_start_verdict(T0, T0 + 10_000, manual=True)[0] is False


def test_unusable_timestamps_RETAIN_because_a_discard_cannot_be_undone():
    assert L.false_start_verdict(None, T0, manual=False)[0] is False
    assert L.false_start_verdict(T0 + 9_000, T0, manual=False)[0] is False  # ended before started


def test_a_false_start_spends_an_attempt_and_reopens_the_session_for_retry():
    """`note_started` marked the session fired; without clearing `fired_for` a machine still in
    Therapy could never earn a retry — and the attempt count plus backoff are what bound the churn."""
    w = L.note_started(_armed())
    w = L.note_false_start(w, T0 + 240_000)
    assert w.attempts == 1 and w.fired_for is None and w.next_try_ms is not None
    assert w.began_at_ms == float(T0), "re-keying the session would hand the retry a fresh budget"
    due, why = L.autostart_due(w, T0 + 240_000)
    assert due is False and "backing off" in why
    assert L.autostart_due(w, T0 + 400_000)[0] is True


def test_repeated_false_starts_EXHAUST_the_budget_even_through_successful_starts():
    """🔴 The interaction that would unbound the churn: `note_started` used to zero the attempt
    count, so start→discard→start→discard would never exhaust. The budget is per-SESSION and must
    survive a successful start."""
    w = _armed()
    for _ in range(5):
        w = L.note_started(w)
        w = L.note_false_start(w, T0 + 240_000)
    assert w.attempts == 5
    assert L.autostart_due(w, T0 + 10_000_000)[1].startswith("5 failed start(s)")


def test_it_fires_ONCE_per_session():
    w = _armed()
    assert L.autostart_due(w, T0 + 200_000)[0] is True
    w = L.note_started(w)
    assert L.autostart_due(w, T0 + 260_000) == (False, "already auto-started for this therapy session")
    # ...and a NEW session arms again
    w = L.observe_start(w, False, T0 + 300_000)
    w = L.observe_start(w, True, T0 + 400_000)
    assert L.autostart_due(w, T0 + 600_000)[0] is True


def test_an_already_running_stream_is_never_started_twice():
    assert L.autostart_due(_armed(), T0 + 999_000, already_streaming=True)[0] is False


# ── manual intent ──────────────────────────────────────────────────────────────────────────────


def test_MANUAL_INTENT_WINS_for_the_session_the_operator_stopped():
    w = L.note_started(_armed())
    w = L.note_manual_stop(w)
    assert L.autostart_due(w, T0 + 900_000)[1].startswith("the operator stopped this session")


def test_a_manual_stop_does_NOT_disable_the_NEXT_session():
    """🔴 Scoped by `began_at_ms`, not a global flag. A global "never again" would silently switch the
    feature off for every future night on one click — and nothing would report that either."""
    w = L.note_manual_stop(L.note_started(_armed()))
    w = L.observe_start(w, False, T0 + 300_000)
    w = L.observe_start(w, True, T0 + 400_000)
    assert L.autostart_due(w, T0 + 600_000)[0] is True, "one manual stop disabled a later night"


# ── bounded retry ──────────────────────────────────────────────────────────────────────────────


def test_a_failed_start_BACKS_OFF_then_retries():
    w = L.note_start_failed(_armed(), T0 + 121_000)
    assert w.attempts == 1
    assert L.autostart_due(w, T0 + 130_000)[1].startswith("backing off")
    assert L.autostart_due(w, T0 + 121_000 + 61_000)[0] is True


def test_the_backoff_is_exponential_and_CAPPED():
    """Uncapped doubling puts the last permitted attempt hours out — past the end of the session it is
    retrying, so it would land on nothing while the state still says a retry is pending."""
    w, t = _armed(), T0 + 121_000
    delays = []
    for _ in range(6):
        w = L.note_start_failed(w, t)
        delays.append((w.next_try_ms - t) / 1000.0)
        t += 1
    assert delays[:4] == [60.0, 120.0, 240.0, 480.0]
    assert max(delays) <= L.AUTOSTART_BACKOFF_MAX_S


def test_retry_is_BOUNDED_a_refusing_device_is_not_hammered_all_night():
    w = _armed()
    for k in range(L.AUTOSTART_MAX_ATTEMPTS):
        w = L.note_start_failed(w, T0 + 121_000 + k * 1_000_000)
    due, why = L.autostart_due(w, T0 + 99_000_000)
    assert due is False and "giving up until the next one" in why


def test_giving_up_is_scoped_to_the_session_too():
    w = _armed()
    for k in range(L.AUTOSTART_MAX_ATTEMPTS):
        w = L.note_start_failed(w, T0 + k * 1_000_000)
    w = L.observe_start(w, False, T0 + 9_000_000)
    w = L.observe_start(w, True, T0 + 9_100_000)
    assert L.autostart_due(w, T0 + 9_400_000)[0] is True


def test_unusable_stamps_refuse_rather_than_fire():
    assert L.autostart_due(L.StartWatch("nope"), T0)[1] == "unusable timestamps"
    w = L.StartWatch(float(T0), next_try_ms="nope")
    assert L.autostart_due(w, T0 + 200_000)[1] == "unusable timestamps"
    assert L.note_start_failed(L.StartWatch(float(T0)), "nope").next_try_ms is None


# ── composing with the boot catch-up ───────────────────────────────────────────────────────────


def test_a_REBOOT_DURING_THERAPY_auto_starts_on_boot():
    """The case with the most to recover: a reboot during therapy is precisely when the stream is NOT
    running, because the daemon that held it died."""
    rows = L.journal_rows(_j([(T0 + i * 30_000, "Therapy") for i in range(20)]))
    w, why = L.boot_start_state(rows, None, None, T0 + 20 * 30_000)
    assert w.began_at_ms == float(T0) and "therapy appears to be running" in why
    assert L.autostart_due(w, T0 + 20 * 30_000)[0] is True


def test_the_boot_seed_uses_the_SESSIONS_start_not_the_last_row():
    """Debouncing against the last row would restart the 120 s clock at every boot, so a box that
    restarted repeatedly would never reach the threshold."""
    rows = L.journal_rows(_j([(T0 + i * 30_000, "Therapy") for i in range(3)]))
    w, _ = L.boot_start_state(rows, None, None, T0 + 90_000)
    assert w.began_at_ms == float(T0)
    assert L.autostart_due(w, T0 + 121_000)[0] is True, "the debounce restarted at boot"


def test_a_journal_that_does_NOT_end_in_therapy_seeds_nothing():
    rows = L.journal_rows(_j([(T0, "Therapy"), (T0 + 30_000, "Standby")]))
    w, why = L.boot_start_state(rows, None, None, T0 + 60_000)
    assert w.began_at_ms is None and "does not end in therapy" in why


def test_a_STALE_journal_does_not_describe_now():
    """Same 24 h bound as the harvest catch-up. A box off for a week must not conclude from an old
    journal that therapy is running right now."""
    rows = L.journal_rows(_j([(T0 + i * 30_000, "Therapy") for i in range(20)]))
    w, why = L.boot_start_state(rows, None, None, T0 + 7 * 86_400_000)
    assert w.began_at_ms is None and "does not describe now" in why


def test_boot_carries_the_session_scoped_flags_and_refuses_bad_input():
    rows = L.journal_rows(_j([(T0 + i * 30_000, "Therapy") for i in range(20)]))
    w, _ = L.boot_start_state(rows, 7.0, 9.0, T0 + 600_000)
    assert w.fired_for == 7.0 and w.manual_stop_for == 9.0
    assert L.boot_start_state([], None, None, T0)[1] == "no journal rows"
    assert "in the future" in L.boot_start_state(rows, None, None, T0 - 60_000)[1]
    assert L.boot_start_state(rows, None, None, "nope")[1] == "unusable timestamps"


def test_a_manual_stop_SURVIVES_the_reboot_it_was_made_before():
    """🔴 Otherwise the automation overrules the operator by way of a restart — the operator says "not
    this session", the box reboots, and it starts anyway. The flag is keyed by the session start, so a
    boot seed that recovers the same session also recovers the refusal."""
    rows = L.journal_rows(_j([(T0 + i * 30_000, "Therapy") for i in range(20)]))
    w, _ = L.boot_start_state(rows, None, float(T0), T0 + 600_000)
    assert w.began_at_ms == float(T0)
    assert L.autostart_due(w, T0 + 600_000)[1].startswith("the operator stopped this session")


def test_the_walk_back_STOPS_at_the_previous_session_not_the_top_of_the_file():
    """🔴 A night can hold an earlier session: Therapy, then Standby, then tonight's Therapy running
    to the end of the journal. Walking past the Standby would date tonight's session from the EARLIER
    one — hours too early — which passes the 120 s debounce instantly and defeats it entirely on
    exactly the nights that have two sessions."""
    rows = L.journal_rows(
        _j(
            [(T0 + i * 30_000, "Therapy") for i in range(10)]  # an earlier session
            + [(T0 + (10 + i) * 30_000, "Standby") for i in range(20)]  # ...which ended
            + [(T0 + (30 + i) * 30_000, "Therapy") for i in range(3)]
        )
    )  # tonight's, still running
    w, _ = L.boot_start_state(rows, None, None, T0 + 33 * 30_000)
    assert w.began_at_ms == float(T0 + 30 * 30_000), "the walk-back ran past an intervening Standby"
    # Under eager start the stake is the session KEY, not a gate: mis-dating tonight's session onto
    # the earlier one would mis-scope the attempt budget and manual intent. The eager fire is due.
    assert L.autostart_due(w, T0 + 30 * 30_000 + 60_000)[0] is True
