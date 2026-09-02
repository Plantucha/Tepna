# tepna-capture — tests/test_audit6_f17_f18.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""DEEP-AUDIT-VI punch-list item 13 — two `capture.py` defects, one PR.

F18 — the stream-silence watchdog admitted the auto-start attempt record by the JOURNAL'S OBSERVED
SPAN, and the journal is one never-rotated file (6.45 days on vigil, 2026-09-01), so a marker from a
failed night four days earlier relabelled tonight's honest NEVER_STARTED as AUTOSTART_FAILED. The
record is now keyed against the Therapy-run ONSETS the journal observed inside the night window —
`_cpap_autostart_load`'s exact-session rule, with the journal standing in for the session the
watchdog does not hold.

F17 — `cpap.ble_stream.creds_path` / `edf_dir` / `raw_record_dir` were consumed verbatim, so a
RELATIVE value resolved against the daemon's cwd: creds silently "not paired", EDFs written into the
/opt checkout (the #2046 spool-root shape). Creds now resolve against the config directory (what the
example config already promised); the two sinks against the box root, like `resolve_spool_root`.
"""

import datetime as _d
import json
import os

import capture
import cpap_stream_watch as W

HDR = "host_ms;prior;state;transition;action;trigger;confidence;reachable;fg_state;x;y;z"


def _local_ms(day, hour, minute=0):
    return _d.datetime.combine(day, _d.time(hour, minute)).timestamp() * 1000.0


def _journal(root, rows):
    (root / "SESSIONDETECT.csv").write_text(
        "\n".join([HDR] + [f"{ms};i;i;;;i;f;True;{st};0;0;" for ms, st in rows]))


def _therapy_run(t0, n=720, step_ms=30_000):
    return [(t0 + i * step_ms, "Therapy") for i in range(n)]


def _week_of_nights(root):
    """A never-rotated journal: a 6 h Therapy run every night 2026-08-25 → 2026-09-01 at 23:00 local,
    each followed by a Standby row (so every run ENDS in the file). Returns the per-night onsets."""
    onsets = {}
    rows = []
    for k in range(8):
        day = _d.date(2026, 8, 25) + _d.timedelta(days=k)
        t0 = _local_ms(day, 23)
        onsets[day.isoformat()] = t0
        rows += _therapy_run(t0)
        rows.append((t0 + 720 * 30_000, "Standby"))
    _journal(root, rows)
    return onsets


# ── F18 · the record is keyed to a therapy ONSET inside the night, not to the journal's span ───────


def test_F18_repro_a_record_from_a_FAILED_night_days_earlier_cannot_relabel_tonight(tmp_path):
    """🔴 The audit's reproduction. The journal spans a week; the marker says 08-29 failed five times;
    the night being judged is 09-01, which nobody started. The old span check admitted the marker
    (08-29 lies inside 08-25..09-01) and the night wore "auto-start-failed … 5 time(s)" with the old
    night's error — the verdict whose response is OPPOSITE to the true one."""
    onsets = _week_of_nights(tmp_path)
    capture._cpap_autostart_save(str(tmp_path), onsets["2026-08-29"], attempts=5,
                                 last_error="AS11 not advertising")
    got = capture._cpap_stream_watch_row({}, str(tmp_path), "2026-09-01")
    assert got["state"] == W.NEVER_STARTED, got
    assert "attempts" not in got and "not advertising" not in (got.get("detail") or "")


def test_F18_the_SAME_journal_and_record_DO_relabel_the_night_the_record_describes(tmp_path):
    """The mirror, so the fix cannot be 'ignore every record': judged for 08-29 itself, the marker
    keyed to that night's onset is exactly the failed automation it records."""
    onsets = _week_of_nights(tmp_path)
    capture._cpap_autostart_save(str(tmp_path), onsets["2026-08-29"], attempts=5,
                                 last_error="AS11 not advertising")
    got = capture._cpap_stream_watch_row({}, str(tmp_path), "2026-08-29")
    assert got["state"] == W.AUTOSTART_FAILED
    assert got["attempts"] == 5 and "not advertising" in got["detail"]


