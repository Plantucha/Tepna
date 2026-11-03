# tepna-capture — tests/test_solid_alert.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The solid-night verdict on ntfy, and a non-PASS verdict as a prompt request (owner order, board
thread 7, 2026-11-03). Pinned: once per night and status, both latches survive a restart, the ntfy latch
follows the delivery, a PASS writes no request, a re-judged older night announces nothing. Every
notifier here is a stub; no test reaches a live topic."""

import json
import os

import alerts
import capture
from tests.test_capture_coverage_100 import _run


class _N:
    def __init__(self, enabled=True, ok=True):
        self.enabled, self.ok, self.sent = enabled, ok, []

    async def send(self, title, message, **kw):
        self.sent.append((title, message))
        return self.ok


def _s(status="FAIL", reason="H10 short", statement="1 solid of 3"):
    return {"status": status, "reason": reason, "statement": statement, "solid": 1, "exit": 0}


def _latch(cap):
    return json.loads((cap / alerts.SOLID_LATCH_NAME).read_text())


# ---- alerts.py, pure ----


def test_the_key_joins_night_and_status():
    assert alerts.solid_key("2026-09-18", "FAIL") == "2026-09-18:FAIL"


def test_a_bad_latch_reads_as_empty_part_by_part():
    assert alerts.solid_latch_restored(None) == (set(), set())
    assert alerts.solid_latch_restored([1]) == (set(), set())
    assert alerts.solid_latch_restored({"ntfy": "x", "prompt": ["a", 3]}) == (set(), {"a"})
    assert alerts.solid_latch_restored({"ntfy": ["n"]}) == ({"n"}, set())


def test_the_saved_latch_keeps_only_the_latest_keys_of_each_kind():
    keys = [f"2026-{m:02d}-{d:02d}:FAIL" for m in (1, 2, 3) for d in range(1, 29)]
    saved = alerts.solid_latch_to_save(reversed(keys), ["b", "a"])
    assert saved["ntfy"] == keys[-alerts.SOLID_LATCH_KEEP :] and len(saved["ntfy"]) == 62
    assert saved["prompt"] == ["a", "b"]


def test_the_alert_text_carries_the_judges_own_words():
    assert alerts.solid_alert_text("2026-09-18", _s()) == ("Tepna: night 2026-09-18 FAIL", "H10 short — 1 solid of 3")
    assert alerts.solid_alert_text("2026-09-18", _s(reason=None))[1] == "1 solid of 3"
    assert alerts.solid_alert_text("2026-09-18", _s(statement=None))[1] == "H10 short"
    text = alerts.solid_alert_text("2026-09-18", _s("PASS", None, None))
    assert text == ("Tepna: night 2026-09-18 PASS", "The solid-night judge reads PASS.")


def test_a_pass_an_unknown_word_and_a_bad_night_write_no_request():
    assert alerts.solid_prompt_request("2026-09-18", _s("PASS"), "t") is None
    assert alerts.solid_prompt_request("2026-09-18", _s("BROKEN"), "t") is None
    for night in (None, "2026-9-18", "2026-02-30", "2026-09-18x", "x" * 10):
        assert alerts.solid_prompt_request(night, _s(), "t") is None, night
    for status in sorted(alerts.VERDICT_STATUSES - {"PASS"}):
        req = alerts.solid_prompt_request("2026-09-18", _s(status), "t")
        assert req == {"night": "2026-09-18", "status": status, "at": "t"}, status
    assert len(alerts.VERDICT_STATUSES) == 7


# ---- capture._announce_solid ----


def test_a_delivered_verdict_goes_out_once_and_the_latch_survives_a_restart(tmp_path, caplog):
    n = _N()
    with caplog.at_level("WARNING"):
        _run(capture._announce_solid(str(tmp_path), "2026-09-18", _s(), n))
    assert n.sent == [("Tepna: night 2026-09-18 FAIL", "H10 short — 1 solid of 3")]
    assert _latch(tmp_path) == {"ntfy": ["2026-09-18:FAIL"], "prompt": ["2026-09-18:FAIL"]}
    req = json.loads((tmp_path / alerts.SOLID_PROMPT_NAME).read_text())
    assert (req["night"], req["status"]) == ("2026-09-18", "FAIL") and req["at"]
    assert any("prompt request written" in r.getMessage() for r in caplog.records)
    (tmp_path / alerts.SOLID_PROMPT_NAME).unlink()
    n2 = _N()  # a restart: a new notifier, and the latch read back from disk
    _run(capture._announce_solid(str(tmp_path), "2026-09-18", _s(), n2))
    assert n2.sent == [] and not (tmp_path / alerts.SOLID_PROMPT_NAME).exists()


def test_a_failed_send_is_tried_again_and_the_prompt_is_not(tmp_path):
    n = _N(ok=False)
    _run(capture._announce_solid(str(tmp_path), "2026-09-18", _s(), n))
    assert _latch(tmp_path) == {"ntfy": [], "prompt": ["2026-09-18:FAIL"]}
    (tmp_path / alerts.SOLID_PROMPT_NAME).unlink()
    n.ok = True
    _run(capture._announce_solid(str(tmp_path), "2026-09-18", _s(), n))
    assert len(n.sent) == 2 and _latch(tmp_path)["ntfy"] == ["2026-09-18:FAIL"]
    assert not (tmp_path / alerts.SOLID_PROMPT_NAME).exists(), "the request went out once"


def test_a_box_without_a_webhook_latches_and_writes_the_request(tmp_path):
    n = _N(enabled=False, ok=False)
    _run(capture._announce_solid(str(tmp_path), "2026-09-18", _s(), n))
    assert _latch(tmp_path)["ntfy"] == ["2026-09-18:FAIL"]
    _run(capture._announce_solid(str(tmp_path), "2026-09-18", _s(), n))
    assert len(n.sent) == 1


def test_no_notifier_still_writes_the_request(tmp_path):
    _run(capture._announce_solid(str(tmp_path), "2026-09-18", _s(), None))
    assert _latch(tmp_path) == {"ntfy": [], "prompt": ["2026-09-18:FAIL"]}
    assert (tmp_path / alerts.SOLID_PROMPT_NAME).exists()


def test_a_pass_goes_out_and_writes_no_request(tmp_path):
    n = _N()
    _run(capture._announce_solid(str(tmp_path), "2026-09-18", _s("PASS", None, "3 solid of 3"), n))
    assert n.sent == [("Tepna: night 2026-09-18 PASS", "3 solid of 3")]
    assert not (tmp_path / alerts.SOLID_PROMPT_NAME).exists()
    assert _latch(tmp_path) == {"ntfy": ["2026-09-18:PASS"], "prompt": ["2026-09-18:PASS"]}


def test_a_new_status_for_the_same_night_goes_out_again(tmp_path):
    n = _N()
    _run(capture._announce_solid(str(tmp_path), "2026-09-18", _s("FAIL"), n))
    _run(capture._announce_solid(str(tmp_path), "2026-09-18", _s("SHORTFALL"), n))
    assert [t for t, _ in n.sent] == ["Tepna: night 2026-09-18 FAIL", "Tepna: night 2026-09-18 SHORTFALL"]
    req = json.loads((tmp_path / alerts.SOLID_PROMPT_NAME).read_text())
    assert req["status"] == "SHORTFALL"


def test_an_unchanged_latch_is_not_written_again(tmp_path, monkeypatch):
    _run(capture._announce_solid(str(tmp_path), "2026-09-18", _s(), _N()))
    writes = []
    monkeypatch.setattr(capture, "_write_quiet_state", lambda *a: writes.append(a))
    _run(capture._announce_solid(str(tmp_path), "2026-09-18", _s(), _N()))
    assert writes == []


# ---- the hook point: `_publish_solid` and the poller ----


def test_publish_solid_says_whether_it_published(monkeypatch):
    monkeypatch.setattr(capture, "STATUS", {})
    assert capture._publish_solid("2026-09-18", _s()) is True
    assert capture._publish_solid("2026-09-17", _s()) is False, "a re-judged older night is not published"
    assert capture.STATUS["solid"]["night"] == "2026-09-18"
    assert (
        capture._publish_loss(
            {"night": "2026-09-19", "loss": None, "loss_error": None, "solid_error": None, "solid": None}
        )
        is False
    )


def test_the_poller_announces_a_published_verdict_and_not_an_older_one(tmp_path, monkeypatch):
    from tests.test_loss_poller import _audit_writer, _night, _stop_after

    _night(tmp_path, "2026-09-18")
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda c, s: set())
    monkeypatch.setattr(capture.loss_audit, "write_night", _audit_writer([]))
    seen = []

    async def rec(captures, night, s, notifier):
        seen.append((captures, night, s["status"], notifier))

    monkeypatch.setattr(capture, "_announce_solid", rec)
    n = _N()

    def poll():
        import asyncio

        capture._STOP = asyncio.Event()
        _stop_after(monkeypatch, 1)
        _run(capture.loss_poller({"loss_audit": {"poll_sec": 1}, "devices": []}, str(tmp_path), n))
        capture._STOP.clear()

    monkeypatch.setattr(capture, "STATUS", {"solid": {"night": "2026-09-30"}})
    poll()
    assert seen == [], "the card shows a newer night, so the older verdict is neither shown nor sent"
    for f in (tmp_path / "captures" / "2026-09-18").iterdir():
        if f.name == capture.solid_night.VERDICT_NAME:
            os.unlink(f)
    monkeypatch.setattr(capture, "STATUS", {})
    poll()
    assert seen == [(str(tmp_path / "captures"), "2026-09-18", "UNKNOWN", n)]
