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
    lines = [
        "# stream=ecg rule=clock-seam bound_ms=60000 unit=ms basis=device-minus-host",
        "phone_ts;idx;device_step_ms;phone_delta_ms;residual_ms;host_offset_ms;at_rel_ms",
    ]
    for ms, step in rows:
        t = T0 + dt.timedelta(milliseconds=ms)
        lines.append(
            f"{t.strftime('%Y-%m-%dT%H:%M:%S.')}{t.microsecond // 1000:03d};999999;{step:.3f};0.000;{step:.3f};0.000;0.000"
        )
    lines.append(f"# final stream=ecg seams={len(rows)} examined={examined}")
    (d / f"{name}_{stream}SEAMS.txt").write_text("\n".join(lines) + "\n")


def _runs(d, stream, min_run=True, name=BASE):
    (d / f"{name}_{stream}.txt").exists() or (d / f"{name}_{stream}.txt").write_text("Phone timestamp;x\n")
    head = f"# stream={stream.lower()} rule=stuck" + (" min_run=30" if min_run else "")
    (d / f"{name}_{stream}RUNS.txt").write_text(head + "\nPhone timestamp;stream\n")


def _audit(
    d,
    *,
    gaps=(),
    reason="doff",
    end="2026-09-20T23:03:00",
    file=f"{BASE}_ECG.txt",
    journal="read",
    wear=None,
    gaps_key=True,
    clock_events=(),
):
    dev = {
        "file": file,
        "wear": wear
        if wear is not None
        else {"available": True, "worn_end": {"at": end, "reason": reason, "file": file}},
    }
    if gaps_key:
        dev["gaps"] = [{"at": a, "s": s, "cause": c} for a, s, c in gaps]
    obj = {"journal": journal, "devices": {H10["name"]: dev}}
    # `clock_events=None` is "journalctl was unavailable", `()` is "read, and nothing happened", and
    # omitting the key entirely is an audit written before the record existed. Three different absences,
    # and A5 must tell them apart, so the fixture can produce each.
    if clock_events != "absent":
        obj["clock_events"] = None if clock_events is None else list(clock_events)
    (d / "LOSS-AUDIT.json").write_text(json.dumps(obj))


def _good_h10(d, **audit):
    _ecg(d)
    _seams(d)
    _runs(d, "ECG")
    _runs(d, "ACC")
    _audit(d, **audit)


def _bands(d, devices=(H10,)):
    return si.score_devices(str(d), list(devices))


# ── the whole path, one device ──────────────────────────────────────────────────────────────────────


def test_a_clean_h10_now_passes_EVERY_term_including_the_timebase(tmp_path):
    _good_h10(tmp_path)
    b = _bands(tmp_path)[H10["name"]]["bands"]
    assert {k: v["status"] for k, v in b.items()} == {
        "continuity": "PASS",
        "completeness": "PASS",
        "validity": "PASS",
        "clocks": "PASS",
        "timebase": "PASS",
    }
    # A5 HAS NOW RUN, and this is the assertion that changes: a clean axis with the record set readable
    # and no candidate PASSES. Until the tripwire was built every night read UNKNOWN here by
    # construction, so the 14-night run could never start — this is the term that unblocked it.
    assert b["timebase"]["status"] == "PASS"
    # A PASS publishes what it passed ON — the rate, the span, and which record sources were read. A band
    # that goes silent on success makes a healthy night unauditable later.
    assert "an independent clock at +0 ppm over 3 min" in b["timebase"]["reason"]
    assert "the A5 tripwire found no unrecorded shift" in b["timebase"]["reason"]
    assert "seam sidecar + journal clock events + CLOCKSYNC.csv" in b["timebase"]["reason"]


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
    assert (
        "no wear-end rule"
        in si.worn_interval({"wear": {"available": False, "reason": "no wear-end rule for model 'X'"}}, [p], spans)[2]
    )
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
        ("2026-09-20T23:02:30", 1.0, "unattributed")
    ]
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
        "t;Polar H10 02849638;a;ecg;;130;2;ok;negotiated\n"
    )
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
    assert (
        si.completeness(str(tmp_path), H10["name"], "H10", p[:1], T0, T0)["reason"] == "the worn interval has no length"
    )


def test_the_rings_spo2_takes_the_rate_its_writer_declared(tmp_path):
    spo2 = tmp_path / "Wellue_O2Ring-S_S8AW2100_20260920230000_SPO2.csv"
    spo2.write_text("Time,Oxygen Level\n23:00:00 20/09/2026,97\n")
    assert si.negotiated_rate(str(tmp_path), "Wellue O2Ring-S", "O2Ring-S", str(spo2))[1].startswith("no rate declared")
    (tmp_path / (spo2.name + ".meta.json")).write_text(
        json.dumps({"acquisition_evidence": {"signal": "spo2_hr_motion@1Hz"}})
    )
    assert si.negotiated_rate(str(tmp_path), "Wellue O2Ring-S", "O2Ring-S", str(spo2)) == (
        1.0,
        "declared in the acquisition evidence (A6)",
    )
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
def _tb(d, clock_events=(), **kw):
    _ecg(d, **kw)
    _seams(d)
    _runs(d, "ECG")
    _runs(d, "ACC")
    _audit(d, clock_events=clock_events)
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


def test_a_healthy_axis_stops_when_the_A5_RECORD_SET_cannot_be_read(tmp_path):
    """§∅: the tripwire must not fire without the records to check against, and it must not PASS over an
    unexamined term either. A `LOSS-AUDIT.json` written before the clock-event record existed carries no
    `clock_events` key at all, which is an absence and not an empty record set."""
    tb = _tb(tmp_path, clock_events="absent")
    assert tb["status"] == "UNKNOWN"
    # a bounded, non-drifting host jitter is a REAL clock with NO rate: +0 ppm is the measurement.
    assert "an independent clock at +0 ppm over 3 min" in tb["reason"], tb["reason"]
    assert "A5 record set could not be read" in tb["reason"]
    assert "predates the clock-event record" in tb["reason"]


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
    # The status moved to PASS when A5 was built; the LINE is what this test pins, and it is unchanged.
    assert tb["status"] == "PASS"
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
    _seams(d)
    _runs(d, "ECG")
    _runs(d, "ACC")
    _audit(d, **audit)
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
    _pairs(
        tmp_path, [(0, 0), (1000, 1_000_000), (2000, 2_000_000)], name="Polar_H10_02849638_20260920235900"
    )  # small, uniform deltas = drawn
    _seams(tmp_path)
    _runs(tmp_path, "ECG")
    _runs(tmp_path, "ACC")
    _audit(tmp_path)
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
    tb = _tb_pairs(
        tmp_path, [(0, 0), (1000, 999_000_000), (2000, 1_998_000_000), (3000, 2_999_000_000), (4000, 4_000_000_000)]
    )
    assert tb["status"] == "UNKNOWN"
    assert "residual spread 2.00 ms" in tb["reason"], tb["reason"]


def test_a_span_of_exactly_one_second_is_ENOUGH_time(tmp_path):
    """Kills `span_s <= 0` -> `<= 1`. Zero is the only span that carries no time; one second carries a
    second. Residuals 0,+5,+3,+8,+4 ms keep the spread above the inert bound and the device deltas
    non-uniform, so neither earlier branch swallows the case."""
    tb = _tb_pairs(tmp_path, [(0, 0), (300, 295_000_000), (600, 597_000_000), (900, 892_000_000), (1000, 996_000_000)])
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
    assert tb["status"] == "PASS", tb
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
    _runs(d, "ECG")
    _runs(d, "ACC")
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
    _pairs(d, pairs)
    _seams(d)
    _runs(d, "ECG")
    _runs(d, "ACC")
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
    _seam_rows(d, [(-3_600_000, 2.44e11)])  # an hour before T0, i.e. before the worn interval
    _runs(d, "ECG")
    _runs(d, "ACC")
    _audit(d, end=(T0 + dt.timedelta(minutes=24)).isoformat())
    tb = _bands(d)[H10["name"]]["bands"]["timebase"]
    assert "recorded clock seam" not in tb["reason"], tb["reason"]


def test_a_segment_with_too_few_anchors_is_UNKNOWN_and_names_the_seam(tmp_path):
    """The worst-of-segments rule, and the honest shape of a short tail: a step 30 s before the end
    leaves a segment that cannot be judged, which is UNKNOWN — never a silent drop of that stretch."""
    # The seam lands after two anchors, so SEGMENT 1 is the short one and wins the tie on rank.
    tb = _stepped(tmp_path, step_ms=2.44e8 * 1000.0, at_min=1000.0 / 60_000.0, minutes=24)
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
        "not-a-timestamp;9;61000.000;0;0;0;0\n"  # unparseable host stamp
        "2026-09-20T23:12:00.000;9;not-a-number;0;0;0;0\n"  # unparseable magnitude
        "2026-09-20T23:12:00.000;9\n"
    )  # short row
    _runs(d, "ECG")
    _runs(d, "ACC")
    _audit(d, end=(T0 + dt.timedelta(minutes=24)).isoformat())
    tb = _bands(d)[H10["name"]]["bands"]["timebase"]
    assert "recorded clock seam" not in tb["reason"], tb["reason"]


def test_the_seam_CAUSE_is_read_from_the_night_and_never_inferred(tmp_path):
    """The cause comes from the night's own clock record or it is absent. A magnitude is not a cause."""
    d = tmp_path
    (d / "CLOCKSYNC.csv").write_text("at;event\n2026-09-20T23:12:00;resynced\n")
    tb = _stepped(d, step_ms=2.44e8 * 1000.0)
    # The SEPARATOR is part of the sentence: the cause is joined onto the seam count with "; ", the
    # same joint the no-cause arm uses. Asserting the cause alone left `'; ' + cause` mutable.
    assert "; `CLOCKSYNC.csv` records a clock event this night;" in tb["reason"], tb["reason"]


def test_an_UNREADABLE_clock_record_names_no_cause_rather_than_guessing_one(tmp_path):
    """A directory where `CLOCKSYNC.csv` cannot be opened must report "no cause recorded" — the reader
    moves to the next record and, finding none, says so. It never promotes the step into its own cause."""
    d = tmp_path
    (d / "CLOCKSYNC.csv").mkdir()  # a directory at that name: open() raises OSError, not ValueError
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
    _runs(d, "ECG")
    _runs(d, "ACC")
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


def _stepped_twice(d, step_ms, at1_min, at2_min, minutes=24, rate=2.0, ppm=20.0):
    """`_stepped` with TWO seams, which no fixture had. Same per-row device jitter, for the same
    reason: a uniform device column scores as a DRAWN axis and returns before the split is reached."""
    pairs, seam1, seam2 = [], None, None
    n = int(minutes * 60 * rate)
    for i in range(n):
        host_ms = i * (1000.0 / rate)
        dev_ms = host_ms * (1.0 + ppm / 1e6) + ((i * 7919) % 211) / 1e6
        if host_ms >= at1_min * 60_000:
            if seam1 is None:
                seam1 = host_ms
            dev_ms += step_ms
        if host_ms >= at2_min * 60_000:
            if seam2 is None:
                seam2 = host_ms
            dev_ms += step_ms
        pairs.append((host_ms, int(round(dev_ms * 1e6))))
    _pairs(d, pairs)
    _seam_rows(d, [(seam1, step_ms), (seam2, step_ms)])
    _runs(d, "ECG")
    _runs(d, "ACC")
    _audit(d, end=(T0 + dt.timedelta(minutes=minutes)).isoformat())
    return _bands(d)[H10["name"]]["bands"]["timebase"]


def test_TWO_seams_make_THREE_segments_and_the_boundary_walk_consumes_them_ONE_at_a_time(tmp_path):
    """The seam split's own boundary arithmetic, which nothing observed.

    `cur, bi = [], bi + 1` advances PAST ONE recorded bound per crossing. With a single seam the
    mutant `bi + 2` is indistinguishable — both land at or past `len(bounds)`, so both produce two
    segments — and every fixture here used exactly one seam. It takes TWO to separate them: the
    mutant consumes both bounds on the first crossing and the third stretch is never opened, so a
    night with two recorded steps is judged as two segments instead of three and the middle stretch
    is silently merged into its neighbour.
    """
    tb = _stepped_twice(tmp_path, step_ms=2.44e8 * 1000.0, at1_min=8, at2_min=16)
    assert "/3" in tb["reason"], tb["reason"]
    assert "2 recorded clock seam(s)" in tb["reason"], tb["reason"]
    # THREE more mutants die on this one string, because all three segments tie on rank and `>` keeps
    # the FIRST: the segment counter must start at 1 (not 0, not 2) and the tie-break must be strict.
    # `>=` would report the LAST segment instead, i.e. "segment 3/3".
    assert "segment 1/3" in tb["reason"], tb["reason"]


def test_the_WORST_segment_decides_and_an_UNKNOWN_one_FIRST_does_not_win(tmp_path):
    """The worst-of-segments rule, in the order that can actually get it wrong.

    `rank = {"FAIL": 2, "UNKNOWN": 1, "PASS": 0}` with `>` keeps the FIRST segment on a tie. So the
    case that separates a correct ranking from a broken one is an UNKNOWN segment BEFORE a FAIL one:
    every existing fixture had a single status, or the worse one first, and none of them look at
    `rank` hard enough to notice it changing.

    Segment 1 is UNKNOWN by anchor count (2 < TB_MIN_ANCHORS = 3); segment 2 is FAIL by rate. This
    one assertion kills three mutants at once — the two `"FAIL"` key re-spellings, which make
    `rank[out["status"]]` raise KeyError the moment any segment is FAIL, and `"UNKNOWN": 1 → 2`,
    which ties UNKNOWN with FAIL so the earlier UNKNOWN wins and the night stops reporting its own
    rate failure.
    """
    d = tmp_path
    rate, minutes = 2.0, 24
    seam_at = 1000.0  # after only 2 anchors at 500 ms spacing → segment 1 is under TB_MIN_ANCHORS
    step_ms = 2.44e8 * 1000.0
    pairs = []
    n = int(minutes * 60 * rate)
    for i in range(n):
        host_ms = i * (1000.0 / rate)
        # segment 2 drifts far past TB_MAX_PPM (50 000) so it is a rate FAIL, not an independent clock
        ppm = 20.0 if host_ms < seam_at else 200_000.0
        dev_ms = host_ms * (1.0 + ppm / 1e6) + ((i * 7919) % 211) / 1e6
        if host_ms >= seam_at:
            dev_ms += step_ms
        pairs.append((host_ms, int(round(dev_ms * 1e6))))
    _pairs(d, pairs)
    _seam_rows(d, [(seam_at, step_ms)])
    _runs(d, "ECG")
    _runs(d, "ACC")
    _audit(d, end=(T0 + dt.timedelta(minutes=minutes)).isoformat())
    tb = _bands(d)[H10["name"]]["bands"]["timebase"]
    assert tb["status"] == "FAIL", (tb["status"], tb["reason"])
    assert "ppm" in tb["reason"], tb["reason"]


def test_the_seam_NOTE_says_how_many_where_and_that_no_cause_was_recorded(tmp_path):
    """The seam note is the operator-facing half of the split, and nothing pinned its wording.

    It is built from three pieces — the count and largest step, the cause clause, and the segment
    count — and each piece carried a live mutant: the `""` initialiser (to `None`, which renders the
    literal "None" into the reason, and to a marker string), and both arms of the cause conditional.
    A night with seams but no recorded cause exercises the no-cause arm; the cause arm is pinned by
    the existing `test_the_seam_CAUSE_is_read_from_the_night_and_never_inferred`.
    """
    tb = _stepped_twice(tmp_path, step_ms=2.44e8 * 1000.0, at1_min=8, at2_min=16)
    r = tb["reason"]
    assert "2 recorded clock seam(s), largest " in r, r
    assert "; no cause recorded this night" in r, r
    assert "the axis is judged in 3 segment(s), never across a step" in r, r
    assert "None" not in r, r  # the `""` initialiser must not render as the word None
    assert "XX" not in r, r  # nor as a marker


def test_a_night_with_NO_seam_carries_no_seam_note_at_all(tmp_path):
    """The other arm of the same initialiser: with no seams the note stays empty and appends nothing.
    `seam_note = None` would concatenate the literal "None" onto every reason on a clean night."""
    d = tmp_path
    pairs = [(i * 500.0, int(round(i * 500.0 * 1.00002 * 1e6)) + ((i * 7919) % 211)) for i in range(2880)]
    _pairs(d, pairs)
    _seams(d)
    _runs(d, "ECG")
    _runs(d, "ACC")
    _audit(d, end=(T0 + dt.timedelta(minutes=24)).isoformat())
    r = _bands(d)[H10["name"]]["bands"]["timebase"]["reason"]
    assert "None" not in r, r
    assert "XX" not in r, r
    assert "recorded clock seam" not in r, r


def test_TWO_segments_are_still_tagged_by_number(tmp_path):
    """`if len(segs) > 1` is the threshold at which the tag gains its segment number. `> 2` leaves a
    two-segment night reporting a bare device tag, so the reader cannot tell which side of the step
    the verdict came from — the whole point of judging the segments separately."""
    tb = _stepped(tmp_path, step_ms=2.44e8 * 1000.0, at_min=12, minutes=24)
    assert "segment 1/2" in tb["reason"] or "segment 2/2" in tb["reason"], tb["reason"]


def test_a_segment_under_the_anchor_floor_NAMES_the_count_and_the_floor(tmp_path):
    """`_decision("UNKNOWN", …)` with its reason dropped (to None, or to no argument at all) still
    returns UNKNOWN, so a status-only assertion cannot see it. The reason is the whole product here:
    "which segment, how many anchors, under what floor"."""
    # The seam lands after two anchors, so SEGMENT 1 is the short one and wins the tie on rank.
    tb = _stepped(tmp_path, step_ms=2.44e8 * 1000.0, at_min=1000.0 / 60_000.0, minutes=24)
    assert tb["status"] == "UNKNOWN", tb["reason"]
    assert "anchor(s) — under 3" in tb["reason"], tb["reason"]


# ── the seam sidecar READER, row by row (#3095's `recorded_seams`) ──────────────────────────────────
#
# Every test below plants ONE malformed or boundary row beside a REAL seam and asserts the real seam
# still splits the axis. That shape is deliberate: each of these rows is skipped by a `continue`, and a
# `continue` mutated to `break` is invisible unless something the reader has not reached yet still has
# to be found. A fixture whose only row is the bad one proves nothing about either.

