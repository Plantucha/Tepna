# tepna-capture — writers tests (the SUITE-CRITICAL layer)
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# Locks in the ~10% HR-bug fix: `timestamp [ms]` must be RELATIVE + FRACTIONAL (not integer/absolute),
# else the ECGDex fs inference reads 143 Hz instead of 130.
import datetime as _dt

import pytest

import oxyii
import writers
from tests._srcscan import module_source


def test_capture_filename_is_contiguous_stamp_not_psl_shape():
    # NOT PSL parity — PSL separates date and time (…_YYYYMMDD_HHMMSS_KIND); we write them
    # contiguous. The old name asserted parity that does not hold and encoded the same
    # misreading as writers.py's comment, so it passed while the bug shipped
    # (ENGINE-VERIFICATION-FINDINGS §1.2). dex-ingest.js now accepts BOTH shapes.
    t = _dt.datetime(2026, 7, 16, 21, 34, 51)
    assert writers.capture_filename("Polar", "H10", "02849638", t, "ecg", "txt") \
        == "Polar_H10_02849638_20260716213451_ECG.txt"
    # explicit: the stamp is 14 contiguous digits, NOT the PSL underscore-separated shape
    assert "_20260716_213451_" not in writers.capture_filename("Polar", "H10", "02849638", t, "ecg", "txt")


def test_ecg_ms_column_is_relative_and_fractional(tmp_path):
    p = tmp_path / "ecg.txt"
    w = writers.StreamWriter(str(p), "ecg")
    t = _dt.datetime(2026, 7, 16, 21, 34, 53, 930000)
    ns0 = 599636646177065964
    w.write_ecg(t, ns0, 0.0, 4)
    w.write_ecg(t, ns0 + 7_692_308, 0.0, 2)      # +7.692308 ms at 130 Hz
    w.close()
    rows = p.read_text().splitlines()
    assert rows[0] == "Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]"
    # ms column: first row exactly "0.0", second row fractional relative ms (NOT rounded to 7 or 8)
    assert rows[1].split(";")[2] == "0.0"
    assert rows[2].split(";")[2] == "7.692308"
    # phone timestamp: LOCAL-CIVIL, zone-free, ms precision (Clock Contract §1)
    assert rows[1].split(";")[0] == "2026-07-16T21:34:53.930"
    # raw sensor_ns carried verbatim as the secondary column
    assert rows[1].split(";")[1] == str(ns0)


def test_ppg_writes_four_channels(tmp_path):
    p = tmp_path / "ppg.txt"
    w = writers.StreamWriter(str(p), "ppg")
    w.write_ppg(_dt.datetime(2026, 7, 16), 100, 0.0, (10, 20, 30), 40)
    w.close()
    rows = p.read_text().splitlines()
    # Real PSL Verity header (corpus: Polar_Sense_*_PPG.txt) — "channel N", and NO timestamp [ms]
    # column, so the channels start at index 2. We used to emit "ppg0;ppg1;ppg2" AND an extra ms column,
    # which shifted every channel by one and made PPGDex/MotionDex silently read the wrong fields.
    assert rows[0] == "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient"
    assert rows[1].split(";")[2:] == ["10", "20", "30", "40"]


def test_spo2_csv_is_vihealth_layout(tmp_path):
    p = tmp_path / "spo2.csv"
    w = writers.Spo2CsvWriter(str(p))
    w.write(_dt.datetime(2026, 7, 16, 21, 34, 53), 97, 62, 5)
    w.close()
    rows = p.read_text().splitlines()
    assert rows[0] == "Time,Oxygen Level,Pulse Rate,Motion"
    # HH:MM:SS DD/MM/YYYY local-civil (the exact shape OxyDex's oxydex-spo2 adapter parses)
    assert rows[1] == "21:34:53 16/07/2026,97,62,5"


def test_streamwriter_periodic_flush_lands_rows_before_close(tmp_path):
    # A hard kill / power loss mid-night must not lose the buffered tail: the writer flushes on a
    # wall-clock cadence, so rows are readable from a SEPARATE handle before close() ever runs.
    p = tmp_path / "ecg.txt"
    w = writers.StreamWriter(str(p), "ecg", flush_interval=0.0)   # 0.0 => flush on every row
    ns0 = 599636646177065964
    for i in range(50):
        w.write_ecg(_dt.datetime(2026, 7, 16, 21, 34, 53), ns0 + i * 7_692_308, 0.0, i)
    on_disk = p.read_text().splitlines()          # NOT closed yet
    assert len(on_disk) == 51                      # header + 50 rows already on disk
    assert on_disk[1].split(";")[2] == "0.0"       # rel-ms invariant survives the flush path
    w.close()


def test_spo2writer_periodic_flush_lands_rows_before_close(tmp_path):
    p = tmp_path / "spo2.csv"
    w = writers.Spo2CsvWriter(str(p), flush_interval=0.0)
    for i in range(4):
        w.write(_dt.datetime(2026, 7, 16, 21, 34, 53 + i), 97, 60 + i, 3)
    on_disk = p.read_text().splitlines()          # NOT closed yet
    assert len(on_disk) == 5                        # header + 4 rows already on disk
    w.close()


