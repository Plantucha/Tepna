# tepna-capture — tests/test_solid_night.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The SOLID-NIGHT composition core (SOLID-NIGHT-2026-09-23-BRIEF §3.1): precedence over band decisions
that are already made, the population equality, the settle trigger, and the consecutive count. Every
verdict is checked by BOTH validators — Python's `verdict.validate` (inside `make`) and verdict.js."""

import collections
import datetime as dt
import json
import os

import pytest

import solid_night as sn
import solid_night_inputs as si
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


def test_no_nights_is_NOT_RUN_and_NOT_a_measured_zero():
    """🔴 THIS TEST USED TO ENCODE THE DEFECT, asserting `solid 0 / nights 0 / days 0` and the sentence
    "0 solid of 0 nights over 0 days" for a run over NOTHING. §🧾's word for a pass that examined
    nothing is NOT_RUN, and §∅ forbids publishing a count for an unmeasured quantity — three zeros make
    the stronger claim that nights were examined and none was solid.

    Measured on the box 2026-10-04: six judge passes (12:30, 13:34, 15:37, 17:35, 18:47, 19:37)
    published that sentence while no night had a verdict at all. The old assertion is the reason none of
    them looked wrong."""
    r = sn.consecutive([])
    assert r == {
        "solid": None,
        "nights": None,
        "days": None,
        "first": None,
        "last": None,
        "pending": None,
        "exit": False,
        "status": "NOT_RUN",
        "statement": "no night was examined, so there is no run to report",
    }


def test_EXAMINED_NOTHING_and_EXAMINED_AND_FOUND_NOTHING_are_DISTINGUISHABLE():
    """The control the old assertion had no way to fail. Before this unit both calls returned the same
    dict and the same sentence; a reader of either could not tell which had happened."""
    nothing = sn.consecutive([])
    found = sn.consecutive([("2026-10-01", "FAIL", "bad")])
    assert nothing["status"] == "NOT_RUN" and found["status"] == "SHORTFALL"
    assert nothing["statement"] != found["statement"]
    assert nothing["solid"] is None, "unmeasured"
    assert found["solid"] == 0, "measured, and genuinely zero"
    assert found["statement"] == "0 solid of 0 nights over 0 days"


def test_a_RUN_THAT_REACHES_THE_EXIT_says_PASS_and_one_below_says_SHORTFALL():
    """`status` is the run's own verdict so a consumer stops re-deriving it from `exit`."""
    short = sn.consecutive([(f"2026-09-{d:02d}", "PASS", None) for d in range(1, sn.EXIT_SOLID)])
    full = sn.consecutive([(f"2026-09-{d:02d}", "PASS", None) for d in range(1, sn.EXIT_SOLID + 1)])
    assert short["status"] == "SHORTFALL" and short["exit"] is False
    assert full["status"] == "PASS" and full["exit"] is True
    assert full["solid"] == sn.EXIT_SOLID


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


# ── NOT_APPLICABLE: a band that does not bind ───────────────────────────────────────────────────────

NA_BAND = {"status": "NOT_APPLICABLE", "reason": "polled stream, rate declared not negotiated"}


def test_an_inapplicable_band_neither_passes_nor_fails_the_device():
    """ "Examined and the rule does not bind" is the verdict contract's own word, and it is not a flavour
    of UNKNOWN: UNKNOWN says the band could not be DECIDED and resets the run, while a band that does not
    bind was never a question about this device."""
    assert sn.device_outcome({"completeness": NA_BAND, "continuity": OK, "validity": OK}) == ("PASS", [])


def test_an_inapplicable_band_does_not_mask_a_failing_one():
    out, why = sn.device_outcome({"completeness": NA_BAND, "continuity": _fail("13 unattributed gaps")})
    assert out == "FAIL" and why == ["continuity: 13 unattributed gaps"]


def test_an_inapplicable_band_does_not_mask_an_undecided_one():
    out, why = sn.device_outcome({"completeness": NA_BAND, "continuity": _unk("audit absent")})
    assert out == "UNKNOWN" and why == ["continuity: audit absent"]


def test_a_device_whose_every_band_is_inapplicable_is_UNKNOWN_never_PASS():
    """The same rule as the empty band set, for the same reason: a device judged on nothing has not been
    judged. The count is named so the two cases stay distinguishable in the verdict."""
    out, why = sn.device_outcome({"completeness": NA_BAND, "clocks": NA_BAND})
    assert out == "UNKNOWN"
    assert why[0].startswith("every band is inapplicable for this device (2) — ")
    assert "polled stream, rate declared not negotiated" in why[0]
    assert sn.device_outcome({})[1] == ["no band was evaluated for this device"]


def test_an_inapplicable_band_with_no_reason_is_refused():
    """An inapplicable band that does not say what made it inapplicable is indistinguishable from a band
    quietly switched off — which is how a device stops being scored without anyone deciding it should."""
    with pytest.raises(ValueError, match="NOT_APPLICABLE without a reason"):
        sn.device_outcome({"completeness": {"status": "NOT_APPLICABLE", "reason": None}, "continuity": OK})
    with pytest.raises(ValueError, match="not one of"):
        sn.device_outcome({"completeness": {"status": "SKIPPED", "reason": "x"}})


