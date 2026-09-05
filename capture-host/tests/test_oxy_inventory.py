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
import pathlib
import re

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
def test_the_row_KEY_SET_is_the_ledger_contract():
    """🔴 ONE ASSERTION, TWELVE MUTANTS. Every consumer reads a row by subscript — `row["device_id"]`,
    `row["state"]` — so the KEY NAMES are the contract, not decoration. Mutation found 12 survivors on
    `make_row` renaming keys (`"device_id"` → `"DEVICE_ID"`, `"session"` → `"XXsessionXX"`): the
    module's own logic passes either way, and every reader breaks.

    ⚠️ DELIBERATELY THE WHOLE SET, NOT TWELVE FIELD ASSERTIONS. Pinning a dict literal field by field
    is the shape that makes a suite brittle without making it truthful — it re-states the
    implementation instead of the contract, and it grows a line every time the row does. One equality
    on the key set says the same thing once, fails loudly on a rename, and fails on an accidental
    ADDITION too, which twelve individual checks would not catch at all."""
    row = inv.make_row("R", "20260101000000", inv.DISCOVERED, at=1.0)
    assert set(row) == {
        "id", "device_id", "session", "state", "reason",
        "size", "reported_size", "sha256", "path", "attempt", "at",
        # `failure` — added DELIBERATELY by G1 (#1702), which is the whole point of asserting the
        # SET: this test went red the moment the key appeared, and extending it is a decision someone
        # had to make rather than a diff that slipped through. It carries the failure CLASS label,
        # not prose — `reason` explains to a human, this is what `oxy_transfer.select()` branches on,
        # so a permanent failure can never be retried by a string mismatch.
        "failure",
    }, "a renamed or added ledger key breaks every reader that subscripts it"


def test_the_row_key_set_survives_a_round_trip_through_the_ledger(tmp_path):
    """The keys must survive JSONL, not just exist in memory — that is where consumers actually read
    them from."""
    led = str(tmp_path / "inventory.jsonl")
    inv.append_row(led, inv.make_row("R", "20260101000000", inv.VERIFIED, size=5, at=1.0))
    assert set(inv.load_rows(led)[0]) == set(inv.make_row("R", "20260101000000", inv.VERIFIED, at=1.0))


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


def test_append_survives_a_second_call_into_an_existing_tree(tmp_path):
    """`exist_ok=True` is the whole directory story now that the `isdir` pre-check is gone, so it has
    to be observable: a second append into a tree that already exists must not raise. With
    `exist_ok=False` this is a FileExistsError."""
    led = str(tmp_path / "deep" / "inventory.jsonl")
    inv.append_row(led, inv.make_row("R", "20260101000000", inv.DISCOVERED, at=1.0))
    inv.append_row(led, inv.make_row("R", "20260101000000", inv.PARTIAL, at=2.0))
    assert len(open(led, encoding="utf-8").read().strip().split("\n")) == 2


def test_the_ledger_round_trips_NON_ASCII(tmp_path):
    """🔴 The encoding is explicit on both ends, and this is what proves it. A `reason` can carry a
    device name or a path, and on a host whose default encoding is not UTF-8 an implicit `open()`
    writes or reads mojibake — or raises. Every other test here is pure ASCII, under which
    `encoding="utf-8"` and the platform default are indistinguishable."""
    led = str(tmp_path / "inventory.jsonl")
    reason = "réveil du capteur — 温度 drift, 0.5 °C"
    inv.append_row(led, inv.make_row("R", "20260101000000", inv.PARTIAL, reason=reason, at=1.0))
    assert inv.load_rows(led)[0]["reason"] == reason


def test_append_to_a_bare_relative_filename(tmp_path, monkeypatch):
    """`os.path.dirname` of a bare name is empty — the mkdir branch must not fire on it."""
    monkeypatch.chdir(tmp_path)
    inv.append_row("inventory.jsonl", inv.make_row("R", "20260101000000", inv.DISCOVERED, at=1.0))
    assert os.path.exists(tmp_path / "inventory.jsonl")


