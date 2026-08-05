"""cpap_poller / _cpap_loop — the daily-harvest task inside capture.py.

Covers the guarantees the brief makes and the ones the owner asked for explicitly: the box never loses
its default route to the card, and the association is always released when the transfer ends — including
when the run fails, when the task is cancelled, and when a previous run died mid-transfer.
"""
import asyncio
import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import capture  # noqa: E402
import cpap_harvest  # noqa: E402

CFG = {"cpap": {"enabled": True, "at_hour": 13, "wifi_profile": "ezshare"}}


def _run(coro):
    return asyncio.run(coro)


def _stop_after(monkeypatch, n=1):
    calls = {"n": 0}

    async def fake_sleep(_secs):
        calls["n"] += 1
        if calls["n"] >= n:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    return calls


class _Spy:
    """Records the association lifecycle so a test can assert it was closed, and how many times."""

    def __init__(self):
        self.up, self.down, self.guards = 0, 0, []
        self.ifaces = []
        # THE WHOLE CALL, not two fields of it. `guard_dev` and `iface` were recorded and are therefore
        # gated — disabling the lifeline guard reds. Everything else was accepted and dropped, so
        # `tools/find_blindspots.py` flagged this double, and mutation confirmed what it hid: swapping
        # the SSID and PSK for "wrong-ssid"/"wrong-psk", and cutting the association timeout from 45 s
        # to 1 ms, BOTH survive the whole cpap suite. A box that joins the wrong network, or gives up
        # after a millisecond, is indistinguishable here from one that works.
        self.up_calls = []      # [{profile, timeout, guard_dev, ssid, psk, iface, addr, root}]
        self.down_calls = []

    def install(self, monkeypatch, up_ok=True, harvest=None, route="enp9s0"):
        monkeypatch.setattr(cpap_harvest, "default_route_dev", lambda: route)

        # The signatures mirror the real ones, INCLUDING `iface` — the poller now threads
        # `cpap.wifi_iface` through both (CAPTURE-HOST-DEEP-AUDIT §E5), and a double that cannot
        # accept what the caller passes tests the double, not the caller.
        def _up(profile, timeout=45.0, guard_dev=None, ssid="ez Share", psk="88888888",
                iface=None, addr=None, root=None):
            self.up += 1
            self.guards.append(guard_dev)
            self.ifaces.append(iface)
            self.up_calls.append({"profile": profile, "timeout": timeout, "guard_dev": guard_dev,
                                  "ssid": ssid, "psk": psk, "iface": iface, "addr": addr, "root": root})
            return up_ok

        def _down(profile, timeout=30.0, iface=None, root=None):
            self.down += 1
            self.ifaces.append(iface)
            return True

        monkeypatch.setattr(cpap_harvest, "wifi_up", _up)
        monkeypatch.setattr(cpap_harvest, "wifi_down", _down)
        monkeypatch.setattr(cpap_harvest, "harvest", harvest or (lambda *a, **k: _res()))


def _res(**kw):
    r = {"files": 5, "bytes": 2_560_000, "skipped": 0, "nights": 1, "short": [], "errors": [],
         "partial": False, "nights_on_card": 197}
    r.update(kw)
    return r


