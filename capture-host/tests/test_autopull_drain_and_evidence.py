# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""THE NIGHT'S OTHER FRAGMENTS, AND THE EVIDENCE THAT A PULL EVER FIRED.

`pull_scope_for` keeps the doff/presence pull at `latest` because it races the ring's post-drop
advertising tail. On a night with several onboard sessions that commits only the newest; measured
2026-08-25→09-05, 4 of 22 sessions arrived instead via the hourly poller 6.5–10.8 h after close, two
of them full 1.3–2.3 h recordings.

⚠️ THE FIX IS A SECOND DISPATCH, NOT A WIDER FIRST ONE. §14b measured the pull DURATIONS (`latest`
p90 31.1 s, `all` p90 69.4 s) but the window they must fit inside is explicitly unresolved
(OXYII-DAT-AUTO-HARVEST-REFINEMENT §5, "needs a deliberate experiment"). Widening the first pull
would trade a proven scope for an unmeasured bound; the follow-on runs when the ring has just
answered, so reachability is demonstrated rather than assumed.
"""
import oxy_inventory as INV


def _row(session, state):
    return {"session": session, "state": state, "id": f"2592302100/{session}"}


def test_ONLY_VERIFIED_AND_COMMITTED_RETIRE_A_SESSION_FROM_THE_DRAIN():
    """DISCOVERED means the ring listed it. PARTIAL means a transfer began. FAILED means one ended
    badly. None of those is 'the bytes are safe', so none may retire a session — otherwise a drain
    skips exactly the files that never landed."""
    flash = ["20260828232644", "20260829015107", "20260903174217", "20260903190037"]
    rows = [_row("20260828232644", INV.COMMITTED), _row("20260829015107", INV.VERIFIED),
            _row("20260903174217", INV.DISCOVERED), _row("20260903190037", INV.PARTIAL)]
    assert INV.undrained(rows, flash) == ["20260903174217", "20260903190037"]


def test_A_FAILED_ROW_IS_STILL_OWED():
    assert INV.undrained([_row("2026", INV.FAILED)], ["2026"]) == ["2026"]


def test_A_SESSION_WITH_NO_ROW_AT_ALL_IS_OWED():
    """The 'first ever pull' shape, and the one a ledger-keyed drain could get backwards."""
    assert INV.undrained([], ["20260828232644"]) == ["20260828232644"]


def test_NOTHING_ON_FLASH_OWES_NOTHING():
    assert INV.undrained([_row("x", INV.COMMITTED)], []) == []


def test_A_LEDGER_ROW_FOR_A_SESSION_NO_LONGER_ON_FLASH_IS_NOT_INVENTED():
    """The drain asks what is ON THE RING and unlanded. A committed session the ring has since
    erased must not reappear as work — that would be a pull for bytes that do not exist."""
    assert INV.undrained([_row("gone", INV.COMMITTED), _row("old", INV.PARTIAL)], ["here"]) == ["here"]


def test_TORN_ROWS_DO_NOT_RETIRE_ANYTHING():
    """A half-written JSONL line is the normal tail of a log being appended to. It must not be read
    as a verification — that would strand the very session it half-describes."""
    assert INV.undrained([{"state": INV.COMMITTED}, None, "junk"], ["20260828232644"]) == \
        ["20260828232644"]


# ── the wiring, which is where two of these defects actually lived ────────────────────────────────
from _srcscan import function_source, module_source


def test_THE_DRAIN_IS_A_SECOND_DISPATCH_AND_THE_FIRST_SCOPE_IS_UNCHANGED():
    """🔴 The load-bearing distinction. If someone 'simplifies' this by widening `pull_scope_for`,
    the doff pull starts racing an unmeasured window with a scope measured at p90 69.4 s."""
    assert 'which="new"' in module_source("capture.py"), "the follow-on drain is gone"
    # function_source, not a fixed byte window: a window is a guess about how long the function is,
    # and a NEGATIVE assert inside one passes as soon as the forbidden text drifts past the edge.
    # (Both of this test's first two assertions failed that way before being written properly.)
    scope = function_source("capture.py", "pull_scope_for")
    assert '"latest"' in scope and '"all"' in scope
    assert '"new"' not in scope, "the event scope was widened — read §14b before doing this"


def test_A_FAILED_DRAIN_DOES_NOT_RETRACT_THE_PULL_THAT_SUCCEEDED():
    """The primary pull is already recorded when the drain runs. A drain that raised through would
    turn a night that landed its main session into a logged failure."""
    seg = function_source("capture.py", "charger_pull_poller")
    assert 'which="new"' in seg, "the drain does not live in the poller that dispatches it"
    assert "except Exception" in seg and "stay on flash for the poller" in seg


def test_WEBMON_FORWARDS_THE_ONLY_EVIDENCE_A_TRIGGER_FIRED():
    assert '"autopull": status.get("autopull")' in module_source("webmon.py")


def test_THE_MONITOR_ACTUALLY_DRAWS_IT_NOT_JUST_MENTIONS_IT():
    """⚠️ `autopull` was already present in monitor.html — inside a COMMENT describing this very
    defect class — and the render scan's word-boundary match counted that as drawn. So the field
    could be forwarded and the gate would still report it rendered. The call, not the mention."""
    src = module_source("monitor.html")
    assert "renderAutopull(s.autopull)" in src, "forwarded and never called"
    assert 'id="apPill"' in src, "called with nothing to write into"


def test_THE_RENDER_SCAN_NO_LONGER_COUNTS_A_COMMENT_AS_A_RENDERING():
    """The gate that would otherwise have passed this change for the wrong reason."""
    src = module_source("tools/find_unwired.py")
    i = src.index("def projected_keys")
    assert '{"storage", "qc"}' in src[i:i + 1800], "the top-level projection is still unscanned"
    j = src.index("orphan_rendered = []")
    assert "<!--" in src[j:j + 1400], "comments are still counted as renderings"


def test_THE_DEAD_STATUS_KEY_IS_GONE():
    """`updated` was written on every publish and read by nothing; instance health ages
    `heartbeat_ms` instead, deliberately."""
    src = module_source("capture.py")
    assert 'STATUS: dict = {"devices": {}}' in src
    assert 'STATUS["updated"]' not in src


# ── the drain's own failure paths, driven through the real poller ─────────────────────────────────
import asyncio

import capture
import offline_lock
from test_presence_wire import A, _arm_presence, _ring_cfg


def _drive(monkeypatch, pull_impl, ticks=3):
    # `_arm_presence` is REQUIRED, not decoration: without it no `by_*` term fires, the poller
    # dispatches nothing, and every assertion below would pass against a poller that never ran.
    _arm_presence()
    monkeypatch.setattr(capture, "pull_oxyii_session", pull_impl)
    n = {"i": 0}
    real_sleep = capture.asyncio.sleep

    async def _sleep(_s):
        n["i"] += 1
        if n["i"] >= ticks:
            capture._STOP.set()
        await real_sleep(0)

    monkeypatch.setattr(capture.asyncio, "sleep", _sleep)
    try:
        asyncio.run(capture.charger_pull_poller(_ring_cfg(), "/tmp"))
        # RETURNED, not left in STATUS for the caller to read: the cleanup below has to run, and an
        # earlier version popped the key in `finally` and then asserted on it — a fixture that
        # destroys the evidence it was gathering.
        return dict(capture.STATUS.get("autopull") or {})
    finally:
        capture._STOP.clear()
        capture._PRESENCE.clear()
        capture._PRESENCE_PULLED.discard(A)
        capture._PRESENCE_PROBED.pop(A, None)
        capture.STATUS.pop("autopull", None)


def test_A_BUSY_SLOT_DEFERS_THE_DRAIN_AND_KEEPS_THE_PULL_THAT_SUCCEEDED(monkeypatch):
    """Another offline op holds the lock when the drain tries to run. The PRIMARY pull already
    landed, so the night is not worse off — and the remainder is exactly as reachable as before."""
    calls = []

    async def pull(dev, root, which="latest", ftype=0):
        calls.append(which)
        if which == "new":
            raise offline_lock.OfflineBusy("slot held")
        return {"new_files": ["a.dat"]}

    ap = _drive(monkeypatch, pull)
    assert calls[:2] == ["latest", "new"], calls
    # THE PRIMARY IS NOT RETRACTED: the busy slot cost the drain, not the pull that already landed.
    assert ap.get("new") == 1 and ap.get("drained") == 0, ap


def test_A_DRAIN_THAT_THROWS_DOES_NOT_RETRACT_THE_PRIMARY_PULL(monkeypatch, caplog):
    """The failure the log line must survive: the drain is a bonus sweep, and a night that landed
    its main session must not be reported as a failure because the bonus did not complete."""
    async def pull(dev, root, which="latest", ftype=0):
        if which == "new":
            raise RuntimeError("ring went away mid-drain")
        return {"new_files": ["a.dat"]}

    with caplog.at_level("INFO"):
        _drive(monkeypatch, pull)
    assert "stay on flash for the poller" in caplog.text


def test_THE_DRAINED_COUNT_REACHES_STATUS(monkeypatch):
    """`drained` is what the monitor renders — a trigger that fires nightly and recovers nothing
    reads as healthy on `trigger` alone."""
    async def pull(dev, root, which="latest", ftype=0):
        return {"new_files": ["a.dat", "b.dat"] if which == "new" else ["main.dat"]}

    ap = _drive(monkeypatch, pull)
    assert ap.get("drained") == 2 and ap.get("new") == 3, ap