SEAM_HDR = [
    "# stream=ecg rule=clock-seam bound_ms=60000 unit=ms basis=device-minus-host",
    "phone_ts;idx;device_step_ms;phone_delta_ms;residual_ms;host_offset_ms;at_rel_ms",
]


def _raw_seams(d, lines, name=BASE, stream="ECG"):
    """A SEAMS sidecar written line-for-line, for rows `_seam_rows` cannot express."""
    (d / f"{name}_{stream}SEAMS.txt").write_text("\n".join(lines) + "\n")


def _seam_row(ms, step):
    t = T0 + dt.timedelta(milliseconds=ms)
    return (
        f"{t.strftime('%Y-%m-%dT%H:%M:%S.')}{t.microsecond // 1000:03d};999999;{step:.3f};0.000;{step:.3f};0.000;0.000"
    )


def _split_night(d, lines, minutes=24, at_min=12, step_ms=2.44e8 * 1000.0, rate=2.0, ppm=20.0):
    """`_stepped`'s stream with a HAND-WRITTEN sidecar: the device steps at `at_min` either way, so
    whether the axis splits is decided by the sidecar rows alone."""
    pairs = []
    for i in range(int(minutes * 60 * rate)):
        host_ms = i * (1000.0 / rate)
        dev_ms = host_ms * (1.0 + ppm / 1e6) + ((i * 7919) % 211) / 1e6
        if host_ms >= at_min * 60_000:
            dev_ms += step_ms
        pairs.append((host_ms, int(round(dev_ms * 1e6))))
    _pairs(d, pairs)
    _raw_seams(d, lines)
    _runs(d, "ECG")
    _runs(d, "ACC")
    _audit(d, end=(T0 + dt.timedelta(minutes=minutes)).isoformat())
    return _bands(d)[H10["name"]]["bands"]["timebase"]


def test_a_seam_row_carrying_EXACTLY_the_three_joined_columns_is_read(tmp_path):
    """`len(cells) < 3` is a MINIMUM, and three cells is the smallest complete row — `phone_ts`, `idx`
    and `device_step_ms` are the only columns the reader touches. Every fixture wrote the writer's full
    seven, so `< 3` could be `<= 3` or `< 4` and nothing noticed: the reader would have started
    discarding complete rows the moment the writer trimmed a column."""
    t = T0 + dt.timedelta(minutes=12)
    tb = _split_night(tmp_path, SEAM_HDR + [f"{t.isoformat(timespec='milliseconds')};999999;244000000.000"])
    assert "1 recorded clock seam(s)" in tb["reason"], tb["reason"]
    assert "2 segment(s)" in tb["reason"], tb["reason"]


def test_a_SHORT_seam_row_skips_ITSELF_and_the_real_seam_after_it_is_still_read(tmp_path):
    """`continue` -> `break` on the short-row guard: the reader would stop at the first truncated line
    and silently drop every seam written after it. A torn sidecar is exactly where that happens."""
    tb = _split_night(tmp_path, SEAM_HDR + ["2026-09-20T23:05:00.000;999999", _seam_row(12 * 60_000, 2.44e8 * 1000.0)])
    assert "1 recorded clock seam(s)" in tb["reason"], tb["reason"]
    assert "2 segment(s)" in tb["reason"], tb["reason"]


def test_an_UNPARSEABLE_seam_row_skips_ITSELF_and_the_real_seam_after_it_is_still_read(tmp_path):
    """The same for the `ValueError` guard: a row whose stamp or step will not parse is one seam this
    reader cannot place, never a reason to stop placing the others."""
    tb = _split_night(
        tmp_path, SEAM_HDR + ["not-a-stamp;999999;nonsense;0;0;0;0", _seam_row(12 * 60_000, 2.44e8 * 1000.0)]
    )
    assert "1 recorded clock seam(s)" in tb["reason"], tb["reason"]
    assert "2 segment(s)" in tb["reason"], tb["reason"]


def test_a_seam_recorded_exactly_AT_the_worn_END_is_inside_the_interval(tmp_path):
    """`host > end` is an EXCLUSION bound, so a seam stamped exactly at the worn end is worn. `>=`
    drops it — and the doff instant is precisely when a clock event is likely (the box stops, the
    phone syncs), so the off-by-one lands on the population it matters most for."""
    tb = _split_night(tmp_path, SEAM_HDR + [_seam_row(24 * 60_000, 2.44e8 * 1000.0)], at_min=12)
    assert "1 recorded clock seam(s)" in tb["reason"], tb["reason"]


def test_a_seam_recorded_BEFORE_the_worn_start_skips_ITSELF_and_the_worn_one_is_still_read(tmp_path):
    """`continue` -> `break` on the worn-interval guard. A seam from before the strap went on is the
    common case — the box is running, the night has not started — so a `break` here would discard
    every real seam on a night that began with one."""
    tb = _split_night(tmp_path, SEAM_HDR + [_seam_row(-60_000, 1000.0), _seam_row(12 * 60_000, 2.44e8 * 1000.0)])
    assert "1 recorded clock seam(s)" in tb["reason"], tb["reason"]
    assert "2 segment(s)" in tb["reason"], tb["reason"]


def test_a_seam_sidecar_with_UNDECODABLE_BYTES_still_splits_the_axis(tmp_path):
    """`errors="replace"` is load-bearing and nothing observed it. The decode happens while ITERATING,
    not at `open`, so the `except OSError` around the open cannot catch a `UnicodeDecodeError` — strict
    decoding would take down the whole night verdict for one bad byte in a sidecar comment."""
    good = _seam_row(12 * 60_000, 2.44e8 * 1000.0)
    blob = ("\n".join(SEAM_HDR) + "\n").encode() + b"# note: \xff\xfe not utf-8\n" + good.encode() + b"\n"
    pairs = []
    for i in range(2880):
        host_ms = i * 500.0
        dev_ms = host_ms * 1.00002 + ((i * 7919) % 211) / 1e6 + (2.44e8 * 1000.0 if host_ms >= 720_000 else 0.0)
        pairs.append((host_ms, int(round(dev_ms * 1e6))))
    _pairs(tmp_path, pairs)
    (tmp_path / f"{BASE}_ECGSEAMS.txt").write_bytes(blob)
    _runs(tmp_path, "ECG")
    _runs(tmp_path, "ACC")
    _audit(tmp_path, end=(T0 + dt.timedelta(minutes=24)).isoformat())
    tb = _bands(tmp_path)[H10["name"]]["bands"]["timebase"]
    assert "1 recorded clock seam(s)" in tb["reason"], tb["reason"]
    assert "2 segment(s)" in tb["reason"], tb["reason"]


# ── the cause reader (#3095's `_seam_cause`) ────────────────────────────────────────────────────────


def test_each_of_the_THREE_clock_event_words_names_the_cause_on_its_own(tmp_path):
    """The guard is three ORs, and a night records ONE of the three words, not all three. Swapping any
    `or` for an `and` leaves a record that names a real clock event reading as no cause recorded —
    which the operator cannot tell from a night whose box wrote nothing. `resynced` was the only word
    any fixture carried, and it happens to contain `synced`, so it alone cannot separate the arms."""
    for word in ("resync", "synced", "offline"):
        d = tmp_path / word
        d.mkdir()
        (d / "CLOCKSYNC.csv").write_text(f"at;event\n2026-09-20T23:12:00;{word}\n")
        tb = _stepped(d, step_ms=2.44e8 * 1000.0)
        assert "; `CLOCKSYNC.csv` records a clock event this night;" in tb["reason"], (word, tb["reason"])


def test_an_unreadable_FIRST_clock_record_falls_through_to_the_SECOND(tmp_path):
    """`continue` -> `break` in the `except OSError`: the fallback to `CLOCK.csv` exists precisely for
    the night whose `CLOCKSYNC.csv` cannot be opened. A `break` makes the second name dead code while
    the existing both-unreadable test stays green, because that one reaches no cause either way."""
    (tmp_path / "CLOCKSYNC.csv").mkdir()  # OSError on open, not ValueError
    (tmp_path / "CLOCK.csv").write_text("at;event\n2026-09-20T23:12:00;offline\n")
    tb = _stepped(tmp_path, step_ms=2.44e8 * 1000.0)
    assert "; `CLOCK.csv` records a clock event this night;" in tb["reason"], tb["reason"]


def test_a_clock_record_with_UNDECODABLE_BYTES_still_names_its_cause(tmp_path):
    """The `_seam_cause` half of the same `errors="replace"` claim: one bad byte in the night's clock
    log must not raise out of a verdict. Strict decoding raises `UnicodeDecodeError` mid-iteration,
    which `except OSError` does not catch."""
    (tmp_path / "CLOCKSYNC.csv").write_bytes(
        b"at;event\n2026-09-20T23:11:00;\xff\xfe junk\n2026-09-20T23:12:00;resync\n"
    )
    tb = _stepped(tmp_path, step_ms=2.44e8 * 1000.0)
    assert "; `CLOCKSYNC.csv` records a clock event this night;" in tb["reason"], tb["reason"]


def test_BOTH_sidecar_readers_declare_their_encoding_and_never_inherit_the_hosts_locale(tmp_path):
    """`encoding="utf-8"` is a claim about the BOX, and it cannot be tested in process.

    The capture host writes UTF-8; this machine reads UTF-8; so `open(..., encoding=None)` behaves
    identically here and both readers' `encoding=` argument survived every test. It is not decoration:
    the daemon runs under a systemd unit whose locale is whatever the unit file says, and `C` gives
    ASCII. With `errors="replace"` already in place an ASCII decode does not raise — it silently
    replaces every non-ASCII byte, which is the §∅ shape (a value manufactured where one was absent)
    rather than a crash anyone would notice.

    CPython resolves the default encoding in C, so no in-process patch reaches it. `-X
    warn_default_encoding` is the supported lever: it makes every `open()` that leaves `encoding`
    unset — or explicitly `None` — raise `EncodingWarning` as an error. The assertion is therefore on
    the CALL, not on a decoded byte, and it holds on a UTF-8 machine and a C-locale one alike.
    """
    import subprocess
    import sys

    d = tmp_path
    (d / "CLOCKSYNC.csv").write_text("at;event\n2026-09-20T23:12:00;resync\n")
    _raw_seams(d, SEAM_HDR + [_seam_row(12 * 60_000, 2.44e8 * 1000.0)])
    # IN-PROCESS FIRST, and it is not redundant: mutmut selects which tests to run for a mutant from
    # COVERAGE, and a subprocess is invisible to the tracer. Without these two calls the test never
    # runs against the very mutants it kills, and all four `encoding=` survivors read as unkillable.
    assert len(si.recorded_seams(str(d / f"{BASE}_ECG.txt"), None, None)) == 1
    assert si._seam_cause(str(d))
    src = (
        "import solid_night_inputs as si\n"
        f"seams = si.recorded_seams({str(d / f'{BASE}_ECG.txt')!r}, None, None)\n"
        f"cause = si._seam_cause({str(d)!r})\n"
        "assert len(seams) == 1, seams\n"
        "assert cause and 'CLOCKSYNC.csv' in cause, cause\n"
    )
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=str(si.__file__).rsplit("/", 1)[0],
    )
    assert r.returncode == 0, r.stderr


def test_the_residual_is_measured_about_THIS_segments_first_anchor_and_keeps_its_precision(tmp_path):
    """The re-origin family, and the one property that separates its members from the arithmetic.

    `r0 = seg[0][0] - seg[0][1]` and `res = [((h - seg[0][0]) / 1000.0, (h - d) - r0) …]` are full of
    index and sign mutations that cancel: a CONSTANT added to every residual leaves `spread`,
    `span_s` and `ppm` untouched, because all three read only differences. Most of those mutants are
    therefore equivalent and are recorded as such in `tools/mutate-equivalence.json`.

    TWO ARE NOT, and the difference is IEEE754, not algebra. `(h - d) + r0` and `r0 = seg[0][0] +
    seg[0][1]` do not add a constant to a small number — they ADD two wall-clock-magnitude numbers,
    so the residual is carried at ≈3.6e12 instead of ≈0 and its ULP grows from nothing to 4.9e-4 ms.
    Measured over 40,000 random segments at the shipped 1.79e12 magnitude, that reaches the reported
    `.2f` in 21 and 1 of them. A ledger entry claiming "no distinguishing input" would be false.

    So here is one, and it is stable rather than lucky: the constants below were searched once on the
    integer-nanosecond grid `_pairs` actually writes, and re-checked at all 105 quarter-hour UTC
    offsets — `datetime.timestamp()` shifts the host epoch by whole minutes, which never leaves the
    binade, so the rounding grid does not move with the machine's timezone. Full precision the night
    spreads 1.8948974609375 ms and reports `1.89`; re-origined it is 1.895 and reports `1.90`.

    Re-derive with: for eps_ns in range(400000) — take the first where the two renderings differ and
    the spread is still under TB_INERT_MS.
    """
    D0_NS = 900_000_000_000_000_000  # a device counter with a large arbitrary epoch, which is what
    EPS_NS = 17424  # `r0` exists to remove — and what makes the two mutants visible
    pairs = [(i * 1000.0, D0_NS + i * 1_000_000_000 - ((i % 7) * 310_000 + EPS_NS * (i % 3))) for i in range(24)]
    _pairs(tmp_path, pairs)
    _seams(tmp_path)
    _runs(tmp_path, "ECG")
    _runs(tmp_path, "ACC")
    _audit(tmp_path, end=(T0 + dt.timedelta(seconds=24)).isoformat())
    tb = _bands(tmp_path)[H10["name"]]["bands"]["timebase"]
    assert "residual spread 1.89 ms" in tb["reason"], tb["reason"]


# ── the UNIT CONVERSIONS inside the reasons, which every earlier assertion rounded away ────────────
#
# Three divisors turn a stored quantity into the one the operator reads: `step_ms / 1000.0` (ms -> s,
# rendered `:+.3g`) and `span_s / 60` (s -> min, rendered `:.0f`, twice). Every existing fixture sits
# where a 1-in-1000 change in the divisor is invisible AFTER rounding — a 2.44e8 s step reads
# `+2.44e+08` either way, and a 24-minute night reads `24` whether divided by 60 or 61. So the
# divisors were mutable with the suite green. These three nights are chosen so the rounding cannot
# hide it: a step of exactly 1 s, and a span of exactly 61 minutes.


def test_the_seam_STEP_is_rendered_in_SECONDS_at_a_magnitude_rounding_cannot_hide(tmp_path):
    """`worst['step_ms'] / 1000.0` -> `/ 1001.0` is a 1e-3 relative change, and `:+.3g` swallows it at
    2.44e8. At exactly 1000 ms it does not: 1 s against 0.999 s."""
    tb = _split_night(tmp_path, SEAM_HDR + [_seam_row(12 * 60_000, 1000.0)], step_ms=1000.0)
    assert "largest +1 s" in tb["reason"], tb["reason"]


def _long_night(d, minutes, dev_ppm):
    """A night whose anchors span EXACTLY `minutes`, one per minute, with per-row device jitter so the
    axis is not read as DRAWN. 61 minutes is the point: 3660/60 = 61 and 3660/61 = 60, so the two
    divisors disagree in the rendered integer."""
    pairs = []
    for i in range(minutes + 1):
        h = 60_000.0 * i
        dev = h * (1.0 + dev_ppm / 1e6) + ((i * 7919) % 211) / 1000.0
        pairs.append((h, int(round(dev * 1e6))))
    _pairs(d, pairs)
    _seams(d)
    _runs(d, "ECG")
    _runs(d, "ACC")
    _audit(d, end=(T0 + dt.timedelta(minutes=minutes)).isoformat())
    return _bands(d)[H10["name"]]["bands"]["timebase"]


def test_an_UNKNOWN_rate_names_the_span_in_MINUTES(tmp_path):
    """`span_s / 60` -> `/ 61` in the independent-clock reason: 61 min becomes 60, and the operator is
    told the axis was judged over a minute less than it was."""
    tb = _long_night(tmp_path, minutes=61, dev_ppm=-166.7)
    assert tb["status"] == "PASS", tb["reason"]
    assert "ppm over 61 min" in tb["reason"], tb["reason"]


def test_an_IMPLAUSIBLE_rate_names_the_span_in_MINUTES_too(tmp_path):
    """The same divisor on the FAIL arm — a separate line, and mutmut mutates each one. The span is
    what makes a rate quotable at all (CLAUDE.md §7: never quote `ppm` without anchor count and span),
    so the arm that REFUSES needs it right at least as much as the one that reports."""
    tb = _long_night(tmp_path, minutes=61, dev_ppm=200000.0)
    assert tb["status"] == "FAIL", tb["reason"]
    assert "ppm over 61 min" in tb["reason"], tb["reason"]


# ── §2 rule 2 · A ZONED STAMP IS LEGAL, AND COSTS THE WHOLE NIGHT'S VERDICT ─────────────────────────
# `recorded_seams` and `residual_scan` parsed the host stamp with `datetime.fromisoformat(cell)`, which
# returns an AWARE datetime for `...+02:00` and a naive one otherwise. Comparing either against the naive
# worn-interval bounds raises `TypeError: can't compare offset-naive and offset-aware datetimes`, and
# TypeError is not the `ValueError` the `except` beside it catches — so it escaped both readers, the
# solid-night poller caught it ("one night's verdict must not stop the poller"), and the night was left
# with NO verdict at all, which §3.1 reads as unassessed. One zoned row, one unassessed night.
#
# ⚠️ WHY NO EXISTING TEST CAUGHT IT: every `residual_scan` call in this file passes `start=None`, which
# short-circuits the comparison the TypeError lives in. The zone was never the missing ingredient on its
# own — the WORN INTERVAL was. Both are supplied below.
#
# Clock Contract §2 rule 2: the zone is authoritative for the offset, and `tMs` is the components AS
# WRITTEN — so a zoned stamp must land on the same floating time as its zoneless twin, not one shifted by
# the offset. Both readers now call `nights_index.parse_host_stamp`, which already got this right for the
# hours-precision readers and keeps the sub-second digits these two measure with.


