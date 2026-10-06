# tepna-capture — tests/test_solid_night_inputs.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The SOLID-NIGHT band suppliers (SOLID-NIGHT-2026-09-23-BRIEF §3.4, amendments A1–A6), each term read from
a synthetic night laid out exactly as the box writes one (checked against 2026-09-23 on vigil): per-stream
`…SEAMS.txt` / `…RUNS.txt` sidecars, `PMDNEG.csv`, the ring's `RTCLOG.csv` and SpO₂ `.meta.json`, and the
loss audit's `wear` + per-gap `gaps`. A 2 Hz primary stream keeps the completeness arithmetic exact."""

import os
import datetime as dt
import json

import loss_audit as _la
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
    # THE PLACEHOLDER CARRIES A DATA ROW, and it has to: `validity` now excludes a ZERO-ROW waveform as
    # an empty session, so a header-only stand-in would make every fixture using this helper report one
    # — which is not what any of them means. The file exists here to be the sidecar's pair, i.e. to
    # represent a session that RECORDED something. A fixture must carry the property the code reasons
    # about; this one used to omit it because nothing read the rows.
    (d / f"{name}_{stream}.txt").exists() or (d / f"{name}_{stream}.txt").write_text(
        "Phone timestamp;x\n2026-09-20T23:00:00.000;1\n"
    )
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
        # `rtc` joins the set on 2026-10-04 and is NOT_APPLICABLE for a Polar: the H10 keeps no RTC log,
        # so the band was examined and the rule does not bind. An EQUALITY here is why a new band cannot
        # arrive unannounced — which is the point of pinning the set rather than a floor.
        "rtc": "NOT_APPLICABLE",
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


# ── §3.4 continuity: a pause the daemon DECLARES is explained, not a regression ─────────────────────
#
# 🔴 OWNER RULING 2026-10-03, "No, if declared". The H10/Verity offline-recording op pauses live capture
# and the journal names it with its reason; that is the system declaring its own discontinuity, and §∅
# puts annotation — not refusal — on the reduced-coverage side of the line. The pause still counts toward
# the LOSS bar, which is a different consumer.


def test_a_DECLARED_PAUSE_inside_the_worn_interval_PASSES_and_the_BAND_NAMES_IT(tmp_path):
    """The 2026-10-01 H10 plant: one 11 s gap at 20:44:53 whose cause the journal declared. It passes,
    and the reason says so — a band that passed SILENTLY over a known discontinuity would make a healthy
    night unauditable later, which is the half of §∅ that annotates rather than refuses."""
    out = _cont(tmp_path, gaps=[("2026-09-20T23:01:00", 11.0, si.DECLARED_PAUSE)])
    assert out["status"] == "PASS", out
    assert out["reason"] == (
        f"explained discontinuity: 1 declared pause(s), 11 s ({si.DECLARED_PAUSE}) inside the worn "
        "interval — counted toward the LOSS bar, not a band failure"
    ), out["reason"]


def test_an_UNDECLARED_DAEMON_GAP_still_FAILS_so_the_rule_is_NARROWED_not_HOLLOWED(tmp_path):
    """The control that binds. Dropping one cause from the regression set must not stop the set working:
    `daemon:restart` is idle-gated, so one that tore a worn recording is still a defect and still fails.

    ⚠️ The control this unit was first specified with does NOT bind, measured on origin/main: the SAME
    gap "with no recorded cause" already PASSED before the change, because an uncaused 11 s gap goes down
    the UNATTRIBUTED path, which judges totals (60 s) and counts (5) rather than this gap. A control that
    passes both before and after proves nothing, so the real undeclared case is the one below."""
    out = _cont(tmp_path, gaps=[("2026-09-20T23:01:00", 11.0, "daemon:restart")])
    assert out == {"status": "FAIL", "reason": "daemon regression inside the worn interval: daemon:restart"}


def test_a_DECLARED_PAUSE_cannot_SOFTEN_a_real_regression_beside_it(tmp_path):
    """The annotation sits at the PASS, so every rule above still decides first. A night carrying both a
    declared pause and a real regression FAILS on the regression — the pause can only ever turn a BARE
    pass into a reasoned one, never a FAIL into a pass."""
    out = _cont(
        tmp_path,
        gaps=[
            ("2026-09-20T23:01:00", 11.0, si.DECLARED_PAUSE),
            ("2026-09-20T23:01:30", 9.0, "daemon:restart"),
        ],
    )
    assert out["status"] == "FAIL", out
    assert "daemon:restart" in out["reason"]
    assert "explained discontinuity" not in out["reason"]


def test_a_GAP_WITH_NO_JOURNAL_AT_ALL_is_still_UNKNOWN_which_is_the_undeclared_case(tmp_path):
    """THE REAL "undeclared" CONTROL. A cause label exists only because the journal declared it, so the
    way a pause can be undeclared is for the journal not to be there — and that is UNKNOWN, unchanged:
    a gap nobody can attribute is not a gap anybody has explained (§∅, a named reason not a borrowed one)."""
    out = _cont(tmp_path, gaps=[("2026-09-20T23:01:00", 11.0, "unattributed (no journal)")])
    assert out == {
        "status": "UNKNOWN",
        "reason": "a gap inside the worn interval is unattributed for want of a journal",
    }


def test_the_DECLARED_PAUSE_is_STILL_COUNTED_by_the_LOSS_AUDIT(tmp_path):
    """The owner's other half: it does not fail the band AND it still counts as loss. The two live in
    different consumers — `by_cause` is the audit's accounting and the band is the verdict's — so the
    band change must leave the seconds where they were. Asserted on the audit's own projection."""
    import loss_audit

    at = dt.datetime(2026, 9, 20, 23, 1, 0)
    # `by_cause_of` reports MINUTES — measured, not assumed: an 11 s pause is 11/60 min there, and the
    # band's reason states the same pause in SECONDS. Two units for one quantity in two consumers, which
    # is worth writing down in the test that spans both.
    got = loss_audit.by_cause_of([(at, 11.0, si.DECLARED_PAUSE)])
    assert got == {si.DECLARED_PAUSE: 11.0 / 60.0}, got
    assert si.DECLARED_PAUSE not in si.DAEMON_REGRESSION, "the band no longer fails it"


# ── §3.4 continuity, the edges of the rules the declared-pause change sits beside ───────────────────
#
# Pre-existing survivors, surfaced because a 25-line change in `continuity` pulls the WHOLE function
# into the diff-scoped gate's view. The families are the ones #3245 drained one module over: a closed
# interval's two edges, a status word asserted nowhere, and a reason asserted by fragment.


def test_the_GAP_INTERVAL_IS_CLOSED_at_both_ends(tmp_path):
    """`start <= at <= end` — a gap starting exactly when the strap went on, or exactly when it came
    off, is INSIDE the worn interval. Both edges need their own plant: the band counts gaps by number
    as well as by seconds, so one dropped at an edge changes a FAIL into a PASS silently."""
    worn_start, worn_end = T0, dt.datetime.fromisoformat("2026-09-20T23:03:00")
    for at, where in ((worn_start, "the worn start"), (worn_end, "the worn end")):
        d = tmp_path / f"edge-{at:%H%M%S}"
        d.mkdir()
        out = _cont(d, gaps=[(at.isoformat(), 11.0, si.DECLARED_PAUSE)])
        assert out["reason"] and "explained discontinuity" in out["reason"], f"{where}: {out}"
    # and one millisecond outside either edge is NOT counted
    for at, where in (
        (worn_start - dt.timedelta(milliseconds=1), "before the worn start"),
        (worn_end + dt.timedelta(milliseconds=1), "after the worn end"),
    ):
        d = tmp_path / f"out-{abs(hash(where)) % 9999}"
        d.mkdir()
        out = _cont(d, gaps=[(at.isoformat(), 11.0, si.DECLARED_PAUSE)])
        assert out == {"status": "PASS", "reason": None}, f"{where}: {out}"


def test_the_AUDITED_FILE_MUST_COVER_the_worn_interval_at_BOTH_ENDS(tmp_path):
    """The 2026-09-10 defect's guard: the audit's one file was the previous night's tail, so its empty
    gap list meant nothing. The guard needs BOTH ends and it needs the STATUS, not just the wording —
    a decision is a status and a reason, and asserting the prose leaves the status word free."""
    out = _cont(tmp_path, file="some_other_night_ECG.txt")
    assert out["status"] == "UNKNOWN", out
    assert out["reason"] == (
        "the loss audit examined `some_other_night_ECG.txt`, which does not cover the worn interval"
    ), out["reason"]
    # The far end: the worn interval runs PAST the audited file's last row.
    late = tmp_path / "late"
    late.mkdir()
    out_late = _cont(late, end="2026-09-20T23:59:00")
    assert out_late["status"] == "UNKNOWN" and "does not cover" in out_late["reason"]
    # …and a file that ends EXACTLY at the worn end does cover it — `span[1] < end`, not `<=`.
    exact = tmp_path / "exact"
    exact.mkdir()
    _good_h10(exact)
    p = str(exact / f"{BASE}_ECG.txt")
    audit = json.loads((exact / "LOSS-AUDIT.json").read_text())
    dev = audit["devices"][H10["name"]]
    first, last = si.first_last(p)
    assert si.continuity(audit, dev, first, last, {p: (first, last)})["status"] == "PASS", "exact cover"


def test_an_UNREADABLE_JOURNAL_and_an_UNCOVERED_FILE_both_carry_the_STATUS_UNKNOWN(tmp_path):
    """Both refusals name their reason and both are UNKNOWN. §🧾: a decision is the pair, and a status
    word nothing asserts is a word that can be anything."""
    out = _cont(tmp_path, journal="unavailable — every gap is unattributed")
    assert out == {
        "status": "UNKNOWN",
        "reason": "the loss audit could not read the journal — no gap can be attributed",
    }


def test_the_LINK_FAIL_states_the_SECONDS_the_PERCENTAGE_and_the_bound_it_crossed(tmp_path):
    """`link drops N s = X %` — the numbers are the finding, and a reason asserted by fragment leaves
    every arithmetic mutation of the rest alive. 1.8 s over a 180 s worn interval is 1.0 %, which is
    exactly `LINK_MAX_FRACTION`, and the comparison is INCLUSIVE."""
    out = _cont(tmp_path, gaps=[("2026-09-20T23:01:00", 1.8, "link:timeout / not found")])
    assert out["status"] == "FAIL", out
    assert out["reason"] == "link drops 2 s = 1.0 % of the worn interval", out["reason"]
    under = tmp_path / "under"
    under.mkdir()
    assert _cont(under, gaps=[("2026-09-20T23:01:00", 1.7, "link:timeout / not found")]) == {
        "status": "PASS",
        "reason": None,
    }


def test_a_WORN_INTERVAL_OF_ONE_SECOND_still_divides(tmp_path):
    """`worn_s > 0` guards the division, and the bound is ZERO, not one: a one-second worn interval is
    absurd as a night and arithmetically fine, so the link fraction is computed over it rather than
    skipped. A guard at `> 1` would silently stop judging the shortest intervals."""
    _good_h10(tmp_path)
    p = str(tmp_path / f"{BASE}_ECG.txt")
    audit = json.loads((tmp_path / "LOSS-AUDIT.json").read_text())
    dev = audit["devices"][H10["name"]]
    dev["gaps"] = [{"at": T0.isoformat(), "s": 0.5, "cause": "link:dbus busy"}]
    one_sec = T0 + dt.timedelta(seconds=1)
    out = si.continuity(audit, dev, T0, one_sec, {p: (T0, one_sec)})
    assert out["status"] == "FAIL", f"0.5 s of link drop in a 1 s interval is 50 %: {out}"
    assert out["reason"] == "link drops 0 s = 50.0 % of the worn interval", out["reason"]


def test_an_AUDITED_FILE_WITH_NO_READABLE_STAMP_is_not_examined(tmp_path):
    """`span[0] is None` guards a file whose rows carry no parseable stamp, and it is REACHABLE: a night
    with TWO primaries passes `worn_interval` on the one that has stamps, so `spans` still holds a
    `(None, None)` entry for the other — and if the AUDIT examined that one, its empty gap list says
    nothing about the night. §∅: an unreadable span is absent, not a span of zero, and the band refuses
    with a named reason rather than scoring over it.

    The guard must also not be reordered into `and`: `None > start` raises TypeError, so an `and` here
    turns a refusal into a crash that takes the whole night's verdict with it."""
    _good_h10(tmp_path)
    good = str(tmp_path / f"{BASE}_ECG.txt")
    blind = str(tmp_path / f"{BASE}_ACC.txt")
    (tmp_path / f"{BASE}_ACC.txt").write_text("Phone timestamp;sensor timestamp [ns];X [mg]\nnot-a-stamp;1;2\n")
    assert si.first_last(blind) == (None, None), "the fixture's point: no parseable stamp"
    audit = json.loads((tmp_path / "LOSS-AUDIT.json").read_text())
    dev = dict(audit["devices"][H10["name"]], file=f"{BASE}_ACC.txt", gaps=[])
    spans = {good: si.first_last(good), blind: (None, None)}
    first, last = si.first_last(good)
    out = si.continuity(audit, dev, first, last, spans)
    assert out["status"] == "UNKNOWN", out
    assert out["reason"] == (f"the loss audit examined `{BASE}_ACC.txt`, which does not cover the worn interval"), out[
        "reason"
    ]


# ── §3.4 validity: an EMPTY SESSION is an absence, not an undecided band ────────────────────────────
#
# 🔴 LIVE ON THE BOX, 2026-10-04: `/api/state.solid` read UNKNOWN for the night on
# "Polar Sense — validity: `…20261004150633_PPGRUNS.txt` publishes no min_run". The Verity connected at
# 15:06 on its charger, battery 100 %, never worn, and opened a session whose `_PPG.txt` has 0 rows. The
# `min_run=` header is written at the FIRST run, so a session that recorded nothing leaves a 0-line
# sidecar — and the band, iterating every waveform file in the folder, returned UNKNOWN on it. With the
# night's real session landing in the same date folder, an empty file costs the first PASS-capable night.


def _session(d, stamp, rows=1, min_run=True, stream="PPG", model_base="Polar_VeritySense_0C301E3F"):
    """One Verity session: a `_PPG.txt` with `rows` data rows and its RUNS sidecar.

    `rows=0` is the box's empty session — 0 bytes on the mirror, not even a header — and its sidecar is
    0 lines because `min_run=` is written at the first run."""
    base = f"{model_base}_{stamp}"
    wav = d / f"{base}_{stream}.txt"
    if rows:
        wav.write_text(
            "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient\n"
            + "".join(f"2026-10-04T23:{i // 60:02d}:{i % 60:02d}.000;{i * 7692307};5;5;5;0\n" for i in range(rows))
        )
        head = "# stream=ppg rule=stuck" + (" min_run=30" if min_run else "")
        (d / f"{base}_{stream}RUNS.txt").write_text(head + "\nPhone timestamp;stream\n")
    else:
        wav.write_text("")  # 0 bytes, as the mirror's 30 zero-row files are
        (d / f"{base}_{stream}RUNS.txt").write_text("")  # 0 lines: no run, so no header
    return wav


def test_an_EMPTY_SESSION_is_EXCLUDED_from_validity_and_the_FULL_one_decides(tmp_path):
    """🔴 THE 10-04 PLANT. A folder holding a real session AND the charger's empty one: validity is
    decided on the full session and the empty one is listed as excluded, with the count stated. A
    session that recorded nothing has no validity to assess — UNKNOWN would say "we could not tell"
    about a file that never claimed to contain anything."""
    _session(tmp_path, "20261004213000", rows=5)
    _session(tmp_path, "20261004150633", rows=0)
    out = si.validity(str(tmp_path), "VeritySense")
    assert out["status"] == "PASS", out
    assert "1 waveform file(s) checked, 1 excluded as empty-session" in out["reason"], out["reason"]
    assert "20261004150633_PPG.txt" in out["reason"], "the excluded file is NAMED, not just counted"
    assert "recorded nothing has no validity to assess" in out["reason"]