# ── writers coverage wave 2 (FOLLOWUPS §2) — night_dir + every per-stream row/header ────────────────
# Only ecg/ppg/spo2 were row-tested; acc/gyro/mag/ppi/hr headers + row formats, the PPI flag-bit split,
# HR's one-row-per-RR behaviour, and night_dir were unpinned (49% mutation score). These assert exact
# bytes so a header typo, a wrong separator/column, a flipped flag bit, or a broken RR loop reds.
import os as _os

_PHONE = _dt.datetime(2026, 7, 16, 21, 34, 53, 930000)
_PTS = "2026-07-16T21:34:53.930"


def _write_read(tmp_path, stream, fn):
    p = str(tmp_path / (stream + ".txt"))
    w = writers.StreamWriter(p, stream, fsync=False)
    fn(w)
    w.close()
    return open(p).read().splitlines(), w


def test_night_dir_is_captures_slash_local_date(tmp_path):
    d = writers.night_dir(str(tmp_path), _dt.datetime(2026, 7, 16, 21, 34, 53))
    assert d == _os.path.join(str(tmp_path), "captures", "2026-07-16")   # per-night folder by LOCAL date
    assert _os.path.isdir(d)                                             # created lazily


def test_write_acc_header_and_row(tmp_path):
    rows, _ = _write_read(tmp_path, "acc", lambda w: w.write_acc(_PHONE, 1000, 0.0, 10, -20, 30))
    # Real PSL ACC header (corpus: Polar_H10_*_ACC.txt) — NO timestamp [ms] column. That column is
    # ECG-ONLY in Polar Sensor Logger; emitting it here shifted X/Y/Z by one for every consumer.
    assert rows[0] == "Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]"
    assert rows[1] == f"{_PTS};1000;10;-20;30"


def test_write_gyro_and_mag_headers_carry_correct_units(tmp_path):
    gr, _ = _write_read(tmp_path, "gyro", lambda w: w.write_gyro(_PHONE, 5, 0.0, 1, 2, 3))
    mr, _ = _write_read(tmp_path, "mag", lambda w: w.write_mag(_PHONE, 5, 0.0, 4, 5, 6))
    # Real PSL GYRO/MAGN headers (corpus: Polar_Sense_*_GYRO.txt / *_MAGN.txt) — no ms column either.
    assert gr[0] == "Phone timestamp;sensor timestamp [ns];X [dps];Y [dps];Z [dps]"
    assert gr[1] == f"{_PTS};5;1;2;3"
    assert mr[0] == "Phone timestamp;sensor timestamp [ns];X [G];Y [G];Z [G]"
    assert mr[1] == f"{_PTS};5;4;5;6"


def test_write_ppi_header_and_flag_bit_decomposition(tmp_path):
    """PSL's PPI layout, VERIFIED against the vendor corpus: interval first, hr last, no device clock.

    The previous expectation here pinned our OWN divergent layout — an extra `sensor timestamp [ns]`
    column with HR third — so it read as validation of the bug. A consumer using PSL's order takes
    column 1 as the interval; under the old layout that was the device clock, which every interval
    sanity band rejects, so a live PPI stream counted ZERO usable beats.
    """
    # flags 0b101 → blocker=1, skinContact=0, skinContactSupported=1 (bits 0,1,2)
    rows, _ = _write_read(tmp_path, "ppi", lambda w: w.write_ppi(_PHONE, 5000, 60, 1000, 5, 0b101))
    assert rows[0] == "Phone Data RX timestamp;PP-interval [ms];error estimate [ms];blocker;contact;contact;hr [bpm]"
    assert rows[1] == f"{_PTS};1000;5;1;0;1;60"
    # Column 1 is what a PSL-layout reader takes as the interval; it must survive an interval band.
    assert 250 < float(rows[1].split(";")[1]) < 2200