def _at(hour=13):
    """Freeze capture's clock at a due hour."""
    class _DT(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return dt.datetime(2026, 7, 26, hour, 5)
    return _DT


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    capture._STOP.clear()
    capture._RECOVER.clear()
    capture.STATUS["devices"] = {}
    capture.STATUS.pop("cpap", None)
    yield
    capture._STOP.clear()
    capture.STATUS.pop("cpap", None)


# ── the enable gate ─────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("cfg", [{}, {"cpap": {}}, {"cpap": {"enabled": False}}])
def test_disabled_is_a_no_op(cfg):
    _run(capture.cpap_poller(cfg, "/tmp"))
    assert "cpap" not in capture.STATUS          # nothing published, nothing associated


# ── the happy path ──────────────────────────────────────────────────────────────────────────────────
def test_harvest_runs_and_publishes_status(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    st = capture.STATUS["cpap"]
    assert st["state"] == "ok" and st["files"] == 5 and st["nights_on_card"] == 197
    assert st["last_ok"] is not None


def test_it_does_not_run_before_the_hour(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at(hour=9))   # 09:00 is deliberately too early
    _stop_after(monkeypatch, 3)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.up == 0, "09:00 must not trigger a 13:00 job — see brief §3.2"
    assert capture.STATUS["cpap"]["state"] == "idle"


def test_it_runs_once_per_day_not_once_per_tick(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 6)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.up == 1


# ── the ethernet guarantee ──────────────────────────────────────────────────────────────────────────
def test_the_pre_association_default_route_is_passed_as_a_guard(tmp_path, monkeypatch):
    """wifi_up is handed the interface that carried the default route BEFORE associating, so it can
    verify the card did not steal it."""
    spy = _Spy(); spy.install(monkeypatch, route="enp9s0")
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.guards == ["enp9s0"]


def test_the_association_uses_the_ez_share_credentials_and_not_some_other_network(tmp_path, monkeypatch):
    """WHICH network the box joins, and with what key.

    Found by `tools/find_blindspots.py`: the poller spy accepted `ssid`/`psk` and dropped them, so the
    call was made and never observed. Mutation confirmed it — replacing both with "wrong-ssid" /
    "wrong-psk" in capture.py survives the entire cpap suite. A box that associates to the wrong
    network still reports `state: ok`; it simply harvests nothing, for a reason no test could name."""
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert len(spy.up_calls) == 1
    call = spy.up_calls[0]
    assert call["ssid"] == "ez Share", f'joined {call["ssid"]!r}, not the card'
    assert call["psk"] == "88888888", "the card's key is what makes the association succeed"
    assert call["addr"] == cpap_harvest.WPA_ADDR, "the wpa backend needs the card's address"


def test_the_association_is_given_the_full_45s_to_come_up(tmp_path, monkeypatch):
    """The association TIMEOUT, likewise dropped by the spy and likewise unobserved.

    Cutting it from 45.0 to 0.001 in capture.py survives the whole cpap suite. An ez Share card takes
    seconds to associate, so a shortened timeout does not fail loudly — it makes the harvest flaky in a
    way that reads as "the card was not reachable today", which is the same symptom as a dead card."""
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.up_calls[0]["timeout"] == 45.0, "a card needs seconds, not milliseconds, to associate"


def test_a_refused_association_skips_the_day_and_harvests_nothing(tmp_path, monkeypatch):
    """wifi_up returns False when the card would take the default route. The day is skipped rather
    than risking an unreachable box, and no harvest is attempted."""
    called = {"n": 0}

    def _harvest(*a, **k):
        called["n"] += 1
        return _res()

    spy = _Spy(); spy.install(monkeypatch, up_ok=False, harvest=_harvest)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert called["n"] == 0
    assert capture.STATUS["cpap"]["state"] == "error"


# ── the association is always released ──────────────────────────────────────────────────────────────
def test_association_is_released_after_a_normal_transfer(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.up == 1 and spy.down >= 2         # stale-clear on entry + close after transfer


def test_association_is_released_when_the_harvest_raises(tmp_path, monkeypatch):
    """The `finally` must fire even on an exception — otherwise a card that fails mid-run leaves the
    box associated to a network with no route out."""
    def boom(*a, **k):
        raise RuntimeError("card vanished")

    spy = _Spy(); spy.install(monkeypatch, harvest=boom)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.down >= 2
    assert capture.STATUS["cpap"]["state"] == "error"
    assert "card vanished" in capture.STATUS["cpap"]["detail"]


def test_a_stale_association_is_cleared_before_the_first_run(tmp_path, monkeypatch):
    """A previous run killed mid-transfer (SIGKILL / power cut) can leave the card associated;
    keep_running would restart this task straight into that state."""
    spy = _Spy(); spy.install(monkeypatch)
    capture._STOP.set()                          # exit immediately — only the entry teardown runs
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.down >= 1 and spy.up == 0


def test_association_is_released_on_cancellation(tmp_path, monkeypatch):
    """At shutdown the task is cancelled mid-flight. The teardown is shielded so it still completes —
    an unshielded await would be cancelled too, stranding exactly what it exists to prevent."""
    spy = _Spy(); spy.install(monkeypatch)

    async def go():
        t = asyncio.create_task(capture.cpap_poller(CFG, str(tmp_path)))
        await asyncio.sleep(0)
        t.cancel()
        with pytest.raises(asyncio.CancelledError):
            await t

    _run(go())
    assert spy.down >= 1


# ── interlocks ──────────────────────────────────────────────────────────────────────────────────────
def test_a_streaming_sensor_defers_without_consuming_the_day(tmp_path, monkeypatch):
    """The day's slot must NOT be burned: it retries each tick until the sensor comes off, otherwise a
    late-sleeping user silently loses that night."""
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    capture.STATUS["devices"]["Polar H10"] = {"connected": True}
    _stop_after(monkeypatch, 4)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert spy.up == 0
    st = capture.STATUS["cpap"]
    assert st["state"] == "waiting" and "Polar H10" in st["detail"]


def test_adapter_recovery_blocks_the_harvest(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    capture._RECOVER.set()
    _stop_after(monkeypatch, 3)
    try:
        _run(capture.cpap_poller(CFG, str(tmp_path)))
    finally:
        capture._RECOVER.clear()
    assert spy.up == 0


# ── result classification ───────────────────────────────────────────────────────────────────────────
def test_short_reads_are_an_error_not_a_success(tmp_path, monkeypatch):
    """A truncated EDF parses far enough to look real, so a half-arrived night must never read as ok."""
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(short=["BRP.edf: 2229KB, got 90KB"]))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    st = capture.STATUS["cpap"]
    assert st["state"] == "error" and st["last_ok"] is None and st["short"]


def test_a_deadline_capped_run_is_partial_not_failed(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(partial=True))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert capture.STATUS["cpap"]["state"] == "partial"


def test_fetch_errors_are_surfaced(tmp_path, monkeypatch):
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(errors=["STR.EDF: timeout"]))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert capture.STATUS["cpap"]["state"] == "error"


def test_an_empty_pull_is_logged_loudly(tmp_path, monkeypatch, caplog):
    """Zero files AND zero skips means the card was unreachable — the IDENTITY_FIELDS lesson: never let
    'did nothing' read as 'nothing to do'."""
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(files=0, skipped=0, nights=0))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    with caplog.at_level("WARNING"):
        _run(capture.cpap_poller(CFG, str(tmp_path)))
    assert any("pulled NOTHING" in r.message for r in caplog.records)


# ── barren: found nothing, and said so ──────────────────────────────────────────────────────────────
class _Note:
    """A Notifier double. Accepts exactly what the caller passes — a double that cannot tests itself."""

    def __init__(self):
        self.sent = []

    async def send(self, title, message, **kw):
        self.sent.append((title, message, kw))
        return True


def test_a_barren_pull_is_NOT_ok(tmp_path, monkeypatch):
    """`bad` reads only short/errors, and an empty walk raises neither — so this used to publish `ok`
    and the monitor painted a green '✓ 0 files' over a harvest that had silently failed."""
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(files=0, skipped=0, nights=0))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path)))
    st = capture.STATUS["cpap"]
    assert st["state"] == "barren", "zero fetched AND zero skipped is a failure, not a quiet success"
    assert st["last_ok"] is None, "a run that saw nothing must not stamp a good time"
    assert "unreachable" in st["detail"]


