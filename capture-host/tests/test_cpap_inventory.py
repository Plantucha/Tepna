# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# cpap_inventory — the spool-as-inventory oracle. Pure, so every branch is reachable from a literal.
#
# The two things worth reading before the assertions:
#
# 1. BOTH DIRECTIONS OF THE CONSULTED ASYMMETRY ARE PLANTED. A source that was read and found nothing
#    is evidence; a source nobody read is not. The same input (`spool=[]`) must produce a FINDING in
#    the first case and NOT-DIAGNOSABLE in the second, and a test that only planted one of them would
#    pass under a module that ignored the flag entirely.
#
# 2. THE VACUITY CASE IS ITS OWN TEST, not a corollary. All three empty must REFUSE — "no
#    discrepancies" and "nothing was examined" produce the same empty list and mean opposite things.

import cpap_inventory as ci


# ── night_key ────────────────────────────────────────────────────────────────────────────────────
def test_night_key_accepts_the_shapes_that_actually_occur():
    assert ci.night_key("20260827") == "20260827"                 # DATALOG folder
    assert ci.night_key("2026-08-27T22:14:05") == "20260827"      # ISO envelope stamp
    assert ci.night_key("2026-08-27 22:14") == "20260827"


def test_a_DIGIT_BEARING_PREFIX_does_not_corrupt_the_night():
    """⚠️ REGRESSION PAIR — each half alone is satisfied by a version that breaks the other, which is
    exactly what happened.

    The first implementation concatenated every digit in the string, so the live-envelope filename
    `AS11_20260827_BRP.edf.meta.json` became "1120260827" and its leading eight "11202608" — year
    1120, rejected, night silently LOST. The protocol name is part of the filename; this is the
    ordinary input.

    The first FIX scanned digit runs instead — and an ISO stamp has no eight-digit run at all, so it
    returned None for every envelope timestamp. The test above caught that within one run.

    Both are asserted here together so neither single-pass version can pass again."""
    assert ci.night_key("AS11_20260827_BRP.edf.meta.json") == "20260827"   # digit-bearing prefix
    assert ci.night_key("AS11_2026-08-27_BRP.meta.json") == "20260827"     # …and separators too
    assert ci.night_key("2026-08-27T22:14:05") == "20260827"               # the case the fix broke


def test_night_key_refuses_rather_than_guessing():
    # Fewer than eight digits cannot name a night. Padding or defaulting would attribute a real
    # session to the wrong day, which is worse than not reconciling it at all.
    assert ci.night_key("2026") is None
    assert ci.night_key("") is None
    assert ci.night_key("no digits here") is None


def test_night_key_validates_the_components_it_extracted():
    # Digits are not a calendar. A regex match is not a date, and Date-style silent rolling is exactly
    # the fabricated-instant failure the Clock Contract forbids.
    assert ci.night_key("20261327") is None   # month 13
    assert ci.night_key("20260832") is None   # day 32
    assert ci.night_key("19990101") is None   # before the device era
    assert ci.night_key("21010101") is None


# ── the vacuity case ─────────────────────────────────────────────────────────────────────────────
def test_all_three_empty_REFUSES_and_does_not_report_a_clean_inventory():
    r = ci.reconcile(spool=[], envelopes=[], card=[])
    assert r["ok"] is False
    assert "no data" in r["reason"]
    assert r["records"] == []
    # The QC field must carry the refusal through rather than rendering it as zero discrepancies —
    # laundering a no-data run into a clean one at the boundary where the evidence stops.
    q = ci.qc_field(r)
    assert q["ok"] is False and q["discrepancies"] is None
    # And a refusal produces ONE journal line, never zero — zero is what a healthy night produces.
    lines = ci.journal_lines(r)
    assert len(lines) == 1 and lines[0]["ok"] is False


# ── the six discrepancy states, one test each, since each has a different remedy ──────────────────
def _state(**kw):
    r = ci.reconcile(**kw)
    assert r["ok"] is True
    return [x["state"] for x in r["records"]]


def test_spool_only_is_MISSED_BOTH():
    assert _state(spool=["20260827"], envelopes=[], card=[]) == ["MISSED-BOTH"]


def test_spool_and_card_without_envelope_is_MISSED_LIVE():
    assert _state(spool=["20260827"], envelopes=[], card=["20260827"]) == ["MISSED-LIVE"]


def test_spool_and_envelope_without_card_is_NOT_ON_CARD():
    assert _state(spool=["20260827"], envelopes=["20260827"], card=[]) == ["NOT-ON-CARD"]


def test_envelope_and_card_without_spool_is_SPOOL_SILENT():
    assert _state(spool=[], envelopes=["20260827"], card=["20260827"]) == ["SPOOL-SILENT"]


def test_card_only_is_UNSPOOLED_CARD_NIGHT():
    assert _state(spool=[], envelopes=[], card=["20260827"]) == ["UNSPOOLED-CARD-NIGHT"]


def test_envelope_only_is_ENVELOPE_ONLY():
    assert _state(spool=[], envelopes=["20260827"], card=[]) == ["ENVELOPE-ONLY"]


def test_present_in_all_three_is_COMPLETE_and_is_NOT_a_record():
    r = ci.reconcile(spool=["20260827"], envelopes=["20260827"], card=["20260827"])
    assert r["ok"] is True
    assert r["records"] == []              # a healthy night is not a discrepancy
    assert r["complete"] == ["20260827"]   # …but it IS counted, so zero records is legible
    assert ci.journal_lines(r) == []


