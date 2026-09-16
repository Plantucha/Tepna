# tepna-capture — tests/test_link_distress.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The radio-distress signal, against the corpus it was derived from.

Bands were pre-stated in `briefs/RADIO-FAILOVER-DISTRESS-SIGNAL-2026-08-29-BRIEF.md` BEFORE this
module existed. These tests use the real measured numbers, so a later edit that moves a threshold has
to move a test that names where the number came from.
"""

import link_distress as D

# The O2Ring's own four non-storm nights on the Sena, and the storm.
RING_QUIET = [0.20, 0.23, 0.31, 0.19]
RING_STORM_PER_H = 13.72
# The highest non-storm observation anywhere in the corpus (Verity on the Sena).
CORPUS_MAX_NORMAL = 4.67


def test_the_REAL_STORM_trips_and_a_quiet_night_does_not():
    """The case the unit exists for: 13.72/h against that device's own 0.23 median, ~60x."""
    hot = D.assess(RING_STORM_PER_H, RING_QUIET, 5 * 3600)
    assert hot["state"] == D.DISTRESSED
    assert D.assess(0.3, RING_QUIET, 5 * 3600)["state"] == D.OK


def test_the_HIGHEST_NORMAL_observation_in_the_corpus_does_NOT_trip():
    """🔴 The band must clear every night we have actually seen and called fine. 4.67/h is the worst
    non-storm rate in the corpus; if the floor sat below it, the signal would fire on a real night
    that nobody thought was broken."""
    assert D.assess(CORPUS_MAX_NORMAL, RING_QUIET, 9 * 3600)["state"] == D.OK
    assert CORPUS_MAX_NORMAL < D.FLOOR_PER_H, "the floor no longer clears the worst normal night"


def test_HYSTERESIS_a_single_bad_stretch_does_not_switch():
    """A mask-off or a doorway is not a storm. Switching late costs a bad hour; flapping a device
    between radios all night costs the night."""
    assert D.assess(RING_STORM_PER_H, RING_QUIET, 120)["state"] == D.OK
    assert D.assess(RING_STORM_PER_H, RING_QUIET, D.HYSTERESIS_S - 1)["state"] == D.OK
    assert D.assess(RING_STORM_PER_H, RING_QUIET, D.HYSTERESIS_S)["state"] == D.DISTRESSED


def test_BOTH_arms_must_be_exceeded_floor_and_multiple():
    """The absolute floor stops a near-zero-baseline device tripping on two ordinary reconnects; the
    multiple stops a legitimately noisy device being distressed by being itself."""
    # A noisy-but-normal device: median 3/h, so 10x = 30/h. 20/h clears the floor but not the multiple.
    noisy = [2.8, 3.0, 3.2, 3.1]
    assert D.assess(20.0, noisy, 9 * 3600)["state"] == D.OK
    assert D.assess(31.0, noisy, 9 * 3600)["state"] == D.DISTRESSED
    # A quiet device: median 0.2, so 10x = 2/h — the FLOOR governs, not the multiple.
    assert D.assess(5.0, RING_QUIET, 9 * 3600)["state"] == D.OK
    assert D.band_for(0.2) == D.FLOOR_PER_H


def test_FEWER_THAN_THREE_NIGHTS_is_UNKNOWN_and_never_OK():
    """🔴 The AX210 arrives with ZERO nights. Reporting OK would let a brand-new radio look proven on
    its first night, and UNKNOWN folded into OK is how an unmeasured thing acquires a reputation."""
    for nights in ([], [0.2], [0.2, 0.3]):
        got = D.assess(RING_STORM_PER_H, nights, 9 * 3600)
        assert got["state"] == D.UNKNOWN, nights
        assert got["band"] is None and "not proven by its first night" in got["detail"]
    assert D.baseline_median([0.2, 0.3]) == (None, 2)


def test_a_ZERO_baseline_does_not_collapse_the_band():
    """A device that never reconnected has median 0, and 10x0 is 0 — the floor must still govern, or
    the first reconnect of its life would read as distress."""
    assert D.band_for(0.0) == D.FLOOR_PER_H
    assert D.assess(1.0, [0.0, 0.0, 0.0], 9 * 3600)["state"] == D.OK