def test_every_emitted_header_matches_a_real_polar_sensor_logger_export():
    """Byte-for-byte against headers taken from the real PSL corpus (19 GB, `Ecg nightly/`).

    The file claims these are "exactly as Polar Sensor Logger exports". Seven of the eight were; PPI was
    not, and nothing asserted the claim — so the one that diverged looked exactly like the seven that
    did not. PSL splits HR/RR across two files, so each is checked against its own real header.
    """
    psl = {
        "ecg":  "Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]",
        "acc":  "Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]",
        "ppg":  "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient",
        "gyro": "Phone timestamp;sensor timestamp [ns];X [dps];Y [dps];Z [dps]",
        "mag":  "Phone timestamp;sensor timestamp [ns];X [G];Y [G];Z [G]",
        "hr":   "Phone timestamp;HR [bpm];HRV [ms];Breathing interval [rpm];",
        "rr":   "Phone timestamp;RR-interval [ms]",
        "ppi":  "Phone Data RX timestamp;PP-interval [ms];error estimate [ms];blocker;contact;contact;hr [bpm]",
    }
    for stream, header in psl.items():
        assert writers.StreamWriter.HEADERS[stream] == header, f"{stream} diverges from the real vendor export"
    # `ppg1` is ours BY DESIGN — the O2Ring's single photodiode has no PSL equivalent, and writing three
    # replicated columns is what fabricated a 100% LED-agreement statistic (AUDIT-PROMPT class 11).
    assert writers.StreamWriter.HEADERS["ppg1"] == "Phone timestamp;sensor timestamp [ns];channel 0"
    # `ppg2w` is ours BY DESIGN too — PSL never talked to an O2Ring, so there is no vendor export for a
    # two-wavelength ring stream to be byte-compatible WITH. It reuses PSL's `channel N` column idiom so
    # one parser still reads it, and it is deliberately NOT `ir;red`: which u32 is which wavelength is
    # unverified (oxyii.RT_PPG_REC, "WHICH-IS-WHICH"), and a header is a bad place to publish a guess
    # that downstream SpO2 math would silently trust.
    assert writers.StreamWriter.HEADERS["ppg2w"] == \
        "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion"
    # `accraw` is ours BY DESIGN, and the UNIT is the whole reason it is not `acc`. PSL never talked to
    # an O2Ring, and more importantly Polar publishes a scale factor while Wellue does not: `acc` can
    # honestly say `mg`, these are counts with no calibrated scale. Writing ring rows under the `acc`
    # header would publish a FABRICATED UNIT that a reader would multiply as milli-g. The column stays
    # `raw` until a six-orientation calibration measures the factor — the same discipline `ppg2w` uses
    # in refusing `ir;red` for a wavelength assignment it has not verified.
    assert writers.StreamWriter.HEADERS["accraw"] == \
        "Phone timestamp;sensor timestamp [ns];X [raw];Y [raw];Z [raw]"
    assert "[mg]" not in writers.StreamWriter.HEADERS["accraw"], \
        "the ring's ACC has no measured scale — a mg column here would be a fabricated unit"
    assert set(writers.StreamWriter.HEADERS) == set(psl) | {"ppg1", "ppg2w", "accraw"}, \
        "a new stream needs its header checked against a real export, or this gate stops covering it"


def test_ppg1_stamps_the_timebase_decision_as_a_header_comment(tmp_path):
    """O2RING-ADAPTIVE-TIMEBASE Stage 3b: the O2Ring optical files carry the per-capture RATE decision as
    a `# timebase=…` comment BEFORE the header, so a reader gets it without a sidecar. The comment is
    inert to parsing (a `#` line fails every row filter), and the gate is by DEVICE — both O2Ring optical
    streams (`ppg1`, `ppg2w`) carry it; a Verity `ppg` or an ECG stream never does."""
    p = str(tmp_path / "Wellue_O2Ring-S_S8AW_20260808_PPG.txt")
    w = writers.StreamWriter(p, "ppg1", fsync=False, timebase="host-disciplined")
    w.close()
    lines = open(p).read().splitlines()
    assert lines[0] == "# timebase=host-disciplined", "the decision precedes the header"
    assert lines[1] == "Phone timestamp;sensor timestamp [ns];channel 0", "the header is unchanged"

    # No timebase ⇒ no comment (PpgDex then defaults to the crystal floor).
    p2 = str(tmp_path / "bare_PPG.txt")
    writers.StreamWriter(p2, "ppg1", fsync=False).close()
    assert open(p2).read().splitlines()[0].startswith("Phone timestamp"), "no decision ⇒ no comment line"

    # A non-O2Ring stream never carries it, even if a timebase is passed — the decision is per DEVICE.
    p3 = str(tmp_path / "verity_PPG.txt")
    writers.StreamWriter(p3, "ppg", fsync=False, timebase="device-crystal").close()
    assert open(p3).read().splitlines()[0].startswith("Phone timestamp"), "a Verity ppg stream carries no timebase"

    # …and `ppg2w` DOES, because it is the same ring on the same host clock. The gate is by DEVICE, not
    # by stream name, and reading it as "the finger file" is how this stream was missed: measured on the
    # box 2026-08-15, 0 of 40 `_PPG2W.txt` carried the stamp against 20 of 216 `_PPG.txt` — including a
    # `_PPG2W.txt` written in the SAME capture session as a stamped `_PPG.txt`.
    p4 = str(tmp_path / "Wellue_O2Ring-S_S8AW_20260808_PPG2W.txt")
    writers.StreamWriter(p4, "ppg2w", fsync=False, timebase="host-disciplined").close()
    l4 = open(p4).read().splitlines()
    assert l4[0] == "# timebase=host-disciplined", "the raw dual-wavelength stream carries the decision too"
    assert l4[1] == "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion", "its header is unchanged"

    # No timebase ⇒ no comment, on ppg2w exactly as on ppg1 — absent is never defaulted to a decision.
    p5 = str(tmp_path / "bare_PPG2W.txt")
    writers.StreamWriter(p5, "ppg2w", fsync=False).close()
    assert open(p5).read().splitlines()[0].startswith("Phone timestamp"), "no decision ⇒ no comment line"