def test_a_NON_EMPTY_file_whose_sidecar_LACKS_MIN_RUN_is_still_UNKNOWN(tmp_path):
    """🔴 THE CONTROL THAT MATTERS MOST, and the measurement says why. A sidecar with no `min_run=`
    beside a session that DID record is a real blind floor: we do not know what run length the stuck
    detector could see, so we cannot say the stream was checked.

    The mirror's 2787 waveform files partition as 30 zero-row · 115 with rows and a proper header ·
    **2642 with rows and NO SIDECAR AT ALL** (pre-#2950 writers, reported under this band's other
    reason) · and ZERO with a sidecar present but lacking `min_run`. So this exact shape does not occur
    on the mirror and the test is a CONSTRUCTED control — which is the point: keying the exclusion off
    the sidecar rather than the ROWS would sweep in those 2642, the historical majority."""
    _session(tmp_path, "20261004213000", rows=5, min_run=False)
    out = si.validity(str(tmp_path), "VeritySense")
    assert out["status"] == "UNKNOWN", out
    assert "publishes no min_run" in out["reason"], out["reason"]
    assert "blind floor is unknown" in out["reason"]


def test_a_NIGHT_OF_NOTHING_BUT_EMPTY_SESSIONS_is_UNKNOWN_not_PASS(tmp_path):
    """§∅ and the empty-denominator rule. Excluding every file leaves nothing checked, and a band that
    examined nothing has not passed — the same shape as `device_outcome`'s all-inapplicable device. The
    count is named so the two cases stay distinguishable in the verdict."""
    _session(tmp_path, "20261004150633", rows=0)
    _session(tmp_path, "20261004151204", rows=0)
    out = si.validity(str(tmp_path), "VeritySense")
    assert out["status"] == "UNKNOWN", out
    assert "no waveform file this night is judgeable yet: 2 empty session(s)" in out["reason"], out["reason"]


def test_a_CLEAN_NIGHT_WITH_NO_EMPTY_SESSION_still_PASSES_SILENTLY(tmp_path):
    """No exclusion, no reason: the band says nothing when there is nothing to say. A PASS that always
    carried prose would make the annotated case unreadable."""
    _session(tmp_path, "20261004213000", rows=5)
    assert si.validity(str(tmp_path), "VeritySense") == {"status": "PASS", "reason": None}


def test_has_rows_STOPS_AT_THE_FIRST_ROW_and_reads_neither_comment_nor_header(tmp_path):
    """`has_rows` is O(1) on a real stream — a night's ECG is ~160 MB and this reads one line of it. The
    writer's `# timebase=` comment and `Phone timestamp;…` header are the file saying what it WOULD
    contain, so neither counts as a sample."""
    p = tmp_path / "x.txt"
    p.write_text("")
    assert si.has_rows(str(p)) is False, "0 bytes"
    p.write_text("Phone timestamp;sensor timestamp [ns];channel 0\n")
    assert si.has_rows(str(p)) is False, "a header is not a sample"
    p.write_text("# timebase=host\nPhone timestamp;x\n")
    assert si.has_rows(str(p)) is False, "nor is a comment"
    p.write_text("# timebase=host\nPhone timestamp;x\n\n   \n")
    assert si.has_rows(str(p)) is False, "nor are blank lines"
    p.write_text("# timebase=host\nPhone timestamp;x\n2026-10-04T23:00:00.000;1\n")
    assert si.has_rows(str(p)) is True
    assert si.has_rows(str(tmp_path / "absent.txt")) is False, "a file we cannot open holds no row we can see"


def test_a_SESSION_STILL_BEING_WRITTEN_is_NOT_YET_JUDGEABLE_never_UNKNOWN(tmp_path):
    """🔴 THE 19:37 RED, PLANTED. On 2026-10-04 a Verity session open since 19:08 was judged at 19:37
    and the night read UNKNOWN on `…_PPGRUNS.txt publishes no min_run`. The sidecar had not failed to
    state its rule: `_RunSidecar` writes that header into a 64 KB buffer at construction, and
    `StreamWriter.flush()` flushes the waveform and its `_RR` sibling but NOT `_runs` — so a live
    session's sidecar sits at 0 bytes until 64 KB of run rows accumulate or `close()` runs. The same
    file later carried `min_run=200` on line 1 and nine lines.

    PRESENT-AND-EMPTY is a different fact from ABSENT, and the two keep different answers: a 0-byte
    sidecar cannot survive a clean close, so it means live or torn; an absent one is the pre-#2950
    writers and keeps its own UNKNOWN. Verified against main in `/tmp/claude-1000/plants.py`: main
    returns UNKNOWN here."""
    full = _session(tmp_path, "20261004213000", rows=5)
    live = _session(tmp_path, "20261004190825", rows=5)
    (tmp_path / f"{live.name[: -len('.txt')]}RUNS.txt").write_text("")  # open("w") made it; nothing flushed
    out = si.validity(str(tmp_path), "VeritySense")
    assert out["status"] == "PASS", out
    assert "1 waveform file(s) checked" in out["reason"], out["reason"]
    assert "1 not yet judgeable, still being written" in out["reason"]
    # the WAVEFORM is named, not its sidecar: the waveform is the unit excluded from the band's
    # population, and `empty-session` names it the same way. The box's operator message named the
    # sidecar because that is what `validity` had refused on.
    assert "20261004190825_PPG.txt" in out["reason"], "the excluded waveform is NAMED"
    assert "in the writer's buffer, not absent" in out["reason"]
    assert full.exists()


def test_an_ABSENT_sidecar_keeps_its_OWN_UNKNOWN_and_is_not_mistaken_for_a_buffer(tmp_path):
    """The distinction the fix turns on, and the mirror is why it matters: 2642 of its 2787 waveform
    files have rows and NO SIDECAR AT ALL (pre-#2950), against ZERO with a sidecar present but empty.
    Folding present-and-empty into absent would sweep in that historical majority."""
    wav = _session(tmp_path, "20261004213000", rows=5)
    (tmp_path / f"{wav.name[: -len('.txt')]}RUNS.txt").unlink()
    out = si.validity(str(tmp_path), "VeritySense")
    assert out["status"] == "UNKNOWN", out
    assert "absent — absences not examined (#2950)" in out["reason"], out["reason"]


def test_a_NIGHT_OF_ONLY_LIVE_SESSIONS_is_UNKNOWN_and_says_which_kind(tmp_path):
    """Nothing judgeable leaves nothing checked, and a band that examined nothing has not passed — but
    the reason distinguishes an empty session from a live one, because they call for different actions:
    one is a session that recorded nothing, the other is a night still being recorded."""
    live = _session(tmp_path, "20261004190825", rows=5)
    (tmp_path / f"{live.name[: -len('.txt')]}RUNS.txt").write_text("")
    out = si.validity(str(tmp_path), "VeritySense")
    assert out["status"] == "UNKNOWN", out
    assert "0 empty session(s), 1 still being written" in out["reason"], out["reason"]


def test_HAS_ROWS_and_the_SIDECAR_READER_both_DECLARE_their_encoding(tmp_path):
    """`encoding="utf-8"` asserted on the CALL for both readers this unit adds. `-X
    warn_default_encoding` with `-W error::EncodingWarning` makes every `open()` that leaves `encoding`
    unset — or explicitly None — raise, so the assertion holds on a UTF-8 machine and a C-locale one
    alike. A capture written on the box must read the same here.

    The in-process calls first are NOT redundant: mutmut picks which tests to run for a mutant from
    COVERAGE, and a subprocess is invisible to the tracer — without them these mutants read unkillable."""
    import subprocess
    import sys

    _session(tmp_path, "20261004213000", rows=3)
    wav = str(tmp_path / "Polar_VeritySense_0C301E3F_20261004213000_PPG.txt")
    assert si.has_rows(wav) is True
    assert si.validity(str(tmp_path), "VeritySense")["status"] == "PASS"
    src = (
        "import solid_night_inputs as si\n"
        f"assert si.has_rows({wav!r}) is True\n"
        f"assert si.validity({str(tmp_path)!r}, 'VeritySense')['status'] == 'PASS'\n"
    )
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=str(si.__file__).rsplit("/", 1)[0],
    )
    assert r.returncode == 0, r.stderr


def test_BOTH_READERS_REPLACE_an_undecodable_byte_rather_than_dying_on_it(tmp_path):
    """`errors="replace"`, killed IN PROCESS with a byte no UTF-8 decoder accepts. A capture file is
    device bytes: the O2Ring's `Pölar` spellings and a torn write both put non-UTF-8 in the stream, and
    the default `errors=None` is STRICT — a `UnicodeDecodeError` is not an `OSError`, so it would
    escape these readers and take the night's whole verdict with it rather than skipping a line.

    Both readers are covered because both open a file this unit put in the path: `has_rows` the waveform
    and `validity` the sidecar."""
    _session(tmp_path, "20261004213000", rows=3)
    wav = tmp_path / "Polar_VeritySense_0C301E3F_20261004213000_PPG.txt"
    runs = tmp_path / "Polar_VeritySense_0C301E3F_20261004213000_PPGRUNS.txt"
    with open(wav, "wb") as fh:
        fh.write(b"Phone timestamp;x\n2026-10-04T23:00:00.000;\xff\xfe5\n")
    assert si.has_rows(str(wav)) is True, "an undecodable byte is a row, not a crash"
    with open(runs, "wb") as fh:
        fh.write(b"# stream=ppg rule=stuck min_run=30 \xff\xfe\nPhone timestamp;stream\n")
    out = si.validity(str(tmp_path), "VeritySense")
    assert out["status"] == "PASS", out
    # and the other direction: the undecodable byte must not swallow the header the band reads for
    with open(runs, "wb") as fh:
        fh.write(b"# stream=ppg rule=stuck \xff\xfe\nPhone timestamp;stream\n")
    assert si.validity(str(tmp_path), "VeritySense")["status"] == "UNKNOWN", "no min_run is still UNKNOWN"


def test_a_NIGHT_WITH_NO_WAVEFORM_AT_ALL_carries_the_STATUS_and_the_reason(tmp_path):
    """A decision is the pair (§🧾). This path had its prose asserted and its STATUS word free, so a
    mutant could publish `None` as the status and no test would see it."""
    out = si.validity(str(tmp_path), "VeritySense")
    assert out == {
        "status": "UNKNOWN",
        "reason": "no waveform file this night, so no sidecar could be checked",
    }


# ── THE RECORDING IS THE SCOPE (NIGHT-IS-THE-RECORDING-2026-10-05) ──────────────────────────────────


def _sess(d, stamp, stream="PPG", model="VeritySense", rows=3):
    """A session's primary file, named as the writer names it: prefix, serial, 14-digit START stamp."""
    pref = {"VeritySense": "Polar_VeritySense_0C301E3F", "H10": "Polar_H10_02849638"}[model]
    p = d / f"{pref}_{stamp}_{stream}.txt"
    p.write_text("Phone timestamp;x\n" + "".join(f"2026-10-04T00:00:0{i};1\n" for i in range(rows)))
    (d / f"{pref}_{stamp}_{stream}RUNS.txt").write_text("# stream=ppg rule=stuck min_run=30\n")
    return p


def test_THE_BAND_A_FOLDER_NAMES_COMES_FROM_NIGHTQC_not_a_second_copy(tmp_path):
    """ONE CONVENTION (owner, 2026-10-05). The band is `nightqc.night_band`'s answer, asked about the
    folder's own date — not a restatement of its edges here. If `_NIGHT_BEGIN_H` moves again, this moves
    with it, which is the whole point of the ruling."""
    import nightqc

    band = si.band_of(str(tmp_path / "2026-10-04"))
    probe = dt.datetime(2026, 10, 4, 23, 0).timestamp()
    assert band == nightqc.night_band(probe), "the single implementation, not a copy"
    assert round(band[1] - band[0]) == (24 - nightqc._NIGHT_BEGIN_H + nightqc._NIGHT_END_H) * 3600
    assert si.band_of(str(tmp_path / "not-a-date")) is None


def test_THE_SCOPE_REACHES_FORWARD_to_the_mornings_folder(tmp_path):
    """A recording is judged in its FIRST session's folder, so the scope reaches to the NEXT day — the
    mirror image of `nightqc._prev_day_dir`, which is called from the folder holding the morning."""
    (tmp_path / "2026-10-04").mkdir()
    (tmp_path / "2026-10-05").mkdir()
    sc = si.recording_scope(str(tmp_path / "2026-10-04"))
    assert sc["ok"] is True
    assert sc["judged_dir"] == "2026-10-04"
    assert sc["searched_dirs"] == ["2026-10-04", "2026-10-05"], "forward, not backward"
    assert len(sc["searched_dirs"]) <= si.SCOPE_MAX_DIRS


def test_A_SCOPE_WITH_NO_NEXT_FOLDER_IS_ONE_FOLDER_and_still_ok(tmp_path):
    """61 of the mirror's 111 night recordings live in one folder. A missing next day is the ordinary
    case, not a failure."""
    (tmp_path / "2026-10-04").mkdir()
    sc = si.recording_scope(str(tmp_path / "2026-10-04"))
    assert sc["ok"] is True and sc["searched_dirs"] == ["2026-10-04"]


def test_A_FOLDER_THAT_IS_NOT_A_DATE_NAMES_NO_BAND_and_is_UNKNOWN_not_judged(tmp_path):
    """`captures/` also holds `stored/` and hundreds of session-id subdirectories. A judgement asked
    about one of those has no band to clip to, and says so rather than inventing one."""
    (tmp_path / "stored").mkdir()
    sc = si.recording_scope(str(tmp_path / "stored"))
    assert sc["ok"] is False
    assert "names no night band" in sc["reason"]
    assert sc["band"] is None


def test_THE_TWO_FOLDER_BOUND_IS_A_TRIPWIRE_THAT_MUST_NEVER_FIRE():
    """🔴 STRUCTURAL, AND ASSERTED BECAUSE A BOUND NOBODY CHECKS IS A BOUND NOBODY KEEPS. A band runs
    18:00 -> 10:00, so it touches exactly two calendar dates, so a band-clipped recording's sessions can
    only start in those two. Measured over the vigil mirror: 111 night recordings — 61 in one folder, 50
    in two, ZERO in three. The branch is kept so that if the premise ever changes the night goes UNKNOWN
    with its reason instead of being judged over a scope silently cut short."""
    assert si.SCOPE_MAX_DIRS == 2
    import nightqc

    width_h = 24 - nightqc._NIGHT_BEGIN_H + nightqc._NIGHT_END_H
    assert width_h <= 24, "a band wider than a day could touch three dates and break the bound"
    assert width_h / 24 < 2, "and the bound is two folders, so the band must stay inside two dates"


def test_A_SESSION_IS_ATTRIBUTED_BY_ITS_START_and_never_by_the_device_serial(tmp_path):
    """MEMBERSHIP, via `writers.file_stamp`. Its docstring records why a regex here would be wrong
    (audit F5): an unanchored 14-digit search takes the FIRST run in the name, which on
    `Polar_H10_20250101000000_20260725225058_ECG.txt` is the SERIAL — and it parses cleanly, so the file
    is silently keyed to a session eighteen months away. Two callers already shipped that bug."""
    band = si.band_of(str(tmp_path / "2026-10-04"))
    assert si.in_band("Polar_H10_20250101000000_20261004220000_ECG.txt", band) is True
    assert si.in_band("Polar_H10_20250101000000_20261004120000_ECG.txt", band) is False
    assert si.in_band("no-stamp-at-all.txt", band) is True, "a file with no start is not ours to exclude"


def test_THE_19_08_SPLIT_AND_THE_04_17_MORNING_LAND_IN_ONE_RECORDING(tmp_path):
    """🔴 #3290's measured case. On 2026-10-04 the Verity donned at 19:08 and banded to 10-03 while the
    ring (22:00) and the H10 (22:02) banded to 10-04 — one recording split at the band layer. And the
    night's morning half (to 04:17) is filed in the NEXT folder. All of it is one recording here."""
    band = si.band_of(str(tmp_path / "2026-10-04"))
    for stamp in ("20261004190825", "20261004220000", "20261004220200", "20261005041700"):
        assert si.in_band(f"Polar_H10_02849638_{stamp}_ECG.txt", band) is True, stamp
    # and the daytime session of the same folder is NOT part of it
    assert si.in_band("Polar_VeritySense_0C301E3F_20261004095250_PPG.txt", band) is False


