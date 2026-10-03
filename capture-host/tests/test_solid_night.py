# tepna-capture — tests/test_solid_night.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The SOLID-NIGHT composition core (SOLID-NIGHT-2026-09-23-BRIEF §3.1): precedence over band decisions
that are already made, the population equality, the settle trigger, and the consecutive count. Every
verdict is checked by BOTH validators — Python's `verdict.validate` (inside `make`) and verdict.js."""

import pytest

import solid_night as sn
from tests.test_verdict import js_validate

EV = ["capture-host/solid_night.py", "captures/2026-09-20"]
AT = "2026-09-21T07:00:00Z"
SHA = "abc1234"

OK = {"status": "PASS", "reason": None}


def _fail(why="bad"):
    return {"status": "FAIL", "reason": why}


def _unk(why="unreadable"):
    return {"status": "UNKNOWN", "reason": why}


def _night(devices, settled=True):
    v = sn.compose(night="2026-09-20", settled=settled, devices=devices, evidence=EV, commit=SHA, at=AT)
    js_validate(v)
    return v


# ── device_outcome ──────────────────────────────────────────────────────────────────────────────────


def test_a_device_judged_on_nothing_is_unknown_never_pass():
    assert sn.device_outcome({}) == ("UNKNOWN", ["no band was evaluated for this device"])


def test_fail_outranks_unknown_outranks_pass_within_a_device():
    st, why = sn.device_outcome({"continuity": _fail("3.2 min daemon:clock re-sync"), "clocks": _unk(), "validity": OK})
    assert st == "FAIL" and why == ["continuity: 3.2 min daemon:clock re-sync"]
    st, why = sn.device_outcome({"clocks": _unk("no offset"), "validity": OK})
    assert st == "UNKNOWN" and why == ["clocks: no offset"]
    assert sn.device_outcome({"validity": OK, "clocks": OK}) == ("PASS", [])


def test_a_missing_reason_is_named_not_blank():
    assert sn.device_outcome({"x": {"status": "FAIL"}}) == ("FAIL", ["x: failed"])
    assert sn.device_outcome({"x": {"status": "UNKNOWN"}}) == ("UNKNOWN", ["x: undecided"])


def test_a_band_status_outside_pass_fail_unknown_is_refused():
    with pytest.raises(ValueError, match="not one of"):
        sn.device_outcome({"x": {"status": "SHORTFALL"}})


# ── compose: §3.1 precedence ────────────────────────────────────────────────────────────────────────


def test_not_settled_overrides_even_a_failing_night():
    v = _night({"H10": {"bands": {"continuity": _fail()}}}, settled=False)
    assert v["status"] == "UNKNOWN" and v["reason"] == sn.NOT_SETTLED
    # An unsettled night still carries what was scored so far: the reader sees the FAIL it is waiting on.
    assert v["result"]["night"] == "2026-09-20" and v["result"]["failing"] == 1
    assert v["result"]["devices"]["H10"]["status"] == "FAIL"


def test_an_empty_expected_list_is_unknown_and_says_why():
    v = _night({})
    assert v["status"] == "UNKNOWN" and "no expected device" in v["reason"]
    assert v["population"] == {"checked": 0, "eligible": 0, "excluded": 0}
    assert v["result"] == {"night": "2026-09-20", "devices": {}, "not_applicable": {}, "failing": 0, "unknown": 0}


def test_one_device_failing_is_a_fail_even_when_another_is_unknown():
    """§3.1 rule 2: a clear failure is not hidden behind another device's UNKNOWN."""
    v = _night({"H10": {"bands": {"continuity": _fail("2 min unattributed")}}, "Verity": {"bands": {"clocks": _unk()}}})
    assert v["status"] == "FAIL"
    assert "H10 — continuity: 2 min unattributed" in v["reason"]
    assert v["result"]["failing"] == 1 and v["result"]["unknown"] == 1


def test_no_fail_but_an_undecided_band_is_unknown():
    v = _night({"H10": {"bands": {"validity": OK}}, "Verity": {"bands": {"validity": _unk("sidecar absent")}}})
    assert v["status"] == "UNKNOWN" and v["reason"] == "Verity — validity: sidecar absent"
    assert v["result"]["unknown"] == 1 and v["result"]["failing"] == 0
    assert v["result"]["devices"]["H10"]["status"] == "PASS"


def test_every_scored_device_passing_is_a_pass_with_no_reason():
    v = _night({"H10": {"bands": {"validity": OK}}, "ring": {"bands": {"validity": OK}}})
    assert v["status"] == "PASS" and v["reason"] is None
    assert v["population"] == {"checked": 2, "eligible": 2, "excluded": 0}


