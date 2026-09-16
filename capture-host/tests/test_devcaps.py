# tepna-capture — tests/test_devcaps.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""BLE-TRANSPORT-REDESIGN §1.3 — capability is a per-UNIT fact, and an unmeasured one is None.

The defect being replaced: "Measured 2026-07-19 on an H10 (which does NOT report contact)" — one unit
measured once, promoted to a claim about a MODEL, and false, because the H10 on the capture box does
report it. Every plant below is that defect in a different disguise.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import devcaps  # noqa: E402


@pytest.fixture(autouse=True)
def _clean():
    devcaps.reset()
    yield
    devcaps.reset()


def test_PLANT_an_unmeasured_capability_is_None_not_False():
    """THE rule. `False` means "observed not to support it"; `None` means nobody looked. A default of
    False is an assertion about every device never probed — which is how one unit's measurement became
    a model's property in the first place."""
    assert devcaps.get("AA:BB:CC:DD:EE:FF", "hr_contact_bit") is None
    assert devcaps.get("AA:BB:CC:DD:EE:FF", "hr_contact_bit") is not False


def test_PLANT_a_measured_False_is_DISTINGUISHABLE_from_never_measured():
    """If these collapse, the record cannot express §1.3's second done-when — "a device whose record is
    absent is PROBED, never assumed" — because absence would have no value of its own."""
    devcaps.record("AA:BB", "hr_contact_bit", False, source="hr-flags-bit2")
    assert devcaps.get("AA:BB", "hr_contact_bit") is False       # measured: does not support
    assert devcaps.get("CC:DD", "hr_contact_bit") is None        # never looked
    assert devcaps.get("AA:BB", "hr_contact_bit") != devcaps.get("CC:DD", "hr_contact_bit")


def test_PLANT_two_units_of_the_same_model_are_two_records():
    """The whole point. One H10 reporting no contact bit must not answer for another H10 that does."""
    devcaps.record("H1:00", "hr_contact_bit", False, source="hr-flags-bit2")
    devcaps.record("H1:01", "hr_contact_bit", True, source="hr-flags-bit2")
    assert devcaps.get("H1:00", "hr_contact_bit") is False
    assert devcaps.get("H1:01", "hr_contact_bit") is True


def test_identity_is_the_address_and_case_does_not_split_a_unit():
    """Standing ruling 2026-08-27: BLE identity is the ADDRESS. A lowercase write and an uppercase read
    are the same unit, or one device silently becomes two records with opposite answers."""
    devcaps.record("aa:bb:cc:dd:ee:ff", "hr_contact_bit", True, source="hr-flags-bit2")
    assert devcaps.get("AA:BB:CC:DD:EE:FF", "hr_contact_bit") is True


def test_a_capability_carries_its_provenance():
    """A value with no source is a claim, not a record — the thing §1.3 is replacing."""
    devcaps.record("AA:BB", "hr_contact_bit", True, source="hr-flags-bit2")
    assert devcaps.source("AA:BB", "hr_contact_bit") == "hr-flags-bit2"
    assert devcaps.source("CC:DD", "hr_contact_bit") is None


def test_the_record_SURVIVES_A_RESTART(tmp_path):
    """The daemon restarts on every deploy, so a record that does not persist re-probes forever and
    never accumulates."""
    p = str(tmp_path / "devcaps.json")
    devcaps.configure(p)
    devcaps.record("AA:BB", "hr_contact_bit", True, source="hr-flags-bit2")
    assert os.path.exists(p)

    devcaps.reset()                      # simulate the restart
    assert devcaps.get("AA:BB", "hr_contact_bit") is None, "reset must really clear it"
    devcaps.configure(p)
    assert devcaps.get("AA:BB", "hr_contact_bit") is True
    assert devcaps.source("AA:BB", "hr_contact_bit") == "hr-flags-bit2"


def test_PLANT_a_corrupt_record_does_not_stop_a_nights_capture(tmp_path):
    """Fail-safe. A telemetry file that takes down the recording is worse than the blindness it fixes —
    and after a corrupt load the state must be EMPTY (None), never partially-trusted."""
    p = str(tmp_path / "devcaps.json")
    open(p, "w").write("{ this is not json")
    devcaps.configure(p)                 # must not raise
    assert devcaps.get("AA:BB", "hr_contact_bit") is None