def test_PRIMARIES_ARE_POOLED_ACROSS_THE_RECORDING_and_filtered_by_band(tmp_path):
    """The whole scope change in one assertion: the evening half in the judged folder, the morning half
    in the next, a daytime session in each — and `stream_files` returns exactly the recording.

    Measured equivalent on real data: judging `2026-10-03` on the vigil mirror finds 0 primaries on
    `origin/main` (the night's sessions are filed in `2026-10-04`) and the actual cross-midnight
    recording here. The folder is not the recording in EITHER direction."""
    d4 = tmp_path / "2026-10-04"
    d5 = tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    _sess(d4, "20261004220000")  # evening: in
    _sess(d5, "20261005041700")  # morning:  in
    _sess(d4, "20261004095250")  # daytime before the band opens: out
    _sess(d5, "20261005143000")  # next afternoon, past the band's end: out
    got = sorted(os.path.basename(p) for p in si.stream_files(str(d4), "VeritySense", "PPG"))
    assert got == [
        "Polar_VeritySense_0C301E3F_20261004220000_PPG.txt",
        "Polar_VeritySense_0C301E3F_20261005041700_PPG.txt",
    ], got


def test_THE_WORN_INTERVAL_IS_TRUNCATED_AT_THE_BAND_EDGES(tmp_path):
    """🔴 THE SECOND MEANING OF "CLIPPED", and the one a first pass missed. `completeness` takes its
    denominator from `rate x (end - start)`, so the worn interval IS the denominator. Membership decided
    WHICH files; truncation decides HOW LONG. A first clipped run that used membership alone reported a
    night span of 32.95 h — impossible inside a 16 h band, and the 46.25 % over-wide denominator
    reappearing one layer in. 9 of the mirror's 111 night recordings have a raw extent leaving their band."""
    nd = str(tmp_path / "2026-10-04")
    (tmp_path / "2026-10-04").mkdir()
    lo, hi = (dt.datetime.fromtimestamp(t) for t in si.band_of(nd))
    # a session that starts inside the band and runs eight hours past its end
    s, e, cut = si._truncate_to_band(nd, lo + dt.timedelta(hours=2), hi + dt.timedelta(hours=8))
    assert cut is True
    assert s == lo + dt.timedelta(hours=2) and e == hi, "the end is clipped, the start is untouched"
    assert (e - s).total_seconds() <= (hi - lo).total_seconds()
    # one wholly inside is returned unchanged and not reported as truncated
    s2, e2, cut2 = si._truncate_to_band(nd, lo + dt.timedelta(hours=1), lo + dt.timedelta(hours=9))
    assert cut2 is False and s2 == lo + dt.timedelta(hours=1)
    # one wholly OUTSIDE its band is no part of this night at all
    s3, e3, cut3 = si._truncate_to_band(nd, hi + dt.timedelta(hours=1), hi + dt.timedelta(hours=3))
    assert (s3, e3) == (None, None) and cut3 is True


def test_A_TRUNCATED_SPAN_NEVER_EXCEEDS_THE_BAND_WIDTH(tmp_path):
    """The invariant behind the measurement: truncated spans came out p50 7.76 h, p95 14.75 h, max
    exactly 16.00 h with none over. Asserted rather than trusted."""
    nd = str(tmp_path / "2026-10-04")
    (tmp_path / "2026-10-04").mkdir()
    band = si.band_of(nd)
    width = band[1] - band[0]
    lo = dt.datetime.fromtimestamp(band[0])
    for off_start, off_end in ((-5, 30), (0, 16), (-1, 1), (3, 50)):
        s, e, _c = si._truncate_to_band(nd, lo + dt.timedelta(hours=off_start), lo + dt.timedelta(hours=off_end))
        if s is not None:
            assert (e - s).total_seconds() <= width + 1e-6, (off_start, off_end)


def test_THE_WEAR_END_IS_TAKEN_FROM_THE_MORNINGS_AUDIT_when_it_is_later(tmp_path):
    """A recording spanning two folders has two `LOSS-AUDIT.json`, and the doff of a night that ended at
    04:17 is recorded in the MORNING folder's. The judged folder's audit stays the base — it holds the
    journal and the gap rows this night was audited against — and only `wear` is taken forward."""
    d4 = tmp_path / "2026-10-04"
    d5 = tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    dev = "Polar H10 02849638"
    (d4 / si.LOSS_AUDIT_NAME).write_text(
        json.dumps(
            {
                "journal": "ok",
                "devices": {
                    dev: {
                        "wear": {"available": True, "worn_end": {"at": "2026-10-04T23:59:00", "reason": "doff"}},
                        "gaps": [{"at": "2026-10-04T23:00:00", "s": 12.0, "file": "evening.txt"}],
                        "file": "a",
                    }
                },
            }
        )
    )
    (d5 / si.LOSS_AUDIT_NAME).write_text(
        json.dumps(
            {
                "journal": "ok",
                "devices": {
                    dev: {
                        "wear": {"available": True, "worn_end": {"at": "2026-10-05T04:17:00", "reason": "doff"}},
                        "gaps": [{"at": "2026-10-05T00:10:00", "s": 9.0, "file": "morning.txt"}],
                        "file": "b",
                    }
                },
            }
        )
    )
    pooled = si._pooled_audit(str(d4))
    assert pooled["devices"][dev]["wear"]["worn_end"]["at"] == "2026-10-05T04:17:00", "the later doff wins"
    assert pooled["devices"][dev]["wear_from"] == "2026-10-05", "and it says where it came from"
    # 🔴 THIS ASSERTION CHANGED DELIBERATELY. #3297 left `gaps` UNMERGED and said so: the rows are
    # measured against one named file, and concatenating two folders' would attribute one file's gaps to
    # another's timeline. Its residue row
    # (`2026-10-05-cross-folder-continuity-sees-only-the-judged-folders-gaps`) is what this unit closes:
    # rows merge BY FILE IDENTITY — each already names its `file`, and a filename carries its own
    # 14-digit session start — and the row from the morning folder is stamped with the folder it came
    # from. `file`, the single name the gaps were summarised under, still does NOT cross.
    merged = pooled["devices"][dev]["gaps"]
    assert [r.get("file") for r in merged] == ["evening.txt", "morning.txt"], merged
    assert merged[1]["folder"] == "2026-10-05", "a row from the next folder says which folder it is from"
    assert "folder" not in merged[0], "and a row from the judged folder needs no stamp"
    assert pooled["devices"][dev]["file"] == "a", "the summarised-under name does not cross"
    assert pooled["devices"][dev]["seam_unassessed"], "and the seam itself is reported, not assumed clean"


def test_A_ONE_FOLDER_RECORDING_READS_ITS_OWN_AUDIT_UNCHANGED(tmp_path):
    """The control: pooling must be a no-op when there is nothing to pool, byte for byte."""
    d4 = tmp_path / "2026-10-04"
    d4.mkdir()
    payload = {"journal": "ok", "devices": {"H10": {"wear": {"available": True}, "gaps": [1], "file": "a"}}}
    (d4 / si.LOSS_AUDIT_NAME).write_text(json.dumps(payload))
    assert si._pooled_audit(str(d4)) == payload


def test_NEXT_DAY_OF_A_NON_DATE_FOLDER_IS_NOTHING(tmp_path):
    """`stored/` and the session-id subdirectories have no next day, because they have no date."""
    assert si._next_day_dir(str(tmp_path / "stored")) is None
    assert si._next_day_dir(str(tmp_path / "2026-10-04")).endswith("2026-10-05")
    # and the month rolls, because `date` arithmetic does it and string arithmetic would not
    assert si._next_day_dir(str(tmp_path / "2026-10-31")).endswith("2026-11-01")


def test_A_MORNING_AUDIT_THAT_IS_UNREADABLE_OR_MALFORMED_LEAVES_THE_BASE_ALONE(tmp_path):
    """The pooling must not be able to damage the judged folder's own audit. Three shapes, each of which
    a real second folder can present: no audit at all, an audit that is not an object, and a device entry
    that is not an object."""
    d4 = tmp_path / "2026-10-04"
    d5 = tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    base = {
        "journal": "ok",
        "devices": {"H10": {"wear": {"available": True, "worn_end": {"at": "2026-10-04T23:00:00"}}}},
    }
    (d4 / si.LOSS_AUDIT_NAME).write_text(json.dumps(base))

    (d5 / si.LOSS_AUDIT_NAME).write_text("[1, 2, 3]")  # valid JSON, not an audit object
    assert si._pooled_audit(str(d4)) == base

    (d5 / si.LOSS_AUDIT_NAME).write_text(json.dumps({"devices": {"H10": "not-an-object"}}))
    assert si._pooled_audit(str(d4)) == base

    (d5 / si.LOSS_AUDIT_NAME).write_text("{ not json at all")
    assert si._pooled_audit(str(d4)) == base


def test_AN_EARLIER_OR_ABSENT_MORNING_DOFF_DOES_NOT_REPLACE_A_LATER_ONE(tmp_path):
    """Only a LATER doff wins. A second folder whose audit states an earlier end — or states none —
    must not pull the recording's end backwards, which would shrink the denominator instead of widening
    it and read as better completeness than the night earned."""
    d4 = tmp_path / "2026-10-04"
    d5 = tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    dev = "H10"
    late = {"available": True, "worn_end": {"at": "2026-10-05T04:17:00", "reason": "doff"}}
    (d4 / si.LOSS_AUDIT_NAME).write_text(json.dumps({"journal": "ok", "devices": {dev: {"wear": late}}}))
    (d5 / si.LOSS_AUDIT_NAME).write_text(
        json.dumps({"devices": {dev: {"wear": {"available": True, "worn_end": {"at": "2026-10-05T01:00:00"}}}}})
    )
    assert si._pooled_audit(str(d4))["devices"][dev]["wear"] == late, "the earlier end loses"
    assert "wear_from" not in si._pooled_audit(str(d4))["devices"][dev]

    (d5 / si.LOSS_AUDIT_NAME).write_text(json.dumps({"devices": {dev: {"gaps": []}}}))  # no wear at all
    assert si._pooled_audit(str(d4))["devices"][dev]["wear"] == late

    # a device the judged folder never saw is still ADOPTED from the morning: it was worn, in this band
    (d5 / si.LOSS_AUDIT_NAME).write_text(
        json.dumps(
            {"devices": {"VeritySense": {"wear": {"available": True, "worn_end": {"at": "2026-10-05T04:00:00"}}}}}
        )
    )
    pooled = si._pooled_audit(str(d4))
    assert pooled["devices"]["VeritySense"]["wear_from"] == "2026-10-05"


def test_THE_SCOPE_COUNTS_THE_FILES_IT_ADMITS_per_folder_and_in_total(tmp_path):
    """🔴 `data_files` SHIPPED AS A LITERAL 0 and three mutants of it survived the gate — nothing read it
    because there was nothing to read. A field fixed at zero is a count nobody took, which is the §∅ bug
    this file exists to refuse. It is counted now, and the per-folder split is what makes a cross-folder
    recording legible: `searched_dirs` says where the judgement looked, this says what it found there."""
    d4, d5 = tmp_path / "2026-10-04", tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    (d4 / "Polar_H10_02849638_20261004220000_ECG.txt").write_text("x")
    (d4 / "Polar_H10_02849638_20261004095250_ECG.txt").write_text("x")  # daytime: not admitted
    (d5 / "Polar_H10_02849638_20261005041700_ECG.txt").write_text("x")
    sc = si.recording_scope(str(d4))
    assert sc["data_files"] == 2, sc
    assert sc["data_files_per_dir"] == {"2026-10-04": 1, "2026-10-05": 1}
    assert sc["data_files"] == sum(sc["data_files_per_dir"].values()), "the total IS the parts"
    # An empty scope counts zero, and that zero was MEASURED — the distinction the literal destroyed.
    # The judged folder is always in scope even when it holds nothing, so it appears with its own 0:
    # "I looked here and found none" is a different statement from "I did not look", and the per-folder
    # split is where the difference is visible.
    empty = si.recording_scope(str(tmp_path / "2026-11-01"))
    assert empty["data_files"] == 0
    assert empty["data_files_per_dir"] == {"2026-11-01": 0}, "looked, found none — not absent from the map"


def test_A_NON_DATE_FOLDER_SCOPE_IS_NOT_OK_and_carries_no_dirs(tmp_path):
    """`ok: False` asserted on the branch itself: a scope that cannot be delimited must not read as
    resolved, or `compose` judges the night over it."""
    (tmp_path / "stored").mkdir()
    sc = si.recording_scope(str(tmp_path / "stored"))
    assert sc["ok"] is False and sc["band"] is None
    assert sc["span"] is None and sc["daytime"] == []
    assert sc["data_files"] == 0
    assert "dirs" not in sc, "an unresolved scope offers no folders to read"
    assert si._scope_dirs(str(tmp_path / "stored")) == [str(tmp_path / "stored")], "falls back to itself"


def test_A_TRAILING_SLASH_NEVER_CHANGES_THE_SCOPE(tmp_path):
    """`rstrip("/")` in four places, and `lstrip` would turn an absolute path into a relative one while
    leaving the trailing slash — so `basename` returns "" and the scope names a folder called nothing.
    The daemon joins paths from config and a config value ending in a separator is ordinary."""
    (tmp_path / "2026-10-04").mkdir()
    bare = si.recording_scope(str(tmp_path / "2026-10-04"))
    slashed = si.recording_scope(str(tmp_path / "2026-10-04") + "/")
    assert slashed["judged_dir"] == "2026-10-04" == bare["judged_dir"]
    assert slashed["searched_dirs"] == bare["searched_dirs"]
    assert si._scope_dirs(str(tmp_path / "2026-10-04") + "/") == si._scope_dirs(str(tmp_path / "2026-10-04"))
    assert si._next_day_dir(str(tmp_path / "2026-10-04") + "/").endswith("2026-10-05")
    assert si.band_of(str(tmp_path / "2026-10-04") + "/") == si.band_of(str(tmp_path / "2026-10-04"))


def test_THE_BAND_IS_HALF_OPEN_at_both_edges(tmp_path):
    """`band[0] <= t < band[1]`. The edges are where a session is assigned to one night or the next, so
    both comparisons carry a whole night: 18:00:00 exactly opens this band, and 10:00:00 exactly belongs
    to the next one, not to this."""
    band = si.band_of(str(tmp_path / "2026-10-04"))
    lo, hi = (dt.datetime.fromtimestamp(t) for t in band)
    at = lambda d: f"Polar_H10_02849638_{d:%Y%m%d%H%M%S}_ECG.txt"
    assert si.in_band(at(lo), band) is True, "18:00:00 exactly IS this night"
    assert si.in_band(at(lo - dt.timedelta(seconds=1)), band) is False
    assert si.in_band(at(hi), band) is False, "10:00:00 exactly is the NEXT night"
    assert si.in_band(at(hi - dt.timedelta(seconds=1)), band) is True


def test_THE_NEXT_DAY_FOLDER_IS_A_SIBLING_not_a_child(tmp_path):
    """`os.path.dirname` then join: the next day sits BESIDE this folder under `captures/`, and a mutant
    that drops the dirname would look for it inside the night itself."""
    (tmp_path / "2026-10-04").mkdir()
    nxt = si._next_day_dir(str(tmp_path / "2026-10-04"))
    assert nxt == str(tmp_path / "2026-10-05")
    assert os.path.dirname(nxt) == str(tmp_path), "a sibling of the judged folder"


def test_TRUNCATION_NEEDS_BOTH_ENDS_and_reports_honestly_when_it_did_nothing(tmp_path):
    """`band is None or start is None or end is None` — ALL THREE, because a half-open interval cannot
    be clipped: with `and`, a start of None and a real end would fall through to `max(None, lo)`. And an
    interval already inside its band reports `truncated=False`, which is what tells a reader the span is
    the recording's own and not a clipped remnant."""
    nd = str(tmp_path / "2026-10-04")
    (tmp_path / "2026-10-04").mkdir()
    lo = dt.datetime.fromtimestamp(si.band_of(nd)[0])
    assert si._truncate_to_band(nd, None, lo + dt.timedelta(hours=2)) == (None, lo + dt.timedelta(hours=2), False)
    assert si._truncate_to_band(nd, lo + dt.timedelta(hours=2), None) == (lo + dt.timedelta(hours=2), None, False)
    assert si._truncate_to_band(str(tmp_path / "stored"), lo, lo) == (lo, lo, False), "no band, no truncation"
    s, e, cut = si._truncate_to_band(nd, lo + dt.timedelta(hours=1), lo + dt.timedelta(hours=2))
    assert cut is False, "untouched means untouched, and a reader relies on that"


def test_AN_INTERVAL_THAT_ENDS_EXACTLY_WHERE_IT_STARTS_IS_NOT_THIS_NIGHT(tmp_path):
    """`new_end <= new_start`, not `<`. A zero-length interval is no part of the night: it would make the
    completeness denominator zero and the band would divide by it."""
    nd = str(tmp_path / "2026-10-04")
    (tmp_path / "2026-10-04").mkdir()
    lo, hi = (dt.datetime.fromtimestamp(t) for t in si.band_of(nd))
    assert si._truncate_to_band(nd, hi, hi + dt.timedelta(hours=1)) == (None, None, True), "clipped to zero"
    assert si._truncate_to_band(nd, lo - dt.timedelta(hours=2), lo) == (None, None, True)


