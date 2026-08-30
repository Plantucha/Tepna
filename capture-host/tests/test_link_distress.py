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