def _zone_the_host_column(path, offset="+02:00"):
    """Append a zone to every `Phone timestamp` cell and change nothing else — same rows, same device
    column, same everything the readers measure. The only difference is the one under test."""
    lines = path.read_text().splitlines()
    out = [lines[0]]
    for ln in lines[1:]:
        cells = ln.split(";")
        if cells[0] and cells[0][0].isdigit():
            cells[0] = cells[0] + offset
        out.append(";".join(cells))
    path.write_text("\n".join(out) + "\n")


def test_a_zoned_host_stamp_gives_the_residual_scan_the_SAME_answer(tmp_path):
    """The plant: one fixture, read twice, differing only in the zone — and a REAL worn interval, without
    which the comparison that used to raise is never reached."""
    start, end = T0, T0 + dt.timedelta(seconds=300)
    _ecg(tmp_path)
    ecg = tmp_path / f"{BASE}_ECG.txt"
    unzoned = si.residual_scan(str(ecg), start, end)
    _zone_the_host_column(ecg)
    zoned = si.residual_scan(str(ecg), start, end)
    assert zoned == unzoned, (
        "a zoned `Phone timestamp` must reach the same floating time as its zoneless twin "
        f"(Clock Contract §2 rule 2)\n  unzoned={unzoned}\n  zoned  ={zoned}"
    )
    assert unzoned["reason"] is None, "and the fixture is one the scan can actually judge"


def test_a_zoned_seam_row_gives_recorded_seams_the_SAME_answer(tmp_path):
    """The same plant on the seam reader, whose host stamps are joined on and then published as
    `host_ms` — so a zone that survived parsing would move the seam by the offset, not merely raise."""
    start, end = T0, T0 + dt.timedelta(seconds=300)
    _ecg(tmp_path)
    _seam_rows(tmp_path, [(1000, 123.0), (2000, -45.0)])
    primary = str(tmp_path / f"{BASE}_ECG.txt")
    unzoned = si.recorded_seams(primary, start, end)
    assert unzoned, "the control: the unzoned rows are read at all, or the comparison proves nothing"
    _zone_the_host_column(tmp_path / f"{BASE}_ECGSEAMS.txt")
    zoned = si.recorded_seams(primary, start, end)
    assert zoned == unzoned, f"unzoned={unzoned}\nzoned  ={zoned}"
    # ...and the host stamps keep their MILLISECONDS, which is what stopped this being a swap to
    # `parse_stamp`: that truncates at the second, and `residual_scan` measures at 1 ms.
    assert unzoned[0]["host_ms"] % 1000 == (T0 + dt.timedelta(milliseconds=1000)).microsecond // 1000


# ── THE TWELVE SURVIVORS THE REFUSAL HAD MASKED (2026-09-27) ────────────────────────────────────────
# `mutate_diff` is diff-scoped BY LINE, so the two-line parser swap above put every mutant of
# `recorded_seams` and `residual_scan` in scope. The gate had been REFUSING (exit 2, two globs testing
# zero mutants) because a sibling test crashed the scratch, and the refusal masked the real result: with
# the crash fixed the gate reports 12 survivors. Eight are killed below; four carry equivalence entries
# with a probe. None is a regression from this branch — they are the functions' standing debt, and the
# PR that makes them visible is the PR that pays it.

_NS = "sensor timestamp [ns]"


def _resid(d, rows, header=None, name="Polar_H10_02849638_20260920230000_ECG.txt", raw=None):
    """A residual-scan input written EXACTLY as given — no helper normalising the bytes, because several
    of these mutants live in how the file is DECODED and a tidying fixture would hide them."""
    p = d / name
    if raw is not None:
        p.write_bytes(raw)
        return str(p)
    head = header if header is not None else f"Phone timestamp;{_NS};ecg [uV]\n"
    p.write_text(head + "".join(rows), encoding="utf-8")
    return str(p)


def test_an_unparseable_seam_row_does_not_END_the_seam_scan(tmp_path):
    """KILLS recorded_seams `continue` → `break`. A row this reader cannot place splits nothing — and it
    must not take the rows AFTER it down with it, which is precisely what `break` would do."""
    lines = [
        "phone_ts;idx;device_step_ms\n",
        "2026-09-20T23:05:00.000;1;not-a-number\n",  # unplaceable: skipped, never fatal
        "2026-09-20T23:06:00.000;2;123.000\n",
    ]  # and THIS one must still be read
    (tmp_path / f"{BASE}_ECGSEAMS.txt").write_text("".join(lines))
    got = si.recorded_seams(str(tmp_path / f"{BASE}_ECG.txt"), T0, T0 + dt.timedelta(hours=1))
    assert [r["step_ms"] for r in got] == [123.0], (
        "the bad row is skipped and the good row after it is still read; `break` would return nothing"
    )


def test_a_row_outside_the_worn_interval_does_not_END_the_residual_scan(tmp_path):
    """KILLS residual_scan's worn-interval `continue` → `break`. Rows outside the interval are not
    anchors, but the scan continues past them — a device that was worn LATER in the file still counts."""
    rows = [
        "2026-09-20T22:00:00.000;0;1\n",  # before the interval: not an anchor
        "2026-09-20T23:10:00.000;1000000;1\n",  # inside
        "2026-09-20T23:20:00.000;3000000;1\n",  # inside, a different delta
        "2026-09-20T23:30:00.000;6000000;1\n",
    ]
    p = _resid(tmp_path, rows)
    got = si.residual_scan(p, T0, T0 + dt.timedelta(hours=1))
    assert got["reason"] is None and got["anchors"], (
        "the rows inside the interval are still scanned after one outside it; `break` loses them"
    )


def test_an_invalid_BYTE_does_not_stop_the_residual_scan(tmp_path):
    """KILLS `errors="replace"` → `errors=None` and the argument dropped. Strict decoding RAISES on a
    malformed byte; this reader replaces it, because one bad byte in a 160 MB night must not cost the
    night its timebase verdict. The byte sits in a trailing column so nothing measured depends on it."""
    raw = (
        f"Phone timestamp;{_NS};note\n".encode()
        + b"2026-09-20T23:10:00.000;1000000;caf\xff\n"  # 0xff: not valid UTF-8 in any position
        + b"2026-09-20T23:20:00.000;3000000;ok\n"
    )
    p = _resid(tmp_path, None, raw=raw)
    got = si.residual_scan(p, None, None)  # must not raise UnicodeDecodeError
    assert got["reason"] is None, got


def test_the_residual_scan_decodes_as_UTF_8_whatever_the_BOXES_locale_is(tmp_path):
    """KILLS `encoding="utf-8"` → `encoding=None` and the argument dropped — the pair that is NOT
    killable in `mutation_diff.root_reads`, and is killable here, because the decoded text reaches
    `int()` and `int()` accepts Unicode digits where a census comparison against filesystem names does
    not. `٣٠٠٠٠٠٠` is ARABIC-INDIC 3000000: it parses under utf-8 and becomes replacement characters
    under the C locale's ASCII, where the row is dropped and the anchor count falls.

    Run in a subprocess under `LC_ALL=C PYTHONUTF8=0`, the same probe shape as
    `test_the_sidecar_reader_does_not_depend_on_the_BOXES_locale`, because in THIS process the platform
    default IS utf-8 and the mutant would be indistinguishable."""
    import os
    import subprocess
    import sys

    rows = [
        "2026-09-20T23:10:00.000;1000000;1\n",
        "2026-09-20T23:20:00.000;٣٠٠٠٠٠٠;1\n",  # ٣٠٠٠٠٠٠
        "2026-09-20T23:30:00.000;6000000;1\n",
    ]
    p = _resid(tmp_path, rows)
    here = si.residual_scan(p, None, None)
    assert len(here["anchors"]) == 3, (
        f"the Unicode-digit row must PARSE here, or the probe below compares two drops: {here}"
    )
    env = {**os.environ, "LC_ALL": "C", "LANG": "C", "PYTHONUTF8": "0", "PYTHONCOERCECLOCALE": "0"}
    script = (
        f"import json,sys; sys.path.insert(0,{os.path.dirname(os.path.abspath(si.__file__))!r});"
        f"import solid_night_inputs as s;"
        f"print(len(s.residual_scan({p!r}, None, None)['anchors']))"
    )
    r = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, env=env)
    assert r.returncode == 0, f"the probe itself failed, which says nothing about encoding:\n{r.stderr[-500:]}"
    assert r.stdout.strip() == "3", (
        "the scan must read utf-8 whatever the ambient encoding is:\n"
        f"  C locale : {r.stdout.strip()} anchor(s)\n  this proc: 3"
    )


def test_the_header_is_stripped_of_its_NEWLINE_and_nothing_else(tmp_path):
    """KILLS `rstrip("\\n")` → `rstrip(None)`. The column name is matched EXACTLY, so a header whose last
    field carries a trailing space does not carry that column — and saying so is the honest answer, where
    stripping all trailing whitespace would silently accept a header this reader cannot vouch for."""
    p = _resid(
        tmp_path, ["2026-09-20T23:10:00.000;1000000;1\n"], header=f"Phone timestamp;{_NS} \n"
    )  # note the trailing space
    got = si.residual_scan(p, None, None)
    assert got.get("reason") and _NS in got["reason"], (
        "a trailing space means the exact column is absent; rstrip(None) would hide that"
    )


def test_a_single_row_has_no_delta_and_therefore_no_drawn_share(tmp_path):
    """KILLS `(top / total) if total else None` → `... if (total) or True else None`, which divides by
    zero the moment a file carries fewer than two usable rows. §∅: one row measures no INTERVAL, so the
    share is null rather than a number — and certainly rather than a crash."""
    p = _resid(tmp_path, ["2026-09-20T23:10:00.000;1000000;1\n"])
    got = si.residual_scan(p, None, None)
    assert got["drawn_share"] is None and got["reason"] is None, got


def test_PLANT_a_sidecar_whose_rows_and_own_TOTALS_disagree_is_refused(tmp_path):
    """residue 2026-09-27-seam-sidecar-rows-and-finals-agree — the tripwire, not a measurement.

    One writer instance writes both a seam row and the final line that counts it, and since #3170 the
    count follows the row, so they cannot disagree. If a reader ever finds them disagreeing, one of the
    two is describing a file it did not write and NEITHER can be trusted to answer "was the clock
    compared on this night" — so it refuses by name rather than picking a side.

    Measured 2026-09-27 over 132 sidecars (66 on the rig, 66 on the box): none disagree. This fires on
    nothing today and exists to notice the day it does.
    """
    _seam_rows(tmp_path, [(1000, 90000.0)], examined=5)  # one row, final says seams=1
    assert si.clocks(str(tmp_path), "H10")["status"] == "PASS", "the agreeing case still passes"

    p = tmp_path / f"{BASE}_ECGSEAMS.txt"
    p.write_text(p.read_text().replace("seams=1 examined=5", "seams=0 examined=5"))
    got = si.clocks(str(tmp_path), "H10")
    assert got["status"] == "UNKNOWN", ("a sidecar contradicting itself is refused, not believed", got)
    assert "disagree" in got["reason"] and "ECGSEAMS" in got["reason"], got["reason"]


def test_a_sidecar_with_SEVERAL_sessions_sums_their_totals_rather_than_taking_one(tmp_path):
    """The real multi-session shape, and why the tripwire counts across the whole file. A resumed
    file-set writes one `# final` per writer instance — the 2026-09-24 H10 carries three, `seams=0`,
    `seams=1`, `seams=0`, for one row — so a reader comparing any single total against the file's rows
    would read a disagreement that is not there. Summing is what makes the check true of the file."""
    lines = [
        "# stream=ecg rule=clock-seam bound_ms=60000 unit=ms basis=device-minus-host",
        "phone_ts;idx;device_step_ms;phone_delta_ms;residual_ms;host_offset_ms;at_rel_ms",
        "# final stream=ecg seams=0 examined=74605",
        f"{T0.strftime('%Y-%m-%dT%H:%M:%S.')}000;1;90000.000;0.000;90000.000;0.000;0.000",
        "# final stream=ecg seams=1 examined=3577",
        "",  # a blank line: a torn flush, or a trailing newline
        "# final stream=ecg seams=0 examined=3727891",
    ]
    (tmp_path / f"{BASE}_ECGSEAMS.txt").write_text("\n".join(lines) + "\n")
    assert si.clocks(str(tmp_path), "H10")["status"] == "PASS", "three totals summing to one row agree"
    # the blank line above is not a row: counting it would make every file with a trailing newline
    # contradict its own totals, which would turn the tripwire into noise on its first night


# ── `clocks`, at the edges the diff-scoped gate found unobserved ────────────────────────────────────


def _seams_raw(d, lines, name=BASE, stream="ECG"):
    (d / f"{name}_{stream}SEAMS.txt").write_text("\n".join(lines) + "\n")


def test_examined_is_SUMMED_across_sessions_not_taken_from_the_last(tmp_path):
    """A resumed file-set writes one `# final` per writer instance, and the LAST one can legitimately
    read `examined=0` — an instance that opened, wrote its header and took no second sample. Reading only
    that one answers "the clock was never compared" for a night that compared it 74,605 times."""
    _seams_raw(
        tmp_path,
        [
            "# stream=ecg rule=clock-seam bound_ms=60000 unit=ms basis=device-minus-host",
            "phone_ts;idx;device_step_ms;phone_delta_ms;residual_ms;host_offset_ms;at_rel_ms",
            "# final stream=ecg seams=0 examined=74605",
            "# final stream=ecg seams=0 examined=0",
        ],
    )
    assert si.clocks(str(tmp_path), "H10")["status"] == "PASS", "74,605 comparisons happened"


def test_a_single_examined_sample_is_a_comparison(tmp_path):
    """`> 0`, not `> 1`. One examined interval IS a device-vs-host comparison — the question §3.4 asks is
    whether the clocks were compared at all, not whether they were compared often."""
    _seams_raw(
        tmp_path,
        [
            "# stream=ecg rule=clock-seam bound_ms=60000 unit=ms basis=device-minus-host",
            "phone_ts;idx",
            "# final stream=ecg seams=0 examined=1",
        ],
    )
    assert si.clocks(str(tmp_path), "H10")["status"] == "PASS"


def test_the_row_count_is_a_COUNT_so_two_rows_are_two(tmp_path):
    """`+= 1`, not `= 1`. The tripwire compares rows against the claimed total, so a row count that
    saturates at one makes a two-seam file look like it contradicts itself."""
    _seam_rows(tmp_path, [(1000, 90000.0), (2000, 95000.0)], examined=9)
    assert si.clocks(str(tmp_path), "H10")["status"] == "PASS", "two rows, a final saying two"


def test_a_night_with_no_clock_evidence_SAYS_WHY(tmp_path):
    """The reason is the output. A bare UNKNOWN tells a reader the night is unjudged without telling them
    whether the evidence was absent, unreadable, or contradictory — and those need different fixes."""
    got = si.clocks(str(tmp_path), "H10")
    assert got["status"] == "UNKNOWN"
    assert got["reason"] == "no device-vs-host clock comparison recorded this night", got


def test_an_rtc_READ_with_no_offset_does_not_stop_the_search(tmp_path):
    """`continue`, never `break`. The ring logs a `read` row before it has an offset to report; stopping
    there answers "no clock evidence" for a night whose very next row carries the measurement."""
    (tmp_path / "Wellue_O2Ring-S_S8AW2100_20260920230000_RTCLOG.csv").write_text(
        "Phone timestamp;event;rtc_offset_s\nt;read;\nt;read;-1.6\n"
    )
    assert si.clocks(str(tmp_path), "O2Ring-S")["status"] == "PASS"


def test_an_rtc_row_needs_BOTH_enough_columns_AND_the_read_event(tmp_path):
    """`and`, not `or`. With `or`, a short row passes the length test by failing it and a `push` row
    passes by being long enough — both then index a column that is not there or read an offset that
    belongs to another event."""
    (tmp_path / "Wellue_O2Ring-S_S8AW2100_20260920230000_RTCLOG.csv").write_text(
        "Phone timestamp;event;rtc_offset_s\nt;read\nt;push;-9.9\n"
    )
    got = si.clocks(str(tmp_path), "O2Ring-S")
    assert got["status"] == "UNKNOWN", (
        "a `read` with no offset column and a `push` with one are neither of them a recorded comparison",
        got,
    )


def test_an_rtc_offset_with_trailing_whitespace_is_still_read(tmp_path):
    """`rstrip("\\n")`, deliberately narrow: the value is parsed with `float`, which tolerates surrounding
    space, so stripping only the newline keeps the column's own content intact. Stripping ALL whitespace
    would also silently swallow a field that is nothing but spaces — an absent measurement — into the
    same shape as a present one."""
    (tmp_path / "Wellue_O2Ring-S_S8AW2100_20260920230000_RTCLOG.csv").write_text(
        "Phone timestamp;event;rtc_offset_s\nt;read; -1.6 \n"
    )
    assert si.clocks(str(tmp_path), "O2Ring-S")["status"] == "PASS"


def _in_c_locale(fn):
    """Run `fn` with LC_CTYPE=C, restored after. A default-encoding read then decodes as ASCII, which is
    what makes an omitted `encoding="utf-8"` observable — both files are read on a box whose unit may
    have been started in any locale."""
    import locale

    before = locale.setlocale(locale.LC_CTYPE)
    try:
        locale.setlocale(locale.LC_CTYPE, "C")
        return fn()
    finally:
        locale.setlocale(locale.LC_CTYPE, before)


def test_both_sidecars_are_read_as_UTF8_whatever_the_boxs_locale_is(tmp_path):
    """A stream name or an operator note can carry non-ASCII, and `errors="replace"` means a wrong codec
    does not raise — it substitutes U+FFFD and the line silently stops matching. Under `LC_CTYPE=C` a
    default-encoding read decodes as ASCII, so an omitted `encoding` turns a `# final` line into one the
    regex no longer matches and the night reads as having no clock evidence."""
    _seams_raw(
        tmp_path,
        [
            "# stream=ecg rule=clock-seam bound_ms=60000 unit=ms basis=device-minus-host réveil",
            "phone_ts;idx",
            "# final stream=ecg seams=0 examined=7",
        ],
    )
    assert _in_c_locale(lambda: si.clocks(str(tmp_path), "H10"))["status"] == "PASS", "seams sidecar"

    (tmp_path / f"{BASE}_ECGSEAMS.txt").unlink()
    (tmp_path / "Wellue_O2Ring-S_S8AW2100_20260920230000_RTCLOG.csv").write_text(
        "Phone timestamp;event;rtc_offset_s\nt;note;réveil du capteur\nt;read;-1.6\n", encoding="utf-8"
    )
    assert _in_c_locale(lambda: si.clocks(str(tmp_path), "O2Ring-S"))["status"] == "PASS", "rtc log"


