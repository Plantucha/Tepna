# tepna-capture — tests/test_night_verdicts_cli.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`night_verdicts.py` — the corpus-free emission the adoption gate runs, and the re-emit for a night
written before the verdicts existed. Every object it writes is validated by both halves of the contract."""

import json
import os

import night_verdicts
import verdict
from tests.test_verdict import js_validate


def _both(d):
    qc = json.load(open(os.path.join(d, "QC-VERDICT.json")))
    bc = json.load(open(os.path.join(d, "BACKCHECK-VERDICT.json")))
    for o in (qc, bc):
        verdict.validate(o)
        v = js_validate(o)
        assert v["ok"], v["errors"]
        assert o["scope"] == "internal"  # REQUIRED on read by the adoption gate — written, never defaulted
    return qc, bc


def test_sample_writes_two_well_formed_objects_without_a_corpus(tmp_path, capsys):
    out = tmp_path / "sample"
    assert night_verdicts.main(["--sample", str(out)]) == 0
    qc, bc = _both(str(out))
    assert (
        qc["gate"] == "night-qc"
        and qc["status"] == "PASS"
        and qc["population"] == {"checked": 2, "eligible": 3, "excluded": 1}
    )
    assert bc["gate"] == "night-backcheck" and bc["status"] == "PASS" and bc["population"]["checked"] == 1
    printed = capsys.readouterr().out.strip().split("\n")
    assert printed == [str(out / "QC-VERDICT.json"), str(out / "BACKCHECK-VERDICT.json")]


def test_a_real_night_is_re_emitted_from_its_summary_and_a_missing_summary_exits_2(tmp_path, capsys):
    root = tmp_path / "captures"
    d = root / "2026-09-08"
    d.mkdir(parents=True)
    (d / "Wellue_O2Ring-S_S8AW2100_20260908034935_PPG.txt").write_text("x\n")
    summary = {
        "devices": [{"name": "Ring", "streams": {"ppg": 900}, "coverage": {"ppg": 0.97}}],
        "missing": [],
        "degraded": [],
        "gaps_in_night": [],
        "span_sec": 20000,
        "class_b": [{"file": "Wellue_O2Ring-S_S8AW2100_20260908034935_PPG.txt", "clips": {"ppg": 25}, "held": None}],
    }
    (d / "QC-SUMMARY.json").write_text(json.dumps(summary))
    assert night_verdicts.main([str(root), "2026-09-08"]) == 0
    qc, bc = _both(str(d))
    assert qc["status"] == "PASS" and qc["population"] == {"checked": 1, "eligible": 1, "excluded": 0}
    assert bc["status"] == "FAIL" and bc["result"]["clip_regions"] == 25  # the 09-08 night, as an object
    assert night_verdicts.main([str(root), "2026-09-09"]) == 2
    assert "no readable QC-SUMMARY.json" in capsys.readouterr().err
    assert night_verdicts.main(["--sample"]) == 2
    (d / "QC-SUMMARY.json").write_text("[1, 2]")
    assert night_verdicts.main([str(root), "2026-09-08"]) == 2 and "not an object" in capsys.readouterr().err


def test_sample_json_prints_one_validated_object_per_gate_and_refuses_an_unknown_gate(capsys):
    for gate in ("night-qc", "night-backcheck"):
        assert night_verdicts.main(["--sample-json", gate]) == 0
        o = json.loads(capsys.readouterr().out)
        verdict.validate(o)
        assert js_validate(o)["ok"] and o["gate"] == gate and o["status"] == "PASS"
    assert night_verdicts.main(["--sample-json", "night-sniffer"]) == 2
    assert "unknown gate" in capsys.readouterr().err


def test_sample_json_night_seal_seals_a_synthetic_night_or_says_it_could_not(capsys, monkeypatch):
    assert night_verdicts.main(["--sample-json", "night-seal"]) == 0
    o = json.loads(capsys.readouterr().out)
    verdict.validate(o)
    assert js_validate(o)["ok"] and o["gate"] == "night-seal" and o["status"] == "PASS"  # cryptography is here
    assert o["result"]["revision"] == 1 and o["population"] == {"checked": 1, "eligible": 1, "excluded": 0}
    # where sealbox cannot import (the JS lane's system python), the emission is NOT_RUN naming it
    import builtins

    real = builtins.__import__

    def no_sealbox(name, *a, **k):
        if name == "sealbox":
            raise ImportError("No module named cryptography")
        return real(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", no_sealbox)
    o = night_verdicts.seal_sample()
    monkeypatch.setattr(builtins, "__import__", real)
    verdict.validate(o)
    assert o["status"] == "NOT_RUN" and "cryptography" in o["reason"] and js_validate(o)["ok"]