def test_a_night_whose_only_finding_is_an_inapplicable_band_still_PASSES(tmp_path):
    """End to end: the ring night that used to FAIL on drift. The verdict carries the device as PASS and
    the night as PASS, and no reason is invented for it."""
    v = _night({"Wellue O2Ring-S": {"bands": {"completeness": NA_BAND, "continuity": OK, "clocks": OK}}})
    assert v["status"] == "PASS" and v["reason"] is None
    assert v["result"]["devices"]["Wellue O2Ring-S"] == {"status": "PASS", "reasons": []}


def test_a_BAD_BAND_STATUS_names_the_band_the_status_and_the_vocabulary(tmp_path):
    """The refusal's message is the whole value of the refusal: a reader hitting it needs to know WHICH
    band carried WHAT, and what the four legal words are. `match=` on a fragment leaves every mutation of
    the rest of the string alive, so the message is asserted whole."""
    with pytest.raises(ValueError) as e:
        sn.device_outcome({"completeness": {"status": "SKIPPED", "reason": "x"}})
    assert str(e.value) == (
        "band 'completeness': status 'SKIPPED' is not one of ('PASS', 'FAIL', 'UNKNOWN', 'NOT_APPLICABLE')"
    ), str(e.value)


def test_the_SAMPLE_is_a_night_that_passes_EVERY_band(tmp_path):
    """`sample_object` is the adoption gate's corpus-free emission, and its whole claim is that it is a
    CLEAN night: every band PASSES from real inputs, so the night does too.

    THE FIXTURE'S DETAILS ARE LOAD-BEARING AND THIS IS WHERE THEY ARE HELD. Two of them in particular:
    the device column carries a per-row offset so the axis is not a DRAWN counter (`clock.js`'s
    `CK_AXIS_DRAWN_SHARE` — a column advancing by a constant is by construction not a clock, and the
    timebase term would score the gate's own sample as "not a clock"); and the host jitter is positive
    and skips the first and last batch so no row crosses a whole second, which would move the
    completeness denominator. A verdict of `unknown: 1` or a non-empty `reasons` is how either failure
    shows up here."""
    v = sn.sample_object()
    assert v["status"] == "PASS", v.get("reason")
    assert v["result"]["failing"] == 0
    assert v["result"]["unknown"] == 0, "a band that cannot decide makes the sample a different claim"
    assert v["result"]["not_applicable"] == {}
    assert v["result"]["night"] == "2026-01-01"
    assert v["result"]["devices"] == {"Polar H10 SAMPLE": {"status": "PASS", "reasons": []}}
    assert v["population"] == {"checked": 1, "eligible": 1, "excluded": 0}