def test_write_hr_splits_into_psl_hr_and_rr_files(tmp_path):
    """PSL layout (verified against the real corpus): _HR.txt = ONE HR row per notification (HR only,
    HRV/Breathing columns empty); RR intervals go to a sibling _RR.txt, one row per interval, no blank
    rows. This lets one parser read Vigil and genuine Polar-Sensor-Logger captures."""
    p = str(tmp_path / "Polar_H10_02849638_20260620_031641_HR.txt")
    w = writers.StreamWriter(p, "hr", fsync=False)
    w.write_hr(_PHONE, 7000, 55, [800, 810])       # 1 HR row + 2 RR rows
    w.write_hr(_PHONE, 7000, 56, [])               # 1 HR row, NO RR rows (no blank line)
    w.close()
    hr = open(p).read().splitlines()
    rr = open(str(tmp_path / "Polar_H10_02849638_20260620_031641_RR.txt")).read().splitlines()
    assert hr[0] == "Phone timestamp;HR [bpm];HRV [ms];Breathing interval [rpm];"
    assert hr[1:] == [f"{_PTS};55", f"{_PTS};56"]              # HR-only, one per notification
    assert rr[0] == "Phone timestamp;RR-interval [ms]"
    assert rr[1:] == [f"{_PTS};800", f"{_PTS};810"]            # one per real RR, no blank row
    assert w.rows == 2                                          # _HR row count (the primary file)


def test_ms_column_is_ecg_only_matching_real_polar_sensor_logger(tmp_path):
    """Ground truth from the real PSL corpus: `timestamp [ms]` appears on ECG and NOWHERE else.
    Emitting it on acc/ppg/gyro/mag put every downstream field one column out, which is why MotionDex
    read the ms value as X and PPGDex read it as channel 0 — silently, with no parse error."""
    ecg, _ = _write_read(tmp_path, "ecg", lambda w: w.write_ecg(_PHONE, 1000, 0.0, 42))
    assert "timestamp [ms]" in ecg[0], "ECG must KEEP the ms column — real PSL has it"
    for kind, call in (("acc", lambda w: w.write_acc(_PHONE, 1, 0.0, 1, 2, 3)),
                       ("gyro", lambda w: w.write_gyro(_PHONE, 1, 0.0, 1, 2, 3)),
                       ("mag", lambda w: w.write_mag(_PHONE, 1, 0.0, 1, 2, 3)),
                       ("ppg", lambda w: w.write_ppg(_PHONE, 1, 0.0, (1, 2, 3), 4))):
        rows, _ = _write_read(tmp_path, kind, call)
        assert "timestamp [ms]" not in rows[0], f"{kind} must NOT carry the ms column (ECG-only in PSL)"
        assert len(rows[0].split(";")) == len(rows[1].split(";")), f"{kind} header/row column count mismatch"


def test_missing_identity_names_exactly_the_blank_fields():
    """The gate both the capture daemon and the Remember API run on. A device that passes this is one
    `capture_filename` can name; one that fails would land as `__<id>_..._ECG.txt`, unroutable."""
    good = {"name": "H10", "vendor": "Polar", "model": "H10", "device_id": "12345678"}
    assert writers.missing_identity(good) == []
    assert writers.missing_identity({**good, "vendor": ""}) == ["vendor"]
    assert writers.missing_identity({**good, "vendor": "", "model": None}) == ["vendor", "model"]
    assert writers.missing_identity({}) == ["name", "vendor", "model", "device_id"]
    # whitespace is not an identity — it would produce ` _ _id_...` filenames
    assert writers.missing_identity({**good, "model": "   "}) == ["model"]
    # the unrecognised-sensor shape guessDevice() actually emits (blank vendor+model, id from the MAC)
    assert writers.missing_identity({"name": "AC028496", "vendor": "", "model": "",
                             "device_id": "AC028496"}) == ["vendor", "model"]


def test_identity_fields_are_the_ones_the_filename_interpolates():
    """Guards the pair from drifting: every field capture_filename() puts in the name must be gated."""
    for f in ("vendor", "model", "device_id"):
        assert f in writers.IDENTITY_FIELDS


def test_the_remember_api_gates_on_identity_before_it_persists():
    """SOURCE SCAN, because webmon.py needs aiohttp and the test env has none — a skipped test here
    would be no gate at all, and this leg is exactly the one that was missing (the daemon checked,
    the API did not). Asserts the ordering that matters: reject BEFORE the config write."""
    import os
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "webmon.py")).read()
    body = src[src.index("async def remember("):]
    body = body[:body.index("\n    async def ")]
    assert "missing_identity(" in body, "Remember API no longer validates device identity"
    assert body.index("missing_identity(") < body.index("_save()"), \
        "identity is checked AFTER the config write — the bad entry is already persisted"
    assert "status=400" in body, "a rejected device must fail loudly, not return a success shape"


# ── the open-sample-writer count (CAPTURE-HOST-DEEP-AUDIT §A1) ─────────────────────────────────────
# This count is the LIFETIME of `capture._now()`'s absorbed DST shift: while it is non-zero a civil
# relabelling is absorbed so the open recording cannot rewind; the instant it hits zero the shift
# expires and stamps return to civil time. So an over-count pins the box an hour off forever (the
# original defect, re-armed) and an under-count rewinds a live file. Both directions are pinned here.

