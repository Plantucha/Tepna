# tepna-capture — tests/test_live_loss_status.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""status_loop runs the live loss guard: it publishes the open-file count on a clean pass, and on a
finding it logs at ERROR, publishes the finding, and alerts."""

import asyncio

import capture
from tests.test_capture_coverage_100 import _run, _stop_after


def _loop(monkeypatch, tmp_path, notifier=None):
    # HERMETIC: status_loop walks STATUS["devices"], and this helper used to inherit whatever the previous
    # test on the same xdist worker left there. #3010's CI failed on exactly that (`'str' object has no
    # attribute 'get'` at publish_recording) on the MERGE of two halves that were each green — which makes
    # it an isolation defect in this helper, not in either half. Reset like its ~15 siblings do.
    monkeypatch.setitem(capture.STATUS, "devices", {})
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    capture._NOTIFIER = notifier
    _run(capture.status_loop(str(tmp_path)))
    capture._NOTIFIER = None
    capture._STOP.clear()


def test_a_clean_pass_publishes_the_open_file_count(tmp_path, monkeypatch):
    monkeypatch.setattr(capture.writers, "live_loss_check", lambda prev: ([], {"a": (1, 2)}))
    monkeypatch.setattr(capture.writers, "open_writer_paths", lambda: ["a", "b"])
    _loop(monkeypatch, tmp_path)
    assert capture.STATUS["live_loss"]["findings"] == [] and capture.STATUS["live_loss"]["open_files"] == 2


def test_a_finding_is_logged_published_and_alerted(tmp_path, monkeypatch, caplog):
    f = {
        "path": "/srv/tepna/captures/2026-09-22/X_ECG.txt",
        "kind": "shrank",
        "detail": "900 → 10 bytes",
        "was": 900,
        "now": 10,
    }
    monkeypatch.setattr(capture.writers, "live_loss_check", lambda prev: ([f], {}))
    sent = []

    class _N:
        async def send(self, title, message, **kw):
            sent.append((title, message))
            return True

        def stats(self):
            return {}

    with caplog.at_level("ERROR"):
        _loop(monkeypatch, tmp_path, notifier=_N())
    assert capture.STATUS["live_loss"]["findings"] == [f] and capture.STATUS["live_loss"]["last_at"]
    assert capture.STATUS["live_loss"]["last"] == [f]
    assert any(
        "LIVE LOSS: shrank X_ECG.txt (900 → 10 bytes) — a file this daemon is writing lost bytes" in r.getMessage()
        for r in caplog.records
    )
    assert sent and sent[0][0] == "Tepna: a live capture file was lost" and "shrank X_ECG.txt" in sent[0][1]


def test_a_guard_that_raises_does_not_end_the_status_loop(tmp_path, monkeypatch, caplog):
    f = {
        "path": "/srv/tepna/captures/2026-09-22/X_ECG.txt",
        "kind": "shrank",
        "detail": "900 → 10 bytes",
        "was": 900,
        "now": 10,
    }
    monkeypatch.setattr(capture.writers, "live_loss_check", lambda prev: ([f], {}))
    monkeypatch.setattr(capture.writers, "open_writer_paths", lambda: [])
    _loop(monkeypatch, tmp_path)  # a loss happens first
    monkeypatch.setattr(capture.writers, "live_loss_check", lambda prev: (_ for _ in ()).throw(OSError("eio")))
    monkeypatch.setattr(capture.writers, "open_writer_paths", lambda: [])
    with caplog.at_level("WARNING"):
        _loop(monkeypatch, tmp_path)
    assert any("live-loss check failed this round" in r.getMessage() for r in caplog.records)
    assert capture.STATUS["live_loss"]["findings"] == []  # this pass is clean…
    assert capture.STATUS["live_loss"]["last"] == [f]  # …and the earlier loss stays visible