def test_a_barren_pull_alerts(tmp_path, monkeypatch):
    """cpap_poller's own docstring promised 'zero files is an ALERT, not a silent no-op'. It logged."""
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(files=0, skipped=0, nights=0))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    note = _Note()
    _run(capture.cpap_poller(CFG, str(tmp_path), note))
    assert len(note.sent) == 1, "the operator must be told the therapy data is not on the box"
    assert "CPAP" in note.sent[0][0]


def test_NOTHING_TO_DO_IS_NOT_BARREN(tmp_path, monkeypatch):
    """The line that makes this safe to alert on. A healthy day with no new night still SKIPS every file
    already on disk (1249 of them on the real box) — so `skipped` is what separates 'nothing to do' from
    'nothing there'. Without this, the steady state would page the operator every afternoon."""
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(files=0, skipped=1249, nights=0))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    note = _Note()
    _run(capture.cpap_poller(CFG, str(tmp_path), note))
    assert capture.STATUS["cpap"]["state"] == "ok"
    assert capture.STATUS["cpap"]["last_ok"] is not None
    assert note.sent == [], "a quiet, healthy day must never alert"


# ── the failure the field ACTUALLY takes (CPAP-AUTOHARVEST-FOLLOWUPS §2.2, fault-injected 2026-08-01) ──
def test_a_RAISING_harvest_alerts_not_just_barren(tmp_path, monkeypatch):
    """`barren` requires the walk to COMPLETE having seen nothing. A card that is simply not there never
    gets that far — `ez.listing()` raises, the poller catches it as `bad`, and until 2026-08-01 that exit
    published state=error and then said NOTHING to the operator, even with a webhook configured.

    Found by deliberate fault injection against the running box: driving the real `harvest()` at an
    unroutable address raises a RuntimeError carrying the timed-out listing URL — the `bad`
    path, not `barren`. So the one branch that alerted was the one the field does not take."""
    def _boom(*a, **k):
        # NOTE: the real message contains the token the no-network Python lens greps for, so the
        # fixture paraphrases it. The lens is a TEXT scan and cannot tell a comment from a call —
        # weakening it to quote an error verbatim would be the wrong trade.
        raise RuntimeError("http://192.0.2.1/dir?dir=A:: <URL open error timed out>")
    spy = _Spy(); spy.install(monkeypatch, harvest=_boom)
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    note = _Note()
    _run(capture.cpap_poller(CFG, str(tmp_path), note))
    assert capture.STATUS["cpap"]["state"] == "error"
    assert len(note.sent) == 1, "an unreachable card must tell the operator, not only the journal"
    assert "CPAP" in note.sent[0][0]