def test_a_witnessed_no_wear_device_is_excluded_not_failed():
    v = _night({"H10": {"bands": {"validity": OK}}, "Verity": {"applicable": False, "reason": "in_charger"}})
    assert v["status"] == "PASS"
    assert v["population"] == {"checked": 1, "eligible": 2, "excluded": 1}
    assert v["result"]["not_applicable"] == {"Verity": "in_charger"}


def test_nobody_wearing_anything_is_not_applicable_with_null_result():
    v = _night(
        {
            "H10": {"applicable": False, "reason": "sibling on hci0"},
            "ring": {"applicable": False, "reason": "finger-in"},
        }
    )
    assert v["status"] == "NOT_APPLICABLE" and v["result"] is None
    assert v["population"] == {"checked": 0, "eligible": 2, "excluded": 2}
    assert "nobody wore anything" in v["reason"] and "H10 — sibling on hci0" in v["reason"]


def test_an_unstated_witness_is_not_a_witness():
    """A device without `applicable: False` is SCORED — and with no bands it is UNKNOWN, not excused."""
    v = _night({"H10": {}})
    assert v["status"] == "UNKNOWN" and v["population"]["checked"] == 1
    assert "no band was evaluated" in v["reason"]


def test_the_gate_and_criterion_are_the_contract():
    v = _night({"H10": {"bands": {"validity": OK}}})
    assert v["gate"] == "solid-night" and v["criterion"]["direction"] == "eq" and v["criterion"]["threshold"] == 0


# ── consecutive ─────────────────────────────────────────────────────────────────────────────────────


def _days(start, statuses):
    """Consecutive calendar nights from `start` (YYYY-MM-DD, day of September 2026)."""
    return [(f"2026-09-{start + i:02d}", st, rs) for i, (st, rs) in enumerate(statuses)]


P = ("PASS", None)
NA = ("NOT_APPLICABLE", "in_charger")
F = ("FAIL", "bad")
U = ("UNKNOWN", "sidecar absent")
PEND = ("UNKNOWN", sn.NOT_SETTLED)


def test_no_nights_is_an_empty_run():
    r = sn.consecutive([])
    assert r == {
        "solid": 0,
        "nights": 0,
        "days": 0,
        "first": None,
        "last": None,
        "pending": None,
        "exit": False,
        "statement": "0 solid of 0 nights over 0 days",
    }


def test_a_run_of_passes_counts_and_states_its_span():
    r = sn.consecutive(_days(1, [P, P, P]))
    assert (r["solid"], r["nights"], r["days"], r["first"], r["last"]) == (3, 3, 3, "2026-09-01", "2026-09-03")
    assert r["statement"] == "3 solid of 3 nights over 3 days"


def test_no_wear_skips_inside_a_run_and_stays_visible_in_the_span():
    r = sn.consecutive(_days(1, [P, NA, NA, P]))
    assert (r["solid"], r["nights"], r["days"]) == (2, 4, 4)


def test_no_wear_before_the_first_pass_and_after_the_last_is_not_in_the_span():
    r = sn.consecutive(_days(1, [NA, P, P, NA]))
    assert (r["solid"], r["nights"], r["first"], r["last"]) == (2, 2, "2026-09-02", "2026-09-03")


def test_fail_resets_the_run():
    assert sn.consecutive(_days(1, [P, P, F, P]))["solid"] == 1


def test_a_settled_unknown_resets_because_it_cannot_bridge_a_run():
    assert sn.consecutive(_days(1, [P, P, U, P]))["solid"] == 1


def test_any_other_status_is_not_solid_and_resets():
    assert sn.consecutive(_days(1, [P, ("NOT_RUN", "crashed"), P]))["solid"] == 1


def test_the_latest_unsettled_night_is_pending_not_a_reset():
    r = sn.consecutive(_days(1, [P, P, PEND]))
    assert r["solid"] == 2 and r["pending"] == "2026-09-03"


def test_an_unsettled_night_that_is_not_the_latest_resets():
    """It should have settled when its successor started; still unsettled means unassessed."""
    r = sn.consecutive(_days(1, [P, PEND, P]))
    assert r["solid"] == 1 and r["pending"] is None


def test_input_order_does_not_matter():
    """Not a palindrome: [F, P, NA, P] reversed reads [P, NA, P, F], which would count 0 if order leaked."""
    shuffled = list(reversed(_days(1, [F, P, NA, P])))
    r = sn.consecutive(shuffled)
    assert (r["solid"], r["nights"], r["first"], r["last"]) == (2, 3, "2026-09-02", "2026-09-04")


def test_a_night_given_twice_is_refused():
    """Which of two verdicts for one night counts would be a guess, so neither does."""
    with pytest.raises(ValueError, match="twice"):
        sn.consecutive([*_days(1, [P, F]), ("2026-09-02", *P)])


