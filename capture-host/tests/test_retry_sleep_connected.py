# tepna-capture — tests/test_retry_sleep_connected.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Residue `2026-09-05-retry-sleep-stale-connected`. A runner waiting to retry its device published
# `connected: true` beside a `retry` block — two claims that cannot both be true. Only the `backoff`
# path read False, and only incidentally: its `except` handler happened to stamp it. `charging`,
# `stalled` and `not_worn` published a live link for the whole wait.
#
# ⚠️ WHY THE STAMP IS IN `_retry_sleep` AND NOT AT THE THREE STALL SITES. Measured on the tree, not
# assumed: ALL EIGHT production call sites sit at indent 16 under `if not _STOP.is_set():`, which is
# OUTSIDE the `try:`/`async with _connect(...)` in all three runners. Every caller has therefore
# already left its connection context, so the invariant is a property of the FUNCTION — a runner
# waiting to retry is by definition not connected — not of three particular branches. Three copied
# stamps would leave `charging` and `not_worn` lying by the identical mechanism two lines away, and
# would not protect a ninth call site.
#
# ⚠️ AND IT COSTS NO LINK GENERATION. The row deferred this in #2248 believing an earlier `False`
# would spend a `_LINK_EPOCH` generation on a wait that might end in the same link resuming. Measured
# both ways below: the epoch is IDENTICAL, because the next loop iteration already stamps
# `connected=False` unconditionally at its top before every connect attempt. The True→False edge
# happens either way; exactly one False→True edge follows either way.

import asyncio

import pytest

import capture


def _fresh(name="R"):
    """A known daemon state. The event clears are NOT boilerplate: `_RECOVER` and `_OXYII_PAUSE` gate
    the runners' inner poll loops, so either one left set by a peer test makes a runner spin in its
    outer idle gate and never reach `_retry_sleep` at all — the plant then observes NOTHING and, but
    for the `assert stalls` guard, would have read as a pass. Reproduced in isolation by planting each
    event: both yield exactly the full-suite signature, `sleeps=400 waits_seen=0`."""
    capture.STATUS["devices"].clear()
    capture._LINK_EPOCH.clear()
    return name


# ── the unit: every `why`, not just the stall ─────────────────────────────────────────────────────

def test_every_retry_reason_publishes_a_link_that_is_DOWN(monkeypatch):
    """All four `why` values reach this wait from outside the connection context, so all four must
    publish `connected=False`. `backoff` already read False by accident of its `except` handler; the
    other three did not."""
    seen = {}
    real = asyncio.sleep

    async def spy(_secs):
        seen[spy.why] = dict(capture.STATUS["devices"]["R"])
        await real(0)

    monkeypatch.setattr(capture.asyncio, "sleep", spy)
    for why in ("charging", "stalled", "not_worn", "backoff"):
        _fresh()
        capture._set("R", connected=True)          # a live link, as the runner had a moment ago
        spy.why = why
        asyncio.run(capture._retry_sleep("R", 30.0, why, 1))
        assert seen[why]["connected"] is False, f"{why} published a live link while waiting to retry"
        assert seen[why]["retry"]["why"] == why, f"{why} lost its retry block"


def test_the_wait_and_the_down_link_are_published_TOGETHER(monkeypatch):
    """THE PLANT'S SHAPE. The defect was not a missing field, it was two fields disagreeing — so the
    assertion has to read them in the SAME snapshot. A test that checked `connected` after the wait
    would pass on the broken code too, because the next loop iteration stamps False anyway."""
    _fresh()
    capture._set("R", connected=True)
    snap = {}
    real = asyncio.sleep

    async def spy(_secs):
        snap.update(capture.STATUS["devices"]["R"])
        await real(0)

    monkeypatch.setattr(capture.asyncio, "sleep", spy)
    asyncio.run(capture._retry_sleep("R", capture._STALL_RECONNECT_S, "stalled", 1))
    assert snap["retry"] is not None and snap["connected"] is False, \
        f"a retry block beside connected={snap.get('connected')} is the lie this closes"