def test_F18_the_night_WINDOW_alone_is_not_the_gate_a_key_inside_it_must_still_be_an_onset(tmp_path):
    """`_night_window_ms` spans d-1..d+1 — three days — so a window check alone would admit far more
    than the session. A key inside tonight's window that matches no observed Therapy onset (here: an
    hour into 09-01's run, i.e. a session the loop never keyed) must not count."""
    onsets = _week_of_nights(tmp_path)
    since, until = capture._night_window_ms("2026-09-01")
    key = onsets["2026-09-01"] + 3_600_000.0
    assert since <= key < until, "precondition: the key IS inside the window"
    capture._cpap_autostart_save(str(tmp_path), key, attempts=3, last_error="old")
    got = capture._cpap_stream_watch_row({}, str(tmp_path), "2026-09-01")
    assert got["state"] == W.NEVER_STARTED, got


def test_F18_the_ADJACENT_night_is_admitted_because_the_figures_sum_it(tmp_path):
    """Not a leak: the d-1..d+1 window mirrors the EDF folder walk (the AS11's date runs ~21 min
    ahead of the host), so judged for 08-30 the therapy figure INCLUDES 08-29 23:00's session, and a
    record keyed to that session explains part of the absent stream those figures report."""
    onsets = _week_of_nights(tmp_path)
    capture._cpap_autostart_save(str(tmp_path), onsets["2026-08-29"], attempts=3, last_error="old")
    got = capture._cpap_stream_watch_row({}, str(tmp_path), "2026-08-30")
    assert got["state"] == W.AUTOSTART_FAILED and got["therapy_min"] > 700, got


def test_F18_a_LIVE_key_lags_the_sighting_by_one_poll_and_still_matches(tmp_path):
    """The live loop keys `began_at_ms` at its own 5 s tick, after the detector wrote the onset row —
    a boot-seeded key equals the row exactly. Both must match; exact float equality would reject
    every live-keyed record and turn F18's fix into the opposite defect."""
    onsets = _week_of_nights(tmp_path)
    capture._cpap_autostart_save(str(tmp_path), onsets["2026-09-01"] + 5_000.0, attempts=2,
                                 last_error="link lost")
    got = capture._cpap_stream_watch_row({}, str(tmp_path), "2026-09-01")
    assert got["state"] == W.AUTOSTART_FAILED and got["attempts"] == 2


def test_F18_onsets_are_first_sightings_including_a_journal_that_OPENS_in_therapy():
    rows = [(10.0, "Therapy"), (40.0, "Therapy"), (70.0, "Standby"), (100.0, "Therapy"),
            (130.0, "Therapy"), (160.0, "Standby"), (190.0, "Therapy")]
    assert capture._therapy_onsets_ms(rows) == [10.0, 100.0, 190.0]
    # half-open window: the onset AT `until` is out, the one AT `since` is in
    assert capture._therapy_onsets_ms(rows, since_ms=100.0, until_ms=190.0) == [100.0]
    assert capture._therapy_onsets_ms([]) == []


def test_F18_the_predicate_itself():
    rows = [(1_000_000.0, "Standby"), (2_000_000.0, "Therapy"), (2_030_000.0, "Therapy"),
            (2_300_000.0, "Therapy")]
    ok = capture._autostart_record_in_night
    assert ok({"session_ms": 2_000_000.0}, None, None, rows)
    assert ok({"session_ms": 2_000_000.0 + capture._AUTOSTART_KEY_SLACK_MS}, None, None, rows)
    assert not ok({"session_ms": 2_000_000.0 + capture._AUTOSTART_KEY_SLACK_MS + 1}, None, None, rows)
    assert not ok({"session_ms": 2_300_000.0}, None, None, rows), "mid-run rows are not onsets"
    assert not ok({"session_ms": 2_000_000.0}, 3_000_000.0, 4_000_000.0, rows), "onset outside window"
    assert not ok({"session_ms": 1_000_000.0}, None, None, rows), "a Standby row keys nothing"
    assert not ok({"session_ms": None}, None, None, rows) and not ok({}, None, None, rows)
    assert not ok({"session_ms": "soon"}, None, None, rows)
    assert not ok({"session_ms": 2_000_000.0}, None, None, [])