def test_both_sidecars_REPLACE_an_undecodable_byte_rather_than_dying_on_it(tmp_path):
    """`errors="replace"`, kept. A torn byte is a live-journal shape; a strict decode raises inside the
    audit and takes the whole night's clock evidence with it, where the rows either side still answer."""
    p = tmp_path / f"{BASE}_ECGSEAMS.txt"
    with open(p, "wb") as fh:
        fh.write(b"# stream=ecg rule=clock-seam \xff\xfe torn\n")
        fh.write(b"phone_ts;idx\n# final stream=ecg seams=0 examined=7\n")
    assert si.clocks(str(tmp_path), "H10")["status"] == "PASS", "seams sidecar"

    p.unlink()
    r = tmp_path / "Wellue_O2Ring-S_S8AW2100_20260920230000_RTCLOG.csv"
    with open(r, "wb") as fh:
        fh.write(b"Phone timestamp;event;rtc_offset_s\nt;note;\xff\xfe\nt;read;-1.6\n")
    assert si.clocks(str(tmp_path), "O2Ring-S")["status"] == "PASS", "rtc log"


# ── completeness on a POLLED stream: the denominator must be stated, not manufactured ───────────────

RING = {"name": "Wellue O2Ring-S", "model": "O2Ring-S"}
RING_BASE = "Wellue_O2Ring-S_S8AW2100_20260920230000"


def _spo2(d, rows, period_s=1.0, expected=None, signal="spo2_hr_motion@1Hz"):
    """A ring `_SPO2.csv` plus the acquisition evidence its writer lays beside it. `period_s` is the POLL
    period: the box sleeps a fixed interval and then does the work, so the real cadence is 1 s + work."""
    p = d / f"{RING_BASE}_SPO2.csv"
    out = []
    for i in range(rows):
        t = T0 + dt.timedelta(seconds=i * period_s)
        out.append(f"{t:%H:%M:%S %d/%m/%Y},97")
    p.write_text("Time,Oxygen Level\n" + "\n".join(out) + "\n")
    ev = {"signal": signal, "source": "live", "expected_sample_count": "UNKNOWN" if expected is None else expected}
    (d / (p.name + ".meta.json")).write_text(json.dumps({"acquisition_evidence": ev}))
    return p


def test_a_polled_stream_does_not_bind_the_completeness_band(tmp_path):
    """The 2026-09-28 ring night in miniature: the poll period is the sleep PLUS the work, so the count
    drifts below the nominal on a night when nothing was lost. Dividing by the `@1Hz` in the signal NAME
    produced a FAIL about drift."""
    _spo2(tmp_path, 197, period_s=1.0149)
    out = si.completeness(
        str(tmp_path),
        RING["name"],
        "O2Ring-S",
        [str(tmp_path / f"{RING_BASE}_SPO2.csv")],
        T0,
        T0 + dt.timedelta(seconds=200),
    )
    assert out["status"] == "NOT_APPLICABLE"
    assert "polled stream, rate declared not negotiated" in out["reason"]
    assert "1 Hz is the nominal in the signal name" in out["reason"]
    assert "continuity band" in out["reason"], "the coverage question is named, not dropped"


def test_a_writer_that_STATES_its_expected_count_is_judged_against_that_number(tmp_path):
    """The rule self-heals: the box already writes a real `expected_sample_count` for downloaded
    `STORED.dat` sessions, so the day the live writer can state one, completeness binds again — against
    the number the writer stated, never against a nominal."""
    _spo2(tmp_path, 200, expected=200)
    p = [str(tmp_path / f"{RING_BASE}_SPO2.csv")]
    assert si.completeness(str(tmp_path), RING["name"], "O2Ring-S", p, T0, T0 + dt.timedelta(seconds=200)) == {
        "status": "PASS",
        "reason": None,
    }
    _spo2(tmp_path, 150, expected=200)
    out = si.completeness(str(tmp_path), RING["name"], "O2Ring-S", p, T0, T0 + dt.timedelta(seconds=200))
    assert out["status"] == "FAIL"
    assert "expected_sample_count stated beside the stream" in out["reason"], "the FAIL names its basis"
    assert "200 expected" in out["reason"]


def test_a_stated_count_that_is_not_a_positive_integer_is_no_count_at_all(tmp_path):
    """§∅: `"UNKNOWN"`, a zero, a float and a bool are each an absence of a count, not a count. `True` is
    an `int` in Python and would otherwise read as an expectation of one sample."""
    p = [str(tmp_path / f"{RING_BASE}_SPO2.csv")]
    for bad in (None, 0, -5, 1.5, True, "200"):
        _spo2(tmp_path, 197, period_s=1.0149, expected=bad)
        assert si.stated_expected_count(p[0]) is None, bad
        assert (
            si.completeness(str(tmp_path), RING["name"], "O2Ring-S", p, T0, T0 + dt.timedelta(seconds=200))["status"]
            == "NOT_APPLICABLE"
        ), bad


def test_a_stream_with_no_meta_at_all_is_still_UNKNOWN_not_inapplicable(tmp_path):
    """No evidence beside the stream is a different answer from evidence that says the rule does not
    bind: without it there is no rate either, and an undecided band must not read as an excused one."""
    (tmp_path / f"{RING_BASE}_SPO2.csv").write_text("Time,Oxygen Level\n23:00:00 20/09/2026,97\n")
    out = si.completeness(
        str(tmp_path),
        RING["name"],
        "O2Ring-S",
        [str(tmp_path / f"{RING_BASE}_SPO2.csv")],
        T0,
        T0 + dt.timedelta(seconds=200),
    )
    assert out == {"status": "UNKNOWN", "reason": "no rate declared in the stream's acquisition evidence"}


def test_a_NEGOTIATED_rate_still_binds_the_band_exactly_as_before(tmp_path):
    """The change must not reach the PMD streams, which is where this band has always done its work: the
    H10's rate comes from a record of what the device and host AGREED, and `rate x span` is a completeness
    measure for a clocked stream."""
    _ecg(tmp_path)
    _seams(tmp_path)
    _audit(tmp_path)
    b = _bands(tmp_path)[H10["name"]]["bands"]["completeness"]
    assert b["status"] == "PASS"
    _ecg(tmp_path, seconds=100)
    out = _bands(tmp_path)[H10["name"]]["bands"]["completeness"]
    assert out["status"] == "FAIL" and "at 2 Hz" in out["reason"]


# ── the drain: what the band's EDGES and its message actually say (#3243's 18 survivors) ─────────────


def test_the_completeness_band_is_INCLUSIVE_at_both_edges(tmp_path):
    """0.99 and 1.01 are the band, not the first values outside it. A night at exactly 99 % PASSES — an
    exclusive edge would fail the one measurement the bar was chosen to admit, and the bar was set at ten
    times a healthy H10 night's shortfall precisely so the edge is reachable."""
    assert si._complete_ratio(99, 100.0, "basis") == {"status": "PASS", "reason": None}
    assert si._complete_ratio(101, 100.0, "basis") == {"status": "PASS", "reason": None}
    assert si._complete_ratio(9899, 10000.0, "basis")["status"] == "FAIL", "just under 0.99 is out"
    assert si._complete_ratio(10101, 10000.0, "basis")["status"] == "FAIL", "just over 1.01 is out"


def test_a_completeness_FAIL_states_the_rows_the_denominator_and_the_percentage(tmp_path):
    """A percentage with no denominator behind it cannot be argued with, and the numbers are the whole
    reason the band's reason exists — an operator reads them to tell a short night from a wrong rate."""
    out = si._complete_ratio(23826, 24179.0, "at 1 Hz")
    assert out["status"] == "FAIL"
    assert out["reason"] == "23826 rows against 24179 expected at 1 Hz = 98.54 %", out["reason"]


def test_a_stated_count_of_ONE_is_a_count(tmp_path):
    """`n > 0`, not `n > 1`. A one-sample stream is a real stream, and treating its stated count as absent
    would send it to the no-denominator path with a count sitting right there in its evidence."""
    p = tmp_path / f"{RING_BASE}_SPO2.csv"
    p.write_text("Time,Oxygen Level\n23:00:00 20/09/2026,97\n")
    (tmp_path / (p.name + ".meta.json")).write_text(json.dumps({"acquisition_evidence": {"expected_sample_count": 1}}))
    assert si.stated_expected_count(str(p)) == 1


def test_a_worn_interval_of_exactly_ONE_expected_sample_is_still_a_length(tmp_path):
    """`expected <= 0` is the refusal, not `expected <= 1`: a one-sample expectation is small, not absent,
    and refusing it would read as "the worn interval has no length" about an interval that has one.

    Driven through `completeness` itself, at the one denominator that separates the two cuts: 2 Hz over
    half a second is expected == 1.0 exactly. Asserting `_complete_ratio` instead would never reach the
    guard — it lives one call up."""
    _ecg(tmp_path)
    _seams(tmp_path)  # 2 Hz
    p = [str(tmp_path / f"{BASE}_ECG.txt")]
    out = si.completeness(str(tmp_path), H10["name"], "H10", p, T0, T0 + dt.timedelta(seconds=0.5))
    assert out["reason"] != "the worn interval has no length", "one expected sample is a length"
    assert out["status"] in ("PASS", "FAIL"), out


def test_the_no_length_refusal_carries_the_STATUS_WORD_and_not_a_null(tmp_path):
    """§∅ and §🧾 together: a decision whose status is None is not a decision, and `device_outcome` would
    refuse it — but only if some test ever drives this arm."""
    _ecg(tmp_path)
    _seams(tmp_path)
    p = [str(tmp_path / f"{BASE}_ECG.txt")]
    out = si.completeness(str(tmp_path), H10["name"], "H10", p, T0, T0)  # zero-length interval
    assert out == {"status": "UNKNOWN", "reason": "the worn interval has no length"}


def test_COMPLETENESS_looks_the_rate_up_for_THIS_DEVICE(tmp_path):
    """`PMDNEG.csv` is per device, so dropping the device from `completeness`'s lookup judges the night
    against a denominator belonging to a different sensor — or against none at all, which reads as
    "negotiated rate not written beside the stream" about a stream whose rate IS written.

    There is no seam sidecar here on purpose: with one, the rate comes from the file and the device is
    never consulted, so the mutant would survive a test that looks right."""
    _ecg(tmp_path)
    p = [str(tmp_path / f"{BASE}_ECG.txt")]
    (tmp_path / "PMDNEG.csv").write_text(
        "Phone timestamp;device;address;stream;requested_hz;offered_hz;chosen_hz;ack;how\n"
        "t;Polar H10 02849638;a;ecg;;;2;ok;negotiated\n"
    )
    out = si.completeness(str(tmp_path), H10["name"], "H10", p, T0, T0 + dt.timedelta(seconds=200))
    assert out == {"status": "PASS", "reason": None}, out
    # the same call for a device with no row of its own cannot borrow the H10's rate
    out = si.completeness(str(tmp_path), "SOMEBODY ELSE", "H10", p, T0, T0 + dt.timedelta(seconds=200))
    assert out["reason"] == "negotiated rate not written beside the stream (#2912)"


def test_a_rate_of_exactly_ONE_HERTZ_is_a_rate(tmp_path):
    """`> 0`, not `> 1` — and this is not academic: 1 Hz is the O2Ring's own declared rate, the stream this
    whole unit is about. Rejecting it would send every ring night down the no-rate path."""
    _ecg(tmp_path)
    _seams(tmp_path, rate="1")
    p = str(tmp_path / f"{BASE}_ECG.txt")
    assert si.negotiated_rate(str(tmp_path), H10["name"], "H10", p) == (1.0, "the stream's own # pmd line")
    (tmp_path / f"{BASE}_ECGSEAMS.txt").unlink()
    (tmp_path / "PMDNEG.csv").write_text(
        "Phone timestamp;device;address;stream;requested_hz;offered_hz;chosen_hz;ack;how\n"
        "t;Polar H10 02849638;a;ecg;;;1;ok;negotiated\n"
    )
    assert si.negotiated_rate(str(tmp_path), H10["name"], "H10", p) == (1.0, "PMDNEG.csv")


def test_a_PMDNEG_row_of_EXACTLY_eight_cells_is_read(tmp_path):
    """`len(p) >= 8`, and the boundary is the row the box actually writes when `how` is empty — a `> 8` or
    `>= 9` cut drops it and the rate silently becomes unavailable."""
    _ecg(tmp_path)
    p = str(tmp_path / f"{BASE}_ECG.txt")
    (tmp_path / "PMDNEG.csv").write_text(
        "Phone timestamp;device;address;stream;requested_hz;offered_hz;chosen_hz;ack\n"
        "t;Polar H10 02849638;a;ecg;;;130;ok\n"
    )
    assert si.negotiated_rate(str(tmp_path), H10["name"], "H10", p) == (130.0, "PMDNEG.csv")


def test_the_PMDNEG_reader_declares_its_encoding_AND_degrades_on_a_bad_byte(tmp_path):
    """The same two claims as the sidecar readers above, for the one reader E17's diff pulled into scope.

    `errors="replace"` is testable in process: a PMDNEG row carrying a byte that is not valid UTF-8 must
    still yield the stream's rate, because a `UnicodeDecodeError` here would take the whole night's
    verdict down over one mangled device name. `encoding="utf-8"` is not — it is a claim about the BOX,
    and on a UTF-8 machine `encoding=None` behaves identically — so it is asserted on the CALL with
    `-X warn_default_encoding`, exactly as the seam readers are. The in-process call first is NOT
    redundant: mutmut picks a mutant's tests from COVERAGE, and a subprocess is invisible to the tracer.
    """
    import subprocess
    import sys

    _ecg(tmp_path)
    p = str(tmp_path / f"{BASE}_ECG.txt")
    (tmp_path / "PMDNEG.csv").write_bytes(
        b"Phone timestamp;device;address;stream;requested_hz;offered_hz;chosen_hz;ack;how\n"
        b"t;Polar \xff\xfe H10;a;ecg;;;99;ok;negotiated\n"
        b"t;Polar H10 02849638;a;ecg;;;130;ok;negotiated\n"
    )
    assert si.negotiated_rate(str(tmp_path), H10["name"], "H10", p) == (130.0, "PMDNEG.csv")
    src = (
        "import solid_night_inputs as si\n"
        f"r = si.negotiated_rate({str(tmp_path)!r}, {H10['name']!r}, 'H10', {p!r})\n"
        "assert r == (130.0, 'PMDNEG.csv'), r\n"
    )
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=str(si.__file__).rsplit("/", 1)[0],
    )
    assert r.returncode == 0, r.stderr


# ── SOLID-NIGHT §A5 — the unrecorded-shift tripwire ─────────────────────────────────────────────────


def _axis(
    minutes=10,
    rate=2.0,
    step_ms=0.0,
    at_min=5.0,
    rows_hz=None,
    cut_at_min=None,
    latency_from_min=None,
    gap_min=None,
    gap_s=30.0,
):
    """A two-clock stream with a plantable device-clock STEP and a plantable delivery collapse.

    `step_ms` shifts the DEVICE column from `at_min` onward — host arrival is untouched, so the residual
    (host − device) moves by exactly that much and STAYS there, which is what a clock step looks like and
    what a latency transient does not. `latency_from_min` thins the rows instead, leaving the residual
    alone: that is the 09-19 shape Guard 1 exists to refuse."""
    rows = []
    t0 = T0
    n = int(minutes * 60 * (rows_hz or rate))
    for i in range(n):
        sec = i / (rows_hz or rate)
        host = t0 + dt.timedelta(seconds=sec)
        if cut_at_min is not None and sec >= cut_at_min * 60:
            break
        if latency_from_min is not None and sec >= latency_from_min * 60 and i % 4:
            continue  # the link delivers a quarter of the rows: a backlog, not a step
        if gap_min is not None and gap_min * 60 <= sec < gap_min * 60 + gap_s:
            continue  # nothing arrives at all for `gap_s`: the after-window is not flowing normally
        # DEVICE JITTER IS NOT DECORATION. A perfectly regular device column is a DRAWN axis by the band's
        # own test (99.9 % modal delta), and the night is refused before the tripwire is ever consulted.
        jit = (i * 37) % 101 - 50  # 101 distinct offsets, so no delta value can dominate
        dev_ns = int(sec * 1e9) + jit * 1_000_000 - (int(step_ms * 1e6) if sec >= at_min * 60 else 0)
        rows.append(f"{host:%Y-%m-%dT%H:%M:%S}.{host.microsecond // 1000:03d};{dev_ns};1")
    return "Phone timestamp;sensor timestamp [ns];ecg\n" + "\n".join(rows) + "\n"


def test_the_DEVICE_COLUMN_may_be_the_LAST_one_in_the_header(tmp_path):
    """The header is resolved by NAME, so the device column's POSITION is not part of the contract — and
    when it is last, the header line's own newline is still attached to it. The box itself wrote a
    different column order until 2026-08-05 (`5e5ac71a`, see `loss_audit.py`), a Polar Sensor Logger
    export is a first-class input (CLAUDE.md §🎙️) and `test_loss_audit.py`'s `_polar(dev_last=True)`
    already exercises exactly this shape. `rstrip` is what makes the name match: `lstrip` leaves
    `"sensor timestamp [ns]\n"`, the membership test misses, and a two-clock stream reports NO DEVICE
    CLOCK — the axis is not measured and §A5 never runs over it."""
    cols = _axis().splitlines()
    hdr = cols[0].split(";")
    assert hdr[1] == si._SENSOR_NS_COL, "the helper writes the device column second; this test moves it last"
    reordered = [";".join([hdr[0], hdr[2], hdr[1]])]
    for line in cols[1:]:
        c = line.split(";")
        reordered.append(";".join([c[0], c[2], c[1]]))
    p = tmp_path / f"{BASE}_ECG.txt"
    p.write_text("\n".join(reordered) + "\n")
    scan = si.residual_scan(str(p), None, None)
    assert scan["reason"] is None, scan["reason"]
    assert len(scan["anchors"]) > 2, "the device column was found and the axis was measured"


