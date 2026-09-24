# tepna-capture — tests/test_solid_night_inputs.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The SOLID-NIGHT band suppliers (SOLID-NIGHT-2026-09-23-BRIEF §3.4, amendments A1–A6), each term read from
a synthetic night laid out exactly as the box writes one (checked against 2026-09-23 on vigil): per-stream
`…SEAMS.txt` / `…RUNS.txt` sidecars, `PMDNEG.csv`, the ring's `RTCLOG.csv` and SpO₂ `.meta.json`, and the
loss audit's `wear` + per-gap `gaps`. A 2 Hz primary stream keeps the completeness arithmetic exact."""

import datetime as dt
import json

import solid_night_inputs as si

H10 = {"name": "Polar H10 02849638", "model": "H10"}
BASE = "Polar_H10_02849638_20260920230000"
T0 = dt.datetime(2026, 9, 20, 23, 0, 0)


def _ecg(d, seconds=200, rate=2.0, name=BASE, skip=()):
    rows = ["Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]"]
    for i in range(int(seconds * rate) + 1):
        if i in skip:
            continue
        t = T0 + dt.timedelta(seconds=i / rate)
        rows.append(f"{t.isoformat(timespec='milliseconds')};{i};{i};100")
    (d / f"{name}_ECG.txt").write_text("\n".join(rows) + "\n")


def _seams(d, rate="2", examined=10, name=BASE, stream="ECG"):
    lines = ["# stream=ecg rule=clock-seam bound_ms=60000 unit=ms basis=device-minus-host", "phone_ts;idx"]
    if rate is not None:
        lines.append(f"# pmd stream=ecg negotiated=yes rate={rate} offered={rate} configured= assumed=")
    lines.append(f"# final stream=ecg seams=0 examined={examined}")
    (d / f"{name}_{stream}SEAMS.txt").write_text("\n".join(lines) + "\n")


def _runs(d, stream, min_run=True, name=BASE):
    (d / f"{name}_{stream}.txt").exists() or (d / f"{name}_{stream}.txt").write_text("Phone timestamp;x\n")
    head = f"# stream={stream.lower()} rule=stuck" + (" min_run=30" if min_run else "")
    (d / f"{name}_{stream}RUNS.txt").write_text(head + "\nPhone timestamp;stream\n")


def _audit(d, *, gaps=(), reason="doff", end="2026-09-20T23:03:00", file=f"{BASE}_ECG.txt", journal="read",
           wear=None, gaps_key=True):
    dev = {"file": file, "wear": wear if wear is not None else {
        "available": True, "worn_end": {"at": end, "reason": reason, "file": file}}}
    if gaps_key:
        dev["gaps"] = [{"at": a, "s": s, "cause": c} for a, s, c in gaps]
    (d / "LOSS-AUDIT.json").write_text(json.dumps({"journal": journal, "devices": {H10["name"]: dev}}))


def _good_h10(d, **audit):
    _ecg(d)
    _seams(d)
    _runs(d, "ECG")
    _runs(d, "ACC")
    _audit(d, **audit)


def _bands(d, devices=(H10,)):
    return si.score_devices(str(d), list(devices))


# ── the whole path, one device ──────────────────────────────────────────────────────────────────────


def test_a_clean_h10_passes_every_term_but_timebase_which_names_what_it_waits_for(tmp_path):
    _good_h10(tmp_path)
    b = _bands(tmp_path)[H10["name"]]["bands"]
    assert {k: v["status"] for k, v in b.items()} == {
        "continuity": "PASS", "completeness": "PASS", "validity": "PASS", "clocks": "PASS", "timebase": "UNKNOWN"}
    assert b["timebase"]["reason"] == si.TIMEBASE_PENDING


def test_an_absent_primary_is_no_wear_or_radio_down_never_a_pass(tmp_path):
    b = _bands(tmp_path)[H10["name"]]["bands"]
    assert b == {"presence": {"status": "UNKNOWN", "reason": "no-wear or radio down — indistinguishable (§3.2)"}}


def test_a_model_with_no_stream_map_is_unknown(tmp_path):
    b = _bands(tmp_path, [{"name": "X", "model": "Nope"}])["X"]["bands"]
    assert b["presence"]["status"] == "UNKNOWN" and "'Nope'" in b["presence"]["reason"]


def test_no_loss_audit_leaves_the_interval_terms_unknown_and_still_scores_the_rest(tmp_path):
    _ecg(tmp_path)
    _seams(tmp_path)
    _runs(tmp_path, "ECG")
    b = _bands(tmp_path)[H10["name"]]["bands"]
    assert b["continuity"] == {"status": "UNKNOWN", "reason": "LOSS-AUDIT.json absent or unreadable"}
    assert b["completeness"]["status"] == "UNKNOWN" and b["validity"]["status"] == "PASS"