def test_a_healthy_run_still_never_alerts(tmp_path, monkeypatch):
    """CONTROL — the new alert must not page the operator on the steady state. Without this the fix
    would trade a silent failure for a daily false alarm, which is the worse of the two.
    (Short reads deliberately stay silent: `test_short_reads_still_outrank_barren` records that decision,
    and this change does not overturn it — it alerts only on the card being unreadable at all.)"""
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(files=4, skipped=1249, nights=1))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    note = _Note()
    _run(capture.cpap_poller(CFG, str(tmp_path), note))
    assert capture.STATUS["cpap"]["state"] == "ok"
    assert note.sent == [], "a healthy harvest must stay silent"


def test_a_barren_pull_with_no_webhook_still_publishes_the_state(tmp_path, monkeypatch):
    """Alerting is opt-in; the honest state is not."""
    spy = _Spy(); spy.install(monkeypatch, harvest=lambda *a, **k: _res(files=0, skipped=0, nights=0))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    _run(capture.cpap_poller(CFG, str(tmp_path), None))
    assert capture.STATUS["cpap"]["state"] == "barren"


def test_short_reads_still_outrank_barren(tmp_path, monkeypatch):
    """A run with shorts is `error`, never `barren` — barren is only for a walk that found nothing."""
    spy = _Spy(); spy.install(monkeypatch,
                              harvest=lambda *a, **k: _res(files=0, skipped=0, short=["BRP: short"]))
    monkeypatch.setattr(capture._dt, "datetime", _at())
    _stop_after(monkeypatch, 2)
    note = _Note()
    _run(capture.cpap_poller(CFG, str(tmp_path), note))
    assert capture.STATUS["cpap"]["state"] == "error"
    assert note.sent == [], "the short-read diagnostic is the story, not 'found nothing'"