def _a5(d, *, records=(), nominal=2.0, **kw):
    p = d / f"{BASE}_ECG.txt"
    p.write_text(_axis(**kw))
    scan = si.residual_scan(str(p), None, None)
    return si.unrecorded_shift(scan, [r.timestamp() * 1000.0 for r in records], nominal)


def test_CONTROL_a_stepless_night_trips_nothing(tmp_path):
    """The control the owner asked for: no step planted, no candidate found, so the band may PASS."""
    assert _a5(tmp_path) is None


def test_a_planted_unrecorded_step_fires_the_tripwire_as_UNKNOWN_never_FAIL(tmp_path):
    """The fire is UNKNOWN `unrecorded-shift-candidate`. It is NOT a FAIL, and that is the whole shape of
    A5: over n = 36 clean nights the corpus holds zero true unrecorded steps, so the detector has never
    been validated against the thing it would convict."""
    out = _a5(tmp_path, step_ms=4000.0)
    assert out["status"] == "UNKNOWN"
    assert "unrecorded-shift-candidate" in out["reason"]
    assert "+4 s persistent shift" in out["reason"]
    assert "no record in any of the three sources" in out["reason"]
    # ONE VANTAGE PER 10 s BIN, and the count is derived rather than magic: the 600 s segment is eligible
    # from +90 s (the before-window's width) to −120 s (the after-window's), so 390 s / `A5_BIN_S` = 39.
    # This is the ONLY thing the one-per-bin dedup changes — with `_win_median` bisected, defeating it
    # evaluates every anchor, finishes just as fast and returns the same verdict. Without this assertion
    # that mutant is an honest survivor; with it, it dies on the number.
    assert out["vantages"] == 39
    assert out["vantages"] == int((10 * 60 - 90 - 120) / si.A5_BIN_S) + 0


def test_a_step_the_box_RECORDED_is_not_a_finding(tmp_path):
    """The 2026-08-18 mistake, planted: the same step with a clock event logged 68 s later — the real lag
    in that night's journal — must not be convicted."""
    rec = T0 + dt.timedelta(minutes=5, seconds=68)
    assert _a5(tmp_path, step_ms=4000.0, records=(rec,)) is None


def test_a_record_just_OUTSIDE_the_match_window_does_not_excuse_the_step(tmp_path):
    """The window is pre-stated at 300 s and is not a licence to absorb any nearby event."""
    rec = T0 + dt.timedelta(minutes=5, seconds=si.A5_RECORD_NEAR_S + 30)
    out = _a5(tmp_path, step_ms=4000.0, records=(rec,))
    assert out is not None and "unrecorded-shift-candidate" in out["reason"]


def test_clock_sets_too_dense_to_attribute_are_named_not_convicted(tmp_path):
    """The 08-28 → 09-12 resync storm: one set every ~5.5 min, where flips minutes apart cannot be
    assigned to one another. The records sit inside the persistence span but outside the match window."""
    recs = [T0 + dt.timedelta(minutes=5, seconds=s) for s in (-85, 115)]
    out = _a5(tmp_path, step_ms=4000.0, records=recs)
    assert out["status"] == "UNKNOWN" and "too dense to attribute" in out["reason"]


def test_GUARD_1_a_delivery_collapse_is_a_latency_regime_not_a_step(tmp_path):
    """09-19, the night that shaped both guards: the residual ramps while the ROW RATE collapses to
    25–90 % of nominal. A clock step holds delivery at the nominal rate while the level moves."""
    out = _a5(tmp_path, step_ms=4000.0, latency_from_min=5.0)
    assert out["status"] == "UNKNOWN" and "latency regime" in out["reason"]
    assert "rows/s against a nominal" in out["reason"]


def test_GUARD_2_a_step_at_the_end_of_the_stream_cannot_establish_persistence(tmp_path):
    """The level "after" must be measured on data that exists: 09-19's after-window sat inside the
    backlog, just before the link was cut."""
    # The gap sits just AFTER the after-window (which runs to +120 s) and inside `A5_GAP_NEAR_S` of its
    # end, so delivery inside the window is nominal and Guard 1 has nothing to say: this isolates Guard 2.
    out = _a5(tmp_path, step_ms=4000.0, at_min=5.0, gap_min=425.0 / 60.0, gap_s=3.0)
    assert out["status"] == "UNKNOWN" and "persistence across a gap" in out["reason"]


def test_a_guard_that_CANNOT_BE_APPLIED_stops_the_fire_rather_than_skipping(tmp_path):
    """Both guards must PASS before the tripwire may fire, so a nominal rate that is not recorded beside
    the stream stops it — the only positive the first cut of this detector produced was one Guard 1 would
    have refused."""
    out = _a5(tmp_path, step_ms=4000.0, nominal=None)
    assert out["status"] == "UNKNOWN" and "Guard 1 (delivery rate) could not be applied" in out["reason"]


def test_a_shift_UNDER_the_pre_stated_bound_is_not_a_candidate(tmp_path):
    """The bound is 1 s against a quiet windowed-shift p99.9 of 81 ms over n = 36 clean nights, pre-stated
    in the brief and never derived from a night being judged."""
    assert _a5(tmp_path, step_ms=si.A5_STEP_MS - 200.0) is None
    assert _a5(tmp_path, step_ms=si.A5_STEP_MS + 200.0) is not None


def test_a_TRANSIENT_that_returns_is_not_a_step(tmp_path):
    """Persistence, never the windowed peak: 1 237 of 1 756 corpus events above 1 s were delivery-latency
    transients that RETURN. A peak detector convicts every one of them."""
    p = tmp_path / f"{BASE}_ECG.txt"
    rows, t0 = [], T0
    for i in range(10 * 60 * 2):
        sec = i / 2.0
        host = t0 + dt.timedelta(seconds=sec)
        bump = int(4000 * 1e6) if 300.0 <= sec < 320.0 else 0  # a 20 s excursion that comes back
        rows.append(f"{host:%Y-%m-%dT%H:%M:%S}.{host.microsecond // 1000:03d};{int(sec * 1e9) - bump};1")
    p.write_text("Phone timestamp;sensor timestamp [ns];ecg\n" + "\n".join(rows) + "\n")
    assert si.unrecorded_shift(si.residual_scan(str(p), None, None), [], 2.0) is None


def _clocksync(d, rows, name="2026-09-20"):
    p = d / name
    p.mkdir(exist_ok=True)
    (p / "CLOCKSYNC.csv").write_text("Phone timestamp;device;address;event;skew_sec;detail\n" + "\n".join(rows) + "\n")


def test_the_record_set_reads_CLOCKSYNC_from_the_NEXT_date_too(tmp_path):
    """`writers.clocksync_row` keys a row by the EVENT's wall date, so a cross-midnight session leaves its
    late rows in the NEXT date's folder. A night that ends at 04:00 would otherwise have every
    post-midnight sync invisible — and missing the record is the one failure mode this must not have."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    (night / "LOSS-AUDIT.json").write_text(json.dumps({"clock_events": []}))
    _clocksync(tmp_path, ["2026-09-21T00:30:00;Polar H10 02849638;a;resynced;1.0;watchdog"], name="2026-09-21")
    recs, how = si.clock_records(
        str(night), H10["name"], str(night / f"{BASE}_ECG.txt"), T0, T0 + dt.timedelta(hours=8)
    )
    assert len(recs) == 1 and "CLOCKSYNC.csv" in how


def test_deferred_absent_is_the_one_event_word_that_is_NOT_a_record(tmp_path):
    """It means the device was not reachable and NOTHING was written to its clock — 153 of 2026-09-28's
    rows. Every other word, including the failures, records that the daemon was writing to that clock."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    (night / "LOSS-AUDIT.json").write_text(json.dumps({"clock_events": []}))
    _clocksync(
        tmp_path,
        [
            "2026-09-20T23:10:00;Polar H10 02849638;a;deferred-absent;;attempt 1",
            "2026-09-20T23:20:00;Polar H10 02849638;a;resync-failed;;hard",
            "2026-09-20T23:30:00;Polar Sense 0C301E3F;a;resynced;;other device",
        ],
    )
    recs, _how = si.clock_records(
        str(night), H10["name"], str(night / f"{BASE}_ECG.txt"), T0, T0 + dt.timedelta(hours=8)
    )
    assert len(recs) == 1, "the failure is a record, the deferral is not, the other device is not ours"


def test_a_MISSING_record_source_returns_None_rather_than_a_shorter_record_set(tmp_path):
    """§∅ and the 08-18 lesson in one: a record set that silently shrinks lets the tripwire fire on a step
    the box logged. An unreadable source stops it instead."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    p = str(night / f"{BASE}_ECG.txt")
    recs, why = si.clock_records(str(night), H10["name"], p, T0, T0 + dt.timedelta(hours=8))
    assert recs is None and "absent or unreadable" in why
    (night / "LOSS-AUDIT.json").write_text(json.dumps({"journal": "read"}))
    recs, why = si.clock_records(str(night), H10["name"], p, T0, T0 + dt.timedelta(hours=8))
    assert recs is None and "predates the clock-event record" in why
    (night / "LOSS-AUDIT.json").write_text(json.dumps({"clock_events": None}))
    recs, why = si.clock_records(str(night), H10["name"], p, T0, T0 + dt.timedelta(hours=8))
    assert recs is None and "journalctl was unavailable" in why


def test_the_JOURNAL_half_of_the_record_set_excuses_a_step_and_respects_the_device(tmp_path):
    """The other two sources are files beside the night; this is the one that had to be carried there by
    the audit. A line that names ANOTHER device is not this device's record; one that names none is."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    at = (T0 + dt.timedelta(minutes=5)).isoformat(timespec="seconds")
    (night / "LOSS-AUDIT.json").write_text(
        json.dumps(
            {
                "clock_events": [
                    {"at": at, "phrase": "device clock JUMPED", "devices": ["Polar Sense 0C301E3F"]},
                    {"at": "not-a-stamp", "phrase": "re-sync busy", "devices": []},
                    {"at": (T0 + dt.timedelta(days=3)).isoformat(), "phrase": "re-sync busy", "devices": []},
                    {"at": at, "phrase": "off host (tolerance", "devices": []},
                ]
            }
        )
    )
    recs, _how = si.clock_records(
        str(night), H10["name"], str(night / f"{BASE}_ECG.txt"), T0, T0 + dt.timedelta(hours=8)
    )
    assert recs == [(T0 + dt.timedelta(minutes=5)).timestamp() * 1000.0], (
        "the other device's line, the unplaceable one and the one outside the interval are all excluded"
    )


def test_an_UNREADABLE_clocksync_stops_the_record_set_rather_than_shortening_it(tmp_path):
    night = tmp_path / "2026-09-20"
    night.mkdir()
    (night / "LOSS-AUDIT.json").write_text(json.dumps({"clock_events": []}))
    (night / "CLOCKSYNC.csv").mkdir()  # present, and not a file we can read
    recs, why = si.clock_records(
        str(night), H10["name"], str(night / f"{BASE}_ECG.txt"), T0, T0 + dt.timedelta(hours=8)
    )
    assert recs is None and "unreadable" in why


def test_a_night_folder_that_is_not_a_date_still_reads_its_own_clocksync(tmp_path):
    """There is no neighbouring date to compute, and that is not an error — the night's own file counts."""
    night = tmp_path / "not-a-date"
    night.mkdir()
    (night / "LOSS-AUDIT.json").write_text(json.dumps({"clock_events": []}))
    (night / "CLOCKSYNC.csv").write_text(
        "Phone timestamp;device;address;event;skew_sec;detail\n"
        "2026-09-20T23:05:00;Polar H10 02849638;a;resynced;1.0;watchdog\n"
        "short;row\n"
    )
    recs, _why = si.clock_records(
        str(night), H10["name"], str(night / f"{BASE}_ECG.txt"), T0, T0 + dt.timedelta(hours=8)
    )
    assert len(recs) == 1


def test_too_few_anchors_is_left_to_the_band_to_say_once(tmp_path):
    assert si.unrecorded_shift({"anchors": [(0.0, 0.0), (1.0, 1.0)]}, [], 2.0) is None


def test_the_TRIPWIRE_reaches_the_TIMEBASE_BAND_and_not_only_the_detector(tmp_path):
    """End to end: a planted unrecorded step makes the night's timebase band UNKNOWN with the tripwire's
    own words, rather than the detector saying so to nobody."""
    (tmp_path / f"{BASE}_ECG.txt").write_text(_axis(step_ms=4000.0))
    _seams(tmp_path)
    _runs(tmp_path, "ECG")
    _runs(tmp_path, "ACC")
    # The worn interval has to COVER the step, or the band never looks at it — the default fixture ends
    # at 23:03 and the step is planted at 23:05.
    _audit(tmp_path, clock_events=(), end="2026-09-20T23:10:00")
    tb = _bands(tmp_path)[H10["name"]]["bands"]["timebase"]
    assert tb["status"] == "UNKNOWN" and "unrecorded-shift-candidate" in tb["reason"]