def test_F18_an_UNPARSEABLE_night_name_still_keys_by_onset_never_by_span(tmp_path):
    """`_night_window_ms` yields (None, None) for a name it cannot parse; the predicate then admits
    any observed onset — but STILL an onset, so a key between runs stays out."""
    onsets = _week_of_nights(tmp_path)
    capture._cpap_autostart_save(str(tmp_path), onsets["2026-08-27"], attempts=1, last_error="x")
    assert capture._cpap_stream_watch_row({}, str(tmp_path), "not-a-night")["state"] == W.AUTOSTART_FAILED
    capture._cpap_autostart_save(str(tmp_path), onsets["2026-08-27"] + 3_600_000.0, attempts=1,
                                 last_error="x")
    assert capture._cpap_stream_watch_row({}, str(tmp_path), "not-a-night")["state"] == W.NEVER_STARTED


# ── F17 · relative CPAP paths never resolve against the cwd ────────────────────────────────────────


def test_F17_creds_path_resolves_against_the_CONFIG_directory(tmp_path):
    cfgp = str(tmp_path / "etc" / "config.yaml")
    assert capture.resolve_creds_path(None, cfgp) == str(tmp_path / "etc" / "as11_creds.json")
    assert capture.resolve_creds_path("", cfgp) == str(tmp_path / "etc" / "as11_creds.json")
    # the example config's own suggested value — the line that reproduced F17
    assert capture.resolve_creds_path("as11_creds.json", cfgp) == str(tmp_path / "etc" / "as11_creds.json")
    assert capture.resolve_creds_path("keys/as11.json", cfgp) == str(tmp_path / "etc" / "keys" / "as11.json")
    assert capture.resolve_creds_path("/abs/creds.json", cfgp) == "/abs/creds.json"


def test_F17_cpap_dirs_resolve_against_the_BOX_ROOT_and_absence_stays_off():
    assert capture.resolve_cpap_dir(None, "/srv/tepna") is None
    assert capture.resolve_cpap_dir("", "/srv/tepna") is None, "empty is the bus-only switch, not a default dir"
    assert capture.resolve_cpap_dir("captures/cpap-ble", "/srv/tepna") == "/srv/tepna/captures/cpap-ble"
    assert capture.resolve_cpap_dir("/var/cpap", "/srv/tepna") == "/var/cpap"
    assert capture._cpap_box_root({"root": "/srv/tepna"}, "/etc/tepna/config.yaml") == "/srv/tepna"
    assert capture._cpap_box_root({}, "/etc/tepna/config.yaml") == "/etc/tepna"


def test_F17_relative_creds_reach_the_controller_shadow_and_spool_starters(tmp_path, monkeypatch):
    """The three consumers all take the resolved path — a helper that exists but is wired into one
    of three sites is the half-wired shape. The cwd is moved somewhere the file is NOT, so the old
    behaviour cannot pass by accident."""
    etc = tmp_path / "etc"
    etc.mkdir()
    (etc / "as11_creds.json").write_text(json.dumps(
        {"masterPairKey": "aa" * 32, "clientId": "rel", "ble_addr": "AA:BB:CC:DD:EE:FF"}))
    elsewhere = tmp_path / "cwd"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    cfgp = str(etc / "config.yaml")
    cfg = {"root": str(tmp_path), "cpap": {"ble_stream": {"creds_path": "as11_creds.json"}}}

    ctl = capture._build_cpap_controller(object(), cfg, cfgp)
    assert ctl._load_creds()["clientId"] == "rel", "controller: relative creds_path → config dir"

    seen = []
    shadow_cfg = dict(cfg, as11_detector={"enabled": True})
    assert capture._maybe_start_as11_shadow(shadow_cfg, cfgp, str(tmp_path), object(), [],
                                            load_creds=lambda p: seen.append(p)) is None
    spool_cfg = dict(cfg, cpap={"ble_stream": {"creds_path": "as11_creds.json"},
                                "spool_pull": {"enabled": True}})
    assert capture._maybe_start_cpap_spool_pull(spool_cfg, cfgp, str(tmp_path), object(), [],
                                                load_creds=lambda p: seen.append(p)) is None
    assert seen == [str(etc / "as11_creds.json")] * 2, seen


