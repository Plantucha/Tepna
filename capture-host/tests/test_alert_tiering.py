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
    # a non-numeric duration raises inside the comparison and the wrapper answers PAGE.
    assert alerts.classify_absence("soon", in_window=True, streamed=True, cluster_size=1) == alerts.TIER_PAGE


def test_classify_absence_matches_tier_when_it_can_classify():
    assert alerts.classify_absence(60, in_window=True, streamed=True, cluster_size=1) == alerts.TIER_BOARD
    assert alerts.classify_absence(1800, in_window=True, streamed=True, cluster_size=1) == alerts.TIER_PAGE


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
    p = _Poster()
    n = alerts.Notifier(_PAGE, enabled=True, _post=p)
    assert n.board_ready is False
    assert _run(n.send("Tepna: x", "body", tier=alerts.TIER_BOARD)) is True
    assert [u for u, _ in p.calls] == [_PAGE]
    assert n.stats()["board_delivered"] == 1


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


# ── the poller: board edge, page escalation, ticket ──────────────────────────────────

import capture


class _Rec:
    """A recording fake notifier with the tier surface the poller uses."""

    def __init__(self, board_ok=True, page_ok=True, with_board_url=True):
        self.enabled = True
        if with_board_url:
            self.board_url = "https://hooks.example/board/topic"
        self.sent = []
        self.board_ok = board_ok
        self.page_ok = page_ok

    async def send(self, title, message, **kw):
        tier = kw.get("tier", alerts.TIER_PAGE)
        self.sent.append((title, tier))
        return self.board_ok if tier == alerts.TIER_BOARD else self.page_ok


def _drive(tmp_path, monkeypatch, steps, cfg_alerts, fake):
    """Run alert_poller over scripted steps: (mono_advance, wall, recording)."""
    mono = [10000.0]
    wall = [steps[0][1]]
    state = {"i": 0}

    def apply(i):
        adv, w, rec = steps[i]
        mono[0] += adv
        wall[0] = w
        if rec:
            capture.STATUS["devices"]["Ring"] = {"connected": True}
            capture._LAST_DATA["Ring"] = mono[0]
        else:
            capture.STATUS["devices"]["Ring"] = {"connected": False}
            capture._LAST_DATA.pop("Ring", None)

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
        "devices": [{"name": "Ring", "address": "AA:BB:CC:DD:EE:FF"}],
    }
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(capture._time, "monotonic", lambda: mono[0])
    monkeypatch.setattr(capture._time, "time", lambda: wall[0].timestamp())
    monkeypatch.setattr(capture, "_now", lambda: wall[0])
    capture._STOP.clear()
    try:
        _run(capture.alert_poller(cfg, fake))
    finally:
        capture._LAST_DATA.pop("Ring", None)
        capture._LAST_PULL_OK.pop("Ring", None)
        capture._IDLE_TIMER_NAMED.discard("Ring")
        capture.STATUS["devices"].pop("Ring", None)
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