def test_a_clocksync_row_that_is_unplaceable_or_outside_the_interval_is_not_a_record(tmp_path):
    """§∅ again, one layer down: a row whose stamp cannot be parsed places no event, and one outside the
    worn interval is not evidence about the stretch being judged. Neither may excuse a candidate."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    (night / "LOSS-AUDIT.json").write_text(json.dumps({"clock_events": []}))
    (night / "CLOCKSYNC.csv").write_text(
        "Phone timestamp;device;address;event;skew_sec;detail\n"
        "not-a-stamp;Polar H10 02849638;a;resynced;;unplaceable\n"
        "2026-09-19T12:00:00;Polar H10 02849638;a;resynced;;the day before\n"
        "2026-09-20T23:05:00;Polar H10 02849638;a;resynced;;inside\n"
    )
    recs, _why = si.clock_records(
        str(night), H10["name"], str(night / f"{BASE}_ECG.txt"), T0, T0 + dt.timedelta(hours=8)
    )
    assert recs == [(T0 + dt.timedelta(minutes=5)).timestamp() * 1000.0]


def test_a_step_ACROSS_a_segment_split_is_not_one_axis_and_is_not_measured(tmp_path):
    """A re-anchor wider than `A5_REANCHOR_S` ends the segment, so no vantage has one level before the
    hole and the other after it. That is the point of splitting: the two stretches are not one clock, and
    a persistence taken across them would be the difference between two different axes."""
    ms = 1_000.0
    anchors = [(i * ms, i * ms) for i in range(0, 120)]  # 0–119 s
    anchors += [(i * ms, i * ms - 4000.0) for i in range(180, 400)]  # a 60 s hole, then a 4 s step
    out = si.unrecorded_shift({"anchors": anchors, "row_bins": {}, "gaps": [], "last_row_ms": 399 * ms}, [], None)
    assert out is None, "neither side of the hole offers a vantage with both windows populated"


# ── §A5 at the EDGES: the pre-stated constants, one test per boundary ───────────────────────────────
#
# These build the `scan` dict DIRECTLY rather than writing a stream and measuring it. That is the point:
# `residual_scan` adds device jitter, BLE batching and float conversion between the plant and the level
# the tripwire reads, so a file-driven test cannot place a residual at EXACTLY `A5_STEP_MS` or a window
# edge on EXACTLY an anchor — and a boundary nothing sits on is a boundary no test can hold. The
# file-driven tests above own the integration; these own the arithmetic.

A5_T0_MS = T0.timestamp() * 1000.0


def _scan(levels, *, spacing_ms=1000.0, span_s=400.0, rate=2.0, gaps=(), last=None, rows_hz=None):
    """A synthetic residual axis. `levels` is a list of `(from_s, residual_ms)` steps, applied in order;
    the residual at an anchor is the last level whose `from_s` it has reached.

    The first anchor's residual is subtracted from every anchor by `unrecorded_shift` itself, so
    `levels` must start at 0.0 ms for the numbers here to be the numbers the tripwire sees — asserted,
    not assumed."""
    assert levels[0][1] == 0.0, "the first level is the origin and the origin is subtracted"
    n = int(span_s * 1000.0 / spacing_ms) + 1
    anchors, times = [], []
    for i in range(n):
        t = A5_T0_MS + i * spacing_ms
        r = 0.0
        for frm, lvl in levels:
            if t >= A5_T0_MS + frm * 1000.0:
                r = lvl
        anchors.append((t, t - r))  # residual = host - device = r
        times.append(t)
    # Delivered rows at exactly the nominal rate over every bin the axis spans, so Guard 1 passes unless
    # a test says otherwise. `_rows_in` sums the bins that EXIST, so the grid must cover the windows.
    hz = rows_hz if rows_hz is not None else rate
    b0 = int((A5_T0_MS - 200_000) // si.A5_BIN_MS)
    b1 = int((A5_T0_MS + span_s * 1000.0 + 200_000) // si.A5_BIN_MS)
    row_bins = {b: int(hz * si.A5_BIN_S) for b in range(b0, b1 + 1)}
    return {
        "anchors": anchors,
        "drawn_share": 0.1,
        "reason": None,
        "row_bins": row_bins,
        "gaps": list(gaps),
        "last_row_ms": times[-1] + 200_000 if last is None else last,
    }


def _at(sec):
    """The rendered `%H:%M:%S` of `sec` seconds after the axis origin — what the message must name."""
    return f"{dt.datetime.fromtimestamp(A5_T0_MS / 1000.0 + sec):%H:%M:%S}"


def test_a_persistence_of_EXACTLY_A5_STEP_MS_fires_and_the_REASON_IS_ASSERTED_WHOLE(tmp_path):
    """`abs(p) >= A5_STEP_MS` is INCLUSIVE, and 1000.0 ms is the pre-stated bound — so a shift of exactly
    one second is a finding and the next one down is not.

    The reason is asserted WHOLE, not by fragment. A `match=`/`in` on part of a message leaves every
    mutation of the rest alive: the magnitude's divisor, the instant's divisor and the wording are all
    inside this one f-string, and only the whole string holds all three."""
    out = si.unrecorded_shift(_scan([(0.0, 0.0), (200.0, si.A5_STEP_MS)]), [], 2.0)
    assert out is not None, "a shift of exactly A5_STEP_MS is at the bound, and the bound is inclusive"
    assert out["status"] == "UNKNOWN"
    assert out["reason"] == (
        f"unrecorded-shift-candidate — +1 s persistent shift at {_at(200.0)}, "
        "with no record in any of the three sources"
    )


def test_a_persistence_ONE_MILLISECOND_under_the_bound_is_not_a_candidate(tmp_path):
    """The other side of the same edge — without it, "inclusive" is untested in the only direction that
    distinguishes it from "any shift at all"."""
    assert si.unrecorded_shift(_scan([(0.0, 0.0), (200.0, si.A5_STEP_MS - 1.0)]), [], 2.0) is None


def test_a_NEGATIVE_shift_whose_AFTER_level_is_EXACTLY_ZERO_is_still_a_shift(tmp_path):
    """§∅ in the small: the level after the step is 0.0 ms, which is a MEASURED level and not an absent
    one. `(after or 0.0)` must not read a measured zero as missing — a residual that returns exactly to
    its origin is the most ordinary thing a negative step can do."""
    # The rise to 1000 ms sits at 20 s, inside the first before-window: the earliest vantage is at
    # +90 s and its before-window already reads 1000, so the rise is never a candidate and the FALL is
    # the only one. Without that, the two are equally strong and the earlier one wins on its own merits.
    out = si.unrecorded_shift(_scan([(0.0, 0.0), (20.0, 1000.0), (250.0, 0.0)]), [], 2.0)
    assert out is not None
    assert out["reason"] == (
        f"unrecorded-shift-candidate — -1 s persistent shift at {_at(250.0)}, "
        "with no record in any of the three sources"
    )


def test_TWO_EQUALLY_STRONG_shifts_report_the_EARLIER_INSTANT(tmp_path):
    """A tie must resolve one way and the earlier instant is the one worth reviewing: it is where the axis
    first stopped describing one clock. `abs(p) > abs(best_p)` keeps the FIRST of equal candidates; `>=`
    would silently report the last, and within one plateau both read the same instant, so only two
    separate steps can tell them apart.

    480 s apart, which is deliberate: one vantage reaches from −90 s to +120 s, so steps closer than
    210 s share a window and the windowed difference then reports a COMBINATION of the two rather than
    either (measured here: 120 s and 260 s apart gave +2.25 s, the mean of 1500 and 3000, from a vantage
    whose after-window straddled the second step exactly in half). That is a property of the windowed
    method, not of the tie-break, and this test is about the tie-break."""
    out = si.unrecorded_shift(_scan([(0.0, 0.0), (120.0, 1500.0), (600.0, 3000.0)], span_s=800.0), [], 2.0)
    assert out is not None
    assert out["reason"] == (
        f"unrecorded-shift-candidate — +1.5 s persistent shift at {_at(120.0)}, "
        "with no record in any of the three sources"
    ), "the EARLIER of two equally strong shifts"


def test_the_EARLIEST_and_LATEST_USABLE_VANTAGE_are_both_evaluated(tmp_path):
    """`t < lo or t > hi` excludes the vantages whose windows fall outside the segment, and both ends are
    USABLE: at `lo` the before-window's far edge is the segment's first anchor, at `hi` the after-window's
    far edge is its last. One anchor per `A5_BIN_S` makes the count the vantage count, so excluding
    either end shows up as a number rather than as nothing at all."""
    scan = _scan([(0.0, 0.0), (200.0, 4000.0)], spacing_ms=si.A5_BIN_MS, span_s=400.0)
    out = si.unrecorded_shift(scan, [], 2.0)
    assert out is not None
    # lo = first + 90 s, hi = last − 120 s, inclusive at both ends, one anchor every 10 s:
    assert out["vantages"] == int((400.0 - 90.0 - 120.0) / si.A5_BIN_S) + 1 == 20


def test_the_VANTAGES_are_ONE_PER_BIN_even_when_the_ANCHORS_are_denser(tmp_path):
    """The dedup, stated as a number over a grid ten times finer than the bin. This is the one thing the
    dedup changes: `_win_median` bisects, so a mutant that defeats it evaluates every anchor, returns the
    same verdict and finishes just as fast (`x_unrecorded_shift__mutmut_77` on run 36651159596)."""
    dense = _scan([(0.0, 0.0), (200.0, 4000.0)], spacing_ms=1000.0, span_s=400.0)
    coarse = _scan([(0.0, 0.0), (200.0, 4000.0)], spacing_ms=si.A5_BIN_MS, span_s=400.0)
    a, b = si.unrecorded_shift(dense, [], 2.0), si.unrecorded_shift(coarse, [], 2.0)
    assert a is not None and b is not None
    assert a["vantages"] == b["vantages"] == 20, "ten times the anchors, the same grid"
    assert a["reason"] == b["reason"]


def test_the_FIRST_ANCHOR_of_a_segment_BELONGS_to_it(tmp_path):
    """The segment is seeded with `pts[0]`, so the earliest usable vantage is measured from the axis's own
    first anchor. Seeding with `pts[1]` instead loses one anchor and one bin of eligibility — invisible in
    the verdict, visible in the count."""
    scan = _scan([(0.0, 0.0), (200.0, 4000.0)], spacing_ms=si.A5_BIN_MS, span_s=400.0)
    out = si.unrecorded_shift(scan, [], 2.0)
    assert out["vantages"] == 20
    dropped = dict(scan, anchors=scan["anchors"][1:])
    assert si.unrecorded_shift(dropped, [], 2.0)["vantages"] == 19, "one anchor fewer IS one vantage fewer"


def test_EVERY_CONSECUTIVE_PAIR_decides_the_SEGMENT_SPLIT(tmp_path):
    """A re-anchor wider than `A5_REANCHOR_S` splits the axis, and the split is decided on ADJACENT pairs.
    Comparing every other pair instead both misses a split and drops an anchor; here the gap sits between
    the second and third anchors, where only an adjacent comparison can see it."""
    scan = _scan([(0.0, 0.0), (200.0, 4000.0)], spacing_ms=si.A5_BIN_MS, span_s=400.0)
    a = list(scan["anchors"])
    shifted = [(t + 70_000.0, d + 70_000.0) for t, d in a[2:]]  # a 70 s re-anchor after the 2nd anchor
    out = si.unrecorded_shift(dict(scan, anchors=a[:2] + shifted, last_row_ms=shifted[-1][0] + 200_000), [], 2.0)
    assert out is not None, "the second segment is long enough to carry the step"
    # The two-anchor head cannot host a vantage at all, so the count is the TAIL segment's alone: it spans
    # 400 − 20 = 380 s and loses the two window widths.
    assert out["vantages"] == int((380.0 - 90.0 - 120.0) / si.A5_BIN_S) + 1 == 18


def test_GUARD_2_fires_on_the_END_OF_THE_STREAM_ALONE_with_no_gap_recorded(tmp_path):
    """The two arms of Guard 2 are separate facts. A night can end cleanly — no host gap anywhere — and
    still leave an after-window that runs off the end of the data, and `last_row_ms` is the only thing
    that says so. With `gaps` empty, this is the only arm that can fire."""
    scan = _scan([(0.0, 0.0), (200.0, 4000.0)])
    at_ms = A5_T0_MS + 200_000.0
    ends_early = dict(scan, gaps=[], last_row_ms=at_ms + si.A5_AFTER_MS[1] + si.A5_GAP_NEAR_MS - 1.0)
    out = si.unrecorded_shift(ends_early, [], 2.0)
    assert out is not None and "persistence across a gap" in out["reason"], out
    flowing = dict(scan, gaps=[], last_row_ms=at_ms + si.A5_AFTER_MS[1] + si.A5_GAP_NEAR_MS)
    assert "unrecorded-shift-candidate" in si.unrecorded_shift(flowing, [], 2.0)["reason"], "at the bound it flows"


def test_GUARD_1_is_INCLUSIVE_at_its_TOLERANCE_and_states_the_RATE_IT_MEASURED(tmp_path):
    """`> A5_RATE_TOL` is strict, so a window exactly 10 % off nominal is NOT a latency regime — the
    tolerance is the width of the band that counts as nominal, not the first value outside it. And the
    refusal must quote the rate it measured, which is rows DIVIDED by seconds."""
    at_s = 200.0
    # 11 Hz AGAINST A NOMINAL 10, and the numbers are chosen for BINARY EXACTNESS, not for realism:
    # `abs(11.0 - 10.0) / 10.0` is `1.0 / 10.0`, which IS the double that `A5_RATE_TOL = 0.10` denotes,
    # so the comparison sits exactly on the bound. The obvious plant — 1.8 Hz against 2 — computes
    # 0.09999999999999998 and lands INSIDE the band whichever way the operator points, which is a
    # boundary test that tests no boundary.
    assert abs(11.0 - 10.0) / 10.0 == si.A5_RATE_TOL, "the plant must be bit-exactly ON the bound"
    edge = _scan([(0.0, 0.0), (at_s, 4000.0)], rows_hz=11.0)
    assert "unrecorded-shift-candidate" in si.unrecorded_shift(edge, [], 10.0)["reason"], "10 % off is nominal"
    over = _scan([(0.0, 0.0), (at_s, 4000.0)], rows_hz=11.1)
    out = si.unrecorded_shift(over, [], 10.0)
    assert out["reason"] == (
        f"latency regime — the before window delivered 11.1 rows/s against a nominal 10 Hz, so "
        f"+4 s persistent shift at {_at(at_s)} is a delivery backlog and not a step"
    )


def test_the_MS_CONSTANTS_ARE_the_briefs_SECONDS_and_nothing_else(tmp_path):
    """The second-to-millisecond conversions are named once, so their values are stated once here rather
    than re-derived at eight call sites. §A5's windows are −90..−30 s before and +60..+120 s after."""
    assert si.A5_BEFORE_MS == (-90_000.0, -30_000.0)
    assert si.A5_AFTER_MS == (60_000.0, 120_000.0)
    assert si.A5_REANCHOR_MS == 60_000.0
    assert si.A5_GAP_NEAR_MS == 10_000.0
    assert si.A5_RECORD_NEAR_MS == 300_000.0
    assert si.A5_GAP_FLOOR_MS == 2_000.0
    assert si.A5_BIN_MS == 10_000


def test_an_EMPTY_WINDOW_has_NO_MEDIAN_and_says_so_rather_than_returning_zero(tmp_path):
    """`_win_median`'s stated contract, tested where the contract lives. §∅ in the small: an unmeasured
    level is absent, and a persistence computed from a fabricated 0.0 would be the difference between a
    real level and a fiction.

    TESTED DIRECTLY, because `unrecorded_shift` cannot produce an empty window — the segments are split
    at anchor gaps WIDER than the window, so a gap able to empty one has already ended the segment. The
    guard is still the function's promise to every other caller, and `j > i` is the whole of it."""
    times = [1000.0, 2000.0, 3000.0]
    vals = [10.0, 20.0, 30.0]
    assert si._win_median(times, vals, 1000.0, 3001.0) == 20.0
    assert si._win_median(times, vals, 1200.0, 1900.0) is None, "a window between two anchors holds none"
    assert si._win_median(times, vals, 2000.0, 2000.0) is None, "a window of zero width holds none"
    assert si._win_median(times, vals, 4000.0, 5000.0) is None, "past the last anchor"
    assert si._win_median([], [], 0.0, 1.0) is None, "no anchors at all"
    # HALF-OPEN, which is what makes the zero-width case empty rather than one-sided.
    assert si._win_median(times, vals, 2000.0, 3000.0) == 20.0
    assert si._win_median(times, vals, 2001.0, 3001.0) == 30.0


def test_the_CROSSING_is_the_FIRST_ANCHOR_AT_OR_PAST_HALF_the_persistence(tmp_path):
    """HALF is pre-stated, and the reason is in `_a5_crossing`'s docstring: a real transition is not
    instantaneous, and the residual crosses the MIDPOINT once while it may approach the far level
    asymptotically or overshoot it. A third of the way is not the midpoint, and an anchor sitting exactly
    ON the midpoint has crossed it."""
    t = [float(i) * 1000.0 for i in range(10)]
    #            0    1    2    3      4      5       6       7       8       9
    vals = [0.0, 0.0, 0.0, 0.0, 400.0, 500.0, 1000.0, 1000.0, 1000.0, 1000.0]
    # Vantage 4000 puts the before-window's end (vantage − 30 s) before every anchor, so the search runs
    # from the first: the midpoint of a +1000 ms step is 500, and anchor 5 is the first AT it.
    assert si._a5_crossing(t, vals, 34_000.0, 1000.0) == 5000.0, "at the midpoint counts as crossed"
    # A THIRD would have taken anchor 4 — 400 is past 333 and short of 500.
    assert 400.0 > 1000.0 / 3.0 and 400.0 < 1000.0 / 2.0, "the plant separates the half from the third"
    down = [1000.0, 1000.0, 1000.0, 1000.0, 600.0, 500.0, 0.0, 0.0, 0.0, 0.0]
    assert si._a5_crossing(t, down, 34_000.0, -1000.0) == 5000.0, "and the same on the way down"


def test_the_CROSSING_SEARCH_STARTS_at_the_BEFORE_WINDOWS_END(tmp_path):
    """`bisect_left(times, lo)` is not only an optimisation: the level BEFORE the step may already have
    sat at or past the midpoint earlier in the segment, and scanning from the segment's first anchor
    would then name that earlier instant instead of the transition. `times[None:]` is the whole list, so
    the mutant that drops the bisect reads as a scan from the start."""
    t = [float(i) * 10_000.0 for i in range(20)]
    # A spike to the far level at anchor 1, long before the real transition at anchor 15. The vantage's
    # before-window ends at anchor 12, so the search must not see the spike.
    vals = [0.0] * 20
    vals[1] = 1000.0
    for i in range(15, 20):
        vals[i] = 1000.0
    at = si._a5_crossing(t, vals, t[15] + si.A5_BEFORE_MS[1] * -1.0 + 0.0, 1000.0)
    assert at == t[15], f"the transition, not the earlier spike at {t[1]}"


def test_a_HOST_GAP_of_EXACTLY_the_FLOOR_is_not_a_gap(tmp_path):
    """`A5_GAP_FLOOR_S` is the width at which a host gap becomes worth recording for Guard 2, and the
    comparison is strict: exactly 2.000 s is the last width that is not one."""
    hdr = "Phone timestamp;sensor timestamp [ns];ecg\n"

    def axis(gap_ms):
        rows = []
        for i in range(40):
            sec = i * 1.0 + (gap_ms / 1000.0 if i >= 20 else 0.0)
            h = T0 + dt.timedelta(seconds=sec)
            rows.append(f"{h:%Y-%m-%dT%H:%M:%S}.{h.microsecond // 1000:03d};{int(sec * 1e9) + (i * 37) % 101};1")
        p = tmp_path / f"{BASE}_ECG.txt"
        p.write_text(hdr + "\n".join(rows) + "\n")
        return si.residual_scan(str(p), None, None)["gaps"]

    # The row cadence is 1 s, so a planted shift of `gap_ms − 1000` makes the gap exactly `gap_ms`.
    assert axis(1000.0) == [], "the 2.000 s gap is exactly the floor, and the floor is not crossed"
    assert len(axis(1001.0)) == 1, "one millisecond more IS a gap"


def test_the_DELIVERY_BINS_COUNT_FROM_ZERO(tmp_path):
    """`row_bins.get(b, 0) + 1` — the first row in a bin makes the count 1, not 2. Guard 1 divides this
    count by the bin span to get a delivery rate, so a default of 1 inflates every bin that holds few
    rows and would read a healthy stream as delivering faster than nominal."""
    hdr = "Phone timestamp;sensor timestamp [ns];ecg\n"
    rows = []
    for i in range(20):  # 2 Hz over 9.5 s: one 10 s bin, exactly 20 rows
        h = T0 + dt.timedelta(seconds=i * 0.5)
        rows.append(f"{h:%Y-%m-%dT%H:%M:%S}.{h.microsecond // 1000:03d};{int(i * 0.5 * 1e9) + (i * 37) % 101};1")
    p = tmp_path / f"{BASE}_ECG.txt"
    p.write_text(hdr + "\n".join(rows) + "\n")
    bins = si.residual_scan(str(p), None, None)["row_bins"]
    # T0 is 23:00:00, so the 10 s span lands wholly inside one bin — 20 rows, not 21.
    assert sorted(bins.values()) == [20], bins
    assert si._rows_in(bins, T0.timestamp() * 1000.0, T0.timestamp() * 1000.0 + 9_500.0) == (20, si.A5_BIN_S)
    assert sum(bins.values()) == 20, "the count is the rows, and the first row in a bin makes it 1"


def test_a_RATE_of_EXACTLY_ONE_HERTZ_is_a_rate_and_a_rate_of_ZERO_is_not(tmp_path):
    """`seam_rate` reads the negotiated rate the sidecar recorded. `> 0` is the whole test: a rate of
    exactly 1 Hz is a rate (it is the O2Ring's own declared rate, and rejecting it would send every ring
    night down the no-rate path), while 0 Hz is the absence of one and must read as absent, never as
    zero (§∅)."""
    p = tmp_path / f"{BASE}_ECG.txt"

    def rate(text):
        (tmp_path / f"{BASE}_ECGSEAMS.txt").write_text(text)
        return si.seam_rate(str(p))

    assert rate("# pmd stream=ecg negotiated=yes rate=1 offered=1\n") == 1.0
    assert rate("# pmd stream=ecg negotiated=yes rate=130 offered=130\n") == 130.0
    # `negotiated=yes` deliberately: the regex requires it, so a `negotiated=no` line fails to match at
    # all and would test the regex rather than the `> 0` guard — a boundary test that tests no boundary.
    assert rate("# pmd stream=ecg negotiated=yes rate=0 offered=0\n") is None, "0 Hz is not a rate"
    assert rate("# final stream=ecg seams=0 examined=10\n") is None, "no pmd line at all"