def test_F17_relative_sinks_land_under_the_box_root_and_are_logged_at_wiring(tmp_path, caplog):
    import cpap_edf_writer
    cfg = {"root": str(tmp_path / "box"),
           "cpap": {"ble_stream": {"edf_dir": "captures/cpap-ble", "raw_record_dir": "captures/cpap-raw",
                                   "serial": "S1"}}}
    with caplog.at_level("INFO"):
        ctl = capture._build_cpap_controller(object(), cfg, str(tmp_path / "etc" / "config.yaml"))
    sink = ctl._edf_sink_factory()
    assert isinstance(sink, cpap_edf_writer.EdfSink)
    assert sink._out_root == str(tmp_path / "box" / "captures" / "cpap-ble")
    raw = ctl._raw_record_factory()
    assert os.path.dirname(raw._path) == str(tmp_path / "box" / "captures" / "cpap-raw"), raw._path
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("CPAP live stream wired"))
    assert str(tmp_path / "box" / "captures" / "cpap-ble") in line
    assert str(tmp_path / "box" / "captures" / "cpap-raw") in line
    assert str(tmp_path / "etc" / "as11_creds.json") in line, "the creds path the daemon will open"


def test_F17_the_wiring_line_names_the_OFF_sinks_rather_than_printing_None(tmp_path, caplog):
    with caplog.at_level("INFO"):
        capture._build_cpap_controller(object(), {"cpap": {}}, str(tmp_path / "config.yaml"))
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("CPAP live stream wired"))
    assert "bus-only" in line and "no raw record" in line and "None" not in line


def test_F17_a_config_WITHOUT_root_anchors_sinks_on_the_config_dir_never_the_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path / "." )
    cfg = {"cpap": {"ble_stream": {"edf_dir": "edf"}}}
    ctl = capture._build_cpap_controller(object(), cfg, str(tmp_path / "etc" / "config.yaml"))
    assert ctl._edf_sink_factory()._out_root == str(tmp_path / "etc" / "edf")


def test_F17_the_watchdog_and_the_inventory_read_the_SAME_resolved_edf_dir(tmp_path, monkeypatch):
    """The two readers of `edf_dir` must look where the writer wrote, or a relative value would
    make the watchdog report every night as never-recorded while the files sit one directory over."""
    box = tmp_path / "box"
    day = _d.date(2026, 8, 29)
    t0 = _local_ms(day, 23)
    box.mkdir()
    _journal(box, _therapy_run(t0))
    edf = box / "captures" / "cpap-ble" / "DATALOG" / "20260829" / "a_BRP.edf"
    edf.parent.mkdir(parents=True)
    h = bytearray(b" " * 256)
    h[236:244] = f"{720 * 30:<8d}".encode()
    h[244:252] = f"{1:<8g}".encode()
    edf.write_bytes(bytes(h))
    cfg = {"cpap": {"ble_stream": {"edf_dir": "captures/cpap-ble"}}}
    got = capture._cpap_stream_watch_row(cfg, str(box), "2026-08-29")
    assert got["state"] not in (W.NEVER_STARTED, W.UNKNOWN), got

    seen = {}
    import cpap_inventory_adapter

    monkeypatch.setattr(cpap_inventory_adapter, "on_harvest_complete",
                        lambda result, **kw: seen.update(kw) or {"discrepancies": 0})
    monkeypatch.setattr(capture, "_now", lambda: _d.datetime(2026, 8, 29, 23, 0, 0))
    night = box / "captures" / "2026-08-29"
    night.mkdir(parents=True)
    (night / "Polar_H10_02849638_20260829_ECG.txt").write_text("h\n1\n")
    capture._cpap_inventory_report({"files": 1}, cfg, str(box), str(box / "captures" / "cpap"))
    assert seen["envelope_root"] == str(box / "captures" / "cpap-ble")
