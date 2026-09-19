# tepna-capture — tests/test_gattmap.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""BLE-TRANSPORT-REDESIGN §1.1 — the expected attribute table, keyed on the Database Hash.

The defect being guarded: bleak snapshots BlueZ's D-Bus object tree while it is still being published,
and `_settle_gatt_chars` can only notice when one of TWO hardcoded UUIDs is absent. Measured on vigil
(#2372): seven failure events, six byte-identical, holding the Generic Attribute service ALONE — no
characteristics, vendor service absent entirely. A two-UUID heuristic cannot see that as partial except
by luck. Every plant below is that tree in a different disguise.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import devcaps  # noqa: E402
import gattmap  # noqa: E402

ADDR = "AA:BB:CC:DD:EE:FF"
H = "a1b2c3d4"
TABLE = {"0000FD56-0000-1000-8000-00805F9B34FB": 0x0010, "0000fd57-0000-1000-8000-00805f9b34fb": 0x0013}


@pytest.fixture(autouse=True)
def _clean():
    # `_gatt_record_table` now DERIVES a devcaps capability from the table it records (§1.3), so this
    # file's subject writes both records and leaking either between tests would make them order-dependent.
    gattmap.reset()
    devcaps.reset()
    yield
    gattmap.reset()
    devcaps.reset()


# ── THE RULE ────────────────────────────────────────────────────────────────────────────────────────
def test_PLANT_an_unrecorded_table_is_None_never_empty():
    """`{}` would assert "this peripheral has no characteristics", under which EVERY snapshot is
    complete — the oracle answering "fine" for a tree entirely in flight, which is the failure it
    exists to catch."""
    assert gattmap.expected(ADDR, H) is None
    assert gattmap.missing(ADDR, H, []) is None


def test_PLANT_recording_an_EMPTY_table_is_REFUSED():
    """The same claim, arriving by the front door. It must not be storable at all."""
    assert gattmap.record(ADDR, H, {}, source="probe") == ""
    assert gattmap.record(ADDR, H, None, source="probe") == ""
    assert gattmap.expected(ADDR, H) is None


def test_record_that_is_not_a_mapping_is_refused_not_raised():
    """It runs beside a live link, so a bad argument returns False rather than ending the night."""
    assert gattmap.record(ADDR, H, 7, source="probe") == ""


# ── THE ORACLE ──────────────────────────────────────────────────────────────────────────────────────
def test_a_complete_snapshot_reports_NOTHING_missing():
    gattmap.record(ADDR, H, TABLE, source="probe")
    assert gattmap.missing(ADDR, H, list(TABLE)) == []


def test_PLANT_the_2026_09_09_tree_is_caught_as_partial():
    """The measured failure: the Generic Attribute service alone, vendor service absent entirely."""
    gattmap.record(ADDR, H, TABLE, source="probe")
    partial = ["00002a05-0000-1000-8000-00805f9b34fb"]
    assert gattmap.missing(ADDR, H, partial) == sorted(k.lower() for k in TABLE)


def test_PLANT_a_tree_missing_something_OTHER_than_the_two_hardcoded_uuids_is_still_caught():
    """This is the whole reason the map beats `_settle_gatt_chars`'s two-UUID wait: a tree that HAS
    both named characteristics and is still incomplete reads as settled to the heuristic."""
    gattmap.record(ADDR, H, TABLE, source="probe")
    all_but_one = [k for k in list(TABLE)[:1]]
    assert gattmap.missing(ADDR, H, all_but_one) == ["0000fd57-0000-1000-8000-00805f9b34fb"]


def test_None_and_empty_list_are_DIFFERENT_answers():
    """`None` = no oracle for this device (fall back); `[]` = the oracle ran and the tree is complete.
    Collapsing them reinstates the ambiguity devcaps was built to remove one level down."""
    assert gattmap.missing(ADDR, H, []) is None          # nothing recorded
    gattmap.record(ADDR, H, TABLE, source="probe")
    assert gattmap.missing(ADDR, H, list(TABLE)) == []   # recorded and complete
    assert gattmap.missing(ADDR, H, []) != []            # recorded and empty tree → not complete


def test_uuid_comparison_is_case_insensitive_both_ways():
    gattmap.record(ADDR, H, {"ABCD": 1}, source="probe")
    assert gattmap.missing(ADDR, H, ["abcd"]) == []
    gattmap.record(ADDR, H, {"abcd": 1}, source="probe")
    assert gattmap.missing(ADDR, H, ["ABCD"]) == []


def test_observed_that_is_not_iterable_reads_as_nothing_seen():
    gattmap.record(ADDR, H, TABLE, source="probe")
    assert gattmap.missing(ADDR, H, 5) == sorted(k.lower() for k in TABLE)


# ── STALENESS ───────────────────────────────────────────────────────────────────────────────────────
def test_PLANT_a_changed_database_hash_RE_DISCOVERS():
    """§1.1's done-when. The stored table describes a layout that no longer exists, so the honest
    answer is `None` — route back to discovery — not a stale table."""
    gattmap.record(ADDR, H, TABLE, source="probe")
    assert gattmap.expected(ADDR, "deadbeef") is None
    assert gattmap.missing(ADDR, "deadbeef", []) is None


def test_hash_normalises_bytes_and_case_so_one_device_is_one_record():
    gattmap.record(ADDR, b"\xa1\xb2\xc3\xd4", TABLE, source="probe")
    assert gattmap.expected(ADDR, "A1B2C3D4") is not None
    assert gattmap.expected(ADDR, b"\xa1\xb2\xc3\xd4") is not None


def test_a_device_with_NO_database_hash_is_checkable_against_itself_only():
    """Not a failure and not an error — a device this oracle cannot key. It answers for `None` and for
    nothing else, so it can never be checked against a hash it never published."""
    gattmap.record(ADDR, None, TABLE, source="probe")
    assert gattmap.expected(ADDR, None) is not None
    assert gattmap.expected(ADDR, H) is None
    gattmap.record(ADDR, "", TABLE, source="probe")
    assert gattmap.expected(ADDR, None) is not None      # "" normalises to None, not to a hash


def test_identity_is_the_ADDRESS_and_it_normalises():
    gattmap.record(ADDR.lower(), H, TABLE, source="probe")
    assert gattmap.expected(ADDR.upper(), H) is not None
    assert gattmap.expected("11:22:33:44:55:66", H) is None


# ── PERSISTENCE ─────────────────────────────────────────────────────────────────────────────────────
def test_the_map_survives_a_restart(tmp_path):
    """§1.1's done-when: a device's handle map survives a disconnect — and a deploy, which is the
    harder case, since the daemon restarts on every one."""
    p = str(tmp_path / "gattmap.json")
    gattmap.configure(p)
    gattmap.record(ADDR, H, TABLE, source="probe")
    gattmap.reset()
    gattmap.configure(p)
    assert gattmap.missing(ADDR, H, list(TABLE)) == []


def test_configure_with_no_path_or_missing_file_is_a_clean_empty_map(tmp_path):
    gattmap.configure(None)
    assert gattmap.expected(ADDR, H) is None
    gattmap.configure(str(tmp_path / "nope.json"))
    assert gattmap.expected(ADDR, H) is None


def test_PLANT_a_corrupt_record_must_not_stop_a_night(tmp_path):
    p = tmp_path / "gattmap.json"
    p.write_text("{not json", encoding="utf-8")
    gattmap.configure(str(p))
    assert gattmap.expected(ADDR, H) is None


def test_PLANT_an_empty_table_ON_DISK_is_rejected_at_load(tmp_path):
    """The refusal must hold at the load door too, or a hand-edited file reinstates the claim."""
    p = tmp_path / "gattmap.json"
    p.write_text(json.dumps({ADDR: {"db_hash": H, "chars": {}}}), encoding="utf-8")
    gattmap.configure(str(p))
    assert gattmap.expected(ADDR, H) is None
    assert gattmap.missing(ADDR, H, []) is None


def test_malformed_rows_on_disk_are_skipped_not_fatal(tmp_path):
    p = tmp_path / "gattmap.json"
    p.write_text(json.dumps({ADDR: "not-a-dict", "22:33": {"chars": "nope"}}), encoding="utf-8")
    gattmap.configure(str(p))
    assert gattmap.expected(ADDR, H) is None


def test_a_non_dict_json_document_loads_as_empty(tmp_path):
    p = tmp_path / "gattmap.json"
    p.write_text(json.dumps([1, 2, 3]), encoding="utf-8")
    gattmap.configure(str(p))
    assert gattmap.expected(ADDR, H) is None


def test_source_defaults_when_absent_on_disk(tmp_path):
    p = tmp_path / "gattmap.json"
    p.write_text(json.dumps({ADDR: {"db_hash": H, "chars": {"abcd": 1}}}), encoding="utf-8")
    gattmap.configure(str(p))
    assert gattmap.snapshot()[ADDR]["source"] == "loaded"


def test_an_unwritable_path_does_not_break_capture(tmp_path):
    """Telemetry must never end a recording: the in-memory map still stands."""
    gattmap.configure(str(tmp_path / "ro" / "gattmap.json"))
    (tmp_path / "ro").mkdir()
    (tmp_path / "ro").chmod(0o500)
    try:
        assert gattmap.record(ADDR, H, TABLE, source="probe") in ("new", "changed")
        assert gattmap.missing(ADDR, H, list(TABLE)) == []
    finally:
        (tmp_path / "ro").chmod(0o700)


# ── REPORTING ───────────────────────────────────────────────────────────────────────────────────────
def test_snapshot_reads_through_the_accessor_so_the_rules_live_in_one_place():
    gattmap.record(ADDR, H, TABLE, source="probe")
    snap = gattmap.snapshot()
    assert snap[ADDR] == {"db_hash": H, "chars": 2, "source": "probe"}


def test_snapshot_of_an_empty_store_is_empty():
    assert gattmap.snapshot() == {}


# ── FAILURE PATHS — mirroring test_devcaps.py's shape, because the writer is the same writer ────────
def test_recording_never_raises_into_the_capture_path(monkeypatch, tmp_path):
    """A map note must never end a recording. The in-memory table still stands; only its persistence
    was lost — so the oracle keeps working for the rest of the night."""
    def boom():
        raise RuntimeError("disk gone")
    gattmap.configure(str(tmp_path / "g.json"))
    monkeypatch.setattr(gattmap, "_flush", boom)
    assert gattmap.record(ADDR, H, TABLE, source="probe") == ""
    assert gattmap.missing(ADDR, H, list(TABLE)) == []      # in-memory table survived the write failure


def test_PLANT_a_failed_write_leaves_no_half_written_map_and_no_tmp_litter(monkeypatch, tmp_path):
    """A half-written map read at the next boot is worse than none — that is why the write is atomic
    and the temp file is removed on failure."""
    def boom(*_a, **_k):
        raise RuntimeError("write failed")
    p = tmp_path / "g.json"
    gattmap.configure(str(p))
    monkeypatch.setattr(gattmap.json, "dump", boom)
    assert gattmap.record(ADDR, H, TABLE, source="probe") in ("new", "changed")   # in-memory write succeeded
    assert not p.exists()                                           # no half-written map
    assert [f for f in os.listdir(tmp_path) if f.startswith(".gattmap-")] == []


def test_even_a_failed_CLEANUP_does_not_reach_the_capture_path(monkeypatch, tmp_path):
    """Read-only volume: the temp file cannot be removed either. The ORIGINAL map is still intact,
    which is the property that matters — and capture continues regardless."""
    def bad_dump(*_a, **_k):
        raise RuntimeError("write failed")
    def bad_unlink(*_a, **_k):
        raise OSError("read-only")
    gattmap.configure(str(tmp_path / "g.json"))
    monkeypatch.setattr(gattmap.json, "dump", bad_dump)
    monkeypatch.setattr(gattmap.os, "unlink", bad_unlink)
    assert gattmap.record(ADDR, H, TABLE, source="probe") in ("new", "changed")
    assert gattmap.missing(ADDR, H, list(TABLE)) == []


# ── THE RECORDER in capture.py — record-only, and every failure path returns a string ───────────────
import asyncio  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class _Char:
    def __init__(self, uuid, handle):
        self.uuid, self.handle = uuid, handle


class _Svc:
    def __init__(self, chars):
        self.characteristics = chars


class _Client:
    """Minimal stand-in: only the surface `_gatt_record_table` actually touches."""
    def __init__(self, chars, read=None):
        self._svcs = [_Svc(chars)]
        self._read = read

    @property
    def services(self):
        return self._svcs

    async def read_gatt_char(self, _uuid):
        if isinstance(self._read, BaseException):
            raise self._read
        return self._read


def test_recorder_PLANT_unreadable_snapshot_is_not_an_empty_one():
    """∅ again, at the writer: a client with no snapshot has told us NOTHING. Recording an empty table
    there would store the claim `gattmap` refuses, and the oracle would later call every tree complete."""
    import capture

    class _NoSnapshot:
        @property
        def services(self):
            raise RuntimeError("Service Discovery has not been performed yet")

    assert _run(capture._gatt_record_table(_NoSnapshot(), ADDR)) == "snapshot unreadable"
    assert gattmap.expected(ADDR, None) is None


def test_recorder_an_empty_tree_records_nothing():
    import capture
    assert _run(capture._gatt_record_table(_Client([]), ADDR)) == ""
    assert gattmap.expected(ADDR, None) is None


def test_recorder_records_the_table_and_reads_the_hash_when_the_tree_SHOWS_it():
    import capture
    chars = [_Char(capture.GATT_DB_HASH_UUID, 0x0003), _Char("0000fd56-0000-1000-8000-00805f9b34fb", 0x0010)]
    out = _run(capture._gatt_record_table(_Client(chars, read=b"\xde\xad\xbe\xef"), ADDR))
    assert "2 char(s)" in out and "deadbeef" in out
    assert gattmap.missing(ADDR, "deadbeef", [c.uuid for c in chars]) == []


def test_recorder_NEVER_reads_the_hash_blind():
    """A device that does not publish 0x2B2A is not a failure — it records under a None hash. The read
    must not be attempted at all, so a device that would ERROR on it is unaffected."""
    import capture
    boom = _Client([_Char("0000fd56-0000-1000-8000-00805f9b34fb", 0x0010)],
                   read=RuntimeError("must not be called"))
    out = _run(capture._gatt_record_table(boom, ADDR))
    assert "db_hash absent" in out
    assert gattmap.expected(ADDR, None) is not None


def test_recorder_an_unread_hash_is_None_never_a_fabricated_key():
    import capture
    chars = [_Char(capture.GATT_DB_HASH_UUID, 0x0003)]
    out = _run(capture._gatt_record_table(_Client(chars, read=RuntimeError("read failed")), ADDR))
    assert "db_hash absent" in out
    assert gattmap.expected(ADDR, None) is not None


def test_recorder_is_SILENT_on_an_unchanged_table(monkeypatch):
    """The noise path, at the caller: `same` must produce no phrase, so no INFO line is logged."""
    import capture
    monkeypatch.setattr(capture.gattmap, "record", lambda *_a, **_k: "same")
    assert _run(capture._gatt_record_table(_Client([_Char("abcd", 1)]), ADDR)) == ""


def test_recorder_ANNOUNCES_a_new_or_changed_table(monkeypatch):
    import capture
    monkeypatch.setattr(capture.gattmap, "record", lambda *_a, **_k: "new")
    out = _run(capture._gatt_record_table(_Client([_Char("abcd", 1)]), ADDR))
    assert out.startswith("new — ") and "1 char(s)" in out


def test_recorder_reports_nothing_when_the_map_REFUSES_the_write(monkeypatch):
    import capture
    monkeypatch.setattr(capture.gattmap, "record", lambda *_a, **_k: "")
    assert _run(capture._gatt_record_table(_Client([_Char("abcd", 1)]), ADDR)) == ""


# ── THE WAIT HINT — a hint, never an assertion ──────────────────────────────────────────────────────
def test_wait_hint_is_None_when_nothing_was_recorded():
    """`None` is what makes the oracle safe to land dormant: the caller's union is unchanged, so a
    device nobody has recorded behaves exactly as it did before this existed."""
    assert gattmap.wait_hint(ADDR) is None


def test_wait_hint_IGNORES_the_hash_on_purpose():
    """The circularity it exists for: looking up by hash needs the hash, reading the hash needs the
    tree, and the tree is what the caller is waiting for. `expected()` stays hash-keyed; this does not."""
    gattmap.record(ADDR, H, TABLE, source="probe")
    assert gattmap.wait_hint(ADDR) == {k.lower() for k in TABLE}
    assert gattmap.expected(ADDR, "deadbeef") is None      # the hash-keyed accessor still refuses
    assert gattmap.wait_hint(ADDR) == {k.lower() for k in TABLE}   # the hint does not


def test_wait_hint_never_returns_an_empty_set(tmp_path):
    """Same rule as `expected`: an empty hint would mean "wait for nothing", which is indistinguishable
    from having no record and would hide the difference."""
    p = tmp_path / "g.json"
    p.write_text(json.dumps({ADDR: {"db_hash": H, "chars": {}}}), encoding="utf-8")
    gattmap.configure(str(p))
    assert gattmap.wait_hint(ADDR) is None


def test_wait_hint_for_an_unknown_address_is_None():
    gattmap.record(ADDR, H, TABLE, source="probe")
    assert gattmap.wait_hint("11:22:33:44:55:66") is None


# ── THE NOISE DEFECT — measured on vigil, 2026-09-17 (Wren) ─────────────────────────────────────────
def test_PLANT_an_UNCHANGED_table_writes_nothing_and_says_so(tmp_path):
    """~112 byte-identical records in one hour, one per ~34 s CPAP poll, every one the same 14
    characteristics and the same hash. Idempotent, so the map was never harmed — and >100 INFO lines
    an hour carrying no information, which is how a real event gets buried. An unchanged table must
    now write NOTHING and report `same`."""
    p = tmp_path / "g.json"
    gattmap.configure(str(p))
    assert gattmap.record(ADDR, H, TABLE, source="probe") == "new"
    before = p.read_bytes()
    mtime = p.stat().st_mtime_ns
    for _ in range(5):
        assert gattmap.record(ADDR, H, TABLE, source="probe") == "same"
    assert p.read_bytes() == before
    assert p.stat().st_mtime_ns == mtime      # not merely identical CONTENT — not rewritten at all


def test_a_CHANGED_table_is_the_event_the_oracle_cares_about(tmp_path):
    gattmap.configure(str(tmp_path / "g.json"))
    assert gattmap.record(ADDR, H, TABLE, source="probe") == "new"
    assert gattmap.record(ADDR, "deadbeef", TABLE, source="probe") == "changed"   # hash moved
    assert gattmap.record(ADDR, "deadbeef", {"abcd": 1}, source="probe") == "changed"  # table moved
    assert gattmap.record(ADDR, "deadbeef", {"abcd": 1}, source="probe") == "same"


def test_the_outcome_distinguishes_a_FIRST_sighting_from_the_hundredth_confirmation():
    """The bool it returned before could not express this: the caller could not tell a fresh table
    from the hundredth confirmation of an old one, which is exactly what produced the noise."""
    assert gattmap.record(ADDR, H, TABLE, source="probe") == "new"
    assert gattmap.record(ADDR, H, TABLE, source="probe") == "same"


def test_recorded_at_is_stamped_and_is_NOT_a_last_confirmed_field(tmp_path):
    """The Database Hash IS the staleness signal by design, so a matching hash already means current.
    A last-confirmed stamp would need a write on every connect — the cost just removed. This records
    when the table was FIRST seen or last CHANGED, and the test pins that it does not drift on a
    confirmation."""
    gattmap.configure(str(tmp_path / "g.json"))
    gattmap.record(ADDR, H, TABLE, source="probe", now=1000)
    gattmap.record(ADDR, H, TABLE, source="probe", now=9999)   # a confirmation
    raw = json.loads((tmp_path / "g.json").read_text(encoding="utf-8"))
    assert raw[ADDR]["recorded_at"] == 1000
    gattmap.record(ADDR, "deadbeef", TABLE, source="probe", now=9999)  # a real change
    raw = json.loads((tmp_path / "g.json").read_text(encoding="utf-8"))
    assert raw[ADDR]["recorded_at"] == 9999


def test_recorded_at_defaults_to_the_clock_when_not_supplied(tmp_path):
    gattmap.configure(str(tmp_path / "g.json"))
    gattmap.record(ADDR, H, TABLE, source="probe")
    raw = json.loads((tmp_path / "g.json").read_text(encoding="utf-8"))
    assert raw[ADDR]["recorded_at"] > 1_700_000_000


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# REACHABILITY FROM THE WEARABLE RAILS (GATT-HANDLE-MAP §2b③, the defect Wren measured 2026-09-18)
# ══════════════════════════════════════════════════════════════════════════════════════════════════
def test_every_wearable_RAIL_reaches_the_recorder():
    """THE DEFECT THIS NEGATES, measured on vigil 2026-09-18 (Wren): `_gatt_record_table` had EXACTLY
    ONE caller, inside `_cpap_ble_connect`, and the wearable connect paths held ZERO gattmap references.
    So the map's silence on H10 / Verity / O2Ring was a fact about the WIRING, not about the devices —
    and a night of wearing them would have produced exactly the same silence. The live proof was a
    Verity worn twice that day with `gattmap.json` unchanged and no record line either time.

    The bar is the negation of that measurement: every rail that opens a wearable link must CALL the
    recorder. Asserted over the AST rather than by grepping the file, so it is a statement about each
    function's body and cannot be satisfied by the identifier appearing in a comment or in a sibling
    rail. A rail added later with no record call fails here, which is the point — this is the check
    that would have caught the original omission."""
    import ast as _ast
    import pathlib as _pl

    src = _pl.Path(__file__).resolve().parent.parent / "capture.py"
    tree = _ast.parse(src.read_text())
    bodies = {n.name: n for n in _ast.walk(tree)
              if isinstance(n, (_ast.FunctionDef, _ast.AsyncFunctionDef))}

    # value = the recorder entry point that rail must reach. The wearables go through the
    # `_gatt_record_rail` wrapper; CPAP calls the table recorder directly and is kept here so a
    # regression on the rail that ALREADY worked also reds.
    RAILS = {
        "run_polar": ("_gatt_record_rail", "Polar H10 + Verity Sense (PMD + the SIG Heart Rate char)"),
        "run_viatom": ("_gatt_record_rail", "Wellue/Viatom O2Ring (legacy Viatom protocol)"),
        "run_oxyii": ("_gatt_record_rail", "Wellue O2Ring-S / T8520 (OxyII protocol)"),
        "_cpap_ble_connect": ("_gatt_record_table", "CPAP AS11 — the rail that already had it"),
    }
    missing = []
    for rail, (entry, why) in RAILS.items():
        fn = bodies.get(rail)
        assert fn is not None, f"{rail} no longer exists — update this test deliberately, not reflexively"
        calls = {c.func.id for c in _ast.walk(fn)
                 if isinstance(c, _ast.Call) and isinstance(c.func, _ast.Name)}
        if entry not in calls:
            missing.append(f"{rail} ({why}) — no call to {entry}")
    assert not missing, "rails that open a link and never record their GATT table: " + "; ".join(missing)


def test_the_recorder_is_a_NO_OP_on_a_second_call_in_one_connect():
    """Why calling the recorder from several streams of one connect is safe, which is what lets each rail
    record from whichever stream subscribes first without tracking which one did. `client.services` is a
    snapshot frozen at connect, so the second call sees identical bytes: `record` answers "same" and
    `_gatt_record_table` returns "" — no write, and nothing logged. Without this property the four call
    sites would risk a false "changed" on a device that never changed."""
    import capture
    chars = [_Char(capture.GATT_DB_HASH_UUID, 0x0003), _Char("00002a37-0000-1000-8000-00805f9b34fb", 0x0011)]
    client = _Client(chars, read=b"\x11\x22\x33\x44\x55\x66\x77\x88\x99\xaa\xbb\xcc\xdd\xee\xff\x00")

    first = _run(capture._gatt_record_table(client, ADDR))
    assert first and "new" in first, f"the first call must RECORD, got {first!r}"
    assert _run(capture._gatt_record_table(client, ADDR)) == "", \
        "a second call in the same connect must be silent — not a write, not a 'changed'"


def test_the_rail_wrapper_logs_ONLY_when_something_was_written(monkeypatch, caplog):
    """Both directions of the wrapper's one branch, because the quiet direction is the load-bearing one.
    `_gatt_record_table` returns "" for a refused table AND for a byte-identical one — and the CPAP path
    measured ~112 identical records an hour at one per ~34 s, so logging those was >100 INFO lines an
    hour carrying no information. Four rails makes that worse, not better."""
    import logging
    import capture

    async def _wrote(_client, _addr):
        return "new — 14 char(s), db_hash 4bcd397d"

    monkeypatch.setattr(capture, "_gatt_record_table", _wrote)
    with caplog.at_level(logging.INFO, logger=capture.log.name):
        _run(capture._gatt_record_rail(object(), ADDR, "Polar H10"))
    assert any("GATT table recorded" in r.message for r in caplog.records)

    async def _silent(_client, _addr):
        return ""

    caplog.clear()
    monkeypatch.setattr(capture, "_gatt_record_table", _silent)
    with caplog.at_level(logging.INFO, logger=capture.log.name):
        _run(capture._gatt_record_rail(object(), ADDR, "Polar H10"))
    assert not caplog.records, "a refused or byte-identical table must log NOTHING"


# ── §1.3 · THE CAPABILITY BRANCH — residue 2026-09-16-devcaps-has-no-branch-consumer ────────────────


def test_psftp_mtu_char_literal_matches_polar_psftp():
    """The literal in `capture` is a COPY (polar_psftp pulls bleak; `import capture` stays stdlib-clean),
    so it needs a guard or it drifts silently and the capability starts measuring nothing."""
    import capture
    import polar_psftp

    assert capture.PSFTP_MTU_CHAR == polar_psftp.MTU_CHAR


def test_clock_gate_UNMEASURED_falls_back_to_the_vendor_string_and_does_NOT_stop_syncing():
    """∅ AT THE BRANCH, and the load-bearing arm. `bool(None)` is False, so coercing here would silently
    stop writing the clock on every device not yet in the map. Unmeasured MUST behave as today."""
    import capture

    assert capture.clock_sync_capable(None, True) is True
    assert capture.clock_sync_capable(None, False) is False


def test_clock_gate_a_MEASURED_capability_OUTRANKS_the_configured_label_both_ways():
    """The point of the conversion: a vendor string someone typed loses to what the unit was observed to
    expose. Both directions, because only one of them is the convenient one."""
    import capture

    assert capture.clock_sync_capable(True, False) is True  # mislabelled unit now gets its clock
    assert capture.clock_sync_capable(False, True) is False  # labelled polar, but has no PS-FTP


def test_recorder_DERIVES_the_psftp_capability_from_the_recorded_table():
    import capture

    chars = [_Char(capture.PSFTP_MTU_CHAR, 0x001E), _Char("0000fd56-0000-1000-8000-00805f9b34fb", 0x0010)]
    _run(capture._gatt_record_table(_Client(chars), ADDR))
    assert devcaps.get(ADDR, "psftp") is True
    assert devcaps.source(ADDR, "psftp") == "gatt-mtu-char"


def test_recorder_records_a_MEASURED_False_when_the_table_lacks_it_not_a_None():
    """A recorded table WITHOUT the characteristic is a measurement, not an absence of one — that is the
    whole difference between this and `_has_contact_bit`, which is a session fact."""
    import capture

    _run(capture._gatt_record_table(_Client([_Char("0000fd56-0000-1000-8000-00805f9b34fb", 0x0010)]), ADDR))
    assert devcaps.get(ADDR, "psftp") is False


def test_recorder_BACKFILLS_the_capability_on_an_UNCHANGED_table():
    """ "same" means the TABLE was already stored, NOT that the capability was. A unit recorded before this
    landed has a table and no capability; gating the derive on ("new","changed") would leave it unmeasured
    until its firmware happened to change."""
    import capture

    chars = [_Char(capture.PSFTP_MTU_CHAR, 0x001E)]
    _run(capture._gatt_record_table(_Client(chars), ADDR))
    devcaps.reset()  # the pre-landing state: table stored, no capability
    assert devcaps.get(ADDR, "psftp") is None
    assert _run(capture._gatt_record_table(_Client(chars), ADDR)) == ""  # "same" — nothing logged
    assert devcaps.get(ADDR, "psftp") is True  # ...but the capability landed


def test_recorder_derives_NOTHING_from_a_REFUSED_table():
    """`""` is a refusal. A capability derived from a table the map rejected would be a fact with no
    evidence behind it — the shape §∅ forbids one layer up."""
    import capture

    assert _run(capture._gatt_record_table(_Client([]), ADDR)) == ""
    assert devcaps.get(ADDR, "psftp") is None


def test_the_rolling_change_is_LOGGED_on_basis_change_and_not_once_per_reconnect(caplog):
    """The conversion is a behaviour change distributed over time: as the map fills, each unit moves from
    vendor-string to measured logic with nothing marking it. Log the transition — but the gate runs every
    ~70 s reconnect, so a line per evaluation buries the event instead of surfacing it."""
    import capture

    capture._CLOCK_CAP_BASIS.pop("dev", None)
    with caplog.at_level("INFO"):
        assert capture._clock_gate("dev", ADDR, True) is True  # unmeasured → vendor string
        for _ in range(4):
            capture._clock_gate("dev", ADDR, True)  # same basis: silent
        assert sum("clock-sync gate" in r.message for r in caplog.records) == 1
        devcaps.record(ADDR, "psftp", False, source="gatt-mtu-char")  # the map fills in
        assert capture._clock_gate("dev", ADDR, True) is False  # measurement outranks the label
        assert sum("clock-sync gate" in r.message for r in caplog.records) == 2
    capture._CLOCK_CAP_BASIS.pop("dev", None)
