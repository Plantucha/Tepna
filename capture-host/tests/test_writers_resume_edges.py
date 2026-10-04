# tepna-capture — tests/test_writers_resume_edges.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`StreamWriter.__init__`'s RESUME path, edge by edge — the diff-scoped survivors that the ABSENCE-SURVEY
drain (group 2b, the ECG relative-ms anchor) pulled into scope by touching this constructor.

Each test names the mutants it kills. The resume path decides three things from a file that already exists:
whether to RESUME (append, no header) or start over, how much of a torn tail to cut first, and — for ECG —
which device-clock sample anchors the relative `timestamp [ms]` column. Every one of those is decided by a
byte count or a byte position, so the inputs here are files of exactly 0, 1 and 3-5 bytes chosen to sit on
each boundary. A test that only ever resumes a healthy multi-row file cannot see any of them.
"""

import datetime as dt
import logging
import os

import writers

T0 = dt.datetime(2026, 8, 19, 21, 0, 0)
H_ECG = writers.StreamWriter.HEADERS["ecg"]
H_RR = writers.StreamWriter.HEADERS["rr"]


def _ecg_after(tmp_path, prior: bytes):
    """Resume an ECG file that held exactly `prior`, append one sample, return (file text, the row)."""
    os.makedirs(tmp_path, exist_ok=True)
    p = str(tmp_path / "Polar_H10_x_20260819210000_ECG.txt")
    with open(p, "wb") as fh:
        fh.write(prior)
    w = writers.StreamWriter(p, "ecg", fsync=False)
    w.write_ecg(T0, 1_000_000_000, 0.0, 100)
    w.close()
    ref = str(tmp_path / "ref" / "Polar_H10_x_20260819210000_ECG.txt")
    os.makedirs(os.path.dirname(ref), exist_ok=True)
    r = writers.StreamWriter(ref, "ecg", fsync=False)
    r.write_ecg(T0, 1_000_000_000, 0.0, 100)
    r.close()
    row = open(ref).read().splitlines()[-1] + "\n"
    return open(p).read(), row


def test_an_EMPTY_existing_file_starts_fresh_with_a_header(tmp_path):
    """mutant 11 (`getsize >= 0`): a 0-byte file entered the resume branch, whose `seek(-1, 2)` cannot
    seek before the start of an empty file."""
    text, row = _ecg_after(tmp_path, b"")
    assert text.startswith(H_ECG + "\n") and text.endswith(row)


def test_a_ONE_BYTE_newline_file_RESUMES(tmp_path):
    """mutants 12 / 48 (`> 1`): a file of exactly "\\n" is a complete (empty) line — resume, no header."""
    text, row = _ecg_after(tmp_path, b"\n")
    assert text == "\n" + row


def test_the_torn_tail_test_reads_the_LAST_byte(tmp_path):
    """mutant 21 (`seek(2)`) reads the THIRD byte, mutant 24 (`seek(-2, 2)`) the second-last: each misses
    a torn tail whose decisive byte is elsewhere, and appends to the fragment, fusing two rows."""
    text, row = _ecg_after(tmp_path / "a", b"ab\nxyz")  # 3rd byte is "\n", the last is not
    assert text == "ab\n" + row
    text, row = _ecg_after(tmp_path / "b", b"row\nz")  # 2nd-last is "\n", the last is not
    assert text == "row\n" + row


def test_a_newline_at_byte_ZERO_is_a_complete_line_to_keep(tmp_path):
    """mutants 42 / 43 (`_cut > 0` / `>= 1`): the only newline is the FIRST byte, so the cut keeps exactly
    one byte; the mutants truncate to nothing and start over with a header."""
    text, row = _ecg_after(tmp_path, b"\nabc")
    assert text == "\n" + row


def test_a_tail_with_NO_newline_at_all_is_cut_to_nothing_and_starts_fresh(tmp_path):
    """mutant 44 (`else 1`) keeps a one-byte stump and appends to it; mutant 47 (`resumed = size >= 0`)
    calls an emptied file resumed and writes no header."""
    text, row = _ecg_after(tmp_path, b"abc")
    assert text == H_ECG + "\n" + row


# ── the HR writer's RR sibling ──────────────────────────────────────────────────────────────────


def _hr(tmp_path, *, hr_prior=None, rr_prior=None):
    os.makedirs(tmp_path, exist_ok=True)
    p = str(tmp_path / "Polar_H10_x_20260819210000_HR.txt")
    rr = str(tmp_path / "Polar_H10_x_20260819210000_RR.txt")
    if hr_prior is not None:
        open(p, "wb").write(hr_prior)
    if rr_prior is not None:
        open(rr, "wb").write(rr_prior)
    w = writers.StreamWriter(p, "hr", fsync=False)
    w.write_hr(T0, 1_000_000_000, 60, [810])
    w.close()
    return open(rr).read()


def test_a_resumed_HR_writer_APPENDS_to_its_RR_sibling(tmp_path):
    """mutant 107 (`_rr_resume = None`): every resume truncated the RR file the night had written."""
    rr = _hr(tmp_path, hr_prior=b"h\nrow\n", rr_prior=(H_RR + "\nold;800\n").encode())
    assert rr.startswith(H_RR + "\nold;800\n") and rr.count(H_RR) == 1 and ";810" in rr, rr


def test_a_FRESH_HR_writer_does_not_append_to_a_stale_RR(tmp_path):
    """mutants 109 (`resumed or …`) / 124 (`"a" if … or True`): with no HR file to resume, a stale RR
    left on disk must be replaced, not continued."""
    rr = _hr(tmp_path, rr_prior=b"stale;1\n")
    assert "stale" not in rr and rr.startswith(H_RR + "\n"), rr


def test_RR_resume_is_decided_by_its_OWN_size(tmp_path):
    """mutant 112 (`>= 0`): an EMPTY RR beside a resumed HR still needs its header; mutant 113 (`> 1`): a
    one-byte RR is a file to append to, not one to replace."""
    rr = _hr(tmp_path / "a", hr_prior=b"h\nrow\n", rr_prior=b"")
    assert rr.startswith(H_RR + "\n"), rr
    rr = _hr(tmp_path / "b", hr_prior=b"h\nrow\n", rr_prior=b"\n")
    assert rr.startswith("\n") and H_RR not in rr, rr


# ── the ECG anchor scan ─────────────────────────────────────────────────────────────────────────


def _resume_anchor(tmp_path, body: str):
    os.makedirs(tmp_path, exist_ok=True)
    p = str(tmp_path / "Polar_H10_x_20260819210000_ECG.txt")
    open(p, "w").write(H_ECG + "\n" + body)
    w = writers.StreamWriter(p, "ecg", fsync=False)
    anchor = w._first_ns
    w.close()
    return anchor


def test_the_anchor_scan_skips_a_COMMENT_even_when_it_has_a_numeric_second_field(tmp_path):
    """mutant 158 (`#… and Phone`): a `#` line is skipped only when it is ALSO the header — so a comment
    whose second field is digits became the anchor."""
    assert _resume_anchor(tmp_path, "# note;42\n2026-08-19T21:00:00.000;1000000000;0.0;5\n") == 1_000_000_000


def test_the_anchor_scan_skips_a_line_with_no_separator_and_takes_a_two_field_row(tmp_path):
    """mutant 173 (`len >= 1`) indexes `_c[1]` on a line with no `;` and raises; mutant 174 (`len > 2`)
    refuses a row with exactly two fields."""
    assert _resume_anchor(tmp_path / "a", "garbage\n2026-08-19T21:00:00.000;1000000000;0.0;5\n") == 1_000_000_000
    assert _resume_anchor(tmp_path / "b", "2026-08-19T21:00:00.000;1000000000\n") == 1_000_000_000


def test_the_anchor_scan_accepts_a_NEGATIVE_device_count(tmp_path):
    """mutants 175 / 176 (`lstrip(None)` / `rstrip("-")`): the sign is stripped only for the digit test,
    so a negative counter is still a number — the mutants skip it."""
    assert _resume_anchor(tmp_path, "2026-08-19T21:00:00.000;-5;0.0;5\n") == -5


def test_an_unreadable_anchor_is_LOGGED_naming_the_file(tmp_path, monkeypatch, caplog):
    """mutants 186-188: the warning's path argument dropped or replaced. A column left empty for the rest of
    a night must say which file, or nobody can find it."""
    import builtins

    p = str(tmp_path / "Polar_H10_x_20260819210000_ECG.txt")
    open(p, "w").write(H_ECG + "\n2026-08-19T21:00:00.000;1000000000;0.0;5\n")
    real = builtins.open

    def _eio(file, mode="r", *a, **k):
        if file == p and mode == "r":
            raise OSError(5, "Input/output error")
        return real(file, mode, *a, **k)

    monkeypatch.setattr(builtins, "open", _eio)
    with caplog.at_level(logging.WARNING, logger="tepna-capture"):
        w = writers.StreamWriter(p, "ecg", fsync=False)
    monkeypatch.setattr(builtins, "open", real)
    w.close()
    msgs = [r.getMessage() for r in caplog.records if "could not be read back" in r.getMessage()]
    assert msgs == [f"ECG resume: {p} could not be read back, so its relative ms column is left empty"], msgs


# ── the run sidecar's channel labels ────────────────────────────────────────────────────────────


def test_the_axis_labels_are_the_headers_SAMPLE_columns(tmp_path):
    """mutant 196 (`split(None)`) splits the header on whitespace; mutant 199 (`[2:6]`) takes the PPG
    `ambient` column as a fourth optical channel."""
    a = writers.StreamWriter(str(tmp_path / "Polar_H10_x_20260819210000_ACC.txt"), "acc", fsync=False)
    p = writers.StreamWriter(str(tmp_path / "Polar_Sense_x_20260819210000_PPG.txt"), "ppg", fsync=False)
    try:
        assert a._axis_labels == ("X [mg]", "Y [mg]", "Z [mg]")
        assert p._axis_labels == ("channel 0", "channel 1", "channel 2")
    finally:
        a.close()
        p.close()


# ── sized by Codex (read-only, source only), each verified here by applying the mutant ──────────


def test_a_failed_flush_is_logged_naming_the_FILE(tmp_path, caplog):
    """mutant 4 (`_FlushHealth(None)`): the write-failure warning names the path it could not write.

    The failure is INJECTED on the handle (ENOSPC from flush), never borrowed from `/dev/full`: under the
    resume-path mutants a writer pointed at `/dev/full` READS it, and an endless stream of zero bytes with no
    newline took the mutation run down (3 mutants UNDECIDED, segfault). A test must not hand the code under
    test an infinite device."""
    import errno

    p = str(tmp_path / "Polar_H10_x_20260819210000_ECG.txt")
    w = writers.StreamWriter(p, "ecg", fsync=False)
    real = w._fh

    class _NoSpace:
        def flush(self):
            raise OSError(errno.ENOSPC, "No space left on device")

        def __getattr__(self, name):
            return getattr(real, name)

    w._fh = _NoSpace()
    with caplog.at_level(logging.WARNING, logger="tepna-capture"):
        w.flush()
    w._fh = real
    w.close()
    msgs = [r.getMessage() for r in caplog.records if "WRITE FAILED" in r.getMessage()]
    assert msgs and msgs[0].startswith(f"{p}: WRITE FAILED"), msgs


def _seams_at_rel(tmp_path, stream, header, prior_rows, write):
    os.makedirs(tmp_path, exist_ok=True)
    p = str(tmp_path / f"Polar_Sense_x_20260819210000_{stream.upper()}.txt")
    open(p, "w").write(header + "\n" + "".join(prior_rows))
    w = writers.StreamWriter(p, stream, fsync=False)
    write(w)
    w.close()
    seams = [f for f in os.listdir(tmp_path) if "SEAMS" in f]
    rows = [
        r for f in seams for r in open(tmp_path / f).read().splitlines() if r and not r.startswith(("#", "phone_ts"))
    ]
    return [r.split(";")[-1] for r in rows]


def test_the_ANCHOR_SCAN_is_ECG_only_so_a_resumed_gyro_seam_is_measured_from_its_seed(tmp_path):
    """mutant 145 (`resumed or stream == "ecg"`): the ECG anchor scan also ran on a resumed GYRO file and
    handed its FIRST row to the seam sidecar, so a seam's `at_rel_ms` moved from the last pre-resume sample
    (the seed) to the file's first sample — 98000 ms became 99000 ms."""
    prior = [
        "2026-08-19T00:00:00.000;1000000000;0;0;0\n",
        "2026-08-19T00:00:01.000;2000000000;0;0;0\n",
    ]
    got = _seams_at_rel(
        tmp_path,
        "gyro",
        writers.StreamWriter.HEADERS["gyro"],
        prior,
        lambda w: w.write_gyro(dt.datetime(2026, 8, 19, 0, 0, 2), 100_000_000_000, 0.0, 1, 2, 3),
    )
    assert got and float(got[0]) == 98000.0, got