def test_a_stream_writer_is_counted_while_open_and_released_on_close(tmp_path):
    base = writers.open_sample_writers()
    w = writers.StreamWriter(str(tmp_path / "a_ECG.txt"), "ecg")
    assert writers.open_sample_writers() == base + 1
    w.close()
    assert writers.open_sample_writers() == base


def test_the_hr_writer_and_its_rr_sibling_count_as_ONE_open_writer(tmp_path):
    # `hr` silently owns a second handle. The count is of WRITERS, not file descriptors — one close()
    # must return the count to where it started, not leave it one high forever.
    base = writers.open_sample_writers()
    w = writers.StreamWriter(str(tmp_path / "a_HR.txt"), "hr")
    assert writers.open_sample_writers() == base + 1
    w.close()
    assert writers.open_sample_writers() == base


def test_closing_twice_does_not_double_release(tmp_path):
    # The teardown paths in capture.py are not all idempotent-by-construction (a `finally` can run
    # after an explicit close). A double release would drive the count negative and expire the clock
    # anchor while a sibling file is still being written.
    base = writers.open_sample_writers()
    w = writers.Spo2CsvWriter(str(tmp_path / "o.csv"))
    w.close()
    w.close()
    assert writers.open_sample_writers() == base


def test_a_writer_whose_flush_raises_is_still_released(tmp_path):
    # close() swallows I/O errors by design (a failed flush must not abort teardown). It must not also
    # swallow the release — a full disk at dawn would otherwise pin the shift open indefinitely.
    base = writers.open_sample_writers()
    w = writers.Spo2CsvWriter(str(tmp_path / "o2.csv"))

    def _boom():
        raise OSError("disk full")
    w.flush = _boom
    w.close()
    assert writers.open_sample_writers() == base


def test_all_three_sample_writers_are_counted_and_the_sidecars_are_not(tmp_path):
    # The sidecars are EXCLUDED deliberately: a running box holds them open continuously, so counting
    # them would make the count never reach zero and the expiry could never fire — which is the defect.
    base = writers.open_sample_writers()
    ws = [writers.StreamWriter(str(tmp_path / "s_ECG.txt"), "ecg"),
          writers.Spo2CsvWriter(str(tmp_path / "s.csv")),
          writers.OxyFrameLogWriter(str(tmp_path / "s_OXY.csv"))]
    assert writers.open_sample_writers() == base + 3
    side = [writers.LinkLogWriter(str(tmp_path / "s_LINK.csv")),
            writers.HostClockLogWriter(str(tmp_path / "s_CLOCK.csv"))]
    assert writers.open_sample_writers() == base + 3, "a sidecar must not pin the clock anchor open"
    for w in ws + side:
        w.close()
    assert writers.open_sample_writers() == base


def test_the_legacy_viatom_caller_does_not_fabricate_a_pulse():
    """§B2. VIGIL-PPG-GRID-AUDIT §5.2 removed `or 0` from the OXYII call site and left a comment there
    plus a past-tense docstring on Spo2CsvWriter.write — and never touched the LEGACY viatom runner, the
    second producer of the identical CSV one screen up. Reachable by configuration
    (`protocol: legacy`, config.example.yaml:83), not dead.

    A CALLER-level check, because the writer-level tests structurally cannot catch a caller that
    fabricates BEFORE it writes — which is exactly why they stayed green while one did.

    Impact is bounded and worth stating: the shipped oxydex-dsp.js rejects `0` and blank identically
    (`parseInt('')` → NaN and `0 < 20` hit the same `continue`), 0 occurrences across 110k real rows on
    the sibling path. No downstream number moves; the FILE stops asserting a pulse never measured."""
    src = module_source("capture.py")   # skips on a mutmut file — see tests/_srcscan.py
    assert 'wr.write(now, pkt["spo2"], pkt["pr"], pkt["motion"])' in src, \
        "the legacy viatom runner must pass `pr` through as-is, including None"
    assert 'pkt["pr"] or 0' not in src, "a fabricated 0 is indistinguishable from a real reading"


def test_both_spo2_producers_write_a_blank_for_an_unreadable_pulse(tmp_path):
    """The two callers must emit the SAME row for the same packet — the divergence itself was the bug."""
    p = tmp_path / "o.csv"
    w = writers.Spo2CsvWriter(str(p), fsync=False)
    w.write(_dt.datetime(2026, 7, 26, 2, 3, 4), 96, None, 3)     # pulse unreadable
    w.write(_dt.datetime(2026, 7, 26, 2, 3, 5), 96, 61, 3)       # pulse read
    w.close()
    rows = p.read_text().splitlines()[1:]
    assert rows[0] == "02:03:04 26/07/2026,96,,3", "blank, never 0"
    assert rows[1] == "02:03:05 26/07/2026,96,61,3"