def test_the_wait_does_not_fabricate_a_link_on_the_way_out(monkeypatch):
    """`finally` clears the retry block. It must not also restore `connected` — the runner is still
    disconnected when the wait ends; the next connect is what earns True back."""
    _fresh()
    capture._set("R", connected=True)
    real = asyncio.sleep                      # bind BEFORE patching: capture.asyncio IS the module,
    monkeypatch.setattr(capture.asyncio, "sleep", lambda _s: real(0))   # so the stub would call itself
    asyncio.run(capture._retry_sleep("R", 1.0, "stalled", 1))
    d = capture.STATUS["devices"]["R"]
    assert d["retry"] is None and d["connected"] is False


# ── the paired opposite ───────────────────────────────────────────────────────────────────────────

def test_a_runner_that_never_retries_is_never_marked_DOWN(monkeypatch):
    """PAIRED OPPOSITE. The stamp must live on the retry path and nowhere else: a device that is
    streaming normally never calls `_retry_sleep`, so it can never acquire a spurious `connected:
    False`. Without this, `connected=False` sprayed anywhere in the poll loop would satisfy every
    assertion above while breaking the live card."""
    _fresh()
    writes = []
    real_set = capture._set

    def spy_set(name, **kv):
        if "connected" in kv:
            writes.append(bool(kv["connected"]))
        return real_set(name, **kv)

    monkeypatch.setattr(capture, "_set", spy_set)
    capture._set("R", connected=False, address="X", last_error=None)   # loop top
    capture._set("R", connected=True)                                  # connected, and it stays up
    for _ in range(20):                                                # a healthy poll loop
        capture._set("R", rssi=-60, battery=80)
    assert writes == [False, True], f"a streaming device acquired a spurious link write: {writes}"
    assert capture.STATUS["devices"]["R"]["connected"] is True


# ── the epoch: a regression guard, and NOT a discriminator ────────────────────────────────────────

def test_a_stall_and_reconnect_still_spends_exactly_ONE_link_generation():
    """⚠️ THIS TEST CANNOT TELL THE FIX FROM ITS ABSENCE, and that is worth stating rather than
    leaving for the next reader to discover. It passes identically before and after, because the
    generation was ALREADY spent by the next iteration's loop-top `connected=False`. It is kept as a
    regression guard on `_LINK_EPOCH` — which feeds `link_distress_scan`'s reconnect RATE, where a
    double-count would manufacture radio distress — not as evidence that the fix works. The evidence
    is the mid-wait snapshot above."""
    _fresh()
    capture._set("R", connected=False, address="X", last_error=None)   # iteration 1, loop top
    capture._set("R", connected=True)                                  # connected
    capture._set("R", connected=False)                                 # the stall: link dropped
    capture._set("R", connected=False, address="X", last_error=None)   # iteration 2, loop top
    capture._set("R", connected=True)                                  # reconnected
    assert capture._LINK_EPOCH["R"] == 2, "a stall must cost one generation, not two"


def test_a_repeated_down_stamp_is_a_noop_for_the_epoch():
    """The mechanism the test above relies on: `_set` counts False→True edges only, so stamping False
    twice — which is exactly what the wait plus the next loop top now do — cannot inflate the count."""
    _fresh()
    capture._set("R", connected=True)
    before = capture._LINK_EPOCH["R"]
    for _ in range(5):
        capture._set("R", connected=False)
    capture._set("R", connected=True)
    assert capture._LINK_EPOCH["R"] == before + 1


# ── the three runners, one plant each ─────────────────────────────────────────────────────────────
# The unit tests above prove `_retry_sleep` stamps the link down. These prove each runner actually
# ROUTES its stall through that function and that nothing downstream re-stamps `connected` back to
# True while the wait is in flight — which a single site standing in for three could not show.

def _snap_stall_waits(monkeypatch, name, cap=400):
    """Snapshot the device's STATUS at every wait that carries a `retry` block, then stop AS SOON AS a
    stall wait has been seen.

    ⚠️ The stop condition is deliberately the EVENT, not a fixed sleep budget, and that is a bug fix
    rather than a style choice. Budgeting `n` sleeps makes the plant depend on how many UNRELATED poll
    sleeps a runner happens to take before it stalls — which module-global state another test can move
    (`_STREAM_STALL_S` is assigned by the settings loader, so monkeypatch cannot restore it). Measured:
    the run_viatom plant passed alone and in a two-file run, and recorded ZERO waits in the full 6480-
    test suite, where the budget was spent before the stall ever fired. A plant that silently observes
    nothing is the failure mode this whole unit exists to close, so it must not depend on ordering."""
    class _Snaps(list):
        """A list that also carries the sleep count, so a vacuous run can NAME why it saw nothing."""
        calls: dict

    snaps = _Snaps()
    calls = {"n": 0}

    async def spy(_secs):
        st = capture.STATUS["devices"].get(name, {})
        if st.get("retry"):
            snaps.append(dict(st))
        calls["n"] += 1
        if any((s.get("retry") or {}).get("why") == "stalled" for s in snaps) or calls["n"] >= cap:
            capture._STOP.set()

    monkeypatch.setattr(capture.asyncio, "sleep", spy)
    snaps.calls = calls
    return snaps


