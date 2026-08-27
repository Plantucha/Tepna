# tepna-capture — tests/test_cpap_spool_caller.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Every assertion here was verified by RE-APPLYING the defect it names (the round-2 discipline): the
# rule was reverted in the module, the test was observed to fail, and the rule restored. A test
# written from reading the code passes while catching nothing.

import cpap_spool_caller as C


# ── window_hours ─────────────────────────────────────────────────────────────
def test_window_hours_covers_exactly_the_half_open_interval():
    assert C.window_hours(13, 2) == {13, 14}, "[13,15) is 13 and 14 — 15 belongs to the next window"


def test_window_hours_wraps_midnight_without_clipping():
    # The scar this replaces: `at_hour <= h < at_hour + window_h` silently CLIPPED at 23:59, so a
    # 23:00 window got one hour instead of two.
    assert C.window_hours(23, 2) == {23, 0}


def test_window_hours_of_a_zero_window_is_empty_not_one_hour():
    assert C.window_hours(10, 0) == set()


def test_window_hours_clamps_a_negative_window_rather_than_reversing_it():
    assert C.window_hours(10, -5) == set()


def test_window_hours_saturates_at_the_whole_day():
    assert C.window_hours(10, 99) == set(range(24)), "a >24 h window is the day, never a repeat"


# ── harvest_conflict ─────────────────────────────────────────────────────────
def test_the_shipped_defaults_do_not_conflict():
    assert C.harvest_conflict(C.SPOOL_AT_HOUR_DEFAULT, C.SPOOL_WINDOW_H_DEFAULT, 13, 2) == []


def test_conflict_names_the_offending_hours_not_merely_true():
    assert C.harvest_conflict(12, 3, 13, 2) == [13, 14]


def test_conflict_is_detected_across_the_midnight_wrap():
    # A 23:00 spool window and a 00:00 harvest overlap at hour 0 — the case interval arithmetic misses.
    assert C.harvest_conflict(23, 2, 0, 2) == [0]


# ── spool_arming ─────────────────────────────────────────────────────────────
def test_absent_flag_defaults_off_and_says_it_never_inherits():
    a = C.spool_arming({})
    assert a["armed"] is False
    assert "never inherits" in a["why"], "an absent flag must not read like an explicit False"


def test_an_explicit_false_is_reported_differently_from_an_absent_key():
    a = C.spool_arming({"cpap": {"spool_pull": {"enabled": False}}})
    assert a["armed"] is False and a["why"] == "cpap.spool_pull.enabled=False"


def test_enabled_arms_with_the_documented_defaults():
    a = C.spool_arming({"cpap": {"spool_pull": {"enabled": True}}})
    assert a == {"armed": True, "why": "", "at_hour": 10, "window_h": 2}


def test_an_out_of_range_hour_refuses_and_names_the_value():
    a = C.spool_arming({"cpap": {"spool_pull": {"enabled": True, "at_hour": 24}}})
    assert a["armed"] is False and "24" in a["why"]


def test_a_window_that_would_never_open_refuses():
    a = C.spool_arming({"cpap": {"spool_pull": {"enabled": True, "window_h": 0}}})
    assert a["armed"] is False and "never open" in a["why"]


def test_a_window_overlapping_the_ENABLED_harvest_refuses_and_names_the_hour():
    a = C.spool_arming({"cpap": {"enabled": True, "at_hour": 13,
                                 "spool_pull": {"enabled": True, "at_hour": 13}}})
    assert a["armed"] is False
    assert "13" in a["why"] and "2.4 GHz" in a["why"], "the refusal must say why overlap matters"


def test_the_same_overlap_is_ALLOWED_when_the_harvest_is_disabled():
    # A disabled harvest's at_hour is a dormant number; refusing against it would block a legitimate
    # config for a job that never runs.
    a = C.spool_arming({"cpap": {"enabled": False, "at_hour": 13,
                                 "spool_pull": {"enabled": True, "at_hour": 13}}})
    assert a["armed"] is True


def test_a_non_overlapping_window_arms_beside_an_enabled_harvest():
    a = C.spool_arming({"cpap": {"enabled": True, "at_hour": 13,
                                 "spool_pull": {"enabled": True, "at_hour": 10}}})
    assert a["armed"] is True and a["at_hour"] == 10


# ── pull_blocked ─────────────────────────────────────────────────────────────
def test_clear_when_nothing_is_in_the_way():
    assert C.pull_blocked(recovering=False, streaming=[], cpap_capturing=False) is None


def test_recovery_outranks_everything_else():
    why = C.pull_blocked(recovering=True, streaming=["H10"], cpap_capturing=True)
    assert why == "adapter mid-recovery"


