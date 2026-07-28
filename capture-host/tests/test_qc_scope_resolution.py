# tepna-capture — tests/test_qc_scope_resolution.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# WHICH FOLDER IS "THE NIGHT" — the question QC got wrong on every cross-midnight session.
#
# 2026-07-28, verbatim: the session ran 22:16 → 04:30, so every capture file was named into the
# `2026-07-27` folder. At 00:00:21 the LINK/CLOCK sidecars rolled and created `2026-07-28` holding
# nothing else. diskguard.active_nights() correctly reported BOTH folders active — its docstring
# anticipates exactly this — and capture._current_night then took max() of the two, which is lexical,
# and picked the sidecar-only decoy. nightqc.summarize's cross-midnight pooling could not repair it
# because that pooling was gated on `if data:` and the chosen folder had no data.
#
# QC therefore reported nine missing streams against 942 MB of healthy tri-device sleep recording, once
# every ten minutes, all night. Nothing was wrong with the capture; the verdict was about the wrong
# folder. These tests pin both halves of the fix and the scope verdict that makes the failure legible.

import os
import time

import capture
import nightqc


DEV = [{"name": "Polar H10 02849638", "device_id": "02849638", "model": "H10",
        "streams": ["ecg"], "address": "24:AC:AC:02:84:96"}]


def _mk(d, name, rows=3, mtime=None):
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name)
    with open(p, "w") as fh:
        fh.write("Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]\n")
        for i in range(rows):
            fh.write(f"2026-07-27T22:16:5{i};{i};0.0;{i}\n")
    if mtime is not None:
        os.utime(p, (mtime, mtime))
    return p


def _night_of_2026_07_28(tmp_path):
    """The real layout: data in the START-date folder, sidecars alone in the rolled-over one."""
    caps = str(tmp_path / "captures")
    d27, d28 = os.path.join(caps, "2026-07-27"), os.path.join(caps, "2026-07-28")
    now = time.time()
    _mk(d27, "Polar_H10_02849638_20260727221616_ECG.txt", rows=2910, mtime=now - 30)
    _mk(d28, "Tepna_20260728000021_LINK.csv", rows=5, mtime=now - 10)     # sidecar, NEWER
    _mk(d28, "Tepna_20260728000155_CLOCK.csv", rows=5, mtime=now - 10)    # sidecar, NEWER
    return caps, d27, d28


# ── Layer 1 · the resolver must follow the DATA, not the name ─────────────────────────────────────
def test_the_current_night_is_the_folder_holding_the_data(tmp_path):
    """Both folders are active and the sidecar-only one is lexically newer AND has newer mtimes.
    Only the data ranking gets this right."""
    caps, _, _ = _night_of_2026_07_28(tmp_path)
    assert capture._current_night(caps, 3600.0) == "2026-07-27"


def test_sidecars_never_break_the_tie(tmp_path):
    """A sidecar is the box talking about itself. It is not evidence that a session lives in a folder."""
    caps, d27, d28 = _night_of_2026_07_28(tmp_path)
    assert nightqc.newest_data_mtime(d28) is None
    assert nightqc.newest_data_mtime(d27) is not None


def test_a_session_crossing_two_midnights_still_resolves(tmp_path):
    """Pooling only reaches back one day, so a >24 h session is the resolver's job, not pooling's."""
    caps = str(tmp_path / "captures")
    now = time.time()
    _mk(os.path.join(caps, "2026-07-26"), "Polar_H10_02849638_20260726220000_ECG.txt", mtime=now - 30)
    for day in ("2026-07-27", "2026-07-28"):
        _mk(os.path.join(caps, day), f"Tepna_{day.replace('-', '')}000021_LINK.csv", mtime=now - 5)
    assert capture._current_night(caps, 3600.0) == "2026-07-26"


def test_with_no_data_anywhere_the_old_lexical_rule_still_applies(tmp_path):
    """Nothing to prefer ⇒ the newest name is as good an answer as exists. No behaviour change."""
    caps = str(tmp_path / "captures")
    now = time.time()
    for day in ("2026-07-27", "2026-07-28"):
        _mk(os.path.join(caps, day), f"Tepna_{day.replace('-', '')}000021_LINK.csv", mtime=now - 5)
    assert capture._current_night(caps, 3600.0) == "2026-07-28"


def test_an_idle_box_still_reports_on_last_night(tmp_path):
    """Everything settled ⇒ fall through to the newest night on disk, exactly as before."""
    caps = str(tmp_path / "captures")
    old = time.time() - 86400
    _mk(os.path.join(caps, "2026-07-27"), "Polar_H10_02849638_20260727221616_ECG.txt", mtime=old)
    assert capture._current_night(caps, 1200.0) == "2026-07-27"


# ── Layer 2 · pooling must work FROM the empty side ───────────────────────────────────────────────
def test_pooling_runs_when_the_folder_has_no_capture_file(tmp_path):
    """The old gate was `if data:`, so this could not run — and it is the 2026-07-28 shape exactly.
    Pointed at the sidecar-only folder, QC must still find the session next door."""
    caps, _, d28 = _night_of_2026_07_28(tmp_path)
    summ = nightqc.summarize(d28, DEV)
    assert summ["devices"][0]["streams"]["ecg"] == 2910, "the session's rows must be found"
    assert summ["missing"] == []
    assert "2026-07-27" in summ["searched_dirs"]


def test_pooling_from_the_data_side_is_unchanged(tmp_path):
    caps, d27, _ = _night_of_2026_07_28(tmp_path)
    assert nightqc.summarize(d27, DEV)["devices"][0]["streams"]["ecg"] == 2910