def _assert_stalled_wait_is_honest(snaps, runner):
    stalls = [s for s in snaps if (s.get("retry") or {}).get("why") == "stalled"]
    assert stalls, (
        f"{runner} never took a stall wait — the plant did not exercise the path. "
        f"sleeps={getattr(snaps, 'calls', {}).get('n')} waits_seen={len(snaps)} "
        f"_STREAM_STALL_S={capture._STREAM_STALL_S} — a leaked global is the usual cause, so the "
        f"message names it rather than leaving the next reader to re-derive it")
    for s in stalls:
        assert s["connected"] is False, (
            f"{runner} published connected={s['connected']} beside retry={s['retry']} — the two "
            f"claims this closes cannot both be true")


@pytest.mark.sets_capture_events
def test_run_polar_publishes_a_DOWN_link_while_it_waits_out_a_stall(tmp_path, monkeypatch):
    import test_capture_runners as T
    _fresh("H10")
    T._polar_common(monkeypatch)
    c = T.FlexPolarClient(data_frames=[], start_status=0x00)        # ACKed, then total silence
    T._inject_connect(monkeypatch, c)
    monkeypatch.setattr(capture, "_STREAM_STALL_S", 90.0)   # pinned: the settings loader assigns it
    clock = {"t": 0.0}                                       # globally, so a peer test can leak a value
    monkeypatch.setattr(capture._time, "monotonic",
                        lambda: clock.__setitem__("t", clock["t"] + 50.0) or clock["t"])
    snaps = _snap_stall_waits(monkeypatch, "H10")
    T._run(capture.run_polar(T._pdev(), str(tmp_path)))
    _assert_stalled_wait_is_honest(snaps, "run_polar")


@pytest.mark.sets_capture_events
def test_run_viatom_publishes_a_DOWN_link_while_it_waits_out_a_stall(tmp_path, monkeypatch):
    import test_capture_runners as T
    _fresh("Ring")

    async def bonded(*a, **k):
        return True

    monkeypatch.setattr(capture.bonding, "ensure_bonded", bonded)
    c = T.FakeGattClient()
    c.services = [T._ViatomService()]                               # no on_live → never sends a packet
    T._inject_connect(monkeypatch, c)
    monkeypatch.setattr(capture, "_STREAM_STALL_S", 90.0)   # pinned: the settings loader assigns it
    clock = {"t": 0.0}                                       # globally, so a peer test can leak a value
    monkeypatch.setattr(capture._time, "monotonic",
                        lambda: clock.__setitem__("t", clock["t"] + 50.0) or clock["t"])
    snaps = _snap_stall_waits(monkeypatch, "Ring")
    T._run(capture.run_viatom(T._viatom_dev(), str(tmp_path)))
    _assert_stalled_wait_is_honest(snaps, "run_viatom")


@pytest.mark.sets_capture_events
def test_run_oxyii_publishes_a_DOWN_link_while_it_waits_out_a_stall(tmp_path, monkeypatch):
    import test_capture_runners as T
    _fresh("Ring")
    capture._OXYII_RTC_AT.clear()
    c = T.FakeGattClient()                                          # on_live stays None → no frames
    T._inject_connect_scan(monkeypatch, c)
    monkeypatch.setattr(capture, "_STREAM_STALL_S", 90.0)   # pinned: the settings loader assigns it
    clock = {"t": 0.0}                                       # globally, so a peer test can leak a value
    monkeypatch.setattr(capture._time, "monotonic",
                        lambda: clock.__setitem__("t", clock["t"] + 50.0) or clock["t"])
    snaps = _snap_stall_waits(monkeypatch, "Ring")
    T._run(capture.run_oxyii(T._o2dev(), str(tmp_path)))
    _assert_stalled_wait_is_honest(snaps, "run_oxyii")