def test_a_worn_end_that_is_not_doff_is_indistinguishable_from_loss(tmp_path):
    _good_h10(tmp_path, reason="link-loss")
    b = _bands(tmp_path)[H10["name"]]["bands"]
    assert b["continuity"]["status"] == "UNKNOWN" and "`link-loss` — doff or loss" in b["continuity"]["reason"]
    assert b["completeness"]["reason"] == b["continuity"]["reason"]


# ── worn_interval ───────────────────────────────────────────────────────────────────────────────────


def test_worn_interval_refuses_every_missing_piece(tmp_path):
    _ecg(tmp_path)
    p = str(tmp_path / f"{BASE}_ECG.txt")
    spans = {p: si.first_last(p)}
    assert si.worn_interval({}, [], {})[2] == "no primary file this night"
    assert si.worn_interval({}, [p], {p: (None, None)})[2] == "the primary stream carries no readable row stamp"
    assert "has no entry" in si.worn_interval(None, [p], spans)[2]
    assert "older than #3010" in si.worn_interval({"wear": None}, [p], spans)[2]
    assert "no wear-end rule" in si.worn_interval(
        {"wear": {"available": False, "reason": "no wear-end rule for model 'X'"}}, [p], spans)[2]
    assert "gives no reason" in si.worn_interval({"wear": {"available": False}}, [p], spans)[2]
    assert "no file end" in si.worn_interval({"wear": {"available": True, "worn_end": None}}, [p], spans)[2]
    assert si.worn_interval(
        {"wear": {"available": True, "worn_end": {"at": "2026-09-20T23:03:00", "reason": "doff"}}}, [p], spans
    ) == (T0, dt.datetime(2026, 9, 20, 23, 3), None)


# ── continuity ──────────────────────────────────────────────────────────────────────────────────────


def _cont(tmp_path, **audit):
    _good_h10(tmp_path, **audit)
    return _bands(tmp_path)[H10["name"]]["bands"]["continuity"]


def test_continuity_without_a_journal_cannot_attribute(tmp_path):
    assert "could not read the journal" in _cont(tmp_path, journal="unavailable — every gap is unattributed")["reason"]


def test_continuity_without_per_gap_times_is_unknown(tmp_path):
    assert _cont(tmp_path, gaps_key=False) == {"status": "UNKNOWN", "reason": "no per-gap times in the loss audit"}


def test_an_audit_of_a_file_that_does_not_cover_the_worn_interval_is_not_examined(tmp_path):
    """2026-09-10: the audit's one file was the previous night's tail — its empty gap list meant nothing."""
    assert "does not cover" in _cont(tmp_path, file="some_other_night_ECG.txt")["reason"]
    late = tmp_path / "late"  # the worn end lies past the audited file's last row
    late.mkdir()
    assert "does not cover" in _cont(late, end="2026-09-20T23:59:00")["reason"]


def test_a_daemon_regression_inside_the_worn_interval_fails_and_one_outside_does_not(tmp_path):
    out = _cont(tmp_path, gaps=[("2026-09-20T23:01:00", 2.0, "daemon:clock re-sync")])
    assert out == {"status": "FAIL", "reason": "daemon regression inside the worn interval: daemon:clock re-sync"}
    d = tmp_path / "outside"
    d.mkdir()
    assert _cont(d, gaps=[("2026-09-20T23:10:00", 900.0, "daemon:not-worn drop")])["status"] == "PASS"


def test_a_no_journal_gap_inside_is_unknown(tmp_path):
    assert _cont(tmp_path, gaps=[("2026-09-20T23:01:00", 1.0, si.NO_JOURNAL)])["status"] == "UNKNOWN"


def test_unattributed_fails_on_minutes_or_on_count(tmp_path):
    assert _cont(tmp_path, gaps=[("2026-09-20T23:01:00", 60.0, "unattributed")])["status"] == "FAIL"
    d = tmp_path / "count"
    d.mkdir()
    five = [(f"2026-09-20T23:0{i}:10", 1.0, "unattributed") for i in range(1, 3)] * 2 + [
        ("2026-09-20T23:02:30", 1.0, "unattributed")]
    out = _cont(d, gaps=five)
    assert out["status"] == "FAIL" and out["reason"].startswith("5 unattributed gap(s)")
    d4 = tmp_path / "four"
    d4.mkdir()
    assert _cont(d4, gaps=five[:4])["status"] == "PASS"