# ── Layer 3 · "everything missing" must not masquerade as a device fault ──────────────────────────
def test_scope_suspect_when_no_capture_file_is_found_anywhere(tmp_path):
    """Nine independent streams across three vendors do not fail in the same second. If the searched
    scope holds no capture file, that is a statement about where we looked."""
    caps = str(tmp_path / "captures")
    d = os.path.join(caps, "2026-07-28")
    _mk(d, "Tepna_20260728000021_LINK.csv")
    summ = nightqc.summarize(d, DEV)
    assert summ["scope_suspect"] is True
    assert summ["missing"], "missing is still honest about this scope"
    assert summ["ok"] is False


def test_a_located_session_is_never_scope_suspect(tmp_path):
    caps, _, d28 = _night_of_2026_07_28(tmp_path)
    assert nightqc.summarize(d28, DEV)["scope_suspect"] is False


def test_a_genuinely_missing_stream_is_not_scope_suspect(tmp_path):
    """The real fault this flag must never mask: data IS present, one declared stream produced none."""
    caps, d27, _ = _night_of_2026_07_28(tmp_path)
    two = DEV + [{"name": "Polar Verity Sense", "device_id": "0C301E3F", "model": "Verity",
                  "streams": ["ppg"], "address": "24:AC:AC:0C:30:1E"}]
    summ = nightqc.summarize(d27, two)
    assert summ["scope_suspect"] is False
    assert summ["missing"] == ["Polar Verity Sense:ppg"]


def test_no_devices_configured_is_not_scope_suspect(tmp_path):
    caps = str(tmp_path / "captures")
    d = os.path.join(caps, "2026-07-28")
    _mk(d, "Tepna_20260728000021_LINK.csv")
    assert nightqc.summarize(d, [])["scope_suspect"] is False


# ── Layer 4 · the verdict carries the ground it was computed from ────────────────────────────────
def test_the_summary_reports_its_own_scope(tmp_path):
    """`files: 2` WAS the tell on 2026-07-28 and nothing surfaced it as one."""
    caps, _, d28 = _night_of_2026_07_28(tmp_path)
    summ = nightqc.summarize(d28, DEV)
    assert summ["judged_dir"] == "2026-07-28"
    assert summ["searched_dirs"] == ["2026-07-28", "2026-07-27"]
    assert summ["data_files"] == 1


# ── newest_data_mtime · the unreadable-entry paths ────────────────────────────────────────────────
def test_an_unreadable_night_dir_is_none_not_a_crash(tmp_path):
    """QC is observability — it must never take capture down. A directory that cannot be listed is
    'no opinion', which is what None means here."""
    assert nightqc.newest_data_mtime(str(tmp_path / "does-not-exist")) is None


def test_a_directory_named_like_a_capture_file_is_not_data(tmp_path):
    """`parse_capture_name` reads a NAME; only a real file is evidence a session lives here."""
    d = str(tmp_path / "2026-07-27")
    os.makedirs(os.path.join(d, "Polar_H10_02849638_20260727221616_ECG.txt"))
    assert nightqc.newest_data_mtime(d) is None


def test_an_entry_that_vanishes_mid_scan_is_skipped(tmp_path, monkeypatch):
    """A night dir is being written while QC reads it; a file can disappear between listdir and stat.
    Skip that entry rather than losing the whole scan."""
    d = str(tmp_path / "2026-07-27")
    _mk(d, "Polar_H10_02849638_20260727221616_ECG.txt")

    def boom(_p):
        raise OSError("raced away")
    monkeypatch.setattr(nightqc.os.path, "getmtime", boom)
    assert nightqc.newest_data_mtime(d) is None


# ── Layer 3 · the consumer side: what qc_poller SAYS about an unlocatable session ─────────────────
def test_qc_poller_reports_a_scope_fault_as_a_scope_fault(tmp_path, monkeypatch, caplog):
    """The line that ran every ten minutes for 6 h 14 m on 2026-07-28 named nine streams as if nine
    things had broken, while 942 MB was being recorded next door. It must describe the right object —
    and it must NOT raise the 'night has a gap' alert, because no gap has been established."""
    import asyncio

    os.makedirs(str(tmp_path / "captures" / "2026-07-28"), exist_ok=True)
    monkeypatch.setattr(capture, "_current_night", lambda captures, settle: "2026-07-28")
    monkeypatch.setattr(capture.nightqc, "summarize", lambda night, devices: {
        "night": "2026-07-28", "missing": ["A:ecg", "A:acc", "B:ppg"], "devices": [],
        "scope_suspect": True, "judged_dir": "2026-07-28",
        "searched_dirs": ["2026-07-28", "2026-07-27"], "data_files": 0})
    sent = []

    class _N:
        async def send(self, title, message, **kw):
            sent.append(title)
            return True

    calls = {"n": 0}

    async def fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= 1:
            capture._STOP.set()
    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    capture._STOP.clear()
    try:
        with caplog.at_level("WARNING"):
            asyncio.run(capture.qc_poller({"qc": {"poll_sec": 1, "alert_after_sec": 0}, "devices": []},
                                          str(tmp_path), _N()))
    finally:
        capture._STOP.clear()
    msgs = [r.getMessage() for r in caplog.records]
    assert any("cannot locate the active session" in m for m in msgs), msgs
    assert any("SCOPE result, not a device fault" in m for m in msgs)
    assert any("2026-07-28 + 2026-07-27" in m for m in msgs), "the scope it searched must be named"
    assert sent == [], "a scope fault must not raise the night-has-a-gap alert"