def test_unusable_inputs_REFUSE_rather_than_defaulting():
    for bad in ("x", None, float("nan")):
        assert D.assess(bad, RING_QUIET, 3600)["state"] == D.UNKNOWN
    assert D.assess(RING_STORM_PER_H, RING_QUIET, "soon")["state"] == D.UNKNOWN
    # a non-numeric or negative night is dropped, not coerced
    med, n = D.baseline_median([0.2, "x", 0.3, -1.0, 0.4, float("inf")])
    assert n == 3 and med == 0.3


def test_the_switch_EVENT_carries_WHICH_signal_fired_and_its_value():
    """🔴 A switch that leaves only "failed over" is half-silent, and silent healing is the defect
    class this whole unit sits inside. A reader must be able to tell a marginal trip from a 60x one
    without re-deriving the threshold."""
    v = D.assess(RING_STORM_PER_H, RING_QUIET, 5 * 3600)
    ev = D.switch_event(device="Wellue O2Ring-S", from_mac="AA:BB", to_mac="CC:DD", verdict=v)
    assert ev["event"] == "radio-failover" and ev["cause"] == "reconnect-rate"
    assert ev["observed_per_h"] == 13.72 and ev["band_per_h"] == D.FLOOR_PER_H
    assert ev["baseline_median_per_h"] == 0.215 and ev["baseline_nights"] == 4
    assert ev["sustained_s"] == 18000.0 and "sustained" in ev["detail"]
    assert ev["from"] == "AA:BB" and ev["to"] == "CC:DD"


def test_the_event_survives_a_missing_verdict_without_inventing_values():
    """It must not fabricate a cause it does not have — None reads as absent, 0 would read as measured."""
    ev = D.switch_event(device="d", from_mac="a", to_mac="b", verdict=None)
    assert ev["observed_per_h"] is None and ev["band_per_h"] is None and ev["detail"] is None


# ── the per-ADAPTER fold (part (a), 2026-09-01) ─────────────────────────────────────────────────────
# The verdict at the granularity a failover actually moves. Its one load-bearing rule: CORROBORATION.
# One link storming is a device/link pathology that moves WITH the device (the 08-29 ring storm; the
# UB500 losing minutes on wearables and zero on CPAP) — relocating the healthy siblings for it is the
# category mismatch the report-only comment in capture.py names.

def _v(state, observed=None, detail="d"):
    return {"state": state, "observed": observed, "detail": detail}


def test_adapter_fold_needs_TWO_distressed_links_not_one():
    """Both directions: one storming link stays `ok` at ADAPTER granularity (named in the detail, so
    it is visible rather than softened away); a second corroborating link flips the fold."""
    one = D.adapter_verdict({"Ring": _v(D.DISTRESSED, 13.7), "H10": _v(D.OK), "Verity": _v(D.OK)})
    assert one["state"] == D.OK
    assert "Ring" in one["detail"] and "device-local" in one["detail"]
    two = D.adapter_verdict({"Ring": _v(D.DISTRESSED, 13.7), "H10": _v(D.DISTRESSED, 9.1),
                             "Verity": _v(D.OK)})
    assert two["state"] == D.DISTRESSED
    assert two["distressed"] == ["H10", "Ring"] and "adapter-wide" in two["detail"]


def test_adapter_fold_carries_the_WORST_link_so_the_event_needs_no_second_lookup():
    out = D.adapter_verdict({"a": _v(D.DISTRESSED, 2.0), "b": _v(D.DISTRESSED, 13.7)})
    assert out["worst"]["observed"] == 13.7


def test_adapter_fold_refuses_when_NO_link_is_rated():
    """An adapter whose every link is unbaselined is UNJUDGED — same rule as assess: a caller must
    not be able to read a refusal as an all-clear."""
    out = D.adapter_verdict({"a": _v(D.UNKNOWN), "b": _v(D.UNKNOWN)})
    assert out["state"] == D.UNKNOWN and out["rated"] == 0 and out["unknown"] == 2
    assert D.adapter_verdict({})["state"] == D.UNKNOWN