# ── the consulted asymmetry, BOTH directions on identical inputs ──────────────────────────────────
def test_an_empty_spool_that_WAS_consulted_is_a_finding():
    # The device was asked and listed nothing for this night. That is evidence.
    assert _state(spool=[], envelopes=["20260827"], card=["20260827"]) == ["SPOOL-SILENT"]


def test_the_SAME_input_with_the_spool_UNCONSULTED_is_not_diagnosable():
    # Measured case (Vigil box, 2026-08-28): the spool is a once-daily Summary transaction, so on the
    # second and later sessions of a day it is simply not run. Reading that emptiness as "the device
    # lists nothing" manufactures a discrepancy per night, forever, from a source nobody read.
    r = ci.reconcile(spool=[], envelopes=["20260827"], card=["20260827"], spool_consulted=False)
    assert [x["state"] for x in r["records"]] == ["NOT-DIAGNOSABLE"]
    assert r["records"][0]["unconsulted"] == ["spool"]
    assert r["consulted"]["spool"] is False


def test_an_unconsulted_source_still_contributes_its_PRESENCES():
    # Presence is evidence regardless: if the unread source somehow reports a night, that night is
    # real. Only its silences are uninformative.
    r = ci.reconcile(spool=["20260827"], envelopes=["20260827"], card=["20260827"], spool_consulted=False)
    assert r["records"] == []   # all three present ⇒ COMPLETE, and the flag changes nothing


def test_the_card_side_the_walk_RAN_versus_the_walk_never_happened():
    # ⚠️ CORRECTED 2026-08-28. My first reading had `barren` as card_consulted=False. It is TRUE: the
    # walk ran and the card held nothing, which is a real absence and therefore evidence. The unread
    # case is the harvest's EARLY EXITS — Wi-Fi never came up, or the listing threw (the exit an absent
    # card takes). Deriving "was the instrument pointed at the subject" from what the instrument
    # RETURNED is the same error one level down, which is why the transport reports it explicitly.
    walk_ran_empty = ci.reconcile(spool=["20260827"], envelopes=["20260827"], card=[])
    assert [x["state"] for x in walk_ran_empty["records"]] == ["NOT-ON-CARD"]
    never_walked = ci.reconcile(spool=["20260827"], envelopes=["20260827"], card=[], card_consulted=False)
    assert [x["state"] for x in never_walked["records"]] == ["NOT-DIAGNOSABLE"]


def test_several_unconsulted_sources_are_all_named():
    r = ci.reconcile(spool=[], envelopes=["20260827"], card=[],
                     spool_consulted=False, card_consulted=False)
    assert r["records"][0]["unconsulted"] == ["spool", "card"]


# ── unparseable entries are reported, never silently dropped ─────────────────────────────────────
def test_unparseable_entries_are_surfaced_not_discarded():
    # Dropping one shrinks an inventory without saying so, which is how a reconciliation reports an
    # agreement it never had.
    r = ci.reconcile(spool=["20260827", "garbage"], envelopes=["20260827"], card=["20260827"])
    assert r["unparseable"] == ["garbage"]
    assert ci.qc_field(r)["unparseable"] == 1
    assert r["counts"]["spool"] == 1


def test_an_inventory_of_only_unparseable_entries_refuses():
    # Nothing resolvable anywhere is the vacuity case by another route: the lists were non-empty and
    # the KEYS are empty, which is still "nothing was examined".
    r = ci.reconcile(spool=["nope"], envelopes=["also nope"], card=["still nope"])
    assert r["ok"] is False
    assert len(r["unparseable"]) == 3


def test_none_inputs_are_treated_as_empty_lists_not_as_errors():
    assert ci.reconcile(spool=None, envelopes=None, card=None)["ok"] is False


# ── the reported shapes ──────────────────────────────────────────────────────────────────────────
def test_qc_field_counts_by_state_so_a_reader_can_act_without_the_records():
    r = ci.reconcile(spool=["20260826", "20260827"], envelopes=["20260827"], card=["20260827"])
    q = ci.qc_field(r)
    assert q["ok"] is True
    assert q["discrepancies"] == 1
    assert q["by_state"] == {"MISSED-BOTH": 1}
    assert q["complete_nights"] == 1
    assert q["counts"] == {"spool": 2, "envelopes": 1, "card": 1}


def test_one_journal_line_per_discrepancy_carrying_its_own_diagnosis():
    r = ci.reconcile(spool=["20260826", "20260827"], envelopes=["20260827"], card=["20260827"])
    lines = ci.journal_lines(r)
    assert len(lines) == 1
    assert lines[0]["event"] == ci.JOURNAL_EVENT
    assert lines[0]["night"] == "20260826"
    assert lines[0]["state"] == "MISSED-BOTH"
    assert "nothing of ours recorded it" in lines[0]["detail"]


def test_records_are_ordered_by_night_so_two_runs_are_comparable():
    r = ci.reconcile(spool=["20260828", "20260826", "20260827"], envelopes=[], card=[])
    assert [x["night"] for x in r["records"]] == ["20260826", "20260827", "20260828"]


def test_every_state_in_the_table_names_a_remedy_not_just_a_condition():
    # A diagnosis nobody can act on is a count with extra words. This pins the contract on the TABLE
    # rather than on one rendered record, so a future state added without a remedy fails here.
    for sig, (name, detail) in ci.STATES.items():
        assert name and detail
        assert len(detail) > 30, f"{name} has no actionable detail"
        assert isinstance(sig, tuple) and len(sig) == 3
    # 2^3 = 8 combinations, minus (False, False, False) which is not a night at all. COMPLETE is one
    # of the remaining seven, not an eighth — my first draft of this line double-counted it.
    assert len(ci.STATES) == 7