def test_spo2_writer_blanks_an_absent_reading_rather_than_writing_the_word_None(tmp_path):
    """Audit F6. `write` defended `pr=None` (blank, never 0 — "a fabricated 0 is indistinguishable from
    a real reading") and left `spo2` undefended, so an absent SpO2 would have been formatted as the
    literal string `None` into the Oxygen Level column. Both call sites guard today; the writer is the
    place the rule is stated, so it is the place it has to hold."""
    p = str(tmp_path / "spo2.csv")
    w = writers.Spo2CsvWriter(p, fsync=False)
    w.write(_dt.datetime(2026, 7, 1, 23, 0, 0), None, None, 0)
    w.write(_dt.datetime(2026, 7, 1, 23, 0, 1), 97, 58, 0)
    w.close()
    rows = open(p).read().strip().split("\n")
    assert rows[1] == "23:00:00 01/07/2026,,,0", f"absent must be BLANK, got {rows[1]!r}"
    assert "None" not in rows[1], "the string 'None' in a CSV is a value, and it is not a measurement"
    assert rows[2] == "23:00:01 01/07/2026,97,58,0"


# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# MUTATION PASS 2026-08-02 — the _RR sibling's path, and the filename fields parsed from the right
# ═══════════════════════════════════════════════════════════════════════════════════════════════════

def test_the_rr_sibling_replaces_only_the_LAST_hr_token(tmp_path):
    """`"_RR.".join(path.rsplit("_HR.", 1))` — the source comments that the `rsplit` and the maxsplit
    are what stop a *containing* path from being rewritten, and nothing tested it: `split` instead of
    `rsplit`, and the maxsplit dropped or raised to 2, all survived.

    A path holds more than the filename. A session directory named for its stream — which is exactly
    what an operator organising a night by hand produces — puts a second `_HR.` earlier in the path,
    and rewriting that one sends the RR file into a directory that does not exist."""
    d = tmp_path / "sess_HR.d"
    d.mkdir()
    p = str(d / "Polar_H10_02849638_20260620031641_HR.txt")
    w = writers.StreamWriter(p, "hr", fsync=False)
    try:
        expected = str(d / "Polar_H10_02849638_20260620031641_RR.txt")
        assert w._rr_path == expected, "only the filename's token is rewritten, never the directory's"
        assert sorted(w.paths) == sorted([p, expected]), \
            "and the sibling is reported, so discard() and the archiver can both see it"
    finally:
        w.close()


def test_an_hr_path_with_no_hr_token_still_gets_a_sibling_beside_it(tmp_path):
    """The fallback arm: `rpartition` (not `partition`) on the extension, and `path + "_RR"` when there
    is no extension at all. Four mutants lived here — `partition` puts the suffix before the first dot
    rather than the last, so `night.2.txt` yields `night_RR.2.txt`."""
    p = str(tmp_path / "night.2.txt")
    w = writers.StreamWriter(p, "hr", fsync=False)
    try:
        assert w._rr_path == str(tmp_path / "night.2_RR.txt"), "the LAST dot is the extension"
    finally:
        w.close()
    q = str(tmp_path / "extensionless")
    w2 = writers.StreamWriter(q, "hr", fsync=False)
    try:
        assert w2._rr_path == q + "_RR", "no extension to split — append, in the same case as the token"
    finally:
        w2.close()


def test_a_stream_writer_remembers_which_stream_it_is(tmp_path):
    """`self.stream = None`. It is what `capture` reads back to route a sample to the right appender;
    None there sends every stream to whichever branch tests None first."""
    w = writers.StreamWriter(str(tmp_path / "a_ECG.txt"), "ecg", fsync=False)
    try:
        assert w.stream == "ecg"
    finally:
        w.close()


def test_closing_an_hr_writer_alone_still_lands_the_rr_intervals(tmp_path):
    """`if self._rr_fh is not None` → `is None` in close(), and `os.fsync(None)` on the sibling handle.
    The flush test below calls flush() explicitly; this one never does, so close() is the only thing
    that can get the per-beat intervals out of a 1 MiB buffer — and it is what the capture path
    actually does at end of night."""
    p = str(tmp_path / "Polar_H10_02849638_20260620031641_HR.txt")
    w = writers.StreamWriter(p, "hr", fsync=True)          # fsync on: the sibling's fsync too
    w.write_hr(_dt.datetime(2026, 6, 20, 3, 16, 41), 1_000_000, 62, [968])
    w.close()                                              # no flush() — close must do it all
    rr = open(str(tmp_path / "Polar_H10_02849638_20260620031641_RR.txt")).read().splitlines()
    assert rr[1:] == ["2026-06-20T03:16:41.000;968"], "close() alone must land the RR file"


