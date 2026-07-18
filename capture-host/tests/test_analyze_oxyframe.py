# tepna-capture — tests for analyze_oxyframe.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The point of these tests is NOT that the analyzer runs. It is that the analyzer can TELL THE
# HYPOTHESES APART. A tool that always answers "alert flag" would confirm the house hypothesis about
# O2Ring byte [11] and teach us nothing — so each test builds a sidecar under a KNOWN ground truth and
# asserts the analyzer reaches the right verdict, including the two ways it can be wrong (claiming an
# alert when the driver is motion, and claiming an alert when the flag actually PRECEDES the event).

from __future__ import annotations
import datetime as _dt
import random

import analyze_oxyframe as A

DESAT_AT = [200, 450, 700, 950, 1200, 1500]
N = 1800


def _build(tmp_path, mode: str, seed: int = 7):
    rng = random.Random(seed)
    t0 = _dt.datetime(2026, 7, 19, 1, 0, 0)
    p = tmp_path / f"synth_{mode}_OXYFRAME.txt"
    with open(p, "w") as fh:
        fh.write("Phone timestamp;seq;flag11;spo2;pr;motion;contact;battery_pct\n")
        for i in range(N):
            in_desat = any(s <= i < s + 40 for s in DESAT_AT)
            spo2 = (88 + rng.randint(-2, 1)) if in_desat else (96 + rng.randint(0, 2))
            motion = 1 if rng.random() < 0.10 else 0
            if mode == "alert":
                f = rng.choice([1, 2, 4]) if in_desat and rng.random() < 0.6 else 0
            elif mode == "perfusion":
                f = 20 + int(8 * rng.random())
            elif mode == "motion":
                f = rng.choice([1, 2]) if motion and rng.random() < 0.8 else 0
            elif mode == "noise":
                f = rng.randint(1, 29) if rng.random() < 0.08 else 0
            elif mode == "predictor":          # fires BEFORE the desat — no alarm can do this
                f = rng.choice([1, 2, 4]) if any(s - 15 <= i < s + 5 for s in DESAT_AT) and rng.random() < 0.7 else 0
            elif mode == "flat":
                f = 0
            t = t0 + _dt.timedelta(seconds=i)
            fh.write(f"{t.strftime('%Y-%m-%dT%H:%M:%S.')}{t.microsecond // 1000:03d};"
                     f"{i % 256};{f};{spo2};60;{motion};1;90\n")
    return str(p)


def _analyse(path):
    rows = A.parse_sidecar(path)
    fb = [bool(r["flag11"]) for r in rows]
    desat = A.mark_desat(rows, 3, 90)
    motion = [bool(r["motion"]) for r in rows]
    rng = random.Random(1)
    phi_d, p_d = A.perm_test(fb, desat, 2000, rng)
    phi_m, p_m = A.perm_test(fb, motion, 2000, rng)
    worn = [r for r in rows if A.valid_spo2(r["spo2"])]
    frac = sum(1 for r in worn if r["flag11"]) / max(1, len(worn))
    lag = max(A.lead_lag(fb, desat), key=lambda kv: abs(kv[1]))[0] if any(fb) and any(desat) else None
    return {"phi_desat": phi_d, "p_desat": p_d, "phi_motion": phi_m, "p_motion": p_m,
            "frac_nz": frac, "lag": lag}


def test_alert_ground_truth_is_identified_as_an_alert(tmp_path):
    r = _analyse(_build(tmp_path, "alert"))
    assert r["phi_desat"] > 0.5 and r["p_desat"] < 0.01      # strongly tied to desaturation
    assert abs(r["phi_motion"]) < 0.2                        # and NOT to motion
    assert r["frac_nz"] < 0.5                                # mostly zero => event marker, not an index
    assert r["lag"] >= 0                                     # a response cannot precede its trigger


def test_motion_ground_truth_is_NOT_misread_as_a_desat_alert(tmp_path):
    """The false-positive that would matter most: blaming desaturation for a motion-driven byte."""
    r = _analyse(_build(tmp_path, "motion"))
    assert r["phi_motion"] > 0.5 and r["p_motion"] < 0.01
    assert abs(r["phi_desat"]) < 0.2                         # must NOT claim the desat association


def test_perfusion_ground_truth_is_distinguishable_from_an_event_flag(tmp_path):
    """A continuous index is non-zero essentially always — that alone separates it from a flag."""
    r = _analyse(_build(tmp_path, "perfusion"))
    assert r["frac_nz"] > 0.9
    assert abs(r["phi_desat"]) < 0.2


def test_random_noise_is_not_promoted_to_a_finding(tmp_path):
    r = _analyse(_build(tmp_path, "noise"))
    assert abs(r["phi_desat"]) < 0.2                         # below the reporting bar
    assert abs(r["phi_motion"]) < 0.2


def test_a_flag_that_PRECEDES_the_desat_is_not_called_an_alert(tmp_path):
    """The lead/lag sign convention got inverted once: a series built to LEAD the event by 15 frames was
    reported as +15 and labelled 'consistent with an alert' — the exact wrong call. Positive lag MUST
    mean the flag FOLLOWS the event."""
    r = _analyse(_build(tmp_path, "predictor"))
    assert r["lag"] < 0, f"a leading flag must report a NEGATIVE lag, got {r['lag']}"


def test_all_zero_flag_yields_no_verdict_rather_than_a_fabricated_one(tmp_path):
    """The current real-world state (ring off the finger, 526 frames, flag11 always 0). The tool must
    say it cannot identify the byte, not invent an association from a constant series."""
    path = _build(tmp_path, "flat")
    rows = A.parse_sidecar(path)
    assert all(r["flag11"] == 0 for r in rows)
    assert A.phi([False] * len(rows), A.mark_desat(rows, 3, 90)) == 0.0   # constant => phi 0, not NaN
    assert A.main([path, "--perm", "50"]) == 0                            # exits cleanly, no crash


def test_blank_columns_are_none_never_a_fabricated_zero(tmp_path):
    """An off-finger frame has a BLANK SpO2. Coercing it to 0 would invent a desaturation in every
    such frame and manufacture the very association we are testing for."""
    p = tmp_path / "blank_OXYFRAME.txt"
    p.write_text("Phone timestamp;seq;flag11;spo2;pr;motion;contact;battery_pct\n"
                 "2026-07-19T01:00:00.000;1;0;;;0;0;90\n")
    rows = A.parse_sidecar(str(p))
    assert rows[0]["spo2"] is None and rows[0]["pr"] is None
    assert not A.valid_spo2(rows[0]["spo2"])
    assert A.mark_desat(rows, 3, 90) == [False]      # absence of a reading is NOT hypoxia