def test_the_SAMPLE_FIXTURE_carries_the_four_properties_it_needs(tmp_path):
    """Measured on the BYTES, because none of the four is visible in the verdict the fixture produces.

    Every band of `sample_object()` still passes when any one of them is violated, so the verdict cannot
    hold them — twenty-five mutations of this layout survived the mutation gate for exactly that reason.
    Reading the file the fixture wrote is the only place the claims are checkable."""
    night = tmp_path / sn.SAMPLE_NIGHT
    night.mkdir()
    assert sn.sample_night(str(night)) == [sn.SAMPLE_DEVICE]
    lines = (night / f"{sn.SAMPLE_BASE}_ECG.txt").read_text().splitlines()
    hdr, rows = lines[0], lines[1:]
    assert hdr.split(";") == ["Phone timestamp", "sensor timestamp [ns]", "timestamp [ms]", "ecg [uV]"]
    assert len(rows) == sn.SAMPLE_ROWS

    # THE NOMINAL COMES FROM THE FILENAME, NEVER FROM ROW 0. Taking `t0` from the first row makes the
    # first row correct by construction — the §🧾 shape of a threshold derived from the data it judges —
    # and a fixture that jitters EVERY row, including the two ends, then reads as perfectly aligned. The
    # 14-digit stamp in the base name is the declared start (Clock Contract §4, anchor rule 2), and it is
    # independent of the rows it names.
    t0 = dt.datetime.strptime(sn.SAMPLE_BASE.rsplit("_", 1)[1], "%Y%m%d%H%M%S")
    nominal = [t0 + dt.timedelta(seconds=i / 2) for i in range(sn.SAMPLE_ROWS)]
    hosts = [dt.datetime.fromisoformat(r.split(";")[0]) for r in rows]
    devs = [int(r.split(";")[1]) for r in rows]

    # 1 · 2 Hz over exactly 200 s, both ends ON the nominal — the span is a length, not a rounding.
    assert hosts[0] == nominal[0] and hosts[-1] == nominal[-1]
    assert (hosts[-1] - hosts[0]).total_seconds() == 200.0

    # 2 · ONE host offset per BLE frame. A frame is one real host measurement back-timed across its rows
    # (§🔒.7), and `residual_scan` takes one anchor per frame; a per-ROW offset would fabricate anchors
    # out of an interpolation. The first and last frames carry no offset at all, which is what keeps (1).
    offs = [round((h - n).total_seconds() * 1000.0) for h, n in zip(hosts, nominal)]
    frames = [offs[i : i + sn.SAMPLE_BATCH] for i in range(0, sn.SAMPLE_ROWS, sn.SAMPLE_BATCH)]
    assert all(len(set(f)) == 1 for f in frames), "every row of a frame shares its frame's host offset"
    assert set(offs[: sn.SAMPLE_BATCH]) == {0}, "the first frame is on the nominal"
    assert offs[-1] == 0, "and so is the last row, which is a frame of its own"
    # 1–5 ms, which is a BLE frame's back-timing span and not an arbitrary number: the stamps carry
    # whole milliseconds, so the set of offsets IS the full statement of the magnitude.
    assert set(offs) == {0, 1, 2, 3, 4, 5}, sorted(set(offs))

    # 3 · NON-NEGATIVE, so no row crosses a whole second backwards and the second it lands in is the
    # second its nominal lands in.
    assert min(offs) == 0 and max(offs) > 0
    assert all(h.second == n.second for h, n in zip(hosts, nominal))

    # 4 · NOT A DRAWN COUNTER, measured with THE BAND'S OWN INSTRUMENT rather than a second opinion: a
    # device column advancing by a constant is by construction not a clock (`clock.js
    # CK_AXIS_DRAWN_SHARE`), and the timebase band would score the adoption gate's own sample as "not a
    # clock". `TB_DRAWN_SHARE` is 0.67 because real streams measured at most 56 % and drawn ones at least
    # 79 %, with nothing in between — so the fixture is held to the REAL-STREAM side of that gap, not
    # merely to the near side of the threshold.
    share = si.residual_scan(str(night / f"{sn.SAMPLE_BASE}_ECG.txt"), None, None)["drawn_share"]
    assert share is not None
    assert share < si.TB_DRAWN_SHARE, f"the modal device delta is {share:.0%} of the anchors — reads as drawn"
    assert share <= 0.56, f"{share:.0%} is outside the range real streams measured at"
    assert devs == sorted(devs), "a device counter does not go backwards"
    # The device clock runs at the NOMINAL rate end to end — 0.5 s per row in ns — so the last stamp is
    # the span, not the span plus an accumulated error. A rate wrong by a part per billion is invisible
    # in the rendered ppm and visible here.
    nominal_last = int((sn.SAMPLE_ROWS - 1) / 2 * 1e9)
    assert 0 <= devs[-1] - nominal_last < 211, f"{devs[-1] - nominal_last} ns off the nominal span"
    assert devs[0] == 0, "and it starts at zero"
    assert len(collections.Counter(b - a for a, b in zip(devs, devs[1:]))) > 1, "the deltas spread"


def test_the_SAMPLE_FIXTURE_DECLARES_THE_ENCODING_IT_WRITES(tmp_path):
    """`encoding="utf-8"` on the four files the fixture writes, asserted on the CALL. `-X
    warn_default_encoding` with `-W error::EncodingWarning` makes every `open()` that leaves `encoding`
    unset — or explicitly None — raise, so the assertion holds on a UTF-8 machine and a C-locale one
    alike. A corpus-free sample that decodes differently per machine is not corpus-free.

    The in-process call first is NOT redundant: mutmut picks which tests to run for a mutant from
    COVERAGE, and a subprocess is invisible to the tracer."""
    import subprocess
    import sys

    night = tmp_path / sn.SAMPLE_NIGHT
    night.mkdir()
    assert sn.sample_night(str(night)) == [sn.SAMPLE_DEVICE]
    out = tmp_path / "again"
    (out / sn.SAMPLE_NIGHT).mkdir(parents=True)
    src = (
        "import solid_night as sn\n"
        f"got = sn.sample_night({str(out / sn.SAMPLE_NIGHT)!r})\n"
        "assert got == [sn.SAMPLE_DEVICE], got\n"
    )
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=str(sn.__file__).rsplit("/", 1)[0],
    )
    assert r.returncode == 0, r.stderr