def test_the_rr_sibling_is_flushed_and_closed_with_its_parent(tmp_path):
    """`if self._rr_fh is not None` → `is None` in both flush() and close(), so the RR handle is never
    flushed and never closed — the per-beat intervals sit in a 1 MiB buffer until the process exits.
    Every assertion on RR content read the file AFTER close(), which is the one moment the bug hides."""
    p = str(tmp_path / "Polar_H10_02849638_20260620031641_HR.txt")
    w = writers.StreamWriter(p, "hr", fsync=False)
    w.write_hr(_dt.datetime(2026, 6, 20, 3, 16, 41), 1_000_000, 62, [968, 972])
    w.flush()                                    # flush alone, WITHOUT closing
    rr = open(str(tmp_path / "Polar_H10_02849638_20260620031641_RR.txt")).read().splitlines()
    assert rr[1:] == ["2026-06-20T03:16:41.000;968", "2026-06-20T03:16:41.000;972"], \
        "flush() must reach the sibling too — the RR file is where the HRV actually is"
    w.close()


def test_the_ppi_flag_bits_are_unpacked_from_their_own_positions(tmp_path):
    """`flags >> 1 & 1` → `flags << 1 & 1`, and `flags >> 2 & 1` → `flags >> 2 | 1` (which is stuck at 1
    forever). Blocker / skin-contact / skin-contact-supported are three independent bits and the tests
    used flag values that could not tell them apart. 'Skin contact supported' reading 1 when the device
    said 0 turns an unknowable into a positive claim."""
    p = str(tmp_path / "Polar_VS_1_20260620031641_PPI.txt")
    w = writers.StreamWriter(p, "ppi", fsync=False)
    when = _dt.datetime(2026, 6, 20, 3, 16, 41)
    for flags, expected in ((0b000, "0;0;0"), (0b001, "1;0;0"),
                            (0b010, "0;1;0"), (0b100, "0;0;1"), (0b111, "1;1;1")):
        w.write_ppi(when, 1_000_000, 62, 968, 4, flags)
    w.close()
    # Columns 3,4,5 under PSL's layout (…;blocker;contact;contact;hr) — NOT the last three, which now
    # end at `hr [bpm]`. The bits' independence is what is being asserted; only their position moved.
    rows = [ln.split(";")[3:6] for ln in open(p).read().splitlines()[1:]]
    assert [";".join(r) for r in rows] == ["0;0;0", "1;0;0", "0;1;0", "0;0;1", "1;1;1"], \
        "each bit lands in its own column, independently"


def test_a_ppg_row_takes_exactly_three_optical_columns(tmp_path):
    """`cols[:3]` → `cols[:4]`. With exactly three channels the two slices are identical, which is every
    fixture; a device offering a fourth then raises `too many values to unpack` mid-capture rather than
    writing the three the header promises."""
    p = str(tmp_path / "Polar_VS_1_20260620031641_PPG.txt")
    w = writers.StreamWriter(p, "ppg", fsync=False)
    w.write_ppg(_dt.datetime(2026, 6, 20, 3, 16, 41), 1_000_000, 0.0, [11, 22, 33, 44], 7)
    w.close()
    row = open(p).read().splitlines()[1]
    assert row.split(";")[2:] == ["11", "22", "33", "7"], \
        "three optical columns and the ambient, matching the header, whatever the device offers"


def test_the_open_writer_count_returns_to_zero(tmp_path, monkeypatch):
    """`max(0, n - 1)` → `max(1, n - 1)`: the counter floors at ONE and never reaches zero again. It is
    what `capture` reads to decide whether any sample file is open at all — the "empty writers" health
    check — so a floor of 1 makes the box permanently believe it is recording.

    The counter is a MODULE GLOBAL, so it must be reset rather than assumed: reading the ambient value
    makes the test depend on every test that ran before it, and the `max(0, …)` floor can only be seen
    from exactly zero. (Asserting the ambient value instead cost a measurement run — a test that fails
    inside mutmut's copy makes the whole module report 'not checked', which reads as a broken harness
    rather than a broken test.)"""
    monkeypatch.setattr(writers, "_open_sample_writers", 0)
    assert writers.open_sample_writers() == 0
    w = writers.StreamWriter(str(tmp_path / "a_ECG.txt"), "ecg", fsync=False)
    assert writers.open_sample_writers() == 1
    w.close()
    assert writers.open_sample_writers() == 0, "closing the last writer means none are open"
    w.close()                                    # idempotent — a second close must not go negative
    assert writers.open_sample_writers() == 0


def test_a_capture_filename_defaults_to_the_txt_extension():
    """The `ext: str = "txt"` default. Every call site passes it explicitly today, which is why the
    default went unpinned — and it is the extension every PSL-compatible reader keys on."""
    t = _dt.datetime(2026, 7, 16, 21, 34, 51)
    assert writers.capture_filename("Polar", "H10", "02849638", t, "ecg") \
        == "Polar_H10_02849638_20260716213451_ECG.txt"


def test_a_device_with_no_id_yields_no_ids():
    """`str(dev.get("device_id") or "")` — the empty-string fallback that the blank filter then drops.
    Mutated to a non-empty literal, a device with no configured id claims a phantom one, and
    `file_device_id` attribution starts matching it."""
    assert writers.device_ids({}) == ()
    assert writers.device_ids({"device_id": "  "}) == ()
    assert writers.device_ids({"device_id": "02849638"}) == ("02849638",)


