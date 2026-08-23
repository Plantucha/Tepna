# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The OxyII inventory ledger (charter G2).

The assertions that matter here are not the happy paths — they are the three places this module
disagrees with the acquisition code it will eventually replace the guesswork in:

  1. a RIGHT-SIZED file that never finalised is PARTIAL, not complete;
  2. an unknown file on disk is re-pullable, not trusted;
  3. the ledger's current view is LAST ROW WINS BY POSITION, so a deliberate regression survives.

Each is planted as a control that fails if the rule is dropped."""
import json
import os

import oxy_inventory as inv

_MAGIC = bytes([0x48, 0x12, 0x5A, 0xDA])


def _trailer(ok: bool) -> bytes:
    """48 bytes shaped like a Format-A trailer, with or without the finalisation sub-magic at [4:8]."""
    t = bytearray(48)
    if ok:
        t[4:8] = _MAGIC
    return bytes(t)


def _parse(data):
    """A stand-in for `oxyii.parse_oxy_trailer` with the SAME contract: None unless the last 48 bytes
    carry the sub-magic. Injected rather than imported so these tests pin the ledger's logic, not the
    protocol parser's — that one has its own tests."""
    if len(data) < 48 or data[-48:][4:8] != _MAGIC:
        return None
    return {"finalized": True}


# ── identity ────────────────────────────────────────────────────────────────────────────────────
def test_identity_is_device_plus_stamp_never_a_stamp_alone():
    """Two rings can carry the same session stamp, and the stamp is the ring's RTC — which
    O2RING-TIME-CAPABILITY work measured drifting and resetting on battery events. A stamp alone is
    not an identity."""
    a = inv.identity("S8AW2100", "20260813202245")
    b = inv.identity("OTHERRING", "20260813202245")
    assert a != b, "same stamp on two devices must not collide"
    assert inv.identity("S8AW2100", "20260813202245") == a, "identity is stable"


def test_identity_excludes_the_fields_that_change_mid_transfer():
    """Size and hash are VERIFICATION fields, not key material. If they keyed the record, a partial
    download would key differently from its own completion and the ledger could never close the loop."""
    row_part = inv.make_row("R", "20260101000000", inv.PARTIAL, size=10, sha256="aa", at=1.0)
    row_done = inv.make_row("R", "20260101000000", inv.VERIFIED, size=99, sha256="bb", at=2.0)
    assert row_part["id"] == row_done["id"]


# ── classify: the rule this module exists for ───────────────────────────────────────────────────
def test_no_bytes_is_discovered():
    assert inv.classify(None, 1000, _parse)[0] == inv.DISCOVERED
    assert inv.classify(b"", 1000, _parse)[0] == inv.DISCOVERED


def test_short_of_the_reported_size_is_partial():
    state, reason = inv.classify(b"x" * 10, 1000, _parse)
    assert state == inv.PARTIAL
    assert "10 of 1000" in reason, "the reason must carry both numbers, or it cannot be acted on"


def test_RIGHT_SIZED_BUT_UNFINALISED_IS_PARTIAL():
    """🔴 THE CONTROL THIS MODULE EXISTS FOR. `parse_oxy_trailer`'s docstring: the ring can report a
    file's full size BEFORE the trailer flushes, so size-equality is not a completeness check. A
    caller that stopped at "size matches" would call this file done."""
    body = b"x" * 200 + _trailer(ok=False)
    state, reason = inv.classify(body, len(body), _parse)
    assert state == inv.PARTIAL, "right size is not finalised"
    assert "not finalised" in reason


def test_a_finalised_trailer_is_verified():
    body = b"x" * 200 + _trailer(ok=True)
    state, reason = inv.classify(body, len(body), _parse)
    assert state == inv.VERIFIED
    assert "finalised" in reason


def test_classify_without_a_reported_size_still_demands_the_trailer():
    """No size to compare against removes the cheap check, never the real one."""
    assert inv.classify(b"x" * 200 + _trailer(ok=False), None, _parse)[0] == inv.PARTIAL
    assert inv.classify(b"x" * 200 + _trailer(ok=True), None, _parse)[0] == inv.VERIFIED


def test_sha256_is_over_the_whole_file():
    a = inv.sha256_bytes(b"abc")
    assert a == inv.sha256_bytes(b"abc")
    assert a != inv.sha256_bytes(b"abd"), "a one-byte change must move the hash"


# ── rows ────────────────────────────────────────────────────────────────────────────────────────
def test_make_row_rejects_an_unknown_state():
    """A typo'd state would otherwise sit in the ledger forever and read as a state nobody handles."""
    try:
        inv.make_row("R", "20260101000000", "PROBABLY_FINE", at=1.0)
    except ValueError as e:
        assert "unknown state" in str(e)
    else:
        raise AssertionError("an unknown state must not be recordable")


def test_make_row_takes_an_injected_clock_and_falls_back_to_the_real_one():
    assert inv.make_row("R", "20260101000000", inv.DISCOVERED, at=1234.5)["at"] == 1234.5
    assert inv.make_row("R", "20260101000000", inv.DISCOVERED)["at"] > 0


# ── append-only JSONL ───────────────────────────────────────────────────────────────────────────
def test_append_creates_the_parent_and_never_rewrites(tmp_path):
    led = str(tmp_path / "deep" / "nested" / "inventory.jsonl")
    inv.append_row(led, inv.make_row("R", "20260101000000", inv.DISCOVERED, at=1.0))
    inv.append_row(led, inv.make_row("R", "20260101000000", inv.VERIFIED, at=2.0))
    lines = open(led, encoding="utf-8").read().strip().split("\n")
    assert len(lines) == 2, "append-only: the first row survives the second"
    assert json.loads(lines[0])["state"] == inv.DISCOVERED