def test_an_INAPPLICABLE_TIMEBASE_lets_an_otherwise_clean_RING_night_PASS():
    """🔴 THE POINT OF E18, at the device level. With the timebase band reading the completeness primary,
    the ring's four other bands could all PASS and the device still read UNKNOWN — because a polled
    vitals CSV has no `sensor timestamp [ns]` column and the band said so about the FILE. Measured here
    both ways: NOT_APPLICABLE lets the device decide on the bands that bind, UNKNOWN does not.

    `device_outcome` already computes over APPLICABLE bands only and already refuses a reasonless
    NOT_APPLICABLE, so this needs no new machinery — only the band to say the true thing."""
    clean = {t: {"status": "PASS", "reason": None} for t in ("continuity", "completeness", "validity", "clocks")}
    inapplicable = dict(clean, timebase={"status": "NOT_APPLICABLE", "reason": sn._inputs.NO_DEVICE_AXIS})
    assert sn.device_outcome(inapplicable) == ("PASS", []), sn.device_outcome(inapplicable)
    # and the shape it replaces: the same night, UNKNOWN, carrying a reason about a file rather than a device
    unknown = dict(
        clean,
        timebase={
            "status": "UNKNOWN",
            "reason": "`Wellue_O2Ring-S_…_SPO2.csv` carries no `sensor timestamp [ns]` column — no device clock",
        },
    )
    status, reasons = sn.device_outcome(unknown)
    assert status == "UNKNOWN" and len(reasons) == 1, (status, reasons)


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


def test_the_PENDING_NIGHT_FOLDER_may_be_given_WITH_A_TRAILING_SLASH(tmp_path):
    """`night_dir.rstrip("/")` twice over, and both strips are load-bearing: `basename` of a path ending
    in `/` is the EMPTY STRING and `dirname` of it is the folder itself. Without them a pending verdict
    is published for night `""` and its history is read from inside the night rather than from
    `captures/` — so the run length is computed against the wrong set and the card names no date.

    An ordinary trailing slash is the input this handles. Same shape as `_clocksync_rows`' night folder
    in #3245, and `lstrip` is in the mutation set too: it strips the LEADING slash instead, which makes
    `basename` of an absolute path right by accident and `dirname` wrong."""
    nd = tmp_path / "2026-09-29"
    nd.mkdir()
    # A PAST NIGHT WITH A WRITTEN VERDICT is what makes `captures` load-bearing. `history` reads
    # `<captures>/<night>/SOLID-VERDICT.json`, so a `captures` left pointing INSIDE the night finds
    # nothing, 09-28's PASS is lost, and the run resets — the same wrong answer the trailing slash
    # produces for `basename`, one directory further up. Without this file both strips look equivalent.
    past = tmp_path / "2026-09-28"
    past.mkdir()
    (past / sn.VERDICT_NAME).write_text(json.dumps({"status": "PASS", "reason": None}))
    plain, _ = sn.pending_verdict(
        str(nd),
        [{"name": "Polar H10 0284", "model": "H10"}],
        nights=["2026-09-28", "2026-09-29"],
        active={"2026-09-29"},
        commit=SHA,
        at=AT,
    )
    slashed, _ = sn.pending_verdict(
        str(nd) + "/",
        [{"name": "Polar H10 0284", "model": "H10"}],
        nights=["2026-09-28", "2026-09-29"],
        active={"2026-09-29"},
        commit=SHA,
        at=AT,
    )
    assert plain["result"]["night"] == "2026-09-29", plain["result"]["night"]
    assert plain["result"]["run"]["solid"] == 1, f"09-28's written PASS is in the run: {plain['result']['run']}"
    assert slashed == plain, "a trailing slash names the same night AND reads the same history"


def test_the_PENDING_VERDICT_names_a_device_by_its_MODEL_when_it_carries_no_NAME(tmp_path):
    """`d.get("name") or d.get("model")` — the fallback is the MODEL, and it has to be a real key: a
    device published under `"None"` is one no operator can match to hardware and no later verdict can
    attribute."""
    obj, _run = _pending(tmp_path, devices=[{"model": "H10"}])
    assert list(obj["result"]["devices"]) == ["H10"], obj["result"]["devices"]
    assert "None" not in obj["result"]["devices"]


def test_the_PENDING_VERDICT_FORWARDS_night_settled_commit_and_at_to_compose(tmp_path):
    """Four keyword arguments that only the composed object can show. `settled=False` is the whole point
    of this producer — it is what makes `compose` return before any band outcome is consulted and what
    `monitor.html` reads to style the card idle rather than as a finding. `night`, `commit` and `at` are
    the identity, the provenance and the stamp; a verdict missing any of them is unattributable.

    Asserted as the WHOLE provenance block and the whole result identity rather than field by field, so
    an argument dropped on the way through cannot hide behind a sibling that is still present."""
    obj, run = _pending(tmp_path)
    assert obj["result"]["night"] == "2026-09-29"
    # `settled=False` carries no field of its own — measured, not assumed: it surfaces as the REASON and
    # as the run's `pending` night, which is what `monitor.html` reads to style the card idle.
    assert obj["status"] == "UNKNOWN"
    assert obj["reason"] == "not settled", obj["reason"]
    assert run["pending"] == "2026-09-29", run
    assert obj["producedBy"] == {"tool": sn.TOOL, "commit": SHA}, obj["producedBy"]
    assert obj["at"] == AT


