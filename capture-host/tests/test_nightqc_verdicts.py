# tepna-capture — tests/test_nightqc_verdicts.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The two box-side nightly verdicts (VERDICT-CONTRACT §3b, wave 1): `night-qc` from summarize's own
`ok`, and `night-backcheck` from the class-B blocks — each ONE `tepna.verdict/1` object beside
QC-SUMMARY.json. Every test reads the OBJECT, never the prose; the criterion is the module constant
written before these tests, and a crash is UNKNOWN naming the exception, never a traceback."""

import json
import os

import nightqc
import verdict

DEV = [
    {"name": "H10", "device_id": "02849638", "streams": ["ecg", "acc"]},
    {"name": "Spare", "device_id": "ZZZZ", "streams": ["hr"], "optional": True},
]


def _summary(**kw):
    base = {
        "devices": [{"name": "H10", "coverage": {"ecg": 0.98, "acc": 0.97}}],
        "missing": [],
        "degraded": [],
        "gaps_in_night": [],
        "span_sec": 7200,
    }
    base.update(kw)
    return base


def test_the_criterion_is_pre_stated_as_a_constant_not_computed_from_the_night():
    assert nightqc._QC_CRITERION == {
        "name": "stream_coverage",
        "threshold": nightqc._DEGRADED_BELOW,
        "unit": "fraction",
        "direction": "gte",
    }
    assert nightqc._BACKCHECK_CRITERION == {
        "name": "clip_regions_plus_held_streams",
        "threshold": 0,
        "unit": "count",
        "direction": "lte",
    }


def test_night_qc_pass_names_the_population_split_by_optional():
    o = nightqc.qc_verdict(_summary(), DEV, night_dir="/n/2026-09-19")
    verdict.validate(o)
    assert o["gate"] == "night-qc" and o["status"] == "PASS" and o["reason"] is None
    assert o["population"] == {"checked": 2, "eligible": 3, "excluded": 1}  # the Spare's hr is declared, not judged
    assert o["result"]["coverage"] == {"H10:ecg": 0.98, "H10:acc": 0.97}
    assert "/n/2026-09-19/QC-SUMMARY.json" in o["evidence"]


def test_night_qc_fail_names_what_missed_and_by_how_much():
    o = nightqc.qc_verdict(_summary(missing=["H10:acc"], degraded=["H10:ecg 31%"]), DEV)
    assert o["status"] == "FAIL"
    assert "missing: H10:acc" in o["reason"] and "degraded (< 50 %): H10:ecg 31%" in o["reason"]


def test_night_qc_shortfall_is_a_headline_met_with_a_session_excluded_inside_the_night():
    o = nightqc.qc_verdict(
        _summary(
            gaps_in_night=["23:10->01:40 150min gap; 1 later session(s), 9 rows, excluded from coverage [in-night]"]
        ),
        DEV,
    )
    assert o["status"] == "SHORTFALL" and "excluded from the judgement" in o["reason"]
    assert o["result"]["gaps_in_night"]


def test_night_qc_underpowered_under_the_minimum_span_is_unknown_not_low():
    for span in (None, 120):
        o = nightqc.qc_verdict(_summary(span_sec=span, devices=[{"name": "H10", "coverage": {}}]), DEV)
        assert o["status"] == "UNDERPOWERED", span
        assert "300 s minimum" in o["reason"] and "unknown, not low" in o["reason"]


def test_night_qc_with_no_device_configured_is_not_run_not_pass():
    o = nightqc.qc_verdict(_summary(), [])
    assert o["status"] == "NOT_RUN" and o["result"] is None and o["population"]["checked"] == 0


def test_night_qc_missing_outranks_the_span_gate():
    """A stream that is absent is absent whatever the span; UNDERPOWERED is for coverage, not presence."""
    o = nightqc.qc_verdict(_summary(missing=["H10:ecg"], span_sec=None), DEV)
    assert o["status"] == "FAIL"


def test_a_crash_inside_night_qc_is_UNKNOWN_naming_the_exception():
    o = nightqc.qc_verdict({"devices": "not-a-list"}, DEV)  # .items() on a str inside the builder
    verdict.validate(o)
    assert o["status"] == "UNKNOWN" and "the gate raised" in o["reason"]


# ── back-check ──────────────────────────────────────────────────────────────────────────────────────


def _night(tmp_path, names):
    d = tmp_path / "2026-09-19"
    d.mkdir()
    for n in names:
        (d / n).write_text("x\n")
    return str(d)


def test_backcheck_pass_over_every_class_b_file(tmp_path):
    d = _night(
        tmp_path,
        ["Wellue_O2Ring-S_S8AW_20260919_PPG.txt", "Polar_H10_0284_20260919_ECG.txt", "Polar_H10_0284_20260919_ACC.txt"],
    )
    summ = {
        "class_b": [
            {"file": "Wellue_O2Ring-S_S8AW_20260919_PPG.txt", "clips": {"ppg": 0}, "held": None},
            {"file": "Polar_H10_0284_20260919_ECG.txt", "clips": {"ecg": 0}, "held": None},
        ]
    }
    o = nightqc.backcheck_verdict(d, summ)
    verdict.validate(o)
    assert o["status"] == "PASS" and o["population"] == {"checked": 2, "eligible": 2, "excluded": 0}
    assert o["result"] == {
        "clip_regions": 0,
        "held_streams": 0,
        "files": {
            "Wellue_O2Ring-S_S8AW_20260919_PPG.txt": {"clip_regions": 0, "held": False},
            "Polar_H10_0284_20260919_ECG.txt": {"clip_regions": 0, "held": False},
        },
    }


def test_backcheck_fail_counts_clips_across_channels_and_held_streams_per_file(tmp_path):
    d = _night(tmp_path, ["A_1_PPG.txt", "A_1_PPG2W.txt", "B_1_ECG.txt"])
    summ = {
        "class_b": [
            {"file": "A_1_PPG.txt", "clips": {"ppg": 25}, "held": None},
            {"file": "A_1_PPG2W.txt", "clips": {"ppg2w:ch0": 2, "ppg2w:ch1": 0}, "held": None},
            {"file": "B_1_ECG.txt", "clips": {}, "held": 512},
        ]
    }
    o = nightqc.backcheck_verdict(d, summ)
    assert o["status"] == "FAIL" and o["result"]["clip_regions"] == 27 and o["result"]["held_streams"] == 1
    assert "A_1_PPG.txt: 25 clip region(s)" in o["reason"] and "B_1_ECG.txt: 0 clip region(s), held" in o["reason"]


def test_backcheck_makes_the_skipped_files_VISIBLE_as_excluded(tmp_path):
    """The new information. class_b_quality `continue`s past a file it cannot judge, so a night whose
    only PPG file was skipped produced an empty list — which night_report read as '0 spans, ok'.
    eligible counts the files on disk; checked counts the blocks; the difference is what nobody examined."""
    d = _night(tmp_path, ["A_1_PPG.txt", "A_1_ECG.txt", "A_1_ACC.txt"])
    o = nightqc.backcheck_verdict(d, {"class_b": [{"file": "A_1_ECG.txt", "clips": {"ecg": 0}, "held": None}]})
    assert o["status"] == "PASS" and o["population"] == {"checked": 1, "eligible": 2, "excluded": 1}
    o = nightqc.backcheck_verdict(d, {"class_b": []})
    assert o["status"] == "UNKNOWN" and o["population"] == {"checked": 0, "eligible": 2, "excluded": 2}
    assert "nothing was examined" in o["reason"]


def test_backcheck_with_no_class_b_file_is_NOT_RUN_and_a_missing_dir_too(tmp_path):
    d = _night(tmp_path, ["A_1_ACC.txt", "QC-SUMMARY.json"])
    o = nightqc.backcheck_verdict(d, {"class_b": []})
    assert o["status"] == "NOT_RUN" and o["result"] is None and o["population"]["eligible"] == 0
    o = nightqc.backcheck_verdict(str(tmp_path / "gone"), {})
    assert o["status"] == "NOT_RUN"


def test_a_crash_inside_backcheck_is_UNKNOWN_naming_the_exception(tmp_path):
    d = _night(tmp_path, ["A_1_PPG.txt"])
    o = nightqc.backcheck_verdict(
        d,
        {
            "class_b": [
                {"file": "A_1_PPG.txt", "clips": {"ppg": "25"}, "held": None},
                {"file": None, "clips": {"x": 1}, "held": None},
            ]
        },
    )
    verdict.validate(o)
    assert o["status"] in ("PASS", "FAIL", "UNKNOWN")  # a string count is ignored, a None file tolerated
    o = nightqc.backcheck_verdict(d, {"class_b": 5})  # not a list: iterating an int raises
    assert o["status"] == "UNKNOWN" and "the gate raised TypeError" in o["reason"]


def test_write_verdicts_puts_the_objects_beside_the_summary_and_survives_a_read_only_dir(
    tmp_path, monkeypatch, caplog
):
    d = _night(tmp_path, ["A_1_PPG.txt"])
    summ = _summary(class_b=[{"file": "A_1_PPG.txt", "clips": {"ppg": 0}, "held": None}])
    nightqc.write_verdicts(d, summ, DEV)
    qc = json.load(open(os.path.join(d, "QC-VERDICT.json")))
    bc = json.load(open(os.path.join(d, "BACKCHECK-VERDICT.json")))
    verdict.validate(qc)
    verdict.validate(bc)
    ah = json.load(open(os.path.join(d, "ADAPTERHCI-VERDICT.json")))   # the third object (adapter_hci, 2026-09-22)
    verdict.validate(ah)
    assert qc["gate"] == "night-qc" and bc["gate"] == "night-backcheck" and ah["gate"] == "adapter-hci"
    assert ah["status"] == "NOT_RUN", "a night with no ADAPTERHCI.csv rows in its window is NOT_RUN, never PASS"
    assert not os.path.exists(os.path.join(d, "QC-VERDICT.json.tmp"))
    monkeypatch.setattr(verdict, "write", lambda p, o: (_ for _ in ()).throw(OSError("read-only")))
    with caplog.at_level("WARNING"):
        nightqc.write_verdicts(d, summ, DEV)  # logged, not raised — the summary write is not lost to it
    assert sum("could not write" in r.getMessage() for r in caplog.records) == 3


# ── ABSENT IS NOT DEGRADED — SOLID-NIGHT night 1, 2026-09-25 ─────────────────────────────────────
# A synthetic fixture of the numbers measured on the box at 21:33 EDT on 2026-09-24, before the kit was
# strapped on at 21:49: three expected devices, the Verity answering `in_charger` on every PMD
# negotiation, the H10 and ring at `connected=0`, and the Verity linked at RSSI −47 / battery 100 as the
# radio witness. Synthetic on purpose — the corpus rule keeps recordings out of the repo, and the live
# evidence was overwritten the moment capture started.
NIGHT1 = [
    {"name": "Polar H10 02849638", "device_id": "02849638", "streams": ["ecg", "acc", "hr"]},
    {"name": "Polar Sense 0C301E3F", "device_id": "0C301E3F", "streams": ["ppg", "acc", "ppi"]},
    {"name": "Wellue O2Ring-S", "device_id": "S8AW2100", "streams": ["spo2", "ppg", "acc"]},
    {"name": "COOSPO 808S", "device_id": "0022265", "streams": ["hr"], "optional": True},
]
_ALL_NINE = [f"{d['name']}:{s}" for d in NIGHT1 if not d.get("optional") for s in d["streams"]]


def test_PLANT_a_night_nobody_wore_is_UNKNOWN_not_FAIL():
    """The defect this was written for. Every zero-row stream lands in `missing`, and ANY `missing`
    entry used to be a FAIL — so a kit on its dock convicted the box of a fault belonging to nobody.
    The band says a no-wear night is NOT_APPLICABLE and never FAIL, and the counter SKIPS it."""
    o = nightqc.qc_verdict(_summary(devices=[], missing=list(_ALL_NINE)), NIGHT1)
    verdict.validate(o)
    assert o["status"] == "UNKNOWN", f"a night nobody wore is not a failed night: {o['status']}"
    assert "indistinguishable" in o["reason"], o["reason"]
    # It must say WHICH two states it cannot separate, not merely that it does not know.
    assert "dead adapter" in o["reason"] and "wore" in o["reason"], o["reason"]
    assert o["result"]["absent"] == sorted({d["name"] for d in NIGHT1 if not d.get("optional")})
    assert o["result"]["absent_witnessed_by"] == [], "nothing recorded, so nothing witnesses the radio"


def test_PLANT_the_population_stays_an_EQUALITY_when_devices_are_absent():
    """An absent device was DECLARED, so it is excluded and never silently dropped — and a PASS over
    `checked: 0` is refused by the schema rather than by convention."""
    o = nightqc.qc_verdict(_summary(devices=[], missing=list(_ALL_NINE)), NIGHT1)
    p = o["population"]
    assert p["checked"] + p["excluded"] == p["eligible"], p
    assert p == {"checked": 0, "eligible": 10, "excluded": 10}, p   # 9 expected + the COOSPO's hr


def test_PLANT_a_recording_sibling_WITNESSES_the_radio_and_the_absent_one_is_excluded():
    """The discriminator. One device recording proves the radio worked, so the silent one is
    declared-but-not-judged and the verdict comes from the device that did record — NOT a FAIL for the
    absence, and NOT a PASS that pretends nine streams were examined."""
    miss = [m for m in _ALL_NINE if not m.startswith("Polar H10")]
    o = nightqc.qc_verdict(
        _summary(devices=[{"name": "Polar H10 02849638", "coverage": {"ecg": 0.99, "acc": 0.99, "hr": 0.99}}],
                 missing=miss), NIGHT1)
    verdict.validate(o)
    assert o["status"] == "PASS", f"the recording device met coverage: {o['status']} / {o['reason']}"
    assert o["result"]["absent"] == ["Polar Sense 0C301E3F", "Wellue O2Ring-S"]
    assert o["result"]["absent_witnessed_by"] == ["Polar H10 02849638"]
    assert o["population"] == {"checked": 3, "eligible": 10, "excluded": 7}


def test_CONTROL_a_genuine_low_coverage_recording_STILL_FAILS():
    """The refusal must not blind the gate. A device that recorded and lost packets is the loss this
    metric exists to catch, and 0.47 on a stream with rows is still a FAIL — unchanged by any of the
    above. Asserts only keys that exist before and after, so it runs against origin/main too."""
    o = nightqc.qc_verdict(
        _summary(devices=[{"name": "Polar H10 02849638", "coverage": {"ecg": 0.47, "acc": 0.47, "hr": 0.47}}],
                 degraded=["Polar H10 02849638:ecg 47%"]), NIGHT1)
    verdict.validate(o)
    assert o["status"] == "FAIL", "rows present and coverage under the floor is a real loss"
    assert "47%" in o["reason"]


def test_PLANT_a_PARTIALLY_missing_device_is_not_absent_and_still_FAILS():
    """A PLANT, not a control: it asserts `absent`/`absent_witnessed_by`, which main does not publish.\n\n    The boundary. Absence is ALL of a device's streams; one stream down while the others record is a
    partial failure, which is exactly what this gate is for."""
    others = [m for m in _ALL_NINE if not m.startswith("Polar H10")]
    o = nightqc.qc_verdict(
        _summary(devices=[{"name": "Polar H10 02849638", "coverage": {"ecg": 0.99, "acc": 0.99}}],
                 missing=["Polar H10 02849638:hr"] + others), NIGHT1)
    verdict.validate(o)
    assert o["status"] == "FAIL", "one stream of a recording device is a fault, not an absence"
    # The H10 recorded two of three, so it is NOT absent and its one gap convicts it. The other two
    # produced nothing at all and are excluded, witnessed by the H10.
    assert o["result"]["absent"] == ["Polar Sense 0C301E3F", "Wellue O2Ring-S"]
    assert o["result"]["absent_witnessed_by"] == ["Polar H10 02849638"]
    assert "Polar H10 02849638:hr" in o["reason"]
    assert not any(m.startswith(("Polar Sense", "Wellue")) for m in o["result"]["missing"]), \
        "an excluded device's absence must not ALSO be reported as a fault to judge"
    assert o["population"] == {"checked": 3, "eligible": 10, "excluded": 7}


def test_a_config_of_only_OPTIONAL_backups_examined_nothing_and_says_NOT_RUN():
    """`eligible` is non-zero — backups were declared — but nothing was EXPECTED, so nothing was judged.
    Distinct from the no-device case above (`eligible == 0`) and from the all-absent UNKNOWN: there is no
    expected device to be absent, so there is nothing for a sibling to witness. A PASS here would be a
    pass over `checked: 0`, which the schema refuses."""
    only_backups = [{"name": "COOSPO 808S", "device_id": "0022265", "streams": ["hr"], "optional": True}]
    o = nightqc.qc_verdict(_summary(devices=[]), only_backups)
    verdict.validate(o)
    assert o["status"] == "NOT_RUN", o["status"]
    assert o["population"] == {"checked": 0, "eligible": 1, "excluded": 1}
    assert o["result"] is None, "NOT_RUN examined nothing, so it carries no result"
