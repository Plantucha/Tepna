# tepna-capture — tests/test_seal_poller.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""capture.seal_poller — OFF by default and says so; ARMED generates keys once, writes the card, seals
settled nights only, and publishes what it did to STATUS."""

import asyncio
import json
import os

import capture
from tests.test_capture_coverage_100 import _run, _stop_after


def test_seal_poller_is_off_by_default_and_says_so(tmp_path, caplog):
    capture._STOP = asyncio.Event()
    with caplog.at_level("INFO"):
        _run(capture.seal_poller({}, str(tmp_path)))
    assert any("seal: OFF" in r.getMessage() for r in caplog.records)
    assert not os.path.exists(str(tmp_path / "keys"))
    capture._STOP.clear()


def test_seal_poller_arms_seals_a_settled_night_and_skips_the_active_one(tmp_path, monkeypatch, caplog):
    root = tmp_path
    for n in ("2026-09-18", "2026-09-19"):
        d = root / "captures" / n
        d.mkdir(parents=True)
        (d / "Polar_H10_0284_20260919_ECG.txt").write_text("a;b\n1;2\n")
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda captures, settle: {"2026-09-19"})
    monkeypatch.setattr(capture.sealbox.socket, "gethostname", lambda: "vigil")
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    cfg = {"seal": {"enabled": True, "poll_sec": 1, "research_consent": None}, "devices": []}
    with caplog.at_level("INFO"):
        _run(capture.seal_poller(cfg, str(root)))
    ob = root / "outbox"
    assert (root / "keys" / "seal-signing.pem").exists() and (root / "keys" / "seal-card.json").exists()
    assert (ob / "vigil-card-k1.html").exists()
    assert (ob / "vigil-2026-09-18.tepna").exists() and not (ob / "vigil-2026-09-19.tepna").exists()
    v = json.load(open(str(ob / "vigil-2026-09-18.tepna.verdict.json")))
    assert v["status"] == "PASS" and v["gate"] == "night-seal"
    st = capture.STATUS["seal"]
    assert st["armed"] is True and st["box_id"] == "vigil" and st["key_id"] == 1 and st["consent"] is None
    assert st["nights"]["2026-09-18"]["status"] == "PASS" and "2026-09-19" not in st["nights"]
    assert any("seal: ARMED" in r.getMessage() and "signing key generated" in r.getMessage() for r in caplog.records)
    # second run: keys reused, card kept, the night reads NOT_APPLICABLE, nothing rewritten
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    before = os.stat(str(ob / "vigil-2026-09-18.tepna")).st_mtime_ns
    _run(capture.seal_poller(cfg, str(root)))
    assert capture.STATUS["seal"]["nights"]["2026-09-18"]["status"] == "NOT_APPLICABLE"
    assert os.stat(str(ob / "vigil-2026-09-18.tepna")).st_mtime_ns == before
    capture._STOP.clear()


def test_seal_poller_refuses_on_a_bad_key_store_and_survives_a_failing_night(tmp_path, monkeypatch, caplog):
    root = tmp_path
    (root / "keys").mkdir()
    (root / "keys" / "seal-card.json").write_text("{broken")
    capture._STOP = asyncio.Event()
    with caplog.at_level("ERROR"):
        _run(capture.seal_poller({"seal": {"enabled": True}}, str(root)))
    assert capture.STATUS["seal"]["armed"] is False and "REFUSED" in caplog.text
    (root / "keys" / "seal-card.json").unlink()
    d = root / "captures" / "2026-09-18"
    d.mkdir(parents=True)
    (d / "x_ECG.txt").write_text("a\n1\n")
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda captures, settle: set())
    monkeypatch.setattr(
        capture.sealbox, "seal_or_reissue", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    with caplog.at_level("WARNING"):
        _run(capture.seal_poller({"seal": {"enabled": True, "poll_sec": 1}}, str(root)))
    assert any("seal: poll failed" in r.getMessage() for r in caplog.records)
    capture._STOP.clear()


def test_seal_poller_logs_a_fail_verdict(tmp_path, monkeypatch, caplog):
    root = tmp_path
    d = root / "captures" / "2026-09-18"
    d.mkdir(parents=True)
    (d / "x_ECG.txt").write_text("a\n1\n")
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda captures, settle: set())
    monkeypatch.setattr(
        capture.sealbox,
        "seal_or_reissue",
        lambda *a, **kw: {
            "status": "FAIL",
            "at": "2026-09-21T00:00:00Z",
            "result": {"revision": 1},
            "reason": "signature: planted",
        },
    )
    capture._STOP = asyncio.Event()
    _stop_after(monkeypatch, 1)
    with caplog.at_level("WARNING"):
        _run(capture.seal_poller({"seal": {"enabled": True, "poll_sec": 1}}, str(root)))
    assert any("2026-09-18 → FAIL" in r.getMessage() for r in caplog.records)
    assert capture.STATUS["seal"]["nights"]["2026-09-18"]["revision"] == 1
    capture._STOP.clear()


def test_suite_version_reads_the_manifest_or_none(tmp_path, monkeypatch):
    assert capture._suite_version(str(tmp_path)) is not None  # the real repo root above capture-host/
    monkeypatch.setattr(capture.os.path, "dirname", lambda p: str(tmp_path))
    assert capture._suite_version(str(tmp_path)) is None
