# tepna-capture — tests/test_cpap_serial.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`resolve_cpap_serial` — the AS11 serial that reaches BRP.edf's `SRN=` field.

The bug this pins: every live-written BRP.edf carried `SRN=UNKNOWN` while the machine's own SD-card
file for the same night carried `SRN=23221590541`. Measured 2026-09-03 over 14 paired files; every
other identification field already matched byte-for-byte, so the serial was the only one wrong.

⚠️ The fixture rule applies here too. `Identification.json` below is the REAL shape harvested from the
card — `FlowGenerator.IdentificationProfiles.Product.SerialNumber` — not a flattened `{"serial": …}`
that would pass a lenient reader while proving nothing about the file the harvest actually writes.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import capture  # noqa: E402


def _ident(tmp_path, serial, *, subdir="captures/cpap"):
    """Write an Identification.json in the harvest's real nesting and return the box root."""
    d = tmp_path / subdir
    d.mkdir(parents=True, exist_ok=True)
    doc = {"FlowGenerator": {"IdentificationProfiles": {"Product": {
        "UniversalIdentifier": "b64c7b29-a2ae-4ee6-9a47-4472e771fa39",
        "SerialNumber": serial,
        "ProductCode": "39485",
        "ProductName": "AirSense11AutoSet",
    }}}}
    (d / "Identification.json").write_text(json.dumps(doc), encoding="utf-8")
    return str(tmp_path)


def test_the_harvested_serial_is_used_when_config_does_not_set_one(tmp_path):
    """The whole point: no config key, and the real serial still reaches the EDF header."""
    root = _ident(tmp_path, "23221590541")
    assert capture.resolve_cpap_serial({}, root) == "23221590541"


def test_config_overrides_the_harvest(tmp_path):
    root = _ident(tmp_path, "23221590541")
    cfg = {"cpap": {"ble_stream": {"serial": "OVERRIDE99"}}}
    assert capture.resolve_cpap_serial(cfg, root) == "OVERRIDE99"


def test_a_custom_dest_subdir_is_honoured(tmp_path):
    """`dest_subdir` is configurable, so the serial must follow it rather than assume captures/cpap."""
    root = _ident(tmp_path, "23221590541", subdir="elsewhere/card")
    cfg = {"cpap": {"dest_subdir": "elsewhere/card"}}
    assert capture.resolve_cpap_serial(cfg, root) == "23221590541"
    # ...and the default location no longer answers, so the test is not passing by accident
    assert capture.resolve_cpap_serial({}, root) == "UNKNOWN"


def test_no_harvest_yet_is_UNKNOWN_not_a_crash(tmp_path):
    """A box that has never harvested still has to start a live stream."""
    assert capture.resolve_cpap_serial({}, str(tmp_path)) == "UNKNOWN"


def test_malformed_identification_json_is_UNKNOWN(tmp_path):
    d = tmp_path / "captures" / "cpap"
    d.mkdir(parents=True)
    (d / "Identification.json").write_text("{not json", encoding="utf-8")
    assert capture.resolve_cpap_serial({}, str(tmp_path)) == "UNKNOWN"


@pytest.mark.parametrize("doc", [
    {},                                                        # empty object
    [],                                                        # a list, not an object
    {"FlowGenerator": None},                                   # nesting stops early
    {"FlowGenerator": {"IdentificationProfiles": {}}},         # Product absent
    {"FlowGenerator": {"IdentificationProfiles": {"Product": {"SerialNumber": ""}}}},   # empty
    {"FlowGenerator": {"IdentificationProfiles": {"Product": {"SerialNumber": None}}}},  # null
])
def test_any_shape_without_a_serial_is_UNKNOWN(tmp_path, doc):
    """An empty serial must not become the string 'None' or '' in an EDF header."""
    d = tmp_path / "captures" / "cpap"
    d.mkdir(parents=True)
    (d / "Identification.json").write_text(json.dumps(doc), encoding="utf-8")
    assert capture.resolve_cpap_serial({}, str(tmp_path)) == "UNKNOWN"


def test_a_non_string_serial_is_stringified_not_dropped(tmp_path):
    """The card writes a string, but a numeric one must still identify the machine."""
    d = tmp_path / "captures" / "cpap"
    d.mkdir(parents=True)
    (d / "Identification.json").write_text(json.dumps(
        {"FlowGenerator": {"IdentificationProfiles": {"Product": {"SerialNumber": 23221590541}}}}),
        encoding="utf-8")
    assert capture.resolve_cpap_serial({}, str(tmp_path)) == "23221590541"


def test_an_empty_config_still_finds_the_harvested_serial(tmp_path):
    """No `cpap` block at all is the common case on a box that only harvests — it must still identify
    the machine. My first draft of this asserted UNKNOWN here and was wrong about the code: the
    absent config only defaults the override lookup, it does not skip reading the card."""
    root = _ident(tmp_path, "23221590541")
    assert capture.resolve_cpap_serial({}, root) == "23221590541"
    assert capture.resolve_cpap_serial({"cpap": {}}, root) == "23221590541"
    assert capture.resolve_cpap_serial({"cpap": {"ble_stream": {}}}, root) == "23221590541"


def test_the_serial_reaches_the_recording_id(tmp_path):
    """End to end through the real header builder — the field that was wrong on disk."""
    import cpap_edf
    root = _ident(tmp_path, "23221590541")
    serial = capture.resolve_cpap_serial({}, root)
    edf = cpap_edf.build_brp([0.0] * 1500, [0.0] * 1500, (2026, 8, 23, 23, 52, 42), serial)
    rid = edf[88:168].decode("ascii").rstrip() if isinstance(edf, (bytes, bytearray)) else None
    if rid is None:                                    # build_brp returns a structure, not bytes
        rid = cpap_edf._recording_id("23-AUG-2026", serial, 46, 3)
    assert "SRN=23221590541" in rid
    assert "SRN=UNKNOWN" not in rid