def test_THE_BAND_PROBE_IS_INSIDE_THE_FOLDERS_OWN_NIGHT(tmp_path):
    """`time(23, 0)` — the hour asked of `nightqc.night_band`. It has to be an hour that lies in the
    folder's OWN band under any plausible lower edge, and the minutes must not drift it: 23:00 on date D
    is inside `[D 18:00, D+1 10:00)` and would still be for any begin hour at or before 23:00."""
    band = si.band_of(str(tmp_path / "2026-10-04"))
    probe = dt.datetime(2026, 10, 4, 23, 0).timestamp()
    assert band[0] <= probe < band[1], "the probe must fall inside the band it is asking about"
    assert dt.datetime.fromtimestamp(band[0]).date() == dt.date(2026, 10, 4), "and anchor on THIS date"


def test_POOLING_NEEDS_A_BASE_AND_A_SECOND_FOLDER_not_either(tmp_path):
    """`base is None or len(dirs) < 2` — OR, not AND. With `and`, a judged folder whose own audit is
    missing would fall through into the merge loop and `base.setdefault` on None would raise, losing the
    night's verdict entirely to an audit that simply was not there yet."""
    d4, d5 = tmp_path / "2026-10-04", tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    (d5 / si.LOSS_AUDIT_NAME).write_text(json.dumps({"devices": {"H10": {"wear": {"available": True}}}}))
    assert si._pooled_audit(str(d4)) is None, "no base audit: nothing to pool INTO, and no crash"
    # and the mirror case: a base with no second folder is returned as it is
    only = tmp_path / "2026-11-01"
    only.mkdir()
    payload = {"journal": "ok", "devices": {}}
    (only / si.LOSS_AUDIT_NAME).write_text(json.dumps(payload))
    assert si._pooled_audit(str(only)) == payload


def test_ONE_UNUSABLE_DEVICE_ENTRY_DOES_NOT_ABANDON_THE_REST(tmp_path):
    """`continue`, not `break`. A second folder's audit may carry one malformed device entry beside good
    ones, and stopping at the first would silently drop every device after it — the morning doff of a
    device listed later would vanish because an earlier one was unreadable."""
    d4, d5 = tmp_path / "2026-10-04", tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    (d4 / si.LOSS_AUDIT_NAME).write_text(json.dumps({"journal": "ok", "devices": {}}))
    (d5 / si.LOSS_AUDIT_NAME).write_text(
        json.dumps(
            {
                "devices": {
                    "aaa-bad": "not-an-object",
                    "zzz-good": {"wear": {"available": True, "worn_end": {"at": "2026-10-05T04:17:00"}}},
                }
            }
        )
    )
    pooled = si._pooled_audit(str(d4))
    assert "zzz-good" in pooled["devices"], "the entry AFTER the bad one still arrives"
    assert pooled["devices"]["zzz-good"]["wear_from"] == "2026-10-05"


def test_AN_EQUAL_DOFF_IS_NOT_A_LATER_ONE(tmp_path):
    """`str(o_end) > str(b_end)`, strictly. Two folders stating the SAME end is the ordinary case for a
    recording whose doff both audits saw; adopting it again would rewrite `wear` and stamp a `wear_from`
    that claims the morning folder decided something it merely agreed with."""
    d4, d5 = tmp_path / "2026-10-04", tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    same = {"available": True, "worn_end": {"at": "2026-10-05T04:17:00", "reason": "doff"}}
    (d4 / si.LOSS_AUDIT_NAME).write_text(json.dumps({"journal": "ok", "devices": {"H10": {"wear": dict(same)}}}))
    (d5 / si.LOSS_AUDIT_NAME).write_text(json.dumps({"devices": {"H10": {"wear": dict(same)}}}))
    pooled = si._pooled_audit(str(d4))
    assert "wear_from" not in pooled["devices"]["H10"], "agreement is not a later doff"


def test_POOLING_WRITES_INTO_THE_DEVICES_MAP_it_was_given(tmp_path):
    """`setdefault("devices", {})` — the default has to be a MAP. With None, adopting a device the judged
    folder never listed would raise on the next `setdefault`, which is exactly the case pooling exists
    for: a device that only appears in the morning half."""
    d4, d5 = tmp_path / "2026-10-04", tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    (d4 / si.LOSS_AUDIT_NAME).write_text(json.dumps({"journal": "ok"}))  # NO devices key at all
    (d5 / si.LOSS_AUDIT_NAME).write_text(
        json.dumps(
            {"devices": {"VeritySense": {"wear": {"available": True, "worn_end": {"at": "2026-10-05T04:00:00"}}}}}
        )
    )
    pooled = si._pooled_audit(str(d4))
    assert pooled["devices"]["VeritySense"]["wear_from"] == "2026-10-05"


def test_SEAM_AND_RTC_SIDECARS_ARE_POOLED_AND_BAND_FILTERED(tmp_path):
    """The other two enumeration sites. A clock record in the morning half belongs to this recording; one
    from the afternoon before it does not, and reading the folder alone gets both wrong at once."""
    d4, d5 = tmp_path / "2026-10-04", tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    pref = "Polar_H10_02849638"
    hdr = "Phone timestamp;event;rtc_offset_s\n"
    (d4 / f"{pref}_20261004220000_RTCLOG.csv").write_text(hdr + "2026-10-04T22:00:01;read;0.4\n")
    (d5 / f"{pref}_20261005041700_RTCLOG.csv").write_text(hdr + "2026-10-05T04:17:01;read;0.5\n")
    (d4 / f"{pref}_20261004095250_RTCLOG.csv").write_text(hdr + "2026-10-04T09:52:51;read;9.9\n")
    band = si.band_of(str(d4))
    admitted = [
        f
        for d in si._scope_dirs(str(d4))
        for f in sorted(os.listdir(d))
        if f.endswith("_RTCLOG.csv") and si.in_band(os.path.join(d, f), band)
    ]
    assert admitted == [f"{pref}_20261004220000_RTCLOG.csv", f"{pref}_20261005041700_RTCLOG.csv"], admitted


def test_CLOCKS_IGNORES_A_SIDECAR_FROM_OUTSIDE_THE_BAND(tmp_path):
    """🔴 THE BAND FILTER ON THE CLOCK SIDECARS, which no existing test reached: the suite's other
    `clocks` cases use a bare `tmp_path`, so `band_of` is None and nothing is filtered. In a real
    date-named folder a seam sidecar from the AFTERNOON is not this night's clock evidence, and counting
    it would let a daytime session's comparison vouch for a night that never had one."""
    nd = tmp_path / "2026-09-20"
    nd.mkdir()
    # only an out-of-band sidecar (12:00, before the band opens): no clock evidence for this night
    _seams(nd, examined=50, name="Polar_H10_02849638_20260920120000")
    assert si.clocks(str(nd), "H10")["status"] == "UNKNOWN", "a daytime comparison is not this night's"
    # and an in-band one decides it
    _seams(nd, examined=50, name="Polar_H10_02849638_20260920230000")
    assert si.clocks(str(nd), "H10")["status"] == "PASS"


def test_CLOCKS_READS_THE_MORNING_HALFS_SIDECAR_TOO(tmp_path):
    """The other direction, and the reason pooling exists here: a recording's clock comparison may have
    been written after midnight, in the NEXT folder."""
    d4 = tmp_path / "2026-09-20"
    d5 = tmp_path / "2026-09-21"
    d4.mkdir()
    d5.mkdir()
    _seams(d5, examined=50, name="Polar_H10_02849638_20260921040000")  # 04:00, in the band
    assert si.clocks(str(d4), "H10")["status"] == "PASS", "the morning folder's sidecar is this night's"


def test_AN_OPTIONAL_DEVICE_WITH_ONLY_OUT_OF_BAND_FILES_DID_NOT_CAPTURE(tmp_path):
    """§3.2: an optional backup counts only on a night it captured. Its daytime files are not that night,
    so a device that ran at noon and not at all overnight must not be expected of the night — it would
    then be scored, and score UNKNOWN, against a night it never joined."""
    nd = tmp_path / "2026-09-20"
    nd.mkdir()
    opt = [{"name": "Polar H10 02849638", "model": "H10", "optional": True}]
    (nd / "Polar_H10_02849638_20260920120000_ECG.txt").write_text("x")  # noon only
    assert si.expected_devices(str(nd), opt) == [], "a noon-only backup did not capture this night"
    (nd / "Polar_H10_02849638_20260920230000_ECG.txt").write_text("x")  # and now it did
    assert len(si.expected_devices(str(nd), opt)) == 1


def test_AN_OPTIONAL_DEVICE_THAT_ONLY_RAN_AFTER_MIDNIGHT_DID_CAPTURE(tmp_path):
    """The pooled half of the same rule: a backup brought in at 02:00 captured this night, and asking
    the judged folder alone would witness it as absent."""
    d4 = tmp_path / "2026-09-20"
    d5 = tmp_path / "2026-09-21"
    d4.mkdir()
    d5.mkdir()
    (d5 / "Polar_H10_02849638_20260921020000_ECG.txt").write_text("x")
    opt = [{"name": "Polar H10 02849638", "model": "H10", "optional": True}]
    assert len(si.expected_devices(str(d4), opt)) == 1


def test_THE_FILE_COUNT_IS_KEYED_BY_PREFIX_AND_BY_NAME(tmp_path):
    """`_scope_file_count` globs each model's PREFIX and keys the set on each file's BASENAME. Dropping
    the prefix would count every file in the folder — verdicts, audits, logs — and keying on anything
    constant would collapse them all to one."""
    nd = tmp_path / "2026-10-04"
    nd.mkdir()
    (nd / "Polar_H10_02849638_20261004220000_ECG.txt").write_text("x")
    (nd / "Polar_H10_02849638_20261004220000_ACC.txt").write_text("x")
    (nd / "SOLID-VERDICT.json").write_text("{}")  # not a capture file
    (nd / "watchdog.log").write_text("x")
    band = si.band_of(str(nd))
    assert si._scope_file_count(str(nd), band) == 2, "two capture files, and the verdict/log are not"


def test_A_NON_DATE_FOLDER_WITH_A_TRAILING_SLASH_STILL_FALLS_BACK_TO_ITSELF(tmp_path):
    """The `_scope_dirs` fallback runs only for an UNRESOLVED scope, so the trailing slash has to be
    stripped there too — otherwise the one folder it does read is spelled differently from every other
    path the judgement handles."""
    (tmp_path / "stored").mkdir()
    bare = str(tmp_path / "stored")
    assert si._scope_dirs(bare + "/") == [bare], "the fallback is the folder, without its slash"
    assert si._next_day_dir(bare + "/") is None


def test_THE_TRIPWIRE_FIRES_when_the_bound_is_crossed(tmp_path):
    """🔴 THE REFUSAL PATH, EXERCISED. Kestrel's ruling was "keep it, assert it" — but with the bound
    hard-coded the branch was unreachable, and an unreachable branch is one the mutation gate can neither
    kill nor excuse, so "asserted" would have been a word rather than a test. `max_dirs` is a parameter
    for exactly this: lowering it to 1 against a real two-folder scope fires the refusal.

    The bound stays 2 in production and is structural (a band touches two calendar dates), so nothing in
    the corpus can trip it — 111 night recordings, 61 in one folder, 50 in two, 0 in three."""
    d4, d5 = tmp_path / "2026-10-04", tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    ok = si.recording_scope(str(d4))
    assert ok["ok"] is True and len(ok["searched_dirs"]) == 2, "two folders, inside the real bound"

    tripped = si.recording_scope(str(d4), max_dirs=1)
    assert tripped["ok"] is False, "crossing the bound REFUSES"
    assert "would span 2 folders and the bound is 1" in tripped["reason"], tripped["reason"]
    assert "refusing rather than judging a truncated scope" in tripped["reason"]
    assert tripped["searched_dirs"] == ["2026-10-04", "2026-10-05"], "it still says what it saw"
    assert tripped["judged_dir"] == "2026-10-04"
    assert tripped["data_files"] == 0, "and claims no count it did not take"
    assert tripped["band"] is not None, "the band was resolvable; the SCOPE was not"
    assert "dirs" not in tripped, "a refused scope offers no folders to read"


def test_THE_PRODUCTION_BOUND_IS_TWO(tmp_path):
    """The default is the structural bound, so a caller that passes nothing gets it."""
    assert si.SCOPE_MAX_DIRS == 2
    d4, d5, d6 = tmp_path / "2026-10-04", tmp_path / "2026-10-05", tmp_path / "2026-10-06"
    for d in (d4, d5, d6):
        d.mkdir()
    sc = si.recording_scope(str(d4))
    assert sc["ok"] is True
    assert sc["searched_dirs"] == ["2026-10-04", "2026-10-05"], "never reaches a third, even when it exists"


def test_A_TRAILING_SLASH_GIVES_THE_SIBLING_not_a_child(tmp_path):
    """`os.path.dirname(night_dir.rstrip("/"))` — the rstrip is what makes dirname step UP. With
    `rstrip(None)` the slash stays, dirname returns the night itself, and the next day is looked for
    INSIDE it: `/x/2026-10-04/2026-10-05`. Asserting `endswith` could not see that; the full path can."""
    (tmp_path / "2026-10-04").mkdir()
    assert si._next_day_dir(str(tmp_path / "2026-10-04") + "/") == str(tmp_path / "2026-10-05")
    assert si._next_day_dir(str(tmp_path / "2026-10-04")) == str(tmp_path / "2026-10-05")


def test_A_MALFORMED_DEVICE_ENTRY_BEFORE_A_GOOD_ONE_DOES_NOT_HIDE_IT(tmp_path):
    """`continue` in `expected_devices`, not `break`: a config list may carry a stray non-dict entry, and
    stopping there would silently drop every device configured after it — the night would then be judged
    against fewer devices than it expected and could still PASS."""
    nd = tmp_path / "2026-09-20"
    nd.mkdir()
    devices = ["not-a-dict", {"name": "Polar H10 02849638", "model": "H10"}]
    got = si.expected_devices(str(nd), devices)
    assert [d["name"] for d in got] == ["Polar H10 02849638"], got


def test_A_STAMPLESS_FILE_IS_ADMITTED_rather_than_silently_dropped(tmp_path):
    """`in_band` returns True for a file carrying no start stamp. It is not this function's call to
    exclude one: a file with no start has no membership to judge, and dropping it here would remove it
    from the night without any reason being recorded (§∅)."""
    band = si.band_of(str(tmp_path / "2026-10-04"))
    assert si.in_band("Polar_H10_02849638_ECG.txt", band) is True, "no stamp, no exclusion"
    assert si.in_band("README.md", band) is True
    assert si.in_band("Polar_H10_02849638_20261004120000_ECG.txt", band) is False, "a stamp IS judged"


def test_CLOCKS_RTC_READS_ARE_BAND_FILTERED_AND_POOLED(tmp_path):
    """🔴 THE RING'S RTC PATH, which the suite reached only through a bare `tmp_path` where `band_of` is
    None and nothing filters. A daytime RTC read is not this night's clock comparison, and a read taken
    after midnight is."""
    d4, d5 = tmp_path / "2026-09-20", tmp_path / "2026-09-21"
    d4.mkdir()
    d5.mkdir()
    pref = "Wellue_O2Ring-S_S8AW2100"
    hdr = "Phone timestamp;event;rtc_offset_s\n"
    # only a NOON log: no comparison belonging to this night
    (d4 / f"{pref}_20260920120000_RTCLOG.csv").write_text(hdr + "t;read;0.4\n")
    assert si.clocks(str(d4), "O2Ring-S")["status"] == "UNKNOWN", "a daytime read is not this night's"
    assert "no device-vs-host clock comparison" in si.clocks(str(d4), "O2Ring-S")["reason"]
    # a read in the MORNING half, in the next folder, is this night's and decides it
    (d5 / f"{pref}_20260921040000_RTCLOG.csv").write_text(hdr + "t;read;0.5\n")
    assert si.clocks(str(d4), "O2Ring-S")["status"] == "PASS", "the morning folder's read counts"