def test_the_live_controller_outranks_a_merely_nearby_wearable():
    why = C.pull_blocked(recovering=False, streaming=["H10"], cpap_capturing=True)
    assert "one connection" in why, "the AS11's single socket is the tighter constraint"


def test_a_streaming_wearable_blocks_and_the_reason_NAMES_it():
    why = C.pull_blocked(recovering=False, streaming=["Polar H10"], cpap_capturing=False)
    assert why == "streaming: Polar H10"


def test_the_streaming_reason_is_bounded_to_three_names():
    why = C.pull_blocked(recovering=False, streaming=list("abcdef"), cpap_capturing=False)
    assert why == "streaming: a, b, c", "an unbounded list would flood the journal line"


# ── spool_pull_cycle ─────────────────────────────────────────────────────────
import asyncio  # noqa: E402

import pytest  # noqa: E402

CREDS = {"masterPairKey": "aa" * 32, "clientId": "tepna"}


def _run(coro):
    return asyncio.run(coro)


class _Link:
    """A scripted transport. Records whether it was disconnected — the leak assertion's instrument."""

    def __init__(self, *, bad_tuple=False):
        self.disconnected = 0
        self.bad_tuple = bad_tuple

    async def __call__(self):
        if self.bad_tuple:
            return ("write", "recv")           # malformed: two members, not three
        return ("write", "recv", self._disc)

    async def _disc(self):
        self.disconnected += 1


async def _establish(_key, _cid, _w, _r):
    return b"k" * 32


def _cipher(_key):
    return ("seal", "unseal")


def _cycle(link, **kw):
    kw.setdefault("sync", _sync_ok)
    return C.spool_pull_cycle(connect=link, creds=CREDS, root="/tmp/x",
                              epoch_start=C.SPOOL_EPOCH_START_DEFAULT,
                              establish=_establish, cipher_factory=_cipher,
                              pull_round=_never_called, **kw)


async def _sync_ok(pull_round, root, **kw):
    return {"rounds_committed": 1, "cursor": kw["epoch_start"], "root": root}


async def _never_called(*_a, **_k):  # pragma: no cover — bound, never driven by these tests
    raise AssertionError("pull_round must be reached only through sync's injected seam")


def test_a_cycle_returns_syncs_summary_and_always_disconnects():
    link = _Link()
    out = _run(_cycle(link))
    assert out["rounds_committed"] == 1
    assert link.disconnected == 1, "the link must close on the success path too"


def test_the_link_is_closed_even_when_sync_raises():
    link = _Link()

    async def _boom(*_a, **_k):
        raise RuntimeError("device went away mid-round")

    with pytest.raises(RuntimeError):
        _run(_cycle(link, sync=_boom))
    assert link.disconnected == 1, "a raise mid-sync must not leak the one AS11 socket"


def test_a_malformed_connect_tuple_does_not_raise_NameError_from_the_finally():
    # The scar: `disconnect` bound after the unpack would raise NameError in the finally and BURY
    # the real ValueError. The test asserts which error surfaces, not merely that one does.
    link = _Link(bad_tuple=True)
    with pytest.raises(ValueError):
        _run(_cycle(link))
    assert link.disconnected == 0, "nothing to close — but the real error must survive"


def test_the_epoch_start_floor_is_recent_not_epochal():
    # A 1970 floor would make the FIRST attended pull an unbounded backfill of the whole device.
    assert C.SPOOL_EPOCH_START_DEFAULT.startswith("2026-"), "run one is specified as bounded"


def test_the_round_closure_hands_pull_spool_round_its_arguments_IN_ORDER():
    # `as11_pull.pull_spool_round(write, recv_frame, seal, unseal, spool_type, from_dt)` — a
    # positional contract, so a transposed pair (seal/unseal, or spool_type/from_dt) type-checks,
    # runs, and fails only against real hardware. Pin it here where it costs nothing.
    seen = {}

    async def _capture_round(*args):
        seen["args"] = args
        return (b"body", False, None)

    async def _sync_drives_the_seam(pull_round, _root, **kw):
        return {"body": await pull_round(kw["spool_type"], kw["epoch_start"])}

    link = _Link()
    out = _run(C.spool_pull_cycle(
        connect=link, creds=CREDS, root="/tmp/x", epoch_start="2026-08-01T00:00:00.000Z",
        spool_type="Summary", establish=_establish, cipher_factory=_cipher,
        pull_round=_capture_round, sync=_sync_drives_the_seam))

    assert out["body"] == (b"body", False, None)
    assert seen["args"] == ("write", "recv", "seal", "unseal",
                            "Summary", "2026-08-01T00:00:00.000Z")