def test_a_REPLACED_VERDICT_IS_WITHDRAWN_WITH_ITS_REASON_never_silently_overwritten(tmp_path):
    """🔴 THE 2026-10-04 RED. Six judge passes published verdicts over a night whose data had not
    arrived; the 19:37 UNKNOWN was then overwritten by the 04:50 FAIL and the night's own artefacts held
    no evidence any of the six had existed. `os.replace` is atomic AND lossy, and only the journal — which
    rotates — could reconstruct the trail. Planted against main in `/tmp/claude-1000/plantB.py`: there,
    the directory holds one file before and one file after, and the prior claim is simply gone."""
    night = tmp_path / "2026-10-04"
    night.mkdir()
    (night / sn.VERDICT_NAME).write_text(
        json.dumps(
            {
                "status": "UNKNOWN",
                "reason": "`Polar_VeritySense_0C301E3F_20261004190825_PPGRUNS.txt` publishes no min_run",
                "at": "2026-10-04T23:37:37Z",
                "commit": "abc1234",
            }
        )
    )
    entry = sn._withdraw(
        str(night),
        {"status": "FAIL", "reason": "H10 — coverage 0.62", "at": "2026-10-05T03:50:02Z", "commit": "def5678"},
    )
    assert entry is not None and entry["recorded"] is True
    assert entry["withdrawn"]["status"] == "UNKNOWN"
    assert "publishes no min_run" in entry["withdrawn"]["reason"]
    assert entry["withdrawn"]["at"] == "2026-10-04T23:37:37Z"
    assert entry["replaced_by"]["status"] == "FAIL"
    assert "re-judged" in entry["reason"], "the withdrawal carries WHY, not just WHAT"
    lines = [json.loads(ln) for ln in (night / sn.WITHDRAWN_NAME).read_text().splitlines() if ln.strip()]
    assert len(lines) == 1 and lines[0]["withdrawn"]["at"] == "2026-10-04T23:37:37Z"


def test_a_FIRST_VERDICT_WITHDRAWS_NOTHING_and_writes_no_record(tmp_path):
    """The control: a withdrawal record appears only when something was actually replaced. A night
    judged once must not accumulate an empty trail."""
    night = tmp_path / "2026-10-06"
    night.mkdir()
    assert sn._withdraw(str(night), {"status": "PASS", "reason": None, "at": "x", "commit": "c"}) is None
    assert not (night / sn.WITHDRAWN_NAME).exists()


def test_SIX_SUCCESSIVE_REJUDGEMENTS_ARE_ALL_RECOVERABLE_in_order(tmp_path):
    """The real shape of 2026-10-04 — six passes, not one. A cap of one record would have discarded five
    of the six and left exactly the gap that made the night unexplainable."""
    night = tmp_path / "2026-10-04"
    night.mkdir()
    stamps = ["12:30", "13:34", "15:37", "17:35", "18:47", "19:37"]
    for i, hhmm in enumerate(stamps):
        (night / sn.VERDICT_NAME).write_text(
            json.dumps({"status": "UNKNOWN", "reason": f"pass {i}", "at": f"2026-10-04T{hhmm}:00Z", "commit": "c"})
        )
        sn._withdraw(str(night), {"status": "FAIL", "reason": "final", "at": "2026-10-05T03:50:02Z", "commit": "c"})
    lines = [json.loads(ln) for ln in (night / sn.WITHDRAWN_NAME).read_text().splitlines() if ln.strip()]
    assert len(lines) == len(stamps), "every superseded claim is kept, not just the last"
    assert [ln["withdrawn"]["at"][11:16] for ln in lines] == stamps, "in the order they were published"


def test_A_WITHDRAWAL_THAT_CANNOT_BE_WRITTEN_DOES_NOT_BLOCK_THE_TRUE_VERDICT(tmp_path):
    """Losing the record of a superseded claim is bad; refusing to publish the correct one is worse. So
    the failure is REPORTED in the entry and the replacement proceeds."""
    night = tmp_path / "2026-10-04"
    night.mkdir()
    (night / sn.VERDICT_NAME).write_text(json.dumps({"status": "UNKNOWN", "reason": "r", "at": "a", "commit": "c"}))
    (night / sn.WITHDRAWN_NAME).mkdir()  # a directory where the record must go: the write cannot succeed
    entry = sn._withdraw(str(night), {"status": "FAIL", "reason": "f", "at": "b", "commit": "c"})
    assert entry is not None
    assert entry["recorded"] is False and entry["record_error"]
    assert entry["withdrawn"]["status"] == "UNKNOWN", "and it still reports WHAT it could not record"


def test_WRITE_NIGHT_RECORDS_THE_WITHDRAWAL_IN_THE_VERDICT_IT_PUBLISHES(tmp_path):
    """End to end through the real writer: the replacing verdict itself carries `result.withdrew`, so a
    reader of the CURRENT file learns that it replaced something and why — without opening the trail."""
    night = tmp_path / sn.SAMPLE_NIGHT
    night.mkdir()
    devices = sn.sample_night(str(night))
    obj1, _ = sn.write_night(str(night), devices, nights=[sn.SAMPLE_NIGHT], active=set())
    assert obj1["result"].get("withdrew") is None, "the first verdict withdrew nothing"
    obj2, _ = sn.write_night(str(night), devices, nights=[sn.SAMPLE_NIGHT], active=set())
    w = obj2["result"]["withdrew"]
    assert w["recorded"] is True
    assert w["withdrawn"]["status"] == obj1["status"]
    assert (night / sn.WITHDRAWN_NAME).exists()