def test_CLOCKS_RTC_NEEDS_A_READ_WITH_A_NUMBER(tmp_path):
    """A `read` row whose offset field is empty measured nothing — `float("")` raises and the scan keeps
    looking. The row's own columns are split on `;` after stripping only the NEWLINE: `rstrip(None)`
    would eat a trailing field's spaces and `lstrip` would leave the newline on the last column, so a
    one-column file would read as three."""
    nd = tmp_path / "2026-09-20"
    nd.mkdir()
    pref = "Wellue_O2Ring-S_S8AW2100"
    rtc = nd / f"{pref}_20260920230000_RTCLOG.csv"
    hdr = "Phone timestamp;event;rtc_offset_s\n"
    rtc.write_text(hdr + "t;push;\nt;read;\n")
    assert si.clocks(str(nd), "O2Ring-S")["status"] == "UNKNOWN", "a read with no offset measured nothing"
    rtc.write_text(hdr + "t;push;\nt;read;\nt;read;0.4\n")
    assert si.clocks(str(nd), "O2Ring-S")["status"] == "PASS", "and a later real read still decides it"
    # the last line without a trailing newline must parse the same as one with it
    rtc.write_text(hdr + "t;read;0.4")
    assert si.clocks(str(nd), "O2Ring-S")["status"] == "PASS"


def test_CLOCKS_RTC_DECODES_A_NON_UTF8_BYTE_rather_than_dying(tmp_path):
    """`encoding="utf-8", errors="replace"` on the RTC log, asserted in process. A capture sidecar is
    device bytes; the default `errors=None` is STRICT, and a `UnicodeDecodeError` is not caught here, so
    one bad byte would take the whole night's verdict instead of one unreadable line."""
    nd = tmp_path / "2026-09-20"
    nd.mkdir()
    rtc = nd / "Wellue_O2Ring-S_S8AW2100_20260920230000_RTCLOG.csv"
    with open(rtc, "wb") as fh:
        fh.write(b"Phone timestamp;event;rtc_offset_s\nt;read;\xff\xfe\nt;read;0.4\n")
    assert si.clocks(str(nd), "O2Ring-S")["status"] == "PASS", "an undecodable byte is a skipped row"


def test_CLOCKS_RTC_DECLARES_ITS_ENCODING_on_the_call(tmp_path):
    """And the call-site assertion, so the same sidecar reads identically on a C-locale box."""
    import subprocess
    import sys

    nd = tmp_path / "2026-09-20"
    nd.mkdir()
    (nd / "Wellue_O2Ring-S_S8AW2100_20260920230000_RTCLOG.csv").write_text(
        "Phone timestamp;event;rtc_offset_s\nt;read;0.4\n"
    )
    assert si.clocks(str(nd), "O2Ring-S")["status"] == "PASS"
    src = f"import solid_night_inputs as si\nassert si.clocks({str(nd)!r}, 'O2Ring-S')['status'] == 'PASS'\n"
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=os.path.dirname(os.path.abspath(si.__file__)),
    )
    assert r.returncode == 0, r.stderr


def test_THE_PRIMARY_STREAMS_EXTENSION_IS_NOT_EVERY_STREAMS(tmp_path):
    """`ext = spec["ext"] if stream == spec["primary"] else ".txt"` — the condition carries real weight
    on the ring, whose primary `SPO2` is a `.csv` while its waveforms are `.txt`. A mutant that makes the
    condition always true would look for `*_PPG.csv`, find nothing, and the device would read as no-wear
    or radio-down on a night it recorded perfectly."""
    nd = tmp_path / "2026-09-20"
    nd.mkdir()
    pref = "Wellue_O2Ring-S_S8AW2100_20260920230000"
    (nd / f"{pref}_SPO2.csv").write_text("x")  # the primary, a CSV
    (nd / f"{pref}_PPG.txt").write_text("x")  # a waveform, a TXT
    assert si.MODELS["O2Ring-S"]["ext"] == ".csv" and si.MODELS["O2Ring-S"]["primary"] == "SPO2"
    prim = si.stream_files(str(nd), "O2Ring-S", "SPO2")
    wave = si.stream_files(str(nd), "O2Ring-S", "PPG")
    assert [os.path.basename(p) for p in prim] == [f"{pref}_SPO2.csv"], prim
    assert [os.path.basename(p) for p in wave] == [f"{pref}_PPG.txt"], wave


# ── THE SEAM ACROSS FOLDERS (#3297 follow-on, briefs/RESIDUE.md 2026-10-05-cross-folder-continuity…) ──

_SEAM_HDR = "Phone timestamp;sensor timestamp [ns];x"


def _dual_stream(path, start, n, step_s=1.0, dev0_ns=0, dev_step_ns=None):
    """A stream carrying BOTH clocks, which is what separates a seam DELAY from a seam LOSS (#3157).

    `loss_audit.boundary_gap` reads the device counter across the boundary: a step under
    `DELAY_PERIODS * period` is late delivery, anything more is real loss. A host-only stream cannot tell
    them apart and every gap there stays a gap — the honest default, and not what this exercises."""
    dev_step_ns = int(step_s * 1e9) if dev_step_ns is None else dev_step_ns
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(_SEAM_HDR + "\n")
        for i in range(n):
            t = start + dt.timedelta(seconds=i * step_s)
            fh.write(f"{t.isoformat(timespec='milliseconds')};{dev0_ns + i * dev_step_ns};1\n")


def _seam_pair(tmp_path, *, gap_s, dev_advance_ns):
    """A cross-midnight recording in TWO folders with a planted seam, and both audits.

    The evening fragment ends at 23:50 in folder D; the morning fragment opens `gap_s` later in D+1,
    its counter advanced by `dev_advance_ns` from where the evening's left off. Neither audit can see
    this boundary — each judges only among its own files — which is the whole defect."""
    caps = tmp_path / "captures"
    d4 = caps / "2026-09-20"
    d5 = caps / "2026-09-21"
    d4.mkdir(parents=True)
    d5.mkdir(parents=True)
    ev_start = dt.datetime(2026, 9, 20, 23, 40, 0)
    n_ev = 600  # 23:40:00 -> 23:49:59 at 1 Hz
    _dual_stream(str(d4 / "Polar_H10_0284_20260920234000_ECG.txt"), ev_start, n_ev)
    (d4 / "Polar_H10_0284_20260920234000_HR.txt").write_text(
        "Phone timestamp;HR [bpm]\n" + ev_start.isoformat() + ";62\n"
    )
    last_host = ev_start + dt.timedelta(seconds=n_ev - 1)
    last_dev = (n_ev - 1) * int(1e9)
    mo_start = last_host + dt.timedelta(seconds=gap_s)
    _dual_stream(
        str(d5 / "Polar_H10_0284_20260921000000_ECG.txt"),
        mo_start,
        600,
        dev0_ns=last_dev + dev_advance_ns,
    )
    (d5 / "Polar_H10_0284_20260921000000_HR.txt").write_text(
        "Phone timestamp;HR [bpm]\n" + mo_start.isoformat() + ";61\n"
    )
    dev = [{"name": "Polar H10 0284", "model": "H10"}]
    a4 = _la.audit_night(str(d4), dev, journal=lambda *a, **k: [], clock_events=lambda *a, **k: [])
    a5 = _la.audit_night(str(d5), dev, journal=lambda *a, **k: [], clock_events=lambda *a, **k: [])
    return a4["devices"]["Polar H10 0284"], a5["devices"]["Polar H10 0284"]


def test_THE_AUDIT_PUBLISHES_PER_FILE_ENDPOINTS_on_both_clocks(tmp_path):
    """The additive half. These six fields are `boundary_gap`'s inputs and they existed only inside
    `stream_scan`; without them on the far side of the JSON a cross-folder seam cannot be judged at all."""
    ev, _mo = _seam_pair(tmp_path, gap_s=600.0, dev_advance_ns=int(600e9))
    f = next(x for x in ev["files"] if x.get("first") is not None)
    for k in ("first", "last", "first_dev", "last_dev", "period_ns", "cut"):
        assert k in f, f"{k} missing from the published files[] entry"
    assert f["first"] == "2026-09-20T23:40:00"
    assert f["last"] == "2026-09-20T23:49:59"
    assert f["last_dev"] > f["first_dev"] >= 0
    assert f["period_ns"] and f["period_ns"] > 0
    # ADDITIVE: the old keys are untouched, so every existing reader sees what it saw
    assert {"file", "span_min", "gaps", "delays"} <= set(f)


def test_A_PLANTED_SEAM_LOSS_IS_READ_AS_LOSS(tmp_path):
    """🔴 ACCEPTANCE 1. A ten-minute hole at the folder boundary, with the device counter advancing right
    across it — so the device really was recording elsewhere and the rows are gone. Neither folder's
    audit sees this: `loss_audit.stream_scan` says a gap BETWEEN files "is exactly the loss that made the
    night fragment", and across folders there is no single audit to notice it."""
    ev, mo = _seam_pair(tmp_path, gap_s=600.0, dev_advance_ns=int(600e9))
    assert ev["boundary_gaps"] == 0 and mo["boundary_gaps"] == 0, "neither audit saw it, which is the defect"
    rows, reason = si.seam_gap(ev, mo)
    assert reason is None, reason
    assert len(rows) == 1, rows
    assert rows[0]["seam"] is True
    assert abs(rows[0]["s"] - 600.0) < 1.5, rows[0]["s"]
    assert rows[0]["at"].startswith("2026-09-20T23:49:59")


def test_A_PLANTED_SEAM_DELAY_IS_NOT_A_LOSS(tmp_path):
    """🔴 ACCEPTANCE 2, and the control that makes acceptance 1 mean something (#3157). Same ten-minute
    HOST gap, but the device counter advanced by less than one sample period — the rows were delivered
    late, not lost. A merge that only summed host gaps would book this as ten minutes of loss."""
    ev, mo = _seam_pair(tmp_path, gap_s=600.0, dev_advance_ns=int(0.5e9))
    rows, reason = si.seam_gap(ev, mo)
    assert rows == [], f"a delay is not a loss: {rows}"
    assert reason is None, "it WAS judged — the silence is a measurement, not an absence"


def test_AN_OLDER_SHAPE_AUDIT_READS_NOT_ASSESSED_never_no_gaps(tmp_path):
    """🔴 ACCEPTANCE 3, and it is not hypothetical: the box runs behind `main` until the owner deploys,
    so tonight's audit may well be the older shape. A verdict must not read "no gaps at the seam" over an
    audit that cannot say — that is absence as a value (§∅), and it would publish a clean seam for a
    night nobody examined."""
    ev, mo = _seam_pair(tmp_path, gap_s=600.0, dev_advance_ns=int(600e9))
    old_ev = dict(ev, files=[{k: f[k] for k in ("file", "span_min", "gaps", "delays")} for f in ev["files"]])
    old_mo = dict(mo, files=[{k: f[k] for k in ("file", "span_min", "gaps", "delays")} for f in mo["files"]])
    rows, reason = si.seam_gap(old_ev, old_mo)
    assert rows == []
    assert reason is not None and si.SEAM_UNASSESSED in reason
    assert "written before #3297" in reason, "and it names WHY it cannot say"
    # the new-shape pair over the same data DOES read the loss — so the fallback is the audit's age, not the data
    assert len(si.seam_gap(ev, mo)[0]) == 1


def test_A_SEAM_WITH_NO_AUDIT_ON_ONE_SIDE_IS_NOT_ASSESSED(tmp_path):
    """One folder settled and the other not yet audited is the ordinary morning state. It is not a clean
    seam and it is not a loss; it is unexamined, with its own reason."""
    ev, _mo = _seam_pair(tmp_path, gap_s=600.0, dev_advance_ns=int(600e9))
    for other, why in ((None, "no audit entry"), ({}, "audited no file"), ({"files": []}, "audited no file")):
        rows, reason = si.seam_gap(ev, other)
        assert rows == [] and reason and si.SEAM_UNASSESSED in reason, (other, reason)
        assert why in reason, reason


def test_A_FILES_ENTRY_THAT_IS_NOT_AN_OBJECT_IS_SKIPPED(tmp_path):
    """`files[]` carries `unreadable` entries too, and a hand-edited or truncated audit can put anything
    there. One junk element must not decide the seam, nor raise while judging it."""
    ev, mo = _seam_pair(tmp_path, gap_s=600.0, dev_advance_ns=int(600e9))
    assert si._scan_shape("not-an-object") is None
    assert si._scan_shape(None) is None
    noisy = dict(ev, files=["junk", None, *ev["files"]])
    rows, reason = si.seam_gap(noisy, mo)
    assert reason is None and len(rows) == 1, (rows, reason)


def test_AN_UNPARSEABLE_ENDPOINT_IS_NOT_A_TIME(tmp_path):
    """The endpoint fields are ISO strings in the JSON, and a corrupt or hand-edited audit can carry
    something that is not one. `fromisoformat` raising means the file cannot say when it started — which
    is "not assessed", never a seam judged against a parsed-anyway default (§∅)."""
    ev, mo = _seam_pair(tmp_path, gap_s=600.0, dev_advance_ns=int(600e9))
    assert si._scan_shape({"first": "not-a-date", "last": "2026-09-20T23:49:59"}) is None
    assert si._scan_shape({"first": "2026-09-20T23:40:00", "last": 12345}) is None
    broken = dict(ev, files=[dict(f, last="23:49 on the dot") for f in ev["files"]])
    rows, reason = si.seam_gap(broken, mo)
    assert rows == []
    assert reason and "publishes no per-file endpoints" in reason


def test_A_MORNING_THAT_RESUMED_INSIDE_THE_CADENCE_HAS_NO_SEAM_GAP(tmp_path):
    """`boundary_gap` returns None when the next file opens within the stream's own cadence cut — the
    recording simply continued across the folder boundary. That is a JUDGED result and reports no row,
    which is different from a seam nobody could judge: `reason` stays None, so `continuity` reads a
    measurement rather than an absence."""
    ev, mo = _seam_pair(tmp_path, gap_s=1.0, dev_advance_ns=int(1e9))
    rows, reason = si.seam_gap(ev, mo)
    assert rows == [], rows
    assert reason is None, "judged and clean — not unassessed"


def test_THE_SAME_FILENAME_IN_BOTH_FOLDERS_IS_NOT_COUNTED_TWICE(tmp_path):
    """Identity is the FILENAME, and the merge dedupes on it. A filename carries its own 14-digit session
    start so a collision should not happen — but the archive mirror and a resumed writer have both put
    the same name in two places before, and double-counting a gap would inflate the loss."""
    d4, d5 = tmp_path / "2026-10-04", tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    row = {"at": "2026-10-04T23:00:00", "s": 12.0, "file": "same.txt"}
    (d4 / si.LOSS_AUDIT_NAME).write_text(json.dumps({"journal": "ok", "devices": {"H10": {"gaps": [row]}}}))
    (d5 / si.LOSS_AUDIT_NAME).write_text(json.dumps({"devices": {"H10": {"gaps": [dict(row)]}}}))
    merged = si._pooled_audit(str(d4))["devices"]["H10"]["gaps"]
    assert len(merged) == 1, f"one file, one row: {merged}"
    assert "folder" not in merged[0], "the kept row is the judged folder's own"


def _audit_json(path, dev, files, gaps):
    """A LOSS-AUDIT.json in the published shape, for driving `_pooled_audit` over two real folders."""
    path.write_text(json.dumps({"journal": "ok", "devices": {dev: {"files": files, "gaps": gaps}}}))


def test_THE_POOLED_AUDIT_CARRIES_THE_SEAM_ROW_INTO_THE_MERGED_GAPS(tmp_path):
    """The call site, not just the function. `seam_gap` is tested directly above; this proves
    `_pooled_audit` actually hands it BOTH audits — passing either side as None would quietly drop the
    seam from a night that has one, and the merged list would look clean."""
    d4, d5 = tmp_path / "2026-10-04", tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    dev = "H10"
    ev_files = [
        {
            "file": "ev.txt",
            "span_min": 10.0,
            "gaps": 0,
            "delays": 0,
            "first": "2026-10-04T23:40:00",
            "last": "2026-10-04T23:49:59",
            "first_dev": 0,
            "last_dev": 599_000_000_000,
            "period_ns": 1_000_000_000,
            "cut": 5.0,
        }
    ]
    mo_files = [
        {
            "file": "mo.txt",
            "span_min": 10.0,
            "gaps": 0,
            "delays": 0,
            "first": "2026-10-05T00:00:00",
            "last": "2026-10-05T00:09:59",
            "first_dev": 1_199_000_000_000,
            "last_dev": 1_798_000_000_000,
            "period_ns": 1_000_000_000,
            "cut": 5.0,
        }
    ]
    _audit_json(d4 / si.LOSS_AUDIT_NAME, dev, ev_files, [])
    _audit_json(d5 / si.LOSS_AUDIT_NAME, dev, mo_files, [])
    bd = si._pooled_audit(str(d4))["devices"][dev]
    seams = [r for r in bd["gaps"] if r.get("seam")]
    assert len(seams) == 1, bd["gaps"]
    assert abs(seams[0]["s"] - 601.0) < 2.0, seams[0]["s"]
    assert bd["seam_unassessed"] is None, "it WAS assessed"


