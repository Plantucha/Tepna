# tepna-capture — test_alert_tiering.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Alert tiering (Kestrel ruling #2614 on consult #2612): PAGE vs BOARD at the source.

The classifier is pure and every gate is tested off as well as on: a gate that cannot
fail in a test is a gate that silently stops working in production. The cap tests pin
the ruling's exact words — 3 per day, over-cap to BOARD with a held line, daemon-down
and low-disk exempt, classifier failure to PAGE.
"""

import asyncio
import datetime as dt
import logging


import alerts


def _run(coro):
    return asyncio.run(coro)


# ── the pure classifier ──────────────────────────────────────────────────────────────


def test_tier_duration_bar_pages_inside_window_after_streaming():
    assert alerts.absence_tier(1800, in_window=True, streamed=True, cluster_size=1) == alerts.TIER_PAGE
    assert alerts.absence_tier(7200, in_window=True, streamed=True, cluster_size=1) == alerts.TIER_PAGE


def test_tier_below_duration_bar_is_board():
    assert alerts.absence_tier(1799, in_window=True, streamed=True, cluster_size=1) == alerts.TIER_BOARD
    assert alerts.absence_tier(0, in_window=True, streamed=True, cluster_size=2) == alerts.TIER_BOARD


def test_tier_cluster_bar_pages_below_duration_bar():
    assert alerts.absence_tier(60, in_window=True, streamed=True, cluster_size=3) == alerts.TIER_PAGE
    assert alerts.absence_tier(60, in_window=True, streamed=True, cluster_size=5) == alerts.TIER_PAGE


def test_tier_window_gate_blocks_even_long_and_clustered():
    assert alerts.absence_tier(7200, in_window=False, streamed=True, cluster_size=1) == alerts.TIER_BOARD
    assert alerts.absence_tier(60, in_window=False, streamed=True, cluster_size=5) == alerts.TIER_BOARD


def test_tier_streamed_gate_blocks_a_device_that_never_streamed():
    assert alerts.absence_tier(7200, in_window=True, streamed=False, cluster_size=1) == alerts.TIER_BOARD
    assert alerts.absence_tier(60, in_window=True, streamed=False, cluster_size=5) == alerts.TIER_BOARD


def test_classify_absence_failure_goes_to_page():
    # A classifier that cannot classify must not hide the alert (ruling amendment 3):
    # a non-numeric duration raises inside the comparison and the function answers PAGE. The
    # second member says the tier was NOT decided, and the caller pages past the cap on it.
    assert alerts.classify_absence("soon", in_window=True, streamed=True, cluster_size=1) == (alerts.TIER_PAGE, True)


def test_classify_absence_matches_tier_when_it_can_classify():
    assert alerts.classify_absence(60, in_window=True, streamed=True, cluster_size=1) == (alerts.TIER_BOARD, False)
    assert alerts.classify_absence(1800, in_window=True, streamed=True, cluster_size=1) == (alerts.TIER_PAGE, False)


def test_is_clustered_tight_trio_all_members():
    starts = [1000.0, 1400.0, 1800.0]
    assert [alerts.is_clustered(starts, i, 900, 3) for i in range(3)] == [True, True, True]


def test_is_clustered_spread_trio_no_members():
    starts = [0.0, 800.0, 1600.0]
    assert [alerts.is_clustered(starts, i, 900, 3) for i in range(3)] == [False, False, False]


def test_is_clustered_pair_is_not_a_cluster():
    starts = [100.0, 200.0]
    assert [alerts.is_clustered(starts, i, 900, 3) for i in range(2)] == [False, False]


def test_is_clustered_ignores_a_far_outlier():
    starts = [0.0, 300.0, 600.0, 5000.0]
    assert [alerts.is_clustered(starts, i, 900, 3) for i in range(4)] == [True, True, True, False]


# ── the cluster arm counts only devices that streamed this night (Kestrel ruling #4340) ──


def test_streamed_this_night_needs_a_sample_this_night():
    assert alerts.streamed_this_night(None, None) is False
    assert alerts.streamed_this_night(None, 1000.0) is False


def test_streamed_this_night_needs_the_sample_at_or_after_night_began():
    assert alerts.streamed_this_night(900.0, 1000.0) is False
    assert alerts.streamed_this_night(1000.0, 1000.0) is True
    assert alerts.streamed_this_night(1500.0, 1000.0) is True


def test_streamed_this_night_without_a_night_start_any_sample_counts():
    assert alerts.streamed_this_night(500.0, None) is True


def test_is_clustered_unstarted_member_breaks_the_trio():
    # Three starts inside one window, but one device never streamed: the other two
    # are a pair, not a cluster — whichever member is unstarted.
    starts = [1000.0, 1400.0, 1800.0]
    assert [alerts.is_clustered(starts, i, 900, 3, started=[True, True, False]) for i in range(3)] == [
        False,
        False,
        False,
    ]
    assert [alerts.is_clustered(starts, i, 900, 3, started=[True, False, True]) for i in range(3)] == [
        False,
        False,
        False,
    ]
    assert [alerts.is_clustered(starts, i, 900, 3, started=[False, True, True]) for i in range(3)] == [
        False,
        False,
        False,
    ]


def test_is_clustered_started_trio_still_clusters():
    starts = [1000.0, 1400.0, 1800.0]
    assert [alerts.is_clustered(starts, i, 900, 3, started=[True, True, True]) for i in range(3)] == [
        True,
        True,
        True,
    ]


def test_is_clustered_unstarted_anchor_cannot_complete_a_started_pair():
    # The unstarted device sits between the two started ones: without the filter its
    # start anchors the window and all three count. With the filter the started pair
    # is two devices in a window, not a cluster.
    starts = [1000.0, 1300.0, 1600.0]
    assert [alerts.is_clustered(starts, i, 900, 3, started=[True, False, True]) for i in range(3)] == [
        False,
        False,
        False,
    ]
    assert [alerts.is_clustered(starts, i, 900, 3) for i in range(3)] == [True, True, True]


def test_is_clustered_skips_an_unstarted_anchor_for_a_later_one():
    # The first start belongs to a device that never streamed. Skipping it must
    # not end the search: the three started devices behind it still form a cluster.
    starts = [0.0, 100.0, 200.0, 300.0]
    assert [alerts.is_clustered(starts, i, 900, 3, started=[False, True, True, True]) for i in range(4)] == [
        False,
        True,
        True,
        True,
    ]


def test_is_clustered_window_edge_is_inclusive_for_the_count():
    # The third start sits exactly one window after the anchor. The window is
    # closed, so the count still reaches three.
    starts = [0.0, 450.0, 900.0]
    assert alerts.is_clustered(starts, 0, 900, 3, started=[True, True, True]) is True


def test_is_clustered_window_edge_is_inclusive_for_the_member():
    # The member itself sits exactly one window after the anchor. The window is
    # closed, so it still belongs to the cluster.
    starts = [0.0, 450.0, 900.0]
    assert alerts.is_clustered(starts, 2, 900, 3, started=[True, True, True]) is True


# ── the board streak (TICKET) ────────────────────────────────────────────────────────

_D1 = dt.date(2026, 10, 29)
_D2 = dt.date(2026, 10, 30)
_D3 = dt.date(2026, 10, 31)
_D4 = dt.date(2026, 11, 1)
_D6 = dt.date(2026, 11, 3)
_D7 = dt.date(2026, 11, 4)
_D8 = dt.date(2026, 11, 5)


def test_streak_fires_once_at_three_consecutive_days():
    s = alerts.BoardStreak(days=3)
    assert s.note("Ring", _D1) is False
    assert s.note("Ring", _D2) is False
    assert s.note("Ring", _D3) is True
    assert s.note("Ring", _D3) is False  # the same day noted again does not refire
    assert s.note("Ring", _D4) is False  # the same streak continuing does not refire


def test_streak_gap_resets_and_a_new_streak_fires():
    s = alerts.BoardStreak(days=3)
    assert s.note("Ring", _D1) is False
    assert s.note("Ring", _D2) is False
    assert s.note("Ring", _D4) is False  # gap at _D3: the streak is 1, not 3
    assert s.note("Ring", _D6) is False
    assert s.note("Ring", _D7) is False
    assert s.note("Ring", _D8) is True


def test_streak_out_of_order_day_completes_the_streak():
    s = alerts.BoardStreak(days=3)
    assert s.note("Ring", _D1) is False
    assert s.note("Ring", _D3) is False
    assert s.note("Ring", _D2) is True  # filling the middle completes d1-d3


def test_streak_is_per_device():
    s = alerts.BoardStreak(days=3)
    assert s.note("Ring", _D1) is False
    assert s.note("Strap", _D1) is False
    assert s.note("Ring", _D2) is False
    assert s.note("Ring", _D3) is True
    assert s.note("Strap", _D2) is False


# ── the Notifier: tier routing and the page cap ──────────────────────────────────────

_PAGE = "https://hooks.example/page/topic"
_BOARD = "https://hooks.example/board/topic"


class _Poster:
    def __init__(self, ok=True):
        self.calls = []
        self.ok = ok

    async def __call__(self, url, payload, headers=None):
        self.calls.append((url, payload))
        return self.ok


def _notifier(poster, **kw):
    return alerts.Notifier(_PAGE, enabled=True, _post=poster, board_url=_BOARD, **kw)


def test_send_default_goes_to_the_page_destination():
    p = _Poster()
    n = _notifier(p)
    assert _run(n.send("Tepna: x", "body")) is True
    assert [u for u, _ in p.calls] == [_PAGE]


def test_send_board_tier_goes_to_the_board_destination():
    p = _Poster()
    n = _notifier(p)
    assert _run(n.send("Tepna: sensor offline", "body", tier=alerts.TIER_BOARD)) is True
    assert [u for u, _ in p.calls] == [_BOARD]
    assert n.stats()["board_delivered"] == 1


def test_send_board_without_a_board_destination_falls_back_to_the_page_topic():
    # The split takes effect when a board destination is configured; until then a BOARD
    # send keeps today's single-topic behaviour instead of going nowhere.
    #
    # 🔴 THIS TEST PINNED THE DEFECT. It asserted `board_delivered == 1` over a send the
    # board never received, so the suite held the fabricated count in place. The route is a
    # decision and stays; the COUNT moves to the stand-in ledger.
    p = _Poster()
    n = alerts.Notifier(_PAGE, enabled=True, _post=p)
    assert n.board_ready is False
    assert _run(n.send("Tepna: x", "body", tier=alerts.TIER_BOARD)) is True
    assert [u for u, _ in p.calls] == [_PAGE]
    st = n.stats()
    assert st["board_delivered"] == 0
    assert st["board_fallback_delivered"] == 1
    assert st["delivered"] == 1


def test_send_board_with_no_destination_at_all_is_not_delivered():
    p = _Poster()
    n = alerts.Notifier(None, enabled=True, _post=p)
    assert _run(n.send("Tepna: x", "body", tier=alerts.TIER_BOARD)) is False
    assert p.calls == []


def test_board_ready_needs_the_flag_and_the_url():
    p = _Poster()
    assert _notifier(p).board_ready is True
    assert alerts.Notifier(_PAGE, enabled=False, _post=p, board_url=_BOARD).board_ready is False


def test_cap_holds_the_fourth_counted_page_to_the_board():
    p = _Poster()
    n = _notifier(p, page_cap_per_day=3)
    for _ in range(3):
        assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True  # delivered — to the board
    urls = [u for u, _ in p.calls]
    assert urls[:3] == [_PAGE] * 3
    assert urls[3] == _BOARD
    assert "cap" in p.calls[3][1]["message"]
    st = n.stats()
    assert st["pages_today"] == 3
    assert st["cap_held"] == 1


def test_cap_exempt_pages_neither_consume_nor_are_held():
    p = _Poster()
    n = _notifier(p, page_cap_per_day=1)
    for _ in range(3):
        assert _run(n.send("Tepna: disk low", "b", cap_exempt=True)) is True
    assert [u for u, _ in p.calls] == [_PAGE] * 3
    assert n.stats()["pages_today"] == 0
    assert n.stats()["cap_held"] == 0


def test_uncounted_pages_do_not_consume_the_cap():
    p = _Poster()
    n = _notifier(p, page_cap_per_day=1)
    assert _run(n.send("Tepna: note", "b")) is True
    assert _run(n.send("Tepna: note", "b")) is True
    assert n.stats()["pages_today"] == 0


def test_a_failed_page_does_not_consume_the_cap():
    p = _Poster(ok=False)
    n = _notifier(p, page_cap_per_day=1)
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is False
    p.ok = True
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    assert [u for u, _ in p.calls] == [_PAGE, _PAGE]
    assert n.stats()["pages_today"] == 1


def test_cap_resets_on_a_new_day():
    p = _Poster()
    today = [_D1]
    n = _notifier(p, page_cap_per_day=1, _today=lambda: today[0])
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    today[0] = _D2
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    assert [u for u, _ in p.calls] == [_PAGE, _PAGE]
    assert n.stats()["pages_today"] == 1


def test_cap_held_without_a_board_destination_still_counts_as_handled():
    p = _Poster()
    n = alerts.Notifier(_PAGE, enabled=True, _post=p, page_cap_per_day=1)
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True  # held; the journal is the record
    assert [u for u, _ in p.calls] == [_PAGE]  # nothing posted for the held one
    assert n.stats()["cap_held"] == 1


def test_configure_can_set_and_clear_the_board_destination():
    p = _Poster()
    n = alerts.Notifier(_PAGE, enabled=True, _post=p)
    n.configure(_PAGE, True, board_url=_BOARD)
    assert n.board_ready is True
    assert _run(n.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is True
    n.configure(_PAGE, True, board_url=None)
    assert n.board_ready is False


def test_configure_without_a_board_argument_keeps_the_destination():
    p = _Poster()
    n = _notifier(p)
    n.configure(_PAGE, True)
    assert n.board_url == _BOARD


def test_stats_do_not_leak_either_url():
    n = _notifier(_Poster())
    st = n.stats()
    assert _PAGE not in str(st) and _BOARD not in str(st)
    assert st["board_configured"] is True


# ── mutation kills (CI #4559, mutate-diff 28 survivors, 2026-11-07) ─────────────────
# Each test pins one behaviour the diff-scoped mutation gate proved unobserved: change
# the line and the suite must go red. A survivor is a test gap, not a shrug.


def test_classify_absence_passes_cluster_devices_through():
    # mutmut_12 dropped the cluster_devices kwarg, so the default (3) answered instead.
    assert alerts.classify_absence(0, in_window=True, streamed=True, cluster_size=2, cluster_devices=2) == (
        alerts.TIER_PAGE,
        False,
    )
    assert alerts.classify_absence(0, in_window=True, streamed=True, cluster_size=2, cluster_devices=3) == (
        alerts.TIER_BOARD,
        False,
    )


def test_classify_absence_failure_logs_the_exception(caplog):
    # mutmut_14/15/16 rewrote the fail-to-PAGE warning: the exception, the reason, the arg.
    with caplog.at_level(logging.WARNING, logger="alerts"):
        assert alerts.classify_absence(None, in_window=True, streamed=True, cluster_size=1) == (alerts.TIER_PAGE, True)
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert warnings, "the fail-to-PAGE path must leave a log line behind"
    text = warnings[-1].getMessage()
    assert "TypeError" in text
    assert "treating the alert as PAGE" in text
    assert "(%r)" not in text


def test_is_clustered_counts_a_member_on_the_window_edge():
    # mutmut_4/9 turned the inclusive edge into an exclusive one, on the member and the count.
    assert alerts.is_clustered([0.0, 900.0], 1, 900, 2) is True
    assert alerts.is_clustered([0.0, 900.0], 0, 900, 2) is True


def test_streak_default_is_three_days():
    # mutmut_1 moved the default from 3 to 4.
    assert alerts.BoardStreak().days == 3


def test_streak_gap_day_breaks_the_run_even_when_noted_out_of_order():
    # A gap day breaks the run: d1-d2 plus a separate d4 is not a 3-day streak.
    s = alerts.BoardStreak()
    assert s.note("Ring", _D4) is False
    assert s.note("Ring", _D1) is False
    assert s.note("Ring", _D2) is False  # d3 is absent: the run is 2 days, not 4


def test_streak_two_day_run_does_not_fire_when_the_earlier_day_is_noted_last():
    # mutmut_24 stepped the run end by 2 days: noting d1 with d2 already seen walked
    # the end past d2 to d3 and counted a 2-day run as 3.
    s = alerts.BoardStreak()
    assert s.note("Ring", _D2) is False
    assert s.note("Ring", _D1) is False  # the run is d1-d2: 2 days, under the 3-day bar


def test_configure_board_url_change_clears_the_dedupe_ledger():
    # mutmut_8/9/10 broke the `changed` flag, so a board-only re-point kept silencing the
    # first alert to the new destination.
    p = _Poster()
    n = _notifier(p)
    assert _run(n.send("Tepna: a", "b", key="k", dedupe_sec=3600, now=1000)) is True
    n.configure(_PAGE, True, board_url="https://hooks.example/board2/topic")
    assert _run(n.send("Tepna: a", "b", key="k", dedupe_sec=3600, now=1001)) is True
    assert len(p.calls) == 2


def test_board_send_with_the_flag_off_posts_nothing():
    # mutmut_11 turned the guard's `and` into `or`, so a switched-off notifier posted.
    p = _Poster()
    n = alerts.Notifier(_PAGE, enabled=False, _post=p, board_url=_BOARD)
    assert _run(n.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is False
    assert p.calls == []
    assert n.stats()["failed"] == 0


def test_exempt_page_never_reads_the_clock():
    # mutmut_24 called _today() even when the page was exempt, so the clock decided nothing.
    calls = []

    def _recording_today():
        calls.append(1)
        return _D1

    p = _Poster()
    n = _notifier(p, page_cap_per_day=1, _today=_recording_today)
    # The constructor reads the clock once, to record the day its page ledger started empty (row
    # `2026-11-08-a-restart-resets-the-page-count-and-board-streak-silently`). This test's claim is
    # about `send`, so it counts the reads from here.
    calls.clear()
    assert _run(n.send("Tepna: disk low", "b", cap_counted=True, cap_exempt=True)) is True
    assert calls == []


def test_cap_held_counts_every_held_page():
    # mutmut_30 reset the counter to 1 instead of adding, so the second held page vanished.
    p = _Poster()
    n = alerts.Notifier(_PAGE, enabled=True, _post=p, page_cap_per_day=1)
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    assert n.stats()["cap_held"] == 2


def test_held_page_forwards_title_key_dedupe_and_now():
    # mutmut_36/38/39/40/44/45/46 rewrote the recursive board send's arguments one at a time.
    p = _Poster()
    n = _notifier(p, page_cap_per_day=1)
    assert _run(n.send("Tepna: a", "b", cap_counted=True, now=1000)) is True
    assert _run(n.send("Tepna: held", "m", cap_counted=True, key="k", dedupe_sec=60, now=1000)) is True
    assert [u for u, _ in p.calls] == [_PAGE, _BOARD]
    assert p.calls[1][1]["title"] == "Tepna: held"
    assert "Held by the daily page cap" in p.calls[1][1]["message"]
    assert n._last.get("k") == 1000
    # Past the forwarded 60-second window the next held page still delivers.
    assert _run(n.send("Tepna: held", "m", cap_counted=True, key="k", dedupe_sec=60, now=1200)) is True
    assert [u for u, _ in p.calls] == [_PAGE, _BOARD, _BOARD]


def test_held_page_without_a_board_destination_logs_the_title(caplog):
    # mutmut_49/50/51 rewrote the journal warning: the title, the reason, the arg.
    p = _Poster()
    n = alerts.Notifier(_PAGE, enabled=True, _post=p, page_cap_per_day=1)
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    with caplog.at_level(logging.WARNING, logger="alerts"):
        assert _run(n.send("Tepna: held", "b", cap_counted=True)) is True
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert warnings, "a held page with no board destination must leave a log line behind"
    text = warnings[-1].getMessage()
    assert "Tepna: held" in text
    assert "no board destination configured" in text
    assert "(%r)" not in text


def test_board_failures_count_each_attempt():
    # mutmut_114/130 reset the counter to 1 instead of adding, at both failure sites.
    p = _Poster(ok=False)
    n = _notifier(p)
    assert _run(n.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is False
    assert _run(n.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is False
    assert n.stats()["board_failed"] == 2

    class _RaisingPoster:
        def __init__(self):
            self.calls = 0

        async def __call__(self, url, payload, headers=None):
            self.calls += 1
            raise RuntimeError("boom")

    r = _RaisingPoster()
    m = _notifier(r)
    assert _run(m.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is False
    assert _run(m.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is False
    assert m.stats()["board_failed"] == 2


def test_board_deliveries_count_each_delivery():
    # mutmut_146 reset the counter to 1 instead of adding.
    p = _Poster()
    n = _notifier(p)
    assert _run(n.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is True
    assert _run(n.send("Tepna: y", "b", tier=alerts.TIER_BOARD)) is True
    assert n.stats()["board_delivered"] == 2


def test_counted_page_with_no_clock_date_counts_nothing():
    # mutmut_149 turned the count guard's `and` into `or`, so a page counted with no date.
    p = _Poster()
    n = _notifier(p, _today=lambda: None)
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    assert n.stats()["pages_today"] == 0


# ── the poller: board edge, page escalation, ticket ──────────────────────────────────

import capture


class _Rec:
    """A recording fake notifier with the tier surface the poller uses."""

    def __init__(self, board_ok=True, page_ok=True, with_board_url=True):
        self.enabled = True
        if with_board_url:
            self.board_url = "https://hooks.example/board/topic"
        self.sent = []
        self.kw = []  # the keyword arguments of each send, in the same order as `sent`
        self.board_ok = board_ok
        self.page_ok = page_ok

    async def send(self, title, message, **kw):
        tier = kw.get("tier", alerts.TIER_PAGE)
        self.sent.append((title, tier))
        self.kw.append(dict(kw))
        return self.board_ok if tier == alerts.TIER_BOARD else self.page_ok


def _drive(tmp_path, monkeypatch, steps, cfg_alerts, fake, names=("Ring",)):
    """Run alert_poller over scripted steps: (mono_advance, wall, recording).

    `recording` is a bool for the single-device case or a {name: bool} map for
    several devices; `names` lists the devices the poller walks.
    """
    mono = [10000.0]
    wall = [steps[0][1]]
    state = {"i": 0}

    def apply(i):
        adv, w, rec = steps[i]
        mono[0] += adv
        wall[0] = w
        if isinstance(rec, bool):
            rec = {names[0]: rec}
        for n in names:
            if rec.get(n):
                capture.STATUS["devices"][n] = {"connected": True}
                capture._LAST_DATA[n] = mono[0]
            else:
                capture.STATUS["devices"][n] = {"connected": False}
                capture._LAST_DATA.pop(n, None)

    async def fake_sleep(_s):
        i = state["i"]
        if i >= len(steps):
            capture._STOP.set()
            return
        apply(i)
        state["i"] += 1
        if state["i"] >= len(steps):
            capture._STOP.set()

    cfg = {
        "root": str(tmp_path),
        "alerts": cfg_alerts,
        "devices": [{"name": n, "address": "AA:BB:CC:DD:EE:%02X" % (0xF0 + j)} for j, n in enumerate(names)],
    }
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: mono[0])
    monkeypatch.setattr(capture._time, "time", lambda: wall[0].timestamp())
    monkeypatch.setattr(capture, "_now", lambda: wall[0])
    capture._STOP.clear()
    try:
        _run(capture.alert_poller(cfg, fake))
    finally:
        for n in names:
            capture._LAST_DATA.pop(n, None)
            capture._LAST_PULL_OK.pop(n, None)
            capture._IDLE_TIMER_NAMED.discard(n)
            capture.STATUS["devices"].pop(n, None)
        capture._STOP.clear()
    return fake


_W = dt.datetime(2026, 10, 29, 22, 0)
_BASE = {"poll_sec": 1, "offline_sec": 0, "offline_page_sec": 120}


def test_poller_pages_only_after_the_bar_then_recovers_and_can_page_again(tmp_path, monkeypatch):
    fake = _Rec()
    steps = [
        (0, _W, True),  # streaming: the night begins with this device
        (10, _W, False),  # drops: the BOARD edge fires, no page yet
        (200, _W, False),  # 200 s absent, past the 120 s bar: the PAGE fires
        (10, _W, False),  # still absent: nothing more
        (10, _W, True),  # back: the recovery goes to the board
        (10, _W, False),  # a second episode: a second board edge
        (200, _W, False),  # …and a second page
    ]
    _drive(tmp_path, monkeypatch, steps, _BASE, fake)
    assert fake.sent == [
        ("Tepna: sensor offline", alerts.TIER_BOARD),
        ("Tepna: sensor offline", alerts.TIER_PAGE),
        ("Tepna: sensor recovered", alerts.TIER_BOARD),
        ("Tepna: sensor offline", alerts.TIER_BOARD),
        ("Tepna: sensor offline", alerts.TIER_PAGE),
    ]


def test_poller_never_pages_a_device_that_did_not_stream(tmp_path, monkeypatch):
    fake = _Rec()
    steps = [(0, _W, False), (1000, _W, False), (1000, _W, False)]
    _drive(tmp_path, monkeypatch, steps, _BASE, fake)
    assert fake.sent == [("Tepna: sensor offline", alerts.TIER_BOARD)]


_CLUSTER = {"poll_sec": 1, "offline_sec": 0, "offline_page_sec": 3600}
_TRIO = ("Ring", "Strap", "Sense")


def test_poller_startup_trio_never_pages_on_the_cluster_bar(tmp_path, monkeypatch):
    # Kestrel ruling #4340: three devices down from the night start, none having
    # streamed, are "not started", not a cluster — BOARD edges only, no page,
    # even though all three went down inside 15 minutes.
    fake = _Rec()
    steps = [
        (0, _W, {n: False for n in _TRIO}),
        (10, _W, {n: False for n in _TRIO}),
        (200, _W, {n: False for n in _TRIO}),
        (200, _W, {n: False for n in _TRIO}),
    ]
    _drive(tmp_path, monkeypatch, steps, _CLUSTER, fake, names=_TRIO)
    edges = [s for s in fake.sent if s == ("Tepna: sensor offline", alerts.TIER_BOARD)]
    pages = [s for s in fake.sent if s[1] == alerts.TIER_PAGE]
    assert len(edges) == 3
    assert pages == []


def test_poller_mixed_trio_needs_three_started_devices_to_page(tmp_path, monkeypatch):
    # The discriminating case for ruling #4340: two devices streamed and stopped,
    # the third never streamed. The old cluster count (all three down inside 15
    # minutes) paged the two started devices; the rule counts started devices
    # only, so two is a pair, not a cluster — no page for anyone.
    fake = _Rec()
    steps = [
        (0, _W, {"Ring": True, "Strap": True, "Sense": False}),  # two stream, one not yet
        (10, _W, {n: False for n in _TRIO}),  # all three down: edges fire
        (200, _W, {n: False for n in _TRIO}),  # still below the duration bar
        (200, _W, {n: False for n in _TRIO}),
    ]
    _drive(tmp_path, monkeypatch, steps, _CLUSTER, fake, names=_TRIO)
    edges = [s for s in fake.sent if s == ("Tepna: sensor offline", alerts.TIER_BOARD)]
    pages = [s for s in fake.sent if s[1] == alerts.TIER_PAGE]
    assert len(edges) == 3
    assert pages == []


def test_poller_started_trio_pages_on_the_cluster_bar(tmp_path, monkeypatch):
    # The same three devices, streamed first and then all stopping inside 15
    # minutes: each earns its one PAGE on the cluster bar, far below the
    # duration bar (3600 s here, the devices are down ~30 s).
    fake = _Rec()
    steps = [
        (0, _W, {n: True for n in _TRIO}),  # all streaming: the night begins
        (10, _W, {n: False for n in _TRIO}),  # all stop: edges fire, below the bar
        (10, _W, {n: False for n in _TRIO}),  # the cluster completes: pages fire
        (10, _W, {n: False for n in _TRIO}),  # still absent: nothing more
    ]
    _drive(tmp_path, monkeypatch, steps, _CLUSTER, fake, names=_TRIO)
    edges = [s for s in fake.sent if s == ("Tepna: sensor offline", alerts.TIER_BOARD)]
    pages = [s for s in fake.sent if s == ("Tepna: sensor offline", alerts.TIER_PAGE)]
    assert len(edges) == 3
    assert len(pages) == 3


def test_poller_never_pages_outside_the_capture_window(tmp_path, monkeypatch):
    fake = _Rec()
    noon = dt.datetime(2026, 10, 29, 13, 0)
    steps = [(0, noon, True), (10, noon, False), (1000, noon, False)]
    _drive(tmp_path, monkeypatch, steps, _BASE, fake)
    assert fake.sent == [("Tepna: sensor offline", alerts.TIER_BOARD)]


def test_poller_retries_a_failed_board_edge_instead_of_latching(tmp_path, monkeypatch):
    fake = _Rec(board_ok=False)
    steps = [(0, _W, True), (10, _W, False), (10, _W, False)]
    _drive(tmp_path, monkeypatch, steps, _BASE, fake)
    edges = [s for s in fake.sent if s == ("Tepna: sensor offline", alerts.TIER_BOARD)]
    assert len(edges) == 2  # attempted on both polls: the latch follows the delivery


def test_poller_retries_a_failed_page_instead_of_latching(tmp_path, monkeypatch):
    fake = _Rec(page_ok=False)
    steps = [(0, _W, True), (10, _W, False), (200, _W, False), (10, _W, False)]
    _drive(tmp_path, monkeypatch, steps, _BASE, fake)
    pages = [s for s in fake.sent if s == ("Tepna: sensor offline", alerts.TIER_PAGE)]
    assert len(pages) == 2


def test_poller_ticket_after_three_board_nights(tmp_path, monkeypatch):
    fake = _Rec()
    steps = []
    for day in (29, 30, 31):
        w = dt.datetime(2026, 10, day, 22, 0)
        steps += [(60, w, False), (60, w, True)]  # a board night, then recovery
    _drive(tmp_path, monkeypatch, steps, _BASE, fake)
    tickets = [t for t, _ in fake.sent if t.startswith("Tepna: ticket")]
    edges = [s for s in fake.sent if s == ("Tepna: sensor offline", alerts.TIER_BOARD)]
    assert len(edges) == 3
    assert len(tickets) == 1
    third_edge = max(i for i, s in enumerate(fake.sent) if s == ("Tepna: sensor offline", alerts.TIER_BOARD))
    assert fake.sent[third_edge + 1][0].startswith("Tepna: ticket")  # right after the third edge


def test_a_failed_board_post_is_counted_on_both_ledgers():
    p = _Poster(ok=False)
    n = _notifier(p)
    assert _run(n.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is False
    st = n.stats()
    assert st["board_failed"] == 1 and st["failed"] == 1 and st["board_delivered"] == 0


def test_a_raising_board_post_is_counted_and_swallowed():
    async def boom(url, payload, headers=None):
        raise OSError("board topic unreachable")

    n = alerts.Notifier(_PAGE, enabled=True, _post=boom, board_url=_BOARD)
    assert _run(n.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is False
    assert n.stats()["board_failed"] == 1


# ── the stand-in route is counted as itself (residue 2026-11-08-a-board-fallback-to-the-phone-
# counts-as-board-delivery). `alerts.py` chooses `self.board_url or self.url` for a BOARD tier, and
# the live box has no `board_webhook_url`, so every board edge on it reaches the phone.


def test_a_board_edge_on_a_box_with_no_board_destination_is_NOT_a_board_delivery():
    """The row's defect, stated as the arithmetic a reader does. `board_delivered` answers "the
    fleet saw this". On the live box it answered that about the owner's phone."""
    p = _Poster()
    n = alerts.Notifier(_PAGE, enabled=True, _post=p)
    for i in range(3):
        assert _run(n.send(f"Tepna: {i}", "b", tier=alerts.TIER_BOARD)) is True
    st = n.stats()
    assert st["board_configured"] is False
    assert st["board_delivered"] == 0
    assert st["board_fallback_delivered"] == 3
    assert st["delivered"] == 3
    assert [u for u, _ in p.calls] == [_PAGE, _PAGE, _PAGE]