def test_THE_VERDICT_AND_ITS_WITHDRAWAL_TRAIL_DECLARE_THEIR_ENCODING(tmp_path):
    """Every `open()` in the write path asserted on the CALL. `-X warn_default_encoding` with
    `-W error::EncodingWarning` makes an unset — or explicitly None — `encoding` raise, so a verdict
    written on the box reads the same here whatever the machine's locale.

    The in-process calls first are NOT redundant: mutmut picks a mutant's tests from COVERAGE and a
    subprocess is invisible to the tracer, so without them these mutants read unkillable."""
    import subprocess
    import sys

    night = tmp_path / sn.SAMPLE_NIGHT
    night.mkdir()
    devices = sn.sample_night(str(night))
    sn.write_night(str(night), devices, nights=[sn.SAMPLE_NIGHT], active=set())
    sn.write_night(str(night), devices, nights=[sn.SAMPLE_NIGHT], active=set())  # the second one withdraws
    assert (night / sn.WITHDRAWN_NAME).exists()
    src = (
        "import solid_night as sn\n"
        f"d = sn.sample_night({str(night)!r})\n"
        f"sn.write_night({str(night)!r}, d, nights=[sn.SAMPLE_NIGHT], active=set())\n"
        f"sn.write_night({str(night)!r}, d, nights=[sn.SAMPLE_NIGHT], active=set())\n"
    )
    r = subprocess.run(
        [sys.executable, "-X", "warn_default_encoding", "-W", "error::EncodingWarning", "-c", src],
        capture_output=True,
        text=True,
        cwd=os.path.dirname(os.path.abspath(sn.__file__)),
    )
    assert r.returncode == 0, r.stderr


def test_THE_VERDICT_FILE_IS_WRITTEN_INDENTED_so_a_human_can_read_it(tmp_path):
    """`indent=1` is the published format, not an accident. A verdict is the artefact an operator opens
    at 07:00 and the one a later session diffs; a single-line dump makes both unreadable, and `indent=2`
    would silently rewrite every line of every verdict on the next pass."""
    night = tmp_path / sn.SAMPLE_NIGHT
    night.mkdir()
    devices = sn.sample_night(str(night))
    sn.write_night(str(night), devices, nights=[sn.SAMPLE_NIGHT], active=set())
    text = (night / sn.VERDICT_NAME).read_text()
    lines = text.splitlines()
    assert len(lines) > 10, "the verdict is indented across lines, not one dense line"
    assert lines[1].startswith(' "'), f"exactly one space of indent, got {lines[1][:8]!r}"
    assert not lines[1].startswith('  "'), "two spaces would rewrite every verdict on the next pass"
    assert json.loads(text)["gate"] == sn.GATE


def test_A_NIGHT_DIR_WITH_A_TRAILING_SLASH_IS_STILL_THAT_NIGHT(tmp_path):
    """`rstrip("/")`, and the mutant that makes it `lstrip("/")` is not cosmetic: on an absolute path
    `lstrip` leaves the TRAILING slash in place, so `basename` returns the empty string and the verdict
    would name a night called "". The daemon joins paths from config, and a config value ending in a
    separator is ordinary."""
    night = tmp_path / sn.SAMPLE_NIGHT
    night.mkdir()
    devices = sn.sample_night(str(night))
    # A PRECEDING NIGHT WITH A PASS, because the trailing slash is stripped TWICE for two different
    # purposes: once for the night's NAME and once for `captures`, the directory `history` reads the run
    # from. Without this, `dirname` of an unstripped path yields the night itself, `history` finds no
    # past verdict, and the run silently restarts — a wrong answer with no error. `lstrip` fails the same
    # way one level up, turning an absolute path into a relative one.
    prior = night.parent / "2025-12-31"
    prior.mkdir()
    (prior / sn.VERDICT_NAME).write_text(
        json.dumps({"status": "PASS", "reason": None, "at": AT, "result": {"night": "2025-12-31"}})
    )
    obj, run = sn.write_night(str(night) + "/", devices, nights=["2025-12-31", sn.SAMPLE_NIGHT], active=set())
    assert obj["result"]["night"] == sn.SAMPLE_NIGHT, "the night is named from the path's last component"
    assert (night / sn.VERDICT_NAME).exists(), "and the file lands inside the night, not beside it"
    assert run["first"] == "2025-12-31", "`captures` resolved, so the preceding PASS is in the run"
    assert run["solid"] == 2, "both nights counted: the run did not restart"