def test_the_exit_is_fourteen_solid_nights():
    assert sn.consecutive(_days(1, [P] * 13))["exit"] is False
    r = sn.consecutive(_days(1, [P] * 14))
    assert r["exit"] is True and r["statement"] == "14 solid of 14 nights over 14 days"


# ── the nightly runner: night_verdict · history · write_night ───────────────────────────────────────


def _verdict_file(captures, night, status, reason=None):
    d = captures / night
    d.mkdir(parents=True, exist_ok=True)
    (d / sn.VERDICT_NAME).write_text(__import__("json").dumps({"status": status, "reason": reason}))
    return d


def test_history_starts_at_the_first_verdict_and_reads_a_missing_one_after_it_as_unassessed(tmp_path):
    _verdict_file(tmp_path, "2026-09-02", "PASS")
    _verdict_file(tmp_path, "2026-09-04", "FAIL", "bad")
    nights = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]
    h = sn.history(str(tmp_path), nights, active={"2026-09-05"})
    assert h == [
        ("2026-09-02", "PASS", None),
        ("2026-09-03", "UNKNOWN", sn.NO_VERDICT),  # settled, never assessed: it cannot bridge a run
        ("2026-09-04", "FAIL", "bad"),
        ("2026-09-05", "UNKNOWN", sn.NOT_SETTLED),
    ]
    assert sn.history(str(tmp_path), ["2026-09-01"], active={"2026-09-01"}) == []  # before the programme


def test_write_night_writes_a_valid_verdict_beside_the_night_with_the_run_as_of_it(tmp_path):
    _verdict_file(tmp_path, "2026-09-18", "PASS")
    _verdict_file(tmp_path, "2026-09-19", "NOT_APPLICABLE", "in_charger")
    nd = tmp_path / "2026-09-20"
    nd.mkdir()
    obj, run = sn.write_night(
        str(nd), [], nights=["2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21"], active={"2026-09-21"}, commit=SHA
    )
    on_disk = __import__("json").loads((nd / sn.VERDICT_NAME).read_text())
    js_validate(on_disk)
    assert on_disk["status"] == "UNKNOWN" and "no expected device" in on_disk["reason"]  # devices [] this test
    # the night itself is a settled UNKNOWN ⇒ it RESETS the run, and a LATER active night never counts in it
    assert on_disk["result"]["run"] == run and run["solid"] == 0 and run["pending"] is None
    assert not (nd / (sn.VERDICT_NAME + ".tmp")).exists()


def test_write_night_hands_back_the_run_when_the_verdict_has_no_result_to_hold_it(tmp_path, monkeypatch):
    """NOT_APPLICABLE carries `result: null` by contract — the run still reaches the caller."""
    nd = tmp_path / "2026-09-20"
    nd.mkdir()
    na = sn.compose(
        night="2026-09-20",
        settled=True,
        devices={"H10": {"applicable": False, "reason": "in_charger"}},
        evidence=EV,
        commit=SHA,
        at=AT,
    )
    monkeypatch.setattr(sn, "night_verdict", lambda *a, **k: na)
    obj, run = sn.write_night(str(nd), [], nights=["2026-09-20"], active=set())
    assert obj["result"] is None and run["solid"] == 0 and run["nights"] == 0


def test_night_verdict_scores_the_configured_devices_from_the_files(tmp_path):
    v = sn.night_verdict(str(tmp_path / "2026-09-20"), [{"name": "Polar H10 x", "model": "H10"}], commit=SHA, at=AT)
    js_validate(v)
    assert v["result"]["night"] == "2026-09-20"
    assert v["status"] == "UNKNOWN" and "no-wear or radio down" in v["reason"]


# ── the written verdict beats a touched directory · the pending statement ───────────────────────────


def test_a_written_verdict_is_read_even_while_the_night_is_still_called_active(tmp_path):
    """The box's own state, 2026-09-29 15:40: `2026-09-28` had a FAIL verdict beside it, its device data
    had been quiet 11 h, and `active_nights` still listed it because the daemon appends the live-vitals
    `OXYLIFE.csv` into the previous night's directory every few minutes. Reading `active` first made an
    assessed night unassessed."""
    _verdict_file(tmp_path, "2026-09-27", "PASS")
    _verdict_file(tmp_path, "2026-09-28", "FAIL", "Wellue O2Ring-S — completeness 98.54 %")
    nights = ["2026-09-27", "2026-09-28", "2026-09-29"]
    h = sn.history(str(tmp_path), nights, active={"2026-09-28", "2026-09-29"})
    assert h == [
        ("2026-09-27", "PASS", None),
        ("2026-09-28", "FAIL", "Wellue O2Ring-S — completeness 98.54 %"),
        ("2026-09-29", "UNKNOWN", sn.NOT_SETTLED),
    ]