def test_the_SEAM_RATE_READER_DECLARES_ITS_ENCODING(tmp_path):
    """`encoding="utf-8"` asserted on the CALL, not on a decoded byte: `-X warn_default_encoding` with
    `-W error::EncodingWarning` makes every `open()` that leaves `encoding` unset — or explicitly None —
    raise, so the assertion holds on a UTF-8 machine and a C-locale one alike.

    The in-process call first is NOT redundant: mutmut picks which tests to run for a mutant from
    COVERAGE, and a subprocess is invisible to the tracer, so without it this test never runs against
    the very mutants it kills."""
    import subprocess
    import sys

    p = tmp_path / f"{BASE}_ECG.txt"
    (tmp_path / f"{BASE}_ECGSEAMS.txt").write_text("# pmd stream=ecg negotiated=yes rate=2 offered=2\n")
    assert si.seam_rate(str(p)) == 2.0
    src = f"import solid_night_inputs as si\nassert si.seam_rate({str(p)!r}) == 2.0\n"
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=str(si.__file__).rsplit("/", 1)[0],
    )
    assert r.returncode == 0, r.stderr


def test_a_CLOCKSYNC_ROW_AT_EITHER_END_of_the_worn_interval_is_INSIDE_it(tmp_path):
    """The interval is CLOSED at both ends. A clock-set logged at the instant the strap went on, or at
    the instant it came off, is a record of this night's axis — excluding it would leave the tripwire
    free to convict a step the box recorded, which is the 2026-08-18 mistake at one millisecond's
    remove."""
    start, end = T0, T0 + dt.timedelta(hours=1)
    _clocksync(
        tmp_path,
        [
            f"{start.isoformat(timespec='milliseconds')};H10-01;AA;resync;0.5;ok",
            f"{end.isoformat(timespec='milliseconds')};H10-01;AA;resync;0.5;ok",
            f"{(start - dt.timedelta(milliseconds=1)).isoformat(timespec='milliseconds')};H10-01;AA;resync;0;ok",
            f"{(end + dt.timedelta(milliseconds=1)).isoformat(timespec='milliseconds')};H10-01;AA;resync;0;ok",
        ],
    )
    got = si._clocksync_rows(str(tmp_path / "2026-09-20"), "H10-01", start, end)
    assert got == [start.timestamp() * 1000.0, end.timestamp() * 1000.0], "both ends in, both neighbours out"


def test_a_CLOCKSYNC_ROW_of_EXACTLY_FOUR_CELLS_is_read(tmp_path):
    """`len(cells) < 4` is the reader's own contract: the four cells it reads are the stamp, the device,
    the address and the event, so a row carrying exactly those is complete FOR THIS READER even though
    the writer's header names six. A row torn by a crash mid-append is the case that produces one, and
    dropping it would silently shrink the record set — which §∅ says must stop the tripwire, not shorten
    it."""
    at = T0 + dt.timedelta(minutes=5)
    p = tmp_path / "2026-09-20"
    p.mkdir()
    (p / "CLOCKSYNC.csv").write_text(
        "Phone timestamp;device;address;event;skew_sec;detail\n"
        f"{at.isoformat(timespec='milliseconds')};H10-01;AA;resync\n"
        f"{(at + dt.timedelta(minutes=1)).isoformat(timespec='milliseconds')};H10-01;AA\n"
    )
    got = si._clocksync_rows(str(p), "H10-01", None, None)
    assert got == [at.timestamp() * 1000.0], "four cells is a record; three is a row this reader cannot place"


def test_the_NIGHT_FOLDER_may_be_given_WITH_A_TRAILING_SLASH(tmp_path):
    """`night_dir.rstrip("/")` is why the next date's folder is found at all: `dirname` and `basename` of
    a path ending in `/` are the folder itself and the empty string, so without the strip the neighbour
    is looked for inside the night and the night's own name is not a date. An ordinary trailing slash is
    the input this handles, and a reader that drops it looks in the wrong place silently."""
    late = T0 + dt.timedelta(hours=5)  # 04:00 the next morning — the cross-midnight case
    _clocksync(tmp_path, [f"{late.isoformat(timespec='milliseconds')};H10-01;AA;resync;0.5;ok"], name="2026-09-21")
    for given in (str(tmp_path / "2026-09-20"), str(tmp_path / "2026-09-20") + "/"):
        got = si._clocksync_rows(given, "H10-01", None, None)
        assert got == [late.timestamp() * 1000.0], f"the next date's row, with the night given as {given!r}"


def test_the_CLOCKSYNC_READER_DECLARES_ITS_ENCODING(tmp_path):
    """`encoding="utf-8"` on the CALL, by the same lever and for the same reason as the seam readers'."""
    import subprocess
    import sys

    at = T0 + dt.timedelta(minutes=5)
    _clocksync(tmp_path, [f"{at.isoformat(timespec='milliseconds')};H10-01;AA;resync;0.5;ok"])
    night = str(tmp_path / "2026-09-20")
    assert si._clocksync_rows(night, "H10-01", None, None) == [at.timestamp() * 1000.0]
    src = (
        "import solid_night_inputs as si\n"
        f"got = si._clocksync_rows({night!r}, 'H10-01', None, None)\n"
        f"assert got == [{at.timestamp() * 1000.0!r}], got\n"
    )
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=str(si.__file__).rsplit("/", 1)[0],
    )
    assert r.returncode == 0, r.stderr


def test_a_JOURNAL_CLOCK_EVENT_AT_EITHER_END_of_the_worn_interval_is_INSIDE_it(tmp_path):
    """The journal half of the record set, at the same closed edges as the CLOCKSYNC half. The two halves
    carry the same interval test and each needs its own plant: a test that only exercises one leaves the
    other's edges unmeasured."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    start, end = T0, T0 + dt.timedelta(hours=8)
    night.joinpath("LOSS-AUDIT.json").write_text(
        json.dumps(
            {
                "clock_events": [
                    {"at": start.isoformat(), "phrase": "device clock JUMPED", "devices": []},
                    {"at": end.isoformat(), "phrase": "device clock JUMPED", "devices": []},
                    {"at": (start - dt.timedelta(milliseconds=1)).isoformat(), "phrase": "re-sync busy", "devices": []},
                    {"at": (end + dt.timedelta(milliseconds=1)).isoformat(), "phrase": "re-sync busy", "devices": []},
                ]
            }
        )
    )
    recs, _how = si.clock_records(str(night), H10["name"], str(night / f"{BASE}_ECG.txt"), start, end)
    assert recs == [start.timestamp() * 1000.0, end.timestamp() * 1000.0], "both ends in, both neighbours out"


def test_a_RECORDED_SEAM_OUTSIDE_the_worn_interval_is_not_in_the_record_set(tmp_path):
    """`clock_records` forwards the interval to `recorded_seams`, and must: a seam recorded while nobody
    was wearing the strap splits no axis this night measured, so counting it as a record would excuse a
    step it has nothing to do with. Dropping the `start` on the way through is invisible unless a seam
    sits outside."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    night.joinpath("LOSS-AUDIT.json").write_text(json.dumps({"clock_events": []}))
    inside, outside = 5 * 60_000, 9 * 60 * 60_000  # +5 min, and +9 h — past an 8 h worn interval
    _seam_rows(night, [(inside, 2500.0), (outside, 2500.0)])
    p = str(night / f"{BASE}_ECG.txt")
    worn, _ = si.clock_records(str(night), H10["name"], p, T0, T0 + dt.timedelta(hours=8))
    assert worn == [(T0 + dt.timedelta(minutes=5)).timestamp() * 1000.0], "only the seam inside the interval"
    unbounded, _ = si.clock_records(str(night), H10["name"], p, None, None)
    assert len(unbounded) == 2, "with no interval stated, both seams are records — the control"


def test_a_step_the_CLOCKSYNC_SIDECAR_recorded_reaches_the_BAND_and_excuses_it(tmp_path):
    """🔴 THE RECORD SET MUST ARRIVE AT THE BAND, not just at the detector. `clock_records` filters both
    the journal's lines and the CLOCKSYNC rows BY DEVICE NAME, so whatever `timebase` hands it as the
    device decides whether those two sources match anything at all.

    This is the 2026-08-18 mistake at the top of the call chain: the night below has a step the box
    wrote down in `CLOCKSYNC.csv`, and a record set that cannot see that row convicts it as
    unrecorded. `test_the_JOURNAL_half_of_the_record_set_excuses_a_step_and_respects_the_device` makes
    the same point one layer down, against `clock_records` directly — which is exactly why it could not
    see this: the defect was in the ARGUMENT, not in the function."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    (night / f"{BASE}_ECG.txt").write_text(_axis(step_ms=4000.0))
    _seams(night)
    _runs(night, "ECG")
    _runs(night, "ACC")
    _audit(night, clock_events=(), end="2026-09-20T23:10:00")
    at = T0 + dt.timedelta(minutes=5)
    (night / "CLOCKSYNC.csv").write_text(
        "Phone timestamp;device;address;event;skew_sec;detail\n"
        f"{at.isoformat(timespec='milliseconds')};{H10['name']};a;resynced;0.5;watchdog\n"
    )
    tb = si.timebase(
        str(night), H10["name"], "ECG", [str(night / f"{BASE}_ECG.txt")], T0, T0 + dt.timedelta(minutes=10)
    )
    assert "unrecorded-shift-candidate" not in tb["reason"], tb["reason"]
    assert tb["status"] == "PASS", tb


def test_a_CLOCK_SET_RECORDED_AFTER_THE_STRAP_CAME_OFF_does_not_excuse_a_step(tmp_path):
    """The worn interval travels with the record set, and it has to: a clock-set written down after the
    strap came off is not evidence about the stretch being judged. The record below sits 160 s from the
    candidate — well inside `A5_RECORD_NEAR_S` — and 10 s outside the worn interval, which is the only
    geometry that separates "near the candidate" from "inside the night".

    The two bounds nearly coincide by construction: a candidate needs 120 s of after-window inside the
    scanned interval, so it can never be closer than that to the end, and 300 s of match window minus
    that leaves a narrow band for the record to land in. Here the candidate is at 23:07:30, the interval
    ends at 23:10:00 and the record is at 23:10:10."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    (night / f"{BASE}_ECG.txt").write_text(_axis(step_ms=4000.0, at_min=7.5, minutes=11))
    _seams(night)
    _runs(night, "ECG")
    _runs(night, "ACC")
    _audit(night, clock_events=(), end="2026-09-20T23:10:00")
    p = [str(night / f"{BASE}_ECG.txt")]
    end = T0 + dt.timedelta(minutes=10)

    def band(sync_at):
        (night / "CLOCKSYNC.csv").write_text(
            "Phone timestamp;device;address;event;skew_sec;detail\n"
            f"{sync_at.isoformat(timespec='milliseconds')};{H10['name']};a;resynced;0.5;watchdog\n"
        )
        return si.timebase(str(night), H10["name"], "ECG", p, T0, end)

    after = band(end + dt.timedelta(seconds=10))
    assert "unrecorded-shift-candidate" in after["reason"], after["reason"]
    inside = band(end - dt.timedelta(seconds=10))
    assert "unrecorded-shift-candidate" not in inside["reason"], (
        "the control: the SAME record 20 s earlier is inside the interval, and then it is a record"
    )


def test_the_SPAN_in_the_timebase_reason_is_MINUTES(tmp_path):
    """`span_s / 60` — and a 61-minute axis is the plant that can tell 60 from anything near it, because
    the reason rounds to whole minutes and 3,660 s over 61 reads as exactly 60."""
    (tmp_path / f"{BASE}_ECG.txt").write_text(_axis(minutes=61, step_ms=0.0))
    _seams(tmp_path)
    _runs(tmp_path, "ECG")
    _runs(tmp_path, "ACC")
    # No `clock_events` key at all: the record set is unreadable, which is the branch that renders the
    # span. The night is UNKNOWN for that reason and the axis measurement is still stated.
    _audit(tmp_path, end="2026-09-21T00:01:00")
    (tmp_path / "LOSS-AUDIT.json").write_text(
        json.dumps({"journal": "read", "devices": {H10["name"]: {"file": f"{BASE}_ECG.txt", "gaps": []}}})
    )
    tb = si.timebase(
        str(tmp_path), H10["name"], "ECG", [str(tmp_path / f"{BASE}_ECG.txt")], T0, T0 + dt.timedelta(minutes=61)
    )
    assert tb["status"] == "UNKNOWN", tb
    assert "over 61 min" in tb["reason"], tb["reason"]
    assert "the A5 record set could not be read" in tb["reason"]


def test_GUARD_2_reads_THE_AFTER_WINDOW_and_its_neighbourhood_and_nothing_else(tmp_path):
    """Guard 2's question is whether the level AFTER the candidate was measured on data that exists and
    is flowing normally, so the stretch it looks at is the after-window `[at+60 s, at+120 s)` plus
    `A5_GAP_NEAR_S` past its far edge — and nothing before it. A gap in the 60 s between the candidate
    and the window is not in that stretch: the level after is still measured on flowing data.

    Both arms of the overlap are needed and each needs its own plant. `g1 > a0` asks whether the gap
    reaches INTO the window and `g0 < a1 + near` whether it starts before the neighbourhood ends; an
    `or` between them makes any gap anywhere fire, and either edge slipping by a millisecond changes
    which nights are refused."""
    at = A5_T0_MS + 200_000.0
    a0, a1 = at + si.A5_AFTER_MS[0], at + si.A5_AFTER_MS[1]

    def band(*gaps):
        return si.unrecorded_shift(_scan([(0.0, 0.0), (200.0, 4000.0)], gaps=gaps), [], 2.0)["reason"]

    fires = "persistence across a gap"
    assert fires in band((a0 + 1_000.0, a0 + 3_000.0)), "a gap INSIDE the window — the plain case"
    assert fires not in band((at + 1_000.0, a0 - 1_000.0)), "between the candidate and the window: not read"
    assert fires not in band((A5_T0_MS + 1_000.0, A5_T0_MS + 3_000.0)), "long before the candidate: not read"
    # The two edges, at the millisecond.
    assert fires not in band((a0 - 2_000.0, a0)), "a gap ENDING exactly at the window's start is before it"
    assert fires in band((a0 - 2_000.0, a0 + 1.0)), "one millisecond into the window IS into the window"
    near_end = a1 + si.A5_GAP_NEAR_MS
    assert fires not in band((near_end, near_end + 2_000.0)), "a gap starting at the end of the neighbourhood"
    assert fires in band((near_end - 1.0, near_end + 2_000.0)), "one millisecond earlier is inside it"


def test_a_RECORD_at_EXACTLY_the_MATCH_DISTANCE_makes_the_step_RECORDED(tmp_path):
    """`A5_RECORD_NEAR_S` is pre-stated at 300 s — "over four times" the 68 s lag the 2026-08-18 journal
    actually showed — and the bound is INCLUSIVE. A record at exactly 300 s is a record; convicting the
    step it belongs to is the mistake the constant exists to prevent."""
    at = A5_T0_MS + 200_000.0
    scan = _scan([(0.0, 0.0), (200.0, 4000.0)])
    assert si.unrecorded_shift(scan, [at + si.A5_RECORD_NEAR_MS], 2.0) is None, "exactly 300 s after"
    assert si.unrecorded_shift(scan, [at - si.A5_RECORD_NEAR_MS], 2.0) is None, "and exactly 300 s before"
    out = si.unrecorded_shift(scan, [at + si.A5_RECORD_NEAR_MS + 1.0], 2.0)
    assert out is not None and "unrecorded-shift-candidate" in out["reason"], "one millisecond further is not"


def test_the_DENSITY_SPAN_is_CLOSED_at_both_of_the_persistence_windows_far_edges(tmp_path):
    """`clock-sets too dense to attribute` counts the records inside one candidate's PERSISTENCE SPAN —
    from the before-window's far edge to the after-window's — and the span is closed at both. Two
    records sitting exactly on the two edges are the storm's minimum case: ±15–30 s flips minutes apart
    that cannot be assigned to one another, which is neither recorded nor unrecorded."""
    at = A5_T0_MS + 200_000.0
    scan = _scan([(0.0, 0.0), (200.0, 4000.0)])
    edges = [at + si.A5_BEFORE_MS[0], at + si.A5_AFTER_MS[1]]
    out = si.unrecorded_shift(scan, edges, 2.0)
    assert out is not None and "clock-sets too dense to attribute" in out["reason"], out
    assert f"{si.A5_DENSE_RECORDS} records around" in out["reason"]
    # A millisecond outside either edge and the pair is no longer inside one span — the earlier record
    # then simply makes the step RECORDED, which is the softer answer and the right one.
    assert si.unrecorded_shift(scan, [edges[0] - 1.0, edges[1]], 2.0) is None
    assert si.unrecorded_shift(scan, [edges[0], edges[1] + 1.0], 2.0) is None


def test_a_REANCHOR_of_EXACTLY_A5_REANCHOR_S_does_not_split_the_axis(tmp_path):
    """`A5_REANCHOR_S` is the capture's own seam bound, and the split is strict: a 60.000 s re-anchor is
    the widest one that leaves the anchors on ONE axis. The count is where it shows — a split that
    should not have happened loses the vantages that straddle it."""
    base = _scan([(0.0, 0.0), (200.0, 4000.0)], spacing_ms=si.A5_BIN_MS, span_s=400.0)
    whole = si.unrecorded_shift(base, [], 2.0)
    assert whole["vantages"] == 20

    def with_reanchor(gap_ms):
        a = list(base["anchors"])
        tail = [(t + gap_ms - si.A5_BIN_MS, d + gap_ms - si.A5_BIN_MS) for t, d in a[20:]]
        return si.unrecorded_shift(dict(base, anchors=a[:20] + tail, last_row_ms=tail[-1][0] + 200_000), [], 2.0)

    at_bound = with_reanchor(si.A5_REANCHOR_MS)
    assert at_bound["vantages"] == 20, "exactly 60 s is still one axis, so every vantage survives"
    # A millisecond more IS a split, and here it costs the candidate entirely: the two halves span 200 s
    # each, under the 210 s a vantage needs, so neither can host one. That is the right answer for a
    # split axis — two clocks are not one stretch of signal — and it is the sharpest possible evidence
    # that the comparison is strict.
    assert with_reanchor(si.A5_REANCHOR_MS + 1.0) is None