def test_adapter_fold_counts_carry_their_filter():
    """`rated` vs `unknown` is the difference between "quiet" and "unexamined" — a bare state cannot
    show it, so the counts ride every verdict (the state-your-filter rule)."""
    out = D.adapter_verdict({"a": _v(D.OK), "b": _v(D.UNKNOWN), "c": _v(D.OK)})
    assert out["state"] == D.OK and out["rated"] == 2 and out["unknown"] == 1
    assert "2 rated" in out["detail"] and "1 unknown" in out["detail"]


def test_adapter_fold_unknown_links_do_not_count_toward_corroboration():
    """Two unknowns plus one distressed is still device-local: corroboration must come from a RATED
    sibling, or a fleet of unbaselined links would vote with verdicts they do not have."""
    out = D.adapter_verdict({"a": _v(D.DISTRESSED, 9.0), "b": _v(D.UNKNOWN), "c": _v(D.UNKNOWN)})
    assert out["state"] == D.OK and "device-local" in out["detail"]


def test_the_corroboration_floor_is_two_and_not_configurable():
    """Pinned so a future knob has to move a test that names why: lowering it to 1 re-creates the
    single-global-pin category mismatch as configuration."""
    assert D.ADAPTER_CORROBORATION == 2


# ── BLE-TRANSPORT-REDESIGN §1.7 — an adapter reservation is a LEASE ────────────────────────────────
# "A reservation the code can override by writing a sentence is not a reservation." The brief's two
# honest options are REFUSE or PREEMPT-AND-RECORD; "override and log" is neither. Preemption is the
# option taken (refusing is a data-loss trade), so behaviour is unchanged and only the evidence moves.

def _ev(**kw):
    base = dict(device="H10", from_mac="AA:AA", to_mac="BB:BB", verdict={}, cause="wedged")
    base.update(kw)
    return D.switch_event(**base)


def test_LEASE_taking_a_reserved_adapter_is_recorded_as_a_decision():
    """Before this, commandeering the CPAP's dedicated radio left only a log line — measured 60/67/65
    times per night on 2026-09-05/06/07, invisible to anything that survives the night."""
    ev = _ev(to_mac="CC:CC", reserved=("CC:CC",),
             preemption={"adapter_mac": "CC:CC", "holder": "cpap.ble_stream",
                         "reason": "no unreserved adapter was available"})
    assert ev["preemption"]["holder"] == "cpap.ble_stream"
    assert ev["preemption"]["adapter_mac"] == "CC:CC"
    assert ev["reserved_adapters"] == ["CC:CC"]


def test_LEASE_a_respected_lease_is_DISTINGUISHABLE_from_no_lease_at_all():
    """The reason `reserved_adapters` rides along. Without it, `preemption: null` conflates two
    different facts — "a lease existed and was honoured" and "there was no lease" — and only one of
    those is evidence that the reservation mechanism did anything."""
    respected = _ev(to_mac="DD:DD", reserved=("CC:CC",))          # a lease existed, spare is not it
    none_configured = _ev(to_mac="DD:DD")                          # no lease at all

    assert respected["preemption"] is None and none_configured["preemption"] is None
    assert respected["reserved_adapters"] == ["CC:CC"]
    assert none_configured["reserved_adapters"] == []
    # PLANT: the two must NOT be the same record — that conflation is the defect this field fixes.
    assert respected != none_configured


def test_LEASE_the_absence_is_null_never_an_empty_dict_or_False():
    """§∅. `preemption` is an ABSENCE when nothing was preempted; a falsy stand-in ({} or False) reads
    as 'a preemption that was empty' to anything doing a key lookup."""
    ev = _ev()
    assert ev["preemption"] is None
    assert ev["preemption"] != {} and ev["preemption"] is not False


def test_LEASE_the_event_still_carries_the_signal_that_fired():
    """The §1.7 fields are ADDITIVE — the existing contract (which signal fired, and its value) must
    survive, or this trades one half-silent record for another."""
    ev = _ev(verdict={"observed": 61.0, "band": "red", "median": 1.0, "nights": 7},
             reserved=("CC:CC",), preemption={"adapter_mac": "CC:CC", "holder": "cpap.ble_stream",
                                              "reason": "none available"})
    assert ev["observed_per_h"] == 61.0 and ev["band_per_h"] == "red"
    assert ev["baseline_median_per_h"] == 1.0 and ev["event"] == "radio-failover"