# ── the filename field parsers, over the shapes a real corpus actually holds ─────────────────────────
@pytest.mark.parametrize("fname,stamp,device_id", [
    # this host: contiguous stamp
    ("Polar_H10_02849638_20260716213451_ECG.txt", "20260716213451", "02849638"),
    # Polar Sensor Logger: split stamp — file_stamp has no 14-digit token to find, the id still resolves
    ("Polar_H10_02849638_20260617_010616_ACC.txt", None, "02849638"),
    # date-only, as older fixtures and hand-named files carry
    ("Polar_H10_02849638_20260617_ACC.txt", None, "02849638"),
    # the sidecars have NO id field — reporting 'Tepna' as one would let a device named Tepna claim
    # every night's link log
    ("Tepna_20260716213451_LINK.csv", "20260716213451", None),
    # a serial that looks like nothing: parsed from the right, so it is never mistaken for the stamp
    ("Polar_H10_20250101000000_20260725225058_ECG.txt", "20260725225058", "20250101000000"),
    # no extension at all — the `or fname` fallback, which a mutant turns into `and fname`
    ("Polar_H10_02849638_20260716213451_ECG", "20260716213451", "02849638"),
    # too few fields to carry either
    ("20260716213451_ECG.txt", "20260716213451", None),
    ("ECG.txt", None, None),
    # a dot INSIDE a field: the extension is the LAST dot, so `partition` would truncate the name at
    # the model and lose both fields
    ("Polar_H10.5_02849638_20260716213451_ECG.txt", "20260716213451", "02849638"),
    # a blank id field is not an id — the truthiness check reads parts[i-1], the field itself
    ("Polar_H10__20260716213451_ECG.txt", "20260716213451", None),
    # six digits that are not a time-after-a-date: the split-stamp branch must not fire, or the token
    # two places left gets reported as a device id
    ("Vendor_Model_Sub_Part_123456_ECG.txt", None, None),
])
def test_the_filename_fields_are_parsed_from_the_right(fname, stamp, device_id):
    """Eighteen survivors across `file_stamp` and `file_device_id` — the length guards, the
    `rpartition`, and the ±1 arithmetic on the index walk. The functions' own docstrings name the three
    stamp shapes and the sidecar case; this asserts that list rather than one example of it.

    Both functions exist because the unanchored versions lied: `nightqc._session_of` keyed
    `Polar_H10_20250101000000_20260725225058_ECG.txt` to the device SERIAL, eighteen months from the
    night it belongs to (audit F5)."""
    assert writers.file_stamp(fname) == stamp
    assert writers.file_device_id(fname) == device_id


def test_write_ppg2w_round_trips_through_the_parser(tmp_path):
    """End-to-end on the shape the ring actually sends: parser output feeds the writer unchanged.

    The two halves were written together, so testing either alone proves little — this pins the JOIN,
    which is where a column swap or an off-by-one silently survives both unit tests.
    """
    recs = [(123456, 7890, 4), (123460, 7895, 0)]
    body = b"".join(a.to_bytes(4, "little") + b.to_bytes(4, "little") + bytes([m]) for a, b, m in recs)
    parsed = oxyii.parse_rt_ppg(len(recs).to_bytes(2, "little") + body + b"\xff\xff")   # real 2-B trailer

    p = str(tmp_path / "Oxy_S8AW_20260805_010203_ppg2w.txt")
    w = writers.StreamWriter(p, "ppg2w", fsync=False)
    for a, b, m in parsed:
        w.write_ppg2w(_PHONE, 0, a, b, m)
    w.close()

    rows = open(p).read().strip().split("\n")
    assert rows[0] == "Phone timestamp;sensor timestamp [ns];channel 0;channel 1;motion"
    assert rows[1] == f"{_PTS};0;123456;7890;4"
    assert rows[2] == f"{_PTS};0;123460;7895;0"
    # The device exposes no clock on this opcode; a non-zero ns column here would be invented.
    assert all(r.split(";")[1] == "0" for r in rows[1:])


def test_pmd_live_meta_units_appear_in_the_psl_headers():
    """Every PMD stream carries TWO unit representations — capture._LIVE_META (the monitor card / bus)
    and writers.StreamWriter.HEADERS (the PSL export). They must agree, so neither can be a hand-pinned
    constant that drifts from the other (the class of the CPAP flow L/min↔L/s mislabel). The unit is
    DERIVED from _LIVE_META and asserted to appear bracketed in the header — the test pins nothing itself.

    Excluded, with reason: 'ppg' is unitless raw counts (header names columns, no unit); 'hr'/'ppi' are
    composite (multiple units in one PSL header), covered by their own layout tests."""
    import capture
    import writers

    def _norm(s):
        return s.replace("µ", "u").replace("μ", "u").replace("₂", "2").lower()

    for meta_key, hdr_key in [("ecg", "ecg"), ("acc", "acc"), ("gyro", "gyro"), ("mag", "mag")]:
        unit = _norm(capture._LIVE_META[meta_key][1])
        header = _norm(writers.StreamWriter.HEADERS[hdr_key])
        assert f"[{unit}]" in header, f"{meta_key}: bus unit {unit!r} not bracketed in header {header!r}"