def test_THE_MERGED_GAPS_ARE_ORDERED_BY_TIME_THEN_BY_SIZE(tmp_path):
    """The sort key, both components. Rows arrive from two folders plus the seam, so the merged list has
    no natural order — and a reader of `gaps` takes the first row as the night's first hole. Two rows at
    the SAME stamp are what separate the size tiebreak from a constant: with `and 0.0` or a fixed `1.0`
    every row's second key is equal and the tie falls back to insertion order, which is the folder the
    row happened to come from."""
    d4, d5 = tmp_path / "2026-10-04", tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    dev = "H10"
    same = "2026-10-04T23:00:00"
    # deliberately OUT of order on arrival, and two rows share a stamp
    ev_gaps = [{"at": "2026-10-04T23:30:00", "s": 5.0, "file": "ev2.txt"}, {"at": same, "s": 30.0, "file": "ev1.txt"}]
    mo_gaps = [{"at": same, "s": 7.0, "file": "mo1.txt"}]
    _audit_json(d4 / si.LOSS_AUDIT_NAME, dev, [], ev_gaps)
    _audit_json(d5 / si.LOSS_AUDIT_NAME, dev, [], mo_gaps)
    rows = si._pooled_audit(str(d4))["devices"][dev]["gaps"]
    assert [r["file"] for r in rows] == ["mo1.txt", "ev1.txt", "ev2.txt"], rows
    assert [r["s"] for r in rows] == [7.0, 30.0, 5.0], "same stamp orders by SIZE, smallest first"
    assert rows[0]["at"] == same and rows[-1]["at"] == "2026-10-04T23:30:00"


def test_A_GAP_ROW_WITH_NO_SIZE_SORTS_BEFORE_ONE_THAT_HAS_ONE(tmp_path):
    """`r.get("s") or 0.0` — the fallback is 0.0 so a row with no size, or a zero one, sorts first rather
    than being handed an invented magnitude. `r.get(None)` would read no size at all and collapse the
    tiebreak for every row.

    ⚠️ THE SIZE HAS TO BE SUB-SECOND for the fallback's VALUE to be observable. With a 4.0 s gap the
    sizeless row sorts first whether the fallback is 0.0 or 1.0, so the assertion holds either way and
    says nothing; 0.5 s sits between them and the order flips. Sub-second gaps are ordinary in a real
    audit, so this is the fixture being realistic rather than contrived."""
    # TWO folders, because the merge and its sort only run when there is something to merge —
    # `_pooled_audit` returns the judged folder's audit untouched when it stands alone, which is the
    # right behaviour and also means a one-folder fixture never reaches this code at all.
    d4, d5 = tmp_path / "2026-10-04", tmp_path / "2026-10-05"
    d4.mkdir()
    d5.mkdir()
    dev = "H10"
    same = "2026-10-04T23:00:00"
    _audit_json(d4 / si.LOSS_AUDIT_NAME, dev, [], [{"at": same, "s": 0.5, "file": "a.txt"}])
    _audit_json(d5 / si.LOSS_AUDIT_NAME, dev, [], [{"at": same, "file": "b.txt"}])
    rows = si._pooled_audit(str(d4))["devices"][dev]["gaps"]
    assert [r["file"] for r in rows] == ["b.txt", "a.txt"], rows
    assert "s" not in rows[0], "the sizeless row keeps its absence — no invented magnitude (§∅)"
    assert rows[1]["s"] == 0.5, "and the sub-second gap it sorts before keeps its own size"


def _ep(file, first, last, first_dev, last_dev, period_ns=1_000_000_000, cut=5.0):
    """One published `files[]` entry carrying endpoints, for driving `seam_gap` directly."""
    return {
        "file": file,
        "span_min": 10.0,
        "gaps": 0,
        "delays": 0,
        "first": first,
        "last": last,
        "first_dev": first_dev,
        "last_dev": last_dev,
        "period_ns": period_ns,
        "cut": cut,
    }


def test_AN_ENTRY_MISSING_EITHER_ENDPOINT_CANNOT_SAY(tmp_path):
    """`"first" not in entry OR "last" not in entry` — either one absent is enough. With `and`, a
    half-written entry (one key present) would be read as an endpoint pair and the seam judged against a
    `None` the code then treats as a time."""
    full = _ep("f.txt", "2026-10-04T23:40:00", "2026-10-04T23:49:59", 0, 599_000_000_000)
    assert si._scan_shape(full) is not None
    assert si._scan_shape({k: v for k, v in full.items() if k != "last"}) is None, "no `last`"
    assert si._scan_shape({k: v for k, v in full.items() if k != "first"}) is None, "no `first`"
    assert si._scan_shape({k: v for k, v in full.items() if k not in ("first", "last")}) is None


def test_AN_ENDPOINT_PUBLISHED_AS_NULL_IS_NOT_A_TIME(tmp_path):
    """`_iso` writes `null` for a file that carried neither a stamp nor a counter, so the consumer must
    read that as absence — the guard before `fromisoformat` is what keeps `None` from being parsed. The
    entry still has both KEYS, so this is a different case from the one above: present and empty."""
    sc = si._scan_shape(_ep("f.txt", None, None, None, None))
    assert sc is not None, "the keys are there, so the entry is the new shape"
    assert sc["first"] is None and sc["last"] is None, "and its endpoints stay absent"
    # a side with no usable endpoint cannot anchor the seam
    ev = {"files": [_ep("ev.txt", None, None, None, None)]}
    mo = {"files": [_ep("mo.txt", "2026-10-05T00:00:00", "2026-10-05T00:09:59", 1_199_000_000_000, 1_798_000_000_000)]}
    rows, reason = si.seam_gap(ev, mo)
    assert rows == [] and reason and si.SEAM_UNASSESSED in reason


def test_THE_SEAM_IS_ANCHORED_ON_THE_LATEST_EVENING_FILE_AND_THE_EARLIEST_MORNING_ONE(tmp_path):
    """`max(pv, key=last)` and `min(nx, key=first)` — the files are NOT in order in `files[]`, and a
    recording's own fragments overlap in name order. Picking the wrong end moves the boundary: anchoring
    on an earlier evening file would invent a gap that spans a fragment that was recording."""
    ev = {
        "files": [
            _ep("ev_late.txt", "2026-10-04T23:40:00", "2026-10-04T23:49:59", 0, 599_000_000_000),
            _ep("ev_early.txt", "2026-10-04T22:00:00", "2026-10-04T22:09:59", 0, 599_000_000_000),
        ]
    }
    mo = {
        "files": [
            _ep("mo_late.txt", "2026-10-05T03:00:00", "2026-10-05T03:09:59", 1_199_000_000_000, 1_798_000_000_000),
            _ep("mo_early.txt", "2026-10-05T00:00:00", "2026-10-05T00:09:59", 1_199_000_000_000, 1_798_000_000_000),
        ]
    }
    rows, reason = si.seam_gap(ev, mo)
    assert reason is None
    assert len(rows) == 1, rows
    # 23:49:59 -> 00:00:00 is 601 s. Anchoring on ev_early (22:09:59) or mo_late (03:00) gives a very
    # different number, which is what makes the two key functions observable at all.
    assert abs(rows[0]["s"] - 601.0) < 2.0, rows[0]["s"]
    assert rows[0]["at"].startswith("2026-10-04T23:49:59")


def test_THE_CADENCE_CUT_IS_READ_FROM_THE_AUDIT_not_assumed(tmp_path):
    """`entry.get("cut") or 0.0`. `boundary_gap` returns no gap when the next file resumed INSIDE the
    previous one's cadence, and the cut is how wide that is — a per-stream fact the audit measured. A
    fallback of 1.0, or reading no cut at all, would either invent a seam inside the cadence or swallow
    one just outside it."""
    base = dict(first="2026-10-04T23:49:59", last="2026-10-04T23:49:59")
    # a 3 s seam: inside a 5 s cut (no gap), outside a 0 s one (a gap)
    ev_wide = {"files": [_ep("ev.txt", base["first"], base["last"], 0, 0, cut=5.0)]}
    ev_zero = {"files": [_ep("ev.txt", base["first"], base["last"], 0, 0, cut=0.0)]}
    mo = {"files": [_ep("mo.txt", "2026-10-04T23:50:02", "2026-10-05T00:00:00", 10_000_000_000, 20_000_000_000)]}
    assert si.seam_gap(ev_wide, mo) == ([], None), "3 s is inside a 5 s cadence: judged, no gap"
    rows, reason = si.seam_gap(ev_zero, mo)
    assert reason is None and len(rows) == 1, (rows, reason)
    assert abs(rows[0]["s"] - 3.0) < 0.5, rows[0]["s"]
    # AND AN ENTRY WITH NO CUT FALLS BACK TO 0.0, NOT TO A MADE-UP WIDTH — which only a SUB-SECOND seam
    # can show. A 3 s gap clears both 0.0 and 1.0, so it holds under either and proves nothing; 0.5 s
    # sits between them, so a fallback of 1.0 would swallow a real seam as "inside the cadence". Same
    # shape as the sort tiebreak in this file: a fixture has to straddle the values it is distinguishing.
    ev_none = {"files": [{k: v for k, v in _ep("ev.txt", base["first"], base["last"], 0, 0).items() if k != "cut"}]}
    near = {"files": [_ep("mo.txt", "2026-10-04T23:50:00", "2026-10-05T00:00:00", 10_000_000_000, 20_000_000_000)]}
    rows_near, reason_near = si.seam_gap(ev_none, near)
    assert reason_near is None
    assert len(rows_near) == 1, f"a 0.5 s seam with no stated cut is a seam: {rows_near}"
    assert abs(rows_near[0]["s"] - 1.0) < 0.6, rows_near[0]["s"]
    assert len(si.seam_gap(ev_none, mo)[0]) == 1, "and the 3 s seam too"


# ── §3.4 `rtc` — the ring's own RTC, judged against the host that disciplines it ────────────────────
#
# Every bound these tests exercise is PRE-STATED from the mirror (620 logs, 181 nights, 2883 reads,
# measured 2026-10-04 before any night was judged) and quoted beside the constants in the module. The
# plant is 2026-10-04's own log shape; the controls are synthetic, because the mirror holds no night
# labelled bad and a reset has never happened in it.


def _rtclog(d, rows, name=RING_BASE):
    """An RTC log in the writer's own layout: `Phone timestamp;event;rtc_offset_s;battery_*`.

    `rows` is [(seconds_from_T0, event, offset_or_None)]. The ring writes ONE LOG PER CAPTURE SESSION,
    so a night can hold hundreds — `rtc_events` reads them all and this helper can be called repeatedly
    with different `name`s to build that shape."""
    out = ["Phone timestamp;event;rtc_offset_s;battery_state;battery_level;battery_raw2;battery_raw3"]
    for sec, ev, off in rows:
        t = T0 + dt.timedelta(seconds=sec)
        o = "" if off is None else f"{off:.1f}"
        out.append(f"{t.isoformat(timespec='milliseconds')};{ev};{o};;;;")
    (d / f"{name}_RTCLOG.csv").write_text("\n".join(out) + "\n")


def _rtc(d, rows, **kw):
    _rtclog(d, rows, **kw)
    return si.rtc_band(str(d), "O2Ring-S", T0, T0 + dt.timedelta(hours=8))


def test_the_RTC_BAND_is_NOT_APPLICABLE_for_a_device_that_keeps_no_RTC_LOG(tmp_path):
    """A Polar is disciplined nowhere and logs nothing, so the band was examined and the rule does not
    bind — NOT_APPLICABLE with its reason, never UNKNOWN. UNKNOWN would say "we could not tell" about a
    device that has nothing to tell."""
    out = si.rtc_band(str(tmp_path), "H10", T0, T0 + dt.timedelta(hours=8))
    assert out == {"status": "NOT_APPLICABLE", "reason": si.NO_RTC_LOG}


def test_a_RING_NIGHT_WITH_NO_RTC_LOG_is_UNKNOWN_not_inapplicable(tmp_path):
    """§∅ and the distinction the two words carry: the ring's spec NAMES an RTC log, so on a night that
    holds none the rule binds and the input is absent. Collapsing this into NOT_APPLICABLE would
    publish "does not apply" about a clock we simply failed to record."""
    out = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(hours=8))
    assert out["status"] == "UNKNOWN", out
    assert "never read" in out["reason"], out["reason"]


def test_THE_10_04_PLANT_a_disciplined_ring_night_PASSES_and_states_its_population(tmp_path):
    """🔴 2026-10-04's own shape: 4 pushes, 43 reads, −1.1 → −0.6 s, 0 resets, a 10 min poll. It PASSES,
    and the reason STATES what was checked and what was set aside — the population is part of the
    verdict, not a footnote (§🧾 `checked + excluded = eligible`)."""
    rows = [(0.0, "push", None)]
    for i in range(43):
        # the 10 min poll the mirror measured (p50 600.4 s), drifting −1.1 → −0.6 across the night
        rows.append((120.0 + i * 600.0, "read", -1.1 + 0.5 * i / 42))
    for k in range(1, 4):
        rows.append((k * 7000.0, "push", None))
    out = _rtc(tmp_path, rows)
    assert out["status"] == "PASS", out
    assert "read(s) checked" in out["reason"], out["reason"]
    assert "set aside within 60 s of a push" in out["reason"]
    assert "drift" in out["reason"]


def test_a_RESET_FAILS_the_band_and_names_what_it_cost(tmp_path):
    """A reset means the disciplined time was LOST, so no offset after it describes the clock we set.
    ⚠️ SYNTHETIC BY NECESSITY: the mirror holds ZERO resets in 620 logs, so this arm has never fired on
    real data. The band says so in its own comment rather than let a FAIL imply otherwise."""
    rows = [(0.0, "push", None), (120.0, "read", -0.5), (3000.0, "reset", None), (3600.0, "read", -0.4)]
    out = _rtc(tmp_path, rows)
    assert out["status"] == "FAIL", out
    assert "RESET 1 time(s)" in out["reason"], out["reason"]
    assert "disciplined time was lost" in out["reason"]


def test_an_OFFSET_PAST_THE_BOUND_fails_and_the_bound_is_the_CLEAR_read_population(tmp_path):
    """The bound is 8.0 s, measured over the 2788 CLEAR reads the band actually judges (p99.9 6.1, max
    6.3) and set above all of them — so a FAIL means something the mirror has never shown. A5's
    precedent: a detector with no validated positive reports, it does not convict on a tail.

    ⚠️ 2026-08-30's worst clear read is 6.3 s and 2026-08-29's is 5.1, so an earlier 5.0 bound failed
    2 of 44 real nights. Those numbers stay VISIBLE in the PASS reason instead."""
    rows = [(0.0, "push", None), (600.0, "read", -0.5), (1200.0, "read", -9.4), (1800.0, "read", -0.6)]
    out = _rtc(tmp_path, rows)
    assert out["status"] == "FAIL", out
    assert "-9.4 s off the host" in out["reason"], out["reason"]
    assert "past the 8.0 s bound" in out["reason"]


def test_the_SAME_OFFSET_INSIDE_THE_PUSH_WINDOW_is_SET_ASIDE_not_failed(tmp_path):
    """🔴 THE MEASUREMENT THAT DEFINES THIS BAND. The identical −9.4 s read, moved to 3 s after a push,
    must NOT fail the night: binned by seconds since the last push the mirror gives 2–5 s a |offset| p50
    of 5.90 and a max of 11.9 against 0.40 and 1.9 beyond an hour, so a read there is measuring the push
    sequence — a half-applied time — and not the clock. Judging it would convict the ring for the
    daemon's own read timing, and the count set aside is stated rather than hidden."""
    rows = [(0.0, "push", None), (3.0, "read", -9.4), (600.0, "read", -0.5), (1200.0, "read", -0.6)]
    out = _rtc(tmp_path, rows)
    assert out["status"] == "PASS", out
    assert "1 set aside within 60 s of a push" in out["reason"], out["reason"]
    assert "2 read(s) checked" in out["reason"]