def test_a_lifecycle_append_no_longer_throws_away_the_pass_night_it_sits_beside(tmp_path):
    """The cost of the precedence, stated as the run: a PASS night whose directory keeps receiving
    `OXYLIFE.csv` used to read `not settled`, and a NON-LATEST `not settled` night resets the run (§3.1),
    so the night's own PASS was discarded with its verdict sitting beside it."""
    for d in range(1, 15):
        _verdict_file(tmp_path, f"2026-09-{d:02d}", "PASS")
    nights = [f"2026-09-{d:02d}" for d in range(1, 16)]
    touched = {"2026-09-14", "2026-09-15"}  # yesterday still being appended to, plus tonight
    run = sn.consecutive(sn.history(str(tmp_path), nights, active=touched))
    assert run["solid"] == 14 and run["exit"] is True
    assert run["pending"] == "2026-09-15"


def test_a_night_with_no_verdict_is_still_told_apart_from_one_that_was_never_assessed(tmp_path):
    """The precedence change must not collapse the two absences: `not settled` (still being written) and
    NO_VERDICT (settled and never assessed) decide the same way for the run but say different things, and
    `active` is what tells them apart once the verdict is known to be missing."""
    _verdict_file(tmp_path, "2026-09-01", "PASS")
    nights = ["2026-09-01", "2026-09-02", "2026-09-03"]
    h = sn.history(str(tmp_path), nights, active={"2026-09-03"})
    assert h[1] == ("2026-09-02", "UNKNOWN", sn.NO_VERDICT)
    assert h[2] == ("2026-09-03", "UNKNOWN", sn.NOT_SETTLED)


def _pending(tmp_path, night="2026-09-29", devices=None, nights=None, active=None):
    nd = tmp_path / night
    nd.mkdir(parents=True, exist_ok=True)
    return sn.pending_verdict(
        str(nd),
        devices if devices is not None else [{"name": "Polar H10 0284", "model": "H10"}],
        nights=nights if nights is not None else [night],
        active=active if active is not None else {night},
        commit=SHA,
        at=AT,
    )


def test_the_pending_verdict_is_unknown_not_settled_and_evaluates_no_band(tmp_path):
    obj, _run = _pending(tmp_path)
    js_validate(obj)
    assert obj["status"] == "UNKNOWN" and obj["reason"] == sn.NOT_SETTLED
    devs = obj["result"]["devices"]
    assert list(devs) == ["Polar H10 0284"]
    # NOT a shortfall measured against an interval that has not finished arriving (§∅).
    assert devs["Polar H10 0284"] == {"status": "UNKNOWN", "reasons": ["no band was evaluated for this device"]}
    assert obj["population"] == {"checked": 1, "eligible": 1, "excluded": 0}


def test_the_pending_verdict_writes_no_file_beside_the_night(tmp_path):
    """§2's verdict file belongs to the settled night: a file here would be a claim over data still arriving,
    and the next poll would read it back as that night's verdict."""
    _pending(tmp_path)
    assert list((tmp_path / "2026-09-29").iterdir()) == []


def test_the_pending_verdict_cites_only_evidence_that_exists(tmp_path):
    """The loss audit has not run for a night still being captured, so naming its file would be a citation
    to something absent — the shape this suite refuses everywhere else."""
    obj, _run = _pending(tmp_path)
    assert obj["evidence"] == [sn.TOOL, "capture-host/solid_night_inputs.py"]
    assert not any("LOSS" in e for e in obj["evidence"])


def test_the_pending_night_is_excluded_from_the_run_and_named_as_pending(tmp_path):
    for d in range(20, 29):
        _verdict_file(tmp_path, f"2026-09-{d:02d}", "PASS")
    nights = [f"2026-09-{d:02d}" for d in range(20, 30)]
    obj, run = _pending(tmp_path, nights=nights, active={"2026-09-29"})
    assert run["pending"] == "2026-09-29"
    assert run["solid"] == 9 and run["statement"] == "9 solid of 9 nights over 9 days"
    assert obj["result"]["run"] == run


def test_an_optional_device_that_did_not_capture_is_not_expected_while_pending(tmp_path):
    """§3.2 applies to the pending statement too: a backup that captured nothing is not a device the night
    is waiting on, and counting it would put an unearned entry in `population.eligible`."""
    devices = [{"name": "Polar H10 0284", "model": "H10"}, {"name": "spare", "model": "H10", "optional": True}]
    obj, _run = _pending(tmp_path, devices=devices)
    assert obj["population"]["eligible"] == 1