def test_link_drops_fail_at_one_percent_of_the_worn_interval(tmp_path):
    assert _cont(tmp_path, gaps=[("2026-09-20T23:01:00", 1.8, "link:timeout / not found")])["status"] == "FAIL"
    d = tmp_path / "under"
    d.mkdir()
    assert _cont(d, gaps=[("2026-09-20T23:01:00", 1.7, "link:timeout / not found")])["status"] == "PASS"


def test_a_device_cause_inside_the_interval_is_not_a_continuity_failure(tmp_path):
    assert _cont(tmp_path, gaps=[("2026-09-20T23:01:00", 30.0, "device:powered off")])["status"] == "PASS"


def test_a_zero_length_interval_skips_the_link_fraction_rather_than_divide(tmp_path):
    _good_h10(tmp_path)
    p = str(tmp_path / f"{BASE}_ECG.txt")
    audit = json.loads((tmp_path / "LOSS-AUDIT.json").read_text())
    dev = audit["devices"][H10["name"]]
    dev["gaps"] = [{"at": "2026-09-20T23:00:00", "s": 5.0, "cause": "link:dbus busy"}]
    assert si.continuity(audit, dev, T0, T0, {p: si.first_last(p)})["status"] == "PASS"


# ── completeness and the negotiated rate ────────────────────────────────────────────────────────────


def test_completeness_counts_rows_only_inside_the_worn_interval(tmp_path):
    """The H10 of 09-23 kept emitting rows for 27½ min after doff; those rows must not rescue a short night."""
    _good_h10(tmp_path, end="2026-09-20T23:03:00")
    assert _bands(tmp_path)[H10["name"]]["bands"]["completeness"]["status"] == "PASS"


def test_completeness_fails_below_99_and_above_101_percent(tmp_path):
    _ecg(tmp_path, skip=set(range(10, 20)))
    _seams(tmp_path)
    _audit(tmp_path)
    out = _bands(tmp_path)[H10["name"]]["bands"]["completeness"]
    # 361 rows in [23:00:00, 23:03:00], less the 10 skipped, plus 23:03:00.5 (whole-second stamps — see
    # `rows_between`): 352 of 360.
    assert out["status"] == "FAIL" and "352 rows against 360 expected at 2 Hz" in out["reason"]
    d = tmp_path / "over"
    d.mkdir()
    _ecg(d, rate=2.2)
    _seams(d)
    _audit(d)
    assert _bands(d)[H10["name"]]["bands"]["completeness"]["status"] == "FAIL"


def test_the_rate_falls_back_to_pmdneg_and_never_to_a_nominal(tmp_path):
    _ecg(tmp_path)
    _seams(tmp_path, rate=None)
    _audit(tmp_path)
    (tmp_path / "PMDNEG.csv").write_text(
        "Phone timestamp;device;address;stream;requested_hz;offered_hz;chosen_hz;ack;how\n"
        "t;Polar H10 02849638;a;acc;;;200;ok;negotiated\n"
        "t;Polar H10 02849638;a;ecg;;;nan-ish;ok;negotiated\n"
        "t;Polar H10 02849638;a;ecg;;;0;ok;negotiated\n"
        "short;row\n"
        "t;Polar H10 02849638;a;ecg;;130;2;ok;negotiated\n")
    p = str(tmp_path / f"{BASE}_ECG.txt")
    assert si.negotiated_rate(str(tmp_path), H10["name"], "H10", p) == (2.0, "PMDNEG.csv")
    (tmp_path / "PMDNEG.csv").write_text("Phone timestamp;device\nt;Polar H10 02849638;a;ecg;;;130;refused;x\n")
    assert si.negotiated_rate(str(tmp_path), H10["name"], "H10", p)[0] is None  # an unacknowledged rate is none
    (tmp_path / "PMDNEG.csv").unlink()
    (tmp_path / f"{BASE}_ECGSEAMS.txt").unlink()
    r = si.negotiated_rate(str(tmp_path), H10["name"], "H10", p)
    assert r == (None, "negotiated rate not written beside the stream (#2912)")
    assert _bands(tmp_path)[H10["name"]]["bands"]["completeness"]["reason"] == r[1]


def test_a_pmd_line_with_a_zero_rate_is_not_a_rate(tmp_path):
    _ecg(tmp_path)
    _seams(tmp_path, rate="0")
    p = str(tmp_path / f"{BASE}_ECG.txt")
    assert si.negotiated_rate(str(tmp_path), H10["name"], "H10", p)[0] is None