def test_a_ledger_line_is_BYTE_STABLE_for_the_same_row(tmp_path):
    """🔴 `sort_keys=True` is the determinism property, and nothing observed it. A row serialised with
    insertion order still round-trips — `json.loads` does not care — so every functional test passes
    either way. What breaks is BYTE stability: two runs that build the same row in a different order
    produce different lines, and an append-only ledger whose bytes depend on construction order cannot
    be diffed, hashed or compared across runs.

    That is exactly the property the acquisition spec's determinism section asks for, and it was one
    unobserved keyword away from being lost."""
    a = dict(inv.make_row("R", "20260101000000", inv.VERIFIED, size=5, sha256="ab", at=1.0))
    b = {k: a[k] for k in reversed(list(a))}          # same content, opposite insertion order
    led_a, led_b = str(tmp_path / "a.jsonl"), str(tmp_path / "b.jsonl")
    inv.append_row(led_a, a)
    inv.append_row(led_b, b)
    assert open(led_a, encoding="utf-8").read() == open(led_b, encoding="utf-8").read(), (
        "the same row must serialise to the same BYTES whatever order it was built in"
    )


def test_the_default_reason_is_EMPTY_not_a_placeholder(tmp_path):
    """`reason` defaults to `""`. A mutant making it any non-empty string is a DATA change, not prose:
    every row created without an explicit reason would carry it, and `test_every_classified_recording
    _carries_a_reason`'s truthiness check in the sibling module would then pass on rows that were
    never given one."""
    assert inv.make_row("R", "20260101000000", inv.DISCOVERED, at=1.0)["reason"] == ""


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


def test_reconcile_keeps_going_after_a_missing_entry():
    """The `missing` branch must CONTINUE, not stop the scan. With `break` the first missing record
    would hide every later one — and a restart-recovery pass that silently stops at the first gap is
    worse than none, because the report looks complete."""
    rows = _rows(
        ("R", "20260101000000", inv.VERIFIED, 500),   # absent from disk -> missing
        ("R", "20260101000001", inv.PARTIAL, 40),     # present -> must still be classified
        ("R", "20260101000002", inv.VERIFIED, 700),   # present -> must still be classified
    )
    out = inv.reconcile(rows, {"R/20260101000001": 40, "R/20260101000002": 700})
    assert out["missing"] == ["R/20260101000000"]
    assert out["repull"] == ["R/20260101000001"], "a later PARTIAL must not be lost to the gap"
    assert out["verified"] == ["R/20260101000002"], "nor a later VERIFIED"


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


# ─────────────────────────────────────────────────────────────────────────────────────────────────
# MUTATION RESIDUE, triaged 2026-09-04 (OXYII-ACQUISITION-CHARTER G1, the owed work-unit).
#
# Re-run under `mutate.py oxy_inventory --no-reuse` leaves 12 survivors, not the 28 recorded on
# 2026-08-23 — tests landed since then killed 16 (`make_row` 14 -> 1, `append_row` 6 -> 3). Of the
# 12, `tools/mutate_triage.py` classes 8 UNOBSERVABLE and 4 REACHABLE, and all 4 REACHABLE are one
# defect wearing two shapes:
#
#     open(ledger_path, "a", encoding="utf-8")  ->  encoding=None   /   encoding omitted
#     open(ledger_path,      encoding="utf-8")  ->  encoding=None   /   encoding omitted
#
# Dropping the explicit encoding makes the ledger's encoding the PLATFORM DEFAULT. On this box that
# is UTF-8, so the mutants behave identically and no behavioural test can see them — which is
# precisely why they survived 245 killed mutants. The defect is real anyway: the ledger is UTF-8 by
# intent, it holds device-supplied filenames, and on a non-UTF-8 locale the write and the read would
# disagree about bytes nobody chose.
#
# So this is a SOURCE-SCAN invariant, deliberately, in the same family as the AS11 read-only scan:
# the property is not observable at runtime here, and a scan is the only instrument that can see it.
# It also kills both shapes at once, because mutmut rewrites the source the scan reads.
def test_every_open_in_the_module_NAMES_its_encoding():
    src = pathlib.Path(__file__).resolve().parent.parent / "oxy_inventory.py"
    text = src.read_text(encoding="utf-8")
    bad = []
    for i, line in enumerate(text.splitlines(), 1):
        if re.search(r"\bopen\s*\(", line) and "encoding=" not in line:
            bad.append(f"{i}: {line.strip()}")
        elif re.search(r"encoding\s*=\s*None", line):
            bad.append(f"{i}: {line.strip()}")
    assert not bad, (
        "every open() of the ledger must name its encoding — without it the file is written and read "
        "in the platform default, which is not UTF-8 everywhere:\n  " + "\n  ".join(bad)
    )
