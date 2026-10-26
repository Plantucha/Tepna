# tepna-capture — tests/test_pull_once_survivors_r4.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Survivor batch `pull-once-r4-of-6` (#3855): the survivors in `pull_session._pull_once` from the
# resume-rejection branch through the classify call. The diff-scoped mutation gate mutates the whole
# function a PR touches, so these old lines red any PR that enters `_pull_once`.
#
# What these tests read, and why:
#   * The FAILED row of a REJECTED RESUME. It is the last row the ledger holds for that session once
#     the `.part` is discarded, so it must name the session, the size the ring reported and the `.part`
#     that was thrown away. A dropped field is null in the ledger and nobody can say what was refused.
#   * The walk after a rejection. The rejected session is skipped with `continue`; a `break` there
#     silently drops every session listed after it, and the caller only sees a shorter list.
#   * The VERIFYING row (T3). It is the only row that says "bytes complete on disk, validation in
#     flight", so its reason, received size, reported size and path must all be on it.
#   * The classify call's REPORTED SIZE. A short transfer whose bytes happen to end in a valid Format-A
#     trailer is still short. Without the reported size, `classify` has nothing to compare against and
#     calls the prefix VERIFIED.
#
# Every test bounds its FILE_DATA waits (`_bound_data_waits`, imported from the part-3 file). A mutant
# that stops the offset from advancing must FAIL these tests, not hang them.

import os

import oxy_inventory as inv
import pull_session
from test_oxyii import _fmt_a_file
from test_pull_once_survivors_p3 import _bound_data_waits, _dat_path, _rows
from test_pull_session import DEV, FakeRing, _install, _run

ADDR = "D1:98:62:7C:92:B3"
# A REAL Format-A file (header, records, finalised trailer): the resume path verifies by the trailer,
# and the short-transfer test needs bytes whose trailer parses. 10 + 300 * 3 + 48 = 958 bytes, so a
# full serve is two 512-byte chunks and a resume from 512 is one.
BLOB = _fmt_a_file([(96, 50 + (i % 7), i % 3) for i in range(300)])
# More FILE_DATA waits than any pull below needs (two sessions of at most three waits each).
WAIT_BOUND = 16


def _bad_part(tmp_path, ts):
    """A `.part` of the right kind of length but junk content: the resume splices onto it, the trailer
    still parses (it comes from the ring), and `oxy_transfer.verify` refuses the junk header."""
    part = tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat.part"
    part.write_bytes(b"\xff" * 512)
    return part


# ── the rejected resume: the FAILED row ─────────────────────────────────────────────────────────────
def test_a_rejected_resume_records_the_session_reported_size_and_the_discarded_part(tmp_path, monkeypatch):
    """The FAILED row is keyed on the session it rejects and names the reported size and the `.part`
    path. The received size stays null: the bytes were discarded, so there is no size to report."""
    ts = "20260720010000"
    part = _bad_part(tmp_path, ts)
    _install(monkeypatch, FakeRing([ts], BLOB))
    _bound_data_waits(monkeypatch, limit=WAIT_BOUND)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "all", True, None, "0000"))

    assert got == [], got
    assert not part.exists(), "the rejected .part is discarded"
    (failed,) = _rows(tmp_path, ts, inv.FAILED)
    assert failed["id"] == inv.identity(DEV, ts), failed
    assert failed["device_id"] == DEV and failed["session"] == ts, failed
    assert failed["reason"].startswith("resume rejected: "), failed
    assert failed["reported_size"] == len(BLOB), failed
    assert failed["path"] == _dat_path(tmp_path, ts) + ".part", failed
    assert failed["size"] is None, "the bytes were discarded: the size is absent, never 0"


def test_a_rejected_resume_skips_only_its_own_session(tmp_path, monkeypatch):
    """The session after a rejected resume is still pulled and committed."""
    rejected, fresh = "20260720010000", "20260721010000"
    _bad_part(tmp_path, rejected)
    _install(monkeypatch, FakeRing([rejected, fresh], BLOB))
    _bound_data_waits(monkeypatch, limit=WAIT_BOUND)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "all", True, None, "0000"))

    assert got == [_dat_path(tmp_path, fresh)], got
    with open(got[0], "rb") as fh:
        assert fh.read() == BLOB
    assert _rows(tmp_path, rejected, inv.FAILED), "the rejection is on the record"
    assert _rows(tmp_path, fresh, inv.COMMITTED), "the next session is walked to its commit"


# ── T3: the VERIFYING row ───────────────────────────────────────────────────────────────────────────
def test_the_verifying_row_names_its_reason_sizes_and_part(tmp_path, monkeypatch):
    """VERIFYING says the bytes are complete on disk in the `.part` and validation is in flight. A crash
    there leaves it as the last row, so it carries the received size, the reported size and the path."""
    ts = "20260719010000"
    # The ring declares FEWER bytes than its chunk delivers, so the received size (one 512-byte chunk)
    # and the reported size (500) are different numbers and neither can stand in for the other.
    _install(monkeypatch, FakeRing([ts], BLOB, declared=500))
    _bound_data_waits(monkeypatch, limit=WAIT_BOUND)

    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    (row,) = _rows(tmp_path, ts, inv.VERIFYING)
    assert row["reason"] == "bytes complete, validating", row
    assert row["size"] == 512, row
    assert row["reported_size"] == 500, row
    assert row["path"] == _dat_path(tmp_path, ts) + ".part", row


# ── the classify call: a short transfer stays PARTIAL ───────────────────────────────────────────────
def test_a_short_transfer_ending_in_a_valid_trailer_is_classified_partial(tmp_path, monkeypatch):
    """The ring declares ten bytes more than it serves. The received bytes end in a trailer that
    parses, so only the reported size shows the transfer is short. The classify row must say PARTIAL
    with the byte counts, never VERIFIED."""
    ts = "20260719010000"
    declared = len(BLOB) + 10
    _install(monkeypatch, FakeRing([ts], BLOB, declared=declared))
    _bound_data_waits(monkeypatch, limit=WAIT_BOUND)

    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    assert not _rows(tmp_path, ts, inv.VERIFIED), "a short transfer is never VERIFIED"
    (partial,) = _rows(tmp_path, ts, inv.PARTIAL)
    assert partial["reason"] == f"short: {len(BLOB)} of {declared} reported bytes", partial
    assert partial["size"] == len(BLOB) and partial["reported_size"] == declared, partial
    assert not os.path.exists(_dat_path(tmp_path, ts)), "a short transfer is not committed"