def test_a_SHORT_SPAN_reports_DRIFT_AS_NULL_and_says_what_it_could_not_resolve(tmp_path):
    """§∅ against a RESOLUTION rather than a coverage gap. The log records `rtc_offset_s` to 0.1 s, so
    the drift floor is `0.1 / span`: over 20 min that is 83 ppm against a 100 ppm bound, and a figure
    there would be the log's resolution rather than the crystal. The band says null AND names the floor,
    so a reader can see why — a number would be absence-as-value in reverse."""
    rows = [(0.0, "push", None), (600.0, "read", -0.5), (1800.0, "read", -0.6)]
    out = _rtc(tmp_path, rows)
    assert out["status"] == "PASS", out
    assert "drift null" in out["reason"], out["reason"]
    assert "resolves only" in out["reason"]
    assert "0.1 s resolution" in out["reason"]


def test_a_LONG_SPAN_reports_A_DRIFT_FIGURE_because_the_span_resolves_it(tmp_path):
    """The other side: over 8 h the floor is 3.5 ppm, which resolves the 100 ppm bound 28 times over, so
    the figure is the crystal and is published. The mirror's spans > 4 h measured p50 26.3 ppm."""
    rows = [(0.0, "push", None), (600.0, "read", -1.1)]
    rows += [(600.0 + i * 600.0, "read", -1.1 + 0.4 * i / 47) for i in range(1, 48)]
    out = _rtc(tmp_path, rows)
    assert out["status"] == "PASS", out
    assert "ppm over" in out["reason"], out["reason"]
    assert "null" not in out["reason"]


def test_A_READ_GAP_OVER_THE_WORN_INTERVAL_is_NAMED_in_the_coverage(tmp_path):
    """A window nobody read is reported, not glossed: the mirror's cadence is a 10 min poll (p99 606 s,
    max 761), so a stretch past `RTC_READ_GAP_MAX_S` is a window the band cannot speak for. It does not
    fail the night — the reads it HAS are still inside the bound — and saying so is the half of §∅ that
    annotates."""
    rows = [(0.0, "push", None), (600.0, "read", -0.5), (9000.0, "read", -0.6), (9600.0, "read", -0.6)]
    out = _rtc(tmp_path, rows)
    assert out["status"] == "PASS", out
    assert "longest unread stretch" in out["reason"], out["reason"]
    assert "140 min" in out["reason"], out["reason"]


def test_EVERY_SESSION_LOG_IS_READ_because_the_ring_writes_one_per_session(tmp_path):
    """2026-08-29 holds 290 RTC logs against a median night's 3 — one per capture session — so a band
    reading a single file is not reading the night. The reset below sits in the SECOND log: a reader that
    stopped at the first would pass the night."""
    _rtclog(tmp_path, [(0.0, "push", None), (600.0, "read", -0.5)], name=RING_BASE)
    _rtclog(tmp_path, [(3000.0, "reset", None)], name="Wellue_O2Ring-S_S8AW2100_20260920234000")
    out = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(hours=8))
    assert out["status"] == "FAIL", out
    assert "RESET" in out["reason"]
    assert len(si.rtc_events(str(tmp_path), "O2Ring-S")) == 3, "both logs were read"


def test_RTC_EVENTS_FOR_A_DEVICE_THAT_LOGS_NONE_IS_EMPTY_not_a_crash(tmp_path):
    """`MODELS[model]["rtc"] is None` — a Polar keeps no RTC log, and asking for its events must return
    an empty list rather than globbing for a tag that does not exist. `rtc_band` short-circuits to
    NOT_APPLICABLE before reaching here, so this is the direct call: the function is exported and a
    caller may reasonably ask the question of any model."""
    assert si.MODELS["H10"]["rtc"] is None
    assert si.rtc_events(str(tmp_path), "H10") == []


def test_AN_UNOPENABLE_RTC_LOG_IS_SKIPPED_and_the_rest_are_read(tmp_path):
    """A log we cannot open records nothing, and it must not take the night's other logs with it. A
    directory where a file should be is the shape that reproduces without permissions games."""
    good = f"{RING_BASE}_RTCLOG.csv"
    (tmp_path / good).write_text("Phone timestamp;event;rtc_offset_s\n2026-09-20T23:00:01;read;0.4\n")
    (tmp_path / "Wellue_O2Ring-S_S8AW2100_20260920233000_RTCLOG.csv").mkdir()  # a dir, not a file
    ev = si.rtc_events(str(tmp_path), "O2Ring-S")
    assert len(ev) == 1 and ev[0][1] == "read", ev


def test_AN_RTC_ROW_WITH_NO_PLACEABLE_STAMP_PLACES_NO_EVENT(tmp_path):
    """An unplaceable stamp cannot be ordered against the worn interval, so the row is dropped rather
    than given a default time (§∅ — a fabricated stamp is worse than a missing row)."""
    (tmp_path / f"{RING_BASE}_RTCLOG.csv").write_text(
        "Phone timestamp;event;rtc_offset_s\nnot-a-stamp;read;0.4\n;read;0.5\n2026-09-20T23:00:01;read;0.6\n"
    )
    ev = si.rtc_events(str(tmp_path), "O2Ring-S")
    assert len(ev) == 1, ev
    assert ev[0][2] == 0.6


def test_AN_RTC_READ_WITH_NO_OFFSET_MEASURED_NOTHING(tmp_path):
    """A `read` row whose offset field will not parse measured nothing and is dropped, never defaulted
    to 0.0 — a zero offset is the claim "the RTC agreed exactly", which is the opposite of silence."""
    (tmp_path / f"{RING_BASE}_RTCLOG.csv").write_text(
        "Phone timestamp;event;rtc_offset_s\n"
        "2026-09-20T23:00:01;read;\n"
        "2026-09-20T23:00:02;read;not-a-number\n"
        "2026-09-20T23:00:03;read;0.7\n"
        "2026-09-20T23:00:04;push;\n"
    )
    ev = si.rtc_events(str(tmp_path), "O2Ring-S")
    kinds = [k for _t, k, _v in ev]
    assert kinds == ["read", "push"], ev
    assert ev[0][2] == 0.7, "only the parseable read survives"
    assert ev[1][2] is None, "a push carries no offset, and None is not 0.0"


def test_THE_RTC_BAND_WITH_NO_WORN_INTERVAL_IS_UNKNOWN(tmp_path):
    """`start is None` — with no worn interval there is no stretch of the night to judge the RTC over,
    so the band reports the absence with its own reason instead of judging every read ever logged."""
    _rtclog(tmp_path, [(1, "read", 0.4)])  # the helper takes SECONDS from T0 and a numeric offset
    out = si.rtc_band(str(tmp_path), "O2Ring-S", None, None)
    assert out["status"] == "UNKNOWN"
    assert "no worn interval" in out["reason"], out["reason"]


def test_EVERY_READ_SITTING_NEXT_TO_A_PUSH_IS_UNKNOWN_not_a_pass(tmp_path):
    """🔴 THE 2–5 s POST-PUSH ARTEFACT, which is why this branch exists. Measured over the mirror
    (620 logs, 2883 reads): binned by seconds since the last push, 0–2 s gives p50 0.80 s and 2–5 s
    gives p50 5.90 s with a max of 11.9 s, while >60 s clear of a push gives p99 1.6 s and a max of
    3.3 s over 2184 reads. So a read taken mid-push sequence reports a half-applied time and is NOT
    evidence about the clock. If every read this night sits inside the settle window the band has
    nothing clear to judge — UNKNOWN with the excluded count, never a PASS on the artefact."""
    rows = [(0, "push", None)] + [(i, "read", 5.9) for i in range(1, 5)]
    out = _rtc(tmp_path, rows)
    assert out["status"] == "UNKNOWN", out
    assert f"{si.RTC_PUSH_SETTLE_S:.0f} s" in out["reason"], out["reason"]
    assert "4 read" in out["reason"], "the excluded population is STATED, not implied"


def test_A_DRIFT_PAST_THE_CRYSTAL_BOUND_FAILS_and_quotes_the_span(tmp_path):
    """The drift FAIL arm. The bound is `RTC_DRIFT_MAX_PPM` and it is only applied when the span RESOLVES
    it — the log records `rtc_offset_s` to 0.1 s, so a ppm figure over a short span is the log's own
    resolution and not the crystal (measured: spans > 0.2 h give |ppm| p50 83.3 against a floor of
    166.7, so the median is BELOW the floor). A FAIL here must quote the span it was measured over."""
    # nine hourly reads walking 1.2 s per hour ~= 333 ppm, well past RTC_DRIFT_MAX_PPM, over a span
    # long enough to RESOLVE it against the log's own 0.1 s quantum
    # ⚠️ SYMMETRIC ABOUT ZERO, and it has to be: walking 0.5 → +10.1 s trips the 8.0 s OFFSET bound
    # first and the band never reaches the drift arm (measured — the reason read "past the 8.0 s
    # bound"). Here |offset| peaks at 3.2 s, well inside the bound, while the SPAN is 6.4 s over 8 h
    # = ~222 ppm, past RTC_DRIFT_MAX_PPM. Two bounds in one function, and a fixture must clear the
    # first to exercise the second.
    rows = [(h * 3600, "read", -3.2 + h * 0.8) for h in range(9)]
    _rtclog(tmp_path, rows)
    out = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(hours=9))
    assert out["status"] == "FAIL", out
    assert "ppm" in out["reason"] and "h" in out["reason"], out["reason"]


def test_THE_DRIFT_ARITHMETIC_IS_PINNED_TO_EXACT_PPM(tmp_path):
    """🔴 THE VALUES, NOT THE RENDERED TEXT. `rtc_band` only ever exposed these as `f"{ppm:+.0f}"`, so a
    test could assert the sentence and still miss an index substitution worth less than half a ppm — 28
    mutants of this arithmetic survived a suite at 100 % line coverage for that reason. Every number here
    is computed from the PRE-STATED constants (`RTC_OFFSET_QUANTUM_S` = 0.1 s, `RTC_DRIFT_MAX_PPM` = 100,
    `RTC_DRIFT_RESOLVE` = 4) and the mirror's own 600 s read cadence, not read back from the code."""
    t0 = dt.datetime(2026, 9, 20, 22, 0, 0)
    # 8 h at the mirror's 600 s cadence = 49 reads; offsets walk -3.2 → +3.2 s
    span_s = 8 * 3600.0
    clear = [(t0 + dt.timedelta(seconds=i * 600), -3.2 + i * (6.4 / 48)) for i in range(49)]
    ppm, floor_ppm, resolved = si.rtc_drift(clear, span_s)
    # ppm = (last - first) / span * 1e6 = 6.4 s / 28800 s = 222.222… ppm, EXACTLY
    assert abs(ppm - (6.4 / span_s * 1e6)) < 1e-9, ppm
    assert abs(ppm - 222.2222222222222) < 1e-9, ppm
    # floor = the log's 0.1 s quantum over the same span = 3.4722… ppm
    assert abs(floor_ppm - (0.1 / span_s * 1e6)) < 1e-9, floor_ppm
    assert abs(floor_ppm - 3.4722222222222223) < 1e-9, floor_ppm
    # resolved when floor x RESOLVE <= MAX: 3.47 x 4 = 13.9 <= 100
    assert resolved is True
    assert floor_ppm * si.RTC_DRIFT_RESOLVE <= si.RTC_DRIFT_MAX_PPM

    # THE FIRST AND LAST READ ARE THE ENDPOINTS — not the second, not the penultimate. Each index
    # substitution the gate tried moves ppm by exactly one step of the walk, 6.4/48 s over the span.
    one_step = (6.4 / 48) / span_s * 1e6
    assert abs(one_step - 4.6296296296296298) < 1e-9, one_step
    assert abs(si.rtc_drift(clear[:-1], span_s)[0] - (ppm - one_step)) < 1e-9, "dropping the LAST read"
    assert abs(si.rtc_drift(clear[1:], span_s)[0] - (ppm - one_step)) < 1e-9, "dropping the FIRST read"


def test_A_SPAN_TOO_SHORT_TO_RESOLVE_PUBLISHES_NO_DRIFT(tmp_path):
    """The floor is the point of the band's drift term: below `RTC_DRIFT_RESOLVE` x the bound the figure
    would be the log's resolution and not the crystal, so `resolved` is False and the band quotes no
    number. Measured over the mirror: spans > 0.2 h give |ppm| p50 83.3 against a floor of 166.7 — the
    median below its own floor, which is why a number there is absence-as-value in reverse."""
    t0 = dt.datetime(2026, 9, 20, 22, 0, 0)
    # the mirror's measured case: 0.2 h span → floor 0.1/720*1e6 = 138.9 ppm, x4 = 555 > 100
    span_s = 0.2 * 3600.0
    clear = [(t0, 0.4), (t0 + dt.timedelta(seconds=span_s), 0.5)]
    ppm, floor_ppm, resolved = si.rtc_drift(clear, span_s)
    assert abs(floor_ppm - 138.88888888888889) < 1e-9, floor_ppm
    assert resolved is False, "138.9 x 4 = 555.6 ppm, far past the 100 ppm bound"
    assert ppm is not None, "the figure is COMPUTED; `resolved` is what decides whether it is published"
    # and the boundary of resolvability itself: floor x RESOLVE == MAX exactly
    exact = si.RTC_OFFSET_QUANTUM_S / (si.RTC_DRIFT_MAX_PPM / si.RTC_DRIFT_RESOLVE / 1e6)
    assert (
        abs(
            si.rtc_drift([(t0, 0.0), (t0 + dt.timedelta(seconds=exact), 0.0)], exact)[1] * si.RTC_DRIFT_RESOLVE
            - si.RTC_DRIFT_MAX_PPM
        )
        < 1e-6
    )
    assert si.rtc_drift([(t0, 0.0), (t0 + dt.timedelta(seconds=exact), 0.0)], exact)[2] is True, "<= is inclusive"


def test_A_ZERO_LENGTH_SPAN_HAS_NO_DRIFT_AT_ALL(tmp_path):
    """`span_s <= 0` — one read, or every read at the same instant, divides by zero. The answer is three
    absences, never a zero drift: "the clock did not drift" is a claim and this is silence."""
    t0 = dt.datetime(2026, 9, 20, 22, 0, 0)
    assert si.rtc_drift([(t0, 0.4)], 0.0) == (None, None, False)
    assert si.rtc_drift([(t0, 0.4), (t0, 0.9)], 0.0) == (None, None, False)
    assert si.rtc_drift([], -1.0) == (None, None, False)


def test_THE_READ_WINDOW_AND_THE_PUSH_SETTLE_BOUNDS_ARE_INCLUSIVE_EXACTLY(tmp_path):
    """The two boundary tests in `rtc_band`, pinned by POPULATION COUNTS rather than by prose: a read
    exactly ON the worn interval's edge is IN (`start <= t <= end`), and a read exactly
    `RTC_PUSH_SETTLE_S` after a push is SET ASIDE (`> RTC_PUSH_SETTLE_S` is strict, so equality is not
    clear). The counts are integers and exact, so an off-by-one in either bound moves them by one."""
    settle = int(si.RTC_PUSH_SETTLE_S)
    # a push at T0, then reads at exactly +settle (NOT clear) and +settle+1 (clear); plus reads exactly
    # on the interval's start and end
    rows = [(0, "push", None), (settle, "read", 0.4), (settle + 1, "read", 0.5), (8 * 3600, "read", 0.6)]
    _rtclog(tmp_path, rows)
    out = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(hours=8))
    # THREE reads are inside [start, end] inclusive (the last sits exactly ON `end`), ONE of them is
    # within the settle window, so `checked` is the CLEAR population: 2 checked + 1 excluded = 3
    # eligible, which is §🧾's `checked + excluded = eligible` on this band. ⚠️ I first asserted
    # "3 read(s) checked" here — my own assumption about the wording rather than the contract; the
    # number that moves with the window bound is `eligible`, and it is `checked` + `set aside`.
    assert "2 read(s) checked" in out["reason"], out["reason"]
    assert "1 set aside" in out["reason"], out["reason"]
    # move the last read one second PAST the end and it leaves the population entirely
    _rtclog(
        tmp_path, [(0, "push", None), (settle, "read", 0.4), (settle + 1, "read", 0.5), (8 * 3600 + 1, "read", 0.6)]
    )
    out2 = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(hours=8))
    # two reads remain in window, one still set aside ⇒ ONE checked: the window bound moved the
    # eligible population by exactly one, which is what an off-by-one there would also do
    assert "1 read(s) checked" in out2["reason"], out2["reason"]
    assert "1 set aside" in out2["reason"], out2["reason"]