def test_THE_VERDICT_LANDS_INSIDE_THE_NIGHT_and_leaves_nothing_in_the_CWD(tmp_path, monkeypatch):
    """The temp file is joined onto `night_dir`. Dropping that argument writes `SOLID-VERDICT.json.tmp`
    into the process's working directory — on the box, the daemon's cwd — and then `os.replace` moves it
    across filesystems or fails. Asserted by watching the cwd, which is the only place the damage shows."""
    night = tmp_path / sn.SAMPLE_NIGHT
    night.mkdir()
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    monkeypatch.chdir(cwd)
    devices = sn.sample_night(str(night))
    sn.write_night(str(night), devices, nights=[sn.SAMPLE_NIGHT], active=set())
    assert (night / sn.VERDICT_NAME).exists()
    assert sorted(p.name for p in cwd.iterdir()) == [], "nothing is LEFT in the working directory"

    # ⚠️ THAT ASSERTION ALONE CANNOT SEE THE DEFECT, which is why the next one exists. Dropping
    # `night_dir` from the join writes `SOLID-VERDICT.json.tmp` into the process's cwd — and then
    # `os.replace` MOVES it into the night, so an after-the-fact look at the cwd finds it clean either
    # way. The invariant is that the temp file is created in the SAME DIRECTORY as its target: that is
    # what makes the replace atomic and keeps it from crossing filesystems (the box's captures live on
    # the corpus disk while the daemon's cwd does not). A read-only cwd is the input that separates them.
    ro = tmp_path / "ro"
    ro.mkdir()
    night2 = tmp_path / "2026-01-02"
    night2.mkdir()
    dev2 = sn.sample_night(str(night2))
    os.chmod(ro, 0o500)
    try:
        monkeypatch.chdir(ro)
        sn.write_night(str(night2), dev2, nights=["2026-01-02"], active=set())
    finally:
        os.chmod(ro, 0o700)
    assert (night2 / sn.VERDICT_NAME).exists(), "a verdict does not depend on the cwd being writable"


def test_THE_WRITTEN_VERDICT_CARRIES_THE_COMMIT_AND_THE_NIGHTS_OWN_DEVICES(tmp_path):
    """Provenance is part of the verdict (§🧾 `producedBy`), so the commit has to reach the file; and the
    device list has to reach `night_verdict`, or the night is scored against nothing."""
    night = tmp_path / sn.SAMPLE_NIGHT
    night.mkdir()
    devices = sn.sample_night(str(night))
    obj, _ = sn.write_night(str(night), devices, nights=[sn.SAMPLE_NIGHT], active=set(), commit="deadbee")
    assert obj["producedBy"]["commit"] == "deadbee", "the commit lives in producedBy (§🧾)"
    assert json.loads((night / sn.VERDICT_NAME).read_text())["producedBy"]["commit"] == "deadbee"
    assert obj["population"]["eligible"] == 1, "the night's own device was scored"
    assert obj["result"]["devices"], "a verdict over no device is not this night's verdict"


def test_A_WITHDRAWAL_BESIDE_A_NOT_APPLICABLE_VERDICT_DOES_NOT_CRASH(tmp_path):
    """The `and` in `withdrawn is not None and result is not None` carries weight. A NOT_APPLICABLE
    verdict has `result: null` by contract, so with `or` the function would subscript None and the
    night's true verdict would be lost to a TypeError — the failure mode the withdrawal exists to
    prevent, caused by the withdrawal."""
    night = tmp_path / "2026-10-04"
    night.mkdir()
    (night / sn.VERDICT_NAME).write_text(json.dumps({"status": "UNKNOWN", "reason": "r", "at": "a", "commit": "c"}))
    na = {"status": "NOT_APPLICABLE", "result": None, "at": "b", "commit": "c", "reason": "nobody wore anything"}
    w = sn._withdraw(str(night), na)
    assert w is not None and w["recorded"] is True
    assert na["result"] is None, "a NOT_APPLICABLE verdict keeps its null result"


def test_THE_WITHDRAWAL_IS_STAMPED_WITH_THE_REPLACEMENTS_OWN_TIME(tmp_path):
    """`replacement.get("at")` — the withdrawal happened when the replacing verdict was composed, and a
    reader reconstructing the trail orders entries by it."""
    night = tmp_path / "2026-10-04"
    night.mkdir()
    (night / sn.VERDICT_NAME).write_text(
        json.dumps({"status": "UNKNOWN", "reason": "r", "at": "2026-10-04T23:37:37Z", "commit": "c"})
    )
    w = sn._withdraw(str(night), {"status": "FAIL", "reason": "f", "at": "2026-10-05T03:50:02Z", "commit": "c"})
    assert w["at"] == "2026-10-05T03:50:02Z", "stamped with the replacement's time, not the withdrawn one"
    assert w["withdrawn"]["at"] == "2026-10-04T23:37:37Z"