def test_a_later_measurement_supersedes_an_earlier_one(tmp_path):
    """A unit whose firmware gains the capability must be able to say so."""
    devcaps.configure(str(tmp_path / "d.json"))
    devcaps.record("AA:BB", "hr_contact_bit", False, source="hr-flags-bit2")
    devcaps.record("AA:BB", "hr_contact_bit", True, source="hr-flags-bit2")
    assert devcaps.get("AA:BB", "hr_contact_bit") is True


def test_snapshot_reports_values_and_sources_and_is_json_safe(tmp_path):
    devcaps.configure(str(tmp_path / "d.json"))
    devcaps.record("AA:BB", "hr_contact_bit", True, source="hr-flags-bit2")
    snap = devcaps.snapshot()
    assert snap == {"AA:BB": {"hr_contact_bit": {"value": True, "source": "hr-flags-bit2"}}}
    json.dumps(snap)                     # it rides in status.json


def test_recording_never_raises_into_the_capture_path(monkeypatch, tmp_path):
    """Same rule as blestats: a telemetry defect must not end a recording."""
    devcaps.configure(str(tmp_path / "d.json"))

    def boom(*_a, **_k):
        raise RuntimeError("disk is gone")
    monkeypatch.setattr(devcaps, "_flush", boom)
    devcaps.record("AA:BB", "hr_contact_bit", True, source="hr-flags-bit2")   # must not raise


def test_configure_with_no_path_is_memory_only(tmp_path):
    """Absent configuration must not write files into the cwd."""
    devcaps.configure(None)
    devcaps.record("AA:BB", "hr_contact_bit", True, source="x")
    assert devcaps.get("AA:BB", "hr_contact_bit") is True
    assert not os.path.exists("devcaps.json")


def test_a_record_file_with_junk_entries_loads_only_the_well_formed_ones(tmp_path):
    """Half-trusting a malformed record is worse than ignoring it: a non-dict entry must be skipped,
    not coerced into something `get` would answer from."""
    p = str(tmp_path / "d.json")
    open(p, "w").write(json.dumps({
        "AA:BB": {"hr_contact_bit": {"value": True, "source": "hr-flags-bit2"}},
        "CC:DD": "not-a-dict",                                  # whole device entry junk
        "EE:FF": {"hr_contact_bit": "not-a-dict"},              # capability entry junk
    }))
    devcaps.configure(p)
    assert devcaps.get("AA:BB", "hr_contact_bit") is True
    assert devcaps.get("CC:DD", "hr_contact_bit") is None
    assert devcaps.get("EE:FF", "hr_contact_bit") is None       # junk reads as UNMEASURED, not False


def test_PLANT_a_failed_write_leaves_no_half_written_record_and_no_tmp_litter(monkeypatch, tmp_path):
    """The atomic-write contract. A half-written record read at the next boot is worse than none, and
    a tmp file left behind every failure fills the capture volume over a long run."""
    p = str(tmp_path / "d.json")
    devcaps.configure(p)
    devcaps.record("AA:BB", "hr_contact_bit", True, source="hr-flags-bit2")
    before = open(p).read()

    def boom(*_a, **_k):
        raise OSError("no space left on device")
    monkeypatch.setattr(devcaps.json, "dump", boom)
    devcaps.record("CC:DD", "hr_contact_bit", True, source="hr-flags-bit2")   # must not raise

    assert open(p).read() == before, "the previous record must be intact, never truncated"
    assert [f for f in os.listdir(str(tmp_path)) if f.startswith(".devcaps-")] == []


def test_a_record_file_that_is_not_an_object_loads_as_empty(tmp_path):
    """Valid JSON, wrong shape — a list where an object belongs. It must read as UNMEASURED rather
    than crash or half-populate."""
    p = str(tmp_path / "d.json")
    open(p, "w").write("[1, 2, 3]")
    devcaps.configure(p)
    assert devcaps.get("AA:BB", "hr_contact_bit") is None


def test_even_a_failed_CLEANUP_does_not_reach_the_capture_path(monkeypatch, tmp_path):
    """The last resort. The write failed AND the tmp file could not be removed — a read-only volume
    does both — and a recording still must not end because of a capability note."""
    devcaps.configure(str(tmp_path / "d.json"))

    def bad_dump(*_a, **_k):
        raise OSError("no space left on device")

    def bad_unlink(*_a, **_k):
        raise OSError("read-only file system")
    monkeypatch.setattr(devcaps.json, "dump", bad_dump)
    monkeypatch.setattr(devcaps.os, "unlink", bad_unlink)
    devcaps.record("AA:BB", "hr_contact_bit", True, source="hr-flags-bit2")   # must not raise
    assert devcaps.get("AA:BB", "hr_contact_bit") is True, "the in-memory answer still stands"