def test_an_UNKNOWN_stream_resuming_a_file_has_no_axis_labels_rather_than_a_KeyError(tmp_path):
    """mutant 194 (`if (stream in HEADERS) or True`): resuming a non-empty file under a stream the header
    table does not know reached `HEADERS[stream]` and raised. (A FRESH unknown stream raises earlier, at the
    header write, on both.)"""
    p = str(tmp_path / "x_UNKNOWN.txt")
    open(p, "w").write("x\n")
    w = writers.StreamWriter(p, "unknown", fsync=False)
    try:
        assert w._axis_labels == ()
    finally:
        w.close()


def _unflushed_size(path, rows, write):
    w = writers.StreamWriter(
        path, os.path.basename(path).rsplit("_", 1)[1].split(".")[0].lower(), fsync=False, flush_interval=float("inf")
    )
    for i in range(rows):
        write(w, i)
    sizes = (os.path.getsize(path), os.path.getsize(w._rr_path) if w._rr_path else None)
    w.close()
    return sizes


def test_the_data_file_buffers_ONE_MiB_before_touching_disk(tmp_path):
    """mutants 56 / 65 / 66: the 1 MiB write buffer is deliberate (one syscall per MiB at 130 Hz). With the
    default buffer, 1,000 ECG rows reach disk unflushed; with 2 MiB, 30,000 rows (~1.35 MiB) do not."""
    ecg = lambda w, i: w.write_ecg(T0, 1_000_000_000 + i, 0.0, 100)  # noqa: E731
    small, _ = _unflushed_size(str(tmp_path / "a_x_ECG.txt"), 1_000, ecg)
    big, _ = _unflushed_size(str(tmp_path / "b_x_ECG.txt"), 30_000, ecg)
    assert small == 0 and big > 0, (small, big)


def test_the_RR_sibling_buffers_ONE_MiB_too(tmp_path):
    """mutants 121 / 130 / 131: the same buffer on the HR writer's RR sibling."""
    hr = lambda w, i: w.write_hr(T0, 1_000_000_000 + i, 60, [1000])  # noqa: E731
    _, small = _unflushed_size(str(tmp_path / "a_x_HR.txt"), 1_000, hr)
    _, big = _unflushed_size(str(tmp_path / "b_x_HR.txt"), 50_000, hr)
    assert small == 0 and big > 0, (small, big)