def test_THE_RTC_LOG_READER_DECLARES_ITS_ENCODING_AND_REPLACES_A_BAD_BYTE(tmp_path):
    """The RTC log is device bytes. `encoding="utf-8"` asserted on the CALL under
    `-X warn_default_encoding -W error::EncodingWarning`, so the same log reads identically on a
    C-locale box; and `errors="replace"` asserted IN PROCESS with a byte no UTF-8 decoder accepts,
    because the default is STRICT and a `UnicodeDecodeError` is not an `OSError` — it would escape this
    reader and take the night's whole verdict rather than skipping one row.

    The in-process call comes first deliberately: mutmut selects a mutant's tests from COVERAGE, and a
    subprocess is invisible to the tracer."""
    import subprocess
    import sys

    path = tmp_path / f"{RING_BASE}_RTCLOG.csv"
    with open(path, "wb") as fh:
        fh.write(b"Phone timestamp;event;rtc_offset_s\n")
        fh.write(b"2026-09-20T23:00:01;read;\xff\xfe\n")
        fh.write(b"2026-09-20T23:00:02;read;0.4\n")
    ev = si.rtc_events(str(tmp_path), "O2Ring-S")
    assert len(ev) == 1 and ev[0][2] == 0.4, ev
    src = f"import solid_night_inputs as si\nassert len(si.rtc_events({str(tmp_path)!r}, 'O2Ring-S')) == 1\n"
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=os.path.dirname(os.path.abspath(si.__file__)),
    )
    assert r.returncode == 0, r.stderr


def test_A_SHORT_RTC_ROW_IS_SKIPPED_BEFORE_ITS_OFFSET_IS_READ(tmp_path):
    """`len(c) < 3 OR c[1] not in (...)` — OR, not AND. A two-field row naming a real event
    (`stamp;read`) has no offset column at all: with `and` the guard passes and `c[2]` raises
    IndexError, taking the night's verdict with it. The writer truncates a row on a torn write, so this
    is a real shape and not a hypothetical."""
    (tmp_path / f"{RING_BASE}_RTCLOG.csv").write_text(
        "Phone timestamp;event;rtc_offset_s\n"
        "2026-09-20T23:00:01;read\n"  # TWO fields, and the event IS valid
        "2026-09-20T23:00:02;read;0.4\n"
    )
    ev = si.rtc_events(str(tmp_path), "O2Ring-S")
    assert len(ev) == 1 and ev[0][2] == 0.4, ev


def test_RTC_EVENTS_ARE_ORDERED_BY_TIME_and_ties_keep_their_file_order(tmp_path):
    """`key=lambda r: r[0]` — by TIME, and the key matters on a tie. Without it Python compares the whole
    tuple, so two events at the same instant order by their EVENT NAME instead of by the order the ring
    wrote them (`push` before `read` alphabetically, whatever the log says). The ring pushes and reads
    within the same second routinely, and `rtc_band` reads the push/read sequence to decide which reads
    sit inside the settle window — so a reordered tie changes which reads are set aside."""
    (tmp_path / f"{RING_BASE}_RTCLOG.csv").write_text(
        "Phone timestamp;event;rtc_offset_s\n"
        "2026-09-20T23:00:05;read;0.4\n"  # LATER, written first
        "2026-09-20T23:00:01;reset;\n"
        "2026-09-20T23:00:01;push;\n"  # a tie with the reset, and `push` > `reset` alphabetically
    )
    ev = si.rtc_events(str(tmp_path), "O2Ring-S")
    assert [k for _t, k, _v in ev] == ["reset", "push", "read"], ev
    assert ev[0][0] == ev[1][0], "the first two really are a tie"


def test_SCORE_DEVICES_HANDS_THE_RTC_BAND_THE_WORN_INTERVAL(tmp_path):
    """The call site, not just the band. `rtc_band(night_dir, model, start, end)` — BOTH ends. With
    `start` replaced by None the band reports "no worn interval" and the night's `rtc` term goes UNKNOWN
    on a night whose RTC was in fact read; with `end` replaced by None the window comparison
    `start <= t <= end` compares a datetime against None and raises, taking the whole night's verdict.
    So this asserts the band ANSWERED from the interval rather than about its absence."""
    night = tmp_path / "2026-09-20"
    night.mkdir()
    _ecg(night)
    _seams(night)
    _runs(night, "ECG")
    _runs(night, "ACC")
    ring = {"name": "Wellue O2Ring-S", "model": "O2Ring-S"}
    # A HEADER IS NOT A STREAM: `worn_interval` takes its start from the primary's own first readable
    # ROW stamp, so a header-only file gives "the primary stream carries no readable row stamp" and the
    # band answers about an absence instead of judging the reads. `_spo2` writes the rows and the
    # acquisition evidence the ring's writer lays beside them.
    spo2 = f"{RING_BASE}_SPO2.csv"
    _spo2(night, 600)
    # THE RING NEEDS ITS OWN AUDIT ENTRY, written inline rather than by widening `_audit` — that helper
    # hardcodes the H10 and a dozen other tests depend on its exact shape. Without a wear end for the
    # ring, `worn_interval` has nothing to hand `rtc_band` and the band correctly answers "no worn
    # interval" — which would make this test pass for the wrong reason.
    (night / "LOSS-AUDIT.json").write_text(
        json.dumps(
            {
                "journal": "read",
                "clock_events": [],
                "devices": {
                    H10["name"]: {
                        "file": f"{BASE}_ECG.txt",
                        "gaps": [],
                        "wear": {
                            "available": True,
                            "worn_end": {"at": "2026-09-20T23:03:00", "reason": "doff", "file": f"{BASE}_ECG.txt"},
                        },
                    },
                    ring["name"]: {
                        "file": spo2,
                        "gaps": [],
                        "wear": {
                            "available": True,
                            "worn_end": {"at": "2026-09-21T06:00:00", "reason": "doff", "file": spo2},
                        },
                    },
                },
            }
        )
    )
    _rtclog(night, [(i * 600, "read", 0.4 + 0.02 * i) for i in range(1, 10)])
    band = si.score_devices(str(night), [H10, ring])[ring["name"]]["bands"]["rtc"]
    assert "no worn interval" not in (band["reason"] or ""), band
    assert band["status"] in ("PASS", "FAIL", "UNKNOWN"), band
    assert "read(s)" in (band["reason"] or ""), "the band judged the reads it was handed"


def test_THE_SPAN_IS_RENDERED_IN_HOURS_at_a_boundary_that_shows_the_divisor(tmp_path):
    """`span_s / 3600` — the divisor is seconds-per-hour, and the rendering is `.1f`. ⚠️ A SPAN CHOSEN AT
    A ROUNDING BOUNDARY IS WHAT MAKES THE DIVISOR OBSERVABLE: at 8.00 h both 3600 and 3601 render
    "8.0 h" and the assertion proves nothing. 8.05 h = 28,980 s renders "8.1 h" under /3600 and "8.0 h"
    under /3601, because 28980/3601 = 8.0478. Same lesson as the sub-second gap in the seam tests —
    a fixture must straddle the values it distinguishes, not merely exceed them."""
    span_s = 8.05 * 3600  # 28,980 s
    rows = [(0, "read", -3.2), (span_s, "read", 3.2)]  # 6.4 s over 8.05 h ≈ 221 ppm, past the bound
    _rtclog(tmp_path, rows)
    out = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(seconds=span_s))
    assert out["status"] == "FAIL", out
    assert "8.1 h" in out["reason"], out["reason"]
    assert "8.0 h" not in out["reason"], "at /3601 it would render 8.0 — the divisor must be 3600"


def test_A_READ_GAP_EXACTLY_AT_THE_BOUND_IS_NOT_A_GAP(tmp_path):
    """`worst_gap > RTC_READ_GAP_MAX_S` is STRICT, so a stretch exactly at the bound is still covered.
    The bound is 900 s against a measured 600 s poll cadence (p95 601.0 s, p99 606.4 s), so 900 s is
    already half again the worst routine gap — a run exactly there is the longest acceptable silence,
    not the first unacceptable one."""
    gap = int(si.RTC_READ_GAP_MAX_S)
    rows = [(0, "read", 0.4), (gap, "read", 0.5), (2 * gap, "read", 0.6)]
    _rtclog(tmp_path, rows)
    out = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(seconds=2 * gap))
    assert out["status"] == "PASS", out
    # "read throughout" IS the discriminator: with `>=` a stretch exactly at the bound would be flagged
    # and this sentence would name a longest-unread-stretch instead. I first asserted that phrasing —
    # a guess at the wording rather than the behaviour, and the band was right.
    assert "read throughout" in out["reason"], out["reason"]
    assert "longest unread stretch" not in out["reason"]
    # and one second past it is a gap
    _rtclog(tmp_path, [(0, "read", 0.4), (gap + 1, "read", 0.5), (2 * gap + 2, "read", 0.6)])
    out2 = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(seconds=2 * gap + 2))
    # ⚠️ STILL A PASS, and that is the band's design rather than a leak: a read gap is reduced COVERAGE,
    # which ANNOTATES (CLAUDE.md §∅ — "a DISCONTINUITY refuses; reduced COVERAGE annotates"). The bound
    # decides the SENTENCE, not the status, so the kill is the wording. I asserted UNKNOWN here first,
    # which was my assumption about severity, not the rule.
    assert out2["status"] == "PASS", out2
    assert "longest unread stretch 15 min" in out2["reason"], out2["reason"]
    assert "read throughout" not in out2["reason"]


def test_THE_OFFSET_AND_DRIFT_BOUNDS_ARE_STRICT_at_exactly_the_bound(tmp_path):
    """Both `>` comparisons, exercised AT the bound. A read exactly at `RTC_OFFSET_MAX_S` passes and one
    a hair past it fails; likewise a drift exactly at `RTC_DRIFT_MAX_PPM`. The bounds were pre-stated
    from the mirror — 8.0 s sits above everything observed clear of a push (p99 1.6 s, max 3.3 s over
    2184 reads) and A5's precedent is that a bound sits above the observed maximum, so a value AT it is
    the last acceptable one rather than the first refused."""
    span = 8 * 3600.0
    # |offset| exactly 8.0 s — the last acceptable read
    _rtclog(tmp_path, [(0, "read", 8.0), (span, "read", 8.0)])
    at_bound = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(seconds=span))
    assert at_bound["status"] == "PASS", at_bound
    _rtclog(tmp_path, [(0, "read", 8.1), (span, "read", 8.1)])
    past = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(seconds=span))
    assert past["status"] == "FAIL" and "8.0 s bound" in past["reason"], past

    # DRIFT EXACTLY AT 100 ppm, and the span is chosen so the float lands EXACTLY on the bound:
    # 1.0 s of walk over 10,000 s is 100.0 ppm with no representation error. ⚠️ My first attempt used
    # 8 h and 2.88 s of walk, which computes to 99.99999999999999 — under the bound either way, so `>`
    # and `>=` agreed and the mutant survived. A boundary test needs a value that IS the boundary in
    # floating point, not one that should be.
    span10 = 10000.0
    _rtclog(tmp_path, [(0, "read", -0.5), (span10, "read", 0.5)])
    at_drift = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(seconds=span10))
    assert at_drift["status"] == "PASS", at_drift  # 100.0 is not > 100.0
    _rtclog(tmp_path, [(0, "read", -0.6), (span10, "read", 0.6)])
    past_drift = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(seconds=span10))
    assert past_drift["status"] == "FAIL" and "ppm bound" in past_drift["reason"], past_drift


def test_THE_UNRESOLVED_SENTENCE_RENDERS_ITS_SPAN_IN_HOURS(tmp_path):
    """The other `span_s / 3600`, on the drift-is-null branch. Same boundary trick: a span of 0.25 h
    renders "0.2 h" under /3600 (0.2500 → banker-free `.1f` gives 0.2) and would read differently under
    a changed divisor, while `* 3600` renders an absurd figure. The sentence has to carry the span
    because the whole claim is "this span cannot resolve the bound" — a reader must see which span."""
    span = 0.25 * 3600  # 900 s → floor 111.1 ppm, x4 = 444 > 100, so UNRESOLVED
    _rtclog(tmp_path, [(0, "read", 0.4), (span, "read", 0.5)])
    out = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(seconds=span))
    assert out["status"] == "PASS", out
    assert "drift null" in out["reason"], out["reason"]
    assert "0.2 h span resolves only" in out["reason"], out["reason"]
    assert "900.0 h" not in out["reason"] and "810000.0 h" not in out["reason"]


def test_A_ONE_SECOND_SPAN_STILL_HAS_A_DRIFT_FIGURE(tmp_path):
    """`span_s <= 0`, not `<= 1`. A one-second span is a real span: the figure it yields is enormous and
    its floor is enormous too, so `resolved` is False and nothing is published — but that is the FLOOR
    refusing, which states a reason, not the guard silently returning three absences. The distinction
    matters because `(None, None, False)` reads as "no span at all"."""
    t0 = dt.datetime(2026, 9, 20, 22, 0, 0)
    ppm, floor_ppm, resolved = si.rtc_drift([(t0, 0.4), (t0 + dt.timedelta(seconds=1), 0.5)], 1.0)
    assert ppm is not None and abs(ppm - 100000.0) < 1e-6, ppm
    assert floor_ppm is not None and abs(floor_ppm - 100000.0) < 1e-6, floor_ppm
    assert resolved is False, "its own floor is 100,000 ppm — the record cannot resolve the bound"
    # and zero really is the guard
    assert si.rtc_drift([(t0, 0.4)], 0.0) == (None, None, False)


def test_ONE_UNOPENABLE_LOG_DOES_NOT_STOP_THE_REST(tmp_path):
    """`continue`, not `break`. The ring writes ONE LOG PER CAPTURE SESSION and a night can hold
    hundreds, so abandoning the scan at the first unreadable file would drop every log after it — and
    the logs are read in sorted name order, which is session order, so the ones lost would be the LATER
    half of the night. The unopenable one must be alphabetically FIRST for the difference to show."""
    (tmp_path / "Wellue_O2Ring-S_S8AW2100_20260920220000_RTCLOG.csv").mkdir()  # sorts FIRST, unopenable
    _rtclog(tmp_path, [(0, "read", 0.4)], name="Wellue_O2Ring-S_S8AW2100_20260920230000")
    _rtclog(tmp_path, [(600, "read", 0.5)], name="Wellue_O2Ring-S_S8AW2100_20260920234000")
    ev = si.rtc_events(str(tmp_path), "O2Ring-S")
    assert len(ev) == 2, f"both readable logs AFTER the bad one were read: {ev}"
    assert [v for _t, _k, v in ev] == [0.4, 0.5], ev


def test_BOTH_HOUR_RENDERINGS_CARRY_THE_DIVISOR(tmp_path):
    """The two remaining `span_s / 3600` sites — the resolved-drift sentence and the drift-null one.
    ⚠️ BOTH SPANS ARE CHOSEN SO /3600 AND /3601 RENDER DIFFERENTLY AT `.1f`, which most spans do not:
    8.00 h renders "8.0" either way, and 2.05 h renders "2.0" either way because 2.05 is slightly under
    in binary. Searched rather than guessed — 4,860 s renders 1.4 h against 1.3 h and resolves its
    bound; 3,780 s renders 1.1 h against 1.0 h and does not."""
    # 1 · RESOLVED: 4,860 s, floor 20.6 ppm x 4 = 82 <= 100, so a drift figure IS published
    _rtclog(tmp_path, [(0, "read", 0.4), (4860, "read", 0.5)])
    resolved = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(seconds=4860))
    assert resolved["status"] == "PASS", resolved
    assert "1.4 h" in resolved["reason"], resolved["reason"]
    assert "1.3 h" not in resolved["reason"], "at /3601 it would render 1.3"

    # 2 · UNRESOLVED: 3,780 s, floor 26.5 ppm x 4 = 105.8 > 100, so the null sentence renders instead
    _rtclog(tmp_path, [(0, "read", 0.4), (3780, "read", 0.5)])
    unresolved = si.rtc_band(str(tmp_path), "O2Ring-S", T0, T0 + dt.timedelta(seconds=3780))
    assert "drift null" in unresolved["reason"], unresolved["reason"]
    assert "1.1 h span resolves only" in unresolved["reason"], unresolved["reason"]
    assert "1.0 h span" not in unresolved["reason"], "at /3601 it would render 1.0"