def test_the_BEFORE_WINDOW_ENDS_BEFORE_THE_VANTAGE_and_never_reaches_past_it(tmp_path):
    """The before-window is `[vantage − 90 s, vantage − 30 s)`: it ends BEFORE the vantage, so the level
    it reports is a level that existed before the candidate. A window reaching 30 s PAST the vantage
    instead would mix data from after the candidate into the level "before" it, which is not before by
    any reading — and the magnitude it then reports is the difference between two overlapping windows.

    A LATENCY TRANSIENT FOLLOWED BY A STEP is what separates the two, and it is the corpus's commonest
    shape: 1,237 of 1,756 events above 1 s were transients that RETURN. A single step cannot separate
    them at all (measured: 1,224 single-step plants, 0 distinguishing), because the strongest vantage's
    before-window is clear of the step either way. Here the residual dips to −3 s at 20 s, returns at
    65 s, and the real step lands at 95 s."""
    out = si.unrecorded_shift(_scan([(0.0, 0.0), (20.0, -3000.0), (65.0, 0.0), (95.0, 4000.0)]), [], 2.0)
    assert out is not None
    assert out["reason"] == (
        f"unrecorded-shift-candidate — +7 s persistent shift at {_at(95.0)}, with no record in any of the three sources"
    ), "the instant is the step; the magnitude is from the level the window actually measured"


# ── §3.2 `score_devices` — the band assembly, which is a set of ARGUMENT FORWARDINGS ────────────────
#
# This function decides almost nothing itself; what it does is hand each band the night, the DEVICE and
# the model. A forwarding is invisible in a verdict unless the test gives the argument something to
# matter FOR — which is exactly how a basename reached `clock_records` where a device name belonged, and
# why `test_a_step_the_CLOCKSYNC_SIDECAR_recorded_reaches_the_BAND_and_excuses_it` could not see it: that
# test calls `timebase` directly, so the CALL SITE went unobserved.


def test_score_devices_FORWARDS_the_device_NAME_to_the_bands_that_key_on_it(tmp_path):
    """Two devices, and the night's evidence names only ONE of them. `completeness` looks the declared
    rate up per device and `timebase` hands the device on to the record set, so a name that does not
    arrive makes both bands answer about a device that is not there."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    (night / f"{BASE}_ECG.txt").write_text(_axis(step_ms=4000.0))
    _seams(night)
    _runs(night, "ECG")
    _runs(night, "ACC")
    _audit(night, clock_events=(), end="2026-09-20T23:10:00")
    at = T0 + dt.timedelta(minutes=5)
    (night / "CLOCKSYNC.csv").write_text(
        "Phone timestamp;device;address;event;skew_sec;detail\n"
        f"{at.isoformat(timespec='milliseconds')};{H10['name']};a;resynced;0.5;watchdog\n"
    )
    tb = _bands(night)[H10["name"]]["bands"]["timebase"]
    assert "unrecorded-shift-candidate" not in tb["reason"], tb["reason"]
    # The control that makes it a forwarding test: the SAME night with the record written against a
    # DIFFERENT device name is not this device's record, so the tripwire fires.
    (night / "CLOCKSYNC.csv").write_text(
        "Phone timestamp;device;address;event;skew_sec;detail\n"
        f"{at.isoformat(timespec='milliseconds')};Polar VeritySense 1234;a;resynced;0.5;watchdog\n"
    )
    other = _bands(night)[H10["name"]]["bands"]["timebase"]
    assert "unrecorded-shift-candidate" in other["reason"], other["reason"]


def test_score_devices_FORWARDS_the_MODEL_and_the_NIGHT_to_every_band(tmp_path):
    """The model selects the stream map and the night selects the files. A device whose model does not
    reach the bands is scored against the wrong stream set; a night that does not reach
    `expected_devices` makes an OPTIONAL device's "did it capture?" test read the wrong directory."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    (night / f"{BASE}_ECG.txt").write_text(_axis())
    _seams(night)
    _runs(night, "ECG")
    _runs(night, "ACC")
    _audit(night, clock_events=())
    got = _bands(night)[H10["name"]]["bands"]
    assert got["validity"]["status"] == "PASS", got["validity"]
    assert got["clocks"]["status"] == "PASS", got["clocks"]
    # An OPTIONAL device is included only on a night that holds its files — which needs the NIGHT.
    ring = {"name": "Wellue O2Ring-S", "model": "O2Ring-S", "optional": True}
    assert si.expected_devices(str(night), [H10, ring]) == [H10], "the ring captured nothing this night"
    assert si.expected_devices(str(night), [ring]) == [], "and it is not expected on its own"


def test_score_devices_names_a_device_by_its_MODEL_when_it_carries_no_NAME(tmp_path):
    """`d.get("name") or d.get("model")` — the fallback is the model, and it has to be a real key: a
    device keyed under `"None"` would be a device the audit can never match and the verdict can never
    attribute."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    got = si.score_devices(str(night), [{"model": "H10"}])
    assert list(got) == ["H10"], got
    assert "None" not in got


def test_score_devices_KEEPS_GOING_after_a_device_it_cannot_score(tmp_path):
    """`continue`, not `break`: an unscorable device is skipped and the NEXT one is still scored. The
    fixture puts the scorable device AFTER both skipped ones, because that is the only arrangement in
    which the loop's skip semantics are observable at all — a `break` on either skip would silently drop
    every device behind it, and a night would be judged on a subset nobody chose."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    (night / f"{BASE}_ECG.txt").write_text(_axis())
    _seams(night)
    _runs(night, "ECG")
    _runs(night, "ACC")
    _audit(night, clock_events=())
    unknown_model = {"name": "Mystery Strap", "model": "NotAModel"}  # hits the `model not in MODELS` skip
    no_files = {"name": "Wellue O2Ring-S", "model": "O2Ring-S"}  # hits the `not primaries` skip
    got = si.score_devices(str(night), [unknown_model, no_files, H10])
    assert list(got) == ["Mystery Strap", "Wellue O2Ring-S", H10["name"]], list(got)
    assert "no stream map" in got["Mystery Strap"]["bands"]["presence"]["reason"]
    assert "indistinguishable" in got["Wellue O2Ring-S"]["bands"]["presence"]["reason"]
    assert got[H10["name"]]["bands"]["validity"]["status"] == "PASS", "the device BEHIND the skips is scored"


def test_an_ABSENT_AUDIT_leaves_both_bands_UNKNOWN_and_says_which_term_is_missing(tmp_path):
    """§∅: with no `LOSS-AUDIT.json` there is no worn interval, so continuity and completeness are
    UNKNOWN — and each carries its own named reason rather than a bare status. The status word and the
    reason are separate claims and a decision needs both."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    (night / f"{BASE}_ECG.txt").write_text(_axis())
    _seams(night)
    _runs(night, "ECG")
    _runs(night, "ACC")
    bands = _bands(night)[H10["name"]]["bands"]
    assert bands["continuity"]["status"] == "UNKNOWN"
    assert bands["continuity"]["reason"] == f"{si.LOSS_AUDIT_NAME} absent or unreadable"
    assert bands["completeness"]["status"] == "UNKNOWN"
    assert bands["completeness"]["reason"].startswith("no worn interval: "), bands["completeness"]
    assert len(bands["completeness"]["reason"]) > len("no worn interval: "), "the reason names the term"


def test_score_devices_FORWARDS_the_NAME_to_COMPLETENESS_through_the_PMDNEG_ROW(tmp_path):
    """The forwarding that only a night WITHOUT a seam sidecar can observe. `negotiated_rate` reads the
    sidecar beside the stream first, and that is keyed by the FILE — so while one exists the device name
    is never consulted and a dropped name changes nothing. With the sidecar's rate absent the lookup
    falls back to `PMDNEG.csv`, whose rows are keyed by DEVICE, and the name becomes load-bearing: no
    name, no rate, and the completeness band stops binding at all.

    This is the same measurement #3243 recorded for `completeness` directly. Here it is the CALL SITE."""
    _ecg(tmp_path, seconds=200, rate=2.0)
    _seams(tmp_path, rate=None)  # a sidecar with NO negotiated rate, so the device lookup is reached
    _runs(tmp_path, "ECG")
    _runs(tmp_path, "ACC")
    _audit(tmp_path)
    (tmp_path / "PMDNEG.csv").write_text(
        "Phone timestamp;device;address;stream;requested_hz;offered_hz;chosen_hz;ack;how\n"
        f"t;{H10['name']};a;ecg;;130;2;ok;negotiated\n"
    )
    bound = _bands(tmp_path)[H10["name"]]["bands"]["completeness"]
    assert bound["status"] in ("PASS", "FAIL"), f"the band BINDS when the rate is found: {bound}"
    # The control: the same row written against another device is not this device's rate.
    (tmp_path / "PMDNEG.csv").write_text(
        "Phone timestamp;device;address;stream;requested_hz;offered_hz;chosen_hz;ack;how\n"
        "t;Polar VeritySense 1234;a;ecg;;130;2;ok;negotiated\n"
    )
    unbound = _bands(tmp_path)[H10["name"]]["bands"]["completeness"]
    assert unbound["status"] == "UNKNOWN", f"no rate for THIS device, so no denominator: {unbound}"


def test_score_devices_FORWARDS_the_NIGHT_to_the_OPTIONAL_device_test(tmp_path):
    """§3.2: an `optional` device is expected only on a night that holds its files, and "this night" is
    the argument. A night that does not reach `expected_devices` makes that test read the wrong
    directory — and then an optional backup is either scored on a night it never captured or dropped
    from one it did."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    _ecg(night)
    _seams(night)
    _runs(night, "ECG")
    _runs(night, "ACC")
    _audit(night)
    ring = {"name": "Wellue O2Ring-S", "model": "O2Ring-S", "optional": True}
    assert list(si.score_devices(str(night), [H10, ring])) == [H10["name"]], "the ring captured nothing"
    # Now give the ring a file IN THIS NIGHT: it becomes expected, and is scored.
    (night / "Wellue_O2Ring-S_S8AW2100_20260920230000_SPO2.csv").write_text("Time;Oxygen Level\n")
    got = si.score_devices(str(night), [H10, ring])
    assert list(got) == [H10["name"], ring["name"]], list(got)


def test_an_AUDIT_WITH_NO_ENTRY_for_the_device_leaves_both_bands_UNKNOWN(tmp_path):
    """The other no-worn-interval path, and it is a DIFFERENT branch from an absent audit: the file is
    there and readable, and it simply does not mention this device. Continuity and completeness are both
    UNKNOWN and both name the term that is missing — a status without its reason is half a decision, and
    §∅ wants the absence NAMED rather than scored.

    Separate from `test_an_ABSENT_AUDIT_leaves_both_bands_UNKNOWN_and_says_which_term_is_missing`
    because the two arms are written out twice in `score_devices`, so a test of one leaves the other's
    status unobserved — measured: the second arm's status word survived mutation with the first covered."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    _ecg(night)
    _seams(night)
    _runs(night, "ECG")
    _runs(night, "ACC")
    # An audit that names ANOTHER device: readable, present, and silent about this one.
    (night / "LOSS-AUDIT.json").write_text(
        json.dumps({"journal": "read", "clock_events": [], "devices": {"Polar VeritySense 1234": {"gaps": []}}})
    )
    bands = _bands(night)[H10["name"]]["bands"]
    for term in ("continuity", "completeness"):
        assert bands[term]["status"] == "UNKNOWN", f"{term}: {bands[term]}"
        assert bands[term]["reason"] == f"no worn interval: {si.LOSS_AUDIT_NAME} has no entry for this device", (
            f"{term}: {bands[term]['reason']}"
        )


# ── E18 · the CLOCK stream is a separate spec field from the completeness PRIMARY ───────────────────


def test_the_RING_s_TIMEBASE_is_NOT_APPLICABLE_because_it_STAMPS_NO_WAVEFORM(tmp_path):
    """🔴 THE 2026-10-04 NIGHT. First night with LOSS, H10 and Verity all PASS, and the ring alone
    UNKNOWN — "`…_SPO2.csv` carries no `sensor timestamp [ns]` column — no device clock". True of that
    file and not a finding about the night: the timebase band was reading the COMPLETENESS PRIMARY, and
    for the ring that is a polled vitals CSV whose stamps the host draws.

    The ring's answer is NOT_APPLICABLE and the reason is about the EXPORTED AXIS, never the hardware.
    The ring HAS a crystal and we discipline it (`oxyii.SET_UTC_TIME`); `O2RING-PROTOCOL-2026-07-17`
    §153 says that RTC "must never stamp the waveform", and every optical stream's `sensor timestamp
    [ns]` is the HOST's — `accraw`/`ppg2w`/`pletha` write a literal 0, and `_PPG.txt`'s column is
    `O2PpgGrid`, "the host lays its samples on a grid and writes that grid". Judging that grid as a
    device axis could PASS it, which is worse than refusing."""
    _spo2(tmp_path, rows=200)
    _audit(tmp_path, file=f"{RING_BASE}_SPO2.csv")
    tb = _bands(tmp_path, devices=(RING,))[RING["name"]]["bands"]["timebase"]
    assert tb["status"] == "NOT_APPLICABLE", tb
    assert tb["reason"] == si.NO_DEVICE_AXIS, tb["reason"]
    assert "no device clock" not in tb["reason"], "the old wording was about the FILE, not the device"


def test_a_RING_PPG_FILE_does_not_change_the_bands_answer(tmp_path):
    """The control for the premise this unit started from. A `_PPG.txt` sitting beside the ring's SPO2 —
    with the host's grid in its `sensor timestamp [ns]` column, exactly as the box writes it — must NOT
    make the band start measuring: the ring's spec names no clock stream, so the file's presence is
    irrelevant and the answer is the same NOT_APPLICABLE."""
    _spo2(tmp_path, rows=200)
    (tmp_path / f"{RING_BASE}_PPG.txt").write_text(
        "# timebase=host\nPhone timestamp;sensor timestamp [ns];channel 0\n"
        + "\n".join(f"2026-09-20T23:00:{i:02d}.000;{i * 7953045};{500 + i}" for i in range(40))
        + "\n"
    )
    _audit(tmp_path, file=f"{RING_BASE}_SPO2.csv")
    tb = _bands(tmp_path, devices=(RING,))[RING["name"]]["bands"]["timebase"]
    assert tb["status"] == "NOT_APPLICABLE", tb
    assert tb["reason"] == si.NO_DEVICE_AXIS


def test_the_RING_s_COMPLETENESS_still_reads_the_SPO2_PRIMARY(tmp_path):
    """The other half of the separation: moving the timebase band off the primary must not move the
    completeness band onto something else. `primary` is still SPO2 and the polled-stream rule still
    applies to it (#3243), so the band does not bind and says why."""
    _spo2(tmp_path, rows=200)
    _audit(tmp_path, file=f"{RING_BASE}_SPO2.csv")
    # `completeness` called directly, as the other ring tests do: `_audit` keys its one device entry by
    # the H10's name, so routing the ring through `_bands` gives it no worn interval and the band answers
    # about THAT instead — a fixture artefact, not the property under test.
    comp = si.completeness(
        str(tmp_path),
        RING["name"],
        "O2Ring-S",
        [str(tmp_path / f"{RING_BASE}_SPO2.csv")],
        T0,
        T0 + dt.timedelta(seconds=200),
    )
    assert comp["status"] == "NOT_APPLICABLE", comp
    assert "polled stream" in comp["reason"], comp["reason"]
    assert si.MODELS["O2Ring-S"]["primary"] == "SPO2", "and the band read the primary, which is unchanged"


def test_a_DECLARED_CLOCK_STREAM_THAT_IS_MISSING_this_night_is_UNKNOWN_not_inapplicable(tmp_path):
    """§∅, and the distinction the two answers carry. A model whose spec names NO clock stream is
    NOT_APPLICABLE — examined, and the rule does not bind. A model whose spec DOES name one, on a night
    that holds no such file, is UNKNOWN — the rule binds and the input is absent. Collapsing the two
    would publish "not applicable" about a strap whose clock we simply failed to record."""
    tb = si.timebase(str(tmp_path), H10["name"], "ECG", [], T0, T0 + dt.timedelta(hours=1))
    assert tb["status"] == "UNKNOWN", tb
    assert tb["reason"] == "no `ECG` stream this night, so no device axis could be read", tb["reason"]


def test_the_CLOCK_TAG_per_model_is_the_stream_that_reports_a_DEVICE_time(tmp_path):
    """Stated once, here, rather than re-derived per band: the Polars report a per-sample device time on
    the stream they are judged on, and the ring reports none on any stream."""
    assert si.MODELS["H10"]["clock"] == "ECG"
    assert si.MODELS["VeritySense"]["clock"] == "PPG"
    assert si.MODELS["O2Ring-S"]["clock"] is None
    # …and `clock` is not `primary`: the ring is the device where they differ, which is the whole unit.
    assert si.MODELS["O2Ring-S"]["primary"] == "SPO2"
    assert all(m["clock"] == m["primary"] for k, m in si.MODELS.items() if m["clock"] is not None)


def test_the_POLAR_BANDS_are_UNCHANGED_by_the_clock_spec_split(tmp_path):
    """🔴 THE CONTROL FOR THE WHOLE UNIT. Both Polars' `clock` EQUALS their `primary`, so the band must
    open the same file and reach the same verdict — and the assertion is the WHOLE decision dict for
    every band, not a status, because a reason that moved would mean the band changed instrument.

    Pinned as literal text rather than compared against a second code path: a control that recomputes
    the expected value with the code under test cannot fail (§🧾, a threshold derived from the data it
    judges). These five strings were measured against `origin/main` before the change."""
    _ecg(tmp_path)
    _seams(tmp_path)
    _runs(tmp_path, "ECG")
    _runs(tmp_path, "ACC")
    _audit(tmp_path)
    bands = _bands(tmp_path)[H10["name"]]["bands"]
    assert bands["continuity"] == {"status": "PASS", "reason": None}
    assert bands["completeness"] == {"status": "PASS", "reason": None}
    assert bands["validity"] == {"status": "PASS", "reason": None}
    assert bands["clocks"] == {"status": "PASS", "reason": None}
    assert bands["timebase"] == {
        "status": "PASS",
        "reason": (
            f"`{BASE}_ECG.txt`: axis is an independent clock at +0 ppm over 3 min; "
            "the A5 tripwire found no unrecorded shift (seam sidecar + journal clock events + CLOCKSYNC.csv)"
        ),
    }, bands["timebase"]