def test_AN_UNWRITABLE_TRAIL_REPORTS_THE_REAL_ERROR_not_a_placeholder(tmp_path):
    """`str(exc)`. "None" as the error text is worse than no field: it says the failure was examined and
    had no cause."""
    night = tmp_path / "2026-10-04"
    night.mkdir()
    (night / sn.VERDICT_NAME).write_text(json.dumps({"status": "UNKNOWN", "reason": "r", "at": "a", "commit": "c"}))
    (night / sn.WITHDRAWN_NAME).mkdir()
    w = sn._withdraw(str(night), {"status": "FAIL", "reason": "f", "at": "b", "commit": "c"})
    assert w["recorded"] is False
    assert w["record_error"] and w["record_error"] != "None"
    assert sn.WITHDRAWN_NAME in w["record_error"], "the error names the path it could not write"


def test_THE_RUN_IS_BUILT_FROM_THE_NIGHTS_THAT_PRECEDE_THIS_ONE(tmp_path):
    """`history(captures, nights, active)` — all three arguments. `active` decides the reason a
    verdict-less night carries, and a night with no verdict that is still capturing must not reset the
    run (§3.1). Dropping it changes a pending night into an unassessed one."""
    captures = tmp_path
    for d in ("2026-10-01", "2026-10-02"):
        (captures / d).mkdir()
    (captures / "2026-10-01" / sn.VERDICT_NAME).write_text(
        json.dumps({"status": "PASS", "reason": None, "at": "a", "result": {"night": "2026-10-01"}})
    )
    night = captures / "2026-10-02"
    devices = sn.sample_night(str(night))
    _obj, run = sn.write_night(str(night), devices, nights=["2026-10-01", "2026-10-02"], active=set(), commit="abc1234")
    assert run["status"] != "NOT_RUN", "two nights were examined"
    # `>= 1` WOULD NOT HAVE BEEN ENOUGH: selecting the past by `n[1] < night` (the STATUS string, not the
    # date) drops every earlier night, and this night's own PASS still leaves solid == 1. The run has to
    # be pinned to BOTH nights for the selector to be observable at all.
    assert run["solid"] == 2, "the preceding PASS and this night"
    assert run["first"] == "2026-10-01" and run["last"] == "2026-10-02"


def test_THE_WITHDRAWAL_READS_THE_COMMIT_FROM_WHERE_A_REAL_VERDICT_KEEPS_IT(tmp_path):
    """🔴 A BUG OF MINE, caught by the mutation gate rather than by me. `_provenance` first read
    `v.get("commit")`, which is absent on every real verdict — §🧾 puts it in `producedBy` — so the
    withdrawal record would have published `commit: null` for all of them while passing against the
    synthetic dicts in the tests above, which carry a top-level key. An unmeasured field presented as
    measured is the §∅ bug in reverse, and the fixture that hid it did not carry the property the code
    reasons about."""
    night = tmp_path / sn.SAMPLE_NIGHT
    night.mkdir()
    devices = sn.sample_night(str(night))
    sn.write_night(str(night), devices, nights=[sn.SAMPLE_NIGHT], active=set(), commit="0ddc0de")
    obj2, _ = sn.write_night(str(night), devices, nights=[sn.SAMPLE_NIGHT], active=set(), commit="9eedc0d")
    w = obj2["result"]["withdrew"]
    assert w["withdrawn"]["commit"] == "0ddc0de", "read from producedBy, where it actually is"
    assert w["replaced_by"]["commit"] == "9eedc0d"
    # and the legacy/hand-written fallback still answers
    assert sn._provenance({"commit": "feedbed"})["commit"] == "feedbed"


def test_REPLACING_A_VERDICT_WITH_A_NOT_APPLICABLE_ONE_DOES_NOT_CRASH(tmp_path, monkeypatch):
    """The `and` in `withdrawn is not None and obj.get("result") is not None`, exercised through the real
    writer — the one combination where `or` differs: something WAS withdrawn and the replacement has
    `result: null` by contract. With `or` the function subscripts None, the night loses its true verdict
    to a TypeError, and the withdrawal meant to preserve a claim destroys one instead.

    A direct `_withdraw` call cannot see this; the branch lives in `write_night`."""
    nd = tmp_path / "2026-09-20"
    nd.mkdir()
    (nd / sn.VERDICT_NAME).write_text(
        json.dumps({"status": "FAIL", "reason": "earlier claim", "at": AT, "result": {"night": "2026-09-20"}})
    )
    na = sn.compose(
        night="2026-09-20",
        settled=True,
        devices={"H10": {"applicable": False, "reason": "in_charger"}},
        evidence=EV,
        commit=SHA,
        at=AT,
    )
    assert na["status"] == "NOT_APPLICABLE" and na["result"] is None
    monkeypatch.setattr(sn, "night_verdict", lambda *a, **k: na)
    obj, _run = sn.write_night(str(nd), [], nights=["2026-09-20"], active=set())
    assert obj["result"] is None, "NOT_APPLICABLE keeps its null result"
    trail = [json.loads(ln) for ln in (nd / sn.WITHDRAWN_NAME).read_text().splitlines() if ln.strip()]
    assert len(trail) == 1 and trail[0]["withdrawn"]["status"] == "FAIL", "withdrawn to the trail instead"
    assert json.loads((nd / sn.VERDICT_NAME).read_text())["status"] == "NOT_APPLICABLE"
