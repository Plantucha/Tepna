# tepna-capture — tests/test_adversarial_capture.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The KNOWN-CLOCK injector (Protocol B, targets 1 · 4): the refuse-production plant FIRST and shown to be
load-bearing, the frame perturbation byte-exact, the loss sequence deterministic, the truth sidecar recording
what was injected, the shim touching only the PMD data characteristic of a targeted device — and the shipped
daemon unable to reach any of it."""

from __future__ import annotations

import asyncio
import datetime as _dt
import json
import os
import struct
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import adversarial_capture as A  # noqa: E402
import polar_pmd as pmd  # noqa: E402

NOW = _dt.datetime(2026, 9, 22, 1, 2, 3, tzinfo=_dt.timezone.utc)


def frame(meas: int, last_ns: int, payload: bytes = b"\x00\x01\x02", frame_type: int = 0) -> bytes:
    return bytes([meas]) + struct.pack("<Q", last_ns) + bytes([frame_type]) + payload


# ── THE PLANT: refuse production, and it is the guard that refuses ────────────────────────────────
@pytest.mark.parametrize(
    "root",
    ["/srv/tepna", "/srv/tepna/adversarial", "/srv/tepna/captures/adversarial", "/srv", "/"],
)
def test_a_root_that_is_production_or_under_it_or_above_it_is_REFUSED(root):
    with pytest.raises(A.Refused) as e:
        A.refuse_production(root, "/srv/tepna")
    assert e.value.code == A.EXIT_REFUSED and ("overlaps" in e.value.why or "adversarial" in e.value.why)


def test_the_config_s_own_root_is_refused_even_when_it_is_not_a_known_one(tmp_path):
    prod = tmp_path / "boxroot"
    with pytest.raises(A.Refused):
        A.refuse_production(str(prod / "adversarial"), str(prod))
    assert A.refuse_production(str(tmp_path / "adversarial"), str(prod)) == str(tmp_path / "adversarial")


def test_a_root_without_the_adversarial_component_is_refused_a_typo_beside_production_is_still_a_walkable_tree(tmp_path):
    with pytest.raises(A.Refused) as e:
        A.refuse_production(str(tmp_path / "nights"), None)
    assert "path component containing" in e.value.why


def test_a_symlink_into_production_is_refused_by_realpath_not_by_spelling(tmp_path):
    prod = tmp_path / "prod"
    prod.mkdir()
    link = tmp_path / "adversarial-link"
    link.symlink_to(prod)
    with pytest.raises(A.Refused) as e:
        A.refuse_production(str(link / "adversarial"), str(prod))
    assert "overlaps" in e.value.why


def _cfg(tmp_path, root="/srv/tepna"):
    p = tmp_path / "config.yaml"
    p.write_text(f"root: {root}\ndevices: []\nalerts:\n  enabled: true\n  webhook_url: https://example.invalid/x\ncpap:\n  enabled: true\n")
    return str(p)


def test_the_plant_is_load_bearing_the_run_WOULD_proceed_into_production_without_the_guard(tmp_path, monkeypatch, capsys):
    """Verified to fail without the guard before it is trusted (the brief's own instruction): with
    `refuse_production` neutralised, a dry run pointed INTO production returns 0 and prints a plan for it.
    With the guard, the same argv exits 3. The difference is the guard, and nothing else."""
    argv = ["--config", _cfg(tmp_path), "--root", "/srv/tepna/adversarial", "--device", "AA:BB:CC:DD:EE:01", "--offset-ms", "250", "--dry-run"]
    monkeypatch.setattr(A, "refuse_production", lambda root, cfg_root, known=(): os.path.realpath(root))
    assert A.run(argv) == 0
    assert json.loads(capsys.readouterr().out)["root"] == "/srv/tepna/adversarial", "the guard removed: production accepted"
    monkeypatch.undo()
    with pytest.raises(A.Refused) as e:
        A.run(argv)
    assert e.value.code == 3


def test_a_dry_run_into_a_separate_tree_prints_the_plan_and_a_config_that_cannot_page_or_harvest(tmp_path, capsys):
    root = str(tmp_path / "adversarial")
    assert A.run(["--config", _cfg(tmp_path), "--root", root, "--device", "aa:bb:cc:dd:ee:01", "--offset-ms", "-125.5", "--drop-p", "0.1", "--seed", "7", "--dry-run"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["root"] == root and out["plan"] == {"devices": ["AA:BB:CC:DD:EE:01"], "offset_ns": -125_500_000, "drop_p": 0.1, "seed": 7,
                                                   "targets": ["1-constant-offset", "4-packet-loss"]}
    assert out["config"]["root"] == root
    assert out["config"]["alerts"] == {"enabled": False, "webhook_url": ""} and out["config"]["cpap"]["enabled"] is False
    assert not (tmp_path / "adversarial").exists(), "a dry run writes nothing"


def test_a_plan_that_injects_nothing_and_an_empty_config_are_refused_by_name(tmp_path):
    with pytest.raises(SystemExit, match="nothing to inject"):
        A.run(["--config", _cfg(tmp_path), "--root", str(tmp_path / "adversarial"), "--device", "AA:BB:CC:DD:EE:01", "--dry-run"])
    (tmp_path / "empty.yaml").write_text("")
    with pytest.raises(SystemExit, match="not a mapping"):
        A.run(["--config", str(tmp_path / "empty.yaml"), "--root", str(tmp_path / "adversarial"), "--device", "X", "--offset-ms", "1", "--dry-run"])


# ── the perturbation, byte-exact ──────────────────────────────────────────────────────────────────
def test_offset_moves_only_the_u64_device_stamp_and_decode_sees_exactly_that_offset():
    f = frame(pmd.ECG, 5_000_000_000, payload=bytes(9))
    g = A.perturb_frame(f, offset_ns=250_000_000, drop=False)
    assert g[0] == f[0] and g[9:] == f[9:] and struct.unpack_from("<Q", g, 1)[0] == 5_250_000_000
    meas_f, s_f = pmd.decode_frame(f, NOW, fs=130.0)
    meas_g, s_g = pmd.decode_frame(g, NOW, fs=130.0)
    assert meas_f == meas_g == pmd.ECG and len(s_f) == len(s_g) == 3
    assert all(b.sensor_ns - a.sensor_ns == 250_000_000 for a, b in zip(s_f, s_g))
    assert [x.values for x in s_f] == [x.values for x in s_g], "values untouched: the offset is a CLOCK perturbation"


def test_a_negative_offset_wraps_within_u64_and_zero_offset_is_the_identity():
    f = frame(pmd.ACC, 10)
    assert struct.unpack_from("<Q", A.perturb_frame(f, offset_ns=-11, drop=False), 1)[0] == 2**64 - 1
    assert A.perturb_frame(f, offset_ns=0, drop=False) == f


def test_a_dropped_frame_is_None_and_a_frame_too_short_for_a_stamp_passes_through():
    assert A.perturb_frame(frame(pmd.ECG, 1), offset_ns=1, drop=True) is None
    assert A.perturb_frame(b"\x00\x01", offset_ns=1_000, drop=False) == b"\x00\x01"


def test_the_loss_sequence_is_deterministic_in_seed_address_and_index_and_close_to_p():
    a = [A.drop_decision(7, "aa:bb:cc:dd:ee:01", i, 0.2) for i in range(5000)]
    b = [A.drop_decision(7, "AA:BB:CC:DD:EE:01", i, 0.2) for i in range(5000)]
    assert a == b, "address case does not change the sequence"
    assert a != [A.drop_decision(8, "AA:BB:CC:DD:EE:01", i, 0.2) for i in range(5000)]
    assert 0.17 < sum(a) / 5000 < 0.23
    assert not any(A.drop_decision(7, "X", i, 0.0) for i in range(100))


def test_plan_refuses_no_device_and_an_out_of_range_p():
    with pytest.raises(ValueError):
        A.Plan([])
    with pytest.raises(ValueError):
        A.Plan(["X"], drop_p=1.0)
    assert A.Plan(["x"]).targets("X") and not A.Plan(["x"]).targets("Y")


# ── the truth sidecar records what was injected, never traffic ────────────────────────────────────
def test_inject_records_offsets_and_drops_with_original_and_injected_stamps_and_nothing_for_untouched_frames(tmp_path):
    plan = A.Plan(["AA:BB:CC:DD:EE:01"], offset_ns=1_000, drop_p=0.5, seed=3)
    truth = A.TruthWriter(str(tmp_path / "truth.jsonl"), plan, NOW)
    outs = [A.inject(plan, truth, "AA:BB:CC:DD:EE:01", frame(pmd.ECG, 100 + i), i, NOW) for i in range(40)]
    truth.close()
    rows = [json.loads(ln) for ln in (tmp_path / "truth.jsonl").read_text().splitlines()]
    assert rows[0]["schema"] == A.SCHEMA and rows[0]["plan"] == plan.as_dict() and "INJECTED" in rows[0]["note"]
    body = rows[1:]
    assert len(body) == 40 == truth.rows, "every frame was either offset or dropped — every one is recorded"
    drops = [r for r in body if r["action"] == "drop"]
    offs = [r for r in body if r["action"] == "offset"]
    assert drops and offs and all(r["injected_last_ns"] is None for r in drops)
    assert all(r["injected_last_ns"] - r["original_last_ns"] == 1_000 for r in offs)
    assert all(r["meas"] == "ecg" and r["address"] == "AA:BB:CC:DD:EE:01" for r in body)
    assert sum(o is None for o in outs) == len(drops)
    # an untouched frame (no offset, not dropped) is delivered as-is and NOT recorded
    quiet = A.Plan(["AA:BB:CC:DD:EE:01"], offset_ns=0, drop_p=0.0)
    t2 = A.TruthWriter(str(tmp_path / "t2.jsonl"), quiet, NOW)
    assert A.inject(quiet, t2, "AA:BB:CC:DD:EE:01", frame(pmd.ACC, 1), 0, NOW) == frame(pmd.ACC, 1) and t2.rows == 0
    t2.close()
    # a frame too short for a stamp, dropped: original_last_ns is null, never fabricated
    plan3 = A.Plan(["Z"], drop_p=0.99, seed=1)
    t3 = A.TruthWriter(str(tmp_path / "t3.jsonl"), plan3, NOW)
    idx = next(i for i in range(100) if A.drop_decision(1, "Z", i, 0.99))
    assert A.inject(plan3, t3, "Z", b"\x00", idx, NOW) is None
    t3.close()
    assert json.loads((tmp_path / "t3.jsonl").read_text().splitlines()[-1])["original_last_ns"] is None


# ── the shim: only the PMD data char, only targeted devices ───────────────────────────────────────
class _FakeClient:
    """Stands in for bleak.BleakClient: remembers the callbacks start_notify registered."""

    def __init__(self, address, **kw):
        self.address = address
        self.notifies = {}

    async def start_notify(self, char, callback, *a, **kw):
        self.notifies[char] = callback


def test_the_shim_wraps_only_the_pmd_data_char_of_a_targeted_device(tmp_path):
    plan = A.Plan(["AA:BB:CC:DD:EE:01"], offset_ns=500)
    truth = A.TruthWriter(str(tmp_path / "t.jsonl"), plan, NOW)
    Client = A.make_client_class(_FakeClient, plan, truth, lambda: NOW)
    seen = []
    cb = lambda s, d: seen.append(bytes(d))  # noqa: E731

    target = Client("AA:BB:CC:DD:EE:01")
    asyncio.run(target.start_notify(pmd.PMD_DATA, cb))
    asyncio.run(target.start_notify(pmd.PMD_CONTROL, cb))
    target.notifies[pmd.PMD_DATA](0, bytearray(frame(pmd.ECG, 100)))
    target.notifies[pmd.PMD_CONTROL](0, bytearray(frame(pmd.ECG, 100)))
    assert struct.unpack_from("<Q", seen[0], 1)[0] == 600, "data char: offset applied"
    assert struct.unpack_from("<Q", seen[1], 1)[0] == 100, "control char: untouched"
    assert target.notifies[pmd.PMD_CONTROL] is cb, "not even wrapped"

    other = Client("AA:BB:CC:DD:EE:02")
    asyncio.run(other.start_notify(pmd.PMD_DATA, cb))
    assert other.notifies[pmd.PMD_DATA] is cb, "an untargeted device gets the daemon's own callback"
    truth.close()
    assert truth.rows == 1


def test_the_shim_drops_frames_and_counts_frame_indices_per_client(tmp_path):
    plan = A.Plan(["AA:BB:CC:DD:EE:01"], drop_p=0.5, seed=11)
    truth = A.TruthWriter(str(tmp_path / "t.jsonl"), plan, NOW)
    Client = A.make_client_class(_FakeClient, plan, truth, lambda: NOW)
    delivered = []
    c = Client("aa:bb:cc:dd:ee:01")
    asyncio.run(c.start_notify(pmd.PMD_DATA.upper(), lambda s, d: delivered.append(bytes(d))))
    for i in range(200):
        c.notifies[pmd.PMD_DATA.upper()](0, bytearray(frame(pmd.ECG, i)))
    truth.close()
    expected_drops = sum(A.drop_decision(11, "AA:BB:CC:DD:EE:01", i, 0.5) for i in range(200))
    assert len(delivered) == 200 - expected_drops and truth.rows == expected_drops and c._inj_index == 200


def test_a_device_object_with_an_address_attribute_is_targeted_by_that_address(tmp_path):
    class Dev:
        address = "AA:BB:CC:DD:EE:01"
    plan = A.Plan(["AA:BB:CC:DD:EE:01"], offset_ns=1)
    truth = A.TruthWriter(str(tmp_path / "t.jsonl"), plan, NOW)
    c = A.make_client_class(_FakeClient, plan, truth, lambda: NOW)(Dev())
    assert c._inj_address == "AA:BB:CC:DD:EE:01"
    truth.close()


# ── the shipped daemon cannot reach any of this ───────────────────────────────────────────────────
def test_the_shipped_daemon_cannot_reach_the_injector():
    """Ruling 2: no hook, no branch, no config key. `capture.py` never names this module or its seam, and
    the module's only way in is the `bleak` attribute it replaces in ITS OWN process."""
    from _srcscan import module_source   # never a raw read of a mutatable module (test_mutation_hygiene)
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = module_source("capture.py")
    for token in ("adversarial_capture", "InjectingClient", "perturb_frame", "make_client_class", "INJECTION-TRUTH"):
        assert token not in src, token
    inj = module_source("adversarial_capture.py")
    assert "bleak.BleakClient = make_client_class(" in inj, "the shim is installed on bleak, in the injector's process only"
    example = open(os.path.join(here, "config.example.yaml"), encoding="utf-8").read()
    assert "adversarial" not in example and "inject" not in example.lower(), "no config key can enable it"


def test_run_writes_the_derived_config_and_truth_then_runs_capture_main_with_the_shim_installed(tmp_path, monkeypatch):
    """The real `run` up to the daemon: the config and truth land in the adversarial root, `bleak.BleakClient`
    is the shim, `capture.main` is invoked with `--config` pointing at the derived file, and the truth is
    closed afterwards with the row count printed."""
    import types
    fake_bleak = types.SimpleNamespace(BleakClient=_FakeClient)
    calls = {}

    async def fake_main():
        calls["argv"] = list(sys.argv)
        calls["client"] = fake_bleak.BleakClient
    fake_capture = types.SimpleNamespace(main=fake_main, _now=lambda: NOW)
    monkeypatch.setitem(sys.modules, "bleak", fake_bleak)
    monkeypatch.setitem(sys.modules, "capture", fake_capture)
    root = str(tmp_path / "adversarial")
    assert A.run(["--config", _cfg(tmp_path), "--root", root, "--device", "AA:BB:CC:DD:EE:01", "--drop-p", "0.2", "--instance", "sena"]) == 0
    files = sorted(os.listdir(root))
    assert [f.split("-")[0] for f in files] == ["INJECTION", "adversarial"], files
    assert calls["argv"][1:3] == ["--config", os.path.join(root, files[1])] and calls["argv"][3:] == ["--instance", "sena"]
    assert calls["client"] is not _FakeClient and issubclass(calls["client"], _FakeClient), "the shim was installed on bleak"
    import yaml
    derived = yaml.safe_load(open(os.path.join(root, files[1])))
    assert derived["root"] == root and derived["alerts"]["enabled"] is False
    header = json.loads(open(os.path.join(root, files[0])).readline())
    assert header["plan"]["targets"] == ["4-packet-loss"]