def test_append_into_an_existing_directory_needs_no_mkdir(tmp_path):
    led = str(tmp_path / "inventory.jsonl")
    inv.append_row(led, inv.make_row("R", "20260101000000", inv.DISCOVERED, at=1.0))
    assert os.path.exists(led)


def test_append_to_a_bare_relative_filename(tmp_path, monkeypatch):
    """`os.path.dirname` of a bare name is empty — the mkdir branch must not fire on it."""
    monkeypatch.chdir(tmp_path)
    inv.append_row("inventory.jsonl", inv.make_row("R", "20260101000000", inv.DISCOVERED, at=1.0))
    assert os.path.exists(tmp_path / "inventory.jsonl")


def test_load_skips_a_torn_final_line_instead_of_refusing_the_file(tmp_path):
    """⚠️ TOLERANT ON PURPOSE. A kill mid-write leaves a torn line; refusing to read the ledger over it
    would turn a recoverable partial write into total loss of history — the opposite of append-only's
    point. Blank lines, non-JSON, non-objects and objects without an id are all skipped."""
    led = str(tmp_path / "inventory.jsonl")
    inv.append_row(led, inv.make_row("R", "20260101000000", inv.DISCOVERED, at=1.0))
    with open(led, "a", encoding="utf-8") as fh:
        fh.write("\n")
        fh.write("{not json at all\n")
        fh.write('"a bare string"\n')
        fh.write('{"no":"id"}\n')
        fh.write('{"id":"R/2","state":"DISCOVERED"}\n')
        fh.write('{"id":"R/3","state":"PART')          # torn mid-write
    rows = inv.load_rows(led)
    assert [r["id"] for r in rows] == ["R/20260101000000", "R/2"]


def test_load_of_an_absent_ledger_is_empty_not_an_error(tmp_path):
    assert inv.load_rows(str(tmp_path / "nope.jsonl")) == []


def test_current_is_LAST_ROW_WINS_BY_POSITION(tmp_path):
    """🔴 NOT by `at`, and NOT by state rank. Position is the only ordering an append-only file
    guarantees: same-second retries share an `at`, and a deliberate regression — VERIFIED then PARTIAL
    after the file is found corrupt — MUST be honoured, which a max-by-rank would silently discard."""
    rows = [
        inv.make_row("R", "20260101000000", inv.VERIFIED, size=100, at=5.0),
        inv.make_row("R", "20260101000000", inv.PARTIAL, size=40, reason="corrupt on re-read", at=5.0),
    ]
    cur = inv.current(rows)
    assert cur["R/20260101000000"]["state"] == inv.PARTIAL, "the regression must win"


# ── reconcile ───────────────────────────────────────────────────────────────────────────────────
def _rows(*specs):
    return [inv.make_row(d, s, st, size=sz, at=1.0) for (d, s, st, sz) in specs]


def test_reconcile_leaves_a_verified_file_alone():
    rows = _rows(("R", "20260101000000", inv.VERIFIED, 500))
    out = inv.reconcile(rows, {"R/20260101000000": 500})
    assert out["verified"] == ["R/20260101000000"]
    assert out["repull"] == [] and out["missing"] == [] and out["size_drift"] == []


def test_reconcile_treats_committed_like_verified():
    rows = _rows(("R", "20260101000000", inv.COMMITTED, 500))
    assert inv.reconcile(rows, {"R/20260101000000": 500})["verified"] == ["R/20260101000000"]


def test_reconcile_verified_without_a_recorded_size_is_still_verified():
    rows = [inv.make_row("R", "20260101000000", inv.VERIFIED, size=None, at=1.0)]
    assert inv.reconcile(rows, {"R/20260101000000": 500})["verified"] == ["R/20260101000000"]


def test_reconcile_reports_SIZE_DRIFT_separately_from_repull():
    """A VERIFIED recording whose bytes changed underneath us is neither re-trusted nor quietly
    re-pulled — it is a fact someone must look at, so it gets its own class."""
    rows = _rows(("R", "20260101000000", inv.VERIFIED, 500))
    out = inv.reconcile(rows, {"R/20260101000000": 512})
    assert out["size_drift"] == ["R/20260101000000"]
    assert out["verified"] == [] and out["repull"] == []


def test_reconcile_repulls_partial_and_discovered():
    rows = _rows(("R", "20260101000000", inv.PARTIAL, 40), ("R", "20260101000001", inv.DISCOVERED, None))
    out = inv.reconcile(rows, {"R/20260101000000": 40, "R/20260101000001": 0})
    assert out["repull"] == ["R/20260101000000", "R/20260101000001"]


def test_reconcile_reports_a_known_recording_that_is_no_longer_on_disk_as_MISSING():
    """Distinct from `repull` because a missing file may mean a moved tree rather than a bad transfer,
    and those want different responses."""
    rows = _rows(("R", "20260101000000", inv.VERIFIED, 500))
    out = inv.reconcile(rows, {})
    assert out["missing"] == ["R/20260101000000"] and out["verified"] == []


def test_AN_UNKNOWN_FILE_ON_DISK_IS_REPULL_NOT_VERIFIED():
    """🔴 Bytes with no ledger row have never been validated by anything. Trusting them because they
    exist is exactly the "size equality means complete" assumption this module replaces."""
    out = inv.reconcile([], {"R/20260101000000": 500})
    assert out["repull"] == ["R/20260101000000"]
    assert out["verified"] == []


def test_reconcile_is_pure_and_does_not_mutate_its_inputs():
    rows = _rows(("R", "20260101000000", inv.VERIFIED, 500))
    listing = {"R/20260101000000": 500}
    before = json.dumps(rows, sort_keys=True), dict(listing)
    inv.reconcile(rows, listing)
    assert (json.dumps(rows, sort_keys=True), listing) == before