def test_primary_files_that_disagree_on_rate_are_unknown(tmp_path):
    _ecg(tmp_path)
    _seams(tmp_path)
    _ecg(tmp_path, name="Polar_H10_02849638_20260920230500")
    _seams(tmp_path, rate="3", name="Polar_H10_02849638_20260920230500")
    p = [str(tmp_path / f"{BASE}_ECG.txt"), str(tmp_path / "Polar_H10_02849638_20260920230500_ECG.txt")]
    out = si.completeness(str(tmp_path), H10["name"], "H10", p, T0, T0 + dt.timedelta(seconds=10))
    assert out == {"status": "UNKNOWN", "reason": "the primary files disagree on their rate: [2.0, 3.0]"}
    assert si.completeness(str(tmp_path), H10["name"], "H10", p[:1], T0, T0)["reason"] == "the worn interval has no length"


def test_the_rings_spo2_takes_the_rate_its_writer_declared(tmp_path):
    spo2 = tmp_path / "Wellue_O2Ring-S_S8AW2100_20260920230000_SPO2.csv"
    spo2.write_text("Time,Oxygen Level\n23:00:00 20/09/2026,97\n")
    assert si.negotiated_rate(str(tmp_path), "Wellue O2Ring-S", "O2Ring-S", str(spo2))[1].startswith(
        "no rate declared")
    (tmp_path / (spo2.name + ".meta.json")).write_text(
        json.dumps({"acquisition_evidence": {"signal": "spo2_hr_motion@1Hz"}}))
    assert si.negotiated_rate(str(tmp_path), "Wellue O2Ring-S", "O2Ring-S", str(spo2)) == (
        1.0, "declared in the acquisition evidence (A6)")
    assert si.stream_files(str(tmp_path), "O2Ring-S", "SPO2") == [str(spo2)]
    assert si.first_last(str(spo2))[0] == T0


# ── validity (A4) and clocks ────────────────────────────────────────────────────────────────────────


def test_validity_needs_every_waveforms_sidecar_and_its_own_min_run(tmp_path):
    assert si.validity(str(tmp_path), "H10")["reason"].startswith("no waveform file")
    _ecg(tmp_path)
    assert "`Polar_H10_02849638_20260920230000_ECGRUNS.txt` absent" in si.validity(str(tmp_path), "H10")["reason"]
    _runs(tmp_path, "ECG", min_run=False)
    assert "publishes no min_run" in si.validity(str(tmp_path), "H10")["reason"]
    _runs(tmp_path, "ECG")
    assert si.validity(str(tmp_path), "H10")["status"] == "PASS"


def test_clocks_from_a_seam_sidecar_that_examined_rows_or_from_the_rings_rtc_read(tmp_path):
    assert si.clocks(str(tmp_path), "H10")["status"] == "UNKNOWN"
    _seams(tmp_path, examined=0)
    assert si.clocks(str(tmp_path), "H10")["status"] == "UNKNOWN"
    _seams(tmp_path, examined=5)
    assert si.clocks(str(tmp_path), "H10")["status"] == "PASS"
    rtc = tmp_path / "Wellue_O2Ring-S_S8AW2100_20260920230000_RTCLOG.csv"
    rtc.write_text("Phone timestamp;event;rtc_offset_s\nt;push;\nt;read;\n")
    assert si.clocks(str(tmp_path), "O2Ring-S")["status"] == "UNKNOWN"
    rtc.write_text("Phone timestamp;event;rtc_offset_s\nt;read;-1.6\n")
    assert si.clocks(str(tmp_path), "O2Ring-S")["status"] == "PASS"


# ── the expected list (§3.2) and read_json ──────────────────────────────────────────────────────────


def test_an_optional_backup_is_expected_only_on_a_night_it_captured(tmp_path):
    coospo = {"name": "COOSPO 808S", "model": "HRM808S", "optional": True}
    spare = {"name": "spare H10", "model": "H10", "optional": True}
    assert si.expected_devices(str(tmp_path), [coospo, spare, H10, "junk"]) == [H10]
    _ecg(tmp_path)
    assert si.expected_devices(str(tmp_path), [coospo, spare, H10]) == [spare, H10]


def test_read_json_refuses_absent_broken_and_non_object_files(tmp_path):
    assert si.read_json(str(tmp_path / "none.json")) is None
    (tmp_path / "bad.json").write_text("{")
    assert si.read_json(str(tmp_path / "bad.json")) is None
    (tmp_path / "list.json").write_text("[1]")
    assert si.read_json(str(tmp_path / "list.json")) is None
