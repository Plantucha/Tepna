# tepna-capture — tests/test_pps_and_update_alerts.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Two push alerts that did not exist (owner, 2026-11-03): the host clock leaving the GPS pulse, and the
box update failing twice in a row. Every notifier here is a stub; no test reaches a live topic."""

import alerts
import capture
from tests.test_capture_runners import _run, _stop_after
from tests import test_vigil_update as _tvu


# The update-script fixture and drivers, shared with test_vigil_update.py.
box = _tvu.box
_fail = _tvu._fail
_upd = _tvu._run


# ── the GPS-pulse watch, pure ────────────────────────────────────────────────────────────────────────
def _walk(refs, grace=600.0, sent=True):
    """Drive the watch over (t, reference) polls; latch every due alert as delivered when `sent`."""
    s, out = alerts.pps_watch_new(), []
    for t, ref in refs:
        s, due, mins = alerts.pps_watch_step(s, ref, t, grace)
        if due:
            out.append((t, due, round(mins, 2)))
            if sent:
                s = alerts.pps_watch_sent(s, due)
    return s, out


def test_a_host_that_never_saw_the_pulse_never_alerts():
    """No receiver, or the boot window before chrony locks: off the pulse for an hour is not news."""
    _, out = _walk([(t, None) for t in range(0, 3600, 120)] + [(3600, "192.0.2.1")])
    assert out == []


def test_the_loss_alerts_once_after_the_grace_and_the_return_names_the_minutes():
    refs = [(0, "PPS"), (120, "192.0.2.1"), (600, "192.0.2.1"), (720, "192.0.2.1"), (840, None), (1320, "PPS")]
    s, out = _walk(refs)
    assert out == [(720, "lost", 10.0), (1320, "back", 20.0)]
    assert s == {"armed": True, "lost_since": None, "back_at": None, "alerted": False}


def test_a_short_loss_inside_the_grace_says_nothing_and_resets():
    _, out = _walk([(0, "PPS"), (120, None), (600, "PPS"), (720, None), (1200, None), (1400, "PPS")])
    assert out == []


def test_an_undelivered_alert_stays_due_and_the_return_keeps_its_first_minute():
    s = alerts.pps_watch_new()
    s, due, _ = alerts.pps_watch_step(s, "PPS", 0)
    s, due, _ = alerts.pps_watch_step(s, None, 60, grace_sec=0)
    assert due == "lost"
    s, due, _ = alerts.pps_watch_step(s, None, 120, grace_sec=0)
    assert due == "lost", "a failed send must retry on the next poll"
    s = alerts.pps_watch_sent(s, "lost")
    s, due, _ = alerts.pps_watch_step(s, None, 180, grace_sec=0)
    assert due is None, "a delivered loss alert is not repeated"
    s, due, m1 = alerts.pps_watch_step(s, "PPS", 300)
    s, due, m2 = alerts.pps_watch_step(s, "PPS", 420)
    assert (due, m1, m2) == ("back", 4.0, 4.0)
    s, due, _ = alerts.pps_watch_step(s, None, 480)
    assert due is None and s["back_at"] is None and s["alerted"] is True


def test_the_alert_text_names_the_pulse_and_never_a_server():
    t, m = alerts.pps_alert_text("lost", 10.4, 2, "disciplined")
    assert t == "Tepna: host clock left the GPS pulse"
    assert "10 min" in m and "stratum 2" in m and "trust disciplined" in m
    _, m = alerts.pps_alert_text("lost", 10, None, None)
    assert "stratum unknown" in m and "trust unknown" in m
    t, m = alerts.pps_alert_text("back", 20.0, 1, "disciplined")
    assert t == "Tepna: host clock back on the GPS pulse" and "after 20 min" in m


# ── the GPS-pulse watch, wired into host_clock_poller ────────────────────────────────────────────────
class _N:
    def __init__(self, enabled=True, ok=True):
        self.enabled, self.ok, self.sent = enabled, ok, []

    async def send(self, title, message, **kw):
        self.sent.append(title)
        return self.ok


def _poll(monkeypatch, refs, notifier):
    seq = iter(refs)

    async def fake_state():
        ref = next(seq)
        return {"reference": ref, "stratum": 1 if ref == "PPS" else 2, "trust": "disciplined", "absolute_ok": True}

    monkeypatch.setattr(capture.host_clock, "read_state", fake_state)
    monkeypatch.setattr(capture, "_NOTIFIER", notifier)
    _stop_after(monkeypatch, len(refs))
    _run(capture.host_clock_poller({"time": {"pps_loss_alert_sec": 0}}, None))
    capture._STOP.clear()  # the stub sleep tripped it to end the loop; the next test starts clean


def test_the_poller_sends_the_loss_once_and_the_return(monkeypatch):
    n = _N()
    _poll(monkeypatch, ["PPS", None, None, "PPS", "PPS"], n)
    assert n.sent == ["Tepna: host clock left the GPS pulse", "Tepna: host clock back on the GPS pulse"]


def test_the_poller_retries_a_failed_send_on_the_next_poll(monkeypatch):
    n = _N(ok=False)
    _poll(monkeypatch, ["PPS", None, None], n)
    assert n.sent == ["Tepna: host clock left the GPS pulse"] * 2


def test_the_poller_latches_when_alerts_are_off(monkeypatch):
    n = _N(enabled=False, ok=False)
    _poll(monkeypatch, ["PPS", None, None], n)
    assert n.sent == ["Tepna: host clock left the GPS pulse"]


def test_the_poller_without_a_notifier_still_records_the_clock(monkeypatch):
    _poll(monkeypatch, ["PPS", None], None)
    assert capture.STATUS["host_clock"]["reference"] is None


# ── the update streak, pure + its CLI ────────────────────────────────────────────────────────────────
def test_the_update_streak_text_names_the_count_and_the_span():
    t, m = alerts.update_streak_text("lost", 2, 1000, 1000 + 3600 + 300)
    assert t == "Tepna: box update failing" and "failed 2 runs in a row" in m and "(1h5m)" in m
    _, m = alerts.update_streak_text("lost", 2, 0, 5000)
    assert "first at unknown (span unknown)" in m
    t, m = alerts.update_streak_text("back", 30, 1000, 1000 + 9 * 3600)
    assert t == "Tepna: box update recovered" and m == "The box update ran clean after 30 failed runs over 9h0m."
    _, m = alerts.update_streak_text("back", 0, 0, 5000)
    assert m == "The box update ran clean after a failing streak."


def _cfg(tmp_path, enabled=True):
    p = tmp_path / "config.yaml"
    p.write_text(f"alerts:\n  enabled: {str(enabled).lower()}\n  webhook_url: https://hook.invalid/topic\n")
    return str(p)


def test_update_streak_main_sends_one_alert_and_reports_delivery(tmp_path):
    sent = []

    async def ok(url, payload, headers=None):
        sent.append(payload["title"])
        return True

    async def bad(url, payload, headers=None):
        return False

    argv = ["update-streak", _cfg(tmp_path), "lost", "2", "1000"]
    assert alerts.update_streak_main(argv, _post=ok, now=5000) == 0
    assert sent == ["Tepna: box update failing"]
    assert alerts.update_streak_main(argv, _post=bad, now=5000) == 5


def test_update_streak_main_is_a_success_when_alerts_are_off_or_unconfigured(tmp_path):
    async def never(url, payload, headers=None):
        raise AssertionError("no post when alerts are off")

    assert alerts.update_streak_main(["update-streak", _cfg(tmp_path, False), "back", "2", "1"], _post=never) == 0
    assert (
        alerts.update_streak_main(["update-streak", str(tmp_path / "absent.yaml"), "back", "2", "1"], _post=never) == 0
    )
    (tmp_path / "list.yaml").write_text("- a\n")
    assert alerts.update_streak_main(["update-streak", str(tmp_path / "list.yaml"), "back", "2", "1"], _post=never) == 0


def test_update_streak_main_refuses_bad_arguments(tmp_path):
    c = _cfg(tmp_path)
    for argv in (
        [],
        ["nope", c, "lost", "2", "1"],
        ["update-streak", c, "maybe", "2", "1"],
        ["update-streak", c, "lost", "x", "1"],
    ):
        assert alerts.update_streak_main(argv) == 2


def test_the_default_clock_is_the_wall_clock(tmp_path):
    sent = []

    async def ok(url, payload, headers=None):
        sent.append(payload["message"])
        return True

    assert alerts.update_streak_main(["update-streak", _cfg(tmp_path), "back", "0", "0"], _post=ok) == 0
    assert sent and "after a failing streak" in sent[0]


# ── the update streak, wired into tepna-update.sh's EXIT trap ────────────────────────────────────────


def _calls(bx):
    p = bx["alert_calls"]
    return [ln.split()[1:] for ln in p.read_text().splitlines()] if p.exists() else []


def test_one_failure_sends_nothing_and_the_second_sends_one_alert(box, tmp_path):
    _fail(box, tmp_path)
    assert _calls(box) == []
    _fail(box, tmp_path)
    _fail(box, tmp_path)
    c = _calls(box)
    assert len(c) == 1 and c[0][:3] == ["update-streak", str(box["alert_cfg"]), "lost"] and c[0][3] == "2"
    assert (tmp_path / "update-fails.alerted").exists()


def test_the_first_clean_run_after_the_alert_sends_the_recovery_and_clears_the_latch(box, tmp_path):
    _fail(box, tmp_path)
    _fail(box, tmp_path)
    r = _upd(box)
    assert r.returncode == 0
    assert [c[2:4] for c in _calls(box)] == [["lost", "2"], ["back", "2"]]
    assert not (tmp_path / "update-fails.alerted").exists()
    _upd(box)
    assert len(_calls(box)) == 2, "a healthy run after the recovery sends nothing"


def test_a_recovery_after_a_single_failure_sends_nothing(box, tmp_path):
    _fail(box, tmp_path)
    _upd(box)
    assert _calls(box) == []


def test_a_failed_send_keeps_no_latch_so_the_next_run_retries(box, tmp_path):
    _fail(box, tmp_path)
    r = _upd(box, TEPNA_REPO_DIR=str(tmp_path / "nope"), FAKE_ALERT_EXIT="5")
    assert "could not send the update-streak alert (lost, exit 5)" in r.stderr
    assert not (tmp_path / "update-fails.alerted").exists()
    _fail(box, tmp_path)
    assert [c[2:4] for c in _calls(box)] == [["lost", "2"], ["lost", "3"]]


def test_a_failed_recovery_send_keeps_the_latch_and_retries_with_no_streak(box, tmp_path):
    _fail(box, tmp_path)
    _fail(box, tmp_path)
    r = _upd(box, FAKE_ALERT_EXIT="5")
    assert r.returncode == 0, "an alert must never fail the update"
    assert (tmp_path / "update-fails.alerted").exists()
    _upd(box)
    assert [c[2:5] for c in _calls(box)][-1] == ["back", "0", "0"]
    assert not (tmp_path / "update-fails.alerted").exists()
