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


BATCH = 4  # rows per synthetic BLE batch: the residual is constant inside one, so anchors = batches


def _ecg(d, seconds=200, rate=2.0, name=BASE, skip=(), dev_jit=True, host_jit=True, dev_ppm=0.0):
    """A synthetic ECG stream with a REALISTIC device axis, which is a requirement and not a nicety.

    `clock.js` (CK_AXIS_DRAWN_SHARE) says a uniform synthetic device column is by construction
    indistinguishable from a fabricated one, and instructs a consumer moving to `deviceDrawn` to re-cut
    its fixtures. This column used to advance by exactly 1 ns per row, so every night built from it
    would have scored as a DRAWN axis. `dev_jit=False` re-creates that column deliberately, for the
    test that asserts the drawn detector fires.

    The host stamp follows the brief's model — one arrival per batch, `arrival + k/fs` within it — so
    the residual is constant inside a batch and steps between them. Jitter is NON-POSITIVE and skips
    the first and last batch, so no row crosses a second boundary and the completeness arithmetic that
    every other test in this file depends on is unchanged.
    """
    rows = ["Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]"]
    n = int(seconds * rate) + 1
    for i in range(n):
        if i in skip:
            continue
        ns = int(i / rate * 1e9 * (1.0 + dev_ppm / 1e6)) + ((i * 7919) % 211 if dev_jit else 0)
        # POSITIVE, deliberately: `rows_between` truncates to whole seconds, so a NEGATIVE jitter on a
        # row landing exactly on a second pulls it into the previous bucket and changes a completeness
        # count. Rows here sit at .000/.500, so +1..+5 ms cannot cross a boundary in either direction.
        jit = 0 if (not host_jit or i < BATCH or i >= n - BATCH) else (1 + (i // BATCH) % 5)
        t = T0 + dt.timedelta(seconds=i / rate, milliseconds=jit)
        rows.append(f"{t.isoformat(timespec='milliseconds')};{ns};{i};100")
    (d / f"{name}_ECG.txt").write_text("\n".join(rows) + "\n")


def _seams(d, rate="2", examined=10, name=BASE, stream="ECG"):
    lines = ["# stream=ecg rule=clock-seam bound_ms=60000 unit=ms basis=device-minus-host", "phone_ts;idx"]
    if rate is not None:
        lines.append(f"# pmd stream=ecg negotiated=yes rate={rate} offered={rate} configured= assumed=")
    lines.append(f"# final stream=ecg seams=0 examined={examined}")
    (d / f"{name}_{stream}SEAMS.txt").write_text("\n".join(lines) + "\n")


def _seam_rows(d, rows, name=BASE, stream="ECG", examined=10):
    """A SEAMS sidecar carrying real step rows, in the writer's own format.

    `rows` is [(host_ms_offset_from_T0, device_step_ms)] — the two columns `recorded_seams` joins on.
    The writer's own header is reproduced because the reader must skip it, and the `idx` column is
    written with a value the reader must NOT use (see `recorded_seams`: `idx` counts clocked samples,
    the reader joins on `phone_ts`). A wrong value there is therefore a decoy, not a fixture bug.
    """
    lines = ["# stream=ecg rule=clock-seam bound_ms=60000 unit=ms basis=device-minus-host",
             "phone_ts;idx;device_step_ms;phone_delta_ms;residual_ms;host_offset_ms;at_rel_ms"]
    for ms, step in rows:
        t = T0 + dt.timedelta(milliseconds=ms)
        lines.append(f"{t.strftime('%Y-%m-%dT%H:%M:%S.')}{t.microsecond // 1000:03d};999999;{step:.3f};0.000;{step:.3f};0.000;0.000")
    lines.append(f"# final stream=ecg seams={len(rows)} examined={examined}")
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
    # The reason CHANGED with PR-B and the change is the point: the band no longer says the scan is
    # unbuilt, it says the axis was measured — an independent clock at a plausible rate — and names the
    # ONE term still outstanding. Whole-band UNKNOWN is still correct while A5 has not run (§∅).
    assert "A5 step tripwire has not run" in b["timebase"]["reason"]
    assert "ppm" in b["timebase"]["reason"]


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


# ── §3.4 timebase · the residual pass (PR-B) ────────────────────────────────────────────────────────
def _tb(d, **kw):
    _ecg(d, **kw)
    _seams(d)
    _runs(d, "ECG")
    _runs(d, "ACC")
    _audit(d)
    return _bands(d)[H10["name"]]["bands"]["timebase"]


def test_the_realistic_fixture_is_not_read_as_drawn(tmp_path):
    """A CONTROL ON THE FIXTURE ITSELF. Every timebase assertion below is vacuous if the re-cut axis
    still concentrates: the drawn branch would short-circuit them all with a passing-looking UNKNOWN."""
    _ecg(tmp_path)
    scan = si.residual_scan(str(tmp_path / f"{BASE}_ECG.txt"), None, None)
    assert scan["reason"] is None
    assert scan["drawn_share"] < si.TB_DRAWN_SHARE, scan["drawn_share"]


def test_a_uniform_device_column_is_drawn_and_never_yields_a_rate(tmp_path):
    """`independent` CANNOT see this — a coarse counter reads as MORE independent, not less."""
    tb = _tb(tmp_path, dev_jit=False)
    assert tb["status"] == "UNKNOWN"
    # the SHARE, not just the word: a mutated tally still says "DRAWN"
    assert "DRAWN (100.0 % modal delta)" in tb["reason"], tb["reason"]


def test_a_host_column_that_only_rounds_the_device_is_not_a_second_clock(tmp_path):
    tb = _tb(tmp_path, host_jit=False)
    assert tb["status"] == "UNKNOWN"
    # the SPREAD itself: an inert host measures exactly 0.00 ms, not merely "small"
    assert "residual spread 0.00 ms" in tb["reason"], tb["reason"]


def test_an_implausible_rate_is_refused_never_corrected(tmp_path):
    tb = _tb(tmp_path, dev_ppm=200000.0)
    assert tb["status"] == "FAIL"
    # THE RATE ITSELF. A device 200000 ppm fast makes (host - device) FALL, so the reported rate is
    # NEGATIVE; pinning the number observes the formula rather than the branch it took. Without it,
    # every mutation of `ppm = (tailv - lead) / 1000.0 / span_s * 1e6` survived.
    assert "-188853 ppm over 3 min" in tb["reason"], tb["reason"]


def test_a_stream_with_no_device_column_says_so_rather_than_scoring_it(tmp_path):
    _ecg(tmp_path)
    (tmp_path / f"{BASE}_ECG.txt").write_text("Phone timestamp;ecg [uV]\n2026-09-20T23:00:00.000;100\n")
    _seams(tmp_path)
    _runs(tmp_path, "ECG")
    _runs(tmp_path, "ACC")
    _audit(tmp_path)
    tb = _bands(tmp_path)[H10["name"]]["bands"]["timebase"]
    assert tb["status"] == "UNKNOWN"
    assert "no device clock" in tb["reason"]


def test_anchors_are_batches_not_rows(tmp_path):
    """The brief's model: the residual is constant inside a batch, so one boundary = one anchor. A
    per-row anchor set would be BATCH times larger and would be an interpolation, not a measurement."""
    # At a REALISTIC row rate: the 1 s floor exists for a 130 Hz stream, where it is far coarser than
    # the batch period. At this file's usual 2 Hz the floor would fire every other row and the batch
    # structure would be invisible — a property of the fixture, not of the detector.
    _ecg(tmp_path, seconds=100, rate=20.0)
    scan = si.residual_scan(str(tmp_path / f"{BASE}_ECG.txt"), None, None)
    rows = 2001
    assert len(scan["anchors"]) < rows / 2, len(scan["anchors"])


def test_a_healthy_axis_stops_at_the_unbuilt_step_scan_rather_than_passing(tmp_path):
    """§∅: the A5 tripwire has not run, so the band must not claim a clean one."""
    tb = _tb(tmp_path)
    assert tb["status"] == "UNKNOWN"
    # a bounded, non-drifting host jitter is a REAL clock with NO rate: +0 ppm is the measurement.
    assert "an independent clock at +0 ppm over 3 min" in tb["reason"], tb["reason"]
    assert "A5 step tripwire has not run" in tb["reason"]


def test_an_unreadable_stream_is_named_not_scored(tmp_path):
    scan = si.residual_scan(str(tmp_path / "nope_ECG.txt"), None, None)
    assert "could not be opened" in scan["reason"]


def test_short_and_unparseable_rows_are_skipped_never_defaulted(tmp_path):
    """§∅: a row that measures nothing contributes nothing — it is not a zero anchor."""
    f = tmp_path / "x.txt"
    f.write_text(
        "Phone timestamp;sensor timestamp [ns];ecg\n"
        "2026-09-20T23:00:00.000\n"  # short: no ns column at all
        "not-a-stamp;5;1\n"  # unparseable stamp
        "2026-09-20T23:00:01.000;not-an-int;1\n"  # unparseable ns
        "2026-09-20T23:00:02.000;2000000000;1\n"
        "2026-09-20T23:00:03.000;3000000123;1\n"
        "2026-09-20T23:00:04.000;4000000456;1\n"
    )
    scan = si.residual_scan(str(f), None, None)
    assert scan["reason"] is None
    assert len(scan["anchors"]) == 3  # only the three well-formed rows


def test_too_few_anchors_says_how_many(tmp_path):
    _ecg(tmp_path, seconds=0.5)
    _seams(tmp_path)
    _runs(tmp_path, "ECG")
    _runs(tmp_path, "ACC")
    _audit(tmp_path)
    tb = _bands(tmp_path)[H10["name"]]["bands"]["timebase"]
    assert tb["status"] == "UNKNOWN" and "anchor(s)" in tb["reason"]


def test_anchors_that_span_no_time_yield_no_rate(tmp_path):
    """Every row stamped the same instant: a residual exists, a RATE cannot."""
    name = f"{BASE}_ECG.txt"
    (tmp_path / name).write_text(
        "Phone timestamp;sensor timestamp [ns];ecg\n"
        + "".join(f"2026-09-20T23:00:00.000;{ns};1\n" for ns in (0, 5_000_000, 12_000_000, 21_000_000))
    )
    _seams(tmp_path)
    _runs(tmp_path, "ECG")
    _runs(tmp_path, "ACC")
    _audit(tmp_path)
    tb = _bands(tmp_path)[H10["name"]]["bands"]["timebase"]
    assert tb["status"] == "UNKNOWN" and "span no time" in tb["reason"]


def test_median_is_the_middle_sample_odd_and_the_mean_of_two_even():
    """Pinned directly. `_median` is the whole of the ppm endpoints and of the A5 windows to come, and
    every mutation of it survived a suite that only ever observed which BRANCH fired."""
    assert si._median([3.0, 1.0, 2.0]) == 2.0
    assert si._median([4.0, 1.0, 2.0, 3.0]) == 2.5
    assert si._median([5.0]) == 5.0


def test_a_real_drift_is_measured_and_pins_the_median_windows(tmp_path):
    """A DRIFTING axis, which the flat fixtures cannot test. The ppm endpoints are a width-21 median at
    each end, so with no drift the answer is +0 whatever the window is — every mutation of the slice
    bounds survives. Under a real drift the number moves with the window, so pinning it observes the
    bounds themselves. -464 ppm for a device running 500 ppm fast: the host-minus-device residual FALLS,
    and the median-of-ends estimator under-reads the planted rate by the known end-clamp bias (§7)."""
    tb = _tb(tmp_path, dev_ppm=500.0)
    assert tb["status"] == "UNKNOWN"
    assert "an independent clock at -464 ppm over 3 min" in tb["reason"], tb["reason"]
    # and the reason NAMES THE FILE it judged. Without this a `who = None` mutation passes every other
    # assertion here, and the band would tell a reader "`None` ... at -464 ppm".
    assert tb["reason"].startswith(f"`{BASE}_ECG.txt`"), tb["reason"]


# ── the mutation survivors: each test below FAILS on a named mutant (#3046) ──────────────────────────
def _pairs(d, pairs, name=BASE):
    """An ECG file from explicit (host_ms_offset, sensor_ns) pairs — exact control of anchors, spread,
    span and the drawn share, which the parameterised `_ecg` cannot give at a boundary."""
    rows = ["Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]"]
    for ms, ns in pairs:
        t = T0 + dt.timedelta(milliseconds=ms)
        rows.append(f"{t.isoformat(timespec='milliseconds')};{ns};0;100")
    (d / f"{name}_ECG.txt").write_text("\n".join(rows) + "\n")


def _tb_pairs(d, pairs, **audit):
    _pairs(d, pairs)
    _seams(d); _runs(d, "ECG"); _runs(d, "ACC"); _audit(d, **audit)
    return _bands(d)[H10["name"]]["bands"]["timebase"]


def test_no_worn_interval_reaches_timebase_and_says_so(tmp_path):
    """Kills the four mutants of that `return`: a swapped status, a dropped status, a dropped reason.
    Nothing reached this branch before — the whole return was unexecuted."""
    tb = _tb_pairs(tmp_path, [(0, 0), (1000, 1_000_000_000)], reason="link-loss")
    assert tb["status"] == "UNKNOWN"
    assert tb["reason"] == "no worn interval, so no stretch of the axis could be judged"


def test_the_largest_primary_is_the_one_judged(tmp_path):
    """Kills `key=os.path.getsize` -> `key=None` and the dropped key. Two primaries: the LARGER carries a
    realistic axis, the smaller a DRAWN one. Judge the wrong file and the band says DRAWN."""
    _ecg(tmp_path, seconds=200)  # large, realistic
    _pairs(tmp_path, [(0, 0), (1000, 1_000_000), (2000, 2_000_000)],
           name="Polar_H10_02849638_20260920235900")  # small, uniform deltas = drawn
    _seams(tmp_path); _runs(tmp_path, "ECG"); _runs(tmp_path, "ACC"); _audit(tmp_path)
    tb = _bands(tmp_path)[H10["name"]]["bands"]["timebase"]
    assert "DRAWN" not in tb["reason"], tb["reason"]


def test_exactly_three_anchors_is_ENOUGH_not_too_few(tmp_path):
    """Kills `len(anchors) < TB_MIN_ANCHORS` -> `<=`. Three is the contract's minimum, so three must
    PASS the check; the boundary is the only place the two spellings differ."""
    tb = _tb_pairs(tmp_path, [(0, 0), (1000, 1_000_000_000), (2000, 2_000_500_000)])
    assert "anchor(s)" not in tb["reason"], tb["reason"]


def test_a_spread_of_exactly_two_ms_is_INERT_not_independent(tmp_path):
    """Kills `spread <= TB_INERT_MS` -> `<`. Twice the stamp quantum is the inert BOUND, so a spread
    sitting exactly on it is still inert."""
    # residuals 0,+1,+2,+1,0 ms -> spread EXACTLY 2.00. Device deltas alternate 999/1001 ms so the modal
    # share is 0.5 and the DRAWN branch (which is checked first) does not swallow the case.
    tb = _tb_pairs(tmp_path, [(0, 0), (1000, 999_000_000), (2000, 1_998_000_000),
                              (3000, 2_999_000_000), (4000, 4_000_000_000)])
    assert tb["status"] == "UNKNOWN"
    assert "residual spread 2.00 ms" in tb["reason"], tb["reason"]


def test_a_span_of_exactly_one_second_is_ENOUGH_time(tmp_path):
    """Kills `span_s <= 0` -> `<= 1`. Zero is the only span that carries no time; one second carries a
    second. Residuals 0,+5,+3,+8,+4 ms keep the spread above the inert bound and the device deltas
    non-uniform, so neither earlier branch swallows the case."""
    tb = _tb_pairs(tmp_path, [(0, 0), (300, 295_000_000), (600, 597_000_000),
                              (900, 892_000_000), (1000, 996_000_000)])
    assert "span no time" not in tb["reason"], tb["reason"]


def test_a_modal_share_of_exactly_the_threshold_is_DRAWN(tmp_path):
    """Kills `share >= TB_DRAWN_SHARE` -> `>`. 0.67 is the measured separator — real streams max 0.56,
    drawn min 0.79 — so a stream sitting exactly on it is drawn. 101 rows: 67 of the 100 device deltas
    identical, the other 33 distinct, and the host residual moves on every row so each is an anchor."""
    pairs, ns = [(0, 0)], 0
    for i in range(1, 101):
        ns += 1_000_000_000 if i <= 67 else 1_000_000_000 + i * 1_000_000
        pairs.append((i * 1000 + (i % 7), ns))
    tb = _tb_pairs(tmp_path, pairs, end="2026-09-20T23:10:00")
    assert tb["status"] == "UNKNOWN"
    assert "DRAWN (67.0 % modal delta)" in tb["reason"], tb["reason"]


def test_a_rate_exactly_at_the_refusal_bound_is_REFUSED(tmp_path):
    """Kills `abs(ppm) >= TB_MAX_PPM` -> `>`. The bound is a REFUSAL bound (Clock Contract §7), so a rate
    sitting exactly on it is refused, not admitted.

    Constructed, not searched: 22 anchors, the residual falling exactly 1050 ms per second, so with a
    width-21 median at each end the endpoints are r[10] and r[11] and the difference is exactly 1050 ms
    over a 21.000 s span -> -50000.0 ppm to the bit. The host stamp carries a two-period jitter
    `(i%3)*7 + (i%7)*11` which is ZERO at both i=0 and i=21 — so the span stays exactly 21 s while the
    DEVICE deltas take four distinct values (modal share 0.571), keeping the drawn branch from
    swallowing the case before the rate is ever computed."""
    pairs = []
    for i in range(22):
        h = 1000 * i + (i % 3) * 7 + (i % 7) * 11
        pairs.append((h, (h + 1050 * i) * 1_000_000))
    tb = _tb_pairs(tmp_path, pairs)
    assert tb["status"] == "FAIL", tb
    assert "-50000 ppm over 0 min" in tb["reason"], tb["reason"]


def test_the_ppm_scale_is_observed_at_a_rounding_edge(tmp_path):
    """Kills `* 1e6` -> `* 1000001.0`. That is a RELATIVE change of 1e-6, invisible to every assertion
    that reads an integer ppm — unless the value is placed just under a .5 boundary, where the extra
    0.04 ppm tips the rounding. Constructed at -40000.48: the baseline reports `-40000`, the mutant
    `-40001`. Deliberately BELOW the refusal bound, so the status stays UNKNOWN and the number in the
    reason is the only thing under test."""
    pairs, k = [], 40000.48 * 21.0 / 1000.0
    for i in range(22):
        h = 1000 * i + (i % 3) * 7 + (i % 7) * 11
        pairs.append((h, round((h + k * i) * 1_000_000)))
    tb = _tb_pairs(tmp_path, pairs)
    assert tb["status"] == "UNKNOWN", tb
    assert "at -40000 ppm" in tb["reason"], tb["reason"]


# ── ONE DEVICE CLOCK PER SEGMENT — night 1's FAIL, and the control that says the fix is surgical ─────
def _stepped(d, step_ms, at_min=12, minutes=24, rate=2.0, ppm=20.0):
    """A two-clock ECG whose device counter STEPS once, exactly as night 1's H10 did.

    Both segments drift at the same small `ppm` so a per-segment fit lands in the low tens; the step is
    added to every device stamp at or after `at_min`, and a SEAMS row records it where the box would.
    """
    pairs, seam_at = [], None
    n = int(minutes * 60 * rate)
    for i in range(n):
        host_ms = i * (1000.0 / rate)
        # PER-ROW DEVICE JITTER, and it is a requirement: a uniform device column scores as a DRAWN
        # axis (`_ecg`'s docstring) and the drawn gate returns BEFORE the segment split is reached.
        # Measured while writing this: without it all four new tests read `DRAWN … not a clock`.
        dev_ms = host_ms * (1.0 + ppm / 1e6) + ((i * 7919) % 211) / 1e6
        if host_ms >= at_min * 60_000:
            if seam_at is None:
                seam_at = host_ms
            dev_ms += step_ms
        pairs.append((host_ms, int(round(dev_ms * 1e6))))
    _pairs(d, pairs)
    _seam_rows(d, [(seam_at, step_ms)])
    _runs(d, "ECG"); _runs(d, "ACC")
    # THE WORN INTERVAL MUST COVER THE FIXTURE, or the seam falls outside it and nothing splits. The
    # default `_audit` end is 23:03, three minutes after T0 — measured while writing this: with it, a
    # 24-minute fixture was judged over 3 min, the minute-12 seam was correctly excluded as unworn, and
    # all three step tests read as one clean segment. A fixture that does not reach the thing it plants.
    _audit(d, end=(T0 + dt.timedelta(minutes=minutes)).isoformat())
    return _bands(d)[H10["name"]]["bands"]["timebase"]


def test_a_recorded_clock_step_is_SEGMENTED_not_quoted_as_a_rate(tmp_path):
    """🔴 NIGHT 1's FAIL. The owner's 22:01 time-sync click left the H10 with a 2.44e8 s device step;
    one fit across it quoted −10,592,683,838 ppm and FAILED the night on rate. Both halves are fine."""
    tb = _stepped(tmp_path, step_ms=2.44e8 * 1000.0)
    assert tb["status"] != "FAIL", tb["reason"]
    assert "2 segment(s), never across a step" in tb["reason"], tb["reason"]
    assert "1 recorded clock seam(s)" in tb["reason"], tb["reason"]
    # the magnitude is reported in seconds, and NOT as ppm — a step of any size is never a rate
    assert "+2.44e+08 s" in tb["reason"], tb["reason"]
    import re as _re
    quoted = [int(m) for m in _re.findall(r"([-+]\d+) ppm", tb["reason"])]
    assert quoted and all(abs(q) < 100 for q in quoted), tb["reason"]


def test_the_step_MAGNITUDE_does_not_change_the_verdict(tmp_path):
    """A step is a step. 4 ms over the bound and 2.44e8 s land in the same place — the size decides
    nothing, which is the whole point of not treating it as a rate."""
    small = _stepped(tmp_path, step_ms=61_000.0)
    assert small["status"] != "FAIL", small["reason"]
    assert "2 segment(s), never across a step" in small["reason"], small["reason"]


def test_CONTROL_no_seam_means_ONE_segment_and_the_number_is_unchanged(tmp_path):
    """The control that makes the fix surgical: with no SEAMS rows the axis is judged exactly as before —
    one segment, no seam note, and the per-file wording the 46 pre-existing tests already pin."""
    d = tmp_path
    pairs = [(i * 500.0, int(round(i * 500.0 * 1.00002 * 1e6)) + ((i * 7919) % 211)) for i in range(2880)]
    _pairs(d, pairs); _seams(d); _runs(d, "ECG"); _runs(d, "ACC")
    _audit(d, end=(T0 + dt.timedelta(minutes=24)).isoformat())
    tb = _bands(d)[H10["name"]]["bands"]["timebase"]
    assert "segment" not in tb["reason"], tb["reason"]
    assert "recorded clock seam" not in tb["reason"], tb["reason"]
    assert "axis is an independent clock at" in tb["reason"], tb["reason"]


def test_a_seam_OUTSIDE_the_worn_interval_does_not_split_the_axis(tmp_path):
    """A step nobody was wearing through is not this night's axis change. Keyed on the worn interval,
    like every other band — otherwise a seam from the pre-wear setup would segment a clean night."""
    d = tmp_path
    pairs = [(i * 500.0, int(round(i * 500.0 * 1.00002 * 1e6)) + ((i * 7919) % 211)) for i in range(2880)]
    _pairs(d, pairs)
    _seam_rows(d, [(-3_600_000, 2.44e11)])   # an hour before T0, i.e. before the worn interval
    _runs(d, "ECG"); _runs(d, "ACC")
    _audit(d, end=(T0 + dt.timedelta(minutes=24)).isoformat())
    tb = _bands(d)[H10["name"]]["bands"]["timebase"]
    assert "recorded clock seam" not in tb["reason"], tb["reason"]


def test_a_segment_with_too_few_anchors_is_UNKNOWN_and_names_the_seam(tmp_path):
    """The worst-of-segments rule, and the honest shape of a short tail: a step 30 s before the end
    leaves a segment that cannot be judged, which is UNKNOWN — never a silent drop of that stretch."""
    tb = _stepped(tmp_path, step_ms=2.44e8 * 1000.0, at_min=23.98, minutes=24)
    assert tb["status"] == "UNKNOWN", tb["reason"]
    assert "recorded clock seam" in tb["reason"], tb["reason"]


def test_an_unparseable_seam_row_splits_NOTHING(tmp_path):
    """§∅ at the reader: a row this cannot place is not a step of zero. Splitting at a guessed sample
    would be worse than not splitting — it would judge two stretches that are not the two segments."""
    d = tmp_path
    pairs = [(i * 500.0, int(round(i * 500.0 * 1.00002 * 1e6)) + ((i * 7919) % 211)) for i in range(2880)]
    _pairs(d, pairs)
    (d / f"{BASE}_ECGSEAMS.txt").write_text(
        "# stream=ecg rule=clock-seam bound_ms=60000 unit=ms basis=device-minus-host\n"
        "phone_ts;idx;device_step_ms;phone_delta_ms;residual_ms;host_offset_ms;at_rel_ms\n"
        "not-a-timestamp;9;61000.000;0;0;0;0\n"          # unparseable host stamp
        "2026-09-20T23:12:00.000;9;not-a-number;0;0;0;0\n"  # unparseable magnitude
        "2026-09-20T23:12:00.000;9\n")                      # short row
    _runs(d, "ECG"); _runs(d, "ACC")
    _audit(d, end=(T0 + dt.timedelta(minutes=24)).isoformat())
    tb = _bands(d)[H10["name"]]["bands"]["timebase"]
    assert "recorded clock seam" not in tb["reason"], tb["reason"]


def test_the_seam_CAUSE_is_read_from_the_night_and_never_inferred(tmp_path):
    """The cause comes from the night's own clock record or it is absent. A magnitude is not a cause."""
    d = tmp_path
    (d / "CLOCKSYNC.csv").write_text("at;event\n2026-09-20T23:12:00;resynced\n")
    tb = _stepped(d, step_ms=2.44e8 * 1000.0)
    assert "`CLOCKSYNC.csv` records a clock event this night" in tb["reason"], tb["reason"]


def test_an_UNREADABLE_clock_record_names_no_cause_rather_than_guessing_one(tmp_path):
    """A directory where `CLOCKSYNC.csv` cannot be opened must report "no cause recorded" — the reader
    moves to the next record and, finding none, says so. It never promotes the step into its own cause."""
    d = tmp_path
    (d / "CLOCKSYNC.csv").mkdir()   # a directory at that name: open() raises OSError, not ValueError
    (d / "CLOCK.csv").mkdir()
    tb = _stepped(d, step_ms=2.44e8 * 1000.0)
    assert "no cause recorded this night" in tb["reason"], tb["reason"]


def test_a_seam_at_the_very_FIRST_anchor_and_one_after_the_LAST_leave_no_empty_segment(tmp_path):
    """The two boundary cases of the split walk: a seam at or before anchor 0 opens no leading segment,
    and a seam past the last anchor closes none. Both must yield ONE real segment, never an empty one —
    an empty segment would be judged as "0 anchors, under 3" and report a shortfall that is an artifact."""
    d = tmp_path
    pairs = [(i * 500.0, int(round(i * 500.0 * 1.00002 * 1e6)) + ((i * 7919) % 211)) for i in range(2880)]
    _pairs(d, pairs)
    last_ms = 2879 * 500.0
    _seam_rows(d, [(0.0, 61_000.0), (last_ms + 1000.0, 61_000.0)])
    _runs(d, "ECG"); _runs(d, "ACC")
    _audit(d, end=(T0 + dt.timedelta(minutes=25)).isoformat())
    tb = _bands(d)[H10["name"]]["bands"]["timebase"]
    assert "2 recorded clock seam(s)" in tb["reason"], tb["reason"]
    assert "judged in 1 segment(s)" in tb["reason"], tb["reason"]
    assert tb["status"] != "FAIL", tb["reason"]


def test_a_READABLE_clock_record_with_no_event_names_no_cause(tmp_path):
    """Distinct from the unreadable case: both records open fine and neither mentions a clock event, so
    the loop exhausts and the reader says "no cause recorded" — it does not fall back to the magnitude."""
    d = tmp_path
    (d / "CLOCKSYNC.csv").write_text("at;event\n2026-09-20T23:12:00;battery\n")
    (d / "CLOCK.csv").write_text("at;event\n2026-09-20T23:13:00;nothing here\n")
    tb = _stepped(d, step_ms=2.44e8 * 1000.0)
    assert "no cause recorded this night" in tb["reason"], tb["reason"]
