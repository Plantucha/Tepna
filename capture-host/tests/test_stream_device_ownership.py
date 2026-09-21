# tepna-capture — tests/test_stream_device_ownership.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""A BUS STREAM SAYS WHICH DEVICE OWNS IT — residue 2026-09-05-capture-status-joins-two-key-namespaces.

Bus KEYS (`acc_vs`, `o2ppg`, bare `ecg`) and configured stream NAMES (`acc`, `ppg`, `ecg`) are different
namespaces. Two consumers joined them by string equality — `capture_status.py` and `monitor.html`'s
`deviceForStream` — and on the live box that matched 2 of 10 streams, both by accident. The fix records
the owner where the stream is DECLARED (`TelemetryBus.register(..., device=)`, `claim()` for the keys
declared before any config exists) and publishes it as `streams[].device`. These tests pin the bus
contract, a source-scan that every register site in `capture.py` names its owner, and the JS twin.
"""

import json
import os
import re
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

import telemetry  # noqa: E402
from _srcscan import module_source  # noqa: E402


# ── the bus contract ──────────────────────────────────────────────────────────────────────────────
def test_register_records_the_owner_and_meta_publishes_it():
    b = telemetry.TelemetryBus()
    b.register("acc_vs", "ACC (Verity)", "raw", 52, chans=3, labels=("X", "Y", "Z"), device="Verity")
    row = {r["key"]: r for r in b.meta()}["acc_vs"]
    assert row["device"] == "Verity"


def test_device_is_optional_and_last_so_every_existing_caller_is_unchanged():
    b = telemetry.TelemetryBus()
    b.register("k", "K", "u", 1)
    assert {r["key"]: r for r in b.meta()}["k"]["device"] is None


def test_default_meta_keys_are_ownerless_until_CLAIMED_by_the_device_task():
    """`ecg` / `spo2` / `pr` are declared at import, before any config names a device. The owner can
    only be attached when that device's task opens — and `None` until then is the honest state, never
    a guessed name."""
    b = telemetry.TelemetryBus()
    rows = {r["key"]: r for r in b.meta()}
    assert rows["spo2"]["device"] is None and rows["ecg"]["device"] is None
    b.claim("spo2", "Ring")
    b.claim("pr", "Ring")
    rows = {r["key"]: r for r in b.meta()}
    assert rows["spo2"]["device"] == "Ring" and rows["pr"]["device"] == "Ring"
    assert rows["ecg"]["device"] is None, "claiming one key must not touch another"


def test_claim_keeps_every_other_field_of_the_declaration():
    b = telemetry.TelemetryBus()
    before = {r["key"]: r for r in b.meta()}["spo2"]
    b.claim("spo2", "Ring")
    after = {r["key"]: r for r in b.meta()}["spo2"]
    assert {k: v for k, v in after.items() if k != "device"} == {k: v for k, v in before.items() if k != "device"}


def test_claiming_an_undeclared_key_does_NOT_declare_it():
    """Claiming is not registering: a typo must not conjure a stream card."""
    b = telemetry.TelemetryBus()
    b.claim("sp02", "Ring")                     # zero, not o
    assert "sp02" not in {r["key"] for r in b.meta()}


# ── every register site in capture.py names its owner ─────────────────────────────────────────────
def _capture_src():
    # Through the hygiene seam, never a raw read: a raw read of a mutatable module makes the whole
    # module unmeasurable under mutmut (tests/test_mutation_hygiene.py).
    return module_source("capture.py")


def test_every_BUS_register_call_in_capture_py_passes_device():
    """A tenth site added without `device=` would publish an ownerless key that both consumers render
    as UNMATCHED. Counted as an equality against the whole set, not a floor, so a site that quietly
    loses the argument is caught too."""
    src = _capture_src()
    calls = []
    for m in re.finditer(r"BUS\.register\(", src):
        depth, i = 0, m.end() - 1
        while True:                              # walk to the matching close paren
            depth += {"(": 1, ")": -1}.get(src[i], 0)
            if depth == 0:
                break
            i += 1
        calls.append(src[m.start():i + 1])
    assert len(calls) == 9, [c[:50] for c in calls]
    missing = [c[:70] for c in calls if "device=" not in c]
    assert missing == [], missing


def test_the_ring_task_claims_its_default_keys():
    """`spo2` and `pr` are pushed by the ring but declared in DEFAULT_META; the ring's task must claim
    them, or the two headline O2Ring streams stay ownerless forever."""
    src = _capture_src()
    assert 'BUS.claim("spo2", name)' in src and 'BUS.claim("pr", name)' in src


# ── the JS twin: monitor.html's deviceForStream ───────────────────────────────────────────────────
def _js_device_for_stream(streams, devices, key):
    node = shutil.which("node")
    if not node:  # pragma: no cover - ubuntu-latest always has node
        pytest.skip("node is not installed")
    src = open(os.path.join(_HERE, "monitor.html"), encoding="utf-8").read()
    i = src.index("function deviceForStream(key){")
    # the function ends at the first line that is exactly "}" after its start
    j = src.index("\n}\n", i) + 3
    fn = src[i:j]
    k = src.index("function _devTag(")
    tag = src[k:src.index("\n}\n", k) + 3]
    prog = (f"let STREAMS = {json.dumps(streams)}, DEVICES = {json.dumps(devices)};\n{tag}\n{fn}\n"
            f"const d = deviceForStream({json.dumps(key)}); console.log(JSON.stringify(d ? d.name : null));")
    r = subprocess.run([node, "-e", prog], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def test_js_uses_the_published_owner_before_parsing_the_key():
    """A key whose SPELLING points at one device but whose OWNER is another resolves to the owner.
    Spelling is the fallback for a daemon older than the field, never the authority."""
    devices = [{"name": "Verity", "model": "Verity Sense", "streams": ["acc"]},
               {"name": "H10", "model": "Polar H10", "streams": ["ecg"]}]
    streams = [{"key": "acc_vs", "device": "H10"}]
    assert _js_device_for_stream(streams, devices, "acc_vs") == "H10"


def test_js_falls_back_to_key_parsing_only_when_no_owner_is_published():
    devices = [{"name": "Verity", "model": "Verity Sense", "streams": ["acc"]},
               {"name": "H10", "model": "Polar H10", "streams": ["ecg"]}]
    assert _js_device_for_stream([{"key": "acc_vs"}], devices, "acc_vs") == "Verity"
    assert _js_device_for_stream([{"key": "acc_vs", "device": None}], devices, "acc_vs") == "Verity"


def test_js_an_owner_naming_no_known_device_falls_through_rather_than_inventing_one():
    devices = [{"name": "Verity", "model": "Verity Sense", "streams": ["acc"]}]
    assert _js_device_for_stream([{"key": "acc_vs", "device": "Ghost"}], devices, "acc_vs") == "Verity"