def test_a_real_board_destination_keeps_counting_on_the_board_ledger():
    """The control. Without it the test above also passes with both counters stuck at 0."""
    p = _Poster()
    n = _notifier(p)
    assert _run(n.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is True
    assert _run(n.send("Tepna: y", "b", tier=alerts.TIER_BOARD)) is True
    st = n.stats()
    assert st["board_delivered"] == 2
    assert st["board_fallback_failed"] == 0
    assert st["board_fallback_delivered"] == 0


def test_a_stand_in_route_that_is_rejected_counts_on_the_stand_in_ledger():
    """A board edge that reached NOBODY must still leave a board-tier trace, which is why the pair
    is symmetric. A second rejection must ADD: one cannot tell `+= 1` from `= 1`."""
    p = _Poster(ok=False)
    n = alerts.Notifier(_PAGE, enabled=True, _post=p)
    assert _run(n.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is False
    assert _run(n.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is False
    st = n.stats()
    assert st["board_failed"] == 0
    assert st["board_fallback_failed"] == 2
    assert st["failed"] == 2


def test_a_stand_in_route_that_raises_counts_on_the_stand_in_ledger():
    async def boom(url, payload, headers=None):
        raise OSError("phone topic unreachable")

    n = alerts.Notifier(_PAGE, enabled=True, _post=boom)
    assert _run(n.send("Tepna: x", "b", tier=alerts.TIER_BOARD)) is False
    assert _run(n.send("Tepna: y", "b", tier=alerts.TIER_BOARD)) is False
    st = n.stats()
    assert st["board_failed"] == 0
    assert st["board_fallback_failed"] == 2


def test_the_delivery_LINE_names_the_route_it_reached(caplog):
    """The second half of the row: the log named no destination, so the journal could not settle it
    afterwards either. Three routes, three sentences, asserted on the real log record."""
    import logging

    caplog.set_level(logging.INFO, logger="tepna-capture")

    p = _Poster()
    board = _notifier(p)
    assert _run(board.send("Tepna: real", "b", tier=alerts.TIER_BOARD)) is True
    assert _run(board.send("Tepna: page", "b")) is True
    stand_in = alerts.Notifier(_PAGE, enabled=True, _post=p)
    assert _run(stand_in.send("Tepna: stand-in", "b", tier=alerts.TIER_BOARD)) is True

    lines = [r.getMessage() for r in caplog.records if "delivered to" in r.getMessage()]
    assert len(lines) == 3, lines
    assert "'Tepna: real' delivered to the board" in lines[0]
    assert "'Tepna: page' delivered to the phone" in lines[1]
    assert "standing in for the board" in lines[2]


def test_the_route_name_answers_for_all_three_routes():
    """The helper on its own. \u26a0\ufe0f THIS IS NOT ENOUGH, and the mutation gate said so: calling the
    helper directly is exactly the wiring the failure arms lacked. The test below reads the lines."""
    assert alerts._route_name(alerts.TIER_BOARD, False) == "the board"
    assert alerts._route_name(alerts.TIER_BOARD, True) == "the phone topic, standing in for the board"
    assert alerts._route_name(alerts.TIER_PAGE, False) == "the phone"
    # A PAGE tier has no stand-in route to take, so the flag cannot change its answer.
    assert alerts._route_name(alerts.TIER_PAGE, True) == "the phone"


def test_a_FAILURE_line_names_the_route_too(caplog):
    """A rejection that names no destination is the same blind spot one arm over, and there are TWO
    failure arms. The mutation gate replaced `route` with `None` in both and the suite stayed green,
    because the test above read the helper and nothing read the LINE."""
    import logging

    caplog.set_level(logging.WARNING, logger="tepna-capture")

    rejected = _Poster(ok=False)
    assert _run(_notifier(rejected).send("Tepna: a", "b", tier=alerts.TIER_BOARD)) is False
    stand_in = alerts.Notifier(_PAGE, enabled=True, _post=rejected)
    assert _run(stand_in.send("Tepna: b", "b", tier=alerts.TIER_BOARD)) is False

    async def boom(url, payload, headers=None):
        raise OSError("unreachable")

    assert _run(_notifier(boom).send("Tepna: c", "b", tier=alerts.TIER_BOARD)) is False
    assert _run(alerts.Notifier(_PAGE, enabled=True, _post=boom).send("Tepna: d", "b")) is False

    lines = [r.getMessage() for r in caplog.records]
    assert "'Tepna: a' rejected by the board (non-2xx)" in lines[0], lines
    assert "'Tepna: b' rejected by the phone topic, standing in for the board" in lines[1], lines
    assert "'Tepna: c' not delivered to the board:" in lines[2], lines
    assert "'Tepna: d' not delivered to the phone:" in lines[3], lines
    assert "None" not in lines[0] and "None" not in lines[1]


def test_the_capped_page_rerouted_to_a_REAL_board_counts_as_a_board_delivery():
    """The cap reroutes through `send` again with a board tier, and that box HAS a board
    destination, because `board_ready` guards the reroute. So the stand-in ledger stays empty."""
    p = _Poster()
    n = _notifier(p)
    for i in range(alerts.PAGE_CAP_PER_DAY):
        assert _run(n.send(f"Tepna: p{i}", "b", cap_counted=True)) is True
    assert _run(n.send("Tepna: held", "b", cap_counted=True)) is True
    st = n.stats()
    assert st["cap_held"] == 1
    assert st["board_delivered"] == 1
    assert st["board_fallback_delivered"] == 0


# ── AN UNDECIDED TIER IS A FACT THE CALLER ACTS ON ──────────────────────────────────────────────
# Row `2026-11-08-the-page-cap-overrides-the-classifier-failure-direction`. A thrown classifier
# answers PAGE so the alert is not hidden, and the caller used to spend the daily page cap on it.
# At the cap, with no board destination configured, `send` writes one WARNING line and answers
# True, so the poller latched the episode as paged and the alert never buzzed.


def test_classify_absence_reports_undecided_when_the_classifier_throws(caplog):
    """The tier it answers is the ruling's failure direction, not a measurement, and the second
    member says so. The log line stays where it was."""
    import logging

    caplog.set_level(logging.WARNING)
    assert alerts.classify_absence("soon", in_window=True, streamed=True, cluster_size=1) == (
        alerts.TIER_PAGE,
        True,
    )
    assert "alert tier classification failed" in caplog.records[-1].getMessage()


def test_poller_pages_an_undecided_tier_exempt_from_the_daily_cap(tmp_path, monkeypatch, caplog):
    """🔴 THIS IS THE DEFECT. The classifier throws, so the poller sends the page `cap_exempt`, and
    the cap cannot answer True without delivering it. The WARNING names the undecided tier."""
    import logging

    def boom(*a, **k):
        raise TypeError("the tier could not be decided")

    monkeypatch.setattr(alerts, "absence_tier", boom)
    caplog.set_level(logging.WARNING)
    fake = _Rec()
    steps = [(0, _W, True), (10, _W, False)]
    _drive(tmp_path, monkeypatch, steps, _BASE, fake)
    pages = [(t, kw) for (t, tier), kw in zip(fake.sent, fake.kw) if tier == alerts.TIER_PAGE]
    assert pages, fake.sent
    assert all(kw["cap_exempt"] is True for _, kw in pages), pages
    assert any("its tier is UNDECIDED" in r.getMessage() for r in caplog.records), [
        r.getMessage() for r in caplog.records
    ]


def test_poller_pages_a_decided_tier_inside_the_daily_cap(tmp_path, monkeypatch, caplog):
    """CONTROL. A tier the classifier decided keeps spending the cap, and keeps its own log line."""
    import logging

    caplog.set_level(logging.WARNING)
    fake = _Rec()
    steps = [(0, _W, True), (10, _W, False), (200, _W, False)]
    _drive(tmp_path, monkeypatch, steps, _BASE, fake)
    pages = [(t, kw) for (t, tier), kw in zip(fake.sent, fake.kw) if tier == alerts.TIER_PAGE]
    assert pages, fake.sent
    assert all(kw["cap_exempt"] is False for _, kw in pages), pages
    assert any("the absence has earned a page" in r.getMessage() for r in caplog.records)
    assert not any("UNDECIDED" in r.getMessage() for r in caplog.records)


# ── §∅: the in-memory ledger after a restart ─────────────────────────────────────────
# Row `2026-11-08-a-restart-resets-the-page-count-and-board-streak-silently`. The limit stood
# disclosed in a docstring. The EVENT disclosed nothing: a reader of `pages_today: 0` or of a
# one-day streak could not tell a measured zero from a ledger a restart had just emptied.


def test_pages_today_does_not_cover_the_day_this_process_started():
    """🔴 THIS IS THE DEFECT. 0 pages on the start day is a FLOOR, not a measured zero: an earlier
    process may have paged before the restart, and nothing told a reader which it was."""
    p = _Poster()
    n = alerts.Notifier(_PAGE, enabled=True, _post=p, page_cap_per_day=3, _today=lambda: _D1)
    st = n.stats()
    assert st["pages_today"] == 0
    assert st["pages_today_covers_day"] is False


def test_pages_today_covers_a_whole_day_spent_under_one_process():
    """CONTROL. A whole day has passed under this process, so 0 is a measured zero."""
    p = _Poster()
    today = [_D1]
    n = alerts.Notifier(_PAGE, enabled=True, _post=p, page_cap_per_day=3, _today=lambda: today[0])
    today[0] = _D2
    st = n.stats()
    assert st["pages_today"] == 0
    assert st["pages_today_covers_day"] is True


def test_a_day_before_the_start_day_is_also_a_floor():
    """A backwards clock step asks about a day this process cannot have counted at all."""
    p = _Poster()
    today = [_D2]
    n = alerts.Notifier(_PAGE, enabled=True, _post=p, page_cap_per_day=3, _today=lambda: today[0])
    today[0] = _D1
    assert n.stats()["pages_today_covers_day"] is False


def test_the_first_counted_page_on_the_start_day_names_the_floor_once(caplog):
    """The disclosure lands where the number first decides something: one line per day, at the
    first counted page, naming the direction the cap can err in."""
    caplog.set_level(logging.INFO)
    p = _Poster()
    n = alerts.Notifier(_PAGE, enabled=True, _post=p, page_cap_per_day=3, _today=lambda: _D1)
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    floors = [r for r in caplog.records if "counted from a ledger this process started" in r.getMessage()]
    assert len(floors) == 1, [r.getMessage() for r in caplog.records]
    assert "page 1 of 3" in floors[0].getMessage()
    assert "never fewer" in floors[0].getMessage()


def test_a_counted_page_on_a_later_day_names_no_floor(caplog):
    caplog.set_level(logging.INFO)
    p = _Poster()
    today = [_D1]
    n = alerts.Notifier(_PAGE, enabled=True, _post=p, page_cap_per_day=3, _today=lambda: today[0])
    today[0] = _D2
    assert _run(n.send("Tepna: a", "b", cap_counted=True)) is True
    assert not [r for r in caplog.records if "counted from a ledger this process started" in r.getMessage()]
    assert n.stats()["pages_today"] == 1


def test_a_short_streak_reaching_the_earliest_day_seen_names_the_floor(caplog):
    """🔴 THE OTHER HALF. Two board days, a restart, then one more day: the run reads 1 and fires
    nothing. It cannot honestly fire on days it never saw, so it names the floor instead."""
    caplog.set_level(logging.WARNING)
    s = alerts.BoardStreak(days=3)
    assert s.note("Ring", _D3) is False
    floors = [r for r in caplog.records if "the earliest day this process saw" in r.getMessage()]
    assert len(floors) == 1, [r.getMessage() for r in caplog.records]
    assert "runs 1 day(s)" in floors[0].getMessage()
    assert _D3.isoformat() in floors[0].getMessage()
    assert "for Ring runs" in floors[0].getMessage()  # the line names the device the floor is about


def test_the_floor_line_is_one_per_run_not_one_per_note(caplog):
    caplog.set_level(logging.WARNING)
    s = alerts.BoardStreak(days=3)
    assert s.note("Ring", _D1) is False
    assert s.note("Ring", _D1) is False
    assert s.note("Ring", _D2) is False
    floors = [r for r in caplog.records if "the earliest day this process saw" in r.getMessage()]
    assert len(floors) == 1, [r.getMessage() for r in caplog.records]
    assert "runs 1 day(s)" in floors[0].getMessage()


def test_an_earlier_day_noted_later_names_the_new_floor(caplog):
    """Out of order: the run now starts at the earliest day seen, so the floor is named for that
    new start. The earliest day is what bounds the unknown, never the latest."""
    caplog.set_level(logging.WARNING)
    s = alerts.BoardStreak(days=3)
    assert s.note("Ring", _D2) is False
    caplog.clear()
    assert s.note("Ring", _D1) is False
    floors = [r for r in caplog.records if "the earliest day this process saw" in r.getMessage()]
    assert len(floors) == 1, [r.getMessage() for r in caplog.records]
    assert "runs 2 day(s)" in floors[0].getMessage()
    assert _D1.isoformat() in floors[0].getMessage()


def test_a_run_after_a_gap_names_no_floor(caplog):
    """CONTROL. This process saw the day before the run start and it was no board day, so the run
    is a measured length."""
    caplog.set_level(logging.WARNING)
    s = alerts.BoardStreak(days=3)
    assert s.note("Ring", _D1) is False
    caplog.clear()
    assert s.note("Ring", _D4) is False
    assert not [r for r in caplog.records if "the earliest day this process saw" in r.getMessage()]


def test_a_refired_day_names_no_floor(caplog):
    """The floor test only ever sees a run at or above `days` once that run has fired, so it must
    read strictly below `days`. A complete streak names no floor."""
    s = alerts.BoardStreak(days=1)
    assert s.note("Ring", _D1) is True
    caplog.set_level(logging.WARNING)
    assert s.note("Ring", _D1) is False
    assert not [r for r in caplog.records if "the earliest day this process saw" in r.getMessage()]


def test_a_clock_that_gives_no_date_leaves_the_count_a_floor():
    """The clock itself can refuse a date. An unknown span is not a covered one (§∅)."""
    p = _Poster()
    n = alerts.Notifier(_PAGE, enabled=True, _post=p, page_cap_per_day=3, _today=lambda: None)
    st = n.stats()
    assert st["pages_today"] == 0
    assert st["pages_today_covers_day"] is False


def test_a_clock_absent_only_at_start_leaves_the_count_a_floor():
    """Either side absent is enough: this process cannot say when it started, so it cannot say
    that a later day's count covers the whole day."""
    p = _Poster()
    today = [None]
    n = alerts.Notifier(_PAGE, enabled=True, _post=p, page_cap_per_day=3, _today=lambda: today[0])
    today[0] = _D2
    assert n.stats()["pages_today_covers_day"] is False
