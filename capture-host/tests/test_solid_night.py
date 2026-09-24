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


def test_the_exit_is_fourteen_solid_nights():
    assert sn.consecutive(_days(1, [P] * 13))["exit"] is False
    r = sn.consecutive(_days(1, [P] * 14))
    assert r["exit"] is True and r["statement"] == "14 solid of 14 nights over 14 days"
