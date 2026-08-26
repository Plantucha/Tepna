# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The union that must FAIL VISIBLY (PER-DEVICE-ADAPTER-PINNING §3.6.3)."""
import json
import os

import status_union as SU

CFG = {"adapters": {"sena": "00:01:95:CC:53:02", "ub500": "AC:A7:F1:29:9D:1D",
                    "intel": "F0:D5:BF:1E:79:21"}}
NOW = 1_700_000_000_000


def _write(root, inst, hb_ms, devices=(), streams=()):
    d = os.path.join(root, "captures")
    os.makedirs(d, exist_ok=True)
    doc = {"heartbeat_ms": hb_ms, "instance": inst, "adapter": CFG["adapters"][inst],
           "devices": list(devices), "streams": list(streams)}
    with open(os.path.join(d, f"status.{inst}.json"), "w") as f:
        json.dump(doc, f)


def test_expected_instances_come_from_config_not_the_directory(tmp_path):
    """Reading the directory is the bug this module prevents: a dead instance has NO FILE, so a
    directory-derived expectation can never notice it is missing."""
    _write(str(tmp_path), "sena", NOW)
    assert SU.expected_instances(CFG) == ["intel", "sena", "ub500"]


def test_a_dead_instance_is_REPORTED_not_omitted(tmp_path):
    """🔴 THE POINT OF THE MODULE. Two radios publish, one never does. The union must say so — not
    quietly show two healthy radios while a third of the capture is gone."""
    _write(str(tmp_path), "sena", NOW, devices=[{"name": "H10"}])
    _write(str(tmp_path), "ub500", NOW, devices=[{"name": "Ring"}])
    u = SU.merge(str(tmp_path), CFG, now_ms=NOW)
    assert u["instances"]["intel"]["state"] == "dead"
    assert u["missing"] == ["intel"]
    assert u["degraded"] is True, "a union with a dead instance must never read as healthy"
    assert [d["name"] for d in u["devices"]] == ["H10", "Ring"]


def test_a_STALE_instance_is_not_live_and_carries_its_age(tmp_path):
    """The up-but-wedged case — the failure that LOOKS most like health, and the one WatchdogSec
    exists for. 'gone for 90 s' and 'gone since yesterday' need different responses, so the age is
    part of the answer."""
    _write(str(tmp_path), "sena", NOW - 90_000)
    _write(str(tmp_path), "ub500", NOW)
    _write(str(tmp_path), "intel", NOW)
    u = SU.merge(str(tmp_path), CFG, now_ms=NOW)
    assert u["instances"]["sena"]["state"] == "stale"
    assert u["instances"]["sena"]["age_ms"] == 90_000
    assert u["degraded"] is True


def test_all_live_is_not_degraded(tmp_path):
    for i in CFG["adapters"]:
        _write(str(tmp_path), i, NOW)
    u = SU.merge(str(tmp_path), CFG, now_ms=NOW)
    assert u["degraded"] is False and u["missing"] == []


def test_a_status_without_a_heartbeat_is_dead_not_live(tmp_path):
    """An old writer or a truncated doc. Treated as dead: an unaged status is one that CANNOT be shown
    to be current, and defaulting it to live is how a stopped instance passes for a running one."""
    d = os.path.join(str(tmp_path), "captures")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "status.sena.json"), "w") as f:
        json.dump({"devices": []}, f)
    assert SU.instance_health(json.load(open(os.path.join(d, "status.sena.json"))),
                              NOW)["state"] == "dead"


def test_unparseable_status_is_dead_not_an_exception(tmp_path):
    d = os.path.join(str(tmp_path), "captures")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "status.sena.json"), "w") as f:
        f.write("{ this is not json")
    assert SU.read_instance(str(tmp_path), "sena") is None
    u = SU.merge(str(tmp_path), CFG, now_ms=NOW)
    assert u["instances"]["sena"]["state"] == "dead"


def test_an_unsplit_box_reads_the_single_status_file(tmp_path):
    """The same reader must serve both deployments, or the split forces a flag-day on every consumer."""
    d = os.path.join(str(tmp_path), "captures")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "status.json"), "w") as f:
        json.dump({"heartbeat_ms": NOW, "devices": [{"name": "H10"}]}, f)
    u = SU.merge(str(tmp_path), {}, now_ms=NOW)
    assert u["instances"]["(single)"]["state"] == "live"
    assert u["degraded"] is False
    assert [x["name"] for x in u["devices"]] == ["H10"]
